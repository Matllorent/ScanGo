/**
 * public/js/utils/dishStation.js
 * ───────────────────────────────────────────────────────────────────────────
 * Espejo ESM de `api/utils/dishStation.js` (F6 "Estaciones de cocina").
 * La MISMA regla de normalización que aplica el sanitizer del server, para
 * que el Studio guarde lo que el KDS va a comparar. Paridad exacta testeada en
 * tests/test-trending-stations.js (§2).
 */

export const MAX_STATION_LEN = 16;

/**
 * @param {*} raw
 * @returns {string} estación normalizada o '' si no hay una válida
 */
export function sanitizeStation(raw) {
  if (typeof raw !== 'string') return '';
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_STATION_LEN)
    .trim();
  return cleaned;
}

/** Clave de comparación (insensible a mayúsculas: "Barra" === "barra"). */
export function stationKey(raw) {
  return sanitizeStation(raw).toLowerCase();
}
