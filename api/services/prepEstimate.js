/**
 * api/services/prepEstimate.js
 * ────────────────────────────
 * F7 "El Tiempo Real": capa con I/O de la estimación de preparación.
 *
 * - Consulta `db.getOrderPrepRows` (unión nube ∪ espejo local) en la ventana
 *   de 7 días y delega la matemática al módulo puro `api/utils/prepEstimate`.
 * - Cachea por restaurante 10 minutos con tope de 500 entradas: el menú es la
 *   ruta más caliente y una consulta por request sería un impuesto absurdo.
 * - Respeta el interruptor del dueño (`showPrepEstimate !== false`): apagado
 *   NO consulta pedidos ni emite números (cero costo).
 * - Fail-open: si la consulta falla, la carta/pedido se sirve SIN estimación.
 *   Un ETA es información, nunca puede romper el menú ni el seguimiento.
 */

const db = require('../../src/db/db');
const prepEstimate = require('../utils/prepEstimate');
const { captureException } = require('../utils/sentry');

const cache = new Map(); // restaurantId -> { at, value }

/**
 * @returns {Promise<null | {samples, p50, p90, min, max, label, windowDays, generatedAt}>}
 */
async function getPrepEstimateForRestaurant(restaurant, { nowMs = Date.now() } = {}) {
  if (!restaurant || !restaurant.id) return null;
  if (restaurant.showPrepEstimate === false) return null;

  const restaurantId = String(restaurant.id);
  const cached = cache.get(restaurantId);
  if (cached && (nowMs - cached.at) < prepEstimate.PREP_CACHE_MS) {
    return cached.value;
  }

  try {
    const window = prepEstimate.getPrepWindow(nowMs);
    const rows = await db.getOrderPrepRows(restaurantId, window.startIso, window.endIso);
    const value = prepEstimate.computePrepEstimate(rows, { nowMs });
    if (cache.size > 500) cache.clear();
    cache.set(restaurantId, { at: nowMs, value });
    return value;
  } catch (err) {
    captureException(err, { source: 'prepEstimate', level: 'warn', tags: { restaurantId } });
    console.warn('[prepEstimate] ventana no disponible (carta sin ETA):', (err && err.message) || err);
    return null;
  }
}

/** Solo para tests: vacía la cache en proceso. */
function clearPrepEstimateCache() {
  cache.clear();
}

module.exports = { getPrepEstimateForRestaurant, clearPrepEstimateCache };
