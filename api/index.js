const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const path = require('path');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const db = require('../src/db/db');
const billingOrchestrator = require('../src/billing/orchestrator');
const emailService = require('./services/email');
const { hashPassword, comparePassword } = require('./utils/hash');
const { registerSchema, loginSchema, validateBody } = require('./middleware/validation');
const errorHandler = require('./middleware/errorHandler');
const { successResponse, errorResponse } = require('./utils/response');
const requireVerifiedEmail = require('./middleware/requireVerifiedEmail');
const requestIdMiddleware = require('./middleware/requestId');
const { menuCacheMiddleware, invalidateMenuCache } = require('./middleware/cache');
const authRouter = require('./routes/auth');
const reviewsRouter = require('./routes/reviews');
const storageRouter = require('./routes/storage');
const webhooksRouter = require('./routes/webhooks');
const notificationsRouter = require('./routes/notifications');
const emailRouter = require('./routes/email');
const healthRouter = require('./routes/health');
const ordersRouter = require('./routes/orders');
const analyticsRouter = require('./routes/analytics');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pizarron_admin_master_key_2026';

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

// Security headers with Helmet (disabling CSP to allow external CDNs like Google Fonts, FontAwesome, etc.)
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

// CORS setup
app.use(cors({ origin: true, credentials: true }));
app.use(cookieParser());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

// Strict rate limiter for Admin Master login
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 6, // max 6 intentos para proteger la clave maestra
  message: { error: 'Demasiados intentos erróneos de clave maestra. Acceso temporalmente bloqueado por 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Production-ready secure cookie flags
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 30 * 24 * 3600 * 1000
};

// Input Sanitizer to prevent malicious or malformed restaurant data
function sanitizeRestaurantPayload(data) {
  if (!data || typeof data !== 'object') return {};
  const clean = { ...data };
  if (clean.name) clean.name = String(clean.name).slice(0, 80);
  if (clean.bizName) clean.bizName = String(clean.bizName).slice(0, 80);
  if (clean.slogan) clean.slogan = String(clean.slogan).slice(0, 150);
  if (clean.phone) clean.phone = String(clean.phone).replace(/[^0-9+]/g, '').slice(0, 20);
  if (clean.currency) clean.currency = String(clean.currency).slice(0, 5);
  if (clean.theme) clean.theme = String(clean.theme).slice(0, 30);
  if (clean.themeFont) clean.themeFont = String(clean.themeFont).slice(0, 30);
  if (clean.instagram) clean.instagram = String(clean.instagram).replace(/[^a-zA-Z0-9._]/g, '').slice(0, 40);
  if (clean.googleReview) clean.googleReview = String(clean.googleReview).slice(0, 300);
  if (typeof clean.allowReservations !== 'undefined') clean.allowReservations = Boolean(clean.allowReservations);
  if (typeof clean.allowCoupons !== 'undefined') clean.allowCoupons = Boolean(clean.allowCoupons);
  if (typeof clean.allowBillSplitter !== 'undefined') clean.allowBillSplitter = Boolean(clean.allowBillSplitter);
  if (clean.announcement) clean.announcement = String(clean.announcement).slice(0, 300);
  if (clean.paymentLink) clean.paymentLink = String(clean.paymentLink).slice(0, 500);
  if (typeof clean.scheduleEnabled !== 'undefined') clean.scheduleEnabled = Boolean(clean.scheduleEnabled);
  if (clean.scheduleActiveHours) clean.scheduleActiveHours = String(clean.scheduleActiveHours).slice(0, 30);
  if (clean.tableCount) clean.tableCount = Math.max(1, Math.min(100, parseInt(clean.tableCount) || 1));

  if (clean.logoUrl && typeof clean.logoUrl === 'string' && clean.logoUrl.length > 5000000) {
    clean.logoUrl = clean.logoUrl.slice(0, 5000000);
  }

  if (Array.isArray(clean.dishes)) {
    clean.dishes = clean.dishes.slice(0, 400).map(d => ({
      id: String(d.id || ('d_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4))),
      categoryId: String(d.categoryId || ''),
      name: String(d.name || 'Sin nombre').slice(0, 100),
      price: Math.max(0, parseFloat(d.price) || 0),
      description: String(d.description || '').slice(0, 400),
      photoUrl: d.photoUrl && typeof d.photoUrl === 'string' ? d.photoUrl.slice(0, 1500) : null,
      outOfStock: Boolean(d.outOfStock),
      tags: Array.isArray(d.tags) ? d.tags.slice(0, 8).map(t => String(t).slice(0, 25)) : []
    }));
  }
  if (Array.isArray(clean.categories)) {
    clean.categories = clean.categories.slice(0, 60).map(c => ({
      id: String(c.id || ('cat_' + Date.now())),
      name: String(c.name || 'Categoría').slice(0, 60)
    }));
  }
  if (Array.isArray(clean.deliveryZones)) {
    clean.deliveryZones = clean.deliveryZones.slice(0, 25).map(z => ({
      name: String(z.name || 'Zona').slice(0, 60),
      fee: Math.max(0, parseFloat(z.fee) || 0)
    }));
  }
  if (Array.isArray(clean.customCoupons)) {
    clean.customCoupons = clean.customCoupons.slice(0, 20).map(cp => ({
      code: String(cp.code || '').trim().toUpperCase().slice(0, 20),
      type: cp.type === 'free_delivery' ? 'free_delivery' : 'percent',
      value: Math.max(0, Math.min(100, parseFloat(cp.value) || 0)),
      label: String(cp.label || '').slice(0, 40)
    })).filter(cp => cp.code.length >= 2);
  }
  if (Array.isArray(clean.teamMembers)) {
    clean.teamMembers = clean.teamMembers.slice(0, 15).map(m => ({
      email: String(m.email || '').trim().toLowerCase().slice(0, 80),
      role: ['admin', 'waiter', 'kitchen'].includes(m.role) ? m.role : 'waiter',
      name: String(m.name || '').slice(0, 60),
      addedAt: m.addedAt || new Date().toISOString()
    })).filter(m => m.email.includes('@'));
  }
  return clean;
}

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


// Static files (allow dotfiles because workspace path contains .gemini)
app.use(express.static(PUBLIC_DIR, { dotfiles: 'allow' }));

// Helper: Verify Auth
function authMiddleware(req, res, next) {
  const token = req.cookies.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
  if (!token) return res.status(401).json({ error: 'No autorizado' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}

// Helper: Admin Master Auth with optional TOTP (Google Authenticator)
const crypto = require('crypto');
function verifyTotpToken(token, secret) {
  if (!secret) return true;
  if (!token) return false;
  function base32Decode(base32) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (let i = 0; i < base32.length; i++) {
      const val = alphabet.indexOf(base32.charAt(i).toUpperCase());
      if (val !== -1) bits += val.toString(2).padStart(5, '0');
    }
    const bytes = [];
    for (let i = 0; i + 8 <= bits.length; i += 8) {
      bytes.push(parseInt(bits.substr(i, 8), 2));
    }
    return Buffer.from(bytes);
  }
  try {
    const keyBuffer = base32Decode(secret.replace(/\s+/g, ''));
    const epoch = Math.floor(Date.now() / 1000);
    const currentStep = Math.floor(epoch / 30);
    for (let offset = -1; offset <= 1; offset++) {
      const step = currentStep + offset;
      const timeBuffer = Buffer.alloc(8);
      timeBuffer.writeUInt32BE(0, 0);
      timeBuffer.writeUInt32BE(step, 4);
      const hmac = crypto.createHmac('sha1', keyBuffer);
      hmac.update(timeBuffer);
      const digest = hmac.digest();
      const hmacOffset = digest[digest.length - 1] & 0xf;
      const code = ((digest[hmacOffset] & 0x7f) << 24 |
        (digest[hmacOffset + 1] & 0xff) << 16 |
        (digest[hmacOffset + 2] & 0xff) << 8 |
        (digest[hmacOffset + 3] & 0xff)) % 1000000;
      if (code.toString().padStart(6, '0') === String(token).trim()) {
        return true;
      }
    }
  } catch (e) {}
  return false;
}

function adminMiddleware(req, res, next) {
  const key = req.headers['x-admin-key'] || req.query.adminKey || req.cookies.admin_key;
  const totp = req.headers['x-admin-totp'] || req.query.adminTotp || req.body?.totp;
  const adminTotpSecret = process.env.ADMIN_TOTP_SECRET;

  if (key && key === ADMIN_KEY) {
    if (adminTotpSecret && !verifyTotpToken(totp, adminTotpSecret)) {
      return res.status(403).json({ error: 'Código Google Authenticator inválido o expirado' });
    }
    return next();
  }
  return res.status(403).json({ error: 'Acceso denegado al panel de administración' });
}

// ==================== STUDIO & RESTAURANT ROUTES ====================
app.post('/api/studio/save', authMiddleware, requireVerifiedEmail, async (req, res) => {
  try {
    const payload = req.body.data || req.body;
    const cleanPayload = sanitizeRestaurantPayload(payload);
    const restaurant = db.saveRestaurant(req.user.userId, cleanPayload);
    if (restaurant && restaurant.slug) {
      await invalidateMenuCache(restaurant.slug);
    }
    res.json({ success: true, restaurant });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== PUBLIC MENU VIEWER (WITH 800MS TIMEOUT RACE & STALE CACHE FALLBACK) ====================
app.get('/api/menu/:slug', menuCacheMiddleware, async (req, res) => {
  const slug = (req.params.slug || '').toLowerCase();
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('DB_TIMEOUT_800MS')), 800)
    );

    const fetchPromise = getCachedMenu(slug, async () => {
      const restaurant = db.findRestaurantBySlug(slug);
      if (!restaurant) return null;

      // Verify Subscription & Grace Period
      const access = billingOrchestrator.verifyAccess(restaurant.id);
      if (!access.allowed) {
        return {
          inactive: true,
          warning: access.warning
        };
      }

      // Multi-Branch Hierarchy Support (?branch= or ?sucursal=)
      const reqBranch = (req.query.branch || req.query.sucursal || '').toLowerCase().trim();
      let activeBranch = null;

      if (reqBranch && Array.isArray(restaurant.branches)) {
        activeBranch = restaurant.branches.find(b =>
          (b.id || '').toLowerCase() === reqBranch || (b.slug || '').toLowerCase() === reqBranch
        );
      }

      // Base dishes inheritance & price overrides for branch
      let inheritedDishes = [...(restaurant.dishes || [])];
      if (activeBranch) {
        if (activeBranch.overridePrices && typeof activeBranch.overridePrices === 'object') {
          inheritedDishes = inheritedDishes.map(d => ({
            ...d,
            price: typeof activeBranch.overridePrices[d.id] !== 'undefined' ? activeBranch.overridePrices[d.id] : d.price,
            previous_price: d.price
          }));
        }
        if (Array.isArray(activeBranch.customDishes) && activeBranch.customDishes.length > 0) {
          inheritedDishes = [...inheritedDishes, ...activeBranch.customDishes];
        }
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
        theme: restaurant.theme || 'emerald',
        themeFont: restaurant.themeFont || 'serif',
        instagram: restaurant.instagram || '',
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
        wifi: restaurant.wifi || { ssid: '', password: '' },
        categories: restaurant.categories || [],
        dishes: dishes,
        deliveryZones: restaurant.deliveryZones || [],
        updatedAt: restaurant.updatedAt
      };

      return {
        restaurant: publicData,
        access: {
          inGracePeriod: access.inGracePeriod,
          daysRemaining: access.gracePeriodDaysRemaining
        }
      };
    });

    let data;
    try {
      data = await Promise.race([fetchPromise, timeoutPromise]);
    } catch (raceErr) {
      if (raceErr.message === 'DB_TIMEOUT_800MS') {
        const { memoryCache } = require('./middleware/cache');
        const stale = memoryCache.get(slug);
        if (stale) {
          res.setHeader('Warning', '110 Response is Stale');
          res.setHeader('X-Cache-Status', 'Stale-Fallback');
          return res.status(200).json(stale);
        }
      }
      data = await fetchPromise;
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

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ==================== BILLING ROUTES ====================
app.post('/api/billing/checkout', authMiddleware, (req, res) => {
  try {
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });

    const { planId, countryCode, currency } = req.body;
    const checkout = billingOrchestrator.createCheckout({
      restaurantId: restaurant.id,
      planId: planId || 'pro_monthly',
      customerEmail: req.user.email,
      countryCode: countryCode || 'UY',
      currency: currency || restaurant.currency || 'USD'
    });

    res.json(checkout);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/billing/webhook/:provider', async (req, res) => {
  try {
    const provider = req.params.provider;
    const rawBody = JSON.stringify(req.body);
    const result = await billingOrchestrator.processWebhook(provider, req.headers, rawBody, req.body);
    res.json(result);
  } catch (e) {
    console.error(`[Webhook Error ${req.params.provider}]`, e.message);
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
  const { key, totp } = req.body;
  const adminTotpSecret = process.env.ADMIN_TOTP_SECRET;

  if (key === ADMIN_KEY) {
    if (adminTotpSecret && !verifyTotpToken(totp, adminTotpSecret)) {
      return res.status(401).json({ error: 'Código Google Authenticator (TOTP) incorrecto o expirado' });
    }
    res.cookie('admin_key', key, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 3600 * 1000 });
    return res.json({ success: true, message: 'Acceso autorizado como administrador maestro' });
  }
  return res.status(401).json({ error: 'Clave de administración incorrecta' });
});

app.get('/api/admin/overview', adminMiddleware, (req, res) => {
  const restaurants = db.getAllRestaurants();
  const users = db.getAllUsers();

  const totalRestaurants = restaurants.length;
  const activeSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'active').length;
  const trialingSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'trialing').length;
  const pastDueSubs = restaurants.filter(r => r.subscription && r.subscription.status === 'past_due').length;
  const mrrEst = activeSubs * 9; // Estimado base USD

  res.json({
    metrics: {
      totalRestaurants,
      totalUsers: users.length,
      activeSubs,
      trialingSubs,
      pastDueSubs,
      mrrEst
    },
    restaurants,
    users
  });
});

app.post('/api/admin/restaurant/:id/status', adminMiddleware, (req, res) => {
  const { status } = req.body;
  const valid = ['active', 'trialing', 'past_due', 'canceled', 'paused'];
  if (!valid.includes(status)) return res.status(400).json({ error: 'Estado de suscripción inválido' });

  const updated = db.setRestaurantStatus(req.params.id, status);
  if (!updated) return res.status(404).json({ error: 'Restaurante no encontrado' });
  res.json({ success: true, restaurant: updated });
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
    const user = db.createUser({
      ...(sbUserId ? { id: sbUserId } : {}),
      email: rawEmail,
      name,
      email_confirmed_at: new Date().toISOString()
    });

    const finalBizName = req.body.restaurantName || req.body.bizName || name;
    const cleanSlug = rawSlug.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);

    const restaurant = db.saveRestaurant(user.id, {
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
app.post('/api/analytics/event', (req, res) => {
  try {
    const { slug, event } = req.body;
    if (!slug || !event) return res.status(400).json({ error: 'slug y event requeridos' });
    const validEvents = ['visit', 'order', 'reservation', 'waiter'];
    if (!validEvents.includes(event)) return res.status(400).json({ error: 'Evento inválido' });
    const analytics = db.recordAnalyticsEvent(slug, event);
    if (!analytics) return res.status(404).json({ error: 'Restaurante no encontrado' });
    res.json({ success: true, analytics });
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
app.post('/api/reviews', authMiddleware, (req, res) => {
  try {
    const { rating, comment, authorRole } = req.body;
    if (!rating || !comment) return res.status(400).json({ error: 'Calificación y comentario requeridos' });
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) return res.status(404).json({ error: 'Restaurante no encontrado' });
    const review = db.addReview({
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

app.post('/api/admin/reviews/:id/moderate', adminMiddleware, (req, res) => {
  try {
    const { status } = req.body;
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Estado debe ser approved o rejected' });
    }
    const review = db.updateReviewStatus(req.params.id, status);
    if (!review) return res.status(404).json({ error: 'Reseña no encontrada' });
    res.json({ success: true, review });
  } catch (e) {
    res.status(500).json({ error: e.message });
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
    const appUrl = process.env.APP_URL || 'https://menupizarron.com';
    const title = `${restaurant.name || restaurant.bizName || 'Menú Digital'} — Menú Pizarrón`;
    const slogan = restaurant.slogan || 'Especialidad, masas artesanales y cocina de autor';
    const logoUrl = restaurant.logoUrl || `${appUrl}/og-cover.png`;
    const menuUrl = `${appUrl}/m/${restaurant.slug}`;

    const ogTags = `
      <title>${title}</title>
      <meta property="og:title" content="${title}" />
      <meta property="og:description" content="${slogan}" />
      <meta property="og:image" content="${logoUrl}" />
      <meta property="og:url" content="${menuUrl}" />
      <meta property="og:type" content="restaurant.menu" />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content="${title}" />
      <meta name="twitter:description" content="${slogan}" />
      <meta name="twitter:image" content="${logoUrl}" />
    `;

    // Inject OpenGraph meta tags before </head>
    html = html.replace('</head>', `${ogTags}\n</head>`);
    return res.send(html);
  }

  res.sendFile(menuHtmlPath, SEND_FILE_OPTIONS);
});

// Server-side Auth Guard for Studio HTML View
function studioHtmlAuthMiddleware(req, res, next) {
  const token = req.cookies.auth_token || (req.headers.authorization && req.headers.authorization.split(' ')[1]);
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
  const key = req.cookies.admin_key || req.headers['x-admin-key'] || req.query.adminKey;
  if (!key || key !== ADMIN_KEY) {
    return res.status(403).send('<!DOCTYPE html><html><head><title>403 Acceso Denegado</title></head><body style="font-family:sans-serif;text-align:center;padding:50px;"><h1>403 Acceso Denegado</h1><p>Se requiere clave de administración para acceder a este panel.</p></body></html>');
  }
  next();
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
app.use('/api/webhooks', webhooksRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/email', emailRouter);

// Test Email Endpoint
app.get('/api/test-email', async (req, res, next) => {
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
