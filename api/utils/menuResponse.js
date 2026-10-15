/**
 * api/utils/menuResponse.js
 * ─────────────────────────
 * Helpers puros del menú público (sucursales: overrides de precio + platos
 * custom). Los usan api/routes/menu.js (/api/menu/:slug) y el SSR /m/:slug.
 * Extraído de api/index.js sin cambios.
 */
/**
 * Coerce a per-branch override price value to a finite number.
 * overridePrices es Record<dishId, number>; datos legacy o payloads externos
 * pueden traer { price: n } — normalizar aquí evita filtrar objetos al frontend.
 * @returns {number|null} precio numérico o null si no hay override usable.
 */
function resolveBranchOverridePrice(overrides, dishId, fallbackPrice) {
  if (!overrides || typeof overrides !== 'object' || typeof dishId !== 'string') return fallbackPrice;
  const raw = overrides[dishId];
  if (raw === undefined || raw === null) return fallbackPrice;
  let num = raw;
  if (typeof raw === 'object' && !Array.isArray(raw)) {
    num = raw.price ?? raw.value ?? raw.precio;
  }
  const parsed = Number(num);
  return Number.isFinite(parsed) ? parsed : fallbackPrice;
}

/**
 * Normalize branch custom dishes so the SPA public menu can render them.
 * Los customDishes de una sucursal vienen con `category` (nombre) pero sin
 * `categoryId`; el menú público agrupa por `d.categoryId === cat.id`, así que
 * sin normalización quedan invisibles. Garantiza que cada custom dish tenga un
 * categoryId válido y que ese category exista en el array de categorías de la
 * respuesta (agregando una categoría sintética si hace falta).
 * @returns {{categories: Array, dishes: Array}} categorías con las extras + dishes normalizados
 */
function normalizeBranchCustomDishes(baseCategories, baseDishes, customDishes) {
  let categories = Array.isArray(baseCategories) ? baseCategories.map(c => ({ ...c })) : [];
  if (!Array.isArray(customDishes) || customDishes.length === 0) {
    return { categories, dishes: baseDishes };
  }
  const categoriesById = new Map(categories.map(c => [c.id, c]));
  let dishes = Array.isArray(baseDishes) ? baseDishes.map(d => ({ ...d })) : [];
  for (const cd of customDishes) {
    if (!cd || typeof cd !== 'object') continue;
    const dish = { ...cd, isBranchCustom: true };
    const catName = String(dish.category || '').trim() || 'Especiales de la sucursal';
    const sluggedCat = catName.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
    const desiredId = dish.categoryId
      ? String(dish.categoryId)
      : `branch_cat_${sluggedCat || 'especiales'}`;
    const cat = categoriesById.get(desiredId);
    if (cat) {
      dish.categoryId = cat.id;
    } else {
      const newCat = { id: desiredId, name: catName };
      categories.push(newCat);
      categoriesById.set(newCat.id, newCat);
      if (dish.categoryId === undefined) dish.categoryId = newCat.id;
    }
    dishes.push({ ...dish, categoryId: dish.categoryId || desiredId });
  }
  return { categories, dishes };
}

module.exports = { resolveBranchOverridePrice, normalizeBranchCustomDishes };
