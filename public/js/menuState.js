/**
 * menuState.js — Estado y Lógica de Negocio Pura (Capa 0)
 * Sin dependencias de DOM. Solo variables de estado y funciones puras.
 */

// ============================================================================
// ESTADO GLOBAL (exportado como mutable para compatibilidad incremental)
// ============================================================================

export let restaurantData = null;
export let selectedCategory = 'ALL';
export let cart = {}; // { dishId: { dish, qty } }
export let pendingDishNoteAction = null;
export let deliveryFee = 0;
export let appliedCoupon = null; // { code: 'PROMO10', type: 'percent', value: 10 }
export let discountAmount = 0;
export let selectedDietFilter = 'ALL';

export const DIET_FILTER_MAP = {
  veggie: ['veggie', 'vegetariano'],
  vegan: ['vegan', 'vegano'],
  celiac: ['celiac', 'singluten'],
  sinlactosa: ['sinlactosa'],
  picante: ['picante']
};

// ============================================================================
// HELPERS PUROS (sin DOM)
// ============================================================================

export function getSlug() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('slug')) return urlParams.get('slug');
  const parts = window.location.pathname.split('/');
  const mIndex = parts.indexOf('m');
  if (mIndex !== -1 && parts[mIndex + 1]) {
    return parts[mIndex + 1];
  }
  return 'demo';
}

export function getActiveWeatherContext() {
  const context = restaurantData?.weatherContext;
  return restaurantData?.smartWeatherEnabled === true &&
    ['muy_frio', 'frio', 'templado', 'caluroso', 'muy_caluroso'].includes(context)
    ? context
    : null;
}

export function sortWeatherDishes(dishes) {
  const context = getActiveWeatherContext();
  if (!context) return dishes;
  return dishes.map((dish, index) => ({ dish, index }))
    .sort((left, right) => {
      const leftMatch = (left.dish.weatherTags || []).includes(context) ? 1 : 0;
      const rightMatch = (right.dish.weatherTags || []).includes(context) ? 1 : 0;
      return rightMatch - leftMatch || left.index - right.index;
    })
    .map(entry => entry.dish);
}

export function sortWeatherCategories(categories, dishes) {
  const context = getActiveWeatherContext();
  if (context !== 'muy_caluroso' && context !== 'muy_frio') return categories;
  const pattern = context === 'muy_caluroso'
    ? /bebid|drink|helad|refresc|limonad|cervez|fr[ií]a|fr[ií]os/i
    : /sopa|caldo|guis|estofad|infusi|caliente|caf[eé]/i;
  return categories.map((category, index) => {
    const categoryDishes = dishes.filter(dish => dish.categoryId === category.id);
    const tagged = categoryDishes.some(dish => (dish.weatherTags || []).includes(context));
    return { category, index, priority: tagged || pattern.test(category.name || '') ? 1 : 0 };
  }).sort((left, right) => right.priority - left.priority || left.index - right.index)
    .map(entry => entry.category);
}

export function getAvailableDietFilters() {
  const dishes = restaurantData.dishes || [];
  const available = new Set(['ALL']);
  Object.entries(DIET_FILTER_MAP).forEach(([key, tags]) => {
    const hasMatch = dishes.some(d => !d.outOfStock && d.tags && d.tags.some(t => tags.includes(t)));
    if (hasMatch) available.add(key);
  });
  return available;
}

function matchesDiet(d) {
  if (selectedDietFilter === 'ALL') return true;
  if (!d.tags) return false;
  if (selectedDietFilter === 'veggie') return d.tags.includes('veggie') || d.tags.includes('vegetariano');
  if (selectedDietFilter === 'vegan') return d.tags.includes('vegan') || d.tags.includes('vegano');
  if (selectedDietFilter === 'celiac') return d.tags.includes('celiac') || d.tags.includes('singluten');
  if (selectedDietFilter === 'sinlactosa') return d.tags.includes('sinlactosa');
  if (selectedDietFilter === 'picante') return d.tags.includes('picante');
  return true;
}

export function getDishScheduleStatus(d) {
  if (!d.schedule || !d.schedule.enabled) {
    return { isAvailable: true, shouldDisplay: true, effectivePrice: d.price, isHappyHour: false };
  }
  const now = new Date();
  const currentDay = now.getDay(); // 0 is Sunday, 1 is Monday ...
  const curHour = String(now.getHours()).padStart(2, '0');
  const curMin = String(now.getMinutes()).padStart(2, '0');
  const curTime = `${curHour}:${curMin}`;

  const days = Array.isArray(d.schedule.days) ? d.schedule.days : [0, 1, 2, 3, 4, 5, 6];
  const dayMatches = days.includes(currentDay);

  const start = d.schedule.timeStart || '00:00';
  const end = d.schedule.timeEnd || '23:59';
  let timeMatches = true;
  if (start <= end) {
    timeMatches = (curTime >= start && curTime <= end);
  } else {
    timeMatches = (curTime >= start || curTime <= end);
  }

  const isAvailable = dayMatches && timeMatches;
  
  // Happy Hours: if schedule is active and has overridePrice, use it
  const overridePrice = d.schedule.overridePrice;
  const originalPriceRef = d.schedule.originalPriceRef;
  const isHappyHour = isAvailable && overridePrice !== null && overridePrice !== undefined;

  if (isAvailable) {
    return { 
      isAvailable: true, 
      shouldDisplay: true, 
      effectivePrice: isHappyHour ? overridePrice : d.price,
      isHappyHour,
      originalPrice: isHappyHour ? (originalPriceRef || d.price) : null,
      happyHourLabel: isHappyHour ? '🕐 Happy Hour' : null
    };
  }

  const behavior = d.schedule.behavior || 'hide';
  if (behavior === 'hide') {
    return { isAvailable: false, shouldDisplay: false, effectivePrice: d.price, isHappyHour: false };
  }

  return {
    isAvailable: false,
    shouldDisplay: true,
    effectivePrice: d.price,
    isHappyHour: false,
    reason: `Disponible ${start} a ${end}`
  };
}

export function getDishModifierGroups(dish) {
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

export function getSavedGroupSelections(cartItem, groupId) {
  return cartItem?.choices?.find(choice => choice.groupId === groupId)?.selections || [];
}

export function getSelectedPackageUnits(groups, cartItem) {
  const packageGroup = groups.find(group => group.kind === 'presentation');
  if (!packageGroup) return null;
  const selected = getSavedGroupSelections(cartItem, packageGroup.id)[0];
  return packageGroup.options.find(option => option.id === selected?.optionId)?.unitsIncluded || null;
}

export function getCartUnitPrice(item) {
  const groups = getDishModifierGroups(item.dish);
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

export function getCartOptionSummary(item) {
  const groups = getDishModifierGroups(item.dish);
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

export function getDishCartQuantity(dishId) {
  return Object.values(cart)
    .filter(item => item.dish.id === dishId)
    .reduce((quantity, item) => quantity + item.qty, 0);
}

export function addDishToCart(dish, note, choices) {
  if (window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive()) {
    const added = window.groupCartManagerInstance.addItem(dish, choices, note);
    if (added) {
      cart = window.groupCartManagerInstance.cart;
      return;
    }
  }

  const choicesKey = JSON.stringify(choices || []);
  const matchingItem = Object.values(cart).find(item => item.dish.id === dish.id && item.note === note && JSON.stringify(item.choices || []) === choicesKey);
  if (matchingItem) {
    matchingItem.qty += 1;
    return;
  }

  const cartItemId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  cart[cartItemId] = { dish, qty: 1, note, choices: choices || [] };
}

export function editCartItemNote(cartItemId) {
  if (cart[cartItemId]) {
    if (window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive()) {
      if (!window.groupCartManagerInstance.canEditItem(cart[cartItemId])) {
        alert(`Solo ${cart[cartItemId].orderedBy || 'quien lo pidió'} puede modificar notas de este plato.`);
        return;
      }
    }
    pendingDishNoteAction = { mode: 'edit', cartItemId };
  }
}

export function changeCartQty(cartItemId, delta) {
  if (!cart[cartItemId]) return;

  // Restricción: Cada comensal solo puede editar o eliminar los platos creados bajo su propio nombre
  if (window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive()) {
    const success = window.groupCartManagerInstance.changeQty(cartItemId, delta);
    if (!success) return;
    cart = window.groupCartManagerInstance.cart;
    return;
  }

  cart[cartItemId].qty += delta;
  if (cart[cartItemId].qty <= 0) {
    delete cart[cartItemId];
  }
}

export function syncCartFromGroupManager(updatedCart, meta) {
  cart = updatedCart || {};
}

export function updateCartUI() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad - será sobrescrita por menuRenderer
}

export function applyCoupon() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

export function updateTotals() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

export function updateDeliveryFee() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

export function handleOrderModeChange() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

export function handleOrderPaymentChange() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

export function updateSplitCalculation() {
  // Esta función toca DOM, se mueve a menuRenderer.js
  // Placeholder para compatibilidad
}

// ============================================================================
// VIRTUAL WAITER (El Mozo Virtual) - Lógica pura
// ============================================================================

const DEFAULT_UPSELL_KEYWORDS = {
  triggers: ['hamburguesa', 'burger', 'milanesa', 'plato', 'principal', 'carne', 'pollo', 'pizza', 'sandwich', 'wrap', 'taco', 'burrito', 'empanada', 'combo', 'chivito', 'lomo'],
  complements: ['papas', 'bebida', 'gaseosa', 'jugo', 'agua', 'postre', 'helado', 'ensalada', 'guarnición', 'acompañamiento', 'salsa', 'extra', 'cerveza', 'vino', 'aros', 'nugget']
};

export function analyzeCartContextForUpsell() {
  const cartItems = Object.values(cart);
  if (!cartItems.length || !restaurantData || !restaurantData.dishes) {
    return { candidates: [], reason: '', badge: '' };
  }

  const cartDishIds = new Set(cartItems.map(ci => ci.dish.id));
  const cartDishNames = cartItems.map(ci => (ci.dish.name || '').toLowerCase());
  const cartCategories = cartItems.map(ci => {
    const cat = (restaurantData.categories || []).find(c => c.id === ci.dish.categoryId);
    return (cat ? cat.name : '').toLowerCase();
  });
  const allCartText = cartDishNames.join(' ') + ' ' + cartCategories.join(' ');

  // Análisis de contenido del carrito
  const hasBurger = /hamburguesa|burger|sandwich|chivito|lomo|wrap|taco|burrito/i.test(allCartText);
  const hasMain = hasBurger || /plato|principal|milanesa|pasta|carne|pollo|pescado|asado|bife|pizza|combo/i.test(allCartText);
  const hasDrink = /bebida|gaseosa|refresco|cerveza|trago|agua|coca|jugo|limonada|vino/i.test(allCartText);
  const hasSide = /papas|fritas|aros|guarnic|acompañ|ensalada|nugget/i.test(allCartText);
  const hasDessert = /postre|helado|flan|brownie|torta|dulce|tiramisu/i.test(allCartText);

  // Subtotal de platos actuales
  let cartSubtotal = 0;
  cartItems.forEach(ci => {
    cartSubtotal += (ci.qty || 1) * (ci.dish.price || 0);
  });

  // Platos disponibles que no están en el carrito
  const availableDishes = (restaurantData.dishes || []).filter(dish =>
    !cartDishIds.has(dish.id) && !dish.outOfStock && (dish.price || 0) > 0
  );

  if (!availableDishes.length) {
    return { candidates: [], reason: '', badge: '' };
  }

  // Reglas personalizadas del restaurante (si existen)
  const customRules = restaurantData.upsellRules || [];
  if (customRules.length) {
    for (const rule of customRules) {
      const triggered = (rule.triggerCategoryIds || []).some(catId =>
        cartItems.some(ci => ci.dish.categoryId === catId)
      );
      if (triggered) {
        const matches = availableDishes.filter(d =>
          (rule.suggestCategoryIds || []).includes(d.categoryId) ||
          (rule.suggestDishIds || []).includes(d.id)
        );
        if (matches.length) {
          return {
            candidates: matches.slice(0, 3),
            reason: rule.message || '✨ Sugerencia exclusiva configurada por la casa para tu pedido.',
            badge: 'Promoción de la casa'
          };
        }
      }
    }
  }

  const weatherContext = getActiveWeatherContext();
  if (weatherContext) {
    const weatherMatches = availableDishes.filter(dish => (dish.weatherTags || []).includes(weatherContext));
    if (weatherMatches.length) {
      const temperature = Number(restaurantData.weatherTemperatureC);
      const hotDay = weatherContext === 'muy_caluroso' || weatherContext === 'caluroso';
      const drinkPattern = /bebida|limonada|jugo|refresco|cerveza|helad|agua|fr[ií]a/i;
      const relevantMatches = hotDay
        ? weatherMatches.filter(dish => drinkPattern.test(`${dish.name} ${dish.description || ''}`))
        : weatherMatches;
      const candidates = relevantMatches.length ? relevantMatches : weatherMatches;
      let reason = '🌤️ Te recomendamos una opción ideal para el clima de hoy.';
      if (hotDay) {
        reason = `🔥 ¡Hace calor! ¿Querés agregar una ${candidates[0].name} helada con 15% OFF?`;
      } else if (weatherContext === 'muy_frio') {
        reason = `🥣 ¡Hoy está muy frío${Number.isFinite(temperature) ? ` (${Math.round(temperature)}°C)` : ''}! ${candidates[0].name} es ideal para entrar en calor.`;
      }
      return { candidates: candidates.slice(0, 3), reason, badge: 'Ideal para el clima' };
    }
  }

  // Heurística 1: Hamburguesa o sándwich sin papas ni guarnición
  if (hasBurger && !hasSide) {
    const sides = availableDishes.filter(d => {
      const t = `${d.name} ${d.description || ''}`.toLowerCase();
      return /papa|frita|aro|guarnic|acompañ|nugget/i.test(t);
    });
    if (sides.length) {
      sides.sort((a, b) => (a.price || 0) - (b.price || 0));
      return {
        candidates: sides.slice(0, 3),
        reason: '🍟 ¿Sale con papas? Las mejores hamburguesas siempre van con acompañamiento crocante. ¡Sumalo a tu pedido!',
        badge: 'Acompañamiento ideal'
      };
    }
  }

  // Heurística 2: Plato principal sin bebida fresca
  if (hasMain && !hasDrink) {
    const drinks = availableDishes.filter(d => {
      const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
      const t = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
      return /bebida|refresco|gaseosa|coca|cerveza|agua|jugo|limonada|vino/i.test(t);
    });
    if (drinks.length) {
      drinks.sort((a, b) => (a.price || 0) - (b.price || 0));
      return {
        candidates: drinks.slice(0, 3),
        reason: '🥤 ¡No te olvides de la bebida! Ideal para acompañar tu plato principal con -15% de descuento sugerido.',
        badge: 'Maridaje perfecto'
      };
    }
  }

  // Heurística 3: Ticket robusto sin postre dulce
  if (cartSubtotal >= 350 && !hasDessert) {
    const desserts = availableDishes.filter(d => {
      const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
      const t = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
      return /postre|helado|flan|brownie|torta|dulce|tiramisu/i.test(t);
    });
    if (desserts.length) {
      desserts.sort((a, b) => (a.price || 0) - (b.price || 0));
      return {
        candidates: desserts.slice(0, 3),
        reason: '🍨 Coroná tu experiencia con un postre artesanal para el toque dulce final.',
        badge: 'Cierre dulce'
      };
    }
  }

  // Heurística 4 (Fallback): Complementos accesibles y populares
  const generalComplements = availableDishes.filter(d => {
    const t = `${d.name} ${d.description || ''}`.toLowerCase();
    return DEFAULT_UPSELL_KEYWORDS.complements.some(kw => t.includes(kw));
  });
  generalComplements.sort((a, b) => (a.price || 0) - (b.price || 0));

  const selected = generalComplements.length ? generalComplements : availableDishes;
  return {
    candidates: selected.slice(0, 3),
    reason: '✨ Recomendación del chef: Completá tu pedido con estos favoritos de la casa.',
    badge: 'Recomendación especial'
  };
}

export function getUpsellCandidates() {
  const analysis = analyzeCartContextForUpsell();
  return analysis.candidates || [];
}

// ============================================================================
// CROSS-SELLING - Lógica pura
// ============================================================================

const CROSS_SELL_PATTERNS = {
  postre: /postre|helado|flan|brownie|torta|dulce|tiramisu|chocotorta|cheesecake|mousse|panna|cotta/i,
  bebida: /bebida|refresco|gaseosa|coca|cerveza|agua|jugo|limonada|vino|cerveza|energizante|agua mineral/i,
  entrada: /entrada|aperitivo|pat[eé]s|empanada|picada|wrap|nugget|aros/i,
  acompaniamiento: /papas|fritas|aros|guarnic|acompa[ñn]|ensalada|salad/i
};

export function detectCrossSellOpportunity(cartItems) {
  const cartText = cartItems.map(ci => {
    const cat = (restaurantData.categories || []).find(c => c.id === ci.dish.categoryId);
    return `${ci.dish.name} ${ci.dish.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
  }).join(' ');

  const hasDessert = CROSS_SELL_PATTERNS.postre.test(cartText);
  const hasDrink = CROSS_SELL_PATTERNS.bebida.test(cartText);
  const hasMain = /plato|principal|milanesa|pasta|carne|pollo|pescado|asado|bife|pizza|hamburguesa|burger|sandwich|chivito|lomo|wrap|taco|burrito|empanada/i.test(cartText);

  const opportunities = [];
  if (hasMain && !hasDrink) opportunities.push({ type: 'bebida', priority: 1, message: '¿Algo para beber? Las bebidas van perfecto con tu pedido.' });
  if (hasMain && !hasDessert) opportunities.push({ type: 'postre', priority: 2, message: '¿Dulce final? Un postre eleva toda la experiencia.' });
  if (!hasDrink) opportunities.push({ type: 'bebida', priority: 3, message: 'Agregá una bebida para completar tu pedido.' });

  return opportunities;
}

// ============================================================================
// FORMATTERS
// ============================================================================

export function formatMenuPrice(amount) {
  const price = Number(amount) || 0;
  const currency = restaurantData?.currency || '$';
  if (Math.abs(price - Math.round(price)) > 0.000001) {
    return `${currency} ${price.toFixed(2)}`;
  }
  return (window.i18nManager && typeof window.i18nManager.formatPrice === 'function')
    ? window.i18nManager.formatPrice(price)
    : `${currency} ${price}`;
}

export function formatOptionPrice(priceDeltaCents) {
  const price = Number(priceDeltaCents) / 100;
  return formatMenuPrice(price);
}

// ============================================================================
// TOAST (delegado a renderer, pero lógica pura aquí)
// ============================================================================

export function showToast(message, type = 'success') {
  // Placeholder - implementación real en menuRenderer.js
  console.log(`[Toast] ${type}: ${message}`);
}

// ============================================================================
// ORDER SUBMISSION (lógica de preparación de pedido)
// ============================================================================

export function prepareOrderData(mode, customerName, notes, payment, tableNumber, address, zoneSelect, currency) {
  const items = Object.values(cart);
  const isGroupOrder = Boolean(window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive());
  
  return {
    restaurantId: restaurantData.id,
    tableNumber,
    customerName,
    customerPhone: '',
    deliveryAddress: mode === 'DELIVERY' ? address : '',
    currency,
    notes,
    isGroupOrder,
    participants: window.groupCartManagerInstance ? Array.from(window.groupCartManagerInstance.participants) : [],
    items: items.map(item => ({
      dishId: item.dish.id,
      quantity: item.qty,
      note: item.note || '',
      orderedBy: item.orderedBy || '',
      orderedById: item.orderedById || '',
      choices: (item.choices || []).map(choice => ({
        groupId: choice.groupId,
        selections: choice.selections.map(selection => ({
          optionId: selection.optionId,
          quantity: selection.quantity
        }))
      }))
    }))
  };
}

export function buildWhatsAppMessage(quote, mode, customerName, notes, payment, tableNumber, address, zoneSelect, currency, deliveryFee, appliedCoupon, discountAmount, isGroupOrder) {
  let msg = isGroupOrder
    ? `👥 *PEDIDO GRUPAL COLABORATIVO - ${restaurantData.name.toUpperCase()}*\n`
    : `📋 *NUEVO PEDIDO - ${restaurantData.name.toUpperCase()}*\n`;
  msg += `👤 *Cliente:* ${customerName}\n`;
  if (mode === 'LOCAL') {
    msg += `🍽️ *Modalidad:* En el local - *${tableNumber || 'Mesa no especificada'}*\n`;
    if (isGroupOrder && window.groupCartManagerInstance?.participants?.size > 0) {
      msg += `👥 *Comensales en la mesa:* ${Array.from(window.groupCartManagerInstance.participants).join(', ')}\n\n`;
    } else {
      msg += `\n`;
    }
  } else if (mode === 'TAKEAWAY') {
    msg += `🛍️ *Modalidad:* Retiro en el local (Take Away)\n\n`;
  } else {
    const zoneName = zoneSelect.options[zoneSelect.selectedIndex]?.text || 'Zona no especificada';
    msg += `🛵 *Modalidad:* Envío a Domicilio\n`;
    msg += `📍 *Zona:* ${zoneName}\n`;
    msg += `🏠 *Dirección:* ${address || 'Dirección no especificada'}\n\n`;
  }

  msg += `*DETALLE DEL PEDIDO:*\n`;
  quote.itemsSnapshot.forEach((line, index) => {
    const authorTag = line.orderedBy ? ` (👤 ${line.orderedBy})` : '';
    msg += `▪ ${line.quantity}x ${line.name}${authorTag} - ${currency} ${line.totalItemAmount.toFixed(2)}\n`;
    const optionSummary = (line.optionsSnapshot || []).flatMap(group => (group.selections || []).map(selection => {
      const label = selection.quantity > 1 ? `${selection.quantity}x ${selection.name}` : selection.name;
      return group.kind === 'presentation' ? label : `${group.groupName}: ${label}`;
    })).join(', ');
    if (optionSummary) {
      const perPackage = line.quantity > 1 && (line.optionsSnapshot || []).some(group => group.kind === 'presentation');
      msg += `   ↳ ${perPackage ? 'Opciones por paquete' : 'Opciones'}: ${optionSummary}\n`;
    }
    if (line.note) msg += `   📝 Nota: ${line.note}\n`;
    const dish = Object.values(cart)[index]?.dish;
    if (dish?.description && (dish.isCustomIceCream || (dish.id && dish.id.startsWith('perfume_')))) {
      msg += `   ↳ _${dish.description}_\n`;
    }
  });

  // Consolidación de pedidos para Cocina en pedidos grupales
  if (isGroupOrder && window.groupCartManagerInstance) {
    const consolidated = window.groupCartManagerInstance.consolidateOrder();
    if (consolidated.kitchenConsolidated.length > 0) {
      msg += `\n🍳 *CONSOLIDADO PARA COCINA:*\n`;
      consolidated.kitchenConsolidated.forEach(k => {
        msg += `▪ ${k.quantity}x ${k.name}\n`;
        if (k.notes.length) msg += `   ↳ ${k.notes.join(' | ')}\n`;
      });
    }
  }

  if (notes) msg += `\n📝 *Aclaraciones:* ${notes}\n`;
  
  const subtotal = quote.amount;
  const currentDelivery = mode === 'DELIVERY' ? deliveryFee : 0;
  const currentDiscount = appliedCoupon?.type === 'percent'
    ? Math.round(subtotal * (appliedCoupon.value / 100) * 100) / 100
    : (appliedCoupon?.type === 'free_delivery' && mode === 'DELIVERY' ? currentDelivery : 0);
  const total = Math.max(0, subtotal + currentDelivery - currentDiscount);

  msg += `\n💵 *Subtotal:* ${currency} ${subtotal.toFixed(2)}\n`;
  if (appliedCoupon && currentDiscount > 0) msg += `🎟️ *Descuento Cupón (${appliedCoupon.code}):* -${currency} ${currentDiscount.toFixed(2)}\n`;
  if (mode === 'DELIVERY' && deliveryFee > 0) msg += `🛵 *Envío:* ${currency} ${deliveryFee}\n`;
  msg += `💰 *TOTAL A PAGAR:* ${currency} ${total.toFixed(2)}\n`;
  msg += `💳 *Método de Pago Seleccionado:* [${payment.toUpperCase()}]\n`;
  if (payment.includes('Transferencia')) msg += `ℹ️ _Se adjuntará el comprobante de transferencia por este chat._\n`;
  if (restaurantData.paymentLink) msg += `🔗 _Link de Pago:_ ${restaurantData.paymentLink}\n`;
  msg += `\n_Enviado desde ScanGo (Menú Digital)_`;

  return { msg, total, subtotal, currentDelivery, currentDiscount };
}

// ============================================================================
// RESERVATION / WIFI / TTS / PUSH - Stubs (delegados a componentes)
// ============================================================================

export function openWaiterModal() { /* delegado a renderer */ }
export function closeWaiterModal() { /* delegado a renderer */ }
export function sendWaiterCall(type) { /* delegado a renderer */ }

export function openSmartReviewModal() { /* delegado a renderer */ }
export function closeSmartReviewModal() { /* delegado a renderer */ }
export function handleStarSelect(rating) { /* delegado a renderer */ }
export function handleGoogleReviewClick() { /* delegado a renderer */ }
export function submitPrivateFeedback(e) { /* delegado a renderer */ }

export function openReservationModal() { /* delegado a renderer */ }
export function closeReservationModal() { /* delegado a renderer */ }
export function submitReservation(e) { /* delegado a renderer */ }

export function openWifiModal() { /* delegado a renderer */ }
export function closeWifiModal() { /* delegado a renderer */ }
export function copyWifiPassword() { /* delegado a renderer */ }

export function stopCategoryTTS() { /* delegado a renderer */ }
export function pauseCategoryTTS() { /* delegado a renderer */ }
export function resumeCategoryTTS() { /* delegado a renderer */ }
export function readSelectedCategoryTTS() { /* delegado a renderer */ }

export function initPushPrompt() { /* delegado a renderer */ }
export function requestPushPermission() { /* delegado a renderer */ }
export function dismissPushPrompt() { /* delegado a renderer */ }

export function openWhatsAppChat() { /* delegado a renderer */ }
export function openRestaurantInfoModal() { /* delegado a renderer */ }
export function closeRestaurantInfoModal() { /* delegado a renderer */ }
export function shareRestaurantUrl() { /* delegado a renderer */ }
export function openLoyaltyModal() { /* delegado a renderer */ }
export function openCategoriesMenuModal() { /* delegado a renderer */ }
export function closeCategoriesMenuModal() { /* delegado a renderer */ }
export function selectCategoryFromModal(catId) { /* delegado a renderer */ }
export function focusSearchInput() { /* delegado a renderer */ }
export function selectDietFilter(diet) { /* delegado a renderer */ }
export function clearSearchFilter() { /* delegado a renderer */ }
export function filterDishes() { /* delegado a renderer */ }
export function quickAddUpsellItem(dishId, btnEl) { /* delegado a renderer */ }
export function renderUpsellSuggestions() { /* delegado a renderer */ }