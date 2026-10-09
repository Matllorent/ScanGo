const assert = require('assert');
const {
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
} = require('../src/billing/subscriptionMachine');

console.log('🧪 Máquina de estados de suscripción (tabla total + invariantes)...');

const ALL_STATES = Object.values(STATES);
const ALL_EVENTS = Object.values(EVENTS);
const ALL_EFFECTS = Object.values(EFFECTS);

function ctxFor(state, over = {}) {
  const now = Date.now();
  const base = {
    [STATES.TRIALING]: {
      now: new Date(now).toISOString(),
      trialEndsAt: new Date(now + 2 * DAY_MS).toISOString(),
      currentPeriodEnd: new Date(now + 2 * DAY_MS).toISOString(),
      provider: 'trial'
    },
    [STATES.GRACE]: {
      now: new Date(now).toISOString(),
      trialEndsAt: new Date(now - 1 * DAY_MS).toISOString(), // día 8: 1 día dentro de la gracia de 3d
      provider: 'trial'
    },
    [STATES.PAUSED]: {
      now: new Date(now).toISOString(),
      trialEndsAt: new Date(now - 20 * DAY_MS).toISOString(),
      provider: 'trial'
    },
    [STATES.ACTIVE]: {
      now: new Date(now).toISOString(),
      currentPeriodEnd: new Date(now + 30 * DAY_MS).toISOString(),
      provider: 'stripe'
    },
    [STATES.PAST_DUE]: {
      now: new Date(now).toISOString(),
      currentPeriodEnd: new Date(now).toISOString(),
      provider: 'stripe'
    },
    [STATES.EXPIRED]: {
      now: new Date(now).toISOString(),
      provider: 'stripe',
      downgradedAt: new Date(now - DAY_MS).toISOString()
    },
    [STATES.FREE]: { now: new Date(now).toISOString(), provider: 'dunning_cron' }
  };
  return { ...(base[state] || {}), ...over };
}

// §1 — Totalidad: cada estado × cada evento tiene celda definida (transición o rechazo explícito).
for (const st of ALL_STATES) {
  assert.ok(TRANSITIONS[st], `TRANSITIONS sin fila para estado ${st}`);
  for (const ev of ALL_EVENTS) {
    const cell = TRANSITIONS[st][ev];
    assert.ok(cell && typeof cell === 'object', `sin celda ${st}×${ev}`);
    if (cell.rejected) {
      assert.strictEqual(typeof cell.reason, 'string', `rechazo ${st}×${ev} sin reason`);
      assert.ok(cell.reason.length > 0, `rechazo ${st}×${ev} con reason vacío`);
    } else {
      assert.ok(ALL_STATES.includes(cell.to), `transición ${st}×${ev} → estado inválido ${cell.to}`);
      assert.ok(Array.isArray(cell.effects), `transición ${st}×${ev} sin effects[]`);
      for (const fx of cell.effects) {
        assert.ok(ALL_EFFECTS.includes(fx), `efecto desconocido ${fx} en ${st}×${ev}`);
      }
    }
    // transition() con ctx válido nunca tira ni devuelve basura.
    const r = transition(st, ev, ctxFor(st));
    assert.ok(r && typeof r === 'object', `transition(${st},${ev}) sin resultado`);
    assert.strictEqual(r.from, st, `transition(${st},${ev}).from`);
    assert.ok(ALL_STATES.includes(r.to), `transition(${st},${ev}).to inválido`);
    assert.ok(Array.isArray(r.effects), `transition(${st},${ev}) sin effects`);
    assert.strictEqual(typeof r.rejected, 'boolean', `transition(${st},${ev}).rejected no booleano`);
    if (r.rejected) assert.ok(r.reason, `rechazo ${st}×${ev} sin reason`);
  }
}
console.log(`✓ Tabla total: ${ALL_STATES.length} estados × ${ALL_EVENTS.length} eventos = ${ALL_STATES.length * ALL_EVENTS.length} celdas definidas`);

// §1b — Rechazos desconocidos.
{
  const r1 = transition('nope', EVENTS.TICK, {});
  assert.strictEqual(r1.rejected, true, 'estado desconocido debe rechazarse');
  assert.strictEqual(r1.reason, 'UNKNOWN_STATE');
  const r2 = transition(STATES.ACTIVE, 'NOPE', {});
  assert.strictEqual(r2.rejected, true, 'evento desconocido debe rechazarse');
  assert.strictEqual(r2.reason, 'UNKNOWN_EVENT');
  console.log('✓ Estados/eventos desconocidos se rechazan explícitamente');
}

// §2a — Invariante: NINGUNA transición lleva DE OTRO estado a trialing
// (trialing solo es inicial; el self-loop trialing×TICK es quedarse, no volver).
for (const st of ALL_STATES) {
  for (const ev of ALL_EVENTS) {
    const cell = TRANSITIONS[st][ev];
    if (!cell.rejected && st !== STATES.TRIALING) {
      assert.notStrictEqual(cell.to, STATES.TRIALING, `${st}×${ev} no debe llevar a trialing`);
    }
  }
}
// Ni siquiera con PAYMENT_SUCCESS desde terminales se vuelve a trialing.
for (const st of [STATES.EXPIRED, STATES.FREE, STATES.PAUSED, STATES.PAST_DUE]) {
  const r = transition(st, EVENTS.PAYMENT_SUCCESS, ctxFor(st));
  assert.strictEqual(r.rejected, false);
  assert.strictEqual(r.to, STATES.ACTIVE, `${st}+PAYMENT_SUCCESS → active (nunca trialing)`);
}
console.log('✓ Invariante: expired/free → trialing imposible sin excepción (solo PAYMENT_SUCCESS → active)');

// §2b — Invariante: DOWNGRADE_TO_FREE solo desde past_due.
for (const st of ALL_STATES) {
  for (const ev of ALL_EVENTS) {
    // Camino estático (tabla).
    const cell = TRANSITIONS[st][ev];
    if (!cell.rejected && cell.effects.includes(EFFECTS.DOWNGRADE_TO_FREE)) {
      assert.strictEqual(st, STATES.PAST_DUE, `DOWNGRADE_TO_FREE estático solo desde past_due (${st}×${ev})`);
    }
    // Camino dinámico (TICK por tiempo): barre antes/durante/después de la gracia.
    for (const shift of [-30, -8, -7, -6, -1, 0, 1, 6, 7, 8, 30]) {
      const c = ctxFor(st, st === STATES.PAST_DUE
        ? { currentPeriodEnd: new Date(Date.now() + shift * DAY_MS).toISOString() }
        : st === STATES.TRIALING
          ? { trialEndsAt: new Date(Date.now() + shift * DAY_MS).toISOString() }
          : st === STATES.GRACE
            ? { trialEndsAt: new Date(Date.now() + (shift - 9) * DAY_MS).toISOString() }
            : {});
      const r = transition(st, ev, c);
      if (r.effects.includes(EFFECTS.DOWNGRADE_TO_FREE)) {
        assert.strictEqual(st, STATES.PAST_DUE, `DOWNGRADE_TO_FREE dinámico solo desde past_due (${st}×${ev} shift ${shift})`);
        assert.strictEqual(r.to, STATES.EXPIRED, 'downgrade lleva a expired');
      }
    }
  }
}
console.log('✓ Invariante: DOWNGRADE_TO_FREE solo desde past_due (estático + TICK por tiempo)');

// §2c — Invariante: gracia post-trial solo si provider==='trial' (o ausente) && !downgradedAt.
{
  const now = Date.now();
  const pastTrial = { now: new Date(now).toISOString(), trialEndsAt: new Date(now - 1 * DAY_MS).toISOString() };
  // Elegibles → grace.
  for (const c of [{ ...pastTrial, provider: 'trial' }, { ...pastTrial }]) {
    const rTick = transition(STATES.TRIALING, EVENTS.TICK, c);
    assert.strictEqual(rTick.to, STATES.GRACE, `trial vencido elegible TICK → grace (${JSON.stringify(c)})`);
    const rEv = transition(STATES.TRIALING, EVENTS.TRIAL_ENDED, c);
    assert.strictEqual(rEv.to, STATES.GRACE, 'trial vencido elegible TRIAL_ENDED → grace');
    assert.ok(rEv.effects.includes(EFFECTS.SEND_TRIAL_EXPIRED), 'aviso de trial vencido');
  }
  // No elegibles (alguna vez pagos) → expired directo con BLOCK_MENU, sin pasar por grace.
  for (const c of [
    { ...pastTrial, provider: 'stripe' },
    { ...pastTrial, provider: 'mercadopago' },
    { ...pastTrial, provider: 'lemonsqueezy' },
    { ...pastTrial, provider: 'trial', downgradedAt: new Date(now - DAY_MS).toISOString() }
  ]) {
    const rTick = transition(STATES.TRIALING, EVENTS.TICK, c);
    assert.strictEqual(rTick.to, STATES.EXPIRED, `trial vencido pago TICK → expired (${c.provider})`);
    assert.ok(rTick.effects.includes(EFFECTS.BLOCK_MENU), 'corte inmediato sin gracia');
    const rEv = transition(STATES.TRIALING, EVENTS.TRIAL_ENDED, c);
    assert.strictEqual(rEv.to, STATES.EXPIRED, 'trial vencido pago TRIAL_ENDED → expired');
  }
  console.log('✓ Invariante: gracia post-trial solo si provider trial (o ausente) y sin downgradedAt');
}

// §2d — Invariante: BLOCK_MENU solo en transiciones hacia paused/expired.
for (const st of ALL_STATES) {
  for (const ev of ALL_EVENTS) {
    const cell = TRANSITIONS[st][ev];
    if (!cell.rejected && cell.effects.includes(EFFECTS.BLOCK_MENU)) {
      assert.ok(
        cell.to === STATES.PAUSED || cell.to === STATES.EXPIRED,
        `BLOCK_MENU estático solo hacia paused/expired (${st}×${ev} → ${cell.to})`
      );
    }
  }
}
// Dinámico: TICK que cruza fronteras de tiempo.
{
  const now = Date.now();
  const dynCases = [
    [STATES.TRIALING, { now: new Date(now).toISOString(), trialEndsAt: new Date(now - 8 * DAY_MS).toISOString(), provider: 'stripe' }],
    [STATES.TRIALING, { now: new Date(now).toISOString(), trialEndsAt: new Date(now - 8 * DAY_MS).toISOString(), provider: 'trial' }],
    [STATES.GRACE, { now: new Date(now).toISOString(), trialEndsAt: new Date(now - 20 * DAY_MS).toISOString(), provider: 'trial' }],
    [STATES.PAST_DUE, { now: new Date(now).toISOString(), currentPeriodEnd: new Date(now - 30 * DAY_MS).toISOString(), provider: 'stripe' }]
  ];
  for (const [st, c] of dynCases) {
    const r = transition(st, EVENTS.TICK, c);
    if (r.effects.includes(EFFECTS.BLOCK_MENU)) {
      assert.ok(r.to === STATES.PAUSED || r.to === STATES.EXPIRED, `BLOCK_MENU dinámico solo a paused/expired (${st})`);
    }
  }
  // FREE jamás emite BLOCK_MENU (bucket terminal ya cortado aguas arriba).
  for (const ev of ALL_EVENTS) {
    const r = transition(STATES.FREE, ev, ctxFor(STATES.FREE));
    assert.ok(!r.effects.includes(EFFECTS.BLOCK_MENU), `FREE×${ev} no debe emitir BLOCK_MENU`);
  }
}
console.log('✓ Invariante: BLOCK_MENU solo hacia paused/expired (y nunca desde free)');

// §3 — TICK por tiempo: fronteras exactas del legacy.
{
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  // Trial: dentro (día 7) → trialing; día 8-10 → grace; día 11+ → paused.
  assert.strictEqual(
    transition(STATES.TRIALING, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now + DAY_MS), provider: 'trial' }).to,
    STATES.TRIALING
  );
  const toGrace = transition(STATES.TRIALING, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now - 1 * DAY_MS), provider: 'trial' });
  assert.strictEqual(toGrace.to, STATES.GRACE);
  assert.ok(toGrace.effects.includes(EFFECTS.SEND_TRIAL_EXPIRED));
  // Grace: 2 días tras el fin sigue; en el borde exacto (now == graceEnd) el
  // legacy usa <= así que sigue; 4 días tras el fin → paused con aviso + corte.
  assert.strictEqual(
    transition(STATES.GRACE, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now - 2 * DAY_MS), provider: 'trial' }).to,
    STATES.GRACE
  );
  assert.strictEqual(
    transition(STATES.GRACE, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now - 3 * DAY_MS), provider: 'trial' }).to,
    STATES.GRACE,
    'borde inclusivo: now == trialEnds+3d sigue en gracia (legacy <=)'
  );
  const toPaused = transition(STATES.GRACE, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now - 4 * DAY_MS), provider: 'trial' });
  assert.strictEqual(toPaused.to, STATES.PAUSED);
  assert.ok(toPaused.effects.includes(EFFECTS.SEND_MENU_PAUSED));
  assert.ok(toPaused.effects.includes(EFFECTS.BLOCK_MENU));
  // past_due: día 7 en gracia, día 8 → expired con downgrade + corte.
  const pdIn = transition(STATES.PAST_DUE, EVENTS.TICK, { now: iso(now), currentPeriodEnd: iso(now - 7 * DAY_MS), provider: 'stripe' });
  assert.strictEqual(pdIn.to, STATES.PAST_DUE);
  const pdOut = transition(STATES.PAST_DUE, EVENTS.TICK, { now: iso(now), currentPeriodEnd: iso(now - 8 * DAY_MS), provider: 'stripe' });
  assert.strictEqual(pdOut.to, STATES.EXPIRED);
  assert.ok(pdOut.effects.includes(EFFECTS.DOWNGRADE_TO_FREE));
  // Reminders de dunning día 3 y 1.
  for (const d of [3, 1]) {
    const r = transition(STATES.PAST_DUE, EVENTS.TICK, { now: iso(now), currentPeriodEnd: iso(now - (7 - d) * DAY_MS), provider: 'stripe' });
    assert.strictEqual(r.to, STATES.PAST_DUE);
    assert.ok(r.effects.includes(EFFECTS.SEND_DUNNING_REMINDER), `reminder día ${d}`);
  }
  // Warns de trial día 3 y 1 (con banderas: ya avisado → silencio).
  const w3 = transition(STATES.TRIALING, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now + 3 * DAY_MS), provider: 'trial' });
  assert.ok(w3.effects.includes(EFFECTS.SEND_TRIAL_WARN_3D));
  const w3dup = transition(STATES.TRIALING, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now + 3 * DAY_MS), provider: 'trial', trialWarning3dSent: iso(now - DAY_MS) });
  assert.ok(!w3dup.effects.includes(EFFECTS.SEND_TRIAL_WARN_3D), 'warn 3d no se repite con bandera');
  const w1 = transition(STATES.TRIALING, EVENTS.TICK, { now: iso(now), trialEndsAt: iso(now + DAY_MS), provider: 'trial' });
  assert.ok(w1.effects.includes(EFFECTS.SEND_TRIAL_WARN_1D));
  console.log('✓ Fronteras de tiempo: trial 7d / gracia 3d / dunning 7d + avisos con banderas');
}

// §4 — computeStatus réplica la lectura legacy (unitario; el diferencial va en test-billing-properties.js).
{
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  // trialing vigente.
  let r = computeStatus({ status: 'trialing', plan: 'pro_monthly', provider: 'trial', trialEndsAt: iso(now + 2 * DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.status, 'trialing');
  assert.strictEqual(r.state, STATES.TRIALING);
  // trialing vencido hace 2 días (nunca pago) → legacy status 'expired' pero allowed + requiresPayment.
  r = computeStatus({ status: 'trialing', plan: 'pro_monthly', provider: 'trial', trialEndsAt: iso(now - 2 * DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.status, 'expired');
  assert.strictEqual(r.requiresPayment, true);
  assert.strictEqual(r.state, STATES.GRACE);
  // expired nunca pago día 20 → pausado legacy (trial_expirado).
  r = computeStatus({ status: 'expired', plan: 'pro_monthly', provider: 'trial', trialEndsAt: iso(now - 20 * DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 'expired');
  assert.strictEqual(r.reason, 'trial_expirado');
  assert.strictEqual(r.state, STATES.PAUSED);
  // expired degradado (alguna vez pago) → bloqueado sin gracia aunque trialEndsAt sea reciente.
  r = computeStatus({ status: 'expired', plan: 'free', provider: 'stripe', downgradedAt: iso(now - DAY_MS), trialEndsAt: iso(now - DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 'expired');
  assert.strictEqual(r.reason, 'suscripcion_inactiva');
  assert.strictEqual(r.state, STATES.EXPIRED);
  // active / past_due en y fuera de gracia.
  r = computeStatus({ status: 'active', plan: 'pro_monthly', currentPeriodEnd: iso(now + 30 * DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.status, 'active');
  assert.strictEqual(r.state, STATES.ACTIVE);
  r = computeStatus({ status: 'past_due', plan: 'pro_monthly', provider: 'stripe', currentPeriodEnd: iso(now) }, new Date(now));
  assert.strictEqual(r.allowed, true);
  assert.strictEqual(r.status, 'past_due');
  assert.strictEqual(r.inGracePeriod, true);
  assert.strictEqual(r.state, STATES.PAST_DUE);
  r = computeStatus({ status: 'past_due', plan: 'pro_monthly', provider: 'stripe', currentPeriodEnd: iso(now - 30 * DAY_MS) }, new Date(now));
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.status, 'past_due');
  // Bucket terminal → legacy 'canceled'.
  for (const sub of [{ status: 'canceled' }, { status: 'free', plan: 'free' }, {}, null]) {
    const b = computeStatus(sub, new Date(now));
    assert.strictEqual(b.allowed, false);
    assert.strictEqual(b.status, 'canceled');
    assert.strictEqual(b.state, STATES.FREE);
  }
  console.log('✓ computeStatus replica la lectura legacy en todos los estados');
}

// §5 — deriveState coherente con computeStatus.
{
  const now = new Date();
  const subs = [
    { status: 'active' },
    { status: 'trialing', trialEndsAt: new Date(Date.now() + DAY_MS).toISOString() },
    { status: 'trialing', trialEndsAt: new Date(Date.now() - 2 * DAY_MS).toISOString() },
    { status: 'trialing', trialEndsAt: new Date(Date.now() - 20 * DAY_MS).toISOString() },
    { status: 'past_due', currentPeriodEnd: new Date().toISOString() },
    { status: 'expired', provider: 'stripe', downgradedAt: new Date().toISOString() },
    { status: 'canceled' }
  ];
  for (const sub of subs) {
    assert.strictEqual(computeStatus(sub, now).state, deriveState(sub, now), `state coherente para ${sub.status}`);
  }
  console.log('✓ deriveState coherente con computeStatus.state');
}

assert.strictEqual(TRIAL_DAYS, 7, 'trial 7d como orchestrator.js:67');
assert.strictEqual(TRIAL_GRACE_DAYS, 3, 'gracia post-trial 3d como orchestrator.js:70');
assert.strictEqual(PAST_DUE_GRACE_DAYS, 7, 'gracia dunning 7d como orchestrator.js:71');

console.log('\n🎉 ¡MÁQUINA DE SUSCRIPCIÓN VERIFICADA: tabla total + invariantes en verde!\n');
