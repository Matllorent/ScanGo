// State
    let restaurantData = null;
    let selectedCategory = 'ALL';
    let cart = {}; // { dishId: { dish, qty } }
    let pendingDishNoteAction = null;
    let deliveryFee = 0;
    let appliedCoupon = null; // { code: 'PROMO10', type: 'percent', value: 10 }
    let discountAmount = 0;

    // XSS Sanitizer Helper
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

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
      // Track analytics
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlug(), event: 'waiter' })
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

    // Fetch Restaurant Menu
    async function loadMenu() {
      const slug = getSlug();
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

      try {
        const res = await fetch(`/api/menu/${slug}`);
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
          localStorage.setItem('scango_cached_menu_' + slug, JSON.stringify(data.restaurant));
        } catch (e) {}
        renderHeader();
        renderCategories();
        renderDishes();
        // Track visit analytics
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, event: 'visit' })
        }).catch(() => {});
      } catch (err) {
        if (!restaurantData) {
          try {
            const cached = localStorage.getItem('scango_cached_menu_' + slug) || (slug === 'demo' ? localStorage.getItem('scango_demo_restaurant') : null);
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
      const validLayouts = ['bento', 'minimalist', 'neon'];
      const layoutClass = validLayouts.includes(restaurantData.layout) ? `layout-${restaurantData.layout}` : 'layout-classic';
      const validThemes = ['classic', 'emerald', 'rustic', 'taqueria', 'bar', 'moderna', 'foodtruck', 'gamer', 'otaku', 'explosivo', 'infantil', 'alegre', 'basketball', 'football'];
      const themeClass = validThemes.includes(restaurantData.theme) ? `theme-${restaurantData.theme}` : 'theme-emerald';
      document.body.className = `${themeClass} font-${restaurantData.themeFont || 'serif'} ${layoutClass}`;

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
      }

      // Loyalty Points Chip Visibility Control
      const loyaltyChip = document.getElementById('loyaltyChip');
      if (loyaltyChip) {
        loyaltyChip.style.display = (restaurantData.allowLoyaltyPoints === true) ? 'inline-flex' : 'none';
      }

      // Vertical / Special Features Visibility Control (Heladería & Perfumería)
      // Only show if explicitly enabled, or if businessType matches and hasn't been disabled
      const isHeladeria = restaurantData.allowIceCreamWizard === true || 
        (restaurantData.businessType === 'heladeria' && restaurantData.allowIceCreamWizard !== false);
      const isPerfumeria = restaurantData.allowPerfumery === true || 
        (['perfumery', 'perfumeria'].includes(restaurantData.businessType) && restaurantData.allowPerfumery !== false);

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

    function renderCategories() {
      const pillsContainer = document.getElementById('categoryPills');
      const cats = restaurantData.categories || [];
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

    function selectDietFilter(diet) {
      selectedDietFilter = diet;
      document.querySelectorAll('#dietaryFilterPills .cat-pill').forEach(btn => {
        const isSel = (diet === 'ALL' && btn.textContent.includes('Todos')) ||
                      (diet === 'veggie' && btn.textContent.includes('Vegetariano')) ||
                      (diet === 'vegan' && btn.textContent.includes('Vegano')) ||
                      (diet === 'celiac' && btn.textContent.includes('Sin TACC')) ||
                      (diet === 'sinlactosa' && btn.textContent.includes('Sin Lactosa')) ||
                      (diet === 'picante' && btn.textContent.includes('Picante'));
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

    // Smart Dish Scheduling Helper
    function getDishScheduleStatus(d) {
      if (!d.schedule || !d.schedule.enabled) {
        return { isAvailable: true, shouldDisplay: true };
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
      if (isAvailable) {
        return { isAvailable: true, shouldDisplay: true };
      }

      const behavior = d.schedule.behavior || 'hide';
      if (behavior === 'hide') {
        return { isAvailable: false, shouldDisplay: false };
      }

      return {
        isAvailable: false,
        shouldDisplay: true,
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
        const formattedPrice = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(d.price) 
          : `${currency} ${d.price}`;
        
        const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
        let originalPriceHtml = '';
        if (origPrice && Number(origPrice) > Number(d.price)) {
          const formattedOrig = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(origPrice) 
            : `${currency} ${origPrice}`;
          originalPriceHtml = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.8em; margin-right:4px; color:var(--chalk-dim); font-weight:normal;">${formattedOrig}</span>`;
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

      const container = document.getElementById('dishesContainer');
      const searchInput = document.getElementById('searchFilter');
      const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
      const btnClear = document.getElementById('btnClearSearch');
      if (btnClear) {
        btnClear.style.display = searchTerm.length > 0 ? 'block' : 'none';
      }

      const currency = restaurantData.currency || '$';
      const categories = restaurantData.categories || [];
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
        const popularDishes = dishes.filter(d => {
          const isStar = d.tags && d.tags.includes('star');
          const matchesSearch = !searchTerm || d.name.toLowerCase().includes(searchTerm) || (d.description && d.description.toLowerCase().includes(searchTerm));
          const sched = getDishScheduleStatus(d);
          return isStar && matchesSearch && matchesDiet(d) && sched.shouldDisplay;
        });

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

        const catDishes = dishes.filter(d => {
          const matchesCat = d.categoryId === cat.id;
          const matchesSearch = !searchTerm || d.name.toLowerCase().includes(searchTerm) || (d.description && d.description.toLowerCase().includes(searchTerm));
          const sched = getDishScheduleStatus(d);
          return matchesCat && matchesSearch && matchesDiet(d) && sched.shouldDisplay;
        });

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

      const photoHtml = d.photoUrl 
        ? `<img src="${d.photoUrl}" alt="${escapeHtml(d.name)}" class="dish-thumb" loading="lazy">` 
        : '';

      const formattedPrice = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
        ? window.i18nManager.formatPrice(d.price) 
        : `${currency} ${d.price}`;
      const displayPrice = getDishModifierGroups(d).some(group => group.kind === 'presentation')
        ? `Desde ${formattedPrice}`
        : formattedPrice;

      const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
      let priceDisplay = isSold ? '<span style="color:#E53E3E; font-size:0.85rem;">Agotado</span>' : displayPrice;
      if (!isSold && origPrice && Number(origPrice) > Number(d.price)) {
        const formattedOriginal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(origPrice) 
          : `${currency} ${origPrice}`;
        priceDisplay = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.85em; margin-right:6px; color:var(--chalk-dim); font-weight:normal;">${formattedOriginal}</span>${displayPrice}`;
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

    // Cart Handlers
    function addToCart(dishId) {
      const dish = restaurantData.dishes.find(d => d.id === dishId);
      if (!dish || dish.outOfStock) return;
      const sched = getDishScheduleStatus(dish);
      if (!sched.isAvailable) {
        alert(`Este plato no se encuentra disponible en este horario (${sched.reason || 'Fuera de horario'}).`);
        return;
      }

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
      document.getElementById('dishNoteInput').focus();
    }

    function closeDishNoteModal() {
      const modal = document.getElementById('dishNoteModal');
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      pendingDishNoteAction = null;
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
        openDishNoteModal({ mode: 'edit', cartItemId });
      }
    }

    function changeCartQty(cartItemId, delta) {
      if (!cart[cartItemId]) return;
      cart[cartItemId].qty += delta;
      if (cart[cartItemId].qty <= 0) {
        delete cart[cartItemId];
      }
      updateCartUI();
      renderDishes();
      renderCartModalList();
    }

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

      if (!items.length) {
        list.innerHTML = '<p style="color:var(--chalk-dim); text-align:center; padding:16px;">El pedido está vacío.</p>';
        updateTotals();
        return;
      }

      let html = '';
      Object.entries(cart).forEach(([cartItemId, item]) => {
        const itemDesc = item.dish.description ? `<div style="font-size:0.75rem; color:var(--chalk-dim); margin-top:2px;">${escapeHtml(item.dish.description)}</div>` : '';
        const itemNote = item.note ? `<div class="cart-item-note">Nota: ${escapeHtml(item.note)}</div>` : '';
        const optionSummary = getCartOptionSummary(item);
        const itemOptions = optionSummary ? `<div class="cart-item-options">${escapeHtml(optionSummary)}</div>` : '';
        const unitPrice = getCartUnitPrice(item);
        const formattedPrice = formatMenuPrice(unitPrice);
        const formattedLineTotal = formatMenuPrice(unitPrice * item.qty);

        html += `
          <div class="cart-item">
            <div style="flex:1; min-width:0;">
              <div class="cart-item-title">${escapeHtml(item.dish.name)}</div>
              ${itemDesc}
              ${itemOptions}
              ${itemNote}
              <div class="cart-item-price">${formattedPrice} x ${item.qty} = ${formattedLineTotal}</div>
              <button type="button" class="cart-note-edit" data-cart-id="${escapeHtml(cartItemId)}" onclick="editCartItemNote(this.dataset.cartId)">${item.note ? 'Editar nota' : 'Agregar nota'}</button>
            </div>
            <div class="cart-qty-ctrl">
              <button class="btn-qty" data-cart-id="${escapeHtml(cartItemId)}" onclick="changeCartQty(this.dataset.cartId, -1)" aria-label="Quitar una unidad">-</button>
              <span style="font-family:var(--font-mono);">${item.qty}</span>
              <button class="btn-qty" data-cart-id="${escapeHtml(cartItemId)}" onclick="changeCartQty(this.dataset.cartId, 1)" aria-label="Agregar una unidad">+</button>
            </div>
          </div>
        `;
      });
      list.innerHTML = html;
      updateTotals();
      renderUpsellSuggestions();
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
            items: items.map(item => ({
              dishId: item.dish.id,
              quantity: item.qty,
              note: item.note || '',
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

        let msg = `📋 *NUEVO PEDIDO - ${restaurantData.name.toUpperCase()}*\n`;
        msg += `👤 *Cliente:* ${customerName}\n`;
        if (mode === 'LOCAL') {
          msg += `🍽️ *Modalidad:* En el local - *${tableNumber || 'Mesa no especificada'}*\n\n`;
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
          msg += `▪ ${line.quantity}x ${line.name} - ${currency} ${line.totalItemAmount.toFixed(2)}\n`;
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

        if (notes) msg += `\n📝 *Aclaraciones:* ${notes}\n`;
        msg += `\n💵 *Subtotal:* ${currency} ${subtotal.toFixed(2)}\n`;
        if (appliedCoupon && currentDiscount > 0) msg += `🎟️ *Descuento Cupón (${appliedCoupon.code}):* -${currency} ${currentDiscount.toFixed(2)}\n`;
        if (mode === 'DELIVERY' && deliveryFee > 0) msg += `🛵 *Envío:* ${currency} ${deliveryFee}\n`;
        msg += `💰 *TOTAL A PAGAR:* ${currency} ${total.toFixed(2)}\n`;
        msg += `💳 *Método de Pago Seleccionado:* [${payment.toUpperCase()}]\n`;
        if (payment.includes('Transferencia')) msg += `ℹ️ _Se adjuntará el comprobante de transferencia por este chat._\n`;
        if (restaurantData.paymentLink) msg += `🔗 _Link de Pago:_ ${restaurantData.paymentLink}\n`;
        msg += `\n_Enviado desde ScanGo (Menú Digital)_`;

        const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');
        const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
        if (popup) popup.location = waUrl;
        else window.location.assign(waUrl);
        fetch('/api/analytics/event', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug: getSlug(), event: 'order' })
        }).catch(() => {});
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
      try {
        return localStorage.getItem('scango_mozo_virtual_enabled') !== 'false';
      } catch (e) {
        return true;
      }
    }

    function handleMozoVirtualToggle(checked) {
      try {
        localStorage.setItem('scango_mozo_virtual_enabled', checked ? 'true' : 'false');
      } catch (e) {}
      const box = document.getElementById('virtualWaiterUpsellBox');
      if (!checked) {
        if (box) box.style.display = 'none';
      } else {
        renderUpsellSuggestions();
      }
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

      // Reset UI state
      const modal = document.getElementById('smartReviewModal');
      document.getElementById('review5StarsBox').style.display = 'none';
      document.getElementById('reviewPrivateFeedbackBox').style.display = 'none';
      document.getElementById('feedbackSuccessMessage').style.display = 'none';
      document.getElementById('starHintText').textContent = 'Tocá las estrellas para calificar';

      // Reset stars
      document.querySelectorAll('.star-btn').forEach(btn => btn.classList.remove('active', 'hover-active'));

      // Set restaurant name
      const nameEl = document.getElementById('smartReviewRestName');
      if (nameEl) nameEl.textContent = restaurantData.name || 'nuestro local';

      // Set Google Maps URL for 5-star redirect
      const googleBtn = document.getElementById('btnGoogleReviewRedirect');
      if (googleBtn) googleBtn.href = restaurantData.googleReview || '#';

      // Show form
      const form = document.getElementById('privateFeedbackForm');
      if (form) { form.reset(); form.style.display = 'block'; }
      const submitBtn = document.getElementById('btnSubmitFeedback');
      if (submitBtn) { submitBtn.disabled = false; submitBtn.querySelector('span').textContent = '📩 Enviar Comentario Privado a la Gerencia'; }

      modal.classList.add('active');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeSmartReviewModal() {
      const modal = document.getElementById('smartReviewModal');
      modal.classList.remove('active');
      modal.setAttribute('aria-hidden', 'true');
      selectedStarRating = 0;
    }

    function handleStarSelect(rating) {
      selectedStarRating = rating;

      // Highlight stars up to selected
      document.querySelectorAll('.star-btn').forEach(btn => {
        const star = parseInt(btn.dataset.star);
        btn.classList.toggle('active', star <= rating);
      });

      const hintTexts = ['', '😞 Muy mala', '😕 Regular', '🙂 Buena', '😊 Muy buena', '🤩 ¡Excelente!'];
      document.getElementById('starHintText').textContent = hintTexts[rating] || '';

      // Branch logic: 5 stars → Google Maps, 1-4 → private feedback
      if (rating === 5) {
        document.getElementById('review5StarsBox').style.display = 'block';
        document.getElementById('reviewPrivateFeedbackBox').style.display = 'none';
      } else {
        document.getElementById('review5StarsBox').style.display = 'none';
        document.getElementById('reviewPrivateFeedbackBox').style.display = 'block';
      }
    }

    function handleGoogleReviewClick() {
      // Track the click
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlug(), event: 'google_review_click' })
      }).catch(() => {});
    }

    async function submitPrivateFeedback(e) {
      e.preventDefault();
      const btn = document.getElementById('btnSubmitFeedback');
      if (btn) { btn.disabled = true; btn.querySelector('span').textContent = '⏳ Enviando...'; }

      const comment = document.getElementById('feedbackCommentInput').value.trim();
      const customerName = document.getElementById('feedbackNameInput').value.trim();
      const customerContact = document.getElementById('feedbackContactInput').value.trim();

      if (!comment) {
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = '📩 Enviar Comentario Privado a la Gerencia'; }
        alert('Por favor escribí un comentario antes de enviar.');
        return;
      }

      try {
        const response = await fetch('/api/reviews/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurantId: restaurantData.id,
            rating: selectedStarRating,
            comment,
            customerName: customerName || 'Anónimo',
            customerContact: customerContact || ''
          })
        });

        if (response.ok) {
          // Show success, hide form
          document.getElementById('privateFeedbackForm').style.display = 'none';
          document.getElementById('feedbackSuccessMessage').style.display = 'block';

          // Track event
          fetch('/api/analytics/event', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slug: getSlug(), event: 'private_feedback' })
          }).catch(() => {});
        } else {
          const data = await response.json().catch(() => ({}));
          alert(data.error || 'No se pudo enviar el comentario. Intentá nuevamente.');
          if (btn) { btn.disabled = false; btn.querySelector('span').textContent = '📩 Enviar Comentario Privado a la Gerencia'; }
        }
      } catch (err) {
        alert('Error de conexión. Por favor, intentá nuevamente.');
        if (btn) { btn.disabled = false; btn.querySelector('span').textContent = '📩 Enviar Comentario Privado a la Gerencia'; }
      }
    }

    // Hover effect for stars
    (function initStarHover() {
      const wrap = document.getElementById('starsSelectorWrap');
      if (!wrap) return;
      wrap.addEventListener('mouseover', e => {
        const btn = e.target.closest('.star-btn');
        if (!btn) return;
        const hoverStar = parseInt(btn.dataset.star);
        document.querySelectorAll('.star-btn').forEach(b => {
          b.classList.toggle('hover-active', parseInt(b.dataset.star) <= hoverStar);
        });
      });
      wrap.addEventListener('mouseout', () => {
        document.querySelectorAll('.star-btn').forEach(b => {
          b.classList.remove('hover-active');
        });
      });
    })();

    // Reservation Modal Logic
    function openReservationModal() {
      const today = new Date().toISOString().split('T')[0];
      const dateInput = document.getElementById('resDate');
      if (dateInput) {
        dateInput.min = today;
        if (!dateInput.value) dateInput.value = today;
      }
      document.getElementById('reservationModal').classList.add('active');
    }

    function closeReservationModal() {
      document.getElementById('reservationModal').classList.remove('active');
    }

    function submitReservation(e) {
      e.preventDefault();
      const submitBtn = e.target.querySelector('button[type="submit"]');
      const originalText = submitBtn ? submitBtn.innerHTML : '';
      if (submitBtn) {
        if (submitBtn.disabled || submitBtn.dataset.busy === 'true') return;
        submitBtn.disabled = true;
        submitBtn.dataset.busy = 'true';
        submitBtn.innerHTML = '<span>⏳ Conectando con WhatsApp...</span>';
      }

      const name = document.getElementById('resName').value.trim();
      const date = document.getElementById('resDate').value;
      const time = document.getElementById('resTime').value;
      const guests = document.getElementById('resGuests').value;
      const notes = document.getElementById('resNotes').value.trim();

      let msg = `📅 *SOLICITUD DE RESERVA - ${restaurantData.name.toUpperCase()}*\n\n`;
      msg += `👤 *Titular:* ${name}\n`;
      msg += `📆 *Fecha:* ${date}\n`;
      msg += `⏰ *Hora:* ${time} hs\n`;
      msg += `👥 *Comensales:* ${guests}\n`;
      if (notes) {
        msg += `📝 *Observaciones:* ${notes}\n`;
      }
      msg += `\n_¿Tienen disponibilidad para confirmar la reserva?_\n`;
      msg += `_Enviado desde ScanGo_`;

      const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');
      const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
      // Track reservation analytics
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlug(), event: 'reservation' })
      }).catch(() => {});
      window.open(waUrl, '_blank');

      setTimeout(() => {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.dataset.busy = 'false';
          submitBtn.innerHTML = originalText;
        }
        closeReservationModal();
      }, 1500);
    }

    // Wi-Fi Modal
    function openWifiModal() {
      document.getElementById('wifiModal').classList.add('active');
    }
    function closeWifiModal() {
      document.getElementById('wifiModal').classList.remove('active');
    }
    function copyWifiPassword() {
      const pass = restaurantData.wifi ? restaurantData.wifi.password : '';
      if (navigator.clipboard) {
        navigator.clipboard.writeText(pass).then(() => alert('Contraseña copiada al portapapeles'));
      } else {
        prompt('Copia la contraseña:', pass);
      }
    }

    // TTS Accessibility
    function readSelectedCategoryTTS() {
      if (!('speechSynthesis' in window)) {
        alert('La síntesis de voz no está soportada en este navegador.');
        return;
      }
      const category = selectedCategory === 'ALL' 
        ? 'Todos los platos disponibles' 
        : (restaurantData.categories.find(c => c.id === selectedCategory) || {}).name;
      
      const dishes = restaurantData.dishes.filter(d => selectedCategory === 'ALL' || d.categoryId === selectedCategory);
      let text = `Estás escuchando la sección ${category}. `;
      dishes.forEach(d => {
        text += `${d.name}, precio ${d.price} pesos. ${d.description || ''}. `;
      });

      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'es-ES';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utter);
    }

    // Push Notifications Prompt & Permissions
    function initPushPrompt() {
      const pushStatus = localStorage.getItem('scango_push_status');
      if (pushStatus === 'granted' || pushStatus === 'dismissed' || pushStatus === 'denied') {
        return;
      }
      setTimeout(() => {
        const banner = document.getElementById('pushPromptBanner');
        if (banner) banner.style.display = 'flex';
      }, 2500);
    }

    async function requestPushPermission() {
      const banner = document.getElementById('pushPromptBanner');
      if (banner) banner.style.display = 'none';

      try {
        if ('Notification' in window) {
          const perm = await Notification.requestPermission();
          localStorage.setItem('scango_push_status', perm);
          if (perm === 'granted') {
            localStorage.setItem('scango_push_subscribed', 'true');
            showPushToast('¡Notificaciones activadas! Te avisaremos de novedades y tus pedidos 🔔');
          }
        } else {
          localStorage.setItem('scango_push_status', 'granted');
          localStorage.setItem('scango_push_subscribed', 'true');
          showPushToast('¡Notificaciones activadas con éxito! 🔔');
        }
      } catch (e) {
        localStorage.setItem('scango_push_status', 'granted');
        localStorage.setItem('scango_push_subscribed', 'true');
        showPushToast('¡Notificaciones activadas con éxito! 🔔');
      }
    }

    function dismissPushPrompt() {
      const banner = document.getElementById('pushPromptBanner');
      if (banner) banner.style.display = 'none';
      localStorage.setItem('scango_push_status', 'dismissed');
    }

    function showPushToast(msg) {
      let toast = document.getElementById('pushToastFeedback');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'pushToastFeedback';
        toast.style.cssText = 'position:fixed; top:20px; left:50%; transform:translateX(-50%); background:#2D3748; color:#ECC94B; border:1px solid #ECC94B; border-radius:30px; padding:10px 20px; font-size:0.85rem; font-weight:700; z-index:9999; box-shadow:0 8px 24px rgba(0,0,0,0.5); display:flex; align-items:center; gap:8px; animation:slideDown 0.3s ease;';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = 'flex';
      setTimeout(() => {
        if (toast) toast.style.display = 'none';
      }, 3500);
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
      // Populate address
      const addrEl = document.getElementById('infoAddressFullText');
      if (addrEl && restaurantData) {
        addrEl.textContent = restaurantData.address || 'Dirección no disponible';
      }
      // Populate delivery time in modal
      const dtModal = document.getElementById('infoDeliveryTimeModal');
      if (dtModal && restaurantData) {
        dtModal.textContent = restaurantData.deliveryTime || '30 - 45min.';
      }
      // Render weekly schedule
      renderWeeklySchedule();
      document.getElementById('restaurantInfoModal').classList.add('active');
    }
    function closeRestaurantInfoModal() {
      document.getElementById('restaurantInfoModal').classList.remove('active');
    }

    // Share Restaurant URL (Web Share API with clipboard fallback)
    function shareRestaurantUrl() {
      const url = window.location.href;
      const title = restaurantData ? restaurantData.name : 'Menú Digital';
      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(() => {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(() => {
          alert('¡Enlace copiado al portapapeles!');
        }).catch(() => {
          prompt('Copiá el enlace:', url);
        });
      } else {
        prompt('Copiá el enlace:', url);
      }
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

    // Init
    window.addEventListener('DOMContentLoaded', () => {
      loadMenu();
      initPushPrompt();
    });