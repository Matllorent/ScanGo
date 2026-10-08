/**
 * public/js/studio/modifierGroups.js
 * ──────────────────────────────────
 * Módulo ES para gestión de grupos de modificadores (proteínas, panes, extras, presentaciones).
 * Extraído de studio.js (getRestaurantModifierGroups, inferLegacyPackUnits, resolveLegacyPackUnits,
 * ensureDishModifierGroups, renderDishModifierAssignments, toggleDishModifierGroup, readDishModifierGroupIds,
 * openModifierGroupManager, closeModifierGroupManager, renderModifierGroupList, addBurgerModifierTemplate,
 * startNewModifierGroup, editModifierGroup, renderModifierGroupOptions, updateModifierGroupEditor,
 * handleModifierGroupModeChange, readModifierGroupOptions, addModifierGroupOption, removeModifierGroupOption,
 * saveModifierGroup, cancelModifierGroupEdit, deleteModifierGroup, getDishOptionConfig).
 */

/**
 * Retorna el array de grupos de modificadores del restaurante asegurando un array.
 * @param {object} restaurant
 * @returns {Array}
 */
export function getRestaurantModifierGroups(restaurant) {
  if (!restaurant) return [];
  if (!Array.isArray(restaurant.modifierGroups)) restaurant.modifierGroups = [];
  return restaurant.modifierGroups;
}

export function inferLegacyPackUnits(dish) {
  const name = String(dish?.name || '').toLowerCase();
  if (/media\s+docena|1\/2\s*docena|\b6\s*(?:unidades|un\.?|empanadas)\b/.test(name)) return 6;
  if (/\bdocena\b|\b12\s*(?:unidades|un\.?|empanadas)\b/.test(name)) return 12;
  if (/\b3\s*(?:unidades|un\.?|empanadas)\b|\btr[ií]o\b/.test(name)) return 3;
  return 1;
}

export function resolveLegacyPackUnits(dish) {
  const inferred = inferLegacyPackUnits(dish);
  const configured = parseInt(dish?.variantsPerItem, 10) || 0;
  return !configured || (configured === 1 && inferred > 1) ? inferred : configured;
}

export function ensureDishModifierGroups(restaurant, dish) {
  const groups = getRestaurantModifierGroups(restaurant);
  const ids = Array.isArray(dish?.modifierGroupIds) ? [...dish.modifierGroupIds] : [];
  const addLegacyGroup = (type, legacyOptions, settings) => {
    if (!Array.isArray(legacyOptions) || !legacyOptions.length) return;
    const id = `legacy_${type}_${dish.id}`;
    let group = groups.find(item => item.id === id);
    if (!group) {
      group = {
        id,
        name: settings.name,
        kind: settings.kind,
        selectionMode: settings.selectionMode,
        required: Boolean(settings.required),
        minSelections: settings.required ? 1 : 0,
        maxSelections: settings.selectionMode === 'single' ? 1 : 100,
        ...(settings.unitsPerSelection ? { unitsPerSelection: settings.unitsPerSelection } : {}),
        options: legacyOptions.map(option => ({
          id: String(option.id),
          name: String(option.name),
          priceDeltaCents: Math.max(0, Math.round(Number(option.priceDeltaCents) || 0)),
          active: option.active !== false
        }))
      };
      groups.push(group);
    }
    if (!ids.includes(id)) ids.push(id);
  };

  addLegacyGroup('protein', dish.proteinOptions, {
    name: 'Proteína', kind: 'protein', selectionMode: 'single', required: dish.proteinSelectionRequired
  });
  const splitFlavors = dish.variantSelectionMode === 'quantity_split';
  addLegacyGroup('flavors', dish.variants, {
    name: splitFlavors ? 'Sabores' : 'Variante',
    kind: splitFlavors ? 'flavor' : 'variant',
    selectionMode: splitFlavors ? 'quantity_split' : 'single',
    required: dish.variantsRequired,
    unitsPerSelection: splitFlavors ? resolveLegacyPackUnits(dish) : null
  });
  return ids;
}

export function renderDishModifierAssignments(restaurant, assignedIds = [], escapeHtml) {
  const container = document.getElementById('dishModifierGroupsList');
  if (!container) return;
  const groups = getRestaurantModifierGroups(restaurant).filter(group => group.active !== false);
  if (!groups.length) {
    container.innerHTML = '<p class="modifier-empty-state">Todavía no hay grupos. Creá uno para ofrecer proteínas, panes, extras o sabores.</p>';
    return;
  }

  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));
  const assigned = new Set(assignedIds);
  const presentationIds = groups.filter(group => group.kind === 'presentation' && assigned.has(group.id)).map(group => group.id);
  const visibleAssigned = presentationIds.length > 1
    ? new Set([...assigned].filter(id => !presentationIds.includes(id)).concat(presentationIds[0]))
    : assigned;
  container.innerHTML = groups.map(group => `
    <label class="dish-assigned-group">
      <input type="checkbox" data-modifier-group-id="${safeEscape(group.id)}" data-group-kind="${safeEscape(group.kind)}" data-js-change="toggleDishModifierGroup|this" ${visibleAssigned.has(group.id) ? 'checked' : ''}>
      <span><strong>${safeEscape(group.name)}</strong><small>${safeEscape(group.kind)} · ${(group.options || []).length} opciones${group.required ? ' · obligatorio' : ''}</small></span>
    </label>
  `).join('');
}

export function toggleDishModifierGroup(input) {
  if (!input || !input.checked || input.dataset.groupKind !== 'presentation') return;
  document.querySelectorAll('#dishModifierGroupsList [data-group-kind="presentation"]').forEach(other => {
    if (other !== input) other.checked = false;
  });
}

export function readDishModifierGroupIds() {
  return Array.from(document.querySelectorAll('#dishModifierGroupsList [data-modifier-group-id]:checked'))
    .map(input => input.dataset.modifierGroupId);
}

export function openModifierGroupManager(renderModifierGroupListFn) {
  const modal = document.getElementById('modifierGroupManagerModal');
  if (modal) modal.classList.add('active');
  if (typeof renderModifierGroupListFn === 'function') renderModifierGroupListFn();
}

export function closeModifierGroupManager(renderAssignmentsFn) {
  const modal = document.getElementById('modifierGroupManagerModal');
  if (modal) modal.classList.remove('active');
  if (typeof renderAssignmentsFn === 'function') {
    renderAssignmentsFn(readDishModifierGroupIds());
  }
}

export function renderModifierGroupList(restaurant, escapeHtml) {
  const container = document.getElementById('modifierGroupList');
  if (!container) return;
  const groups = getRestaurantModifierGroups(restaurant);
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));
  container.innerHTML = groups.length ? groups.map(group => `
    <div class="modifier-group-list-item">
      <div><strong>${safeEscape(group.name)}</strong><small>${safeEscape(group.kind)} · ${(group.options || []).length} opciones</small></div>
      <div class="modifier-group-list-actions">
        <button type="button" class="btn-icon" data-js-click="editModifierGroup|${safeEscape(group.id)}" aria-label="Editar ${safeEscape(group.name)}">✎</button>
        <button type="button" class="btn-icon btn-icon-danger" data-js-click="deleteModifierGroup|${safeEscape(group.id)}" aria-label="Eliminar ${safeEscape(group.name)}">×</button>
      </div>
    </div>
  `).join('') : '<p class="modifier-empty-state">Creá grupos reutilizables para personalizar los platos.</p>';
}

export function addBurgerModifierTemplate(restaurant, onUpdated) {
  const groups = getRestaurantModifierGroups(restaurant);
  if (groups.some(group => group.id.startsWith('template_burger_'))) {
    alert('La plantilla de hamburguesa ya existe. Editá sus grupos o asignalos a otro plato.');
    return;
  }
  const template = [
    {
      id: 'template_burger_bread',
      name: 'Tipo de pan',
      kind: 'bread',
      selectionMode: 'single',
      required: true,
      minSelections: 1,
      maxSelections: 1,
      active: true,
      options: [
        { id: 'template_bread_brioche', name: 'Brioche', priceDeltaCents: 0, active: true },
        { id: 'template_bread_potato', name: 'Pan de papa', priceDeltaCents: 0, active: true },
        { id: 'template_bread_gluten_free', name: 'Sin gluten', priceDeltaCents: 0, active: true }
      ]
    },
    {
      id: 'template_burger_extras',
      name: 'Extras',
      kind: 'topping',
      selectionMode: 'multiple',
      required: false,
      minSelections: 0,
      maxSelections: 3,
      active: true,
      options: [
        { id: 'template_extra_cheddar', name: 'Extra cheddar', priceDeltaCents: 0, active: true },
        { id: 'template_extra_bacon', name: 'Bacon', priceDeltaCents: 0, active: true },
        { id: 'template_extra_egg', name: 'Huevo', priceDeltaCents: 0, active: true }
      ]
    },
    {
      id: 'template_burger_patty',
      name: 'Medallones extra',
      kind: 'extra',
      selectionMode: 'quantity',
      required: false,
      minSelections: 0,
      maxSelections: 3,
      active: true,
      options: [{ id: 'template_extra_patty', name: 'Medallón extra', priceDeltaCents: 0, maxQuantity: 3, active: true }]
    }
  ];
  groups.push(...template);
  if (typeof onUpdated === 'function') onUpdated();
}

export function startNewModifierGroup() {
  const editor = document.getElementById('modifierGroupEditor');
  if (editor) editor.style.display = 'block';
  const el = id => document.getElementById(id);
  if (el('modifierGroupId')) el('modifierGroupId').value = '';
  if (el('modifierGroupName')) el('modifierGroupName').value = '';
  if (el('modifierGroupKind')) el('modifierGroupKind').value = 'protein';
  if (el('modifierGroupMode')) el('modifierGroupMode').value = 'single';
  if (el('modifierGroupRequired')) el('modifierGroupRequired').checked = false;
  if (el('modifierGroupMin')) el('modifierGroupMin').value = '0';
  if (el('modifierGroupMax')) el('modifierGroupMax').value = '1';
  if (el('modifierSplitUnits')) el('modifierSplitUnits').value = '12';
  renderModifierGroupOptions([]);
  updateModifierGroupEditor();
  if (el('modifierGroupName')) el('modifierGroupName').focus();
}

export function editModifierGroup(restaurant, groupId) {
  const group = getRestaurantModifierGroups(restaurant).find(item => item.id === groupId);
  if (!group) return;
  const editor = document.getElementById('modifierGroupEditor');
  if (editor) editor.style.display = 'block';
  const el = id => document.getElementById(id);
  if (el('modifierGroupId')) el('modifierGroupId').value = group.id;
  if (el('modifierGroupName')) el('modifierGroupName').value = group.name;
  if (el('modifierGroupKind')) el('modifierGroupKind').value = group.kind;
  if (el('modifierGroupMode')) el('modifierGroupMode').value = group.selectionMode;
  if (el('modifierGroupRequired')) el('modifierGroupRequired').checked = Boolean(group.required);
  if (el('modifierGroupMin')) el('modifierGroupMin').value = group.minSelections || 0;
  if (el('modifierGroupMax')) el('modifierGroupMax').value = group.maxSelections || 1;
  if (el('modifierSplitUnits')) el('modifierSplitUnits').value = group.unitsPerSelection || 12;
  renderModifierGroupOptions(group.options || []);
  updateModifierGroupEditor();
}

export function renderModifierGroupOptions(options, escapeHtml) {
  const kindEl = document.getElementById('modifierGroupKind');
  const modeEl = document.getElementById('modifierGroupMode');
  const kind = kindEl ? kindEl.value : 'protein';
  const mode = modeEl ? modeEl.value : 'single';
  const isPresentation = kind === 'presentation';
  const hasQuantities = mode === 'quantity';

  const headingPrice = document.getElementById('modifierPriceHeading');
  if (headingPrice) headingPrice.textContent = isPresentation ? 'Precio del paquete' : 'Adicional';
  const headingUnits = document.getElementById('modifierUnitsHeading');
  if (headingUnits) headingUnits.hidden = !isPresentation;
  const headingMax = document.getElementById('modifierMaxHeading');
  if (headingMax) headingMax.hidden = !hasQuantities;

  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));
  const listEl = document.getElementById('modifierGroupOptionsList');
  if (!listEl) return;
  listEl.innerHTML = (options || []).map((option, index) => `
    <div class="modifier-option-row">
      <input type="hidden" data-option-id value="${safeEscape(option.id || '')}">
      <input type="text" class="form-input" data-option-name maxlength="80" value="${safeEscape(option.name || '')}" placeholder="Nombre de la opción" aria-label="Nombre de la opción">
      <input type="number" class="form-input" data-option-price min="0" step="0.01" value="${option.priceValue !== undefined ? Number(option.priceValue) : (isPresentation ? (Number(option.priceCents) || 0) / 100 : (Number(option.priceDeltaCents) || 0) / 100)}" aria-label="${isPresentation ? 'Precio total' : 'Adicional de precio'}">
      <input type="number" class="form-input modifier-option-units" data-option-units min="1" max="100" step="1" value="${option.unitsIncluded || 1}" style="${isPresentation ? '' : 'display:none;'}" aria-label="Unidades incluidas">
      <input type="number" class="form-input modifier-option-max" data-option-max min="1" max="100" step="1" value="${option.maxQuantity || 3}" style="${hasQuantities && !isPresentation ? '' : 'display:none;'}" aria-label="Cantidad máxima">
      <button type="button" class="dish-option-remove" data-js-click="removeModifierGroupOption|${index}" aria-label="Quitar opción">×</button>
    </div>
  `).join('');
}

export function updateModifierGroupEditor() {
  const kind = document.getElementById('modifierGroupKind')?.value;
  if (kind === 'presentation') {
    const modeEl = document.getElementById('modifierGroupMode');
    if (modeEl) modeEl.value = 'single';
  }
  const mode = document.getElementById('modifierGroupMode')?.value;
  const maxEl = document.getElementById('modifierGroupMax');
  if (maxEl) maxEl.max = mode === 'single' || kind === 'presentation' ? '1' : '100';
  const splitField = document.getElementById('modifierSplitUnitsField');
  if (splitField) splitField.style.display = mode === 'quantity_split' ? 'block' : 'none';
  renderModifierGroupOptions(readModifierGroupOptions());
}

export function handleModifierGroupModeChange() {
  const mode = document.getElementById('modifierGroupMode')?.value;
  const maximum = document.getElementById('modifierGroupMax');
  if (!maximum) return;
  if (mode === 'single') maximum.value = '1';
  else if (maximum.value === '1') maximum.value = mode === 'quantity' ? '3' : '100';
  updateModifierGroupEditor();
}

export function readModifierGroupOptions() {
  return Array.from(document.querySelectorAll('#modifierGroupOptionsList .modifier-option-row')).map(row => ({
    id: row.querySelector('[data-option-id]')?.value || '',
    name: row.querySelector('[data-option-name]')?.value || '',
    priceValue: row.querySelector('[data-option-price]')?.value || '0',
    unitsIncluded: row.querySelector('[data-option-units]')?.value || '1',
    maxQuantity: row.querySelector('[data-option-max]')?.value || '1'
  }));
}

export function addModifierGroupOption() {
  const options = readModifierGroupOptions();
  options.push({ id: '', name: '', priceValue: '0', unitsIncluded: '1', maxQuantity: '3' });
  renderModifierGroupOptions(options);
  document.querySelector('#modifierGroupOptionsList .modifier-option-row:last-child [data-option-name]')?.focus();
}

export function removeModifierGroupOption(index) {
  const options = readModifierGroupOptions();
  options.splice(index, 1);
  renderModifierGroupOptions(options);
}

export function saveModifierGroup(restaurant, event, onSaved) {
  if (event) event.preventDefault();
  const assignedIds = readDishModifierGroupIds();
  const name = document.getElementById('modifierGroupName')?.value.trim().slice(0, 80);
  const kind = document.getElementById('modifierGroupKind')?.value;
  const selectionMode = kind === 'presentation' ? 'single' : document.getElementById('modifierGroupMode')?.value;
  const rawOptions = readModifierGroupOptions();
  const options = rawOptions.filter(option => option.name.trim()).map((option, index) => ({
    id: option.id || `opt_${Date.now()}_${index}`,
    name: option.name.trim().slice(0, 80),
    priceDeltaCents: kind === 'presentation' ? 0 : Math.max(0, Math.round((Number(option.priceValue) || 0) * 100)),
    ...(kind === 'presentation' ? {
      priceCents: Math.max(0, Math.round((Number(option.priceValue) || 0) * 100)),
      unitsIncluded: Math.max(1, Math.min(100, parseInt(option.unitsIncluded, 10) || 1))
    } : {}),
    ...(selectionMode === 'quantity' ? { maxQuantity: Math.max(1, Math.min(100, parseInt(option.maxQuantity, 10) || 1)) } : {}),
    active: true
  }));

  if (!name || !options.length) {
    alert('El grupo necesita un nombre y al menos una opción.');
    return;
  }
  if (kind === 'presentation' && options.some(option => !option.priceCents)) {
    alert('Cada presentación necesita un precio mayor a cero.');
    return;
  }

  const id = document.getElementById('modifierGroupId')?.value || `group_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const groups = getRestaurantModifierGroups(restaurant);
  const existingIndex = groups.findIndex(group => group.id === id);
  const required = document.getElementById('modifierGroupRequired')?.checked;
  const maximum = selectionMode === 'single' ? 1 : Math.max(1, Math.min(100, parseInt(document.getElementById('modifierGroupMax')?.value, 10) || 1));
  const group = {
    id,
    name,
    kind,
    selectionMode,
    required,
    minSelections: Math.max(0, Math.min(maximum, parseInt(document.getElementById('modifierGroupMin')?.value, 10) || 0)),
    maxSelections: maximum,
    ...(selectionMode === 'quantity_split' ? { unitsPerSelection: Math.max(1, Math.min(100, parseInt(document.getElementById('modifierSplitUnits')?.value, 10) || 1)) } : {}),
    active: true,
    options
  };

  if (existingIndex >= 0) groups[existingIndex] = group;
  else groups.push(group);

  const editorDish = restaurant.dishes?.find(dish => dish.id === document.getElementById('modalDishId')?.value);
  if (editorDish) editorDish.modifierGroupIds = assignedIds;

  const editor = document.getElementById('modifierGroupEditor');
  if (editor) editor.style.display = 'none';

  if (typeof onSaved === 'function') onSaved(assignedIds);
}

export function cancelModifierGroupEdit() {
  const editor = document.getElementById('modifierGroupEditor');
  if (editor) editor.style.display = 'none';
}

export function deleteModifierGroup(restaurant, groupId, onDeleted) {
  const groups = getRestaurantModifierGroups(restaurant);
  const group = groups.find(item => item.id === groupId);
  if (!group || !confirm(`¿Eliminar el grupo "${group.name}"? También se quitará de los platos que lo usan.`)) return;
  const assignedIds = readDishModifierGroupIds().filter(id => id !== groupId);
  restaurant.modifierGroups = groups.filter(item => item.id !== groupId);
  (restaurant.dishes || []).forEach(dish => {
    dish.modifierGroupIds = (dish.modifierGroupIds || []).filter(id => id !== groupId);
  });
  if (typeof onDeleted === 'function') onDeleted(assignedIds);
}

export function getDishOptionConfig() {
  return { modifierGroupIds: readDishModifierGroupIds() };
}
