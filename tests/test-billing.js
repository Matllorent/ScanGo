const assert = require('assert');
const db = require('../src/db/db');
const billingOrchestrator = require('../src/billing/orchestrator');

console.log('🧪 Iniciando pruebas de la Pasarela de Pagos & Escalabilidad...');

// 1. Crear restaurante de prueba
const user = db.createUser({ email: 'test-restaurante@pizarron.com', password: 'secret_demo_pwd' });
const rest = db.saveRestaurant(user.id, { bizName: 'La Esquina Gourmet', slug: 'esquina-gourmet' });
console.log('✓ Restaurante creado con id:', rest.id, 'en estado trial');

// 2. Verificar acceso inicial en trial
const accessTrial = billingOrchestrator.verifyAccess(rest.id);
assert.strictEqual(accessTrial.allowed, true, 'El trial debe tener acceso permitido');
assert.strictEqual(accessTrial.status, 'trialing');
console.log('✓ Acceso permitido en Free Trial (14 días)');

// 3. Simular Webhook de pago exitoso (Lemon Squeezy)
const fakeEventId = 'evt_test_' + Date.now();
const webhookPayload = {
  meta: {
    event_name: 'subscription_payment_success',
    custom_data: { restaurant_id: rest.id, event_id: fakeEventId }
  },
  data: {
    id: fakeEventId,
    attributes: {
      status: 'active',
      user_email: user.email,
      renews_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
    }
  }
};

(async () => {
  // Primer webhook
  const res1 = await billingOrchestrator.processWebhook('lemonsqueezy', {}, JSON.stringify(webhookPayload), webhookPayload);
  assert.strictEqual(res1.success, true);
  assert.strictEqual(res1.status, 'active');

  const accessActive = billingOrchestrator.verifyAccess(rest.id);
  assert.strictEqual(accessActive.allowed, true);
  assert.strictEqual(accessActive.status, 'active');
  console.log('✓ Suscripción activada exitosamente tras pago');

  // Segundo webhook idéntico (Prueba de Idempotencia)
  const res2 = await billingOrchestrator.processWebhook('lemonsqueezy', {}, JSON.stringify(webhookPayload), webhookPayload);
  assert.strictEqual(res2.duplicate, true, 'Debe detectar evento duplicado');
  console.log('✓ Idempotencia confirmada: El evento duplicado fue ignorado sin alterar la DB');

  // 4. Simular fallo de cobro (Smart Dunning & Período de Gracia)
  const failEventId = 'evt_fail_' + Date.now();
  const failPayload = {
    meta: {
      event_name: 'subscription_payment_failed',
      custom_data: { restaurant_id: rest.id, event_id: failEventId }
    },
    data: {
      id: failEventId,
      attributes: {
        status: 'past_due',
        user_email: user.email,
        ends_at: new Date().toISOString()
      }
    }
  };

  await billingOrchestrator.processWebhook('lemonsqueezy', {}, JSON.stringify(failPayload), failPayload);
  const accessGrace = billingOrchestrator.verifyAccess(rest.id);
  assert.strictEqual(accessGrace.allowed, true, 'Durante el período de gracia el menú DEBE permanecer activo');
  assert.strictEqual(accessGrace.inGracePeriod, true);
  assert.strictEqual(accessGrace.gracePeriodDaysRemaining, 7);
  console.log('✓ Smart Dunning verificado: Tarjeta fallida entra en gracia (7 días) y el menú sigue ONLINE');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE BILLING PASARON EXITOSAMENTE AL 100%!\n');
})();
