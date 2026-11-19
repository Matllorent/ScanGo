/**
 * tests/test-push-order-status.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Push dirigido del estado del pedido (sendOrderStatusNotification).
 *
 * Verifica:
 *   §1 - Sin VAPID → skipped honesto (PUSH_NOT_CONFIGURED, failed:0)
 *   §2 - Con VAPID: push se entrega SOLO a la suscripción guest con teléfono coincidente
 *   §3 - Sin teléfono normalizable → skipped honesto (checked:0, NO_MATCHING_SUBSCRIBERS)
 *   §4 - Sin consentimiento de marketing → no se entrega (filtrado)
 *   §5 - Rol owner no se entrega (solo guests)
 *   §6 - Payload tipo order_status con tag por pedido y link de tracking
 *   §7 - Intento real de entrega (endpoint .invalid → failed>=1)
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
  console.log('🧪 Iniciando verificación de push de estado de pedido...');

  const origPublic = process.env.VAPID_PUBLIC_KEY;
  const origPrivate = process.env.VAPID_PRIVATE_KEY;
  const origSubject = process.env.VAPID_SUBJECT;

  // Generar llaves VAPID reales para el test de entrega
  const vapidKeys = webpush.generateVAPIDKeys();
  process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
  process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;
  process.env.VAPID_SUBJECT = origSubject || 'mailto:soporte@scango.uy';

  const user = await db.createUser({
    email: `push-status-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'Push Status QA',
    bizName: 'Push Status QA',
    slug: `push-status-qa-${Date.now()}`
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // ── Crear suscripciones guest ──
    const endpointWithPhone = `https://push.test/status-with-phone-${Date.now()}`;
    const endpointNoPhone = `https://push.test/status-no-phone-${Date.now()}`;
    const endpointNoConsent = `https://push.test/status-no-consent-${Date.now()}`;
    const endpointOwner = `https://push.test/status-owner-${Date.now()}`;

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

    // ── §1 - Sin VAPID → skipped honesto ──
    console.log('  §1 - Sin VAPID: skipped honesto...');
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const pushNoVapid = await notificationsService.sendOrderStatusNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      status: 'preparing',
      orderId: 'ord_test_novapid',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(pushNoVapid.success, true, 'pushNoVapid success');
    assert.strictEqual(pushNoVapid.checked, 1, 'checked:1 (suscripción encontrada)');
    assert.strictEqual(pushNoVapid.delivered, 0, 'sin VAPID no entrega');
    assert.strictEqual(pushNoVapid.failed, 0, 'sin VAPID no falla la entrega, hace skip');
    assert.strictEqual(pushNoVapid.skipped, 'PUSH_NOT_CONFIGURED', 'skipped honesto sin VAPID');
    console.log(`   ✓ checked=${pushNoVapid.checked} skipped=${pushNoVapid.skipped}`);

    // Restaurar VAPID
    process.env.VAPID_PUBLIC_KEY = vapidKeys.publicKey;
    process.env.VAPID_PRIVATE_KEY = vapidKeys.privateKey;

    // ── §2 - Con VAPID: teléfono coincidente → checked:1, intenta entrega ──
    console.log('  §2 - Con VAPID: teléfono coincidente...');
    const push1 = await notificationsService.sendOrderStatusNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      status: 'preparing',
      orderId: 'ord_test_001',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push1.success, true, 'push1 success');
    assert.strictEqual(push1.checked, 1, 'checked:1 (solo la suscripción con teléfono coincide)');
    assert.strictEqual(push1.delivered, 0, 'endpoint .invalid no entrega');
    assert.ok(push1.failed >= 1, 'intento real de entrega (falló por .invalid)');
    assert.strictEqual(push1.payload.type, 'order_status', 'payload tipo order_status');
    assert.ok(push1.payload.tag.startsWith('order-'), 'tag por pedido');
    assert.ok(push1.payload.url.includes(`?track=`), 'link de tracking');
    console.log(`   ✓ checked=${push1.checked} delivered=${push1.delivered} failed=${push1.failed}`);

    // ── §3 - Sin teléfono → skipped honesto ──
    console.log('  §3 - Sin teléfono normalizable...');
    const push2 = await notificationsService.sendOrderStatusNotification({
      restaurantId: restaurant.id,
      customerPhone: '',
      status: 'preparing',
      orderId: 'ord_test_002',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push2.checked, 0, 'checked:0 (sin teléfono)');
    assert.strictEqual(push2.skipped, 'NO_MATCHING_SUBSCRIBERS', 'skipped honesto');
    console.log('   ✓ Sin teléfono → skipped NO_MATCHING_SUBSCRIBERS');

    // ── §4 - Teléfono sin consentimiento → no entrega ──
    console.log('  §4 - Teléfono sin consentimiento de marketing...');
    const push3 = await notificationsService.sendOrderStatusNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      status: 'ready',
      orderId: 'ord_test_003',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    // sub1 tiene consent=true y coincide → checked:1
    assert.strictEqual(push3.checked, 1, 'checked:1 (solo sub1 con consent)');
    console.log(`   ✓ Filtro consentMarketing: checked=${push3.checked}`);

    // ── §5 - Rol owner nunca recibe push de estado ──
    console.log('  §5 - Rol owner excluido...');
    const push4 = await notificationsService.sendOrderStatusNotification({
      restaurantId: restaurant.id,
      customerPhone: '+598 99 123 456',
      status: 'delivered',
      orderId: 'ord_test_004',
      slug: restaurant.slug,
      restaurantName: restaurant.name
    });
    assert.strictEqual(push4.checked, 1, 'checked:1 (solo guests, owner excluido)');
    console.log(`   ✓ Owner excluido: checked=${push4.checked}`);

    // ── §6 - Verificar payload ──
    assert.strictEqual(push1.payload.title, '👨‍🍳 Preparando tu pedido', 'título preparing');
    assert.strictEqual(push1.payload.body, 'Tu pedido está en marcha.', 'cuerpo preparing');
    assert.strictEqual(push1.payload.data.orderId, 'ord_test_001', 'data.orderId');
    console.log('   ✓ Payload correcto (título, cuerpo, data, tag, url)');

    console.log('\n✓ TODAS LAS PRUEBAS DE PUSH ESTADO DE PEDIDO PASARON!');
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
  console.error('❌ Error en pruebas de push estado de pedido:', err);
  process.exit(1);
});
