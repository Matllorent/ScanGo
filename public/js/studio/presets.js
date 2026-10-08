/**
 * public/js/studio/presets.js
 * ───────────────────────────
 * Módulo ES para la carga e importación de plantillas (presets) de platos, heladerías y perfumerías.
 * Extraído de studio.js (openPresetsModal, closePresetsModal, renderPresetChips, browsePresetCategory,
 * buildPresetDish, ensureEmpanadaPresetGroups, addSinglePresetDish, importCurrentPresetCategory,
 * importPresetCategory, importAllPresets, openIceCreamPresetsModal, closeIceCreamPresetsModal,
 * filterIceCreamPresetCat, toggleAllIceCreamFlavors, renderIceCreamPresetsList, toggleIceCreamFlavorItem,
 * importSelectedIceCreamFlavors, openPerfumeryPresetsModal, closePerfumeryPresetsModal,
 * renderPerfumeryPresetsList, importSelectedPerfumery).
 */

import { PRESETS } from './data/presetsData.js';
import { ICE_CREAM_PRESETS_DATA } from './data/iceCreamPresets.js';
import { PERFUMERY_PRESETS_STUDIO } from './data/perfumeryPresets.js';
import { getRestaurantModifierGroups } from './modifierGroups.js';

let currentPresetCategory = 'empanadas';
let iceCreamSelectedIds = new Set(ICE_CREAM_PRESETS_DATA.map(f => f.id));
let iceCreamActiveCat = 'ALL';

export function openPresetsModal(escapeHtml) {
  const modal = document.getElementById('presetsModal');
  if (modal) modal.classList.add('active');
  renderPresetChips();
  browsePresetCategory('empanadas', escapeHtml);
}

export function closePresetsModal() {
  const modal = document.getElementById('presetsModal');
  if (modal) modal.classList.remove('active');
}

export function renderPresetChips(onBrowseCategory) {
  const container = document.getElementById('presetChipsContainer');
  if (!container) return;
  container.innerHTML = '';
  Object.keys(PRESETS).forEach(key => {
    const p = PRESETS[key];
    const chip = document.createElement('button');
    chip.className = 'btn-nav';
    chip.style.cssText = 'white-space:nowrap; font-size:11px; padding:5px 12px; flex-shrink:0;';
    chip.textContent = p.catName;
    chip.onclick = () => {
      if (typeof onBrowseCategory === 'function') onBrowseCategory(key);
      else browsePresetCategory(key);
    };
    if (key === currentPresetCategory) {
      chip.style.background = 'var(--accent-gold)';
      chip.style.color = '#101614';
      chip.style.fontWeight = '700';
      chip.style.borderColor = 'var(--accent-gold)';
    }
    container.appendChild(chip);
  });
}

export function browsePresetCategory(key, escapeHtml) {
  currentPresetCategory = key;
  const preset = PRESETS[key];
  if (!preset) return;

  const labelEl = document.getElementById('presetCategoryLabel');
  if (labelEl) labelEl.textContent = preset.catName;
  renderPresetChips();

  const list = document.getElementById('presetDishesList');
  if (!list) return;
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));

  let html = '';
  preset.dishes.forEach((d, idx) => {
    const tagBadges = (d.tags || []).map(t => {
      const labels = { star: '⭐', veggie: '🥬', vegan: '🌱', celiac: '🌾', sinlactosa: '🥛', picante: '🌶️' };
      return labels[t] || '';
    }).join(' ');
    html += `
      <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-base); padding:8px 10px; border-radius:8px; margin-bottom:6px; border:1px solid var(--border);">
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; gap:4px;">
            ${safeEscape(d.name)} ${tagBadges}
          </div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${safeEscape(d.desc)}</div>
          <div style="font-size:11px; color:var(--accent-gold); font-family:var(--font-mono); margin-top:2px;">$ ${d.price}</div>
        </div>
        <button class="btn-nav btn-nav-gold" style="font-size:11px; padding:4px 10px; flex-shrink:0; margin-left:8px;" data-js-click="addSinglePresetDish|${key}|${idx}">
          + Sumar
        </button>
      </div>
    `;
  });
  list.innerHTML = html;
}

export function buildPresetDish(presetKey, dish, categoryId, index, restaurant) {
  if (presetKey === 'empanadas' && Array.isArray(dish.variants)) {
    return {
      id: `d_${presetKey}_${Date.now()}_${index}`,
      categoryId,
      name: dish.name,
      price: dish.price,
      description: dish.desc,
      tags: dish.tags || [],
      modifierGroupIds: ensureEmpanadaPresetGroups(dish, restaurant)
    };
  }

  const optionConfig = Array.isArray(dish.variants) ? {
    variants: dish.variants,
    variantSelectionMode: dish.variantSelectionMode || 'single',
    variantsRequired: Boolean(dish.variantsRequired),
    ...(dish.variantSelectionMode === 'quantity_split' ? { variantsPerItem: dish.variantsPerItem || 1 } : {})
  } : {};
  return {
    id: `d_${presetKey}_${Date.now()}_${index}`,
    categoryId,
    name: dish.name,
    price: dish.price,
    description: dish.desc,
    tags: dish.tags || [],
    ...optionConfig
  };
}

export function ensureEmpanadaPresetGroups(dish, restaurant) {
  const groups = getRestaurantModifierGroups(restaurant);
  const presentationId = 'preset_empanadas_presentation';
  const flavorsId = 'preset_empanadas_flavors';

  if (!groups.some(group => group.id === presentationId)) {
    groups.push({
      id: presentationId,
      name: 'Presentación',
      kind: 'presentation',
      selectionMode: 'single',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      active: true,
      options: [
        { id: 'empanadas_3', name: '3 unidades', unitsIncluded: 3, priceCents: 28500, priceDeltaCents: 0, active: true },
        { id: 'empanadas_6', name: 'Media docena (6)', unitsIncluded: 6, priceCents: 55000, priceDeltaCents: 0, active: true },
        { id: 'empanadas_12', name: 'Docena (12)', unitsIncluded: 12, priceCents: 108000, priceDeltaCents: 0, active: true }
      ]
    });
  }
  if (!groups.some(group => group.id === flavorsId)) {
    groups.push({
      id: flavorsId,
      name: 'Sabores',
      kind: 'flavor',
      selectionMode: 'quantity_split',
      required: true,
      minSelections: 1,
      maxSelections: 100,
      unitsPerSelection: 12,
      active: true,
      options: (dish.variants || []).map(option => ({
        ...option,
        priceDeltaCents: Number(option.priceDeltaCents) || 0,
        active: true
      }))
    });
  }
  return [presentationId, flavorsId];
}

export function addSinglePresetDish(presetKey, dishIdx, restaurant, onUpdated) {
  const preset = PRESETS[presetKey];
  if (!preset || !preset.dishes[dishIdx]) return;
  const d = preset.dishes[dishIdx];

  if (!restaurant.categories) restaurant.categories = [];
  if (!restaurant.dishes) restaurant.dishes = [];

  let cat = restaurant.categories.find(c => c.name.toLowerCase() === preset.catName.toLowerCase());
  if (!cat) {
    cat = { id: 'cat_' + presetKey + '_' + Date.now(), name: preset.catName };
    restaurant.categories.push(cat);
  }

  restaurant.dishes.push(buildPresetDish(presetKey, d, cat.id, dishIdx, restaurant));
  if (typeof onUpdated === 'function') onUpdated();

  const btns = document.querySelectorAll('#presetDishesList button');
  if (btns[dishIdx]) {
    btns[dishIdx].textContent = '✓ Agregado';
    btns[dishIdx].disabled = true;
    setTimeout(() => {
      btns[dishIdx].textContent = '+ Sumar';
      btns[dishIdx].disabled = false;
    }, 1500);
  }
}

export function importCurrentPresetCategory(restaurant, onUpdated) {
  importPresetCategory(currentPresetCategory, restaurant, onUpdated);
}

export function importPresetCategory(presetKey, restaurant, onUpdated) {
  const preset = PRESETS[presetKey];
  if (!preset) return;

  if (!restaurant.categories) restaurant.categories = [];
  if (!restaurant.dishes) restaurant.dishes = [];

  let cat = restaurant.categories.find(c => c.name.toLowerCase() === preset.catName.toLowerCase());
  if (!cat) {
    cat = { id: 'cat_' + presetKey + '_' + Date.now(), name: preset.catName };
    restaurant.categories.push(cat);
  }

  preset.dishes.forEach((dish, index) => {
    restaurant.dishes.push(buildPresetDish(presetKey, dish, cat.id, index, restaurant));
  });

  closePresetsModal();
  if (typeof onUpdated === 'function') onUpdated();
  alert(`¡Se agregaron ${preset.dishes.length} platos de ${preset.catName}!`);
}

export function importAllPresets(restaurant, onUpdated) {
  Object.keys(PRESETS).forEach(k => {
    const p = PRESETS[k];
    let cat = (restaurant.categories || []).find(c => c.name.toLowerCase() === p.catName.toLowerCase());
    if (!cat) {
      cat = { id: 'cat_' + k + '_' + Date.now(), name: p.catName };
      if (!restaurant.categories) restaurant.categories = [];
      restaurant.categories.push(cat);
    }
    p.dishes.forEach((dish, index) => {
      restaurant.dishes.push(buildPresetDish(k, dish, cat.id, index, restaurant));
    });
  });

  closePresetsModal();
  if (typeof onUpdated === 'function') onUpdated();
  alert('¡Carta completa de 100+ platos importada con éxito!');
}

export function openIceCreamPresetsModal() {
  const modal = document.getElementById('iceCreamPresetsModal');
  if (modal) modal.classList.add('active');
  renderIceCreamPresetsList();
}

export function closeIceCreamPresetsModal() {
  const modal = document.getElementById('iceCreamPresetsModal');
  if (modal) modal.classList.remove('active');
}

export function filterIceCreamPresetCat(cat) {
  iceCreamActiveCat = cat;
  const pills = document.querySelectorAll('#iceCreamPresetFilterBar .cat-pill');
  pills.forEach(p => {
    p.classList.toggle('active', p.textContent.includes(cat) || (cat === 'ALL' && p.textContent.includes('Todos')));
  });
  renderIceCreamPresetsList();
}

export function toggleAllIceCreamFlavors(select) {
  if (select) {
    ICE_CREAM_PRESETS_DATA.forEach(f => iceCreamSelectedIds.add(f.id));
  } else {
    iceCreamSelectedIds.clear();
  }
  renderIceCreamPresetsList();
}

export function renderIceCreamPresetsList() {
  const container = document.getElementById('iceCreamPresetsListContainer');
  const countLabel = document.getElementById('iceCreamPresetCountLabel');
  if (!container) return;

  if (countLabel) {
    countLabel.textContent = `${iceCreamSelectedIds.size} de ${ICE_CREAM_PRESETS_DATA.length} seleccionados`;
  }

  const filtered = ICE_CREAM_PRESETS_DATA.filter(f => iceCreamActiveCat === 'ALL' || f.cat === iceCreamActiveCat);

  let html = '';
  filtered.forEach(f => {
    const isChecked = iceCreamSelectedIds.has(f.id);
    const tags = (f.tags || []).map(t => {
      if (t === 'star') return '⭐';
      if (t === 'celiac') return '🌾 Sin TACC';
      if (t === 'vegan') return '🌱 Vegano';
      return '';
    }).filter(Boolean).join(' ');

    html += `
      <div style="display:flex; align-items:center; justify-content:space-between; background:var(--bg-base); padding:8px 12px; border-radius:8px; margin-bottom:6px; border:1px solid ${isChecked ? 'var(--accent-gold)' : 'var(--border)'};">
        <label style="display:flex; align-items:center; gap:10px; flex:1; cursor:pointer; min-width:0;">
          <input type="checkbox" ${isChecked ? 'checked' : ''} data-js-change="toggleIceCreamFlavorItem|${f.id}|this.checked" style="width:18px; height:18px; accent-color:var(--accent-gold); cursor:pointer;">
          <div style="min-width:0;">
            <div style="font-size:12px; font-weight:700; color:#fff; display:flex; align-items:center; gap:6px; flex-wrap:wrap;">
              <span>${f.name}</span>
              <span style="font-size:10px; color:var(--accent-gold);">${tags}</span>
            </div>
            <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${f.desc}</div>
          </div>
        </label>
        <div style="font-size:11px; font-weight:700; color:var(--accent-gold); font-family:var(--font-mono); margin-left:8px; white-space:nowrap;">
          $ ${f.price}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
}

export function toggleIceCreamFlavorItem(id, checked) {
  if (checked) iceCreamSelectedIds.add(id);
  else iceCreamSelectedIds.delete(id);
  const countLabel = document.getElementById('iceCreamPresetCountLabel');
  if (countLabel) countLabel.textContent = `${iceCreamSelectedIds.size} de ${ICE_CREAM_PRESETS_DATA.length} seleccionados`;
}

export function importSelectedIceCreamFlavors(restaurant, onUpdated) {
  if (iceCreamSelectedIds.size === 0) {
    alert('Por favor marcá al menos 1 sabor para importar.');
    return;
  }

  if (!restaurant.categories) restaurant.categories = [];
  if (!restaurant.dishes) restaurant.dishes = [];

  let importedCount = 0;
  ICE_CREAM_PRESETS_DATA.forEach(f => {
    if (!iceCreamSelectedIds.has(f.id)) return;

    const catName = `🍦 Helados (${f.cat})`;
    let cat = restaurant.categories.find(c => c.name.toLowerCase() === catName.toLowerCase());
    if (!cat) {
      cat = { id: 'cat_helados_' + f.cat.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + Date.now(), name: catName };
      restaurant.categories.push(cat);
    }

    const existingDish = restaurant.dishes.find(d => d.name.toLowerCase() === f.name.toLowerCase());
    if (!existingDish) {
      restaurant.dishes.push({
        id: 'd_ice_' + f.id + '_' + Date.now(),
        categoryId: cat.id,
        name: f.name,
        price: f.price,
        description: f.desc,
        tags: f.tags || []
      });
      importedCount++;
    }
  });

  closeIceCreamPresetsModal();
  if (typeof onUpdated === 'function') onUpdated();
  alert(`¡Se importaron ${importedCount} sabores de heladería a tu carta!`);
}

export function openPerfumeryPresetsModal() {
  const modal = document.getElementById('perfumeryPresetsModal');
  if (modal) modal.classList.add('active');
  renderPerfumeryPresetsList();
}

export function closePerfumeryPresetsModal() {
  const modal = document.getElementById('perfumeryPresetsModal');
  if (modal) modal.classList.remove('active');
}

export function renderPerfumeryPresetsList() {
  const container = document.getElementById('perfumeryPresetsListContainer');
  if (!container) return;

  let html = '';
  PERFUMERY_PRESETS_STUDIO.forEach(p => {
    html += `
      <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px; display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="flex:1; min-width:0;">
          <div style="font-size:12px; font-weight:700; color:#fff;">${p.name}</div>
          <div style="font-size:10px; color:var(--accent-gold); margin-top:1px;">${p.cat} • $ ${p.price}</div>
          <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">${p.desc}</div>
        </div>
        <input type="checkbox" class="perfume-preset-checkbox" value="${p.id}" checked style="width:18px; height:18px; accent-color:var(--accent-gold); cursor:pointer;">
      </div>
    `;
  });
  container.innerHTML = html;
}

export function importSelectedPerfumery(restaurant, onUpdated) {
  const checkboxes = document.querySelectorAll('.perfume-preset-checkbox:checked');
  if (!checkboxes.length) {
    alert('Marcá al menos una fragancia para importar.');
    return;
  }

  if (!restaurant.categories) restaurant.categories = [];
  if (!restaurant.dishes) restaurant.dishes = [];

  let count = 0;
  checkboxes.forEach(cb => {
    const p = PERFUMERY_PRESETS_STUDIO.find(item => item.id === cb.value);
    if (!p) return;

    let cat = restaurant.categories.find(c => c.name.toLowerCase() === p.cat.toLowerCase());
    if (!cat) {
      cat = { id: 'cat_perf_' + p.id + '_' + Date.now(), name: `🌸 ${p.cat}` };
      restaurant.categories.push(cat);
    }

    const existing = restaurant.dishes.find(d => d.name.toLowerCase() === p.name.toLowerCase());
    if (!existing) {
      restaurant.dishes.push({
        id: 'd_perf_' + p.id + '_' + Date.now(),
        categoryId: cat.id,
        name: p.name,
        price: p.price,
        description: p.desc,
        tags: p.tags || []
      });
      count++;
    }
  });

  closePerfumeryPresetsModal();
  if (typeof onUpdated === 'function') onUpdated();
  alert(`¡Se importaron ${count} fragancias a tu carta!`);
}
