import { escapeHtml } from '/js/utils/escapeHtmlBrowser.js';
import {
  openSmartReviewModal as openSmartReviewModalMod,
  closeSmartReviewModal as closeSmartReviewModalMod,
  handleStarSelect as handleStarSelectMod,
  handleGoogleReviewClick as handleGoogleReviewClickMod,
  submitPrivateFeedback as submitPrivateFeedbackMod,
  initStarHover as initStarHoverMod,
  isMozoVirtualEnabled as isMozoVirtualEnabledMod,
  handleMozoVirtualToggle as handleMozoVirtualToggleMod,
  analyzeCartContextForUpsell as analyzeCartContextForUpsellMod,
  getUpsellCandidates as getUpsellCandidatesMod,
  renderUpsellSuggestions as renderUpsellSuggestionsMod,
  quickAddUpsellItem as quickAddUpsellItemMod,
  detectCrossSellOpportunity as detectCrossSellOpportunityMod,
  renderCrossSellSection as renderCrossSellSectionMod,
  handleOrderPaymentChange as handleOrderPaymentChangeMod,
  openWifiModal as openWifiModalMod,
  closeWifiModal as closeWifiModalMod,
  copyWifiPassword as copyWifiPasswordMod,
  stopCategoryTTS as stopCategoryTTSMod,
  pauseCategoryTTS as pauseCategoryTTSMod,
  resumeCategoryTTS as resumeCategoryTTSMod,
  readSelectedCategoryTTS as readSelectedCategoryTTSMod,
  initPushPrompt as initPushPromptMod,
  requestPushPermission as requestPushPermissionMod,
  dismissPushPrompt as dismissPushPromptMod,
  openRestaurantInfoModal as openRestaurantInfoModalMod,
  closeRestaurantInfoModal as closeRestaurantInfoModalMod,
  shareRestaurantUrl as shareRestaurantUrlMod,
  resolveEventTheme,
  initGlobalModalDismiss as initGlobalModalDismissMod,
  openReservationModal as openReservationModalMod,
  closeReservationModal as closeReservationModalMod,
  submitReservation as submitReservationMod
} from './menu/index.js';

// State
let restaurantData = null;
let selectedCategory = 'ALL';
let cart = {}; // { dishId: { dish, qty } }
let pendingDishNoteAction = null;
let deliveryFee = 0;
let appliedCoupon = null; // { code: 'PROMO10', type: 'percent', value: 10 }
let discountAmount = 0;

// Puente window ↔ estado del módulo: menu-modules.js y componentes (wizards, GroupCartManager)
// leen/escriben window.restaurantData y window.cart, pero el estado real vive en este módulo.
// Sin este puente recibían undefined/{} y los canales Realtime caían al slug 'default'.
Object.defineProperties(window, {
  restaurantData: { get: () => restaurantData, configurable: true },
  cart: {
    get: () => cart,
    set: (value) => { cart = value; },
    configurable: true
  }
});

    // XSS Sanitizer Helper
    

    // Waiter Call & Analytics Tracking
    function openWaiterModal() {
      document.getElementById('waiterModal').classList.add('active');
    }
    function closeWaiterModal() {
      document.getElementById('waiterModal').classList.remove('active');
    }
    function sendWaiterCall(type) {
      if (!restaurantData || !restaurantData.phone) {
        alert('Este restaurante no tiene WhatsApp configurado.');
        return;
      }
      const mesa = document.getElementById('waiterTableNum').value.trim() || 'No especificada';
      let msg = '';
      if (type === 'mozo') {
        msg = `🔔 *LLAMADO AL MOZO*%0A📍 Mesa: ${mesa}%0A🕐 ${new Date().toLocaleTimeString()}%0A%0A_Enviado desde el menú digital ScanGo_`;
      } else if (type === 'cuenta_efectivo') {
        msg = `🧾 *CUENTA SOLICITADA*%0A📍 Mesa: ${mesa}%0A💵 Forma de pago: *Efectivo*%0A🕐 ${new Date().toLocaleTimeString()}%0A%0A_Enviado desde el menú digital ScanGo_`;
      } else if (type === 'cuenta_tarjeta') {
        msg = `🧾 *CUENTA SOLICITADA*%0A📍 Mesa: ${mesa}%0A💳 Forma de pago: *Tarjeta*%0A🕐 ${new Date().toLocaleTimeString()}%0A%0A_Enviado desde el menú digital ScanGo_`;
      }
      // Track analytics (fire-and-forget, canal unificado)
      trackPublicEvent('waiter');
      // Aviso push al dueño (fire-and-forget: si el push está apagado, no molesta)
      fetch('/api/notifications/waiter-alert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlug(), table: mesa, type })
      }).catch(() => {});
      window.open(`https://wa.me/${restaurantData.phone}?text=${msg}`, '_blank');
      closeWaiterModal();
    }

    // Detect slug
    function getSlug() {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('slug')) return urlParams.get('slug');
      const parts = window.location.pathname.split('/');
      const mIndex = parts.indexOf('m');
      if (mIndex !== -1 && parts[mIndex + 1]) {
        return parts[mIndex + 1];
      }
      return 'demo';
    }

    // Sucursal activa desde la URL (?branch= / ?sucursal=) para telemetría granular
    function getActiveBranchId() {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get('branch') || urlParams.get('sucursal') || '';
    }

    // Analítica unificada fire-and-forget: contadores legacy + telemetría rica
    // (dish_click / order_placed con amount) en el canal público.
    function trackPublicEvent(event, extra = {}) {
      const slug = getSlug();
      if (!slug) return;
      const body = {
        slug,
        event,
        branchId: getActiveBranchId() || undefined
      };
      Object.assign(body, extra || {});
      fetch('/api/public/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }).catch(() => {});
    }

    // Offline resilience banner
    function showOfflineBanner(isOffline, customMsg) {
      let banner = document.getElementById('offlineNoticeBanner');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offlineNoticeBanner';
        banner.style.cssText = 'position:fixed; bottom:16px; left:50%; transform:translateX(-50%); z-index:9999; background:rgba(229,62,62,0.92); color:#fff; font-size:12px; font-weight:600; padding:8px 16px; border-radius:20px; box-shadow:0 4px 12px rgba(0,0,0,0.4); display:flex; align-items:center; gap:8px; backdrop-filter:blur(4px); transition:opacity .3s ease;';
        document.body.appendChild(banner);
      }
      if (isOffline) {
        banner.innerHTML = `<span>⚠️</span> <span>${escapeHtml(customMsg || 'Sin conexión a internet. Mostrando carta guardada.')}</span>`;
        banner.style.display = 'flex';
        banner.style.opacity = '1';
      } else {
        banner.style.background = 'rgba(56,161,105,0.92)';
        banner.innerHTML = '<span>✓</span> <span>Conexión restablecida</span>';
        setTimeout(() => {
          if (banner) banner.style.display = 'none';
        }, 2500);
      }
    }

    window.addEventListener('offline', () => showOfflineBanner(true));
    window.addEventListener('online', () => showOfflineBanner(false));

    // Fetch Restaurant Menu with Client-Side Timeout & Branch-Aware Caching
    async function loadMenu() {
      const slug = getSlug();
      const urlParams = new URLSearchParams(window.location.search);
      const branch = urlParams.get('branch') || urlParams.get('sucursal') || '';
      const cacheKey = 'scango_cached_menu_' + slug + (branch ? '_' + branch : '');

      // Check local storage for interactive demo mode
      if (slug === 'demo') {
        try {
          const localDemo = localStorage.getItem('scango_demo_restaurant');
          if (localDemo) {
            restaurantData = JSON.parse(localDemo);
            renderHeader();
            renderCategories();
            renderDishes();
          }
        } catch (e) {}
      }

      // Timeout AbortController to prevent freezing on extreme server latency during peak service (3.5s limit)
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutId = controller ? setTimeout(() => controller.abort(), 3500) : null;

      try {
        const fetchUrl = `/api/menu/${slug}${window.location.search}`;
        const res = await fetch(fetchUrl, { signal: controller ? controller.signal : undefined });
        if (timeoutId) clearTimeout(timeoutId);

        if (!res.ok) {
          if (restaurantData) return;
          if (res.status === 402) {
            renderUnavailable('El menú se encuentra temporalmente en actualización. Por favor consulta al mozo o en la barra.');
            return;
          }
          renderUnavailable('Restaurante no encontrado.');
          return;
        }
        const data = await res.json();
        restaurantData = data.restaurant;
        try {
          localStorage.setItem(cacheKey, JSON.stringify(data.restaurant));
          localStorage.setItem('scango_cached_menu_' + slug, JSON.stringify(data.restaurant));
        } catch (e) {}
        renderHeader();
        renderCategories();
        renderDishes();
        // Track visit analytics
        fetch('/api/public/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, event: 'visit' })
        }).catch(() => {});
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (!restaurantData) {
          try {
            const cached = localStorage.getItem(cacheKey) || localStorage.getItem('scango_cached_menu_' + slug) || (slug === 'demo' ? localStorage.getItem('scango_demo_restaurant') : null);
            if (cached) {
              restaurantData = JSON.parse(cached);
              renderHeader();
              renderCategories();
              renderDishes();
              showOfflineBanner(true, 'Modo sin conexión: mostrando carta guardada');
              return;
            }
          } catch (e) {}
          renderUnavailable('No se pudo conectar con el servidor.');
        }
      }
    }

    // Live sync via postMessage from Studio Editor (real-time preview)
    window.addEventListener('message', (event) => {
      if (event.data && (event.data.type === 'UPDATE_LIVE_PREVIEW' || event.data.type === 'UPDATE_RESTAURANT')) {
        const updated = event.data.data || event.data.restaurant;
        if (!updated) return;
        // Merge or replace restaurantData
        restaurantData = Object.assign({}, restaurantData || {}, updated);
        renderHeader();
        renderCategories();
        renderDishes();
      }
    });

    function renderUnavailable(msg) {
      document.getElementById('restaurantName').textContent = 'Menú no disponible';
      document.getElementById('dishesContainer').innerHTML = `
        <div style="text-align:center; padding:50px 20px; background:#1C2723; border:1px solid rgba(255,255,255,0.1); border-radius:12px;">
          <p style="color:#ECC94B; font-size:1.1rem; margin-bottom:10px;">📋 Aviso del establecimiento</p>
          <p style="color:#CBD5E0;">${msg}</p>
        </div>
      `;
    }

    function renderHeader() {
      document.title = `${restaurantData.name} — Menú Digital`;
      document.getElementById('restaurantName').textContent = restaurantData.name;
      document.getElementById('restaurantSlogan').textContent = restaurantData.slogan || 'Carta Gastronómica';

      // Apply Layout Morphology & 14 Authentic Classic Themes & Fonts to body
      const validLayouts = ['classic', 'bento', 'minimalist', 'neon'];
      const morphParam = new URLSearchParams(window.location.search).get('morph');
      let layout = restaurantData.layout;
      if (morphParam && validLayouts.includes(morphParam)) {
        layout = morphParam;
      }
      const layoutClass = validLayouts.includes(layout) ? `layout-${layout}` : 'layout-classic';
      const validThemes = ['classic', 'emerald', 'rustic', 'taqueria', 'bar', 'moderna', 'foodtruck', 'gamer', 'otaku', 'explosivo', 'infantil', 'alegre', 'basketball', 'football'];
      const themeClass = validThemes.includes(restaurantData.theme) ? `theme-${restaurantData.theme}` : 'theme-emerald';
      document.body.className = `${themeClass} font-${restaurantData.themeFont || 'serif'} ${layoutClass}`;

      // === EVENT VISUAL THEMES: Aplicar tema visual cuando businessType='events' o ?event= parámetro
      const eventThemeClass = resolveEventTheme(restaurantData, window.location.search);
      if (eventThemeClass) {
        document.body.classList.add(eventThemeClass);
      }

      // Render the hero image and temporarily move the existing brand/status nodes into it.
      const bannerEl = document.getElementById('menuBannerHero');
      const logoContainer = document.getElementById('restaurantLogoContainer');
      const heroStatusBadge = document.getElementById('statusOpenClosedBadge');
      const statusRow = document.querySelector('.status-pill-row');
      const restaurantTitle = document.getElementById('restaurantName');
      const restoreHeaderBranding = () => {
        if (logoContainer && restaurantTitle) restaurantTitle.parentNode.insertBefore(logoContainer, restaurantTitle);
        if (heroStatusBadge && statusRow) statusRow.insertBefore(heroStatusBadge, statusRow.firstChild);
      };
      if (bannerEl) {
        if (restaurantData.bannerUrl) {
          const bannerSrc = escapeHtml(restaurantData.bannerUrl);
          bannerEl.style.display = 'block';
          bannerEl.innerHTML = `
            <div class="menu-banner-media">
              <img src="${bannerSrc}" alt="Portada de ${escapeHtml(restaurantData.name)}" class="menu-banner-img" loading="eager">
              <div class="menu-banner-overlay" aria-hidden="true"></div>
            </div>
            <div class="menu-banner-status-slot"></div>
            <div class="menu-banner-logo-slot"></div>
          `;
          bannerEl.querySelector('.menu-banner-logo-slot').append(logoContainer);
          bannerEl.querySelector('.menu-banner-status-slot').append(heroStatusBadge);
          document.body.classList.add('has-hero-banner');
          bannerEl.querySelector('.menu-banner-img').addEventListener('error', () => {
            bannerEl.style.display = 'none';
            document.body.classList.remove('has-hero-banner');
            restoreHeaderBranding();
          }, { once: true });
        } else {
          bannerEl.style.display = 'none';
          bannerEl.innerHTML = '';
          document.body.classList.remove('has-hero-banner');
          restoreHeaderBranding();
        }
      }

      if (restaurantData.logoUrl) {
        logoContainer.innerHTML = `
          <img src="${restaurantData.logoUrl}" alt="Logo" class="restaurant-logo">
        `;
      } else {
        logoContainer.innerHTML = '';
      }

      // Show or Hide Reservation Chip strictly
      const resChip = document.getElementById('reservationChip');
      if (resChip) {
        resChip.style.display = (restaurantData.allowReservations !== false) ? 'inline-flex' : 'none';
      }

      // Wi-Fi Chip
      if (restaurantData.wifi && restaurantData.wifi.ssid) {
        const wifiChip = document.getElementById('wifiChip');
        wifiChip.style.display = 'inline-flex';
        document.getElementById('wifiSsidDisplay').textContent = restaurantData.wifi.ssid;
        document.getElementById('wifiPassDisplay').textContent = restaurantData.wifi.password || '(Sin clave)';
      }

      // Instagram Link Chip
      const instaChip = document.getElementById('instagramChip');
      if (instaChip) {
        if (restaurantData.instagram) {
          instaChip.style.display = 'inline-flex';
          instaChip.href = `https://instagram.com/${restaurantData.instagram.replace('@', '')}`;
          document.getElementById('instagramText').textContent = `@${restaurantData.instagram.replace('@', '')}`;
        } else {
          instaChip.style.display = 'none';
        }
      }

      // Google Reviews / Smart Feedback Chip (shows if googleReview URL is configured)
      const gReviewChip = document.getElementById('googleReviewChip');
      if (gReviewChip) {
        gReviewChip.style.display = restaurantData.googleReview ? 'inline-flex' : 'none';
      }

      // Coupon Box Visibility Control
      const couponBox = document.getElementById('couponSectionBox');
      if (couponBox) {
        couponBox.style.display = (restaurantData.allowCoupons !== false) ? 'block' : 'none';
      }

      // Phone & Address
      if (restaurantData.phone) {
        const pChip = document.getElementById('phoneChip');
        pChip.style.display = 'inline-flex';
        document.getElementById('phoneText').textContent = restaurantData.phone;
      }

      // Announcement Banner
      const banner = document.getElementById('announcementBanner');
      const bannerText = document.getElementById('announcementBannerText');
      if (banner && bannerText) {
        if (restaurantData.announcement && restaurantData.announcement.trim()) {
          banner.style.display = 'flex';
          bannerText.textContent = `📢 ${restaurantData.announcement.trim()}`;
        } else {
          banner.style.display = 'none';
        }
      }

      // External Payment Link Setup
      const payBox = document.getElementById('externalPaymentBox');
      const btnPay = document.getElementById('btnExternalPay');
      if (payBox && btnPay) {
        if (restaurantData.paymentLink && restaurantData.paymentLink.trim()) {
          payBox.style.display = 'block';
          btnPay.href = restaurantData.paymentLink.trim();
        } else {
          payBox.style.display = 'none';
        }
      }

      // Bill Splitter Feature Check
      const billSplitterSection = document.getElementById('billSplitterSection');
      if (billSplitterSection) {
        billSplitterSection.style.display = (restaurantData.allowBillSplitter !== false) ? 'block' : 'none';
      }

      // Open / Closed Real-time Status Badge
      const statusBadge = document.getElementById('statusOpenClosedBadge');
      if (statusBadge) {
        if (restaurantData.scheduleEnabled && restaurantData.scheduleActiveHours) {
          const now = new Date();
          const currentHour = now.getHours() + (now.getMinutes() / 60);
          const [startH, endH] = (restaurantData.scheduleActiveHours || '00:00-23:59').split('-').map(t => {
            const [h, m] = t.split(':').map(Number);
            return h + (m || 0) / 60;
          });
          const isOpen = (startH === undefined || endH === undefined) || (currentHour >= startH && currentHour <= endH);
          statusBadge.style.display = 'inline-flex';
          if (isOpen) {
            statusBadge.style.background = 'rgba(72,187,120,0.15)';
            statusBadge.style.borderColor = 'rgba(72,187,120,0.4)';
            statusBadge.style.color = '#48BB78';
            statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#48BB78; margin-right:6px; box-shadow:0 0 6px #48BB78;"></span> Abierto (${restaurantData.scheduleActiveHours} hs)`;
          } else {
            statusBadge.style.display = 'inline-flex';
            statusBadge.style.background = 'rgba(229,62,62,0.15)';
            statusBadge.style.borderColor = 'rgba(229,62,62,0.4)';
            statusBadge.style.color = '#FC8181';
            statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#E53E3E; margin-right:6px;"></span> Cerrado (${restaurantData.scheduleActiveHours} hs)`;
          }
        } else {
          statusBadge.style.display = 'inline-flex';
          statusBadge.style.background = 'rgba(72,187,120,0.15)';
          statusBadge.style.borderColor = 'rgba(72,187,120,0.4)';
          statusBadge.style.color = '#48BB78';
          statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#48BB78; margin-right:6px; box-shadow:0 0 6px #48BB78;"></span> Abierto para pedidos`;
        }
      }

      // Auto-detect Mesa / Table Query Param (?mesa=N or ?table=N) & Control Table Service Buttons
      const urlParams = new URLSearchParams(window.location.search);
      const mesaParam = urlParams.get('mesa') || urlParams.get('table');
      const hasTable = Boolean(mesaParam);
      
      const waiterBtn = document.querySelector('.waiter-fab');
      if (waiterBtn) {
        waiterBtn.style.display = hasTable ? 'flex' : 'none';
      }

      if (mesaParam) {
        const orderTable = document.getElementById('orderTable');
        const waiterTableNum = document.getElementById('waiterTableNum');
        if (orderTable && !orderTable.value) orderTable.value = `Mesa ${mesaParam}`;
        if (waiterTableNum && !waiterTableNum.value) waiterTableNum.value = `Mesa ${mesaParam}`;

        // Auto-conectar dispositivos de la mesa al Pedido Grupal en Tiempo Real
        if (typeof window.initGroupCartManager === 'function') {
          window.initGroupCartManager();
        }
      }

      // Loyalty Points Chip Visibility Control
      const loyaltyChip = document.getElementById('loyaltyChip');
      if (loyaltyChip) {
        loyaltyChip.style.display = (restaurantData.allowLoyaltyPoints === true) ? 'inline-flex' : 'none';
      }

      // Vertical / Special Features Visibility Control (Heladería & Perfumería)
      // Strictly modular by businessType: restaurants and events do not have ice cream or perfumery enabled
      const isHeladeria = restaurantData.businessType === 'heladeria' && restaurantData.allowIceCreamWizard !== false;
      const isPerfumeria = ['perfumery', 'perfumeria'].includes(restaurantData.businessType) && restaurantData.allowPerfumery !== false;

      const btnIceCream = document.getElementById('btnOpenIceCreamWizard');
      if (btnIceCream) {
        btnIceCream.style.display = isHeladeria ? 'inline-flex' : 'none';
      }

      const btnPerf = document.getElementById('btnTogglePerfumeryMode');
      if (btnPerf) {
        btnPerf.style.display = isPerfumeria ? 'inline-flex' : 'none';
      }

      const specialBar = document.getElementById('specialActionsBar');
      if (specialBar) {
        specialBar.style.display = (isHeladeria || isPerfumeria) ? 'flex' : 'none';
      }

      if (restaurantData.address) {
        const aChip = document.getElementById('addressChip');
        aChip.style.display = 'inline-flex';
        document.getElementById('addressText').textContent = restaurantData.address;
      }

      // === NEW: Loyalty Top Banner Visibility ===
      const loyaltyBanner = document.getElementById('loyaltyTopBanner');
      if (loyaltyBanner) {
        loyaltyBanner.style.display = (restaurantData.allowLoyaltyPoints === true) ? 'flex' : 'none';
      }

      // === NEW: Header Social Links ===
      const hdrWa = document.getElementById('hdrSocialWa');
      const hdrIg = document.getElementById('hdrSocialIg');
      const hdrFb = document.getElementById('hdrSocialFb');
      const hdrTk = document.getElementById('hdrSocialTk');

      if (hdrWa) {
        if (restaurantData.phone) {
          hdrWa.style.display = 'inline-flex';
        } else {
          hdrWa.style.display = 'none';
        }
      }
      if (hdrIg) {
        if (restaurantData.instagram) {
          hdrIg.href = `https://instagram.com/${restaurantData.instagram.replace('@', '')}`;
          hdrIg.style.display = 'inline-flex';
        } else {
          hdrIg.style.display = 'none';
        }
      }
      if (hdrFb) {
        if (restaurantData.facebook) {
          hdrFb.href = restaurantData.facebook;
          hdrFb.style.display = 'inline-flex';
        } else {
          hdrFb.style.display = 'none';
        }
      }
      if (hdrTk) {
        if (restaurantData.tiktok) {
          hdrTk.href = restaurantData.tiktok;
          hdrTk.style.display = 'inline-flex';
        } else {
          hdrTk.style.display = 'none';
        }
      }

      // === NEW: Delivery time chip ===
      const dtText = document.getElementById('deliveryTimeText');
      if (dtText) {
        dtText.textContent = restaurantData.deliveryTime || '30 - 45min.';
      }
      const dtChip = document.getElementById('deliveryTimeChip');
      if (dtChip) {
        dtChip.style.display = restaurantData.deliveryTime ? 'inline-flex' : 'none';
      }

      // === NEW: Minimum Order Chip ===
      const moChip = document.getElementById('minOrderChip');
      const moText = document.getElementById('minOrderText');
      if (moChip && moText) {
        if (restaurantData.minOrder && restaurantData.minOrder > 0) {
          moChip.style.display = 'inline-flex';
          moText.textContent = `$U ${restaurantData.minOrder}`;
        } else {
          moChip.style.display = 'none';
        }
      }
    }

    function getActiveWeatherContext() {
      const context = restaurantData?.weatherContext;
      return restaurantData?.smartWeatherEnabled === true &&
        ['muy_frio', 'frio', 'templado', 'caluroso', 'muy_caluroso'].includes(context)
        ? context
        : null;
    }

    function sortWeatherDishes(dishes) {
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

    function sortWeatherCategories(categories, dishes) {
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

    function renderCategories() {
      const pillsContainer = document.getElementById('categoryPills');
      const cats = sortWeatherCategories(restaurantData.categories || [], restaurantData.dishes || []);
      const hasFeatured = (restaurantData.dishes || []).some(d => d.tags && d.tags.includes('star'));

      let html = `<button class="cat-pill ${selectedCategory === 'ALL' ? 'active' : ''}" onclick="selectCategory('ALL')">Todos</button>`;
      if (hasFeatured) {
        html += `<button class="cat-pill ${selectedCategory === 'POPULAR' ? 'active' : ''}" onclick="selectCategory('POPULAR')" style="color:var(--chalk-gold); border-color:rgba(236,201,75,0.4);">⭐ Populares</button>`;
      }

      cats.forEach(c => {
        html += `<button class="cat-pill ${selectedCategory === c.id ? 'active' : ''}" data-cat-id="${escapeHtml(c.id)}" onclick="selectCategory(this.dataset.catId)">${escapeHtml(c.name)}</button>`;
      });
      pillsContainer.innerHTML = html;
    }

    function selectCategory(catId) {
      selectedCategory = catId;
      document.querySelectorAll('.cat-pill').forEach(btn => {
        const isSelected = (catId === 'ALL' && btn.textContent.trim() === 'Todos') ||
                           (catId === 'POPULAR' && btn.textContent.trim().includes('Populares')) ||
                           (restaurantData.categories && (restaurantData.categories.find(c => c.id === catId) || {}).name === btn.textContent.trim());
        btn.classList.toggle('active', isSelected);
      });
      renderDishes();
    }

    let selectedDietFilter = 'ALL';

    const DIET_FILTER_MAP = {
      veggie: ['veggie', 'vegetariano'],
      vegan: ['vegan', 'vegano'],
      celiac: ['celiac', 'singluten'],
      sinlactosa: ['sinlactosa'],
      picante: ['picante']
    };

    function getAvailableDietFilters() {
      const dishes = restaurantData.dishes || [];
      const available = new Set(['ALL']);
      Object.entries(DIET_FILTER_MAP).forEach(([key, tags]) => {
        const hasMatch = dishes.some(d => !d.outOfStock && d.tags && d.tags.some(t => tags.includes(t)));
        if (hasMatch) available.add(key);
      });
      return available;
    }

    function renderDietaryFilters() {
      const container = document.getElementById('dietaryFilterPills');
      if (!container) return;
      const available = getAvailableDietFilters();
      container.querySelectorAll('.cat-pill').forEach(btn => {
        const isAll = btn.textContent.includes('Todos');
        const isVeggie = btn.textContent.includes('Vegetariano');
        const isVegan = btn.textContent.includes('Vegano');
        const isCeliac = btn.textContent.includes('Sin TACC');
        const isSinLactosa = btn.textContent.includes('Sin Lactosa');
        const isPicante = btn.textContent.includes('Picante');

        let key = null;
        if (isAll) key = 'ALL';
        else if (isVeggie) key = 'veggie';
        else if (isVegan) key = 'vegan';
        else if (isCeliac) key = 'celiac';
        else if (isSinLactosa) key = 'sinlactosa';
        else if (isPicante) key = 'picante';

        if (key && !available.has(key)) {
          btn.style.display = 'none';
        } else {
          btn.style.display = '';
        }
      });
    }

    function selectDietFilter(diet) {
      const available = getAvailableDietFilters();
      if (!available.has(diet)) {
        selectedDietFilter = 'ALL';
      } else {
        selectedDietFilter = diet;
      }
      document.querySelectorAll('#dietaryFilterPills .cat-pill').forEach(btn => {
        const isSel = (selectedDietFilter === 'ALL' && btn.textContent.includes('Todos')) ||
                      (selectedDietFilter === 'veggie' && btn.textContent.includes('Vegetariano')) ||
                      (selectedDietFilter === 'vegan' && btn.textContent.includes('Vegano')) ||
                      (selectedDietFilter === 'celiac' && btn.textContent.includes('Sin TACC')) ||
                      (selectedDietFilter === 'sinlactosa' && btn.textContent.includes('Sin Lactosa')) ||
                      (selectedDietFilter === 'picante' && btn.textContent.includes('Picante'));
        btn.classList.toggle('active', isSel);
      });
      renderDishes();
    }

    function clearSearchFilter() {
      const input = document.getElementById('searchFilter');
      if (input) input.value = '';
      const btnClear = document.getElementById('btnClearSearch');
      if (btnClear) btnClear.style.display = 'none';
      renderDishes();
    }

    // Smart Dish Scheduling Helper (with Happy Hours price overrides)
    function getDishScheduleStatus(d) {
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

    function renderChefSpecials() {
      const section = document.getElementById('chefSpecialsSection');
      const carousel = document.getElementById('chefSpecialsCarousel');
      if (!section || !carousel) return;

      const dishes = restaurantData.dishes || [];
      const chefDishes = dishes.filter(d => {
        if (d.outOfStock) return false;
        if (!d.isChefSpecial && (!d.tags || !d.tags.includes('chef_special'))) return false;
        const sched = getDishScheduleStatus(d);
        return sched.shouldDisplay;
      });

      if (!chefDishes.length) {
        section.style.display = 'none';
        carousel.innerHTML = '';
        return;
      }

      const currency = restaurantData.currency || '$';
      let html = '';
      chefDishes.forEach(d => {
        const inCart = getDishCartQuantity(d.id);
        const sched = getDishScheduleStatus(d);
        const effectivePrice = sched.effectivePrice !== undefined ? sched.effectivePrice : d.price;
        const formattedPrice = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(effectivePrice) 
          : `${currency} ${effectivePrice}`;
        
        // For Happy Hours: show original price as strikethrough
        let originalPriceHtml = '';
        if (sched.isHappyHour && sched.originalPrice !== null && sched.originalPrice !== undefined && Number(sched.originalPrice) > Number(effectivePrice)) {
          const formattedOrig = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(sched.originalPrice) 
            : `${currency} ${sched.originalPrice}`;
          originalPriceHtml = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.8em; margin-right:4px; color:var(--chalk-dim); font-weight:normal;">${formattedOrig}</span>`;
        } else {
          // Fallback to dish-level originalPrice
          const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
          if (origPrice && Number(origPrice) > Number(effectivePrice)) {
            const formattedOrig = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
              ? window.i18nManager.formatPrice(origPrice) 
              : `${currency} ${origPrice}`;
            originalPriceHtml = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.8em; margin-right:4px; color:var(--chalk-dim); font-weight:normal;">${formattedOrig}</span>`;
          }
        }

        const photoHtml = d.photoUrl 
          ? `<img src="${d.photoUrl}" alt="${escapeHtml(d.name)}" class="chef-special-thumb" loading="lazy">` 
          : `<div style="height:90px; display:flex; align-items:center; justify-content:center; font-size:2.4rem; background:rgba(236,201,75,0.06); border-radius:8px; margin-bottom:8px;">👨‍🍳</div>`;

        html += `
          <div class="chef-special-card" style="${!sched.isAvailable ? 'opacity:0.6;' : ''}">
            <span class="chef-special-tag-ribbon">👨‍🍳 ${sched.isAvailable ? 'Recomendación' : sched.reason}</span>
            ${photoHtml}
            <div>
              <div class="chef-special-name">${escapeHtml(d.name)}</div>
              ${d.description ? `<p class="chef-special-desc">${escapeHtml(d.description)}</p>` : ''}
            </div>
            <div class="chef-special-footer">
              <div class="chef-special-price">
                ${originalPriceHtml}${formattedPrice}
              </div>
              ${sched.isAvailable 
                ? `<button class="btn-add" data-dish-id="${escapeHtml(d.id)}" onclick="addToCart(this.dataset.dishId)" aria-label="Agregar ${escapeHtml(d.name)}" style="width:34px; height:34px; font-size:1.1rem;">+</button>`
                : `<button class="btn-add" disabled style="width:34px; height:34px; font-size:0.9rem; background:#4A5568; cursor:not-allowed; opacity:0.6;" title="${sched.reason}">⏰</button>`
              }
            </div>
            ${inCart > 0 ? `<div style="font-size:0.7rem; color:var(--chalk-gold); font-weight:700; margin-top:4px; text-align:right;">${inCart} en carrito</div>` : ''}
          </div>
        `;
      });

      carousel.innerHTML = html;
      section.style.display = 'block';
    }

    function renderDishes() {
      // Render top carousel for Chef's Specials & Menú del Día
      renderChefSpecials();

      // Hide dietary filters that have no matching dishes
      renderDietaryFilters();

      const container = document.getElementById('dishesContainer');
      const searchInput = document.getElementById('searchFilter');
      const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
      const btnClear = document.getElementById('btnClearSearch');
      if (btnClear) {
        btnClear.style.display = searchTerm.length > 0 ? 'block' : 'none';
      }

      const currency = restaurantData.currency || '$';
      const categories = sortWeatherCategories(restaurantData.categories || [], restaurantData.dishes || []);
      const dishes = restaurantData.dishes || [];

      if (!dishes.length) {
        container.innerHTML = `
          <div class="empty-state-card">
            <span class="empty-state-icon">📋</span>
            <div class="empty-state-title">Aún no hay platos en la carta</div>
            <div class="empty-state-desc">El establecimiento está preparando las opciones del menú. Por favor vuelve a consultar en unos instantes.</div>
          </div>
        `;
        return;
      }

      // Check for scheduled menu restriction
      if (restaurantData.scheduleEnabled && restaurantData.scheduleActiveHours) {
        const now = new Date();
        const currentHour = now.getHours() + (now.getMinutes() / 60);
        const [startH, endH] = (restaurantData.scheduleActiveHours || '00:00-23:59').split('-').map(t => {
          const [h, m] = t.split(':').map(Number);
          return h + (m || 0) / 60;
        });
        if (startH !== undefined && endH !== undefined && (currentHour < startH || currentHour > endH)) {
          container.innerHTML = `
            <div style="text-align:center; padding:40px 20px; background:rgba(236,201,75,0.06); border:1px dashed var(--border-gold); border-radius:12px;">
              <p style="font-size:1.2rem; color:var(--chalk-gold); font-family:var(--font-heading); margin-bottom:8px;">Carta Fuera de Horario</p>
              <p style="color:var(--chalk-dim); font-size:0.9rem;">Esta carta está disponible de ${restaurantData.scheduleActiveHours} hs. Por favor consulta con el personal.</p>
            </div>
          `;
          return;
        }
      }

      // Dietary filter predicate
      const matchesDiet = (d) => {
        if (selectedDietFilter === 'ALL') return true;
        if (!d.tags) return false;
        if (selectedDietFilter === 'veggie') return d.tags.includes('veggie') || d.tags.includes('vegetariano');
        if (selectedDietFilter === 'vegan') return d.tags.includes('vegan') || d.tags.includes('vegano');
        if (selectedDietFilter === 'celiac') return d.tags.includes('celiac') || d.tags.includes('singluten');
        if (selectedDietFilter === 'sinlactosa') return d.tags.includes('sinlactosa');
        if (selectedDietFilter === 'picante') return d.tags.includes('picante');
        return true;
      };

      let html = '';

      // Special Mode: Popular / Featured Dishes
      if (selectedCategory === 'POPULAR') {
        const popularDishes = sortWeatherDishes(dishes.filter(d => {
          const isStar = d.tags && d.tags.includes('star');
          const matchesSearch = !searchTerm || d.name.toLowerCase().includes(searchTerm) || (d.description && d.description.toLowerCase().includes(searchTerm));
          const sched = getDishScheduleStatus(d);
          return isStar && matchesSearch && matchesDiet(d) && sched.shouldDisplay;
        }));

        if (!popularDishes.length) {
          container.innerHTML = '<div class="loading-spinner">No se encontraron platos destacados.</div>';
          return;
        }

        html += `
          <div class="category-section">
            <div class="category-title">
              <span>⭐ Favoritos & Especialidades de la Casa</span>
              <span class="category-badge-count">${popularDishes.length} platos</span>
            </div>
            <div class="dishes-grid">
        `;
        popularDishes.forEach(d => { html += renderSingleDishCard(d, currency); });
        html += `</div></div>`;
        container.innerHTML = html;
        return;
      }

      // Standard Mode: Loop through categories
      categories.forEach(cat => {
        if (selectedCategory !== 'ALL' && selectedCategory !== cat.id) return;

        const catDishes = sortWeatherDishes(dishes.filter(d => {
          const matchesCat = d.categoryId === cat.id;
          const matchesSearch = !searchTerm || d.name.toLowerCase().includes(searchTerm) || (d.description && d.description.toLowerCase().includes(searchTerm));
          const sched = getDishScheduleStatus(d);
          return matchesCat && matchesSearch && matchesDiet(d) && sched.shouldDisplay;
        }));

        if (!catDishes.length) return;

        html += `
          <div class="category-section" id="cat_${cat.id}">
            <div class="category-title">
              <span>${escapeHtml(cat.name)}</span>
              <span class="category-badge-count">${catDishes.length} platos</span>
            </div>
            <div class="dishes-grid">
        `;

        catDishes.forEach(d => { html += renderSingleDishCard(d, currency); });

        html += `
            </div>
          </div>
        `;
      });

      if (!html) {
        if (searchTerm) {
          container.innerHTML = `
            <div class="empty-state-card">
              <span class="empty-state-icon">🔍</span>
              <div class="empty-state-title">Sin resultados para "${escapeHtml(searchTerm)}"</div>
              <div class="empty-state-desc">Probá con otro nombre o término más general para encontrar lo que buscas.</div>
              <button type="button" class="empty-state-btn" onclick="clearSearchFilter()">✕ Limpiar búsqueda</button>
            </div>
          `;
        } else if (selectedCategory !== 'ALL') {
          const currentCatObj = categories.find(c => c.id === selectedCategory);
          const catName = currentCatObj ? currentCatObj.name : 'esta sección';
          container.innerHTML = `
            <div class="empty-state-card">
              <span class="empty-state-icon">🍽️</span>
              <div class="empty-state-title">Sección sin platos disponibles</div>
              <div class="empty-state-desc">No hay platos activos en "${escapeHtml(catName)}" en este momento.</div>
              <button type="button" class="empty-state-btn" onclick="selectCategory('ALL')">Ver todos los platos</button>
            </div>
          `;
        } else {
          container.innerHTML = `
            <div class="empty-state-card">
              <span class="empty-state-icon">🥗</span>
              <div class="empty-state-title">Sin platos con los filtros seleccionados</div>
              <div class="empty-state-desc">Probá cambiando los filtros dietéticos para explorar la carta completa.</div>
              <button type="button" class="empty-state-btn" onclick="selectDietFilter('ALL')">Restablecer filtros</button>
            </div>
          `;
        }
      } else {
        container.innerHTML = html;
      }
    }

    function renderSingleDishCard(d, currency) {
      const inCart = getDishCartQuantity(d.id);
      const isSold = Boolean(d.outOfStock);
      const sched = getDishScheduleStatus(d);
      const isUnavailable = isSold || !sched.isAvailable;
      const effectivePrice = sched.effectivePrice !== undefined ? sched.effectivePrice : d.price;

      let badgeHtml = '';
      if (isSold) badgeHtml += '<span class="dish-badge" style="background:#E53E3E; color:#fff;">✕ AGOTADO HOY</span> ';
      if (!isSold && !sched.isAvailable) badgeHtml += `<span class="dish-badge" style="background:rgba(237,137,54,0.25); color:#F6AD55; border:1px solid rgba(237,137,54,0.5);">⏰ ${sched.reason}</span> `;
      if (d.isChefSpecial || (d.tags && d.tags.includes('chef_special'))) badgeHtml += '<span class="dish-badge" style="background:rgba(236,201,75,0.25); color:var(--chalk-gold); border:1px solid rgba(236,201,75,0.6); font-weight:700;">👨‍🍳 Sugerencia del Chef</span> ';
      if (d.tags && (d.tags.includes('veggie') || d.tags.includes('vegetariano'))) badgeHtml += '<span class="dish-badge badge-veggie">🥬 Vegetariano</span> ';
      if (d.tags && (d.tags.includes('vegano') || d.tags.includes('vegan'))) badgeHtml += '<span class="dish-badge badge-veggie">🌱 Vegano</span> ';
      if (d.tags && (d.tags.includes('celiac') || d.tags.includes('singluten'))) badgeHtml += '<span class="dish-badge badge-celiac">🌾 Sin TACC</span> ';
      if (d.tags && d.tags.includes('sinlactosa')) badgeHtml += '<span class="dish-badge" style="background:rgba(99,179,237,0.2); color:#63B3ED; border:1px solid rgba(99,179,237,0.4);">🥛 Sin Lactosa</span> ';
      if (d.tags && d.tags.includes('picante')) badgeHtml += '<span class="dish-badge" style="background:rgba(237,137,54,0.2); color:#ED8936; border:1px solid rgba(237,137,54,0.4);">🌶️ Picante</span> ';
      if (d.tags && d.tags.includes('star')) badgeHtml += '<span class="dish-badge badge-star">⭐ Destacado</span> ';
      // Happy Hour badge
      if (sched.isHappyHour) badgeHtml += '<span class="dish-badge" style="background:rgba(72,187,120,0.2); color:#48BB78; border:1px solid rgba(72,187,120,0.4);">🕐 Happy Hour</span> ';

      const photoHtml = d.photoUrl 
        ? `<img src="${d.photoUrl}" alt="${escapeHtml(d.name)}" class="dish-thumb" loading="lazy">` 
        : '';

      const formattedPrice = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
        ? window.i18nManager.formatPrice(effectivePrice) 
        : `${currency} ${effectivePrice}`;
      const displayPrice = getDishModifierGroups(d).some(group => group.kind === 'presentation')
        ? `Desde ${formattedPrice}`
        : formattedPrice;

      const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
      let priceDisplay = isSold ? '<span style="color:#E53E3E; font-size:0.85rem;">Agotado</span>' : displayPrice;
      if (!isSold) {
        // Happy Hour: show schedule override price with original as strikethrough
        if (sched.isHappyHour && sched.originalPrice !== null && sched.originalPrice !== undefined && Number(sched.originalPrice) > Number(effectivePrice)) {
          const formattedOriginal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(sched.originalPrice) 
            : `${currency} ${sched.originalPrice}`;
          priceDisplay = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.85em; margin-right:6px; color:var(--chalk-dim); font-weight:normal;">${formattedOriginal}</span>${displayPrice}`;
        } else if (origPrice && Number(origPrice) > Number(effectivePrice)) {
          // Fallback to dish-level originalPrice
          const formattedOriginal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(origPrice) 
            : `${currency} ${origPrice}`;
          priceDisplay = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.85em; margin-right:6px; color:var(--chalk-dim); font-weight:normal;">${formattedOriginal}</span>${displayPrice}`;
        }
      }

      return `
        <div class="dish-card ${isUnavailable ? 'dish-sold' : ''}" id="dish_card_${d.id}" style="${isUnavailable ? 'opacity:0.6; filter:grayscale(0.5);' : ''}">
          ${photoHtml}
          <div class="dish-body">
            <div class="dish-title-line">
              <span class="dish-name" style="${isSold ? 'text-decoration:line-through;' : ''}">${escapeHtml(d.name)}</span>
              ${badgeHtml}
            </div>
            ${d.description ? `<p class="dish-desc">${escapeHtml(d.description)}</p>` : ''}
            <div class="dish-price">${priceDisplay}</div>
          </div>
          <div class="dish-action">
            ${isSold 
              ? '<button class="btn-add" disabled style="background:#4A5568; cursor:not-allowed; opacity:0.6;">✕</button>' 
              : (!sched.isAvailable 
                  ? `<button class="btn-add" disabled style="background:#4A5568; cursor:not-allowed; opacity:0.6;" title="${sched.reason}">⏰</button>`
                  : `<button class="btn-add" data-dish-id="${escapeHtml(d.id)}" onclick="addToCart(this.dataset.dishId)" aria-label="Agregar ${escapeHtml(d.name)}">+</button>`
                )
            }
            ${inCart > 0 ? `<span class="qty-counter">${inCart} en carrito</span>` : ''}
          </div>
        </div>
      `;
    }

    function filterDishes() {
      renderDishes();
    }

    // Toast notification helper
    function showToast(message, type = 'success') {
      let toast = document.getElementById('scangoToast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'scangoToast';
        toast.style.cssText = 'position:fixed; bottom:100px; left:50%; transform:translateX(-50%); background:#1a2e25; color:#ECC94B; padding:10px 20px; border-radius:20px; font-size:0.85rem; font-weight:700; z-index:99999; box-shadow:0 8px 24px rgba(0,0,0,0.4); border:1px solid rgba(236,201,75,0.3); opacity:0; transition:opacity 0.3s ease; pointer-events:none;';
        document.body.appendChild(toast);
      }
      toast.textContent = message;
      toast.style.opacity = '1';
      clearTimeout(toast._timeout);
      toast._timeout = setTimeout(() => { toast.style.opacity = '0'; }, 2000);
    }

    // Cart Handlers
    function addToCart(dishId) {
      const dish = restaurantData.dishes.find(d => d.id === dishId);
      if (!dish || dish.outOfStock) return;
      const sched = getDishScheduleStatus(dish);
      if (!sched.isAvailable) {
        alert(`Este plato no se encuentra disponible en este horario (${sched.reason || 'Fuera de horario'}).`);
        return;
      }

      // Telemetría: interacción con plato → ranking de Top Platos en Studio
      trackPublicEvent('dish_click', { dishId: dish.id });

      openDishNoteModal({ mode: 'add', dishId });
    }

    function openDishNoteModal(action) {
      pendingDishNoteAction = action;
      const dish = action.mode === 'edit'
        ? cart[action.cartItemId]?.dish
        : restaurantData.dishes.find(item => item.id === action.dishId);
      if (!dish) return;

      document.getElementById('dishNoteTitle').textContent = action.mode === 'edit'
        ? 'Editar nota del plato'
        : 'Personalizar el plato';
      document.getElementById('dishNoteDishName').textContent = dish.name;
      document.getElementById('dishNoteInput').value = action.mode === 'edit'
        ? (cart[action.cartItemId].note || '')
        : '';
      renderDishChoiceFields(dish, action.mode === 'edit' ? cart[action.cartItemId] : null);
      document.getElementById('dishNoteConfirm').textContent = action.mode === 'edit'
        ? 'Guardar nota'
        : 'Agregar al carrito';

      const modal = document.getElementById('dishNoteModal');
      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');

      // Focus management for accessibility: move focus to the first interactive element
      const firstFocusable = modal.querySelector('.dish-choice-input, .dish-note-cancel, #dishNoteInput');
      if (firstFocusable) {
        firstFocusable.focus();
      }

      // Store the previously focused element to restore on close
      document.getElementById('dishNoteModal').dataset.previousFocus = document.activeElement?.id || '';
    }

    function closeDishNoteModal() {
      const modal = document.getElementById('dishNoteModal');
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      pendingDishNoteAction = null;

      // Restore focus to the element that opened the modal
      const previousFocusId = modal.dataset.previousFocus;
      if (previousFocusId) {
        const prevEl = document.getElementById(previousFocusId);
        if (prevEl) prevEl.focus();
      }
    }

    function confirmDishNote() {
      if (!pendingDishNoteAction) return;

      const note = document.getElementById('dishNoteInput').value.trim().slice(0, 250);
      const action = pendingDishNoteAction;
      const dish = action.mode === 'edit' ? cart[action.cartItemId]?.dish : restaurantData.dishes.find(item => item.id === action.dishId);
      const choices = readDishChoiceSelections(dish);
      if (!choices.valid) {
        const error = document.getElementById('dishChoiceError');
        if (error) error.textContent = choices.error;
        return;
      }

      if (action.mode === 'edit') {
        const item = cart[action.cartItemId];
        if (item) {
          item.note = note;
          item.choices = choices.selections;
        }
      } else {
        if (dish) addDishToCart(dish, note, choices.selections);
      }

      closeDishNoteModal();
      updateCartUI();
      renderDishes();
      if (document.getElementById('cartModal').classList.contains('active')) {
        renderCartModalList();
      }
    }

    function getDishModifierGroups(dish) {
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

    function getSavedGroupSelections(cartItem, groupId) {
      return cartItem?.choices?.find(choice => choice.groupId === groupId)?.selections || [];
    }

    function getSelectedPackageUnits(groups, cartItem) {
      const packageGroup = groups.find(group => group.kind === 'presentation');
      if (!packageGroup) return null;
      const selected = getSavedGroupSelections(cartItem, packageGroup.id)[0];
      return packageGroup.options.find(option => option.id === selected?.optionId)?.unitsIncluded || null;
    }

    function renderDishChoiceFields(dish, cartItem) {
      const container = document.getElementById('dishChoiceContainer');
      const groups = getDishModifierGroups(dish).sort((left, right) => Number(right.kind === 'presentation') - Number(left.kind === 'presentation'));
      const packageUnits = getSelectedPackageUnits(groups, cartItem);
      const savedSelections = new Map((cartItem?.choices || []).map(choice => [choice.groupId, choice.selections]));
      let html = '';

      groups.forEach(group => {
        const choices = savedSelections.get(group.id) || [];
        const choicesById = new Map(choices.map(choice => [choice.optionId, choice]));
        const options = (group.options || []).filter(option => option.active !== false);
        if (!options.length) return;
        const requiredLabel = group.required ? ' *' : ' (opcional)';
        const legend = group.kind === 'presentation' ? 'Elegí la presentación' : group.name;
        html += `<fieldset class="dish-choice-group" data-choice-group="${escapeHtml(group.id)}"><legend class="dish-choice-legend">${escapeHtml(legend)}${requiredLabel}</legend><div class="dish-choice-list">`;

        if (group.selectionMode === 'single') {
          if (!group.required) {
            html += `<label class="dish-choice-option"><input type="radio" class="dish-choice-input" name="group_${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}" value=""> Sin preferencia</label>`;
          }
          html += options.map(option => {
            const saved = choicesById.get(option.id);
            const packageLabel = group.kind === 'presentation';
            const price = packageLabel ? option.priceCents : option.priceDeltaCents;
            const priceLabel = Number(price) > 0 ? (packageLabel ? formatOptionPrice(price) : `+${formatOptionPrice(price)}`) : '';
            const detail = packageLabel && option.unitsIncluded ? `${option.unitsIncluded} unidades` : '';
            return `<label class="dish-choice-option"><input type="radio" class="dish-choice-input" name="group_${escapeHtml(group.id)}" data-group-id="${escapeHtml(group.id)}" data-option-id="${escapeHtml(option.id)}" data-selection-mode="single" value="${escapeHtml(option.id)}" ${saved ? 'checked' : ''} onchange="updateModifierSplitTotals()"><span>${escapeHtml(option.name)}${detail ? ` · ${detail}` : ''}</span>${priceLabel ? `<span class="dish-choice-price">${priceLabel}</span>` : ''}</label>`;
          }).join('');
        } else if (group.selectionMode === 'multiple') {
          html += options.map(option => {
            const selected = choicesById.has(option.id);
            const priceLabel = Number(option.priceDeltaCents) > 0 ? `+${formatOptionPrice(option.priceDeltaCents)}` : '';
            return `<label class="dish-choice-option"><input type="checkbox" class="dish-choice-input" data-group-id="${escapeHtml(group.id)}" data-option-id="${escapeHtml(option.id)}" data-selection-mode="multiple" ${selected ? 'checked' : ''}><span>${escapeHtml(option.name)}</span>${priceLabel ? `<span class="dish-choice-price">${priceLabel}</span>` : ''}</label>`;
          }).join('');
        } else {
          const isSplit = group.selectionMode === 'quantity_split';
          const target = isSplit ? (packageUnits || group.unitsPerSelection || 1) : null;
          const waitingForPresentation = isSplit && groups.some(item => item.kind === 'presentation') && !packageUnits;
          if (isSplit) {
            html += `<p class="dish-split-hint" data-group-id="${escapeHtml(group.id)}">${waitingForPresentation ? 'Primero elegí la presentación.' : `Repartí ${target} ${target === 1 ? 'unidad' : 'unidades'} en ${escapeHtml(group.name.toLowerCase())}.`}</p>`;
          }
          html += options.map(option => {
            const saved = choicesById.get(option.id);
            const maxQuantity = isSplit ? target : (option.maxQuantity || 10);
            const priceLabel = Number(option.priceDeltaCents) > 0 ? `+${formatOptionPrice(option.priceDeltaCents)}${isSplit ? ' c/u' : ''}` : '';
            const inputId = `qty_${group.id}_${option.id}`;
            return `<div class="dish-choice-option dish-choice-quantity"><span>${escapeHtml(option.name)}${priceLabel ? `<small class="dish-choice-price">${priceLabel}</small>` : ''}</span><div class="dish-choice-stepper"><button type="button" class="dish-choice-step" onclick="adjustChoiceQuantity('${escapeHtml(group.id)}','${escapeHtml(option.id)}',-1)" aria-label="Quitar ${escapeHtml(option.name)}">−</button><input id="${escapeHtml(inputId)}" type="number" class="dish-choice-input dish-choice-quantity-input ${isSplit ? 'dish-variant-count' : ''}" min="0" max="${maxQuantity}" step="1" value="${saved?.quantity || 0}" data-group-id="${escapeHtml(group.id)}" data-option-id="${escapeHtml(option.id)}" data-selection-mode="${escapeHtml(group.selectionMode)}" ${waitingForPresentation ? 'disabled' : ''} oninput="updateModifierSplitTotals()" aria-label="Cantidad de ${escapeHtml(option.name)}"><button type="button" class="dish-choice-step" onclick="adjustChoiceQuantity('${escapeHtml(group.id)}','${escapeHtml(option.id)}',1)" aria-label="Agregar ${escapeHtml(option.name)}" ${waitingForPresentation ? 'disabled' : ''}>+</button></div></div>`;
          }).join('');
          if (isSplit) html += `<output class="dish-variant-total" data-split-group="${escapeHtml(group.id)}" data-required="${target}"></output>`;
        }
        html += '</div></fieldset>';
      });

      if (html) html += '<p id="dishChoiceError" class="dish-choice-error" role="alert"></p>';
      container.innerHTML = html;
      updateModifierSplitTotals();
      updateDishChoiceSubmitState();
    }

    function adjustChoiceQuantity(groupId, optionId, delta) {
      const input = Array.from(document.querySelectorAll('.dish-choice-quantity-input'))
        .find(item => item.dataset.groupId === groupId && item.dataset.optionId === optionId);
      if (!input) return;
      const max = parseInt(input.max, 10) || 100;
      input.value = Math.max(0, Math.min(max, (parseInt(input.value, 10) || 0) + delta));
      updateModifierSplitTotals();
    }

    function formatOptionPrice(priceDeltaCents) {
      const price = Number(priceDeltaCents) / 100;
      return formatMenuPrice(price);
    }

    function formatMenuPrice(amount) {
      const price = Number(amount) || 0;
      const currency = restaurantData.currency || '$';
      if (Math.abs(price - Math.round(price)) > 0.000001) {
        return `${currency} ${price.toFixed(2)}`;
      }
      return (window.i18nManager && typeof window.i18nManager.formatPrice === 'function')
        ? window.i18nManager.formatPrice(price)
        : `${currency} ${price}`;
    }

    function getSelectedPresentationUnits(groups, selections) {
      const presentationGroup = groups.find(group => group.kind === 'presentation');
      if (!presentationGroup) return null;
      const selected = selections.find(choice => choice.groupId === presentationGroup.id)?.selections[0];
      return presentationGroup.options.find(option => option.id === selected?.optionId)?.unitsIncluded || null;
    }

    function updateModifierSplitTotals() {
      const groups = Array.from(document.querySelectorAll('[data-split-group]'));
      groups.forEach(output => {
        const groupId = output.dataset.splitGroup;
        const target = getCurrentPresentationUnits() || parseInt(output.dataset.required, 10) || 1;
        const hasPresentation = getDishModifierGroups(getCurrentDishForChoices() || {}).some(group => group.kind === 'presentation');
        const waitingForPresentation = hasPresentation && !getCurrentPresentationUnits();
        const inputs = Array.from(document.querySelectorAll('.dish-choice-quantity-input'))
          .filter(input => input.dataset.groupId === groupId);
        const selected = inputs.reduce((sum, input) => sum + (parseInt(input.value, 10) || 0), 0);
        inputs.forEach(input => {
          input.max = String(target);
          input.disabled = waitingForPresentation;
          const stepper = input.parentElement?.querySelectorAll('.dish-choice-step');
          if (stepper) stepper.forEach(button => { button.disabled = waitingForPresentation; });
        });
        const hint = output.closest('.dish-choice-group')?.querySelector('.dish-split-hint');
        if (hint) hint.textContent = waitingForPresentation
          ? 'Primero elegí la presentación.'
          : `Repartí ${target} ${target === 1 ? 'unidad' : 'unidades'} en ${(getDishModifierGroups(getCurrentDishForChoices() || {}).find(group => group.id === groupId)?.name || 'los sabores').toLowerCase()}.`;
        output.dataset.required = target;
        output.textContent = waitingForPresentation ? 'Elegí una presentación' : `${selected} de ${target} unidades asignadas`;
        output.classList.toggle('invalid', waitingForPresentation || selected !== target);
      });
      const error = document.getElementById('dishChoiceError');
      if (error) error.textContent = '';
      updateDishChoiceSubmitState();
    }

    function updateDishChoiceSubmitState() {
      const button = document.getElementById('dishNoteConfirm');
      const dish = getCurrentDishForChoices();
      if (!button || !dish) return;
      button.disabled = !readDishChoiceSelections(dish).valid;
    }

    function getCurrentDishForChoices() {
      if (!pendingDishNoteAction) return null;
      if (pendingDishNoteAction.mode === 'edit') return cart[pendingDishNoteAction.cartItemId]?.dish || null;
      return restaurantData.dishes.find(dish => dish.id === pendingDishNoteAction.dishId) || null;
    }

    function getCurrentPresentationUnits() {
      const dish = getCurrentDishForChoices();
      const groups = getDishModifierGroups(dish || {});
      const selectedInput = Array.from(document.querySelectorAll('.dish-choice-input[data-selection-mode="single"]:checked'))
        .find(input => groups.some(group => group.kind === 'presentation' && group.id === input.dataset.groupId));
      if (!selectedInput) return null;
      const group = groups.find(item => item.id === selectedInput.dataset.groupId);
      return group?.options.find(option => option.id === selectedInput.dataset.optionId)?.unitsIncluded || null;
    }

    function readDishChoiceSelections(dish) {
      if (!dish) return { valid: false, error: 'No se encontró el plato seleccionado.' };
      const groups = getDishModifierGroups(dish);
      const selections = groups.map(group => {
        const selected = Array.from(document.querySelectorAll('.dish-choice-input'))
          .filter(input => input.dataset.groupId === group.id && (input.type === 'radio' ? input.checked && input.dataset.optionId : input.type === 'checkbox' ? input.checked : Number(input.value) > 0))
          .map(input => ({ optionId: input.dataset.optionId, quantity: input.type === 'number' ? parseInt(input.value, 10) || 0 : 1 }));
        return { groupId: group.id, selections: selected };
      });

      for (const group of groups) {
        const selected = selections.find(choice => choice.groupId === group.id)?.selections || [];
        const count = selected.reduce((sum, option) => sum + (group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split' ? option.quantity : 1), 0);
        if (group.required && !count) return { valid: false, error: `Elegí una opción para "${group.name}".` };
        if (count < (group.minSelections || 0) || count > (group.maxSelections || 100)) {
          return { valid: false, error: `La selección de "${group.name}" no cumple sus límites.` };
        }
      }

      const packageUnits = getSelectedPresentationUnits(groups, selections);
      for (const group of groups.filter(item => item.selectionMode === 'quantity_split')) {
        const selected = selections.find(choice => choice.groupId === group.id)?.selections || [];
        const total = selected.reduce((sum, option) => sum + option.quantity, 0);
        const target = packageUnits || group.unitsPerSelection || 1;
        if ((group.required || total > 0) && total !== target) {
          return { valid: false, error: `Las cantidades de "${group.name}" deben sumar ${target}.` };
        }
      }
      return { valid: true, selections: selections.filter(group => group.selections.length) };
    }

    function getCartUnitPrice(item) {
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

    function getCartOptionSummary(item) {
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

    function addDishToCart(dish, note, choices) {
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

    function getDishCartQuantity(dishId) {
      return Object.values(cart)
        .filter(item => item.dish.id === dishId)
        .reduce((quantity, item) => quantity + item.qty, 0);
    }

    function editCartItemNote(cartItemId) {
      if (cart[cartItemId]) {
        if (window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive()) {
          if (!window.groupCartManagerInstance.canEditItem(cart[cartItemId])) {
            alert(`Solo ${cart[cartItemId].orderedBy || 'quien lo pidió'} puede modificar notas de este plato.`);
            return;
          }
        }
        openDishNoteModal({ mode: 'edit', cartItemId });
      }
    }

    function changeCartQty(cartItemId, delta) {
      if (!cart[cartItemId]) return;

      // Restricción: Cada comensal solo puede editar o eliminar los platos creados bajo su propio nombre
      if (window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive()) {
        const success = window.groupCartManagerInstance.changeQty(cartItemId, delta);
        if (!success) return;
        cart = window.groupCartManagerInstance.cart;
        updateCartUI();
        renderDishes();
        renderCartModalList();
        return;
      }

      cart[cartItemId].qty += delta;
      if (cart[cartItemId].qty <= 0) {
        delete cart[cartItemId];
      }
      updateCartUI();
      renderDishes();
      renderCartModalList();
    }

    // Sincronización en tiempo real desde GroupCartManager
    window.syncCartFromGroupManager = function(updatedCart, meta) {
      cart = updatedCart || {};
      updateCartUI();
      renderDishes();
      if (document.getElementById('cartModal')?.classList.contains('active')) {
        renderCartModalList();
      }
    };

    function updateCartUI() {
      const totalCount = Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * getCartUnitPrice(item)), 0);
      const currency = restaurantData.currency || '$';
      const formattedSubtotal = formatMenuPrice(subtotal);

      const bar = document.getElementById('floatingCart');
      if (totalCount > 0) {
        bar.classList.add('active');
        document.getElementById('cartCountBadge').textContent = `🛒 ${totalCount} ítems`;
        document.getElementById('cartTotalBadge').textContent = `${formattedSubtotal}`;
      } else {
        bar.classList.remove('active');
      }
    }

    function openCartModal() {
      document.getElementById('cartModal').classList.add('active');
      populateDeliveryZones();
      renderCartModalList();
    }

    function closeCartModal() {
      document.getElementById('cartModal').classList.remove('active');
    }

    function renderCartModalList() {
      const list = document.getElementById('cartItemsList');
      const currency = restaurantData.currency || '$';
      const items = Object.values(cart);
      const isGroup = Boolean(window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive());

      const btnConsolidate = document.getElementById('btnToggleGroupConsolidated');
      if (btnConsolidate) {
        btnConsolidate.style.display = (isGroup && items.length > 0) ? 'flex' : 'none';
      }

      if (!items.length) {
        list.innerHTML = '<p style="color:var(--chalk-dim); text-align:center; padding:16px;">El pedido está vacío.</p>';
        updateTotals();
        return;
      }

      let html = '';
      Object.entries(cart).forEach(([cartItemId, item]) => {
        const canEdit = !isGroup || window.groupCartManagerInstance.canEditItem(item);
        const orderedBy = item.orderedBy;
        const currentUserName = window.groupCartManagerInstance?.userName;
        const isOwn = isGroup && orderedBy && currentUserName &&
                      orderedBy.toLowerCase() === currentUserName.toLowerCase();

        const orderedByBadge = orderedBy ? `
          <div style="margin-bottom:3px;">
            <span class="cart-item-ordered-by ${isOwn ? 'is-own' : ''}">
              👤 ${escapeHtml(orderedBy)} ${isOwn ? '(Tú)' : ''}
            </span>
          </div>
        ` : '';

        // Atribución de nombre solicitada: "Juan: Hamburguesa Criolla"
        const displayTitle = orderedBy ? `${escapeHtml(orderedBy)}: ${escapeHtml(item.dish.name)}` : escapeHtml(item.dish.name);

        const itemDesc = item.dish.description ? `<div style="font-size:0.75rem; color:var(--chalk-dim); margin-top:2px;">${escapeHtml(item.dish.description)}</div>` : '';
        const itemNote = item.note ? `<div class="cart-item-note">Nota: ${escapeHtml(item.note)}</div>` : '';
        const optionSummary = getCartOptionSummary(item);
        const itemOptions = optionSummary ? `<div class="cart-item-options">${escapeHtml(optionSummary)}</div>` : '';
        const unitPrice = getCartUnitPrice(item);
        const formattedPrice = formatMenuPrice(unitPrice);
        const formattedLineTotal = formatMenuPrice(unitPrice * item.qty);

        const editNoteBtn = canEdit ? `
          <button type="button" class="cart-note-edit" data-cart-id="${escapeHtml(cartItemId)}" onclick="editCartItemNote(this.dataset.cartId)">${item.note ? 'Editar nota' : 'Agregar nota'}</button>
        ` : `<span style="font-size:0.72rem; color:var(--chalk-dim); font-style:italic;">🔒 Pedido por ${escapeHtml(orderedBy || 'otro comensal')}</span>`;

        const disabledAttr = canEdit ? '' : `disabled title="Solo ${escapeHtml(orderedBy || 'quien lo pidió')} puede modificar este plato"`;

        html += `
          <div class="cart-item">
            <div style="flex:1; min-width:0;">
              ${orderedByBadge}
              <div class="cart-item-title">${displayTitle}</div>
              ${itemDesc}
              ${itemOptions}
              ${itemNote}
              <div class="cart-item-price">${formattedPrice} x ${item.qty} = ${formattedLineTotal}</div>
              ${editNoteBtn}
            </div>
            <div class="cart-qty-ctrl">
              <button class="btn-qty" ${disabledAttr} data-cart-id="${escapeHtml(cartItemId)}" onclick="changeCartQty(this.dataset.cartId, -1)" aria-label="Quitar una unidad">-</button>
              <span style="font-family:var(--font-mono);">${item.qty}</span>
              <button class="btn-qty" ${disabledAttr} data-cart-id="${escapeHtml(cartItemId)}" onclick="changeCartQty(this.dataset.cartId, 1)" aria-label="Agregar una unidad">+</button>
            </div>
          </div>
        `;
      });
      list.innerHTML = html;
      updateTotals();
      renderUpsellSuggestions();
      renderCrossSellSection();
    }

    function populateDeliveryZones() {
      const select = document.getElementById('deliveryZoneSelect');
      const zones = (restaurantData && restaurantData.deliveryZones) || [];
      const currency = restaurantData.currency || '$';

      select.innerHTML = '<option value="0" data-fee="0">Selecciona zona de entrega...</option>';
      zones.forEach(z => {
        const opt = document.createElement('option');
        opt.value = z.name;
        opt.dataset.fee = z.fee;
        opt.textContent = `${z.name} (${currency} ${z.fee})`;
        select.appendChild(opt);
      });
    }

    function handleOrderModeChange() {
      const mode = document.getElementById('orderMode').value;
      const tableField = document.getElementById('tableField');
      const deliveryField = document.getElementById('deliveryZoneField');

      if (mode === 'LOCAL') {
        tableField.style.display = 'block';
        deliveryField.style.display = 'none';
        deliveryFee = 0;
      } else if (mode === 'DELIVERY') {
        tableField.style.display = 'none';
        deliveryField.style.display = 'block';
        updateDeliveryFee();
      } else { // TAKEAWAY
        tableField.style.display = 'none';
        deliveryField.style.display = 'none';
        deliveryFee = 0;
      }
      updateTotals();
    }

    function updateDeliveryFee() {
      const select = document.getElementById('deliveryZoneSelect');
      const selectedOpt = select.options[select.selectedIndex];
      deliveryFee = selectedOpt ? parseFloat(selectedOpt.dataset.fee || 0) : 0;
      updateTotals();
    }

    function applyCoupon() {
      const input = document.getElementById('inputCouponCode');
      const code = (input.value || '').trim().toUpperCase();
      const msg = document.getElementById('couponMsg');

      if (!code) {
        appliedCoupon = null;
        msg.textContent = '';
        updateTotals();
        return;
      }

      if (code === 'PROMO10') {
        appliedCoupon = { code: 'PROMO10', type: 'percent', value: 10, label: '10% OFF' };
        msg.style.color = '#68D391';
        msg.textContent = '✓ 10% Descuento aplicado';
      } else if (code === 'PROMO15') {
        appliedCoupon = { code: 'PROMO15', type: 'percent', value: 15, label: '15% OFF' };
        msg.style.color = '#68D391';
        msg.textContent = '✓ 15% Descuento aplicado';
      } else if (code === 'ENVIOFREE') {
        appliedCoupon = { code: 'ENVIOFREE', type: 'free_delivery', value: 0, label: 'Envío Gratis' };
        msg.style.color = '#68D391';
        msg.textContent = '✓ Costo de envío bonificado';
      } else {
        appliedCoupon = null;
        msg.style.color = '#FEB2B2';
        msg.textContent = '✕ Cupón inválido';
      }
      updateTotals();
    }

    function updateTotals() {
      const currency = restaurantData.currency || '$';
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * getCartUnitPrice(item)), 0);
      const mode = document.getElementById('orderMode').value;

      const formatP = formatMenuPrice;

      document.getElementById('summarySubtotal').textContent = formatP(subtotal);
      const deliveryRow = document.getElementById('summaryDeliveryRow');
      const discountRow = document.getElementById('summaryDiscountRow');

      let currentDelivery = (mode === 'DELIVERY' ? deliveryFee : 0);
      discountAmount = 0;

      if (appliedCoupon) {
        if (appliedCoupon.type === 'percent') {
          discountAmount = Math.round(subtotal * (appliedCoupon.value / 100));
        } else if (appliedCoupon.type === 'free_delivery' && mode === 'DELIVERY') {
          discountAmount = currentDelivery;
        }
      }

      if (discountAmount > 0) {
        discountRow.style.display = 'flex';
        document.getElementById('summaryDiscount').textContent = `-${formatP(discountAmount)} (${appliedCoupon.label})`;
      } else {
        discountRow.style.display = 'none';
      }

      if (mode === 'DELIVERY' && deliveryFee > 0) {
        deliveryRow.style.display = 'flex';
        document.getElementById('summaryDeliveryFee').textContent = `${formatP(deliveryFee)}`;
      } else {
        deliveryRow.style.display = 'none';
      }

      const total = Math.max(0, subtotal + currentDelivery - discountAmount);
      document.getElementById('summaryTotal').textContent = formatP(total);
      updateSplitCalculation();
    }

    function updateSplitCalculation() {
      const splitBox = document.getElementById('billSplitterSection');
      if (!splitBox || splitBox.style.display === 'none') return;

      const currency = restaurantData.currency || '$';
      const countInput = document.getElementById('splitCountInput');
      const count = parseInt(countInput ? countInput.value : 2) || 1;
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * getCartUnitPrice(item)), 0);
      const mode = document.getElementById('orderMode').value;
      const currentDelivery = (mode === 'DELIVERY' ? deliveryFee : 0);
      const total = Math.max(0, subtotal + currentDelivery - discountAmount);

      const perPerson = Math.ceil(total / Math.max(1, count));
      const display = document.getElementById('splitPerPersonDisplay');
      if (display) {
        display.textContent = `${currency} ${perPerson} c/u (${count} personas)`;
      }
    }

    async function submitWhatsAppOrder() {
      const items = Object.values(cart);
      if (!items.length) {
        alert('Por favor agrega platos a tu pedido primero.');
        return;
      }

      const btn = document.getElementById('btnSubmitOrderWA');
      if (btn?.dataset.submitting === 'true') return;
      const originalHtml = btn?.innerHTML;
      let popup = null;
      if (btn) {
        btn.dataset.submitting = 'true';
        btn.disabled = true;
        btn.innerHTML = '<span>⏳ Verificando precios...</span>';
      }

      try {
        popup = window.open('about:blank', '_blank');
        const mode = document.getElementById('orderMode').value;
        const customerName = document.getElementById('orderCustomerName').value.trim() || 'Cliente';
        const notes = document.getElementById('orderNotes').value.trim();
        const payment = document.getElementById('orderPayment').value;
        const currency = restaurantData.currency || '$';
        const zoneSelect = document.getElementById('deliveryZoneSelect');
        const tableNumber = document.getElementById('orderTable').value.trim() || '1';
        const address = document.getElementById('orderAddress').value.trim();
        const isGroupOrder = Boolean(window.groupCartManagerInstance && window.groupCartManagerInstance.isGroupActive());
        const quoteResponse = await fetch('/api/orders/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
          })
        });
        const quotePayload = await quoteResponse.json();
        if (!quoteResponse.ok || !quotePayload.success || !quotePayload.data) {
          throw new Error(quotePayload.error || 'No se pudo validar el pedido. Revisá las opciones y volvé a intentar.');
        }

        const quote = quotePayload.data;
        const subtotal = quote.amount;
        const currentDelivery = mode === 'DELIVERY' ? deliveryFee : 0;
        const currentDiscount = appliedCoupon?.type === 'percent'
          ? Math.round(subtotal * (appliedCoupon.value / 100) * 100) / 100
          : (appliedCoupon?.type === 'free_delivery' && mode === 'DELIVERY' ? currentDelivery : 0);
        const total = Math.max(0, subtotal + currentDelivery - currentDiscount);

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
          const dish = items[index]?.dish;
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
        msg += `\n💵 *Subtotal:* ${currency} ${subtotal.toFixed(2)}\n`;
        if (appliedCoupon && currentDiscount > 0) msg += `🎟️ *Descuento Cupón (${appliedCoupon.code}):* -${currency} ${currentDiscount.toFixed(2)}\n`;
        if (mode === 'DELIVERY' && deliveryFee > 0) msg += `🛵 *Envío:* ${currency} ${deliveryFee}\n`;
        msg += `💰 *TOTAL A PAGAR:* ${currency} ${total.toFixed(2)}\n`;
        msg += `💳 *Método de Pago Seleccionado:* [${payment.toUpperCase()}]\n`;
        if (payment.includes('Transferencia')) msg += `ℹ️ _Se adjuntará el comprobante de transferencia por este chat._\n`;
        if (restaurantData.paymentLink) msg += `🔗 _Link de Pago:_ ${restaurantData.paymentLink}\n`;
        msg += `\n_Enviado desde ScanGo (Menú Digital)_`;

        // Registrar pedido en backend
        fetch('/api/orders', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
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
              choices: item.choices || []
            }))
          })
        }).catch(() => {});

        if (isGroupOrder && window.groupCartManagerInstance) {
          window.groupCartManagerInstance.clearTableCart();
        }

        const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');
        const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
        if (popup) popup.location = waUrl;
        else window.location.assign(waUrl);
        trackPublicEvent('order_placed', {
          amount: total,
          items: items.map(item => ({ dishId: item.dish.id, qty: item.qty })).slice(0, 100)
        });
      } catch (error) {
        if (popup) popup.close();
        alert(error.message || 'No se pudo preparar el pedido. Intentá nuevamente.');
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.dataset.submitting = 'false';
          btn.innerHTML = originalHtml;
        }
      }
    }

    // =========================================================================
    // EL MOZO VIRTUAL: MOTOR HEURÍSTICO CONTEXTUAL AVANZADO Y 100% OPCIONAL
    // =========================================================================

    /**
     * Preferencia de usuario persistida en localStorage para El Mozo Virtual
     */
    function isMozoVirtualEnabled() {
      return isMozoVirtualEnabledMod();
    }

    function handleMozoVirtualToggle(checked) {
      handleMozoVirtualToggleMod(checked, renderUpsellSuggestions);
    }

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
    function analyzeCartContextForUpsell() {
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
          const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
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

    /**
     * Retorna los candidatos a upselling (mantiene compatibilidad con suite de tests existente)
     */
    function getUpsellCandidates() {
      const analysis = analyzeCartContextForUpsell();
      return analysis.candidates || [];
    }

    function renderUpsellSuggestions() {
      const box = document.getElementById('virtualWaiterUpsellBox');
      const toggleEl = document.getElementById('toggleMozoVirtual');
      if (toggleEl) {
        toggleEl.checked = isMozoVirtualEnabled();
      }

      if (!box) return;

      if (!isMozoVirtualEnabled()) {
        box.style.display = 'none';
        return;
      }

      const analysis = analyzeCartContextForUpsell();
      const candidates = analysis.candidates;

      if (!candidates || !candidates.length) {
        box.style.display = 'none';
        return;
      }

      const currency = restaurantData.currency || '$';
      let cardsHtml = '';
      candidates.forEach(dish => {
        const thumbHtml = dish.photoUrl
          ? `<img class="mozo-item-thumb" src="${escapeHtml(dish.photoUrl)}" alt="${escapeHtml(dish.name)}" loading="lazy" onerror="this.style.display='none'">`
          : `<div class="mozo-item-thumb" style="display:flex;align-items:center;justify-content:center;font-size:1.2rem;">🍽️</div>`;
        cardsHtml += `
          <div class="mozo-item-card">
            ${thumbHtml}
            <div class="mozo-item-info">
              <span class="mozo-badge-tag">${escapeHtml(analysis.badge || 'Sugerido')}</span>
              <div class="mozo-item-title">${escapeHtml(dish.name)}</div>
              <div class="mozo-item-price">${currency} ${(dish.price || 0).toFixed(0)}</div>
            </div>
            <button type="button" class="btn-mozo-quick-add" data-dish-id="${escapeHtml(dish.id)}" onclick="quickAddUpsellItem('${escapeHtml(dish.id)}', this)">
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

    function quickAddUpsellItem(dishId, btnEl) {
      const dish = (restaurantData.dishes || []).find(d => d.id === dishId);
      if (!dish) return;

      addDishToCart(dish, '', []);
      updateCartUI();
      renderCartModalList();

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

    function detectCrossSellOpportunity(cartItems) {
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

    function renderCrossSellSection() {
      const section = document.getElementById('crossSellSection');
      if (!section) return;

      const items = Object.values(cart);
      if (!items.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const opportunities = detectCrossSellOpportunity(items);
      if (!opportunities.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const cartDishIds = new Set(items.map(ci => ci.dish.id));
      const availableDishes = (restaurantData.dishes || []).filter(d =>
        !cartDishIds.has(d.id) && !d.outOfStock && (d.price || 0) > 0
      );

      if (!availableDishes.length) {
        section.style.display = 'none';
        section.innerHTML = '';
        return;
      }

      const currency = restaurantData.currency || '$';
      let html = '';

      opportunities.slice(0, 2).forEach(opp => {
        const matches = availableDishes.filter(d => {
          const cat = (restaurantData.categories || []).find(c => c.id === d.categoryId);
          const text = `${d.name} ${d.description || ''} ${cat ? cat.name : ''}`.toLowerCase();
          return CROSS_SELL_PATTERNS[opp.type] && CROSS_SELL_PATTERNS[opp.type].test(text);
        }).sort((a, b) => (a.price || 0) - (b.price || 0));

        if (!matches.length) return;

        const topPick = matches[0];
        const thumbHtml = topPick.photoUrl
          ? `<img src="${escapeHtml(topPick.photoUrl)}" alt="${escapeHtml(topPick.name)}" style="width:48px;height:48px;object-fit:cover;border-radius:8px;flex-shrink:0;" loading="lazy">`
          : `<div style="width:48px;height:48px;border-radius:8px;background:rgba(236,201,75,0.1);display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">${opp.type === 'postre' ? '🍰' : '🥤'}</div>`;

        html += `
          <div class="cross-sell-card" style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(236,201,75,0.06); border:1px solid rgba(236,201,75,0.25); border-radius:10px; margin-bottom:8px;">
            ${thumbHtml}
            <div style="flex:1; min-width:0;">
              <div style="font-size:0.72rem; color:var(--chalk-gold); font-weight:700; text-transform:uppercase; margin-bottom:2px;">${opp.type === 'postre' ? '🍰 Sugerencia Dulce' : '🥤 Sugerencia para Acompañar'}</div>
              <div style="font-weight:600; font-size:0.88rem; color:#fff; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(topPick.name)}</div>
              <div style="font-size:0.78rem; color:var(--chalk-dim);">${currency} ${formatMenuPrice(topPick.price)}</div>
            </div>
            <button type="button" class="btn-mozo-quick-add" data-dish-id="${escapeHtml(topPick.id)}" onclick="quickAddUpsellItem('${escapeHtml(topPick.id)}', this)" aria-label="Agregar ${escapeHtml(topPick.name)} al carrito">+ Agregar</button>
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

    // =========================================================================
    // MERCADO PAGO CHECKOUT PRO: PAYMENT METHOD HANDLER
    // =========================================================================

    function handleOrderPaymentChange() {
      const payment = document.getElementById('orderPayment').value;
      const externalBox = document.getElementById('externalPaymentBox');
      const btnExternal = document.getElementById('btnExternalPay');

      if (payment.includes('Mercado Pago') && restaurantData.paymentLink) {
        if (externalBox) {
          externalBox.style.display = 'block';
          if (btnExternal) btnExternal.href = restaurantData.paymentLink;
        }
      } else {
        if (externalBox) externalBox.style.display = 'none';
      }
    }

    // =========================================================================
    // SMART GOOGLE REVIEWS & FEEDBACK FILTER
    // =========================================================================

    let selectedStarRating = 0;

    function openSmartReviewModal() {
      selectedStarRating = 0;
      openSmartReviewModalMod(restaurantData);
    }

    function closeSmartReviewModal() {
      closeSmartReviewModalMod();
      selectedStarRating = 0;
    }

    function handleStarSelect(rating) {
      selectedStarRating = rating;
      handleStarSelectMod(rating);
    }

    function handleGoogleReviewClick() {
      handleGoogleReviewClickMod(getSlug);
    }

    async function submitPrivateFeedback(e) {
      await submitPrivateFeedbackMod(e, restaurantData, getSlug);
    }

    initStarHoverMod();

    // Reservation Modal Logic
    function openReservationModal() {
      const today = new Date().toISOString().split('T')[0];
      const dateInput = document.getElementById('resDate');
      if (dateInput) {
        dateInput.min = today;
        if (!dateInput.value) dateInput.value = today;
      }
      openReservationModalMod();
    }

    function closeReservationModal() {
      closeReservationModalMod();
    }

    function submitReservation(e) {
      submitReservationMod(e, restaurantData, getSlug);
    }

    // Wi-Fi Modal
    function openWifiModal() {
      openWifiModalMod();
    }
    function closeWifiModal() {
      closeWifiModalMod();
    }
    function copyWifiPassword() {
      copyWifiPasswordMod(restaurantData ? restaurantData.wifi : {});
    }

    // TTS Accessibility
    function stopCategoryTTS() {
      stopCategoryTTSMod();
    }

    function pauseCategoryTTS() {
      pauseCategoryTTSMod();
    }

    function resumeCategoryTTS() {
      resumeCategoryTTSMod();
    }

    function readSelectedCategoryTTS() {
      readSelectedCategoryTTSMod(selectedCategory, restaurantData ? restaurantData.categories : [], restaurantData ? restaurantData.dishes : []);
    }

    // Push Notifications Prompt & Permissions
    function initPushPrompt() {
      initPushPromptMod();
    }

    async function requestPushPermission() {
      await requestPushPermissionMod();
    }

    function dismissPushPrompt() {
      dismissPushPromptMod();
    }

    // ========== NEW HEADER & MODAL FUNCTIONS ==========

    // WhatsApp Chat: Opens WhatsApp with the restaurant phone
    function openWhatsAppChat() {
      if (!restaurantData || !restaurantData.phone) {
        alert('Este restaurante no tiene WhatsApp configurado.');
        return;
      }
      const phone = restaurantData.phone.replace(/[^\d+]/g, '');
      window.open(`https://wa.me/${phone}`, '_blank');
    }

    // Restaurant Info Modal
    function openRestaurantInfoModal() {
      const addrEl = document.getElementById('infoAddressFullText');
      if (addrEl && restaurantData) {
        addrEl.textContent = restaurantData.address || 'Dirección no disponible';
      }
      const dtModal = document.getElementById('infoDeliveryTimeModal');
      if (dtModal && restaurantData) {
        dtModal.textContent = restaurantData.deliveryTime || '30 - 45min.';
      }
      renderWeeklySchedule();
      openRestaurantInfoModalMod();
    }
    function closeRestaurantInfoModal() {
      closeRestaurantInfoModalMod();
    }

    // Share Restaurant URL (Web Share API with clipboard fallback)
    function shareRestaurantUrl() {
      shareRestaurantUrlMod(restaurantData ? restaurantData.name : 'Menú Digital');
    }

    // Focus Search Input (from category nav icon)
    function focusSearchInput() {
      const input = document.getElementById('searchFilter');
      if (input) {
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        setTimeout(() => input.focus(), 300);
      }
    }

    // Categories Menu Modal
    function openCategoriesMenuModal() {
      const listEl = document.getElementById('categoriesModalList');
      if (!listEl || !restaurantData) return;
      const cats = restaurantData.categories || [];
      let html = `<button type="button" onclick="selectCategoryFromModal('ALL')" style="
        display:flex; align-items:center; gap:10px; padding:12px 16px; border-radius:10px;
        border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04);
        color:#fff; font-size:0.95rem; font-weight:600; cursor:pointer; text-align:left;
        transition: background 0.2s;
      ">📋 Todos los platos</button>`;
      cats.forEach(c => {
        const icon = c.icon || '🍽️';
        const dishCount = (restaurantData.dishes || []).filter(d => d.categoryId === c.id).length;
        html += `<button type="button" onclick="selectCategoryFromModal('${escapeHtml(c.id)}')" style="
          display:flex; align-items:center; justify-content:space-between; gap:10px;
          padding:12px 16px; border-radius:10px;
          border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.04);
          color:#fff; font-size:0.95rem; font-weight:500; cursor:pointer; text-align:left;
          transition: background 0.2s;
        ">
          <span>${icon} ${escapeHtml(c.name)}</span>
          <span style="color:var(--chalk-dim); font-size:0.8rem;">${dishCount} platos</span>
        </button>`;
      });
      listEl.innerHTML = html;
      document.getElementById('categoriesListModal').classList.add('active');
    }
    function closeCategoriesMenuModal() {
      document.getElementById('categoriesListModal').classList.remove('active');
    }
    function selectCategoryFromModal(catId) {
      closeCategoriesMenuModal();
      selectCategory(catId);
      // Scroll to dishes area
      const dishesEl = document.getElementById('dishesContainer');
      if (dishesEl) {
        setTimeout(() => dishesEl.scrollIntoView({ behavior: 'smooth', block: 'start' }), 200);
      }
    }

    // Render Weekly Schedule inside Info Modal
    function renderWeeklySchedule() {
      const container = document.getElementById('weeklyScheduleList');
      if (!container || !restaurantData) return;

      const dayNames = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
      const dayNamesShort = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
      const todayIndex = new Date().getDay();

      // Check if restaurant has weekly schedule data
      const weeklySchedule = restaurantData.weeklySchedule || restaurantData.schedule;
      
      if (weeklySchedule && Array.isArray(weeklySchedule)) {
        // Use detailed weekly schedule array [{day, open, close, closed}]
        let html = '';
        weeklySchedule.forEach((entry, i) => {
          const isToday = (i === todayIndex) || (entry.day && dayNames.indexOf(entry.day) === todayIndex);
          const dayLabel = entry.day || dayNames[i] || dayNamesShort[i];
          if (entry.closed) {
            html += `<div class="schedule-day-row ${isToday ? 'today' : ''}">
              <span class="schedule-day-name">${escapeHtml(dayLabel)}</span>
              <span class="schedule-day-hours closed">Cerrado</span>
            </div>`;
          } else {
            html += `<div class="schedule-day-row ${isToday ? 'today' : ''}">
              <span class="schedule-day-name">${escapeHtml(dayLabel)}</span>
              <span class="schedule-day-hours">${escapeHtml(entry.open || '00:00')} – ${escapeHtml(entry.close || '23:59')}</span>
            </div>`;
          }
        });
        container.innerHTML = html;
      } else if (restaurantData.scheduleActiveHours) {
        // Fallback: use single scheduleActiveHours string for all days
        const hours = restaurantData.scheduleActiveHours;
        let html = '';
        dayNames.forEach((day, i) => {
          const isToday = i === todayIndex;
          html += `<div class="schedule-day-row ${isToday ? 'today' : ''}">
            <span class="schedule-day-name">${day}</span>
            <span class="schedule-day-hours">${escapeHtml(hours)}</span>
          </div>`;
        });
        container.innerHTML = html;
      } else {
        container.innerHTML = '<p style="color:var(--chalk-dim); font-size:0.85rem; padding:8px 0;">Horarios no disponibles.</p>';
      }
    }

    // Loyalty Modal placeholder (opens from loyalty banner)
    function openLoyaltyModal() {
      alert('🌟 Funcionalidad de Club de Puntos próximamente disponible.');
    }

    // Expose all interactive functions to window for HTML inline event handlers
    Object.assign(window, {
      loadMenu,
      selectCategory,
      selectCategoryFromModal,
      openCategoriesMenuModal,
      closeCategoriesMenuModal,
      filterDishes,
      clearSearchFilter,
      focusSearchInput,
      selectDietFilter,
      openDishNoteModal,
      closeDishNoteModal,
      confirmDishNote,
      addToCart,
      openCartModal,
      closeCartModal,
      handleOrderModeChange,
      handleOrderPaymentChange,
      updateDeliveryFee,
      applyCoupon,
      updateSplitCalculation,
      submitWhatsAppOrder,
      openSmartReviewModal,
      closeSmartReviewModal,
      handleStarSelect,
      handleGoogleReviewClick,
      submitPrivateFeedback,
      openReservationModal,
      closeReservationModal,
      submitReservation,
      openWifiModal,
      closeWifiModal,
      copyWifiPassword,
      stopCategoryTTS,
      pauseCategoryTTS,
      resumeCategoryTTS,
      readSelectedCategoryTTS,
      initPushPrompt,
      requestPushPermission,
      dismissPushPrompt,
      openWhatsAppChat,
      openRestaurantInfoModal,
      closeRestaurantInfoModal,
      shareRestaurantUrl,
      openLoyaltyModal,
      openWaiterModal,
      closeWaiterModal,
      sendWaiterCall,
      isMozoVirtualEnabled,
      handleMozoVirtualToggle,
      quickAddUpsellItem,
      renderUpsellSuggestions,
      // Inline handlers generados por JS (carrito y modificadores):
      changeCartQty,
      editCartItemNote,
      adjustChoiceQuantity,
      updateModifierSplitTotals,
      // Contratos que consume menu-modules.js vía window:
      renderDishes,
      updateCartUI,
      updateTotals
    });

    // Init
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      window.addEventListener('DOMContentLoaded', () => {
        loadMenu();
        initPushPrompt();
        initGlobalModalDismissMod();
      });
    } else {
      loadMenu();
      initPushPrompt();
      initGlobalModalDismissMod();
    }