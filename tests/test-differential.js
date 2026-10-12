const assert = require('assert');

// Carga .env SOLO para el frente C (telemetría cloud): sigue el patrón de
// test-realtime-live-guard / test-group-cart-mozo. Sin credenciales, el
// diferencial SQL hace SKIP limpio y el resto del test corre igual.
require('dotenv').config();

const SEED = 20261013;

/**
 * Bloque 3 — Differential testing.
 *
 * Tres frentes, todos con PRNG seed fijo (reproducible, sin dependencias):
 *
 *   A) escapeHtml legacy (CommonJS public/js/utils/escapeHtml.js) vs el módulo
 *      browser (ESM public/js/utils/escapeHtmlBrowser.js). El frontend usa el
 *      browser; el legacy queda solo para test-escape-html.js. Diferencial:
 *      en el dominio compartido (strings, incl. '' y null/undefined) AMBOS
 *      producen exactamente la misma salida; la única divergencia legítima se
 *      documenta: falsy no-null (0/false/NaN) → legacy '' vs browser
 *      '0'/'false'/'NaN' (el legacy usa `if(!str)`, el browser null/undefined).
 *      Se fuzzean 600 strings con el alfabeto de meta-characters y se verifica
 *      que el doble escape aplicado por ambos es idéntico (misma divergencia
 *      acumulada), que la salida no contiene chars crudos peligrosos y que el
 *      escapado es punto fijo sobre texto plano.
 *
 *   B) Máquina de suscripción (src/billing/subscriptionMachine.js, pura sin
 *      db): 1.600 subs fuzzed + 3 barridos de reloj. Invariantes:
 *      - consistencia state ↔ allowed/status por estado;
 *      - determinismo (dos lecturas = misma salida);
 *      - monotonicidad del acceso: con el reloj avanzando, allowed pasa de
 *        true→false a lo sumo UNA vez y nunca vuelve (sin revención de
 *        trialing→grace→paused);
 *      - el estado nunca retrocede en el ciclo de vida.
 *      Complementa §c de test-billing-properties (que difunde contra
 *      verifyAccess con db) desde el lado puro de la transición temporal.
 *
 *   C) Telemetría: proyección countAnalytics vs re-conteo ingenuo de la misma
 *      fuente + re-lectura SQL independiente (canal directo, sin la proyección
 *      del servicio). Cloud-only para la parte SQL (SKIP limpio sin
 *      credenciales); el resto corre siempre contra el espejo local/in-memory.
 *      Usa un restaurantId throwaway y DELETE best-effort al final.
 *
 * No toca data/*.json ni fixtures del dueño: todo es throwaway.
 */

console.log('🧪 Differential: escapeHtml legacy↔browser, máquina de suscripción, telemetría...');

function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    maybe(p) { return this.next() < p; }
  };
}

// ── A) escapeHtml: legacy vs browser ────────────────────────────────────────
const legacyEscape = require('../public/js/utils/escapeHtml.js').escapeHtml;

const METACHARS = ['&', '<', '>', '"', "'", 'a', 'Z', '1', ' ', 'ñ', 'é', '&amp;', '&lt;', '&gt;', '&quot;', '&#039;', '<script>', '<!--', '=>'];

function randomString(rng) {
  const len = rng.int(0, 24);
  let out = '';
  for (let i = 0; i < len; i++) out += rng.pick(METACHARS);
  return out;
}

function assertEscapeSafety(escaped) {
  // La salida NUNCA contiene chars crudos peligrosos: < > " ' quedan como entidades.
  for (const raw of ['<', '>', '"', "'"]) {
    assert.ok(!escaped.includes(raw), `salida no contiene ${JSON.stringify(raw)}: ${JSON.stringify(escaped)}`);
  }
}

function escapeDifferential() {
  // Dominio compartido: strings (vacías incluidas) → salida idéntica.
  {
    const rng = makeRng(SEED);
    for (let i = 0; i < 600; i++) {
      const s = randomString(rng);
      const a = legacyEscape(s);
      const b = browserEscape(s);
      // En strings la divergencia no existe: ambas normalizan por String().
      assert.strictEqual(a, b, `fuzz ${i}: igual salida para ${JSON.stringify(s)}`);
      assertEscapeSafety(a);
      assert.strictEqual(typeof a, 'string', `fuzz ${i}: siempre string`);
    }
    // Strings vacías: ambas → ''.
    assert.strictEqual(legacyEscape(''), browserEscape(''));
    // Null/undefined: ambas → ''.
    assert.strictEqual(legacyEscape(null), '');
    assert.strictEqual(browserEscape(null), '');
    assert.strictEqual(legacyEscape(undefined), '');
    assert.strictEqual(browserEscape(undefined), '');
  }

  // Divergencia DOCUMENTADA (falsy no-null): legacy `if(!str)` vs browser null/undefined.
  {
    assert.strictEqual(legacyEscape(0), '', 'legacy: 0 → ""');
    assert.strictEqual(browserEscape(0), '0', 'browser: 0 → "0" (String)');
    assert.strictEqual(legacyEscape(false), '', 'legacy: false → ""');
    assert.strictEqual(browserEscape(false), 'false', 'browser: false → "false"');
    assert.strictEqual(legacyEscape(NaN), '', 'legacy: NaN → ""');
    assert.strictEqual(browserEscape(NaN), 'NaN', 'browser: NaN → "NaN"');
  }

  // Punto fijo sobre texto plano y mapa de entidades canónico.
  {
    assert.strictEqual(legacyEscape('Hola mundo 123'), 'Hola mundo 123');
    assert.strictEqual(browserEscape('Hola mundo 123'), 'Hola mundo 123');
    assert.strictEqual(browserEscape('&'), '&amp;');
    assert.strictEqual(browserEscape('<'), '&lt;');
    assert.strictEqual(browserEscape('>'), '&gt;');
    assert.strictEqual(browserEscape('"'), '&quot;');
    assert.strictEqual(browserEscape("'"), '&#039;');
    assert.strictEqual(browserEscape('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  }

  // Doble aplicación: ambos coinciden entre sí (doble escape idéntico), aun
  // cuando re-escapar entidades no es punto fijo — la divergencia de los
  // falsy no-null solo puede aparecer en la PRIMERA aplicación.
  {
    const rng = makeRng(SEED + 1);
    for (let i = 0; i < 300; i++) {
      const s = randomString(rng);
      assert.strictEqual(legacyEscape(legacyEscape(s)), browserEscape(browserEscape(s)), `doble fuzz ${i}`);
    }
  }

  console.log('✓ escapeHtml: 600 fuzz strings + 300 doble-aplicación, divergencia 0/false/NaN documentada, salida sin chars crudos');
}

// ── B) Máquina de suscripción: invariantes + monotonicidad ──────────────────
const { STATES, deriveState, computeStatus } = require('../src/billing/subscriptionMachine.js');

const DAY_MS = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();
const BASE = Date.UTC(2026, 9, 12, 12); // lun 12 oct 2026, mediodía UTC

function randomSub(rng) {
  const status = rng.pick(['active', 'trialing', 'expired', 'past_due', 'canceled', 'free', '']);
  const sub = { status };
  if (rng.maybe(0.7)) sub.trialEndsAt = iso(BASE + rng.int(-3, 15) * DAY_MS + rng.int(0, 3600e3));
  if (rng.maybe(0.7)) sub.currentPeriodEnd = iso(BASE + rng.int(-1, 20) * DAY_MS);
  if (rng.maybe(0.6)) sub.provider = rng.pick(['trial', 'stripe', 'lemonsqueezy', 'mercadopago', '']);
  if (rng.maybe(0.4)) sub.downgradedAt = iso(BASE + rng.int(-30, 0) * DAY_MS);
  if (rng.maybe(0.4)) sub.plan = rng.pick(['starter_monthly', 'pro_monthly', 'pro_annual']);
  return sub;
}

function assertSubInvariants(sub, now) {
  const r = computeStatus(sub, now);
  // Determinismo: dos lecturas con el mismo reloj = misma salida.
  assert.deepStrictEqual(computeStatus(sub, now), r, 'determinismo');

  // Consistencia con la derivación de estado pura (mismo reloj, mismo sub).
  assert.strictEqual(r.state, deriveState(sub, now), `state=${r.state}`);

  assert.strictEqual(typeof r.allowed, 'boolean', 'allowed es boolean');
  if (r.state === STATES.ACTIVE) {
    assert.strictEqual(r.status, 'active');
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.inGracePeriod, false);
  } else if (r.state === STATES.TRIALING) {
    assert.strictEqual(r.status, 'trialing');
    assert.strictEqual(r.allowed, true);
    assert.ok(r.daysLeft >= 0, `daysLeft>=0 (${r.daysLeft})`);
    assert.strictEqual(r.inGracePeriod, false);
  } else if (r.state === STATES.GRACE) {
    assert.strictEqual(r.allowed, true, 'grace → allowed');
    assert.strictEqual(r.requiresPayment, true, 'grace → requiere pago');
    assert.strictEqual(r.status, 'expired');
    assert.strictEqual(r.inGracePeriod, true);
  } else if (r.state === STATES.PAUSED) {
    assert.strictEqual(r.allowed, false, 'paused → bloqueado');
    assert.strictEqual(r.status, 'expired');
  } else if (r.state === STATES.PAST_DUE) {
    assert.strictEqual(r.allowed, r.inGracePeriod, 'past_due → allowed === en gracia');
    assert.ok(r.gracePeriodDaysRemaining >= 0, `gracePeriodDaysRemaining>=0 (${r.gracePeriodDaysRemaining})`);
  } else if (r.state === STATES.EXPIRED) {
    assert.strictEqual(r.allowed, false, 'expired → bloqueado');
  } else if (r.state === STATES.FREE) {
    assert.strictEqual(r.allowed, false, 'free/canceled → bloqueado');
    assert.strictEqual(r.status, 'canceled');
  } else {
    assert.fail(`estado desconocido ${r.state}`);
  }
}

function subscriptionDifferential() {
  // 1.600 subs fuzzed × un reloj aleatorio razonable.
  {
    const rng = makeRng(SEED + 1000);
    for (let i = 0; i < 1600; i++) {
      const sub = randomSub(rng);
      const now = new Date(BASE + rng.int(-5, 25) * DAY_MS);
      assertSubInvariants(sub, now);
    }
  }

  // Malformados: nunca lanza, allowed siempre boolean, estado siempre conocido.
  {
    const rng = makeRng(SEED + 2000);
    const garbage = [null, undefined, 'x', 42, [], { status: 7 }, { status: 'trialing', trialEndsAt: 'no-es-fecha' }, { status: 'past_due', currentPeriodEnd: 'aaaa' }];
    for (let i = 0; i < 400; i++) {
      const sub = rng.maybe(0.6) ? garbage[rng.int(0, garbage.length - 1)] : { status: rng.pick(['active', 'trialing', 'expired', 'past_due', 'zzz']) };
      const now = new Date(rng.int(0, 1) === 0 ? BASE : BASE + 40 * DAY_MS);
      const r = computeStatus(sub, now);
      assert.strictEqual(typeof r.allowed, 'boolean');
      assert.ok(Object.values(STATES).includes(r.state), `estado conocido (${r.state})`);
    }
  }

  // Barridos de reloj: monotonía del acceso y del ciclo de vida.
  const sweep = (sub, fromMs, toMs, stepMs, label) => {
    let sawFalse = false;
    let flips = 0;
    const seen = [];
    for (let t = fromMs; t <= toMs; t += stepMs) {
      const r = computeStatus(sub, new Date(t));
      seen.push(r.state);
      if (r.allowed && sawFalse) assert.fail(`${label} t=${t}: allowed volvió a true después de false`);
      if (!r.allowed && !sawFalse) { sawFalse = true; flips++; }
      // El ciclo de vida no retrocede: TRIALING < GRACE < PAUSED (mismos sub).
      for (let i = 1; i < seen.length; i++) {
        const a = seen[i - 1], b = seen[i];
        const order = [STATES.TRIALING, STATES.GRACE, STATES.PAUSED, STATES.EXPIRED, STATES.FREE];
        if (order.includes(a) && order.includes(b)) {
          assert.ok(order.indexOf(b) >= order.indexOf(a), `${label}: ${a} → ${b} no retrocede`);
        }
      }
    }
    return flips;
  };

  // 1) Trial nunca pago: trialing → grace (días 8-10) → paused. Un solo flip.
  {
    const sub = { status: 'trialing', trialEndsAt: iso(BASE), provider: 'trial' };
    const flips = sweep(sub, BASE - DAY_MS, BASE + 20 * DAY_MS, 6 * 3600e3, 'trial-nunca-pago');
    assert.strictEqual(flips, 1, `trial nunca pago: allowed flipea una sola vez true→false (${flips})`);
    const r = computeStatus(sub, new Date(BASE + 2 * DAY_MS));
    assert.strictEqual(r.state, STATES.GRACE, 'día 9 → grace');
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.requiresPayment, true);
    assert.strictEqual(computeStatus(sub, new Date(BASE + 11 * DAY_MS)).state, STATES.PAUSED, 'día 11 → paused');
  }

  // 2) past_due: gracia 7 días desde currentPeriodEnd; un solo flip.
  {
    const sub = { status: 'past_due', currentPeriodEnd: iso(BASE), plan: 'pro_monthly' };
    const flips = sweep(sub, BASE - DAY_MS, BASE + 20 * DAY_MS, 6 * 3600e3, 'past-due');
    assert.strictEqual(flips, 1, `past_due: un solo flip (${flips})`);
    assert.strictEqual(computeStatus(sub, new Date(BASE + 3 * DAY_MS)).allowed, true, 'en gracia → allowed');
    assert.strictEqual(computeStatus(sub, new Date(BASE + 10 * DAY_MS)).allowed, false, 'gracia vencida → bloqueado');
  }

  // 3) Pagó alguna vez y luego expired: jamás gana gracia post-trial.
  {
    const sub = { status: 'expired', trialEndsAt: iso(BASE), downgradedAt: iso(BASE - 20 * DAY_MS), provider: 'stripe' };
    const r = computeStatus(sub, new Date(BASE));
    assert.strictEqual(r.state, STATES.EXPIRED, 'pagó antes → expired, sin gracia');
    assert.strictEqual(r.allowed, false);
  }

  // 4) active: siempra allowed, nunca gracia.
  {
    const r = computeStatus({ status: 'active', plan: 'pro_monthly' }, new Date(BASE));
    assert.strictEqual(r.state, STATES.ACTIVE);
    assert.strictEqual(r.allowed, true);
  }

  // 5) Nunca vuelve a trialing tras haber entrado en grace/paused.
  {
    const sub = { status: 'trialing', trialEndsAt: iso(BASE), provider: 'trial' };
    for (let t = BASE + DAY_MS; t <= BASE + 20 * DAY_MS; t += DAY_MS) {
      assert.notStrictEqual(computeStatus(sub, new Date(t)).state, STATES.TRIALING, `t=${new Date(t).toISOString()} no reintroduce trialing`);
    }
  }

  console.log('✓ Máquina de suscripción: 1.600 fuzz + 400 malformados, 5 barridos de reloj — monotonía, determinismo, sin revención');
}

// ── C) Telemetría: proyección vs re-conteo ingenuo + SQL independiente ──────
const telemetry = require('../api/services/telemetry');
const { getSupabaseClient } = require('../api/utils/supabase');

// Espejo del mapeo (re-declarado a propósito: es el "oráculo" del test, no el
// mismo objeto del servicio — si el servicio cambia el mapeo, este test falla).
const LEGACY = {
  visits: ['visit', 'qr_scan', 'event_qr_scan'],
  orders: ['order', 'order_placed', 'event_order_placed'],
  reservations: ['reservation'],
  waiterCalls: ['waiter', 'waiter_call']
};
const KNOWN_TYPES = Object.values(LEGACY).flat();

function naiveCount(rows) {
  const c = { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 };
  for (const row of rows) {
    for (const [k, types] of Object.entries(LEGACY)) {
      if (types.includes(row.event_type)) c[k]++;
    }
  }
  return c;
}

async function telemetryDifferential() {
  const rng = makeRng(SEED + 3000);
  const id = `diff_${Date.now()}_${rng.int(10000, 99999)}`;
  const pool = [...KNOWN_TYPES, 'dish_click', 'event_dish_click', 'bogus_type', 'qr_scan'];

  // Inserta 60 eventos mixtos (mapedos y no mapeados) con recordEventSync.
  const expected = { visits: 0, orders: 0, reservations: 0, waiterCalls: 0 };
  for (let i = 0; i < 60; i++) {
    const type = rng.pick(pool);
    await telemetry.recordEventSync({ restaurantId: id, eventType: type, dishId: type === 'dish_click' ? 'd-1' : null, metadata: { amount: type.includes('order') ? rng.int(100, 50000) : undefined } });
    for (const [k, types] of Object.entries(LEGACY)) {
      if (types.includes(type)) expected[k]++;
    }
  }

  // 1) Proyección del servicio vs re-conteo ingenuo de la misma fuente.
  const counters = await telemetry.countAnalytics(id);
  const { lastUpdated, ...projection } = counters;
  assert.ok(typeof lastUpdated === 'string' && !Number.isNaN(Date.parse(lastUpdated)), 'lastUpdated ISO');
  assert.deepStrictEqual(projection, expected, 'countAnalytics == re-conteo ingenuo');

  // 2) Re-lectura SQL independiente (canal directo, sin la proyección del servicio).
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log('✓ Telemetría (local): 60 eventos mixtos, proyección == re-conteo ingenuo');
    console.log('  (skipped SQL diferencial: sin credenciales Supabase)');
    return;
  }
  const { data, error } = await supabase.from('telemetry_events').select('event_type').eq('restaurant_id', id);
  assert.ok(!error, `SQL read falló: ${error && error.message}`);
  assert.strictEqual(data.length, 60, `SQL trae los 60 eventos (${data.length})`);
  assert.deepStrictEqual(naiveCount(data), expected, 'SQL directo == proyección del servicio');

  // Cleanup best-effort (nunca rompe el test).
  try {
    await supabase.from('telemetry_events').delete().eq('restaurant_id', id);
  } catch (e) {
    console.log(`  (warn: cleanup best-effort falló: ${e.message})`);
  }
  console.log('✓ Telemetría: 60 eventos mixtos cloud, proyección == re-conteo ingenuo == SQL directo');
}

async function run() {
  const browserMod = await import('../public/js/utils/escapeHtmlBrowser.js');
  global.browserEscape = browserMod.escapeHtml;

  escapeDifferential();
  subscriptionDifferential();
  await telemetryDifferential();

  console.log('\n🎉 ¡DIFERENCIAL EN VERDE: escapeHtml, máquina de suscripción y telemetría sin divergencias ocultas!\n');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});