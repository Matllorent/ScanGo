/**
 * tests/test-churn-recovery.js
 * ────────────────────────────
 * Recupero de clientes (R1): detección de churn con data PROPIA de fidelización
 * + envío de email de reactivación por el dueño. Cero mocks: server HTTP real
 * + store local real (las mutaciones de data/* las aísla scripts/test-data-guard.js).
 *
 * Cubre:
 *  - Módulo puro churnRecovery: umbral contra la frecuencia propia (45d default),
 *    minVisits, lastVisitAt futura ignorada, clamp de días, orden por ausencia,
 *    privacy (teléfono enmascarado, email solo como dominio), flags hasEmail/
 *    consentBlocked, entrada malformada sin lanzar.
 *  - GET /api/loyalty/churn: 401 anónimo, 200 dueño con SOLO sus candidatos
 *    (cross-tenant afuera) y el umbral aplicado.
 *  - POST /api/loyalty/reactivation: 400 body inválido, 404 cliente ajeno,
 *    422 perfil sin email, 409 sin consentimiento de marketing, 409 opt-out
 *    (baja de email) y el envío feliz con email enmascarado en la respuesta.
 */
const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const loyaltyService = require('../api/services/loyalty');
const emailService = require('../api/services/email');
const { computeChurnCandidates, maskLocalPhone } = require('../api/utils/churnRecovery');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const DAY_MS = 24 * 60 * 60 * 1000;
const accountsFile = path.join(process.cwd(), 'data', 'loyalty_accounts.json');
const customersFile = path.join(process.cwd(), 'data', 'customer_profiles.json');

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

async function runTests() {
  console.log('🧪 Iniciando verificación de Recupero de Clientes (churn + reactivation)...');

  // ── 1) Módulo puro churnRecovery ──────────────────────────────────────────
  const NOW = Date.parse('2026-10-20T12:00:00.000Z');
  const mkAccount = (over = {}) => ({ id: 'acc_' + Math.random().toString(36).slice(2), customerId: 'cust_x', restaurantId: 'rA', visits: 2, points: 120, lastVisitAt: new Date(NOW - 50 * DAY_MS).toISOString(), ...over });
  const mkCustomer = (over = {}) => ({ id: 'cust_x', phone: '59899123456', name: 'Ana', email: 'ana@mail.com', consentMarketing: true, ...over });

  // Cliente activo (visitó hace 5 días) no es candidata.
  let report = computeChurnCandidates({
    accounts: [mkAccount({ lastVisitAt: new Date(NOW - 5 * DAY_MS).toISOString() })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.count, 0, ' cliente activo NO es candidato');
  assert.strictEqual(report.thresholdDays, 45, 'umbral default 45 días');

  // 50 días sin venir + 2 visitas → candidata, con métricas correctas.
  report = computeChurnCandidates({
    accounts: [mkAccount()], customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.count, 1, '50 días sin venir → candidata');
  const c = report.candidates[0];
  assert.strictEqual(c.phoneMasked, '598***56', 'teléfono enmascarado');
  assert.strictEqual(c.email, 'mail.com', 'email expuesto SOLO como dominio');
  assert.ok(!c.email.includes('@') && !c.email.includes('ana'), 'nunca el email crudo ni el usuario');
  assert.strictEqual(c.visits, 2);
  assert.strictEqual(c.daysSince, 50);
  assert.strictEqual(c.hasEmail, true);
  assert.strictEqual(c.consentBlocked, false);
  assert.strictEqual(c.name, 'Ana');

  // minVisits=1: una sola visita ya puede considerarse (configurable).
  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1, customerId: 'cust_y' })],
    customers: [mkCustomer({ id: 'cust_y', email: '' })],
    restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.count, 0, 'visits < minVisits default (2) → afuera');
  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1, customerId: 'cust_y' })],
    customers: [mkCustomer({ id: 'cust_y', email: 'b@mail.com' })],
    restaurantId: 'rA', nowMs: NOW, minVisits: 1
  });
  assert.strictEqual(report.count, 1, 'minVisits=1 abre la puerta');
  assert.strictEqual(report.candidates[0].hasEmail, true, 'email presente → enviable');
  report = computeChurnCandidates({
    accounts: [mkAccount({ visits: 1, customerId: 'cust_y' })],
    customers: [mkCustomer({ id: 'cust_y', email: '' })],
    restaurantId: 'rA', nowMs: NOW, minVisits: 1
  });
  assert.strictEqual(report.candidates[0].hasEmail, false, 'sin email → flag hasEmail false');

  // LastVisitAt futura (reloj mal seteado) NO crea candidatos.
  report = computeChurnCandidates({
    accounts: [mkAccount({ lastVisitAt: '2999-01-01T00:00:00.000Z' })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.count, 0, 'lastVisitAt futura ignorada');

  // Sin lastVisitAt (cuenta sin visita web) no flag fake.
  report = computeChurnCandidates({
    accounts: [mkAccount({ lastVisitAt: null })],
    customers: [mkCustomer()], restaurantId: 'rA', nowMs: NOW
  });
  assert.strictEqual(report.count, 0, 'ausencia de dato no inventa churn');

  // Clamp del umbral (7..365) y orden por mayor ausencia.
  report = computeChurnCandidates({
    accounts: [
      mkAccount({ id: 'a1', customerId: 'cust_a', lastVisitAt: new Date(NOW - 90 * DAY_MS).toISOString() }),
      mkAccount({ id: 'a2', customerId: 'cust_b', lastVisitAt: new Date(NOW - 60 * DAY_MS).toISOString() }),
      mkAccount({ id: 'a3', customerId: 'cust_c', restaurantId: 'rB', lastVisitAt: new Date(NOW - 200 * DAY_MS).toISOString() })
    ],
    customers: [mkCustomer({ id: 'cust_a' }), mkCustomer({ id: 'cust_b' }), mkCustomer({ id: 'cust_c' })],
    restaurantId: 'rA', nowMs: NOW, daysSinceLastVisit: 3
  });
  assert.strictEqual(report.thresholdDays, 7, 'clamp mínimo 7 días');
  assert.strictEqual(report.count, 2, 'condaysOverride=3→7: ambas rA son candidatas, rB afuera');
  assert.ok(report.candidates[0].daysSince >= report.candidates[1].daysSince, 'orden por ausencia descendente');

  report = computeChurnCandidates({ daysSinceLastVisit: 9999, accounts: [], customers: [] });
  assert.strictEqual(report.thresholdDays, 365, 'clamp máximo 365 días');
  assert.strictEqual(report.count, 0);

  // Entrada malformada no lanza.
  report = computeChurnCandidates({ accounts: null, customers: 'junk', restaurantId: 'x' });
  assert.strictEqual(report.count, 0, 'inputs basura → reporte vacío, no throw');

  // maskPhone local consistente.
  assert.strictEqual(maskLocalPhone('59899123456'), '598***56');
  console.log('✓ Módulo puro churnRecovery: umbral propio, privacy y bordes');

  // ── Setup runtime: dueño A con dos clientes (uno churn, uno fresco) ───────
  const stamp = Date.now();
  const customerDigits = '598' + String(stamp).slice(0, 3) + String(stamp).slice(-5); // E.164 limpio, único por corrida
  const customerMasked = customerDigits.slice(0, 3) + '***' + customerDigits.slice(-2);
  // Otro comensal (otra boca) para probar el aislamiento cross-tenant.
  const customerDigitsB = '598' + String(stamp + 1).slice(0, 3) + String(stamp + 1).slice(-5);
  const userA = await db.createUser({ email: `test-churn-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });
  const userB = await db.createUser({ email: `test-churn-b-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });

  const restA = await db.saveRestaurant(userA.id, {
    name: 'Churn Local A', bizName: 'Churn Local A',
    slug: `churn-a-${stamp}`, allowLoyaltyPoints: true, currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });
  const restB = await db.saveRestaurant(userB.id, {
    name: 'Churn Local B', bizName: 'Churn Local B',
    slug: `churn-b-${stamp}`, allowLoyaltyPoints: true, currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Burger', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const orderBody = (restaurantId, qty = 1, phone = customerDigits) => ({
    restaurantId, items: [{ dishId: 'dish1', quantity: qty }],
    customerName: 'Alice', customerPhone: '+' + phone, currency: 'USD'
  });

  try {
    // Dos pedidos reales para crear la cuenta con visits=2 (cliente churn) y
    // un pedido apenas para el local B (cross-tenant control).
    await postJson('/api/orders', orderBody(restA.id));
    await postJson('/api/orders', orderBody(restA.id));
    await postJson('/api/orders', orderBody(restB.id, 1, customerDigitsB));

    // Email del perfil (first-write público) para poder enviar el recupero.
    const emailRes = await postJson('/api/loyalty/email', { phone: customerDigits, email: `club-${stamp}@mail.com` });
    assert.strictEqual(emailRes.status, 200, 'email de perfil registrado');

    // Consentimiento de marketing: el default de privacidad es false. El dueño
    // solo puede recuperar a quien DIO su consentimiento (subimos el flag acá,
    // como lo haría el comensal aceptando promos).
    const customersPre = readJson(customersFile);
    const myCustomerPre = customersPre.find(cu => cu.phone === customerDigits);
    myCustomerPre.consentMarketing = true;
    writeJson(customersFile, customersPre);

    // Envejecer el lastVisitAt del local A: 50 días sin volver.
    const accounts = readJson(accountsFile);
    let aged = 0;
    for (const row of accounts) {
      if (row.restaurantId === restA.id) {
        row.lastVisitAt = new Date(Date.now() - 50 * DAY_MS).toISOString();
        if (row.last_visit_at !== undefined) row.last_visit_at = row.lastVisitAt;
        aged++;
      }
    }
    assert.ok(aged >= 1, 'cuenta del local A existe tras los pedidos');
    writeJson(accountsFile, accounts);

    // ── 2) GET /api/loyalty/churn ────────────────────────────────────────────
    const anon = await fetch(`${base}/api/loyalty/churn`);
    assert.strictEqual(anon.status, 401, 'churn sin sesión → 401');

    const churnRes = await fetch(`${base}/api/loyalty/churn`, { headers: authA });
    assert.strictEqual(churnRes.status, 200, 'dueño lista su churn');
    const churnBody = await churnRes.json();
    const report2 = churnBody.data;
    assert.strictEqual(report2.thresholdDays, 45);
    assert.strictEqual(report2.count, 1, 'exactamente UNA candidata (la del local A)');
    const candidate = report2.candidates[0];
    assert.ok(candidate.customerId, 'customerId presente para el envío');
    assert.strictEqual(candidate.phoneMasked, customerMasked, 'teléfono enmascarado');
    assert.strictEqual(candidate.email, 'mail.com', 'solo dominio');
    assert.strictEqual(candidate.daysSince, 50);
    assert.strictEqual(candidate.consentBlocked, false, 'consentimiento explícito registrado → candidato enviable');
    console.log('✓ GET /api/loyalty/churn: 401 anónimo + dueño con SOLO su candidata');

    // ── 3) POST /api/loyalty/reactivation: casos honestos ────────────────────
    const invalid = await postJson('/api/loyalty/reactivation', { customerId: '' }, authA);
    assert.strictEqual(invalid.status, 400, 'customerId faltante → 400');

    const foreign = await postJson('/api/loyalty/reactivation', { customerId: 'no-existe-nada' }, authA);
    assert.strictEqual(foreign.status, 404);
    assert.strictEqual((await foreign.json()).code, 'CUSTOMER_NOT_FOUND');

    // El comensal de B es OTRA persona: A no puede recuperar a nadie de B.
    // El comensal de B es OTRA persona: A no puede recuperar a nadie de B.
    const bAccounts = readJson(accountsFile).filter(r => r.restaurantId === restB.id);
    assert.ok(bAccounts.length >= 1, 'cuenta de B existe');
    const noEmailRes = await postJson('/api/loyalty/reactivation', { customerId: bAccounts[0].customerId }, authA);
    assert.strictEqual(noEmailRes.status, 404);
    assert.strictEqual((await noEmailRes.json()).code, 'CUSTOMER_NOT_FOUND', 'cuenta de B no es alcanzable desde A (IDOR)');

    // Sin email en el perfil PROPIO → 422 honesto.
    // Buscar una cuenta propia sin email: quito el email del customer A y reintento.
    const customers = readJson(customersFile);
    const myCustomer = customers.find(cu => cu.phone === customerDigits);
    const emailBackup = myCustomer.email;
    myCustomer.email = '';
    writeJson(customersFile, customers);
    const noEmail = await postJson('/api/loyalty/reactivation', { customerId: candidate.customerId }, authA);
    assert.strictEqual(noEmail.status, 422);
    assert.strictEqual((await noEmail.json()).code, 'NO_CUSTOMER_EMAIL', 'perfil sin email → 422 honesto');
    myCustomer.email = emailBackup;
    writeJson(customersFile, customers);

    // Consentimiento de marketing explícito falso → 409 (el email NO salió).
    myCustomer.consentMarketing = false;
    writeJson(customersFile, customers);
    const consent = await postJson('/api/loyalty/reactivation', { customerId: candidate.customerId }, authA);
    assert.strictEqual(consent.status, 409);
    assert.strictEqual((await consent.json()).code, 'MARKETING_CONSENT_MISSING');
    myCustomer.consentMarketing = true;
    writeJson(customersFile, customers);

    // Envío feliz: 200 con email enmascarado (antes del opt-out: isOptedOut
    // vive en memoria del servicio y no se puede revertir in-test).
    const targetEmail = `club-${stamp}@mail.com`;
    const ok = await postJson('/api/loyalty/reactivation', {
      customerId: candidate.customerId,
      message: 'Volvé y te regalamos un café',
      promoCode: 'VOLVE-TEST'
    }, authA);
    assert.strictEqual(ok.status, 200, `envío feliz 200 (llegó ${ok.status})`);
    const okBody = await ok.json();
    assert.strictEqual(okBody.data.sent, true);
    assert.ok(okBody.data.emailMasked.includes('*') && !okBody.data.emailMasked.includes(targetEmail), 'email enmascarado en la respuesta');

    // Opt-out de email (baja real vía unsubscribe) → 409 el dueño no insiste.
    emailService.markOptOut(targetEmail);
    const optout = await postJson('/api/loyalty/reactivation', { customerId: candidate.customerId }, authA);
    assert.strictEqual(optout.status, 409);
    assert.strictEqual((await optout.json()).code, 'CUSTOMER_OPTED_OUT');
    console.log('✓ POST /api/loyalty/reactivation: 400/404/422/409 honestos + envío feliz con email enmascarado');

    // ── 4) El dueño B NO ve al cliente de A en su churn ─────────────────────
    const tokenB = jwt.sign({ userId: userB.id }, JWT_SECRET, { expiresIn: '1h' });
    const churnB = await fetch(`${base}/api/loyalty/churn`, { headers: { Authorization: `Bearer ${tokenB}` } });
    assert.strictEqual(churnB.status, 200);
    const bodyB = (await churnB.json()).data;
    assert.strictEqual(bodyB.count, 0, 'el local fresco no tiene candidatos (cross-tenant intacto)');
    console.log('✓ Aislamiento cross-tenant: B no ve clientes de A');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Limpieza del opt-out del test (el Set en memoria muere con el proceso;
    // el archivo no debe dejar basura para la siguiente corrida).
    try {
      const optoutsFile = path.join(process.cwd(), 'data', 'email_optouts.json');
      const optouts = readJson(optoutsFile);
      writeJson(optoutsFile, optouts.filter(e => e !== targetEmail && e.email !== targetEmail));
    } catch (e) { /* nada que limpiar */ }
  }

  console.log('\n✓ Todos los asserts de Recupero de Clientes pasaron.');
}

if (require.main === module) {
  runTests().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runTests };
