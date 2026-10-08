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
 * baldes del wizard y, si es una heladería sin pistas, usamos toda la carta.
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

  const detected = dishes.filter(d => {
    const cat = categories.find(c => c.id === d.categoryId);
    const catName = (cat ? cat.name : '').toLowerCase();
    const dishName = String(d.name || '').toLowerCase();
    return FLAVOR_CATEGORY_HINTS.some(h => catName.includes(h)) ||
      dishName.includes('helad') || dishName.includes('sabor');
  });

  if (detected.length > 0) return detected;
  return isHeladeria ? dishes : [];
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
