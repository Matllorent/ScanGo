/**
 * reviewNudge.js — Selección de pedidos para pedir reseña "el día siguiente" (R2).
 *
 * Módulo PURO (cero I/O): recibe los pedidos (espejo local o filas cloud
 * normalizadas) y devuelve SOLO los que hoy corresponden a un nudge de reseña:
 *
 *   - estado `delivered` (la experiencia ya terminó — antes de eso molestaría);
 *   - entregado hace 26..50 horas (≈ "1 día después"; ventana holgada para
 *     absorber un cron diario que corre con jitter, sin doble toque);
 *   - teléfono del comensal normalizable (sin teléfono = no hay a dónde llegar).
 *
 * La deduplicación (que a un pedido no se le pida dos veces) vive en
 * `notification_events` (type `review_nudge_request`) — ver services/notifications.
 * El mensaje es el EMBUDO NEUTRAL de reseñas (4-5★ → Google, 1-3★ → privado):
 * jamás se pide "una reseña de 5 estrellas" (Google penaliza pedir solo positivas).
 */
const DAY_MS = 24 * 60 * 60 * 1000;

function normalizePhoneLoose(phone) {
  if (!phone) return null;
  let digits = String(phone).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < 7 || digits.length > 15) return null;
  return digits;
}

function parseOrderTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * @param {Array} orders - pedidos con { id, restaurant_id|restaurantId, status, status_updated_at|statusUpdatedAt, created_at, customer_phone, customer_name }
 * @param {object} options
 * @param {number} [options.nowMs] - reloj inyectable
 * @param {number} [options.minHours=26] - edad mínima del pedido entregado
 * @param {number} [options.maxHours=50] - edad máxima (más viejo = ya se pasó el momento)
 * @param {number} [options.maxPerRun=150] - tope por corrida (costo real de Resend)
 * @returns {{ checked:number, count:number, candidates:Array }}
 */
function collectReviewNudgeCandidates(orders, { nowMs = Date.now(), minHours = 26, maxHours = 50, maxPerRun = 150 } = {}) {
  if (!Array.isArray(orders)) {
    return { checked: 0, count: 0, candidates: [] };
  }
  const minAgeMs = minHours * 60 * 60 * 1000;
  const maxAgeMs = maxHours * 60 * 60 * 1000;
  const candidates = [];

  for (const order of orders) {
    if (!order || typeof order !== 'object') continue;
    if (order.status !== 'delivered') continue;
    const ts = parseOrderTimestamp(order.status_updated_at || order.statusUpdatedAt) || parseOrderTimestamp(order.created_at);
    if (ts === null) continue;
    const ageMs = nowMs - ts;
    if (ageMs < minAgeMs || ageMs > maxAgeMs) continue;
    const phone = normalizePhoneLoose(order.customer_phone);
    if (!phone) continue;
    const restaurantId = (typeof order.restaurant_id === 'string' && order.restaurant_id) || (typeof order.restaurantId === 'string' ? order.restaurantId : '');
    if (!restaurantId) continue;
    if (!order.id) continue;
    candidates.push({
      orderId: order.id,
      restaurantId,
      phone,
      customerName: typeof order.customer_name === 'string' ? order.customer_name.slice(0, 60) : '',
      deliveredAt: new Date(ts).toISOString()
    });
  }

  candidates.sort((a, b) => (a.deliveredAt < b.deliveredAt ? -1 : 1));
  return { checked: orders.length, count: Math.min(candidates.length, maxPerRun), candidates: candidates.slice(0, maxPerRun) };
}

module.exports = { collectReviewNudgeCandidates, normalizePhoneLoose, _DAY_MS: DAY_MS };
