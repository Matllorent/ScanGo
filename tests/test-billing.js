const assert = require('assert');
const db = require('../src/db/db');
const billingOrchestrator = require('../src/billing/orchestrator');

console.log('🧪 Iniciando pruebas de la Pasarela de Pagos & Escalabilidad...');

async function runTests() {
  // 1. Crear restaurante de prueba
  const user = await db.createUser({ email: 'test-restaurante@pizarron.com', password: 'secret_demo_pwd' });
  const rest = await db.saveRestaurant(user.id, { bizName: 'La Esquina Gourmet', slug: 'esquina-gourmet' });
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
  await db.saveRestaurant(user.id, {
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

  // 5c. createCheckout expone el pricing efectivo del plan (async: MP/Stripe
  //     crean la sesión vía API)
  const checkout = await billingOrchestrator.createCheckout({
    restaurantId: rest.id,
    planId: 'pro_monthly',
    customerEmail: user.email
  });
  assert.strictEqual(checkout.pricing.branchCount, 3, 'checkout hereda el conteo de sucursales');
  assert.strictEqual(checkout.pricing.totalPrice, 46.55, 'checkout calcula el total multi-sucursal');
  assert.strictEqual(checkout.planId, 'pro_monthly', 'checkout normaliza el planId');
  assert.strictEqual(checkout.provider, 'lemonsqueezy', 'sin país se resuelve el proveedor por defecto');
  assert.ok(checkout.checkoutUrl === null || typeof checkout.checkoutUrl === 'string', 'checkoutUrl es null cuando no hay credenciales, o una URL válida');
  console.log('✓ createCheckout incluye pricing multi-sucursal (y resuelve proveedor)');

  // 5c'. Normalización de planes: la UI manda aliases cortos ('monthly'/'annual')
  assert.strictEqual(billingOrchestrator.normalizePlanId('monthly'), 'pro_monthly', 'alias monthly → pro_monthly');
  assert.strictEqual(billingOrchestrator.normalizePlanId('annual'), 'pro_annual', 'alias annual → pro_annual');
  assert.strictEqual(billingOrchestrator.normalizePlanId('pro_monthly'), 'pro_monthly', 'plan real se conserva');
  assert.throws(() => billingOrchestrator.normalizePlanId('gold_plan'), /Plan inválido/, 'plan desconocido debe rechazarse');
  assert.strictEqual(billingOrchestrator.resolveProvider('UY', '$'), 'mercadopago', 'UY + moneda $ → Mercado Pago');
  assert.strictEqual(billingOrchestrator.resolveProvider('AR', 'ARS'), 'mercadopago', 'AR → Mercado Pago');
  assert.strictEqual(billingOrchestrator.resolveProvider('US', 'USD'), 'lemonsqueezy', 'resto del mundo → Lemon Squeezy');
  console.log('✓ Normalización de planes y resolución de proveedor por país/moneda');

  // 5d. Restaurante sin branches = 1 sucursal (sin descuento)
  await db.saveRestaurant(user.id, { branches: [] });
  const accessSingle = billingOrchestrator.verifyAccess(rest.id);
  assert.strictEqual(accessSingle.pricing.branchCount, 1, 'sin branches se cuenta 1 sucursal principal');
  assert.strictEqual(accessSingle.pricing.totalPrice, 19, 'sin descuento mantiene precio base');
  assert.strictEqual(accessSingle.pricing.hasMultiBranchDiscount, false, 'flag de descuento inactivo');
  console.log('✓ Restaurante single-branch conserva el precio base ($19 USD)');

  // 6. Eventos: modelo one-off por fiesta (plan event_once, ~USD 12)
  // 6a. El plan existe y los aliases se normalizan
  assert.ok(billingOrchestrator.getPlanPricing(rest, 'event_once'), 'plan event_once debe existir');
  const eventPricing = billingOrchestrator.getPlanPricing({ branches: [] }, 'event_once');
  assert.strictEqual(eventPricing.planName, 'Evento Único', 'nombre del plan legible');
  assert.strictEqual(eventPricing.totalPrice, 12, 'evento one-off: $12 USD pago único');
  assert.strictEqual(eventPricing.hasMultiBranchDiscount, false, 'un evento no tiene sucursales');
  assert.strictEqual(billingOrchestrator.normalizePlanId('event_once'), 'event_once', 'plan real se conserva');
  assert.strictEqual(billingOrchestrator.normalizePlanId('evento'), 'event_once', 'alias evento → event_once');
  assert.strictEqual(billingOrchestrator.normalizePlanId('fiesta'), 'event_once', 'alias fiesta → event_once');
  assert.strictEqual(billingOrchestrator.normalizePlanId('event'), 'event_once', 'alias legacy event → event_once');
  console.log('✓ Plan Evento Único ($12) + aliases evento/fiesta/event → event_once');

  // 6b. createCheckout acepta event_once y expone el pricing one-off
  const eventCheckout = await billingOrchestrator.createCheckout({
    restaurantId: rest.id,
    planId: 'event_once',
    customerEmail: user.email
  });
  assert.strictEqual(eventCheckout.planId, 'event_once', 'checkout normaliza event_once');
  assert.strictEqual(eventCheckout.pricing.totalPrice, 12, 'checkout cobra $12 por el evento');
  assert.ok(eventCheckout.checkoutUrl === null || typeof eventCheckout.checkoutUrl === 'string', 'checkout event_once devuelve URL o configuration.missing');
  console.log('✓ createCheckout de event_once expone pricing one-off ($12)');

  // 6c. verifyAccess de un evento en trial activo (plan event_once) permite acceso
  const nowIso = new Date().toISOString();
  const eventRest = await db.saveRestaurant(user.id, {
    bizName: 'Fiesta de Quince de Valentina',
    slug: 'event-quince-valentina',
    businessType: 'events',
    isEvent: true,
    eventDate: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
    expiresAt: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(),
    subscription: {
      status: 'trialing',
      plan: 'event_once',
      provider: 'trial',
      trialEndsAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      currentPeriodEnd: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(),
      gracePeriodDaysRemaining: 7
    }
  });
  const accessEventTrial = billingOrchestrator.verifyAccess(eventRest.id);
  assert.strictEqual(accessEventTrial.allowed, true, 'evento en trial: acceso permitido');
  assert.strictEqual(accessEventTrial.status, 'trialing');
  assert.strictEqual(accessEventTrial.plan, 'event_once', 'el evento conserva el plan event_once');
  assert.strictEqual(accessEventTrial.pricing.totalPrice, 12, 'pricing del evento: $12 one-off');
  console.log('✓ verifyAccess de evento one-off en trial: acceso permitido con pricing $12');

  // 6d. Webhook de pago exitoso del one-off → currentPeriodEnd = fecha del evento
  //     (no el renewsAt del proveedor, que para MP asumiría +30 días)
  const eventHookId = 'evt_event_once_' + Date.now();
  const eventWebhookPayload = {
    meta: {
      event_name: 'subscription_payment_success',
      custom_data: { restaurant_id: eventRest.id, plan_id: 'event_once', event_id: eventHookId }
    },
    data: {
      id: eventHookId,
      attributes: {
        status: 'active',
        user_email: user.email,
        renews_at: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
      }
    }
  };
  const eventHookRes = await billingOrchestrator.processWebhook('lemonsqueezy', {}, JSON.stringify(eventWebhookPayload), eventWebhookPayload);
  assert.strictEqual(eventHookRes.success, true);
  assert.strictEqual(eventHookRes.status, 'active');
  const eventRestAfter = db.findRestaurantById(eventRest.id);
  assert.strictEqual(eventRestAfter.subscription.plan, 'event_once', 'webhook conserva el plan event_once');
  const eventPeriodEnd = new Date(eventRestAfter.subscription.currentPeriodEnd).getTime();
  const expectedEventEnd = new Date(Date.now() + 31 * 24 * 3600 * 1000).getTime();
  assert.ok(
    Math.abs(eventPeriodEnd - expectedEventEnd) < 60 * 1000,
    'currentPeriodEnd del one-off = fecha del evento (no +30 días del proveedor)'
  );
  assert.strictEqual(eventRestAfter.subscription.gracePeriodDaysRemaining, 0, 'one-off no tiene smart dunning');
  const accessEventPaid = billingOrchestrator.verifyAccess(eventRest.id);
  assert.strictEqual(accessEventPaid.allowed, true, 'evento pagado: acceso permitido');
  console.log('✓ Webhook event_once → active con currentPeriodEnd = eventDate (sin renovación)');

  // 6e. Evento con trial vencido y sin pago → sin acceso (verifyAccess lo pausa)
  await db.updateSubscription(eventRest.id, {
    status: 'trialing',
    plan: 'event_once',
    provider: 'trial',
    trialEndsAt: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
    currentPeriodEnd: new Date(Date.now() - 20 * 24 * 3600 * 1000).toISOString(),
    gracePeriodDaysRemaining: 7
  });
  const accessEventExpired = billingOrchestrator.verifyAccess(eventRest.id);
  assert.strictEqual(accessEventExpired.allowed, false, 'evento sin pago tras el trial: acceso denegado');
  console.log('✓ Evento sin pago one-off tras el trial → menú pausado');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE BILLING PASARON EXITOSAMENTE AL 100%!\n');
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});