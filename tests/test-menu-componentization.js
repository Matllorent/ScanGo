/**
 * tests/test-menu-componentization.js
 * Automated test suite verifying modular menu architecture (smartReviews, virtualWaiterHeuristics, orderCheckout)
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function runMenuComponentizationTests() {
  console.log('🧪 Iniciando verificación de Componentización de public/js/menu/ ...');

  // 1. Check module files existence
  const smartReviewsPath = path.join(__dirname, '../public/js/menu/smartReviews.js');
  const waiterHeuristicsPath = path.join(__dirname, '../public/js/menu/virtualWaiterHeuristics.js');
  const orderCheckoutPath = path.join(__dirname, '../public/js/menu/orderCheckout.js');

  assert.ok(fs.existsSync(smartReviewsPath), 'smartReviews.js debe existir en public/js/menu/');
  assert.ok(fs.existsSync(waiterHeuristicsPath), 'virtualWaiterHeuristics.js debe existir en public/js/menu/');
  assert.ok(fs.existsSync(orderCheckoutPath), 'orderCheckout.js debe existir en public/js/menu/');
  console.log('✓ Archivos de módulos en public/js/menu/ creados correctamente');

  // 2. Test virtualWaiterHeuristics logic
  const waiterSrc = fs.readFileSync(waiterHeuristicsPath, 'utf8');
  assert.ok(waiterSrc.includes('export const DEFAULT_UPSELL_KEYWORDS'), 'Debe exportar DEFAULT_UPSELL_KEYWORDS');
  assert.ok(waiterSrc.includes('export function analyzeCartContextForUpsell'), 'Debe exportar analyzeCartContextForUpsell');
  assert.ok(waiterSrc.includes('export function getUpsellCandidates'), 'Debe exportar getUpsellCandidates');
  assert.ok(waiterSrc.includes('export function renderUpsellSuggestions'), 'Debe exportar renderUpsellSuggestions');
  assert.ok(waiterSrc.includes('export function quickAddUpsellItem'), 'Debe exportar quickAddUpsellItem');

  // Dynamic import of virtualWaiterHeuristics (ES Module)
  const waiterModule = await import('../public/js/menu/virtualWaiterHeuristics.js');
  assert.ok(waiterModule.DEFAULT_UPSELL_KEYWORDS.triggers.includes('hamburguesa'));
  assert.ok(waiterModule.DEFAULT_UPSELL_KEYWORDS.complements.includes('papas'));

  // Test heuristic analysis
  const mockRestaurant = {
    categories: [{ id: 'cat1', name: 'Principales' }, { id: 'cat2', name: 'Bebidas' }],
    dishes: [
      { id: 'd1', name: 'Hamburguesa Doble Cheddar', price: 450, categoryId: 'cat1' },
      { id: 'd2', name: 'Papas Rústicas con Romero', price: 200, categoryId: 'cat1' },
      { id: 'd3', name: 'Cerveza IPA Artesanal', price: 250, categoryId: 'cat2' }
    ]
  };
  const mockCart = {
    'd1': { dish: mockRestaurant.dishes[0], qty: 1 }
  };

  const analysis = waiterModule.analyzeCartContextForUpsell(mockCart, mockRestaurant);
  assert.ok(analysis.candidates.length > 0, 'Debe sugerir complementos para hamburguesa sin bebida ni papas');
  assert.strictEqual(analysis.badge, 'Maridaje Perfecto');
  assert.ok(analysis.reason.includes('papas doradas'), 'Debe persuadir con papas o bebida fría');
  console.log('✓ Motor heurístico El Mozo Virtual validado como módulo ES independiente');

  // 3. Test orderCheckout logic
  const checkoutModule = await import('../public/js/menu/orderCheckout.js');
  
  // Bill splitter calculation
  const split2 = checkoutModule.calculateSplitPerPerson(1050, 2);
  assert.strictEqual(split2, 525, 'División de $1050 entre 2 debe ser $525');

  const split3 = checkoutModule.calculateSplitPerPerson(1000, 3);
  assert.strictEqual(split3, 333.33, 'División de $1000 entre 3 debe redondear a $333.33');

  // Coupon discount calculation
  const percentDisc = checkoutModule.calculateCouponDiscount(1000, 150, { type: 'percent', value: 15 }, 'DELIVERY');
  assert.strictEqual(percentDisc, 150, '15% de $1000 debe ser $150');

  const freeDeliveryDisc = checkoutModule.calculateCouponDiscount(1000, 150, { type: 'free_delivery' }, 'DELIVERY');
  assert.strictEqual(freeDeliveryDisc, 150, 'Cupón free_delivery debe descontar el costo de envío');

  // WhatsApp order message formatting
  const formattedMsg = checkoutModule.formatWhatsAppOrderMessage({
    restaurantName: 'Parrilla El Charrúa',
    customerName: 'Santiago',
    mode: 'LOCAL',
    tableNumber: '4',
    currency: '$',
    items: [{ dish: { name: 'Asado Criollo', price: 800 }, qty: 1 }],
    subtotal: 800,
    deliveryFee: 0,
    discountAmount: 0,
    total: 800
  });

  assert.ok(formattedMsg.includes('PARRILLA EL CHARRÚA'));
  assert.ok(formattedMsg.includes('Mesa 4'));
  assert.ok(formattedMsg.includes('Asado Criollo'));
  assert.ok(formattedMsg.includes('TOTAL: $ 800.00'));
  console.log('✓ Módulo orderCheckout (WhatsApp, cupones y división de cuenta) validado');

  // 4. Test cartOperations logic
  const cartOpsModule = await import('../public/js/menu/cartOperations.js');
  const sampleDish = { id: 'dish_empanadas', name: 'Empanadas Caseras', price: 120 };
  const sampleModifierGroups = [
    {
      id: 'grp_sabores',
      name: 'Sabores',
      active: true,
      kind: 'flavor',
      selectionMode: 'single',
      options: [
        { id: 'opt_carne', name: 'Carne Suave', priceDeltaCents: 0 },
        { id: 'opt_queso', name: 'Jamón y Queso', priceDeltaCents: 3000 } // +30 pesos
      ]
    }
  ];

  const resolvedGroups = cartOpsModule.getDishModifierGroups(
    { ...sampleDish, modifierGroupIds: ['grp_sabores'] },
    { modifierGroups: sampleModifierGroups }
  );
  assert.strictEqual(resolvedGroups.length, 1, 'Debe resolver el grupo de modificadores asignado');
  assert.strictEqual(resolvedGroups[0].id, 'grp_sabores');

  // Test unit price with modifier delta
  const dishWithModifiers = { ...sampleDish, modifierGroupIds: ['grp_sabores'] };
  const itemWithChoice = {
    dish: dishWithModifiers,
    qty: 2,
    choices: [{ groupId: 'grp_sabores', selections: [{ optionId: 'opt_queso', quantity: 1 }] }]
  };
  const unitPrice = cartOpsModule.getCartUnitPrice(itemWithChoice, { modifierGroups: sampleModifierGroups });
  assert.strictEqual(unitPrice, 150, 'Precio unitario con modificador de +30 debe ser 150');

  // Test cart totals with coupon
  const cartTest = { 'item1': itemWithChoice };
  const totals = cartOpsModule.calculateCartTotals(cartTest, { modifierGroups: sampleModifierGroups }, 80, { type: 'percent', value: 10 }, 'DELIVERY');
  assert.strictEqual(totals.subtotal, 300, 'Subtotal de 2 empanadas a 150 debe ser 300');
  assert.strictEqual(totals.deliveryFee, 80, 'Envío debe ser 80');
  assert.strictEqual(totals.discountAmount, 30, 'Descuento 10% de 300 debe ser 30');
  assert.strictEqual(totals.total, 350, 'Total final debe ser 300 + 80 - 30 = 350');
  console.log('✓ Motor de modificadores, cálculo de precios y totales de carrito validado');

  // 5. Test menuModals module exports
  const modalsModule = await import('../public/js/menu/menuModals.js');
  assert.ok(typeof modalsModule.openWifiModal === 'function', 'openWifiModal debe existir');
  assert.ok(typeof modalsModule.stopCategoryTTS === 'function', 'stopCategoryTTS debe existir');
  assert.ok(typeof modalsModule.readSelectedCategoryTTS === 'function', 'readSelectedCategoryTTS debe existir');
  assert.ok(typeof modalsModule.initPushPrompt === 'function', 'initPushPrompt debe existir');
  assert.ok(typeof modalsModule.shareRestaurantUrl === 'function', 'shareRestaurantUrl debe existir');
  console.log('✓ Módulo de accesibilidad TTS, modales auxiliares y push notifications validado');

  // 6. Test eventGuestMode module
  const eventModeModule = await import('../public/js/menu/eventGuestMode.js');
  const weddingTheme = eventModeModule.resolveEventTheme({ businessType: 'events' }, '?event=wedding');
  assert.strictEqual(weddingTheme, 'theme-wedding', 'Modo boda debe resolver a theme-wedding');

  const cumpleTheme = eventModeModule.resolveEventTheme({ businessType: 'events' }, '?event=cumple_15');
  assert.strictEqual(cumpleTheme, 'theme-cumple15', 'Modo 15 debe resolver a theme-cumple15');

  const cateringTheme = eventModeModule.resolveEventTheme({ businessType: 'events' }, '?event=catering');
  assert.strictEqual(cateringTheme, 'theme-catering', 'Modo catering debe resolver a theme-catering');

  const guestCtx = eventModeModule.parseGuestContext('?invitado=Valeria&mesa=12&qr=token_xyz');
  assert.strictEqual(guestCtx.guestName, 'Valeria');
  assert.strictEqual(guestCtx.tableNumber, '12');

  const reservationMsg = eventModeModule.formatReservationWhatsAppMessage({
    restaurantName: 'La Pergola Eventos',
    name: 'Carolina',
    date: '2026-10-15',
    time: '21:00',
    guests: 4
  });
  assert.ok(reservationMsg.includes('LA PERGOLA EVENTOS'));
  assert.ok(reservationMsg.includes('Carolina'));
  assert.ok(reservationMsg.includes('2026-10-15'));
  assert.ok(reservationMsg.includes('*Comensales:* 4'));
  console.log('✓ Módulo de eventos, resolución de temas y reservas WhatsApp validado');

  // 7. Test menu-modules.js integration
  const menuModulesSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu-modules.js'), 'utf8');
  assert.ok(menuModulesSrc.includes('/js/menu/smartReviews.js'), 'menu-modules.js debe importar smartReviews.js');
  assert.ok(menuModulesSrc.includes('/js/menu/virtualWaiterHeuristics.js'), 'menu-modules.js debe importar virtualWaiterHeuristics.js');
  assert.ok(menuModulesSrc.includes('/js/menu/orderCheckout.js'), 'menu-modules.js debe importar orderCheckout.js');
  assert.ok(menuModulesSrc.includes('/js/menu/cartOperations.js'), 'menu-modules.js debe importar cartOperations.js');
  assert.ok(menuModulesSrc.includes('/js/menu/menuModals.js'), 'menu-modules.js debe importar menuModals.js');
  assert.ok(menuModulesSrc.includes('/js/menu/eventGuestMode.js'), 'menu-modules.js debe importar eventGuestMode.js');
  console.log('✓ Enlace de todos los módulos en menu-modules.js verificado');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE COMPONENTIZACIÓN DE MENU PASARON AL 100%!');
}

runMenuComponentizationTests().catch(err => {
  console.error('❌ Error en pruebas de componentización:', err);
  process.exit(1);
});
