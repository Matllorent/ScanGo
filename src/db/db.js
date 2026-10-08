const fs = require('fs');
const path = require('path');
const os = require('os');

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', '..', 'data');
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function writeJson(file, data, retries = 3, delay = 100) {
  const temporaryFile = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      fs.writeFileSync(temporaryFile, JSON.stringify(data, null, 2), 'utf8');
      fs.renameSync(temporaryFile, file);
      return true;
    } catch (e) {
      console.error(`Error writing to ${file} (attempt ${attempt}/${retries}):`, e.message);
      
      // Limpiar archivo temporal
      try { fs.rmSync(temporaryFile, { force: true }); } catch (cleanupError) {}
      
      // Si es el último intento, retornar false
      if (attempt === retries) {
        console.error(`Failed to write ${file} after ${retries} attempts`);
        return false;
      }
      
      // Esperar con backoff exponencial antes de reintentar (non-blocking)
      const waitTime = delay * Math.pow(2, attempt - 1);
      console.log(`Retrying in ${waitTime}ms...`);
      await sleep(waitTime);
    }
  }
  return false;
}

function hasMeaningfulRecords(rows) {
  return Array.isArray(rows) && rows.some(row => row && typeof row === 'object' && Object.keys(row).length > 0);
}

function resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants) {
  const resolvedUsers = hasMeaningfulRecords(cloudUsers) || !hasMeaningfulRecords(localUsers)
    ? (Array.isArray(cloudUsers) ? cloudUsers : [])
    : (Array.isArray(localUsers) ? localUsers : []);

  const resolvedRestaurants = hasMeaningfulRecords(cloudRestaurants) || !hasMeaningfulRecords(localRestaurants)
    ? (Array.isArray(cloudRestaurants) ? cloudRestaurants : [])
    : (Array.isArray(localRestaurants) ? localRestaurants : []);

  return { users: resolvedUsers, restaurants: resolvedRestaurants };
}

function normalizeBusinessType(value) {
  const aliases = {
    restaurante: 'restaurant',
    perfumeria: 'perfumery',
    heladeria: 'restaurant',
    cafeteria: 'restaurant',
    evento: 'events',
    event: 'events',
    catering: 'events'
  };
  const normalized = aliases[value] || value;
  return ['restaurant', 'perfumery', 'events'].includes(normalized) ? normalized : 'restaurant';
}

/**
 * Ensures a restaurant always has a valid subscription object.
 * Falls back to a 7-day trial so new or migrated restaurants are never
 * locked out with status UNKNOWN.
 */
function normalizeSubscription(restaurant) {
  if (!restaurant) return restaurant;
  const sub = restaurant.subscription;
  if (!sub || typeof sub !== 'object') {
    restaurant.subscription = {
      status: 'trialing',
      plan: 'pro_monthly',
      provider: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      gracePeriodDaysRemaining: 7
    };
  } else {
    // Ensure plan and status are always present strings
    if (!sub.status) sub.status = 'trialing';
    if (!sub.plan) sub.plan = 'pro_monthly';
  }
  return restaurant;
}

function normalizeRestaurantBusinessType(restaurant) {
  if (!restaurant) return restaurant;
  if (restaurant.city === undefined) restaurant.city = '';
  if (restaurant.smartWeatherEnabled === undefined) restaurant.smartWeatherEnabled = false;
  if (restaurant.businessType === 'heladeria') {
    if (restaurant.allowIceCreamWizard === undefined) restaurant.allowIceCreamWizard = true;
  } else {
    restaurant.allowIceCreamWizard = false;
  }
  if (['perfumeria', 'perfumery'].includes(restaurant.businessType)) {
    if (restaurant.allowPerfumery === undefined) restaurant.allowPerfumery = true;
  } else {
    restaurant.allowPerfumery = false;
  }
  restaurant.businessType = normalizeBusinessType(restaurant.businessType);
  normalizeSubscription(restaurant);
  return restaurant;
}

function isExpectedSupabaseSchemaWarning(error) {
  const message = (error && (error.message || String(error))) || '';
  const normalized = message.toLowerCase();
  return (
    normalized.includes('schema cache') ||
    normalized.includes('could not find the') && normalized.includes('column') ||
    normalized.includes('column') && normalized.includes('does not exist') ||
    error?.code === '42703'
  );
}

/**
 * Returns the branches array for a restaurant.
 * Ensures the field always returns a valid array.
 */
function getRestaurantBranches(restaurant) {
  if (!restaurant) return [];
  if (!Array.isArray(restaurant.branches)) return [];
  return restaurant.branches.filter(b => b && b.id);
}

/**
 * Finds a specific branch by ID within a restaurant.
 */
function findRestaurantBranch(restaurant, branchId) {
  const branches = getRestaurantBranches(restaurant);
  return branches.find(b => b.id === branchId) || null;
}

// Supabase Cloud PostgreSQL Dual-Mode Adapter
let supabase = null;
const pendingSupabaseWrites = new Set();
let databaseReady = Promise.resolve({ ready: true, mode: 'json' });
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

// Estado del esquema cloud (sonda real por tabla vía PostgREST, service role).
// Se rellena durante `databaseReady` y se expone por db.getSchemaStatus() y
// /api/healthz, para que una tabla faltante sea visible y no una degradación
// silenciosa a memoria local. La migración vive en src/db/migrations/.
let cloudSchemaStatus = { probedAt: null, missing: [], present: [], details: [] };
const OPERATIONAL_CLOUD_TABLES = [
  'group_carts',
  'orders',
  'reviews',
  'customer_feedback',
  'audit_logs',
  'push_subscriptions',
  'telemetry_events'
];

/**
 * Sonda read-only (LIMIT 1) de las tablas cloud. Una relación inexistente
 * responde PGRST205; el resto de los errores también se reportan.
 */
async function probeCloudSchema(client) {
  const rows = await Promise.all(
    OPERATIONAL_CLOUD_TABLES.map(async (table) => {
      try {
        const { error } = await client.from(table).select('id').limit(1);
        if (!error) return { table, exists: true, note: '' };
        const code = String(error.code || '');
        return {
          table,
          exists: false,
          note: code === 'PGRST205' ? 'relation missing (PGRST205)' : `${code} ${error.message || ''}`
        };
      } catch (e) {
        return { table, exists: false, note: `probe error: ${e.message}` };
      }
    })
  );
  return {
    probedAt: new Date().toISOString(),
    missing: rows.filter(r => !r.exists).map(r => r.table),
    present: rows.filter(r => r.exists).map(r => r.table),
    details: rows
  };
}

function trackSupabaseWrite(operation, context) {
  let trackedWrite;
  trackedWrite = Promise.resolve(operation)
    .then(result => {
      if (result?.error) throw result.error;
    })
    .catch(error => {
      if (isExpectedSupabaseSchemaWarning(error)) return;
      console.warn(`[Supabase ${context}]`, error.message || String(error));
    })
    .finally(() => pendingSupabaseWrites.delete(trackedWrite));
  pendingSupabaseWrites.add(trackedWrite);
  return trackedWrite;
}

if (process.env.SUPABASE_URL && supabaseKey) {
  try {
    const { createClient } = require('@supabase/supabase-js');
    supabase = createClient(
      process.env.SUPABASE_URL,
      supabaseKey,
      { auth: { persistSession: false } }
    );
    console.log('⚡ [DB] Conectado a Cloud Supabase (PostgreSQL)');

    databaseReady = (async () => {
      try {
        const [usersResult, restaurantsResult] = await Promise.all([
          supabase.from('users').select('*'),
          supabase.from('restaurants').select('*')
        ]);
        if (usersResult.error) throw usersResult.error;
        if (restaurantsResult.error) throw restaurantsResult.error;

        const cloudUsers = (usersResult.data || []).map(user => ({
          ...user,
          createdAt: user.createdAt || user.created_at,
          updatedAt: user.updatedAt || user.updated_at
        }));
        const cloudRestaurants = (restaurantsResult.data || []).map(r => {
          const profile = r.profile && typeof r.profile === 'object' ? r.profile : {};
          return {
            ...profile,
            id: r.id,
            userId: r.user_id,
            slug: r.slug,
            name: r.name || profile.name,
            bizName: r.biz_name || profile.bizName,
            slogan: r.slogan || profile.slogan,
            currency: r.currency || profile.currency,
            phone: r.phone || profile.phone,
            city: r.city || profile.city || '',
            smartWeatherEnabled: Boolean(r.smart_weather_enabled),
            theme: r.theme || profile.theme,
            logoUrl: r.logo_url || profile.logoUrl,
            bannerUrl: r.banner_url || profile.bannerUrl || null,
            businessType: normalizeBusinessType(r.business_type || profile.businessType),
            layout: r.layout || profile.layout || 'classic',
            wifi: r.wifi || profile.wifi,
            categories: r.categories || profile.categories || [],
            dishes: r.dishes || profile.dishes || [],
            modifierGroups: r.modifier_groups || profile.modifierGroups || [],
            deliveryZones: r.delivery_zones || profile.deliveryZones || [],
            branches: r.branches || profile.branches || [],
            subscription: r.subscription || profile.subscription,
            createdAt: r.created_at || profile.createdAt,
            updatedAt: r.updated_at || profile.updatedAt
          };
        }).map(normalizeRestaurantBusinessType);

        const localUsers = readJson(USERS_FILE, []);
        const localRestaurants = readJson(RESTAURANTS_FILE, []);
        const hydrated = resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants);

        if (cloudUsers.length === 0 && localUsers.length > 0) {
          console.warn('[DB] Snapshot de Supabase vacío para usuarios; conservando datos locales válidos.');
        }
        if (cloudRestaurants.length === 0 && localRestaurants.length > 0) {
          console.warn('[DB] Snapshot de Supabase vacío para restaurantes; conservando datos locales válidos.');
        }

        if (!await writeJson(USERS_FILE, hydrated.users) || !await writeJson(RESTAURANTS_FILE, hydrated.restaurants)) {
          throw new Error('No se pudo hidratar el snapshot local desde Supabase.');
        }

        // Sonda del esquema operacional (7 tablas realtime/operaciones).
        // Grupal/Realtime, pedidos, reseñas, feedback, auditoría, push y
        // telemetría: si alguna falta, se reporta en logs y healthz.
        try {
          cloudSchemaStatus = await probeCloudSchema(supabase);
          if (cloudSchemaStatus.missing.length > 0) {
            console.warn(`⚠️ [DB] Tablas cloud que faltan (${cloudSchemaStatus.missing.length}): ${cloudSchemaStatus.missing.join(', ')}`);
            console.warn('   Aplicá src/db/migrations/001_realtime_operations_tables.sql en el SQL Editor de Supabase');
            console.warn('   (o revisá el inventario con "npm run db:check").');
          } else {
            console.log(`✅ [DB] Esquema cloud completo (${OPERATIONAL_CLOUD_TABLES.length} tablas operacionales presentes).`);
          }
        } catch (probeErr) {
          console.warn('⚠️ [DB] No se pudo sondear el esquema cloud:', probeErr.message);
        }

        return { ready: true, mode: 'supabase', schema: { missing: cloudSchemaStatus.missing, present: cloudSchemaStatus.present } };
      } catch (err) {
        console.warn('⚠️ [DB] Aviso en sincronización inicial con Supabase:', err.message);
        return {
          ready: process.env.NODE_ENV !== 'production',
          mode: 'json-fallback',
          error: err.message
        };
      }
    })();
  } catch (err) {
    console.warn('⚠️ [DB] No se pudo conectar a Supabase, utilizando archivos JSON locales:', err.message);
    databaseReady = Promise.resolve({ ready: process.env.NODE_ENV !== 'production', mode: 'json-fallback', error: err.message });
  }
} else {
  console.log('📁 [DB] Modo Local: Almacenamiento JSON activo');
  if (IS_VERCEL && process.env.NODE_ENV === 'production') {
    databaseReady = Promise.resolve({
      ready: false,
      mode: 'unconfigured',
      error: 'Supabase server credentials are required for Vercel production.'
    });
  }
}

const db = {
  ready: databaseReady,
  async flushCloudWrites() {
    while (pendingSupabaseWrites.size) {
      await Promise.all([...pendingSupabaseWrites]);
    }
  },

  // Users
  findUserByEmail(email) {
    const users = readJson(USERS_FILE, []);
    return users.find(u => u.email.toLowerCase() === (email || '').toLowerCase()) || null;
  },
  findUserById(id) {
    const users = readJson(USERS_FILE, []);
    return users.find(u => u.id === id) || null;
  },
  async createUser(userData) {
    const users = readJson(USERS_FILE, []);
    const id = 'usr_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
    const newUser = { id, createdAt: new Date().toISOString(), ...userData };
    users.push(newUser);
    await writeJson(USERS_FILE, users);

    // Sync to Supabase in background if connected
    if (supabase) {
      trackSupabaseWrite(supabase.from('users').insert([{
        id: newUser.id,
        email: newUser.email,
        password: newUser.password,
        name: newUser.name,
        email_confirmed_at: newUser.email_confirmed_at || null,
        created_at: newUser.createdAt
      }]), 'Insert User');
    }
    return newUser;
  },
  async updateUserPassword(userId, newHashedPassword) {
    const users = readJson(USERS_FILE, []);
    const user = users.find(u => u.id === userId);
    if (!user) return null;
    user.password = newHashedPassword;
    user.updatedAt = new Date().toISOString();
    await writeJson(USERS_FILE, users);

    if (supabase) {
      trackSupabaseWrite(supabase.from('users').update({
        password: newHashedPassword,
        updated_at: user.updatedAt
      }).eq('id', userId), 'Update Password');
    }
    return user;
  },

  // Password Recovery Tokens (Single-use with JTI & Expiry)
  async savePasswordResetToken(userId, jti, expiresAt) {
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
    await writeJson(RESET_TOKENS_FILE, tokens);
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
  async invalidateResetToken(jti) {
    const tokens = readJson(RESET_TOKENS_FILE, []);
    const record = tokens.find(t => t.jti === jti);
    if (record) {
      record.used = true;
      record.usedAt = new Date().toISOString();
      await writeJson(RESET_TOKENS_FILE, tokens);
      return true;
    }
    return false;
  },

  // Restaurants & Menus
  findRestaurantBySlug(slug) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return normalizeRestaurantBusinessType(rests.find(r => (r.slug || '').toLowerCase() === (slug || '').toLowerCase()) || null);
  },
  findRestaurantByUserId(userId) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return normalizeRestaurantBusinessType(rests.find(r => r.userId === userId) || null);
  },
  findRestaurantById(id) {
    const rests = readJson(RESTAURANTS_FILE, []);
    return normalizeRestaurantBusinessType(rests.find(r => r.id === id) || null);
  },
  async saveRestaurant(userId, data) {
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
      normalizeRestaurantBusinessType(rest);
      rests.push(rest);
    } else {
      Object.assign(rest, data);
      normalizeRestaurantBusinessType(rest);
      rest.updatedAt = new Date().toISOString();
    }
    await writeJson(RESTAURANTS_FILE, rests);

    // Sync to Supabase in background if connected
    if (supabase) {
      trackSupabaseWrite(supabase.from('restaurants').upsert([{
        id: rest.id,
        user_id: rest.userId,
        slug: rest.slug,
        name: rest.name || rest.bizName,
        biz_name: rest.bizName || rest.name,
        slogan: rest.slogan,
        currency: rest.currency,
        phone: rest.phone,
        city: rest.city || '',
        smart_weather_enabled: Boolean(rest.smartWeatherEnabled),
        theme: rest.theme,
        logo_url: rest.logoUrl,
        banner_url: rest.bannerUrl || null,
        business_type: rest.businessType,
        layout: rest.layout || 'classic',
        wifi: rest.wifi,
        categories: rest.categories,
        dishes: rest.dishes,
        modifier_groups: rest.modifierGroups || [],
        delivery_zones: rest.deliveryZones,
        branches: rest.branches || [],
        subscription: rest.subscription,
        profile: rest,
        created_at: rest.createdAt,
        updated_at: new Date().toISOString()
      }], { onConflict: 'id' }), 'Save Restaurant');
    }
    return rest;
  },

  /**
   * Granular branch operations: add, update, delete single branch by id or slug
   * @param {string} restaurantId
   * @param {object} opts
   * @param {string} opts.operation - 'add' | 'update' | 'delete'
   * @param {object} opts.branch - branch data (required for add/update)
   * @param {string} opts.branchId - branch id (required for update/delete)
   * @param {string} opts.branchSlug - branch slug (alternative to branchId for update/delete)
   * @returns {object} { success: true, restaurant, branch, action }
   */
  async updateBranches(restaurantId, { operation, branch, branchId, branchSlug }) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return { success: false, error: 'Restaurante no encontrado' };

    // Initialize branches array if not present
    if (!Array.isArray(rest.branches)) rest.branches = [];

    // Normalize overridePrices to Record<dishId, number>: the public menu maps
    // `dish.price = overridePrices[dishId]`, so an object shape ({price: 6})
    // would leak into the frontend and break price formatting. Accept only
    // numbers (or {price: number} for backwards compat) and drop NaN.
    const normalizeOverridePrices = (overrides) => {
      if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return {};
      const clean = {};
      for (const [dishId, value] of Object.entries(overrides)) {
        if (!dishId || typeof dishId !== 'string') continue;
        let num = value;
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          num = value.price ?? value.value ?? value.precio;
        }
        const parsed = Number(num);
        if (Number.isFinite(parsed)) clean[dishId] = parsed;
      }
      return clean;
    };

    // Helper to find branch index by id or slug
    const findBranchIndex = (id, slug) => {
      return rest.branches.findIndex(b =>
        (id && b.id === id) || (slug && b.slug === slug)
      );
    };

    // Helper to generate unique slug within this restaurant's branches
    const generateUniqueSlug = (baseSlug, excludeIndex = -1) => {
      let slug = (baseSlug || 'sucursal')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '-')
        .replace(/-+/g, '-')
        .slice(0, 30);
      let uniqueSlug = slug;
      let counter = 1;
      while (rest.branches.some((b, i) => i !== excludeIndex && b.slug === uniqueSlug)) {
        uniqueSlug = `${slug}-${counter}`;
        counter++;
      }
      return uniqueSlug;
    };

    let resultBranch = null;
    let action = '';

    switch (operation) {
      case 'add': {
        if (!branch || !branch.name) {
          return { success: false, error: 'Nombre de sucursal requerido' };
        }
        const newBranch = {
          id: 'br_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
          name: String(branch.name).slice(0, 80),
          slug: generateUniqueSlug(branch.slug || branch.name),
          phone: branch.phone ? String(branch.phone).replace(/[^0-9+]/g, '').slice(0, 20) : '',
          address: branch.address ? String(branch.address).slice(0, 200) : '',
          overridePrices: normalizeOverridePrices(branch.overridePrices),
          customDishes: Array.isArray(branch.customDishes) ? branch.customDishes.slice(0, 50) : [],
          createdAt: new Date().toISOString()
        };
        rest.branches.push(newBranch);
        resultBranch = newBranch;
        action = 'added';
        break;
      }

      case 'update': {
        const idx = findBranchIndex(branchId, branchSlug);
        if (idx === -1) {
          return { success: false, error: 'Sucursal no encontrada' };
        }
        // Protección real de la sucursal principal (index 0): impedir cambios
        // de name/slug que romperían la jerarquía, QR y URLs del restaurante.
        if (idx === 0) {
          if (branch.name && branch.name !== rest.branches[idx].name) {
            return {
              success: false,
              error: 'No se puede cambiar el nombre de la sucursal principal. Editá el nombre desde la sección Perfil del restaurante.'
            };
          }
          if (branch.slug && branch.slug !== rest.branches[idx].slug) {
            return {
              success: false,
              error: 'No se puede cambiar el slug de la sucursal principal (rompería sus URLs y QR).'
            };
          }
        }
        const existing = rest.branches[idx];
        const updated = { ...existing };
        if (branch.name) updated.name = String(branch.name).slice(0, 80);
        if (branch.slug) updated.slug = generateUniqueSlug(branch.slug, idx);
        if (branch.phone !== undefined) updated.phone = branch.phone ? String(branch.phone).replace(/[^0-9+]/g, '').slice(0, 20) : '';
        if (branch.address !== undefined) updated.address = branch.address ? String(branch.address).slice(0, 200) : '';
        if (branch.overridePrices && typeof branch.overridePrices === 'object') updated.overridePrices = normalizeOverridePrices(branch.overridePrices);
        if (Array.isArray(branch.customDishes)) updated.customDishes = branch.customDishes.slice(0, 50);
        updated.updatedAt = new Date().toISOString();
        rest.branches[idx] = updated;
        resultBranch = updated;
        action = 'updated';
        break;
      }

      case 'delete': {
        const idx = findBranchIndex(branchId, branchSlug);
        if (idx === -1) {
          return { success: false, error: 'Sucursal no encontrada' };
        }
        // Prevent deletion of principal branch (index 0)
        if (idx === 0) {
          return { success: false, error: 'No se puede eliminar la sucursal principal' };
        }
        const deleted = rest.branches.splice(idx, 1)[0];
        resultBranch = deleted;
        action = 'deleted';
        break;
      }

      default:
        return { success: false, error: 'Operación inválida: use add, update o delete' };
    }

    // Persist to local JSON
    rest.updatedAt = new Date().toISOString();
    await writeJson(RESTAURANTS_FILE, rests);

    // Sync to Supabase
    if (supabase) {
      trackSupabaseWrite(supabase.from('restaurants').update({
        branches: rest.branches,
        profile: rest,
        updated_at: new Date().toISOString()
      }).eq('id', restaurantId), 'Update Branches');
    }

    return { success: true, restaurant: rest, branch: resultBranch, action };
  },

  // Subscriptions
  async updateSubscription(restaurantId, subData) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return null;
    rest.subscription = { ...rest.subscription, ...subData, updatedAt: new Date().toISOString() };
    await writeJson(RESTAURANTS_FILE, rests);

    // Sync to Supabase in background if connected
    if (supabase) {
      trackSupabaseWrite(supabase.from('restaurants').update({
        subscription: rest.subscription,
        profile: rest,
        updated_at: new Date().toISOString()
      }).eq('id', restaurantId), 'Update Subscription');
    }
    return rest.subscription;
  },

  // Webhooks idempotency (prevent duplicate billing actions)
  hasProcessedWebhook(provider, eventId) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    return hooks.some(h => h.provider === provider && h.eventId === eventId);
  },
  async markWebhookProcessed(provider, eventId, eventType, data = {}) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    hooks.push({
      provider,
      eventId,
      eventType,
      receivedAt: new Date().toISOString(),
      data
    });
    if (hooks.length > 1000) hooks.shift();
    await writeJson(WEBHOOKS_FILE, hooks);

    // Sync to Supabase in background if connected
    if (supabase) {
      trackSupabaseWrite(supabase.from('webhooks').upsert([{
        provider,
        event_id: eventId,
        event_type: eventType,
        data,
        received_at: new Date().toISOString()
      }], { onConflict: 'provider,event_id' }), 'Insert Webhook');
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
  async setRestaurantStatus(restaurantId, newStatus) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return null;
    if (!rest.subscription) rest.subscription = {};
    rest.subscription.status = newStatus;
    rest.subscription.updatedAt = new Date().toISOString();
    await writeJson(RESTAURANTS_FILE, rests);
    if (supabase) {
      trackSupabaseWrite(supabase.from('restaurants').update({
        subscription: rest.subscription,
        profile: rest,
        updated_at: rest.subscription.updatedAt
      }).eq('id', restaurantId), 'Update Restaurant Status');
    }
    return rest;
  },

  // Analytics tracking
  async recordAnalyticsEvent(slug, eventType) {
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
    await writeJson(RESTAURANTS_FILE, rests);
    if (supabase) {
      trackSupabaseWrite(supabase.from('restaurants').update({
        profile: rest,
        updated_at: rest.analytics.lastUpdated
      }).eq('id', rest.id), 'Update Analytics Snapshot');
    }
    return rest.analytics;
  },

  // Customer Reviews & Moderation
  async addReview(reviewData) {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    const newRev = {
      id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      status: 'pending', // 'pending' | 'approved' | 'rejected'
      ...reviewData
    };
    reviews.push(newRev);
    await writeJson(path.join(DATA_DIR, 'reviews.json'), reviews);
    return newRev;
  },
  getAllReviews() {
    return readJson(path.join(DATA_DIR, 'reviews.json'), []);
  },
  getApprovedReviews() {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    return reviews.filter(r => r.status === 'approved');
  },
  async updateReviewStatus(id, status) {
    const reviews = readJson(path.join(DATA_DIR, 'reviews.json'), []);
    const rev = reviews.find(r => r.id === id);
    if (!rev) return null;
    rev.status = status;
    rev.moderatedAt = new Date().toISOString();
    await writeJson(path.join(DATA_DIR, 'reviews.json'), reviews);
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
  async updateSettings(newSettings) {
    const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
    const current = this.getSettings();
    const updated = { ...current, ...newSettings };
    await writeJson(SETTINGS_FILE, updated);
    return updated;
  },
  // Customer Private Feedback (Smart Google Reviews filter)
  async addFeedback(feedbackData) {
    const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
    const all = readJson(FEEDBACK_FILE, []);
    const newFb = {
      id: 'fb_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      createdAt: new Date().toISOString(),
      ...feedbackData
    };
    all.push(newFb);
    await writeJson(FEEDBACK_FILE, all);
    return newFb;
  },
  getFeedbackByRestaurantId(restaurantId) {
    const FEEDBACK_FILE = path.join(DATA_DIR, 'feedback.json');
    const all = readJson(FEEDBACK_FILE, []);
    return all.filter(f => f.restaurantId === restaurantId);
  },
  getRestaurantBranches(restaurant) {
    if (!restaurant) return [];
    if (!Array.isArray(restaurant.branches)) return [];
    return restaurant.branches.filter(b => b && b.id);
  },
  findRestaurantBranch(restaurant, branchId) {
    const branches = this.getRestaurantBranches(restaurant);
    return branches.find(b => b.id === branchId) || null;
  },
  resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants) {
    return resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants);
  },
  /**
   * Estado del esquema cloud (sonda real con service role, rellenada en el
   * arranque). Devuelve { probedAt, missing, present, details } o el objeto
   * vacío inicial si el modo es JSON local.
   */
  getSchemaStatus() {
    return cloudSchemaStatus;
  }
};

module.exports = db;
