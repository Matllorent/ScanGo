'use strict';
/**
 * api/utils/loyaltyLevels.js — R3 "Multiplicador por nivel de lealtad" (Fornno).
 *
 * Módulo PURO (cero I/O): define y resuelve la escalera de niveles de lealtad
 * LOCAL del dueño (`restaurant.loyaltyConfig.levels`). Cada nivel es
 * `{ name, minVisits, multiplier }`: el cliente con `visits` a ESTE local
 * ≥ minVisits gana sus puntos por pedido multiplicados.
 *
 * Reglas de la casa:
 *  - OPT-IN: si `levels` no viene o es basura, el campo queda ABSENT (nunca
 *    `null`/`[]` inventado) y el crédito sigue multiplicando ×1 — ningún
 *    local existente cambia de comportamiento.
 *  - El multiplicador se resuelve con las visitas ANTES del pedido actual
 *    (el tier YA ganado): el pedido que cruza el umbral acredita todavía 1×,
 *    el siguiente gana el nivel. Determinista y sin saltos retroactivos.
 *  - `multiplier` se redondea a pasos de 0.5, clamp [1, 10].
 *  - Espejo ESM: public/js/utils/loyaltyLevels.js — paridad testeada en
 *    tests/test-quick-wins.js (corpus determinista, mismo patrón que
 *    dishStation/viralRef). Si cambiás uno, cambiá el otro.
 */

const MAX_LOYALTY_LEVELS = 5;
const MAX_MULTIPLIER = 10;
const MAX_LEVEL_NAME_LEN = 24;
const MAX_MIN_VISITS = 9999;

// Plantilla sugerida por defecto (solo se USA como valores del formulario del
// Studio; el server nunca la inventa para un local que no la pidió).
const DEFAULT_LOYALTY_LEVELS = [
  { name: 'Bronce', minVisits: 0, multiplier: 1 },
  { name: 'Plata', minVisits: 5, multiplier: 1.5 },
  { name: 'Oro', minVisits: 12, multiplier: 2 }
];

/**
 * Multiplicador válido: número finito ≥ 1, clamp [1, 10], pasos de 0.5.
 * Devuelve 0 cuando el valor es inválido (señal para descartar la fila).
 */
function sanitizeMultiplier(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(1, Math.min(MAX_MULTIPLIER, n));
  return Math.round(clamped * 2) / 2;
}

/**
 * Sanea la escalera de niveles. Devuelve `undefined` (campo ABSENT) cuando
 * no hay filas válidas; filas sin nombre o con multiplicador basura se
 * descartan. Ordena por minVisits asc y dedupe (misma frontera → primera
 * fila manda). Nunca lanza.
 */
function sanitizeLoyaltyLevels(raw) {
  if (!Array.isArray(raw)) return undefined;
  const rows = raw
    .filter(r => r && typeof r === 'object' && !Array.isArray(r))
    .map(r => {
      const name = String(r.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_LEVEL_NAME_LEN);
      if (!name) return null;
      const minVisitsRaw = Number(r.minVisits);
      if (!Number.isFinite(minVisitsRaw) || minVisitsRaw < 0) return null;
      const multiplier = sanitizeMultiplier(r.multiplier);
      if (!multiplier) return null;
      return {
        name,
        minVisits: Math.max(0, Math.min(MAX_MIN_VISITS, Math.round(minVisitsRaw))),
        multiplier
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minVisits - b.minVisits)
    .slice(0, MAX_LOYALTY_LEVELS);

  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const key = String(row.minVisits);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out.length ? out : undefined;
}

/**
 * Multiplicador vigente para un cliente con `visits` a este local:
 * el tier con mayor minVisits ≤ visits; ninguno → 1. Empate de frontera →
 * la última fila del array (el sanitize ordena asc, así que es la ingresada
 * después). Tolerante a basura; nunca lanza.
 */
function resolvePointsMultiplier(levels, visits) {
  const n = Number(visits);
  const v = Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
  if (!Array.isArray(levels) || !levels.length) return 1;
  let best = null;
  for (const level of levels) {
    if (!level || typeof level !== 'object') continue;
    const minVisits = Number(level.minVisits);
    if (!Number.isFinite(minVisits) || minVisits < 0 || minVisits > v) continue;
    const multiplier = Number(level.multiplier);
    if (!Number.isFinite(multiplier) || multiplier < 1) continue;
    if (best === null || minVisits >= best.minVisits) best = { minVisits, multiplier };
  }
  return best ? best.multiplier : 1;
}

module.exports = {
  MAX_LOYALTY_LEVELS,
  MAX_MULTIPLIER,
  MAX_LEVEL_NAME_LEN,
  MAX_MIN_VISITS,
  DEFAULT_LOYALTY_LEVELS,
  sanitizeMultiplier,
  sanitizeLoyaltyLevels,
  resolvePointsMultiplier
};
