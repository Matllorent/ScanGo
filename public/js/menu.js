// State
    let restaurantData = null;
    let selectedCategory = 'ALL';
    let cart = {}; // { dishId: { dish, qty } }
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

      // Apply 14 Authentic & Special Themes & Fonts to body
      const validThemes = ['classic', 'emerald', 'rustic', 'taqueria', 'bar', 'moderna', 'foodtruck', 'gamer', 'otaku', 'explosivo', 'infantil', 'alegre', 'basketball', 'football'];
      const themeClass = validThemes.includes(restaurantData.theme) ? `theme-${restaurantData.theme}` : 'theme-emerald';
      document.body.className = `${themeClass} font-${restaurantData.themeFont || 'serif'}`;

      if (restaurantData.logoUrl) {
        document.getElementById('restaurantLogoContainer').innerHTML = `
          <img src="${restaurantData.logoUrl}" alt="Logo" class="restaurant-logo">
        `;
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

      // Google Reviews Link Chip
      const gReviewChip = document.getElementById('googleReviewChip');
      if (gReviewChip) {
        if (restaurantData.googleReview) {
          gReviewChip.style.display = 'inline-flex';
          gReviewChip.href = restaurantData.googleReview;
        } else {
          gReviewChip.style.display = 'none';
        }
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
        (restaurantData.businessType === 'perfumeria' && restaurantData.allowPerfumery !== false);

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
        const inCart = cart[d.id] ? cart[d.id].qty : 0;
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
      const inCart = cart[d.id] ? cart[d.id].qty : 0;
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

      const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
      let priceDisplay = isSold ? '<span style="color:#E53E3E; font-size:0.85rem;">Agotado</span>' : formattedPrice;
      if (!isSold && origPrice && Number(origPrice) > Number(d.price)) {
        const formattedOriginal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(origPrice) 
          : `${currency} ${origPrice}`;
        priceDisplay = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.85em; margin-right:6px; color:var(--chalk-dim); font-weight:normal;">${formattedOriginal}</span>${formattedPrice}`;
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

      if (!cart[dishId]) {
        cart[dishId] = { dish, qty: 1 };
      } else {
        cart[dishId].qty += 1;
      }
      updateCartUI();
      renderDishes();
    }

    function changeCartQty(dishId, delta) {
      if (!cart[dishId]) return;
      cart[dishId].qty += delta;
      if (cart[dishId].qty <= 0) {
        delete cart[dishId];
      }
      updateCartUI();
      renderDishes();
      renderCartModalList();
    }

    function updateCartUI() {
      const totalCount = Object.values(cart).reduce((sum, item) => sum + item.qty, 0);
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * item.dish.price), 0);
      const currency = restaurantData.currency || '$';
      const formattedSubtotal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
        ? window.i18nManager.formatPrice(subtotal) 
        : `${currency} ${subtotal}`;

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
      items.forEach(item => {
        const itemDesc = item.dish.description ? `<div style="font-size:0.75rem; color:var(--chalk-dim); margin-top:2px;">${escapeHtml(item.dish.description)}</div>` : '';
        const formattedPrice = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(item.dish.price) 
          : `${currency} ${item.dish.price}`;
        const formattedLineTotal = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
          ? window.i18nManager.formatPrice(item.dish.price * item.qty) 
          : `${currency} ${item.dish.price * item.qty}`;

        html += `
          <div class="cart-item">
            <div style="flex:1; min-width:0;">
              <div class="cart-item-title">${escapeHtml(item.dish.name)}</div>
              ${itemDesc}
              <div class="cart-item-price">${formattedPrice} x ${item.qty} = ${formattedLineTotal}</div>
            </div>
            <div class="cart-qty-ctrl">
              <button class="btn-qty" data-dish-id="${escapeHtml(item.dish.id)}" onclick="changeCartQty(this.dataset.dishId, -1)">-</button>
              <span style="font-family:var(--font-mono);">${item.qty}</span>
              <button class="btn-qty" data-dish-id="${escapeHtml(item.dish.id)}" onclick="changeCartQty(this.dataset.dishId, 1)">+</button>
            </div>
          </div>
        `;
      });
      list.innerHTML = html;
      updateTotals();
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
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * item.dish.price), 0);
      const mode = document.getElementById('orderMode').value;

      const formatP = (amt) => (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
        ? window.i18nManager.formatPrice(amt) 
        : `${currency} ${amt}`;

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
      const subtotal = Object.values(cart).reduce((sum, item) => sum + (item.qty * item.dish.price), 0);
      const mode = document.getElementById('orderMode').value;
      const currentDelivery = (mode === 'DELIVERY' ? deliveryFee : 0);
      const total = Math.max(0, subtotal + currentDelivery - discountAmount);

      const perPerson = Math.ceil(total / Math.max(1, count));
      const display = document.getElementById('splitPerPersonDisplay');
      if (display) {
        display.textContent = `${currency} ${perPerson} c/u (${count} personas)`;
      }
    }

    function submitWhatsAppOrder() {
      const items = Object.values(cart);
      if (!items.length) {
        alert('Por favor agrega platos a tu pedido primero.');
        return;
      }

      // UX Resilience: Prevent double-click
      const btn = document.getElementById('btnSubmitOrderWA');
      if (btn) {
        if (btn.dataset.submitting === 'true') return;
        btn.dataset.submitting = 'true';
        btn.disabled = true;
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>⏳ Conectando con WhatsApp...</span>';
        setTimeout(() => {
          btn.disabled = false;
          btn.dataset.submitting = 'false';
          btn.innerHTML = originalHtml;
        }, 3500);
      }

      const mode = document.getElementById('orderMode').value;
      const customerName = document.getElementById('orderCustomerName').value.trim() || 'Cliente';
      const notes = document.getElementById('orderNotes').value.trim();
      const payment = document.getElementById('orderPayment').value;
      const currency = restaurantData.currency || '$';
      const subtotal = items.reduce((sum, item) => sum + (item.qty * item.dish.price), 0);
      const currentDelivery = (mode === 'DELIVERY' ? deliveryFee : 0);
      const total = Math.max(0, subtotal + currentDelivery - discountAmount);

      let msg = `📋 *NUEVO PEDIDO - ${restaurantData.name.toUpperCase()}*\n`;
      msg += `👤 *Cliente:* ${customerName}\n`;

      if (mode === 'LOCAL') {
        const table = document.getElementById('orderTable').value.trim() || 'Mesa no especificada';
        msg += `🍽️ *Modalidad:* En el local - *${table}*\n\n`;
      } else if (mode === 'TAKEAWAY') {
        msg += `🛍️ *Modalidad:* Retiro en el local (Take Away)\n\n`;
      } else {
        const zoneSelect = document.getElementById('deliveryZoneSelect');
        const zoneName = zoneSelect.options[zoneSelect.selectedIndex].text;
        const address = document.getElementById('orderAddress').value.trim() || 'Dirección no especificada';
        msg += `🛵 *Modalidad:* Envío a Domicilio\n`;
        msg += `📍 *Zona:* ${zoneName}\n`;
        msg += `🏠 *Dirección:* ${address}\n\n`;
      }

      msg += `*DETALLE DEL PEDIDO:*\n`;
      items.forEach(it => {
        msg += `▪ ${it.qty}x ${it.dish.name} - ${currency} ${it.dish.price * it.qty}\n`;
        if (it.dish.description && (it.dish.isCustomIceCream || (it.dish.id && it.dish.id.startsWith('perfume_')))) {
          msg += `   ↳ _${it.dish.description}_\n`;
        }
      });

      if (notes) {
        msg += `\n📝 *Aclaraciones:* ${notes}\n`;
      }

      msg += `\n💵 *Subtotal:* ${currency} ${subtotal}\n`;
      if (appliedCoupon && discountAmount > 0) {
        msg += `🎟️ *Descuento Cupón (${appliedCoupon.code}):* -${currency} ${discountAmount}\n`;
      }
      if (mode === 'DELIVERY' && deliveryFee > 0) {
        msg += `🛵 *Envío:* ${currency} ${deliveryFee}\n`;
      }
      msg += `💰 *TOTAL A PAGAR:* ${currency} ${total}\n`;
      msg += `💳 *Método de Pago Seleccionado:* [${payment.toUpperCase()}]\n`;
      if (payment.includes('Transferencia')) {
        msg += `ℹ️ _Se adjuntará el comprobante de transferencia por este chat._\n`;
      }
      if (restaurantData.paymentLink) {
        msg += `🔗 _Link de Pago:_ ${restaurantData.paymentLink}\n`;
      }
      msg += `\n_Enviado desde ScanGo (Menú Digital)_`;

      const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');
      const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;
      // Track order analytics
      fetch('/api/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlug(), event: 'order' })
      }).catch(() => {});
      window.open(waUrl, '_blank');
    }

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

    // Init
    window.addEventListener('DOMContentLoaded', () => {
      loadMenu();
      initPushPrompt();
    });