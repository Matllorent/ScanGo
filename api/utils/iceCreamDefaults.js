'use strict';

/**
 * api/utils/iceCreamDefaults.js
 * ─────────────────────────────
 * Tamaños y toppings ORIGINALES del armador de helado, en CommonJS para que el
 * servidor pueda cotizar el helado a medida de forma autoritativa (el frontend
 * los tiene en public/js/components/IceCreamPresets.js, ESM para navegador).
 *
 * Backend (CJS) y frontend (ESM) no comparten módulo en runtime: la guarda es
 * el test §28 (deepStrictEqual en tests/test-menu-componentization.js). Si
 * cambia un precio o un tamaño de un lado, hay que cambiarlo del otro.
 */

const DEFAULT_CONTAINERS = Object.freeze([
  { id: 'container_barquillo', name: 'Barquillo Simple', capacityLabel: '1 sabor', maxFlavors: 1, price: 150, icon: '🧇', badge: 'Al paso' },
  { id: 'container_cucurucho', name: 'Cucurucho Artesanal Especial', capacityLabel: 'Hasta 2 sabores', maxFlavors: 2, price: 220, icon: '🍦', badge: 'Crocante' },
  { id: 'container_quarterkg', name: 'Pote 1/4 Kilogramo', capacityLabel: 'Hasta 2 sabores', maxFlavors: 2, price: 310, icon: '🥣', badge: 'Individual' },
  { id: 'container_pinta', name: 'Pinta Térmica (500 ml)', capacityLabel: 'Hasta 3 sabores', maxFlavors: 3, price: 480, icon: '🥤', badge: 'Gourmet' },
  { id: 'container_halfkg', name: 'Pote 1/2 Kilogramo', capacityLabel: 'Hasta 3 sabores', maxFlavors: 3, price: 520, icon: '🍨', badge: 'Para compartir' },
  { id: 'container_1kg', name: 'Pote 1 Kilogramo', capacityLabel: 'Hasta 4 sabores', maxFlavors: 4, price: 890, icon: '🍧', badge: 'Familiar' }
]);

const DEFAULT_TOPPINGS = Object.freeze([
  { id: 'top_almendras', name: 'Almendras caramelizadas', price: 60, icon: '🌰' },
  { id: 'top_mani', name: 'Crocante de maní tostado', price: 30, icon: '🥜' },
  { id: 'top_chips', name: 'Chips de chocolate semiamargo', price: 40, icon: '🍫' },
  { id: 'top_oreo', name: 'Galletitas Oreo trituradas', price: 50, icon: '🍪' },
  { id: 'top_rocklets', name: 'Confites de chocolate tipo Rocklets', price: 40, icon: '🍬' },
  { id: 'top_bano_choco', name: 'Baño de repostería crocante', price: 60, icon: '✨' },
  { id: 'salsa_choco', name: 'Salsa tibia de chocolate', price: 50, icon: '🍯' },
  { id: 'salsa_frutos', name: 'Salsa de frutos rojos silvestres', price: 50, icon: '🍓' },
  { id: 'salsa_ddl', name: 'Salsa tibia de dulce de leche', price: 50, icon: '🍮' }
]);

/**
 * Listas efectivas del local: las del dueño si definió, si no los defaults.
 * @param {object} restaurant
 * @returns {{ containers: Array, toppings: Array }}
 */
function effectiveIceCreamLists(restaurant) {
  const containers = Array.isArray(restaurant && restaurant.iceCreamContainers) && restaurant.iceCreamContainers.length
    ? restaurant.iceCreamContainers
    : DEFAULT_CONTAINERS;
  const toppings = Array.isArray(restaurant && restaurant.iceCreamToppings) && restaurant.iceCreamToppings.length
    ? restaurant.iceCreamToppings
    : DEFAULT_TOPPINGS;
  return { containers, toppings };
}

module.exports = { DEFAULT_CONTAINERS, DEFAULT_TOPPINGS, effectiveIceCreamLists };
