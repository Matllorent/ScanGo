/**
 * public/js/studio/cloneUtils.js
 * ──────────────────────────────
 * Clonado con ids nuevos para duplicar platos y categorías (puro, sin DOM en
 * import, testeable en Node). Un solo lugar para la forma del clon: nombre +
 * " (copia)" recortado, clon visible (no agotado) e id `d_|cat_` único.
 * Lo usan `dishEditor.js:duplicateDish` y `categoryManager.js:duplicateCategory`.
 */

/**
 * Id único local con prefijo (`d_`, `cat_`, `gst_`…).
 */
export function stampId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Clona un plato con id nuevo, nombre marcado y visible.
 * @param {object} dish Plato original (no se muta)
 * @param {string} suffix Sufijo del nombre (default " (copia)")
 * @returns {object} clon independiente (deep copy)
 */
export function cloneDishWithNewId(dish, suffix = ' (copia)') {
  const clone = JSON.parse(JSON.stringify(dish || {}));
  clone.id = stampId('d');
  clone.name = `${clone.name || 'Plato'}${suffix}`.slice(0, 100);
  clone.outOfStock = false;
  return clone;
}

/**
 * Clona una categoría con id nuevo y nombre marcado.
 * @param {object} category Categoría original (no se muta)
 * @param {string} suffix Sufijo del nombre (default " (copia)")
 * @returns {object} clon independiente (deep copy)
 */
export function cloneCategoryWithNewId(category, suffix = ' (copia)') {
  const clone = JSON.parse(JSON.stringify(category || {}));
  clone.id = stampId('cat');
  clone.name = `${clone.name || 'Categoría'}${suffix}`.slice(0, 60);
  return clone;
}
