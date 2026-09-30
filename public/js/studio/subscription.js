/**
 * public/js/studio/subscription.js
 * ─────────────────────────────────
 * Módulo ES para toda la lógica de suscripción del Studio.
 * Extraído de studio.js para reducir su tamaño y permitir pruebas independientes.
 *
 * Uso desde studio.js (mientras sea script normal, no type="module"):
 *   Las funciones se importan internamente al convertir studio.js a módulo.
 *   Por ahora, este archivo sirve como referencia canónica del código corregido.
 */

/**
 * Normaliza un objeto subscription para que siempre tenga `status` y `plan`.
 * @param {object|null|undefined} rawSub
 * @returns {object} subscription válida
 */
export function normalizeSubscription(rawSub) {
  if (!rawSub || typeof rawSub !== 'object') {
    return {
      status: 'trialing',
      plan: 'pro_monthly',
      provider: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      gracePeriodDaysRemaining: 7
    };
  }
  return {
    ...rawSub,
    status: rawSub.status || 'trialing',
    plan: rawSub.plan || 'pro_monthly'
  };
}

/**
 * Evalúa si el usuario tiene acceso activo al Studio.
 * Si subscription falta o es inválida, trata como trial activo (7 días).
 *
 * @param {object|null} currentUser  — objeto usuario con .subscription opcional
 * @returns {{ allowed: boolean, status: string, warning?: string }}
 */
export function checkStudioAccess(currentUser) {
  const sub = normalizeSubscription(currentUser?.subscription);

  // Actualiza currentUser para que el resto del Studio vea el valor normalizado
  if (currentUser) currentUser.subscription = sub;

  const now = new Date();
  const status = sub.status;

  if (status === 'active') {
    return { allowed: true, status };
  }

  if (status === 'trial' || status === 'trialing') {
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    if (!trialEnd || trialEnd.getTime() > now.getTime()) {
      return { allowed: true, status: 'trialing' };
    }
    return {
      allowed: false,
      status: 'expired',
      warning: 'Tu período de prueba ha finalizado. Activá tu suscripción para reactivar tu menú.'
    };
  }

  if (status === 'past_due') {
    const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : null;
    const graceEnd = periodEnd ? new Date(periodEnd.getTime() + 7 * 24 * 3600 * 1000) : null;
    if (graceEnd && graceEnd.getTime() > now.getTime()) {
      const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / 86400000));
      return {
        allowed: true,
        status: 'past_due',
        warning: `Tu suscripción está en período de gracia. Quedan ${daysLeft} días.`
      };
    }
    return {
      allowed: false,
      status: 'past_due',
      warning: 'Tu suscripción ha expirado. Actualizá tu plan para reactivar tu menú.'
    };
  }

  return {
    allowed: false,
    status,
    warning: 'Tu suscripción está inactiva. Ingresá a tu cuenta para renovar tu menú.'
  };
}

/**
 * Renderiza el badge de suscripción en el header del Studio.
 * @param {object|null} sub — objeto subscription (ya normalizado)
 */
export function renderSubscriptionBadge(sub) {
  const badge = document.getElementById('subscriptionBadge');
  if (!badge) return;

  const status = sub?.status || 'trialing';
  const plan = sub?.plan || 'pro_monthly';

  if (status === 'trial' || status === 'trialing') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const days = trialEnd
      ? Math.max(0, Math.ceil((trialEnd - new Date()) / (1000 * 60 * 60 * 24)))
      : 7;
    badge.className = 'sub-badge badge-trial';
    badge.textContent = `⏳ Prueba (${days} días)`;
  } else if (status === 'active') {
    badge.className = 'sub-badge badge-active';
    badge.textContent = `✓ PRO ACTIVO (${plan.toUpperCase()})`;
  } else if (status === 'past_due') {
    badge.className = 'sub-badge badge-grace';
    badge.textContent = `⚠️ GRACIA`;
  } else {
    badge.className = 'sub-badge badge-grace';
    badge.textContent = `✕ VENCIDO`;
  }
}

/**
 * Muestra/oculta el banner de alerta de suscripción en el header.
 * @param {object|null} sub — objeto subscription (ya normalizado)
 */
export function checkSubscriptionAlerts(sub) {
  const banner = document.getElementById('subscriptionAlertBanner');
  const text = document.getElementById('subscriptionAlertText');
  const btn = document.getElementById('subscriptionAlertBtn');
  if (!banner || !text || !btn) return;

  const status = sub?.status || 'trialing';
  let alertLevel = null;
  let alertMsg = '';
  let btnText = '';
  let btnBg = '';
  let btnColor = '';

  if (status === 'trial' || status === 'trialing') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const daysLeft = trialEnd ? Math.ceil((trialEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)) : 7;
    if (daysLeft <= 2 && daysLeft > 0) {
      alertLevel = 'warning';
      alertMsg = `⚠️ Tu prueba gratuita expira en ${daysLeft} día${daysLeft === 1 ? '' : 's'}. Activá tu plan para mantener tu menú activo.`;
      btnText = 'Activar Plan Pro';
      btnBg = '#f59e0b';
      btnColor = '#0d1312';
    }
  } else if (status === 'past_due') {
    const graceEnd = sub?.currentPeriodEnd
      ? new Date(new Date(sub.currentPeriodEnd).getTime() + 7 * 24 * 3600 * 1000)
      : null;
    const daysLeft = graceEnd
      ? Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
    if (daysLeft <= 3) {
      alertLevel = 'danger';
      alertMsg = `🚨 Tu suscripción está vencida. Tu menú se pausará en ${daysLeft} día${daysLeft === 1 ? '' : 's'} si no regularizás el pago.`;
      btnText = 'Regularizar Pago';
      btnBg = '#ef4444';
      btnColor = '#fff';
    }
  }

  if (!alertLevel) {
    banner.style.display = 'none';
    return;
  }

  text.textContent = alertMsg;
  btn.textContent = btnText;
  btn.style.background = btnBg;
  btn.style.color = btnColor;
  banner.style.background = alertLevel === 'danger'
    ? 'rgba(239, 68, 68, 0.12)'
    : 'rgba(245, 158, 11, 0.1)';
  banner.style.borderBottom = alertLevel === 'danger'
    ? '1px solid rgba(239, 68, 68, 0.4)'
    : '1px solid rgba(245, 158, 11, 0.35)';
  banner.style.color = alertLevel === 'danger' ? '#fca5a5' : '#fbbf24';
  banner.style.display = 'flex';
}

/**
 * Determina si el menú público es visible para los clientes.
 * @param {object|null} sub — objeto subscription (ya normalizado)
 * @returns {{ visible: boolean, label: string, color: string }}
 */
export function getMenuVisibilityStatus(sub) {
  const status = sub?.status || 'trialing';

  if (status === 'active') return { visible: true, label: 'ONLINE', color: '#4ade80' };

  if (status === 'trial' || status === 'trialing') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    if (!trialEnd || trialEnd.getTime() > Date.now()) {
      return { visible: true, label: 'ONLINE (Trial)', color: '#60a5fa' };
    }
    return { visible: false, label: 'PAUSADO', color: '#f87171' };
  }

  if (status === 'past_due') {
    const graceEnd = sub?.currentPeriodEnd
      ? new Date(new Date(sub.currentPeriodEnd).getTime() + 7 * 24 * 3600 * 1000)
      : null;
    if (graceEnd && graceEnd.getTime() > Date.now()) {
      return { visible: true, label: 'ONLINE (Gracia)', color: '#fbbf24' };
    }
  }

  return { visible: false, label: 'PAUSADO', color: '#f87171' };
}

/**
 * Renderiza el indicador de estado del menú público (punto verde/rojo en el header).
 * @param {object|null} sub — objeto subscription (ya normalizado)
 */
export function renderMenuStatusIndicator(sub) {
  const dot = document.getElementById('menuStatusDot');
  const label = document.getElementById('menuStatusLabel');
  if (!dot || !label) return;

  const { visible, label: statusLabel, color } = getMenuVisibilityStatus(sub);
  dot.style.background = color;
  dot.style.boxShadow = visible ? `0 0 6px ${color}` : 'none';
  label.textContent = statusLabel;
  label.style.color = color;
}

/**
 * Muestra la pantalla de "Menú Pausado" bloqueando el workspace.
 * @param {{ status: string, warning?: string }} access
 */
export function showSubscriptionRequiredScreen(access) {
  const workspace = document.querySelector('.workspace-layout');
  if (workspace) {
    workspace.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:70vh; padding:40px 20px; text-align:center;">
        <div style="font-size:3.5rem; margin-bottom:16px;">⚠️</div>
        <h2 style="color:var(--accent-gold); margin-bottom:12px; font-size:1.5rem;">Menú Pausado</h2>
        <p style="color:var(--text-muted); margin-bottom:8px; font-size:0.95rem; max-width:420px;">
          ${access.warning || 'Tu suscripción está inactiva.'}
        </p>
        <p style="color:var(--text-muted); margin-bottom:24px; font-size:0.8rem;">
          Estado: <strong style="color:#f87171;">${(access.status || 'unknown').toUpperCase()}</strong>
        </p>
        <button onclick="openBillingModal()" style="padding:12px 28px; background:var(--accent-gold); color:#101614; border:none; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.9rem;">
          💎 Reactivar mi menú
        </button>
      </div>
    `;
  }
  const nameEl = document.getElementById('studioNavRestaurantName');
  if (nameEl) nameEl.textContent = 'Suscripción Requerida';
}
