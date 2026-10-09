/**
 * api/utils/deviceTokens.js
 * ─────────────────────────
 * Credenciales opacas de larga vida para la app nativa (Capacitor): el
 * WebView corre en otro origen y las cookies SameSite=Lax no viajan, así que
 * el móvil NO puede usar la sesión cookie-only del navegador. En vez de
 * devolverle el JWT de sesión en el body (robable por XSS), se le emite un
 * token opaco por dispositivo: revocable, con expiración y atado a pwdTs
 * (muere con un reset, igual que las sesiones).
 *
 * - Se almacena SOLO el hash SHA-256 (el crudo se muestra una vez).
 * - Re-login del mismo `deviceName` rota (un dispositivo = un token).
 * - Reset de contraseña revoca todos los del usuario.
 * - Archivo JSON local (`data/device_tokens.json`, gitignored); misma
 *   limitación multi-instancia que la denylist de jtis (documentada).
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', '..', 'data');
const DEVICES_FILE = path.join(DATA_DIR, 'device_tokens.json');

const DEVICE_TOKEN_PREFIX = 'scango_dev_';
const DEVICE_TOKEN_TTL_MS = 365 * 24 * 3600 * 1000; // 1 año
const MAX_DEVICES_PER_USER = 10;

function readDevices() {
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(DEVICES_FILE)) return [];
    const rows = JSON.parse(fs.readFileSync(DEVICES_FILE, 'utf8'));
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function writeDevices(rows) {
  try {
    fs.writeFileSync(DEVICES_FILE, JSON.stringify(rows));
    return true;
  } catch {
    return false;
  }
}

function hashDeviceToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function publicDevice(row) {
  return {
    id: row.id,
    deviceName: row.deviceName,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt || null
  };
}

/**
 * Emite (o rota) el token del dispositivo. Devuelve el crudo UNA vez.
 */
function issueDeviceToken(userId, deviceName) {
  const name = String(deviceName || 'dispositivo').trim().slice(0, 60) || 'dispositivo';
  const raw = DEVICE_TOKEN_PREFIX
    + crypto.randomBytes(32).toString('base64url');
  const now = new Date().toISOString();
  const rows = readDevices().filter((r) => r && r.revokedAt == null);
  // Rota el anterior del mismo nombre; tope por usuario.
  const kept = rows.filter((r) => !(r.userId === userId && r.deviceName === name));
  const mine = kept.filter((r) => r.userId === userId);
  while (mine.length >= MAX_DEVICES_PER_USER) {
    const oldest = mine.shift();
    const idx = kept.findIndex((r) => r.id === oldest.id);
    if (idx >= 0) kept.splice(idx, 1);
  }
  const record = {
    id: 'dev_' + Date.now().toString(36) + '_' + crypto.randomBytes(4).toString('hex'),
    userId,
    deviceName: name,
    hash: hashDeviceToken(raw),
    createdAt: now,
    expiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_MS).toISOString(),
    lastUsedAt: null,
    revokedAt: null
  };
  kept.push(record);
  writeDevices(kept);
  return { raw, record: publicDevice(record) };
}

/**
 * Verifica un token opaco. Devuelve { userId, tokenId } o null.
 * (La frescura pwdTs la valida el llamador contra el usuario, igual que JWT.)
 */
function verifyDeviceToken(raw) {
  if (!raw || typeof raw !== 'string' || !raw.startsWith(DEVICE_TOKEN_PREFIX)) return null;
  const hash = hashDeviceToken(raw);
  const rows = readDevices();
  const row = rows.find((r) => {
    if (!r || r.hash !== hash || r.revokedAt != null) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(r.hash), Buffer.from(hash));
    } catch {
      return false;
    }
  });
  if (!row) return null;
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now()) return null;
  row.lastUsedAt = new Date().toISOString();
  writeDevices(rows);
  return { userId: row.userId, tokenId: row.id };
}

function listDeviceTokens(userId) {
  const now = Date.now();
  return readDevices()
    .filter((r) => r && r.userId === userId && r.revokedAt == null
      && (!r.expiresAt || new Date(r.expiresAt).getTime() > now))
    .map(publicDevice);
}

function revokeDeviceToken(userId, id) {
  const rows = readDevices();
  const row = rows.find((r) => r && r.id === id && r.userId === userId && r.revokedAt == null);
  if (!row) return false;
  row.revokedAt = new Date().toISOString();
  writeDevices(rows);
  return true;
}

function revokeAllUserDevices(userId) {
  const rows = readDevices();
  let count = 0;
  const now = new Date().toISOString();
  for (const r of rows) {
    if (r && r.userId === userId && r.revokedAt == null) {
      r.revokedAt = now;
      count += 1;
    }
  }
  if (count) writeDevices(rows);
  return count;
}

module.exports = {
  DEVICE_TOKEN_PREFIX,
  issueDeviceToken,
  verifyDeviceToken,
  listDeviceTokens,
  revokeDeviceToken,
  revokeAllUserDevices
};
