const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const RESTAURANTS_FILE = path.join(DATA_DIR, 'restaurants.json');
const WEBHOOKS_FILE = path.join(DATA_DIR, 'webhooks.json');
const RESET_TOKENS_FILE = path.join(DATA_DIR, 'reset_tokens.json');

function readJson(file, def = []) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}

function writeJson(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error('Error writing to', file, e);
  }
}

// Supabase Cloud PostgreSQL Dual-Mode Adapter
let supabase = null;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_KEY ||
  process.env.SUPABASE_ANON_KEY;

if (process.env.SUPABASE_URL && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.SUPABASE_URL,
      supabaseKey,
      { auth: { persistSession: false } }
    );
    console.log('⚡ [DB] Conectado a Cloud Supabase (PostgreSQL)');

    // Sync cloud data into memory/cache on boot
    (async () => {
      try {
        const { data: uData } = await supabase.from('users').select('*');
        if (uData && uData.length) writeJson(USERS_FILE, uData);

        const { data: rData } = await supabase.from('restaurants').select('*');
        if (rData && rData.length) {
          const mapped = rData.map(r => ({
            id: r.id,
            userId: r.user_id,
            slug: r.slug,
            name: r.name,
            bizName: r.biz_name,
            slogan: r.slogan,
            currency: r.currency,
            phone: r.phone,
            theme: r.theme,
            logoUrl: r.logo_url,
            wifi: r.wifi,
            categories: r.categories,
            dishes: r.dishes,
            modifierGroups: r.modifier_groups || [],
            deliveryZones: r.delivery_zones,
            subscription: r.subscription,
            createdAt: r.created_at,
            updatedAt: r.updated_at
          }));
          writeJson(RESTAURANTS_FILE, mapped);
        }
      } catch (err) {
        console.warn('⚠️ [DB] Aviso en sincronización inicial con Supabase:', err.message);
      }
    })();
  } catch (err) {
    console.warn('⚠️ [DB] No se pudo conectar a Supabase, utilizando archivos JSON locales:', err.message);
  }
} else {
  console.log('📁 [DB] Modo Local: Almacenamiento JSON activo');
}

const db = {
  // Users
  findUserByEmail(email) {
    const users = readJson(USERS_FILE, []);
    return users.find(u => u.email.toLowerCase() === (email || '').toLowerCase()) || null;
  },
  findUserById(id) {
    const users = readJson(USERS_FILE, []);
    return users.find(u => u.id === id) || null;
  },
  createUser(userData) {
    const users = readJson(USERS_FILE, []);
    const id = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const newUser = { id, createdAt: new Date().toISOString(), ...userData };
    users.push(newUser);
    writeJson(USERS_FILE, users);

    // Sync to Supabase in background if connected
    if (supabase) {
      supabase.from('users').insert([{
        id: newUser.id,
        email: newUser.email,
        password: newUser.password,
        name: newUser.name,
        created_at: newUser.createdAt
      }]).then().catch(e => console.warn('[Supabase Insert User]', e.message));
    }
    return newUser;
  },
  updateUserPassword(userId, newHashedPassword) {
    const users = readJson(USERS_FILE, []);
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    user.password = newHashedPassword;
    user.updatedAt = new Date().toISOString();
    writeJson(USERS_FILE, users);

    if (supabase) {
      supabase.from('users').update({
        password: newHashedPassword,
        updated_at: user.updatedAt
      }).eq('id', userId).then().catch(e => console.warn('[Supabase Update Password]', e.message));
    }
    return user;
  },

  // Password Recovery Tokens (Single-use with JTI & Expiry)
  savePasswordResetToken(userId, jti, expiresAt) {
    const tokens = readJson(RESET_TOKENS_FILE, []);
    // Invalidate any previously pending unused tokens for this user
    tokens.forEach(t => {
      if (t.userId === userId && !t.used) {
        t.used = true;
        t.revokedAt = new Date().toISOString();
      }
    });
    tokens.push({
      userId,
      jti,
      expiresAt,
      used: false,
      createdAt: new Date().toISOString()
    });
    // Keep max 500 recent token records
    if (tokens.length > 500) tokens.splice(0, tokens.length - 500);
    writeJson(RESET_TOKENS_FILE, tokens);
  },
  isResetTokenValid(userId, jti) {
    const tokens = readJson(RESET_TOKENS_FILE, []);
    const record = tokens.find(t => t.jti === jti);
    if (!record) return false;
    if (record.userId !== userId) return false;
    if (record.used) return false;
    if (Date.now() > record.expiresAt) return false;
    return true;
  },
  invalidateResetToken(jti) {
    const tokens = readJson(RESET_TOKENS_FILE, []);
    const record = tokens.find(t => t.jti === jti);
    if (record) {
      record.used = true;
      record.usedAt = new Date().toISOString();
      writeJson(RESET_TOKENS_FILE, tokens);
      return true;
    }
    return false;
  },

  // Restaurants & Menus
  findRestaurantBySlug(slug) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return rests.find(r => (r.slug || '').toLowerCase() === (slug || '').toLowerCase()) || null;
  },
  findRestaurantByUserId(userId) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return rests.find(r => r.userId === userId) || null;
  },
  findRestaurantById(id) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return rests.find(r => r.id === id) || null;
  },
  saveRestaurant(userId, data) {
    const rests = readJson(RESTAURANTS_FILE, []);
    let rest = rests.find(r => r.userId === userId);
    if (!rest) {
      const id = 'rest_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      const rawSlug = (data.slug || data.bizName || 'mi-local').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
      rest = {
        id,
        userId,
        slug: rawSlug || 'local-' + Date.now().toString(36),
        subscription: {
          status: 'trialing',
          plan: 'pro_monthly',
          provider: 'trial',
          trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          gracePeriodDaysRemaining: 7
        },
        createdAt: new Date().toISOString(),
        ...data
      };
      rests.push(rest);
    } else {
      Object.assign(rest, data);
      rest.updatedAt = new Date().toISOString();
    }
    writeJson(RESTAURANTS_FILE, rests);

    // Sync to Supabase in background if connected
    if (supabase) {
      supabase.from('restaurants').upsert([{
        id: rest.id,
        user_id: rest.userId,
        slug: rest.slug,
        name: rest.name || rest.bizName,
        biz_name: rest.bizName || rest.name,
        slogan: rest.slogan,
        currency: rest.currency,
        phone: rest.phone,
        theme: rest.theme,
        logo_url: rest.logoUrl,
        wifi: rest.wifi,
        categories: rest.categories,
        dishes: rest.dishes,
        modifier_groups: rest.modifierGroups || [],
        delivery_zones: rest.deliveryZones,
        subscription: rest.subscription,
        updated_at: new Date().toISOString()
      }], { onConflict: 'id' }).then().catch(e => console.warn('[Supabase Save Rest]', e.message));
    }
    return rest;
  },

  // Subscriptions
  updateSubscription(restaurantId, subData) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return null;
    rest.subscription = { ...rest.subscription, ...subData, updatedAt: new Date().toISOString() };
    writeJson(RESTAURANTS_FILE, rests);

    // Sync to Supabase in background if connected
    if (supabase) {
      supabase.from('restaurants').update({
        subscription: rest.subscription,
        updated_at: new Date().toISOString()
      }).eq('id', restaurantId).then().catch(e => console.warn('[Supabase Update Sub]', e.message));
    }
    return rest.subscription;
  },

  // Webhooks idempotency (prevent duplicate billing actions)
  hasProcessedWebhook(provider, eventId) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    return hooks.some(h => h.provider === provider && h.eventId === eventId);
  },
  markWebhookProcessed(provider, eventId, eventType, data = {}) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    hooks.push({
      provider,
      eventId,
      eventType,
      receivedAt: new Date().toISOString(),
      data
    });
    if (hooks.length > 1000) hooks.shift();
    writeJson(WEBHOOKS_FILE, hooks);

    // Sync to Supabase in background if connected
    if (supabase) {
      supabase.from('webhooks').insert([{
        provider,
        event_id: eventId,
        event_type: eventType,
        data
      }]).then().catch(e => console.warn('[Supabase Insert Webhook]', e.message));
    }
  },

  // Admin & Monitoring
  getAllRestaurants() {
    return readJson(RESTAURANTS_FILE, []);
  },
  getAllUsers() {
    const users = readJson(USERS_FILE, []);
    // Sanitize: do not expose password hashes to admin views
    return users.map(u => ({ id: u.id, email: u.email, name: u.name, createdAt: u.createdAt }));
  },
  setRestaurantStatus(restaurantId, newStatus) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return null;
    if (!rest.subscription) rest.subscription = {};
    rest.subscription.status = newStatus;
    rest.subscription.updatedAt = new Date().toISOString();
    writeJson(RESTAURANTS_FILE, rests);
    return rest;
  },

  // Analytics tracking
  recordAnalyticsEvent(slug, eventType) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.slug === slug);
    if (!rest) return null;
    if (!rest.analytics) {
      rest.analytics = { visits: 0, orders: 0, reservations: 0, waiterCalls: 0, lastUpdated: new Date().toISOString() };
    }
    if (eventType === 'visit') rest.analytics.visits = (rest.analytics.visits || 0) + 1;
    else if (eventType === 'order') rest.analytics.orders = (rest.analytics.orders || 0) + 1;
    else if (eventType === 'reservation') rest.analytics.reservations = (rest.analytics.reservations || 0) + 1;
    else if (eventType === 'waiter') rest.analytics.waiterCalls = (rest.analytics.waiterCalls || 0) + 1;
    rest.analytics.lastUpdated = new Date().toISOString();
    writeJson(RESTAURANTS_FILE, rests);
    return rest.analytics;
  },

  // Customer Reviews & Moderation
  addReview(reviewData) {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    const newRev = {
      id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      ...reviewData
    };
    reviews.push(newRev);
    writeJson(path.join(DATA_DIR, 'reviews.json'), reviews);
    return newRev;
  },
  getAllReviews() {
    return readJson(path.join(DATA_DIR, 'reviews.json'), []);
  },
  getApprovedReviews() {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    return reviews.filter(r => r.status === 'approved');
  },
  updateReviewStatus(id, status) {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    const rev = reviews.find(r => r.id === id);
    if (!rev) return null;
    rev.status = status;
    rev.moderatedAt = new Date().toISOString();
    writeJson(path.join(DATA_DIR, 'reviews.json'), reviews);
    return rev;
  },

  // Global Settings (Pricing & Promotional Banner)
  getSettings() {
    const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
    const defaultSettings = {
      monthlyPrice: 9,
      annualPrice: 69,
      annualDiscountPercent: 36,
      promoBannerEnabled: true,
      promoDiscountPercent: 50,
      promoBannerText: '🔥 ¡50% OFF por tiempo limitado en todos los planes! Lanzá tu carta hoy.'
    };
    return { ...defaultSettings, ...readJson(SETTINGS_FILE, {}) };
  },
  updateSettings(newSettings) {
    const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
    const current = this.getSettings();
    const updated = { ...current, ...newSettings };
    writeJson(SETTINGS_FILE, updated);
    return updated;
  }
};

module.exports = db;
