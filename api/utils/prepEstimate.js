/**
 * api/utils/prepEstimate.js
 * ─────────────────────────
 * F7 "El Tiempo Real" — estimación HONESTA de cuánto tarda un pedido.
 *
 * Módulo PURO: cero I/O, cero require de src/db/routes/middleware (guard de
 * arquitectura B). Toda la decisión vive acá para poder testearla con reloj
 * inyectable y sin servidor.
 *
 * Qué hace (y qué NO hace):
 *  - Mide el tiempo REAL de pedidos que el local ya terminó: delta entre
 *    `created_at` y `status_updated_at` de pedidos con estado terminal
 *    (`delivered`). Es una AFIRMACIÓN sobre el local, no una predicción.
 *  - Excluye cancelados (no miden cocina) y pedidos zombis (> PREP_MAX_MINUTES,
 *    probablemente nadie cerró el estado: no son un tiempo de preparación).
 *  - Exige una muestra mínima (PREP_MIN_SAMPLES) en la ventana de 7 días.
 *    Menos que eso es anécdota: devuelve `null` y el chip NO aparece.
 *    Regla de la casa: omitir antes que inventar.
 *  - Devuelve p50 y p90 (nearest-rank), no un promedio que esconde la cola.
 *  - NO consulta la base, NO cachea, NO decide si el dueño lo habilitó:
 *    eso es `api/services/prepEstimate.js` y las rutas.
 *
 * F7-v2 (migración 009 aplicada): `orders.order_mode` existe en cloud y en el
 * espejo local, así que el deliberate skip de la v1 murió. `computePrepEstimates`
 * computa la estimación GENERAL (idéntica a la v1) y la POR MODALIDAD
 * (LOCAL/DELIVERY/TAKEAWAY) en UNA sola pasada sobre las mismas filas — cero
 * consultas extra, tope de filas compartido. Cada modalidad exige SU PROPIO
 * mínimo de muestras: 20 pedidos en total no autorizan un ETA de delivery con
 * solo 3 delivery. Filas históricas sin modo → 'LOCAL' (la asunción legacy
 * documentada de la casa: el espejo y el fallback de filas viejas asumían salón).
 */

const PREP_WINDOW_DAYS = 7;
// Menos de 20 pedidos en una semana es anécdota, no estadística.
const PREP_MIN_SAMPLES = 20;
// Un pedido de 6 horas no es "preparación": es un estado que nadie cerró.
const PREP_MAX_MINUTES = 240;
// El chip no necesita frescura de segundos: 10 min por local es suficiente
// y evita una consulta de pedidos por request de menú.
const PREP_CACHE_MS = 10 * 60 * 1000;
const PREP_MAX_ROWS = 500;
// Estados que ya no pueden cambiar: solo esos miden un tiempo completo.
const PREP_TERMINAL_STATUSES = ['delivered'];
// Modalidades canónicas de `orders.order_mode` (CHECK de la migración 009).
const PREP_MODES = ['LOCAL', 'DELIVERY', 'TAKEAWAY'];

const MINUTE_MS = 60 * 1000;

/** Acepta epoch ms, número en string o ISO (mismo patrón que nightSummary). */
function toMs(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^\d+$/.test(trimmed)) {
      const asNumber = Number(trimmed);
      return Number.isFinite(asNumber) ? asNumber : null;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

/** Ventana de la medición: los últimos N días, en rango ISO [start, end). */
function getPrepWindow(nowMs = Date.now()) {
  const endMs = toMs(nowMs) || Date.now();
  const startMs = endMs - PREP_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

/**
 * Minutos reales que tardó UN pedido, o `null` si no sirve como muestra.
 * - Solo pedidos en estado terminal completado (`delivered`).
 * - Cantidades duales camel/snake (cloud y espejo local conviven).
 */
function prepMinutesForOrder(order) {
  if (!order || typeof order !== 'object') return null;
  const status = String(order.status || '').toLowerCase();
  if (!PREP_TERMINAL_STATUSES.includes(status)) return null;

  const createdMs = toMs(order.created_at !== undefined ? order.created_at : order.createdAt);
  const finishedMs = toMs(order.status_updated_at !== undefined ? order.status_updated_at : order.statusUpdatedAt);
  if (createdMs === null || finishedMs === null) return null;

  const minutes = (finishedMs - createdMs) / MINUTE_MS;
  if (!Number.isFinite(minutes) || minutes <= 0) return null;
  if (minutes > PREP_MAX_MINUTES) return null;
  return minutes;
}

/**
 * Modalidad canónica de UN pedido (dual camel/snake, espejo del KDS y del
 * comandero). Basura/ausente → 'LOCAL': es la asunción legacy de la casa
 * para filas históricas — nunca inventa una modalidad que no viajó.
 * @returns {'LOCAL'|'DELIVERY'|'TAKEAWAY'}
 */
function prepModeForOrder(order) {
  if (!order || typeof order !== 'object') return 'LOCAL';
  const raw = order.order_mode !== undefined ? order.order_mode : order.orderMode;
  const normalized = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  return PREP_MODES.includes(normalized) ? normalized : 'LOCAL';
}

/** Percentil por nearest-rank (sin interpolación: no inventa decimales). */
function percentile(sorted, p) {
  if (!Array.isArray(sorted) || sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

/** Copy del chip: "~12–18 min" (o "~12 min" si p50 === p90). */
function buildPrepLabel(estimate = {}) {
  const source = estimate && typeof estimate === 'object' ? estimate : {};
  const min = Number(source.p50);
  const max = Number(source.p90);
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return '';
  if (max <= min) return `~${Math.round(min)} min`;
  return `~${Math.round(min)}–${Math.round(max)} min`;
}

/**
 * Objeto estimación a partir de minutos VÁLIDOS ya recolectados (menos del
 * mínimo → null: omitir antes que inventar, la regla de la casa).
 */
function buildEstimateFromMinutes(minutes, nowMs) {
  if (minutes.length < PREP_MIN_SAMPLES) return null;
  minutes.sort((a, b) => a - b);
  const p50 = Math.round(percentile(minutes, 50));
  const p90 = Math.round(percentile(minutes, 90));
  const roundedMin = Math.max(1, Math.min(p50, p90));
  const roundedMax = Math.max(roundedMin, p90);

  return {
    samples: minutes.length,
    p50: roundedMin,
    p90: roundedMax,
    min: roundedMin,
    max: roundedMax,
    label: buildPrepLabel({ p50: roundedMin, p90: roundedMax }),
    windowDays: PREP_WINDOW_DAYS,
    generatedAt: new Date(toMs(nowMs) || Date.now()).toISOString()
  };
}

/**
 * F7-v2: estimación GENERAL + POR MODALIDAD en UNA sola pasada sobre las
 * mismas filas (cero consultas extra; el tope PREP_MAX_ROWS es compartido).
 * `all` y cada clave de `byMode` son el MISMO objeto estimación (o null si esa
 * muestra no alcanza el mínimo).
 * @returns {{all: (null|object), byMode: {LOCAL: (null|object), DELIVERY: (null|object), TAKEAWAY: (null|object)}}}
 */
function computePrepEstimates(orders, { nowMs = Date.now() } = {}) {
  const rows = Array.isArray(orders) ? orders.slice(0, PREP_MAX_ROWS) : [];
  const byModeMinutes = { LOCAL: [], DELIVERY: [], TAKEAWAY: [] };
  for (const order of rows) {
    const value = prepMinutesForOrder(order);
    if (value === null) continue;
    byModeMinutes[prepModeForOrder(order)].push(value);
  }
  return {
    all: buildEstimateFromMinutes(
      byModeMinutes.LOCAL.concat(byModeMinutes.DELIVERY, byModeMinutes.TAKEAWAY),
      nowMs
    ),
    byMode: {
      LOCAL: buildEstimateFromMinutes(byModeMinutes.LOCAL, nowMs),
      DELIVERY: buildEstimateFromMinutes(byModeMinutes.DELIVERY, nowMs),
      TAKEAWAY: buildEstimateFromMinutes(byModeMinutes.TAKEAWAY, nowMs)
    }
  };
}

/**
 * Estimación a partir de filas de pedidos (ya recortadas por ventana o no).
 * Compat F7 (60ª suite): es EXACTAMENTE la estimación general del bundle
 * (`computePrepEstimates(...).all`) — una sola fuente, cero drift posible.
 * @returns {null | {samples:number, p50:number, p90:number, min:number, max:number, label:string, windowDays:number}}
 */
function computePrepEstimate(orders, { nowMs = Date.now() } = {}) {
  return computePrepEstimates(orders, { nowMs }).all;
}

module.exports = {
  PREP_WINDOW_DAYS,
  PREP_MIN_SAMPLES,
  PREP_MAX_MINUTES,
  PREP_CACHE_MS,
  PREP_MAX_ROWS,
  PREP_TERMINAL_STATUSES,
  PREP_MODES,
  toMs,
  getPrepWindow,
  prepMinutesForOrder,
  prepModeForOrder,
  percentile,
  buildPrepLabel,
  computePrepEstimates,
  computePrepEstimate
};
