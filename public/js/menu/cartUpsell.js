/**
 * public/js/menu/cartUpsell.js
 * ────────────────────────────
 * Mozo Virtual + cross-selling (extraído de menu.js sin cambios de
 * comportamiento: misma lógica, mismas strings, mismo orden). Todo lo que
 * tocaba estado del módulo menu.js llega por `ctx`:
 * {
 *   getCart: () => cart, getRestaurantData: () => restaurantData,
 *   getActiveWeatherContext: () => string|null,
 *   isMozoVirtualEnabled, areMenuOrdersEnabled, addDishToCart,
 *   updateCartUI, renderCartModalList, formatMenuPrice: (n) => string
 * }
 * Sin imports fuera de public/js. Sin DOM en import (seguro en Node).
 */
import { escapeHtml } from '../utils/escapeHtmlBrowser.js';
import { isFreePrice } from './menuPresentation.js';
import { isDishSoldOut } from '../utils/dishAvailability.js';

    /**
     * Diccionario semántico de categorías y disparadores para recomendaciones gastronómicas
     */
    const DEFAULT_UPSELL_KEYWORDS = {
      triggers: ['hamburguesa', 'burger', 'milanesa', 'plato', 'principal', 'carne', 'pollo', 'pizza', 'sandwich', 'wrap', 'taco', 'burrito', 'empanada', 'combo', 'chivito', 'lomo'],
      complements: ['papas', 'bebida', 'gaseosa', 'jugo', 'agua', 'postre', 'helado', 'ensalada', 'guarnición', 'acompañamiento', 'salsa', 'extra', 'cerveza', 'vino', 'aros', 'nugget']
    };

    /**
     * Motor heurístico en tiempo real: evalúa el carrito y genera recomendaciones con argumentos persuasivos
     */
    function analyzeCartContextForUpsell(ctx) {
      const cart = ctx.getCart();
      const restaurant = ctx.getRestaurantData();
      const getActiveWeatherContext = ctx.getActiveWeatherContext;
      const restaurantData = restaurant;
      const cartItems = Object.values(ctx.getCart());
      if (!cartItems.length || !ctx.getRestaurantData() || !ctx.getRestaurantData().dishes) {
        return { candidates: [], reason: '', badge: '' };
      }

      const cartDishIds = new Set(cartItems.map(ci => ci.dish.id));
      const cartDishNames = cartItems.map(ci => (ci.dish.name || '').toLowerCase());
      const cartCategories = cartItems.map(ci => {
        const cat = (ctx.getRestaurantData().categories || []).find(c => c.id === ci.dish.categoryId);
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

      // Platos disponibles que no están en el carrito (agotado manual u
      // "Agotado hoy" derivado del stock diario, ambos fuera).
      const availableDishes = (ctx.getRestaurantData().dishes || []).filter(dish =>
        !cartDishIds.has(dish.id) && !isDishSoldOut(dish) && (dish.price || 0) > 0
      );

      if (!availableDishes.length) {
        return { candidates: [], reason: '', badge: '' };
      }

      // Reglas personalizadas del restaurante (si existen)
      const customRules = ctx.getRestaurantData().upsellRules || [];
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

      const weatherContext = ctx.getActiveWeatherContext();
      if (weatherContext) {
        const weatherMatches = availableDishes.filter(dish => (dish.weatherTags || []).includes(weatherContext));
        if (weatherMatches.length) {
          const temperature = Number(ctx.getRestaurantData().weatherTemperatureC);
          const hotDay = weatherContext === 'muy_caluroso' || weatherContext === 'caluroso';
          const drinkPattern = /bebida|limonada|jugo|refresco|cerveza|helad|agua|fr[ií]a/i;
          const relevantMatches = hotDay
            ? weatherMatches.filter(dish => drinkPattern.test(`${dish.name} ${dish.description || ''}`))
            : weatherMatches;
          const candidates = relevantMatches.length ? relevantMatches : weatherMatches;
          let reason = '🌤️ Te recomendamos una opción ideal para el clima de hoy.';
          if (hotDay) {
            reason = `🔥 ¡Hace calor! ¿Querés agregar una ${candidates[0].name} bien helada para refrescar el momento?`;
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
          const cat = (ctx.getRestaurantData().categories || []).find(c => c.id === d.categoryId);
          const t = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
          return /bebida|refresco|gaseosa|coca|cerveza|agua|jugo|limonada|vino/i.test(t);
        });
        if (drinks.length) {
          drinks.sort((a, b) => (a.price || 0) - (b.price || 0));
          return {
            candidates: drinks.slice(0, 3),
            reason: '🥤 ¡No te olvides de la bebida! Ideal para acompañar tu plato principal.',
            badge: 'Maridaje perfecto'
          };
        }
      }

      // Heurística 3: Ticket robusto sin postre dulce
      if (cartSubtotal >= 350 && !hasDessert) {
        const desserts = availableDishes.filter(d => {
          const cat = (ctx.getRestaurantData().categories || []).find(c => c.id === d.categoryId);
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

    /**
     * Retorna los candidatos a upselling (mantiene compatibilidad con suite de tests existente)
     */
    function getUpsellCandidates(ctx) {
      const analysis = analyzeCartContextForUpsell(ctx);
      return analysis.candidates || [];
    }

    function renderUpsellSuggestions(ctx) {
      const box = document.getElementById('virtualWaiterUpsellBox');
      const toggleEl = document.getElementById('toggleMozoVirtual');
      if (toggleEl) {
        toggleEl.checked = ctx.isMozoVirtualEnabled();
      }

      if (!box) return;

      if (!ctx.isMozoVirtualEnabled()) {
        box.style.display = 'none';
        return;
      }

      const analysis = analyzeCartContextForUpsell(ctx);
      const candidates = analysis.candidates;

      if (!candidates || !candidates.length) {
        box.style.display = 'none';
        return;
      }

      const currency = ctx.getRestaurantData().currency || '$';
      let cardsHtml = '';
      candidates.forEach(dish => {
        const thumbHtml = dish.photoUrl
          ? `<img class="mozo-item-thumb" src="${escapeHtml(dish.photoUrl)}" alt="${escapeHtml(dish.name)}" loading="lazy" decoding="async" data-js-error-style-display="none">`
          : `<div class="mozo-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`;
        // Sugerencia sin costo: sin cifra, solo el botón agregar.
        const upsellIsFree = isFreePrice(dish.price);
        cardsHtml += `
          <div class="mozo-item-card">
            ${thumbHtml}
            <div class="mozo-item-info">
              <span class="mozo-badge-tag">${escapeHtml(analysis.badge || 'Sugerido')}</span>
              <div class="mozo-item-title">${escapeHtml(dish.name)}</div>
              ${upsellIsFree ? '' : `<div class="mozo-item-price">${escapeHtml(currency)} ${(Number(dish.price) || 0).toFixed(0)}</div>`}
            </div>
            <button type="button" class="btn-mozo-quick-add" data-dish-id="${escapeHtml(dish.id)}" data-js-click="quickAddUpsellItem|${escapeHtml(dish.id)}|this">
              + Agregar
            </button>
          </div>`;
      });

      box.innerHTML = `
        <div class="mozo-header">
          <div class="mozo-avatar">🤵</div>
          <div class="mozo-header-text">
            <h4>El Mozo Virtual sugiere</h4>
            <p>Recomendaciones personalizadas para tu comanda</p>
          </div>
        </div>
        ${analysis.reason ? `<div class="mozo-reason-banner">${escapeHtml(analysis.reason)}</div>` : ''}
        <div class="mozo-cards-carousel">${cardsHtml}</div>
      `;
      box.style.display = 'block';
    }

    function quickAddUpsellItem(ctx, dishId, btnEl) {
      if (!ctx.areMenuOrdersEnabled()) return; // vitrina: sin agregados
      const dish = (ctx.getRestaurantData().dishes || []).find(d => d.id === dishId);
      if (!dish) return;

      ctx.addDishToCart(dish, '', []);
      ctx.updateCartUI();
      if (typeof ctx.renderDishes === 'function') ctx.renderDishes();
      ctx.renderCartModalList();

      // Feedback táctil instantáneo
      if (btnEl) {
        btnEl.classList.add('added');
        btnEl.innerHTML = '✓ Listo';
        btnEl.disabled = true;
        setTimeout(() => {
          btnEl.classList.remove('added');
          btnEl.innerHTML = '+ Agregar';
          btnEl.disabled = false;
        }, 2000);
      }
    }

    // =========================================================================
    // CROSS-SELLING: Recomendación cruzada liviana antes de enviar pedido
    // =========================================================================

    const CROSS_SELL_PATTERNS = {
      postre: /postre|helado|flan|brownie|torta|dulce|tiramisu|chocotorta|cheesecake|mousse|panna|cotta/i,
      bebida: /bebida|refresco|gaseosa|coca|cerveza|agua|jugo|limonada|vino|cerveza|energizante|agua mineral/i,
      entrada: /entrada|aperitivo|pat[eé]s|empanada|picada|wrap|nugget|aros/i,
      acompaniamiento: /papas|fritas|aros|guarnic|acompa[ñn]|ensalada|salad/i
    };

    function detectCrossSellOpportunity(cartItems, restaurant) {
      const cartText = cartItems.map(ci => {
        const cat = (restaurant.categories || []).find(c => c.id === ci.dish.categoryId);
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

    function renderCrossSellSection(ctx) {
      const section = document.getElementById('crossSellSection');
      if (!section) return;

      const items = Object.values(ctx.getCart());
      if (!items.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const opportunities = detectCrossSellOpportunity(items, restaurantData);
      if (!opportunities.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const cartDishIds = new Set(items.map(ci => ci.dish.id));
      const availableDishes = (restaurantData.dishes || []).filter(d =>
        !cartDishIds.has(d.id) && !isDishSoldOut(d) && (d.price || 0) > 0
      );

      if (!availableDishes.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const currency = ctx.getRestaurantData().currency || '$';
      let html = '';

      opportunities.slice(0, 2).forEach(opp => {
        const matches = availableDishes.filter(d => {
          const cat = (ctx.getRestaurantData().categories || []).find(c => c.id === d.categoryId);
          const text = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
          return CROSS_SELL_PATTERNS[opp.type] && CROSS_SELL_PATTERNS[opp.type].test(text);
        }).sort((a, b) => (a.price || 0) - (b.price || 0));

        if (!matches.length) return;

        const topPick = matches[0];
        const thumbHtml = topPick.photoUrl
          ? `<img src="${escapeHtml(topPick.photoUrl)}" alt="${escapeHtml(topPick.name)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy" decoding="async">`
          : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(236,201,75,0.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">${opp.type === 'postre' ? '🍰' : '🥤'}</div>`;

        html += `
          <div class="cross-sell-card" style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(236,201,75,0.06); border:1px solid rgba(236,201,75,0.25); border-radius:10px; margin-bottom:8px;">
            ${thumbHtml}
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.72rem; color:var(--chalk-gold); font-weight:700; text-transform:uppercase; margin-bottom:2px;">${opp.type === 'postre' ? '🍰 Sugerencia Dulce' : '🥤 Sugerencia para Acompañar'}</div>
              <div style="font-weight:600; font-size:0.88rem; color:var(--chalk-white); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(topPick.name)}</div>
              <div style="font-size:0.78rem; color:var(--chalk-dim);">${currency} ${ctx.formatMenuPrice(topPick.price)}</div>
            </div>
            <button type="button" class="btn-mozo-quick-add" data-dish-id="${escapeHtml(topPick.id)}" data-js-click="quickAddUpsellItem|${escapeHtml(topPick.id)}|this" aria-label="Agregar ${escapeHtml(topPick.name)} al carrito">+ Agregar</button>
          </div>
        `;
      });

      if (!html) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      section.innerHTML = `
        <div style="font-size:0.72rem; color:var(--chalk-gold); font-weight:700; text-transform:uppercase; margin-bottom:6px;">💡 ¿Algo más para completar tu pedido?</div>
        ${html}
      `;
      section.style.display = 'block';
    }
export {
  DEFAULT_UPSELL_KEYWORDS,
  CROSS_SELL_PATTERNS,
  analyzeCartContextForUpsell,
  getUpsellCandidates,
  renderUpsellSuggestions,
  quickAddUpsellItem,
  detectCrossSellOpportunity,
  renderCrossSellSection
};
