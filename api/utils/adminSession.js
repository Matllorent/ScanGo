/**
 * api/utils/adminSession.js
 * ─────────────────────────
 * Fuente única de los secretos y constantes de la sesión del panel maestro
 * (`/admin`). Lo requieren `api/index.js` (gate 403, MP webhook con secreto
 * en query) y `api/routes/admin.js` (login/logout). Un solo lugar: si cambia,
 * cambia en ambos sin drift.
 */
const crypto = require('crypto');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const ADMIN_KEY = process.env.ADMIN_KEY || 'pizarron_admin_master_key_2026';

// Production-ready secure cookie flags
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

const ADMIN_SESSION_IDLE_TIMEOUT_SECONDS = 15 * 60;

// Comparación de secretos en tiempo constante (evita oráculo de timing).
// timingSafeEqual exige igual longitud: se hashea con SHA-256 primero.
function timingSafeEqualHex(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

module.exports = {
  JWT_SECRET,
  ADMIN_KEY,
  COOKIE_OPTIONS,
  ADMIN_SESSION_IDLE_TIMEOUT_SECONDS,
  timingSafeEqualHex
};
