/**
 * api/utils/staffCredentials.js
 * ──────────────────────────────
 * Primitivas PURAS del Sistema de Mozos y Cocina (Fase 1). Cero I/O, cero
 * requires de src/routes/middleware (guard de pureza de api/utils).
 *
 * Modelo de seguridad:
 *  - Cada persona del equipo tiene UNA credencial de enrolamiento. El secreto
 *    se genera en el servidor y viaja SOLO dentro del QR de turno (fragmento
 *    `#k=`): nunca se guarda crudo ni se manda al backend en un query string.
 *  - En la base se persiste su hash HMAC-SHA256 con pepper del entorno. Un
 *    dump de la tabla no alcanza para entrar a un turno.
 *  - Al activar el turno se emite un token opaco de sesión (32 bytes). También
 *    se guarda hasheado: si se pierde la base no se pueden reusar sesiones.
 */
const crypto = require('crypto');

const STAFF_ROLES = Object.freeze(['waiter', 'kitchen']);
const STAFF_ROLE_LABELS = Object.freeze({
  waiter: 'Mozo',
  kitchen: 'Cocina'
});

// Turno de 12 h: cubre un servicio largo sin obligar a re-escanear el QR a
// mitad de la noche. El heartbeat puede estirarlo, pero nunca más de 24 h
// desde la activación (tope absoluto; después se vuelve a escanear).
const STAFF_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const STAFF_SESSION_MAX_MS = 24 * 60 * 60 * 1000;
const STAFF_SECRET_BYTES = 24; // 192 bits → base64url de 32 chars
const STAFF_ID_RE = /^staff_[a-z0-9_]{4,80}$/;
const MAX_TABLES = 200;
const MAX_TABLE_NUMBER_LENGTH = 20;

/**
 * Pepper del hash de credenciales. Cambiarlo invalida TODOS los QR y sesiones
 * vigentes (decisión deliberada: rotar el secreto es un botón de pánico).
 */
function getStaffPepper() {
  return process.env.STAFF_CREDENTIAL_SECRET
    || process.env.JWT_SECRET
    || 'dev_staff_secret_scango_2026';
}

/** Secreto de alta entropía para credencial o token de sesión. */
function generateStaffSecret() {
  return crypto.randomBytes(STAFF_SECRET_BYTES).toString('base64url');
}

function hashStaffSecret(secret, pepper) {
  return crypto
    .createHmac('sha256', pepper || getStaffPepper())
    .update(String(secret || ''))
    .digest('hex');
}

/** Comparación en tiempo constante de dos hashes hex. */
function safeEqualHex(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left || !right || left.length !== right.length) return false;
  let leftBuf;
  let rightBuf;
  try {
    leftBuf = Buffer.from(left, 'hex');
    rightBuf = Buffer.from(right, 'hex');
  } catch (e) {
    return false;
  }
  if (leftBuf.length === 0 || leftBuf.length !== rightBuf.length) return false;
  return crypto.timingSafeEqual(leftBuf, rightBuf);
}

function sanitizeStaffRole(role) {
  return STAFF_ROLES.includes(role) ? role : null;
}

function staffRoleLabel(role) {
  return STAFF_ROLE_LABELS[role] || STAFF_ROLE_LABELS.waiter;
}

function sanitizeStaffName(value) {
  const raw = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return raw.slice(0, 60);
}

function generateStaffId() {
  return `staff_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function generateStaffSessionId() {
  return `ss_${Date.now().toString(36)}_${crypto.randomBytes(6).toString('hex')}`;
}

function isValidStaffId(value) {
  return typeof value === 'string' && STAFF_ID_RE.test(value);
}

/**
 * Normaliza un número/nombre de mesa para la asignación operativa.
 * Acepta "1", "12", "Terraza 3", "Mesa #4". Vacío o basura → ''.
 */
function sanitizeTableNumber(value) {
  const raw = String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!raw || raw.length > MAX_TABLE_NUMBER_LENGTH) return '';
  if (!/^[A-Za-z0-9ÁÉÍÓÚÜÑáéíóúüñ .#-]+$/.test(raw)) return '';
  return raw;
}

/**
 * Sanea el mapa `{ "1": "staff_...", "Terraza 3": "staff_..." }`.
 * Nunca deja pasar claves de prototipo ni ids con forma inválida. Tope 200.
 */
function sanitizeTableAssignments(input, { isValidStaffId: validator = isValidStaffId } = {}) {
  const out = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  const entries = Object.entries(input).slice(0, MAX_TABLES);
  for (const [key, value] of entries) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
    const tableNumber = sanitizeTableNumber(key);
    const staffId = typeof value === 'string' ? value.trim() : '';
    if (!tableNumber || !staffId) continue;
    if (typeof validator === 'function' && !validator(staffId)) continue;
    out[tableNumber] = staffId;
  }
  return out;
}

/**
 * URL del QR de turno. El secreto va en el FRAGMENTO (`#k=`), que el browser
 * no envía al servidor ni aparece en logs/Referer. Base hostil (`javascript:`,
 * `data:`, `//evil.com`, http no-local) → URL relativa segura.
 */
function buildStaffEnrollmentUrl(appUrl, { restaurantId, staffId, secret } = {}) {
  const r = String(restaurantId || '').trim();
  const w = String(staffId || '').trim();
  const k = String(secret || '').trim();
  if (!r || !w || !k) return '';
  const params = new URLSearchParams({ r, w });
  let base = '';
  const rawBase = String(appUrl || '').trim();
  if (rawBase) {
    try {
      const parsed = new URL(rawBase);
      const isHttps = parsed.protocol === 'https:';
      const isLocalhost = parsed.protocol === 'http:' && /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(parsed.hostname);
      if (isHttps || isLocalhost) base = parsed.origin;
    } catch (e) {
      base = '';
    }
  }
  return `${base}/mozo?${params.toString()}#k=${encodeURIComponent(k)}`;
}

function isStaffSessionActive(session, nowMs = Date.now()) {
  if (!session) return false;
  if (session.revokedAt || session.endedAt) return false;
  const expires = Date.parse(session.expiresAt || '');
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  return Number.isFinite(expires) && expires > now;
}

function staffSessionExpiry(nowMs = Date.now()) {
  return new Date(Number(nowMs) + STAFF_SESSION_TTL_MS).toISOString();
}

/**
 * Extiende una sesión viva sin superar el tope absoluto de 24 h desde su
 * creación. Si ya no se puede extender, devuelve el mismo `expiresAt`.
 */
function extendStaffSession(session, nowMs = Date.now()) {
  const now = Number(nowMs);
  const created = Date.parse(session && session.createdAt ? session.createdAt : '') || now;
  const current = Date.parse(session && session.expiresAt ? session.expiresAt : '') || now;
  const maxExpiry = created + STAFF_SESSION_MAX_MS;
  const next = Math.min(now + STAFF_SESSION_TTL_MS, maxExpiry);
  if (!Number.isFinite(next) || next <= current) return session && session.expiresAt ? session.expiresAt : new Date(next).toISOString();
  return new Date(next).toISOString();
}

module.exports = {
  STAFF_ROLES,
  STAFF_ROLE_LABELS,
  STAFF_SESSION_TTL_MS,
  STAFF_SESSION_MAX_MS,
  MAX_TABLES,
  MAX_TABLE_NUMBER_LENGTH,
  getStaffPepper,
  generateStaffSecret,
  hashStaffSecret,
  safeEqualHex,
  sanitizeStaffRole,
  staffRoleLabel,
  sanitizeStaffName,
  generateStaffId,
  generateStaffSessionId,
  isValidStaffId,
  sanitizeTableNumber,
  sanitizeTableAssignments,
  buildStaffEnrollmentUrl,
  isStaffSessionActive,
  staffSessionExpiry,
  extendStaffSession
};
