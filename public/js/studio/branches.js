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
