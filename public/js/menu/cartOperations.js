/**
 * public/js/menu/cartOperations.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Cart Operations, Modifier Groups Resolver, Unit & Pricing Calculations
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Resolves all modifier groups assigned or embedded in a dish, including legacy variants.
 * @param {object} dish Dish object
 * @param {object} restaurantData Current restaurant metadata
 * @returns {Array} Array of normalized modifier group objects
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

/**
 * Calculates unit price in decimal for a cart item including modifier options.
 * @param {object} item Cart item with dish and choices
 * @param {object} restaurantData Restaurant metadata
 * @returns {number} Unit price in standard decimal currency
 */
export function getCartUnitPrice(item, restaurantData = {}) {
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
 * Produces readable text summary of selected modifiers for a cart item.
 * @param {object} item Cart item
 * @param {object} restaurantData Restaurant metadata
 * @returns {string} Comma-separated summary
 */
export function getCartOptionSummary(item, restaurantData = {}) {
  const groups = getDishModifierGroups(item.dish, restaurantData);
  const parts = (item.choices || []).flatMap(choice => {
    const group = groups.find(candidate => candidate.id === choice.groupId);
    return (choice.selections || []).map(selection => {
      const option = group?.options.find(candidate => candidate.id === selection.optionId);
      if (!option) return null;
      const label = selection.quantity > 1 ? `${selection.quantity}x ${option.name}` : option.name;
      return group?.kind === 'presentation' ? label : `${group?.name || 'Opción'}: ${label}`;
    }).filter(Boolean);
  });
  const summary = parts.join(', ');
  const hasPackage = groups.some(group => group.kind === 'presentation');
  return item.qty > 1 && hasPackage && summary ? `Por paquete (${item.qty}): ${summary}` : summary;
}

/**
 * Counts total quantity of a dish across the cart.
 * @param {string} dishId Dish identifier
 * @param {object} cart Current cart object
 * @returns {number} Sum of quantities
 */
export function getDishCartQuantity(dishId, cart = {}) {
  return Object.values(cart)
    .filter(item => item.dish.id === dishId)
    .reduce((quantity, item) => quantity + item.qty, 0);
}

/**
 * Calculates subtotal and final total for the cart.
 * @param {object} cart Current cart object
 * @param {object} restaurantData Restaurant metadata
 * @param {number} deliveryFee Delivery fee in currency
 * @param {object|null} coupon Active coupon
 * @param {string} mode 'LOCAL' | 'DELIVERY' | 'TAKEAWAY'
 * @returns {object} { subtotal, deliveryFee, discountAmount, total }
 */
export function calculateCartTotals(cart = {}, restaurantData = {}, deliveryFee = 0, coupon = null, mode = 'LOCAL') {
  let subtotal = 0;
  Object.values(cart).forEach(item => {
    const unitPrice = getCartUnitPrice(item, restaurantData);
    subtotal += unitPrice * (item.qty || 1);
  });

  const actualDelivery = mode === 'DELIVERY' ? deliveryFee : 0;
  let discountAmount = 0;
  if (coupon) {
    if (coupon.type === 'percent') {
      discountAmount = Math.round(subtotal * (coupon.value / 100) * 100) / 100;
    } else if (coupon.type === 'free_delivery' && mode === 'DELIVERY') {
      discountAmount = actualDelivery;
    }
  }

  const total = Math.max(0, subtotal + actualDelivery - discountAmount);
  return { subtotal, deliveryFee: actualDelivery, discountAmount, total };
}

/**
 * Adds an item to the local cart state with matching choices/notes deduplication.
 * @param {object} dish Dish to add
 * @param {string} note Optional note
 * @param {Array} choices Modifier choices array
 * @param {object} cart Target cart object
 * @returns {string} Cart item id created or updated
 */
export function addDishToCartState(dish, note = '', choices = [], cart = {}) {
  const choicesKey = JSON.stringify(choices || []);
  const matchingItem = Object.values(cart).find(
    item => item.dish.id === dish.id && item.note === note && JSON.stringify(item.choices || []) === choicesKey
  );
  if (matchingItem) {
    matchingItem.qty += 1;
    return matchingItem;
  }

  const cartItemId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  cart[cartItemId] = { dish, qty: 1, note, choices: choices || [] };
  return cartItemId;
}
