require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../src/db/db');
const billingOrchestrator = require('../src/billing/orchestrator');
const mpService = require('../src/services/mercadopago');
const emailService = require('./services/email');
const telemetryService = require('./services/telemetry');
const storageService = require('./services/storage');
const auditService = require('./services/audit');
const { getWeatherContext } = require('./services/weather');
const { hashPassword, comparePassword } = require('./utils/hash');
const { registerSchema, loginSchema, validateBody } = require('./middleware/validation');
const { sanitizeModifierGroups, sanitizeDishOptionConfig } = require('./utils/menuOptions');
const { sanitizeRestaurantPayload, sanitizeBranchPayload } = require('./utils/sanitizeRestaurant');
const { checkSubscriptionKillSwitch, getSubscriptionKillSwitch, setSubscriptionKillSwitch } = require('./middleware/killSwitch');
const { requireActiveSubscription } = require('./middleware/subscriptionGuard');
const errorHandler = require('./middleware/errorHandler');
const { successResponse, errorResponse } = require('./utils/response');
const requireVerifiedEmail = require('./middleware/requireVerifiedEmail');
const requestIdMiddleware = require('./middleware/requestId');
const { menuCacheMiddleware, invalidateMenuCache, getCachedMenu } = require('./middleware/cache');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');
const { publicAnalyticsLimiter, emailLimiter } = require('./middleware/rateLimits');
const { createGroupCartToken } = require('./utils/groupCartToken');
const sentry = require('./utils/sentry');
const securityHeaders = require('./utils/securityHeaders');
const seoDiscovery = require('./utils/seoDiscovery');
const seoSolutions = require('./utils/seoSolutions');
const indexNow = require('./utils/indexNow');
const { getDemoRestaurant, listDemoRestaurants, normalizeDemoType, isDemoSlug } = require('./utils/demoRestaurants');
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
const loyaltyService = require('./services/loyalty');
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

// Resolve public directory reliably across environments
const fs = require('fs');
let PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(process.cwd(), 'public');
}
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(__dirname, 'public');
}

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

/**
 * Coerce a per-branch override price value to a finite number.
 * overridePrices es Record<dishId, number>; datos legacy o payloads externos
 * pueden traer { price: n } — normalizar aquí evita filtrar objetos al frontend.
 * @returns {number|null} precio numérico o null si no hay override usable.
 */
function resolveBranchOverridePrice(overrides, dishId, fallbackPrice) {
  if (!overrides || typeof overrides !== 'object' || typeof dishId !== 'string') return fallbackPrice;
  const raw = overrides[dishId];
  if (raw === undefined || raw === null) return fallbackPrice;
  let num = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    num = raw.price ?? raw.value ?? raw.precio;
  }
  const parsed = Number(num);
  return Number.isFinite(parsed) ? parsed : fallbackPrice;
}

/**
 * Normalize branch custom dishes so the SPA public menu can render them.
 * Los customDishes de una sucursal vienen con `category` (nombre) pero sin
 * `categoryId`; el menú público agrupa por `d.categoryId === cat.id`, así que
 * sin normalización quedan invisibles. Garantiza que cada custom dish tenga un
 * categoryId válido y que ese category exista en el array de categorías de la
 * respuesta (agregando una categoría sintética si hace falta).
 * @returns {{categories: Array, dishes: Array}} categorías con las extras + dishes normalizados
 */
function normalizeBranchCustomDishes(baseCategories, baseDishes, customDishes) {
  let categories = Array.isArray(baseCategories) ? baseCategories.map(c => ({ ...c })) : [];
  if (!Array.isArray(customDishes) || customDishes.length === 0) {
    return { categories, dishes: baseDishes };
  }
  const categoriesById = new Map(categories.map(c => [c.id, c]));
  let dishes = Array.isArray(baseDishes) ? baseDishes.map(d => ({ ...d })) : [];
  for (const cd of customDishes) {
    if (!cd || typeof cd !== 'object') continue;
    const dish = { ...cd, isBranchCustom: true };
    const catName = String(dish.category || '').trim() || 'Especiales de la sucursal';
    const sluggedCat = catName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
    const desiredId = dish.categoryId
      ? String(dish.categoryId)
      : `branch_cat_${sluggedCat || 'especiales'}`;
    const cat = categoriesById.get(desiredId);
    if (cat) {
      dish.categoryId = cat.id;
    } else {
      const newCat = { id: desiredId, name: catName };
      categories.push(newCat);
      categoriesById.set(newCat.id, newCat);
      if (dish.categoryId === undefined) dish.categoryId = newCat.id;
    }
    dishes.push({ ...dish, categoryId: dish.categoryId || desiredId });
  }
  return { categories, dishes };
}


// Static files (allow dotfiles because workspace path contains .gemini)
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

// Studio routes are now mounted at /api/studio via studioRouter
// (includes save, group-cart-tokens, ai-import, branches, events)

// GET /api/events/:slug/guest/:qrToken - Guest Companion page data
app.get('/api/events/:slug/guest/:qrToken', async (req, res, next) => {
  try {
    const { slug, qrToken } = req.params;
    
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant || (restaurant.businessType !== 'events' && !restaurant.isEvent)) {
      return res.status(404).json({ error: 'Evento no encontrado' });
    }
    
    // Buscar guest por qrToken
    const guests = restaurant.eventConfig?.guests || [];
    const guest = guests.find(g => g.qrToken === qrToken);
    if (!guest) {
      return res.status(404).json({ error: 'Invitado no encontrado' });
    }
    
    // Verificar expiración del evento
    const expiresAt = restaurant.expiresAt ? new Date(restaurant.expiresAt) : null;
    const eventDate = restaurant.eventDate ? new Date(restaurant.eventDate) : null;
    const expiryCheck = expiresAt || eventDate;
    if (expiryCheck && expiryCheck < new Date()) {
      return res.status(410).json({ 
        error: 'Evento finalizado',
        expired: true,
        message: 'Este evento ya ha finalizado. ¡Gracias por participar!'
      });
    }
    
    // Buscar padre si es niño
    let parentGuest = null;
    if (guest.isChild && guest.parentGuestId) {
      parentGuest = guests.find(g => g.id === guest.parentGuestId) || null;
    }
    
    // Construir respuesta completa para la Guest Page
    const response = {
      event: {
        slug: restaurant.slug,
        coupleNames: restaurant.eventConfig?.coupleNames || restaurant.name,
        eventType: restaurant.eventConfig?.eventType || 'wedding',
        eventDate: restaurant.eventDate,
        venue: restaurant.eventConfig?.venue,
        dressCode: restaurant.eventConfig?.dressCode,
        theme: restaurant.eventConfig?.theme || 'wedding_elegant',
        heroImage: restaurant.eventConfig?.heroImage || restaurant.bannerUrl,
        menuSections: restaurant.eventConfig?.menuSections || [],
        timeline: restaurant.eventConfig?.timeline || [],
        waiterConfig: restaurant.eventConfig?.waiterConfig || {},
        tables: restaurant.eventConfig?.tables || [],
        gifts: restaurant.eventConfig?.gifts || {}
      },
      guest: {
        id: guest.id,
        name: guest.name,
        isChild: guest.isChild || false,
        tableId: guest.tableId,
        tableName: guest.tableId ? (restaurant.eventConfig?.tables?.find(t => t.id === guest.tableId)?.name || guest.tableId) : null,
        seatNumber: guest.seatNumber,
        dietary: guest.dietary,
        allergens: guest.allergens || [],
        parentGuestId: guest.parentGuestId,
        parentContact: guest.parentContact,
        parentGuest: parentGuest ? {
          id: parentGuest.id,
          name: parentGuest.name,
          phone: parentGuest.phone
        } : null,
        qrToken: guest.qrToken
      }
    };
    
    res.json({ success: true, data: response });
  } catch (err) {
    next(err);
  }
});

// POST /api/events/:slug/waiter-call - Waiter call with kids mode support
app.post('/api/events/:slug/waiter-call', async (req, res, next) => {
  try {
    const { slug } = req.params;
    const { guestToken, categoryId, itemId, notes, kidMode } = req.body;
    
    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) return res.status(404).json({ error: 'Evento no encontrado' });
    
    const guests = restaurant.eventConfig?.guests || [];
    const guest = guests.find(g => g.qrToken === guestToken);
    if (!guest) return res.status(404).json({ error: 'Invitado no encontrado' });
    
    const tableName = guest.tableId ? (restaurant.eventConfig?.tables?.find(t => t.id === guest.tableId)?.name || guest.tableId) : 'Sin mesa';
    const isChild = guest.isChild || false;
    const allergens = guest.allergens?.length ? guest.allergens : [];
    
    // Construir payload para telemetría + staff push
    const callData = {
      eventId: restaurant.id,
      guestId: guest.id,
      guestName: guest.name,
      guestIsChild: isChild,
      tableName,
      seatNumber: guest.seatNumber,
      categoryId,
      itemId,
      notes: notes || '',
      allergens,
      kidMode: kidMode || false,
      timestamp: new Date().toISOString()
    };
    
    // Telemetría
    telemetryService.recordEvent({
      restaurantId: restaurant.id,
      eventType: 'event_waiter_call',
      metadata: callData
    });
    
    // Push a staff (Supabase Realtime channel: event_waiters_{slug})
    const supabase = getSupabaseClient();
    if (supabase) {
      let channel;
      try {
        channel = supabase.channel(`event_waiters_${slug}`, { config: { private: true } });
        await channel.send({ type: 'broadcast', event: 'waiter_call', payload: callData });
      } catch (e) {
        console.warn('[Event Waiter Push]', e.message);
      } finally {
        if (channel) {
          try {
            await supabase.removeChannel(channel);
          } catch (removeErr) {
            console.warn('[Event Waiter Push] Failed to remove channel:', removeErr.message);
          }
        }
      }
    }
    
    // Si es llamada a padres, log específico
    if (itemId === 'call_parent' && guest.parentContact?.whatsapp) {
      telemetryService.recordEvent({
        restaurantId: restaurant.id,
        eventType: 'kid_call_parent',
        metadata: { guestId: guest.id, parentContact: guest.parentContact }
      });
    }
    
    res.json({ success: true, callId: 'wc_' + Date.now() });
  } catch (err) {
    next(err);
  }
});

// ==================== PUBLIC MENU VIEWER (WITH 800MS TIMEOUT RACE & STALE CACHE FALLBACK) ====================
// ── Demos públicas por rubro (in-memory, sin persistencia) ─────────────────
// Catálogo navegable: /m/demo-restaurante, /m/demo-heladeria,
// /m/demo-perfumeria, /m/demo-evento. Siempre online (sin verifyAccess) y
// con el MISMO shape público que /api/menu/:slug (incluye weddingItinerary
// y neonAccent, que el menú usa para el timeline en vivo y el glow neón).
function buildDemoMenuResponse(typeOrSlug) {
  const demo = getDemoRestaurant(typeOrSlug);
  if (!demo) return null;
  const isEvent = demo.businessType === 'events';
  const dishes = (demo.dishes || []).map(d => ({
    ...d,
    previous_price: d.previous_price || d.previousPrice || null,
    is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
  }));
  const publicData = {
    id: demo.id,
    organizationId: null,
    slug: demo.slug,
    name: demo.name,
    bizName: demo.bizName || demo.name,
    phone: demo.phone || '',
    scheduleActiveHours: demo.scheduleActiveHours || '',
    tableCount: demo.tableCount || 10,
    activeBranch: null,
    branches: [],
    slogan: demo.slogan || '',
    currency: demo.currency || '$',
    city: demo.city || '',
    smartWeatherEnabled: false,
    weatherContext: null,
    weatherTemperatureC: null,
    theme: demo.theme || 'emerald',
    themeFont: demo.themeFont || 'serif',
    neonAccent: demo.neonAccent || 'mint',
    neonCustomColor: demo.neonCustomColor || '',
    forceClosed: demo.forceClosed === true,
    instagram: demo.instagram || '',
    facebook: demo.facebook || '',
    tiktok: demo.tiktok || '',
    x: demo.x || '',
    googleReview: demo.googleReview || '',
    allowReservations: demo.allowReservations !== false,
    allowCoupons: demo.allowCoupons !== false,
    allowBillSplitter: demo.allowBillSplitter === true,
    allowWaiterCall: demo.allowWaiterCall !== false,
    allowBillRequest: demo.allowBillRequest !== false,
    allowMenuOrders: demo.allowMenuOrders !== false,
    announcement: demo.announcement || '',
    paymentLink: '',
    allowOnlinePayment: false,
    onlinePaymentReady: false,
    scheduleEnabled: Boolean(demo.scheduleEnabled),
    customCoupons: [],
    allowLoyaltyPoints: false,
    loyaltyConfig: loyaltyService.getPublicLoyaltyConfig(demo),
    logoUrl: demo.logoUrl || null,
    bannerUrl: demo.bannerUrl || null,
    layout: demo.layout || 'classic',
    businessType: demo.businessType || 'restaurant',
    allowIceCreamWizard: demo.allowIceCreamWizard === true,
    iceCreamBuilderLabel: demo.iceCreamBuilderLabel || '',
    iceCreamButtonStyle: demo.iceCreamButtonStyle || 'fiesta',
    iceCreamContainers: Array.isArray(demo.iceCreamContainers) ? demo.iceCreamContainers : null,
    iceCreamToppings: Array.isArray(demo.iceCreamToppings) ? demo.iceCreamToppings : null,
    allowPerfumery: demo.allowPerfumery === true,
    wifi: demo.wifi || { ssid: '', password: '' },
    categories: demo.categories || [],
    modifierGroups: demo.modifierGroups || [],
    dishes,
    deliveryZones: demo.deliveryZones || [],
    updatedAt: demo.updatedAt,
    weddingItinerary: demo.weddingItinerary || null,
    isEvent,
    eventDate: demo.eventDate,
    eventType: demo.eventType,
    expiresAt: demo.expiresAt,
    eventCustomQR: demo.eventCustomQR,
    isDemo: true
  };
  const response = {
    restaurant: publicData,
    weatherContext: null,
    weatherTemperatureC: null,
    isDemo: true
  };
  if (isEvent) {
    response.isEvent = true;
    response.eventDate = demo.eventDate;
    response.expiresAt = demo.expiresAt;
  } else {
    response.access = { inGracePeriod: false };
  }
  return response;
}

// Lista de demos (metadatos para la galería de la landing).
app.get('/api/demos', (req, res) => {
  return res.status(200).json({ demos: listDemoRestaurants() });
});

// Demo completa por tipo (lo que el Studio en modo demo carga en el editor).
app.get('/api/demos/:type', (req, res) => {
  const demo = getDemoRestaurant(req.params.type);
  if (!demo) return res.status(404).json({ error: 'Demo no encontrada' });
  return res.status(200).json({ demo, isDemo: true });
});

app.get('/api/menu/:slug', menuCacheMiddleware, async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  // Demos públicas por rubro: catálogo in-memory, siempre online.
  // Se sirve ANTES del cache single-flight para que la key demo:* nunca
  // colisione con un restaurante real del mismo slug.
  const demoType = normalizeDemoType(slug);
  if (demoType) {
    try {
      return res.status(200).json(buildDemoMenuResponse(demoType));
    } catch (e) {
      return res.status(500).json({ error: 'No se pudo cargar la demo' });
    }
  }
  try {
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('DB_TIMEOUT_800MS')), 800);
    });

    // Multi-Branch Hierarchy Support (?branch= or ?sucursal=)
    // Resuelto ANTES del single-flight cache: la key incluye la sucursal para que
    // ?branch=centro y el menú base no compartan entrada (5s TTL) y se contaminen.
    const reqBranch = (req.query.branch || req.query.sucursal || '').toLowerCase().trim();
    const activeBranchCacheKey = `${slug}:branch:${reqBranch}`;

    const fetchPromise = getCachedMenu(activeBranchCacheKey, async () => {
      const restaurant = db.findRestaurantBySlug(slug);
      if (!restaurant) return null;

      // Events mode: el corte duro es la fecha del evento (expiry), pero la
      // suscripción también importa: el dueño paga un one-off (`event_once`)
      // para que el menú esté online hasta eventDate. Sin pago tras el trial,
      // verifyAccess pausa el evento como a cualquier restaurante.
      const isEvent = restaurant.businessType === 'events' || restaurant.isEvent === true;
      let access = null;
      if (isEvent) {
        const expiresAt = restaurant.expiresAt ? new Date(restaurant.expiresAt) : null;
        const eventDate = restaurant.eventDate ? new Date(restaurant.eventDate) : null;
        const expiryCheck = expiresAt || eventDate;
        
        if (expiryCheck && expiryCheck < new Date()) {
          return {
            inactive: true,
            warning: 'Este evento ha finalizado. El menú ya no está disponible.',
            isEvent: true,
            expired: true
          };
        }
        // El evento sigue dentro de la fecha: la suscripción decide si está online
        access = billingOrchestrator.verifyAccess(restaurant.id);
        if (!access.allowed) {
          return {
            inactive: true,
            warning: access.warning,
            isEvent: true
          };
        }
      } else {
        // Regular restaurant - verify subscription
        access = billingOrchestrator.verifyAccess(restaurant.id);
        if (!access.allowed) {
          return {
            inactive: true,
            warning: access.warning
          };
        }
      }

      let weather = null;
      if (restaurant.smartWeatherEnabled && restaurant.city) {
        weather = await getWeatherContext(restaurant.city);
      }

      // Multi-Branch Hierarchy Support (?branch= or ?sucursal=)
      let activeBranch = null;

      if (reqBranch && Array.isArray(restaurant.branches)) {
        activeBranch = restaurant.branches.find(b =>
          (b.id || '').toLowerCase() === reqBranch || (b.slug || '').toLowerCase() === reqBranch
        );
      }

      // Base dishes inheritance & price overrides for branch
      let inheritedDishes = [...(restaurant.dishes || [])];
      let publicCategories = Array.isArray(restaurant.categories) ? restaurant.categories.map(c => ({ ...c })) : [];
      if (activeBranch) {
        if (activeBranch.overridePrices && typeof activeBranch.overridePrices === 'object') {
          inheritedDishes = inheritedDishes.map(d => ({
            ...d,
            price: resolveBranchOverridePrice(activeBranch.overridePrices, d.id, d.price),
            previous_price: d.price
          }));
        }
        // Normalizar customDishes: sintetizar categoryId y asegurar que su
        // categoría exista en la respuesta (si no, el menú público los ignora).
        const normalized = normalizeBranchCustomDishes(publicCategories, inheritedDishes, activeBranch.customDishes);
        publicCategories = normalized.categories;
        inheritedDishes = normalized.dishes;
      }

      // Smart Menu Sorting & Filtering
      const reqHour = req.query.hour || req.query.mealTime || '';
      const reqDay = typeof req.query.day !== 'undefined' ? parseInt(req.query.day) : new Date().getDay();
      const reqLang = (req.query.lang || 'es').toLowerCase();

      let dishes = inheritedDishes.map(d => {
        const trans = d.translations?.[reqLang];
        return {
          ...d,
          name: trans?.name || d.name,
          description: trans?.description || d.description,
          previous_price: d.previous_price || d.previousPrice || null,
          is_chef_recommended: Boolean(d.is_chef_recommended || d.isChefRecommended)
        };
      });

      // Priority sorting: Chef recommended on top, followed by matching hour & day slots
      dishes.sort((a, b) => {
        const aChef = a.is_chef_recommended ? 1 : 0;
        const bChef = b.is_chef_recommended ? 1 : 0;
        if (aChef !== bChef) return bChef - aChef;

        if (reqHour) {
          const aHours = Array.isArray(a.available_hours || a.availableHours) ? (a.available_hours || a.availableHours) : [];
          const bHours = Array.isArray(b.available_hours || b.availableHours) ? (b.available_hours || b.availableHours) : [];
          const aMatch = aHours.includes(reqHour) ? 1 : 0;
          const bMatch = bHours.includes(reqHour) ? 1 : 0;
          if (aMatch !== bMatch) return bMatch - aMatch;
        }

        const aDays = Array.isArray(a.available_days || a.availableDays) ? (a.available_days || a.availableDays) : [0, 1, 2, 3, 4, 5, 6];
        const bDays = Array.isArray(b.available_days || b.availableDays) ? (b.available_days || b.availableDays) : [0, 1, 2, 3, 4, 5, 6];
        const aDayMatch = aDays.includes(reqDay) ? 1 : 0;
        const bDayMatch = bDays.includes(reqDay) ? 1 : 0;
        if (aDayMatch !== bDayMatch) return bDayMatch - aDayMatch;

        return 0;
      });

      // Sanitize public payload: exclude internal userId, billing identifiers, etc.
      const publicData = {
        id: restaurant.id,
        organizationId: restaurant.organizationId || null,
        slug: restaurant.slug,
        name: activeBranch ? `${restaurant.name || restaurant.bizName} — ${activeBranch.name}` : (restaurant.name || restaurant.bizName),
        bizName: restaurant.bizName || restaurant.name,
        phone: activeBranch?.phone || restaurant.phone || '',
        scheduleActiveHours: activeBranch?.scheduleActiveHours || restaurant.scheduleActiveHours || '',
        tableCount: activeBranch?.tableCount || restaurant.tableCount || 10,
        activeBranch: activeBranch ? {
          id: activeBranch.id,
          name: activeBranch.name,
          slug: activeBranch.slug,
          address: activeBranch.address || ''
        } : null,
        branches: (restaurant.branches || []).map(b => ({
          id: b.id,
          name: b.name,
          slug: b.slug,
          address: b.address || ''
        })),
        slogan: restaurant.slogan || '',
        currency: restaurant.currency || '$',
        phone: restaurant.phone || '',
        city: restaurant.city || '',
        smartWeatherEnabled: Boolean(restaurant.smartWeatherEnabled),
        weatherContext: weather?.weatherContext || null,
        weatherTemperatureC: weather?.temperatureC ?? null,
        theme: restaurant.theme || 'emerald',
        themeFont: restaurant.themeFont || 'serif',
        neonAccent: restaurant.neonAccent || 'mint',
        neonCustomColor: restaurant.neonCustomColor || '',
        forceClosed: restaurant.forceClosed === true,
        instagram: restaurant.instagram || '',
        facebook: restaurant.facebook || '',
        tiktok: restaurant.tiktok || '',
        x: restaurant.x || '',
        googleReview: restaurant.googleReview || '',
        allowReservations: restaurant.allowReservations !== false,
        allowCoupons: restaurant.allowCoupons !== false,
        allowBillSplitter: restaurant.allowBillSplitter !== false,
        // Servicio de mesa: interruptores del dueño (defaults encendidos).
        // "Pedir la cuenta" además solo tiene sentido en el local (el menú
        // la oculta en DELIVERY/TAKEAWAY aunque esté habilitada).
        allowWaiterCall: restaurant.allowWaiterCall !== false,
        allowBillRequest: restaurant.allowBillRequest !== false,
        // Vitrina vs con pedidos: el dueño decide si la carta lleva carrito.
        allowMenuOrders: restaurant.allowMenuOrders !== false,
        announcement: restaurant.announcement || '',
        paymentLink: restaurant.paymentLink || '',
        // Pago online: el dueño decide si la opción aparece. `allowOnlinePayment`
        // es el interruptor; `onlinePaymentReady` indica si hay con qué cobrar
        // (link propio y/o Checkout Pro configurado en el servidor).
        allowOnlinePayment: restaurant.allowOnlinePayment === true,
        onlinePaymentReady: Boolean(
          (restaurant.paymentLink && String(restaurant.paymentLink).trim()) ||
          mpService.isConfigured()
        ),
        scheduleEnabled: Boolean(restaurant.scheduleEnabled),
        scheduleActiveHours: restaurant.scheduleActiveHours || '',
        tableCount: restaurant.tableCount || 10,
        customCoupons: restaurant.customCoupons || [],
        allowLoyaltyPoints: restaurant.allowLoyaltyPoints === true,
        loyaltyConfig: loyaltyService.getPublicLoyaltyConfig(restaurant),
        logoUrl: restaurant.logoUrl || null,
        bannerUrl: restaurant.bannerUrl || null,
        layout: restaurant.layout || 'classic',
        filterBarMode: ['fixed', 'autohide', 'compact'].includes(restaurant.filterBarMode) ? restaurant.filterBarMode : 'fixed',
        // Verticales de negocio (no sensibles): el frontend las usa para el gating
        // de heladería/perfumería y la resolución de temas de eventos.
        businessType: restaurant.businessType || 'restaurant',
        allowIceCreamWizard: restaurant.allowIceCreamWizard === true,
        iceCreamBuilderLabel: restaurant.iceCreamBuilderLabel || '',
        iceCreamButtonStyle: restaurant.iceCreamButtonStyle || 'clasico',
        // Heladería: tamaños y toppings del dueño (null = defaults del wizard).
        iceCreamContainers: Array.isArray(restaurant.iceCreamContainers) ? restaurant.iceCreamContainers : null,
        iceCreamToppings: Array.isArray(restaurant.iceCreamToppings) ? restaurant.iceCreamToppings : null,
        allowPerfumery: restaurant.allowPerfumery === true,
        wifi: restaurant.wifi || { ssid: '', password: '' },
        categories: publicCategories,
        modifierGroups: restaurant.modifierGroups || [],
        dishes: dishes,
        deliveryZones: restaurant.deliveryZones || [],
        updatedAt: restaurant.updatedAt,
        // Programa del evento e itinerario visual (público por diseño: es el
        // programa de la fiesta; el menú lo renderiza como timeline en vivo).
        weddingItinerary: restaurant.weddingItinerary || null,
        // Events mode data
        isEvent: isEvent,
        eventDate: restaurant.eventDate,
        eventType: restaurant.eventType,
        expiresAt: restaurant.expiresAt,
        eventCustomQR: restaurant.eventCustomQR
      };

      const response = {
        restaurant: publicData,
        weatherContext: publicData.weatherContext,
        weatherTemperatureC: publicData.weatherTemperatureC
      };

      // Add event-specific fields to response
      if (isEvent) {
        response.isEvent = true;
        response.eventDate = restaurant.eventDate;
        response.eventType = restaurant.eventType;
        response.expiresAt = restaurant.expiresAt;
        response.eventCustomQR = restaurant.eventCustomQR || `${process.env.APP_URL || 'https://scango.app'}/m/${slug}?event=true`;
      } else {
        response.access = {
          inGracePeriod: access.inGracePeriod,
          daysRemaining: access.gracePeriodDaysRemaining
        };
      }

      return response;
    });

    let data;
    try {
      data = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (raceErr) {
      if (raceErr.message === 'DB_TIMEOUT_800MS') {
        const { memoryCache } = require('./middleware/cache');
        const stale = memoryCache.get(slug);
        if (stale) {
          res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
          res.setHeader('Warning', '110 Response is Stale');
          res.setHeader('X-Cache-Status', 'Stale-Fallback');
          return res.status(200).json(stale);
        }
      }
      data = await fetchPromise;
    } finally {
      clearTimeout(timeoutId);
    }

    if (!data) {
      return res.status(404).json({ error: 'Restaurante no encontrado' });
    }
    if (data.inactive) {
      return res.status(402).json({
        error: 'MenuTemporalmenteInactivo',
        message: 'Este menú se encuentra temporalmente en pausa por renovación de suscripción.',
        warning: data.warning
      });
    }

    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== BILLING ROUTES ====================
// POST /api/billing/cancel — baja voluntaria inmediata (derecho a dar de
// baja, Ley 17.250). El menú se pausa al instante y se puede reactivar cuando
// se quiera. Si el cobro es por pasarela recurrente, el dueño también debe
// cancelarla en su cuenta de Mercado Pago/Stripe (se le indica en la respuesta).
app.post('/api/billing/cancel', authMiddleware, async (req, res, next) => {
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
app.post('/api/billing/checkout', authMiddleware, checkSubscriptionKillSwitch, async (req, res, next) => {
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

app.post('/api/billing/webhook/:provider', async (req, res) => {
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

app.get('/api/billing/status', authMiddleware, (req, res) => {
  const restaurant = db.findRestaurantByUserId(req.user.userId);
  if (!restaurant) return res.status(404).json({ error: 'No encontrado' });

  const access = billingOrchestrator.verifyAccess(restaurant.id);
  res.json({
    subscription: restaurant.subscription,
    access
  });
});

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

// Specific HTML routing (allowing dotfiles for paths containing .gemini)
const SEND_FILE_OPTIONS = { dotfiles: 'allow' };

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

// SEO & OpenGraph Dynamic Public Menu Route
app.get('/m/:slug', (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  // Demos por rubro: se resuelven sin DB (in-memory, siempre online).
  const restaurant = db.findRestaurantBySlug(slug) || getDemoRestaurant(slug);
  const menuHtmlPath = path.join(PUBLIC_DIR, 'menu.html');

  if (fs.existsSync(menuHtmlPath) && restaurant) {
    let html = fs.readFileSync(menuHtmlPath, 'utf8');
    const appUrl = (process.env.APP_URL || 'https://scango.uy').replace(/\/+$/, '');
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    })[character]);
    const toAbsoluteUrl = (value, fallback = null) => {
      if (!value) return fallback;
      try {
        const url = new URL(value, `${appUrl}/`);
        return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
      } catch (e) {
        return fallback;
      }
    };
    const requestedBranch = String(req.query.branch || req.query.sucursal || '').toLowerCase().trim();
    const activeBranch = (restaurant.branches || []).find(branch =>
      requestedBranch && [branch.id, branch.slug].some(value => String(value || '').toLowerCase() === requestedBranch)
    ) || null;
    const restaurantName = activeBranch
      ? `${restaurant.name || restaurant.bizName || 'Menú Digital'} — ${activeBranch.name}`
      : (restaurant.name || restaurant.bizName || 'Menú Digital');
    // Evento (boda/15/cumpleaños/catering): el preview al compartir debe contar la
    // celebración (pareja/fecha/lugar), no el genérico "ScanGo".
    const eventCfg = restaurant.eventConfig || {};
    const isEventMenu = Boolean(
      restaurant.businessType === 'events' ||
        restaurant.eventType ||
        eventCfg.eventType ||
        eventCfg.coupleNames ||
        (restaurant.weddingItinerary && restaurant.weddingItinerary.enabled)
    );
    const resolveEventTypeLabel = eventType => {
      switch (String(eventType || '').toLowerCase()) {
        case 'cumple_15':
          return 'Cumpleaños de 15';
        case 'birthday':
          return 'Cumpleaños';
        case 'catering':
          return 'Evento';
        case 'wedding':
          return 'Boda';
        default:
          return 'Evento';
      }
    };
    const eventTypeLabel = resolveEventTypeLabel(restaurant.eventType || eventCfg.eventType || 'wedding');
    const eventCouple = String(
      (restaurant.weddingItinerary && restaurant.weddingItinerary.coupleNames) || eventCfg.coupleNames || ''
    ).trim();
    const eventWhere = [
      (restaurant.weddingItinerary && restaurant.weddingItinerary.date) || eventCfg.date,
      (restaurant.weddingItinerary && restaurant.weddingItinerary.venue) || eventCfg.venue
    ]
      .map(value => String(value || '').trim())
      .filter(Boolean);
    const title = isEventMenu
      ? `${eventTypeLabel}${eventCouple ? `: ${eventCouple}` : ''} — ${restaurantName} — ScanGo`
      : `${restaurantName} — ScanGo`;
    const slogan =
      isEventMenu && eventWhere.length
        ? eventWhere.join(' · ')
        : restaurant.slogan || 'Especialidad, masas artesanales y cocina de autor';
    const ogImage = toAbsoluteUrl(
      restaurant.bannerUrl || restaurant.logoUrl || eventCfg.heroImage,
      `${appUrl}/og-cover.png`
    );
    const branchQuery = activeBranch ? `?branch=${encodeURIComponent(activeBranch.slug || activeBranch.id)}` : '';
    const menuUrl = `${appUrl}/m/${encodeURIComponent(restaurant.slug || slug)}${branchQuery}`;
    const normalized = normalizeBranchCustomDishes(restaurant.categories, restaurant.dishes, activeBranch?.customDishes || null);
    const categories = normalized.categories;
    // Defensa para verticales sin carta cargada (eventos/heladerías frescas):
    // normalizeBranchCustomDishes puede devolver dishes: undefined.
    let dishes = Array.isArray(normalized.dishes) ? normalized.dishes : [];

    if (activeBranch?.overridePrices && typeof activeBranch.overridePrices === 'object') {
      dishes = dishes.map(dish => ({
        ...dish,
        price: resolveBranchOverridePrice(activeBranch.overridePrices, dish.id, dish.price)
      }));
    }

    const currencyAliases = {
      '$U': 'UYU', U$U: 'UYU', UYU: 'UYU',
      USD: 'USD', 'US$': 'USD', 'U$S': 'USD',
      ARS: 'ARS', 'AR$': 'ARS', BRL: 'BRL', 'R$': 'BRL',
      CLP: 'CLP', MXN: 'MXN', COP: 'COP', EUR: 'EUR', '€': 'EUR', GBP: 'GBP', '£': 'GBP'
    };
    const currencyInput = String(restaurant.currency || '').trim().toUpperCase();
    const priceCurrency = currencyAliases[currencyInput] || (/^[A-Z]{3}$/.test(currencyInput) ? currencyInput : null);
    const toMenuItem = dish => {
      const item = {
        '@type': 'MenuItem',
        name: String(dish.name || 'Plato'),
        ...(dish.description ? { description: String(dish.description) } : {})
      };
      const image = toAbsoluteUrl(dish.photoUrl || dish.imageUrl || dish.image || dish.photo);
      if (image) item.image = image;

      const price = dish.price;
      if (price !== null && price !== undefined && price !== '' && Number.isFinite(Number(price))) {
        item.offers = {
          '@type': 'Offer',
          price: String(Number(price)),
          ...(priceCurrency ? { priceCurrency } : {})
        };
      }
      return item;
    };
    const menuSections = categories.map(category => ({
      '@type': 'MenuSection',
      name: String(category.name || 'Categoría'),
      hasMenuItem: dishes.filter(dish => dish.categoryId === category.id).map(toMenuItem)
    }));
    const uncategorizedDishes = dishes.filter(dish => !categories.some(category => category.id === dish.categoryId));
    if (uncategorizedDishes.length) {
      menuSections.push({
        '@type': 'MenuSection',
        name: 'Otros',
        hasMenuItem: uncategorizedDishes.map(toMenuItem)
      });
    }

    const address = activeBranch?.address || restaurant.address || '';
    const city = restaurant.city || '';
    const imageUrl = toAbsoluteUrl(
      restaurant.bannerUrl || restaurant.logoUrl || eventCfg.heroImage,
      `${appUrl}/og-cover.png`
    );
    const structuredData = {
      '@context': 'https://schema.org',
      '@type': 'Restaurant',
      '@id': `${menuUrl}#restaurant`,
      name: restaurantName,
      url: menuUrl,
      image: imageUrl,
      description: String(slogan),
      ...(activeBranch?.phone || restaurant.phone ? { telephone: activeBranch?.phone || restaurant.phone } : {}),
      ...(address || city ? {
        address: {
          '@type': 'PostalAddress',
          ...(address ? { streetAddress: String(address) } : {}),
          ...(city ? { addressLocality: String(city) } : {}),
          ...(restaurant.addressCountry ? { addressCountry: String(restaurant.addressCountry) } : {})
        }
      } : {}),
      hasMenu: {
        '@type': 'Menu',
        '@id': `${menuUrl}#menu`,
        name: `Menú de ${restaurantName}`,
        inLanguage: 'es',
        hasMenuSection: menuSections
      },
      // SEO local: zona de servicio para búsquedas "cerca de mí".
      ...(city ? { areaServed: String(city) } : {}),
      ...(seoDiscovery.buildOpeningHoursFromSchedule(restaurant) || {}),
      ...(restaurant.priceRange ? { priceRange: restaurant.priceRange } : {}),
      ...(Array.isArray(restaurant.sameAs) && restaurant.sameAs.length ? { sameAs: restaurant.sameAs } : {}),
      ...(Number.isFinite(Number(restaurant.latitude)) && Number.isFinite(Number(restaurant.longitude)) ? {
        geo: {
          '@type': 'GeoCoordinates',
          latitude: Number(restaurant.latitude),
          longitude: Number(restaurant.longitude)
        }
      } : {}),
      ...(restaurant.servesCuisine ? { servesCuisine: restaurant.servesCuisine } : (restaurant.categories && restaurant.categories.length > 0 ? { servesCuisine: restaurant.categories.map(c => c.name) } : {}))
    };
    const safeJsonLd = JSON.stringify(structuredData).replace(/[<>&\u2028\u2029]/g, character => ({
      '<': '\\u003c',
      '>': '\\u003e',
      '&': '\\u0026',
      '\u2028': '\\u2028',
      '\u2029': '\\u2029'
    })[character]);
    const ogTags = `
      <meta name="description" content="${escapeHtml(slogan)}" />
      <link rel="canonical" href="${escapeHtml(menuUrl)}" />
      <meta property="og:title" content="${escapeHtml(title)}" />
      <meta property="og:description" content="${escapeHtml(slogan)}" />
      <meta property="og:image" content="${escapeHtml(ogImage)}" />
      <meta property="og:url" content="${escapeHtml(menuUrl)}" />
      <meta property="og:type" content="restaurant.menu" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${escapeHtml(title)}" />
      <meta name="twitter:description" content="${escapeHtml(slogan)}" />
      <meta name="twitter:image" content="${escapeHtml(ogImage)}" />
      <script type="application/ld+json">${safeJsonLd}</script>
    `;

    // IMPORTANTE: replace con FUNCIÓN, no con string. String.prototype.replace
    // interpreta patrones `$` en el reemplazo ($&, $$, $', ...): si el título o el
    // JSON-LD inyectado contienen `$` (p.ej. priceRange "$$$" o un nombre con $),
    // un reemplazo-string los corrompe (V8 colapsa "$$$" → "$$"). Una función
    // devuelve el texto literal sin procesar los `$`. (Bug real cazado por
    // test-seo-discovery al agregar priceRange "$$$" al JSON-LD del SSR.)
    html = html.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escapeHtml(title)}</title>`);
    html = html.replace('</head>', () => `${ogTags}\n</head>`);
    // Falso positivo verificado: TODO dato de restaurante inyectado en `html` pasa por
    // escapeHtml() (ogTags, title) o por safeJsonLd (JSON.stringify + escape de <>& y \u2028\u2029);
    // la base `html` es el template estático de menu.html, sin interpolación de usuario.
    // CSP estricto del menú público (/m/*): sin 'unsafe-inline' en script-src ni
    // script-src-attr (todo handler vía data-js-* + dom-bindings.js). El resto de
    // headers ya vienen del middleware securityHeaders.
    res.setHeader(
      'Content-Security-Policy',
      securityHeaders.getSecurityHeaders({ strictMenu: true })['Content-Security-Policy']
    );
    // ETag + CDN cache del SSR público: revalidación barata para crawlers/CDN
    // sin cambiar contenido ni CSP. La clave incluye updatedAt/createdAt para
    // invalidar al editar la carta, MÁS subscription.updatedAt: un flip de
    // suscripción por webhook/cron también cambia el HTML (menú pausado ↔
    // online) y sin esto el navegador/CDN respondería 304 con lo viejo.
    const subTs = (restaurant.subscription && restaurant.subscription.updatedAt) || '';
    const menuEtag = 'W/"m-' + restaurant.slug + '-' + (restaurant.updatedAt || restaurant.createdAt || '') + '-' + subTs + '-' + html.length + '"';
    res.setHeader('ETag', menuEtag);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60, stale-while-revalidate=300');
    if (req.headers['if-none-match'] === menuEtag) {
      return res.status(304).end();
    }
    return res.send(html); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  }

  res.sendFile(menuHtmlPath, SEND_FILE_OPTIONS);
});

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
app.use('/api/cron', billingDunningRouter);
app.use('/api/cron', telemetryRetentionRouter);
app.use('/api/cron', seoAuditCronRouter);

// Protected routes: require active subscription (Billing operations)
// IMPORTANTE: sólo aplica a rutas /api/billing montadas DESPUÉS de esta línea.
// checkout/webhook/status (líneas 581/617/642) quedan ex a propósito: un usuario
// con trial vencido DEBE poder llegar al checkout para pagarse.
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
