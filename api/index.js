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
const emailService = require('./services/email');
const telemetryService = require('./services/telemetry');
const { getWeatherContext } = require('./services/weather');
const { hashPassword, comparePassword } = require('./utils/hash');
const { registerSchema, loginSchema, validateBody } = require('./middleware/validation');
const { sanitizeModifierGroups, sanitizeDishOptionConfig } = require('./utils/menuOptions');
const { sanitizeRestaurantPayload, sanitizeBranchPayload } = require('./utils/sanitizeRestaurant');
const { checkSubscriptionKillSwitch, getSubscriptionKillSwitch, setSubscriptionKillSwitch } = require('./middleware/killSwitch');
const { verifyTotpToken } = require('./utils/totp');
const { requireActiveSubscription } = require('./middleware/subscriptionGuard');
const errorHandler = require('./middleware/errorHandler');
const { successResponse, errorResponse } = require('./utils/response');
const requireVerifiedEmail = require('./middleware/requireVerifiedEmail');
const requestIdMiddleware = require('./middleware/requestId');
const { menuCacheMiddleware, invalidateMenuCache } = require('./middleware/cache');
const { authMiddleware, adminMiddleware } = require('./middleware/auth');
const { publicAnalyticsLimiter, emailLimiter } = require('./middleware/rateLimits');
const { createGroupCartToken } = require('./utils/groupCartToken');
const sentry = require('./utils/sentry');
const securityHeaders = require('./utils/securityHeaders');
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
const billingDunningRouter = require('./cron/billing-dunning');

const app = express();
// Detrás de Vercel (proxy) el req.ip real llega por X-Forwarded-For (Vercel lo
// reescribe en el edge). Sin trust proxy, todo el tráfico comparte la IP del
// proxy y el rate-limit por IP no distingue clientes (429 masivo injusto).
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pizarron_admin_master_key_2026';

// Initialize Sentry for centralized error tracking (no-op if SENTRY_DSN not set)
sentry.initSentry();

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

// CORS setup
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

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

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 30,
  keyGenerator: tenantKeyGenerator,
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

// Strict rate limiter for Admin Master login (max 5 consecutive attempts per 15 minutes)
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // Exactamente 5 intentos consecutivos antes de bloquear
  message: {
    success: false,
    error: 'Acceso temporalmente bloqueado por seguridad: has superado el límite de 5 intentos. Esperá 15 minutos antes de volver a intentar.',
    code: 'ADMIN_RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Production-ready secure cookie flags
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

const ADMIN_SESSION_IDLE_TIMEOUT_SECONDS = 15 * 60;

// In-Memory Cache with Mutex / Single-Flight to prevent Cache Stampede
const menuCache = new Map(); // slug -> { data, expiresAt, fetchingPromise }
function getCachedMenu(slug, fetcherFn) {
  const now = Date.now();
  const entry = menuCache.get(slug);

  // Cache hit and still fresh (5 seconds TTL)
  if (entry && entry.expiresAt > now && entry.data) {
    return Promise.resolve(entry.data);
  }

  // Mutex: If a fetch is already in progress for this slug, join the existing promise (Prevents Cache Stampede!)
  if (entry && entry.fetchingPromise) {
    return entry.fetchingPromise;
  }

  // Stale-While-Revalidate: If stale data is available, return immediately while refreshing in background
  if (entry && entry.data) {
    const refreshPromise = Promise.resolve().then(fetcherFn).then(freshData => {
      menuCache.set(slug, { data: freshData, expiresAt: Date.now() + 5000, fetchingPromise: null });
      return freshData;
    }).catch(() => {});
    entry.fetchingPromise = refreshPromise;
    return Promise.resolve(entry.data);
  }

  // Cold cache: First request fetches and sets promise
  const fetchingPromise = Promise.resolve().then(fetcherFn).then(freshData => {
    menuCache.set(slug, { data: freshData, expiresAt: Date.now() + 5000, fetchingPromise: null });
    return freshData;
  }).catch(err => {
    menuCache.delete(slug);
    throw err;
  });

  menuCache.set(slug, { data: null, expiresAt: 0, fetchingPromise });
  return fetchingPromise;
}

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
app.get('/api/menu/:slug', menuCacheMiddleware, async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
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
        instagram: restaurant.instagram || '',
        facebook: restaurant.facebook || '',
        tiktok: restaurant.tiktok || '',
        x: restaurant.x || '',
        googleReview: restaurant.googleReview || '',
        allowReservations: restaurant.allowReservations !== false,
        allowCoupons: restaurant.allowCoupons !== false,
        allowBillSplitter: restaurant.allowBillSplitter !== false,
        announcement: restaurant.announcement || '',
        paymentLink: restaurant.paymentLink || '',
        scheduleEnabled: Boolean(restaurant.scheduleEnabled),
        scheduleActiveHours: restaurant.scheduleActiveHours || '',
        tableCount: restaurant.tableCount || 10,
        customCoupons: restaurant.customCoupons || [],
        logoUrl: restaurant.logoUrl || null,
        bannerUrl: restaurant.bannerUrl || null,
        layout: restaurant.layout || 'classic',
        // Verticales de negocio (no sensibles): el frontend las usa para el gating
        // de heladería/perfumería y la resolución de temas de eventos.
        businessType: restaurant.businessType || 'restaurant',
        allowIceCreamWizard: restaurant.allowIceCreamWizard === true,
        allowPerfumery: restaurant.allowPerfumery === true,
        wifi: restaurant.wifi || { ssid: '', password: '' },
        categories: publicCategories,
        modifierGroups: restaurant.modifierGroups || [],
        dishes: dishes,
        deliveryZones: restaurant.deliveryZones || [],
        updatedAt: restaurant.updatedAt,
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
app.post('/api/billing/checkout', authMiddleware, checkSubscriptionKillSwitch, async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });

    const { planId, plan, countryCode, currency } = req.body || {};
    const checkout = await billingOrchestrator.createCheckout({
      restaurantId: restaurant.id,
      // Acepta planId ('pro_monthly') o el alias corto que manda la UI ('monthly' | 'annual')
      planId: planId || plan || (restaurant.subscription && restaurant.subscription.plan) || 'pro_monthly',
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
    // Mercado Pago entrega el secreto por query string (notification_url)
    const expectedSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (provider === 'mercadopago' && expectedSecret && req.query.secret !== expectedSecret) {
      return res.status(401).json({ error: 'Webhook secret inválido', code: 'WEBHOOK_SECRET_INVALID' });
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
      tags: { provider: req.params.provider },
      extra: { path: req.originalUrl }
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

// ==================== OWNER ADMIN ROUTES ====================
app.post('/api/admin/login', adminLimiter, (req, res) => {
  const { key, adminKey, totp } = req.body || {};
  const providedKey = key || adminKey || req.headers['x-admin-key'];
  const adminTotpSecret = process.env.ADMIN_TOTP_SECRET || 'JBSWY3DPEHPK3PXP';

  if (providedKey === ADMIN_KEY) {
    const cleanTotp = (totp ? String(totp) : '').trim();
    if (!cleanTotp) {
      return res.status(401).json({ error: 'El código 2FA de Google Authenticator es obligatorio para ingresar al panel de administración' });
    }
    if (!verifyTotpToken(cleanTotp, adminTotpSecret)) {
      return res.status(401).json({ error: 'Código Google Authenticator (TOTP) incorrecto o expirado' });
    }
    const adminToken = jwt.sign(
      { role: 'admin_master', timestamp: Date.now() },
      JWT_SECRET,
      { expiresIn: ADMIN_SESSION_IDLE_TIMEOUT_SECONDS }
    );
    res.cookie('admin_key', providedKey, COOKIE_OPTIONS);
    res.cookie('admin_token', adminToken, COOKIE_OPTIONS);
    return res.json({
      success: true,
      token: adminToken,
      message: 'Acceso autorizado como administrador maestro'
    });
  }
  return res.status(401).json({ error: 'Clave de administración incorrecta' });
});

app.post('/api/admin/logout', (req, res) => {
  res.clearCookie('admin_key', COOKIE_OPTIONS);
  res.clearCookie('admin_token', COOKIE_OPTIONS);
  return res.json({ success: true });
});

app.get('/api/admin/overview', adminMiddleware, async (req, res) => {
  try {
    const { getSupabaseClient } = require('./utils/supabase');
    const supabase = getSupabaseClient();
    let restaurants = [];
    let users = [];

    if (supabase) {
      try {
        const { data: rData, error: rError } = await supabase.from('restaurants').select('*');
        if (!rError && Array.isArray(rData)) {
          restaurants = rData.map(r => ({
            id: r.id,
            userId: r.user_id,
            slug: r.slug,
            name: r.name || r.biz_name,
            bizName: r.biz_name || r.name,
            slogan: r.slogan,
            currency: r.currency,
            phone: r.phone,
            theme: r.theme,
            logoUrl: r.logo_url,
            wifi: r.wifi,
            categories: r.categories || [],
            dishes: r.dishes || [],
            modifierGroups: r.modifier_groups || [],
            deliveryZones: r.delivery_zones || [],
            branches: r.branches || [],
            subscription: r.subscription || {},
            analytics: r.analytics || { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 },
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }));
        } else if (rError) {
          console.warn('⚠️ [Supabase Overview Warning]', rError.message);
        }

        const { data: uData, error: uError } = await supabase.from('users').select('id, email, name, created_at');
        if (!uError && Array.isArray(uData)) {
          users = uData.map(u => ({
            id: u.id,
            email: u.email,
            name: u.name,
            createdAt: u.created_at
          }));
        } else if (uError) {
          console.warn('⚠️ [Supabase Users Overview Warning]', uError.message);
        }
      } catch (err) {
        console.warn('⚠️ [Supabase Query Exception]', err.message);
      }
    }

    // If Supabase wasn't connected or errored, use clean local store (no mocks)
    if (!restaurants.length) {
      const localR = db.getAllRestaurants();
      if (Array.isArray(localR) && localR.length) {
        restaurants = localR;
      }
    }
    if (!users.length) {
      const localU = db.getAllUsers();
      if (Array.isArray(localU) && localU.length) {
        users = localU;
      }
    }

    const now = new Date();
    // ¿Trial vencido? Se calcula sin mutar: escribir `isTrialExpired` sobre el
    // objeto compartido del caché dejaba basura que data/restaurants.json
    // persistía en la siguiente escritura.
    const isTrialEnded = (r) => {
      const s = r.subscription;
      return Boolean(s && s.status === 'trialing' && s.trialEndsAt && new Date(s.trialEndsAt) < now);
    };

    // ── Métricas en español llano (sin jerga de negocio) ──
    const DAY_MS = 24 * 60 * 60 * 1000;
    const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
    const KNOWN_PLANS = ['starter_monthly', 'starter_annual', 'pro_monthly', 'pro_annual'];
    const PLAN_NAMES = {
      starter_monthly: 'Starter Mensual',
      starter_annual: 'Starter Anual',
      pro_monthly: 'Pro Mensual',
      pro_annual: 'Pro Anual'
    };
    // Cuánta plata entra al mes por un restaurante que paga (el plan anual se
    // reparte entre 12; el descuento multi-sucursal es el real del orquestador).
    const monthlyEquivalent = (r) => {
      const s = r.subscription || {};
      if (s.status !== 'active' || !KNOWN_PLANS.includes(s.plan)) return 0;
      const pricing = billingOrchestrator.getPlanPricing(r, s.plan);
      return round2(String(s.plan).endsWith('_annual') ? pricing.totalPrice / 12 : pricing.totalPrice);
    };

    const fromSevenDays = new Date(now.getTime() - 7 * DAY_MS);
    const inSevenDays = new Date(now.getTime() + 7 * DAY_MS);

    const payingNow = restaurants.filter(r => (r.subscription || {}).status === 'active');
    const monthlyIncomeEstimate = round2(payingNow.reduce((sum, r) => sum + monthlyEquivalent(r), 0));

    // Renovaciones: clientes que pagan y se les renueva el pago dentro de 7 días
    const renewalsList = payingNow
      .filter(r => {
        const end = r.subscription.currentPeriodEnd && new Date(r.subscription.currentPeriodEnd);
        return Boolean(end && end > now && end <= inSevenDays);
      })
      .map(r => ({
        id: r.id,
        name: r.name || r.bizName || 'Sin nombre',
        slug: r.slug,
        plan: r.subscription.plan,
        planName: PLAN_NAMES[r.subscription.plan] || r.subscription.plan,
        renewsAt: r.subscription.currentPeriodEnd,
        amountMonthly: monthlyEquivalent(r)
      }))
      .sort((a, b) => new Date(a.renewsAt) - new Date(b.renewsAt));

    // Pruebas que terminan dentro de 7 días (les queda poco de prueba gratis)
    const trialsEndingList = restaurants
      .filter(r => {
        const s = r.subscription || {};
        const end = s.status === 'trialing' && s.trialEndsAt && new Date(s.trialEndsAt);
        return Boolean(end && end > now && end <= inSevenDays);
      })
      .map(r => ({
        id: r.id,
        name: r.name || r.bizName || 'Sin nombre',
        slug: r.slug,
        trialEndsAt: r.subscription.trialEndsAt
      }))
      .sort((a, b) => new Date(a.trialEndsAt) - new Date(b.trialEndsAt));

    // Conversión de la prueba, en criollo: de los que ya terminaron su prueba
    // gratis, ¿cuántos siguen pagando hoy?
    const trialFinished = restaurants.filter(r => {
      const t = r.subscription && r.subscription.trialEndsAt;
      return Boolean(t && new Date(t) < now);
    });
    const trialBecamePaying = trialFinished.filter(r => (r.subscription || {}).status === 'active').length;
    const trialConversionPercent = trialFinished.length
      ? Math.round((trialBecamePaying / trialFinished.length) * 100)
      : 0;

    const totalRestaurants = restaurants.length;
    const activeSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'active').length;
    const trialingSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'trialing' && !isTrialEnded(r)).length;
    const pastDueSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'past_due').length;
    const expiredSubs = restaurants.filter(r => {
      const s = r.subscription || {};
      return s.status === 'expired' || s.status === 'canceled' || isTrialEnded(r);
    }).length;
    const mrrEst = monthlyIncomeEstimate; // alias legacy: misma plata, nombre claro en la UI

    res.json({
      metrics: {
        totalRestaurants,
        totalUsers: users.length,
        activeSubs,
        trialingSubs,
        pastDueSubs,
        expiredSubs,
        mrrEst,
        // Números en criollo (lo que el panel muestra con palabras simples)
        monthlyIncomeEstimate,
        newThisWeek: restaurants.filter(r => r.createdAt && new Date(r.createdAt) >= fromSevenDays).length,
        renewalsCount: renewalsList.length,
        renewalsList,
        trialsEndingCount: trialsEndingList.length,
        trialsEndingList,
        trialFinished: trialFinished.length,
        trialBecamePaying,
        trialConversionPercent
      },
      restaurants,
      users
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/restaurant/:id/status', adminMiddleware, async (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'trialing', 'past_due', 'canceled', 'paused', 'expired'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado de suscripción inválido' });

  const { getSupabaseClient } = require('./utils/supabase');
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('restaurants').update({
        subscription: { status, updatedAt: new Date().toISOString() },
        updated_at: new Date().toISOString()
      }).eq('id', req.params.id);
    } catch (e) {
      console.warn('[Supabase status update error]', e.message);
    }
  }

  const updated = await db.setRestaurantStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Restaurante no encontrado' });
  res.json({ success: true, restaurant: updated });
});

// Revoke Free Trial Endpoint (Admin Action)
app.post('/api/admin/restaurant/:id/remove-trial', adminMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { getSupabaseClient } = require('./utils/supabase');
    const supabase = getSupabaseClient();

    const updatedSub = {
      status: 'expired',
      provider: 'admin_revoked',
      trialEndsAt: new Date(Date.now() - 1000).toISOString(),
      canceledAt: new Date().toISOString(),
      revokedByAdmin: true
    };

    if (supabase) {
      try {
        await supabase.from('restaurants').update({
          subscription: updatedSub,
          updated_at: new Date().toISOString()
        }).eq('id', id);
      } catch (e) {
        console.warn('[Supabase remove-trial error]', e.message);
      }
    }

    await db.updateSubscription(id, updatedSub);
    res.json({ success: true, message: 'Prueba gratuita revocada exitosamente', subscription: updatedSub });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Admin Manual Restaurant Invitation
app.post('/api/admin/invite-restaurant', adminMiddleware, async (req, res, next) => {
  try {
    const rawEmail = String(req.body.email || '').trim().toLowerCase();
    const name = String(req.body.name || 'Dueño de Restaurante').trim();
    const rawSlug = String(req.body.slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-')).trim();

    if (!rawEmail || !rawEmail.includes('@')) {
      return errorResponse(res, 'Email válido requerido para enviar la invitación', 400, null, 'INVALID_EMAIL');
    }

    const appUrl = process.env.APP_URL || `http://localhost:${PORT}`;
    const redirectUrl = `${appUrl}/studio`;
    const { getSupabaseClient } = require('./utils/supabase');
    const supabase = getSupabaseClient();

    let sbUserId = null;
    if (supabase) {
      try {
        const { data: inviteData, error: inviteError } = await supabase.auth.admin.inviteUserByEmail(rawEmail, {
          redirectTo: redirectUrl,
          data: { name, slug: rawSlug }
        });
        if (!inviteError && inviteData?.user) {
          sbUserId = inviteData.user.id;
        } else if (inviteError) {
          console.warn('[Supabase Invite Warning]', inviteError.message);
        }
      } catch (err) {
        console.warn('[Supabase Invite Exception]', err.message);
      }
    }

    // Create user in local DB
    const user = await db.createUser({
      ...(sbUserId ? { id: sbUserId } : {}),
      email: rawEmail,
      name,
      email_confirmed_at: new Date().toISOString()
    });

    const finalBizName = req.body.restaurantName || req.body.bizName || name;
    const cleanSlug = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);

    const restaurant = await db.saveRestaurant(user.id, {
      name: finalBizName,
      bizName: finalBizName,
      slug: cleanSlug,
      slogan: 'Especialidad, masas artesanales y cocina de autor',
      currency: '$',
      phone: req.body.phone || '59899123456',
      subscription: {
        status: 'active',
        plan: 'pro_monthly',
        provider: 'admin_invite',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });

    // Send real invitation email using Resend
    const inviteResult = await emailService.sendAdminInvitationEmail({
      to: rawEmail,
      name,
      restaurantName: finalBizName,
      inviteLink: redirectUrl
    });

    const { password: _, ...safeUser } = user;
    return successResponse(
      res,
      { user: safeUser, restaurant, emailDispatch: inviteResult },
      `Invitación enviada exitosamente a ${rawEmail} mediante Resend. El cliente podrá establecer su contraseña mediante el enlace recibido.`,
      201
    );
  } catch (err) {
    next(err);
  }
});

// ==================== ANALYTICS ROUTES ====================
// Canal público unificado de analítica. Fuente única de verdad: telemetría
// (telemetry_events). Los contadores legacy (restaurant.analytics) son una
// proyección derivada que se recalcula acá, nunca se incrementan a mano.
app.post('/api/public/analytics/event', publicAnalyticsLimiter, async (req, res) => {
  try {
    const { slug, event, dishId, branchId, amount, items } = req.body || {};
    if (!slug || !event) return res.status(400).json({ error: 'slug y event requeridos' });
    const validEvents = ['visit', 'order', 'reservation', 'waiter', 'dish_click', 'order_placed'];
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Evento inválido' });

    const restaurant = db.findRestaurantBySlug(slug);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    // Telemetría rica: alimenta ticket promedio, top platos y comparativa de
    // sucursales. Los valores se sanean (cadenas cortas; amount numérico 0..1e9;
    // items de pedidos con dishId ≤80 y qty 1..999, máximo 100 por pedido).
    const cleanAmount = Number(amount);
    const safeAmount = Number.isFinite(cleanAmount) && cleanAmount >= 0 && cleanAmount <= 1e9
      ? cleanAmount
      : undefined;
    const metadata = { amount: safeAmount, source: 'public_menu' };
    if (event === 'order_placed' && Array.isArray(items)) {
      const safeItems = items
        .slice(0, 100)
        .map(it => ({
          dishId: it && it.dishId ? String(it.dishId).slice(0, 80) : undefined,
          qty: it && Number.isFinite(Number(it.qty)) ? Math.max(1, Math.min(999, Math.floor(Number(it.qty)))) : 1
        }))
        .filter(it => it.dishId);
      if (safeItems.length) metadata.items = safeItems;
    }
    const canonicalType = event === 'order' || event === 'order_placed'
      ? 'order_placed'
      : event === 'waiter'
        ? 'waiter_call'
        : event;
    await telemetryService.recordEventSync({
      restaurantId: restaurant.id,
      eventType: canonicalType,
      dishId: dishId ? String(dishId).slice(0, 80) : undefined,
      branchId: branchId ? String(branchId).slice(0, 80) : undefined,
      metadata
    });

    // Proyección legacy derivada de la telemetría (queda sincronizada con todo
    // lo que pasa por /track y por el menú público).
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

app.get('/api/admin/reviews', adminMiddleware, (req, res) => {
  try {
    const reviews = db.getAllReviews();
    res.json({ reviews });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/admin/reviews/:id/moderate', adminMiddleware, async (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Estado debe ser approved o rejected' });
    }
    const review = await db.updateReviewStatus(req.params.id, status);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    res.json({ success: true, review });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dynamic Pricing & Promotional Banner Configuration
app.get('/api/settings/pricing', (req, res) => {
  try {
    const settings = db.getSettings();
    res.json({ success: true, settings });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

app.post('/api/admin/settings/pricing', adminMiddleware, async (req, res) => {
  try {
    const {
      monthlyPrice,
      annualPrice,
      annualDiscountPercent,
      promoBannerEnabled,
      promoDiscountPercent,
      promoBannerText
    } = req.body;

    const payload = {};
    if (monthlyPrice !== undefined) payload.monthlyPrice = Number(monthlyPrice);
    if (annualPrice !== undefined) payload.annualPrice = Number(annualPrice);
    if (annualDiscountPercent !== undefined) payload.annualDiscountPercent = Number(annualDiscountPercent);
    if (promoBannerEnabled !== undefined) payload.promoBannerEnabled = Boolean(promoBannerEnabled);
    if (promoDiscountPercent !== undefined) payload.promoDiscountPercent = Number(promoDiscountPercent);
    if (promoBannerText !== undefined) payload.promoBannerText = String(promoBannerText).trim();

    const updated = await db.updateSettings(payload);
    res.json({ success: true, settings: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Admin Kill-Switch Control para Suscripciones y Registro
app.get('/api/admin/killswitch', adminMiddleware, (req, res) => {
  res.json({ success: true, allowNewSubscriptions: getSubscriptionKillSwitch() });
});

app.post('/api/admin/killswitch', adminMiddleware, (req, res) => {
  try {
    const { allowNewSubscriptions } = req.body;
    if (typeof allowNewSubscriptions !== 'boolean') {
      return res.status(400).json({ success: false, error: 'Se requiere allowNewSubscriptions como booleano' });
    }
    const updated = setSubscriptionKillSwitch(allowNewSubscriptions);
    res.json({ success: true, allowNewSubscriptions: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// Specific HTML routing (allowing dotfiles for paths containing .gemini)
const SEND_FILE_OPTIONS = { dotfiles: 'allow' };

// SEO: Dynamic Robots.txt Route
app.get('/robots.txt', (req, res) => {
  res.type('text/plain');
  res.send(`User-agent: *
Disallow: /admin
Disallow: /studio
Disallow: /api/
Allow: /m/
Allow: /
Sitemap: ${process.env.APP_URL || 'https://menupizarron.com'}/sitemap.xml
`);
});

// SEO: Dynamic XML Sitemap Route for Active Restaurant Menus
app.get('/sitemap.xml', (req, res) => {
  res.type('application/xml');
  const appUrl = process.env.APP_URL || 'https://menupizarron.com';
  const restaurants = db.getAllRestaurants().filter(r => r.subscription && r.subscription.status !== 'canceled');

  const urlsXml = restaurants.map(r => `
  <url>
    <loc>${appUrl}/m/${r.slug}</loc>
    <lastmod>${r.updatedAt || r.createdAt || new Date().toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`).join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${appUrl}/</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>${urlsXml}
</urlset>`;

  res.send(xml);
});

// SEO & OpenGraph Dynamic Public Menu Route
app.get('/m/:slug', (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  const restaurant = db.findRestaurantBySlug(slug);
  const menuHtmlPath = path.join(PUBLIC_DIR, 'menu.html');

  if (fs.existsSync(menuHtmlPath) && restaurant) {
    let html = fs.readFileSync(menuHtmlPath, 'utf8');
    const appUrl = (process.env.APP_URL || 'https://menupizarron.com').replace(/\/+$/, '');
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
    const title = `${restaurantName} — Menú Pizarrón`;
    const slogan = restaurant.slogan || 'Especialidad, masas artesanales y cocina de autor';
    const ogImage = toAbsoluteUrl(restaurant.bannerUrl || restaurant.logoUrl, `${appUrl}/og-cover.png`);
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
    const imageUrl = toAbsoluteUrl(restaurant.bannerUrl || restaurant.logoUrl, `${appUrl}/og-cover.png`);
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
      ...(restaurant.openingHours ? { openingHours: restaurant.openingHours } : {}),
      ...(restaurant.priceRange ? { priceRange: restaurant.priceRange } : {}),
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

    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeHtml(title)}</title>`);
    html = html.replace('</head>', `${ogTags}\n</head>`);
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
    return res.send(html); // nosemgrep: javascript.express.security.audit.xss.direct-response-write.direct-response-write
  }

  res.sendFile(menuHtmlPath, SEND_FILE_OPTIONS);
});

// Server-side Auth Guard for Studio HTML View
function studioHtmlAuthMiddleware(req, res, next) {
  const token = req.cookies?.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]) || req.query.token;

  if (!token) {
    return res.redirect('/?auth=required');
  }
  try {
    jwt.verify(token, JWT_SECRET);
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
      const decoded = jwt.verify(token, JWT_SECRET);
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

// Mount modular API routers with rate limiting
app.use('/api/auth', authLimiter, authRouter);
app.use('/api/reviews', reviewsLimiter, reviewsRouter);
app.use('/api/storage', storageRouter);
app.use('/api/ai', aiRouter);
// Nota: las rutas de studio exigen `requireVerifiedEmail` + `authMiddleware`
// (el guard de suscripción vive en la UI del Studio y en los gates que pausan
// el menú público, no en este mount).
app.use('/api/studio', studioRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/email', emailRouter);
app.use('/api/cron', billingDunningRouter);

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
      subject: '🧪 Prueba de Correo Real con Resend — Menú Pizarrón SaaS',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #10b981; margin-top: 0;">🚀 Confirmación de Integración de Resend</h2>
          <p>Este es un correo electrónico de prueba enviado exitosamente desde el backend de <strong>Menú Pizarrón SaaS</strong> utilizando la API Key de Resend.</p>
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

// Mount Global Error Handler Middleware
app.use(errorHandler);

// Fallback for direct node execution (not when imported or in Vercel Serverless)
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`🚀 Menú Pizarrón SaaS corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
