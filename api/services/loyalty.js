/**
 * api/services/loyalty.js
 * ────────────────────────
 * Fidelización DUAL — "Club ScanGo":
 *
 *   1. LOCAL (por restaurante): puntos + sellos de visita + catálogo de premios
 *      configurables en `restaurant.loyaltyConfig`. Se acredita automáticamente
 *      al registrar un pedido (`/api/orders`) y manualmente por el dueño
 *      (`/api/loyalty/credit`).
 *   2. GLOBAL (red SaaS cross-restaurant): el comensal acumula historia y
 *      reputación por comprar en diferentes locales de la plataforma. Niveles
 *      Bronce→Platino, insignias automáticas y beneficios globales canjeables
 *      en CUALQUIER local de la red.
 *
 * Identidad unificada: teléfono normalizado (E.164) como clave primaria —
 * coincide con el flujo de pedidos por WhatsApp y es la identidad natural del
 * mercado. Privacy-first: consentimiento explícito (`consentMarketing`), nunca
 * se loguea el teléfono crudo (se usa `maskPhone`), y hay borrado total de
 * datos (`eraseCustomerData`, estilo RGPD / Ley 18.331 UY).
 *
 * Persistencia: JSON local en `data/` (fuente de verdad por instancia, atómica
 * vía `db.writeJson`) + replicación fire-and-forget a Supabase con `service_role`
 * (tablas de la migración 003, RLS FORCE). La fidelización NUNCA rompe el flujo
 * del pedido: `creditOrder` captura y registra sus propios errores.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const AppError = require('../utils/AppError');
const sentry = require('../utils/sentry');
const logger = require('../utils/logger');

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch (e) {}
}

// ─────────────────────────────────────────────────────────────────────────────
// Colecciones locales (un JSON por tabla; mapeo local-camel ↔ cloud-snake)
// ─────────────────────────────────────────────────────────────────────────────
const COLLECTIONS = {
  customers: {
    file: 'customer_profiles.json',
    table: 'customer_profiles',
    map: {
      id: 'id', phone: 'phone', phoneHash: 'phone_hash', name: 'name',
      email: 'email', consentPush: 'consent_push', consentMarketing: 'consent_marketing',
      globalVisits: 'global_visits', globalPoints: 'global_points',
      restaurantsVisited: 'restaurants_visited', levelId: 'level_id', badges: 'badges',
      firstSeenAt: 'first_seen_at', lastSeenAt: 'last_seen_at',
      createdAt: 'created_at', updatedAt: 'updated_at'
    }
  },
  accounts: {
    file: 'loyalty_accounts.json',
    table: 'loyalty_accounts',
    map: {
      id: 'id', customerId: 'customer_id', restaurantId: 'restaurant_id',
      points: 'points', stamps: 'stamps', visits: 'visits',
      levelId: 'level_id', lastVisitAt: 'last_visit_at',
      createdAt: 'created_at', updatedAt: 'updated_at'
    }
  },
  ledger: {
    file: 'loyalty_ledger.json',
    table: 'loyalty_ledger',
    map: {
      id: 'id', customerId: 'customer_id', restaurantId: 'restaurant_id',
      kind: 'kind', pointsDelta: 'points_delta', stampsDelta: 'stamps_delta',
      reason: 'reason', refId: 'ref_id', metadata: 'metadata', createdAt: 'created_at'
    }
  },
  redemptions: {
    file: 'loyalty_redemptions.json',
    table: 'loyalty_redemptions',
    map: {
      id: 'id', code: 'code', customerId: 'customer_id', restaurantId: 'restaurant_id',
      rewardId: 'reward_id', rewardTitle: 'reward_title', rewardValue: 'reward_value',
      pointsCost: 'points_cost', status: 'status', redeemedAt: 'redeemed_at',
      redeemedByRestaurantId: 'redeemed_by_restaurant_id', createdAt: 'created_at'
    }
  }
};

function readCollection(key) {
  const file = path.join(DATA_DIR, COLLECTIONS[key].file);
  if (!fs.existsSync(file)) return [];
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}

async function writeCollection(key, rows) {
  return db.writeJson(path.join(DATA_DIR, COLLECTIONS[key].file), rows);
}

function toCloudRow(key, local) {
  const map = COLLECTIONS[key].map;
  const row = {};
  for (const localKey of Object.keys(map)) {
    const val = local[localKey];
    row[map[localKey]] = val === undefined ? null : val;
  }
  return row;
}

function replicateUpsert(key, rows) {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    supabase.from(COLLECTIONS[key].table).upsert(rows.map(r => toCloudRow(key, r)), { onConflict: 'id' })
      .then(() => {}, (e) => logger.warn(`[Supabase ${COLLECTIONS[key].table} Upsert Warning]`, { details: e.message }));
  } catch (e) {
    logger.warn(`[Supabase ${COLLECTIONS[key].table} Upsert Warning]`, { details: e.message });
  }
}

function replicateDelete(key, column, value) {
  const supabase = getSupabaseClient();
  if (!supabase) return;
  try {
    supabase.from(COLLECTIONS[key].table).delete().eq(column, value)
      .then(() => {}, (e) => logger.warn(`[Supabase ${COLLECTIONS[key].table} Delete Warning]`, { details: e.message, column }));
  } catch (e) {
    logger.warn(`[Supabase ${COLLECTIONS[key].table} Delete Warning]`, { details: e.message, column });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers puros (exportados para tests)
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Normaliza un teléfono a dígitos E.164-ish (sin +/espacios/guiones).
 * Convierte prefijo 00 → +. Devuelve null si no parece un teléfono válido.
 */
function normalizePhone(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

/** Enmascara un teléfono para logs/UI nunca expone el número crudo. */
function maskPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  if (normalized.length <= 5) return '*'.repeat(normalized.length);
  return normalized.slice(0, 3) + '***' + normalized.slice(-2);
}

/** SHA-256 del teléfono: identificador no reversible para auditoría. */
function hashPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return '';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// ─────────────────────────────────────────────────────────────────────────────
// OTP de posesión del canal email (canjes y borrado).
// El teléfono solo es un identificador (cualquiera lo conoce); las acciones
// destructivas (gastar puntos, borrar datos) exigen probar el email del perfil
// con un código de 6 dígitos, ventana de 10 minutos, stateless (HMAC por
// ventana, sin tabla nueva, seguro entre instancias) + caché de un solo uso.
// ─────────────────────────────────────────────────────────────────────────────
const LOYALTY_OTP_WINDOW_MS = 10 * 60 * 1000;
const LOYALTY_OTP_PURPOSES = ['redeem', 'erase', 'change-email'];
const usedLoyaltyOtps = new Map(); // `${phone}|${purpose}|${code}` -> expiraAt

function getLoyaltyOtpSecret() {
  return process.env.ORDER_TRACKING_SECRET
    || process.env.GROUP_CART_SECRET
    || process.env.JWT_SECRET
    || 'dev_secret_menu_pizarron_2026';
}

function loyaltyOtpWindow(at = Date.now()) {
  return Math.floor(at / LOYALTY_OTP_WINDOW_MS);
}

function computeLoyaltyOtp(phone, purpose, window) {
  const hmac = crypto.createHmac('sha256', getLoyaltyOtpSecret());
  hmac.update(`loyalty-otp|${phone}|${purpose}|${window}`);
  const code = parseInt(hmac.digest('hex').slice(0, 8), 16) % 1000000;
  return String(code).padStart(6, '0');
}

/** Genera el OTP vigente (exportado para tests white-box; al comensal le llega por email). */
function generateLoyaltyOtp(phone, purpose) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return computeLoyaltyOtp(normalized, purpose, loyaltyOtpWindow());
}

function verifyLoyaltyOtp(phone, purpose, otp) {
  const normalized = normalizePhone(phone);
  const clean = String(otp || '').replace(/\D/g, '');
  if (!normalized || clean.length !== 6 || !LOYALTY_OTP_PURPOSES.includes(purpose)) return false;
  const current = loyaltyOtpWindow();
  for (const window of [current, current - 1]) {
    const expected = computeLoyaltyOtp(normalized, purpose, window);
    if (expected.length === clean.length
      && crypto.timingSafeEqual(Buffer.from(expected, 'utf8'), Buffer.from(clean, 'utf8'))) {
      const key = `${normalized}|${purpose}|${expected}`;
      if (usedLoyaltyOtps.has(key)) return false;
      usedLoyaltyOtps.set(key, Date.now() + 15 * 60 * 1000);
      if (usedLoyaltyOtps.size > 3000) {
        const now = Date.now();
        for (const [k, exp] of usedLoyaltyOtps) {
          if (exp < now) usedLoyaltyOtps.delete(k);
          if (usedLoyaltyOtps.size < 2000) break;
        }
      }
      return true;
    }
  }
  return false;
}

function maskEmail(email) {
  const clean = String(email || '').trim();
  const at = clean.indexOf('@');
  if (at <= 0) return '***';
  const local = clean.slice(0, at);
  return (local[0] || '*') + '***@' + clean.slice(at + 1);
}

/**
 * Emite un desafío OTP al email del perfil (canje o borrado).
 * Sin cliente o sin email → 422 (primero hay que registrar el email).
 */
async function requestLoyaltyOtp({ phone, purpose }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError('Teléfono inválido', 400, 'INVALID_PHONE');
  if (!LOYALTY_OTP_PURPOSES.includes(purpose)) throw new AppError('Propósito inválido', 400, 'INVALID_OTP_PURPOSE');
  const customer = await findCustomerByPhone(normalized);
  if (!customer) throw new AppError('Cliente no encontrado para este teléfono', 404, 'CUSTOMER_NOT_FOUND');
  if (!customer.email) {
    throw new AppError('Registrá tu email para recibir el código de confirmación', 422, 'CUSTOMER_EMAIL_REQUIRED');
  }
  const otp = generateLoyaltyOtp(normalized, purpose);
  const emailService = require('../services/email');
  const subject = purpose === 'erase'
    ? 'Código para borrar tus datos de Club ScanGo'
    : 'Tu código de canje de Club ScanGo';
  const result = await emailService.sendEmail({
    to: customer.email,
    subject,
    text: `Tu código de confirmación es ${otp}. Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.`
  });
  if (result && result.provider === 'local_mock' && process.env.NODE_ENV === 'production') {
    throw new AppError('Envío de email no configurado', 503, 'EMAIL_NOT_CONFIGURED');
  }
  if (process.env.NODE_ENV !== 'production') {
    logger.warn('[Loyalty OTP dev] desafío emitido (solo desarrollo)', { purpose, maskedEmail: maskEmail(customer.email) });
  }
  return { maskedEmail: maskEmail(customer.email), expiresInMinutes: 10 };
}

/**
 * Registra el email del perfil (solo si aún no tiene: first-write).
 * Cambiar un email existente exige desafío al anterior (anti-takeover).
 */
async function setCustomerEmail({ phone, email, otp }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError('Teléfono inválido', 400, 'INVALID_PHONE');
  const clean = String(email || '').trim().toLowerCase().slice(0, 100);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(clean)) {
    throw new AppError('Email inválido', 400, 'INVALID_EMAIL');
  }
  const customer = await findCustomerByPhone(normalized);
  if (!customer) throw new AppError('Cliente no encontrado para este teléfono', 404, 'CUSTOMER_NOT_FOUND');
  if (customer.email) {
    if (!verifyLoyaltyOtp(normalized, 'change-email', otp)) {
      throw new AppError('Para cambiar el email confirmá el código enviado al anterior', 403, 'EMAIL_CHANGE_OTP_REQUIRED');
    }
  }
  customer.email = clean;
  customer.updatedAt = new Date().toISOString();
  await persistCustomer(customer);
  return { maskedEmail: maskEmail(clean) };
}

const GLOBAL_LEVELS = [
  { id: 'bronce', label: 'Bronce', minVisits: 0, perks: ['Acumulás puntos en todos los locales de la red'] },
  { id: 'plata', label: 'Plata', minVisits: 5, perks: ['5% OFF global en tu próxima orden', 'Insignia Comensal Recurrente'] },
  { id: 'oro', label: 'Oro', minVisits: 15, perks: ['10% OFF global', 'Insignia Embajador de la Red'] },
  { id: 'platino', label: 'Platino', minVisits: 30, perks: ['15% OFF global', 'Acceso anticipado a nuevos locales', 'Insignia Power User'] }
];
const LEVEL_RANK = { bronce: 0, plata: 1, oro: 2, platino: 3 };

function deriveLevel(globalVisits) {
  let level = GLOBAL_LEVELS[0];
  for (const candidate of GLOBAL_LEVELS) {
    if (globalVisits >= candidate.minVisits) level = candidate;
  }
  return level;
}

function deriveBadges({ visits = 0, restaurants = 0 } = {}) {
  const badges = [];
  if (restaurants >= 1) badges.push({ id: 'primera', label: 'Primera visita' });
  if (visits >= 5) badges.push({ id: 'habitual', label: 'Comensal habitual' });
  if (restaurants >= 3) badges.push({ id: 'explorador', label: 'Explorador de la red' });
  if (restaurants >= 5) badges.push({ id: 'embajador', label: 'Embajador de la red' });
  return badges;
}

/** Catálogo global (fijo del SaaS): beneficios canjeables en cualquier local. */
const GLOBAL_REWARDS = [
  { id: 'glob_off5', title: '5% OFF en cualquier local de la red', pointsCost: 800, minLevel: 'plata' },
  { id: 'glob_probe', title: 'Cupón "Probá un local nuevo" (15% OFF primera vez)', pointsCost: 1200, minLevel: 'plata' },
  { id: 'glob_off10', title: '10% OFF en cualquier local de la red', pointsCost: 2500, minLevel: 'oro' }
];

const DEFAULT_REWARDS = [
  { id: 'rew_coffee', title: '☕ Café o Bebida de Bienvenida', pointsCost: 150 },
  { id: 'rew_dessert', title: '🍰 Postre o Copa Helada Gratis', pointsCost: 300 },
  { id: 'rew_main', title: '🍽️ 2x1 en Platos Principales', pointsCost: 500 },
  { id: 'rew_bottle', title: '🍾 Botella de Vino de la Casa', pointsCost: 750 }
];

const DEFAULT_VISIT_REWARD = { id: 'visita_completa', title: '☕ Café o bebida de bienvenida' };

/**
 * Config de fidelización de un restaurante con defaults sólidos.
 * Nunca devuelve valores sensibles (solo lo que el menú público necesita).
 */
function getLoyaltyConfig(restaurant) {
  const cfg = (restaurant && restaurant.loyaltyConfig) || {};
  const rewards = Array.isArray(cfg.rewards) && cfg.rewards.length
    ? cfg.rewards.filter(r => r && r.id && r.title).map(r => ({ id: r.id, title: r.title, pointsCost: Math.max(0, Number(r.pointsCost) || 0) }))
    : DEFAULT_REWARDS;
  return {
    enabled: cfg.enabled !== false,
    pointsPerOrder: Number.isFinite(Number(cfg.pointsPerOrder)) ? Math.max(0, Number(cfg.pointsPerOrder)) : 10,
    pointsPerCurrency: Number.isFinite(Number(cfg.pointsPerCurrency)) ? Math.max(0, Number(cfg.pointsPerCurrency)) : 1,
    autoStampOnOrder: cfg.autoStampOnOrder !== false,
    stampsTarget: Number.isFinite(Number(cfg.stampsTarget)) ? Math.max(1, Number(cfg.stampsTarget)) : 6,
    visitReward: (cfg.visitReward && cfg.visitReward.title) ? { id: cfg.visitReward.id || 'visita_completa', title: cfg.visitReward.title } : DEFAULT_VISIT_REWARD,
    rewards
  };
}

/**
 * La versión pública que viaja en /api/menu/:slug (sin campos de negocio sensibles).
 */
function getPublicLoyaltyConfig(restaurant) {
  const cfg = getLoyaltyConfig(restaurant);
  return {
    enabled: cfg.enabled,
    pointsPerOrder: cfg.pointsPerOrder,
    pointsPerCurrency: cfg.pointsPerCurrency,
    autoStampOnOrder: cfg.autoStampOnOrder,
    stampsTarget: cfg.stampsTarget,
    visitReward: cfg.visitReward,
    rewards: cfg.rewards
  };
}

function newId(prefix) {
  return prefix + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

const CODE_ALPHABET = 'AB3CDE5FGHJK6MNPQ7RSTUVW9XZ';
function generateRedemptionCode() {
  const part = (len) => Array.from({ length: len }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  return 'LOY-' + part(4) + '-' + part(4);
}

// ─────────────────────────────────────────────────────────────────────────────
// Identidad unificada
// ─────────────────────────────────────────────────────────────────────────────
async function findCustomerByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const customers = readCollection('customers');
  return customers.find(c => c.phone === normalized) || null;
}

async function findOrCreateCustomer({ phone, name = '', email = '', consentMarketing = false }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const customers = readCollection('customers');
  let customer = customers.find(c => c.phone === normalized);
  const now = new Date().toISOString();
  if (!customer) {
    customer = {
      id: newId('cust'),
      phone: normalized,
      phoneHash: hashPhone(normalized),
      name: name || '',
      email: email || '',
      consentPush: false,
      consentMarketing: Boolean(consentMarketing),
      globalVisits: 0,
      globalPoints: 0,
      restaurantsVisited: 0,
      levelId: 'bronce',
      badges: [],
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now
    };
    customers.push(customer);
    await writeCollection('customers', customers);
    replicateUpsert('customers', [customer]);
  } else {
    let changed = false;
    if (name && !customer.name) { customer.name = name; changed = true; }
    if (email && !customer.email) { customer.email = email; changed = true; }
    if (consentMarketing && !customer.consentMarketing) { customer.consentMarketing = true; changed = true; }
    customer.lastSeenAt = now;
    customer.updatedAt = now;
    customers[customers.findIndex(c => c.id === customer.id)] = customer;
    if (changed) {
      await writeCollection('customers', customers);
      replicateUpsert('customers', [customer]);
    }
  }
  return customer;
}

async function getOrCreateAccount(customerId, restaurantId) {
  const accounts = readCollection('accounts');
  let account = accounts.find(a => a.customerId === customerId && a.restaurantId === restaurantId);
  const now = new Date().toISOString();
  if (!account) {
    account = {
      id: newId('acc'),
      customerId,
      restaurantId,
      points: 0,
      stamps: 0,
      visits: 0,
      levelId: 'bronce',
      lastVisitAt: null,
      createdAt: now,
      updatedAt: now
    };
    accounts.push(account);
    await writeCollection('accounts', accounts);
    replicateUpsert('accounts', [account]);
  }
  return account;
}

async function persistCustomer(customer) {
  const customers = readCollection('customers');
  const idx = customers.findIndex(c => c.id === customer.id);
  if (idx >= 0) customers[idx] = customer; else customers.push(customer);
  await writeCollection('customers', customers);
  replicateUpsert('customers', [customer]);
}

async function persistAccount(account) {
  const accounts = readCollection('accounts');
  const idx = accounts.findIndex(a => a.id === account.id);
  if (idx >= 0) accounts[idx] = account; else accounts.push(account);
  await writeCollection('accounts', accounts);
  replicateUpsert('accounts', [account]);
}

async function addLedger(entries) {
  const ledger = readCollection('ledger');
  ledger.push(...entries);
  await writeCollection('ledger', ledger);
  replicateUpsert('ledger', entries);
}

/** Recalcula restaurantes distintos + nivel + insignias del cliente. */
function refreshGlobalStatus(customer) {
  const accounts = readCollection('accounts');
  customer.restaurantsVisited = new Set(
    accounts.filter(a => a.customerId === customer.id && (a.visits || 0) > 0).map(a => a.restaurantId)
  ).size;
  const level = deriveLevel(customer.globalVisits || 0);
  customer.levelId = level.id;
  customer.badges = deriveBadges({ visits: customer.globalVisits || 0, restaurants: customer.restaurantsVisited });
  return level;
}

// ─────────────────────────────────────────────────────────────────────────────
// Acreditación automática por pedido (NUNCA rompe el pedido)
// ─────────────────────────────────────────────────────────────────────────────
async function creditOrder({ restaurant, customerPhone, customerName, orderId, amountInCents }) {
  try {
    const config = getLoyaltyConfig(restaurant);
    if (!config.enabled) return { credited: false, reason: 'loyalty_disabled' };
    const normalized = normalizePhone(customerPhone);
    if (!normalized) return { credited: false, reason: 'no_phone' };
    if (!restaurant || !restaurant.id) return { credited: false, reason: 'no_restaurant' };

    const customer = await findOrCreateCustomer({ phone: normalized, name: customerName || '' });
    if (!customer) return { credited: false, reason: 'no_phone' };

    const points = config.pointsPerOrder + Math.floor((amountInCents || 0) / 100) * config.pointsPerCurrency;
    const stamps = config.autoStampOnOrder ? 1 : 0;
    const account = await getOrCreateAccount(customer.id, restaurant.id);

    const prevStamps = account.stamps;
    const prevLevelId = customer.levelId;

    account.points = (account.points || 0) + points;
    account.stamps = (account.stamps || 0) + stamps;
    account.visits = (account.visits || 0) + 1;
    account.levelId = config.stampsTarget > 0 && account.stamps >= config.stampsTarget ? 'frecuente' : 'bronce';
    account.lastVisitAt = new Date().toISOString();
    account.updatedAt = new Date().toISOString();

    customer.globalPoints = (customer.globalPoints || 0) + points;
    customer.globalVisits = (customer.globalVisits || 0) + 1;
    customer.lastSeenAt = new Date().toISOString();
    customer.updatedAt = new Date().toISOString();

    // Persistir la cuenta PRIMERO: refreshGlobalStatus lee el estado en disco
    // (visits>0) para contar restaurantes distintos — si la cuenta recién
    // actualizada aún figurara con visits:0, se auto-excluiría del set.
    await persistAccount(account);
    const level = refreshGlobalStatus(customer);
    await persistCustomer(customer);

    const now = new Date().toISOString();
    await addLedger([
      {
        id: newId('ledg'), customerId: customer.id, restaurantId: restaurant.id,
        kind: 'order', pointsDelta: points, stampsDelta: stamps,
        reason: 'Pedido registrado', refId: orderId || null,
        metadata: { amountInCents: amountInCents || 0 }, createdAt: now
      },
      {
        id: newId('ledg'), customerId: customer.id, restaurantId: null,
        kind: 'order_global', pointsDelta: points, stampsDelta: 0,
        reason: 'Acumulación global de la red', refId: orderId || null,
        metadata: { restaurantId: restaurant.id, amountInCents: amountInCents || 0 }, createdAt: now
      }
    ]);

    const unlocks = [];
    if (stamps > 0 && prevStamps < config.stampsTarget && account.stamps >= config.stampsTarget) {
      unlocks.push({ type: 'visit_reward', title: config.visitReward.title, stamp: config.stampsTarget });
    }
    if (prevLevelId !== customer.levelId) {
      unlocks.push({ type: 'level_up', levelId: customer.levelId, label: level.label });
    }

    return {
      credited: true,
      points,
      stamps,
      unlocks,
      account: publicAccount(account),
      customer: publicCustomer(customer, level.id)
    };
  } catch (err) {
    // La fidelización jamás debe romper el alta del pedido.
    sentry.captureException(err, { source: 'loyalty.creditOrder', level: 'warn' });
    return { credited: false, reason: 'error' };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Acreditación manual por el dueño (visitas in-person / ajustes)
// ─────────────────────────────────────────────────────────────────────────────
async function manualCredit({ restaurantId, phone, points, reason = 'Ajuste manual' }) {
  const restaurant = db.findRestaurantById(restaurantId);
  if (!restaurant) throw new AppError('Restaurante no encontrado', 404, 'RESTAURANT_NOT_FOUND');
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError('Teléfono inválido', 400, 'INVALID_PHONE');
  if (!Number.isInteger(points) || points <= 0 || points > 100000) {
    throw new AppError('Puntos inválidos (entero positivo hasta 100.000)', 400, 'INVALID_POINTS');
  }

  const customer = await findOrCreateCustomer({ phone: normalized });
  if (!customer) throw new AppError('Teléfono inválido', 400, 'INVALID_PHONE');
  const account = await getOrCreateAccount(customer.id, restaurant.id);

  account.points = (account.points || 0) + points;
  account.updatedAt = new Date().toISOString();
  customer.globalPoints = (customer.globalPoints || 0) + points;
  customer.updatedAt = new Date().toISOString();
  refreshGlobalStatus(customer);

  await persistAccount(account);
  await persistCustomer(customer);
  await addLedger([{
    id: newId('ledg'), customerId: customer.id, restaurantId: restaurant.id,
    kind: 'manual_credit', pointsDelta: points, stampsDelta: 0,
    reason: String(reason).slice(0, 200), refId: null,
    metadata: { manual: true }, createdAt: new Date().toISOString()
  }]);

  return { credited: true, points, account: publicAccount(account), customerId: customer.id };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canjes (códigos de un solo uso emitidos por el server)
// ─────────────────────────────────────────────────────────────────────────────
async function redeemReward({ phone, restaurantId, rewardId }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new AppError('Teléfono inválido', 400, 'INVALID_PHONE');
  const customer = await findCustomerByPhone(normalized);
  if (!customer) throw new AppError('Cliente no encontrado para este teléfono', 404, 'CUSTOMER_NOT_FOUND');

  let cost;
  let reward;
  let account = null;
  let restaurant = null;

  if (String(rewardId).startsWith('glob_')) {
    reward = GLOBAL_REWARDS.find(r => r.id === rewardId);
    if (!reward) throw new AppError('Beneficio global no encontrado', 404, 'REWARD_NOT_FOUND');
    const level = deriveLevel(customer.globalVisits || 0);
    if (LEVEL_RANK[level.id] < LEVEL_RANK[reward.minLevel]) {
      throw new AppError(`Necesitás nivel ${reward.minLevel} para este beneficio de la red`, 403, 'GLOBAL_LEVEL_REQUIRED');
    }
    if ((customer.globalPoints || 0) < reward.pointsCost) {
      throw new AppError('No tenés suficientes puntos globales', 400, 'INSUFFICIENT_GLOBAL_POINTS');
    }
    cost = reward.pointsCost;
  } else {
    restaurant = db.findRestaurantById(restaurantId);
    if (!restaurant) throw new AppError('Restaurante no encontrado', 404, 'RESTAURANT_NOT_FOUND');
    const config = getLoyaltyConfig(restaurant);
    reward = config.rewards.find(r => r.id === rewardId);
    if (!reward) throw new AppError('Premio no encontrado en este restaurante', 404, 'REWARD_NOT_FOUND');
    account = await getOrCreateAccount(customer.id, restaurant.id);
    if ((account.points || 0) < reward.pointsCost) {
      throw new AppError('No tenés suficientes puntos en este local', 400, 'INSUFFICIENT_LOCAL_POINTS');
    }
    cost = reward.pointsCost;
  }

  const redemption = {
    id: newId('rdm'),
    code: generateRedemptionCode(),
    customerId: customer.id,
    restaurantId: restaurant ? restaurant.id : null,
    rewardId: reward.id,
    rewardTitle: reward.title,
    rewardValue: reward.id,
    pointsCost: cost,
    status: 'issued',
    redeemedAt: null,
    redeemedByRestaurantId: null,
    createdAt: new Date().toISOString()
  };

  if (account) {
    account.points = (account.points || 0) - cost;
    account.updatedAt = new Date().toISOString();
    await persistAccount(account);
  } else {
    customer.globalPoints = (customer.globalPoints || 0) - cost;
    customer.updatedAt = new Date().toISOString();
    await persistCustomer(customer);
  }

  const redemptions = readCollection('redemptions');
  redemptions.push(redemption);
  await writeCollection('redemptions', redemptions);
  replicateUpsert('redemptions', [redemption]);

  await addLedger([{
    id: newId('ledg'), customerId: customer.id, restaurantId: restaurant ? restaurant.id : null,
    kind: 'redeem', pointsDelta: -cost, stampsDelta: 0,
    reason: `Canje: ${reward.title}`, refId: redemption.code,
    metadata: { rewardId: reward.id }, createdAt: redemption.createdAt
  }]);

  return {
    code: redemption.code,
    rewardTitle: reward.title,
    pointsCost: cost,
    restaurantName: restaurant ? (restaurant.name || restaurant.bizName) : 'Red ScanGo'
  };
}

async function validateRedemptionCode({ code, ownerRestaurantId }) {
  const normalized = String(code || '').trim().toUpperCase();
  if (!normalized) throw new AppError('Código requerido', 400, 'CODE_REQUIRED');

  // 1) RPC atómico primero (si hay cliente Supabase): el
  //    `UPDATE ... WHERE status='issued'` de claim_loyalty_redemption (006) es
  //    una sola sentencia → dos validates concurrentes (misma o distintas
  //    instancias) no pueden canjear doble.
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.rpc('claim_loyalty_redemption', {
        p_code: normalized,
        p_restaurant_id: ownerRestaurantId || null
      });
      if (!error && data && typeof data === 'object') {
        if (data.ok === true) {
          // Veto anti split-brain: si ESTA instancia ya lo marcó redeemed
          // (claim local durante un lag de replicación), el ok del RPC viene
          // de un estado cloud desactualizado → 409, no doble éxito.
          try {
            const prior = readCollection('redemptions')
              .find(r => String(r.code || '').toUpperCase() === normalized);
            if (prior && prior.status === 'redeemed') {
              logger.warn('[loyalty] claim RPC ok pero espejo local ya redeemed (lag), veto 409');
              throw new AppError('Este código ya fue canjeado', 409, 'CODE_ALREADY_REDEEMED');
            }
          } catch (vetoErr) {
            if (vetoErr && typeof vetoErr.statusCode === 'number') throw vetoErr;
            logger.warn('[loyalty] veto local falló (best-effort), sigue claim RPC', { details: vetoErr && vetoErr.message });
          }
          // Sincroniza el espejo local best-effort (nunca rompe el canje).
          try {
            const redemptions = readCollection('redemptions');
            const idx = redemptions.findIndex(r => String(r.code || '').toUpperCase() === normalized);
            if (idx >= 0) {
              redemptions[idx].status = 'redeemed';
              redemptions[idx].redeemedAt = data.redeemed_at || new Date().toISOString();
              if (ownerRestaurantId) redemptions[idx].redeemedByRestaurantId = ownerRestaurantId;
              await writeCollection('redemptions', redemptions);
            }
          } catch (mirrorErr) {
            logger.warn('[loyalty] espejo local post-claim falló (best-effort)', { details: mirrorErr.message });
          }
          return {
            code: data.code,
            rewardTitle: data.reward_title,
            pointsCost: data.points_cost,
            restaurantId: data.restaurant_id,
            redeemedAt: data.redeemed_at
          };
        }
        if (data.ok === false) {
          // NOT_FOUND con espejo local pero cloud rezagado (el upsert de
          // emisión es fire-and-forget): manda el local, que distingue
          // 404/409/410/403 (incluido cross-restaurant), como antes de 006.
          if (data.reason === 'NOT_FOUND') {
            const local = readCollection('redemptions')
              .find(r => String(r.code || '').toUpperCase() === normalized);
            if (local) {
              logger.warn('[loyalty] claim RPC NOT_FOUND pero espejo local presente (cloud rezagado), path local');
              return _withClaimLock(normalized, () => _validateLocally(normalized, ownerRestaurantId));
            }
          }
          throw _claimReasonToError(data.reason);
        }
        logger.warn('[loyalty] claim RPC respuesta inesperada, fallback local');
      } else if (error) {
        if (_isMissingClaimFunction(error)) {
          logger.warn('[loyalty] claim_loyalty_redemption ausente (006 no aplicada), fallback local', { details: error.message });
        } else {
          logger.warn('[loyalty] claim RPC falló, fallback local', { details: error.message });
        }
      } else {
        logger.warn('[loyalty] claim RPC sin data, fallback local');
      }
    } catch (rpcErr) {
      // Los AppError de mapeo (CODE_*) ya son la respuesta final: no caer al local.
      if (rpcErr && typeof rpcErr.statusCode === 'number' && String(rpcErr.code || '').startsWith('CODE_')) throw rpcErr;
      logger.warn('[loyalty] claim RPC excepción, fallback local', { details: rpcErr && rpcErr.message });
    }
  }

  // 2) Path local, serializado por código dentro de la instancia.
  return _withClaimLock(normalized, () => _validateLocally(normalized, ownerRestaurantId));
}

// Mutex en proceso por código: serializa dos validates concurrentes de la
// misma instancia (el check-then-set local no es atómico entre awaits). La
// atomicidad cross-instancia la da el RPC 006 cuando hay Supabase.
const _claimChains = new Map();

function _withClaimLock(normalizedCode, fn) {
  const prev = _claimChains.get(normalizedCode) || Promise.resolve();
  const current = prev.catch(() => {}).then(() => fn());
  const tracked = current.catch(() => {});
  _claimChains.set(normalizedCode, tracked);
  tracked.finally(() => {
    if (_claimChains.get(normalizedCode) === tracked) _claimChains.delete(normalizedCode);
  });
  return current;
}

function _isMissingClaimFunction(err) {
  if (!err) return false;
  if (err.code === 'PGRST202') return true;
  const msg = String(err.message || '');
  return /could not find the function/i.test(msg) && /claim_loyalty_redemption/i.test(msg);
}

function _claimReasonToError(reason) {
  switch (reason) {
    case 'ALREADY':
      return new AppError('Este código ya fue canjeado', 409, 'CODE_ALREADY_REDEEMED');
    case 'EXPIRED':
      return new AppError('Este código está vencido', 410, 'CODE_EXPIRED');
    case 'OTHER':
      return new AppError('Este código pertenece a otro restaurante', 403, 'CODE_OTHER_RESTAURANT');
    case 'NOT_FOUND':
    default:
      return new AppError('Código no encontrado', 404, 'CODE_NOT_FOUND');
  }
}

async function _validateLocally(normalized, ownerRestaurantId) {
  const redemptions = readCollection('redemptions');
  const redemption = redemptions.find(r => String(r.code || '').toUpperCase() === normalized);
  if (!redemption) throw new AppError('Código no encontrado', 404, 'CODE_NOT_FOUND');
  if (redemption.status === 'redeemed') {
    throw new AppError('Este código ya fue canjeado', 409, 'CODE_ALREADY_REDEEMED');
  }
  if (redemption.status === 'expired') {
    throw new AppError('Este código está vencido', 410, 'CODE_EXPIRED');
  }
  // Los códigos LOCALES solo los valida el restaurante que los emitió.
  // Los GLOBALES (restaurant_id null) son de la red: cualquier local los valida.
  if (redemption.restaurantId && ownerRestaurantId && redemption.restaurantId !== ownerRestaurantId) {
    throw new AppError('Este código pertenece a otro restaurante', 403, 'CODE_OTHER_RESTAURANT');
  }

  redemption.status = 'redeemed';
  redemption.redeemedAt = new Date().toISOString();
  if (ownerRestaurantId) redemption.redeemedByRestaurantId = ownerRestaurantId;
  const idx = redemptions.findIndex(r => r.id === redemption.id);
  redemptions[idx] = redemption;
  await writeCollection('redemptions', redemptions);
  replicateUpsert('redemptions', [redemption]);

  return {
    code: redemption.code,
    rewardTitle: redemption.rewardTitle,
    pointsCost: redemption.pointsCost,
    restaurantId: redemption.restaurantId,
    redeemedAt: redemption.redeemedAt
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas para el cliente (tarjeta) y el dueño (clientes del local)
// ─────────────────────────────────────────────────────────────────────────────
function publicCustomer(customer, levelId) {
  return {
    phone: maskPhone(customer.phone),
    name: customer.name || '',
    levelId: levelId || customer.levelId || 'bronce',
    globalVisits: customer.globalVisits || 0,
    globalPoints: customer.globalPoints || 0,
    restaurantsVisited: customer.restaurantsVisited || 0,
    badges: customer.badges || []
  };
}

function publicAccount(account) {
  return {
    points: account.points || 0,
    stamps: account.stamps || 0,
    visits: account.visits || 0,
    levelId: account.levelId || 'bronce',
    lastVisitAt: account.lastVisitAt || null
  };
}

async function getCustomerCard({ phone, restaurantId }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const customer = await findCustomerByPhone(normalized);
  if (!customer) return null;

  const level = deriveLevel(customer.globalVisits || 0);
  const accounts = readCollection('accounts').filter(a => a.customerId === customer.id);
  const currentAccount = restaurantId ? accounts.find(a => a.restaurantId === restaurantId) : (accounts[0] || null);

  const ledger = readCollection('ledger')
    .filter(e => e.customerId === customer.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 20);

  const restaurants = accounts
    .map(a => {
      const rest = db.findRestaurantById(a.restaurantId);
      return { restaurantId: a.restaurantId, name: rest ? (rest.name || rest.bizName) : 'Local', ...publicAccount(a) };
    })
    .filter(a => a.visits > 0 || a.points > 0 || a.stamps > 0);

  return {
    customer: publicCustomer(customer, level.id),
    level: { id: level.id, label: level.label, perks: level.perks },
    account: currentAccount ? publicAccount(currentAccount) : null,
    restaurants,
    global: {
      points: customer.globalPoints || 0,
      visits: customer.globalVisits || 0,
      restaurantsVisited: customer.restaurantsVisited || 0,
      level: level.label
    },
    availableGlobalRewards: GLOBAL_REWARDS
      .filter(r => LEVEL_RANK[level.id] >= LEVEL_RANK[r.minLevel])
      .map(r => ({ ...r, canAfford: (customer.globalPoints || 0) >= r.pointsCost })),
    recentLedger: ledger.map(e => ({
      id: e.id, kind: e.kind, pointsDelta: e.pointsDelta, stampsDelta: e.stampsDelta,
      reason: e.reason, createdAt: e.createdAt
    }))
  };
}

async function listRestaurantCustomers(restaurantId) {
  const accounts = readCollection('accounts').filter(a => a.restaurantId === restaurantId);
  const customers = readCollection('customers');
  return accounts.map(a => {
    const c = customers.find(cust => cust.id === a.customerId);
    return {
      customerId: a.customerId,
      phone: c ? maskPhone(c.phone) : '',
      name: c ? (c.name || '') : '',
      globalLevel: c ? c.levelId : 'bronce',
      ...publicAccount(a),
      lastVisitAt: a.lastVisitAt || null
    };
  }).sort((x, y) => (y.points || 0) - (x.points || 0));
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrado total de datos del cliente (derecho al olvido, privacy-first)
// ─────────────────────────────────────────────────────────────────────────────
async function eraseCustomerData(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return { erased: false, reason: 'INVALID_PHONE' };
  const customers = readCollection('customers');
  const customer = customers.find(c => c.phone === normalized);
  if (!customer) return { erased: false, reason: 'CUSTOMER_NOT_FOUND' };
  const customerId = customer.id;

  customers.splice(customers.findIndex(c => c.id === customerId), 1);
  await writeCollection('customers', customers);
  replicateDelete('customers', 'id', customerId);

  const accounts = readCollection('accounts').filter(a => a.customerId !== customerId);
  await writeCollection('accounts', accounts);
  replicateDelete('accounts', 'customer_id', customerId);

  const ledger = readCollection('ledger').filter(e => e.customerId !== customerId);
  await writeCollection('ledger', ledger);
  replicateDelete('ledger', 'customer_id', customerId);

  const redemptions = readCollection('redemptions').filter(r => r.customerId !== customerId);
  await writeCollection('redemptions', redemptions);
  replicateDelete('redemptions', 'customer_id', customerId);

  return { erased: true, customerId };
}

module.exports = {
  // puros / helpers (para tests)
  normalizePhone,
  maskPhone,
  hashPhone,
  deriveLevel,
  deriveBadges,
  generateRedemptionCode,
  getLoyaltyConfig,
  getPublicLoyaltyConfig,
  GLOBAL_LEVELS,
  GLOBAL_REWARDS,
  // negocio
  findCustomerByPhone,
  findOrCreateCustomer,
  getOrCreateAccount,
  creditOrder,
  manualCredit,
  redeemReward,
  validateRedemptionCode,
  getCustomerCard,
  listRestaurantCustomers,
  eraseCustomerData,
  // prueba de posesión por email (OTP anti-drenaje)
  generateLoyaltyOtp,
  verifyLoyaltyOtp,
  maskEmail,
  requestLoyaltyOtp,
  setCustomerEmail
};