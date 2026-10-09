/**
 * subscriptionMachine.js — Máquina de estados explícita de la suscripción.
 *
 * Pura (CommonJS, sin I/O): no toca db, ni email, ni proveedores. Modela el
 * ciclo de vida que hoy está disperso entre `verifyAccess` /
 * `buildTrialExpiredAccess` (src/billing/orchestrator.js) y el cron de dunning
 * (api/cron/billing-dunning.js).
 *
 * La máquina SIGUE al legacy: ante cualquier duda, `computeStatus()` replica
 * la lectura de `verifyAccess` al pie de la letra. Si el diferencial
 * (tests/test-billing-properties.js) encuentra un mismatch real, se ajusta
 * ESTA máquina, nunca el orchestrator.
 *
 * Mapa de reglas → fuente:
 *   - TRIAL_DAYS=7, TRIAL_GRACE_DAYS=3, PAST_DUE_GRACE_DAYS=7
 *     → orchestrator.js:66-71 (DAY_MS/TRIAL_DAYS/TRIAL_GRACE_DAYS/PAST_DUE_GRACE_DAYS)
 *   - buildTrialExpiredAccess: gracia días 8-10 (allowed+requiresPayment),
 *     día 11+ pausado → orchestrator.js:443-471
 *   - trialing lee trialEndsAt o cae a currentPeriodEnd+7d → orchestrator.js:494-511
 *   - expired con gracia post-trial SOLO si nunca estuvo paga
 *     (downgradedAt o provider!=='trial' la pierden) → orchestrator.js:514-527
 *   - past_due: gracia 7d desde currentPeriodEnd → orchestrator.js:530-545
 *   - resto (canceled/desconocido) → bloqueado → orchestrator.js:547-553
 *   - Cron trial: warnings 3d/1d con banderas, trialing→expired día 8,
 *     menú pausado día 11+ (banderas trialWarning3dSent/1dSent,
 *     trialExpiredEmailSent, menuPausedEmailSent; salta pagas)
 *     → billing-dunning.js:132-223
 *   - Cron dunning: past_due en gracia → reminders día 3/1 (sin bandera por
 *     restaurante; dedup por idempotencia diaria lastDunningRun); gracia
 *     expirada → downgrade a {status:'expired', plan:'free', downgradedAt}
 *     → billing-dunning.js:225-324
 *   - Webhook past_due setea gracePeriodDaysRemaining=7 y mail de fallo
 *     → orchestrator.js:370-377, 408-427
 *
 * Nota estados vs strings legacy: `verifyAccess` NUNCA devuelve los strings
 * 'grace'/'paused'/'free'. La gracia post-trial y el pausado se leen como
 * status:'expired' (allowed true/false), y el bucket terminal
 * (canceled/free/desconocido) se lee como status:'canceled'. Por eso
 * `computeStatus()` devuelve la forma legacy (allowed/requiresPayment/plan/
 * status/...) MÁS el campo extra `state` con el estado de ESTA máquina, para
 * observabilidad. El diferencial solo compara `allowed` y `status`.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = 7; // orchestrator.js:67
const TRIAL_GRACE_DAYS = 3; // orchestrator.js:70
const PAST_DUE_GRACE_DAYS = 7; // orchestrator.js:71

const STATES = Object.freeze({
  TRIALING: 'trialing',
  GRACE: 'grace', // post-trial días 8-10 (legacy: status 'expired', allowed true)
  PAUSED: 'paused', // trial vencido día 11+, nunca pago (legacy: status 'expired', allowed false)
  ACTIVE: 'active',
  PAST_DUE: 'past_due', // en gracia o con gracia vencida (el cron la degrada)
  EXPIRED: 'expired', // terminal con historia paga/dunning (incluye downgraded plan free)
  FREE: 'free' // bucket terminal legacy 'canceled' (status canceled/free/desconocido)
});

const EVENTS = Object.freeze({
  TICK: 'TICK', // {now} — avanza el reloj; dispara transiciones por tiempo
  PAYMENT_SUCCESS: 'PAYMENT_SUCCESS', // {plan} — webhook/cobro OK
  PAYMENT_FAILED: 'PAYMENT_FAILED', // {} — webhook/cobro rechazado
  TRIAL_ENDED: 'TRIAL_ENDED', // {} — el cron detectó fin del trial (día 8)
  GRACE_ENDED: 'GRACE_ENDED', // {} — el cron detectó fin de la gracia post-trial (día 11)
  DUNNING_EXPIRED: 'DUNNING_EXPIRED' // {} — el cron detectó fin de la gracia past_due
});

const EFFECTS = Object.freeze({
  SEND_TRIAL_WARN_3D: 'SEND_TRIAL_WARN_3D', // cron: billing-dunning.js:162-174
  SEND_TRIAL_WARN_1D: 'SEND_TRIAL_WARN_1D', // cron: billing-dunning.js:147-161
  SEND_TRIAL_EXPIRED: 'SEND_TRIAL_EXPIRED', // cron: billing-dunning.js:182-196
  SEND_MENU_PAUSED: 'SEND_MENU_PAUSED', // cron: billing-dunning.js:198-212
  SEND_DUNNING_REMINDER: 'SEND_DUNNING_REMINDER', // cron: billing-dunning.js:246-265 + orchestrator.js:409-427
  DOWNGRADE_TO_FREE: 'DOWNGRADE_TO_FREE', // cron: billing-dunning.js:275-289
  BLOCK_MENU: 'BLOCK_MENU' // marca la transición que corta el acceso (paused/expired)
});

// Celda de rechazo explícito: la combinación estado×evento no es válida y la
// máquina se queda donde está.
function reject(reason) {
  return Object.freeze({ rejected: true, reason });
}

function go(to, effects) {
  return Object.freeze({ to, effects: Object.freeze(effects.slice()) });
}

/**
 * Tabla total estado×evento → {to, effects[]} o {rejected, reason}.
 * Es el camino CANÓNICO (sin contexto). `transition()` la interpreta y aplica
 * los guards de elegibilidad por ctx (gracia post-trial solo si nunca paga,
 * TICK por tiempo, etc.).
 */
const TRANSITIONS = Object.freeze({
  [STATES.TRIALING]: Object.freeze({
    // TICK resuelto por tiempo en transition() (warns / paso a grace / expired).
    [EVENTS.TICK]: go(STATES.TRIALING, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: reject('TRIAL_HAS_NO_CARD_TO_CHARGE'),
    // TRIAL_ENDED canónico → grace; transition() lo manda a expired con
    // BLOCK_MENU si ctx ya estuvo pago (provider!=='trial' o downgradedAt).
    [EVENTS.TRIAL_ENDED]: go(STATES.GRACE, [EFFECTS.SEND_TRIAL_EXPIRED]),
    [EVENTS.GRACE_ENDED]: reject('TRIAL_NOT_IN_GRACE'),
    [EVENTS.DUNNING_EXPIRED]: reject('NO_DUNNING_WITHOUT_PAST_DUE')
  }),
  [STATES.GRACE]: Object.freeze({
    // TICK resuelto por tiempo en transition() (sigue en grace o → paused).
    [EVENTS.TICK]: go(STATES.GRACE, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: reject('NO_RECURRING_CHARGE_IN_TRIAL_GRACE'),
    [EVENTS.TRIAL_ENDED]: reject('TRIAL_ALREADY_ENDED'),
    [EVENTS.GRACE_ENDED]: go(STATES.PAUSED, [EFFECTS.SEND_MENU_PAUSED, EFFECTS.BLOCK_MENU]),
    [EVENTS.DUNNING_EXPIRED]: reject('TRIAL_GRACE_HAS_NO_DUNNING')
  }),
  [STATES.PAUSED]: Object.freeze({
    [EVENTS.TICK]: go(STATES.PAUSED, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: reject('PAUSED_NEEDS_SUCCESSFUL_PAYMENT'),
    [EVENTS.TRIAL_ENDED]: reject('TRIAL_ALREADY_ENDED'),
    [EVENTS.GRACE_ENDED]: reject('GRACE_ALREADY_ENDED'),
    [EVENTS.DUNNING_EXPIRED]: reject('NO_DUNNING_WITHOUT_PAST_DUE')
  }),
  [STATES.ACTIVE]: Object.freeze({
    [EVENTS.TICK]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []), // renovación
    [EVENTS.PAYMENT_FAILED]: go(STATES.PAST_DUE, [EFFECTS.SEND_DUNNING_REMINDER]),
    [EVENTS.TRIAL_ENDED]: reject('ACTIVE_HAS_NO_TRIAL'),
    [EVENTS.GRACE_ENDED]: reject('ACTIVE_HAS_NO_GRACE'),
    [EVENTS.DUNNING_EXPIRED]: reject('ACTIVE_HAS_NO_DUNNING')
  }),
  [STATES.PAST_DUE]: Object.freeze({
    // TICK resuelto por tiempo en transition() (sigue o → expired).
    [EVENTS.TICK]: go(STATES.PAST_DUE, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: go(STATES.PAST_DUE, []), // reintento fallido, sigue en gracia
    [EVENTS.TRIAL_ENDED]: reject('PAST_DUE_HAS_NO_TRIAL'),
    [EVENTS.GRACE_ENDED]: reject('PAST_DUE_HAS_NO_TRIAL_GRACE'),
    [EVENTS.DUNNING_EXPIRED]: go(STATES.EXPIRED, [EFFECTS.DOWNGRADE_TO_FREE, EFFECTS.BLOCK_MENU])
  }),
  [STATES.EXPIRED]: Object.freeze({
    [EVENTS.TICK]: go(STATES.EXPIRED, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: reject('EXPIRED_NEEDS_SUCCESSFUL_PAYMENT'),
    [EVENTS.TRIAL_ENDED]: reject('TRIAL_ALREADY_ENDED'),
    [EVENTS.GRACE_ENDED]: reject('GRACE_ALREADY_ENDED'),
    [EVENTS.DUNNING_EXPIRED]: reject('ALREADY_DOWNGRADED')
  }),
  [STATES.FREE]: Object.freeze({
    [EVENTS.TICK]: go(STATES.FREE, []),
    [EVENTS.PAYMENT_SUCCESS]: go(STATES.ACTIVE, []),
    [EVENTS.PAYMENT_FAILED]: reject('FREE_NEEDS_SUCCESSFUL_PAYMENT'),
    [EVENTS.TRIAL_ENDED]: reject('FREE_HAS_NO_TRIAL'),
    [EVENTS.GRACE_ENDED]: reject('FREE_HAS_NO_GRACE'),
    [EVENTS.DUNNING_EXPIRED]: reject('FREE_HAS_NO_DUNNING')
  })
});

function toDate(v) {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') return new Date(v);
  return null;
}

function isValidDate(d) {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

// Elegibilidad de gracia post-trial: SOLO suscripciones que nunca estuvieron
// pagas (cron: billing-dunning.js:137; lectura: orchestrator.js:518).
function eligibleForTrialGrace(ctx) {
  const c = ctx || {};
  if (c.downgradedAt) return false;
  const provider = c.provider;
  return !provider || provider === 'trial';
}

function daysLeft(fromMs, toMs) {
  return Math.max(0, Math.ceil((toMs - fromMs) / DAY_MS));
}

/**
 * Transición pura: (state, event, ctx) → {from, to, effects, rejected, reason?}.
 * ctx: {trialEndsAt, currentPeriodEnd, provider, downgradedAt, now,
 *       trialWarning3dSent, trialWarning1dSent} — todo opcional salvo lo que
 *       el evento necesite (ver rechazos MISSING_*).
 */
function transition(state, event, ctx) {
  const c = ctx || {};
  const now = toDate(c.now) || new Date();
  const row = TRANSITIONS[state];
  if (!row) return { from: state, to: state, effects: [], rejected: true, reason: 'UNKNOWN_STATE' };
  const cell = row[event];
  if (!cell) return { from: state, to: state, effects: [], rejected: true, reason: 'UNKNOWN_EVENT' };
  if (cell.rejected) return { from: state, to: state, effects: [], rejected: true, reason: cell.reason };

  // Guards dependientes de ctx por (estado, evento).
  if (state === STATES.TRIALING && event === EVENTS.TICK) {
    // trialEndsAt o fallback currentPeriodEnd+7d (orchestrator.js:495-497).
    let trialEnds = toDate(c.trialEndsAt);
    if (!isValidDate(trialEnds)) {
      const periodEnd = toDate(c.currentPeriodEnd);
      trialEnds = isValidDate(periodEnd) ? new Date(periodEnd.getTime() + TRIAL_DAYS * DAY_MS) : null;
    }
    if (!isValidDate(trialEnds)) {
      return { from: state, to: state, effects: [], rejected: true, reason: 'MISSING_TRIAL_ENDS_AT' };
    }
    if (now <= trialEnds) {
      const left = daysLeft(now.getTime(), trialEnds.getTime());
      // Avisos del cron con banderas (billing-dunning.js:146-175).
      if (left <= 1 && !c.trialWarning1dSent) {
        return { from: state, to: state, effects: [EFFECTS.SEND_TRIAL_WARN_1D], rejected: false };
      }
      if (left <= 3 && !c.trialWarning3dSent) {
        return { from: state, to: state, effects: [EFFECTS.SEND_TRIAL_WARN_3D], rejected: false };
      }
      return { from: state, to: state, effects: [], rejected: false };
    }
    // Trial vencido: gracia solo si nunca paga.
    if (eligibleForTrialGrace(c)) {
      return { from: state, to: STATES.GRACE, effects: [EFFECTS.SEND_TRIAL_EXPIRED], rejected: false };
    }
    return {
      from: state, to: STATES.EXPIRED,
      effects: [EFFECTS.SEND_TRIAL_EXPIRED, EFFECTS.BLOCK_MENU], rejected: false
    };
  }

  if (state === STATES.TRIALING && event === EVENTS.TRIAL_ENDED) {
    if (eligibleForTrialGrace(c)) return { from: state, to: STATES.GRACE, effects: cell.effects.slice(), rejected: false };
    return {
      from: state, to: STATES.EXPIRED,
      effects: [EFFECTS.SEND_TRIAL_EXPIRED, EFFECTS.BLOCK_MENU], rejected: false
    };
  }

  if (state === STATES.GRACE && event === EVENTS.TICK) {
    const trialEnds = toDate(c.trialEndsAt);
    if (!isValidDate(trialEnds)) {
      return { from: state, to: state, effects: [], rejected: true, reason: 'MISSING_TRIAL_ENDS_AT' };
    }
    // graceEnd = trialEnds + 3d (orchestrator.js:444; cron: billing-dunning.js:199).
    const graceEnd = new Date(trialEnds.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
    if (now <= graceEnd) return { from: state, to: state, effects: [], rejected: false };
    return {
      from: state, to: STATES.PAUSED,
      effects: [EFFECTS.SEND_MENU_PAUSED, EFFECTS.BLOCK_MENU], rejected: false
    };
  }

  if (state === STATES.PAST_DUE && event === EVENTS.TICK) {
    // periodEnd o fallback now (orchestrator.js:479: sin currentPeriodEnd → now).
    const periodEnd = toDate(c.currentPeriodEnd);
    const base = isValidDate(periodEnd) ? periodEnd : now;
    // graceEnd = periodEnd + 7d (orchestrator.js:531; cron: billing-dunning.js:239).
    const graceEnd = new Date(base.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
    if (now <= graceEnd) {
      const left = daysLeft(now.getTime(), graceEnd.getTime());
      // Reminders día 3 y 1 (cron: billing-dunning.js:246; sin bandera por
      // restaurante — el dedup es la idempotencia diaria del cron).
      if (left === 3 || left === 1) {
        return { from: state, to: state, effects: [EFFECTS.SEND_DUNNING_REMINDER], rejected: false };
      }
      return { from: state, to: state, effects: [], rejected: false };
    }
    return {
      from: state, to: STATES.EXPIRED,
      effects: [EFFECTS.DOWNGRADE_TO_FREE, EFFECTS.BLOCK_MENU], rejected: false
    };
  }

  return { from: state, to: cell.to, effects: cell.effects.slice(), rejected: false };
}

/**
 * Deriva el estado de la máquina desde una subscription legacy + now.
 * Sigue la LECTURA de verifyAccess (no la elegibilidad estricta del cron):
 * un `trialing` vencido se lee en gracia/pausado aunque el provider sea raro,
 * igual que orchestrator.js:510 (TRIAL_ENDED sin chequeo de wasPaid).
 */
function deriveState(sub, now) {
  const s = (sub && sub.status) || '';
  const t = isValidDate(now) ? now : new Date();
  if (s === 'active') return STATES.ACTIVE;
  if (s === 'trialing') {
    let trialEnds = toDate(sub.trialEndsAt);
    if (!isValidDate(trialEnds)) {
      const periodEnd = toDate(sub.currentPeriodEnd);
      trialEnds = isValidDate(periodEnd) ? new Date(periodEnd.getTime() + TRIAL_DAYS * DAY_MS) : null;
    }
    if (!isValidDate(trialEnds) || t <= trialEnds) return STATES.TRIALING;
    const graceEnd = new Date(trialEnds.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
    return t <= graceEnd ? STATES.GRACE : STATES.PAUSED;
  }
  if (s === 'past_due') return STATES.PAST_DUE;
  if (s === 'expired') {
    const wasPaid = Boolean(sub.downgradedAt) || Boolean(sub.provider && sub.provider !== 'trial');
    const trialEnds = toDate(sub.trialEndsAt);
    if (trialEnds && !wasPaid && isValidDate(trialEnds)) {
      const graceEnd = new Date(trialEnds.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
      return t <= graceEnd ? STATES.GRACE : STATES.PAUSED;
    }
    return STATES.EXPIRED;
  }
  return STATES.FREE;
}

// Lectura de gracia post-trial: réplica exacta de buildTrialExpiredAccess
// (orchestrator.js:443-471) sin pricing/features (no hay acceso a db/rest).
function trialExpiredReading(sub, trialEnds, now) {
  const plan = sub && sub.plan;
  const planKey = plan || 'pro_monthly';
  const graceEnd = new Date(trialEnds.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
  const inGrace = now <= graceEnd;
  if (inGrace) {
    const left = daysLeft(now.getTime(), graceEnd.getTime());
    return {
      allowed: true,
      status: 'expired',
      trialExpired: true,
      requiresPayment: true,
      trialGraceDaysRemaining: left,
      plan: planKey,
      inGracePeriod: true,
      warning: `Tu prueba gratuita terminó. Tu menú sigue online ${left} día${left === 1 ? '' : 's'} más: activá tu plan para no perderlo.`
    };
  }
  return {
    allowed: false,
    status: 'expired',
    isTrialExpired: true,
    reason: 'trial_expirado',
    warning: 'Tu período de prueba gratuita ha finalizado. Actualizá tu suscripción para reactivar tu menú.'
  };
}

/**
 * computeStatus(sub, now) — réplica PURA de la lectura de verifyAccess
 * (orchestrator.js:473-554) sobre {trialEndsAt, currentPeriodEnd, provider,
 * downgradedAt, status, plan}. Devuelve la forma legacy + `state`.
 * Sin NaN-guards extra: las comparaciones con fechas inválidas se comportan
 * igual que en el legacy (false → rama de vencido).
 */
function computeStatus(sub, now) {
  const s = (sub && typeof sub === 'object') ? sub : {};
  const t = isValidDate(now) ? now : (toDate(now) || new Date());
  const nowDate = isValidDate(t) ? t : new Date();
  const periodEndRaw = s.currentPeriodEnd ? new Date(s.currentPeriodEnd) : nowDate;
  const state = deriveState(s, nowDate);

  if (s.status === 'active') {
    return {
      state,
      allowed: true,
      status: 'active',
      plan: s.plan || 'pro_monthly',
      inGracePeriod: false
    };
  }

  if (s.status === 'trialing') {
    const trialEnds = s.trialEndsAt
      ? new Date(s.trialEndsAt)
      : new Date(periodEndRaw.getTime() + TRIAL_DAYS * DAY_MS);
    if (nowDate <= trialEnds) {
      return {
        state,
        allowed: true,
        status: 'trialing',
        daysLeft: daysLeft(nowDate.getTime(), trialEnds.getTime()),
        plan: s.plan || 'pro_monthly',
        inGracePeriod: false
      };
    }
    return { state, ...trialExpiredReading(s, trialEnds, nowDate) };
  }

  if (s.status === 'expired') {
    const trialEnds = s.trialEndsAt ? new Date(s.trialEndsAt) : null;
    const wasPaid = Boolean(s.downgradedAt) || Boolean(s.provider && s.provider !== 'trial');
    if (trialEnds && !wasPaid) return { state, ...trialExpiredReading(s, trialEnds, nowDate) };
    return {
      state,
      allowed: false,
      status: 'expired',
      isTrialExpired: true,
      reason: 'suscripcion_inactiva',
      warning: 'Tu suscripción ha finalizado. Activá tu plan para reactivar tu menú.'
    };
  }

  if (s.status === 'past_due') {
    const graceEnd = new Date(periodEndRaw.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
    const isStillInGrace = nowDate <= graceEnd;
    const left = daysLeft(nowDate.getTime(), graceEnd.getTime());
    return {
      state,
      allowed: isStillInGrace,
      status: 'past_due',
      inGracePeriod: isStillInGrace,
      gracePeriodDaysRemaining: left,
      plan: s.plan || 'pro_monthly',
      warning: 'Cobro pendiente. Su menú se pausará en ' + left + ' días si no regulariza el pago.'
    };
  }

  return {
    state,
    allowed: false,
    status: 'canceled',
    reason: 'suscripcion_inactiva',
    warning: 'Suscripción inactiva. Ingrese a su cuenta para renovar su menú.'
  };
}

module.exports = {
  DAY_MS,
  TRIAL_DAYS,
  TRIAL_GRACE_DAYS,
  PAST_DUE_GRACE_DAYS,
  STATES,
  EVENTS,
  EFFECTS,
  TRANSITIONS,
  transition,
  deriveState,
  computeStatus
};
