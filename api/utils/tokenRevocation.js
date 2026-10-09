/**
 * api/utils/tokenRevocation.js
 * ────────────────────────────
 * Revocación de sesiones sin migrar la DB:
 *
 * 1) Denylist de JTIs (logout puntual): en memoria + persistida en
 *    `data/revoked_tokens.json` (hidratada al arrancar, podada por expiración).
 *    Cubre la instancia y sobrevive reinicios; entre instancias de Vercel cada
 *    una valida su propia lista (limitación documentada).
 * 2) pwdTs (reset de contraseña, cross-instancia): el JWT lleva el
 *    `updatedAt||createdAt` del usuario al momento del login. Como
 *    `updateUserPassword` pisa `updatedAt` (y esa columna YA replica a
 *    Supabase), un reset invalida TODAS las sesiones previas en todas las
 *    instancias sin columna nueva. Tokens legacy (sin pwdTs) mueren si el
 *    usuario tiene `updatedAt` (o sea, si alguna vez cambió la clave).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', '..', 'data');
const REVOKED_FILE = path.join(DATA_DIR, 'revoked_tokens.json');
const MAX_ENTRIES = 5000;

let revoked = new Map(); // jti -> expMs
let hydrated = false;

function hydrateOnce() {
  if (hydrated) return;
  hydrated = true;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(REVOKED_FILE)) return;
    const rows = JSON.parse(fs.readFileSync(REVOKED_FILE, 'utf8'));
    if (Array.isArray(rows)) {
      const now = Date.now();
      for (const r of rows.slice(-MAX_ENTRIES)) {
        if (r && typeof r.jti === 'string' && typeof r.exp === 'number' && r.exp > now) {
          revoked.set(r.jti, r.exp);
        }
      }
    }
  } catch { /* best-effort: arrancar sin denylist es seguro (fail-open acotado) */ }
}

function persistBestEffort() {
  try {
    const rows = [...revoked.entries()].map(([jti, exp]) => ({ jti, exp }));
    fs.writeFileSync(REVOKED_FILE, JSON.stringify(rows));
  } catch { /* best-effort */ }
}

/** Revoca un jti hasta su expiración (logout puntual). */
function revokeJti(jti, expSeconds) {
  if (!jti) return;
  hydrateOnce();
  const expMs = typeof expSeconds === 'number' && expSeconds > 0
    ? expSeconds * 1000
    : Date.now() + 7 * 24 * 3600 * 1000;
  revoked.set(String(jti), expMs);
  if (revoked.size > MAX_ENTRIES) pruneRevoked();
  persistBestEffort();
}

function pruneRevoked(now = Date.now()) {
  for (const [jti, exp] of revoked) {
    if (exp <= now) revoked.delete(jti);
    if (revoked.size <= MAX_ENTRIES - 500) break;
  }
}

function isJtiRevoked(jti) {
  if (!jti) return false;
  hydrateOnce();
  const exp = revoked.get(String(jti));
  if (!exp) return false;
  if (exp <= Date.now()) {
    revoked.delete(String(jti));
    return false;
  }
  return true;
}

/**
 * Valida frescura de una sesión decodificada (post-verify).
 * @returns {null|{status:number, error:string, code:string}} null = vigente.
 */
function checkSessionFreshness(decoded) {
  if (!decoded || typeof decoded !== 'object') {
    return { status: 401, error: 'No autorizado', code: 'UNAUTHORIZED' };
  }
  if (decoded.jti && isJtiRevoked(decoded.jti)) {
    return { status: 401, error: 'Sesión revocada. Iniciá sesión nuevamente.', code: 'SESSION_REVOKED' };
  }
  // Tokens no-usuario (admin_master, group-cart, tracking) no pasan por acá.
  if (!decoded.userId) return null;
  let user = null;
  try {
    // require perezoso: evita ciclos (db no importa este módulo).
    const db = require('../../src/db/db');
    user = db.findUserById(decoded.userId);
  } catch { /* fail-open acotado: sin DB no se puede validar */ }
  if (!user) {
    return { status: 401, error: 'Usuario no encontrado', code: 'USER_NOT_FOUND' };
  }
  const current = user.updatedAt || user.createdAt || null;
  if (decoded.pwdTs) {
    if (current && decoded.pwdTs !== current) {
      return { status: 401, error: 'Sesión revocada por cambio de credenciales. Iniciá sesión nuevamente.', code: 'SESSION_REVOKED' };
    }
  } else if (user.updatedAt) {
    // Token legacy (sin pwdTs) posterior a un cambio de clave.
    return { status: 401, error: 'Sesión anterior al cambio de credenciales. Iniciá sesión nuevamente.', code: 'SESSION_REVOKED' };
  }
  return null;
}

module.exports = { revokeJti, isJtiRevoked, checkSessionFreshness };
