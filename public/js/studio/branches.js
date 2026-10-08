/**
 * public/js/studio/branches.js
 * ────────────────────────────
 * Módulo ES para la gestión de sucursales, precios escalonados y sincronización.
 * Extraído de studio.js (renderBranchesList, updateBranchesPricingBanner, addBranch, deleteBranch, resetBranchForm).
 */

import { PLANS } from './data/plans.js';
import { getBranchDiscount, calculateMultiBranchPrice, getValidBranches } from './billing.js';

/**
 * Renderiza la lista de sucursales en el Studio.
 * @param {object} currentUser
 * @param {object} restaurant
 * @param {Function} escapeHtml
 */
export function renderBranchesList(currentUser, restaurant, escapeHtml) {
  const container = document.getElementById('branchesList');
  if (!container) return;

  const branches = getValidBranches(restaurant);
  const sub = currentUser ? currentUser.subscription : {};
  const planId = (sub?.plan && PLANS[sub.plan]) ? sub.plan : 'pro_monthly';
  const plan = PLANS[planId] || PLANS.pro_monthly;
  const basePrice = plan.priceUsd;
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));

  if (branches.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; padding:24px 16px; background:var(--bg-base); border:1px dashed var(--border); border-radius:10px;">
        <div style="font-size:28px; margin-bottom:8px;">🏢</div>
        <div style="font-size:13px; font-weight:700; color:#fff; margin-bottom:4px;">No hay sucursales registradas</div>
        <div style="font-size:11px; color:var(--text-dim); max-width:320px; margin:0 auto 16px;">
          Tu restaurante principal cuenta como la primera sucursal. Agregá sedes adicionales para expandir tu marca y obtener descuentos por volumen.
        </div>
      </div>
    `;
    updateBranchesPricingBanner(1, basePrice);
    return;
  }

  let html = `
    <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:10px; padding:8px 10px; background:var(--bg-base); border-radius:8px; border:1px solid var(--border);">
      <div style="font-size:11px; font-weight:700; color:var(--text-muted); display:flex; gap:24px;">
        <span style="min-width:120px;">SUCURSAL</span>
        <span style="min-width:100px;">TELÉFONO</span>
        <span style="min-width:100px;">DIRECCIÓN</span>
        <span style="min-width:80px;">PRECIO EFECTIVO</span>
        <span>ACCIONES</span>
      </div>
    </div>
  `;

  branches.forEach((branch, idx) => {
    const position = idx + 1;
    const discount = getBranchDiscount(position);
    const effectivePrice = Math.round((basePrice * (1 - discount) + Number.EPSILON) * 100) / 100;
    const discountLabel = discount > 0 ? `<span style="color:var(--accent-green); font-size:10px; margin-left:4px;">(${Math.round(discount * 100)}% desc.)</span>` : '';

    const name = safeEscape(branch.name || `Sucursal ${position}`);
    const phone = safeEscape(branch.phone || '—');
    const address = safeEscape(branch.address || '—');
    const branchId = safeEscape(branch.id);

    html += `
      <div class="branch-card" data-branch-id="${branchId}" style="display:flex; align-items:center; justify-content:space-between; gap:12px; padding:10px; background:var(--surface-2); border:1px solid var(--border); border-radius:8px; margin-bottom:8px; flex-wrap:wrap;">
        <div style="min-width:120px; flex:1; font-size:12px; font-weight:700; color:#fff;">${name} <span style="font-size:10px; color:var(--text-dim); font-weight:500;">${position === 1 ? ' (Principal)' : ''}</span></div>
        <div style="min-width:100px; flex:1; font-size:11px; color:var(--text-muted);">${phone}</div>
        <div style="min-width:100px; flex:1; font-size:10px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${address}</div>
        <div style="min-width:80px; font-size:11px; font-weight:700; font-family:var(--font-mono); color:var(--accent-gold);">$${effectivePrice.toFixed(2)} ${discountLabel}</div>
        <div style="display:flex; gap:6px; flex-shrink:0;">
          <button class="btn-icon" onclick="editBranch('${branchId}')" title="Editar sucursal — precios personalizados y platillos exclusivos" style="padding:6px 8px;">⚙️</button>
          ${position > 1 ? `
            <button class="btn-icon btn-icon-danger" onclick="deleteBranch('${branchId}')" title="Eliminar sucursal" style="padding:6px 8px;">🗑️</button>
          ` : `
            <span style="font-size:10px; color:var(--text-dim); padding:6px 8px;">🔒 Principal</span>
          `}
        </div>
      </div>
    `;
  });

  container.innerHTML = html;
  updateBranchesPricingBanner(branches.length, basePrice);
}

/**
 * Actualiza el banner de precios escalonados en la vista de sucursales.
 * @param {number} branchCount
 * @param {number} basePrice
 */
export function updateBranchesPricingBanner(branchCount, basePrice) {
  const banner = document.getElementById('branchesPricingBanner');
  const summary = document.getElementById('branchesPricingSummary');
  const totalEl = document.getElementById('branchesTotalPrice');
  const savingsEl = document.getElementById('branchesTotalSavings');
  if (!banner || !summary || !totalEl || !savingsEl) return;

  banner.style.display = 'flex';

  const totalPrice = calculateMultiBranchPrice(basePrice, branchCount);
  const fullPrice = basePrice * branchCount;
  const totalSavings = Math.round((fullPrice - totalPrice + Number.EPSILON) * 100) / 100;
  const savingsPct = fullPrice > 0 ? Math.round((totalSavings / fullPrice) * 100) : 0;

  let breakdownHtml = '';
  for (let i = 1; i <= branchCount; i++) {
    const discount = getBranchDiscount(i);
    const price = Math.round((basePrice * (1 - discount) + Number.EPSILON) * 100) / 100;
    const label = i === 1 ? 'Principal' : `Suc. ${i}`;
    breakdownHtml += `<span style="display:flex; align-items:center; gap:6px; background:rgba(255,255,255,0.06); padding:4px 10px; border-radius:6px; font-size:11px;">${label}: <strong>$${price.toFixed(2)}</strong>${discount > 0 ? ` <span style="color:var(--accent-green);">-${Math.round(discount * 100)}%</span>` : ''}</span>`;
  }
  summary.innerHTML = breakdownHtml;

  totalEl.textContent = `$${totalPrice.toFixed(2)} USD`;
  savingsEl.textContent = `Ahorro: $${totalSavings.toFixed(2)} USD (${savingsPct}%)`;
}

/**
 * Agrega una nueva sucursal con optimismo y sincronización idempotente.
 * @param {Event} e
 * @param {object} restaurant
 * @param {Function} onUpdated
 */
export async function addBranch(e, restaurant, onUpdated) {
  if (e) e.preventDefault();
  const name = document.getElementById('branchName')?.value.trim();
  const phone = document.getElementById('branchPhone')?.value.trim();
  const address = document.getElementById('branchAddress')?.value.trim();
  let slug = document.getElementById('branchSlug')?.value.trim().toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);

  if (!name) {
    alert('El nombre de la sucursal es obligatorio.');
    return;
  }

  const token = localStorage.getItem('menu_pizarron_token');
  if (!token) {
    alert('Sesión expirada. Por favor recargá la página.');
    return;
  }

  if (!restaurant.branches) restaurant.branches = [];
  const branches = getValidBranches(restaurant);

  if (branches.some(b => b.name.toLowerCase() === name.toLowerCase())) {
    alert('Ya existe una sucursal con ese nombre.');
    return;
  }

  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
  }

  const submitBtn = e?.target?.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Agregando...</span>';
  }

  const idempotencyKey = `branch_add_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    const res = await fetch('/api/studio/branches', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        operation: 'add',
        branch: { name, slug, phone, address }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al agregar sucursal');

    restaurant.branches.push(data.branch);
    resetBranchForm();
    if (typeof onUpdated === 'function') onUpdated();
  } catch (err) {
    alert(err.message || 'Error al agregar sucursal');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText || '➕ Agregar Sucursal';
    }
  }
}

/**
 * Elimina una sucursal mediante PATCH al endpoint /api/studio/branches.
 * @param {string} branchId
 * @param {object} restaurant
 * @param {Function} showConfirmDialogFn
 * @param {Function} onDeleted
 */
export async function deleteBranch(branchId, restaurant, showConfirmDialogFn, onDeleted) {
  const branches = getValidBranches(restaurant);
  const branch = branches.find(b => b.id === branchId);
  if (!branch) return;

  if (branches.indexOf(branch) === 0) {
    alert('No se puede eliminar la sucursal principal.');
    return;
  }

  const executeDelete = async () => {
    const token = localStorage.getItem('menu_pizarron_token');
    if (!token) {
      alert('Sesión expirada. Por favor recargá la página.');
      return;
    }

    const idempotencyKey = `branch_del_${branchId}_${Date.now()}`;
    try {
      const res = await fetch('/api/studio/branches', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          'X-Idempotency-Key': idempotencyKey
        },
        body: JSON.stringify({ operation: 'delete', branchId })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al eliminar sucursal');

      restaurant.branches = restaurant.branches.filter(b => b.id !== branchId);
      if (typeof onDeleted === 'function') onDeleted();
    } catch (err) {
      alert(err.message || 'Error al eliminar sucursal');
    }
  };

  if (typeof showConfirmDialogFn === 'function') {
    showConfirmDialogFn({
      icon: '🗑️',
      title: '¿Eliminar Sucursal?',
      message: `¿Estás seguro de eliminar "${branch.name}"? Esto actualizará el precio de tu plan.`,
      confirmText: 'Sí, Eliminar',
      confirmClass: 'btn-danger',
      onConfirm: executeDelete
    });
  } else {
    if (confirm(`¿Estás seguro de eliminar "${branch.name}"?`)) {
      await executeDelete();
    }
  }
}

/**
 * Resetea el formulario de agregar sucursal.
 */
export function resetBranchForm() {
  const form = document.getElementById('addBranchForm');
  if (form) form.reset();
}

// ─────────────────────────────────────────────────────────────────────────────
// Editor de sucursal: overridePrices + customDishes por sede
// ─────────────────────────────────────────────────────────────────────────────

const BRANCH_EDIT = { restaurant: null, branch: null, onUpdated: null };
let overridesRowSeq = 0;
let customDishRowSeq = 0;

/**
 * Coerce un valor de precio (número o {price:n} legacy) a string editable.
 * @param {*} price
 * @returns {string} número formateado o cadena vacía si no es finito.
 */
function numberOrEmpty(price) {
  let num = price;
  if (price && typeof price === 'object' && !Array.isArray(price)) {
    num = price.price ?? price.value ?? price.precio;
  }
  return Number.isFinite(Number(num)) ? String(Number(num)) : '';
}

/**
 * Abre el modal de edición de una sucursal (datos de contacto + precios
 * personalizados + platillos exclusivos).
 * @param {string} branchId
 * @param {object} restaurant
 * @param {Function} escapeHtml
 * @param {Function} onUpdated
 */
export function editBranch(branchId, restaurant, escapeHtml, onUpdated) {
  const branches = getValidBranches(restaurant);
  const branch = branches.find(b => b.id === branchId);
  if (!branch) return;

  BRANCH_EDIT.restaurant = restaurant;
  BRANCH_EDIT.branch = branch;
  BRANCH_EDIT.onUpdated = onUpdated || null;

  const isPrincipal = branches.findIndex(b => b.id === branchId) === 0;
  const safeEscape = typeof escapeHtml === 'function' ? escapeHtml : (str => String(str || ''));

  const modal = document.getElementById('branchEditModal');
  if (!modal) return;

  // Datos de contacto
  const nameInput = document.getElementById('branchEditName');
  const phoneInput = document.getElementById('branchEditPhone');
  const addressInput = document.getElementById('branchEditAddress');
  const slugInput = document.getElementById('branchEditSlug');

  if (nameInput) nameInput.value = safeEscape(branch.name || '');
  if (phoneInput) phoneInput.value = safeEscape(branch.phone || '');
  if (addressInput) addressInput.value = safeEscape(branch.address || '');
  if (slugInput) slugInput.value = safeEscape(branch.slug || '');

  // La sucursal principal no puede renombrarse ni cambiar su slug (rompería
  // QR/URLs); el backend también lo bloquea. Lock en UI para guiar al usuario.
  if (nameInput) nameInput.readOnly = isPrincipal;
  if (slugInput) slugInput.readOnly = isPrincipal;
  const statusEl = document.getElementById('branchEditStatus');
  if (statusEl) {
    statusEl.innerHTML = isPrincipal
      ? 'Sucursal principal: el nombre y slug se editan desde el Perfil del restaurante. Podés configurar acá precios personalizados y platillos exclusivos.'
      : `Configurá los datos de contacto, precios personalizados y platillos exclusivos de ${safeEscape(branch.name || 'esta sucursal')}.`;
  }

  // Rows de precios personalizados
  const overridesRows = document.getElementById('branchOverridesRows');
  if (overridesRows) {
    overridesRows.innerHTML = '';
    overridesRowSeq = 0;
    const overrides = (branch.overridePrices && typeof branch.overridePrices === 'object') ? branch.overridePrices : {};
    const entries = Object.entries(overrides);
    if (entries.length === 0) {
      addBranchOverrideRow();
    } else {
      for (const [dishId, price] of entries) {
        addBranchOverrideRow(dishId, price, restaurant, safeEscape);
      }
    }
  }

  // Rows de platillos exclusivos
  const customRows = document.getElementById('branchCustomDishesRows');
  if (customRows) {
    customRows.innerHTML = '';
    customDishRowSeq = 0;
    const custom = Array.isArray(branch.customDishes) ? branch.customDishes : [];
    if (custom.length === 0) {
      addBranchCustomDishRow(null, restaurant, safeEscape);
    } else {
      for (const dish of custom) {
        addBranchCustomDishRow(dish, restaurant, safeEscape);
      }
    }
  }

  modal.classList.add('active');
}

/**
 * Cierra el modal de edición de sucursal.
 */
export function closeBranchEdit() {
  const modal = document.getElementById('branchEditModal');
  if (modal) modal.classList.remove('active');
  BRANCH_EDIT.branch = null;
  BRANCH_EDIT.onUpdated = null;
}

/**
 * Renderiza una fila de precio personalizado dentro del modal.
 */
export function addBranchOverrideRow(dishId = '', price = '', restaurant, safeEscape) {
  const rows = document.getElementById('branchOverridesRows');
  if (!rows) return;
  const rest = restaurant || BRANCH_EDIT.restaurant;
  const esc = safeEscape || (str => String(str || ''));

  const dishes = Array.isArray(rest?.dishes) ? rest.dishes : [];
  const options = dishes.length
    ? dishes.map(d => `<option value="${esc(d.id)}"${String(d.id) === String(dishId) ? ' selected' : ''}>${esc(d.name || d.id)}</option>`).join('')
    : `<option value="" disabled>No hay platillos base todavía</option>`;

  const idx = ++overridesRowSeq;
  const row = document.createElement('div');
  row.id = `overrideRow_${idx}`;
  row.style.cssText = 'display:flex; gap:8px; align-items:center;';
  row.innerHTML = `
    <select class="form-select" data-role="dishId" style="flex:1.4; min-width:0;" ${dishes.length ? '' : 'disabled'}>
      <option value="">— Platillo —</option>
      ${options}
    </select>
    <input type="number" min="0" step="0.01" class="form-input" data-role="price" value="${numberOrEmpty(price)}" placeholder="Precio" style="flex:0.8; min-width:0;">
    <button type="button" class="btn-icon btn-icon-danger" onclick="removeBranchOverrideRow(${idx})" title="Quitar" style="padding:6px 8px;">✕</button>
  `;
  rows.appendChild(row);
}

/**
 * Elimina una fila de precio personalizado del modal.
 */
export function removeBranchOverrideRow(idx) {
  const row = document.getElementById(`overrideRow_${idx}`);
  if (row) row.remove();
}

/**
 * Renderiza una fila de platillo exclusivo dentro del modal.
 */
export function addBranchCustomDishRow(dish = null, restaurant, safeEscape) {
  const rows = document.getElementById('branchCustomDishesRows');
  if (!rows) return;
  const esc = safeEscape || (str => String(str || ''));
  const d = dish || {};

  const idx = ++customDishRowSeq;
  const row = document.createElement('div');
  row.id = `customDishRow_${idx}`;
  row.setAttribute('data-row', '1');
  row.style.cssText = 'display:flex; gap:8px; align-items:flex-start; background:var(--bg-base); border:1px dashed var(--border); border-radius:8px; padding:8px;';
  row.innerHTML = `
    <div style="flex:2; display:flex; flex-direction:column; gap:6px; min-width:0;">
      <input type="text" class="form-input" data-role="name" value="${esc(d.name || '')}" placeholder="Nombre del platillo" maxlength="120">
      <input type="text" class="form-input" data-role="category" value="${esc(d.category || '')}" placeholder="Categoría (opcional)" maxlength="60">
    </div>
    <div style="flex:0.8; display:flex; flex-direction:column; gap:6px; min-width:70px;">
      <input type="number" min="0" step="0.01" class="form-input" data-role="price" value="${numberOrEmpty(d.price)}" placeholder="Precio">
      <input type="text" class="form-input" data-role="description" value="${esc(d.description || '')}" placeholder="Descripción (opcional)" maxlength="200">
    </div>
    <button type="button" class="btn-icon btn-icon-danger" onclick="removeBranchCustomDishRow(${idx})" title="Quitar" style="padding:6px 8px; flex-shrink:0;">✕</button>
  `;
  rows.appendChild(row);
}

/**
 * Elimina una fila de platillo exclusivo del modal.
 */
export function removeBranchCustomDishRow(idx) {
  const row = document.getElementById(`customDishRow_${idx}`);
  if (row) row.remove();
}

/**
 * Guarda los cambios de la sucursal vía PATCH /api/studio/branches (update).
 */
export async function saveBranchEdit(e, restaurant, onUpdated) {
  if (e && e.preventDefault) e.preventDefault();
  const rest = restaurant || BRANCH_EDIT.restaurant;
  const branch = BRANCH_EDIT.branch;
  if (!rest || !branch) return;

  const name = (document.getElementById('branchEditName')?.value || '').trim();
  if (!name) {
    alert('El nombre de la sucursal es obligatorio.');
    return;
  }

  const token = localStorage.getItem('menu_pizarron_token');
  if (!token) {
    alert('Sesión expirada. Por favor recargá la página.');
    return;
  }

  // Recolectar precios personalizados (vacío = hereda precio base)
  const overridePrices = {};
  document.querySelectorAll('#branchOverridesRows [data-role="dishId"]').forEach((sel, i) => {
    const dishId = sel.value;
    const priceInput = document.querySelectorAll('#branchOverridesRows [data-role="price"]')[i];
    if (!dishId || !priceInput) return;
    const price = Number(priceInput.value);
    if (Number.isFinite(price) && price >= 0) overridePrices[dishId] = price;
  });

  // Recolectar platillos exclusivos
  const customDishes = [];
  document.querySelectorAll('#branchCustomDishesRows [data-row]').forEach((row) => {
    const nameInput = row.querySelector('[data-role="name"]');
    const priceInput = row.querySelector('[data-role="price"]');
    const catInput = row.querySelector('[data-role="category"]');
    const descInput = row.querySelector('[data-role="description"]');
    const dishName = (nameInput?.value || '').trim();
    if (!dishName) return;
    customDishes.push({
      id: `cd_${branch.id}_${Date.now()}_${customDishes.length}`,
      name: dishName.slice(0, 120),
      price: Number(priceInput?.value) > 0 ? Number(priceInput.value) : 0,
      category: (catInput?.value || '').trim().slice(0, 60),
      description: (descInput?.value || '').trim().slice(0, 200),
      isBranchCustom: true
    });
  });

  const submitBtn = e?.target?.querySelector('button[type="submit"]');
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<span>⏳ Guardando...</span>';
  }

  const idempotencyKey = `branch_edit_${branch.id}_${Date.now()}`;
  try {
    const res = await fetch('/api/studio/branches', {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'X-Idempotency-Key': idempotencyKey
      },
      body: JSON.stringify({
        operation: 'update',
        branchId: branch.id,
        branch: {
          name,
          phone: (document.getElementById('branchEditPhone')?.value || '').trim(),
          address: (document.getElementById('branchEditAddress')?.value || '').trim(),
          slug: (document.getElementById('branchEditSlug')?.value || '').trim(),
          overridePrices,
          customDishes
        }
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Error al actualizar la sucursal');

    // Reflejar en el objeto local y refrescar
    const idx = (rest.branches || []).findIndex(b => b.id === branch.id);
    if (idx !== -1) {
      rest.branches[idx] = { ...rest.branches[idx], name, phone: (document.getElementById('branchEditPhone')?.value || '').trim(), address: (document.getElementById('branchEditAddress')?.value || '').trim(), slug: (document.getElementById('branchEditSlug')?.value || '').trim(), overridePrices, customDishes, updatedAt: new Date().toISOString() };
    }

    closeBranchEdit();
    if (typeof onUpdated === 'function') onUpdated();
  } catch (err) {
    alert(err.message || 'Error al actualizar la sucursal');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText || '💾 Guardar Cambios';
    }
  }
}
