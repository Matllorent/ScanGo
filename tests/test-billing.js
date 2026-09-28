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

  // 5. Precios escalonados por volumen de sucursales
  const p1 = billingOrchestrator.calculateMultiBranchPrice(19, 1);
  assert.strictEqual(p1, 19, '1 sucursal (principal) paga 100% del precio base');
  const p2 = billingOrchestrator.calculateMultiBranchPrice(19, 2);
  assert.strictEqual(p2, 34.2, '2 sucursales: 100% + 80% = 34.20');
  const p3 = billingOrchestrator.calculateMultiBranchPrice(19, 3);
  assert.strictEqual(p3, 46.55, '3 sucursales: 100% + 80% + 65% = 46.55');
  const p4 = billingOrchestrator.calculateMultiBranchPrice(19, 4);
  assert.strictEqual(p4, 56.05, '4 sucursales: piso del 50% aplica desde la 4ª');
  const p6 = billingOrchestrator.calculateMultiBranchPrice(19, 6);
  assert.strictEqual(p6, 75.05, '6 sucursales: piso 50% en la 4ª, 5ª y 6ª');
  assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice(19, 0), 19, 'branchCount inválido usa mínimo 1 (principal)');
  assert.strictEqual(billingOrchestrator.calculateMultiBranchPrice('abc', 3), 0, 'basePrice inválida devuelve 0');
  console.log(`✓ calculateMultiBranchPrice escalonado: 1→$${p1} | 2→$${p2} | 3→$${p3} | 4→$${p4} | 6→$${p6}`);

  // 5b. verifyAccess aplica el cálculo cuando el restaurante tiene múltiples sucursales
  db.saveRestaurant(user.id, {
    branches: [
      { id: 'br_1', name: 'Principal' },
      { id: 'br_2', name: 'Centro' },
      { id: 'br_3', name: 'Pocitos' }
    ]
  });
  const accessMulti = billingOrchestrator.verifyAccess(rest.id);
  assert.strictEqual(accessMulti.allowed, true, 'Acceso multi-sucursal dentro de la gracia');
  assert.strictEqual(accessMulti.pricing.branchCount, 3, 'pricing detecta 3 sucursales');
  assert.strictEqual(accessMulti.pricing.basePrice, 19, 'basePrice del plan Pro Mensual');
  assert.strictEqual(accessMulti.pricing.totalPrice, 46.55, 'totalPrice con descuento escalonado');
  assert.strictEqual(accessMulti.pricing.totalDiscount, 10.45, 'ahorro total: 57 - 46.55 = 10.45');
  assert.strictEqual(accessMulti.pricing.hasMultiBranchDiscount, true, 'flag de descuento activo');
  console.log('✓ verifyAccess aplica precio escalonado multi-sucursal (3 sucursales → $46.55 USD, ahorro $10.45)');

  // 5c. createCheckout expone el pricing efectivo del plan
  const checkout = billingOrchestrator.createCheckout({
    restaurantId: rest.id,
    planId: 'pro_monthly',
    customerEmail: user.email
  });
  assert.strictEqual(checkout.pricing.branchCount, 3, 'checkout hereda el conteo de sucursales');
  assert.strictEqual(checkout.pricing.totalPrice, 46.55, 'checkout calcula el total multi-sucursal');
  console.log('✓ createCheckout incluye pricing multi-sucursal');

  // 5d. Restaurante sin branches = 1 sucursal (sin descuento)
  db.saveRestaurant(user.id, { branches: [] });
  const accessSingle = billingOrchestrator.verifyAccess(rest.id);
  assert.strictEqual(accessSingle.pricing.branchCount, 1, 'sin branches se cuenta 1 sucursal principal');
  assert.strictEqual(accessSingle.pricing.totalPrice, 19, 'sin descuento mantiene precio base');
  assert.strictEqual(accessSingle.pricing.hasMultiBranchDiscount, false, 'flag de descuento inactivo');
  console.log('✓ Restaurante single-branch conserva el precio base ($19 USD)');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE BILLING PASARON EXITOSAMENTE AL 100%!\n');
})();
