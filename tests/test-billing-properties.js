const assert = require('assert');
const db = require('../src/db/db');
const billingOrchestrator = require('../src/billing/orchestrator');
const { computeStatus } = require('../src/billing/subscriptionMachine');
const { sanitizeUrl } = require('../api/utils/sanitizeRestaurant');

/**
 * Tests de propiedades del billing (monotonicidad, saneamiento, diferencial).
 *
 * Por qué PRNG propio y no fast-check:
 * `node_modules` está trackeado PARCIALMENTE en este repo (solo paquetes
 * críticos históricos con `git add -f`) y `package.json`/`package-lock.json`
 * + `node_modules/.package-lock.json` entran en el diff ante cualquier bump.
 * Agregar fast-check como dependencia tocaría el lockfile (churn) solo para
 * este test. En su lugar se implementa un mulberry32 con seed fija + un mini
 * runner de N casos: determinista (mismo seed ⇒ mismos casos), sin
 * dependencias nuevas, y suficiente para las tres propiedades de abajo.
 */
console.log('🧪 Propiedades de billing (PRNG mulberry32 determinista, sin dependencias nuevas)...');

const DAY_MS = 24 * 60 * 60 * 1000;
const SEED = 20261009;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    maybe: (p) => next() < p
  };
}

async function runTests() {
  // ── a) calculateMultiBranchPrice: ≥500 casos ──────────────────────────
  {
    const N = 600;
    const rng = makeRng(SEED);
    const tiers = [1, 0.8, 0.65, 0.5]; // factor por posición: 1ª, 2ª, 3ª, 4ª+
    const factor = (k) => (k <= 3 ? tiers[k - 1] : 0.5);
    for (let i = 0; i < N; i++) {
      const base = rng.int(100, 50000) / 100; // USD con 2 decimales
      const n = rng.int(1, 12);
      const T = (k) => billingOrchestrator.calculateMultiBranchPrice(base, k);
      // total(1) === base.
      assert.strictEqual(T(1), base, `caso ${i}: total(1)===base (base=${base})`);
      // Monótono en n (agregar sucursales nunca baja el total).
      for (let k = 1; k < n; k++) {
        assert.ok(T(k + 1) >= T(k), `caso ${i}: total(${k + 1}) >= total(${k})`);
      }
      // Nunca supera n veces el base (hay descuento o igualdad, nunca recargo).
      assert.ok(T(n) <= n * base + 1e-9, `caso ${i}: total(${n}) <= ${n}*base`);
      // Tiers exactos por marginal (tolerancia 1.1 cent por redondeo acumulado).
      for (let k = 1; k <= n; k++) {
        const expected = Math.round(base * factor(k) * 100) / 100;
        const got = k === 1 ? T(1) : Math.round((T(k) - T(k - 1)) * 100) / 100;
        assert.ok(Math.abs(got - expected) <= 0.011, `caso ${i}: marginal sucursal ${k} = ${got}, esperado ${expected}`);
      }
    }
    // Bordes inválidos (deterministas).
    assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice(0, 3), 0, 'base 0 → 0');
    assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice(-5, 3), 0, 'base negativa → 0');
    assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice('abc', 3), 0, 'base no numérica → 0');
    assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice(19, 0), 19, 'count 0 → mínimo 1');
    assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice(19, -4), 19, 'count negativo → mínimo 1');
    console.log(`✓ a) calculateMultiBranchPrice: ${N} casos (monótono, total(1)===base, ≤n·base, tiers 100/80/65/50%)`);
  }

  // ── b) sanitizeUrl: ≥500 strings hostiles ─────────────────────────────
  {
    const N = 600;
    const rng = makeRng(SEED + 1);
    const tokens = [
      'javascript:', 'JaVaScRiPt:', 'JAVASCRIPT:', 'data:', 'DATA:text/html,', 'vbscript:',
      'file:///etc/passwd', 'http://', 'https://', 'HTTP://evil.com/x', ' https://ok.com ',
      '//protocol.relative/x', '', '   ', '\njavascript:alert(1)', '\t data:,hi',
      'java\tscript:x', 'https:evil.com', 'http:evil', 'ftp://x.com/f', 'https://',
      'http://a b.com/', 'https://a.com/<script>alert(1)</script>', 'HtTpS://MiXeD.com/p',
      'https://', 'http://[::1]/x', 'https://a.com/#frag?q=1', 'mjavascript:x'
    ];
    const alpha = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/:.?&=#%_- ';
    for (let i = 0; i < N; i++) {
      const parts = rng.int(1, 4);
      let s = '';
      for (let p = 0; p < parts; p++) {
        s += rng.maybe(0.55) ? rng.pick(tokens) : alpha[rng.int(0, alpha.length - 1)];
      }
      // Ruido de casing/espacios para cazar chequeos case-sensitive.
      if (rng.maybe(0.3)) s = `  ${s}  `;
      const out = sanitizeUrl(s);
      assert.strictEqual(typeof out, 'string', `caso ${i}: siempre string`);
      assert.ok(out === '' || /^https?:\/\//i.test(out), `caso ${i}: salida '' o ^https?:// (in=${JSON.stringify(s)} out=${JSON.stringify(out)})`);
      const low = out.trim().toLowerCase();
      assert.ok(
        !low.startsWith('javascript:') && !low.startsWith('data:') && !low.startsWith('vbscript:'),
        `caso ${i}: nunca esquema peligroso (out=${JSON.stringify(out)})`
      );
    }
    // Fijos conocidos.
    assert.strictEqual(sanitizeUrl('javascript:alert(1)'), '', 'javascript: bloqueado');
    assert.strictEqual(sanitizeUrl('JaVaScRiPt:alert(1)'), '', 'casing no lo salta');
    assert.strictEqual(sanitizeUrl('data:text/html,<b>x</b>'), '', 'data: bloqueado');
    assert.strictEqual(sanitizeUrl('vbscript:msgbox(1)'), '', 'vbscript: bloqueado');
    assert.strictEqual(sanitizeUrl('//evil.com/x'), '', 'protocol-relative bloqueado');
    assert.strictEqual(sanitizeUrl('https://ok.com/menu'), 'https://ok.com/menu', 'https válido pasa');
    console.log(`✓ b) sanitizeUrl: ${N} casos hostiles (siempre '' o ^https?://, sin javascript:/data:/vbscript:)`);
  }

  // ── c) DIFERENCIAL máquina vs legacy: ≥500 fixtures en db ─────────────
  // Compara computeStatus(sub, now) contra billingOrchestrator.verifyAccess(id)
  // en `allowed` y `status`. `now` es el real en ambos (el aleatorio va en los
  // offsets de trialEndsAt/currentPeriodEnd, que es lo que mueve las ramas).
  // Limpieza: no se limpia a mano — el patrón del repo es mutar data/
  // libremente y `scripts/test-data-guard.js` restaura el snapshot de data/
  // al final de `npm test` (pase o falle).
  {
    const N = 500;
    const rng = makeRng(SEED + 2);
    const statuses = ['trialing', 'active', 'past_due', 'expired', 'canceled', 'free'];
    const plans = ['pro_monthly', 'pro_annual', 'starter_monthly', 'starter_annual', 'event_once', 'free'];
    const providers = ['trial', 'lemonsqueezy', 'stripe', 'mercadopago', 'dunning_cron', undefined];
    const t0 = Date.now();
    let mismatches = 0;
    const mismatchLog = [];
    // PENDIENTES (diferencial legacy): lista de casos con mismatch REAL que se
    // documentan aquí sin tocar el orchestrator — la máquina sigue al legacy.
    // (Vacía: la máquina replica al legacy en los 500 casos.)
    const pending = [];
    for (let i = 0; i < N; i++) {
      const status = rng.pick(statuses);
      const trialOffH = rng.int(-40 * 24, 40 * 24); // ±40 días en horas
      const periodOffH = rng.int(-40 * 24, 40 * 24);
      const sub = {
        status,
        plan: rng.pick(plans),
        provider: rng.pick(providers)
      };
      if (!rng.maybe(0.1)) sub.trialEndsAt = new Date(t0 + trialOffH * 3600 * 1000).toISOString();
      if (!rng.maybe(0.1)) sub.currentPeriodEnd = new Date(t0 + periodOffH * 3600 * 1000).toISOString();
      if (rng.maybe(0.25)) sub.downgradedAt = new Date(t0 - rng.int(1, 30) * DAY_MS).toISOString();
      if (rng.maybe(0.15)) sub.previousPlan = 'pro_monthly';

      const user = await db.createUser({ email: `propdiff_${SEED}_${i}@test.local`, password: 'x' });
      const rest = await db.saveRestaurant(user.id, {
        bizName: `PropDiff ${i}`,
        slug: `propdiff-${SEED}-${i}`,
        subscription: sub
      });
      const stored = db.findRestaurantById(rest.id);
      const now = new Date();
      const mine = computeStatus(stored.subscription, now);
      const legacy = billingOrchestrator.verifyAccess(rest.id);
      if (mine.allowed !== legacy.allowed || mine.status !== legacy.status) {
        mismatches++;
        if (mismatchLog.length < 10) {
          mismatchLog.push({ i, sub: stored.subscription, mine: { allowed: mine.allowed, status: mine.status }, legacy: { allowed: legacy.allowed, status: legacy.status } });
        }
      }
    }
    if (mismatchLog.length > 0) {
      console.error('MISMATCHES máquina vs legacy:', JSON.stringify(mismatchLog, null, 2));
    }
    // Documentar como pendientes en vez de tocar el orchestrator (ver `pending`).
    for (const m of mismatchLog) pending.push(m);
    assert.strictEqual(mismatches, 0, `diferencial: ${mismatches}/${N} mismatches (ver log; documentar en 'pending', no tocar orchestrator)`);
    console.log(`✓ c) Diferencial máquina vs legacy: ${N} fixtures, mismatches=0 (allowed+status idénticos)`);
  }

  console.log('\n🎉 ¡PROPIEDADES DE BILLING EN VERDE: precios + saneamiento + diferencial!\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
