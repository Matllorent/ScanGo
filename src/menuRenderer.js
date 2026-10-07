export function renderCategories() {
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

export function renderItems() {
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

export function renderCart() {
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