/**
 * api/utils/dishStation.js
 * ───────────────────────────────────────────────────────────────────────────
 * F6 "Estaciones de cocina" (Serie 5 "El Sistema", oct-2026).
 *
 * `dish.station` es TEXTO LIBRE del dueño ("Barra", "Cocina", "Fríos",
 * "Parrilla"…): no se hardcodea ningún catálogo porque cada local arma su
 * cocina como quiere. El KDS deriva los chips de las estaciones REALES de la
 * carta (cero demo).
 *
 * Reglas de normalización (UNA sola fuente, espejo ESM en
 * public/js/utils/dishStation.js — paridad testeada):
 *  - Solo strings: números/booleanos/objetos → '' (nunca "undefined").
 *  - Se quitan caracteres de control (rompen el render y los logs).
 *  - Espacios colapsados y recortados: "  Barra   fría " → "Barra fría".
 *  - Máximo MAX_STATION_LEN caracteres; vacío = SIN estación (se ve en todas).
 * Módulo puro: cero I/O.
 */

const MAX_STATION_LEN = 16;

/**
 * @param {*} raw
 * @returns {string} estación normalizada o '' si no hay una válida
 */
function sanitizeStation(raw) {
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

module.exports = { MAX_STATION_LEN, sanitizeStation };
