/**
 * public/js/studio/subscription.js
 * ─────────────────────────────────
 * Módulo ES para toda la lógica de suscripción del Studio.
 * Extraído de studio.js para reducir su tamaño y permitir pruebas independientes.
 *
 * Contrato espejo de `verifyAccess()` en src/billing/orchestrator.js:
 *  - trial 7 días → acceso total
 *  - días 8-10    → menú público online (gracia), Studio en paywall descartable
 *  - día 11+      → menú pausado
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_GRACE_DAYS = 3;
const TRIAL_GRACE_DAYS_MS = TRIAL_GRACE_DAYS * DAY_MS;

// Etiquetas en español de los status de máquina que muestra el paywall ("Estado: …")
const STATUS_LABELS = {
  active: 'ACTIVO',
  trial: 'EN PRUEBA',
  trialing: 'EN PRUEBA',
  trial_expired: 'PRUEBA VENCIDA',
  expired: 'VENCIDO',
  past_due: 'PAGO VENCIDO',
  inactive: 'INACTIVO'
};

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
 * Normaliza el status PARA MOSTRAR: un trial con `trialEndsAt` vencido se
 * muestra como 'expired' aunque el cron diario todavía no haya cambiado el
 * status en la DB (hasta 24 h de retraso). Así badge, alertas e indicador de
 * menú dicen la verdad desde el día 8 y no "Prueba (0 días)" / "PAUSADO".
 * @param {string|undefined} rawStatus
 * @param {object|null|undefined} sub
 * @returns {string}
 */
export function resolveDisplayStatus(rawStatus, sub) {
  const status = rawStatus || 'trialing';
  const isTrial = status === 'trial' || status === 'trialing';
  if (isTrial && sub?.trialEndsAt && new Date(sub.trialEndsAt).getTime() <= Date.now()) {
    return 'expired';
  }
  return status;
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

  if (status === 'trial' || status === 'trialing' || status === 'expired') {
    const trialEnd = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    if (status !== 'expired' && (!trialEnd || trialEnd.getTime() > now.getTime())) {
      return { allowed: true, status: 'trialing' };
    }

    // La gracia post-trial (3 días de menú online) sólo aplica a cuentas que
    // nunca estuvieron pagas: un plan degradado por dunning no la tiene.
    const wasPaid = Boolean(sub.downgradedAt) || Boolean(sub.provider && sub.provider !== 'trial');
    const graceEnd = trialEnd ? new Date(trialEnd.getTime() + TRIAL_GRACE_DAYS_MS) : null;
    const inGrace = !wasPaid && graceEnd && graceEnd.getTime() > now.getTime();

    if (inGrace) {
      const graceDays = Math.max(1, Math.ceil((graceEnd.getTime() - now.getTime()) / DAY_MS));
      return {
        allowed: false,
        status: 'trial_expired',
        inGrace: true,
        canDismiss: true,
        graceDaysLeft: graceDays,
        warning: `Tu prueba gratuita terminó. Tu menú sigue online ${graceDays} día${graceDays === 1 ? '' : 's'} más: activá tu plan para no perderlo.`
      };
    }

    return {
      allowed: false,
      status: 'expired',
      inGrace: false,
      warning: graceEnd
        ? 'Tu período de prueba finalizó y tu menú quedó pausado. Activá tu plan para reactivarlo al instante.'
        : 'Tu período de prueba ha finalizado. Activá tu suscripción para reactivar tu menú.'
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

  const status = resolveDisplayStatus(sub?.status, sub);
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
    // Vencido: si seguimos dentro de la gracia post-trial, lo decimos con el contador
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const graceEnd = trialEnd ? new Date(trialEnd.getTime() + TRIAL_GRACE_DAYS_MS) : null;
    const graceDaysLeft = graceEnd ? Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / DAY_MS)) : 0;
    badge.className = 'sub-badge badge-grace';
    badge.textContent = graceDaysLeft > 0
      ? `⚠️ VENCIDO (gracia ${graceDaysLeft}d)`
      : `✕ VENCIDO`;
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

  const status = resolveDisplayStatus(sub?.status, sub);
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
  } else if (status === 'expired' || status === 'trial_expired') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const graceEnd = trialEnd ? new Date(trialEnd.getTime() + TRIAL_GRACE_DAYS_MS) : null;
    const daysLeft = graceEnd ? Math.max(0, Math.ceil((graceEnd.getTime() - Date.now()) / DAY_MS)) : 0;
    alertLevel = 'danger';
    btnText = 'Activar mi plan';
    btnBg = '#ef4444';
    btnColor = '#fff';
    alertMsg = daysLeft > 0
      ? `🚨 Tu prueba terminó. Tu menú deja de estar online en ${daysLeft} día${daysLeft === 1 ? '' : 's'} si no activás tu plan.`
      : '🚨 Tu menú está pausado. Activá tu plan para volver a estar online al instante.';
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
  const status = resolveDisplayStatus(sub?.status, sub);

  if (status === 'active') return { visible: true, label: 'ONLINE', color: '#4ade80' };

  if (status === 'trial' || status === 'trialing') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    if (!trialEnd || trialEnd.getTime() > Date.now()) {
      return { visible: true, label: 'ONLINE (Trial)', color: '#60a5fa' };
    }
  }

  if (status === 'expired' || status === 'trial_expired') {
    const trialEnd = sub?.trialEndsAt ? new Date(sub.trialEndsAt) : null;
    const graceEnd = trialEnd ? new Date(trialEnd.getTime() + TRIAL_GRACE_DAYS_MS) : null;
    if (graceEnd && graceEnd.getTime() > Date.now()) {
      const days = Math.max(1, Math.ceil((graceEnd.getTime() - Date.now()) / DAY_MS));
      return { visible: true, label: `ONLINE (gracia ${days}d)`, color: '#fbbf24' };
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
 * Muestra la pantalla de bloqueo (paywall) sobre el workspace.
 * @param {{ status: string, warning?: string, inGrace?: boolean, graceDaysLeft?: number }} access
 * @param {{ onContinue?: Function }} [options] — si `onContinue` viene dado y
 *   estamos en gracia post-trial, se ofrece un botón secundario para seguir
 *   editando (el menú público sigue online igual).
 */
export function showSubscriptionRequiredScreen(access, options = {}) {
  const workspace = document.querySelector('.workspace-layout');
  const inGrace = Boolean(access.inGrace);
  const statusLabel = STATUS_LABELS[access.status] || String(access.status || 'unknown').toUpperCase();

  if (workspace) {
    workspace.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:70vh; padding:40px 20px; text-align:center;">
        <div style="font-size:3.5rem; margin-bottom:16px;">${inGrace ? '⏳' : '⚠️'}</div>
        <h2 style="color:var(--accent-gold); margin-bottom:12px; font-size:1.5rem;">
          ${inGrace ? 'Tu prueba gratuita terminó' : 'Menú pausado'}
        </h2>
        <p style="color:var(--text-muted); margin-bottom:8px; font-size:0.95rem; max-width:440px;">
          ${access.warning || 'Tu suscripción está inactiva.'}
        </p>
        <p style="color:var(--text-muted); margin-bottom:24px; font-size:0.8rem;">
          Estado: <strong style="color:${inGrace ? '#fbbf24' : '#f87171'};">${statusLabel}</strong>
          ${inGrace ? ' · Tu menú público sigue <strong style="color:#4ade80;">ONLINE</strong>' : ''}
        </p>
        <button data-action="activate-plan" style="padding:12px 28px; background:var(--accent-gold); color:#101614; border:none; border-radius:8px; font-weight:700; cursor:pointer; font-size:0.9rem;">
          💎 Activar mi plan
        </button>
        ${inGrace && typeof options.onContinue === 'function' ? `
          <button data-action="continue-editing" style="margin-top:14px; padding:10px 22px; background:transparent; color:var(--text-muted); border:1px solid var(--border-color, rgba(255,255,255,0.18)); border-radius:8px; cursor:pointer; font-size:0.82rem;">
            Seguir editando (quedan ${access.graceDaysLeft} día${access.graceDaysLeft === 1 ? '' : 's'} de gracia)
          </button>
        ` : ''}
      </div>
    `;

    const activateBtn = workspace.querySelector('[data-action="activate-plan"]');
    if (activateBtn) {
      activateBtn.addEventListener('click', () => {
        if (typeof window !== 'undefined' && typeof window.openBillingModal === 'function') {
          window.openBillingModal();
        }
      });
    }
    const continueBtn = workspace.querySelector('[data-action="continue-editing"]');
    if (continueBtn) {
      continueBtn.addEventListener('click', () => options.onContinue());
    }
  }

  const nameEl = document.getElementById('studioNavRestaurantName');
  if (nameEl) nameEl.textContent = inGrace ? 'Prueba finalizada' : 'Suscripción Requerida';
}
