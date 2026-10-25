/**
 * public/js/kitchen/kitchenStations.js
 * ───────────────────────────────────────────────────────────────────────────
 * F6 "Estaciones de cocina" — filtrado PURO de la pizarra KDS.
 *
 * El dueño asigna una estación a cada plato (`dish.station`, texto libre). El
 * KDS resuelve `dishId → station` contra la carta y ofrece chips con las
 * estaciones REALES (nunca un catálogo inventado): sin estaciones en la carta
 * la barra no existe.
 *
 * Invariante de honestidad operativa (la cocina JAMÁS pierde trabajo):
 *  - Un ítem SIN estación no está "en ninguna": se ve en TODAS (fail-open).
 *  - Un pedido se muestra si al menos un ítem matchea la estación elegida.
 *  - Al filtrar solo se ocultan los ítems de OTRAS estaciones, y la tarjeta
 *    informa cuántos quedaron afuera ("＋N ítems en otra estación"): nada
 *    desaparece en silencio.
 */

import { sanitizeStation, stationKey } from '../utils/dishStation.js';

/** Clave del chip "Todos" (sin filtro). */
export const ALL_STATIONS_KEY = '';

/**
 * Estaciones presentes en el KDS, ordenadas alfabéticamente (es).
 * La PRIMERA grafía encontrada manda como etiqueta visible.
 *
 * `extraStations` (opcional) son las estaciones de la CARTA: se suman a las
 * que aparecen en las tarjetas para que una estación sin pedidos activos no
 * pierda su chip (la cocina no ve "desaparecer" su filtro a media tarde).
 * @param {Array<object>} models modelos de tarjeta (con `items[].station`)
 * @param {Array<string>} [extraStations] estaciones declaradas en la carta
 * @returns {Array<{key: string, label: string}>}
 */
export function getStationOptions(models, extraStations) {
  const seen = new Map();
  const add = (raw) => {
    const key = stationKey(raw);
    if (!key || seen.has(key)) return;
    seen.set(key, sanitizeStation(raw));
  };
  for (const station of Array.isArray(extraStations) ? extraStations : []) add(station);
  for (const model of Array.isArray(models) ? models : []) {
    const items = model && Array.isArray(model.items) ? model.items : [];
    for (const item of items) add(item && item.station);
  }
  return Array.from(seen.entries())
    .sort((a, b) => a[1].localeCompare(b[1], 'es'))
    .map(([key, label]) => ({ key, label }));
}

/**
 * Filtra las tarjetas por estación. Con clave vacía devuelve los modelos tal
 * cual (sin copiarlos, cero trabajo extra en el caso normal).
 * @param {Array<object>} models
 * @param {string} key clave de estación (`ALL_STATIONS_KEY` = todos)
 * @returns {Array<object>} modelos (posiblemente recortados) con `hiddenItems`
 */
export function filterModelsByStation(models, key) {
  const list = Array.isArray(models) ? models : [];
  const wanted = stationKey(key);
  if (!wanted) return list;

  const out = [];
  for (const model of list) {
    if (!model) continue;
    const items = Array.isArray(model.items) ? model.items : [];
    const kept = items.filter((item) => {
      const itemKey = stationKey(item && item.station);
      // Sin estación = visible en todas (nunca se pierde un ítem).
      return !itemKey || itemKey === wanted;
    });
    if (!kept.length) continue;
    out.push({ ...model, items: kept, hiddenItems: items.length - kept.length });
  }
  return out;
}

/**
 * Valida la estación recordada en el device contra las disponibles. Si la
 * estación ya no existe (el dueño la renombró o borró) cae a "Todos": nunca
 * se queda mostrando una pizarra vacía por un valor viejo en localStorage.
 * @param {string} stored
 * @param {Array<{key: string, label: string}>} options
 * @returns {string} clave válida ('' = todos)
 */
export function resolveStoredStation(stored, options) {
  const wanted = stationKey(stored);
  if (!wanted) return ALL_STATIONS_KEY;
  const available = (Array.isArray(options) ? options : []).some(o => o && o.key === wanted);
  return available ? wanted : ALL_STATIONS_KEY;
}
