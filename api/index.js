require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../src/db/db');
const { requireActiveSubscription } = require('./middleware/subscriptionGuard');
const errorHandler = require('./middleware/errorHandler');
const { successResponse, errorResponse } = require('./utils/response');
const requireVerifiedEmail = require('./middleware/requireVerifiedEmail');
const requestIdMiddleware = require('./middleware/requestId');
const { invalidateMenuCache } = require('./middleware/cache');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');
const sentry = require('./utils/sentry');
const securityHeaders = require('./utils/securityHeaders');
const { normalizeDemoType, isDemoSlug } = require('./utils/demoRestaurants');
const authRouter = require('./routes/auth');
const reviewsRouter = require('./routes/reviews');
const storageRouter = require('./routes/storage');
const webhooksRouter = require('./routes/webhooks');
const notificationsRouter = require('./routes/notifications');
const emailRouter = require('./routes/email');
const healthRouter = require('./routes/health');
const ordersRouter = require('./routes/orders');
const analyticsRouter = require('./routes/analytics');
const aiRouter = require('./routes/ai');
const studioRouter = require('./routes/studio');
const loyaltyRouter = require('./routes/loyalty');
const discoverRouter = require('./routes/discover');
const adminRouter = require('./routes/admin');
const billingRouter = require('./routes/billing');
const menuRouter = require('./routes/menu');
const menuSsrRouter = require('./routes/menuSsr');
const eventsRouter = require('./routes/events');
const discoveryRouter = require('./routes/discovery');
const publicRouter = require('./routes/public');
const accountRouter = require('./routes/account');
const billingDunningRouter = require('./cron/billing-dunning');
const telemetryRetentionRouter = require('./cron/telemetry-retention');
const seoAuditCronRouter = require('./cron/seo-audit');
const reviewNudgeCronRouter = require('./cron/review-nudge');

const app = express();
// Detrás de Vercel (proxy) el req.ip real llega por X-Forwarded-For (Vercel lo
// reescribe en el edge). Sin trust proxy, todo el tráfico comparte la IP del
// proxy y el rate-limit por IP no distingue clientes (429 masivo injusto).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
// Fail-closed en producción: sin secretos no se arranca (en dev se mantiene el
// fallback actual para no romper el flujo local ni la suite de tests).
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en producción (fail-closed: sin secreto no se arranca).');
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_KEY) {
  throw new Error('Falta ADMIN_KEY en producción (fail-closed: sin clave maestra no se arranca).');
}
if (process.env.NODE_ENV === 'production' && !process.env.ADMIN_TOTP_SECRET) {
  throw new Error('Falta ADMIN_TOTP_SECRET en producción (fail-closed: sin secreto 2FA no se arranca).');
}

// Initialize Sentry for centralized error tracking (no-op if SENTRY_DSN not set)
sentry.initSentry();

// Un flip de suscripción (webhook/cron/admin) cambia el menú público
// (pausado ↔ online): invalida la caché igual que POST /api/studio/save.
// Registrado acá (capa HTTP) porque db.js no puede requerir api/middleware.
if (db && typeof db.onSubscriptionChange === 'function') {
  db.onSubscriptionChange(({ slug } = {}) => {
    if (!slug) return;
    try {
      const { memoryCache } = require('./middleware/cache');
      if (memoryCache) memoryCache.delete(slug);
    } catch { /* best-effort */ }
    invalidateMenuCache(slug).catch(() => {});
  });
}

// Resolve public directory reliably across environments: ver
// api/utils/paths.js (fuente única, también usada por routes/menuSsr.js).
const fs = require('fs');
const { PUBLIC_DIR } = require('./utils/paths');

// Tracing Middleware (X-Request-ID)
app.use(requestIdMiddleware);

// Security headers: ver api/utils/securityHeaders.js (única fuente de verdad;
// en producción Vercel aplica los mismos a los estáticos vía vercel.json).
app.disable('x-powered-by');
app.use(securityHeaders.securityHeadersMiddleware);

// CORS con allowlist explícita (fail-closed en producción): APP_URL,
// PUBLIC_URL, ADMIN_URL y LANDING_URL (aceptan listas separadas por coma) +
// localhost solo en dev. Sin header Origin (curl, health checks, server-to-
// server) se permite; con Origin fuera de la lista se deniega (sin header
// ACAO) pero sin romper la respuesta (health y APIs siguen 200).
const CORS_ALLOWLIST = [process.env.APP_URL, process.env.PUBLIC_URL, process.env.ADMIN_URL, process.env.LANDING_URL]
  .flatMap(v => String(v || '').split(','))
  .map(s => s.trim().replace(/\/+$/, ''))
  .filter(Boolean);
function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  const clean = String(origin).trim().replace(/\/+$/, '');
  if (CORS_ALLOWLIST.includes(clean)) return callback(null, true);
  if (process.env.NODE_ENV !== 'production' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(clean)) {
    return callback(null, true);
  }
  return callback(null, false);
}
app.use(cors({ origin: corsOrigin, credentials: true }));
app.use(cookieParser());
// Anti-CSRF en profundidad: mutaciones con cookie de sesión exigen Origin
// propio cuando el browser lo envía (ver api/middleware/originCheck.js).
app.use(require('./middleware/originCheck'));
// Límite global chico (1mb). Los payloads grandes (fotos base64 del import con
// IA) usan el parser de 25mb solo en /api/studio/ai-import y /api/ai/* — ver
// el dispatcher de abajo y los mounts explícitos antes de cada router.
const jsonStandardLimit = express.json({ limit: '1mb' });
const jsonLargeLimit = express.json({ limit: '25mb' });
function isLargePayloadPath(pathname) {
  return pathname === '/api/studio/ai-import'
    || pathname === '/api/ai'
    || pathname.startsWith('/api/ai/');
}
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && isLargePayloadPath(req.path || '')) {
    return jsonLargeLimit(req, res, next);
  }
  return jsonStandardLimit(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use(async (req, res, next) => {
  if ((!req.path.startsWith('/api/') && !req.path.startsWith('/m/')) ||
      req.path === '/api/health' || req.path === '/api/healthz') {
    return next();
  }

  try {
    const readiness = await db.ready;
    if (!readiness?.ready) {
      return res.status(503).json({
        success: false,
        error: 'La persistencia no está disponible; intenta nuevamente en unos instantes.',
        code: 'DATABASE_NOT_READY'
      });
    }
    return next();
  } catch (error) {
    return res.status(503).json({ success: false, error: 'La base de datos no está disponible.', code: 'DATABASE_NOT_READY' });
  }
});


// Dynamic Tenant & IP Rate Limiter
const tenantKeyGenerator = (req) => {
  return req.headers['x-tenant-id'] || req.headers['x-restaurant-id'] || req.user?.userId || req.ip;
};

// Auth usa SIEMPRE la IP real (trust proxy): la key por header es spoofeable
// (rotar x-tenant-id daba baldes frescos). Detrás de un NAT se comparte el
// balde de login, aceptable para 20 intentos/15min.
const authIpKeyGenerator = (req) => req.ip;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  // 30 intentos/15min por IP: frena floods sin castigar NATs compartidas
  // (móviles detrás de CGNAT). No es anti-brute-force real — eso requiere
  // lockout por cuenta + CAPTCHA (diseño pendiente, ver AGENTS.md).
  max: 30,
  keyGenerator: authIpKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, error: 'Demasiados intentos de acceso. Por favor intentá nuevamente en 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false
});

const reviewsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: tenantKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, error: 'Demasiadas solicitudes de reseñas. Por favor intentá nuevamente en 15 minutos.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false
});

const ordersLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  keyGenerator: tenantKeyGenerator,
  validate: { keyGeneratorIpFallback: false },
  message: { success: false, error: 'Límite de solicitudes de pedidos excedido. Por favor aguardá unos minutos.', code: 'RATE_LIMIT_EXCEEDED' },
  standardHeaders: true,
  legacyHeaders: false
});

// Static files (allow dotfiles because workspace path contains .gemini)
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

// Studio routes are now mounted at /api/studio via studioRouter
// (includes save, group-cart-tokens, ai-import, branches, events)

// → movido a api/routes/events.js (misma ruta, mismo middleware)

// → movido a api/routes/menu.js + api/utils/menuResponse.js (misma ruta, mismo middleware)

// ==================== BILLING ROUTES ====================
// → movido a api/routes/billing.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// ==================== ANALYTICS ROUTES ====================
// Sitekey pública de Turnstile (invisible). Vacía = captcha desactivado en
// este despliegue y el menú no lo carga. La sitekey es pública por diseño.
// → movido a api/routes/public.js (misma ruta, mismo middleware)

// Canal público unificado de analítica. Fuente única de verdad: telemetría
// (telemetry_events). Los contadores legacy (restaurant.analytics) son una
// proyección derivada que se recalcula acá, nunca se incrementan a mano.
// → movido a api/routes/public.js (misma ruta, mismo middleware)

app.get('/api/analytics/:slug', authMiddleware, (req, res) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant || restaurant.slug !== req.params.slug) {
      return res.status(403).json({ error: 'No autorizado' });
    }
    res.json({ analytics: restaurant.analytics || { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 } });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== REVIEWS ROUTES ====================
app.post('/api/reviews', authMiddleware, async (req, res) => {
  try {
    const { rating, comment, authorRole } = req.body;
    if (!rating || !comment) return res.status(400).json({ error: 'Calificación y comentario requeridos' });
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });
    const review = await db.addReview({
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      userId: req.user.userId,
      email: req.user.email,
      rating: parseInt(rating),
      comment: String(comment).slice(0, 500),
      authorRole: String(authorRole || '').slice(0, 60)
    });
    res.json({ success: true, review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// → movido a api/routes/public.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// Dynamic Pricing & Promotional Banner Configuration
// → movido a api/routes/public.js (misma ruta, mismo middleware)

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// Specific HTML routing: ver api/utils/paths.js (SEND_FILE_OPTIONS compartido
// con routes/menuSsr.js).
const { SEND_FILE_OPTIONS } = require('./utils/paths');

// → movido a api/routes/discovery.js (misma ruta, mismo middleware)

// → movido a api/routes/menuSsr.js (misma ruta, mismo middleware)

const { studioHtmlAuthMiddleware, adminHtmlAuthMiddleware } = require('./middleware/htmlAuth');

app.get('/studio', studioHtmlAuthMiddleware, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'studio.html'), SEND_FILE_OPTIONS);
});

// Panel maestro en ruta ofuscada y configurable (default /el-jefe): la URL
// pegada no se descubre por escaneo; /admin queda como redirección legacy.
// En Vercel la página es estática: la ruta canónica vive en vercel.json.
const ADMIN_PATH = process.env.ADMIN_PATH && /^\/[a-z0-9-]{2,64}$/.test(process.env.ADMIN_PATH)
  ? process.env.ADMIN_PATH
  : '/el-jefe';

app.get('/admin', (req, res) => {
  res.redirect(302, ADMIN_PATH);
});

app.get(ADMIN_PATH, adminHtmlAuthMiddleware, (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'admin.html'), SEND_FILE_OPTIONS);
});

// Descubrir beta: página pública (sin auth) del feed de platos de la zona.
// En Vercel la sirve el CDN vía vercel.json; acá en dev la sirve Express.
app.get('/descubrir', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'discover.html'), SEND_FILE_OPTIONS);
});

app.get('/terminos', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'legal', 'terms.html'), SEND_FILE_OPTIONS);
});

app.get('/privacidad', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'legal', 'privacy.html'), SEND_FILE_OPTIONS);
});

app.get('/cookies', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'legal', 'cookies.html'), SEND_FILE_OPTIONS);
});

app.get('/reembolsos', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'legal', 'refunds.html'), SEND_FILE_OPTIONS);
});

app.get('/aviso-legal', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'legal', 'disclaimer.html'), SEND_FILE_OPTIONS);
});

// Client diagnostic logging endpoint (production-grade debugging)
// → movido a api/routes/public.js (misma ruta, mismo middleware)

// → movido a api/routes/account.js (misma ruta, mismo middleware)

// Mount modular API routers with rate limiting
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/reviews', reviewsLimiter, reviewsRouter);
app.use('/api/storage', storageRouter);
// Parser amplio (25mb) solo para las rutas de IA con fotos base64. El
// dispatcher global ya eligió el límite por path (single-parse: este segundo
// json() salta vía req._body); el mount explícito deja la excepción visible
// junto al router que la necesita.
app.use('/api/ai', express.json({ limit: '25mb' }));
app.use('/api/ai', aiRouter);
// Nota: las rutas de studio exigen `requireVerifiedEmail` + `authMiddleware`
// (el guard de suscripción vive en la UI del Studio y en los gates que pausan
// el menú público, no en este mount).
// Mismo parser amplio que /api/ai: POST /ai-import recibe páginas
// escaneadas en base64 (ver dispatcher global de límites).
app.use('/api/studio/ai-import', express.json({ limit: '25mb' }));
app.use('/api/studio', studioRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/loyalty', loyaltyRouter);
app.use('/api/discover', discoverRouter);
app.use('/api/email', emailRouter);
app.use('/api/admin', adminRouter);
app.use('/api', menuRouter);
app.use('/m', menuSsrRouter);
app.use('/api/events', eventsRouter);
app.use('/api', publicRouter);
app.use('/api/account', accountRouter);
app.use('/', discoveryRouter);
app.use('/api/cron', billingDunningRouter);
app.use('/api/cron', telemetryRetentionRouter);
app.use('/api/cron', seoAuditCronRouter);
app.use('/api/cron', reviewNudgeCronRouter);

// Protected routes: require active subscription (Billing operations)
// IMPORTANTE: sólo aplica a rutas /api/billing montadas DESPUÉS de esta línea.
// checkout/webhook/status quedan fuera a propósito (ver routes/billing.js):
// un usuario con trial vencido DEBE poder llegar al checkout para pagarse.
app.use('/api/billing', billingRouter);
app.use('/api/billing', requireActiveSubscription);

// (legacy) GET /api/test-email ELIMINADO: duplicaba GET /api/email/test-email de routes/email.js
app.use('/api/orders', ordersLimiter, ordersRouter);
app.use('/api/analytics', analyticsRouter);
app.use('/api', healthRouter);

// 404 Not Found Handler for unmatched API routes
app.use('/api', (req, res) => {
  return errorResponse(res, 'Ruta de API no encontrada', 404, null, 'NOT_FOUND');
});

// Fallback 404 (rutas NO-API sin match): en Vercel el CDN sirve public/404.html
// automáticamente, pero en Express el default es un "Cannot GET" feo. Servimos
// la MISMA página 404 (ya usada para un /m/:slug inexistente) para que dev y
// producción se vean igual y la app sea correcta en cualquier host de Node.
app.use((req, res) => {
  return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), SEND_FILE_OPTIONS);
});

// Mount Global Error Handler Middleware
app.use(errorHandler);

// Fallback for direct node execution (not when imported or in Vercel Serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 ScanGo corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
