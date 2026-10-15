/**
 * public/js/menu/menuHeader.js
 * ────────────────────────────
 * Header del menú público (extraído de menu.js sin cambios de
 * comportamiento: misma lógica, mismas strings, mismo orden). Título,
 * layout/temas (?theme=/morph=?neon=), neón, tema de evento, itinerario,
 * hero/banner, chips (reserva/wifi/social/pago/splitter/loyalty), badge
 * abierto-cerrado, mesa ?mesa=, CTA heladería y perfumería. Todo el estado
 * de menu.js llega por `ctx`:
 * {
 *   getRestaurantData, renderWeddingItinerary, renderGuestInvite,
 *   areMenuOrdersEnabled, updateTableServiceUI
 * }
 * Sin imports fuera de public/js. Sin DOM en import (seguro en Node).
 */
import { escapeHtml } from '../utils/escapeHtmlBrowser.js';
import {
  resolveNeonAccent,
  normalizeNeonHex,
  neonHexToRgb,
  resolveIceCreamButtonStyle
} from './menuPresentation.js';
import { resolveEventTheme } from './eventGuestMode.js';
import { computeOpenStatus } from './openStatus.js';

    function renderHeader(ctx) {
      document.title = `${ctx.getRestaurantData().name} — Menú Digital`;
      document.getElementById('restaurantName').textContent = ctx.getRestaurantData().name;
      document.getElementById('restaurantSlogan').textContent = ctx.getRestaurantData().slogan || 'Carta Gastronómica';

      // Apply Layout Morphology & 14 Authentic Classic Themes + 6 Heladería themes & Fonts to body
      const validLayouts = ['classic', 'bento', 'minimalist', 'neon', 'billboard', 'ticker', 'sticker', 'delivery', 'stories'];
      const morphParam = new URLSearchParams(window.location.search).get('morph');
      let layout = ctx.getRestaurantData().layout;
      if (morphParam && validLayouts.includes(morphParam)) {
        layout = morphParam;
      }
      const layoutClass = validLayouts.includes(layout) ? `layout-${layout}` : 'layout-classic';
      const validThemes = ['classic', 'emerald', 'rustic', 'taqueria', 'bar', 'moderna', 'foodtruck', 'gamer', 'otaku', 'explosivo', 'infantil', 'alegre', 'basketball', 'football', 'smash-urban', 'glass-gastro', 'ticket', 'helado-fiesta', 'helado-menta', 'helado-tropical', 'helado-pastel', 'gelateria', 'cioccolato', 'helado-fresa', 'helado-dulce', 'helado-pistacho', 'helado-cielo', 'helado-mora', 'helado-crema'];
      // Heladería SOLO viste sus 12 temas: si el dato viene con un theme de
      // restaurante (cuenta vieja o payload manual), se corrige a fiesta en el
      // render para que el comensal siempre vea estética de heladería.
      const HELADERIA_ONLY = ['helado-fiesta', 'helado-menta', 'helado-tropical', 'helado-pastel', 'gelateria', 'cioccolato', 'helado-fresa', 'helado-dulce', 'helado-pistacho', 'helado-cielo', 'helado-mora', 'helado-crema'];
      let effectiveTheme = ctx.getRestaurantData().theme;
      if (ctx.getRestaurantData().businessType === 'heladeria' && !HELADERIA_ONLY.includes(effectiveTheme)) {
        effectiveTheme = 'helado-fiesta';
      }
      // Preview ?theme=<clave> (espejo de ?morph= y ?neon=): el dueño prueba
      // estéticas desde un link sin guardar nada. Solo claves válidas, y en
      // heladería SOLO las 12 propias: el lockdown no tiene excepciones ni
      // siquiera por preview (?theme=classic en heladería → fiesta).
      const themeParam = new URLSearchParams(window.location.search).get('theme');
      if (themeParam && validThemes.includes(themeParam)) {
        if (ctx.getRestaurantData().businessType === 'heladeria' && !HELADERIA_ONLY.includes(themeParam)) {
          effectiveTheme = 'helado-fiesta';
        } else {
          effectiveTheme = themeParam;
        }
      }
      const themeClass = validThemes.includes(effectiveTheme) ? `theme-${effectiveTheme}` : 'theme-emerald';
      document.body.className = `${themeClass} font-${ctx.getRestaurantData().themeFont || 'serif'} ${layoutClass}`;

      // === NEON ACCENT: color elegible del layout Neon Nightbar (?neon= para previsualizar)
      // El preset pone la clase neon-<clave>; el color libre (picker HEX del
      // dueño o ?neon=%23RRGGBB) lo pisa vía variables inline --neon/--neon-rgb.
      if (layoutClass === 'layout-neon') {
        const neonParam = new URLSearchParams(window.location.search).get('neon');
        const paramHex = normalizeNeonHex(neonParam);
        const baseKey = resolveNeonAccent(paramHex ? ctx.getRestaurantData().neonAccent : (neonParam || ctx.getRestaurantData().neonAccent));
        document.body.classList.add(`neon-${baseKey}`);
        const customHex = paramHex || normalizeNeonHex(ctx.getRestaurantData().neonCustomColor);
        if (customHex) {
          const customRgb = neonHexToRgb(customHex);
          try {
            document.body.style.setProperty('--neon', customHex);
            if (customRgb) document.body.style.setProperty('--neon-rgb', customRgb);
          } catch (e) {}
        } else {
          try {
            document.body.style.removeProperty('--neon');
            document.body.style.removeProperty('--neon-rgb');
          } catch (e) {}
        }
      } else {
        try {
          document.body.style.removeProperty('--neon');
          document.body.style.removeProperty('--neon-rgb');
        } catch (e) {}
      }

      // === EVENT VISUAL THEMES: Aplicar tema visual cuando businessType='events' o ?event= parámetro
      const eventThemeClass = resolveEventTheme(ctx.getRestaurantData(), window.location.search);
      if (eventThemeClass) {
        document.body.classList.add(eventThemeClass);
      }

      // === WEDDING ITINERARY: sección data-driven (dueño la configura en Studio)
      ctx.renderWeddingItinerary();

      // === GUEST HERO: bienvenida al invitado (solo eventos con ?invitado=)
      ctx.renderGuestInvite();

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
        if (ctx.getRestaurantData().bannerUrl) {
          const bannerSrc = escapeHtml(ctx.getRestaurantData().bannerUrl);
          bannerEl.style.display = 'block';
          bannerEl.innerHTML = `
            <div class="menu-banner-media">
              <img src="${bannerSrc}" alt="Portada de ${escapeHtml(ctx.getRestaurantData().name)}" class="menu-banner-img" loading="eager" decoding="async" fetchpriority="high" style="aspect-ratio:16/9">
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

      if (ctx.getRestaurantData().logoUrl) {
        logoContainer.innerHTML = `
          <img src="${escapeHtml(ctx.getRestaurantData().logoUrl)}" alt="Logo" class="restaurant-logo">
        `;
      } else {
        logoContainer.innerHTML = '';
      }

      // Show or Hide Reservation Chip strictly
      const resChip = document.getElementById('reservationChip');
      if (resChip) {
        resChip.style.display = (ctx.getRestaurantData().allowReservations !== false) ? 'inline-flex' : 'none';
      }

      // Wi-Fi Chip
      if (ctx.getRestaurantData().wifi && ctx.getRestaurantData().wifi.ssid) {
        const wifiChip = document.getElementById('wifiChip');
        wifiChip.style.display = 'inline-flex';
        document.getElementById('wifiSsidDisplay').textContent = ctx.getRestaurantData().wifi.ssid;
        document.getElementById('wifiPassDisplay').textContent = ctx.getRestaurantData().wifi.password || '(Sin clave)';
      }

      // Instagram Link Chip
      const instaChip = document.getElementById('instagramChip');
      if (instaChip) {
        if (ctx.getRestaurantData().instagram) {
          instaChip.style.display = 'inline-flex';
          instaChip.href = `https://instagram.com/${ctx.getRestaurantData().instagram.replace('@', '')}`;
          document.getElementById('instagramText').textContent = `@${ctx.getRestaurantData().instagram.replace('@', '')}`;
        } else {
          instaChip.style.display = 'none';
        }
      }

      // Google Reviews / Smart Feedback Chip (shows if googleReview URL is configured)
      const gReviewChip = document.getElementById('googleReviewChip');
      if (gReviewChip) {
        gReviewChip.style.display = ctx.getRestaurantData().googleReview ? 'inline-flex' : 'none';
      }

      // Coupon Box Visibility Control
      const couponBox = document.getElementById('couponSectionBox');
      if (couponBox) {
        couponBox.style.display = (ctx.getRestaurantData().allowCoupons !== false) ? 'block' : 'none';
      }

      // Phone & Address
      if (ctx.getRestaurantData().phone) {
        const pChip = document.getElementById('phoneChip');
        pChip.style.display = 'inline-flex';
        document.getElementById('phoneText').textContent = ctx.getRestaurantData().phone;
      }

      // Announcement Banner
      const banner = document.getElementById('announcementBanner');
      const bannerText = document.getElementById('announcementBannerText');
      if (banner && bannerText) {
        if (ctx.getRestaurantData().announcement && ctx.getRestaurantData().announcement.trim()) {
          banner.style.display = 'flex';
          bannerText.textContent = `📢 ${ctx.getRestaurantData().announcement.trim()}`;
        } else {
          banner.style.display = 'none';
        }
      }

      // Pago online del comensal (SOLO si el dueño lo habilitó).
      // Si el interruptor está apagado, la opción de pago online se elimina
      // del select y nunca se muestra el box de cobro.
      const onlinePayOpt = document.getElementById('payOptionOnline');
      if (onlinePayOpt && ctx.getRestaurantData().allowOnlinePayment !== true) {
        onlinePayOpt.remove();
        const paySelect = document.getElementById('orderPayment');
        if (paySelect && String(paySelect.value).includes('Mercado Pago')) paySelect.value = 'Efectivo';
      }
      const payBox = document.getElementById('externalPaymentBox');
      if (payBox) payBox.style.display = 'none';

      // Bill Splitter Feature Check
      const billSplitterSection = document.getElementById('billSplitterSection');
      if (billSplitterSection) {
        billSplitterSection.style.display = (ctx.getRestaurantData().allowBillSplitter !== false) ? 'block' : 'none';
      }

      // Open / Closed Real-time Status Badge
      // El override manual `forceClosed` del dueño gana siempre: ni el horario
      // configurado lo reabre (feriados e imprevistos sin tocar la franja).
      const statusBadge = document.getElementById('statusOpenClosedBadge');
      if (statusBadge) {
        if (ctx.getRestaurantData().forceClosed === true) {
          statusBadge.style.display = 'inline-flex';
          statusBadge.style.background = 'rgba(229,62,62,0.15)';
          statusBadge.style.borderColor = 'rgba(229,62,62,0.4)';
          statusBadge.style.color = '#FC8181';
          statusBadge.innerHTML = '<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#E53E3E; margin-right:6px;"></span> Cerrado por el momento';
        } else if (ctx.getRestaurantData().scheduleEnabled && ctx.getRestaurantData().scheduleActiveHours) {
          // Badge con la MISMA regla del checkout (espejo ESM openStatus):
          // rango invertido = ventana nocturna, forceClosed ya se cubrió arriba.
          const st = computeOpenStatus(ctx.getRestaurantData(), -new Date().getTimezoneOffset());
          statusBadge.style.display = 'inline-flex';
          if (st.open) {
            statusBadge.style.background = 'rgba(72,187,120,0.15)';
            statusBadge.style.borderColor = 'rgba(72,187,120,0.4)';
            statusBadge.style.color = '#48BB78';
            statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#48BB78; margin-right:6px; box-shadow:0 0 6px #48BB78;"></span> Abierto (${ctx.getRestaurantData().scheduleActiveHours} hs)`;
          } else {
            statusBadge.style.background = 'rgba(229,62,62,0.15)';
            statusBadge.style.borderColor = 'rgba(229,62,62,0.4)';
            statusBadge.style.color = '#FC8181';
            statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#E53E3E; margin-right:6px;"></span> Cerrado (${ctx.getRestaurantData().scheduleActiveHours} hs)`;
          }
        } else {
          statusBadge.style.display = 'inline-flex';
          statusBadge.style.background = 'rgba(72,187,120,0.15)';
          statusBadge.style.borderColor = 'rgba(72,187,120,0.4)';
          statusBadge.style.color = '#48BB78';
          statusBadge.innerHTML = `<span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:#48BB78; margin-right:6px; box-shadow:0 0 6px #48BB78;"></span> Abierto para pedidos`;
        }
      }

      // Auto-detect Mesa / Table Query Param (?mesa=N or ?table=N): prefill de
      // mesa + auto-conexión al grupo. La visibilidad del FAB la gobierna
      // updateTableServiceUI (contexto de mesa + flags del dueño).
      const urlParams = new URLSearchParams(window.location.search);
      const mesaParam = urlParams.get('mesa') || urlParams.get('table');

      if (mesaParam) {
        const orderTable = document.getElementById('orderTable');
        const waiterTableNum = document.getElementById('waiterTableNum');
        if (orderTable && !orderTable.value) orderTable.value = `Mesa ${mesaParam}`;
        if (waiterTableNum && !waiterTableNum.value) waiterTableNum.value = `Mesa ${mesaParam}`;

        // Auto-conectar dispositivos de la mesa al Pedido Grupal en Tiempo Real
        // (solo con pedidos habilitados: en vitrina no hay nada que consolidar).
        if (ctx.areMenuOrdersEnabled() && typeof window.initGroupCartManager === 'function') {
          window.initGroupCartManager();
        }
      }
      ctx.updateTableServiceUI();

      // Loyalty Points Chip Visibility Control
      const loyaltyChip = document.getElementById('loyaltyChip');
      if (loyaltyChip) {
        loyaltyChip.style.display = (ctx.getRestaurantData().allowLoyaltyPoints === true) ? 'inline-flex' : 'none';
      }

      // Vertical / Special Features Visibility Control (Heladería & Perfumería)
      // Strictly modular by businessType: restaurants and events do not have ice cream or perfumery enabled
      // isHeladeria: el backend normaliza 'heladeria' y define allowIceCreamWizard (true por
      // defecto; ver normalizeRestaurantBusinessType en src/db/db.js). El flag es la señal
      // real: un `false` explícito del dueño apaga el asistente aunque el rubro sea heladería.
      const isHeladeria = ctx.getRestaurantData().allowIceCreamWizard === true;
      const isPerfumeria = ['perfumery', 'perfumeria'].includes(ctx.getRestaurantData().businessType) && ctx.getRestaurantData().allowPerfumery !== false;

      // CTA protagonista de heladería: ÚNICO acceso al armador (se eliminó el botón
      // duplicado de la barra de accesos). El texto es configurable por el dueño
      // (restaurant.iceCreamBuilderLabel); si está vacío, queda el default del HTML.
      const iceCreamHero = document.getElementById('iceCreamHeroCTA');
      if (iceCreamHero) {
        // Vitrina: sin pedidos no hay nada que armar (el CTA lleva al wizard).
        const ordersOn = typeof areMenuOrdersEnabled === 'function' ? ctx.areMenuOrdersEnabled() : true;
        iceCreamHero.style.display = (isHeladeria && ordersOn) ? 'flex' : 'none';
        const heroLabel = document.getElementById('iceCreamHeroLabel');
        if (heroLabel) {
          const customLabel = String(ctx.getRestaurantData().iceCreamBuilderLabel || '').trim();
          heroLabel.textContent = customLabel || 'Armá tu helado a medida';
        }
        // Estilo del botón elegido por el dueño (6 variantes premium de heladería).
        // Se resetean las clases style-* anteriores para no acumular estilos.
        try {
          const btnStyle = resolveIceCreamButtonStyle(ctx.getRestaurantData().iceCreamButtonStyle);
          iceCreamHero.classList.remove('style-clasico', 'style-fiesta', 'style-premium', 'style-tropical', 'style-nube', 'style-noche');
          iceCreamHero.classList.add(`style-${btnStyle}`);
          iceCreamHero.dataset.iceStyle = btnStyle;
        } catch (e) {}
      }

      const btnPerf = document.getElementById('btnTogglePerfumeryMode');
      if (btnPerf) {
        btnPerf.style.display = isPerfumeria ? 'inline-flex' : 'none';
      }

      const specialBar = document.getElementById('specialActionsBar');
      if (specialBar) {
        specialBar.style.display = isPerfumeria ? 'flex' : 'none';
      }

      if (ctx.getRestaurantData().address) {
        const aChip = document.getElementById('addressChip');
        aChip.style.display = 'inline-flex';
        document.getElementById('addressText').textContent = ctx.getRestaurantData().address;
      }

      // === NEW: Loyalty Top Banner Visibility ===
      const loyaltyBanner = document.getElementById('loyaltyTopBanner');
      if (loyaltyBanner) {
        loyaltyBanner.style.display = (ctx.getRestaurantData().allowLoyaltyPoints === true) ? 'flex' : 'none';
      }

      // === NEW: Header Social Links ===
      const hdrWa = document.getElementById('hdrSocialWa');
      const hdrIg = document.getElementById('hdrSocialIg');
      const hdrFb = document.getElementById('hdrSocialFb');
      const hdrTk = document.getElementById('hdrSocialTk');

      if (hdrWa) {
        if (ctx.getRestaurantData().phone) {
          hdrWa.style.display = 'inline-flex';
        } else {
          hdrWa.style.display = 'none';
        }
      }
      if (hdrIg) {
        if (ctx.getRestaurantData().instagram) {
          hdrIg.href = `https://instagram.com/${ctx.getRestaurantData().instagram.replace('@', '')}`;
          hdrIg.style.display = 'inline-flex';
        } else {
          hdrIg.style.display = 'none';
        }
      }
      if (hdrFb) {
        if (/^https?:\/\//i.test(ctx.getRestaurantData().facebook || '')) {
          hdrFb.href = ctx.getRestaurantData().facebook;
          hdrFb.style.display = 'inline-flex';
        } else {
          hdrFb.style.display = 'none';
        }
      }
      if (hdrTk) {
        if (/^https?:\/\//i.test(ctx.getRestaurantData().tiktok || '')) {
          hdrTk.href = ctx.getRestaurantData().tiktok;
          hdrTk.style.display = 'inline-flex';
        } else {
          hdrTk.style.display = 'none';
        }
      }
      const hdrX = document.getElementById('hdrSocialX');
      if (hdrX) {
        if (/^https?:\/\//i.test(ctx.getRestaurantData().x || '')) {
          hdrX.href = ctx.getRestaurantData().x;
          hdrX.style.display = 'inline-flex';
        } else {
          hdrX.style.display = 'none';
        }
      }

      // === NEW: Delivery time chip ===
      const dtText = document.getElementById('deliveryTimeText');
      if (dtText) {
        dtText.textContent = ctx.getRestaurantData().deliveryTime || '30 - 45min.';
      }
      const dtChip = document.getElementById('deliveryTimeChip');
      if (dtChip) {
        dtChip.style.display = ctx.getRestaurantData().deliveryTime ? 'inline-flex' : 'none';
      }

      // === NEW: Minimum Order Chip ===
      const moChip = document.getElementById('minOrderChip');
      const moText = document.getElementById('minOrderText');
      if (moChip && moText) {
        if (ctx.getRestaurantData().minOrder && ctx.getRestaurantData().minOrder > 0) {
          moChip.style.display = 'inline-flex';
          moText.textContent = `$U ${ctx.getRestaurantData().minOrder}`;
        } else {
          moChip.style.display = 'none';
        }
      }
    }
export { renderHeader };
