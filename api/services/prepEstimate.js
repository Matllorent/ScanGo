/**
 * api/services/prepEstimate.js
 * ────────────────────────────
 * F7 "El Tiempo Real": capa con I/O de la estimación de preparación.
 *
 * - Consulta `db.getOrderPrepRows` (unión nube ∪ espejo local) en la ventana
 *   de 7 días y delega la matemática al módulo puro `api/utils/prepEstimate`.
 * - F7-v2: el bundle completo (estimación general + POR MODALIDAD) se computa
 *   en UNA consulta y una pasada; la cache guarda el bundle entero, así la
 *   carta y el seguimiento comparten la MISMA entrada de 10 minutos.
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

const cache = new Map(); // restaurantId -> { at, bundle: { all, byMode } }

/**
 * Bundle F7-v2: `{ all, byMode: {LOCAL, DELIVERY, TAKEAWAY} }` — la estimación
 * general es EXACTAMENTE la de F7 (compat 60ª suite) y cada modalidad lleva el
 * mismo objeto (o null si no alcanza SU mínimo de muestras). `null` si el
 * dueño lo apagó, si la consulta falla o si no hay restaurante.
 * @returns {Promise<null | {all, byMode}>}
 */
async function getPrepEstimateBundleForRestaurant(restaurant, { nowMs = Date.now() } = {}) {
  if (!restaurant || !restaurant.id) return null;
  if (restaurant.showPrepEstimate === false) return null;

  const restaurantId = String(restaurant.id);
  const cached = cache.get(restaurantId);
  if (cached && (nowMs - cached.at) < prepEstimate.PREP_CACHE_MS) {
    return cached.bundle;
  }

  try {
    const window = prepEstimate.getPrepWindow(nowMs);
    const rows = await db.getOrderPrepRows(restaurantId, window.startIso, window.endIso);
    const bundle = prepEstimate.computePrepEstimates(rows, { nowMs });
    if (cache.size > 500) cache.clear();
    cache.set(restaurantId, { at: nowMs, bundle });
    return bundle;
  } catch (err) {
    captureException(err, { source: 'prepEstimate', level: 'warn', tags: { restaurantId } });
    console.warn('[prepEstimate] ventana no disponible (carta sin ETA):', (err && err.message) || err);
    return null;
  }
}

/**
 * Compat F7 (60ª suite): la MISMA estimación general de siempre. Lee el bundle
 * cacheado — cero consultas extra respecto a la v1.
 * @returns {Promise<null | {samples, p50, p90, min, max, label, windowDays, generatedAt}>}
 */
async function getPrepEstimateForRestaurant(restaurant, { nowMs = Date.now() } = {}) {
  const bundle = await getPrepEstimateBundleForRestaurant(restaurant, { nowMs });
  return bundle ? bundle.all : null;
}

/** Solo para tests: vacía la cache en proceso. */
function clearPrepEstimateCache() {
  cache.clear();
}

module.exports = { getPrepEstimateBundleForRestaurant, getPrepEstimateForRestaurant, clearPrepEstimateCache };
