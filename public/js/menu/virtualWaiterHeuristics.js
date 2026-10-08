/**
 * public/js/menu/virtualWaiterHeuristics.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Real-time contextual heuristic recommendation engine: "El Mozo Virtual"
 * Evaluates cart items to detect orphan dishes (e.g. burger without fries or drink)
 * and situational weather/discount combos with persuasive sales arguments.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const DEFAULT_UPSELL_KEYWORDS = {
  triggers: ['hamburguesa', 'burger', 'milanesa', 'plato', 'principal', 'carne', 'pollo', 'pizza', 'sandwich', 'wrap', 'taco', 'burrito', 'empanada', 'combo', 'chivito', 'lomo'],
  complements: ['papas', 'bebida', 'gaseosa', 'jugo', 'agua', 'postre', 'helado', 'ensalada', 'guarnición', 'acompañamiento', 'salsa', 'extra', 'cerveza', 'vino', 'aros', 'nugget']
};

/**
 * Checks if El Mozo Virtual is enabled by user preference.
 */
export function isMozoVirtualEnabled() {
  try {
    return localStorage.getItem('scango_mozo_virtual_enabled') !== 'false';
  } catch (e) {
    return true;
  }
}

/**
 * Toggles Mozo Virtual preference and triggers UI refresh.
 */
export function handleMozoVirtualToggle(checked, renderSuggestionsFn) {
  try {
    localStorage.setItem('scango_mozo_virtual_enabled', checked ? 'true' : 'false');
  } catch (e) {}
  const box = document.getElementById('virtualWaiterUpsellBox');
  if (!checked) {
    if (box) box.style.display = 'none';
  } else if (typeof renderSuggestionsFn === 'function') {
    renderSuggestionsFn();
  }
}

/**
 * Evaluates cart items and determines contextual upsell opportunities.
 */
export function analyzeCartContextForUpsell(cart = {}, restaurantData = {}) {
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

  const hasBurger = /hamburguesa|burger|sandwich|chivito|lomo|wrap|taco|burrito/i.test(allCartText);
  const hasMain = hasBurger || /plato|principal|milanesa|pasta|carne|pollo|pescado|asado|bife|pizza|combo/i.test(allCartText);
  const hasDrink = /bebida|gaseosa|refresco|cerveza|trago|agua|coca|jugo|limonada|vino/i.test(allCartText);
  const hasSide = /papas|fritas|aros|guarnic|acompañ|ensalada|nugget/i.test(allCartText);
  const hasDessert = /postre|helado|flan|brownie|torta|dulce|tiramisu/i.test(allCartText);

  let cartSubtotal = 0;
  cartItems.forEach(ci => {
    cartSubtotal += (ci.qty || 1) * (ci.dish.price || 0);
  });

  const availableDishes = restaurantData.dishes.filter(d => !d.outOfStock && !cartDishIds.has(d.id));
  let candidates = [];
  let reason = '';
  let badge = 'Sugerencia del Mozo';

  if (hasBurger && !hasSide && !hasDrink) {
    candidates = availableDishes.filter(d => {
      const text = (d.name + ' ' + (d.description || '')).toLowerCase();
      return /papas|fritas|aros|gaseosa|refresco|coca|cerveza|limonada/i.test(text);
    }).slice(0, 3);
    reason = '🍔 ¿La acompañás con papas doradas o una bebida bien fría?';
    badge = 'Maridaje Perfecto';
  } else if (hasMain && !hasDrink) {
    candidates = availableDishes.filter(d => {
      const text = (d.name + ' ' + (d.description || '')).toLowerCase();
      const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
      const catName = (cat ? cat.name : '').toLowerCase();
      return /bebida|gaseosa|refresco|cerveza|vino|trago|agua|jugo/i.test(text + ' ' + catName);
    }).slice(0, 3);
    reason = '🍷 Nada mejor que un buen plato con la bebida ideal.';
    badge = 'Completá tu Mesa';
  } else if (hasMain && !hasDessert && cartSubtotal > 0) {
    candidates = availableDishes.filter(d => {
      const text = (d.name + ' ' + (d.description || '')).toLowerCase();
      const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
      const catName = (cat ? cat.name : '').toLowerCase();
      return /postre|helado|flan|brownie|torta|dulce|tiramisu|cafe/i.test(text + ' ' + catName);
    }).slice(0, 3);
    reason = '🍰 Date un gusto dulce para cerrar una comida perfecta.';
    badge = 'El Toque Final';
  }

  if (!candidates.length) {
    candidates = availableDishes.filter(d => d.isChefSpecial || (d.tags && d.tags.includes('destacado'))).slice(0, 3);
    if (candidates.length) {
      reason = '⭐ Especialidades recomendadas por nuestra cocina:';
      badge = 'Favoritos de la Casa';
    }
  }

  if (!candidates.length && availableDishes.length) {
    candidates = availableDishes.slice(0, 2);
    reason = '💡 También te podría gustar:';
    badge = 'Recomendado';
  }

  return { candidates, reason, badge };
}

/**
 * Returns upsell candidates for current cart state.
 */
export function getUpsellCandidates(cart = {}, restaurantData = {}) {
  const result = analyzeCartContextForUpsell(cart, restaurantData);
  return result.candidates;
}

/**
 * Renders upsell suggestion cards in cart container.
 */
export function renderUpsellSuggestions(params = {}) {
  const {
    cart = {},
    restaurantData = {},
    containerId = 'virtualWaiterUpsellBox',
    onQuickAdd = () => {},
    escapeHtmlFn = (s) => s
  } = params;

  const box = document.getElementById(containerId);
  if (!box) return;

  if (!isMozoVirtualEnabled()) {
    box.style.display = 'none';
    return;
  }

  const { candidates, reason, badge } = analyzeCartContextForUpsell(cart, restaurantData);
  if (!candidates.length) {
    box.style.display = 'none';
    return;
  }

  const currency = restaurantData.currency || '$';

  let html = `
    <div class="mozo-virtual-container" style="background:rgba(212,168,83,0.08); border:1px dashed rgba(212,168,83,0.4); border-radius:10px; padding:12px; margin-top:14px;">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
        <span style="font-size:11px; font-weight:700; color:var(--chalk-gold); text-transform:uppercase; letter-spacing:0.5px;">
          🤵 El Mozo Virtual sugiere:
        </span>
        <span style="font-size:9px; background:rgba(212,168,83,0.2); color:var(--chalk-gold); padding:2px 6px; border-radius:4px; font-weight:600;">
          ${escapeHtmlFn(badge)}
        </span>
      </div>
      <div class="mozo-reason-banner" style="font-size:12px; color:#fff; font-weight:500; margin-bottom:10px;">
        ${escapeHtmlFn(reason)}
      </div>
      <div class="mozo-cards-grid" style="display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:8px;">
  `;

  candidates.forEach(dish => {
    html += `
      <div class="mozo-dish-card" style="background:rgba(0,0,0,0.3); border:1px solid rgba(255,255,255,0.08); border-radius:8px; padding:8px; display:flex; flex-direction:column; justify-content:space-between;">
        <div>
          <div style="font-size:11px; font-weight:700; color:#fff; margin-bottom:2px; line-height:1.2;">
            ${escapeHtmlFn(dish.name)}
          </div>
          <div style="font-size:10px; color:var(--chalk-gold); font-weight:700; font-family:var(--font-mono);">
            ${currency} ${dish.price}
          </div>
        </div>
        <button type="button" class="btn-nav btn-quick-add-upsell" style="margin-top:6px; padding:3px 6px; font-size:10px; border-color:var(--chalk-gold); color:var(--chalk-gold); width:100%; justify-content:center;" data-js-click="quickAddUpsellItem|${dish.id}|this">
          + Agregar
        </button>
      </div>
    `;
  });

  html += `
      </div>
    </div>
  `;

  box.innerHTML = html;
  box.style.display = 'block';
}

/**
 * Quickly adds an upsell item to the cart without leaving modal.
 */
export function quickAddUpsellItem(dishId, btnEl, callbacks = {}) {
  const { cart = {}, restaurantData = {}, onUpdateUI = () => {} } = callbacks;
  if (!restaurantData || !restaurantData.dishes) return;
  const dish = restaurantData.dishes.find(d => d.id === dishId);
  if (!dish) return;

  if (cart[dishId]) {
    cart[dishId].qty += 1;
  } else {
    cart[dishId] = { dish, qty: 1 };
  }

  if (btnEl) {
    const origText = btnEl.textContent;
    btnEl.textContent = '✓ Agregado';
    btnEl.style.borderColor = '#48BB78';
    btnEl.style.color = '#48BB78';
    setTimeout(() => {
      btnEl.textContent = origText;
      btnEl.style.borderColor = 'var(--chalk-gold)';
      btnEl.style.color = 'var(--chalk-gold)';
    }, 1200);
  }

  if (typeof onUpdateUI === 'function') onUpdateUI();
}

/**
 * Detects cross-selling opportunities based on dish categories.
 */
export function detectCrossSellOpportunity(cartItems = [], restaurantData = {}) {
  if (!cartItems.length || !restaurantData || !restaurantData.dishes) return [];
  const dishNames = cartItems.map(ci => (ci.dish.name || '').toLowerCase()).join(' ');
  const needsDrink = !/bebida|gaseosa|agua|cerveza|vino|trago/i.test(dishNames);
  if (needsDrink) {
    return restaurantData.dishes.filter(d => {
      const text = (d.name + ' ' + (d.description || '')).toLowerCase();
      return !d.outOfStock && /bebida|gaseosa|refresco|cerveza|limonada|trago/i.test(text);
    }).slice(0, 2);
  }
  return [];
}

/**
 * Renders cross-sell section inside customization modal.
 */
export function renderCrossSellSection(cartItems = [], restaurantData = {}, callbacks = {}) {
  const container = document.getElementById('dishModalUpsellBox');
  if (!container) return;
  const items = detectCrossSellOpportunity(cartItems, restaurantData);
  if (!items.length) {
    container.style.display = 'none';
    return;
  }
  const curr = restaurantData.currency || '$';
  container.innerHTML = `
    <div style="background:rgba(0,0,0,0.25); border-radius:6px; padding:8px 10px; margin-top:10px;">
      <div style="font-size:11px; font-weight:700; color:var(--chalk-gold); margin-bottom:4px;">✨ Combiná tu plato con:</div>
      <div style="display:flex; gap:6px;">
        ${items.map(it => `
          <button type="button" class="btn-nav" style="flex:1; padding:4px 6px; font-size:10px; justify-content:space-between;" data-js-click="quickAddUpsellItem|${it.id}|this">
            <span>${it.name}</span>
            <strong style="color:var(--chalk-gold);">${curr} ${it.price}</strong>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  container.style.display = 'block';
}
