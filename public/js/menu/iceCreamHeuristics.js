/**
 * public/js/menu/iceCreamHeuristics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Detección de los sabores REALES de una heladería a partir de su carta.
 *
 * Problema que resuelve: antes el wizard sólo reconocía sabores si la categoría
 * o el plato decían literalmente "helad"/"sabor". Una heladería con categorías
 * típicas ("Cremas", "Chocolates", "Dulces de Leche", "Frutales", "Especiales")
 * no matcheaba y el wizard caía al catálogo DEMO de sabores inventados, incluso
 * para un local real. Acá ampliamos las pistas, mapeamos las categorías a los
 * baldes del wizard y, si es una heladería sin pistas, usamos toda la carta
 * (excepto las bebidas heladas, que no son sabores).
 *
 * Módulo puro (sin DOM, sin fetch) → testeable con `node`/assert.
 */

export const FLAVOR_CATEGORY_HINTS = [
  'helad', 'sabor', 'chocolat', 'cacao', 'dulce de leche',
  'crema', 'frut', 'sorbete', 'especial', 'gusto'
];

/** Baldes de categoría que muestran los chips del paso 2 del wizard. */
export const FLAVOR_BUCKETS = ['Chocolates', 'Dulces de Leche', 'Cremas', 'Frutales', 'Especiales'];

/**
 * Pistas que DESCARTAN un plato como sabor, aunque su nombre/categoría diga "helad".
 * El caso real: "Bebidas Heladas" (milkshakes, licuados) no son sabores de helado.
 * Sólo se aplican a la categoría (nunca a "café", que sí puede ser un sabor).
 */
export const FLAVOR_EXCLUDE_CATEGORY_HINTS = ['bebida', 'milkshake', 'licuado', 'batido', 'smoothie', 'trago', 'jugo'];

/** Pistas que descartan por nombre de plato (una bebida puntual en cualquier categoría). */
export const FLAVOR_EXCLUDE_DISH_HINTS = ['milkshake', 'licuado', 'batido', 'smoothie'];

/**
 * Mapea el nombre de categoría real del local a uno de los baldes del wizard.
 * Sin bucket conocido queda "Carta de la Casa" (sólo aparece en "Todos").
 * @param {string} rawCatName Nombre de la categoría del restaurante
 * @returns {string}
 */
export function resolveFlavorCategoryName(rawCatName) {
  const n = String(rawCatName || '').toLowerCase();
  if (!n) return 'Carta de la Casa';
  if (n.includes('chocolat') || n.includes('cacao')) return 'Chocolates';
  if (n.includes('dulce de leche') || n.includes('ddl')) return 'Dulces de Leche';
  if (n.includes('crema') || n.includes('vainilla') || n.includes('mascarpone')) return 'Cremas';
  if (n.includes('frut') || n.includes('sorbete') || n.includes('limon') || n.includes('limón')) return 'Frutales';
  if (n.includes('especial') || n.includes('premium') || n.includes('autor')) return 'Especiales';
  return 'Carta de la Casa';
}

/**
 * Devuelve los platos que funcionan como sabores.
 * - Si hay pistas (categoría/plato), devuelve sólo esos.
 * - Si es una heladería sin pistas, devuelve toda la carta (nunca demo).
 * - Si no es heladería y no hay pistas, devuelve [] (no inventa sabores).
 * @param {object} restaurantData Payload público del restaurante
 * @returns {Array<object>} Platos-sabor
 */
export function detectFlavorDishes(restaurantData = {}) {
  const rd = restaurantData || {};
  const dishes = Array.isArray(rd.dishes) ? rd.dishes : [];
  if (!dishes.length) return [];

  const categories = Array.isArray(rd.categories) ? rd.categories : [];
  const isHeladeria = rd.allowIceCreamWizard === true || rd.businessType === 'heladeria';

  const categoryNameOf = (dish) => {
    const cat = categories.find(c => c.id === dish.categoryId);
    return String(cat ? cat.name : '').toLowerCase();
  };
  const isExcluded = (dish) => {
    const catName = categoryNameOf(dish);
    const dishName = String(dish.name || '').toLowerCase();
    return FLAVOR_EXCLUDE_CATEGORY_HINTS.some(h => catName.includes(h))
      || FLAVOR_EXCLUDE_DISH_HINTS.some(h => dishName.includes(h));
  };

  const detected = dishes.filter(d => {
    if (isExcluded(d)) return false;
    const catName = categoryNameOf(d);
    const dishName = String(d.name || '').toLowerCase();
    return FLAVOR_CATEGORY_HINTS.some(h => catName.includes(h)) ||
      dishName.includes('helad') || dishName.includes('sabor');
  });

  if (detected.length > 0) return detected;
  // Heladería sin pistas: usa toda la carta, pero nunca las bebidas.
  return isHeladeria ? dishes.filter(d => !isExcluded(d)) : [];
}

/**
 * Construye el array `customFlavors` que consume IceCreamWizard.
 * @param {object} restaurantData Payload público del restaurante
 * @returns {Array<object>} Sabores listos para el wizard
 */
export function buildCustomFlavors(restaurantData = {}) {
  const rd = restaurantData || {};
  const categories = Array.isArray(rd.categories) ? rd.categories : [];
  return detectFlavorDishes(rd).map(d => {
    const cat = categories.find(c => c.id === d.categoryId);
    return {
      id: d.id,
      categoryId: d.categoryId,
      categoryName: resolveFlavorCategoryName(cat ? cat.name : ''),
      name: d.name,
      price: d.price,
      description: d.description || '',
      tags: d.tags || [],
      outOfStock: Boolean(d.outOfStock)
    };
  });
}
