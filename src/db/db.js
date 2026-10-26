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
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

function readJson(file, def = []) {
  if (!fs.existsSync(file)) return def;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return def; }
}

// Cache L1 en memoria para restaurantes (el JSON se parseaba entero + .find()
// lineal en CADA request: tenantGuard, SSR /m/*, analytics...). Se revalida por
// mtime+size del archivo, así que escrituras directas, snapshot/restore de tests
// y writes del propio proceso siempre se ven. Toda escritura vía writeJson al
// archivo de restaurantes invalida explícitamente (cubre mismo-ms-mismo-size).
let _restCache = { key: '', rows: null };
function _restCacheKey() {
  try {
    const st = fs.statSync(RESTAURANTS_FILE);
    return `${st.mtimeMs}:${st.size}`;
  } catch (e) { return `missing:${Date.now()}`; }
}
function readRestaurants() {
  const key = _restCacheKey();
  if (_restCache.rows && _restCache.key === key) return _restCache.rows;
  const rows = readJson(RESTAURANTS_FILE, []);
  _restCache = { key, rows };
  return rows;
}

// ── Caché de hydratación lazy (por slug / userId / id) ──────────────────────
// En un Cold Start serverless el archivo restaurants.json está vacío.
// En lugar de descargar toda la tabla al boot, cada lookup consulta Supabase
// de forma puntual la primera vez y persiste el resultado en el JSON local.
// Las siguientes llamadas síncronas (findRestaurantBySlug, etc.) lo encuentran.
let _lazyCache = new Map(); // slug|userId|id → true (evita doble fetch por key)

/** Normaliza una fila de Supabase al mismo shape que usa el boot. */
function _normalizeCloudRestaurantRow(r) {
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
}

/**
 * Descarga UN restaurante de Supabase (por slug, userId o id) y lo mezcla en
 * el JSON local. Best-effort: nunca lanza, el fallo se logea silencioso.
 * @param {'slug'|'userId'|'id'} field  Campo de búsqueda.
 * @param {string} value                Valor a buscar.
 */
async function _lazyHydrateRestaurant(field, value) {
  if (!supabase || !value) return;
  const cacheKey = `${field}:${value}`;
  if (_lazyCache.has(cacheKey)) return; // ya lo intentamos
  _lazyCache.set(cacheKey, true);

  const colMap = { slug: 'slug', userId: 'user_id', id: 'id' };
  const col = colMap[field];
  if (!col) return;

  try {
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq(col, value)
      .limit(1)
      .maybeSingle();
    if (error || !data) return;

    const normalized = normalizeRestaurantBusinessType(_normalizeCloudRestaurantRow(data));
    const existing = readJson(RESTAURANTS_FILE, []);
    const idx = existing.findIndex(r => r.id === normalized.id);
    if (idx === -1) {
      existing.push(normalized);
    } else {
      // Cloud gana solo si es más nuevo
      if (tsOf(normalized.updatedAt || normalized.createdAt) >
          tsOf(existing[idx].updatedAt || existing[idx].createdAt)) {
        existing[idx] = normalized;
      }
    }
    await writeJson(RESTAURANTS_FILE, existing);
  } catch (e) {
    // best-effort: el JSON local puede quedar incompleto pero nunca rompe
    console.warn(`[DB lazy] No se pudo hidratar ${field}=${value}:`, e.message);
  }
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
      if (file === RESTAURANTS_FILE) _restCache = { key: '', rows: null };
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

// Compara instantes ISO (null/inválido = -infinito: siempre pierde).
function tsOf(value) {
  const t = new Date(value || 0).getTime();
  return Number.isFinite(t) ? t : -1;
}

/**
 * Fusión cloud ↔ local por id (last-writer-wins por updatedAt, empate → local).
 * NUNCA clobbera: antes, si la nube tenía filas "con sentido", se DESCARTABA
 * todo lo local — incluyendo filas creadas hace milisegundos por el request en
 * curso (la hidratación corre en background al boot mientras los handlers ya
 * escriben) → 401 USER_NOT_FOUND fantasma en tests y, en prod, pérdida de
 * altas concurrentes al arranque. La unión solo suma; el conflicto se resuelve
 * por fecha, nunca por borrado.
 */
function mergeById(localRows, cloudRows) {
  const byId = new Map();
  for (const row of (Array.isArray(cloudRows) ? cloudRows : [])) {
    if (row && typeof row === 'object' && row.id) byId.set(String(row.id), row);
  }
  for (const row of (Array.isArray(localRows) ? localRows : [])) {
    if (!row || typeof row !== 'object' || !row.id) continue;
    const key = String(row.id);
    const prev = byId.get(key);
    if (!prev || tsOf(row.updatedAt || row.createdAt) >= tsOf(prev.updatedAt || prev.createdAt)) {
      byId.set(key, row);
    }
  }
  return [...byId.values()];
}

function resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants) {
  const users = mergeById(localUsers, cloudUsers);
  const restaurants = mergeById(localRestaurants, cloudRestaurants).map(normalizeRestaurantBusinessType);
  return { users, restaurants };
}

function normalizeBusinessType(value) {
  const aliases = {
    restaurante: 'restaurant',
    perfumeria: 'perfumery',
    heladeria: 'heladeria',
    cafeteria: 'restaurant',
    evento: 'events',
    event: 'events',
    catering: 'events'
  };
  const normalized = aliases[value] || value;
  return ['restaurant', 'heladeria', 'perfumery', 'events'].includes(normalized) ? normalized : 'restaurant';
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

  // Heladería es un rubro de primera clase (no se colapsa a 'restaurant').
  // Compatibilidad: registros antiguos guardaron businessType='restaurant' junto
  // con allowIceCreamWizard=true; esa bandera explícita promueve el rubro de vuelta.
  if (restaurant.businessType !== 'heladeria' && restaurant.allowIceCreamWizard === true) {
    restaurant.businessType = 'heladeria';
  }
  // Sólo se define por defecto cuando la bandera está ausente: un `false` explícito
  // del dueño (o un `true` heredado) nunca se pisa al leer.
  if (restaurant.allowIceCreamWizard === undefined) {
    restaurant.allowIceCreamWizard = restaurant.businessType === 'heladeria';
  }
  if (restaurant.allowPerfumery === undefined) {
    restaurant.allowPerfumery = ['perfumeria', 'perfumery'].includes(restaurant.businessType);
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
// Hook de invalidación de caché ante cambios de suscripción (lo registra la
// capa HTTP al boot; db.js no puede requerir api/middleware por el guard D).
// Se dispara en updateSubscription (webhooks, cron, admin, cancel): un flip
// active↔past_due cambia el menú público, así que invalida igual que /save.
let subscriptionChangeHook = null;
// Mutex en proceso para addOrder (read-modify-write sin transacción).
let orderWriteLock = Promise.resolve();
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
      if (isExpectedSupabaseSchemaWarning(error)) {
        // Antes esto era SILENCIO total: así se perdió que la nube rechazaba
        // TODOS los inserts de users/restaurants (columna inexistente,
        // PGRST204) y las tablas quedaron vacías sin que nadie lo notara.
        // Ahora se loguea una vez por mensaje (sin spam) para que el drift
        // de schema sea visible en logs/healthz en vez de invisible.
        warnOnce(`[Supabase schema drift] ${context}: ${error.message || String(error)}`);
        return;
      }
      console.warn(`[Supabase ${context}]`, error.message || String(error));
    })
    .finally(() => pendingSupabaseWrites.delete(trackedWrite));
  pendingSupabaseWrites.add(trackedWrite);
  return trackedWrite;
}

// Warn deduplicado por mensaje (un drift de schema genera un error por
// escritura; sin dedup inundaría el log en cada request).
const warnedSchemaDrifts = new Set();
function warnOnce(message) {
  if (warnedSchemaDrifts.has(message)) return;
  warnedSchemaDrifts.add(message);
  if (warnedSchemaDrifts.size > 200) {
    warnedSchemaDrifts.delete(warnedSchemaDrifts.keys().next().value);
  }
  console.warn(message);
}

// Extrae la columna de un PGRST204 ("Could not find the 'X' column...").
function parseUnknownColumn(message) {
  const m = String(message || '').match(/could not find the '([^']+)' column/i);
  return m ? m[1] : null;
}

function toCamelCase(col) {
  return String(col).replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

// Columnas que la nube ya rechazó (drift conocido): se quitan ANTES del
// primer intento para no pagar un roundtrip fallido en cada escritura.
const knownMissingColumns = {};

function stripKnownMissing(table, row) {
  const missing = knownMissingColumns[table];
  if (!missing || !missing.size) return row;
  const clean = { ...row };
  for (const col of missing) {
    delete clean[col];
    delete clean[toCamelCase(col)];
  }
  return clean;
}

// Escritura cloud tolerante a drift de schema: si PostgREST rechaza una
// columna inexistente (nube anterior al schema.sql), la quita y reintenta
// (máx 4 columnas). La escritura JAMÁS se pierde por una columna de más;
// lo quitado se loguea (dedup) para que la migración pendiente sea visible.
// `match` ({col: val}) usa UPDATE en vez de insert/upsert.
// Devuelve { ok, dropped[] } | { ok:false, error } | { ok:false, skipped }.
async function cloudWriteTolerant(table, rows, { onConflict, match } = {}) {
  if (!supabase) return { ok: false, skipped: true };
  const dropped = [];
  let current = rows.map((r) => stripKnownMissing(table, r));
  for (let attempt = 0; attempt < 5; attempt++) {
    let builder = supabase.from(table);
    if (match) {
      const [matchCol, matchVal] = Object.entries(match)[0];
      builder = builder.update(current[0]).eq(matchCol, matchVal);
    } else if (onConflict) {
      builder = builder.upsert(current, { onConflict });
    } else {
      builder = builder.insert(current);
    }
    const { error } = await builder;
    if (!error) {
      if (dropped.length) warnOnce(`[Supabase schema drift] ${table}: columnas quitadas [${dropped.join(', ')}] (aplicar migraciones pendientes)`);
      return { ok: true, dropped };
    }
    const col = parseUnknownColumn(error.message);
    if (!col) return { ok: false, error: error.message };
    dropped.push(col);
    if (!knownMissingColumns[table]) knownMissingColumns[table] = new Set();
    knownMissingColumns[table].add(col);
    current = current.map((r) => {
      const c = { ...r };
      delete c[col];
      delete c[toCamelCase(col)];
      return c;
    });
  }
  return { ok: false, error: 'column-drop retries exhausted' };
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
        // ── Boot lazy: solo hidratamos la tabla users ────────────────────────
        // La tabla restaurants puede tener miles de filas y crece con el SaaS.
        // Descargarla entera en cada Cold Start es el principal contribuidor al
        // tiempo de arranque en Vercel. Los restaurantes se hidratan on-demand
        // mediante _lazyHydrateRestaurant() la primera vez que se accede a uno
        // por slug/userId/id (ver findRestaurantBySlug et al. más abajo).
        const usersResult = await supabase.from('users').select('*');
        if (usersResult.error) throw usersResult.error;

        const cloudUsers = (usersResult.data || []).map(user => ({
          ...user,
          createdAt: user.createdAt || user.created_at,
          updatedAt: user.updatedAt || user.updated_at
        }));

        const localUsers = readJson(USERS_FILE, []);
        if (cloudUsers.length === 0 && localUsers.length > 0) {
          console.warn('[DB] Snapshot de Supabase vacío para usuarios; conservando datos locales válidos.');
        }

        // Re-lectura antes de escribir (ver comentario original).
        const freshUsers = readJson(USERS_FILE, []);
        const finalUsers = mergeById(freshUsers, cloudUsers);

        if (!await writeJson(USERS_FILE, finalUsers)) {
          throw new Error('No se pudo hidratar el snapshot local de usuarios desde Supabase.');
        }

        console.log(`✅ [DB] Usuarios hidratados (${finalUsers.length}). Restaurantes: carga diferida por slug/id.`);

        // Reparación outbox: pedidos que quedaron solo en local (insert cloud
        // fallido en caliente) se suben ahora. Best-effort, nunca rompe el boot.
        try {
          const repair = await db.repairCloudPendingOrders();
          if (repair && (repair.repaired > 0 || repair.remaining > 0)) {
            console.log(`[DB] Pedidos pendientes reparados: ${repair.repaired} subidos, ${repair.remaining} restantes.`);
          }
        } catch (e) {
          console.warn('[DB] Reparación de pedidos pendientes falló (best-effort):', e.message);
        }

        // Sonda del esquema operacional (7 tablas realtime/operaciones).
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

    // Sync to Supabase in background if connected (tolerante a drift: si la
    // nube es anterior al schema.sql, se quitan las columnas que rechace).
    if (supabase) {
      trackSupabaseWrite(
        cloudWriteTolerant('users', [{
          id: newUser.id,
          email: newUser.email,
          password: newUser.password,
          name: newUser.name,
          email_confirmed_at: newUser.email_confirmed_at || null,
          created_at: newUser.createdAt
        }]).then((r) => {
          if (!r.ok && !r.skipped) throw new Error(r.error || 'users insert failed');
          return r;
        }),
        'Insert User'
      );
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
    const rests = readRestaurants();
    const found = rests.find(r => (r.slug || '').toLowerCase() === (slug || '').toLowerCase()) || null;
    // Si no está localmente, disparar la carga lazy en background para el próximo request.
    // Fire-and-forget: esta función sigue siendo síncrona.
    if (!found && slug) _lazyHydrateRestaurant('slug', slug.toLowerCase()).catch(() => {});
    return normalizeRestaurantBusinessType(found);
  },
  findRestaurantByUserId(userId) {
    const rests = readRestaurants();
    const found = rests.find(r => r.userId === userId) || null;
    if (!found && userId) _lazyHydrateRestaurant('userId', userId).catch(() => {});
    return normalizeRestaurantBusinessType(found);
  },
  findRestaurantById(id) {
    const rests = readRestaurants();
    const found = rests.find(r => r.id === id) || null;
    if (!found && id) _lazyHydrateRestaurant('id', id).catch(() => {});
    return normalizeRestaurantBusinessType(found);
  },

  /**
   * Versión async de findRestaurantBySlug que ESPERA la hidratación lazy.
   * Úsala en handlers de alto impacto que pueden hacer await:
   * SSR /m/:slug, rutas de menú público, handler de eventos.
   * Garantiza que el restaurante esté en el JSON local ANTES del lookup.
   * @param {string} slug
   * @returns {Promise<object|null>}
   */
  async lazyLoadRestaurant(slug) {
    if (!slug) return null;
    await _lazyHydrateRestaurant('slug', (slug || '').toLowerCase());
    const rests = readRestaurants();
    return normalizeRestaurantBusinessType(
      rests.find(r => (r.slug || '').toLowerCase() === slug.toLowerCase()) || null
    );
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

    // Sync to Supabase in background if connected (tolerante a drift).
    if (supabase) {
      trackSupabaseWrite(
        cloudWriteTolerant('restaurants', [{
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
        }], { onConflict: 'id' }).then((r) => {
          if (!r.ok && !r.skipped) throw new Error(r.error || 'restaurants upsert failed');
          return r;
        }),
        'Save Restaurant'
      );
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
        // Llaves de prototipo: Object.assign posterior usaría [[Set]].
        if (dishId === '__proto__' || dishId === 'constructor' || dishId === 'prototype') continue;
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

    // Sync to Supabase in background if connected (tolerante a drift).
    if (supabase) {
      trackSupabaseWrite(
        cloudWriteTolerant('restaurants', [{
          subscription: rest.subscription,
          profile: rest,
          updated_at: new Date().toISOString()
        }], { match: { id: restaurantId } }).then((r) => {
          if (!r.ok && !r.skipped) throw new Error(r.error || 'subscription update failed');
          return r;
        }),
        'Update Subscription'
      );
    }
    // Hook de invalidación (lo registra la capa HTTP al boot): un flip de
    // suscripción por webhook/cron cambia lo que ve el comensal (menú
    // pausado ↔ online), así que la caché debe caer igual que en /save.
    // Fire-and-forget: nunca rompe la escritura.
    if (subscriptionChangeHook) {
      try {
        const out = subscriptionChangeHook({ restaurantId, slug: rest.slug });
        if (out && typeof out.catch === 'function') out.catch(() => {});
      } catch { /* best-effort */ }
    }
    return rest.subscription;
  },

  // Registra el hook de invalidación (una sola vez, al boot del server).
  onSubscriptionChange(fn) {
    if (typeof fn === 'function') subscriptionChangeHook = fn;
  },

  // Webhooks idempotency (prevent duplicate billing actions)
  hasProcessedWebhook(provider, eventId) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    return hooks.some(h => h.provider === provider && h.eventId === eventId);
  },
  // Devuelve el marcador guardado (incluye `data.response` si se persistió
  // una respuesta idempotente, como en PATCH /studio/branches).
  getProcessedWebhook(provider, eventId) {
    const hooks = readJson(WEBHOOKS_FILE, []);
    return hooks.find(h => h.provider === provider && h.eventId === eventId) || null;
  },
  async getProcessedWebhookAsync(provider, eventId) {
    const local = this.getProcessedWebhook(provider, eventId);
    if (local) return local;
    if (!supabase) return null;
    try {
      const { data } = await supabase
        .from('webhooks')
        .select('*')
        .eq('provider', provider)
        .eq('event_id', eventId)
        .limit(1);
      return Array.isArray(data) && data[0] ? data[0] : null;
    } catch (e) {
      return null;
    }
  },
  // Variante cross-instancia: el JSON local es efímero en serverless (/tmp),
  // así que ante un redelivery post-restart también se consulta Supabase.
  async hasProcessedWebhookAsync(provider, eventId) {
    if (this.hasProcessedWebhook(provider, eventId)) return true;
    if (!supabase) return false;
    try {
      const { data } = await supabase
        .from('webhooks')
        .select('id')
        .eq('provider', provider)
        .eq('event_id', eventId)
        .limit(1);
      return Array.isArray(data) && data.length > 0;
    } catch (e) {
      return false;
    }
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
    return readRestaurants();
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

  // Snapshot de contadores legacy (restaurant.analytics). La FUENTE DE VERDAD
  // es la telemetría (telemetry_events); esto solo escribe la proyección derivada
  // que leen Studio y GET /api/analytics/:slug. Nunca incrementa a mano.
  async setAnalyticsSnapshot(slug, counters) {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.slug === slug);
    if (!rest) return null;
    rest.analytics = {
      visits: 0,
      orders: 0,
      reservations: 0,
      waiterCalls: 0,
      ...(counters || {})
    };
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

  // Orders — espejo local para desarrollo/offline. En modo cloud la fuente de
  // verdad sigue siendo la tabla `orders` de Supabase (escriben el router y el
  // seguimiento); esto permite que el seguimiento funcione también sin cloud.
  // Mutex en proceso: addOrder es read-modify-write (lee todo, unshift,
  // escribe todo) y dos POST / concurrentes intercalados pisaban un pedido.
  // writeJson ya es atómico por archivo, pero eso no hace transaccional el
  // read-modify-write. (Cross-instancia lo cubre la nube con ids únicos.)
  async addOrder(order) {
    if (!order || !order.id) return null;
    const run = async () => {
      const orders = readJson(ORDERS_FILE, []);
      orders.unshift(order);
      await writeJson(ORDERS_FILE, orders);
      return order;
    };
    orderWriteLock = orderWriteLock.then(run, run);
    return orderWriteLock;
  },
  getOrders() {
    return readJson(ORDERS_FILE, []);
  },
  findOrderById(id) {
    if (!id) return null;
    return readJson(ORDERS_FILE, []).find(o => o.id === id) || null;
  },
  async updateOrderStatus(id, status, updatedAt) {
    const orders = readJson(ORDERS_FILE, []);
    const order = orders.find(o => o.id === id);
    if (!order) return null;
    order.status = status;
    order.status_updated_at = updatedAt || new Date().toISOString();
    await writeJson(ORDERS_FILE, orders);
    return order;
  },

  // F3 stock diario ("Agotados con memoria"): filas MÍNIMAS de pedidos dentro
  // de la ventana ISO del día local del dueño (la calcula
  // api/utils/dailyStockTracker.getDailyStockWindow, misma frontera que F1).
  // Unión nube ∪ espejo local por id (patrón El Cierre): un pedido cuyo
  // dual-write fue rechazado en cloud NO desaparece del conteo, y si la nube
  // con drift cae, el espejo sostiene el agregado (el menú nunca rompe).
  async getSoldQtyForDay(restaurantId, startIso, endIso) {
    if (!restaurantId || !startIso || !endIso) return [];
    let cloudRows = [];
    try {
      if (supabase) {
        const { data, error } = await supabase
          .from('orders')
          .select('id, items_snapshot, status, created_at')
          .eq('restaurant_id', restaurantId)
          .gte('created_at', startIso)
          .lt('created_at', endIso);
        if (error) throw error;
        cloudRows = Array.isArray(data) ? data : [];
      }
    } catch (err) {
      console.warn('[DB] getSoldQtyForDay cloud no disponible (espejo local:', (err && err.message) || err, ')');
    }
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    const byId = new Map();
    for (const row of cloudRows) {
      if (row && row.id) byId.set(String(row.id), row);
    }
    for (const localRow of readJson(ORDERS_FILE, [])) {
      if (!localRow) continue;
      const rid = localRow.restaurant_id || localRow.restaurantId;
      if (rid !== restaurantId) continue;
      const ts = Date.parse(localRow.created_at || localRow.createdAt || '');
      if (Number.isNaN(ts)) continue;
      if (ts >= startMs && ts < endMs && localRow.id && !byId.has(String(localRow.id))) {
        byId.set(String(localRow.id), localRow);
      }
    }
    return [...byId.values()];
  },

  // F7 "El Tiempo Real": filas de pedidos dentro de la ventana (ISO) con los
  // timestamps que miden la preparación REAL (created_at → status_updated_at).
  // Unión nube ∪ espejo local por id (patrón El Cierre/F3): un pedido cuyo
  // dual-write fue rechazado en cloud no desaparece de la muestra, y si la
  // nube cae el espejo sostiene el cálculo (la carta nunca rompe).
  // Degradación honesta: si `status_updated_at` todavía no existe en cloud
  // (migración 004 sin aplicar), reintenta sin esa columna — el espejo local
  // sigue aportando sus filas y sin timestamps la estimación es `null`.
  async getOrderPrepRows(restaurantId, startIso, endIso) {
    if (!restaurantId || !startIso || !endIso) return [];
    let cloudRows = [];
    if (supabase) {
      const baseColumns = 'id, status, created_at';
      const attempt = async (columns) => supabase
        .from('orders')
        .select(columns)
        .eq('restaurant_id', restaurantId)
        .gte('created_at', startIso)
        .lt('created_at', endIso)
        .limit(1000);
      try {
        let { data, error } = await attempt(`${baseColumns}, status_updated_at`);
        if (error && /status_updated_at/i.test(error.message || '')) {
          const retry = await attempt(baseColumns);
          data = retry.data;
          error = retry.error;
        }
        if (error) throw error;
        cloudRows = Array.isArray(data) ? data : [];
      } catch (err) {
        console.warn('[DB] getOrderPrepRows cloud no disponible (espejo local:', (err && err.message) || err, ')');
      }
    }
    const startMs = Date.parse(startIso);
    const endMs = Date.parse(endIso);
    const byId = new Map();
    // Espejo local primero; la nube es canónica pero NO puede borrar el
    // timestamp que el espejo sí tiene (dual-write asimétrico: local OK,
    // cloud rechazado). Sin esto, un pedido medido en local se perdería.
    for (const localRow of readJson(ORDERS_FILE, [])) {
      if (!localRow) continue;
      const rid = localRow.restaurant_id || localRow.restaurantId;
      if (rid !== restaurantId) continue;
      const ts = Date.parse(localRow.created_at || localRow.createdAt || '');
      if (Number.isNaN(ts)) continue;
      if (ts >= startMs && ts < endMs && localRow.id) {
        byId.set(String(localRow.id), localRow);
      }
    }
    for (const row of cloudRows) {
      if (!row || !row.id) continue;
      const key = String(row.id);
      const local = byId.get(key);
      if (!local) {
        byId.set(key, row);
        continue;
      }
      const cloudFinished = row.status_updated_at !== undefined ? row.status_updated_at : row.statusUpdatedAt;
      const localFinished = local.status_updated_at !== undefined ? local.status_updated_at : local.statusUpdatedAt;
      byId.set(key, (!cloudFinished && localFinished) ? { ...row, status_updated_at: localFinished } : row);
    }
    return [...byId.values()];
  },

  // Mapeo canónico local → fila cloud de `orders` (misma forma que usa
  // POST /api/orders; fuente única para no diverger).
  toCloudOrder(orderRecord) {
    return {
      id: orderRecord.id,
      restaurant_id: orderRecord.restaurant_id,
      table_number: orderRecord.table_number,
      items_snapshot: orderRecord.items_snapshot,
      amount: orderRecord.amount,
      amount_in_cents: orderRecord.amount_in_cents,
      currency: orderRecord.currency,
      status: orderRecord.status,
      customer_name: orderRecord.customer_name,
      customer_phone: orderRecord.customer_phone,
      created_at: orderRecord.created_at
    };
  },

  // Insert cloud con reintento tolerante a drift (misma vía que el resto del
  // dual-write; reemplaza el fallback manual de `tip_amount`).
  // { ok:true } | { ok:false, error } | { ok:false, skipped:true } sin cliente.
  async insertCloudOrder(orderRecord) {
    if (!supabase) return { ok: false, skipped: true };
    try {
      // Coalesce a 0: la columna es NOT NULL DEFAULT 0 en la nube con la 005.
      // Insertar null explícito (tip ausente en pedidos viejos/sintéticos)
      // violaría el NOT NULL aunque el default cubriría la omisión. Si la nube
      // NO tiene la columna (005 sin aplicar), cloudWriteTolerant la quita.
      const tip = Number(orderRecord.tip_amount ?? orderRecord.tipAmount ?? 0) || 0;
      const res = await cloudWriteTolerant('orders', [{ ...this.toCloudOrder(orderRecord), tip_amount: tip }]);
      if (res.ok) return res;
      return { ok: false, error: res.error };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  },

  // Pedidos que quedaron SOLO en local porque el insert cloud falló (outbox
  // mínima). Se responden 201 igual (el comensal no debe sufrirlo), pero se
  // marcan para reparar y para que el dueño los vea igual.
  async markOrderCloudPending(id) {
    const orders = readJson(ORDERS_FILE, []);
    const order = orders.find(o => o.id === id);
    if (!order || order.cloudPending) return order || null;
    order.cloudPending = true;
    order.cloudPendingAt = new Date().toISOString();
    await writeJson(ORDERS_FILE, orders);
    return order;
  },
  async clearOrderCloudPending(id) {
    const orders = readJson(ORDERS_FILE, []);
    const order = orders.find(o => o.id === id);
    if (!order || !order.cloudPending) return order || null;
    delete order.cloudPending;
    delete order.cloudPendingAt;
    await writeJson(ORDERS_FILE, orders);
    return order;
  },
  getCloudPendingOrders() {
    return readJson(ORDERS_FILE, []).filter(o => o && o.cloudPending);
  },

  // Reparación al boot: sube los pendientes locales a la nube (best-effort,
  // nunca rompe el arranque). Cierra la divergencia local-only → cloud.
  async repairCloudPendingOrders() {
    if (!supabase) return { repaired: 0, remaining: this.getCloudPendingOrders().length };
    const pending = this.getCloudPendingOrders();
    let repaired = 0;
    for (const order of pending) {
      try {
        const res = await this.insertCloudOrder(order);
        if (res.ok) {
          await this.clearOrderCloudPending(order.id);
          repaired++;
        }
      } catch { /* best-effort: queda pendiente para el próximo boot */ }
    }
    return { repaired, remaining: this.getCloudPendingOrders().length };
  },

  // Global Settings (Pricing & Promotional Banner)
  getSettings() {
    const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
    const defaultSettings = {
      // Los precios reflejan los planes reales de src/billing/plans.json
      // (starter 9/79, pro 19/159) — la landing jamás debe prometer un precio
      // que el checkout no cobra.
      monthlyPrice: 9,
      annualPrice: 79,
      annualDiscountPercent: 27,
      // El descuento anual real es 27% (79 vs 9*12=108). Un banner de descuento
      // solo debe activarse cuando exista un precio promocional real en la pasarela.
      promoBannerEnabled: false,
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
   * Primitiva atómica de escritura JSON (temp-file + rename, retries con
   * backoff no-bloqueante). Expuesta para tests de la capa de datos.
   */
  writeJson(file, data, retries = 3, delay = 100) {
    return writeJson(file, data, retries, delay);
  },
  /**
   * Estado del esquema cloud (sonda real con service role, rellenada en el
   * arranque). Devuelve { probedAt, missing, present, details } o el objeto
   * vacío inicial si el modo es JSON local.
   */
  getSchemaStatus() {
    return cloudSchemaStatus;
  },
  /**
   * Derecho al olvido (RGPD / Ley 18.331 / Google Play): borra el usuario, su
   * restaurante y TODOS los datos asociados — local (JSON) y nube (Supabase,
   * best-effort: nunca rompe el flujo si la nube falla).
   *
   * No borra: la tabla `audit_logs` (registro de procesamiento propio) ni la
   * tabla `webhooks` (registro contable de pagos, requisito legal de facturación).
   * Tampoco toca `customer_profiles`/`loyalty_*`: son datos de los COMENSALES,
   * no del dueño que se da de baja (su borrado es otro derecho, del comensal).
   * Idempotente: si no existe nada, no falla.
   *
   * @param {string} userId - ID del dueño
   * @param {string|null} restaurantId - ID de su restaurante (si existe)
   * @returns {Promise<{usersRemoved: number}>}
   */
  async deleteRestaurantData(userId, restaurantId) {
    // Primero drena las escrituras pendientes a la nube: un upsert encolado
    // hace 1 s podría re-insertar el restaurante DESPUÉS de borrarlo.
    await this.flushCloudWrites();

    // ── Local JSON ──────────────────────────────────────────────────────────
    await writeJson(USERS_FILE, readJson(USERS_FILE, []).filter((u) => u.id !== userId));

    await writeJson(RESTAURANTS_FILE, readJson(RESTAURANTS_FILE, []).filter((r) => r.id !== restaurantId));

    const reviewsFile = path.join(DATA_DIR, 'reviews.json');
    await writeJson(
      reviewsFile,
      readJson(reviewsFile, []).filter((r) => r.restaurant_id !== restaurantId && r.restaurantId !== restaurantId)
    );

    const feedbackFile = path.join(DATA_DIR, 'feedback.json');
    await writeJson(
      feedbackFile,
      readJson(feedbackFile, []).filter((f) => f.restaurantId !== restaurantId)
    );

    const tokensFile = path.join(DATA_DIR, 'reset_tokens.json');
    await writeJson(
      tokensFile,
      readJson(tokensFile, []).filter((t) => t.userId !== userId && t.user_id !== userId)
    );

    const hooksFile = path.join(DATA_DIR, 'webhooks.json');
    await writeJson(
      hooksFile,
      readJson(hooksFile, []).filter(
        (h) => !h.data || (h.data.restaurant_id !== restaurantId && h.data.restaurantId !== restaurantId)
      )
    );

    const ordersFile = path.join(DATA_DIR, 'orders.json');
    await writeJson(
      ordersFile,
      readJson(ordersFile, []).filter((o) => o.restaurant_id !== restaurantId && o.restaurantId !== restaurantId)
    );

    // ── Supabase (best-effort; un fallo no debe impedir el derecho al olvido) ─
    if (supabase) {
      const deletes = [];
      if (restaurantId) {
        for (const table of [
          'orders',
          'reviews',
          'customer_feedback',
          'group_carts',
          'push_subscriptions',
          'telemetry_events',
          'notification_events'
        ]) {
          deletes.push(supabase.from(table).delete().eq('restaurant_id', restaurantId));
        }
        deletes.push(supabase.from('restaurants').delete().eq('id', restaurantId));
      }
      deletes.push(supabase.from('users').delete().eq('id', userId));
      await Promise.allSettled(deletes);
    }

    return { usersRemoved: 1 };
  }
};

module.exports = db;
