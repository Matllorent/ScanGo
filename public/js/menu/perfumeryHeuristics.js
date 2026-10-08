/**
 * public/js/menu/perfumeryHeuristics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Catálogo de perfumería data-driven a partir de la carta REAL del local.
 *
 * Problema que resuelve: la vista "Colección Perfumería" mostraba un catálogo
 * DEMO hardcodeado (6 fragancias con precios y pirámides inventadas). Al agregar
 * al carrito, generaba un `dishId` sintético (`perfume_...`) que NO existe en la
 * carta del local → el pedido fallaba al cotizar (DISH_NOT_FOUND) y el precio
 * mostrado no era el del dueño.
 *
 * Ahora, para una perfumería, el catálogo se arma con sus platos reales: el
 * `id` del carrito es el id REAL (la cotización cierra) y el precio es el del
 * dueño. Si no hay carta cargada, devuelve [] (estado vacío honesto, sin demo).
 *
 * Módulo puro (sin DOM, sin fetch) → testeable con `node`/assert.
 */

/**
 * Mapea el nombre de categoría a una familia olfativa de los chips del wizard.
 * @param {string} rawCatName Nombre de la categoría del restaurante
 * @returns {string} Familia olfativa (o 'Autor' si no matchea ninguna)
 */
export function resolvePerfumeFamily(rawCatName) {
  const n = String(rawCatName || '').toLowerCase();
  if (!n) return 'Autor';
  if (n.includes('cítric') || n.includes('citric') || n.includes('fresco') || n.includes('fresh')) return 'Cítrico';
  if (n.includes('floral') || n.includes('flor')) return 'Floral';
  if (n.includes('amader') || n.includes('madera') || n.includes('wood')) return 'Amaderado';
  if (n.includes('oriental') || n.includes('ámbar') || n.includes('ambar') || n.includes('nicho')) return 'Oriental';
  if (n.includes('gourmand') || n.includes('dulce') || n.includes('bruma')) return 'Gourmand';
  if (n.includes('aromátic') || n.includes('aromatic') || n.includes('barbershop') || n.includes('fougère') || n.includes('fougere')) return 'Aromático';
  return 'Autor';
}

/**
 * Detecta la concentración a partir del nombre del producto.
 * @param {string} name Nombre del plato/fragancia
 * @returns {string} 'EDP' | 'EDT' | 'EDC' | 'Body Splash' | ''
 */
export function resolvePerfumeConcentration(name) {
  const n = String(name || '').toLowerCase();
  if (n.includes('body splash') || n.includes('bruma')) return 'Body Splash';
  if (n.includes('eau de parfum') || /\bedp\b/.test(n) || /\bparfum\b/.test(n)) return 'EDP';
  if (n.includes('eau de toilette') || /\bedt\b/.test(n)) return 'EDT';
  if (n.includes('eau de cologne') || /\bedc\b/.test(n)) return 'EDC';
  return '';
}

/**
 * Arma el catálogo de perfumería desde la carta real del local.
 * @param {object} restaurantData Payload público del restaurante
 * @returns {Array<object>} Catálogo listo para PerfumeryView
 */
export function buildPerfumeryCatalog(restaurantData = {}) {
  const rd = restaurantData || {};
  const dishes = Array.isArray(rd.dishes) ? rd.dishes : [];
  const categories = Array.isArray(rd.categories) ? rd.categories : [];

  return dishes
    .filter(d => d && d.id && d.name && d.price != null)
    .map(d => {
      const cat = categories.find(c => c.id === d.categoryId);
      const price = Number(d.price) || 0;
      return {
        id: d.id,                 // id REAL de la carta → el pedido cotiza bien
        cartDishId: d.id,
        categoryId: d.categoryId,
        name: d.name,
        brand: d.brand || 'Carta de la Casa',
        concentration: resolvePerfumeConcentration(d.name),
        family: resolvePerfumeFamily(cat ? cat.name : ''),
        description: d.description || '',
        prices: { 'Único': price },
        defaultVolume: 'Único',
        tags: d.tags || [],
        photoUrl: d.photoUrl || d.imageUrl || '',
        pyramid: null,
        outOfStock: Boolean(d.outOfStock)
      };
    });
}
