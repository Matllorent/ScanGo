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
  const raw = req?.params?.slug ?? req?.query?.slug ?? req?.body?.slug ?? req?.body?.restaurantSlug;
  const slug = typeof raw === 'string'
    ? raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 80)
    : '';
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
  // El aviso de mozo lo disparan MUCHOS comensales distintos de UN mismo
  // restaurante: se agrupa por slug (un balde por local), no por IP global,
  // con un máximo alto para no bloquear una mesa ocupada. Mismo patrón que
  // publicAnalyticsLimiter, pero con semántica de "alerta operativa".
  waiterAlertLimiter: createRateLimit(
    300,
    'WAITER_ALERT_RATE_LIMITED',
    'Demasiados avisos de mesa en poco tiempo.',
    { keyGenerator: publicEventKeyGenerator, validate: { keyGeneratorIpFallback: false } }
  ),
  loyaltyLimiter: createRateLimit(30, 'LOYALTY_RATE_LIMITED', 'Demasiadas operaciones de fidelización en poco tiempo.'),
  storageLimiter: createRateLimit(20, 'STORAGE_RATE_LIMITED', 'Límite de cargas excedido.'),
  groupCartLimiter: createRateLimit(90, 'GROUP_CART_RATE_LIMITED', 'Límite de sincronización de mesa excedido.'),
  publicEventKeyGenerator
};