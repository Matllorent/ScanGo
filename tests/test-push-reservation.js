/**
 * tests/test-push-reservation.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Push de recordatorio de reserva (sendReservationReminderNotification).
 *
 * Verifica:
 *   §1 - Push se entrega SOLO a la suscripción guest con teléfono coincidente
 *   §2 - Sin teléfono normalizable → skipped honesto (checked:0, NO_MATCHING_SUBSCRIBERS)
 *   §3 - Sin consentimiento de marketing → no se entrega (filtrado)
 *   §4 - Rol owner no se entrega (solo guests)
 *   §5 - Payload tipo reservation_reminder con tag por reserva y link al menú
 *   §6 - Intento real de entrega (endpoint .invalid → failed>=1)
 *   §7 - Sin VAPID → skipped honesto (PUSH_NOT_CONFIGURED, failed:0)
 *
 * Cero mocks: server HTTP real + DB real + web-push real.
 */
const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const notificationsService = require('../api/services/notifications');
const webpush = require('web-push');

async function runTests() {
  console.log('🧪 Iniciando verificación de push de recordatorio de reserva...');

  const origPublic = process.env.VAPID_PUBLIC_KEY;
  const origPrivate = process.env.VAPID_PRIVATE_KEY;
  const origSubject = process.env.VAPID_SUBJECT;

  // Generar llaves VAPID reales para el test de entrega
  const vapidKeys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.VAPID_SUBJECT = origSubject || 'mailto:soporte@scango.uy';

  const user = await db.createUser({
    email: `push-res-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Push Res QA',
    bizName: 'Push Res QA',
    slug: `push-res-qa-${Date.now()}`
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // ── Crear suscripciones guest ──
    const endpointWithPhone = `https://push.test/res-with-phone-${Date.now()}`;
    const endpointNoPhone = `https://push.test/res-no-phone-${Date.now()}`;
    const endpointNoConsent = `https://push.test/res-no-consent-${Date.now()}`;
    const endpointOwner = `https://push.test/res-owner-${Date.now()}`;

    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointWithPhone,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'guest',
      consentMarketing: true,
      customerPhone: '+598 99 123 456',
      staffId: ''
    });

    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointNoPhone,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'guest',
      consentMarketing: true,
      customerPhone: '',
      staffId: ''
    });

    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointNoConsent,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'guest',
      consentMarketing: false,
      customerPhone: '+598 99 123 456',
      staffId: ''
    });

    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointOwner,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'owner',
      consentMarketing: true,
      customerPhone: '+598 99 123 456',
      staffId: ''
    });

    // ── §1 - Con VAPID: teléfono coincidente → checked:1, intenta entrega ──
    console.log('  §1 - Con VAPID: teléfono coincidente...');
    const push1 = await notificationsService.sendReservationReminderNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      date: 'sáb 22 nov',
      time: '20:30',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push1.success, true, 'push1 success');
    assert.strictEqual(push1.checked, 1, 'checked:1 (solo la suscripción con teléfono coincide)');
    assert.strictEqual(push1.delivered, 0, 'endpoint .invalid no entrega');
    assert.ok(push1.failed >= 1, 'intento real de entrega (falló por .invalid)');
    assert.strictEqual(push1.payload.type, 'reservation_reminder', 'payload tipo reservation_reminder');
    assert.ok(push1.payload.tag.startsWith('reservation-reminder-'), 'tag por reserva');
    assert.ok(push1.payload.url.includes(`/m/${restaurant.slug}`), 'link al menú del local');
    console.log(`   ✓ checked=${push1.checked} delivered=${push1.delivered} failed=${push1.failed}`);

    // ── §2 - Sin teléfono → skipped honesto ──
    console.log('  §2 - Sin teléfono normalizable...');
    const push2 = await notificationsService.sendReservationReminderNotification({
      restaurantId: restaurant.id,
      customerPhone: '',
      date: 'sáb 22 nov',
      time: '20:30',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push2.checked, 0, 'checked:0 (sin teléfono)');
    assert.strictEqual(push2.skipped, 'NO_MATCHING_SUBSCRIBERS', 'skipped honesto');
    console.log('   ✓ Sin teléfono → skipped NO_MATCHING_SUBSCRIBERS');

    // ── §3 - Teléfono sin consentimiento → no entrega ──
    console.log('  §3 - Teléfono sin consentimiento de marketing...');
    const push3 = await notificationsService.sendReservationReminderNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      date: 'sáb 22 nov',
      time: '20:30',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    // sub1 tiene consent=true y coincide → checked:1
    assert.strictEqual(push3.checked, 1, 'checked:1 (solo sub1 con consent)');
    console.log(`   ✓ Filtro consentMarketing: checked=${push3.checked}`);

    // ── §4 - Rol owner nunca recibe push de reserva ──
    console.log('  §4 - Rol owner excluido...');
    const push4 = await notificationsService.sendReservationReminderNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      date: 'sáb 22 nov',
      time: '20:30',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push4.checked, 1, 'checked:1 (solo guests, owner excluido)');
    console.log(`   ✓ Owner excluido: checked=${push4.checked}`);

    // ── §5 - Verificar payload ──
    assert.strictEqual(push1.payload.title, '📅 Tu reserva es mañana', 'título');
    assert.strictEqual(push1.payload.body.includes('sáb 22 nov'), true, 'cuerpo con fecha');
    assert.strictEqual(push1.payload.body.includes('20:30'), true, 'cuerpo con hora');
    assert.strictEqual(push1.payload.data.kind, 'reservation_reminder', 'data.kind');
    console.log('   ✓ Payload correcto (título, cuerpo, data, tag, url)');

    // ── §6 - Sin VAPID → skipped honesto ──
    console.log('  §6 - Sin VAPID: skipped honesto...');
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const push6 = await notificationsService.sendReservationReminderNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      date: 'sáb 22 nov',
      time: '20:30',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push6.success, true, 'push6 success');
    assert.strictEqual(push6.checked, 1, 'checked:1 (suscripción encontrada)');
    assert.strictEqual(push6.delivered, 0, 'sin VAPID no entrega');
    assert.strictEqual(push6.failed, 0, 'sin VAPID no falla la entrega');
    assert.strictEqual(push6.skipped, 'PUSH_NOT_CONFIGURED', 'skipped honesto sin VAPID');
    console.log(`   ✓ checked=${push6.checked} skipped=${push6.skipped}`);

    console.log('\n✓ TODAS LAS PRUEBAS DE PUSH RESERVA PASARON!');
  } finally {
    if (origPublic) process.env.VAPID_PUBLIC_KEY = origPublic;
    else delete process.env.VAPID_PUBLIC_KEY;
    if (origPrivate) process.env.VAPID_PRIVATE_KEY = origPrivate;
    else delete process.env.VAPID_PRIVATE_KEY;
    if (origSubject) process.env.VAPID_SUBJECT = origSubject;
    else delete process.env.VAPID_SUBJECT;
    await new Promise(resolve => server.close(resolve));
  }
}

runTests().catch(err => {
  console.error('❌ Error en pruebas de push reserva:', err);
  process.exit(1);
});
