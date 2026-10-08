/**
 * public/js/menu/tipCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Propina opcional del comensal en el checkout.
 *
 * Es una decisión 100% del comensal (nunca obligatoria): parte de "Sin
 * propina" y ofrece 5% / 10% / 15% o un monto fijo. La base de cálculo es el
 * subtotal de platos (sin envío), que es lo justo para el personal.
 *
 * Módulo puro (sin DOM, sin fetch) → testeable con `node`/assert.
 */

/** Porcentajes sugeridos (0 = sin propina). */
export const TIP_PERCENT_PRESETS = [0, 5, 10, 15];

/**
 * Calcula el monto de propina.
 * Prioridad: monto fijo (`customAmount`) > porcentaje (`tipPercent`).
 * Nunca devuelve negativos; redondea a 2 decimales.
 * @param {number} subtotal Base de cálculo (subtotal de platos)
 * @param {number} tipPercent Porcentaje sugerido (0-100)
 * @param {number|string|null} customAmount Monto fijo opcional
 * @returns {number} Monto de propina listo para sumar
 */
export function computeTipAmount(subtotal, tipPercent = 0, customAmount = null) {
  const hasCustom = customAmount !== null && customAmount !== undefined && customAmount !== '';
  if (hasCustom) {
    const custom = Number(customAmount);
    if (Number.isFinite(custom) && custom > 0) return Math.round(custom * 100) / 100;
    return 0;
  }
  const base = Number(subtotal) || 0;
  const pct = Number(tipPercent) || 0;
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(pct) || pct <= 0) return 0;
  return Math.round(base * (pct / 100) * 100) / 100;
}
