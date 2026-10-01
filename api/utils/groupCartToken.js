const crypto = require('crypto');

function getGroupCartSecret() {
  return process.env.GROUP_CART_SECRET || process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
}

function createGroupCartToken(restaurantId, tableNumber) {
  const payload = `${restaurantId}:${String(tableNumber)}`;
  return crypto.createHmac('sha256', getGroupCartSecret()).update(payload).digest('base64url');
}

function verifyGroupCartToken(restaurantId, tableNumber, token) {
  if (typeof token !== 'string' || !token) return false;
  const expected = Buffer.from(createGroupCartToken(restaurantId, tableNumber));
  const provided = Buffer.from(token);
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}

module.exports = { createGroupCartToken, verifyGroupCartToken };