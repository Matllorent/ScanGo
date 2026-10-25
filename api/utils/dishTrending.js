/**
 * api/utils/dishTrending.js
 * ───────────────────────────────────────────────────────────────────────────
 * F5 "Tendencia honesta" (Serie 5 "El Sistema", oct-2026).
 *
 * El chip "🔥 Muy pedido esta semana" es una AFIRMACIÓN: se emite solo cuando
 * hay evidencia real de ventas, con una ventana explícita y un umbral mínimo.
 * Nada de inferencias ni de "populares" inventados:
 *  - La evidencia son UNIDADES VENDIDAS en los últimos 7 días (orden real del
 *    comensal), no clicks ni el proxy del chef. `sumSoldByDish`
 *    (api/utils/dailyStockTracker.js) ya excluye cancelados y líneas basura.
 *  - Umbral mínimo: un plato con 2 ventas no es "muy pedido" (sería mentira).
 *  - Tope de 3 etiquetas: la carta no se convierte en un cartel de ofertas.
 *  - Un plato que ya no existe en la carta NUNCA se etiqueta (id huérfano).
 *
 * El payload público recibe SOLO la etiqueta textual; jamás unidades,
 * scores ni conteos. Módulo puro (cero I/O): el fetch y el cache viven en la
 * ruta (api/routes/menu.js).
 */

// Copy explícita del período: dice "esta semana" porque la ventana es 7 días.
const TRENDING_LABEL = '🔥 Muy pedido esta semana';
const TRENDING_WINDOW_DAYS = 7;
const TRENDING_MIN_UNITS = 3;
const TRENDING_MAX_LABELS = 3;
// Cache en proceso de la ruta: 10 min por local (máx 6 consultas/hora/local).
const TRENDING_CACHE_MS = 10 * 60 * 1000;

/**
 * Ventana de la evidencia: [ahora - N días, ahora] en ISO (UTC). Es un rango
 * cerrado-abierto como el de F1/F3, así el mismo pedido no entra dos veces en
 * dos corridas consecutivas.
 * @param {number} [nowMs] reloj inyectable (tests)
 * @param {number} [windowDays]
 * @returns {{startIso: string, endIso: string}}
 */
function getTrendingWindow(nowMs = Date.now(), windowDays = TRENDING_WINDOW_DAYS) {
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const days = Number.isFinite(Number(windowDays)) && Number(windowDays) > 0
    ? Math.floor(Number(windowDays))
    : TRENDING_WINDOW_DAYS;
  return {
    startIso: new Date(now - days * 24 * 60 * 60 * 1000).toISOString(),
    endIso: new Date(now).toISOString()
  };
}

/**
 * Deriva las etiquetas de tendencia desde el agregado de ventas.
 * @param {Map<string, number>|Object} soldByDish unidades vendidas por dishId
 * @param {Array<object>} dishes carta real (solo esos ids pueden etiquetarse)
 * @param {{minUnits?: number, maxLabels?: number}} [options]
 * @returns {Map<string, string>} dishId → etiqueta
 */
function computeTrendingLabels(soldByDish, dishes, options = {}) {
  const minUnits = Number.isFinite(Number(options.minUnits)) && Number(options.minUnits) > 0
    ? Math.floor(Number(options.minUnits))
    : TRENDING_MIN_UNITS;
  const maxLabels = Number.isFinite(Number(options.maxLabels)) && Number(options.maxLabels) > 0
    ? Math.floor(Number(options.maxLabels))
    : TRENDING_MAX_LABELS;

  const known = new Set(
    (Array.isArray(dishes) ? dishes : [])
      .map(d => (d && d.id ? String(d.id) : ''))
      .filter(Boolean)
  );

  const entries = [];
  const visit = (qty, rawId) => {
    const dishId = rawId === undefined || rawId === null ? '' : String(rawId);
    if (!dishId || !known.has(dishId)) return;
    const units = Math.floor(Number(qty));
    if (!Number.isFinite(units) || units < minUnits) return;
    entries.push([dishId, units]);
  };
  if (soldByDish instanceof Map) {
    soldByDish.forEach((qty, dishId) => visit(qty, dishId));
  } else if (soldByDish && typeof soldByDish === 'object') {
    Object.keys(soldByDish).forEach((dishId) => visit(soldByDish[dishId], dishId));
  }

  // Determinismo total: unidades desc y, en empate, id asc (nunca depende del
  // orden de inserción del Map ni del orden de la consulta).
  entries.sort((a, b) => (b[1] - a[1]) || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

  const labels = new Map();
  for (const [dishId] of entries.slice(0, maxLabels)) labels.set(dishId, TRENDING_LABEL);
  return labels;
}

/**
 * Adjunta `trendingLabel` a los platos etiquetados. Devuelve un array NUEVO
 * (no muta el input, que puede venir del cache del menú).
 * @param {Array<object>} dishes
 * @param {Map<string, string>} labels
 * @returns {Array<object>}
 */
function attachTrendingLabel(dishes, labels) {
  const list = Array.isArray(dishes) ? dishes : [];
  if (!(labels instanceof Map) || labels.size === 0) return list.slice();
  return list.map(d => {
    if (!d || !d.id) return d;
    const label = labels.get(String(d.id));
    return label ? { ...d, trendingLabel: label } : d;
  });
}

module.exports = {
  TRENDING_LABEL,
  TRENDING_WINDOW_DAYS,
  TRENDING_MIN_UNITS,
  TRENDING_MAX_LABELS,
  TRENDING_CACHE_MS,
  getTrendingWindow,
  computeTrendingLabels,
  attachTrendingLabel
};
