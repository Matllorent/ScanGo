require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../src/db/db');
const emailService = require('./services/email');
const telemetryService = require('./services/telemetry');
const storageService = require('./services/storage');
const auditService = require('./services/audit');
const { requireActiveSubscription } = require('./middleware/subscriptionGuard');
const errorHandler = require('./middleware/errorHandler');
const { successResponse, errorResponse } = require('./utils/response');
const requireVerifiedEmail = require('./middleware/requireVerifiedEmail');
const requestIdMiddleware = require('./middleware/requestId');
const { invalidateMenuCache } = require('./middleware/cache');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');
const { publicAnalyticsLimiter, emailLimiter } = require('./middleware/rateLimits');
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
const billingDunningRouter = require('./cron/billing-dunning');
const telemetryRetentionRouter = require('./cron/telemetry-retention');
const seoAuditCronRouter = require('./cron/seo-audit');

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
app.get('/api/public/captcha-config', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.json({ sitekey: process.env.TURNSTILE_SITEKEY || '' });
});

// Canal público unificado de analítica. Fuente única de verdad: telemetría
// (telemetry_events). Los contadores legacy (restaurant.analytics) son una
// proyección derivada que se recalcula acá, nunca se incrementan a mano.
app.post('/api/public/analytics/event', publicAnalyticsLimiter, async (req, res) => {
  try {
    const { slug, event, dishId, branchId, amount, items, consent } = req.body || {};
    if (!slug || !event) return res.status(400).json({ error: 'slug y event requeridos' });
    const validEvents = ['visit', 'order', 'reservation', 'waiter', 'dish_click', 'order_placed', 'google_review_click', 'private_feedback', 'review_nudge_accept', 'dish_like'];
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Evento inválido' });
    // dish_like sin plato es ruido (inflaría lecturas del feed sin contar en
    // ningún lado): se rechaza antes de persistir.
    if (event === 'dish_like' && !dishId) return res.status(400).json({ error: 'dishId requerido' });
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) {
      // Los menús demo son públicos pero NO son restaurantes reales: no se
      // persiste telemetría (cero datos falsos). Se responde 200 no-op para no
      // llenar de 404 el panel de red / monitoreo de cada visita a una demo.
      if (isDemoSlug(slug)) return res.json({ success: true, demo: true });
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }
    // Consentimiento (Ley 18.331 / cookies): con 'necessary' solo se registra
    // lo contractual (el pedido/reserva/aviso que el local necesita operar);
    // lo puramente analítico se descarta con 200 honesto (sin persistir).
    // Sin consentimiento declarado se mantiene el comportamiento actual.
    const CONTRACTUAL_EVENTS = new Set(['order_placed', 'reservation', 'waiter_call']);
    const canonicalPre = event === 'order' || event === 'order_placed'
      ? 'order_placed'
      : event === 'waiter'
        ? 'waiter_call'
        : event;
    const minimalConsent = consent === 'necessary';
    if (minimalConsent && !CONTRACTUAL_EVENTS.has(canonicalPre)) {
      return res.json({ success: true, recorded: false, reason: 'CONSENT_NECESSARY' });
    }
    // dish_like de un plato que no es de la carta: voto fantasma (inflaría el
    // feed de otro local). Se valida pertenencia antes de persistir.
    if (event === 'dish_like') {
      const belongs = (restaurant.dishes || []).some(d => d && String(d.id) === String(dishId).slice(0, 80));
      if (!belongs) return res.status(400).json({ error: 'Plato no pertenece al local' });
    }

    // Telemetría rica: alimenta ticket promedio, top platos y comparativa de
    // sucursales. Los valores se sanean (cadenas cortas; amount numérico 0..1e9;
    // items de pedidos con dishId ≤80 y qty 1..999, máximo 100 por pedido).
    // Con consentimiento mínimo ('necessary') el metadata se reduce a la fuente
    // (sin montos ni detalle de ítems): alcanza para operar, no para perfilar.
    const cleanAmount = Number(amount);
    const safeAmount = Number.isFinite(cleanAmount) && cleanAmount >= 0 && cleanAmount <= 1e9
      ? cleanAmount
      : undefined;
    const metadata = minimalConsent
      ? { source: 'public_menu' }
      : { amount: safeAmount, source: 'public_menu' };
    if (event === 'order_placed' && Array.isArray(items) && !minimalConsent) {
      const safeItems = items
        .slice(0, 100)
        .map(it => ({
          dishId: it && it.dishId ? String(it.dishId).slice(0, 80) : undefined,
          qty: it && Number.isFinite(Number(it.qty)) ? Math.max(1, Math.min(999, Math.floor(Number(it.qty)))) : 1
        }))
        .filter(it => it.dishId);
      if (safeItems.length) metadata.items = safeItems;
    }
    await telemetryService.recordEventSync({
      restaurantId: restaurant.id,
      eventType: canonicalPre,
      dishId: dishId ? String(dishId).slice(0, 80) : undefined,
      branchId: branchId ? String(branchId).slice(0, 80) : undefined,
      metadata
    });

    // Proyección legacy derivada de la telemetría (queda sincronizada con todo
    // lo que pasa por /track y por el menú público). Se recalcula por evento:
    // los contadores del dueño deben estar frescos y los tests lo exigen.
    // El control de carga de este camino es el rate-limit por slug (120/15min)
    // + el scan acotado a la única columna que usa la proyección.
    const analytics = await telemetryService.countAnalytics(restaurant.id);
    await db.setAnalyticsSnapshot(slug, analytics);

    res.json({ success: true, analytics, telemetry: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

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

app.get('/api/reviews/approved', (req, res) => {
  try {
    const reviews = db.getApprovedReviews();
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// → movido a api/routes/admin.js (misma ruta, mismo middleware)

// Dynamic Pricing & Promotional Banner Configuration
app.get('/api/settings/pricing', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

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

app.get('/admin', adminHtmlAuthMiddleware, (req, res) => {
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
app.post('/api/logs', (req, res) => {
  const { level, message, stack, url, ua } = req.body || {};
  const timestamp = new Date().toISOString();
  console.log(`[CLIENT-LOG] [${timestamp}] [${level || 'INFO'}] ${message || ''} | URL: ${url || ''}`);
  if (stack) console.error(stack);
  res.json({ received: true });
});

// ==================== ACCOUNT ERASURE (RGPD / Ley 18.331 / Google Play) ====================
// POST /api/account/delete-request — derecho al olvido. El "Eliminar cuenta"
// del Studio quedaba huérfano (llamaba a esta ruta y el backend no existía →
// 404 silencioso que mentía "solicitud registrada"). Ahora borra de verdad:
// usuario + restaurante + datos asociados (local y nube), imágenes del bucket,
// revoca la sesión y deja auditoría ANTES del borrado. Requiere `confirm: true`
// explícito + sesión válida; limiter dedicado y estricto (10/15min).
const accountDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes de eliminación. Probá de nuevo en unos minutos.',
    code: 'RATE_LIMITED'
  }
});
app.post('/api/account/delete-request', accountDeleteLimiter, authMiddleware, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Debés confirmar la eliminación definitiva con confirm: true.',
        code: 'CONFIRMATION_REQUIRED'
      });
    }

    const user = db.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada', code: 'ACCOUNT_NOT_FOUND' });
    }
    const restaurant = db.findRestaurantByUserId(user.id);

    // Auditoría ANTES del borrado: queda como registro de procesamiento propio
    // (tabla audit_logs, no se borra con la cuenta).
    auditService.logAction({
      tenantId: restaurant ? restaurant.id : undefined,
      userId: user.id,
      requestId: req.requestId,
      action: 'ACCOUNT_DELETE',
      entity: 'account',
      details: {
        reason: String(body.reason || '').slice(0, 200) || 'Sin motivo',
        restaurantId: restaurant ? restaurant.id : null
      }
    });

    // 1) Imágenes del tenant en el bucket público (no quedan huérfanas).
    if (restaurant) {
      await storageService.deleteTenantFiles(user.id).catch((e) => {
        sentry.captureException(e, { source: 'account.delete.storage', tags: { userId: user.id } });
        console.warn('[Account Delete] No se pudieron borrar archivos de storage:', e.message);
      });
      await invalidateMenuCache(restaurant.slug).catch(() => {});
    }

    // 2) Datos: usuario + restaurante + asociados (local JSON + Supabase).
    await db.deleteRestaurantData(user.id, restaurant ? restaurant.id : null);

    return res.json({ success: true, deleted: true });
  } catch (e) {
    return next(e);
  }
});

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
app.use('/', discoveryRouter);
app.use('/api/cron', billingDunningRouter);
app.use('/api/cron', telemetryRetentionRouter);
app.use('/api/cron', seoAuditCronRouter);

// Protected routes: require active subscription (Billing operations)
// IMPORTANTE: sólo aplica a rutas /api/billing montadas DESPUÉS de esta línea.
// checkout/webhook/status quedan fuera a propósito (ver routes/billing.js):
// un usuario con trial vencido DEBE poder llegar al checkout para pagarse.
app.use('/api/billing', billingRouter);
app.use('/api/billing', requireActiveSubscription);

// Test Email Endpoint
app.get('/api/test-email', adminMiddleware, emailLimiter, async (req, res, next) => {
  try {
    const targetEmail = req.query.to || 'mat2001llorent@gmail.com';
    const result = await emailService.sendEmail({
      to: targetEmail,
      subject: '🧪 Prueba de Correo Real con Resend — ScanGo',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #10b981; margin-top: 0;">🚀 Confirmación de Integración de Resend</h2>
          <p>Este es un correo electrónico de prueba enviado exitosamente desde el backend de <strong>ScanGo</strong> utilizando la API Key de Resend.</p>
          <div style="background: #f8fafc; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #334155;"><strong>Destinatario:</strong> ${targetEmail}</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #334155;"><strong>Remitente:</strong> onboarding@resend.dev</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #334155;"><strong>Fecha:</strong> ${new Date().toISOString()}</p>
          </div>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">Integración 100% activa y lista para producción.</p>
        </div>
      `
    });

    return successResponse(res, result, `Correo de prueba enviado a ${targetEmail} mediante Resend`);
  } catch (err) {
    next(err);
  }
});
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
