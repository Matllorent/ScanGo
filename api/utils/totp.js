/**
 * TOTP (Time-based One-Time Password) verification
 * Compatible con Google Authenticator, Authy, etc.
 * RFC 6238 compliant
 */
const crypto = require('crypto');

const TOTP_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_STEP_SECONDS = 30;
const TOTP_TOLERANCE_STEPS = 2; // +/- 2 steps = 60s clock skew

function base32Decode(base32) {
  let bits = '';
  for (let i = 0; i < base32.length; i++) {
    const val = TOTP_ALPHABET.indexOf(base32.charAt(i));
    if (val !== -1) bits += val.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

function sanitizeSecret(secret) {
  let cleanSecret = String(secret).trim();
  const uriMatch = cleanSecret.match(/secret=([A-Za-z2-7=]+)/i);
  if (uriMatch) {
    cleanSecret = uriMatch[1];
  }
  cleanSecret = cleanSecret.replace(/[\s\-_=]/g, '').toUpperCase();
  return cleanSecret;
}

function sanitizeToken(token) {
  return String(token).replace(/\D/g, '').trim();
}

/**
 * Verifica un token TOTP
 * @param {string} token - Código de 6 dígitos
 * @param {string} secret - Secreto base32 (puede ser otpauth:// URL)
 * @returns {boolean} - true si el token es válido
 */
function verifyTotpToken(token, secret) {
  // Fail-closed: sin secreto NO hay bypass (antes devolvía true).
  if (!secret) return false;
  if (!token) return false;

  const cleanSecret = sanitizeSecret(secret);
  const cleanToken = sanitizeToken(token);

  if (!cleanSecret) return false;
  if (cleanToken.length !== 6) return false;

  try {
    const keyBuffer = base32Decode(cleanSecret);
    const epoch = Math.floor(Date.now() / 1000);
    const currentStep = Math.floor(epoch / TOTP_STEP_SECONDS);

    // Tolerance window of +/- TOTP_TOLERANCE_STEPS steps
    for (let offset = -TOTP_TOLERANCE_STEPS; offset <= TOTP_TOLERANCE_STEPS; offset++) {
      const step = currentStep + offset;
      const timeBuffer = Buffer.alloc(8);
      timeBuffer.writeUInt32BE(0, 0);
      timeBuffer.writeUInt32BE(step, 4);
      const hmac = crypto.createHmac('sha1', keyBuffer);
      hmac.update(timeBuffer);
      const digest = hmac.digest();
      const hmacOffset = digest[digest.length - 1] & 0xf;
      const code = ((digest[hmacOffset] & 0x7f) << 24 |
        (digest[hmacOffset + 1] & 0xff) << 16 |
        (digest[hmacOffset + 2] & 0xff) << 8 |
        (digest[hmacOffset + 3] & 0xff)) % 1000000;
      const candidate = code.toString().padStart(6, '0');
      // Comparación en tiempo constante + un solo uso por código.
      if (candidate.length === cleanToken.length
        && crypto.timingSafeEqual(Buffer.from(candidate, 'utf8'), Buffer.from(cleanToken, 'utf8'))) {
        if (wasTotpUsed(cleanSecret, step)) return false;
        markTotpUsed(cleanSecret, step);
        return true;
      }
    }
  } catch (e) {
    // Silent fail - invalid secret format or crypto error
  }
  return false;
}

// Caché anti-replay: un código TOTP vale una sola vez dentro de su ventana.
// Memoria en proceso con TTL (suficiente contra reintentos automatizados).
const usedTotpCodes = new Map(); // key `${secretHash}:${step}` -> expiresAt
function markTotpUsed(secret, step) {
  try {
    const key = crypto.createHash('sha256').update(String(secret)).digest('hex') + ':' + step;
    usedTotpCodes.set(key, Date.now() + (TOTP_STEP_SECONDS * 1000 * (TOTP_TOLERANCE_STEPS + 1)));
    if (usedTotpCodes.size > 5000) {
      const now = Date.now();
      for (const [k, exp] of usedTotpCodes) {
        if (exp < now) usedTotpCodes.delete(k);
        if (usedTotpCodes.size < 4000) break;
      }
    }
  } catch { /* best-effort */ }
}
function wasTotpUsed(secret, step) {
  try {
    const key = crypto.createHash('sha256').update(String(secret)).digest('hex') + ':' + step;
    const exp = usedTotpCodes.get(key);
    if (exp && exp > Date.now()) return true;
    if (exp) usedTotpCodes.delete(key);
  } catch { /* best-effort */ }
  return false;
}

/**
 * Genera un token TOTP actual (para testing/debugging)
 * @param {string} secret - Secreto base32
 * @returns {string} - Token actual de 6 dígitos
 */
function generateTotpToken(secret) {
  const cleanSecret = sanitizeSecret(secret);
  if (!cleanSecret) return null;

  try {
    const keyBuffer = base32Decode(cleanSecret);
    const epoch = Math.floor(Date.now() / 1000);
    const currentStep = Math.floor(epoch / TOTP_STEP_SECONDS);

    const timeBuffer = Buffer.alloc(8);
    timeBuffer.writeUInt32BE(0, 0);
    timeBuffer.writeUInt32BE(currentStep, 4);
    const hmac = crypto.createHmac('sha1', keyBuffer);
    hmac.update(timeBuffer);
    const digest = hmac.digest();
    const hmacOffset = digest[digest.length - 1] & 0xf;
    const code = ((digest[hmacOffset] & 0x7f) << 24 |
      (digest[hmacOffset + 1] & 0xff) << 16 |
      (digest[hmacOffset + 2] & 0xff) << 8 |
      (digest[hmacOffset + 3] & 0xff)) % 1000000;
    return code.toString().padStart(6, '0');
  } catch (e) {
    return null;
  }
}

module.exports = {
  verifyTotpToken,
  generateTotpToken,
  sanitizeSecret,
  sanitizeToken
};