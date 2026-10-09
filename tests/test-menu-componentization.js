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

  // 7. Test barrel export menu/index.js
  const menuIndexModule = await import('../public/js/menu/index.js');
  assert.ok(typeof menuIndexModule.openSmartReviewModal === 'function', 'index.js debe re-exportar openSmartReviewModal');
  assert.ok(typeof menuIndexModule.analyzeCartContextForUpsell === 'function', 'index.js debe re-exportar analyzeCartContextForUpsell');
  assert.ok(typeof menuIndexModule.calculateSplitPerPerson === 'function', 'index.js debe re-exportar calculateSplitPerPerson');
  assert.ok(typeof menuIndexModule.getCartUnitPrice === 'function', 'index.js debe re-exportar getCartUnitPrice');
  assert.ok(typeof menuIndexModule.openWifiModal === 'function', 'index.js debe re-exportar openWifiModal');
  assert.ok(typeof menuIndexModule.resolveEventTheme === 'function', 'index.js debe re-exportar resolveEventTheme');
  assert.ok(typeof menuIndexModule.buildCustomFlavors === 'function', 'index.js debe re-exportar buildCustomFlavors (sabores de heladería)');
  assert.ok(typeof menuIndexModule.buildPerfumeryCatalog === 'function', 'index.js debe re-exportar buildPerfumeryCatalog (catálogo de perfumería)');
  assert.ok(typeof menuIndexModule.computeTipAmount === 'function', 'index.js debe re-exportar computeTipAmount (propina del comensal)');
  console.log('✓ Barrel export public/js/menu/index.js verificado y unificado');

  // 8. Test menu-modules.js integration
  const menuModulesSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu-modules.js'), 'utf8');
  const menuMainSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(menuModulesSrc.includes('/js/menu/smartReviews.js'), 'menu-modules.js debe importar smartReviews.js');
  assert.ok(menuModulesSrc.includes('/js/menu/virtualWaiterHeuristics.js'), 'menu-modules.js debe importar virtualWaiterHeuristics.js');
  assert.ok(menuModulesSrc.includes('/js/menu/orderCheckout.js'), 'menu-modules.js debe importar orderCheckout.js');
  assert.ok(menuModulesSrc.includes('/js/menu/cartOperations.js'), 'menu-modules.js debe importar cartOperations.js');
  assert.ok(menuModulesSrc.includes('/js/menu/menuModals.js'), 'menu-modules.js debe importar menuModals.js');
  assert.ok(menuModulesSrc.includes('/js/menu/eventGuestMode.js'), 'menu-modules.js debe importar eventGuestMode.js');
  assert.ok(menuModulesSrc.includes('/js/menu/iceCreamHeuristics.js'), 'menu-modules.js debe importar iceCreamHeuristics.js (sabores reales, no demo)');
  assert.ok(menuModulesSrc.includes('/js/menu/perfumeryHeuristics.js'), 'menu-modules.js debe importar perfumeryHeuristics.js (catálogo real, no demo)');
  assert.ok(menuModulesSrc.includes('/js/menu/index.js'), 'menu-modules.js debe importar index.js');
  assert.ok(menuModulesSrc.includes('window.togglePerfumeryMode = function()'), 'menu-modules.js debe registrar el interruptor de perfumería en window');
  assert.ok(menuModulesSrc.includes('window.toggleGroupConsolidatedView = function()'), 'menu-modules.js debe registrar la vista consolidada grupal en window');
  assert.ok(!/^[\t ]*togglePerfumeryMode,$/m.test(menuMainSrc), 'menu.js no debe exponer como local una función registrada solo en window');
  assert.ok(!/^[\t ]*removeFromCart,$/m.test(menuMainSrc), 'menu.js no debe exponer funciones de carrito inexistentes');
  assert.ok(!/^[\t ]*toggleGroupConsolidatedView,$/m.test(menuMainSrc), 'menu.js no debe exponer como local una función registrada solo en window');
  console.log('✓ Enlace de todos los módulos en menu-modules.js verificado');

  // 9. Regression: todo handler inline (menu.html + HTML generado por menu.js)
  //    debe ser alcanzable desde window, si no los botones lanzan ReferenceError.
  const menuHtmlSrc = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
  const assignMatch = menuMainSrc.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\);/);
  assert.ok(assignMatch, 'menu.js debe exponer funciones interactivas con Object.assign(window, {...})');

  const exposed = new Set(
    [...assignMatch[1].matchAll(/^\s*([A-Za-z_$][\w$]*)\s*,?\s*(?:\/\/.*)?$/gm)].map(m => m[1])
  );
  for (const m of menuModulesSrc.matchAll(/window\.([A-Za-z_$][\w$]*)\s*=/g)) exposed.add(m[1]);

  const JS_KEYWORDS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'new', 'void', 'delete', 'do', 'else', 'try', 'function']);
  const collectInlineHandlers = (src) => {
    const names = new Set();
    const withoutInterpolations = src.replace(/\$\{[\s\S]*?\}/g, '');
    for (const attr of withoutInterpolations.matchAll(/\son(?:click|change|input|submit)="([^"]*)"/g)) {
      for (const call of attr[1].matchAll(/(?<![.$\w])[A-Za-z_$][\w$]*(?=\s*\()/g)) {
        if (!JS_KEYWORDS.has(call[0])) names.add(call[0]);
      }
    }
    return names;
  };

  const missing = [...new Set([...collectInlineHandlers(menuHtmlSrc), ...collectInlineHandlers(menuMainSrc)])]
    .filter(name => !exposed.has(name));
  assert.deepStrictEqual(
    missing, [],
    `Handlers inline sin exponer en window (dispararían ReferenceError al hacer clic): ${missing.join(', ')}`
  );
  console.log(`✓ ${exposed.size} funciones expuestas en window: handlers inline de menu.html y menu.js 100% resueltos`);

  // 10. Puente window ↔ estado del módulo: menu-modules.js lee window.restaurantData
  //     (GroupCartManager, wizards, i18n) y escribe window.cart; deben apuntar al estado real.
  assert.ok(/restaurantData:\s*\{\s*get:/.test(menuMainSrc),
    'menu.js debe exponer window.restaurantData vía getter (lo consume menu-modules.js)');
  assert.ok(/cart:\s*\{\s*get:[\s\S]*?set:/.test(menuMainSrc),
    'menu.js debe exponer window.cart con getter y setter (los wizards escriben en el carrito real)');
  console.log('✓ Puente window.restaurantData / window.cart definido en menu.js');

  // 11. iceCreamHeuristics: sabores REALES de la carta (cero demo)
  const iceModule = await import('../public/js/menu/iceCreamHeuristics.js');
  assert.strictEqual(typeof iceModule.buildCustomFlavors, 'function', 'buildCustomFlavors debe existir');
  assert.strictEqual(typeof iceModule.detectFlavorDishes, 'function', 'detectFlavorDishes debe existir');
  assert.strictEqual(typeof iceModule.resolveFlavorCategoryName, 'function', 'resolveFlavorCategoryName debe existir');

  // Heladería con categorías típicas (sin la palabra "helad"): usa TODA la carta real
  const heladeria = {
    allowIceCreamWizard: true,
    categories: [
      { id: 'c1', name: 'Cremas' },
      { id: 'c2', name: 'Chocolates' },
      { id: 'c3', name: 'Frutales' }
    ],
    dishes: [
      { id: 'f1', name: 'Vainilla Americana', price: 120, categoryId: 'c1' },
      { id: 'f2', name: 'Chocolate Amargo', price: 140, categoryId: 'c2', tags: ['star'] },
      { id: 'f3', name: 'Frutilla a la Crema', price: 130, categoryId: 'c3', outOfStock: true }
    ]
  };
  const flavors = iceModule.buildCustomFlavors(heladeria);
  assert.strictEqual(flavors.length, 3, 'Heladería con categorías típicas usa su carta real (no el demo)');
  assert.strictEqual(flavors.find(f => f.id === 'f1').categoryName, 'Cremas', '"Cremas" mapea al balde Cremas');
  assert.strictEqual(flavors.find(f => f.id === 'f2').categoryName, 'Chocolates');
  assert.strictEqual(flavors.find(f => f.id === 'f3').categoryName, 'Frutales');
  assert.strictEqual(flavors.find(f => f.id === 'f3').outOfStock, true, 'outOfStock se propaga al wizard');
  assert.deepStrictEqual(flavors.find(f => f.id === 'f2').tags, ['star'], 'Los tags se propagan');

  // Restaurante común SIN pistas: no inventa sabores (evita el catálogo demo)
  assert.deepStrictEqual(
    iceModule.buildCustomFlavors({
      categories: [{ id: 'x', name: 'Principales' }],
      dishes: [{ id: 'd', name: 'Milanesa Napolitana', price: 300, categoryId: 'x' }]
    }),
    [],
    'Un restaurante común no debe exponer sabores de heladería'
  );

  // Restaurante común con categoría "Helados": detecta SOLO esos platos
  const detected = iceModule.detectFlavorDishes({
    categories: [{ id: 'p', name: 'Principales' }, { id: 'h', name: 'Helados Artesanales' }],
    dishes: [
      { id: 'm', name: 'Milanesa', categoryId: 'p' },
      { id: 'h1', name: 'Dulce de Leche Granizado', categoryId: 'h' }
    ]
  });
  assert.deepStrictEqual(detected.map(d => d.id), ['h1'], 'Sólo los platos de la categoría de helados');

  assert.strictEqual(iceModule.resolveFlavorCategoryName('Dulce de Leche Clásico'), 'Dulces de Leche');
  assert.strictEqual(iceModule.resolveFlavorCategoryName('Especiales de Autor'), 'Especiales');
  assert.strictEqual(iceModule.resolveFlavorCategoryName(''), 'Carta de la Casa');

  // Una categoría "Bebidas Heladas" (milkshakes) NO es un sabor, aunque diga "helad".
  const conBebidas = iceModule.buildCustomFlavors({
    allowIceCreamWizard: true,
    categories: [
      { id: 'h', name: 'Helados Artesanales' },
      { id: 'b', name: 'Bebidas Heladas' }
    ],
    dishes: [
      { id: 'h1', name: 'Dulce de Leche Granizado', price: 120, categoryId: 'h' },
      { id: 'b1', name: 'Milkshake de Frutilla', price: 200, categoryId: 'b' }
    ]
  });
  assert.deepStrictEqual(conBebidas.map(f => f.id), ['h1'], 'Las bebidas heladas no se ofrecen como sabores de helado');
  console.log('✓ Heurística de sabores de heladería: carta real, categorías mapeadas, cero demo');

  // 12. perfumeryHeuristics: catálogo data-driven (id real → cotiza bien, sin demo)
  const perfModule = await import('../public/js/menu/perfumeryHeuristics.js');
  assert.strictEqual(typeof perfModule.buildPerfumeryCatalog, 'function', 'buildPerfumeryCatalog debe existir');
  assert.strictEqual(typeof perfModule.resolvePerfumeFamily, 'function', 'resolvePerfumeFamily debe existir');
  assert.strictEqual(typeof perfModule.resolvePerfumeConcentration, 'function', 'resolvePerfumeConcentration debe existir');

  const perfumeria = {
    businessType: 'perfumery',
    categories: [
      { id: 'pc1', name: 'Fragancias Cítricas' },
      { id: 'pc2', name: 'Gourmand & Brumas' }
    ],
    dishes: [
      { id: 'd_perf_1', name: 'Aqua Riviera (EDT)', price: 1750, categoryId: 'pc1', description: 'Fresca', tags: ['star'] },
      { id: 'd_perf_2', name: 'Vanille Noire (Body Splash)', price: 1250, categoryId: 'pc2' }
    ]
  };
  const catalog = perfModule.buildPerfumeryCatalog(perfumeria);
  assert.strictEqual(catalog.length, 2, 'El catálogo usa los platos reales de la perfumería');
  const first = catalog.find(p => p.id === 'd_perf_1');
  assert.strictEqual(first.cartDishId, 'd_perf_1', 'El id del carrito es el id REAL de la carta (cotiza bien)');
  assert.strictEqual(first.family, 'Cítrico', 'La categoría "Cítricas" mapea a familia Cítrico');
  assert.strictEqual(first.concentration, 'EDT', 'Detecta EDT desde el nombre');
  assert.strictEqual(first.prices['Único'], 1750, 'El precio es el del dueño (no el demo)');
  assert.strictEqual(first.pyramid, null, 'Sin pirámide demo; la vista la oculta');
  const second = catalog.find(p => p.id === 'd_perf_2');
  assert.strictEqual(second.family, 'Gourmand');
  assert.strictEqual(second.concentration, 'Body Splash');

  // Perfumería sin carta cargada: catálogo vacío (estado honesto, sin demo)
  assert.deepStrictEqual(perfModule.buildPerfumeryCatalog({ dishes: [] }), [], 'Sin carta no inventa fragancias');
  assert.deepStrictEqual(
    perfModule.buildPerfumeryCatalog({ dishes: [{ id: 'x', name: 'Sin precio', categoryId: 'c' }] }),
    [],
    'Un plato sin precio se descarta del catálogo'
  );

  assert.strictEqual(perfModule.resolvePerfumeFamily('Fragancias Amaderadas'), 'Amaderado');
  assert.strictEqual(perfModule.resolvePerfumeFamily('Perfumes de Nicho'), 'Oriental');
  assert.strictEqual(perfModule.resolvePerfumeFamily('Categoría rara'), 'Autor');
  assert.strictEqual(perfModule.resolvePerfumeConcentration('Eau de Parfum Intense'), 'EDP');
  assert.strictEqual(perfModule.resolvePerfumeConcentration('Aqua Fresca'), '');
  console.log('✓ Catálogo de perfumería data-driven: id real de carta, familia/concentración mapeadas, cero demo');

  // 13. tipCalculator: propina opcional (porcentaje / monto fijo, sin negativos)
  const tipModule = await import('../public/js/menu/tipCalculator.js');
  assert.strictEqual(typeof tipModule.computeTipAmount, 'function', 'computeTipAmount debe existir');
  assert.deepStrictEqual(tipModule.TIP_PERCENT_PRESETS, [0, 5, 10, 15], 'Presets de propina 0/5/10/15');
  assert.strictEqual(tipModule.computeTipAmount(1000, 10), 100, '10% de 1000 = 100');
  assert.strictEqual(tipModule.computeTipAmount(1000, 15), 150, '15% de 1000 = 150');
  assert.strictEqual(tipModule.computeTipAmount(333, 10), 33.3, 'Redondea a 2 decimales');
  assert.strictEqual(tipModule.computeTipAmount(1000, 0), 0, 'Sin propina = 0');
  assert.strictEqual(tipModule.computeTipAmount(0, 10), 0, 'Sin base no hay propina');
  assert.strictEqual(tipModule.computeTipAmount(1000, 10, 250), 250, 'El monto fijo tiene prioridad sobre el porcentaje');
  assert.strictEqual(tipModule.computeTipAmount(1000, 10, '0'), 0, 'Monto fijo explícito en 0 => sin propina');
  assert.strictEqual(tipModule.computeTipAmount(1000, -5), 0, 'Porcentaje negativo => 0 (nunca propina negativa)');
  assert.strictEqual(tipModule.computeTipAmount(1000, 0, -50), 0, 'Monto fijo negativo => 0');
  assert.strictEqual(tipModule.computeTipAmount(null, 10), 0, 'Base inválida => 0');
  console.log('✓ Propina opcional: porcentaje/monto fijo, nunca negativa, base = subtotal');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE COMPONENTIZACIÓN DE MENU PASARON AL 100%!');
}

runMenuComponentizationTests().catch(err => {
  console.error('❌ Error en pruebas de componentización:', err);
  process.exit(1);
});
