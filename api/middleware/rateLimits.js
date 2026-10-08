const rateLimit = require('express-rate-limit');

function createRateLimit(max, code, message, extra = {}) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: message, code },
    ...extra
  });
}

// El canal público de analytics no manda headers de tenant: se agrupa por slug
// de menú (un balde por restaurante) en lugar de por IP. En Vercel, sin esto,
// todos los visitantes de todos los restaurantes compartirían UN balde de 120
// eventos y el menú público empezaría a devolver 429 con poco tráfico.
function publicEventKeyGenerator(req) {
  const slug = req?.body?.slug;
  return slug ? `slug:${slug}` : `ip:${req?.ip || 'unknown'}`;
}

module.exports = {
  publicAnalyticsLimiter: createRateLimit(
    120,
    'ANALYTICS_RATE_LIMITED',
    'Límite de eventos excedido.',
    { keyGenerator: publicEventKeyGenerator, validate: { keyGeneratorIpFallback: false } }
  ),
  emailLimiter: createRateLimit(10, 'EMAIL_RATE_LIMITED', 'Límite de envíos de correo excedido.'),
  notificationLimiter: createRateLimit(20, 'NOTIFICATION_RATE_LIMITED', 'Límite de notificaciones excedido.'),
  storageLimiter: createRateLimit(20, 'STORAGE_RATE_LIMITED', 'Límite de cargas excedido.'),
  groupCartLimiter: createRateLimit(90, 'GROUP_CART_RATE_LIMITED', 'Límite de sincronización de mesa excedido.'),
  publicEventKeyGenerator
};