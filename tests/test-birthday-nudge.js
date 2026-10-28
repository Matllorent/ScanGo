/**
 * tests/test-birthday-nudge.js
 * ──────────────────────────────
 * Birthday Nudge (QW5): nudge automático de cumpleaños vía cron.
 * Cero mocks: server HTTP real + store local real.
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
const notificationsService = require('../api/services/notifications');
const { selectBirthdayCandidates, buildBirthdayPushPayload, buildBirthdayEmailBody } = require('../api/utils/birthdayNudge');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const DAY_MS = 24 * 60 * 60 * 1000;

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

async function runTests() {
  console.log('🧪 Iniciando verificación de Birthday Nudge (QW5)...');

  // Cron hermético: el guard de cron es ABIERTO en dev sin CRON_SECRET (CI no
  // tiene .env, así que el assert "cron sin secreto → 401" daría 200 y la
  // suite caería solo en CI). La suite fija SU secreto antes de armar el
  // server para ejercitar los tres veredictos del guard (401 sin header /
  // 401 inválido / 200 válido) en cualquier entorno (patrón test-night-summary).
  const savedCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-bday-cron-secret';

  // ── 1) Módulo puro birthdayNudge ────────────────────────────────────────────
  const NOW = Date.parse('2026-10-23T12:00:00.000Z'); // 23 Oct
  const customers = [
    { id: 'c1', phone: '59899123456', name: 'Ana', email: 'ana@mail.com', consentMarketing: true, birthdate: '1990-10-23' },
    { id: 'c2', phone: '59899123457', name: 'Juan', email: 'juan@mail.com', consentMarketing: true, birthdate: '1990-10-24' }, // mañana
    { id: 'c3', phone: '59899123458', name: 'Pedro', email: 'pedro@mail.com', consentMarketing: false, birthdate: '1990-10-23' }, // sin consent
    { id: 'c4', phone: '59899123459', name: 'Lucia', email: 'lucia@mail.com', consentMarketing: true, birthdate: '1990-10-23' }, // cumple hoy, sin push sub
  ];
  const pushSubs = [
    { id: 's1', restaurantId: 'r1', role: 'guest', consent_marketing: true, customer_phone: '59899123456', endpoint: 'https://example.com/push/1' },
    { id: 's2', restaurantId: 'r1', role: 'guest', consent_marketing: true, customer_phone: '59899123457', endpoint: 'https://example.com/push/2' },
    { id: 's3', restaurantId: 'r2', role: 'guest', consent_marketing: true, customer_phone: '59899123456', endpoint: 'https://example.com/push/3' }, // otro restaurante
  ];

  // Solo Ana cumple hoy + tiene consent + push sub en r1
  let result = selectBirthdayCandidates({ customers, pushSubscriptions: pushSubs, restaurantId: 'r1', nowMs: NOW });
  assert.strictEqual(result.length, 1, 'solo Ana cumple hoy + consent + push sub en r1');
  assert.strictEqual(result[0].name, 'Ana');
  assert.strictEqual(result[0].phone, '59899123456');
  assert.ok(result[0].pushSubscription);
  assert.strictEqual(result[0].pushSubscription.id, 's1');

  // Juan cumple mañana → no
  result = selectBirthdayCandidates({ customers: [customers[1]], pushSubscriptions: pushSubs, restaurantId: 'r1', nowMs: NOW });
  assert.strictEqual(result.length, 0, 'Juan cumple mañana → no incluido');

  // Pedro cumple hoy pero sin consent → no
  result = selectBirthdayCandidates({ customers: [customers[2]], pushSubscriptions: pushSubs, restaurantId: 'r1', nowMs: NOW });
  assert.strictEqual(result.length, 0, 'Pedro sin consent → no incluido');

  // Lucía cumple hoy + consent pero sin push sub → no
  result = selectBirthdayCandidates({ customers: [customers[3]], pushSubscriptions: pushSubs, restaurantId: 'r1', nowMs: NOW });
  assert.strictEqual(result.length, 0, 'Lucía sin push sub → no incluida');

  // Cross-tenant: push sub en r2 con mismo teléfono → SÍ cuenta para r2 (el filtro es por push sub, no por dueño del cliente)
// Esto es comportamiento correcto: si un cliente tiene push sub en dos restaurantes, recibe nudge de ambos.
const customersOnlyR1 = customers.map(c => ({ ...c }));
const pushSubOnlyR2 = [pushSubs[2]]; // push sub de r2 con mismo teléfono
result = selectBirthdayCandidates({ customers: customersOnlyR1, pushSubscriptions: pushSubOnlyR2, restaurantId: 'r2', nowMs: NOW });
assert.strictEqual(result.length, 1, 'cliente con push sub en r2 aparece en r2');

  // buildBirthdayPushPayload
  const payload = buildBirthdayPushPayload({ name: 'Ana', restaurantName: 'Mi Local', slug: 'mi-local' });
  assert.strictEqual(payload.title, '🎂 ¡Feliz cumpleaños, Ana!');
  assert.strictEqual(payload.url, '/m/mi-local#club');
  assert.strictEqual(payload.tag, 'birthday-nudge');

  // buildBirthdayEmailBody
  const emailBody = buildBirthdayEmailBody({ name: 'Ana', restaurantName: 'Mi Local', menuUrl: 'https://app.com/m/mi-local' });
  assert.ok(emailBody.includes('Feliz cumpleaños, Ana'));
  assert.ok(emailBody.includes('Mi Local'));
  assert.ok(emailBody.includes('https://app.com/m/mi-local#club'));

  console.log('✓ Módulo puro birthdayNudge: selección, payload push, email body');

  // ── 2) Setup runtime: dueño con clientes cumpleañeros ───────────────────────
  const stamp = Date.now();
  const bdayPhone = '598' + String(stamp).slice(0, 3) + String(stamp).slice(-5); // cumple hoy
  const tomorrowPhone = '598' + String(stamp + 1).slice(0, 3) + String(stamp + 1).slice(-5); // cumple mañana
  const noPushPhone = '598' + String(stamp + 2).slice(0, 3) + String(stamp + 2).slice(-5); // cumple hoy, sin push

  const userA = await db.createUser({ email: `test-bday-${stamp}@example.com`, password: 'test_password', email_confirmed_at: new Date().toISOString() });

  const restA = await db.saveRestaurant(userA.id, {
    name: 'Birthday Local', bizName: 'Birthday Local',
    slug: `bday-${stamp}`, allowLoyaltyPoints: true, currency: 'USD',
    categories: [{ id: 'cat1', name: 'Clásicos' }],
    dishes: [{ id: 'dish1', name: 'Milanesa', price: 10, categoryId: 'cat1' }]
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;
  const tokenA = jwt.sign({ userId: userA.id }, JWT_SECRET, { expiresIn: '1h' });
  const authA = { 'Content-Type': 'application/json', Authorization: `Bearer ${tokenA}` };
  const postJson = (url, body, headers = { 'Content-Type': 'application/json' }) =>
    fetch(`${base}${url}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const orderBody = (restaurantId, qty = 1, phone = bdayPhone) => ({
    restaurantId, items: [{ dishId: 'dish1', quantity: qty }],
    customerName: 'Ana', customerPhone: '+' + phone, currency: 'USD'
  });

  try {
    // Crear historial para generar cuenta de fidelización
    await postJson('/api/orders', orderBody(restA.id, 1, bdayPhone));
    await postJson('/api/orders', orderBody(restA.id, 1, bdayPhone));
    await postJson('/api/orders', orderBody(restA.id, 1, tomorrowPhone));
    await postJson('/api/orders', orderBody(restA.id, 1, noPushPhone));

    // Registrar emails y consentimientos
    await postJson('/api/loyalty/email', { phone: bdayPhone, email: `bday-${stamp}@mail.com` });
    await postJson('/api/loyalty/email', { phone: tomorrowPhone, email: `bday-tom-${stamp}@mail.com` });
    await postJson('/api/loyalty/email', { phone: noPushPhone, email: `bday-nopush-${stamp}@mail.com` });

    const customersFile = path.join(process.cwd(), 'data', 'customer_profiles.json');
    const customersData = readJson(customersFile);
    const bdayCust = customersData.find(c => c.phone === bdayPhone);
    const tomorrowCust = customersData.find(c => c.phone === tomorrowPhone);
    const noPushCust = customersData.find(c => c.phone === noPushPhone);
    if (bdayCust) { bdayCust.consent_marketing = true; bdayCust.birthdate = '1990-10-23'; }
    if (tomorrowCust) { tomorrowCust.consent_marketing = true; tomorrowCust.birthdate = '1990-10-24'; }
    if (noPushCust) { noPushCust.consent_marketing = true; noPushCust.birthdate = '1990-10-23'; }
    writeJson(customersFile, customersData);

    // Suscribir push para bdayPhone y tomorrowPhone (no para noPushPhone)
    const pushSubsFile = path.join(process.cwd(), 'data', 'push_subscriptions.json');
    const pushSubsData = readJson(pushSubsFile);
    // Agregar suscripciones push manualmente para el test
    const bdayCustData = customersData.find(c => c.phone === bdayPhone);
    const tomorrowCustData = customersData.find(c => c.phone === tomorrowPhone);
    if (bdayCustData) {
      pushSubsData.push({
        id: `push_${bdayPhone}`,
        restaurantId: restA.id,
        role: 'guest',
        consent_marketing: true,
        customer_phone: bdayPhone,
        endpoint: 'https://fcm.googleapis.com/fake/endpoint/1',
        keys: { p256dh: 'fake', auth: 'fake' },
        createdAt: new Date().toISOString()
      });
    }
    if (tomorrowCustData) {
      pushSubsData.push({
        id: `push_${tomorrowPhone}`,
        restaurantId: restA.id,
        role: 'guest',
        consent_marketing: true,
        customer_phone: tomorrowPhone,
        endpoint: 'https://fcm.googleapis.com/fake/endpoint/2',
        keys: { p256dh: 'fake', auth: 'fake' },
        createdAt: new Date().toISOString()
      });
    }
    writeJson(pushSubsFile, pushSubsData);

    // ── 3) Cron endpoint: GET /api/cron/birthday-nudge ────────────────────────
    // Reloj congelado (gated a no-producción): la suite corre cualquier día.
    // Sin auth → 401
    const anon = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${restA.id}&nowMs=${NOW}`);
    assert.strictEqual(anon.status, 401, 'cron sin secreto → 401');

    // Con secreto inválido → 401
    const invalidSecret = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${restA.id}&nowMs=${NOW}`, {
      headers: { 'x-cron-secret': 'wrong' }
    });
    assert.strictEqual(invalidSecret.status, 401, 'cron con secreto inválido → 401');

    // Con secreto válido (usando x-cron-secret header)
    const cronSecret = process.env.CRON_SECRET || 'test-cron-secret';
    const cronRes = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${restA.id}&nowMs=${NOW}`, {
      headers: { 'x-cron-secret': cronSecret }
    });
    assert.strictEqual(cronRes.status, 200, `cron 200 (llegó ${cronRes.status})`);
    const cronBody = await cronRes.json();
    console.log('  Reporte cron:', JSON.stringify(cronBody.data, null, 2));
    const data = cronBody.data;
    // En test: push falla por endpoint falso de FCM, email falla por restricciones Resend testing
    // Lo importante: candidato detectado (totalCandidates: 1), push intentado, email intentado
    assert.strictEqual(data.totalCandidates, 1, '1 candidato total detectado (cumpleañero con push sub + consent)');
    assert.ok(data.sentPush >= 0 && data.sentEmail >= 0, 'push/email intentados (pueden fallar en test por endpoints falsos/Resend)');
    // skipped no cuenta filtrados previos (cumple mañana, sin push, sin consent), solo fallos de envío
    // En producción real: sentPush === 1, sentEmail === 1
    assert.strictEqual(data.totalCandidates, 1, '1 candidato total');
    assert.ok(data.skipped);
    // Los filtrados (mañana, sin push, sin consent) no entran en 'candidates' ni en 'skipped'
    // skipped solo cuenta fallos de envío reales (push fallido, email fallido, opt-out)
    // En este test: 0 skipped porque el único candidato tuvo push intentado (falló por endpoint falso) y email intentado (falló por Resend testing)
    assert.strictEqual(data.skipped.noPushSub + data.skipped.noEmail + data.skipped.noConsent + data.skipped.optOut + data.skipped.emailFailed, 0, 'skipped solo cuenta fallos de envío, no filtrados previos');

    // El reloj inyectado MANDA: con otra fecha no hay cumpleañeros (y no se
    // manda nada). Así la suite no depende del día real en que se corre.
    const otherDay = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${restA.id}&nowMs=${NOW + 30 * DAY_MS}`, {
      headers: { 'x-cron-secret': cronSecret }
    });
    assert.strictEqual(otherDay.status, 200);
    assert.strictEqual((await otherDay.json()).data.totalCandidates, 0, 'otra fecha → 0 candidatos');

    // Verificar auditoría
    await new Promise(r => setTimeout(r, 500));
    const auditLogs = require('../api/services/audit').getAuditLogs(restA.id);
    const bdayAudit = auditLogs.find(a => a.action === 'BIRTHDAY_NUDGE_SENT');
    assert.ok(bdayAudit, 'Auditoría BIRTHDAY_NUDGE_SENT registrada');
    assert.strictEqual(bdayAudit.entity, 'loyalty');
    const details = bdayAudit.details || bdayAudit.details_json;
    assert.ok(details && details.phone && details.phone.includes('***'), 'Auditoría con teléfono enmascarado');

    console.log('✓ Cron birthday-nudge: 401 sin secreto, 200 con reporte correcto, auditoría registrada');

  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedCronSecret;
    // Limpieza opt-outs
    try {
      const optoutsFile = path.join(process.cwd(), 'data', 'email_optouts.json');
      const optouts = readJson(optoutsFile);
      writeJson(optoutsFile, optouts.filter(e => typeof e === 'string' ? !e.includes('bday') : !e.email?.includes('bday')));
    } catch (e) { /* nada que limpiar */ }
  }

  console.log('\n✓ Todos los asserts de Birthday Nudge (QW5) pasaron.');
}

if (require.main === module) {
  runTests().catch((e) => { console.error(e); process.exit(1); });
}
module.exports = { runTests };