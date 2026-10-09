const assert = require('assert');
const app = require('../api/index');
const http = require('http');

let server;
const PORT = 3999;
const BASE_URL = `http://localhost:${PORT}`;

async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const fetchOptions = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      'Connection': 'close',
      ...(options.headers || {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  };
  const res = await fetch(url, fetchOptions);
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    data = null;
  }
  return { status: res.status, data, headers: res.headers };
}

async function runTests() {
  console.log('🚀 Iniciando pruebas de Integración End-to-End (E2E)...');

  // Start HTTP server on test port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`✓ Servidor de prueba iniciado en puerto ${PORT}`);

  try {
    // 1. Register a new user & restaurant
    const testEmail = `test_${Date.now()}@bistro.com`;
    const regRes = await request('/api/auth/register', {
      method: 'POST',
      body: {
        email: testEmail,
        password: 'password123',
        name: 'Carlos Alberto',
        restaurantName: 'Bistro Don Alberto'
      }
    });

    assert.strictEqual(regRes.status, 200, 'Registro falló');
    assert.ok(!('token' in (regRes.data || {})), 'Sin JWT en el body (solo-cookie)');
    assert.ok(regRes.data.restaurant.slug, 'Slug de restaurante no generado');
    console.log(`✓ Usuario y Restaurante registrados: Slug = ${regRes.data.restaurant.slug}`);

    // Cookie-only: se reenvía la cookie de sesión como el navegador.
    const sessionCookie = (regRes.headers.get('set-cookie') || '').split(';')[0];
    assert.ok(sessionCookie.startsWith('auth_token='), 'Cookie auth_token seteada');
    const slug = regRes.data.restaurant.slug;
    const restaurantId = regRes.data.restaurant.id;

    // 1.5 — En modo cloud el registro exige confirmar el correo (link de Supabase;
    // el frontend muestra "revisá tu casilla" vía requiresEmailVerification). La
    // suite corre flujos REALES: confirmamos con la Admin API (service role),
    // equivalente a que el usuario abrió el link. En modo local (JSON) el registro
    // ya llega con email confirmado y este paso se salta.
    if (regRes.data.requiresEmailVerification) {
      const { getSupabaseClient } = require('../api/utils/supabase');
      const supabase = getSupabaseClient();
      assert.ok(supabase, 'requiresEmailVerification=true pero no hay cliente Supabase');
      const { error } = await supabase.auth.admin.updateUserById(regRes.data.user.id, { email_confirm: true });
      assert.ok(!error, `No se pudo confirmar el email vía Admin API: ${error?.message}`);
      console.log('✓ Email confirmado vía Admin API (flujo real del link de Supabase)');
    }

    // 2. Test /api/auth/me
    const meRes = await request('/api/auth/me', {
      headers: { Cookie: sessionCookie }
    });
    assert.strictEqual(meRes.status, 200);
    assert.strictEqual(meRes.data.user.email, testEmail);
    assert.strictEqual(meRes.data.restaurant.id, restaurantId);
    console.log('✓ /api/auth/me autenticó y validó al usuario correctamente');

    // 3. Test /api/studio/save
    const updatedData = {
      ...meRes.data.restaurant,
      slogan: 'Cocina de autor y carnes maduradas',
      currency: '$',
      deliveryZones: [
        { name: 'Zona 1 (Centro)', fee: 40 },
        { name: 'Zona 2 (Periferia)', fee: 90 }
      ]
    };
    const saveRes = await request('/api/studio/save', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: { restaurantId, data: updatedData }
    });
    assert.strictEqual(saveRes.status, 200);
    assert.strictEqual(saveRes.data.restaurant.slogan, 'Cocina de autor y carnes maduradas');
    assert.strictEqual(saveRes.data.restaurant.deliveryZones.length, 2);
    console.log('✓ /api/studio/save actualizó los datos del local y zonas de delivery');

    // 4. Test Public Menu /api/menu/:slug
    const menuRes = await request(`/api/menu/${slug}`);
    assert.strictEqual(menuRes.status, 200);
    assert.strictEqual(menuRes.data.restaurant.name, 'Bistro Don Alberto');
    assert.ok(menuRes.data.restaurant.dishes.length >= 4, 'Menú público contiene platos iniciales');
    assert.strictEqual(menuRes.data.access.inGracePeriod, false);
    console.log(`✓ /api/menu/${slug} sirvió el menú público con ${menuRes.data.restaurant.dishes.length} platos`);

    // 5. Test Billing Checkout
    const checkoutRes = await request('/api/billing/checkout', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
      body: { planId: 'pro_monthly', countryCode: 'UY' }
    });
    assert.strictEqual(checkoutRes.status, 200);
    assert.ok(checkoutRes.data.checkoutUrl, 'URL de checkout no generada');
    console.log(`✓ /api/billing/checkout generó enlace de pago con Smart Routing: ${checkoutRes.data.provider}`);

    // 6. Test Webhook simulated payment
    const webhookRes = await request('/api/billing/webhook/lemonsqueezy', {
      method: 'POST',
      body: {
        meta: {
          event_name: 'subscription_payment_success',
          custom_data: { restaurant_id: restaurantId }
        },
        data: {
          id: `sub_evt_${Date.now()}`,
          attributes: {
            status: 'active',
            renews_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          }
        }
      }
    });
    assert.strictEqual(webhookRes.status, 200);
    assert.strictEqual(webhookRes.data.success, true);
    console.log('✓ Webhook de pago activó la suscripción PRO en tiempo real');

    console.log('\n🌟 ¡TODAS LAS PRUEBAS E2E PASARON EXITOSAMENTE (100% OK)!');
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  } catch (err) {
    console.error('❌ Error en prueba E2E:', err);
    if (server) {
      if (server.closeAllConnections) server.closeAllConnections();
      server.close();
    }
    process.exit(1);
  }
}

runTests();
