import { IceCreamWizard } from '/js/components/IceCreamWizard.js';
import { PerfumeryView } from '/js/components/PerfumeryView.js';
import { LoyaltyRewardsModal } from '/js/components/LoyaltyRewardsModal.js';
import { I18nCurrencyManager } from '/js/components/I18nCurrencyManager.js';
import { VirtualWaiter } from '/js/components/VirtualWaiter.js';
import { GroupCartManager } from '/js/components/GroupCartManager.js';
import * as smartReviews from '/js/menu/smartReviews.js';
import * as virtualWaiterHeuristics from '/js/menu/virtualWaiterHeuristics.js';
import * as orderCheckout from '/js/menu/orderCheckout.js';
import * as cartOperations from '/js/menu/cartOperations.js';
import * as menuModals from '/js/menu/menuModals.js';
import * as eventGuestMode from '/js/menu/eventGuestMode.js';
import * as menuBundle from '/js/menu/index.js';

// Expose classes and modules on window
window.IceCreamWizard = IceCreamWizard;
window.PerfumeryView = PerfumeryView;
window.LoyaltyRewardsModal = LoyaltyRewardsModal;
window.I18nCurrencyManager = I18nCurrencyManager;
window.VirtualWaiter = VirtualWaiter;
window.GroupCartManager = GroupCartManager;
window.smartReviewsModule = smartReviews;
window.virtualWaiterHeuristicsModule = virtualWaiterHeuristics;
window.orderCheckoutModule = orderCheckout;
window.cartOperationsModule = cartOperations;
window.menuModalsModule = menuModals;
window.eventGuestModeModule = eventGuestMode;
window.menuBundle = menuBundle;

    // Initialize i18n & Currency Manager
    window.i18nManager = new I18nCurrencyManager({
      defaultLang: 'es',
      defaultCurrency: '$UYU',
      onStateChange: () => {
        if (window.renderDishes) window.renderDishes();
        if (window.updateCartUI) window.updateCartUI();
        if (window.updateTotals) window.updateTotals();
        if (window.updateSplitCalculation) window.updateSplitCalculation();
      }
    });

    window.addEventListener('DOMContentLoaded', () => {
      window.i18nManager.renderControlsBar('i18nCurrencyBarContainer');
    });

    // Loyalty Rewards Modal Handler
    window.openLoyaltyModal = function() {
      const restName = window.restaurantData ? window.restaurantData.name : 'ScanGo';
      const phone = window.restaurantData ? window.restaurantData.phone : '';
      if (!window.activeLoyaltyModalInstance) {
        window.activeLoyaltyModalInstance = new LoyaltyRewardsModal({ restaurantName: restName, phone: phone });
      } else {
        window.activeLoyaltyModalInstance.restaurantName = restName;
        window.activeLoyaltyModalInstance.phone = phone;
      }
      window.activeLoyaltyModalInstance.open();
    };

    // Ice Cream Wizard Handler
    window.openIceCreamWizard = function() {
      const curr = window.i18nManager ? window.i18nManager.getCurrencySymbol() : (window.restaurantData ? window.restaurantData.currency : '$');
      
      // Chequear si el restaurante tiene sabores de heladería propios cargados
      let customFlavors = null;
      if (window.restaurantData && window.restaurantData.dishes) {
        const iceDishes = window.restaurantData.dishes.filter(d => {
          const cat = (window.restaurantData.categories || []).find(c => c.id === d.categoryId);
          const catName = cat ? cat.name.toLowerCase() : '';
          return catName.includes('helad') || d.name.toLowerCase().includes('helad') || d.name.toLowerCase().includes('sabor');
        });
        if (iceDishes.length > 0) {
          customFlavors = iceDishes.map(d => ({
            id: d.id,
            categoryId: d.categoryId,
            categoryName: 'Carta de la Casa',
            name: d.name,
            price: d.price,
            description: d.description || '',
            tags: d.tags || [],
            outOfStock: Boolean(d.outOfStock)
          }));
        }
      }

      window.iceCreamWizardInstance = new IceCreamWizard({
        currency: curr,
        customFlavors: customFlavors,
        onAddToCart: (customItem) => {
          if (!window.cart) window.cart = {};
          if (!window.cart[customItem.id]) {
            window.cart[customItem.id] = { dish: customItem, qty: 1 };
          } else {
            window.cart[customItem.id].qty += 1;
          }
          if (window.updateCartUI) window.updateCartUI();
          if (window.renderDishes) window.renderDishes();
          if (window.openCartModal) window.openCartModal();
        }
      });

      window.iceCreamWizardInstance.open();
    };

    // Perfumery Mode Toggle Handler
    let isPerfumeryActive = false;
    window.togglePerfumeryMode = function() {
      isPerfumeryActive = !isPerfumeryActive;
      const perfContainer = document.getElementById('perfumeryContainer');
      const dishesContainer = document.getElementById('dishesContainer');
      const btnToggle = document.getElementById('btnTogglePerfumeryMode');

      if (isPerfumeryActive) {
        perfContainer.style.display = 'block';
        dishesContainer.style.display = 'none';
        btnToggle.style.background = 'var(--chalk-gold)';
        btnToggle.style.color = '#101614';
        btnToggle.textContent = '🍽️ Volver a la Carta Gastronómica';

        const curr = window.i18nManager ? window.i18nManager.getCurrencySymbol() : (window.restaurantData ? window.restaurantData.currency : '$');
        if (!window.perfumeryViewInstance) {
          window.perfumeryViewInstance = new PerfumeryView({
            currency: curr,
            onAddToCart: (perfumeDish) => {
              if (!window.cart) window.cart = {};
              if (!window.cart[perfumeDish.id]) {
                window.cart[perfumeDish.id] = { dish: perfumeDish, qty: 1 };
              } else {
                window.cart[perfumeDish.id].qty += 1;
              }
              if (window.updateCartUI) window.updateCartUI();
              if (window.renderDishes) window.renderDishes();
              if (window.openCartModal) window.openCartModal();
            }
          });
        }
        window.perfumeryViewInstance.currency = curr;
        window.perfumeryViewInstance.renderToContainer('perfumeryContainer');
      } else {
        perfContainer.style.display = 'none';
        dishesContainer.style.display = 'block';
        btnToggle.style.background = 'transparent';
        btnToggle.style.color = '#B794F4';
        btnToggle.textContent = '✨ Colección Perfumería';
      }
    };

    // Pedido Grupal en Tiempo Real: Inicializador global y gestor de eventos
    // NOTA: puede invocarse desde dos call-sites (DOMContentLoaded en este
    // módulo y menu.js tras cargar el menú). Se comparte una promesa in-flight
    // para evitar que dos llamadas concurrentes construyan dos instancias.
    let groupCartInitPromise = null;
    window.initGroupCartManager = async function() {
      if (!window.GroupCartManager) return null;
      if (window.groupCartManagerInstance) {
        return window.groupCartManagerInstance;
      }
      if (groupCartInitPromise) {
        return groupCartInitPromise;
      }

      const urlParams = new URLSearchParams(window.location.search);
      const mesa = urlParams.get('mesa') || urlParams.get('table');
      const groupToken = new URLSearchParams(window.location.hash.slice(1)).get('groupToken');
      if (!mesa || !groupToken) return null;

      groupCartInitPromise = (async () => {
        // Slug determinístico desde la URL (/m/<slug> o ?slug=) — disponible
        // siempre, a diferencia de window.restaurantData que tarda en cargar.
        const pathSlug = (window.location.pathname.split('/').filter(Boolean).slice(-1)[0] || '');
        const urlSlug = urlParams.get('slug') || pathSlug;

        // Esperar a que el menú termine de cargar para obtener el ID real del
        // restaurante (hasta 8s). Crítico: el token HMAC del QR de mesa se firma
        // con ese ID, así que con 'default' el server responde 403
        // GROUP_CART_TOKEN_INVALID y el carrito nunca persiste ni se emite el
        // broadcast server→client. El slug de la URL es el fallback si el menú
        // viene de cache/offline antes de que el fetch termine.
        let restData = window.restaurantData || {};
        const waitStarted = Date.now();
        while (!restData?.id && Date.now() - waitStarted < 8000) {
          await new Promise(resolve => setTimeout(resolve, 250));
          restData = window.restaurantData || {};
        }

        const restSlug = restData?.slug || urlSlug;
        window.groupCartManagerInstance = new window.GroupCartManager({
          restaurantData: restData,
          restaurantSlug: restSlug,
          restaurantId: restData?.id || restSlug,
          tableNumber: mesa,
          groupToken,
          onCartUpdate: (updatedCart, meta) => {
            if (typeof window.syncCartFromGroupManager === 'function') {
              window.syncCartFromGroupManager(updatedCart, meta);
            }
          }
        });

        await window.groupCartManagerInstance.init();

        if (typeof window.syncCartFromGroupManager === 'function') {
          window.syncCartFromGroupManager(window.groupCartManagerInstance.cart, { trigger: 'init' });
        }

        return window.groupCartManagerInstance;
      })();

      try {
        return await groupCartInitPromise;
      } finally {
        groupCartInitPromise = null;
      }
    };

    // Alternar vista consolidada de la mesa
    window.toggleGroupConsolidatedView = function() {
      const container = document.getElementById('groupConsolidatedContainer');
      const btn = document.getElementById('btnToggleGroupConsolidated');
      if (!container || !window.groupCartManagerInstance) return;

      if (container.style.display === 'block') {
        container.style.display = 'none';
        if (btn) btn.innerHTML = '<span>👥 Ver Consolidado por Comensal y Cocina</span>';
        return;
      }

      const consolidated = window.groupCartManagerInstance.consolidateOrder();
      const curr = window.restaurantData?.currency || '$';

      let html = `<div style="font-weight:700; color:var(--chalk-gold); margin-bottom:8px; font-size:0.95rem;">👥 Resumen Mesa ${window.groupCartManagerInstance.tableNumber} (${consolidated.participantCount} comensales)</div>`;

      html += `<div style="margin-bottom:10px;"><strong style="font-size:0.8rem; color:#90CDF4; text-transform:uppercase;">Por Comensal:</strong>`;
      Object.entries(consolidated.byParticipant).forEach(([person, data]) => {
        html += `
          <div style="background:rgba(0,0,0,0.3); border-radius:6px; padding:6px 10px; margin-top:4px;">
            <div style="display:flex; justify-content:space-between; font-weight:700; font-size:0.84rem; color:#fff;">
              <span>👤 ${person}</span>
              <span style="color:var(--chalk-gold); font-family:var(--font-mono);">${curr} ${data.subtotal.toFixed(2)}</span>
            </div>
            <div style="font-size:0.75rem; color:var(--chalk-muted); margin-top:2px;">
              ${data.items.map(it => `${it.qty}x ${it.dish?.name}${it.note ? ` (${it.note})` : ''}`).join(' • ')}
            </div>
          </div>
        `;
      });
      html += `</div>`;

      html += `<div><strong style="font-size:0.8rem; color:#68D391; text-transform:uppercase;">🍳 Total para Cocina:</strong>`;
      html += `<div style="background:rgba(0,0,0,0.3); border-radius:6px; padding:6px 10px; margin-top:4px; font-size:0.8rem;">`;
      consolidated.kitchenConsolidated.forEach(k => {
        html += `<div>▪ <strong>${k.quantity}x</strong> ${k.name}${k.notes.length ? ` <em style="color:#ECC94B;">[${k.notes.join(' | ')}]</em>` : ''}</div>`;
      });
      html += `</div></div>`;

      container.innerHTML = html;
      container.style.display = 'block';
      if (btn) btn.innerHTML = '<span>🔼 Ocultar Consolidado de la Mesa</span>';
    };

    // Auto-inicializar si hay mesa en la URL al cargar el DOM
    window.addEventListener('DOMContentLoaded', () => {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('mesa') || urlParams.get('table')) {
        setTimeout(() => {
          if (window.initGroupCartManager) window.initGroupCartManager();
        }, 150);
      }
    });