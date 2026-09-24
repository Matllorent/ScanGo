const express = require('express');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const { getSupabaseClient } = require('../utils/supabase');
const idempotencyMiddleware = require('../middleware/idempotency');
const { successResponse, errorResponse } = require('../utils/response');
const logger = require('../utils/logger');

const router = express.Router();

/**
 * POST /api/webhooks/payments
 * Automatic payment webhook handler for payment gateways (Stripe, MercadoPago, LemonSqueezy, dLocal)
 */
router.post('/payments', idempotencyMiddleware, async (req, res, next) => {
  try {
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
            logger.warn('[Supabase Webhook Sub Update Warning]', { error: e.message });
          }
        }

        logger.info('Subscription activated automatically via Payment Webhook', {
          restaurantId: restaurant.id,
          eventId
        });

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
 * Generic provider webhook router
 */
router.post('/:provider', idempotencyMiddleware, async (req, res, next) => {
  try {
    const provider = req.params.provider;
    const rawBody = JSON.stringify(req.body);

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
