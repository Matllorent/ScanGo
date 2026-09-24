import { IceCreamWizard } from '/js/components/IceCreamWizard.js';
    import { PerfumeryView } from '/js/components/PerfumeryView.js';
    import { LoyaltyRewardsModal } from '/js/components/LoyaltyRewardsModal.js';
    import { I18nCurrencyManager } from '/js/components/I18nCurrencyManager.js';

    // Expose classes on window
    window.IceCreamWizard = IceCreamWizard;
    window.PerfumeryView = PerfumeryView;
    window.LoyaltyRewardsModal = LoyaltyRewardsModal;
    window.I18nCurrencyManager = I18nCurrencyManager;

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