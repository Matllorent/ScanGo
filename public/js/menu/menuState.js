/**
 * public/js/menu/menuState.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Centralized state management for the menu application.
 * Uses a simple observable pattern for reactivity.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Private state
let _state = {
  restaurantData: null,
  selectedCategory: 'ALL',
  selectedDietFilter: 'ALL',
  cart: {},
  pendingDishNoteAction: null,
  deliveryFee: 0,
  appliedCoupon: null,
  discountAmount: 0,
  searchTerm: '',
  isLoading: false,
  error: null
};

// Subscribers for reactivity
const _subscribers = new Set();

/**
 * Get current state (read-only)
 * @returns {Object} Current state snapshot
 */
export function getState() {
  return { ..._state };
}

/**
 * Get specific state property
 * @param {string} key - State key
 * @returns {*} State value
 */
export function get(key) {
  return _state[key];
}

/**
 * Update state and notify subscribers
 * @param {Object} updates - Partial state updates
 */
export function set(updates) {
  _state = { ..._state, ...updates };
  notify();
}

/**
 * Set single property
 * @param {string} key - State key
 * @param {*} value - New value
 */
export function setOne(key, value) {
  if (_state[key] !== value) {
    _state[key] = value;
    notify();
  }
}

/**
 * Subscribe to state changes
 * @param {Function} callback - Called with new state on changes
 * @returns {Function} Unsubscribe function
 */
export function subscribe(callback) {
  _subscribers.add(callback);
  return () => _subscribers.delete(callback);
}

/**
 * Notify all subscribers
 */
function notify() {
  const state = getState();
  _subscribers.forEach(cb => cb(state));
}

/**
 * Reset state to initial values
 */
export function reset() {
  _state = {
    restaurantData: null,
    selectedCategory: 'ALL',
    selectedDietFilter: 'ALL',
    cart: {},
    pendingDishNoteAction: null,
    deliveryFee: 0,
    appliedCoupon: null,
    discountAmount: 0,
    searchTerm: '',
    isLoading: false,
    error: null
  };
  notify();
}

/**
 * Cart-specific helpers
 */
export const cartHelpers = {
  /**
   * Get total item count in cart
   * @returns {number}
   */
  getTotalCount() {
    return Object.values(_state.cart).reduce((sum, item) => sum + (item.qty || 0), 0);
  },

  /**
   * Get cart subtotal
   * @param {Object} restaurantData - Restaurant data for price calculation
   * @returns {number}
   */
  getSubtotal(restaurantData) {
    return Object.values(_state.cart).reduce((sum, item) => {
      const unitPrice = getCartUnitPrice(item, restaurantData);
      return sum + unitPrice * (item.qty || 1);
    }, 0);
  },

  /**
   * Get item quantity in cart
   * @param {string} dishId
   * @returns {number}
   */
  getDishQuantity(dishId) {
    return Object.values(_state.cart)
      .filter(item => item.dish.id === dishId)
      .reduce((sum, item) => sum + (item.qty || 1), 0);
  },

  /**
   * Check if dish is in cart
   * @param {string} dishId
   * @returns {boolean}
   */
  hasDish(dishId) {
    return Object.values(_state.cart).some(item => item.dish.id === dishId);
  }
};

/**
 * Calculate unit price for cart item
 * @param {Object} item - Cart item
 * @param {Object} restaurantData - Restaurant data
 * @returns {number}
 */
function getCartUnitPrice(item, restaurantData) {
  const groups = getDishModifierGroups(item.dish, restaurantData);
  const presentationGroup = groups.find(group => group.kind === 'presentation');
  const presentationChoice = presentationGroup && item.choices?.find(choice => choice.groupId === presentationGroup.id)?.selections[0];
  const presentation = presentationGroup?.options.find(option => option.id === presentationChoice?.optionId);
  let priceInCents = presentation?.priceCents !== undefined
    ? presentation.priceCents
    : Math.round((Number(item.dish.price) || 0) * 100);

  for (const choice of item.choices || []) {
    const group = groups.find(itemGroup => itemGroup.id === choice.groupId);
    if (!group || group.kind === 'presentation') continue;
    for (const selection of choice.selections || []) {
      const option = group.options.find(itemOption => itemOption.id === selection.optionId);
      if (!option) continue;
      const multiplier = group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split' ? selection.quantity : 1;
      priceInCents += (Number(option.priceDeltaCents) || 0) * multiplier;
    }
  }
  return priceInCents / 100;
}

/**
 * Get dish modifier groups (mirrors logic from cartOperations.js)
 * @param {Object} dish
 * @param {Object} restaurantData
 * @returns {Array}
 */
function getDishModifierGroups(dish = {}, restaurantData = {}) {
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