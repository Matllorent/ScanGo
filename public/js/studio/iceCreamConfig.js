/**
 * public/js/studio/iceCreamConfig.js
 * ──────────────────────────────────
 * Editor de tamaños, precios y toppings de heladería (config del dueño).
 * Las filas viven en restaurant.iceCreamContainers / restaurant.iceCreamToppings
 * y se guardan con /api/studio/save (sanitizadas en el backend; vacío =
 * defaults del wizard). Render con escape (nunca innerHTML con data cruda).
 */
import { escapeHtml as escapeHtmlDefault } from '../utils/escapeHtmlBrowser.js';

export function getIceCreamContainers(restaurant) {
  if (!restaurant) return [];
  if (!Array.isArray(restaurant.iceCreamContainers)) restaurant.iceCreamContainers = [];
  return restaurant.iceCreamContainers;
}

export function getIceCreamToppings(restaurant) {
  if (!restaurant) return [];
  if (!Array.isArray(restaurant.iceCreamToppings)) restaurant.iceCreamToppings = [];
  return restaurant.iceCreamToppings;
}

export function renderIceCreamConfigRows(restaurant, escapeHtml) {
  const esc = typeof escapeHtml === 'function' ? escapeHtml : escapeHtmlDefault;
  const contBox = document.getElementById('iceCreamContainersRows');
  if (contBox) {
    const list = getIceCreamContainers(restaurant);
    contBox.innerHTML = list.length ? list.map((c, i) => `
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; background:var(--surface-2); padding:6px 8px; border-radius:6px; border:1px solid var(--border);">
        <input type="text" class="form-input" value="${esc(c.icon || '🍦')}" maxlength="8" title="Icono"
               data-js-input="updateIceCreamContainerField|${i}|icon|this.value" style="width:44px; flex-shrink:0; font-size:13px; padding:6px 4px; text-align:center;">
        <input type="text" class="form-input" value="${esc(c.name || '')}" maxlength="40" placeholder="Pote 1/2 kg"
               data-js-input="updateIceCreamContainerField|${i}|name|this.value" style="flex:2; min-width:110px; font-size:11px; padding:6px 8px;" title="Nombre del tamaño" aria-label="Nombre del tamaño ${i + 1}">
        <input type="number" class="form-input" value="${Number(c.price) || 0}" min="0" max="1000000" step="1" placeholder="$"
               data-js-input="updateIceCreamContainerField|${i}|price|this.value" style="width:84px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Precio" aria-label="Precio del tamaño ${i + 1}">
        <input type="number" class="form-input" value="${Math.max(1, Math.min(6, parseInt(c.maxFlavors, 10) || 1))}" min="1" max="6" step="1"
               data-js-input="updateIceCreamContainerField|${i}|maxFlavors|this.value" style="width:56px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Sabores que admite" aria-label="Sabores que admite el tamaño ${i + 1}">
        <input type="text" class="form-input" value="${esc(c.badge || '')}" maxlength="20" placeholder="Etiqueta"
               data-js-input="updateIceCreamContainerField|${i}|badge|this.value" style="width:84px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Etiqueta (opcional)">
        <button type="button" class="btn-nav" data-js-click="removeIceCreamContainer|${i}" aria-label="Quitar tamaño ${i + 1}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
      </div>
    `).join('') : '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin tamaños propios: el armador usa los originales (barquillo, cucurucho, 1/4, 1/2, 1 kg…).</div>';
  }
  const topBox = document.getElementById('iceCreamToppingsRows');
  if (topBox) {
    const list = getIceCreamToppings(restaurant);
    topBox.innerHTML = list.length ? list.map((t, i) => `
      <div style="display:flex; gap:6px; align-items:center; flex-wrap:wrap; background:var(--surface-2); padding:6px 8px; border-radius:6px; border:1px solid var(--border);">
        <input type="text" class="form-input" value="${esc(t.icon || '✨')}" maxlength="8" title="Icono"
               data-js-input="updateIceCreamToppingField|${i}|icon|this.value" style="width:44px; flex-shrink:0; font-size:13px; padding:6px 4px; text-align:center;">
        <input type="text" class="form-input" value="${esc(t.name || '')}" maxlength="60" placeholder="Granola sin TACC"
               data-js-input="updateIceCreamToppingField|${i}|name|this.value" style="flex:2; min-width:110px; font-size:11px; padding:6px 8px;" title="Nombre del agregado" aria-label="Nombre del agregado ${i + 1}">
        <input type="number" class="form-input" value="${Number(t.price) || 0}" min="0" max="1000000" step="1" placeholder="$"
               data-js-input="updateIceCreamToppingField|${i}|price|this.value" style="width:84px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Precio adicional" aria-label="Precio del agregado ${i + 1}">
        <select class="form-input" data-js-change="updateIceCreamToppingField|${i}|kind|this.value" style="width:96px; flex-shrink:0; font-size:11px; padding:6px 4px;" title="Tipo" aria-label="Tipo del agregado ${i + 1}">
          <option value="topping"${t.kind !== 'salsa' ? ' selected' : ''}>Topping</option>
          <option value="salsa"${t.kind === 'salsa' ? ' selected' : ''}>Salsa</option>
        </select>
        <button type="button" class="btn-nav" data-js-click="removeIceCreamTopping|${i}" aria-label="Quitar agregado ${i + 1}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
      </div>
    `).join('') : '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin agregados propios: el armador usa los originales.</div>';
  }
}

export function updateIceCreamContainerField(restaurant, index, field, value) {
  const list = getIceCreamContainers(restaurant);
  const row = list[Number(index)];
  if (!row) return;
  if (field === 'price') row.price = Math.max(0, Math.min(1000000, parseFloat(value) || 0));
  else if (field === 'maxFlavors') {
    const n = parseInt(value, 10);
    row.maxFlavors = Number.isInteger(n) ? Math.max(1, Math.min(6, n)) : 1;
  }
  else if (field === 'name') row.name = String(value || '').slice(0, 40);
  else if (field === 'capacityLabel') row.capacityLabel = String(value || '').slice(0, 30);
  else if (field === 'icon') row.icon = String(value || '').slice(0, 8);
  else if (field === 'badge') row.badge = String(value || '').slice(0, 20);
}

export function addIceCreamContainer(restaurant) {
  const list = getIceCreamContainers(restaurant);
  if (list.length >= 12) return;
  list.push({ id: `cont_${Date.now().toString(36)}`, name: '', price: 0, maxFlavors: 2, icon: '🍦', badge: '' });
}

export function removeIceCreamContainer(restaurant, index) {
  const list = getIceCreamContainers(restaurant);
  list.splice(Number(index), 1);
}

export function updateIceCreamToppingField(restaurant, index, field, value) {
  const list = getIceCreamToppings(restaurant);
  const row = list[Number(index)];
  if (!row) return;
  if (field === 'price') row.price = Math.max(0, Math.min(1000000, parseFloat(value) || 0));
  else if (field === 'name') row.name = String(value || '').slice(0, 60);
  else if (field === 'icon') row.icon = String(value || '').slice(0, 8);
  else if (field === 'kind') row.kind = String(value) === 'salsa' ? 'salsa' : 'topping';
}

export function addIceCreamTopping(restaurant) {
  const list = getIceCreamToppings(restaurant);
  if (list.length >= 30) return;
  list.push({ id: `top_${Date.now().toString(36)}`, name: '', price: 0, icon: '✨', kind: 'topping' });
}

export function removeIceCreamTopping(restaurant, index) {
  const list = getIceCreamToppings(restaurant);
  list.splice(Number(index), 1);
}

// Volver a los originales = vaciar (el backend omite vacíos y el wizard usa defaults).
export function resetIceCreamConfig(restaurant) {
  if (!restaurant) return;
  restaurant.iceCreamContainers = [];
  restaurant.iceCreamToppings = [];
}
