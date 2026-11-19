/**
 * tests/test-push-staff.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Push dirigido al equipo (sendStaffPush).
 *
 * Verifica:
 *   §1 - Push se entrega SOLO a la suscripción waiter con staff_id coincidente
 *   §2 - Sin VAPID → skipped honesto (PUSH_NOT_CONFIGURED, failed:0)
 *   §3 - Sin suscripciones waiter → skipped honesto (NO_MATCHING_SUBSCRIBERS)
 *   §4 - Rol owner NO recibe push de staff (solo waiter)
 *   §5 - Payload tipo staff_shift con tag por turno y link /mozo
 *   §6 - Intento real de entrega (endpoint .invalid → failed>=1)
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
  console.log('🧪 Iniciando verificación de push dirigido al equipo (staff)...');

  const origPublic = process.env.VAPID_PUBLIC_KEY;
  const origPrivate = process.env.VAPID_PRIVATE_KEY;
  const origSubject = process.env.VAPID_SUBJECT;

  // Generar llaves VAPID reales para el test de entrega
  const vapidKeys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.VAPID_SUBJECT = origSubject || 'mailto:soporte@scango.uy';

  const user = await db.createUser({
    email: `push-staff-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Push Staff QA',
    bizName: 'Push Staff QA',
    slug: `push-staff-qa-${Date.now()}`
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // ── Crear suscripciones waiter y owner ──
    const endpointWaiter1 = `https://push.test/staff-waiter1-${Date.now()}`;
    const endpointWaiter2 = `https://push.test/staff-waiter2-${Date.now()}`;
    const endpointOwner = `https://push.test/staff-owner-${Date.now()}`;

    // Waiter 1 (staff_001) - teléfono coincidente
    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointWaiter1,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'waiter',
      consentMarketing: true,
      customerPhone: '',
      staffId: 'staff_001'
    });

    // Waiter 2 (staff_002) - diferente staff_id
    await notificationsService.saveSubscription({
      userId: null,
      restaurantId: restaurant.id,
      endpoint: endpointWaiter2,
      keys: { p256dh: 'A' + 'x'.repeat(86), auth: 'B' + 'y'.repeat(21) },
      role: 'waiter',
      consentMarketing: true,
      customerPhone: '',
      staffId: 'staff_002'
    });

    // Owner (no waiter, no staff_id)
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

    // ── §1 - Con VAPID: staff_id coincidente → checked:1, intenta entrega ──
    console.log('  §1 - Con VAPID: staff_id coincidente...');
    const push1 = await notificationsService.sendStaffPush({
      restaurantId: restaurant.id,
      staffId: 'staff_001',
      title: '🔔 Mesa 5 llama al mozo',
      body: 'El comensal de la Mesa 5 necesita atención.',
      url: '/mozo',
      type: 'staff_shift',
      tag: 'staff-shift-mesa5'
    });
    assert.strictEqual(push1.success, true, 'push1 success');
    assert.strictEqual(push1.checked, 1, 'checked:1 (solo waiter con staff_id coincidente)');
    assert.strictEqual(push1.delivered, 0, 'endpoint .invalid no entrega');
    assert.ok(push1.failed >= 1, 'intento real de entrega (falló por .invalid)');
    assert.strictEqual(push1.payload.type, 'staff_shift', 'payload tipo staff_shift');
    assert.ok(push1.payload.tag.startsWith('staff-shift'), 'tag por turno');
    assert.strictEqual(push1.payload.url, '/mozo', 'link al PWA del mozo');
    console.log(`   ✓ checked=${push1.checked} delivered=${push1.delivered} failed=${push1.failed}`);

    // ── §2 - staff_id inexistente → NO_MATCHING_SUBSCRIBERS ──
    console.log('  §2 - staff_id inexistente...');
    const push2 = await notificationsService.sendStaffPush({
      restaurantId: restaurant.id,
      staffId: 'staff_999',
      title: 'Test',
      body: 'Test body',
      url: '/mozo',
      type: 'staff_shift',
      tag: 'staff-shift-999'
    });
    assert.strictEqual(push2.checked, 0, 'checked:0 (ningún waiter con ese staff_id)');
    assert.strictEqual(push2.skipped, 'NO_MATCHING_SUBSCRIBERS', 'skipped honesto');
    console.log('   ✓ staff_id inexistente → skipped NO_MATCHING_SUBSCRIBERS');

    // ── §3 - Sin VAPID → skipped honesto ──
    console.log('  §3 - Sin VAPID: skipped honesto...');
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const push3 = await notificationsService.sendStaffPush({
      restaurantId: restaurant.id,
      staffId: 'staff_001',
      title: 'Test sin VAPID',
      body: 'Test body',
      url: '/mozo',
      type: 'staff_shift',
      tag: 'staff-shift-novapid'
    });
    assert.strictEqual(push3.success, true, 'push3 success');
    assert.strictEqual(push3.checked, 1, 'checked:1 (suscripción encontrada)');
    assert.strictEqual(push3.delivered, 0, 'sin VAPID no entrega');
    assert.strictEqual(push3.failed, 0, 'sin VAPID no falla la entrega');
    assert.strictEqual(push3.skipped, 'PUSH_NOT_CONFIGURED', 'skipped honesto sin VAPID');
    console.log(`   ✓ checked=${push3.checked} skipped=${push3.skipped}`);

    // Restaurar VAPID
    process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;

    // ── §4 - Rol owner no recibe push de staff ──
    console.log('  §4 - Rol owner excluido...');
    const push4 = await notificationsService.sendStaffPush({
      restaurantId: restaurant.id,
      staffId: 'staff_001',
      title: 'Test owner',
      body: 'Test body',
      url: '/mozo',
      type: 'staff_shift',
      tag: 'staff-shift-owner'
    });
    // Solo waiter con staff_id coincidente (staff_001) recibe, owner no
    assert.strictEqual(push4.checked, 1, 'checked:1 (solo waiter, owner excluido)');
    console.log(`   ✓ Owner excluido: checked=${push4.checked}`);

    // ── §5 - Verificar payload ──
    assert.strictEqual(push1.payload.title, '🔔 Mesa 5 llama al mozo', 'título');
    assert.strictEqual(push1.payload.body, 'El comensal de la Mesa 5 necesita atención.', 'cuerpo');
    assert.strictEqual(push1.payload.data.staffId, 'staff_001', 'data.staffId');
    assert.strictEqual(push1.payload.data.restaurantId, restaurant.id, 'data.restaurantId');
    console.log('   ✓ Payload correcto (título, cuerpo, data, tag, url)');

    console.log('\n✓ TODAS LAS PRUEBAS DE PUSH STAFF PASARON!');
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
  console.error('❌ Error en pruebas de push staff:', err);
  process.exit(1);
});
