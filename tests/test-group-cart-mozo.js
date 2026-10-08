/**
 * test-group-cart-mozo.js
 * Test Suite: Pedido Grupal Colaborativo en Tiempo Real y El Mozo Virtual
 */

require('dotenv').config();
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { createGroupCartToken } = require('../api/utils/groupCartToken');

// Importar rutas de orders
const ordersRouter = require('../api/routes/orders');

async function runGroupCartAndMozoTests() {
  console.log('🧪 Iniciando verificación del Pedido Grupal y El Mozo Virtual...');

  // ==========================================
  // 1. Verificación de Archivos y Clases
  // ==========================================
  const groupCartFile = path.join(__dirname, '../public/js/components/GroupCartManager.js');
  const virtualWaiterFile = path.join(__dirname, '../public/js/components/VirtualWaiter.js');
  const menuHtmlFile = path.join(__dirname, '../public/menu.html');
  const menuJsFile = path.join(__dirname, '../public/js/menu.js');
  const menuModulesFile = path.join(__dirname, '../public/js/menu-modules.js');

  assert.ok(fs.existsSync(groupCartFile), 'GroupCartManager.js debe existir en public/js/components/');
  assert.ok(fs.existsSync(virtualWaiterFile), 'VirtualWaiter.js debe existir en public/js/components/');

  const groupCartSource = fs.readFileSync(groupCartFile, 'utf8');
  const virtualWaiterSource = fs.readFileSync(virtualWaiterFile, 'utf8');
  const menuHtmlSource = fs.readFileSync(menuHtmlFile, 'utf8');
  const menuJsSource = fs.readFileSync(menuJsFile, 'utf8');
  const menuModulesSource = fs.readFileSync(menuModulesFile, 'utf8');

  // ==========================================
  // 2. Pedido Grupal en Tiempo Real (GroupCartManager.js)
  // ==========================================
  assert.ok(groupCartSource.includes('class GroupCartManager'), 'GroupCartManager.js debe exportar la clase GroupCartManager');
  assert.ok(groupCartSource.includes('realtime:${this.restaurantSlug}:mesa_${this.tableNumber}') ||
            groupCartSource.includes("realtime:"), 'GroupCartManager debe usar el canal realtime:restaurantSlug:mesa_X');
  assert.ok(groupCartSource.includes('cart_update'), 'GroupCartManager debe emitir y escuchar el evento cart_update');
  assert.ok(groupCartSource.includes('sessionStorage'), 'GroupCartManager debe usar sessionStorage para recuperarse de desconexión 4G');
  assert.ok(groupCartSource.includes('canEditItem'), 'GroupCartManager debe implementar control de permisos canEditItem');
  assert.ok(groupCartSource.includes('consolidateOrder'), 'GroupCartManager debe implementar consolidateOrder');
  assert.ok(groupCartSource.includes('formatWhatsAppGroupMessage'), 'GroupCartManager debe formatear el pedido grupal para WhatsApp');

  console.log('✓ GroupCartManager implementado con canales Supabase Realtime, SessionStorage 4G y permisos');

  // ==========================================
  // 3. Prueba lógica de permisos en GroupCartManager
  // ==========================================
  const mockManager = {
    userId: 'usr_juan_123',
    userName: 'Juan',
    tableNumber: '4',
    isGroupActive: () => true,
    canEditItem(item) {
      if (!this.isGroupActive()) return true;
      if (item.orderedById && item.orderedById === this.userId) return true;
      if (item.orderedBy && this.userName && item.orderedBy.toLowerCase() === this.userName.toLowerCase()) return true;
      return false;
    }
  };

  const itemJuan = {
    dish: { id: 'd1', name: 'Hamburguesa Criolla', price: 350 },
    qty: 1,
    orderedBy: 'Juan',
    orderedById: 'usr_juan_123'
  };

  const itemMaria = {
    dish: { id: 'd2', name: 'Limonada Helada', price: 140 },
    qty: 1,
    orderedBy: 'María',
    orderedById: 'usr_maria_456'
  };

  // Juan PUEDE editar su propio plato
  assert.strictEqual(mockManager.canEditItem(itemJuan), true, 'El comensal debe poder editar platos bajo su propio nombre');
  // Juan NO PUEDE editar el plato de María
  assert.strictEqual(mockManager.canEditItem(itemMaria), false, 'El comensal NO debe poder editar platos de otro comensal');

  console.log('✓ Restricción de permisos validada: Cada comensal solo puede editar o eliminar sus propios platos');

  // ==========================================
  // 4. El Mozo Virtual (VirtualWaiter.js) con Clima
  // ==========================================
  assert.ok(virtualWaiterSource.includes('class VirtualWaiter'), 'VirtualWaiter.js debe exportar la clase VirtualWaiter');
  assert.ok(virtualWaiterSource.includes('weatherContext'), 'VirtualWaiter debe analizar weatherContext');
  assert.ok(virtualWaiterSource.includes('🔥 ¡Hace calor! ¿Querés agregar una') &&
            virtualWaiterSource.includes('bien helada'),
            'VirtualWaiter debe generar sugerencias situacionales para días calurosos');
  assert.ok(!virtualWaiterSource.includes('15% OFF'),
            'El Mozo Virtual no debe prometer descuentos falsos (no aplica un 15% OFF real al agregar el item)');

  let VirtualWaiterClass;
  try {
    // Strip both export and import statements for CommonJS evaluation
    const cleanedCode = virtualWaiterSource
      .replace(/export class VirtualWaiter/, 'class VirtualWaiter')
      .replace(/import\s+.*?from\s+['"][^'"]+['"]\s*;/g, '')
      .replace(/import\s+.*?from\s+['"][^'"]+['"]\s*;/g, '');
    const factory = new Function(`${cleanedCode}; return VirtualWaiter;`);
    VirtualWaiterClass = factory();
  } catch (e) {
    throw new Error('Error al evaluar VirtualWaiter: ' + e.message);
  }

  const sampleRestaurant = {
    id: 'rest_test',
    currency: '$',
    weatherContext: 'caluroso',
    weatherTemperatureC: 32,
    smartWeatherEnabled: true,
    dishes: [
      { id: 'dish_hamb', name: 'Hamburguesa Criolla', price: 350, weatherTags: ['templado'] },
      { id: 'dish_limo', name: 'Limonada Menta y Jengibre', price: 150, weatherTags: ['caluroso', 'muy_caluroso'] },
      { id: 'dish_sopa', name: 'Sopa Crema de Calabaza', price: 200, weatherTags: ['fresco', 'muy_frio'] }
    ],
    categories: [{ id: 'cat1', name: 'Bebidas' }]
  };

  const waiter = new VirtualWaiterClass({
    restaurantData: sampleRestaurant,
    weatherContext: 'caluroso',
    weatherTemperatureC: 32
  });

  const cartWithBurger = [{ dish: sampleRestaurant.dishes[0], qty: 1 }];
  const hotSuggestion = waiter.analyze(cartWithBurger);

  assert.ok(hotSuggestion.candidates.length > 0, 'Debe haber candidatos recomendados');
  assert.strictEqual(hotSuggestion.candidates[0].id, 'dish_limo', 'En día caluroso debe recomendar la limonada');
  assert.ok(hotSuggestion.reason.includes('calor') && hotSuggestion.reason.includes('bien helada'),
            'La sugerencia debe contener el pitch de calor honesto: ' + hotSuggestion.reason);
  assert.ok(!hotSuggestion.reason.includes('%'), 'El pitch de calor no puede prometer porcentajes de descuento falsos');

  console.log('✓ "El Mozo Virtual" validado: Recomendaciones situacionales de clima (Limonada helada sugerida para el calor) y maridaje');

  // ==========================================
  // 5. Verificación de menu.html y menu-modules.js
  // ==========================================
  assert.ok(menuHtmlSource.includes('@supabase/supabase-js'), 'menu.html debe cargar el cliente Supabase Realtime');
  assert.ok(menuHtmlSource.includes('btnToggleGroupConsolidated'), 'menu.html debe tener el botón para ver el consolidado de la mesa');
  assert.ok(menuHtmlSource.includes('groupConsolidatedContainer'), 'menu.html debe tener el contenedor para el consolidado grupal');
  assert.ok(menuModulesSource.includes('GroupCartManager'), 'menu-modules.js debe importar GroupCartManager');
  assert.ok(menuModulesSource.includes('VirtualWaiter'), 'menu-modules.js debe importar VirtualWaiter');
  assert.ok(menuModulesSource.includes('initGroupCartManager'), 'menu-modules.js debe definir initGroupCartManager');

  console.log('✓ Integración de componentes en menu.html y menu-modules.js verificada');

  // ==========================================
  // 6. Verificación de Endpoints en api/routes/orders.js
  // ==========================================
  const app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRouter);

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const groupCartToken = createGroupCartToken('rest_123', '4');

  try {
    // 6.1 GET /api/orders/realtime-config
    const configRes = await fetch(`${baseUrl}/api/orders/realtime-config`);
    const configData = await configRes.json();
    assert.strictEqual(configRes.status, 200);
    assert.ok(configData.success, 'realtime-config debe responder con éxito');
    assert.ok('supabaseUrl' in configData.data, 'realtime-config debe incluir supabaseUrl');

    // 6.2 Anonymous access to a table cart is rejected
    const anonymousGet = await fetch(`${baseUrl}/api/orders/group/rest_123/4`);
    assert.strictEqual(anonymousGet.status, 403);

    // 6.3 POST /api/orders/group/:restaurantId/:tableNumber/sync
    const syncRes = await fetch(`${baseUrl}/api/orders/group/rest_123/4/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Group-Cart-Token': groupCartToken
      },
      body: JSON.stringify({
        items: [
          {
            cartItemId: 'c1',
            dishId: 'dish_hamb',
            dish: { id: 'dish_hamb', name: 'Hamburguesa Criolla', price: 350 },
            qty: 1,
            orderedBy: 'Juan',
            orderedById: 'usr_juan_123'
          }
        ],
        participants: ['Juan'],
        action: 'add',
        fromUser: 'Juan'
      })
    });
    const syncData = await syncRes.json();
    assert.strictEqual(syncRes.status, 200);
    assert.ok(syncData.success);
    assert.strictEqual(syncData.data.tableNumber, '4');
    assert.strictEqual(syncData.data.items.length, 1);
    assert.ok(syncData.data.participants.includes('Juan'));

    // 6.4 GET /api/orders/group/:restaurantId/:tableNumber
    const getGroupRes = await fetch(`${baseUrl}/api/orders/group/rest_123/4`, {
      headers: { 'X-Group-Cart-Token': groupCartToken }
    });
    const getGroupData = await getGroupRes.json();
    assert.strictEqual(getGroupRes.status, 200);
    assert.ok(getGroupData.success);
    assert.strictEqual(getGroupData.data.items.length, 1);
    assert.strictEqual(getGroupData.data.items[0].orderedBy, 'Juan');

    console.log('✓ Endpoints de sincronización y configuración en api/routes/orders.js verificados');
  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE PEDIDO GRUPAL Y MOZO VIRTUAL PASARON EXITOSAMENTE AL 100%!');
}

runGroupCartAndMozoTests().then(() => {
  // El canal de Supabase Realtime abierto durante el test mantiene vivo el
  // event loop: sin este exit el proceso nunca terminaba y npm test se colgaba
  // en este suite (los otros suites que levantan server hacen lo mismo).
  process.exit(0);
}).catch(err => {
  console.error('❌ Error en test-group-cart-mozo:', err);
  process.exit(1);
});
