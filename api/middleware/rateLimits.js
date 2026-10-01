const rateLimit = require('express-rate-limit');

function createRateLimit(max, code, message) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: message, code }
  });
}

module.exports = {
  publicAnalyticsLimiter: createRateLimit(120, 'ANALYTICS_RATE_LIMITED', 'Límite de eventos excedido.'),
  emailLimiter: createRateLimit(10, 'EMAIL_RATE_LIMITED', 'Límite de envíos de correo excedido.'),
  notificationLimiter: createRateLimit(20, 'NOTIFICATION_RATE_LIMITED', 'Límite de notificaciones excedido.'),
  storageLimiter: createRateLimit(20, 'STORAGE_RATE_LIMITED', 'Límite de cargas excedido.'),
  groupCartLimiter: createRateLimit(90, 'GROUP_CART_RATE_LIMITED', 'Límite de sincronización de mesa excedido.')
};