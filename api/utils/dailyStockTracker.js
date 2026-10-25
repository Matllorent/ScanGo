'use strict';

/**
 * api/utils/dailyStockTracker.js — F3 "Agotados con memoria" (oct-2026), Serie
 * "El Sistema". Módulo PURO (cero I/O, cero requires de src/routes/middleware:
 * guard B de arquitectura) — el llamador trae los pedidos YA recortados.
 *
 * Contrato (docs/plan-ejecucion-bloque-sistema-oct-2026.md §3):
 *   - `dish.dailyStock` es OPT-IN (entero 1..9999): `undefined` = sin memoria,
 *     el comportamiento actual queda intacto y no se consulta `orders` extra.
 *   - "Vendo ~30 por día" → cuando el día local vendió 30, el plato se pausa
 *     solo con "Agotado hoy" y revive solo a la medianoche del dueño (ventana
 *     derivada, CERO cron de reset).
 *   - La ventana del día local es la MISMA de F1 "El Cierre"
 *     (`nightSummary.localDayWindow`): huso del dueño (utcOffsetMinutes
 *     capturado en cada save del Studio), medianoche inclusiva [00:00, 24:00)
 *     local expresada como rango UTC exacto para SQL y espejo.
 *   - El flag MANUAL `dish.outOfStock` del dueño GANA SIEMPRE: este módulo
 *     solo emite el DERIVADO (`soldOutToday: boolean`), jamás escribe lo
 *     manual (el badge/tachado/`+` bloqueado reutilizan el mismo render).
 *   - Los pedidos CANCELADOS no consumen stock (el plato no salió de cocina).
 */

const { localDayWindow, clampOffset } = require('./nightSummary');

const MIN_DAILY_STOCK = 1;
const MAX_DAILY_STOCK = 9999;

/**
 * Valor crudo del campo → entero válido 1..9999. Lo demás (undefined/null,
 * string, fracción, negativo, fuera de rango) → null = el plato queda SIN
 * memoria de stock (comportamiento actual). Así el sanitizer y el Studio
 * comparten UNA sola regla y el campo nunca se cuela inválido.
 */
function parseDailyStock(value) {
  // Solo número o string numérica: un `true` (Number(true)=1) o un objeto no
  // pueden convertirse en un tope de ventas por accidente.
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return null;
  if (n < MIN_DAILY_STOCK || n > MAX_DAILY_STOCK) return null;
  return n;
}

/**
 * Ventana UTC [start, end) del día local EN CURSO del dueño (misma frontera
 * del día que F1). Overkill el offset inválido: clampa ±840 como toda la casa.
 * @returns {{ localDay: string, startUtc: string, endUtc: string }}
 */
function getDailyStockWindow(nowMs, utcOffsetMinutes) {
  return localDayWindow(nowMs, clampOffset(utcOffsetMinutes), 0);
}

/**
 * Σ de unidades vendidas por dishId a partir de filas de pedidos YA recortadas
 * por la ventana (la unión nube ∪ espejo la hace el llamador, patrón El
 * Cierre). Cancelados excluidos; líneas sin dishId legible (helado a medida y
 * snapshots viejos) se saltan: el stock diario es sobre platos de la carta.
 * @param {Array<{items_snapshot?:Array, itemsSnapshot?:Array, status?:string}>} orders
 * @returns {Map<string, number>}
 */
function sumSoldByDish(orders) {
  const sold = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== 'object') continue;
    if (String(order.status || '').toLowerCase() === 'cancelled') continue;
    const items = order.items_snapshot || order.itemsSnapshot;
    if (!Array.isArray(items)) continue;
    for (const line of items) {
      if (!line || typeof line !== 'object') continue;
      const dishId = line.dishId;
      if (typeof dishId !== 'string' || !dishId || dishId.startsWith('icecream_')) continue;
      const qty = Math.max(0, Math.round(Number(line.quantity ?? line.qty) || 0));
      if (qty <= 0) continue;
      sold.set(dishId, (sold.get(dishId) || 0) + qty);
    }
  }
  return sold;
}

/**
 * ¿Se agotó HOY? true sii el plato tiene dailyStock válido y las unidades
 * vendidas del día llegaron o PASARON el tope (borde inclusivo: >=).
 * Sin tope (parse null) o sin datos de ventas → false: fail-open, nunca se
 * auto-agota por falla de infraestructura.
 */
function computeSoldOutToday(dish, soldTodayQty = 0) {
  if (!dish || typeof dish !== 'object') return false;
  const stock = parseDailyStock(dish.dailyStock);
  if (stock === null) return false;
  const qty = Math.max(0, Math.round(Number(soldTodayQty) || 0));
  return qty >= stock;
}

/**
 * Marca el DERIVADO en cada plato del payload público: `soldOutToday` boolean
 * SIEMPRE presente (estable para el frontend) y el manual `outOfStock` viaja
 * intacto — el render decide `outOfStock || soldOutToday`.
 */
function attachSoldOutToday(dishes, soldByDish) {
  const sold = soldByDish instanceof Map ? soldByDish : new Map();
  return (Array.isArray(dishes) ? dishes : []).map((dish) => ({
    ...dish,
    soldOutToday: computeSoldOutToday(dish, (dish && sold.get(dish.id)) || 0),
  }));
}

/** ¿Vale la pena mirar `orders`? Cero consultas extra para los locales que no
 *  usan la memoria de stock (el 99% hoy): el costo del agregado lo pagan solo
 *  los que lo configuraron, y ya está acotado por el cache de menú (60s). */
function anyDishWithDailyStock(dishes) {
  return (Array.isArray(dishes) ? dishes : []).some(
    (d) => parseDailyStock(d && d.dailyStock) !== null
  );
}

module.exports = {
  MIN_DAILY_STOCK,
  MAX_DAILY_STOCK,
  parseDailyStock,
  getDailyStockWindow,
  sumSoldByDish,
  computeSoldOutToday,
  attachSoldOutToday,
  anyDishWithDailyStock,
};
