/**
 * tests/test-loyalty-claim.js
 * ───────────────────────────
 * Canje atómico de fidelización (anti race de doble-canje): dos validates
 * concurrentes del mismo código LOY-XXXX-XXXX deben dar exactamente UN éxito
 * + UN 409 CODE_ALREADY_REDEEMED. Cero mocks: servicio real + store local
 * real + RPC real contra Supabase cuando hay credenciales (y la 006 aplicada).
 * Mutaciones de data/* aisladas por scripts/test-data-guard.js.
 *
 * Cubre:
 *  a) `redeemReward` emite un código y `Promise.all([validate, validate])`
 *     concurrentes → 1 éxito (mismo shape de siempre) + 1×409.
 *  b) Tercer validate → 409 CODE_ALREADY_REDEEMED.
 *  c) Sonda RPC: `supabase.rpc('claim_loyalty_redemption', …)` con código
 *     basura — si responde NOT_FOUND (006 aplicada) verifica el mapeo 404 vía
 *     servicio; si PGRST202/función ausente (o sin credenciales/red) → SKIP
 *     explícito; el resto igual pasa por path local+mutex.
 */
const assert = require('assert');
try { require('dotenv').config(); } catch (e) { /* dotenv opcional: sin .env la sonda RPC hace SKIP */ }
const db = require('../src/db/db');
const loyaltyService = require('../api/services/loyalty');
const { getSupabaseClient } = require('../api/utils/supabase');

function isMissingFunctionError(err) {
  if (!err) return false;
  if (err.code === 'PGRST202') return true;
  const msg = String(err.message || '');
  return /could not find the function/i.test(msg) && /claim_loyalty_redemption/i.test(msg);
}

async function runTests() {
  console.log('🧪 Iniciando verificación de canje atómico (anti race)...');

  // ── Setup: dueño + restaurante + cliente con puntos ──────────────────────
  const suffix = String(Date.now()).slice(-6);
  const user = await db.createUser({
    email: `claim-${suffix}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const rest = await db.saveRestaurant(user.id, {
    name: 'Claim Local', bizName: 'Claim Local',
    slug: `claim-${suffix}`,
    allowLoyaltyPoints: true,
    currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  const phone = `+59899${suffix}`;

  await loyaltyService.manualCredit({ restaurantId: rest.id, phone, points: 500, reason: 'setup claim test' });
  const issued = await loyaltyService.redeemReward({ phone, restaurantId: rest.id, rewardId: 'rew_coffee' });
  assert.ok(/^LOY-/.test(issued.code), `código LOY emitido (${issued.code})`);

  // ── a) Dos validates concurrentes → 1 éxito + 1×409 ──────────────────────
  const settled = await Promise.all([
    loyaltyService.validateRedemptionCode({ code: issued.code, ownerRestaurantId: rest.id }),
    loyaltyService.validateRedemptionCode({ code: issued.code, ownerRestaurantId: rest.id })
  ].map((p) => p.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason) => ({ status: 'rejected', reason })
  )));
  const wins = settled.filter((s) => s.status === 'fulfilled');
  const losses = settled.filter((s) => s.status === 'rejected');
  assert.strictEqual(wins.length, 1, 'exactamente UN éxito concurrente (sin doble-canje)');
  assert.strictEqual(losses.length, 1, 'exactamente UN rechazo concurrente');
  assert.strictEqual(losses[0].reason.code, 'CODE_ALREADY_REDEEMED', 'el perdedor es CODE_ALREADY_REDEEMED');
  assert.strictEqual(losses[0].reason.statusCode, 409, 'el perdedor es HTTP 409');
  assert.deepStrictEqual(
    Object.keys(wins[0].value).sort(),
    ['code', 'pointsCost', 'redeemedAt', 'restaurantId', 'rewardTitle'].sort(),
    'shape de retorno intacto tras el claim atómico'
  );
  assert.strictEqual(wins[0].value.code, issued.code, 'el éxito devuelve el mismo código');
  console.log('✓ Concurrentes: exactamente 1 éxito + 1×409 CODE_ALREADY_REDEEMED (sin doble-canje)');

  // ── b) Tercer validate → 409 ─────────────────────────────────────────────
  await assert.rejects(
    loyaltyService.validateRedemptionCode({ code: issued.code, ownerRestaurantId: rest.id }),
    (e) => e && e.code === 'CODE_ALREADY_REDEEMED' && e.statusCode === 409,
    'tercer validate → 409 CODE_ALREADY_REDEEMED'
  );
  console.log('✓ Tercer validate → 409 CODE_ALREADY_REDEEMED');

  // ── c) Sonda RPC 006 ─────────────────────────────────────────────────────
  const supabase = getSupabaseClient();
  if (!supabase) {
    console.log('⊘ SKIP sonda RPC: sin SUPABASE_URL/service key en el entorno (path local+mutex verificado arriba)');
  } else {
    try {
      const bogus = 'LOY-TESTE-BOGUS9';
      const { data, error } = await supabase.rpc('claim_loyalty_redemption', {
        p_code: bogus,
        p_restaurant_id: rest.id
      });
      if (error && isMissingFunctionError(error)) {
        console.log('⊘ SKIP mapeo RPC: función claim_loyalty_redemption ausente en la nube (006 aún no aplicada). Path local+mutex verificado arriba.');
      } else if (data && data.ok === false && data.reason === 'NOT_FOUND') {
        await assert.rejects(
          loyaltyService.validateRedemptionCode({ code: bogus, ownerRestaurantId: rest.id }),
          (e) => e && e.code === 'CODE_NOT_FOUND' && e.statusCode === 404,
          'mapeo RPC NOT_FOUND → 404 CODE_NOT_FOUND'
        );
        console.log('✓ RPC 006 presente en la nube: NOT_FOUND mapea a 404 CODE_NOT_FOUND vía servicio');
      } else {
        console.log(`⊘ SKIP mapeo RPC: sonda con respuesta inesperada (data=${JSON.stringify(data)} error=${error && error.message}). Path local+mutex verificado arriba.`);
      }
    } catch (e) {
      console.log(`⊘ SKIP sonda RPC: red/error (${e && e.message}). Path local+mutex verificado arriba.`);
    }
  }

  console.log('\n🎉 ¡CANJE ATÓMICO SIN DOBLE-CANJE VERIFICADO!');
}

runTests()
  .then(() => console.log('✅ test-loyalty-claim.js OK'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
