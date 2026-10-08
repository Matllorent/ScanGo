import { escapeHtml } from '/js/utils/escapeHtmlBrowser.js';
/**
 * VirtualWaiter.js — "El Mozo Virtual" con Recomendaciones de Clima y Maridaje Inteligente
 * Asistente heurístico en tiempo real para el carrito de compras de ScanGo.
 */

export class VirtualWaiter {
  /**
   * @param {Object} options
   * @param {Object} options.restaurantData - Datos del restaurante (dishes, categories, rules, etc.)
   * @param {string} [options.weatherContext] - 'muy_caluroso' | 'caluroso' | 'fresco' | 'muy_frio' | 'lluvioso'
   * @param {number} [options.weatherTemperatureC] - Temperatura en °C
   * @param {string} [options.currency] - Símbolo de moneda (ej: '$', '$U', 'USD')
   * @param {Function} [options.onAddToCart] - Callback al agregar un producto sugerido
   */
  constructor(options = {}) {
    this.restaurantData = options.restaurantData || {};
    this.weatherContext = options.weatherContext || this.restaurantData?.weatherContext || null;
    this.weatherTemperatureC = options.weatherTemperatureC ?? this.restaurantData?.weatherTemperatureC ?? null;
    this.currency = options.currency || this.restaurantData?.currency || '$';
    this.onAddToCart = typeof options.onAddToCart === 'function' ? options.onAddToCart : null;
    this.storageKey = 'scango_mozo_virtual_enabled';

    this.keywords = {
      burgers: ['hamburguesa', 'burger', 'sandwich', 'chivito', 'lomo', 'wrap', 'taco', 'burrito'],
      mains: ['plato', 'principal', 'milanesa', 'pasta', 'carne', 'pollo', 'pescado', 'asado', 'bife', 'pizza', 'combo'],
      sides: ['papa', 'papas', 'fritas', 'aros', 'guarnicion', 'guarnición', 'ensalada', 'nugget', 'bastones'],
      drinks: ['bebida', 'refresco', 'gaseosa', 'coca', 'cerveza', 'agua', 'jugo', 'limonada', 'vino', 'trago', 'pomelo', 'fernet'],
      coldDrinks: ['limonada', 'jugo', 'refresco', 'gaseosa', 'cerveza', 'agua', 'trago', 'helad', 'licuado', 'fria', 'fría', 'helada'],
      warmComfort: ['sopa', 'guiso', 'cafe', 'café', 'chocolate', 'te', 'té', 'caldo', 'cappuccino', 'latte', 'cazuela', 'fondue'],
      desserts: ['postre', 'helado', 'flan', 'brownie', 'torta', 'dulce', 'tiramisu', 'cheesecake', 'chocotorta', 'alfajor']
    };
  }

  /**
   * Actualiza el contexto climático dinámicamente
   */
  setWeatherContext(context, temp = null) {
    this.weatherContext = context;
    if (temp !== null) this.weatherTemperatureC = temp;
  }

  /**
   * Actualiza los datos del restaurante
   */
  setRestaurantData(restaurantData) {
    this.restaurantData = restaurantData || {};
    if (!this.weatherContext && restaurantData?.weatherContext) {
      this.weatherContext = restaurantData.weatherContext;
    }
    if (this.weatherTemperatureC === null && restaurantData?.weatherTemperatureC !== undefined) {
      this.weatherTemperatureC = restaurantData.weatherTemperatureC;
    }
    if (restaurantData?.currency) {
      this.currency = restaurantData.currency;
    }
  }

  /**
   * Verifica si El Mozo Virtual está activado por el usuario
   */
  isEnabled() {
    try {
      return localStorage.getItem(this.storageKey) !== 'false';
    } catch (e) {
      return true;
    }
  }

  /**
   * Activa o desactiva la preferencia
   */
  setEnabled(enabled) {
    try {
      localStorage.setItem(this.storageKey, enabled ? 'true' : 'false');
    } catch (e) {}
  }

  /**
   * Extrae los items como array normalizado
   */
  normalizeCart(cart) {
    if (!cart) return [];
    if (Array.isArray(cart)) return cart;
    if (typeof cart === 'object') return Object.values(cart);
    return [];
  }

  /**
   * Formatea precio
   */
  formatPrice(num) {
    const n = Number(num) || 0;
    return `${this.currency} ${n.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }

  /**
   * Analiza el carrito y el clima para generar sugerencias altamente situacionales
   * @param {Object|Array} cart - Items en el carrito
   * @returns {Object} { candidates, reason, badge, discount, situationalType }
   */
  analyze(cart) {
    const items = this.normalizeCart(cart);
    const dishes = this.restaurantData?.dishes || [];
    const categories = this.restaurantData?.categories || [];

    if (!items.length || !dishes.length) {
      return { candidates: [], reason: '', badge: '', discount: '' };
    }

    const inCartDishIds = new Set(items.map(item => item?.dish?.id || item?.dishId).filter(Boolean));
    const availableDishes = dishes.filter(d => !inCartDishIds.has(d.id) && !d.outOfStock && (d.price || 0) > 0);

    if (!availableDishes.length) {
      return { candidates: [], reason: '', badge: '', discount: '' };
    }

    // Texto acumulado del carrito para heurísticas de matching
    const cartTexts = items.map(item => {
      const dName = item?.dish?.name || '';
      const dDesc = item?.dish?.description || '';
      const cat = categories.find(c => c.id === item?.dish?.categoryId);
      const cName = cat ? cat.name : '';
      return `${dName} ${dDesc} ${cName}`.toLowerCase();
    }).join(' ');

    const hasBurger = this.keywords.burgers.some(kw => cartTexts.includes(kw));
    const hasMain = hasBurger || this.keywords.mains.some(kw => cartTexts.includes(kw));
    const hasSide = this.keywords.sides.some(kw => cartTexts.includes(kw));
    const hasDrink = this.keywords.drinks.some(kw => cartTexts.includes(kw));
    const hasDessert = this.keywords.desserts.some(kw => cartTexts.includes(kw));

    const cartSubtotal = items.reduce((sum, item) => {
      const price = item?.dish?.price || item?.unitPrice || 0;
      const qty = item?.qty || item?.quantity || 1;
      return sum + (price * qty);
    }, 0);

    // ==========================================
    // 1. REGLAS PERSONALIZADAS DE LA CASA (UPSELL RULES)
    // ==========================================
    const customRules = this.restaurantData.upsellRules || [];
    if (customRules.length) {
      for (const rule of customRules) {
        const triggered = (rule.triggerCategoryIds || []).some(catId =>
          items.some(ci => (ci.dish?.categoryId || ci.categoryId) === catId)
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
              badge: '⭐ Promoción de la casa',
              discount: rule.discountText || '',
              situationalType: 'custom_rule'
            };
          }
        }
      }
    }

    // ==========================================
    // 2. RECOMENDACIONES SITUACIONALES DE CLIMA (WEATHER CONTEXT)
    // ==========================================
    const weather = this.weatherContext || (this.restaurantData.smartWeatherEnabled ? this.restaurantData.weatherContext : null);
    const temp = this.weatherTemperatureC !== null ? Number(this.weatherTemperatureC) : null;
    const isHot = weather === 'muy_caluroso' || weather === 'caluroso' || (temp !== null && temp >= 26);
    const isCold = weather === 'muy_frio' || weather === 'fresco' || (temp !== null && temp <= 16);
    const isRainy = weather === 'lluvioso';

    // A) Día Caluroso: limonada helada, bebidas frías, helados, opciones refrescantes
    if (isHot) {
      // Prioridad 1: platos con weatherTags que coincidan con 'muy_caluroso' o 'caluroso'
      const weatherTagged = availableDishes.filter(d =>
        (d.weatherTags || []).includes('muy_caluroso') || (d.weatherTags || []).includes('caluroso')
      );

      // Prioridad 2: Bebidas heladas / limonadas / licuados / helados
      const coldOptions = availableDishes.filter(d => {
        const text = `${d.name} ${d.description || ''}`.toLowerCase();
        return this.keywords.coldDrinks.some(kw => text.includes(kw));
      });

      const hotCandidates = weatherTagged.length ? weatherTagged : coldOptions;
      if (hotCandidates.length) {
        // Encontrar si hay limonada o bebida fresca preferencial
        const lemonadeOrCold = hotCandidates.find(d => /limonada|jugo|helad/i.test(d.name)) || hotCandidates[0];
        const tempText = Number.isFinite(temp) ? ` (${Math.round(temp)}°C)` : '';

        return {
          candidates: [lemonadeOrCold, ...hotCandidates.filter(c => c.id !== lemonadeOrCold.id)].slice(0, 3),
          reason: `🔥 ¡Hace calor! ¿Querés agregar una ${lemonadeOrCold.name} bien helada para refrescar el momento?`,
          badge: '🔥 Clima Caluroso',
          discount: 'Ideal para el calor',
          situationalType: 'weather_hot'
        };
      }
    }

    // B) Día Frío: sopas, guisos, café de especialidad, chocolate caliente
    if (isCold) {
      const weatherTagged = availableDishes.filter(d =>
        (d.weatherTags || []).includes('muy_frio') || (d.weatherTags || []).includes('fresco')
      );
      const warmOptions = availableDishes.filter(d => {
        const text = `${d.name} ${d.description || ''}`.toLowerCase();
        return this.keywords.warmComfort.some(kw => text.includes(kw));
      });

      const coldCandidates = weatherTagged.length ? weatherTagged : warmOptions;
      if (coldCandidates.length) {
        const comfortDish = coldCandidates[0];
        const tempText = Number.isFinite(temp) ? ` (${Math.round(temp)}°C)` : '';

        return {
          candidates: coldCandidates.slice(0, 3),
          reason: `🥣 ¡Hoy está fresco${tempText}! ${comfortDish.name} es ideal para acompañar tu plato y entrar en calor.`,
          badge: '❄️ Especial Clima Frío',
          discount: 'Sugerencia del Mozo',
          situationalType: 'weather_cold'
        };
      }
    }

    // C) Día Lluvioso: platos reconfortantes
    if (isRainy) {
      const rainyTagged = availableDishes.filter(d => (d.weatherTags || []).includes('lluvioso'));
      if (rainyTagged.length) {
        return {
          candidates: rainyTagged.slice(0, 3),
          reason: `🌧️ ¡Día de lluvia ideal para disfrutar algo calentito y reconfortante!`,
          badge: '🌧️ Especial Día Lluvioso',
          discount: 'Recomendado',
          situationalType: 'weather_rainy'
        };
      }
    }

    // ==========================================
    // 3. HEURÍSTICAS DE MARIDAJE GASTRONÓMICO
    // ==========================================

    // Heurística 3.1: Hamburguesa o sándwich sin papas fritas
    if (hasBurger && !hasSide) {
      const sides = availableDishes.filter(d => {
        const t = `${d.name} ${d.description || ''}`.toLowerCase();
        return this.keywords.sides.some(kw => t.includes(kw));
      });
      if (sides.length) {
        sides.sort((a, b) => (a.price || 0) - (b.price || 0));
        return {
          candidates: sides.slice(0, 3),
          reason: '🍟 ¿Sale con papas? Las mejores hamburguesas siempre van con acompañamiento crocante. ¡Sumalo a tu pedido!',
          badge: '🍟 Acompañamiento ideal',
          discount: 'Combo recomendado',
          situationalType: 'pairing_burger_sides'
        };
      }
    }

    // Heurística 3.2: Plato principal sin bebida
    if (hasMain && !hasDrink) {
      const drinks = availableDishes.filter(d => {
        const cat = categories.find(c => c.id === d.categoryId);
        const t = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
        return this.keywords.drinks.some(kw => t.includes(kw));
      });
      if (drinks.length) {
        drinks.sort((a, b) => (a.price || 0) - (b.price || 0));
        return {
          candidates: drinks.slice(0, 3),
          reason: '🥤 ¡No te olvides de la bebida! Ideal para acompañar tu plato principal.',
          badge: '🥤 Maridaje perfecto',
          discount: 'Maridaje recomendado',
          situationalType: 'pairing_main_drink'
        };
      }
    }

    // Heurística 3.3: Ticket superior a 350 sin postre
    if (cartSubtotal >= 350 && !hasDessert) {
      const desserts = availableDishes.filter(d => {
        const cat = categories.find(c => c.id === d.categoryId);
        const t = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
        return this.keywords.desserts.some(kw => t.includes(kw));
      });
      if (desserts.length) {
        desserts.sort((a, b) => (a.price || 0) - (b.price || 0));
        return {
          candidates: desserts.slice(0, 3),
          reason: '🍨 Coroná tu experiencia con un postre artesanal para el toque dulce final.',
          badge: '🍨 Cierre dulce',
          discount: 'Toque dulce',
          situationalType: 'pairing_dessert'
        };
      }
    }

    // Fallback general: productos destacados o populares
    const complements = availableDishes.filter(d => {
      const t = `${d.name} ${d.description || ''}`.toLowerCase();
      return [...this.keywords.sides, ...this.keywords.drinks, ...this.keywords.desserts].some(kw => t.includes(kw));
    });
    complements.sort((a, b) => (a.price || 0) - (b.price || 0));
    const finalCandidates = complements.length ? complements : availableDishes;

    return {
      candidates: finalCandidates.slice(0, 3),
      reason: '✨ Recomendación del chef: Completá tu pedido con estos favoritos de la casa.',
      badge: '✨ Recomendación especial',
      discount: '',
      situationalType: 'fallback'
    };
  }

  /**
   * Renderiza el componente HTML del Mozo Virtual en el contenedor provisto
   * @param {HTMLElement|string} target - Elemento o selector ID
   * @param {Object|Array} cart - Carrito actual
   */
  render(target, cart) {
    const container = typeof target === 'string' ? document.getElementById(target) : target;
    if (!container) return;

    if (!this.isEnabled()) {
      container.style.display = 'none';
      return;
    }

    const analysis = this.analyze(cart);
    const { candidates, reason, badge, discount } = analysis;

    if (!candidates || !candidates.length) {
      container.style.display = 'none';
      return;
    }

    let cardsHtml = '';
    candidates.forEach(dish => {
      const thumbHtml = dish.photoUrl
        ? `<img class="mozo-item-thumb" src="${escapeHtml(dish.photoUrl)}" alt="${escapeHtml(dish.name)}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="mozo-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`;

      const discountTagHtml = discount
        ? `<span style="font-size:10px; background:rgba(239,68,68,0.2); color:#F87171; border:1px solid rgba(239,68,68,0.3); border-radius:4px; padding:1px 5px; font-weight:700; margin-left:4px;">${escapeHtml(discount)}</span>`
        : '';

      cardsHtml += `
        <div class="mozo-item-card" data-dish-id="${escapeHtml(dish.id)}">
          ${thumbHtml}
          <div class="mozo-item-info">
            <div class="mozo-item-title">${escapeHtml(dish.name)} ${discountTagHtml}</div>
            <div class="mozo-item-price">${this.formatPrice(dish.price)}</div>
          </div>
          <button type="button" class="btn-mozo-quick-add" data-dish-id="${escapeHtml(dish.id)}" aria-label="Agregar ${escapeHtml(dish.name)} al pedido">
            + Agregar
          </button>
        </div>
      `;
    });

    container.innerHTML = `
      <div class="mozo-header">
        <span class="mozo-icon">🤖</span>
        <span class="mozo-title">El Mozo Virtual sugiere</span>
        ${badge ? `<span class="mozo-badge" style="margin-left:auto;">${escapeHtml(badge)}</span>` : ''}
      </div>
      ${reason ? `<div class="mozo-reason-banner">${escapeHtml(reason)}</div>` : ''}
      <div class="mozo-suggestions-list">
        ${cardsHtml}
      </div>
    `;

    // Vincular listeners para los botones de agregar
    container.querySelectorAll('.btn-mozo-quick-add').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const dishId = e.currentTarget.dataset.dishId;
        const dish = candidates.find(d => d.id === dishId);
        if (dish && this.onAddToCart) {
          this.onAddToCart(dish, { situationalReason: reason, badge });
        }
      });
    });

    container.style.display = 'block';
  }

  
}

if (typeof window !== 'undefined') {
  window.VirtualWaiter = VirtualWaiter;
}
