/**
 * api/routes/billing.js
 * ─────────────────────
 * Facturación del dueño (/api/billing/*): baja voluntaria, checkout,
 * webhooks de pasarelas y estado. Extraído de api/index.js sin cambios de
 * comportamiento. NOTA: `app.use('/api/billing', requireActiveSubscription)`
 * en index.js está registrado DESPUÉS de estas rutas (guard inefectivo para
 * ellas, el checkout debe funcionar en trial); el mount del router conserva
 * ese orden a propósito — no moverlo debajo del guard.
 */
const express = require('express');
const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');
const { authMiddleware } = require('../middleware/auth');
const { checkSubscriptionKillSwitch } = require('../middleware/killSwitch');
const { invalidateMenuCache } = require('../middleware/cache');
const { successResponse } = require('../utils/response');
const { timingSafeEqualHex } = require('../utils/adminSession');
const sentry = require('../utils/sentry');

const router = express.Router();

// POST /api/billing/cancel — baja voluntaria inmediata (derecho a dar de
// baja, Ley 17.250). El menú se pausa al instante y se puede reactivar cuando
// se quiera. Si el cobro es por pasarela recurrente, el dueño también debe
// cancelarla en su cuenta de Mercado Pago/Stripe (se le indica en la respuesta).
router.post('/cancel', authMiddleware, async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const current = restaurant.subscription || {};
    if (current.status === 'canceled') {
      return successResponse(res, { subscription: current }, 'La suscripción ya estaba dada de baja');
    }
    const updated = await db.updateSubscription(restaurant.id, {
      status: 'canceled',
      canceledAt: new Date().toISOString(),
      previousPlan: current.plan || null
    });
    await invalidateMenuCache(restaurant.slug).catch(() => {});
    return successResponse(res, {
      subscription: updated,
      gatewayNote: 'Si tu cobro es recurrente por Mercado Pago o Stripe, cancelá también la suscripción desde tu cuenta de la pasarela para no recibir más cargos. Ante cualquier duda escribinos por WhatsApp.'
    }, 'Suscripción dada de baja. Tu menú quedó pausado y podés reactivarlo cuando quieras.');
  } catch (err) {
    next(err);
  }
});
router.post('/checkout', authMiddleware, checkSubscriptionKillSwitch, async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });

    const { planId, plan, countryCode, currency } = req.body || {};
    const checkout = await billingOrchestrator.createCheckout({
      restaurantId: restaurant.id,
      // Acepta planId ('starter_monthly') o el alias corto que manda la UI ('monthly' | 'annual')
      planId: planId || plan || (restaurant.subscription && restaurant.subscription.plan) || 'starter_monthly',
      customerEmail: req.user.email,
      countryCode: countryCode || req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || 'UY',
      currency: currency || restaurant.currency || 'USD'
    });

    if (!checkout.checkoutUrl) {
      const missing = checkout.configuration && checkout.configuration.missing;
      return res.status(503).json({
        success: false,
        error: checkout.error
          || (missing && missing.length
            ? `La pasarela de pagos (${checkout.provider}) no está configurada. Faltan variables: ${missing.join(', ')}.`
            : 'No pudimos generar el enlace de pago. Intentá nuevamente en unos minutos.'),
        code: checkout.error ? 'PAYMENT_PROVIDER_ERROR' : 'PAYMENT_PROVIDER_NOT_CONFIGURED',
        provider: checkout.provider,
        ...(missing ? { missing } : {}),
        ...(checkout.pricing ? { pricing: checkout.pricing } : {})
      });
    }

    res.json(checkout);
  } catch (e) {
    next(e);
  }
});

router.post('/webhook/:provider', async (req, res) => {
  try {
    const provider = req.params.provider;
    // Mercado Pago entrega el secreto por query string (notification_url).
    // Comparación en tiempo constante (mismo criterio que ADMIN_KEY).
    const expectedSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (provider === 'mercadopago' && expectedSecret && !timingSafeEqualHex(req.query.secret, expectedSecret)) {
      return res.status(401).json({ error: 'Webhook secret inválido', code: 'WEBHOOK_SECRET_INVALID' });
    }
    // Fail-closed en prod: sin secreto configurado no se acepta nada de MP.
    // (En dev/tests se mantiene abierto para no romper el flujo local.)
    if (provider === 'mercadopago' && !expectedSecret && process.env.NODE_ENV === 'production') {
      return res.status(503).json({ error: 'Webhook de Mercado Pago sin configurar', code: 'MP_WEBHOOK_NOT_CONFIGURED' });
    }

    // IPN legado manda topic/id por query y el body viene vacío
    const payload = { ...(req.query || {}), ...(req.body || {}) };
    const rawBody = JSON.stringify(payload);
    const result = await billingOrchestrator.processWebhook(provider, req.headers, rawBody, payload);
    res.json(result);
  } catch (e) {
    sentry.captureException(e, {
      source: 'webhooks.provider',
      level: 'error',
      // Sin query en tags: el notification_url de MP trae ?secret= en la URL.
      tags: { provider: req.params.provider },
      extra: { path: String(req.originalUrl || '').split('?')[0] }
    });
    res.status(400).json({ error: e.message });
  }
});

router.get('/status', authMiddleware, (req, res) => {
  const restaurant = db.findRestaurantByUserId(req.user.userId);
  if (!restaurant) return res.status(404).json({ error: 'No encontrado' });

  const access = billingOrchestrator.verifyAccess(restaurant.id);
  res.json({
    subscription: restaurant.subscription,
    access
  });
});

module.exports = router;
