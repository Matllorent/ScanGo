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
const seoDiscovery = require('./utils/seoDiscovery');
const seoSolutions = require('./utils/seoSolutions');
const indexNow = require('./utils/indexNow');
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
const JWT_SECRET = require('./utils/adminSession').JWT_SECRET;
const ADMIN_KEY = require('./utils/adminSession').ADMIN_KEY;

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

// Strict rate limiter for Admin Master login: ver api/middleware/rateLimits.js
// (adminLimiter, 5 intentos/IP/15min). Se aplica en api/routes/admin.js.
const { timingSafeEqualHex } = require('./utils/adminSession');

// Production-ready secure cookie flags + timeout de sesión admin: ver
// api/utils/adminSession.js (fuente única, también usada por routes/admin.js).
const { COOKIE_OPTIONS, ADMIN_SESSION_IDLE_TIMEOUT_SECONDS } = require('./utils/adminSession');

const { resolveBranchOverridePrice, normalizeBranchCustomDishes } = require('./utils/menuResponse');


// Static files (allow dotfiles because workspace path contains .gemini)
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

// Studio routes are now mounted at /api/studio via studioRouter
// (includes save, group-cart-tokens, ai-import, branches, events)

// → movido a api/routes/events.js (misma ruta, mismo middleware)

// → movido a api/routes/menu.js + api/utils/menuResponse.js (misma ruta, mismo middleware)

// ==================== BILLING ROUTES ====================
// → movido a api/routes/billing.js (misma ruta, mismo middleware)

// Comparación de secretos en tiempo constante: ver api/utils/adminSession.js
// (timingSafeEqualHex, fuente única con routes/admin.js).

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

// SEO: Dynamic Robots.txt Route (política de rastreo + IA desde el compilador
// puro api/utils/seoDiscovery.js; /robots.txt también se sirve por Express en
// Vercel — ver routes en vercel.json).
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(seoDiscovery.buildRobotsTxt(process.env.APP_URL));
});

// SEO: Dynamic XML Sitemap (menús activos + sucursales + legales, con lastmod
// por restaurante; los estáticos public/robots.txt y public/sitemap.xml fueron
// ELIMINADOS a propósito: en Vercel el archivo estático pisaba al dinámico y
// dejaba a los /m/* fuera del sitemap de producción).
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  const restaurants = db.getAllRestaurants().filter(r => r.subscription && r.subscription.status !== 'canceled');
  res.send(seoDiscovery.buildSitemapXml({
    appUrl: process.env.APP_URL,
    restaurants,
    solutions: seoSolutions.getAllSolutions()
  }));
});

// SEO: landings de "soluciones por rubro" (/soluciones y /soluciones/:slug).
// HTML 100% server-rendered desde el módulo puro api/utils/seoSolutions.js:
// capturan búsquedas long-tail por rubro y exponen WebPage + BreadcrumbList +
// FAQPage a buscadores e IA. Sin JS ni on*= (CSP script-src-attr 'none'); los
// CTA apuntan a /?registro=1 (el landing abre el registro solo).
app.get('/soluciones', (req, res) => {
  res.type('html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  res.send(seoSolutions.renderSolutionsIndexHtml({ appUrl: process.env.APP_URL }));
});

app.get('/soluciones/:slug', (req, res) => {
  const solution = seoSolutions.getSolutionBySlug(req.params.slug);
  if (!solution) {
    return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'), SEND_FILE_OPTIONS);
  }
  res.type('html');
  res.set('Cache-Control', 'public, max-age=300, s-maxage=3600');
  // `solution` sale del catálogo puro (no de input libre) y todo dato se
  // escapa en renderSolutionHtml (escapeHtml/safeJsonLd): falso positivo.
  res.send(seoSolutions.renderSolutionHtml(solution, { appUrl: process.env.APP_URL })); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
});

// IndexNow: archivo de verificación de dominio en /{key}.txt (espec de Bing,
// Yandex, Seznam, Naver). SOLO responde 200 si el segmento coincide EXACTO con
// INDEXNOW_KEY (mismo patrón [0-9a-fA-F-]{8,64} que la ruta de vercel.json que
// desvía acá el .txt en producción); sin key configurada no existe archivo.
// Se registra DESPUÉS de express.static (línea ~281): los .txt estáticos
// (robots, llms, llms-full) ya fueron servidos; acá solo llegan los hex-dash.
app.get('/:key.txt', (req, res) => {
  const configuredKey = indexNow.getIndexNowKey();
  if (!configuredKey || req.params.key !== configuredKey) {
    return res.status(404).type('text/plain').send('Not Found');
  }
  res.type('text/plain').send(configuredKey);
});

// → movido a api/routes/menuSsr.js (misma ruta, mismo middleware)

// Server-side Auth Guard for Studio HTML View
function studioHtmlAuthMiddleware(req, res, next) {
  // Modo demo (?demo=heladeria): la landing enlaza al Studio sin sesión para
  // probar el editor con datos de ejemplo. En prod vercel.json sirve
  // studio.html estático sin pasar por acá; este bypass es solo para dev.
  // La seguridad real está en POST /api/studio/save (exige sesión).
  if (normalizeDemoType(req.query.demo)) return next();
  // Solo cookie httpOnly o Bearer en memoria. El token por ?query= quedaba en
  // logs de Vercel/proxy, historial y Referer: se elimina esa vía.
  const token = req.cookies?.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);

  if (!token) {
    return res.redirect('/?auth=required');
  }
  try {
    jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    next();
  } catch (e) {
    res.clearCookie('auth_token');
    return res.redirect('/?auth=expired');
  }
}

// Server-side Auth Guard for Admin HTML View
function adminHtmlAuthMiddleware(req, res, next) {
  const token = req.cookies?.admin_token;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (decoded?.role !== 'admin_master') throw new Error('Invalid admin session');
      const renewedToken = jwt.sign(
        { role: 'admin_master', timestamp: decoded.timestamp || Date.now() },
        JWT_SECRET,
        { expiresIn: ADMIN_SESSION_IDLE_TIMEOUT_SECONDS }
      );
      res.cookie('admin_token', renewedToken, COOKIE_OPTIONS);
      return next();
    } catch (e) {}
  }

  return res.status(403).send(`<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>403 — Acceso Restringido • ScanGo</title>
  <link rel="icon" type="image/png" href="/logo-scango.png" />
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #0d1312;
      --card-bg: #151f1c;
      --card-border: #23352f;
      --text: #f0f3f2;
      --text-muted: #8ca39b;
      --gold: #e5a93b;
      --gold-hover: #c9902b;
      --danger: #ef4444;
      --danger-bg: rgba(239, 68, 68, 0.12);
      --accent: #22c55e;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Montserrat', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background: radial-gradient(circle at top, #172421 0%, var(--bg) 70%);
      color: var(--text);
      padding: 1.5rem;
    }
    .card {
      background: var(--card-bg);
      padding: 2.5rem;
      border-radius: 16px;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 25px 50px -12px rgba(0,0,0,0.6);
      text-align: center;
      border: 1px solid var(--card-border);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: '';
      position: absolute;
      top: 0; left: 0; right: 0;
      height: 3px;
      background: linear-gradient(90deg, transparent, var(--gold), transparent);
    }
    .brand-logo {
      height: 48px;
      width: auto;
      margin-bottom: 1.25rem;
      border-radius: 8px;
      object-fit: contain;
    }
    .status-badge {
      display: inline-block;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 1px;
      color: var(--gold);
      background: rgba(229, 169, 59, 0.12);
      border: 1px solid rgba(229, 169, 59, 0.3);
      padding: 4px 10px;
      border-radius: 20px;
      margin-bottom: 0.85rem;
      text-transform: uppercase;
    }
    h2 {
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      margin-bottom: 0.5rem;
    }
    p {
      font-size: 0.85rem;
      color: var(--text-muted);
      line-height: 1.5;
      margin-bottom: 1.75rem;
    }
    .form-group {
      text-align: left;
      margin-bottom: 1.25rem;
    }
    .form-group label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--text-muted);
      margin-bottom: 0.4rem;
    }
    .input-wrapper {
      position: relative;
    }
    input {
      width: 100%;
      padding: 0.8rem 1rem;
      border-radius: 8px;
      border: 1px solid var(--card-border);
      background: #0d1312;
      color: #fff;
      font-size: 0.95rem;
      font-family: inherit;
      outline: none;
      transition: all 0.2s ease;
    }
    input:focus {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(229, 169, 59, 0.15);
    }
    input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .alert-box {
      display: none;
      padding: 0.75rem 1rem;
      border-radius: 8px;
      font-size: 0.82rem;
      line-height: 1.4;
      margin-bottom: 1.25rem;
      text-align: left;
    }
    .alert-danger {
      background: var(--danger-bg);
      border: 1px solid rgba(239, 68, 68, 0.35);
      color: #fca5a5;
    }
    .alert-success {
      background: rgba(34, 197, 94, 0.12);
      border: 1px solid rgba(34, 197, 94, 0.35);
      color: #86efac;
    }
    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }
    .input-wrapper input {
      width: 100%;
      padding-right: 42px;
    }
    .toggle-eye-btn {
      position: absolute;
      right: 10px;
      top: 50%;
      transform: translateY(-50%);
      background: none !important;
      border: none !important;
      color: var(--text-muted);
      cursor: pointer;
      padding: 4px;
      font-size: 1.1rem;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: auto !important;
      line-height: 1;
    }
    .toggle-eye-btn:hover {
      color: #fff;
    }
    button {
      width: 100%;
      padding: 0.85rem;
      border-radius: 8px;
      border: none;
      background: var(--gold);
      color: #0d1312;
      font-weight: 700;
      font-size: 0.95rem;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 0.5rem;
    }
    button:hover:not(:disabled) {
      background: var(--gold-hover);
      transform: translateY(-1px);
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }
    .footer-link {
      margin-top: 1.5rem;
      font-size: 0.8rem;
    }
    .footer-link a {
      color: var(--text-muted);
      text-decoration: none;
      transition: color 0.2s;
    }
    .footer-link a:hover {
      color: var(--gold);
    }
  </style>
</head>
<body>
  <div class="card">
    <img src="/logo-scango.png" alt="ScanGo" class="brand-logo" data-js-error-style-display="none">
    <div><span class="status-badge">403 • ACCESO RESTRINGIDO</span></div>
    <h2>Acceso Maestro ScanGo</h2>
    <p>Ingresá la clave maestra configurada en el servidor (ADMIN_KEY) para acceder al panel de administración.</p>

    <div id="alert-box" class="alert-box"></div>

    <form id="login-form">
      <div class="form-group">
        <label for="admin-key">Clave de Administración</label>
        <div class="input-wrapper">
          <input type="password" id="admin-key" placeholder="••••••••••••••••" autocomplete="current-password" autofocus required />
          <button type="button" class="toggle-eye-btn" data-js-click="togglePass|admin-key|this" aria-label="Alternar visibilidad de contraseña" title="Mostrar/ocultar contraseña">👁️</button>
        </div>
      </div>
      <div class="form-group">
        <label for="admin-totp" style="display:flex; justify-content:space-between;">
          <span>Código 2FA (Google Auth)</span>
          <span style="font-weight:600; font-size:0.75rem; color:#ef4444;">(Obligatorio)</span>
        </label>
        <div class="input-wrapper">
          <input type="text" id="admin-totp" placeholder="Ej: 123456" maxlength="6" inputmode="numeric" required style="letter-spacing: 2px; font-family: monospace;" />
        </div>
      </div>
      <button type="submit" id="submit-btn">
        <span>Ingresar al Panel</span>
      </button>
    </form>

    <div class="footer-link">
      <a href="/">&larr; Volver al sitio principal</a>
    </div>
  </div>

  <script src="/js/dom-bindings.js"></script>
  <script src="/js/admin-gate.js"></script>
</body>
</html>`);
}

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
