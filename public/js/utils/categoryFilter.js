/**
 * Category Filter Module
 * Helper functions for category and dietary filter management.
 */
module.exports = {
  // Obtiene los filtros dietéticos disponibles basados en los platos
  getAvailableDietFilters: function(dishes) {
    const DIET_FILTER_MAP = {
      veggie: ['veggie', 'vegetariano'],
      vegan: ['vegan', 'vegano'],
      celiac: ['celiac', 'singluten'],
      sinlactosa: ['sinlactosa'],
      picante: ['picante']
    };

    const available = new Set(['ALL']);
    if (!dishes || !dishes.length) return available;

    const noOutStock = dishes.filter(d => !d.outOfStock);
    Object.entries(DIET_FILTER_MAP).forEach(([key, tags]) => {
      const hasMatch = noOutStock.some(d => 
        d.tags && d.tags.some(t => tags.includes(t))
      );
      if (hasMatch) available.add(key);
    });
    return available;
  },

  // Verifica si un plato coincide con un filtro dietético
  matchesDiet: function(dish, selectedDietFilter) {
    if (selectedDietFilter === 'ALL') return true;
    if (!dish.tags) return false;
    
    const dietMap = {
      veggie: d => d.tags.includes('veggie') || d.tags.includes('vegetariano'),
      vegan: d => d.tags.includes('vegan') || d.tags.includes('vegano'),
      celiac: d => d.tags.includes('celiac') || d.tags.includes('singluten'),
      sinlactosa: d => d.tags.includes('sinlactosa'),
      picante: d => d.tags.includes('picante')
    };

    const check = dietMap[selectedDietFilter];
    return check ? check(dish) : true;
  },

  // Ordena categorías teniendo en cuenta el contexto climático
  sortWeatherCategories: function(categories, dishes, context) {
    if (!context) return categories;
    
    const pattern = context === 'muy_caluroso'
      ? /bebid|drink|helad|refresc|limonad|cervez|fr[ií]a|fr[ií]os/i
      : /sopa|caldo|guis|estofad|infusi|caliente|caf[eé]/i;

    return categories.map((category, index) => {
      const categoryDishes = dishes.filter(d => d.categoryId === category.id);
      const tagged = categoryDishes.some(d => (d.weatherTags || []).includes(context));
      return { category, index, priority: tagged || pattern.test(category.name || '') ? 1 : 0 };
    }).sort((left, right) => right.priority - left.priority || left.index - right.index)
      .map(entry => entry.category);
  }
};