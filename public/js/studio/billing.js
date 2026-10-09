/**
 * public/js/studio/billing.js
 * ───────────────────────────
 * Módulo ES para gestión de facturación, checkout y planes en el Studio.
 * Extraído de studio.js (openBillingModal, closeBillingModal, startCheckout).
 */

import { PLANS } from './data/plans.js';
// Mismo criterio de "status para mostrar" que badge/alertas/indicador: un trial
// con trialEndsAt vencido se trata como expired aunque el cron no haya corrido.
import { resolveDisplayStatus } from './subscription.js';

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
  // Los eventos usan el modelo one-off (plan event_once): el modal ofrece el
  // pago único por fiesta en lugar de los planes recurrentes.
  const isEvent = Boolean(
    (restaurant && (restaurant.businessType === 'events' || restaurant.isEvent === true))
    || sub?.plan === 'event_once'
    || sub?.plan === 'event'
  );
  const planId = (sub?.plan && PLANS[sub.plan]) ? sub.plan : 'pro_monthly';
  const plan = PLANS[planId] || PLANS.pro_monthly;
  const basePrice = plan.priceUsd;
  const branches = getValidBranches(restaurant);
  const branchCount = Math.max(1, branches.length);

  const stateEl = document.getElementById('modalSubState');
  if (stateEl) {
    const rawStatus = resolveDisplayStatus(sub?.status, sub);
    stateEl.textContent = (rawStatus === 'expired' || rawStatus === 'trial_expired')
      ? 'PRUEBA VENCIDA'
      : rawStatus.toUpperCase();
    stateEl.style.color = (rawStatus === 'expired' || rawStatus === 'trial_expired') ? '#fca5a5' : 'var(--accent-gold)';
  }
  const detailEl = document.getElementById('modalSubDetail');
  if (detailEl) {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    // Sin datos (modal abierto desde el paywall antes de cargar la sesión) se
    // asume trial: decir "Plan activo" sería mentirle al usuario.
    const status = resolveDisplayStatus(sub?.status, sub);
    const isTrialing = status === 'trial' || status === 'trialing';
    const isExpired = status === 'expired' || status === 'trial_expired';
    const graceEnd = trialEnd ? new Date(trialEnd.getTime() + 3 * 24 * 3600 * 1000) : null;
    const inTrialGrace = isExpired && graceEnd && graceEnd.getTime() > Date.now();

    if (isTrialing && trialEnd) {
      const daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / (24 * 3600 * 1000)));
      detailEl.textContent = `Prueba gratis hasta el ${trialEnd.toLocaleDateString()} · quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'}`;
    } else if (isTrialing) {
      detailEl.textContent = 'Prueba gratis activa.';
    } else if (inTrialGrace) {
      const graceLeft = Math.max(1, Math.ceil((graceEnd.getTime() - Date.now()) / (24 * 3600 * 1000)));
      detailEl.textContent = `Prueba finalizada · tu menú sigue online ${graceLeft} día${graceLeft === 1 ? '' : 's'} más`;
    } else if (isExpired) {
      detailEl.textContent = 'Tu menú está pausado: activá un plan para reactivarlo al instante.';
    } else {
      detailEl.textContent = `Plan ${plan.name} activo.`;
    }
  }

  // Oculta un error de checkout anterior cada vez que se reabre el modal
  const errorEl = document.getElementById('billingCheckoutError');
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.style.display = 'none';
  }

  // Inject tiered pricing visualizer into billing modal
  const pricingContainer = document.getElementById('billingTieredPricing');
  if (pricingContainer) {
    if (isEvent) {
      pricingContainer.innerHTML = `
        <div style="background:rgba(236,201,75,0.08); border:1px solid rgba(236,201,75,0.3); border-radius:8px; padding:12px; margin-bottom:16px;">
          <div style="font-size:11px; font-weight:700; color:var(--accent-gold); text-transform:uppercase; margin-bottom:8px;">🎉 Evento Único (por fiesta)</div>
          <div style="font-size:11px; color:var(--text-dim); margin-bottom:10px;">Pago único de <strong style="color:#fff;">$${basePrice.toFixed(2)} USD</strong> · tu menú queda online hasta la fecha de tu evento y luego se pausa automáticamente.</div>
        </div>
      `;
    } else {
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
        <div style="font-size:11px; font-weight:700; color:var(--accent-gold); text-transform:uppercase; margin-bottom:8px;">📊 Precio Pro por Sucursales (${branchCount} activa${branchCount > 1 ? 's' : ''})</div>
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
  }

  // Modo evento: mostrar el bloque one-off, ocultar los planes recurrentes
  const eventBlock = document.getElementById('eventBillingBlock');
  const plansGrid = document.getElementById('billingPlansGrid');
  if (eventBlock) eventBlock.style.display = isEvent ? 'block' : 'none';
  if (plansGrid) plansGrid.style.display = isEvent ? 'none' : 'grid';

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
 * Banner flotante para avisos de facturación (éxito/cancelación de checkout).
 * @param {string} message
 * @param {'success'|'error'|'info'} kind
 */
export function showBillingNotice(message, kind = 'info') {
  if (typeof document === 'undefined') return;
  const palette = {
    success: { bg: 'rgba(16,185,129,0.15)', border: 'rgba(16,185,129,0.5)', color: '#6ee7b7' },
    error: { bg: 'rgba(239,68,68,0.15)', border: 'rgba(239,68,68,0.5)', color: '#fca5a5' },
    info: { bg: 'rgba(59,130,246,0.15)', border: 'rgba(59,130,246,0.5)', color: '#93c5fd' }
  }[kind] || {};

  const el = document.createElement('div');
  el.setAttribute('role', 'status');
  el.textContent = message;
  Object.assign(el.style, {
    position: 'fixed',
    top: '18px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: '9999',
    maxWidth: 'min(92vw, 560px)',
    padding: '12px 18px',
    borderRadius: '10px',
    fontSize: '13px',
    fontWeight: '600',
    lineHeight: '1.4',
    background: palette.bg || 'rgba(59,130,246,0.15)',
    border: `1px solid ${palette.border || 'rgba(59,130,246,0.5)'}`,
    color: palette.color || '#93c5fd',
    backdropFilter: 'blur(6px)'
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 7000);
}

/**
 * Procesa el retorno de una pasarela (?billing=success|canceled) y limpia la URL.
 * Se llama al iniciar el Studio para refrescar el estado real de la suscripción.
 */
export function handleBillingReturn() {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  const result = params.get('billing');
  if (!result) return;

  params.delete('billing');
  const query = params.toString();
  window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : '') + window.location.hash);

  if (result === 'success') {
    showBillingNotice('✅ Pago recibido. Tu plan se activa en segundos cuando la pasarela confirma el cobro.', 'success');
  } else if (result === 'canceled') {
    showBillingNotice('Pago cancelado: no se realizó ningún cargo. Podés intentarlo cuando quieras.', 'info');
  }
}

/**
 * Inicia checkout redirigiendo a la pasarela en la MISMA pestaña
 * (window.open tras un await es bloqueado por los pop-up blockers).
 * @param {string} plan — clave real ('pro_monthly', 'starter_annual', …) o alias ('monthly'|'annual')
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

  const authHeaders = window.AuthClient
    ? window.AuthClient.getAuthHeaders({ 'Content-Type': 'application/json' })
    : { 'Content-Type': 'application/json' };
  try {
    // El navegador sólo nos da país confiable si la clave es UY/AR; si no,
    // el server decide (cabecera de Vercel / UY por defecto).
    const browserCountry = (navigator.language || '').split('-').pop().toUpperCase();
    const countryCode = ['UY', 'AR'].includes(browserCountry) ? browserCountry : undefined;

    const res = await fetch('/api/billing/checkout', {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({
        planId: plan,
        plan,
        restaurantId: restaurant?.id,
        ...(countryCode ? { countryCode } : {})
      })
    });
    const data = await res.json().catch(() => ({}));

    if (res.ok && data.checkoutUrl) {
      window.location.assign(data.checkoutUrl);
      return;
    }

    const message = data.error
      || (res.status === 503
        ? 'La pasarela de pagos todavía no está configurada para este entorno.'
        : `No pudimos iniciar el checkout (error ${res.status}).`);
    console.error('[Billing] checkout failed', res.status, data);
    showBillingNotice(message, 'error');
    const errorEl = document.getElementById('billingCheckoutError');
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = 'block';
    }
  } catch (err) {
    const message = 'No pudimos conectar con la pasarela. Revisá tu conexión e intentá nuevamente.';
    console.error('[Billing] checkout exception', err);
    showBillingNotice(message, 'error');
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
