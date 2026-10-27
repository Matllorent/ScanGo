/**
 * public/js/utils/loyaltyLevels.js — espejo ESM de api/utils/loyaltyLevels.js
 * (R3 "Multiplicador por nivel de lealtad").
 *
 * Módulo puro (cero I/O, cero DOM): la escalera de niveles locales del dueño
 * (`restaurant.loyaltyConfig.levels`). Paridad byte a byte con el CJS canónico
 * — testeada en tests/test-quick-wins.js (§5) sobre corpus determinista.
 * Si cambiás uno, cambiá el otro.
 */

export const MAX_LOYALTY_LEVELS = 5;
export const MAX_MULTIPLIER = 10;
export const MAX_LEVEL_NAME_LEN = 24;
export const MAX_MIN_VISITS = 9999;
export const DEFAULT_LOYALTY_LEVELS = [
  { name: 'Bronce', minVisits: 0, multiplier: 1 },
  { name: 'Plata', minVisits: 5, multiplier: 1.5 },
  { name: 'Oro', minVisits: 12, multiplier: 2 }
];

export function sanitizeMultiplier(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const clamped = Math.max(1, Math.min(MAX_MULTIPLIER, n));
  return Math.round(clamped * 2) / 2;
}

export function sanitizeLoyaltyLevels(raw) {
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

export function resolvePointsMultiplier(levels, visits) {
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
