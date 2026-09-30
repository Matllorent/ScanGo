/**
 * public/js/studio/billing.js
 * ───────────────────────────
 * Módulo ES para gestión de facturación, checkout y planes en el Studio.
 * Extraído de studio.js (openBillingModal, closeBillingModal, startCheckout).
 */

import { PLANS } from './data/plans.js';

/**
 * Calcula descuento por sucursal.
 * @param {number} position
 * @returns {number}
 */
export function getBranchDiscount(position) {
  const pos = Math.floor(Number(position) || 1);
  if (pos <= 1) return 0;
  if (pos === 2) return 0.20;
  if (pos === 3) return 0.35;
  return 0.50;
}

/**
 * Calcula precio multi-sucursal con base price y cantidad.
 * @param {number} basePrice
 * @param {number} branchCount
 * @returns {number}
 */
export function calculateMultiBranchPrice(basePrice, branchCount) {
  const base = Number(basePrice);
  if (!Number.isFinite(base) || base <= 0) return 0;
  const count = Math.max(1, Math.floor(Number(branchCount) || 1));
  let total = 0;
  for (let i = 1; i <= count; i++) {
    total += Math.round((base * (1 - getBranchDiscount(i)) + Number.EPSILON) * 100) / 100;
  }
  return Math.round((total + Number.EPSILON) * 100) / 100;
}

/**
 * Retorna las sucursales válidas (con id).
 * @param {object} restaurant
 * @returns {Array}
 */
export function getValidBranches(restaurant) {
  if (!restaurant || !Array.isArray(restaurant.branches)) return [];
  return restaurant.branches.filter(b => b && b.id);
}

/**
 * Abre el modal de facturación y renderiza el desglose multi-sucursal.
 * @param {object} currentUser
 * @param {object} restaurant
 */
export function openBillingModal(currentUser, restaurant) {
  const sub = currentUser ? currentUser.subscription : {};
  const planId = (sub?.plan && PLANS[sub.plan]) ? sub.plan : 'pro_monthly';
  const plan = PLANS[planId] || PLANS.pro_monthly;
  const basePrice = plan.priceUsd;
  const branches = getValidBranches(restaurant);
  const branchCount = Math.max(1, branches.length);

  const stateEl = document.getElementById('modalSubState');
  if (stateEl) {
    stateEl.textContent = sub?.status ? sub.status.toUpperCase() : 'TRIAL';
  }
  const detailEl = document.getElementById('modalSubDetail');
  if (detailEl) {
    detailEl.textContent = (sub?.status === 'trial' || sub?.status === 'trialing')
      ? `Prueba activa hasta el ${sub?.trialEndsAt ? new Date(sub.trialEndsAt).toLocaleDateString() : 'próximamente'}`
      : `Plan ${plan.name} activo.`;
  }

  // Inject tiered pricing visualizer into billing modal
  const pricingContainer = document.getElementById('billingTieredPricing');
  if (pricingContainer) {
    const totalPrice = calculateMultiBranchPrice(basePrice, branchCount);
    const fullPrice = basePrice * branchCount;
    const totalSavings = Math.round((fullPrice - totalPrice + Number.EPSILON) * 100) / 100;
    const savingsPct = fullPrice > 0 ? Math.round((totalSavings / fullPrice) * 100) : 0;

    let breakdownHtml = '';
    for (let i = 1; i <= branchCount; i++) {
      const discount = getBranchDiscount(i);
      const price = Math.round((basePrice * (1 - discount) + Number.EPSILON) * 100) / 100;
      const label = i === 1 ? 'Principal' : `Sucursal ${i}`;
      breakdownHtml += `<div style="display:flex; justify-content:space-between; padding:6px 0; border-bottom:1px solid rgba(255,255,255,0.08); font-size:12px;">
        <span>${label}${discount > 0 ? ` <span style="color:var(--accent-green); font-size:10px;">-${Math.round(discount * 100)}%</span>` : ''}</span>
        <span style="font-weight:700; color:var(--accent-gold);">$${price.toFixed(2)} USD</span>
      </div>`;
    }

    pricingContainer.innerHTML = `
      <div style="background:rgba(236,201,75,0.08); border:1px solid rgba(236,201,75,0.3); border-radius:8px; padding:12px; margin-bottom:16px;">
        <div style="font-size:11px; font-weight:700; color:var(--accent-gold); text-transform:uppercase; margin-bottom:8px;">📊 Precio Efectivo por Sucursales (${branchCount} activa${branchCount > 1 ? 's' : ''})</div>
        <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Descuentos: 1ª 100% · 2ª 20% · 3ª 35% · 4ª+ 50%</div>
        ${breakdownHtml}
        <div style="display:flex; justify-content:space-between; margin-top:10px; padding-top:10px; border-top:1px solid rgba(236,201,75,0.3); font-size:13px; font-weight:700;">
          <span>Total Mensual:</span>
          <span style="color:var(--accent-gold);">$${totalPrice.toFixed(2)} USD</span>
        </div>
        ${branchCount > 1 ? `<div style="font-size:11px; color:var(--accent-green); margin-top:4px;">💰 Ahorro vs. precio sin descuento: $${totalSavings.toFixed(2)} USD (${savingsPct}%)</div>` : ''}
      </div>
    `;
  }

  const modal = document.getElementById('billingModal');
  if (modal) modal.classList.add('active');
}

/**
 * Cierra el modal de facturación.
 */
export function closeBillingModal() {
  const modal = document.getElementById('billingModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Inicia checkout redirigiendo a pasarela externa.
 * @param {string} plan
 * @param {Event} eventRef
 * @param {object} restaurant
 */
export async function startCheckout(plan, eventRef, restaurant) {
  const activeEl = (eventRef && eventRef.target) || (window.event && window.event.target) || document.activeElement;
  const btn = activeEl && (activeEl.tagName === 'BUTTON' ? activeEl : activeEl.closest('button'));
  const originalText = btn ? btn.innerHTML : '';

  if (btn) {
    if (btn.disabled || btn.dataset.busy === 'true') return;
    btn.disabled = true;
    btn.dataset.busy = 'true';
    btn.innerHTML = '<span><i class="fa-solid fa-spinner fa-spin"></i> Conectando con pasarela...</span>';
  }

  const token = localStorage.getItem('menu_pizarron_token');
  try {
    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        restaurantId: restaurant?.id,
        plan: plan
      })
    });
    const data = await res.json();
    if (data.checkoutUrl) {
      window.open(data.checkoutUrl, '_blank');
    } else {
      alert('Redirigiendo a pasarela de cobro...');
    }
  } catch (err) {
    alert('Error al iniciar checkout: ' + (err.message || 'Error de conexión'));
  } finally {
    if (btn) {
      setTimeout(() => {
        btn.disabled = false;
        btn.dataset.busy = 'false';
        btn.innerHTML = originalText;
      }, 2500);
    }
  }
}
