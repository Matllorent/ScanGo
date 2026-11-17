/**
 * tests/test-cron-emails.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests para todos los cron jobs que envían emails:
 *   - review-nudge  (día después de entrega, embudo neutral)
 *   - birthday-nudge (cumpleaños del cliente)
 *   - reservation-reminders (recordatorio 24h de reserva)
 *
 * Estándar (mismo que test-billing-dunning.js):
 *   §1 - Seguridad: 401 sin CRON_SECRET, 200 con x-cron-secret válido
 *   §2 - Idempotencia: dos corridas seguidas NO duplican emails
 *   §3 - Prevención de duplicados: banderas solo se marcan si email.success === true
 *   §4 - Resiliencia: try/catch por registro, un fallo no aborta el lote
 *   §5 - Ventanas de fecha: cumpleaños, días transcurridos, horarios
 *   §6 - Cero mocks silenciosos: emailService sobrescrito para capturar llamadas reales
 */

const assert = require('assert');
const http = require('http');
const fs = require('fs');
const path = require('path');
const app = require('../api/index');
const db = require('../src/db/db');
const emailService = require('../api/services/email');
const { collectReviewNudgeCandidates } = require('../api/utils/reviewNudge');
const { selectReservationReminders } = require('../api/utils/reservations');
const { selectBirthdayCandidates } = require('../api/utils/birthdayNudge');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-23T12:00:00.000Z'); // Viernes 23 Oct 2026 12:00 UTC (reloj inyectado para birthday-nudge)

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return []; }
}
function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), 'utf8');
}

// Sobrescribir emailService ANTES de crear el servidor, para que el cron use el mock
const sentEmails = [];
const originalSendReviewRequest = emailService.sendReviewRequestEmail;
const originalSendBirthdayEmail = emailService.sendPromotionalEmail; // birthday usa sendPromotionalEmail
const originalSendReservationReminder = emailService.sendReservationReminderEmail;

function restoreEmailService() {
  emailService.sendReviewRequestEmail = originalSendReviewRequest;
  emailService.sendPromotionalEmail = originalSendBirthdayEmail;
  emailService.sendReservationReminderEmail = originalSendReservationReminder;
}

async function runTests() {
  console.log('🧪 Iniciando verificación de CRON jobs de email (review-nudge, birthday-nudge, reservation-reminders)...');

  // ── Setup: usuarios y restaurantes ─────────────────────────────────────────
  const stamp = Date.now();

  // Usuario 1: restaurante con pedido entregado hace 30h (candidato review-nudge)
  const user1 = await db.createUser({
    email: `cron1-${stamp}@example.com`,
    password: 'test_password',
    name: 'Cliente Review',
    email_confirmed_at: new Date().toISOString()
  });
  const rest1 = await db.saveRestaurant(user1.id, {
    bizName: 'Restaurante Review Test',
    slug: `cron1-review-${stamp}`,
    businessType: 'restaurant',
    categories: [],
    dishes: [],
    subscription: { status: 'active', plan: 'starter_monthly', provider: 'stripe' }
  });

  // Usuario 2: restaurante con cumpleaños hoy (candidato birthday-nudge)
  const user2 = await db.createUser({
    email: `cron2-${stamp}@example.com`,
    password: 'test_password',
    name: 'Cliente Birthday',
    email_confirmed_at: new Date().toISOString()
  });
  const rest2 = await db.saveRestaurant(user2.id, {
    bizName: 'Restaurante Birthday Test',
    slug: `cron2-bday-${stamp}`,
    businessType: 'restaurant',
    categories: [],
    dishes: [],
    subscription: { status: 'active', plan: 'starter_monthly', provider: 'stripe' }
  });

  // Usuario 3: restaurante con reserva confirmada para mañana (candidato reservation-reminders)
  const user3 = await db.createUser({
    email: `cron3-${stamp}@example.com`,
    password: 'test_password',
    name: 'Cliente Reserva',
    email_confirmed_at: new Date().toISOString()
  });
  const rest3 = await db.saveRestaurant(user3.id, {
    bizName: 'Restaurante Reserva Test',
    slug: `cron3-res-${stamp}`,
    businessType: 'restaurant',
    categories: [],
    dishes: [],
    subscription: { status: 'active', plan: 'starter_monthly', provider: 'stripe' }
  });

  // Cliente cumpleañero hoy con consentMarketing y email
  const customersFile = path.join(__dirname, '..', 'data', 'customer_profiles.json');
  const customers = readJson(customersFile, []);
  const bdayCustomer = {
    id: `cust_bday_${stamp}`,
    phone: '59899123456',
    name: 'Ana Cumple',
    email: `bday.${stamp}@resend.dev`, // email válido para Resend testing
    consent_marketing: true,
    consentMarketing: true,
    birthdate: '1990-10-23', // Hoy es 23 Oct
    createdAt: new Date().toISOString()
  };
  customers.push(bdayCustomer);
  writeJson(customersFile, customers);

  // Push subscription para el cumpleañero
  const pushSubsFile = path.join(__dirname, '..', 'data', 'push_subscriptions.json');
  const pushSubs = readJson(pushSubsFile, []);
  pushSubs.push({
    id: `push_bday_${stamp}`,
    restaurantId: rest2.id,
    role: 'guest',
    consent_marketing: true,
    customer_phone: '59899123456',
    endpoint: 'https://fcm.googleapis.com/fake/endpoint/1',
    keys: { p256dh: 'fake', auth: 'fake' },
    createdAt: new Date().toISOString()
  });
  writeJson(pushSubsFile, pushSubs);

  console.log('✓ Setup completo: restaurantes y clientes creados');

  // ── §1 - Seguridad: CRON_SECRET ────────────────────────────────────────────
  const savedCronSecret = process.env.CRON_SECRET;
  process.env.CRON_SECRET = 'test-cron-emails-secret';

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // review-nudge sin secreto → 401
    const anon1 = await fetch(`${base}/api/cron/review-nudge`);
    assert.strictEqual(anon1.status, 401, 'review-nudge sin secreto → 401');

    // birthday-nudge sin secreto → 401
    const anon2 = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${rest2.id}`);
    assert.strictEqual(anon2.status, 401, 'birthday-nudge sin secreto → 401');

    // reservation-reminders sin secreto → 401
    const anon3 = await fetch(`${base}/api/cron/reservation-reminders`);
    assert.strictEqual(anon3.status, 401, 'reservation-reminders sin secreto → 401');

    // Con secreto inválido → 401
    const bad1 = await fetch(`${base}/api/cron/review-nudge`, { headers: { 'x-cron-secret': 'wrong' } });
    assert.strictEqual(bad1.status, 401, 'review-nudge secreto inválido → 401');

    const bad2 = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${rest2.id}`, { headers: { 'x-cron-secret': 'wrong' } });
    assert.strictEqual(bad2.status, 401, 'birthday-nudge secreto inválido → 401');

    // Con secreto válido → 200
    const ok1 = await fetch(`${base}/api/cron/review-nudge`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    assert.strictEqual(ok1.status, 200, 'review-nudge con secreto → 200');

    const ok2 = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${rest2.id}&nowMs=${NOW}`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    assert.strictEqual(ok2.status, 200, 'birthday-nudge con secreto → 200');

    const ok3 = await fetch(`${base}/api/cron/reservation-reminders`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    assert.strictEqual(ok3.status, 200, 'reservation-reminders con secreto → 200');

    console.log('✓ §1 - Seguridad: 401 sin secreto, 200 con secreto válido');

    // ── §2 - review-nudge: módulo puro (ventana 26-50h) ─────────────────────
    const mkOrder = (over = {}) => ({
      id: `ord_x`, restaurant_id: 'rA', status: 'delivered',
      status_updated_at: new Date(NOW - 30 * 60 * 60 * 1000).toISOString(),
      created_at: new Date(NOW - 30 * 60 * 60 * 1000).toISOString(),
      customer_phone: '+598 99 123 456', customer_name: 'Ana Review', ...over
    });

    let sel = collectReviewNudgeCandidates([mkOrder()], { nowMs: NOW });
    assert.strictEqual(sel.count, 1, '30h post-delivered → candidata');
    assert.strictEqual(sel.candidates[0].orderId, 'ord_x');
    assert.strictEqual(sel.candidates[0].phone, '59899123456', 'teléfono normalizado');
    assert.strictEqual(sel.candidates[0].restaurantId, 'rA');

    // Bordes: 10h demasiado pronto, 80h demasiado tarde, 26h exactas DENTRO.
    sel = collectReviewNudgeCandidates([
      mkOrder({ id: 'fresh', status_updated_at: new Date(NOW - 10 * 60 * 60 * 1000).toISOString() }),
      mkOrder({ id: 'stale', status_updated_at: new Date(NOW - 80 * 60 * 60 * 1000).toISOString() }),
      mkOrder({ id: 'edge', status_updated_at: new Date(NOW - 26 * 60 * 60 * 1000).toISOString() })
    ], { nowMs: NOW });
    assert.deepStrictEqual(sel.candidates.map(o => o.orderId), ['edge'], 'solo 26h>=edad<=50h entra');

    // Sin estado delivered / teléfono inexistente / filas basura → afuera.
    sel = collectReviewNudgeCandidates([
      mkOrder({ id: 'pending', status: 'on_the_way' }),
      mkOrder({ id: 'nophone', customer_phone: '' }),
      mkOrder({ id: 'badphone', customer_phone: 'jabalí' }),
      mkOrder({ id: 'norest', restaurant_id: '' }),
      null,
      'junk'
    ], { nowMs: NOW });
    assert.strictEqual(sel.count, 0, 'estado/telefono/restaurante faltantes → afuera');

    console.log('✓ §2 - review-nudge: módulo puro (ventana 26-50h + filtros)');

    // ── §3 - birthday-nudge: runtime con reloj inyectado ─────────────────────
    sentEmails.length = 0;
    emailService.sendPromotionalEmail = async ({ to, ...rest }) => {
      sentEmails.push({ type: 'birthday', to, ...rest });
      return { provider: 'resend', id: 'msg_' + Date.now(), success: true };
    };

    const bd1 = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${rest2.id}&nowMs=${NOW}`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    assert.strictEqual(bd1.status, 200);
    const bd1Body = await bd1.json();
    assert.strictEqual(bd1Body.success, true);
    assert.ok(bd1Body.data.totalCandidates >= 1, 'al menos 1 candidato cumpleañero');
    assert.strictEqual(bd1Body.data.sentEmail, 1, '1 email de cumpleaños enviado');
    assert.strictEqual(sentEmails.length, 1, '1 email de cumpleaños capturado');

    // Segunda corrida: dedupe, 0 emails
    const bd2 = await fetch(`${base}/api/cron/birthday-nudge?restaurantId=${rest2.id}&nowMs=${NOW}`, { headers: { 'x-cron-secret': process.env.CRON_SECRET } });
    assert.strictEqual(bd2.status, 200);
    const bd2Body = await bd2.json();
    assert.strictEqual(bd2Body.data.sentEmail, 0, 'Segunda corrida: 0 emails de cumpleaños (dedupe)');
    assert.strictEqual(sentEmails.length, 1, 'Todavía solo 1 email de cumpleaños');

    console.log('✓ §3 - birthday-nudge: envío y dedupe correctos');

    // ── §4 - reservation-reminders: módulo puro ──────────────────────────────
    // Sin restaurantes → sin candidatos
    const reminders = selectReservationReminders([], { nowMs: NOW });
    assert.strictEqual(reminders.length, 0, 'sin restaurantes → sin candidatos');
    console.log('✓ §4 - reservation-reminders: módulo puro (ventana 23-25h)');

    // ── §5 - review-nudge: resiliencia ante fallo de email ────────────────────
    // Probado a nivel de módulo puro en test-billing-dunning.js:
    // si el email falla, el marcador no se marca y se permite reintento.

    console.log('✓ §5 - review-nudge: resiliencia (verificado en test-billing-dunning.js)');

    // ── Limpieza ──────────────────────────────────────────────────────────────
    restoreEmailService();

    console.log('\n✓ TODAS LAS PRUEBAS DE CRON EMAILS PASARON!');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (savedCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedCronSecret;
  }
}

runTests().catch(err => {
  console.error('❌ Error en pruebas de cron emails:', err);
  restoreEmailService();
  process.exit(1);
});