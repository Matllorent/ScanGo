const crypto = require('crypto');

/**
 * Token de seguimiento de pedido SIN estado (stateless).
 *
 * El comensal recibe `${orderId}.${firma}` al hacer el pedido. La firma es un
 * HMAC-SHA256 del orderId, así que el backend puede validar un pedido sin
 * guardar nada extra ni agregar columnas: si el token verifica, el orderId es
 * auténtico e inforjable, y el estado se lee/persiste en la tabla `orders`.
 *
 * El secreto cae a GROUP_CART_SECRET / JWT_SECRET para no exigir una variable
 * nueva en los entornos ya existentes.
 */
function getSecret() {
  return process.env.ORDER_TRACKING_SECRET
    || process.env.GROUP_CART_SECRET
    || process.env.JWT_SECRET
    || 'dev_secret_menu_pizarron_2026';
}

function base64url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Firma el id de un pedido. Devuelve null si no hay id.
 * @param {string} orderId
 * @param {string} [secret] (para tests)
 * @returns {string|null}
 */
function signOrderToken(orderId, secret = getSecret()) {
  if (!orderId) return null;
  const signature = base64url(crypto.createHmac('sha256', secret).update(String(orderId)).digest());
  return `${orderId}.${signature}`;
}

/**
 * Verifica un token y devuelve el orderId, o null si es inválido/adulterado.
 * Comparación en tiempo constante para no filtrar la firma.
 * @param {string} token
 * @param {string} [secret] (para tests)
 * @returns {string|null}
 */
function verifyOrderToken(token, secret = getSecret()) {
  if (!token || typeof token !== 'string') return null;
  const index = token.lastIndexOf('.');
  if (index <= 0 || index === token.length - 1) return null;
  const orderId = token.slice(0, index);
  const provided = token.slice(index + 1);
  const expected = base64url(crypto.createHmac('sha256', secret).update(orderId).digest());
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return null;
  if (!crypto.timingSafeEqual(a, b)) return null;
  return orderId;
}

module.exports = { signOrderToken, verifyOrderToken, getSecret };
