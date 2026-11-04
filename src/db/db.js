const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
// SCANGO_DATA_DIR permite aislar una instancia (tests de dos réplicas/cold
// start). En Vercel el default sigue siendo /tmp (efímero por instancia).
const DATA_DIR = process.env.SCANGO_DATA_DIR
  ? path.resolve(process.env.SCANGO_DATA_DIR)
  : IS_VERCEL
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
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');
const STAFF_SESSIONS_FILE = path.join(DATA_DIR, 'staff_sessions.json');

// ── Usuarios: tombstones, frescura y outbox (P0-2) ─────────────────────────
// El borrado de cuenta deja un TOMBSTONE sin PII en `users` (email
// `deleted+<id>@deleted.invalid`, password aleatorio, deleted:true). El dominio
// ES el marcador: no hace falta migración y un tombstone jamás puede loguearse
// (findUserByEmail/ById los devuelven como null). Además, un usuario borrado en
// OTRA réplica de Vercel no revive por la unión cloud↔local del boot.
const USER_TOMBSTONE_DOMAIN = 'deleted.invalid';
const USER_CLOUD_PENDING_TTL_MS = 60 * 60 * 1000; // 1 h para reparar un alta
const USER_CLOUD_ABSENCE_GRACE_MS = 10 * 60 * 1000; // margen de una ausencia cloud
const CLOUD_USERS_PAGE_SIZE = 1000; // límite real de PostgREST por request
const CLOUD_RESTAURANTS_PAGE_SIZE = 1000; // idem para el listado completo de locales
const ALL_RESTAURANTS_TTL_MS = 60 * 1000; // caché del listado cross-réplica

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
//
// El cache SOLO guarda hydrataciones EXITOSAS y por una ventana corta: antes se
// marcaba el intento ANTES del fetch, así un fallo transitorio de Supabase
// dejaba el local invisible para siempre en esa instancia (el Studio lo
// interpretaba como "usuario sin local" y ofrecía crear uno nuevo).
const LAZY_RESTAURANT_TTL_MS = 60 * 1000;
let _lazyCache = new Map(); // slug|userId|id → epoch ms de la última hydratación OK
const _lazyInflight = new Map(); // slug|userId|id → Promise (dedupe concurrente)

// ── Listado COMPLETO de restaurantes (crons, sitemap, Descubrir, Admin) ─────
// El hot path (menú público, tenantGuard) sigue hidratando UN local por slug /
// userId / id: bajar la tabla entera en cada request sería el costo de cold
// start que el boot lazy eliminó. Pero los consumidores que necesitan "TODOS
// los locales" (crons de dunning/El Cierre/nudges, sitemap, landings por
// ciudad, feed Descubrir, overview del admin, unicidad de slug del Studio) NO
// pueden leer solo el espejo local: en Vercel `data/` vive en /tmp, es efímero
// por instancia y arranca vacío en cada cold start. Leer únicamente el JSON
// hacía que los trials nunca vencieran (checked:0 en billing-dunning), que El
// Cierre no procesara nada y que el sitemap publicara locales por goteo (solo
// los que alguien visitó en esa réplica). `getAllRestaurantsAsync()` pagina la
// nube, la fusiona con el espejo (mergeById) y cachea ~60 s en proceso.
let _allRestaurantsCache = { at: 0, rows: null, inflight: null };

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
 * el JSON local. Lanza si la consulta falla: el caller decide si degrada o si
 * responde 503 (nunca se inventa "no existe" ante un error de infraestructura).
 * @param {'slug'|'userId'|'id'} field  Campo de búsqueda.
 * @param {string} value                Valor a buscar.
 * @returns {Promise<object|null>} restaurante normalizado o null si no existe.
 */
async function _fetchRestaurantFromCloud(field, value) {
  if (!supabase || !value) return null;
  const colMap = { slug: 'slug', userId: 'user_id', id: 'id' };
  const col = colMap[field];
  if (!col) return null;

  const { data, error } = await supabase
    .from('restaurants')
    .select('*')
    .eq(col, value)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message || `restaurants query failed (${field})`);
  if (!data) return null;

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
  return normalized;
}

/**
 * Hidratación lazy tolerante (fire-and-forget de los lookups síncronos).
 * Devuelve {ok, found, restaurant?} y NUNCA lanza: el caller que necesita
 * distinguir "no existe" de "la nube falló" mira `ok` y decide (503/retry).
 * @param {'slug'|'userId'|'id'} field
 * @param {string} value
 * @param {{force?: boolean}} [opts]
 */
async function _lazyHydrateRestaurant(field, value, opts = {}) {
  if (!supabase || !value) return { ok: true, found: false };
  const cacheKey = `${field}:${value}`;
  const cachedAt = _lazyCache.get(cacheKey);
  if (!opts.force && cachedAt && Date.now() - cachedAt < LAZY_RESTAURANT_TTL_MS) {
    return { ok: true, found: true, cached: true };
  }
  if (_lazyInflight.has(cacheKey)) return _lazyInflight.get(cacheKey);

  const task = (async () => {
    try {
      const restaurant = await _fetchRestaurantFromCloud(field, value);
      if (restaurant) {
        _lazyCache.set(cacheKey, Date.now());
        return { ok: true, found: true, restaurant };
      }
      return { ok: true, found: false };
    } catch (e) {
      // Best-effort: el JSON local puede quedar incompleto pero nunca rompe el
      // request que solo quería un lookup síncrono.
      console.warn(`[DB lazy] No se pudo hidratar ${field}=${value}:`, e.message);
      return { ok: false, found: false, error: e };
    } finally {
      _lazyInflight.delete(cacheKey);
    }
  })();
  _lazyInflight.set(cacheKey, task);
  return task;
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
      if (file === RESTAURANTS_FILE) {
        _restCache = { key: '', rows: null };
        // Un guardado local puede cambiar slug/suscripción: el listado cacheado
        // deja de ser confiable (unicidad de slug, overview, sitemap).
        if (_allRestaurantsCache.rows) {
          _allRestaurantsCache = { at: 0, rows: null, inflight: _allRestaurantsCache.inflight };
        }
      }
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

// ── Usuarios: tombstones, frescura y outbox (P0-2) ─────────────────────────

function isTombstoneEmail(email) {
  return String(email || '').trim().toLowerCase().endsWith(`@${USER_TOMBSTONE_DOMAIN}`);
}

function isDeletedUser(user) {
  if (!user || typeof user !== 'object') return false;
  if (user.deleted === true) return true;
  return isTombstoneEmail(user.email);
}

function buildUserTombstone(user) {
  const source = user && typeof user === 'object' ? user : {};
  const now = new Date().toISOString();
  return {
    id: source.id,
    email: `deleted+${source.id}@${USER_TOMBSTONE_DOMAIN}`,
    // Password aleatorio (no es un hash bcrypt válido): aunque alguien fuerce
    // el lookup, comparePassword nunca puede autenticar.
    password: crypto.randomBytes(32).toString('hex'),
    name: '',
    email_confirmed_at: null,
    createdAt: source.createdAt || source.created_at || now,
    updatedAt: now,
    deleted: true,
    deletedAt: now
  };
}

function normalizeCloudUserRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  const normalized = {
    ...row,
    id: String(row.id),
    email: String(row.email || ''),
    name: row.name || '',
    createdAt: row.createdAt || row.created_at || null,
    updatedAt: row.updatedAt || row.updated_at || null,
    email_confirmed_at: row.email_confirmed_at ?? row.emailConfirmedAt ?? null
  };
  if (isTombstoneEmail(normalized.email)) {
    normalized.deleted = true;
    normalized.deletedAt = normalized.updatedAt || null;
  }
  return normalized;
}

function toCloudUserRow(user) {
  // El tombstone se identifica por el dominio del email: NO viaja un flag
  // `deleted` que la tabla cloud no tiene (cloudWriteTolerant lo quitaría y
  // ensuciaría el log de drift en cada borrado).
  return {
    id: user.id,
    email: user.email,
    password: user.password,
    name: user.name || '',
    email_confirmed_at: user.email_confirmed_at || user.emailConfirmedAt || null,
    created_at: user.createdAt || null,
    updated_at: user.updatedAt || null
  };
}

function isUserCloudPending(user, nowMs = Date.now()) {
  if (!user || typeof user !== 'object' || !user._cloudPending) return false;
  const at = tsOf(user._cloudPendingAt || user.createdAt);
  // Sin timestamp no se puede probar que venció: conservar es lo seguro.
  if (at < 0) return true;
  return nowMs - at <= USER_CLOUD_PENDING_TTL_MS;
}

function getUserFreshTtlMs() {
  const raw = process.env.USER_FRESH_TTL_MS;
  if (raw === undefined || raw === '') return 30 * 1000;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : 30 * 1000;
}

/**
 * Fusión de usuarios con DOS reglas que `mergeById` no puede expresar:
 * 1) un tombstone cloud SIEMPRE gana (una réplica con el usuario viejo en su
 *    JSON no puede resucitar una cuenta borrada en otra);
 * 2) un usuario activo cloud gana sobre un tombstone local (una réplica que
 *    borró y otra que todavía no vio el cambio convergen al estado cloud).
 * El resto sigue siendo last-writer-wins con empate → local (altas del request
 * en curso durante el boot).
 */
function mergeUsers(localUsers, cloudUsers) {
  const byId = new Map();
  for (const row of (Array.isArray(cloudUsers) ? cloudUsers : [])) {
    const normalized = normalizeCloudUserRow(row);
    if (normalized) byId.set(normalized.id, normalized);
  }
  for (const row of (Array.isArray(localUsers) ? localUsers : [])) {
    if (!row || typeof row !== 'object' || !row.id) continue;
    const key = String(row.id);
    const cloudRow = byId.get(key);
    if (!cloudRow) {
      byId.set(key, row);
      continue;
    }
    const cloudDeleted = isDeletedUser(cloudRow);
    const localDeleted = isDeletedUser(row);
    if (cloudDeleted) {
      // El tombstone cloud manda; conservamos createdAt local si existe.
      byId.set(key, {
        ...row,
        ...cloudRow,
        createdAt: row.createdAt || cloudRow.createdAt,
        deleted: true
      });
      continue;
    }
    if (localDeleted) {
      byId.set(key, cloudRow);
      continue;
    }
    if (tsOf(row.updatedAt || row.createdAt) >= tsOf(cloudRow.updatedAt || cloudRow.createdAt)) {
      // Local gana el empate, pero conserva campos que solo están en cloud
      // (email_confirmed_at, etc.).
      byId.set(key, { ...cloudRow, ...row });
    }
  }
  return [...byId.values()];
}

/**
 * Poda conservadora de usuarios locales que ya no existen en cloud. Requisitos
 * para borrar una fila: cloud NO vacío (nunca podar contra un fallo de lectura),
 * ausencia fuera de la ventana de gracia, timestamp verificable y sin
 * `_cloudPending` vigente (un alta cuyo insert cloud falló no es un borrado).
 * Filas sin timestamp y tombstones se conservan siempre.
 */
function pruneUsersByCloudAbsence(users, cloudUsers, opts = {}) {
  const cloud = Array.isArray(cloudUsers) ? cloudUsers : [];
  if (cloud.length === 0) return users;
  const cloudIds = new Set(
    cloud.filter((r) => r && typeof r === 'object' && r.id).map((r) => String(r.id))
  );
  const nowMs = Number.isFinite(opts.nowMs) ? opts.nowMs : Date.now();
  const graceMs = Number.isFinite(opts.graceMs) ? opts.graceMs : USER_CLOUD_ABSENCE_GRACE_MS;
  return users.filter((row) => {
    if (!row || typeof row !== 'object' || !row.id) return false;
    if (cloudIds.has(String(row.id))) return true;
    if (isDeletedUser(row)) return true; // el tombstone local rechaza tokens viejos
    if (isUserCloudPending(row, nowMs)) return true;
    const stamp = tsOf(row.updatedAt || row.createdAt);
    if (stamp < 0) return true; // sin timestamp no se puede probar stale
    return nowMs - stamp < graceMs;
  });
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

function resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants, opts = {}) {
  const users = pruneUsersByCloudAbsence(mergeUsers(localUsers, cloudUsers), cloudUsers, opts);
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
 * Tabla inexistente en la nube (proyecto nuevo sin una migración aplicada).
 * Un DELETE contra una tabla ausente no tiene datos que borrar: se tolera y se
 * sigue con las demás. Cualquier otro error SÍ aborta el borrado de cuenta.
 */
function isMissingTableError(error) {
  const code = String((error && error.code) || '');
  if (code === 'PGRST205' || code === '42P01') return true;
  const message = String((error && error.message) || error || '').toLowerCase();
  return message.includes('could not find the table') || message.includes('relation') && message.includes('does not exist');
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
// Mutex en proceso para reservas (addReservation/updateReservationStatus son
// read-modify-write sobre el MISMO documento del local: dos POST/PATCH
// concurrentes intercalados pisaban una reserva — mismo porqué que addOrder).
let reservationWriteLock = Promise.resolve();
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

// ── Reservas v2 (migración 011): claim atómico de franja ────────────────────
/**
 * Intenta el claim cloud `claim_reservation_slot` (alta + capacidad en UNA
 * sentencia bajo advisory lock). Devuelve SIEMPRE una de:
 *   {ok:true, already:boolean}            — franja tomada (o retry idempotente)
 *   {ok:false, reason}                    — SLOT_FULL / BUFFER_TOO_CLOSE
 *   {unavailable:true}                    — sin migración / doc ausente / red:
 *     el caller degrada al path local (NOT_FOUND e INVALID_* son "el doc cloud
 *     todavía no existe o la forma no sirve" — nunca un rechazo de capacidad).
 */
async function claimReservationSlotInCloud(restaurantId, reservation, config) {
  try {
    const { resolveReservationConfig, MAX_RESERVATIONS } = require('../../api/utils/reservations');
    const cfg = resolveReservationConfig(config);
    const { data, error } = await supabase.rpc('claim_reservation_slot', {
      p_restaurant_id: restaurantId,
      p_reservation: reservation,
      p_max_per_slot: cfg.maxPerSlot,
      p_buffer_minutes: cfg.slotBufferMinutes,
      p_max_reservations: MAX_RESERVATIONS
    });
    if (error) {
      // PGRST202 (función ausente) u otro error: path local con aviso visible
      // (el drift de la 011 no puede quedar invisible — lección de 007/008).
      warnOnce('[DB] claim_reservation_slot no disponible (path local): ' + (error.message || String(error)));
      return { unavailable: true };
    }
    if (!data || typeof data !== 'object') return { unavailable: true };
    if (data.ok === true) return { ok: true, already: data.already === true };
    const reason = String(data.reason || '');
    if (reason === 'SLOT_FULL' || reason === 'BUFFER_TOO_CLOSE') {
      return { ok: false, reason };
    }
    // NOT_FOUND / INVALID_RESERVATION / INVALID_TIME → degradar (la capacidad
    // la re-validará el path local).
    return { unavailable: true };
  } catch (e) {
    return { unavailable: true };
  }
}

/**
 * Escritura SOLO del espejo local para una reserva ya persistida en cloud
 * (claim 011): read-modify-write bajo el mutex, sin trackSupabaseWrite — un
 * whole-doc write desde el espejo pisaría un claim concurrente de otra
 * réplica. El fallo del espejo NO revierte la reserva (la nube es la fuente
 * de verdad y la hidratación lo repara).
 */
async function runReservationMirrorWrite(restaurantId, reservation, trimReservationsList, maxReservations) {
  const run = async () => {
    const rests = readJson(RESTAURANTS_FILE, []);
    const rest = rests.find(r => r.id === restaurantId);
    if (!rest) return { success: false, error: 'Restaurante no encontrado' };
    if (!Array.isArray(rest.reservations)) rest.reservations = [];
    if (!rest.reservations.some(r => r && r.id === reservation.id)) {
      rest.reservations.push(reservation);
      if (rest.reservations.length > maxReservations) {
        rest.reservations = trimReservationsList(rest.reservations, maxReservations);
      }
      await writeJson(RESTAURANTS_FILE, rests);
    }
    return { success: true, restaurant: rest, reservation };
  };
  reservationWriteLock = reservationWriteLock.then(run, run);
  return reservationWriteLock;
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

/**
 * Descarga TODOS los usuarios paginando (PostgREST corta en 1000 filas por
 * request). La hidratación del boot necesita la lista COMPLETA para poder podar
 * con honestidad las filas locales que ya no existen en cloud: una lectura
 * truncada parecería una ausencia masiva.
 */
async function fetchAllCloudUsers(client) {
  const rows = [];
  for (let from = 0; ; from += CLOUD_USERS_PAGE_SIZE) {
    const { data, error } = await client
      .from('users')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + CLOUD_USERS_PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    for (const row of page) {
      const normalized = normalizeCloudUserRow(row);
      if (normalized) rows.push(normalized);
    }
    if (page.length < CLOUD_USERS_PAGE_SIZE) break;
  }
  return rows;
}

/**
 * Descarga TODOS los restaurantes paginando (PostgREST corta en 1000 filas).
 * Se normaliza igual que las hydrataciones puntuales (`_normalizeCloudRestaurantRow`
 * + `normalizeRestaurantBusinessType`) para que el espejo local escrito acá sea
 * indistinguible del que produce el boot/lazy hydration.
 */
async function fetchAllCloudRestaurants(client) {
  const rows = [];
  for (let from = 0; ; from += CLOUD_RESTAURANTS_PAGE_SIZE) {
    const { data, error } = await client
      .from('restaurants')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + CLOUD_RESTAURANTS_PAGE_SIZE - 1);
    if (error) throw error;
    const page = Array.isArray(data) ? data : [];
    for (const row of page) {
      const normalized = _normalizeCloudRestaurantRow(row);
      if (normalized && normalized.id) rows.push(normalizeRestaurantBusinessType(normalized));
    }
    if (page.length < CLOUD_RESTAURANTS_PAGE_SIZE) break;
  }
  return rows;
}

/** Firma barata para detectar si el listado cambió (evita reescribir el JSON). */
function restaurantsSignature(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((r) => `${r && r.id}:${(r && (r.updatedAt || r.createdAt)) || ''}`)
    .join('|');
}

/**
 * Listado COMPLETO de restaurantes, cross-réplica.
 *
 * Contrato:
 * - Sin Supabase configurado → espejo local (modo JSON, dev/test): idéntico a
 *   `getAllRestaurants()`, cero comportamiento nuevo.
 * - Con Supabase → nube paginada ∪ espejo local (`mergeById`, local gana
 *   empates), escritura del espejo SOLO si cambió, caché de 60 s por proceso y
 *   dedupe de llamadas concurrentes.
 * - Nube vacía con espejo local no vacío NO pisa el espejo (una lectura
 *   truncada o un proyecto recién vaciado no debe borrar la lista local).
 * - Cualquier error degrade al espejo local con warn: un cron o el sitemap
 *   nunca se caen por la nube.
 */
async function _getAllRestaurantsAsync(opts = {}) {
  if (!supabase) return readRestaurants();
  const ttlMs = Number.isFinite(opts.ttlMs) ? Math.max(0, opts.ttlMs) : ALL_RESTAURANTS_TTL_MS;
  if (!opts.force && _allRestaurantsCache.rows && Date.now() - _allRestaurantsCache.at < ttlMs) {
    // Copia superficial: un consumidor que ordene/mute el array no ensucia la caché.
    return _allRestaurantsCache.rows.slice();
  }
  if (_allRestaurantsCache.inflight) return _allRestaurantsCache.inflight;

  const task = (async () => {
    try {
      const cloud = await fetchAllCloudRestaurants(supabase);
      // Se re-lee DESPUÉS del fetch: un alta/guardado local ocurrido durante la
      // descarga entra en la fusión (no se pisa con una foto vieja).
      const base = readRestaurants();
      if (cloud.length === 0 && base.length > 0) {
        console.warn('[DB] Listado cloud de restaurantes vacío; se conserva el espejo local');
        _allRestaurantsCache = { at: Date.now(), rows: base, inflight: null };
        return base.slice();
      }
      const merged = mergeById(base, cloud).map(normalizeRestaurantBusinessType);
      if (restaurantsSignature(merged) !== restaurantsSignature(base)) {
        await writeJson(RESTAURANTS_FILE, merged);
      }
      _allRestaurantsCache = { at: Date.now(), rows: merged, inflight: null };
      return merged.slice();
    } catch (e) {
      // No se cachea el fallo: el próximo consumidor reintenta la nube.
      console.warn('[DB] No se pudo listar restaurantes desde Supabase; degradando al espejo local:', e.message);
      _allRestaurantsCache = { at: 0, rows: null, inflight: null };
      return readRestaurants();
    }
  })();

  _allRestaurantsCache = { ..._allRestaurantsCache, inflight: task };
  task.finally(() => {
    if (_allRestaurantsCache.inflight === task) {
      _allRestaurantsCache = { ..._allRestaurantsCache, inflight: null };
    }
  });
  return task;
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
        const cloudUsers = await fetchAllCloudUsers(supabase);

        const localUsers = readJson(USERS_FILE, []);
        if (cloudUsers.length === 0 && localUsers.length > 0) {
          console.warn('[DB] Snapshot de Supabase vacío para usuarios; conservando datos locales válidos.');
        }

        // Re-lectura antes de escribir (ver comentario original). La fusión
        // respeta tombstones cloud y poda ausencias verificadas (ver mergeUsers
        // y pruneUsersByCloudAbsence).
        const freshUsers = readJson(USERS_FILE, []);
        const finalUsers = resolveHydrationData(cloudUsers, freshUsers, [], []).users;

        if (!await writeJson(USERS_FILE, finalUsers)) {
          throw new Error('No se pudo hidratar el snapshot local de usuarios desde Supabase.');
        }

        console.log(`✅ [DB] Usuarios hidratados (${finalUsers.length}). Restaurantes: carga diferida por slug/id.`);

        // Outbox de usuarios: un alta cuyo upsert cloud falló queda con
        // `_cloudPending` y se repara acá. Best-effort, nunca rompe el boot.
        try {
          const repairUsers = await db.repairCloudPendingUsers();
          if (repairUsers && (repairUsers.repaired > 0 || repairUsers.remaining > 0)) {
            console.log(`[DB] Usuarios pendientes reparados: ${repairUsers.repaired} subidos, ${repairUsers.remaining} restantes.`);
          }
        } catch (e) {
          console.warn('[DB] Reparación de usuarios pendientes falló (best-effort):', e.message);
        }

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

// ── Sistema de Mozos y Cocina (Fase 1) ─────────────────────────────────────
// El equipo operativo vive en sus propias tablas (`staff` / `staff_sessions`),
// NUNCA como `users`: un mozo no tiene email, password ni suscripción. Las
// sesiones son opacas y revocables; el token crudo jamás se persiste (solo su
// hash). El dual-write sigue el patrón del resto del repo: local primero,
// nube best-effort con `cloudWriteTolerant` para tolerar la migración 010
// todavía no aplicada.
let staffWriteLock = Promise.resolve();
let staffSessionWriteLock = Promise.resolve();

function withStaffLock(run) {
  staffWriteLock = staffWriteLock.then(run, run);
  return staffWriteLock;
}
function withStaffSessionLock(run) {
  staffSessionWriteLock = staffSessionWriteLock.then(run, run);
  return staffSessionWriteLock;
}

function normalizeStaffRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: row.id,
    restaurantId: row.restaurant_id ?? row.restaurantId ?? null,
    name: row.name || '',
    role: row.role === 'kitchen' ? 'kitchen' : 'waiter',
    active: row.active !== false,
    credentialHash: row.credential_hash || row.credentialHash || '',
    credentialUpdatedAt: row.credential_updated_at || row.credentialUpdatedAt || null,
    createdBy: row.created_by || row.createdBy || null,
    createdAt: row.created_at || row.createdAt || null,
    updatedAt: row.updated_at || row.updatedAt || row.created_at || row.createdAt || null
  };
}

function toCloudStaffRow(row) {
  return {
    id: row.id,
    restaurant_id: row.restaurantId,
    name: row.name,
    role: row.role,
    active: row.active !== false,
    credential_hash: row.credentialHash,
    credential_updated_at: row.credentialUpdatedAt,
    created_by: row.createdBy || null,
    created_at: row.createdAt,
    updated_at: row.updatedAt
  };
}

function normalizeStaffSessionRow(row) {
  if (!row || typeof row !== 'object' || !row.id) return null;
  return {
    id: row.id,
    staffId: row.staff_id ?? row.staffId ?? null,
    restaurantId: row.restaurant_id ?? row.restaurantId ?? null,
    tokenHash: row.token_hash || row.tokenHash || '',
    createdAt: row.created_at || row.createdAt || null,
    expiresAt: row.expires_at || row.expiresAt || null,
    lastSeenAt: row.last_seen_at || row.lastSeenAt || null,
    endedAt: row.ended_at || row.endedAt || null,
    revokedAt: row.revoked_at || row.revokedAt || null
  };
}

function toCloudStaffSessionRow(row) {
  return {
    id: row.id,
    staff_id: row.staffId,
    restaurant_id: row.restaurantId,
    token_hash: row.tokenHash,
    created_at: row.createdAt,
    expires_at: row.expiresAt,
    last_seen_at: row.lastSeenAt || null,
    ended_at: row.endedAt || null,
    revoked_at: row.revokedAt || null
  };
}

function isActiveStaffSessionRow(session, nowMs = Date.now()) {
  if (!session || session.revokedAt || session.endedAt) return false;
  const expires = Date.parse(session.expiresAt || '');
  return Number.isFinite(expires) && expires > Number(nowMs);
}

function mergeStaffSessions(localRows, cloudRows) {
  const byId = new Map();
  for (const row of (Array.isArray(cloudRows) ? cloudRows : [])) {
    if (row && row.id) byId.set(String(row.id), row);
  }
  for (const row of (Array.isArray(localRows) ? localRows : [])) {
    if (!row || !row.id) continue;
    const prev = byId.get(String(row.id));
    const rowTs = tsOf(row.lastSeenAt || row.createdAt);
    const prevTs = tsOf(prev && (prev.lastSeenAt || prev.createdAt));
    if (!prev || rowTs >= prevTs) byId.set(String(row.id), row);
  }
  return [...byId.values()];
}

async function fetchCloudStaffRows(restaurantId) {
  if (!supabase || !restaurantId) return [];
  try {
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .eq('restaurant_id', restaurantId);
    if (error) return [];
    return (data || []).map(normalizeStaffRow).filter(Boolean);
  } catch (e) {
    return [];
  }
}

async function fetchCloudStaffSessionRows({ restaurantId, staffId } = {}) {
  if (!supabase) return [];
  try {
    let query = supabase.from('staff_sessions').select('*');
    if (staffId) query = query.eq('staff_id', staffId);
    if (restaurantId) query = query.eq('restaurant_id', restaurantId);
    const { data, error } = await query;
    if (error) return [];
    return (data || []).map(normalizeStaffSessionRow).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Serializa read-modify-write sobre users.json (el alta y la hidratación
// corren en el mismo proceso). El lock es una promesa encadenada: un fallo no
// rompe la cadena (then(run, run)).
let usersWriteLock = Promise.resolve();
function withUsersLock(run) {
  usersWriteLock = usersWriteLock.then(run, run);
  return usersWriteLock;
}

// Caché de frescura de sesión (userId → {at, result}). Se invalida en toda
// mutación del usuario (clave, tombstone, hidratación).
const _userFreshCache = new Map();
function invalidateUserFreshCache(userId) {
  if (userId) _userFreshCache.delete(String(userId));
  else _userFreshCache.clear();
}

/**
 * Verifica que el email no esté tomado, también en cloud cuando está
 * configurado. Fail-closed: si la nube no se puede consultar lanza
 * USER_LOOKUP_UNAVAILABLE (nunca se asume libre y se crea un duplicado).
 * Usa `.eq` y no `.ilike`: el `_` del local-part es wildcard en SQL.
 */
async function assertUserEmailAvailable(email, { excludeId } = {}) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return;
  const local = readJson(USERS_FILE, []).find(
    (u) => u && u.id !== excludeId && !isDeletedUser(u)
      && String(u.email || '').toLowerCase() === normalized
  );
  if (local) {
    const err = new Error('El email ya está registrado');
    err.code = 'EMAIL_ALREADY_EXISTS';
    throw err;
  }
  if (!supabase) return;
  const { data, error } = await supabase
    .from('users')
    .select('id,email')
    .eq('email', normalized)
    .limit(1)
    .maybeSingle();
  if (error) {
    const err = new Error('No se pudo verificar el email');
    err.code = 'USER_LOOKUP_UNAVAILABLE';
    throw err;
  }
  if (data && String(data.id) !== String(excludeId || '') && !isTombstoneEmail(data.email)) {
    const err = new Error('El email ya está registrado');
    err.code = 'EMAIL_ALREADY_EXISTS';
    throw err;
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
  // Los tombstones (`@deleted.invalid`) NUNCA se devuelven como usuarios: el
  // estado `deleted` se consulta por getUserSessionState(). Así una cuenta
  // borrada no puede autenticarse ni "reaparecer" por un lookup local.
  findUserByEmail(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return null;
    const users = readJson(USERS_FILE, []);
    return users.find(
      (u) => u && !isDeletedUser(u) && String(u.email || '').toLowerCase() === normalized
    ) || null;
  },
  findUserById(id) {
    if (!id) return null;
    const users = readJson(USERS_FILE, []);
    return users.find((u) => u && u.id === id && !isDeletedUser(u)) || null;
  },

  /**
   * Lookup FRESCO por email para login/registro/reset. La nube es la fuente de
   * verdad multi-réplica: una réplica con el usuario viejo en su JSON no puede
   * loguear una cuenta borrada en otra. Contrato:
   *   { ok:true, user, source }                 → resultado confiable
   *   { ok:true, user:null, deleted:true }      → tombstone (no autenticable)
   *   { ok:true, user, degraded:true }          → cloud caído, se usa el espejo
   *   { ok:false }                              → no se pudo verificar y no hay
   *                                               espejo: el route responde 503
   */
  async getUserByEmailFresh(email) {
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return { ok: true, user: null, source: 'local' };
    const local = readJson(USERS_FILE, []).find(
      (u) => u && !isDeletedUser(u) && String(u.email || '').toLowerCase() === normalized
    ) || null;
    if (!supabase) return { ok: true, user: local, source: 'local' };

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', normalized)
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      if (data) {
        const cloudUser = normalizeCloudUserRow(data);
        if (!cloudUser) return { ok: true, user: null, source: 'cloud' };
        await this.cacheUserLocally(cloudUser);
        if (isDeletedUser(cloudUser)) {
          return { ok: true, user: null, deleted: true, source: 'cloud' };
        }
        return { ok: true, user: cloudUser, source: 'cloud' };
      }

      if (!local) return { ok: true, user: null, source: 'cloud' };

      // Sin fila por email puede ser un TOMBSTONE (el email cambió al borrar)
      // o un alta cuyo insert cloud falló. Segunda consulta por id para no
      // confundir un borrado con un alta pendiente.
      const byId = await supabase
        .from('users')
        .select('*')
        .eq('id', local.id)
        .limit(1)
        .maybeSingle();
      if (byId.error) throw byId.error;
      if (byId.data) {
        const cloudUser = normalizeCloudUserRow(byId.data);
        await this.cacheUserLocally(cloudUser);
        if (!cloudUser || isDeletedUser(cloudUser)) {
          return { ok: true, user: null, deleted: true, source: 'cloud' };
        }
        return { ok: true, user: cloudUser, source: 'cloud' };
      }
      if (isUserCloudPending(local)) {
        return { ok: true, user: local, source: 'local-pending', degraded: true };
      }
      // Ausencia cloud verificada (no está por email ni por id): cuenta
      // inexistente. El espejo local es basura de una réplica vieja.
      return { ok: true, user: null, source: 'cloud' };
    } catch (e) {
      if (local) {
        return { ok: true, user: local, source: 'local-degraded', degraded: true };
      }
      return { ok: false, user: null, source: 'unavailable', error: e };
    }
  },

  /**
   * Estado de sesión por userId (middleware). `active|deleted|missing|
   * unavailable`. Cachea el resultado TTL corto (USER_FRESH_TTL_MS) para no
   * consultar la nube en cada request; NUNCA cachea degraded/unavailable.
   */
  async getUserSessionState(userId) {
    const key = String(userId || '');
    if (!key) return { ok: false, status: 'missing' };
    const ttl = getUserFreshTtlMs();
    const cached = _userFreshCache.get(key);
    if (cached && ttl > 0 && Date.now() - cached.at <= ttl) {
      return { ...cached.result };
    }
    const local = readJson(USERS_FILE, []).find((u) => u && u.id === key) || null;
    if (!supabase) {
      if (!local) return { ok: false, status: 'missing' };
      return {
        ok: true,
        status: isDeletedUser(local) ? 'deleted' : 'active',
        user: local,
        source: 'local'
      };
    }

    try {
      const { data, error } = await supabase
        .from('users')
        .select('*')
        .eq('id', key)
        .limit(1)
        .maybeSingle();
      if (error) throw error;

      if (!data) {
        if (local && isDeletedUser(local)) {
          // El tombstone local solo se escribe después de verificar el borrado
          // cloud: sin fila cloud, el tombstone local es la verdad.
          return { ok: true, status: 'deleted', user: local, source: 'local' };
        }
        if (local && isUserCloudPending(local)) {
          return { ok: true, status: 'active', user: local, source: 'local-pending', degraded: true };
        }
        return { ok: true, status: 'missing' };
      }

      const cloudUser = normalizeCloudUserRow(data);
      if (!cloudUser) return { ok: true, status: 'missing' };
      await this.cacheUserLocally(cloudUser);
      const result = isDeletedUser(cloudUser)
        ? { ok: true, status: 'deleted', user: cloudUser, source: 'cloud' }
        : { ok: true, status: 'active', user: cloudUser, source: 'cloud' };
      if (ttl > 0) _userFreshCache.set(key, { at: Date.now(), result });
      return { ...result };
    } catch (e) {
      if (local) {
        return {
          ok: true,
          status: isDeletedUser(local) ? 'deleted' : 'active',
          user: local,
          source: 'local-degraded',
          degraded: true
        };
      }
      return { ok: false, status: 'unavailable', error: e };
    }
  },

  /**
   * Escribe el espejo local de un usuario cloud con reglas de borrado:
   * tombstone cloud SIEMPRE gana; cloud activo gana sobre tombstone local;
   * entre activos, last-writer-wins. Un tombstone local JAMÁS se pisa con una
   * fila cloud más vieja.
   */
  async cacheUserLocally(cloudUser) {
    const normalized = normalizeCloudUserRow(cloudUser);
    if (!normalized) return null;
    await withUsersLock(async () => {
      const users = readJson(USERS_FILE, []);
      const idx = users.findIndex((u) => u && u.id === normalized.id);
      if (idx < 0) {
        users.push(normalized);
      } else {
        const local = users[idx];
        const localDeleted = isDeletedUser(local);
        const incomingDeleted = isDeletedUser(normalized);
        const incomingTs = tsOf(normalized.updatedAt || normalized.createdAt);
        const localTs = tsOf(local.updatedAt || local.createdAt);
        if (incomingDeleted || localDeleted || incomingTs >= localTs) {
          const next = { ...local, ...normalized };
          if (incomingDeleted) {
            next.deleted = true;
          } else if (localDeleted) {
            delete next.deleted;
            delete next.deletedAt;
          }
          // Sin cambios reales no se reescribe el archivo: con
          // USER_FRESH_TTL_MS=0 cada request consulta la nube y un write por
          // request sería ruido puro.
          const unchanged = Object.keys(next).every(
            (k) => JSON.stringify(next[k]) === JSON.stringify(local[k])
          );
          if (unchanged) return;
          users[idx] = next;
        } else {
          return;
        }
      }
      await writeJson(USERS_FILE, users);
    });
    invalidateUserFreshCache(normalized.id);
    return normalized;
  },

  async clearUserCloudPending(userId) {
    let changed = false;
    await withUsersLock(async () => {
      const users = readJson(USERS_FILE, []);
      const user = users.find((u) => u && u.id === userId);
      if (!user || (!user._cloudPending && !user._cloudPendingAt)) return;
      delete user._cloudPending;
      delete user._cloudPendingAt;
      changed = true;
      await writeJson(USERS_FILE, users);
    });
    if (changed) invalidateUserFreshCache(userId);
  },

  invalidateUserFreshCache(userId) {
    invalidateUserFreshCache(userId);
  },

  /**
   * Alta local-first con outbox: si el upsert cloud falla, el usuario queda
   * `_cloudPending` y el boot lo repara (repairCloudPendingUsers). La
   * unicidad de email se verifica contra local Y cloud (fail-closed).
   * NO setea updatedAt: los tokens legacy sin pwdTs siguen válidos.
   */
  async createUser(userData, opts = {}) {
    const data = { ...(userData || {}) };
    const email = String(data.email || '').trim().toLowerCase();
    if (!email) {
      const err = new Error('El email es requerido');
      err.code = 'EMAIL_REQUIRED';
      throw err;
    }
    const id = String(data.id || ('usr_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8)));
    const checkEmailUniqueness = opts.checkEmailUniqueness !== false;
    if (checkEmailUniqueness) {
      await assertUserEmailAvailable(email, { excludeId: id });
    }

    const now = new Date().toISOString();
    const newUser = {
      id,
      email,
      createdAt: now,
      ...data,
      // id/email normalizados ganan aunque userData traiga otra grafía.
      _cloudPending: true,
      _cloudPendingAt: now
    };
    newUser.id = id;
    newUser.email = email;
    if (!newUser.createdAt) newUser.createdAt = now;

    await withUsersLock(async () => {
      const users = readJson(USERS_FILE, []);
      if (checkEmailUniqueness) {
        // Re-chequeo DENTRO del mutex: dos registros concurrentes en el mismo
        // proceso no pueden crear el mismo email.
        const dup = users.find(
          (u) => u && u.id !== id && !isDeletedUser(u)
            && String(u.email || '').toLowerCase() === email
        );
        if (dup) {
          const err = new Error('El email ya está registrado');
          err.code = 'EMAIL_ALREADY_EXISTS';
          throw err;
        }
      }
      const idx = users.findIndex((u) => u && u.id === id);
      if (idx >= 0) users[idx] = { ...users[idx], ...newUser };
      else users.push(newUser);
      await writeJson(USERS_FILE, users);
    });
    invalidateUserFreshCache(id);

    if (supabase) {
      try {
        const res = await cloudWriteTolerant('users', [toCloudUserRow(newUser)], { onConflict: 'id' });
        if (res.ok) {
          await this.clearUserCloudPending(id);
        } else if (!res.skipped) {
          warnOnce(`[DB] Alta de usuario pendiente en cloud: ${res.error || 'sin detalle'}`);
        }
      } catch (e) {
        warnOnce(`[DB] Alta de usuario pendiente en cloud: ${e.message || String(e)}`);
      }
    } else {
      await this.clearUserCloudPending(id);
    }

    const { _cloudPending: _pending, _cloudPendingAt: _pendingAt, ...clean } = newUser;
    return clean;
  },

  /**
   * Cambio de clave cloud-first: la nube es la fuente de verdad multi-réplica
   * y el `updated_at` (pwdTs) debe persistir ANTES de responder, o una réplica
   * con el hash viejo seguiría aceptando la clave anterior. Si el UPDATE afecta
   * 0 filas (usuario ausente en cloud) se verifica con un select y se degrada
   * al espejo solo si el usuario tampoco existe en cloud.
   */
  async updateUserPassword(userId, newHashedPassword) {
    const updatedAt = new Date().toISOString();
    const localUser = readJson(USERS_FILE, []).find(
      (u) => u && u.id === userId && !isDeletedUser(u)
    ) || null;
    // Un alta local cuyo dual-write falló NO existe todavía en la nube: su
    // cambio de clave se escribe local y queda pendiente para el boot. Sin
    // esta excepción, el upgrade legacy de hash (login) rompía con 500.
    let cloudAbsentPending = false;
    let cloudConfirmed = false;
    if (supabase) {
      try {
        const { error } = await supabase
          .from('users')
          .update({ password: newHashedPassword, updated_at: updatedAt })
          .eq('id', userId);
        if (error) throw error;
        const { data, error: checkErr } = await supabase
          .from('users')
          .select('id')
          .eq('id', userId)
          .limit(1)
          .maybeSingle();
        if (checkErr) throw checkErr;
        if (!data) {
          if (localUser && isUserCloudPending(localUser)) {
            cloudAbsentPending = true;
          } else {
            const err = new Error('Usuario inexistente en la nube');
            err.code = 'USER_NOT_FOUND_CLOUD';
            throw err;
          }
        } else {
          cloudConfirmed = true;
        }
      } catch (e) {
        if (e && e.code === 'USER_NOT_FOUND_CLOUD' && localUser && isUserCloudPending(localUser)) {
          cloudAbsentPending = true;
        } else {
          const err = new Error(`No se pudo actualizar la clave en la nube: ${e.message || String(e)}`);
          err.code = 'PASSWORD_UPDATE_FAILED';
          err.cause = e;
          throw err;
        }
      }
    }

    let updated = null;
    await withUsersLock(async () => {
      const users = readJson(USERS_FILE, []);
      const user = users.find((u) => u && u.id === userId && !isDeletedUser(u));
      if (!user) return;
      user.password = newHashedPassword;
      user.updatedAt = updatedAt;
      if (cloudAbsentPending) {
        user._cloudPending = true;
        user._cloudPendingAt = updatedAt;
      }
      updated = { ...user };
      await writeJson(USERS_FILE, users);
    });
    if (cloudConfirmed) await this.clearUserCloudPending(userId);
    invalidateUserFreshCache(userId);
    return updated;
  },

  /**
   * Outbox de usuarios: re-sube los `_cloudPending` del espejo. Un tombstone
   * local también se re-sube (es el estado correcto). Best-effort: lo que falle
   * queda pendiente para el próximo boot.
   */
  async repairCloudPendingUsers() {
    if (!supabase) return { repaired: 0, remaining: 0 };
    const pending = readJson(USERS_FILE, []).filter((u) => u && isUserCloudPending(u));
    let repaired = 0;
    for (const user of pending) {
      try {
        const res = await cloudWriteTolerant('users', [toCloudUserRow(user)], { onConflict: 'id' });
        if (res.ok) {
          await this.clearUserCloudPending(user.id);
          repaired++;
        }
      } catch { /* queda pendiente para el próximo boot */ }
    }
    return {
      repaired,
      remaining: readJson(USERS_FILE, []).filter((u) => u && isUserCloudPending(u)).length
    };
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

  /**
   * Versión async de findRestaurantByUserId que ESPERA la hidratación cloud.
   * Es la fuente de verdad del Studio: un `null` significa "este usuario no
   * tiene local" (recién ahí el frontend puede crear uno); si Supabase
   * falla, LANZA `RESTAURANT_LOAD_FAILED` para que la ruta responda 503 en vez
   * de crear un local duplicado o dejar que el Studio guarde una carta vacía.
   * @param {string} userId
   * @returns {Promise<object|null>}
   */
  async lazyLoadRestaurantByUserId(userId) {
    if (!userId) return null;
    const local = readRestaurants().find(r => r.userId === userId) || null;
    if (local) return normalizeRestaurantBusinessType(local);

    const result = await _lazyHydrateRestaurant('userId', userId, { force: true });
    if (!result.ok) {
      const err = new Error('No se pudo cargar el local desde la nube');
      err.code = 'RESTAURANT_LOAD_FAILED';
      err.cause = result.error;
      throw err;
    }
    const hydrated = readRestaurants().find(r => r.userId === userId) || null;
    return normalizeRestaurantBusinessType(hydrated);
  },

  /**
   * Variante async por ID (misma hidratación lazy que lazyLoadRestaurant).
   * La usa el middleware de staff en un cold start de Vercel: el staff puede
   * venir de la nube y su restaurante todavía no estar en el JSON local.
   */
  async lazyLoadRestaurantById(id) {
    if (!id) return null;
    await _lazyHydrateRestaurant('id', id);
    return normalizeRestaurantBusinessType(this.findRestaurantById(id));
  },

  // ── Equipo operativo (mozos / cocina) ──────────────────────────────────
  async listStaff(restaurantId) {
    if (!restaurantId) return [];
    const local = readJson(STAFF_FILE, [])
      .map(normalizeStaffRow)
      .filter((s) => s && s.restaurantId === restaurantId);
    const cloud = await fetchCloudStaffRows(restaurantId);
    return mergeById(local, cloud)
      .map(normalizeStaffRow)
      .filter((s) => s && s.restaurantId === restaurantId)
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'es'));
  },

  async findStaffById(staffId) {
    if (!staffId) return null;
    const local = readJson(STAFF_FILE, []).find((s) => s && s.id === staffId);
    if (local) return normalizeStaffRow(local);
    if (!supabase) return null;
    try {
      const { data, error } = await supabase.from('staff').select('*').eq('id', staffId).limit(1);
      if (error || !data || !data.length) return null;
      const row = normalizeStaffRow(data[0]);
      if (!row) return null;
      await withStaffLock(async () => {
        const rows = readJson(STAFF_FILE, []);
        if (!rows.some((s) => s && s.id === row.id)) {
          rows.push(row);
          await writeJson(STAFF_FILE, rows);
        }
      });
      return row;
    } catch (e) {
      return null;
    }
  },

  async createStaff(staff) {
    const row = normalizeStaffRow(staff);
    if (!row || !row.restaurantId) return null;
    return withStaffLock(async () => {
      const rows = readJson(STAFF_FILE, []);
      if (!rows.some((s) => s && s.id === row.id)) rows.unshift(row);
      await writeJson(STAFF_FILE, rows);
      if (supabase) {
        trackSupabaseWrite(
          cloudWriteTolerant('staff', [toCloudStaffRow(row)], { onConflict: 'id' }).then((r) => {
            if (!r.ok && !r.skipped) throw new Error(r.error || 'staff insert failed');
            return r;
          }),
          'Create Staff'
        );
      }
      return row;
    });
  },

  async updateStaff(staffId, patch) {
    if (!staffId) return null;
    const existing = await this.findStaffById(staffId);
    if (!existing) return null;
    const updatedAt = new Date().toISOString();
    const next = normalizeStaffRow({
      ...existing,
      ...(patch && typeof patch === 'object' ? patch : {}),
      id: existing.id,
      restaurantId: existing.restaurantId,
      createdAt: existing.createdAt,
      updatedAt
    });
    return withStaffLock(async () => {
      const rows = readJson(STAFF_FILE, []);
      const idx = rows.findIndex((s) => s && s.id === staffId);
      if (idx >= 0) rows[idx] = next;
      else rows.unshift(next);
      await writeJson(STAFF_FILE, rows);
      if (supabase) {
        trackSupabaseWrite(
          cloudWriteTolerant('staff', [toCloudStaffRow(next)], { match: { id: staffId } }).then((r) => {
            if (!r.ok && !r.skipped) throw new Error(r.error || 'staff update failed');
            return r;
          }),
          'Update Staff'
        );
      }
      return next;
    });
  },

  async deleteStaff(staffId, restaurantId) {
    if (!staffId) return { deleted: false };
    const existing = await this.findStaffById(staffId);
    if (!existing) return { deleted: false };
    const rid = restaurantId || existing.restaurantId;
    await withStaffLock(async () => {
      await writeJson(STAFF_FILE, readJson(STAFF_FILE, []).filter((s) => s && s.id !== staffId));
    });
    await withStaffSessionLock(async () => {
      await writeJson(
        STAFF_SESSIONS_FILE,
        readJson(STAFF_SESSIONS_FILE, []).filter((s) => s && s.staffId !== staffId && s.staff_id !== staffId)
      );
    });
    if (rid) await this.removeStaffFromTableAssignments(rid, staffId);
    if (supabase) {
      Promise.resolve(supabase.from('staff_sessions').delete().eq('staff_id', staffId)).catch(() => {});
      Promise.resolve(supabase.from('staff').delete().eq('id', staffId)).catch(() => {});
    }
    return { deleted: true };
  },

  /**
   * Quita un mozo de TODAS las mesas asignadas. Se usa al borrarlo para que
   * ninguna mesa quede apuntando a un id inexistente (la pizarra del mozo
   * simplemente no la vería, pero el Studio mostraría basura).
   */
  async removeStaffFromTableAssignments(restaurantId, staffId) {
    if (!restaurantId || !staffId) return false;
    const restaurants = readJson(RESTAURANTS_FILE, []);
    const rest = restaurants.find((r) => r && r.id === restaurantId);
    if (!rest || !rest.tableAssignments || typeof rest.tableAssignments !== 'object') return false;
    let changed = false;
    for (const [table, assigned] of Object.entries(rest.tableAssignments)) {
      if (assigned === staffId) {
        delete rest.tableAssignments[table];
        changed = true;
      }
    }
    if (!changed) return false;
    await writeJson(RESTAURANTS_FILE, restaurants);
    if (supabase) {
      trackSupabaseWrite(
        cloudWriteTolerant('restaurants', [{ id: rest.id, profile: rest }], { match: { id: rest.id } }).then((r) => {
          if (!r.ok && !r.skipped) throw new Error(r.error || 'table assignments update failed');
          return r;
        }),
        'Remove Staff Table Assignments'
      );
    }
    return true;
  },

  /**
   * Actualiza SOLO el mapa de mesas del local. No toca `updatedAt` a propósito:
   * una asignación operativa no es una edición de carta y no debe provocar un
   * 409 `MENU_CONCURRENCY_CONFLICT` en el autosave que el dueño tenga abierto.
   */
  async updateTableAssignments(restaurantId, assignments) {
    if (!restaurantId) return null;
    const restaurants = readJson(RESTAURANTS_FILE, []);
    const rest = restaurants.find((r) => r && r.id === restaurantId);
    if (!rest) return null;
    rest.tableAssignments = assignments && typeof assignments === 'object' ? assignments : {};
    await writeJson(RESTAURANTS_FILE, restaurants);
    if (supabase) {
      trackSupabaseWrite(
        cloudWriteTolerant('restaurants', [{ id: rest.id, profile: rest }], { match: { id: rest.id } }).then((r) => {
          if (!r.ok && !r.skipped) throw new Error(r.error || 'table assignments update failed');
          return r;
        }),
        'Update Table Assignments'
      );
    }
    return rest;
  },

  async listStaffSessions({ restaurantId, staffId, activeOnly = false } = {}) {
    const local = readJson(STAFF_SESSIONS_FILE, [])
      .map(normalizeStaffSessionRow)
      .filter((s) => s
        && (!restaurantId || s.restaurantId === restaurantId)
        && (!staffId || s.staffId === staffId));
    const cloud = await fetchCloudStaffSessionRows({ restaurantId, staffId });
    const merged = mergeStaffSessions(local, cloud)
      .map(normalizeStaffSessionRow)
      .filter((s) => s
        && (!restaurantId || s.restaurantId === restaurantId)
        && (!staffId || s.staffId === staffId));
    return activeOnly ? merged.filter((s) => isActiveStaffSessionRow(s)) : merged;
  },

  async createStaffSession(session) {
    const row = normalizeStaffSessionRow(session);
    if (!row || !row.staffId || !row.restaurantId || !row.tokenHash) return null;
    return withStaffSessionLock(async () => {
      const rows = readJson(STAFF_SESSIONS_FILE, []);
      if (!rows.some((s) => s && s.id === row.id)) rows.unshift(row);
      await writeJson(STAFF_SESSIONS_FILE, rows);
      if (supabase) {
        trackSupabaseWrite(
          cloudWriteTolerant('staff_sessions', [toCloudStaffSessionRow(row)], { onConflict: 'id' }).then((r) => {
            if (!r.ok && !r.skipped) throw new Error(r.error || 'staff session insert failed');
            return r;
          }),
          'Create Staff Session'
        );
      }
      return row;
    });
  },

  async findStaffSessionByTokenHash(tokenHash) {
    if (!tokenHash) return null;
    const local = readJson(STAFF_SESSIONS_FILE, [])
      .find((s) => s && (s.tokenHash === tokenHash || s.token_hash === tokenHash));
    if (local) return normalizeStaffSessionRow(local);
    if (!supabase) return null;
    try {
      const { data, error } = await supabase
        .from('staff_sessions')
        .select('*')
        .eq('token_hash', tokenHash)
        .limit(1);
      if (error || !data || !data.length) return null;
      const row = normalizeStaffSessionRow(data[0]);
      if (!row) return null;
      await withStaffSessionLock(async () => {
        const rows = readJson(STAFF_SESSIONS_FILE, []);
        if (!rows.some((s) => s && s.id === row.id)) {
          rows.push(row);
          await writeJson(STAFF_SESSIONS_FILE, rows);
        }
      });
      return row;
    } catch (e) {
      return null;
    }
  },

  async endStaffSession(sessionId, endedAt) {
    if (!sessionId) return null;
    const stamp = endedAt || new Date().toISOString();
    return withStaffSessionLock(async () => {
      const rows = readJson(STAFF_SESSIONS_FILE, []);
      const row = rows.find((s) => s && s.id === sessionId);
      if (row) {
        row.endedAt = stamp;
        await writeJson(STAFF_SESSIONS_FILE, rows);
      }
      if (supabase) {
        trackSupabaseWrite(
          supabase.from('staff_sessions').update({ ended_at: stamp }).eq('id', sessionId),
          'End Staff Session'
        );
      }
      return row ? normalizeStaffSessionRow(row) : null;
    });
  },

  async revokeStaffSessions(staffId, restaurantId) {
    if (!staffId) return { revoked: 0 };
    const stamp = new Date().toISOString();
    return withStaffSessionLock(async () => {
      const rows = readJson(STAFF_SESSIONS_FILE, []);
      let revoked = 0;
      for (const row of rows) {
        if (!row || row.staffId !== staffId && row.staff_id !== staffId) continue;
        if (restaurantId && row.restaurantId !== restaurantId && row.restaurant_id !== restaurantId) continue;
        if (!row.revokedAt && !row.revoked_at) {
          row.revokedAt = stamp;
          revoked++;
        }
      }
      if (revoked) await writeJson(STAFF_SESSIONS_FILE, rows);
      if (supabase) {
        let query = supabase.from('staff_sessions').update({ revoked_at: stamp }).eq('staff_id', staffId);
        if (restaurantId) query = query.eq('restaurant_id', restaurantId);
        trackSupabaseWrite(Promise.resolve(query), 'Revoke Staff Sessions');
      }
      return { revoked };
    });
  },

  async touchStaffSession(sessionId, patch = {}) {
    if (!sessionId) return null;
    return withStaffSessionLock(async () => {
      const rows = readJson(STAFF_SESSIONS_FILE, []);
      const row = rows.find((s) => s && s.id === sessionId);
      if (row) {
        row.lastSeenAt = patch.lastSeenAt || new Date().toISOString();
        if (patch.expiresAt) row.expiresAt = patch.expiresAt;
        await writeJson(STAFF_SESSIONS_FILE, rows);
      }
      if (supabase) {
        const cloudPatch = { last_seen_at: patch.lastSeenAt || new Date().toISOString() };
        if (patch.expiresAt) cloudPatch.expires_at = patch.expiresAt;
        trackSupabaseWrite(
          supabase.from('staff_sessions').update(cloudPatch).eq('id', sessionId),
          'Touch Staff Session'
        );
      }
      return row ? normalizeStaffSessionRow(row) : null;
    });
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

  // ── Reservas de verdad (backlog #2, oct-2026) ─────────────────────────────
  // Las reservas viven DENTRO del documento del local (`restaurant.reservations[]`)
  // y viajan a Supabase en la columna `profile` (JSONB de la 008): cero
  // migración, misma vía dual-write que branches. El array es SERVER-OWNED —
  // `reservations` está en PRIVILEGED_FIELDS, así que el autosave del Studio
  // jamás lo pisa con un snapshot vago.
  //
  // Mutex en proceso: igual que addOrder, el read-modify-write del documento
  // no es transaccional por más que writeJson sea atómico por archivo. En v2
  // el chequeo de capacidad vive DENTRO del mutex (check+escritura atómicos
  // en este proceso) y el race cross-replica lo cierra la RPC de la 011.

  /**
   * v2 (migración 011): alta de reserva con capacidad ATÓMICA.
   * 1. Con cloud: intenta la RPC `claim_reservation_slot` — re-cuenta las
   *    reservas activas del DOC ACTUAL bajo advisory lock (restaurante+fecha)
   *    y, si hay lugar, agrega la reserva en la MISMA sentencia (jsonb_set).
   *    Cierra el race cross-replica del v1 (dos POST para la misma franja).
   *    NOT_FOUND / INVALID_* / error de red → degradación honesta al path local.
   * 2. Path local (o tras un claim cloud exitoso para el espejo): read-modify-
   *    write bajo el mutex de proceso. Con `opts.slotInput` RE-CHEQUEA la
   *    capacidad DENTRO del mutex (check+escritura atómicos en este proceso).
   * @param {object} opts { config, slotInput, skipCloudClaim }
   *   - config: reservationConfig del local (para el re-chequeo local).
   *   - slotInput: el value parseado del alta ({date,time}) — habilita el
   *     re-chequeo in-mutex.
   *   - skipCloudClaim: salta la RPC (usado cuando el claim ya decidió).
   * @returns {Promise<{success, reservation?, restaurant?, error?, code?, reason?, mode?}>}
   *   code 'SLOT_UNAVAILABLE' (con reason SLOT_FULL|BUFFER_TOO_CLOSE) cuando
   *   la franja no tiene lugar — el route lo mapea a 409 público único.
   */
  async addReservation(restaurantId, reservation, opts = {}) {
    if (!restaurantId || !reservation || !reservation.id) {
      return { success: false, error: 'Reserva inválida' };
    }
    const resvModule = require('../../api/utils/reservations');
    const { trimReservationsList, MAX_RESERVATIONS, assertSlotAvailable } = resvModule;

    // ── 1) Cloud primero: capacidad + alta en UNA sentencia (011) ─────────
    if (supabase && !opts.skipCloudClaim) {
      const claimed = await claimReservationSlotInCloud(restaurantId, reservation, opts.config);
      if (!claimed.unavailable) {
        if (claimed.ok) {
          // La nube YA tiene la reserva (el claim la agregó al doc atómicamente):
          // solo hidratar el espejo local, SIN re-escribir el doc cloud (un
          // whole-doc write desde el espejo pisaría un claim concurrente).
          const mirrored = await runReservationMirrorWrite(restaurantId, reservation, trimReservationsList, MAX_RESERVATIONS);
          if (!mirrored.success && mirrored.error === 'Restaurante no encontrado') return mirrored;
          return { success: true, restaurant: mirrored.restaurant, reservation, mode: 'cloud' };
        }
        return {
          success: false,
          error: 'Esa franja ya no tiene lugar disponible',
          code: 'SLOT_UNAVAILABLE',
          reason: claimed.reason || 'SLOT_FULL',
          mode: 'cloud'
        };
      }
      // unavailable → cae al path local (mismo contrato que v1, con re-chequeo)
    }

    // ── 2) Path local: mutex de proceso + re-chequeo in-mutex ─────────────
    const run = async () => {
      const rests = readJson(RESTAURANTS_FILE, []);
      const rest = rests.find(r => r.id === restaurantId);
      if (!rest) return { success: false, error: 'Restaurante no encontrado' };
      if (!Array.isArray(rest.reservations)) rest.reservations = [];
      if (opts.slotInput) {
        // v2: el chequeo vive DENTRO del mutex — el check+escritura del MISMO
        // proceso ya no puede sobrecargar la franja (v1 lo hacía fuera).
        const slot = assertSlotAvailable(rest.reservations, opts.slotInput, opts.config);
        if (!slot.ok) {
          return {
            success: false,
            error: 'Esa franja ya no tiene lugar disponible',
            code: 'SLOT_UNAVAILABLE',
            reason: slot.reason
          };
        }
      }
      rest.reservations.push(reservation);
      if (rest.reservations.length > MAX_RESERVATIONS) {
        rest.reservations = trimReservationsList(rest.reservations, MAX_RESERVATIONS);
      }
      await writeJson(RESTAURANTS_FILE, rests);
      if (supabase) {
        trackSupabaseWrite(
          supabase.from('restaurants').update({
            profile: rest,
            updated_at: new Date().toISOString()
          }).eq('id', restaurantId),
          'Add Reservation'
        );
      }
      return { success: true, restaurant: rest, reservation };
    };
    reservationWriteLock = reservationWriteLock.then(run, run);
    return reservationWriteLock;
  },

  /** Lectura de una reserva del local (sin lock: solo lectura). */
  findReservationById(restaurantId, reservationId) {
    if (!restaurantId || !reservationId) return null;
    const rest = readJson(RESTAURANTS_FILE, []).find(r => r.id === restaurantId);
    if (!rest || !Array.isArray(rest.reservations)) return null;
    return rest.reservations.find(r => r && r.id === reservationId) || null;
  },

  /**
   * Aplica una transición de estado YA VALIDADA por el módulo puro (la
   * máquina vive en api/utils/reservations.transitionReservationStatus —
   * db.js no puede requerir api/utils para la decisión por el guard D, pero
   * SÍ la usa acá porque el require es lazy dentro del método y el route la
   * consultó antes). Persiste espejo local + nube (profile).
   */
  async updateReservationStatus(restaurantId, reservationId, patch, statusUpdatedAt) {
    const { RESERVATION_STATUSES } = require('../../api/utils/reservations');
    if (
      !restaurantId || !reservationId || !patch ||
      !RESERVATION_STATUSES.includes(patch.status)
    ) {
      return { success: false, error: 'Datos de transición inválidos', code: 'INVALID_RESERVATION_STATUS' };
    }
    const run = async () => {
      const rests = readJson(RESTAURANTS_FILE, []);
      const rest = rests.find(r => r.id === restaurantId);
      if (!rest) return { success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' };
      if (!Array.isArray(rest.reservations)) rest.reservations = [];
      const idx = rest.reservations.findIndex(r => r && r.id === reservationId);
      if (idx === -1) {
        return { success: false, error: 'Reserva no encontrada', code: 'RESERVATION_NOT_FOUND' };
      }
      const current = rest.reservations[idx];
      const { transitionReservationStatus } = require('../../api/utils/reservations');
      const check = transitionReservationStatus(current.status, patch.status);
      if (!check.ok) {
        return { success: false, error: 'La reserva no puede pasar a ese estado', code: check.reason };
      }
      const updated = {
        ...current,
        status: patch.status,
        statusUpdatedAt: statusUpdatedAt || new Date().toISOString(),
        updatedAt: statusUpdatedAt || new Date().toISOString()
      };
      // El motivo solo se persiste al cancelar (y nunca limpia uno previo).
      if (patch.status === 'cancelled') {
        updated.cancelReason = patch.cancelReason
          ? String(patch.cancelReason).slice(0, 200)
          : (current.cancelReason || 'Cancelada por el local');
      }
      rest.reservations[idx] = updated;
      await writeJson(RESTAURANTS_FILE, rests);
      if (supabase) {
        trackSupabaseWrite(
          supabase.from('restaurants').update({
            profile: rest,
            updated_at: new Date().toISOString()
          }).eq('id', restaurantId),
          'Update Reservation Status'
        );
      }
      return { success: true, restaurant: rest, reservation: updated };
    };
    reservationWriteLock = reservationWriteLock.then(() => run(), () => run());
    return reservationWriteLock;
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
  /**
   * Listado completo cross-réplica (nube paginada ∪ espejo local, caché 60 s).
   * Usarlo SOLO en consumidores que necesitan TODOS los locales (crons,
   * sitemap/ciudades, Descubrir, overview, unicidad de slug). El hot path
   * conserva la hydratación puntual por slug/userId/id.
   */
  async getAllRestaurantsAsync(opts) {
    return _getAllRestaurantsAsync(opts);
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
        // Takeaway Programado (73ª): el día de venta es el día del RETIRO.
        // COALESCE(scheduled_for, created_at) no se expresa directo en
        // PostgREST → dos ramas AND dentro del OR: (a) retiro dentro de la
        // ventana, (b) pedido inmediato (scheduled_for NULL) creado dentro de
        // la ventana. Un pre-order de OTRA fecha no entra por ninguna rama.
        // Si la nube todavía no tiene la 013 (columna rechazada), degrada al
        // SQL de created_at.
        const tryScheduled = async () => supabase
          .from('orders')
          .select('id, items_snapshot, status, created_at')
          .eq('restaurant_id', restaurantId)
          .or(
            `and(scheduled_for.gte.${startIso},scheduled_for.lt.${endIso}),` +
            `and(created_at.gte.${startIso},created_at.lt.${endIso},scheduled_for.is.null)`
          );
        let rows, err;
        try {
          const res = await tryScheduled();
          rows = res.data; err = res.error;
        } catch (e) { rows = null; err = e; }
        if (err && /scheduled_for/i.test(err.message || '')) {
          const res = await supabase
            .from('orders')
            .select('id, items_snapshot, status, created_at')
            .eq('restaurant_id', restaurantId)
            .gte('created_at', startIso)
            .lt('created_at', endIso);
          rows = res.data; err = res.error;
        }
        if (err) throw err;
        cloudRows = Array.isArray(rows) ? rows : [];
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
      // Espejo: mismo re-anclaje al instante de retiro (dual camel/snake).
      const fulfillIso = localRow.scheduled_for != null ? localRow.scheduled_for
        : (localRow.scheduledFor != null ? localRow.scheduledFor : (localRow.created_at || localRow.createdAt));
      const ts = Date.parse(fulfillIso || '');
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
      const attempt = async (columns, excludeScheduled) => {
        let q = supabase
          .from('orders')
          .select(columns)
          .eq('restaurant_id', restaurantId)
          .gte('created_at', startIso)
          .lt('created_at', endIso)
          .limit(1000);
        // Takeaway Programado (73ª): los programados NO miden cocina (el
        // reloj arranca cuando la comanda despierta, que acá no existe).
        // Cláusula aparte, con la misma degradación honesta si falta la 013.
        if (excludeScheduled) q = q.is('scheduled_for', null);
        return q;
      };
      try {
        // F7-v2: `order_mode` viaja junto a los timestamps (migración 009) para
        // estimar POR MODALIDAD sin una segunda consulta. Degradación honesta
        // de a UNA columna por intento: una nube puede deberse la 004, la 009
        // o ambas — el espejo local sigue aportando sus filas y sin la columna
        // la modalidad degrada a LOCAL (asunción legacy de la casa).
        let columns = `${baseColumns}, status_updated_at, order_mode`;
        let res = await attempt(columns, true);
        let data = res.data;
        let error = res.error;
        for (let tries = 0; error && tries < 4 && /status_updated_at|order_mode/i.test(error.message || ''); tries++) {
          if (/status_updated_at/i.test(error.message || '')) columns = columns.replace(', status_updated_at', '');
          else if (/order_mode/i.test(error.message || '')) columns = columns.replace(', order_mode', '');
          res = await attempt(columns, true);
          data = res.data;
          error = res.error;
        }
        // Takeaway Programado: una nube sin la 013 rechaza la exclusión →
        // reintenta SIN la cláusula (igualmente no tiene filas programadas:
        // el dual-write se las quitó con cloudWriteTolerant). El espejo local
        // SIEMPRE filtra las suyas (la nube no borra lo que el espejo sí tiene).
        if (error && /scheduled_for/i.test(error.message || '')) {
          res = await attempt(columns, false);
          data = res.data;
          error = res.error;
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
      // Takeaway Programado: un pedido programado aún no midió cocina (su
      // reloj arranca cuando la comanda despierta, no al crear).
      const scheduledIso = localRow.scheduled_for != null ? localRow.scheduled_for : localRow.scheduledFor;
      if (scheduledIso != null) continue;
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
      const merged = (!cloudFinished && localFinished) ? { ...row, status_updated_at: localFinished } : row;
      // F7-v2: si la nube va detrás de la 009, el espejo aporta la modalidad
      // (mismo espíritu del timestamp: la nube no borra lo que el espejo sí tiene).
      const cloudMode = row.order_mode !== undefined ? row.order_mode : row.orderMode;
      if (cloudMode === undefined || cloudMode === null) {
        const localMode = local.order_mode !== undefined ? local.order_mode : local.orderMode;
        if (localMode !== undefined && localMode !== null) merged.order_mode = localMode;
      }
      byId.set(key, merged);
    }
    return [...byId.values()];
  },

  // Takeaway Programado (73ª): filas de pedidos programados (scheduled_for
  // no null) cerca de un instante, para contar la capacidad del slot contra
  // `maxPerSlot`. Unión nube ∪ espejo por id (patrón El Cierre/F3): un
  // pedido cuyo dual-write fue rechazado en cloud NO libera su cupo de la
  // franja en silencio (la cocina contaría 3 de 4 aunque el dueño vea 4).
  // Degrada a espejo si la 013 no está aplicada; el llamador hace el conteo
  // con `countOrdersInSlot` (puro). Ventana ±6h alrededor del retiro.
  async getSlotOrdersNear(restaurantId, scheduledForIso) {
    if (!restaurantId || !scheduledForIso) return [];
    const target = Date.parse(String(scheduledForIso));
    if (Number.isNaN(target)) return [];
    const nearIso = (ms) => new Date(ms).toISOString();
    const startMs = target - 6 * 3600000;
    const endMs = target + 6 * 3600000;
    const byId = new Map();
    for (const localRow of readJson(ORDERS_FILE, [])) {
      if (!localRow || !localRow.id) continue;
      const rid = localRow.restaurant_id || localRow.restaurantId;
      if (rid !== restaurantId) continue;
      const iso = localRow.scheduled_for != null ? localRow.scheduled_for : localRow.scheduledFor;
      const ms = Date.parse(String(iso || ''));
      if (Number.isNaN(ms) || ms < startMs || ms >= endMs) continue;
      byId.set(String(localRow.id), localRow);
    }
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('id, status, scheduled_for, created_at')
          .eq('restaurant_id', restaurantId)
          .not('scheduled_for', 'is', null)
          .gte('scheduled_for', nearIso(startMs))
          .lt('scheduled_for', nearIso(endMs));
        if (error && /scheduled_for/i.test(error.message || '')) {
          // Nube sin la 013: no tiene filas programadas → el espejo es la
          // verdad de ese instante (degradación honesta, warn visible arriba).
        } else if (error) {
          throw error;
        } else if (Array.isArray(data)) {
          for (const row of data) {
            if (row && row.id) byId.set(String(row.id), row);
          }
        }
      } catch (err) {
        console.warn('[DB] getSlotOrdersNear cloud no disponible (espejo local:', (err && err.message) || err, ')');
      }
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
      // F0 Mozos/Cocina: modalidad del pedido para la pizarra. Fallback LOCAL
      // para pedidos viejos/sintéticos que no traían el campo.
      order_mode: orderRecord.order_mode || orderRecord.orderMode || 'LOCAL',
      items_snapshot: orderRecord.items_snapshot,
      amount: orderRecord.amount,
      amount_in_cents: orderRecord.amount_in_cents,
      currency: orderRecord.currency,
      status: orderRecord.status,
      customer_name: orderRecord.customer_name,
      customer_phone: orderRecord.customer_phone,
      // Trazabilidad del equipo (Fase 1): quién tomó el pedido y desde qué
      // mesa. En pedidos del comensal viajan null; el comandero del mozo las
      // completa. `source` distingue el origen sin inferirlo por el canal.
      waiter_id: orderRecord.waiter_id || orderRecord.waiterId || null,
      table_id: orderRecord.table_id || orderRecord.tableId || null,
      source: orderRecord.source || 'customer',
      // Takeaway Programado (73ª suite): instante de retiro programado + el
      // lead USADO en el alta. El lead DEBE vivir en cloud: el KDS puede caer
      // en otra réplica de Vercel y el espejo local (/tmp) es efímero, así que
      // sin este campo `wakeAt` no existe fuera de la instancia que creó el
      // pedido (la comanda no despertaría antes del retiro). null en pedidos
      // inmediatos/históricos; la nube sin la 013 degrada vía
      // cloudWriteTolerant y el espejo conserva el dato (camel/snake).
      scheduled_for: orderRecord.scheduled_for || orderRecord.scheduledFor || null,
      scheduled_lead_minutes: orderRecord.scheduled_lead_minutes != null
        ? orderRecord.scheduled_lead_minutes
        : (orderRecord.scheduledLeadMinutes != null ? orderRecord.scheduledLeadMinutes : null),
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
  resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants, opts = {}) {
    return resolveHydrationData(cloudUsers, localUsers, cloudRestaurants, localRestaurants, opts);
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
   * restaurante y TODOS los datos asociados — nube (Supabase) y local (JSON).
   *
   * ORDEN CRÍTICO (P0-2): la nube primero y VERIFICADA. Antes el borrado local
   * se hacía aunque el DELETE cloud fallara: la respuesta era 200 "borrado" y
   * el próximo boot resucitaba la cuenta desde la nube. Ahora, si la nube no
   * confirma, se lanza `ACCOUNT_DELETE_FAILED` (503 en la ruta) sin tocar el
   * espejo local. El usuario cloud NO se borra: se reemplaza por un TOMBSTONE
   * sin PII (email `deleted+<id>@deleted.invalid`), porque una fila ausente no
   * impide que una réplica con el JSON viejo siga autenticando.
   *
   * No borra: la tabla `audit_logs` (registro de procesamiento propio) ni la
   * tabla `webhooks` cloud (registro contable de pagos). Tampoco toca
   * `customer_profiles` (identidad global del comensal): su borrado es otro
   * derecho, del comensal.
   * Idempotente: si no existe nada, no falla.
   *
   * @param {string} userId - ID del dueño
   * @param {string|null} restaurantId - ID de su restaurante (si existe)
   * @returns {Promise<{usersRemoved: number, restaurantsRemoved: number}>}
   */
  async deleteRestaurantData(userId, restaurantId) {
    // Primero drena las escrituras pendientes a la nube: un upsert encolado
    // hace 1 s podría re-insertar el restaurante DESPUÉS de borrarlo.
    await this.flushCloudWrites();

    const localUsers = readJson(USERS_FILE, []);
    const localUser = localUsers.find((u) => u && u.id === userId) || null;
    const localRestaurants = readJson(RESTAURANTS_FILE, []);
    const restaurantIds = new Set();
    if (restaurantId) restaurantIds.add(String(restaurantId));
    for (const r of localRestaurants) {
      if (!r || !r.id) continue;
      if (String(r.id) === String(restaurantId) || r.userId === userId || r.user_id === userId) {
        restaurantIds.add(String(r.id));
      }
    }

    // ── Cloud primero (fuente de verdad multi-réplica) ─────────────────────
    if (supabase) {
      try {
        // Resolver TODOS los locales del dueño en la nube: una réplica pudo
        // haber creado un local que este JSON todavía no conoce.
        const { data: cloudRests, error: restErr } = await supabase
          .from('restaurants')
          .select('id')
          .eq('user_id', userId);
        if (restErr && !isMissingTableError(restErr)) throw restErr;
        for (const row of (cloudRests || [])) {
          if (row && row.id) restaurantIds.add(String(row.id));
        }

        // Hijos por restaurant_id. Una tabla inexistente (proyecto sin esa
        // migración) no tiene datos que borrar: se tolera. Cualquier otro
        // error aborta y NO se toca nada local.
        for (const rid of restaurantIds) {
          for (const table of [
            'staff_sessions',
            'staff',
            'orders',
            'reviews',
            'customer_feedback',
            'group_carts',
            'push_subscriptions',
            'telemetry_events',
            'notification_events',
            'loyalty_redemptions',
            'loyalty_ledger',
            'loyalty_accounts'
          ]) {
            const { error } = await supabase.from(table).delete().eq('restaurant_id', rid);
            if (error && !isMissingTableError(error)) throw error;
          }
        }

        // Restaurantes: por id (explícito) y por user_id (cubre réplicas con
        // locales que este JSON no conoce). El tombstone es un UPDATE, así que
        // NO dispara el ON DELETE CASCADE de la FK: hay que borrarlos a mano.
        if (restaurantIds.size) {
          const { error } = await supabase
            .from('restaurants')
            .delete()
            .in('id', [...restaurantIds]);
          if (error && !isMissingTableError(error)) throw error;
        }
        const { error: delByUserErr } = await supabase
          .from('restaurants')
          .delete()
          .eq('user_id', userId);
        if (delByUserErr && !isMissingTableError(delByUserErr)) throw delByUserErr;

        // Verificación: no puede quedar NINGÚN local del dueño.
        const { data: leftover, error: checkErr } = await supabase
          .from('restaurants')
          .select('id')
          .eq('user_id', userId);
        if (checkErr && !isMissingTableError(checkErr)) throw checkErr;
        if (Array.isArray(leftover) && leftover.length > 0) {
          throw new Error(`Quedaron ${leftover.length} restaurantes sin borrar`);
        }

        // Tombstone sin PII + verificación de que se persistió. Si la fila no
        // existe en cloud no hay nada que resucitar (la verificación lo acepta).
        const tombstone = buildUserTombstone(localUser || { id: userId });
        const { error: tombErr } = await supabase
          .from('users')
          .update({
            email: tombstone.email,
            password: tombstone.password,
            name: '',
            email_confirmed_at: null,
            updated_at: tombstone.updatedAt
          })
          .eq('id', userId);
        if (tombErr && !isMissingTableError(tombErr)) throw tombErr;

        const { data: checkUser, error: checkUserErr } = await supabase
          .from('users')
          .select('id,email')
          .eq('id', userId)
          .limit(1)
          .maybeSingle();
        if (checkUserErr && !isMissingTableError(checkUserErr)) throw checkUserErr;
        if (checkUser && !isTombstoneEmail(checkUser.email)) {
          throw new Error('El tombstone del usuario no se persistió en la nube');
        }
      } catch (e) {
        const err = new Error(`No se pudo completar el borrado en la nube: ${e.message || String(e)}`);
        err.code = 'ACCOUNT_DELETE_FAILED';
        err.cause = e;
        throw err;
      }
    }

    // ── Local JSON (solo después de que la nube confirmó) ──────────────────
    // El tombstone local se CONSERVA: aunque la nube esté caída en el próximo
    // request, un token viejo no puede volver a autenticar contra el espejo.
    const tombstone = buildUserTombstone(localUser || { id: userId });
    const nextUsers = localUsers.some((u) => u && u.id === userId)
      ? localUsers.map((u) => (u && u.id === userId ? { ...tombstone } : u))
      : [...localUsers, tombstone];
    await writeJson(USERS_FILE, nextUsers);
    invalidateUserFreshCache(userId);

    const belongsToRestaurant = (row) => {
      if (!row || typeof row !== 'object') return false;
      const rid = row.restaurantId || row.restaurant_id;
      return Boolean(rid) && restaurantIds.has(String(rid));
    };

    const removedRestaurants = localRestaurants.filter(
      (r) => r && r.id && restaurantIds.has(String(r.id))
    ).length;
    await writeJson(
      RESTAURANTS_FILE,
      localRestaurants.filter(
        (r) => r && r.id !== restaurantId && r.userId !== userId && r.user_id !== userId
      )
    );

    const reviewsFile = path.join(DATA_DIR, 'reviews.json');
    await writeJson(reviewsFile, readJson(reviewsFile, []).filter((r) => !belongsToRestaurant(r)));

    const feedbackFile = path.join(DATA_DIR, 'feedback.json');
    await writeJson(feedbackFile, readJson(feedbackFile, []).filter((f) => !belongsToRestaurant(f)));

    const tokensFile = path.join(DATA_DIR, 'reset_tokens.json');
    await writeJson(
      tokensFile,
      readJson(tokensFile, []).filter((t) => t && t.userId !== userId && t.user_id !== userId)
    );

    const hooksFile = path.join(DATA_DIR, 'webhooks.json');
    await writeJson(
      hooksFile,
      readJson(hooksFile, []).filter((h) => {
        if (!h || !h.data) return true;
        const rid = h.data.restaurant_id || h.data.restaurantId;
        return !rid || !restaurantIds.has(String(rid));
      })
    );

    const ordersFile = path.join(DATA_DIR, 'orders.json');
    await writeJson(ordersFile, readJson(ordersFile, []).filter((o) => !belongsToRestaurant(o)));

    // Equipo operativo: sesiones y personas del local. El token de sesión y el
    // hash de credencial son datos del dueño → caen con su cuenta.
    await writeJson(
      STAFF_SESSIONS_FILE,
      readJson(STAFF_SESSIONS_FILE, []).filter((s) => !belongsToRestaurant(s))
    );
    await writeJson(
      STAFF_FILE,
      readJson(STAFF_FILE, []).filter((s) => !belongsToRestaurant(s))
    );

    // Dispositivos nativos y avisos: pertenecen al usuario o a su local.
    const deviceTokensFile = path.join(DATA_DIR, 'device_tokens.json');
    await writeJson(
      deviceTokensFile,
      readJson(deviceTokensFile, []).filter((d) => d && d.userId !== userId)
    );

    const pushSubsFile = path.join(DATA_DIR, 'push_subscriptions.json');
    await writeJson(
      pushSubsFile,
      readJson(pushSubsFile, []).filter(
        (s) => s && s.userId !== userId && !belongsToRestaurant(s)
      )
    );

    const notificationEventsFile = path.join(DATA_DIR, 'notification_events.json');
    await writeJson(
      notificationEventsFile,
      readJson(notificationEventsFile, []).filter(
        (e) => e && e.userId !== userId && !belongsToRestaurant(e)
      )
    );

    // Ledger y cupones del local. El ledger GLOBAL del comensal
    // (`restaurant_id` NULL) NO se toca: es de la red, no del dueño.
    for (const file of [
      'recovery_coupons.json',
      'loyalty_accounts.json',
      'loyalty_ledger.json',
      'loyalty_redemptions.json'
    ]) {
      const target = path.join(DATA_DIR, file);
      await writeJson(target, readJson(target, []).filter((row) => !belongsToRestaurant(row)));
    }

    return { usersRemoved: 1, restaurantsRemoved: removedRestaurants };
  }
};

module.exports = db;
