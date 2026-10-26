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
 * Límite honesto documentado (deliberate skip v1): NO hay estimación por
 * modalidad (mesa / delivery / takeaway) porque `order_mode` no se persiste
 * en la base (ni local ni cloud). El número es del LOCAL completo: "los
 * pedidos de este local tardan ~X–Y min". Una ventana por modalidad
 * requeriría persistir `orders.order_mode` (migración nueva) — fuera de v1.
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
 * Estimación a partir de filas de pedidos (ya recortadas por ventana o no).
 * @returns {null | {samples:number, p50:number, p90:number, min:number, max:number, label:string, windowDays:number}}
 */
function computePrepEstimate(orders, { nowMs = Date.now() } = {}) {
  const rows = Array.isArray(orders) ? orders.slice(0, PREP_MAX_ROWS) : [];
  if (rows.length === 0) return null;

  const minutes = [];
  for (const order of rows) {
    const value = prepMinutesForOrder(order);
    if (value !== null) minutes.push(value);
  }
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

module.exports = {
  PREP_WINDOW_DAYS,
  PREP_MIN_SAMPLES,
  PREP_MAX_MINUTES,
  PREP_CACHE_MS,
  PREP_MAX_ROWS,
  PREP_TERMINAL_STATUSES,
  toMs,
  getPrepWindow,
  prepMinutesForOrder,
  percentile,
  buildPrepLabel,
  computePrepEstimate
};
