/**
 * public/js/menu/menuViewModel.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure business logic for menu: filtering, sorting, dietary matching, scheduling.
 * No DOM dependencies - pure functions for testability.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const DIET_FILTER_MAP = {
  veggie: ['veggie', 'vegetariano'],
  vegan: ['vegan', 'vegano'],
  celiac: ['celiac', 'singluten'],
  sinlactosa: ['sinlactosa'],
  picante: ['picante']
};

const DEFAULT_UPSELL_KEYWORDS = {
  triggers: ['hamburguesa', 'burger', 'milanesa', 'plato', 'principal', 'carne', 'pollo', 'pizza', 'sandwich', 'wrap', 'taco', 'burrito', 'empanada', 'combo', 'chivito', 'lomo'],
  complements: ['papas', 'bebida', 'gaseosa', 'jugo', 'agua', 'postre', 'helado', 'ensalada', 'guarnición', 'acompañamiento', 'salsa', 'extra', 'cerveza', 'vino', 'aros', 'nugget']
};

/**
 * Check if dish matches dietary filter
 * @param {Object} dish
 * @param {string} dietFilter
 * @returns {boolean}
 */
export function matchesDiet(dish, dietFilter) {
  if (dietFilter === 'ALL') return true;
  if (!dish.tags) return false;
  const tags = DIET_FILTER_MAP[dietFilter];
  if (!tags) return true;
  return dish.tags.some(t => tags.includes(t));
}

/**
 * Check if dish matches search term
 * @param {Object} dish
 * @param {string} searchTerm
 * @returns {boolean}
 */
export function matchesSearch(dish, searchTerm) {
  if (!searchTerm) return true;
  const term = searchTerm.toLowerCase().trim();
  return dish.name.toLowerCase().includes(term) ||
    (dish.description && dish.description.toLowerCase().includes(term));
}

/**
 * Get dish schedule status
 * @param {Object} dish
 * @param {Object} restaurantData
 * @returns {Object} { shouldDisplay, isAvailable, effectivePrice, isHappyHour, reason, originalPrice }
 */
export function getDishScheduleStatus(dish, restaurantData = {}) {
  if (!restaurantData.scheduleEnabled || !dish.schedule) {
    return { shouldDisplay: true, isAvailable: true, effectivePrice: dish.price };
  }

  const now = new Date();
  const currentHour = now.getHours() + (now.getMinutes() / 60);
  const currentDay = now.getDay(); // 0 = Sunday

  const schedule = dish.schedule;
  const days = Array.isArray(schedule.days) ? schedule.days : [0, 1, 2, 3, 4, 5, 6];
  const timeStart = schedule.timeStart ? parseTime(schedule.timeStart) : 0;
  const timeEnd = schedule.timeEnd ? parseTime(schedule.timeEnd) : 24;
  const behavior = schedule.behavior || 'hide';

  const dayMatch = days.includes(currentDay);
  const timeMatch = currentHour >= timeStart && currentHour <= timeEnd;
  const isAvailable = dayMatch && timeMatch;

  let shouldDisplay = true;
  if (!isAvailable) {
    shouldDisplay = behavior === 'badge';
  }

  const effectivePrice = schedule.overridePrice !== undefined && schedule.overridePrice !== null
    ? schedule.overridePrice
    : dish.price;

  let reason = '';
  if (!dayMatch) {
    reason = 'Fuera de días programados';
  } else if (!timeMatch) {
    reason = `Disponible de ${schedule.timeStart} a ${schedule.timeEnd}`;
  }

  const isHappyHour = isAvailable && schedule.overridePrice !== undefined &&
    schedule.overridePrice !== null && Number(schedule.overridePrice) < Number(dish.price);

  const originalPrice = isHappyHour
    ? (schedule.originalPriceRef !== undefined && schedule.originalPriceRef !== null
      ? schedule.originalPriceRef
      : (dish.originalPrice !== undefined && dish.originalPrice !== null ? dish.originalPrice : dish.previous_price || dish.previousPrice))
    : null;

  return {
    shouldDisplay,
    isAvailable,
    effectivePrice,
    isHappyHour,
    reason,
    originalPrice
  };
}

/**
 * Parse time string (HH:MM) to decimal hours
 * @param {string} timeStr
 * @returns {number}
 */
function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h + (m || 0) / 60;
}

/**
 * Sort dishes by weather relevance, chef special, schedule, then name
 * @param {Array} dishes
 * @param {Object} restaurantData
 * @returns {Array}
 */
export function sortWeatherDishes(dishes, restaurantData = {}) {
  const weatherContext = getActiveWeatherContext(restaurantData);
  return [...dishes].sort((left, right) => {
    const leftMatch = weatherContext && (left.weatherTags || []).includes(weatherContext) ? 1 : 0;
    const rightMatch = weatherContext && (right.weatherTags || []).includes(weatherContext) ? 1 : 0;
    if (leftMatch !== rightMatch) return rightMatch - leftMatch;

    const leftChef = (left.isChefSpecial || (left.tags && left.tags.includes('chef_special'))) ? 1 : 0;
    const rightChef = (right.isChefSpecial || (right.tags && right.tags.includes('chef_special'))) ? 1 : 0;
    if (leftChef !== rightChef) return rightChef - leftChef;

    return (left.name || '').localeCompare(right.name || '');
  });
}

/**
 * Get active weather context from restaurant data
 * @param {Object} restaurantData
 * @returns {string|null}
 */
export function getActiveWeatherContext(restaurantData = {}) {
  if (!restaurantData.smartWeatherEnabled) return null;
  return restaurantData.weatherContext || null;
}

/**
 * Sort categories by weather relevance
 * @param {Array} categories
 * @param {Array} dishes
 * @param {Object} restaurantData
 * @returns {Array}
 */
export function sortWeatherCategories(categories, dishes, restaurantData = {}) {
  const context = getActiveWeatherContext(restaurantData);
  const pattern = context === 'muy_caluroso'
    ? /helad|fr[ií]o|bebida|refresco|cerveza|jugo|limonada|agua/i
    : context === 'muy_frio'
      ? /sopa|guiso|caldo|chocolate|caf[eé]|t[eé]|caliente/i
      : null;

  return [...categories].map(category => {
    const categoryDishes = dishes.filter(dish => dish.categoryId === category.id);
    const tagged = categoryDishes.some(dish => (dish.weatherTags || []).includes(context));
    return {
      category,
      index: categories.indexOf(category),
      priority: tagged || (pattern && pattern.test(category.name || '')) ? 1 : 0
    };
  }).sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(entry => entry.category);
}

/**
 * Get available diet filters based on current dishes
 * @param {Array} dishes
 * @returns {Set<string>}
 */
export function getAvailableDietFilters(dishes) {
  const available = new Set(['ALL']);
  Object.entries(DIET_FILTER_MAP).forEach(([key, tags]) => {
    const hasMatch = dishes.some(d => !d.outOfStock && d.tags && d.tags.some(t => tags.includes(t)));
    if (hasMatch) available.add(key);
  });
  return available;
}

/**
 * Check if category has any visible dishes (considering filters, search, schedule)
 * @param {Object} category
 * @param {Array} dishes
 * @param {Object} options
 * @returns {boolean}
 */
export function categoryHasVisibleDishes(category, dishes, { searchTerm, dietFilter, restaurantData } = {}) {
  return dishes.some(dish => {
    if (dish.categoryId !== category.id) return false;
    if (dish.outOfStock) return false;
    if (searchTerm && !matchesSearch(dish, searchTerm)) return false;
    if (!matchesDiet(dish, dietFilter)) return false;
    const sched = getDishScheduleStatus(dish, restaurantData);
    return sched.shouldDisplay;
  });
}

/**
 * Filter dishes based on all criteria
 * @param {Array} dishes
 * @param {Object} options
 * @returns {Array}
 */
export function filterDishes(dishes, { searchTerm, dietFilter, selectedCategory, restaurantData } = {}) {
  const scheduleEnabled = restaurantData?.scheduleEnabled;
  return dishes.filter(dish => {
    if (dish.outOfStock) return false;
    if (searchTerm && !matchesSearch(dish, searchTerm)) return false;
    if (!matchesDiet(dish, dietFilter)) return false;
    if (selectedCategory !== 'ALL' && selectedCategory !== 'POPULAR' && dish.categoryId !== selectedCategory) return false;
    if (scheduleEnabled) {
      const sched = getDishScheduleStatus(dish, restaurantData);
      if (!sched.shouldDisplay) return false;
    }
    return true;
  });
}

/**
 * Get dishes for a specific category (with all filters applied)
 * @param {Array} dishes
 * @param {string} categoryId
 * @param {Object} options
 * @returns {Array}
 */
export function getDishesForCategory(dishes, categoryId, options) {
  return filterDishes(dishes, { ...options, selectedCategory: categoryId });
}

/**
 * Get popular/featured dishes
 * @param {Array} dishes
 * @param {Object} options
 * @returns {Array}
 */
export function getPopularDishes(dishes, options) {
  return filterDishes(dishes, { ...options, selectedCategory: 'POPULAR' })
    .filter(d => d.tags && d.tags.includes('star'))
    .sort((a, b) => (b.price || 0) - (a.price || 0));
}

/**
 * Get dish modifier groups (mirrors cartOperations logic)
 * @param {Object} dish
 * @param {Object} restaurantData
 * @returns {Array}
 */
export function getDishModifierGroups(dish = {}, restaurantData = {}) {
  const definitions = restaurantData.modifierGroups || [];
  const assigned = (dish.modifierGroupIds || [])
    .map(id => definitions.find(group => group.id === id))
    .filter(group => group && group.active !== false);
  const embedded = (dish.modifierGroups || []).filter(group => group.active !== false);
  if (assigned.length || embedded.length) return [...assigned, ...embedded];

  const legacyGroups = [];
  if ((dish.proteinOptions || []).length) {
    legacyGroups.push({
      id: `legacy_protein_${dish.id}`,
      name: 'Proteína',
      kind: 'protein',
      selectionMode: 'single',
      required: Boolean(dish.proteinSelectionRequired),
      minSelections: dish.proteinSelectionRequired ? 1 : 0,
      maxSelections: 1,
      options: dish.proteinOptions
    });
  }
  if ((dish.variants || []).length) {
    const split = dish.variantSelectionMode === 'quantity_split';
    const name = String(dish.name || '').toLowerCase();
    const inferredUnits = /media\s+docena|1\/2\s*docena|\b6\s*(?:unidades|un\.?|empanadas)\b/.test(name)
      ? 6
      : (/\bdocena\b|\b12\s*(?:unidades|un\.?|empanadas)\b/.test(name) ? 12 : (/\b3\s*(?:unidades|un\.?|empanadas)\b|\btr[ií]o\b/.test(name) ? 3 : 1));
    const configuredUnits = parseInt(dish.variantsPerItem, 10) || 0;
    legacyGroups.push({
      id: `legacy_variants_${dish.id}`,
      name: split ? 'Sabores' : 'Variante',
      kind: split ? 'flavor' : 'variant',
      selectionMode: split ? 'quantity_split' : 'single',
      required: Boolean(dish.variantsRequired),
      minSelections: dish.variantsRequired ? 1 : 0,
      maxSelections: split ? 100 : 1,
      unitsPerSelection: !configuredUnits || (configuredUnits === 1 && inferredUnits > 1) ? inferredUnits : configuredUnits,
      options: dish.variants
    });
  }
  return legacyGroups;
}