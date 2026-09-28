const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const emailService = require('../services/email');
const { getSupabaseClient } = require('../utils/supabase');
const idempotencyMiddleware = require('../middleware/idempotency');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');
const sentry = require('../utils/sentry');

const router = express.Router();

/**
 * Verifica la firma HMAC del webhook usando timing-safe comparison.
 * Soporta múltiples formatos de header y algoritmos.
 */
function verifyWebhookSignature(rawBody, headers, secret) {
  if (!secret || !rawBody) return false;

  const signature =
    headers['x-signature'] ||
    headers['x-webhook-signature'] ||
    headers['stripe-signature'] ||
    headers['x-mercadopago-signature'] ||
    headers['x-hub-signature-256'] ||
    '';

  if (!signature) return false;

  try {
    // Lemon Squeezy / genérico: HMAC-SHA256 directo
    const hmac = crypto.createHmac('sha256', secret);
    const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
    const sig = Buffer.from(signature, 'utf8');

    if (digest.length === sig.length && crypto.timingSafeEqual(digest, sig)) {
      return true;
    }

    // Stripe: formato "t=timestamp,v1=signature"
    if (signature.includes(',')) {
      const parts = signature.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const sigPart = parts.find(p => p.startsWith('v1='));
      if (timestampPart && sigPart) {
        const timestamp = timestampPart.split('=')[1];
        const sig = sigPart.split('=')[1];
        const payload = timestamp + '.' + rawBody;
        const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
      }
    }

    // GitHub-style: sha256=prefix
    if (signature.startsWith('sha256=')) {
      const sig = signature.slice(7);
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(digest, 'utf8'));
    }

    return false;
  } catch (e) {
    return false;
  }
}

/**
 * POST /api/webhooks/payments
 * Automatic payment webhook handler for payment gateways (Stripe, MercadoPago, LemonSqueezy, dLocal)
 * REQUIERE validación estricta de firma HMAC antes de procesar cualquier cambio de estado.
 */
router.post('/payments', async (req, res, next) => {
  try {
    const rawBody = JSON.stringify(req.body);
    const webhookSecret = process.env.WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '';

    // Validación estricta de firma HMAC — rechaza con 401 si no es válida
    if (!webhookSecret) {
      logger.error('[Webhook Security] WEBHOOK_SECRET no configurado — rechazando webhook');
      return res.status(401).json({
        success: false,
        error: 'Webhook secret no configurado en el servidor',
        code: 'WEBHOOK_SECRET_MISSING'
      });
    }

    if (!verifyWebhookSignature(rawBody, req.headers, webhookSecret)) {
      logger.warn('[Webhook Security] Firma HMAC inválida — rechazando webhook', {
        ip: req.ip,
        headers: req.headers
      });
      return res.status(401).json({
        success: false,
        error: 'Firma de webhook inválida',
        code: 'INVALID_WEBHOOK_SIGNATURE'
      });
    }

    const payload = req.body || {};
    const eventType = payload.event || payload.type || payload.event_type || 'payment.created';
    const eventId = req.headers['x-event-id'] || req.headers['x-request-id'] || payload.id || payload.event_id || payload.data?.id;

    // Verify successful payment event types
    const successfulEvents = [
      'payment_intent.succeeded',
      'checkout.session.completed',
      'merchant_order.created',
      'payment.created',
      'payment_created',
      'invoice.payment_succeeded',
      'subscription_payment_success',
      'order.success',
      'approved'
    ];

    const isSuccessfulPayment = successfulEvents.some(e => String(eventType).toLowerCase().includes(e));

    logger.info('Payment Webhook Received', { eventType, eventId });

    if (isSuccessfulPayment) {
      // Extract target identifiers
      const restaurantId = payload.restaurant_id || payload.restaurantId || payload.data?.restaurant_id || payload.data?.metadata?.restaurant_id;
      const userId = payload.user_id || payload.userId || payload.data?.user_id || payload.data?.metadata?.user_id;
      const email = payload.customer_email || payload.email || payload.data?.customer_email || payload.data?.customer?.email;

      let restaurant = null;
      if (restaurantId) {
        restaurant = db.findRestaurantById(restaurantId);
      } else if (userId) {
        restaurant = db.findRestaurantByUserId(userId);
      } else if (email) {
        const user = db.findUserByEmail(email);
        if (user) restaurant = db.findRestaurantByUserId(user.id);
      }

      if (restaurant) {
        const updatedSubscription = {
          status: 'active',
          plan: 'pro_monthly',
          provider: payload.provider || 'payment_gateway',
          updated_at: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        };

        // Update in local DB memory/cache adapter
        db.updateSubscription(restaurant.id, updatedSubscription);

        // Sync to Supabase PostgreSQL table `restaurants` and `webhooks`
        const supabase = getSupabaseClient();
        if (supabase) {
          try {
            await supabase
              .from('restaurants')
              .update({
                subscription: updatedSubscription,
                updated_at: updatedSubscription.updated_at
              })
              .eq('id', restaurant.id);

            // Log event in public.webhooks for strict idempotency
            if (eventId) {
              await supabase.from('webhooks').insert([{
                provider: payload.provider || 'stripe_mercadopago',
                event_id: String(eventId),
                event_type: eventType,
                data: { restaurant_id: restaurant.id, status: 'active' }
              }]);
            }
          } catch (e) {
            sentry.captureException(e, {
              source: 'webhooks.supabaseUpdate',
              level: 'warn',
              tags: { restaurantId: restaurant.id, eventId },
              extra: { provider: payload.provider }
            });
          }
        }

        logger.info('Subscription activated automatically via Payment Webhook', {
          restaurantId: restaurant.id,
          eventId
        });

        // Comprobante de pago por email (no bloqueante, con reintentos vía retryQueue)
        try {
          const owner = db.findUserById(restaurant.userId);
          if (owner) {
            emailService.sendPaymentReceiptEmail({
              to: owner.email,
              userName: owner.name,
              restaurantName: restaurant.name || restaurant.bizName,
              planName: billingOrchestrator.getPlanName(updatedSubscription.plan)
            }).catch(e => logger.warn('[Payment Webhook] Failed to send receipt email:', e.message));
          }
        } catch (e) {
          logger.warn('[Payment Webhook] Failed to send receipt email:', e.message);
        }

        return res.status(200).json({
          success: true,
          message: `Suscripción del restaurante ${restaurant.id} activada automáticamente`,
          subscription: updatedSubscription,
          timestamp: new Date().toISOString()
        });
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Webhook recibido y registrado',
      eventType,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/webhooks/:provider
 * Generic provider webhook router con validación estricta de firma HMAC.
 */
router.post('/:provider', async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const rawBody = JSON.stringify(req.body);

    // Validación estricta de firma HMAC específica del proveedor
    const providerSecret = process.env[provider.toUpperCase() + '_WEBHOOK_SECRET'] || '';
    const genericSecret = process.env.WEBHOOK_SECRET || process.env.PAYMENT_WEBHOOK_SECRET || '';
    const secret = providerSecret || genericSecret;

    if (!secret) {
      logger.error(`[Webhook Security] Secret no configurado para ${provider} — rechazando webhook`);
      return res.status(401).json({
        success: false,
        error: 'Webhook secret no configurado en el servidor',
        code: 'WEBHOOK_SECRET_MISSING'
      });
    }

    if (!verifyWebhookSignature(rawBody, req.headers, secret)) {
      logger.warn(`[Webhook Security] Firma HMAC inválida para ${provider} — rechazando webhook`, {
        ip: req.ip,
        provider
      });
      return res.status(401).json({
        success: false,
        error: 'Firma de webhook inválida',
        code: 'INVALID_WEBHOOK_SIGNATURE'
      });
    }

    const result = await billingOrchestrator.processWebhook(
      provider,
      req.headers,
      rawBody,
      req.body
    );

    return res.status(200).json({
      success: true,
      message: `Webhook ${provider} procesado exitosamente`,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    logger.error(`[Webhook Route Error ${req.params.provider}]`, { error: err.message });
    return errorResponse(res, err.message || 'Error al procesar el webhook', 400, null, 'WEBHOOK_PROCESSING_FAILED');
  }
});

module.exports = router;
