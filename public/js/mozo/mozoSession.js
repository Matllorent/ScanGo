/**
 * public/js/mozo/mozoSession.js
 * ─────────────────────────────
 * Primitivas PURAS de la PWA del turno (Sistema de Mozos y Cocina, Fase 1).
 * Sin DOM, sin red y sin storage global: todo entra por parámetro para poder
 * verificarse en Node y en el navegador con la misma lógica.
 *
 * El secreto del QR viaja SOLO en el fragmento `#k=` y se canjea UNA vez por
 * un token de sesión opaco. La PWA guarda ese token (no el secreto) y lo
 * manda como `Authorization: Bearer`; el servidor solo conoce su hash.
 */

export const STAFF_SESSION_STORAGE_KEY = 'scango_staff_session';
export const END_SHIFT_ARM_MS = 4000;
export const MOZO_POLL_MS = 30000;
export const MOZO_HEARTBEAT_MS = 5 * 60 * 1000;
export const MAX_TABLES = 200;

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanId(value, maxLength = 100) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > maxLength) return '';
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
}

function cleanSecret(value) {
  const raw = String(value == null ? '' : value).trim();
  if (raw.length < 20 || raw.length > 200) return '';
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
}

function cleanIso(value) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw) return '';
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
}

/**
 * Extrae la credencial de enrolamiento de una URL de /mozo.
 * Devuelve `complete:false` si falta cualquier pieza, sin lanzar.
 *
 * @param {{ search?: string, hash?: string }} locationLike
 * @returns {{ restaurantId: string, staffId: string, secret: string, complete: boolean, partial: boolean }}
 */
export function parseEnrollmentFromLocation(locationLike = {}) {
  const source = locationLike && typeof locationLike === 'object' ? locationLike : {};
  const search = typeof source.search === 'string' ? source.search : '';
  const hash = typeof source.hash === 'string' ? source.hash : '';
  let params;
  let fragment;
  try {
    params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    fragment = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash);
  } catch (e) {
    return { restaurantId: '', staffId: '', secret: '', complete: false, partial: false };
  }
  const restaurantId = cleanId(params.get('r'));
  const staffId = cleanId(params.get('w'));
  const secret = cleanSecret(fragment.get('k'));
  const complete = Boolean(restaurantId && staffId && secret);
  const partial = Boolean(restaurantId || staffId || secret) && !complete;
  return { restaurantId, staffId, secret, complete, partial };
}

/** URL sin el fragmento del QR (el secreto no queda en el historial visible). */
export function stripEnrollmentFragment(href) {
  const raw = String(href == null ? '' : href);
  const index = raw.indexOf('#');
  return index >= 0 ? raw.slice(0, index) : raw;
}

function normalizeTable(table) {
  if (table == null) return null;
  const source = typeof table === 'object' ? table : { number: table };
  const number = cleanText(source.number, 20);
  if (!number) return null;
  const label = cleanText(source.label, 40) || (/^\d+$/.test(number) ? `Mesa ${number}` : number);
  return { number, label };
}

export function normalizeTables(tables) {
  if (!Array.isArray(tables)) return [];
  const seen = new Set();
  const out = [];
  for (const table of tables.slice(0, MAX_TABLES)) {
    const normalized = normalizeTable(table);
    if (!normalized || seen.has(normalized.number)) continue;
    seen.add(normalized.number);
    out.push(normalized);
  }
  return out;
}

/** Sesión mínima que puede vivir en localStorage (nunca incluye el secreto QR). */
export function sanitizeStaffSession(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const token = cleanSecret(raw.token);
  const staffId = cleanId(raw.staffId);
  const restaurantId = cleanId(raw.restaurantId);
  const expiresAt = cleanIso(raw.expiresAt);
  if (!token || !staffId || !restaurantId || !expiresAt) return null;
  return {
    token,
    staffId,
    restaurantId,
    staffName: cleanText(raw.staffName, 80),
    role: raw.role === 'kitchen' ? 'kitchen' : 'waiter',
    roleLabel: cleanText(raw.roleLabel, 30) || (raw.role === 'kitchen' ? 'Cocina' : 'Mozo'),
    restaurantName: cleanText(raw.restaurantName, 120),
    expiresAt,
    activatedAt: cleanIso(raw.activatedAt) || new Date().toISOString(),
    tables: normalizeTables(raw.tables)
  };
}

/** Construye la sesión desde `body.data` de POST /api/staff/shift/activate. */
export function buildStaffSessionFromActivation(payload, nowMs = Date.now()) {
  if (!payload || typeof payload !== 'object') return null;
  const staff = payload.staff && typeof payload.staff === 'object' ? payload.staff : {};
  const restaurant = payload.restaurant && typeof payload.restaurant === 'object' ? payload.restaurant : {};
  const session = sanitizeStaffSession({
    token: payload.token,
    staffId: staff.id || payload.staffId,
    restaurantId: restaurant.id || payload.restaurantId,
    staffName: staff.name || payload.staffName,
    role: staff.role || payload.role,
    roleLabel: staff.roleLabel || payload.roleLabel,
    restaurantName: restaurant.name || payload.restaurantName,
    expiresAt: payload.expiresAt,
    activatedAt: new Date(Number(nowMs)).toISOString(),
    tables: payload.tables
  });
  return session;
}

/** Aplica la respuesta de GET /api/staff/me sobre una sesión existente. */
export function mergeStaffSessionFromMe(session, payload) {
  const base = sanitizeStaffSession(session);
  if (!base || !payload || typeof payload !== 'object') return base;
  const staff = payload.staff && typeof payload.staff === 'object' ? payload.staff : {};
  const restaurant = payload.restaurant && typeof payload.restaurant === 'object' ? payload.restaurant : {};
  const serverSession = payload.session && typeof payload.session === 'object' ? payload.session : {};
  return sanitizeStaffSession({
    ...base,
    staffId: staff.id || base.staffId,
    restaurantId: restaurant.id || base.restaurantId,
    staffName: staff.name || base.staffName,
    role: staff.role || base.role,
    roleLabel: staff.roleLabel || base.roleLabel,
    restaurantName: restaurant.name || base.restaurantName,
    expiresAt: serverSession.expiresAt || base.expiresAt,
    tables: payload.tables || base.tables
  });
}

/** ¿La sesión sirve para al menos un request más? Margen de 5 s. */
export function staffSessionIsUsable(session, nowMs = Date.now()) {
  if (!session || !session.token) return false;
  const expires = Date.parse(session.expiresAt || '');
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return Number.isFinite(expires) && expires > now + 5000;
}

export function staffSessionMinutesLeft(session, nowMs = Date.now()) {
  const expires = Date.parse(session && session.expiresAt ? session.expiresAt : '');
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (!Number.isFinite(expires)) return 0;
  return Math.max(0, Math.ceil((expires - now) / 60000));
}

export function formatStaffExpiry(session, nowMs = Date.now(), locale = 'es-UY') {
  const expires = Date.parse(session && session.expiresAt ? session.expiresAt : '');
  if (!Number.isFinite(expires)) return '—';
  const date = new Date(expires);
  try {
    const parts = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
    const hour = parts.find((p) => p.type === 'hour');
    const minute = parts.find((p) => p.type === 'minute');
    if (hour && minute) return `${hour.value.padStart(2, '0')}:${minute.value.padStart(2, '0')}`;
  } catch (e) {
    // Fallback determinista abajo.
  }
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/**
 * Máquina de los DOS toques para cerrar turno (sin `window.confirm`).
 * Primer toque: arma. Segundo dentro de 4 s: confirma. Fuera de la ventana:
 * vuelve a armar (nunca cierra por un toque accidental aislado).
 */
export function nextEndShiftTap(state, nowMs = Date.now()) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const armedAt = state && Number(state.armedAt);
  if (armedAt > 0 && now >= armedAt && now - armedAt <= END_SHIFT_ARM_MS) {
    return { armed: false, confirm: true, armedAt: null, remainingMs: 0 };
  }
  return { armed: true, confirm: false, armedAt: now, remainingMs: END_SHIFT_ARM_MS };
}

/** El polling y el heartbeat corren SOLO con la pestaña visible. */
export function shouldRefreshStaffSession(visibilityState) {
  return visibilityState === 'visible';
}

export function readStaffSessionFromStorage(storage, key = STAFF_SESSION_STORAGE_KEY) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    return raw ? sanitizeStaffSession(JSON.parse(raw)) : null;
  } catch (e) {
    return null;
  }
}

export function writeStaffSessionToStorage(storage, session, key = STAFF_SESSION_STORAGE_KEY) {
  if (!storage) return false;
  const clean = sanitizeStaffSession(session);
  if (!clean) return false;
  try {
    storage.setItem(key, JSON.stringify(clean));
    return true;
  } catch (e) {
    return false;
  }
}

export function clearStaffSessionStorage(storage, key = STAFF_SESSION_STORAGE_KEY) {
  if (!storage) return false;
  try {
    storage.removeItem(key);
    return true;
  } catch (e) {
    return false;
  }
}

/** Vista estable para pintar la PWA (sin PII de comensales). */
export function buildMozoView(session, { pushConfigured = false, online = true } = {}) {
  const clean = sanitizeStaffSession(session);
  if (!clean) return null;
  return {
    restaurantName: clean.restaurantName || 'Tu local',
    staffName: clean.staffName || 'Equipo',
    roleLabel: clean.roleLabel,
    tables: clean.tables,
    tableCount: clean.tables.length,
    hasTables: clean.tables.length > 0,
    expiresAt: clean.expiresAt,
    pushConfigured: Boolean(pushConfigured),
    online: online !== false
  };
}
