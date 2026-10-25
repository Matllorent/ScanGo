/**
 * public/js/studio/dishEditor.js
 * ──────────────────────────────
 * Módulo ES para la gestión, edición, filtros y subida de imágenes de platos.
 * Extraído de studio.js (renderDishesList, editDish, openNewDishModal, closeDishEditModal,
 * saveDishFromModal, deleteDish, clearDishPhoto, toggleDishScheduleControls, populateCatFilter,
 * toggleDishesByIngredient, handleDishPhotoUpload).
 */

import { ensureDishModifierGroups, renderDishModifierAssignments, getDishOptionConfig } from './modifierGroups.js';
import { cloneDishWithNewId as cloneDishWithNewIdUtil } from './cloneUtils.js';
import { escapeHtml as escapeHtmlDefault } from '../utils/escapeHtmlBrowser.js';

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

  // Cleanup previous virtual list if exists
  if (container._virtualListCleanup) {
    container._virtualListCleanup();
  }
  if (container._virtualListResizeObserver) {
    container._virtualListResizeObserver.disconnect();
    container._virtualListResizeObserver = null;
  }

  // Cobertura de fotos: cuántos platos no tienen imagen (cualquier campo
  // legacy cuenta como "con foto"; el backend ya normaliza todo a photoUrl).
  updatePhotoCoverageBanner(restaurant);

  // Quota warning banner
  updateQuotaWarningBanner(restaurant);

  const filter = filterSelect.value;
  const dishes = restaurant?.dishes || [];
  const cats = restaurant?.categories || [];
  const currency = restaurant?.currency || '$';
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlDefault;

  const filtered = dishes.filter(d => filter === 'ALL' || d.categoryId === filter);
  if (!filtered.length) {
    container.innerHTML = `
      <div style="text-align:center; padding:32px 16px; background:var(--bg-base); border:1px dashed var(--border); border-radius:12px; margin:10px 0;">
        <div style="font-size:32px; margin-bottom:8px;">🍽️</div>
        <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:4px;">No hay platos en esta sección</div>
        <div style="font-size:11px; color:var(--text-dim); max-width:280px; margin:0 auto 12px;">Comienza sumando platos recomendados desde nuestro catálogo o crea uno nuevo personalizado.</div>
        <div style="display:flex; justify-content:center; gap:8px;">
          <button class="btn-nav btn-nav-gold" style="font-size:11px; padding:5px 12px;" data-js-click="openPresetsModal">✨ Agregar Platos Frecuentes</button>
          <button class="btn-nav" style="font-size:11px; padding:5px 12px;" data-js-click="openNewDishModal">+ Crear Plato</button>
        </div>
      </div>
    `;
    return;
  }

  // Virtual list implementation
  initVirtualDishList(container, filtered, cats, currency, safeEscape);
}

/**
 * Banner de advertencia de cuota de platos (cerca del límite del plan).
 * Se muestra cuando se alcanza el 80% de la cuota.
 */
export function updateQuotaWarningBanner(restaurant) {
  const banner = document.getElementById('dishQuotaWarningBanner');
  if (!banner) return;
  
  const dishes = restaurant?.dishes || [];
  const current = dishes.length;
  const max = restaurant?.subscription?.features?.maxDishes ?? 
              (restaurant?.subscription?.status === 'trialing' ? 50 : 200);
  
  // Trial: 50, Starter: 200, Event: 100
  const effectiveMax = restaurant?.subscription?.status === 'trialing' ? 50 :
                       restaurant?.subscription?.plan === 'event_once' ? 100 : max;
  
  const percent = effectiveMax > 0 ? (current / effectiveMax) * 100 : 0;
  
  if (percent >= 80 && current > 0) {
    banner.style.display = 'block';
    const remaining = effectiveMax - current;
    if (remaining <= 0) {
      banner.innerHTML = `⚠️ <strong>Límite de platos alcanzado</strong> (${current}/${effectiveMax}). <a href="#billing" data-js-click="switchTab|billing" style="color:var(--accent-gold);">Actualizá tu plan</a> para agregar más.`;
      banner.style.background = 'rgba(229, 62, 62, 0.15)';
      banner.style.borderColor = '#E53E3E';
    } else if (percent >= 95) {
      banner.innerHTML = `⚠️ <strong>Casi al límite</strong>: ${current}/${effectiveMax} platos (${remaining} restantes). <a href="#billing" data-js-click="switchTab|billing" style="color:var(--accent-gold);">Actualizá tu plan</a>.`;
      banner.style.background = 'rgba(237, 137, 54, 0.15)';
      banner.style.borderColor = '#ED8936';
    } else {
      banner.innerHTML = `ℹ️ <strong>Cuota de platos</strong>: ${current}/${effectiveMax} (${Math.round(percent)}%). <a href="#billing" data-js-click="switchTab|billing" style="color:var(--accent-gold);">Ver planes</a>.`;
      banner.style.background = 'rgba(56, 178, 172, 0.15)';
      banner.style.borderColor = '#38B2AC';
    }
  } else {
    banner.style.display = 'none';
    banner.textContent = '';
  }
}

/**
 * Virtual list para platos (estilo react-window vanilla).
 * Renderiza solo los items visibles + buffer, con IntersectionObserver para cargar más.
 */
function initVirtualDishList(container, dishes, cats, currency, safeEscape) {
  const ITEM_HEIGHT = 72; // Altura estimada de cada tarjeta de plato
  const BUFFER = 5; // Items extra arriba/abajo
  const tagLabels = { star: '⭐', veggie: '🥬', vegan: '🌱', celiac: '🌾', sinlactosa: '🥛', picante: '🌶️' };

  // Estado del virtual list
  let scrollTop = 0;
  let containerHeight = container.clientHeight;
  let visibleStart = 0;
  let visibleEnd = Math.min(dishes.length, Math.ceil(containerHeight / ITEM_HEIGHT) + BUFFER * 2);
  let renderScheduled = false;

  // Wrapper para el virtual list
  container.style.position = 'relative';
  container.style.overflowY = 'auto';
  container.style.maxHeight = '600px'; // Altura fija para virtualización

  // Spacer superior (simula items no renderizados arriba)
  let topSpacer = container.querySelector('.virtual-list-top-spacer');
  if (!topSpacer) {
    topSpacer = document.createElement('div');
    topSpacer.className = 'virtual-list-top-spacer';
    topSpacer.style.height = '0px';
    container.insertBefore(topSpacer, container.firstChild);
  }

  // Spacer inferior
  let bottomSpacer = container.querySelector('.virtual-list-bottom-spacer');
  if (!bottomSpacer) {
    bottomSpacer = document.createElement('div');
    bottomSpacer.className = 'virtual-list-bottom-spacer';
    bottomSpacer.style.height = '0px';
    container.appendChild(bottomSpacer);
  }

  // Contenedor de items renderizados
  let itemsContainer = container.querySelector('.virtual-list-items');
  if (!itemsContainer) {
    itemsContainer = document.createElement('div');
    itemsContainer.className = 'virtual-list-items';
    itemsContainer.style.position = 'relative';
    itemsContainer.style.zIndex = '1';
    container.insertBefore(itemsContainer, bottomSpacer);
  }

  function renderItem(d, index) {
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

    return `
      <div class="dish-editor-card" style="${opacity} display:flex; align-items:center; gap:8px; height:${ITEM_HEIGHT}px;" data-dish-index="${index}" data-dish-id="${cleanDishId}">
        ${photoThumb}
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; flex-wrap:wrap; gap:2px;">
            ${chefBadge}${starBadge}${cleanName}${outBadge}
          </div>
          <div style="font-size:10px; color:var(--text-dim); display:flex; align-items:center; gap:4px; margin-top:2px;">
            ${cleanCatName} • ${priceDisplay} ${tags}
          </div>
        </div>
        <button class="btn-icon" data-js-click="editDish|${cleanDishId}" title="Editar">✏️</button>
        <button class="btn-icon" data-js-click="duplicateDishItem|${cleanDishId}" title="Duplicar">⧉</button>
        <button class="btn-icon btn-icon-danger" data-js-click="deleteDish|${cleanDishId}" title="Eliminar">🗑️</button>
      </div>
    `;
  }

  function renderVisible() {
    topSpacer.style.height = `${visibleStart * ITEM_HEIGHT}px`;
    bottomSpacer.style.height = `${Math.max(0, (dishes.length - visibleEnd) * ITEM_HEIGHT)}px`;
    
    let html = '';
    for (let i = visibleStart; i < visibleEnd; i++) {
      html += renderItem(dishes[i], i);
    }
    itemsContainer.innerHTML = html;
  }

  function updateVisibleRange() {
    const newStart = Math.max(0, Math.floor(scrollTop / ITEM_HEIGHT) - BUFFER);
    const newEnd = Math.min(dishes.length, Math.ceil((scrollTop + containerHeight) / ITEM_HEIGHT) + BUFFER);
    
    if (newStart !== visibleStart || newEnd !== visibleEnd) {
      visibleStart = newStart;
      visibleEnd = newEnd;
      renderVisible();
    }
  }

  function onScroll() {
    scrollTop = container.scrollTop;
    containerHeight = container.clientHeight;
    if (!renderScheduled) {
      renderScheduled = true;
      requestAnimationFrame(() => {
        updateVisibleRange();
        renderScheduled = false;
      });
    }
  }

  // Initial render
  renderVisible();
  
  // Scroll listener
  container.addEventListener('scroll', onScroll, { passive: true });
  
  // Cleanup on filter change (re-init will be called)
  container._virtualListCleanup = () => {
    container.removeEventListener('scroll', onScroll);
    container._virtualListCleanup = null;
  };
  
  // Re-render on resize
  const resizeObserver = new ResizeObserver(() => {
    containerHeight = container.clientHeight;
    updateVisibleRange();
  });
  resizeObserver.observe(container);
  container._virtualListResizeObserver = resizeObserver;
}

/**
 * Banner de cobertura de fotos: cuenta platos sin imagen y lo muestra en el
 * tab Carta. Solo informa (nunca bloquea): la foto vende, pero es opcional.
 */
export function updatePhotoCoverageBanner(restaurant) {
  const banner = document.getElementById('photoCoverageBanner');
  if (!banner) return;
  const dishes = restaurant?.dishes || [];
  const hasPhoto = (d) => Boolean(d.photoUrl || d.imageUrl || d.image || d.photo);
  const missing = dishes.filter(d => !hasPhoto(d)).length;
  if (dishes.length > 0 && missing > 0) {
    banner.style.display = 'block';
    banner.textContent = `📷 ${missing} de ${dishes.length} platos sin foto. La carta con fotos vende más: editalos con ✏️ y sumales imagen.`;
  } else {
    banner.style.display = 'none';
    banner.textContent = '';
  }
}

/**
 * Duplica un plato (foto, descripción, horarios y modificadores incluidos).
 * El clon nace visible (no agotado) justo después del original.
 */
export function duplicateDish(restaurant, dishId, onDuplicated) {
  const dishes = restaurant.dishes || [];
  const idx = dishes.findIndex(d => d.id === dishId);
  if (idx === -1) return;
  dishes.splice(idx + 1, 0, cloneDishWithNewIdUtil(dishes[idx]));
  if (typeof onDuplicated === 'function') onDuplicated();
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

// Video del plato (solo Stories): link MP4 directo o subida de archivo
// (vía URL firmada: los bytes van directo a Storage, nunca al servidor).
export function clearDishVideo() {
  const urlInput = document.getElementById('modalDishVideo');
  const fileInput = document.getElementById('modalDishVideoFile');
  const statusEl = document.getElementById('dishVideoUploadStatus');
  const clearBtn = document.getElementById('btnClearDishVideo');
  const previewContainer = document.getElementById('dishVideoPreviewContainer');
  const preview = document.getElementById('dishVideoPreview');

  if (urlInput) urlInput.value = '';
  if (fileInput) fileInput.value = '';
  if (statusEl) statusEl.textContent = '';
  if (clearBtn) clearBtn.style.display = 'none';
  if (previewContainer) previewContainer.style.display = 'none';
  if (preview) preview.removeAttribute('src');
}

export function previewDishVideo() {
  const urlInput = document.getElementById('modalDishVideo');
  const clearBtn = document.getElementById('btnClearDishVideo');
  const previewContainer = document.getElementById('dishVideoPreviewContainer');
  const preview = document.getElementById('dishVideoPreview');
  const url = urlInput ? urlInput.value.trim() : '';
  const ok = /^https:\/\//i.test(url) && /\.(mp4|webm)(\?|#|$)/i.test(url);
  if (ok && preview && previewContainer) {
    preview.src = url;
    previewContainer.style.display = 'block';
    if (clearBtn) clearBtn.style.display = 'inline';
  } else {
    if (previewContainer) previewContainer.style.display = 'none';
    if (clearBtn) clearBtn.style.display = url ? 'inline' : 'none';
    if (preview) preview.removeAttribute('src');
  }
}

export async function uploadDishVideoFile(input) {
  const file = input?.files?.[0];
  const statusEl = document.getElementById('dishVideoUploadStatus');
  const say = (msg) => { if (statusEl) statusEl.textContent = msg; };
  if (!file) return;
  if (!/^video\/(mp4|webm)$/i.test(file.type || '')) {
    say('Solo MP4 o WebM.');
    input.value = '';
    return;
  }
  if (file.size > 50 * 1024 * 1024) {
    say('El video no debe superar los 50 MB.');
    input.value = '';
    return;
  }
  say('⏳ Pidiendo URL de subida…');
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (window.AuthClient && typeof window.AuthClient.getAuthHeaders === 'function') {
      Object.assign(headers, window.AuthClient.getAuthHeaders());
    }
    const urlRes = await fetch('/api/storage/video-upload-url', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size })
    });
    const urlBody = await urlRes.json().catch(() => ({}));
    if (!urlRes.ok || !urlBody?.data?.uploadUrl) {
      throw new Error((urlBody && (urlBody.error || urlBody.message)) || 'No se pudo generar la subida.');
    }
    say('⏳ Subiendo video…');
    const putRes = await fetch(urlBody.data.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file
    });
    if (!putRes.ok) throw new Error('La subida falló (HTTP ' + putRes.status + ').');
    const urlInput = document.getElementById('modalDishVideo');
    if (urlInput) urlInput.value = urlBody.data.publicUrl;
    previewDishVideo();
    const left = (urlBody.data.videosMax ?? 10) - (urlBody.data.videosUsed ?? 0) - 1;
    say(left > 0 ? `✓ Video subido (${left} libres en tu carta).` : '✓ Video subido.');
    input.value = '';
  } catch (error) {
    say('⚠️ ' + (error.message || 'No se pudo subir el video.'));
    input.value = '';
  }
}

export async function handleDishPhotoUpload(input, compressImage) {
  const file = input?.files?.[0];
  if (!file) return;
  if (file.size > 12 * 1024 * 1024) {
    alert('La imagen original no debe superar los 12MB.');
    input.value = '';
    return;
  }

  try {
    const compressed = await compressImage(file);
    const urlInput = document.getElementById('modalDishPhoto');
    const previewContainer = document.getElementById('dishPhotoPreviewContainer');
    const preview = document.getElementById('dishPhotoPreview');
    const fileName = document.getElementById('dishPhotoFileName');
    const clearButton = document.getElementById('btnClearDishPhoto');

    if (urlInput) urlInput.value = compressed.dataUrl;
    if (preview) preview.src = compressed.dataUrl;
    if (previewContainer) previewContainer.style.display = 'block';
    if (fileName) fileName.textContent = file.name;
    if (clearButton) clearButton.style.display = 'inline';
  } catch (error) {
    alert(error.message || 'No se pudo procesar la foto del plato.');
    input.value = '';
  }
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
  // Recargo premium del armador (solo heladería): visible solo en ese rubro.
  const surchargeGroup = document.getElementById('dishSurchargeGroup');
  if (surchargeGroup) surchargeGroup.style.display = restaurant.businessType === 'heladeria' ? 'block' : 'none';
  if (el('modalDishSurcharge')) el('modalDishSurcharge').value = (dish.iceCreamSurcharge !== null && dish.iceCreamSurcharge !== undefined && Number(dish.iceCreamSurcharge) > 0) ? dish.iceCreamSurcharge : '';

  const existingPhoto = dish.photoUrl || dish.imageUrl || dish.image || dish.photo || '';
  if (el('modalDishPhoto')) el('modalDishPhoto').value = existingPhoto;
  // Video del plato (solo Stories): link directo, con preview.
  const existingVideo = dish.videoUrl || '';
  if (el('modalDishVideo')) el('modalDishVideo').value = existingVideo;
  previewDishVideo();
  if (el('modalDishOutOfStock')) el('modalDishOutOfStock').checked = !!dish.outOfStock;
  // F3 "Agotados con memoria": el tope de ventas del día (opt-in). Vacío = sin tope.
  if (el('modalDishDailyStock')) el('modalDishDailyStock').value = (dish.dailyStock ?? '');
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
  if (el('modalDishSurcharge')) el('modalDishSurcharge').value = '';
  const surchargeGroup = document.getElementById('dishSurchargeGroup');
  if (surchargeGroup) surchargeGroup.style.display = restaurant.businessType === 'heladeria' ? 'block' : 'none';
  if (el('modalDishPhoto')) el('modalDishPhoto').value = '';
  if (el('modalDishVideo')) el('modalDishVideo').value = '';
  clearDishVideo();
  if (el('modalDishOutOfStock')) el('modalDishOutOfStock').checked = false;
  if (el('modalDishDailyStock')) el('modalDishDailyStock').value = '';
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
  const surchargeVal = parseFloat(document.getElementById('modalDishSurcharge')?.value);
  const iceCreamSurcharge = isNaN(surchargeVal) ? 0 : Math.max(0, surchargeVal);
  const description = document.getElementById('modalDishDesc')?.value.trim();
  const photoUrl = document.getElementById('modalDishPhoto')?.value.trim();
  const videoUrl = document.getElementById('modalDishVideo')?.value.trim();
  const categoryId = document.getElementById('modalDishCategory')?.value;
  const outOfStock = document.getElementById('modalDishOutOfStock')?.checked;
  // F3 "Agotados con memoria": entero 1..9999; vacío/inválido → undefined
  // (sin memoria, comportamiento actual — el sanitizer aplica la MISMA regla).
  const dailyStockVal = parseInt(document.getElementById('modalDishDailyStock')?.value, 10);
  const dailyStock = (Number.isInteger(dailyStockVal) && dailyStockVal >= 1 && dailyStockVal <= 9999)
    ? dailyStockVal
    : undefined;
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
      dish.iceCreamSurcharge = iceCreamSurcharge;
      dish.description = description;
      dish.photoUrl = photoUrl || null;
      dish.videoUrl = videoUrl || null;
      dish.categoryId = finalCategoryId;
      dish.outOfStock = outOfStock;
      // F3: si el dueño vació el campo, el tope se REMUEVE (no queda un stock
      // viejo auto-agotando el plato para siempre).
      if (dailyStock !== undefined) {
        dish.dailyStock = dailyStock;
      } else {
        delete dish.dailyStock;
      }
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
      iceCreamSurcharge,
      description: description || 'Plato casero elaborado en el día',
      photoUrl: photoUrl || null,
      videoUrl: videoUrl || null,
      categoryId: finalCategoryId,
      outOfStock,
      dailyStock,
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
