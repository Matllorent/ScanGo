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

module.exports = {
  requireActiveSubscription
};
