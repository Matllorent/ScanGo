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
  // Feed Descubrir beta: público por IP (no hay slug), balde generoso porque
  // cada visita pagina varias veces. Cache de 60s en la ruta amortigua picos.
  discoverLimiter: createRateLimit(60, 'DISCOVER_RATE_LIMITED', 'Demasiadas consultas al Descubrir en poco tiempo.'),
  storageLimiter: createRateLimit(20, 'STORAGE_RATE_LIMITED', 'Límite de cargas excedido.'),
  groupCartLimiter: createRateLimit(90, 'GROUP_CART_RATE_LIMITED', 'Límite de sincronización de mesa excedido.'),
  // Login maestro del panel /admin: exactamente 5 intentos por IP cada 15 min.
  adminLimiter: createRateLimit(
    5,
    'ADMIN_RATE_LIMIT_EXCEEDED',
    'Acceso temporalmente bloqueado por seguridad: has superado el límite de 5 intentos. Esperá 15 minutos antes de volver a intentar.'
  ),
  // Creación individual de platos (POST /api/studio/dishes): 30 req/min por tenant
  dishCreationLimiter: createRateLimit(30, 'DISH_CREATION_RATE_LIMITED', 'Demasiados platos creados en poco tiempo.'),
  // Guardado masivo con platos (POST /api/studio/save con dishes[]): 5 req/min por tenant
  dishBulkSaveLimiter: createRateLimit(5, 'DISH_BULK_SAVE_RATE_LIMITED', 'Demasiados guardados masivos de carta en poco tiempo.'),
  // Equipo operativo: el mozo hace polling de mesas cada 30 s durante todo el
  // turno (≈120 req/15 min por dispositivo). El balde es por IP y generoso.
  staffLimiter: createRateLimit(300, 'STAFF_RATE_LIMITED', 'Demasiadas operaciones del turno en poco tiempo.'),
  // Activación del turno: 24 bytes de secreto hacen la fuerza bruta imposible;
  // el límite corta el abuso antes de que llegue al hash.
  staffShiftLimiter: createRateLimit(30, 'STAFF_SHIFT_RATE_LIMITED', 'Demasiados intentos de activar un turno.'),
  publicEventKeyGenerator
};