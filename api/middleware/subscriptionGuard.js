const db = require('../../src/db/db');
const billingOrchestrator = require('../../src/billing/orchestrator');

/**
 * Middleware: Requires an active subscription to access Studio routes.
 * Returns 402 with structured error if subscription is expired, canceled, or past_due beyond grace.
 */
function requireActiveSubscription(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado',
      code: 'UNAUTHORIZED'
    });
  }

  const restaurant = db.findRestaurantByUserId(req.user.userId);
  if (!restaurant) {
    return res.status(404).json({
      success: false,
      error: 'Restaurante no encontrado',
      code: 'RESTAURANT_NOT_FOUND'
    });
  }

  const access = billingOrchestrator.verifyAccess(restaurant.id);

  if (!access.allowed) {
    return res.status(402).json({
      success: false,
      error: 'Suscripción requerida',
      code: 'SUBSCRIPTION_REQUIRED',
      warning: access.warning || 'Tu suscripción está inactiva. Actualizá tu plan para continuar.',
      subscriptionStatus: access.status,
      billingUrl: '/studio?billing=required'
    });
  }

  req.restaurant = restaurant;
  req.subscriptionAccess = access;
  next();
}

/**
 * Variante async para POST /api/studio/save: espera la hidratación cloud y
 * permite el caso "usuario sin local" (primera carta). Sin esto, un cold start
 * de Vercel respondía 404 RESTAURANT_NOT_FOUND antes de que el handler pudiera
 * crear el local, y el scaffold legítimo del Studio quedaba muerto.
 *
 * Si el local existe, aplica EXACTAMENTE el mismo gate de suscripción. Si la
 * hidratación falla, 503 (nunca se asume "no tiene local").
 */
async function requireActiveSubscriptionForStudioSave(req, res, next) {
  if (!req.user || !req.user.userId) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado',
      code: 'UNAUTHORIZED'
    });
  }

  let restaurant;
  try {
    restaurant = await db.lazyLoadRestaurantByUserId(req.user.userId);
  } catch (e) {
    if (e && e.code === 'RESTAURANT_LOAD_FAILED') {
      return res.status(503).json({
        success: false,
        error: 'No pudimos cargar tu local en este momento. Reintentá en unos segundos.',
        code: 'RESTAURANT_LOAD_FAILED'
      });
    }
    return next(e);
  }

  if (!restaurant) {
    // Primera carta: no hay suscripción que verificar todavía. `saveRestaurant`
    // crea el local con el trial de 7 días.
    req.restaurant = null;
    req.subscriptionAccess = { allowed: true, status: 'trial_pending', firstRestaurant: true };
    return next();
  }

  const access = billingOrchestrator.verifyAccess(restaurant.id);
  if (!access.allowed) {
    return res.status(402).json({
      success: false,
      error: 'Suscripción requerida',
      code: 'SUBSCRIPTION_REQUIRED',
      warning: access.warning || 'Tu suscripción está inactiva. Actualizá tu plan para continuar.',
      subscriptionStatus: access.status,
      billingUrl: '/studio?billing=required'
    });
  }

  req.restaurant = restaurant;
  req.subscriptionAccess = access;
  next();
}

module.exports = {
  requireActiveSubscription,
  requireActiveSubscriptionForStudioSave
};
