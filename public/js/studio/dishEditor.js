/**
 * public/js/studio/dishEditor.js
 * ──────────────────────────────
 * Módulo ES para la gestión, edición, filtros y subida de imágenes de platos.
 * Extraído de studio.js (renderDishesList, editDish, openNewDishModal, closeDishEditModal,
 * saveDishFromModal, deleteDish, clearDishPhoto, toggleDishScheduleControls, populateCatFilter,
 * toggleDishesByIngredient, handleDishPhotoUpload).
 */

import { ensureDishModifierGroups, renderDishModifierAssignments, getDishOptionConfig } from './modifierGroups.js';

export function toggleDishesByIngredient(restaurant, isOut, onUpdated) {
  const input = document.getElementById('inputIngredientKeyword');
  const keyword = (input?.value || '').trim().toLowerCase();
  if (!keyword) {
    alert('Por favor escribe un ingrediente o término (ej: Salmón, Aguacate, Champiñones).');
    return;
  }

  let count = 0;
  (restaurant.dishes || []).forEach(d => {
    const inName = (d.name || '').toLowerCase().includes(keyword);
    const inDesc = (d.description || '').toLowerCase().includes(keyword);
    if (inName || inDesc) {
      d.outOfStock = isOut;
      count++;
    }
  });

  if (typeof onUpdated === 'function') onUpdated();
  alert(`Se ${isOut ? 'marcaron como agotados' : 'reactivaron'} ${count} platos asociados a "${keyword}".`);
}

export function populateCatFilter(restaurant) {
  const select = document.getElementById('selectCatFilter');
  if (!select) return;
  const cats = restaurant?.categories || [];
  select.innerHTML = '<option value="ALL">Todas las Categorías</option>';
  cats.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    select.appendChild(opt);
  });
}

export function renderDishesList(restaurant, escapeHtml) {
  const container = document.getElementById('studioDishesList');
  const filterSelect = document.getElementById('selectCatFilter');
  if (!container || !filterSelect) return;

  const filter = filterSelect.value;
  const dishes = restaurant?.dishes || [];
  const cats = restaurant?.categories || [];
  const currency = restaurant?.currency || '$';
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));

  const filtered = dishes.filter(d => filter === 'ALL' || d.categoryId === filter);
  if (!filtered.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; background:var(--bg-base); border:1px dashed var(--border); border-radius:12px; margin:10px 0;">
        <div style="font-size:32px; margin-bottom:8px;">🍽️</div>
        <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:4px;">No hay platos en esta sección</div>
        <div style="font-size:11px; color:var(--text-dim); max-width:280px; margin:0 auto 12px;">Comienza sumando platos recomendados desde nuestro catálogo o crea uno nuevo personalizado.</div>
        <div style="display:flex; justify-content:center; gap:8px;">
          <button class="btn-nav btn-nav-gold" style="font-size:11px; padding:5px 12px;" onclick="openPresetsModal()">✨ Agregar Platos Frecuentes</button>
          <button class="btn-nav" style="font-size:11px; padding:5px 12px;" onclick="openNewDishModal()">+ Crear Plato</button>
        </div>
      </div>
    `;
    return;
  }

  const tagLabels = { star: '⭐', veggie: '🥬', vegan: '🌱', celiac: '🌾', sinlactosa: '🥛', picante: '🌶️' };
  let html = '';
  filtered.forEach((d) => {
    const cat = cats.find(c => c.id === d.categoryId);
    const tags = (d.tags || []).filter(t => t !== 'star' && t !== 'chef_special').map(t => tagLabels[t] || '').join(' ');
    const starBadge = (d.tags || []).includes('star') ? '<span style="color:var(--accent-gold); margin-right:4px;">⭐</span>' : '';
    const chefBadge = (d.isChefSpecial || (d.tags || []).includes('chef_special')) ? '<span style="background:rgba(236,201,75,0.2); color:var(--accent-gold); font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; margin-right:4px; border:1px solid rgba(236,201,75,0.4);">👨‍🍳 CHEF</span>' : '';
    const outBadge = d.outOfStock ? '<span style="background:#E53E3E; color:#fff; font-size:9px; font-weight:800; padding:1px 6px; border-radius:4px; margin-left:6px;">AGOTADO</span>' : '';
    const opacity = d.outOfStock ? 'opacity:0.5;' : '';
    const photoThumb = d.photoUrl 
      ? `<img src="${d.photoUrl}" style="width:36px; height:36px; border-radius:6px; object-fit:cover; border:1px solid var(--border); flex-shrink:0;">` 
      : '';
    const priceDisplay = (d.originalPrice && Number(d.originalPrice) > Number(d.price)) 
      ? `<span style="text-decoration:line-through; opacity:0.6; margin-right:4px;">${currency} ${d.originalPrice}</span> ${currency} ${d.price}` 
      : `${currency} ${d.price}`;

    const cleanName = safeEscape(d.name || 'Sin nombre');
    const cleanCatName = safeEscape(cat ? cat.name : 'Sin cat.');
    const cleanDishId = safeEscape(d.id || '');

    html += `
      <div class="dish-editor-card" style="${opacity} display:flex; align-items:center; gap:8px;">
        ${photoThumb}
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
            ${chefBadge}${starBadge}${cleanName}${outBadge}
          </div>
          <div style="font-size:10px; color:var(--text-dim); display:flex; align-items:center; gap:4px; margin-top:2px;">
            ${cleanCatName} • ${priceDisplay} ${tags}
          </div>
        </div>
        <button class="btn-icon" onclick="editDish('${cleanDishId}')" title="Editar">✏️</button>
        <button class="btn-icon btn-icon-danger" onclick="deleteDish('${cleanDishId}')" title="Eliminar">🗑️</button>
      </div>
    `;
  });
  container.innerHTML = html;
}

export function deleteDish(restaurant, dishId, showConfirmDialogFn, onDeleted) {
  const dish = (restaurant.dishes || []).find(d => d.id === dishId);
  const dishName = dish ? dish.name : 'este plato';
  const executeDelete = () => {
    restaurant.dishes = (restaurant.dishes || []).filter(d => d.id !== dishId);
    if (typeof onDeleted === 'function') onDeleted();
  };

  if (typeof showConfirmDialogFn === 'function') {
    showConfirmDialogFn({
      icon: '🗑️',
      title: '¿Eliminar Plato de la Carta?',
      message: `¿Estás seguro de que deseas eliminar "${dishName}"? Esta acción se guardará automáticamente en tu carta digital.`,
      confirmText: 'Sí, Eliminar',
      confirmClass: 'btn-danger',
      onConfirm: executeDelete
    });
  } else if (confirm(`¿Estás seguro de eliminar "${dishName}"?`)) {
    executeDelete();
  }
}

export function clearDishPhoto() {
  const urlInput = document.getElementById('modalDishPhoto');
  const fileInput = document.getElementById('modalDishPhotoFile');
  const fileNameSpan = document.getElementById('dishPhotoFileName');
  const clearBtn = document.getElementById('btnClearDishPhoto');
  const previewContainer = document.getElementById('dishPhotoPreviewContainer');

  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
  if (fileNameSpan) fileNameSpan.textContent = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (previewContainer) previewContainer.style.display = 'none';
}

export function toggleDishScheduleControls() {
  const enabled = document.getElementById('modalDishScheduleEnabled')?.checked;
  const controls = document.getElementById('dishScheduleControls');
  if (controls) controls.style.display = enabled ? 'flex' : 'none';
}

export function editDish(restaurant, dishId) {
  const dish = (restaurant.dishes || []).find(d => d.id === dishId);
  if (!dish) return;

  const titleEl = document.getElementById('dishModalTitle');
  if (titleEl) titleEl.textContent = 'Editar Plato';

  const el = id => document.getElementById(id);
  if (el('modalDishId')) el('modalDishId').value = dish.id;
  if (el('modalDishName')) el('modalDishName').value = dish.name || '';
  if (el('modalDishPrice')) el('modalDishPrice').value = dish.price || 0;
  if (el('modalDishOriginalPrice')) el('modalDishOriginalPrice').value = (dish.originalPrice !== null && dish.originalPrice !== undefined) ? dish.originalPrice : '';
  if (el('modalDishDesc')) el('modalDishDesc').value = dish.description || '';

  const existingPhoto = dish.photoUrl || dish.imageUrl || dish.image || dish.photo || '';
  if (el('modalDishPhoto')) el('modalDishPhoto').value = existingPhoto;
  if (el('modalDishOutOfStock')) el('modalDishOutOfStock').checked = !!dish.outOfStock;
  if (el('modalDishStar')) el('modalDishStar').checked = (dish.tags || []).includes('star');
  if (el('modalDishChefSpecial')) el('modalDishChefSpecial').checked = !!dish.isChefSpecial || (dish.tags || []).includes('chef_special');
  if (el('tagVeggie')) el('tagVeggie').checked = (dish.tags || []).includes('veggie');
  if (el('tagVegan')) el('tagVegan').checked = (dish.tags || []).includes('vegan');
  if (el('tagCeliac')) el('tagCeliac').checked = (dish.tags || []).includes('celiac');
  if (el('tagSinLactosa')) el('tagSinLactosa').checked = (dish.tags || []).includes('sinlactosa');
  if (el('tagPicante')) el('tagPicante').checked = (dish.tags || []).includes('picante');

  document.querySelectorAll('.dish-weather-tag').forEach(input => {
    input.checked = (dish.weatherTags || []).includes(input.value);
  });

  renderDishModifierAssignments(restaurant, ensureDishModifierGroups(restaurant, dish));

  // Smart Scheduling
  const sched = dish.schedule;
  const schedEnabled = !!(sched && sched.enabled);
  if (el('modalDishScheduleEnabled')) el('modalDishScheduleEnabled').checked = schedEnabled;
  toggleDishScheduleControls();
  const schedDays = (sched && Array.isArray(sched.days)) ? sched.days : [0, 1, 2, 3, 4, 5, 6];
  document.querySelectorAll('.dish-sched-day').forEach(cb => {
    cb.checked = schedDays.includes(parseInt(cb.value, 10));
  });
  if (el('modalDishTimeStart')) el('modalDishTimeStart').value = (sched && sched.timeStart) || '11:30';
  if (el('modalDishTimeEnd')) el('modalDishTimeEnd').value = (sched && sched.timeEnd) || '15:30';
  if (el('modalDishScheduleBehavior')) el('modalDishScheduleBehavior').value = (sched && sched.behavior) || 'hide';

  // Photo preview
  const previewContainer = document.getElementById('dishPhotoPreviewContainer');
  const previewImg = document.getElementById('dishPhotoPreview');
  const clearBtn = document.getElementById('btnClearDishPhoto');
  const fileNameSpan = document.getElementById('dishPhotoFileName');
  if (fileNameSpan) fileNameSpan.textContent = '';
  if (existingPhoto) {
    if (previewContainer && previewImg) {
      previewImg.src = existingPhoto;
      previewContainer.style.display = 'block';
    }
    if (clearBtn) clearBtn.style.display = 'inline';
  } else {
    if (previewContainer) previewContainer.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';
  }

  // Populate category select
  const catSelect = document.getElementById('modalDishCategory');
  if (catSelect) {
    catSelect.innerHTML = '';
    let matchedCategory = false;
    (restaurant.categories || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === dish.categoryId) {
        opt.selected = true;
        matchedCategory = true;
      }
      catSelect.appendChild(opt);
    });
    if (!matchedCategory && dish.categoryId) {
      const opt = document.createElement('option');
      opt.value = dish.categoryId;
      opt.textContent = dish.categoryId;
      opt.selected = true;
      catSelect.appendChild(opt);
    } else if (!catSelect.options.length) {
      const opt = document.createElement('option');
      opt.value = 'cat_general';
      opt.textContent = 'General';
      opt.selected = true;
      catSelect.appendChild(opt);
    }
  }

  const modal = document.getElementById('dishEditModal');
  if (modal) modal.classList.add('active');
}

export function openNewDishModal(restaurant) {
  const titleEl = document.getElementById('dishModalTitle');
  if (titleEl) titleEl.textContent = 'Nuevo Plato';

  const form = document.getElementById('dishForm');
  if (form) form.reset();

  const el = id => document.getElementById(id);
  if (el('modalDishId')) el('modalDishId').value = '';
  if (el('modalDishPrice')) el('modalDishPrice').value = '';
  if (el('modalDishOriginalPrice')) el('modalDishOriginalPrice').value = '';
  if (el('modalDishPhoto')) el('modalDishPhoto').value = '';
  if (el('modalDishOutOfStock')) el('modalDishOutOfStock').checked = false;
  if (el('modalDishStar')) el('modalDishStar').checked = false;
  if (el('modalDishChefSpecial')) el('modalDishChefSpecial').checked = false;

  document.querySelectorAll('.dish-weather-tag').forEach(input => { input.checked = false; });
  renderDishModifierAssignments(restaurant, []);
  clearDishPhoto();

  if (el('modalDishScheduleEnabled')) el('modalDishScheduleEnabled').checked = false;
  toggleDishScheduleControls();
  document.querySelectorAll('.dish-sched-day').forEach(cb => { cb.checked = true; });
  if (el('modalDishTimeStart')) el('modalDishTimeStart').value = '11:30';
  if (el('modalDishTimeEnd')) el('modalDishTimeEnd').value = '15:30';
  if (el('modalDishScheduleBehavior')) el('modalDishScheduleBehavior').value = 'hide';

  const catSelect = document.getElementById('modalDishCategory');
  if (catSelect) {
    catSelect.innerHTML = '';
    (restaurant.categories || []).forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catSelect.appendChild(opt);
    });
    if (!catSelect.options.length) {
      const opt = document.createElement('option');
      opt.value = 'cat_general';
      opt.textContent = 'General';
      catSelect.appendChild(opt);
    }
  }

  const modal = document.getElementById('dishEditModal');
  if (modal) modal.classList.add('active');
}

export function closeDishEditModal() {
  const submitBtn = document.getElementById('btnSubmitDishModal');
  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.dataset.saving = 'false';
    submitBtn.textContent = '💾 Guardar Plato';
  }
  const modal = document.getElementById('dishEditModal');
  if (modal) modal.classList.remove('active');
}

export function saveDishFromModal(restaurant, event, onSaved) {
  if (event) event.preventDefault();

  const submitBtn = document.getElementById('btnSubmitDishModal');
  if (submitBtn) {
    if (submitBtn.dataset.saving === 'true') return;
    submitBtn.dataset.saving = 'true';
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Guardando...';
  }

  const id = document.getElementById('modalDishId')?.value;
  const name = document.getElementById('modalDishName')?.value.trim();
  const price = parseFloat(document.getElementById('modalDishPrice')?.value) || 0;
  const originalPriceVal = parseFloat(document.getElementById('modalDishOriginalPrice')?.value);
  const originalPrice = isNaN(originalPriceVal) ? null : originalPriceVal;
  const description = document.getElementById('modalDishDesc')?.value.trim();
  const photoUrl = document.getElementById('modalDishPhoto')?.value.trim();
  const categoryId = document.getElementById('modalDishCategory')?.value;
  const outOfStock = document.getElementById('modalDishOutOfStock')?.checked;
  const isChefSpecial = document.getElementById('modalDishChefSpecial')?.checked;
  const optionConfig = getDishOptionConfig();

  const scheduleEnabled = document.getElementById('modalDishScheduleEnabled')?.checked;
  let schedule = null;
  if (scheduleEnabled) {
    const selectedDays = Array.from(document.querySelectorAll('.dish-sched-day:checked')).map(cb => parseInt(cb.value, 10));
    const timeStart = document.getElementById('modalDishTimeStart')?.value || '00:00';
    const timeEnd = document.getElementById('modalDishTimeEnd')?.value || '23:59';
    const behavior = document.getElementById('modalDishScheduleBehavior')?.value || 'hide';
    schedule = {
      enabled: true,
      days: selectedDays.length ? selectedDays : [0, 1, 2, 3, 4, 5, 6],
      timeStart,
      timeEnd,
      behavior
    };
  }

  const tags = [];
  if (document.getElementById('modalDishStar')?.checked) tags.push('star');
  if (isChefSpecial) tags.push('chef_special');
  if (document.getElementById('tagVeggie')?.checked) tags.push('veggie');
  if (document.getElementById('tagVegan')?.checked) tags.push('vegan');
  if (document.getElementById('tagCeliac')?.checked) tags.push('celiac');
  if (document.getElementById('tagSinLactosa')?.checked) tags.push('sinlactosa');
  if (document.getElementById('tagPicante')?.checked) tags.push('picante');
  const weatherTags = Array.from(document.querySelectorAll('.dish-weather-tag:checked')).map(input => input.value);

  if (!restaurant.dishes) restaurant.dishes = [];

  let finalCategoryId = categoryId;
  if (!finalCategoryId) {
    if (restaurant.categories && restaurant.categories.length > 0) {
      finalCategoryId = restaurant.categories[0].id;
    } else {
      finalCategoryId = 'cat_general';
      if (!restaurant.categories) restaurant.categories = [];
      restaurant.categories.push({ id: 'cat_general', name: 'General' });
    }
  }

  if (id) {
    const dish = restaurant.dishes.find(d => d.id === id);
    if (dish) {
      dish.name = name;
      dish.price = price;
      dish.originalPrice = originalPrice;
      dish.description = description;
      dish.photoUrl = photoUrl || null;
      dish.categoryId = finalCategoryId;
      dish.outOfStock = outOfStock;
      dish.isChefSpecial = isChefSpecial;
      dish.schedule = schedule;
      dish.tags = tags;
      dish.weatherTags = weatherTags;
      Object.assign(dish, optionConfig);
      delete dish.proteinOptions;
      delete dish.proteinSelectionRequired;
      delete dish.variants;
      delete dish.variantSelectionMode;
      delete dish.variantsRequired;
      delete dish.variantsPerItem;
    }
  } else {
    restaurant.dishes.push({
      id: 'd_' + Date.now(),
      name,
      price,
      originalPrice: originalPrice,
      description: description || 'Plato casero elaborado en el día',
      photoUrl: photoUrl || null,
      categoryId: finalCategoryId,
      outOfStock,
      isChefSpecial,
      schedule,
      tags,
      weatherTags,
      ...optionConfig
    });
  }

  closeDishEditModal();
  if (typeof onSaved === 'function') onSaved();
}
