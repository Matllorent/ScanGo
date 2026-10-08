/**
 * public/js/studio/categoryManager.js
 * ───────────────────────────────────
 * Módulo ES para la gestión y ordenamiento de categorías del menú.
 * Extraído de studio.js (openCategoryManagerModal, closeCategoryManagerModal,
 * renderCategoryManagerList, moveCategory, addCategoryFromManager, renameCategory, deleteCategory).
 */

/**
 * Abre el diálogo rápido para crear una nueva categoría desde el modal de plato.
 * @param {object} restaurant
 * @param {Function} populateCatFilter
 * @param {Function} triggerAutoSave
 */
export function promptNewCategoryInModal(restaurant, populateCatFilter, triggerAutoSave) {
  const name = prompt('Ingresa el nombre de la nueva categoría (ej: Postres, Cafetería):');
  if (!name || !name.trim()) return;
  const cleanName = name.trim();
  if (!restaurant.categories) restaurant.categories = [];
  let cat = restaurant.categories.find(c => c.name.toLowerCase() === cleanName.toLowerCase());
  if (!cat) {
    cat = { id: 'cat_' + Date.now(), name: cleanName };
    restaurant.categories.push(cat);
    if (typeof populateCatFilter === 'function') populateCatFilter();
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
  const catSelect = document.getElementById('modalDishCategory');
  if (catSelect) {
    catSelect.innerHTML = '';
    restaurant.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === cat.id) opt.selected = true;
      catSelect.appendChild(opt);
    });
  }
}

/**
 * Abre el modal del gestor de categorías.
 * @param {Function} renderCategoryManagerListFn
 */
export function openCategoryManagerModal(renderCategoryManagerListFn) {
  if (typeof renderCategoryManagerListFn === 'function') {
    renderCategoryManagerListFn();
  }
  const modal = document.getElementById('categoryManagerModal');
  if (modal) modal.classList.add('active');
}

/**
 * Cierra el modal de categorías y actualiza selectores.
 * @param {Function} populateCatFilter
 */
export function closeCategoryManagerModal(populateCatFilter) {
  const modal = document.getElementById('categoryManagerModal');
  if (modal) modal.classList.remove('active');
  if (typeof populateCatFilter === 'function') populateCatFilter();
}

/**
 * Renderiza la lista de categorías con controles de mover, editar y eliminar.
 * @param {object} restaurant
 * @param {Function} escapeHtml
 */
export function renderCategoryManagerList(restaurant, escapeHtml) {
  const list = document.getElementById('categoryManagerList');
  if (!list) return;
  const cats = restaurant.categories || [];
  if (!cats.length) {
    list.innerHTML = '<div style="font-size:11px; color:var(--text-dim); text-align:center; padding:12px;">No hay categorías creadas aún.</div>';
    return;
  }
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));
  list.innerHTML = cats.map((c, index) => `
    <div style="display:flex; justify-content:space-between; align-items:center; background:var(--surface-2); padding:8px 12px; border-radius:6px; border:1px solid var(--border);">
      <span style="font-size:12px; font-weight:600; color:#fff;">${safeEscape(c.name)}</span>
      <div style="display:flex; gap:6px;">
        <button class="btn-icon" data-js-click="moveCategory|${safeEscape(c.id)}|-1" title="Mover arriba" aria-label="Mover ${safeEscape(c.name)} arriba" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button class="btn-icon" data-js-click="moveCategory|${safeEscape(c.id)}|1" title="Mover abajo" aria-label="Mover ${safeEscape(c.name)} abajo" ${index === cats.length - 1 ? 'disabled' : ''}>↓</button>
        <button class="btn-icon" data-js-click="renameCategory|${safeEscape(c.id)}" title="Renombrar">✏️</button>
        <button class="btn-icon btn-icon-danger" data-js-click="deleteCategory|${safeEscape(c.id)}" title="Eliminar">🗑️</button>
      </div>
    </div>
  `).join('');
}

/**
 * Reordena una categoría subiéndola o bajándola.
 * @param {object} restaurant
 * @param {string} catId
 * @param {number} direction
 * @param {Function} onUpdated
 */
export function moveCategory(restaurant, catId, direction, onUpdated) {
  const categories = restaurant.categories || [];
  const currentIndex = categories.findIndex(category => category.id === catId);
  const targetIndex = currentIndex + direction;
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= categories.length) return;

  [categories[currentIndex], categories[targetIndex]] = [categories[targetIndex], categories[currentIndex]];
  if (typeof onUpdated === 'function') onUpdated();
}

/**
 * Añade una categoría desde el input del gestor.
 * @param {object} restaurant
 * @param {Function} onUpdated
 */
export function addCategoryFromManager(restaurant, onUpdated) {
  const input = document.getElementById('newCategoryInput');
  if (!input) return;
  const name = (input.value || '').trim();
  if (!name) return;
  if (!restaurant.categories) restaurant.categories = [];
  const exists = restaurant.categories.some(c => c.name.toLowerCase() === name.toLowerCase());
  if (exists) return alert('Esa categoría ya existe.');
  restaurant.categories.push({ id: 'cat_' + Date.now(), name });
  input.value = '';
  if (typeof onUpdated === 'function') onUpdated();
}

/**
 * Renombra una categoría existente.
 * @param {object} restaurant
 * @param {string} catId
 * @param {Function} onUpdated
 */
export function renameCategory(restaurant, catId, onUpdated) {
  const cat = (restaurant.categories || []).find(c => c.id === catId);
  if (!cat) return;
  const newName = prompt('Nuevo nombre para la categoría:', cat.name);
  if (!newName || !newName.trim()) return;
  cat.name = newName.trim();
  if (typeof onUpdated === 'function') onUpdated();
}

/**
 * Elimina una categoría tras confirmar.
 * @param {object} restaurant
 * @param {string} catId
 * @param {Function} onUpdated
 */
export function deleteCategory(restaurant, catId, onUpdated) {
  const cat = (restaurant.categories || []).find(c => c.id === catId);
  if (!cat) return;
  const dishCount = (restaurant.dishes || []).filter(d => d.categoryId === catId).length;
  const msg = dishCount > 0 
    ? `Esta categoría contiene ${dishCount} plato(s). ¿Estás seguro de que deseas eliminarla? Los platos quedarán sin categoría asignada.`
    : `¿Confirmas eliminar la categoría "${cat.name}"?`;
  if (!confirm(msg)) return;
  restaurant.categories = (restaurant.categories || []).filter(c => c.id !== catId);
  if (typeof onUpdated === 'function') onUpdated();
}
