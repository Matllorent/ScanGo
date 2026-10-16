/**
 * public/js/menu/menuRender.js
 * ────────────────────────────
 * Render de la carta (extraído de menu.js sin cambios de comportamiento:
 * misma lógica, mismas strings, mismo orden). Horarios por plato, chef
 * specials, grilla por categorías y card individual. Todo el estado de
 * menu.js llega por `ctx`:
 * {
 *   getRestaurantData, getSelectedCategory: () => string,
 *   getSelectedDietFilter: () => string, getDishCartQuantity,
 *   getDishModifierGroups, sortWeatherCategories, sortWeatherDishes,
 *   renderDietaryFilters, areMenuOrdersEnabled
 * }
 * Sin imports fuera de public/js. Sin DOM en import (seguro en Node).
 */
import { escapeHtml } from '../utils/escapeHtmlBrowser.js';
import { isFreePrice } from './menuPresentation.js';
import { computeOpenStatus } from './openStatus.js';
import { parseGuestContext, resolveEventTheme } from './eventGuestMode.js';
import { renderWeddingItineraryHTML as renderWeddingItineraryHTMLMod } from './weddingItinerary.js';

let weddingItineraryTimer = null; // re-render del timeline en vivo cada 30s


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

    function renderChefSpecials(ctx) {
      const section = document.getElementById('chefSpecialsSection');
      const carousel = document.getElementById('chefSpecialsCarousel');
      if (!section || !carousel) return;

      const dishes = ctx.getRestaurantData().dishes || [];
      const layout = (document.body.className.match(/layout-(\S+)/) || [])[1] || ctx.getRestaurantData().layout || 'classic';
      const isBoardMorph = ['billboard', 'ticker', 'sticker', 'delivery'].includes(layout);

      // Chef Specials & Menú del Día (siempre, como hasta ahora)
      const chefDishes = dishes.filter(d => {
        if (d.outOfStock) return false;
        if (!d.isChefSpecial && (!d.tags || !d.tags.includes('chef_special'))) return false;
        const sched = getDishScheduleStatus(d);
        return sched.shouldDisplay;
      });

      // En las morfologías board (billboard/ticker/sticker), los platos destacados
      // (tag "star") también entran al carrusel superior: "Los Mejores Platos".
      let starDishes = [];
      if (isBoardMorph) {
        starDishes = dishes.filter(d => {
          if (d.outOfStock) return false;
          if (!d.tags || !d.tags.includes('star')) return false;
          const sched = getDishScheduleStatus(d);
          return sched.shouldDisplay;
        });
      }

      const featured = [...chefDishes];
      starDishes.forEach(sd => {
        if (!featured.some(f => f.id === sd.id)) featured.push(sd);
      });

      if (!featured.length) {
        section.style.display = 'none';
        carousel.innerHTML = '';
        return;
      }

      // Título dinámico: si no hay recomendaciones del chef pero sí favoritos
      const i18n = window.i18nManager;
      const t = (key, fallback) => (i18n && typeof i18n.t === 'function') ? i18n.t(key) : fallback;
      const titleEl = section.querySelector('.chef-specials-title');
      const badgeEl = section.querySelector('.chef-badge-gold');
      if (!chefDishes.length && starDishes.length && titleEl) {
        titleEl.innerHTML = `<span>🔥</span> ${t('topDishesCarousel', 'Los Mejores Platos de la Casa')}`;
        if (badgeEl) badgeEl.textContent = t('favoritesBadge', '⭐ Los Favoritos');
      } else if (chefDishes.length && starDishes.length && titleEl) {
        titleEl.innerHTML = `<span>👨‍🍳</span> ${t('chefAndFavoritesLabel', 'Sugerencia del Chef & Los Favoritos')}`;
      } else if (titleEl) {
        // Restaura el título por defecto (puede haber sido re-traducido por applyDOMTranslations)
        titleEl.innerHTML = `<span>👨‍🍳</span> ${t('chefTitleDefault', 'Sugerencia del Chef & Menú del Día')}`;
        if (badgeEl) badgeEl.textContent = t('chefSpecialBadge', '⭐ Especial del Día');
      }

      const currency = ctx.getRestaurantData().currency || '$';
      let html = '';
      featured.forEach(d => {
        const inCart = ctx.getDishCartQuantity(d.id);
        const sched = getDishScheduleStatus(d);
        const effectivePrice = sched.effectivePrice !== undefined ? sched.effectivePrice : d.price;
        // Sin costo ($0 o sin precio): NO se muestra ninguna cifra, solo el botón pedir.
        const isFree = isFreePrice(effectivePrice);
        const formattedPrice = isFree
          ? ''
          : ((window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(effectivePrice) 
            : `${currency} ${effectivePrice}`);
        const isStar = !d.isChefSpecial && (!d.tags || !d.tags.includes('chef_special')) && d.tags && d.tags.includes('star');
        const ribbonLabel = isStar ? t('favoriteRibbon', '⭐ Favorito') : (sched.isAvailable ? t('recommendationLabel', 'Recomendación') : sched.reason);
        const ribbonIcon = isStar ? '🔥' : '👨‍🍳';
        
        // For Happy Hours: show original price as strikethrough (nunca si es sin costo)
        let originalPriceHtml = '';
        if (!isFree && sched.isHappyHour && sched.originalPrice !== null && sched.originalPrice !== undefined && Number(sched.originalPrice) > Number(effectivePrice)) {
          const formattedOrig = (window.i18nManager && typeof window.i18nManager.formatPrice === 'function') 
            ? window.i18nManager.formatPrice(sched.originalPrice) 
            : `${currency} ${sched.originalPrice}`;
          originalPriceHtml = `<span style="text-decoration:line-through; opacity:0.6; font-size:0.8em; margin-right:4px; color:var(--chalk-dim); font-weight:normal;">${formattedOrig}</span>`;
        } else if (!isFree) {
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
          ? `<img src="${escapeHtml(d.photoUrl)}" alt="${escapeHtml(d.name)}" class="chef-special-thumb" loading="lazy" decoding="async" style="aspect-ratio:16/9">` 
          : `<div style="height:90px; display:flex; align-items:center; justify-content:center; font-size:2.4rem; background:rgba(236,201,75,0.06); border-radius:8px; margin-bottom:8px;">👨‍🍳</div>`;

        html += `
          <div class="chef-special-card" style="${!sched.isAvailable ? 'opacity:0.6;' : ''}">
            <span class="chef-special-tag-ribbon">${ribbonIcon} ${ribbonLabel}</span>
            ${photoHtml}
            <div>
              <div class="chef-special-name">${escapeHtml(d.name)}</div>
              ${d.description ? `<p class="chef-special-desc">${escapeHtml(d.description)}</p>` : ''}
            </div>
            <div class="chef-special-footer">
              <div class="chef-special-price">
                ${originalPriceHtml}${formattedPrice}
              </div>
              ${!ctx.areMenuOrdersEnabled()
                ? ''
                : (sched.isAvailable
                  ? `<button class="btn-add" data-dish-id="${escapeHtml(d.id)}" data-js-click="addToCart|this.dataset.dishId" aria-label="Agregar ${escapeHtml(d.name)}" style="width:34px; height:34px; font-size:1.1rem;">+</button>`
                  : `<button class="btn-add" disabled style="width:34px; height:34px; font-size:0.9rem; background:#4A5568; cursor:not-allowed; opacity:0.6;" title="${sched.reason}">⏰</button>`
                )
              }
            </div>
            ${inCart > 0 ? `<div style="font-size:0.7rem; color:var(--chalk-gold); font-weight:700; margin-top:4px; text-align:right;">${inCart} ${t('inCart', 'en carrito')}</div>` : ''}
          </div>
        `;
      });

      carousel.innerHTML = html;
      section.style.display = 'block';
    }

    /**
     * Renderiza la sección del itinerario de boda/evento.
     * Visible solo con tema de evento activo (businessType='events' o ?event=)
     * Y con itinerario habilitado + al menos un momento configurado.
     */
    function renderWeddingItinerary(ctx) {
      const section = document.getElementById('weddingItinerarySection');
      if (!section || !ctx.getRestaurantData()) return;
      // Un solo intervalo vivo: se limpia en cada re-render.
      if (weddingItineraryTimer) {
        clearInterval(weddingItineraryTimer);
        weddingItineraryTimer = null;
      }
      const themeActive = Boolean(resolveEventTheme(ctx.getRestaurantData(), window.location.search))
        || ctx.getRestaurantData().businessType === 'events';
      const html = themeActive
        ? renderWeddingItineraryHTMLMod(ctx.getRestaurantData().weddingItinerary, escapeHtml, new Date())
        : '';
      section.innerHTML = html;
      section.style.display = html ? 'block' : 'none';
      // El estado (AHORA / avance / cuenta regresiva) se actualiza solo.
      if (html) {
        weddingItineraryTimer = setInterval(() => renderWeddingItinerary(ctx), 30000);
      }
    }

    /**
     * Etiqueta humana del tipo de evento (espejo del SSR en api/index.js).
     */
    function resolveEventMenuLabel(eventType) {
      switch (String(eventType || '').toLowerCase()) {
        case 'cumple_15': return 'Cumpleaños de 15';
        case 'birthday': return 'Cumpleaños';
        case 'catering': return 'Evento';
        case 'wedding': return 'Boda';
        default: return 'Evento';
      }
    }

    /**
     * Tarjeta de bienvenida al invitado (solo eventos con ?invitado= + tema
     * de evento). Data-driven desde weddingItinerary (pareja/fecha/lugar) y
     * mesa del link del invitado. Todo con textContent: cero HTML inyectable.
     * `ctx` llega por parámetro (es Module/strict mode: un `ctx` sin declarar
     * lanza ReferenceError y, al correr dentro de renderHeader, rompía el
     * render de TODA la carta).
     */
    function renderGuestInvite(ctx) {
      const host = document.getElementById('guestInviteHero');
      if (!host || !ctx.getRestaurantData()) return;
      const { guestName, tableNumber } = parseGuestContext(window.location.search);
      if (!guestName || !resolveEventTheme(ctx.getRestaurantData(), window.location.search)) {
        host.style.display = 'none';
        return;
      }
      const it = ctx.getRestaurantData().weddingItinerary || {};
      const couple = String(it.coupleNames || '').trim();
      const eventDay = String(it.date || '').trim();
      const venue = String(it.venue || '').trim();
      const label = resolveEventMenuLabel(ctx.getRestaurantData().eventType || 'wedding');
      const nameEl = document.getElementById('guestHeroName');
      const titleEl = document.getElementById('guestHeroTitle');
      const metaEl = document.getElementById('guestHeroMeta');
      if (nameEl) nameEl.textContent = guestName;
      if (titleEl) titleEl.textContent = couple ? `${couple} — ${label}` : (ctx.getRestaurantData().name || label);
      if (metaEl) {
        const bits = [];
        if (eventDay) bits.push(`📅 ${eventDay}`);
        if (venue) bits.push(`📍 ${venue}`);
        if (tableNumber) bits.push(`Mesa ${tableNumber}`);
        metaEl.textContent = bits.join(' · ');
        metaEl.style.display = bits.length ? '' : 'none';
      }
      host.style.display = 'block';
    }

    function renderDishes(ctx) {
      // Render top carousel for Chef's Specials & Menú del Día
      renderChefSpecials(ctx);

      // Hide dietary filters that have no matching dishes
      ctx.renderDietaryFilters();

      const container = document.getElementById('dishesContainer');
      const searchInput = document.getElementById('searchFilter');
      const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
      const btnClear = document.getElementById('btnClearSearch');
      if (btnClear) {
        btnClear.style.display = searchTerm.length > 0 ? 'block' : 'none';
      }

      const currency = ctx.getRestaurantData().currency || '$';
      const categories = ctx.sortWeatherCategories(ctx.getRestaurantData().categories || [], ctx.getRestaurantData().dishes || []);
      const dishes = ctx.getRestaurantData().dishes || [];

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

      // Check for scheduled menu restriction (o cierre manual del dueño)
      if (ctx.getRestaurantData().forceClosed === true) {
        container.innerHTML = `
          <div style="text-align:center; padding:40px 20px; background:rgba(236,201,75,0.06); border:1px dashed var(--border-gold); border-radius:12px;">
            <p style="font-size:1.2rem; color:var(--chalk-gold); font-family:var(--font-heading); margin-bottom:8px;">Local cerrado por el momento</p>
            <p style="color:var(--chalk-dim); font-size:0.9rem;">Estamos haciendo una pausa breve. Por favor volvé a consultar en unos minutos.</p>
          </div>
        `;
        return;
      }
      if (ctx.getRestaurantData().scheduleEnabled && ctx.getRestaurantData().scheduleActiveHours) {
        const st = computeOpenStatus(ctx.getRestaurantData(), -new Date().getTimezoneOffset());
        if (!st.open) {
          container.innerHTML = `
            <div style="text-align:center; padding:40px 20px; background:rgba(236,201,75,0.06); border:1px dashed var(--border-gold); border-radius:12px;">
              <p style="font-size:1.2rem; color:var(--chalk-gold); font-family:var(--font-heading); margin-bottom:8px;">Carta Fuera de Horario</p>
              <p style="color:var(--chalk-dim); font-size:0.9rem;">Esta carta está disponible de ${ctx.getRestaurantData().scheduleActiveHours} hs. Por favor consulta con el personal.</p>
            </div>
          `;
          return;
        }
      }

      // Dietary filter predicate
      const matchesDiet = (d) => {
        if (ctx.getSelectedDietFilter() === 'ALL') return true;
        if (!d.tags) return false;
        if (ctx.getSelectedDietFilter() === 'veggie') return d.tags.includes('veggie') || d.tags.includes('vegetariano');
        if (ctx.getSelectedDietFilter() === 'vegan') return d.tags.includes('vegan') || d.tags.includes('vegano');
        if (ctx.getSelectedDietFilter() === 'celiac') return d.tags.includes('celiac') || d.tags.includes('singluten');
        if (ctx.getSelectedDietFilter() === 'sinlactosa') return d.tags.includes('sinlactosa');
        if (ctx.getSelectedDietFilter() === 'picante') return d.tags.includes('picante');
        return true;
      };

      let html = '';

      // Special Mode: Popular / Featured Dishes
      if (ctx.getSelectedCategory() === 'POPULAR') {
        const popularDishes = ctx.sortWeatherDishes(dishes.filter(d => {
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
        popularDishes.forEach(d => { html += renderSingleDishCard(ctx, d, currency); });
        html += `</div></div>`;
        container.innerHTML = html;
        return;
      }

      // Standard Mode: Loop through categories
      categories.forEach(cat => {
        if (ctx.getSelectedCategory() !== 'ALL' && ctx.getSelectedCategory() !== cat.id) return;

        const catDishes = ctx.sortWeatherDishes(dishes.filter(d => {
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

        catDishes.forEach(d => { html += renderSingleDishCard(ctx, d, currency); });

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
              <button type="button" class="empty-state-btn" data-js-click="clearSearchFilter">✕ Limpiar búsqueda</button>
            </div>
          `;
        } else if (ctx.getSelectedCategory() !== 'ALL') {
          const currentCatObj = categories.find(c => c.id === ctx.getSelectedCategory());
          const catName = currentCatObj ? currentCatObj.name : 'esta sección';
          container.innerHTML = `
            <div class="empty-state-card">
              <span class="empty-state-icon">🍽️</span>
              <div class="empty-state-title">Sección sin platos disponibles</div>
              <div class="empty-state-desc">No hay platos activos en "${escapeHtml(catName)}" en este momento.</div>
              <button type="button" class="empty-state-btn" data-js-click="selectCategory|ALL">Ver todos los platos</button>
            </div>
          `;
        } else {
          container.innerHTML = `
            <div class="empty-state-card">
              <span class="empty-state-icon">🥗</span>
              <div class="empty-state-title">Sin platos con los filtros seleccionados</div>
              <div class="empty-state-desc">Probá cambiando los filtros dietéticos para explorar la carta completa.</div>
              <button type="button" class="empty-state-btn" data-js-click="selectDietFilter|ALL">Restablecer filtros</button>
            </div>
          `;
        }
      } else {
        container.innerHTML = html;
      }
    }

    function renderSingleDishCard(ctx, d, currency) {
      const inCart = ctx.getDishCartQuantity(d.id);
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
      if (d.videoUrl) badgeHtml += '<span class="dish-badge dish-videobadge">🎬 Video</span> ';
      // Happy Hour badge
      if (sched.isHappyHour) badgeHtml += '<span class="dish-badge" style="background:rgba(225,169,56,0.16); color:var(--chalk-gold, #E1A938); border:1px solid rgba(225,169,56,0.4);">🕐 Happy Hour</span> ';

      const photoHtml = d.photoUrl 
        ? `<img src="${escapeHtml(d.photoUrl)}" alt="${escapeHtml(d.name)}" class="dish-thumb" loading="lazy" decoding="async" style="aspect-ratio:16/9">` 
        : '';

      // Sin costo ($0 o sin precio): NO se muestra ninguna cifra, solo el botón pedir.
      const isFreeDish = isFreePrice(effectivePrice);
      const formattedPrice = isFreeDish
        ? ''
        : ((window.i18nManager && typeof window.i18nManager.formatPrice === 'function')
          ? window.i18nManager.formatPrice(effectivePrice)
          : `${currency} ${effectivePrice}`);
      const displayPrice = isFreeDish
        ? ''
        : (ctx.getDishModifierGroups(d).some(group => group.kind === 'presentation')
          ? `Desde ${formattedPrice}`
          : formattedPrice);

      const origPrice = (d.originalPrice !== undefined && d.originalPrice !== null) ? d.originalPrice : (d.previous_price || d.previousPrice);
      let priceDisplay = isSold ? '<span style="color:#E53E3E; font-size:0.85rem;">Agotado</span>' : displayPrice;
      if (!isSold && !isFreeDish) {
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
        <div class="dish-card ${isUnavailable ? 'dish-sold' : ''} ${d.photoUrl ? 'dish-has-photo' : ''}" id="dish_card_${d.id}" style="${isUnavailable ? 'opacity:0.6; filter:grayscale(0.5);' : ''}">
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
            ${!ctx.areMenuOrdersEnabled()
              ? ''
              : (isSold
                ? '<button class="btn-add" disabled style="background:#4A5568; cursor:not-allowed; opacity:0.6;">✕</button>'
                : (!sched.isAvailable
                    ? `<button class="btn-add" disabled style="background:#4A5568; cursor:not-allowed; opacity:0.6;" title="${sched.reason}">⏰</button>`
                    : `<button class="btn-add" data-dish-id="${escapeHtml(d.id)}" data-js-click="addToCart|this.dataset.dishId" aria-label="Agregar ${escapeHtml(d.name)}">+</button>`
                  )
              )
            }
            ${inCart > 0 ? `<span class="qty-counter">${inCart} en carrito</span>` : ''}
          </div>
        </div>
      `;
    }
export {
  getDishScheduleStatus,
  renderChefSpecials,
  renderDishes,
  renderSingleDishCard,
  renderGuestInvite,
  renderWeddingItinerary
};
