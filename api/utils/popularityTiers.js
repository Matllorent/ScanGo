/**
 * api/utils/popularityTiers.js
 * ────────────────────────────
 * Tiers de popularidad del menú (`menuSizing: 'popularity'`): deciden el
 * TAMAÑO visual de cada carta, nunca conteos crudos (privacidad: el payload
 * público solo emite `popTier` 2/1/0, nunca la score ni las muestras).
 *
 * Jerarquía (pura, sin I/O):
 *   1. Scores con ≥ MIN_SAMPLES muestras en la ventana (90 días) → ranking
 *      por cuantiles: top 20% → 2 (con tope de 4 platos para que "top" no
 *      signifique "todo grande"); siguiente 30% → 1; resto → 0. Un plato sin
 *      score queda en 1 (neutral: lo nuevo no se castiga).
 *   2. Sin scores suficientes → proxy curado del dueño: `is_chef_recommended`
 *      (o tag 'chef_special') → 2; el resto → 1.
 *   3. Ni scores ni chef → todos 1 (uniforme: el estado histórico).
 *
 * Puro: cero requires (guard de arquitectura B de api/utils).
 */

/** Muestras mínimas en la ventana antes de confiar en el ranking real. */
const DISH_POPULARITY_MIN_SAMPLES = 30;
/** Fracción de platos en el tier grande (2) y en el tier medio (1). */
const TIER_TOP_FRACTION = 0.2;
const TIER_MID_FRACTION = 0.3;
/** Máximo de platos "grandes" a la vez: destacar 2 de 30 es señal; 20, ruido. */
const TIER_TOP_MAX = 4;

function isChefPicked(dish) {
  return Boolean(
    dish &&
    (dish.isChefSpecial === true ||
      dish.is_chef_recommended === true ||
      (Array.isArray(dish.tags) && dish.tags.includes('chef_special')))
  );
}

/**
 * @param {Array<object>} dishes platos de la carta (solo lectura)
 * @param {{scores?: Object<string, number>, samples?: number}|null} dishPopularity
 *        proyección guardada en `restaurant.analytics.dishPopularity`
 * @returns {Map<string, 2|1|0>} tier por dishId (los ausentes no se consultan)
 */
function computePopTiers(dishes, dishPopularity) {
  const tiers = new Map();
  const list = Array.isArray(dishes) ? dishes.filter((d) => d && d.id) : [];

  const scores = dishPopularity && dishPopularity.scores ? dishPopularity.scores : null;
  const samples = dishPopularity && Number.isFinite(Number(dishPopularity.samples))
    ? Number(dishPopularity.samples)
    : 0;

  // 1. Ranking real (solo con evidencia suficiente)
  if (scores && samples >= DISH_POPULARITY_MIN_SAMPLES) {
    const scored = list
      .map((d, index) => ({ id: d.id, index, score: Number(scores[d.id]) }))
      .filter((e) => Number.isFinite(e.score));
    scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));

    const topCut = Math.min(Math.max(1, Math.ceil(scored.length * TIER_TOP_FRACTION)), TIER_TOP_MAX);
    const midCut = topCut + Math.max(0, Math.ceil(scored.length * TIER_MID_FRACTION));
    scored.forEach((e, rank) => {
      tiers.set(e.id, rank < topCut ? 2 : rank < midCut ? 1 : 0);
    });
    // Platos sin score (recién agregados): neutral, nunca chico por accidente.
    for (const d of list) {
      if (!tiers.has(d.id)) tiers.set(d.id, 1);
    }
    return tiers;
  }

  // 2. Proxy curado del dueño (sin evidencia estadística aún)
  const anyChef = list.some(isChefPicked);
  for (const d of list) {
    tiers.set(d.id, anyChef ? (isChefPicked(d) ? 2 : 1) : 1);
  }
  return tiers;
}

module.exports = {
  computePopTiers,
  isChefPicked,
  DISH_POPULARITY_MIN_SAMPLES,
  TIER_TOP_FRACTION,
  TIER_MID_FRACTION,
  TIER_TOP_MAX
};
