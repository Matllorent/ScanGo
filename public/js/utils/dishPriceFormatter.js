/**
 * Dish Price Formatting Module
 * Helper functions for formatting dish prices consistently.
 */
module.exports = {
  // Formatea un precio con la moneda especificada
  formatPrice: function(price, currency) {
    const curr = currency || '$';
    return `${curr} ${Number(price).toFixed(2)}`;
  },

  // Formatea un precio desde un rango (ej: "Desde $15")
  formatFromPrice: function(minPrice, currency) {
    const curr = currency || '$';
    return `Desde ${curr} ${Number(minPrice).toFixed(2)}`;
  },

  // Formatea el precio mostrando el precio original tachado y el precio con descuento
  formatPriceWithStrike: function(originalPrice, effectivePrice, currency) {
    const curr = currency || '$';
    const orig = Number(originalPrice).toFixed(2);
    const eff = Number(effectivePrice).toFixed(2);
    
    if (Number(originalPrice) > Number(effectivePrice)) {
      return `<span style="text-decoration:line-through; opacity:0.6; font-size:0.85em; margin-right:6px; color:var(--chalk-dim); font-weight:normal;">${curr} ${orig}</span>${curr} ${eff}`;
    }
    return `${curr} ${eff}`;
  },

  // Determina si un plato tiene precio de Happy Hour activo
  hasHappyHour: function(sched) {
    return sched && sched.isHappyHour === true;
  },

  // Obtiene el label de Happy Hour
  getHappyHourLabel: function(sched) {
    return sched && sched.isHappyHour ? '🕐 Happy Hour' : null;
  }
};