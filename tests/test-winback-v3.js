/**
 * tests/test-winback-v3.js — F8-v3 "El cupón se puede revocar" (70ª suite).
 *
 * Lo que v2 dejó abierto (deliberate skips de la 61ª) y esta suite cierra:
 *  - El claim solo escribía el ledger LOCAL de la réplica: dos réplicas de
 *    Vercel podían reclamar el MISMO código en el mismo instante y ambas
 *    órdenes salían con descuento (race cross-réplica real).
 *  - La lectura del espejo cloud (mirrorCouponList) consultaba columnas
 *    INEXISTENTES (`response`/`created_at`; la tabla webhooks usa `data`/
 *    `received_at`), el error se tragaba con `return []` y la lectura
 *    cross-réplica estaba MUERTA en silencio (cazado preparando la 70ª).
 *  - El release podía deshacer un uso ya CONCRETO (pedido real en otra
 *    réplica): no había guard FINALIZED.
 *  - No existía revocación: un código fugado quedaba vivo hasta vencer.
 *
 * Migración 012 (la aplica el dueño en el SQL Editor): tres funciones
 * SECURITY DEFINER — claim_recovery_coupon / release_recovery_coupon /
 * revoke_recovery_coupon — con UPDATE condicional bajo row-lock: el perdedor
 * de la carrera ve 0 filas → re-clasifica → ALREADY_USED. Todas estampan
 * `stateAt` (versión de estado con la que el merge espejo↔local elige la fila
 * más nueva: una fila local STALE nunca tape una mutación de otra réplica).
 *
 * Cubre:
 *  §1 Módulo puro: veredicto REVOKED (la revocación del dueño GANA SIEMPRE,
 *     incluso si la fila trajera usedAt), copy propia, statusOfRecoveryCoupon
 *     (UNA derivación de estado para todo el panel: used > revoked >
 *     live/expired), summary con revokedCount, telemetría con couponsRevoked
 *     y purge que retira revocados (sin mutar la entrada).
 *  §2 Runtime real (server HTTP + store real): revocación E2E por API (401
 *     anónimo, cross-tenant 404 no enumerado, 200 del dueño con status
 *     revoked + revokedAt, panel con revokedCount, validate REVOKED, pedido
 *     con cupón revocado → 422 COUPON_REVOKED sin quemarlo, doble revoke 409,
 *     revoke de usado 409, revoke de vencido 422, audit WINBACK_REVOKED) y
 *     carrera de claims: dos POSTs simultáneos → exactamente [201, 409].
 *  §3 Probe cloud de la 012 (SKIP honesto si no está aplicada): claim RPC real
 *     con fila cloud (usedAt + stateAt), segundo claim ALREADY_USED por RPC,
 *     release contra un uso FINALIZADO que NO deshace y revoke RPC con
 *     revokedAt en la fila cloud.
 *  §4 Wiring: catálogo de auditoría, openapi.yaml (DELETE + revoked +
 *     revokedCount + couponsRevoked), export en window, botón del Studio con
 *     data-js-click y cero on*=.
 *
 * Cero mocks: server HTTP real + store real (JSON local + Supabase cuando hay
 * credenciales). Las mutaciones de data/* las aísla scripts/test-data-guard.js.
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

const app = require('../api/index');
const db = require('../src/db/db');
const auditService = require('../api/services/audit');
const loyaltyService = require('../api/services/loyalty');
const recoveryCoupons = require('../api/utils/recoveryCoupons');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const DAY_MS = 24 * 60 * 60 * 1000;
const ROOT = path.join(__dirname, '..');

async function runTests() {
  console.log('🧪 Iniciando verificación de F8-v3 (revocación + claim/release/revoke atómico RPC 012)...');

  // ─────────────────────────────────────────────────────────────────────────
  // §1 Módulo puro
  // ─────────────────────────────────────────────────────────────────────────
  const nowMs = Date.now(); // §1 se auto-consistente (expiresAt ± offsets); §2 usa el reloj real
  const atIso = new Date(nowMs).toISOString();
  const baseRow = {
    id: 'wbcp_p1', code: 'VOL-PURE0001', restaurantId: 'r1',
    source: 'winback', type: 'percent', value: 20, label: '20% OFF',
    boundPhone: '+59899123456',
    createdAt: new Date(nowMs - DAY_MS).toISOString(),
    expiresAt: new Date(nowMs + 13 * DAY_MS).toISOString(),
    usedAt: null, usedByPhone: null, usedOrderId: null
  };

  // REVOKED gana SIEMPRE: la revocación del dueño está ANTES del usedAt en el
  // orden de veredictos — un revocado no se canjea ni con la fila corrupta.
  assert.strictEqual(
    recoveryCoupons.isValidRecoveryCoupon({ ...baseRow, revokedAt: atIso }, { nowMs, phone: '+59899123456' }),
    'REVOKED', 'cupón revocado vivo → REVOKED'
  );
  assert.strictEqual(
    recoveryCoupons.isValidRecoveryCoupon(
      { ...baseRow, usedAt: atIso, revokedAt: atIso },
      { nowMs, phone: '+59899123456' }
    ),
    'REVOKED', 'la revocación del dueño GANA incluso sobre un usedAt (defensivo)'
  );
  assert.strictEqual(
    recoveryCoupons.isValidRecoveryCoupon(baseRow, { nowMs, phone: '+598 99 123 456' }),
    true, 'cupón vivo intacto sigue válido (la v3 no rompe v2)'
  );

  const copyRevoked = recoveryCoupons.RECOVERY_COUPON_REASON_COPY.REVOKED;
  assert.ok(typeof copyRevoked === 'string' && copyRevoked.includes('canceló'), 'copy REVOKED honesta');
  const desc = recoveryCoupons.describeRecoveryCoupon({ ...baseRow, revokedAt: atIso }, { nowMs, phone: '+59899123456' });
  assert.strictEqual(desc.valid, false, 'describe de revocado → inválido');
  assert.strictEqual(desc.reason, 'REVOKED', 'reason REVOKED');
  assert.strictEqual(desc.message, copyRevoked, 'el veredicto lleva la copy del motivo');

  // statusOfRecoveryCoupon — UNA derivación para TODO el panel (used > revoked > live/expired).
  const statusOf = (row) => recoveryCoupons.statusOfRecoveryCoupon(row, { nowMs });
  assert.strictEqual(statusOf(baseRow), 'live', 'vigente → live');
  assert.strictEqual(statusOf({ ...baseRow, usedAt: atIso }), 'used', 'usado → used');
  assert.strictEqual(statusOf({ ...baseRow, revokedAt: atIso }), 'revoked', 'revocado → revoked');
  assert.strictEqual(statusOf({ ...baseRow, usedAt: atIso, revokedAt: atIso }), 'used', 'used > revoked');
  assert.strictEqual(
    statusOf({ ...baseRow, revokedAt: atIso, expiresAt: new Date(nowMs - DAY_MS).toISOString() }),
    'revoked', 'un revocado VENCIDO sigue revoked (no se disfraza de vencido)'
  );
  assert.strictEqual(
    statusOf({ ...baseRow, expiresAt: new Date(nowMs - DAY_MS).toISOString() }),
    'expired', 'vencido → expired'
  );
  assert.strictEqual(statusOf(null), 'expired', 'fila ausente → expired (nunca viva por accidente)');
  assert.strictEqual(statusOf({ foo: 1 }), 'expired', 'fila sin code → expired');

  // Summary: revokedCount cuenta; el revocado NO es ni vigente ni vencido.
  const rowLive = { ...baseRow, id: 'wbcp_l', code: 'VOL-LIVE0001' };
  const rowUsed = { ...baseRow, id: 'wbcp_u', code: 'VOL-USED0001', usedAt: atIso, usedOrderId: 'ord_1' };
  const rowRevoked = { ...baseRow, id: 'wbcp_r', code: 'VOL-REVO0001', revokedAt: atIso };
  const rowExpired = { ...baseRow, id: 'wbcp_e', code: 'VOL-EXPI0001', expiresAt: new Date(nowMs - DAY_MS).toISOString() };
  const summary = recoveryCoupons.summarizeRecoveryCoupons([rowLive, rowUsed, rowRevoked, rowExpired], { nowMs });
  assert.strictEqual(summary.total, 4, 'summary.total');
  assert.strictEqual(summary.liveCount, 1, 'summary.liveCount');
  assert.strictEqual(summary.usedCount, 1, 'summary.usedCount');
  assert.strictEqual(summary.revokedCount, 1, 'summary.revokedCount (nuevo v3)');
  assert.strictEqual(summary.expiredCount, 1, 'el revocado NO suma a vencidos');

  // Telemetría: couponsRevoked presente; el revocado no suma uso ni ingreso.
  const telemetry = recoveryCoupons.computeWinbackTelemetry([rowLive, rowUsed, rowRevoked], {
    nowMs,
    windowDays: 30,
    orders: [{ id: 'ord_1', total: 9, status: 'delivered' }]
  });
  assert.strictEqual(telemetry.couponsIssued, 3, 'telemetry.couponsIssued');
  assert.strictEqual(telemetry.couponsUsed, 1, 'telemetry.couponsUsed');
  assert.strictEqual(telemetry.couponsRevoked, 1, 'telemetry.couponsRevoked (nuevo v3)');
  assert.strictEqual(telemetry.recoveredCount, 1, 'el revocado no suma recuperados');

  // Purge: revocados → RETIRED (no viven); keepUsed:0 los retira del ledger.
  const purgedKeep0 = recoveryCoupons.purgeRecoveryCoupons([rowLive, rowUsed, rowRevoked, rowExpired], { nowMs, keepUsed: 0, keepTotal: 100 });
  assert.deepStrictEqual(purgedKeep0.map((r) => r.id), [rowLive.id], 'purge retira usados/revocados/expirados (revoked es retired)');
  const purgedKeep = recoveryCoupons.purgeRecoveryCoupons([rowLive, rowUsed, rowRevoked], { nowMs, keepUsed: 2, keepTotal: 100 });
  assert.ok(purgedKeep.some((r) => r.id === rowRevoked.id), 'con keepUsed generoso el revocado queda auditable en el ledger');

  // Tope POR LOCAL: 500 cupones del local A jamás expulsan los del B (antes el
  // slice era global y el write del create BORRABA los cupones de los demás —
  // data-loss real de v2, cazado por esta suite).
  const otherRest = { ...rowLive, id: 'wbcp_o', code: 'VOL-OTHER01', restaurantId: 'r2', createdAt: new Date(nowMs - 2 * DAY_MS).toISOString() };
  const purgedCross = recoveryCoupons.purgeRecoveryCoupons([rowLive, otherRest, rowRevoked], { nowMs, keepUsed: 0, keepTotal: 1 });
  assert.deepStrictEqual(
    purgedCross.map((r) => r.id).sort(),
    [rowLive.id, otherRest.id],
    'el tope es POR LOCAL: sobrevive el vivo de A y el vivo de B (no solo el último global)'
  );

  // Pureza: ninguna función muta la entrada.
  const snapshot = JSON.stringify([rowLive, rowUsed, rowRevoked, rowExpired]);
  recoveryCoupons.statusOfRecoveryCoupon(rowRevoked, { nowMs });
  recoveryCoupons.summarizeRecoveryCoupons([rowLive, rowUsed, rowRevoked, rowExpired], { nowMs });
  recoveryCoupons.computeWinbackTelemetry([rowLive, rowUsed, rowRevoked], { nowMs, windowDays: 30, ordersById: new Map() });
  recoveryCoupons.purgeRecoveryCoupons([rowLive, rowRevoked], { nowMs, keepUsed: 0, keepTotal: 100 });
  assert.strictEqual(JSON.stringify([rowLive, rowUsed, rowRevoked, rowExpired]), snapshot, 'el módulo puro no muta la entrada');
  console.log('✓ §1 módulo puro: REVOKED gana siempre, statusOf unificada, contadores y purge honestos');

  // ─────────────────────────────────────────────────────────────────────────
  // §2 Setup runtime real
  // ─────────────────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const phoneA = '598' + String(stamp).slice(0, 3) + String(stamp).slice(-5);

  const userA = await db.createUser({ email: `test-wbv3-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `test-wbv3-b-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const restA = await db.saveRestaurant(userA.id, {
    name: 'Winback V3 Local', bizName: 'Winback V3 Local', slug: `wbv3-${stamp}`,
    currency: 'USD', allowLoyaltyPoints: true,
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }],
    deliveryZones: [{ name: 'Centro', fee: 3 }]
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Winback V3 Local B', bizName: 'Winback V3 Local B', slug: `wbv3-b-${stamp}`,
    currency: 'USD', categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const tokenB = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const authB = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenB}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });

  // Espera la fila espejo del cupón en CLOUD (el write es background): sin
  // espera, la RPC diría NOT_FOUND y el claim iría por el path local — válido,
  // pero la verificación real de la 012 exige que AMBOS vayan por RPC.
  async function waitCloudCoupon(couponId, { tries = 40 } = {}) {
    for (let i = 0; i < tries; i++) {
      const row = await fetchCloudCoupon(couponId);
      if (row) return row;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  }
  async function fetchCloudCoupon(couponId) {
    const { getSupabaseClient } = require('../api/utils/supabase');
    const supabase = getSupabaseClient();
    if (!supabase) return null;
    try {
      const { data } = await supabase
        .from('webhooks')
        .select('data')
        .eq('provider', 'winback_coupon')
        .eq('event_id', `wb_${couponId}`)
        .maybeSingle();
      return (data && data.data && data.data.coupon) || null;
    } catch (e) {
      return null;
    }
  }

  const couponLive = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 10,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  const couponExpired = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 15,
    nowMs: nowMs - 20 * DAY_MS, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  const couponUsed = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 10,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  const couponRace = await loyaltyService.createWinbackCoupon({
    restaurantId: restA.id, discountType: 'percent', discountValue: 10,
    nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
  });
  assert.ok(couponLive && couponExpired && couponUsed && couponRace, 'los 4 cupones se crearon en el ledger real');

  try {
    // ───────────────────────────────────────────────────────────────────────
    // §2a Revocación E2E por API
    // ───────────────────────────────────────────────────────────────────────
    const delJson = (code, headers) =>
      fetch(`${base}/api/loyalty/winback/coupons/${encodeURIComponent(code)}`, { method: 'DELETE', headers });

    const anonDelete = await delJson(couponLive.code);
    assert.strictEqual(anonDelete.status, 401, `revocación anónima → 401 (llegó ${anonDelete.status})`);

    const crossTenant = await delJson(couponLive.code, authB);
    assert.strictEqual(crossTenant.status, 404, `B revoca código de A → 404 no enumerado (llegó ${crossTenant.status})`);
    assert.strictEqual((await crossTenant.json()).code, 'COUPON_NOT_FOUND');

    const unknownDelete = await delJson('VOL-NOEXIST', authA);
    assert.strictEqual(unknownDelete.status, 404, `código inexistente → 404 (llegó ${unknownDelete.status})`);

    const revokeRes = await delJson(couponLive.code, authA);
    assert.strictEqual(revokeRes.status, 200, `el dueño revoca un cupón vivo → 200 (llegó ${revokeRes.status})`);
    const revokeData = (await revokeRes.json()).data;
    assert.strictEqual(revokeData.revoked, true, 'respuesta revoked:true');
    assert.strictEqual(revokeData.coupon.status, 'revoked', 'status derivado revoked');
    assert.ok(revokeData.coupon.revokedAt, 'la fila lleva revokedAt');

    // Panel: la fila revocada aparece con su estado y el summary lo cuenta.
    const panelRes = await fetch(`${base}/api/loyalty/winback/coupons`, { headers: authA });
    assert.strictEqual(panelRes.status, 200, 'GET /winback/coupons del dueño → 200');
    const panelData = (await panelRes.json()).data;
    const revokedRow = panelData.coupons.find((r) => r.code === couponLive.code);
    assert.ok(revokedRow, 'la fila revocada está en el panel');
    assert.strictEqual(revokedRow.status, 'revoked', 'el panel deriva status revoked');
    assert.ok(revokedRow.revokedAt, 'el panel expone revokedAt');
    assert.ok(!('boundPhone' in revokedRow) && !('usedByPhone' in revokedRow), 'el panel NUNCA expone teléfonos crudos');
    assert.ok(panelData.summary.revokedCount >= 1, 'summary.revokedCount ≥ 1');
    const panelText = JSON.stringify(panelData);
    assert.ok(!panelText.includes(phoneA), 'el panel no filtra el teléfono del cupón');

    // Validate público: el comensal ve el veredicto REVOKED con su copy.
    const validateRes = await postJson('/api/orders/coupon/validate', {
      restaurantId: restA.id, code: couponLive.code, phone: `+${phoneA}`, orderMode: 'LOCAL'
    });
    assert.strictEqual(validateRes.status, 200, 'validate público → 200');
    const validateData = (await validateRes.json()).data;
    assert.strictEqual(validateData.valid, false, 'validate de revocado → inválido');
    assert.strictEqual(validateData.reason, 'REVOKED', 'reason REVOKED');
    assert.strictEqual(validateData.message, copyRevoked, 'el comensal ve la copy honesta');

    // Pedido con cupón revocado → 422 COUPON_REVOKED; el cupón NO se quema
    // (el pre-verdict rechaza ANTES del claim: sigue revoked, no usado).
    const revokedOrder = await postJson('/api/orders', {
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: `+${phoneA}`, currency: 'USD',
      coupon: { code: couponLive.code }
    });
    assert.strictEqual(revokedOrder.status, 422, `pedido con cupón revocado → 422 (llegó ${revokedOrder.status})`);
    assert.strictEqual((await revokedOrder.json()).code, 'COUPON_REVOKED');
    const stillRevoked = (await loyaltyService.listRecoveryCoupons(restA.id)).find((r) => r.id === couponLive.id);
    assert.ok(stillRevoked.revokedAt && !stillRevoked.usedAt, 'el cupón sigue revocado (la revocación no se convirtió en uso)');

    // Doble revoke → 409 ALREADY_REVOKED.
    const doubleRevoke = await delJson(couponLive.code, authA);
    assert.strictEqual(doubleRevoke.status, 409, `doble revocación → 409 (llegó ${doubleRevoke.status})`);
    assert.strictEqual((await doubleRevoke.json()).code, 'COUPON_ALREADY_REVOKED');

    // Revoke de un cupón USADO → 409 ALREADY_USED (claim + finalize reales).
    await waitCloudCoupon(couponUsed.id);
    const claim = await loyaltyService.claimRecoveryCoupon({ restaurantId: restA.id, code: couponUsed.code, phone: `+${phoneA}` });
    assert.ok(!claim.reason, `claim de couponUsed OK (reason=${claim.reason})`);
    await loyaltyService.finalizeRecoveryClaim({ restaurantId: restA.id, code: couponUsed.code, orderId: 'ord_wbv3_used', phone: `+${phoneA}` });
    const revokeUsed = await delJson(couponUsed.code, authA);
    assert.strictEqual(revokeUsed.status, 409, `revoke de usado → 409 (llegó ${revokeUsed.status})`);
    assert.strictEqual((await revokeUsed.json()).code, 'COUPON_ALREADY_USED');

    // Revoke de un cupón VENCIDO → 422 COUPON_EXPIRED.
    const revokeExpired = await delJson(couponExpired.code, authA);
    assert.strictEqual(revokeExpired.status, 422, `revoke de vencido → 422 (llegó ${revokeExpired.status})`);
    assert.strictEqual((await revokeExpired.json()).code, 'COUPON_EXPIRED');

    // Auditoría WINBACK_REVOKED (fire-and-forget: poll corto).
    let revocations = [];
    for (let i = 0; i < 10; i++) {
      revocations = auditService.getAuditLogs(restA.id).filter((a) => a.action === 'WINBACK_REVOKED');
      if (revocations.length >= 1) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(revocations.length >= 1, 'audit WINBACK_REVOKED registrado');
    const auditEntry = revocations[revocations.length - 1];
    assert.strictEqual(auditEntry.tenant_id, restA.id, 'audit con tenantId');
    assert.ok(!JSON.stringify(auditEntry).includes(phoneA), 'audit SIN teléfono crudo (enmascarado)');
    console.log('✓ §2a revocación E2E: 401/404/200, panel con estado, validate REVOKED, pedido 422 sin quemar, 409/409/422, audit');

    // ───────────────────────────────────────────────────────────────────────
    // §2b Carrera de claims: dos POSTs SIMULTÁNEOS → exactamente [201, 409]
    // ───────────────────────────────────────────────────────────────────────
    await waitCloudCoupon(couponRace.id);
    const orderBody = () => ({
      restaurantId: restA.id,
      items: [{ dishId: 'dish1', quantity: 1 }],
      customerName: 'Alice', customerPhone: `+${phoneA}`, currency: 'USD',
      coupon: { code: couponRace.code }
    });
    const [res1, res2] = await Promise.all([
      postJson('/api/orders', orderBody()),
      postJson('/api/orders', orderBody())
    ]);
    const raceStatuses = [res1.status, res2.status].sort((a, b) => a - b);
    assert.deepStrictEqual(raceStatuses, [201, 409], `carrera → exactamente un 201 y un 409 (llegó ${raceStatuses.join(',')})`);
    const winner = res1.status === 201 ? res1 : res2;
    const winnerData = (await winner.json()).data;
    assert.strictEqual(winnerData.discount_amount, 1, 'el ganador lleva el descuento (10% × $10 = $1)');
    const loser = res1.status === 201 ? res2 : res1;
    assert.strictEqual((await loser.json()).code, 'COUPON_ALREADY_USED', 'el perdedor ve COUPON_ALREADY_USED');
    const raceRow = (await loyaltyService.listRecoveryCoupons(restA.id)).find((r) => r.id === couponRace.id);
    assert.ok(raceRow.usedAt, 'el cupón quedó usado UNA vez');
    assert.strictEqual(raceRow.usedByPhone, phoneA, 'atribuido al teléfono correcto');
    console.log('✓ §2b carrera de claims: [201, 409] exacto — el descuento se cobra UNA sola vez');

    // ───────────────────────────────────────────────────────────────────────
    // §3 Probe cloud de la 012 (SKIP honesto si la migración no está aplicada)
    // ───────────────────────────────────────────────────────────────────────
    const { getSupabaseClient } = require('../api/utils/supabase');
    const supabase = getSupabaseClient();
    let probeResult = null;
    if (!supabase) {
      console.log('⏭️ §3 SKIP: sin Supabase en el entorno (todo el runtime fue por el path local)');
    } else {
      // Detección honesta: la RPC con código fantasma. PGRST202 = 012 sin aplicar.
      const ghost = await supabase.rpc('claim_recovery_coupon', {
        p_restaurant_id: 'probe012-ghost',
        p_code: 'VOL-PROBE12',
        p_phone_digits: '',
        p_used_by_phone: null,
        p_now_iso: new Date().toISOString()
      });
      if (ghost.error) {
        console.log(`⏭️ §3 SKIP — migración 012 sin aplicar en cloud (${ghost.error.message}).`);
        console.log('   → Aplicar src/db/migrations/012_winback_coupon_claim_rpc.sql en el SQL Editor de Supabase.');
      } else {
        assert.ok(ghost.data && ghost.data.ok === false && ghost.data.reason === 'NOT_FOUND',
          'probe fantasma → NOT_FOUND (la RPC existe y decide)');
        probeResult = {};

        // Claim REAL por RPC: fila cloud con usedAt + stateAt.
        const couponCloud = await loyaltyService.createWinbackCoupon({
          restaurantId: restA.id, discountType: 'percent', discountValue: 10,
          nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
        });
        const cloudRow = await waitCloudCoupon(couponCloud.id);
        assert.ok(cloudRow, 'la fila espejo del cupón aterrizó en cloud');
        const claimC = await loyaltyService.claimRecoveryCoupon({ restaurantId: restA.id, code: couponCloud.code, phone: `+${phoneA}` });
        assert.strictEqual(claimC.mode, 'cloud', 'el claim fue POR RPC 012');
        assert.ok(!claimC.reason, `claim RPC OK (reason=${claimC.reason})`);
        assert.ok(claimC.row.usedAt, 'fila reclamada con usedAt');
        assert.ok(claimC.row.stateAt, 'fila reclamada con stateAt (versión de estado)');
        const cloudAfterClaim = await fetchCloudCoupon(couponCloud.id);
        assert.ok(cloudAfterClaim.usedAt, 'la fila CLOUD quedó con usedAt (decisión cross-réplica)');
        assert.ok(cloudAfterClaim.stateAt, 'la fila CLOUD quedó con stateAt');

        // Segundo claim → ALREADY_USED POR RPC (la fila ya no está vigente).
        const claimC2 = await loyaltyService.claimRecoveryCoupon({ restaurantId: restA.id, code: couponCloud.code, phone: `+${phoneA}` });
        assert.strictEqual(claimC2.mode, 'cloud', 'segundo claim por RPC');
        assert.strictEqual(claimC2.reason, 'ALREADY_USED', 'la RPC rechaza el doble uso cross-réplica');

        // Release sobre un uso FINALIZADO → NO deshace (v1 lo deshacía).
        await loyaltyService.finalizeRecoveryClaim({ restaurantId: restA.id, code: couponCloud.code, orderId: 'ord_probe12', phone: `+${phoneA}` });
        let markerCloud = null;
        for (let i = 0; i < 40; i++) {
          const { data } = await supabase
            .from('webhooks')
            .select('data')
            .eq('provider', 'winback_used')
            .eq('event_id', `wbu_${couponCloud.id}`)
            .maybeSingle();
          if (data && data.data) { markerCloud = data.data; break; }
          await new Promise((r) => setTimeout(r, 250));
        }
        assert.ok(markerCloud, 'el marcador wbu_ aterrizó en cloud antes del release');
        const releaseFin = await loyaltyService.releaseRecoveryClaim({ restaurantId: restA.id, code: couponCloud.code });
        assert.strictEqual(releaseFin.released, false, 'el release NO deshace un uso finalizado');
        assert.strictEqual(releaseFin.reason, 'FINALIZED', 'reason FINALIZED');
        const cloudAfterRelease = await fetchCloudCoupon(couponCloud.id);
        assert.ok(cloudAfterRelease.usedAt, 'la fila cloud SIGUE usada tras el release');

        // Revoke RPC: fila cloud con revokedAt (revocación cross-réplica real).
        const couponRev = await loyaltyService.createWinbackCoupon({
          restaurantId: restA.id, discountType: 'percent', discountValue: 10,
          nowMs, ttlDays: 14, randomSource: Math.random, boundPhone: phoneA
        });
        await waitCloudCoupon(couponRev.id);
        const revokeC = await loyaltyService.revokeRecoveryCoupon({ restaurantId: restA.id, code: couponRev.code });
        assert.strictEqual(revokeC.mode, 'cloud', 'revoke por RPC 012');
        assert.strictEqual(revokeC.revoked, true, 'revoke RPC OK');
        const cloudAfterRevoke = await fetchCloudCoupon(couponRev.id);
        assert.ok(cloudAfterRevoke.revokedAt, 'la fila CLOUD quedó con revokedAt');
        assert.ok(cloudAfterRevoke.stateAt, 'la fila CLOUD quedó con stateAt');

        probeResult.claimOk = true;
        console.log('✓ §3 probe cloud 012: claim/release/revoke POR RPC con fila cloud y stateAt');
      }
    }

    // ───────────────────────────────────────────────────────────────────────
    // §4 Wiring estático + contrato
    // ───────────────────────────────────────────────────────────────────────
    assert.strictEqual(auditService.AUDIT_ACTIONS.WINBACK_REVOKED, 'WINBACK_REVOKED', 'acción en el catálogo cerrado');

    const loyaltyManager = fs.readFileSync(path.join(ROOT, 'public', 'js', 'studio', 'loyaltyManager.js'), 'utf8');
    assert.ok(loyaltyManager.includes("revoked: 'Revocado'"), 'copy de estado revoked en el panel');
    assert.ok(loyaltyManager.includes('revokeWinbackCouponMod'), 'revocación cableada en loyaltyManager');
    assert.ok(loyaltyManager.includes("revokeWinbackCoupon|${c.code}") && loyaltyManager.includes("'data-js-click'"), 'botón 🚫 con binder CSP-safe (data-js-click por setAttribute)');
    assert.ok(loyaltyManager.includes('revokedCount'), 'summary con revocados');
    const revokeSection = loyaltyManager.slice(loyaltyManager.indexOf('function winbackEl'));
    assert.ok(!/\son[a-z]+\s*=/i.test(revokeSection), 'cero atributos on*= en el bloque de cupones');
    assert.ok(!revokeSection.includes('innerHTML'), 'el panel renderiza con DOM API');

    const studioJs = fs.readFileSync(path.join(ROOT, 'public', 'js', 'studio.js'), 'utf8');
    assert.ok(studioJs.includes('revokeWinbackCoupon as revokeWinbackCouponMod'), 'studio.js importa la revocación');
    assert.ok(/revokeWinbackCoupon[^\n]*globalExports/.test(studioJs) || studioJs.includes('revokeWinbackCoupon,'), 'exportado a window');
    assert.ok(studioJs.includes('showConfirmDialog)'), 'la revocación pasa por el diálogo propio (sin window.confirm)');

    const studioHtml = fs.readFileSync(path.join(ROOT, 'public', 'studio.html'), 'utf8');
    assert.ok(!/\son[a-z]+\s*=\s*"/i.test(studioHtml), 'cero on*= en todo el Studio');

    const spec = fs.readFileSync(path.join(ROOT, 'openapi.yaml'), 'utf8');
    assert.ok(spec.includes('/api/loyalty/winback/coupons/{code}:'), 'openapi documenta el DELETE de revocación');
    assert.ok(spec.includes('loyaltyWinbackCouponRevoke'), 'operationId del revoke');
    assert.ok(spec.includes('COUPON_ALREADY_REVOKED') && spec.includes('COUPON_REVOKED'), 'openapi documenta los errores nuevos');
    assert.ok(spec.includes('couponsRevoked') && spec.includes('revokedCount'), 'openapi documenta los contadores de v3');
    console.log('✓ §4 wiring (catálogo audit, Studio DOM API sin on*=, export window) + contrato openapi');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  console.log('🎉 F8-v3: el cupón se emite, se ve, se canjea UNA vez (cross-réplica) y el dueño lo puede revocar');
}

runTests().catch((err) => {
  console.error('❌ Error en test-winback-v3:', err);
  process.exit(1);
});
