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

  // 14. i18n: el selector de idioma sólo existe si hay traducciones reales
  const i18nModule = await import('../public/js/components/I18nCurrencyManager.js');
  assert.strictEqual(typeof i18nModule.detectAvailableLanguages, 'function', 'detectAvailableLanguages debe existir');
  assert.deepStrictEqual(
    i18nModule.detectAvailableLanguages({ dishes: [{ id: 'a', name: 'Milanesa' }] }),
    ['es'],
    'Sin traducciones sólo queda el idioma base (el selector se oculta)'
  );
  assert.deepStrictEqual(
    i18nModule.detectAvailableLanguages({ dishes: [{ id: 'a', translations: { en: { name: 'Schnitzel' } } }] }),
    ['es', 'en'],
    'Un plato con traducción en inglés habilita el idioma'
  );
  assert.deepStrictEqual(
    i18nModule.detectAvailableLanguages({ dishes: [{ id: 'a', translations: { en: { name: '   ' }, pt: { name: 'X' } } }] }),
    ['es', 'pt'],
    'Una traducción vacía no cuenta como idioma disponible'
  );
  assert.deepStrictEqual(
    i18nModule.detectAvailableLanguages({ availableLanguages: ['es', 'pt'] }),
    ['es', 'pt'],
    'Un array explícito availableLanguages también habilita idiomas'
  );
  // El render no debe hardcodear las pastillas ES/EN/PT: usa el desplegable 🌐.
  const i18nSrc = fs.readFileSync(path.join(__dirname, '../public/js/components/I18nCurrencyManager.js'), 'utf8');
  assert.ok(i18nSrc.includes('detectAvailableLanguages('), 'renderControlsBar debe derivar los idiomas del restaurante');
  assert.ok(i18nSrc.includes('data-js-click="i18nManager.toggleLanguageMenu"'), 'El ícono 🌐 debe desplegar el menú de idiomas');
  assert.ok(i18nSrc.includes('i18n-lang-menu'), 'Debe existir el menú flotante de idiomas');
  console.log('✓ i18n: selector 🌐 desplegable y oculto cuando no hay traducciones configuradas');

  // 15. Armador de helado: divulgación progresiva (tamaño → sabores)
  const wizardSrc = fs.readFileSync(path.join(__dirname, '../public/js/components/IceCreamWizard.js'), 'utf8');
  assert.ok(wizardSrc.includes('id="iceCreamFlavorsSection" hidden'), 'Los sabores deben arrancar ocultos');
  assert.ok(wizardSrc.includes('id="iceCreamToppingsSection" hidden'), 'Los toppings deben arrancar ocultos');
  assert.ok(wizardSrc.includes('this.sizeChosen = false'), 'El armador arranca sin tamaño elegido');
  assert.ok(wizardSrc.includes('updateFlowVisibility()'), 'updateFlowVisibility debe revelar sabores al elegir tamaño');
  assert.ok(wizardSrc.includes("line.textContent = 'Elegí un tamaño para empezar'"), 'El resumen debe pedir el tamaño primero');
  console.log('✓ Armador de helado: sabores y toppings recién aparecen tras elegir el tamaño');

  // 16. Itinerario visual de boda: módulo puro + render data-driven con escape
  const wedModule = await import('../public/js/menu/weddingItinerary.js');
  assert.strictEqual(typeof wedModule.sanitizeWeddingItinerary, 'function', 'sanitizeWeddingItinerary debe existir');
  assert.strictEqual(typeof wedModule.renderWeddingItineraryHTML, 'function', 'renderWeddingItineraryHTML debe existir');
  // Sanitiza: capa items a 12, recorta strings, descarta vacíos, icono por defecto
  const dirtyIt = {
    enabled: true, title: 'T'.repeat(99), coupleNames: 'Mora & Alex', date: '5/6/2029', venue: 'Salón X',
    items: [{ time: '18:00', title: 'Recepción', icon: '🥂' }]
      .concat(Array.from({ length: 20 }, (_, i) => ({ time: `2${i}:00`, title: `Momento ${i}` })))
      .concat([{ time: '', title: '' }])
  };
  const cleanIt = wedModule.sanitizeWeddingItinerary(dirtyIt);
  assert.strictEqual(cleanIt.items.length, 12, 'El itinerario se capa a 12 momentos');
  assert.ok(cleanIt.title.length <= 60, 'El título se recorta a 60');
  assert.strictEqual(cleanIt.items[0].icon, '🥂', 'Se preserva el icono configurado');
  assert.strictEqual(cleanIt.items[1].icon, '💛', 'Sin icono → fallback 💛');
  assert.deepStrictEqual(wedModule.sanitizeWeddingItinerary(null).items, [], 'Basura → itinerario vacío apagado');
  assert.strictEqual(wedModule.sanitizeWeddingItinerary(null).enabled, false, 'Basura → enabled false');
  // Render: timeline con tiempos/títulos, escape XSS, apagado → ''
  const wedHtml = wedModule.renderWeddingItineraryHTML({
    enabled: true, title: 'Programa de Boda', coupleNames: 'Mora & Alex',
    items: [{ time: '18:00', title: 'Recepción', icon: '🥂' }]
  }, (s) => String(s).replace(/</g, '&lt;'));
  assert.ok(wedHtml.includes('wed-it-timeline'), 'Debe renderizar la línea de tiempo');
  assert.ok(wedHtml.includes('18:00') && wedHtml.includes('Recepción'), 'Tiempos y momentos visibles');
  assert.ok(wedHtml.includes('Mora & Alex'), 'Nombres de la pareja visibles');
  const xssHtml = wedModule.renderWeddingItineraryHTML({
    enabled: true, items: [{ time: '18:00', title: '<script>alert(1)</script>' }]
  });
  assert.ok(!xssHtml.includes('<script>'), 'El título del momento se escapa (XSS)');
  assert.strictEqual(wedModule.renderWeddingItineraryHTML({ enabled: false, items: [{ time: '1', title: 'X' }] }), '', 'Apagado → HTML vacío');
  assert.strictEqual(wedModule.renderWeddingItineraryHTML({ enabled: true, items: [] }), '', 'Sin momentos → HTML vacío');
  // Cableado: barrel + menú + sección + estilos + Studio + backend
  const barrelSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/index.js'), 'utf8');
  assert.ok(barrelSrc.includes("export * from './weddingItinerary.js'"), 'El barrel debe exportar weddingItinerary');
  assert.ok(barrelSrc.includes("export * from './menuPresentation.js'"), 'El barrel debe exportar menuPresentation');
  const menuSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(menuSrc.includes('renderWeddingItineraryHTMLMod'), 'menu.js debe importar el render del itinerario');
  assert.ok(menuSrc.includes('function renderWeddingItinerary()'), 'menu.js debe definir renderWeddingItinerary()');
  assert.ok(menuHtmlSrc.includes('id="weddingItinerarySection"'), 'menu.html debe tener el contenedor de la sección');
  const menuCssSrc = fs.readFileSync(path.join(__dirname, '../public/css/menu.css'), 'utf8');
  assert.ok(menuCssSrc.includes('.wed-it-timeline'), 'menu.css debe tener los estilos del timeline');
  assert.ok(menuCssSrc.includes('.wed-it-node'), 'menu.css debe tener los nodos del timeline');
  const studioHtmlSrc = fs.readFileSync(path.join(__dirname, '../public/studio.html'), 'utf8');
  assert.ok(studioHtmlSrc.includes('id="weddingItinerarySection"'), 'Studio debe tener el editor del itinerario');
  assert.ok(studioHtmlSrc.includes('data-js-click="addWeddingItineraryItem"'), 'Studio: botón agregar momento sin on*=');
  const studioSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  assert.ok(studioSrc.includes('function renderWeddingItineraryRows()'), 'Studio: render de filas del itinerario');
  assert.ok(studioSrc.includes('addWeddingItineraryItem, removeWeddingItineraryItem'), 'Studio: handlers exportados a window');
  console.log('✓ Itinerario de boda: sanitize/render puros, timeline con escape, cableado menú+Studio+CSS');

  // 17. Precios $0: sin cifras en carta, carrito, sugerencias ni WhatsApp
  const presModule = await import('../public/js/menu/menuPresentation.js');
  assert.strictEqual(typeof presModule.isFreePrice, 'function', 'isFreePrice debe existir');
  for (const v of [0, '0', 0.0, null, undefined, '', '  ', 'abc', NaN]) {
    assert.strictEqual(presModule.isFreePrice(v), true, `isFreePrice(${JSON.stringify(v)}) debe ser true`);
  }
  for (const v of [1, 490, '25.5', 0.01, -5]) {
    assert.strictEqual(presModule.isFreePrice(v), false, `isFreePrice(${JSON.stringify(v)}) debe ser false`);
  }
  // Call sites en menu.js: carta, chef, carrito, barra, totales, upsell
  assert.ok(menuSrc.includes('isFreePriceMod(effectivePrice)'), 'Chef specials: gate de precio sin costo');
  assert.ok(menuSrc.includes('const isFreeDish = isFreePriceMod(effectivePrice)'), 'Dish card: gate de precio sin costo');
  assert.ok(menuSrc.includes('const itemIsFree = isFreePriceMod(unitPrice)'), 'Carrito: línea sin cifras si es gratis');
  assert.ok(menuSrc.includes('Ver Pedido →'), 'Barra flotante: sin ($0) cuando el pedido es gratis');
  assert.ok(menuSrc.includes('formatTotalOrFree(total)'), 'Totales: "Sin costo" en vez de $0');
  assert.ok(menuSrc.includes('const upsellIsFree = isFreePriceMod(dish.price)'), 'Upsell del menú: sin cifra si es gratis');
  // WhatsApp: ítems gratis sin precio + pedido gratis sin Subtotal/TOTAL $0
  const freeMsg = checkoutModule.formatWhatsAppOrderMessage({
    restaurantName: 'Boda Mora & Alex', customerName: 'Invitado', mode: 'LOCAL',
    tableNumber: '5', paymentMethod: 'Efectivo', currency: '$',
    items: [{ dish: { name: 'Focaccia de cortesía', price: 0 }, qty: 2 }],
    subtotal: 0, deliveryFee: 0, discountAmount: 0, total: 0
  });
  assert.ok(freeMsg.includes('2x Focaccia de cortesía'), 'El ítem gratis aparece en el mensaje');
  assert.ok(!freeMsg.includes('$ 0'), 'Sin "$ 0" en el mensaje del pedido gratis');
  assert.ok(!freeMsg.includes('TOTAL:'), 'Sin línea TOTAL en el pedido gratis');
  assert.ok(freeMsg.includes('Pedido sin costo'), 'El pedido gratis se declara sin costo');
  const mixedMsg = checkoutModule.formatWhatsAppOrderMessage({
    restaurantName: 'R', customerName: 'C', mode: 'LOCAL', tableNumber: '1',
    paymentMethod: 'Efectivo', currency: '$',
    items: [{ dish: { name: 'Agua', price: 0 }, qty: 1 }, { dish: { name: 'Pizza', price: 500 }, qty: 1 }],
    subtotal: 500, deliveryFee: 0, discountAmount: 0, total: 500
  });
  assert.ok(mixedMsg.includes('▪ 1x Agua\n'), 'Ítem gratis mixto: sin guion de precio');
  assert.ok(mixedMsg.includes('TOTAL:'), 'Pedido con cargo: TOTAL presente');
  // Componentes: VirtualWaiter + cross-sell del modal sin $0
  const waiterCompSrc = fs.readFileSync(path.join(__dirname, '../public/js/components/VirtualWaiter.js'), 'utf8');
  assert.ok(waiterCompSrc.includes('dishIsFree'), 'VirtualWaiter: oculta precio $0 en sugerencias');
  const waiterHeuSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/virtualWaiterHeuristics.js'), 'utf8');
  assert.ok(waiterHeuSrc.includes("import { isFreePrice } from './menuPresentation.js'"), 'Cross-sell usa el helper puro');
  console.log('✓ Precios $0: sin cifras en carta/carrito/sugerencias/WhatsApp, botón pedir intacto');

  // 18. Notas por rubro: la heladería ya no sugiere "sin cebolla"
  assert.strictEqual(typeof presModule.getDishNoteCopy, 'function', 'getDishNoteCopy debe existir');
  const helaCopy = presModule.getDishNoteCopy({ businessType: 'heladeria', allowIceCreamWizard: true });
  assert.ok(!helaCopy.placeholder.toLowerCase().includes('cebolla'), 'Heladería: placeholder sin "cebolla"');
  assert.ok(!helaCopy.placeholder.toLowerCase().includes('aderezo'), 'Heladería: placeholder sin "aderezo"');
  assert.ok(helaCopy.label.toLowerCase().includes('helado'), 'Heladería: etiqueta propia del rubro');
  const restoCopy = presModule.getDishNoteCopy({ businessType: 'restaurant' });
  assert.ok(restoCopy.placeholder.toLowerCase().includes('cebolla'), 'Restaurante: conserva el ejemplo de cocina');
  const perfCopy = presModule.getDishNoteCopy({ businessType: 'perfumery' });
  assert.ok(!perfCopy.placeholder.toLowerCase().includes('cebolla'), 'Perfumería: sin ejemplo de cocina');
  const eventsCopy = presModule.getDishNoteCopy({ businessType: 'events' });
  assert.ok(eventsCopy.label.length > 0 && eventsCopy.placeholder.length > 0, 'Eventos: copy de notas no vacío');
  assert.ok(menuSrc.includes('getDishNoteCopyMod(restaurantData'), 'openDishNoteModal aplica el copy por rubro');
  assert.ok(menuHtmlSrc.includes('sin cebolla, aderezo aparte'), 'El default estático del HTML sigue siendo el de restaurante');
  console.log('✓ Notas por rubro: heladería/perfumería/eventos con placeholder propio, restaurante intacto');

  // 19. Itinerario en vivo: progreso por hora real (pasado/ahora/siguiente)
  assert.strictEqual(typeof wedModule.parseItineraryTime, 'function', 'parseItineraryTime debe existir');
  assert.strictEqual(typeof wedModule.resolveItineraryProgress, 'function', 'resolveItineraryProgress debe existir');
  assert.strictEqual(wedModule.parseItineraryTime('18:00'), 1080, 'HH:MM → minutos');
  assert.strictEqual(wedModule.parseItineraryTime('00:15'), 15, 'Medianoche válida');
  assert.strictEqual(wedModule.parseItineraryTime('9.30'), 570, 'Acepta punto como separador');
  assert.strictEqual(wedModule.parseItineraryTime('18h00'), 1080, 'Acepta h como separador');
  assert.strictEqual(wedModule.parseItineraryTime('abc'), null, 'Texto → null');
  assert.strictEqual(wedModule.parseItineraryTime(''), null, 'Vacío → null');
  assert.strictEqual(wedModule.parseItineraryTime('25:00'), null, 'Hora imposible → null');
  assert.strictEqual(wedModule.parseItineraryTime('18:99'), null, 'Minutos imposibles → null');
  const liveItems = [
    { time: '18:00', title: 'Recepción', icon: '🥂' },
    { time: '19:30', title: 'Cena', icon: '🍽️' },
    { time: '00:15', title: 'Fin', icon: '🌙' }
  ];
  const at = (iso) => new Date(iso);
  // En curso a las 20:00 del día del evento (acarreo nocturno del 00:15)
  let st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-05T20:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'live', '20:00 del eventDay → live');
  assert.strictEqual(st.currentIndex, 1, 'Momento actual = Cena');
  assert.strictEqual(st.nextIndex, 2, 'Siguiente = Fin');
  assert.ok(st.progressPct > 0 && st.progressPct < 100, 'Avance parcial 0-100');
  // Madrugada siguiente: sigue en vivo por el acarreo (00:15 + gracia)
  st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-06T00:30:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'live', '00:30 del día siguiente → live por acarreo nocturno');
  assert.strictEqual(st.currentIndex, 2, 'Momento actual = Fin');
  // Temprano el mismo día: upcoming con siguiente
  st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-05T10:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'upcoming', '10:00 → upcoming');
  assert.strictEqual(st.nextIndex, 0, 'Siguiente = primer momento');
  // Al día siguiente a la mañana: finished
  st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-06T08:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'finished', 'Día siguiente de mañana → finished');
  assert.strictEqual(st.progressPct, 100, 'Avance 100 al terminar');
  // Días antes: countdown; días después: finished
  st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-02T12:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'countdown', '3 días antes → countdown');
  assert.strictEqual(st.daysLeft, 3, 'daysLeft = 3');
  st = wedModule.resolveItineraryProgress(liveItems, at('2029-06-10T12:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'finished', 'Días después → finished');
  // Sin fecha: heurística del día (misma lógica con hoy)
  st = wedModule.resolveItineraryProgress(
    [{ time: '00:00', title: 'A', icon: 'x' }, { time: '23:59', title: 'B', icon: 'y' }],
    at('2029-06-05T12:00:00'), ''
  );
  assert.strictEqual(st.mode, 'live', 'Sin eventDay usa el día actual');
  assert.strictEqual(st.currentIndex, 0, 'Al mediodía el actual es el primero');
  // Sin horas válidas: static
  st = wedModule.resolveItineraryProgress([{ time: '', title: 'X' }, { time: 'abc', title: 'Y' }], at('2029-06-05T20:00:00'), '2029-06-05');
  assert.strictEqual(st.mode, 'static', 'Sin horas parseables → static');
  // Render en vivo: badge AHORA + aria-current + píldora + barra
  const liveHtml = wedModule.renderWeddingItineraryHTML({
    enabled: true, title: 'Programa', coupleNames: 'M&E', eventDay: '2029-06-05',
    items: liveItems
  }, (s) => String(s), at('2029-06-05T20:00:00'));
  assert.ok(liveHtml.includes('is-now'), 'El momento actual lleva is-now');
  assert.ok(liveHtml.includes('AHORA'), 'Badge AHORA visible');
  assert.ok(liveHtml.includes('aria-current="true"'), 'aria-current en el momento actual');
  assert.ok(liveHtml.includes('En vivo'), 'Píldora En vivo en el header');
  assert.ok(liveHtml.includes('role="progressbar"'), 'Barra de avance con rol');
  assert.ok(liveHtml.includes('is-past'), 'Momentos pasados atenuados');
  assert.ok(liveHtml.includes('Siguiente'), 'Tag Siguiente en el próximo');
  // Render countdown: píldora sin timeline alterado
  const cdHtml = wedModule.renderWeddingItineraryHTML({
    enabled: true, title: 'Programa', eventDay: '2029-06-05', items: liveItems
  }, (s) => String(s), at('2029-06-02T12:00:00'));
  assert.ok(cdHtml.includes('Faltan 3 días'), 'Cuenta regresiva en el header');
  assert.ok(!cdHtml.includes('is-now'), 'Sin momento actual antes del evento');
  // Cableado del refresh: menu.js re-renderiza cada 30s + Studio pide el día + CSS de estados
  assert.ok(menuSrc.includes('weddingItineraryTimer'), 'menu.js gestiona el intervalo de re-render');
  assert.ok(menuSrc.includes('setInterval(renderWeddingItinerary, 30000)'), 'Refresh cada 30s');
  assert.ok(studioHtmlSrc.includes('id="inputWeddingDay"'), 'Studio: input de fecha del evento');
  assert.ok(menuCssSrc.includes('.wed-it-status'), 'CSS: píldora de estado');
  assert.ok(menuCssSrc.includes('.wed-it-progress'), 'CSS: barra de avance');
  assert.ok(menuCssSrc.includes('.wed-it-now-badge'), 'CSS: badge AHORA');
  assert.ok(menuCssSrc.includes('prefers-reduced-motion'), 'CSS: respeta reduced-motion');
  console.log('✓ Itinerario en vivo: pasado/ahora/siguiente, countdown, acarreo nocturno, refresh 30s');

  // 20. Marco floral del timeline: esquinas botánicas + divisor, todo inline
  const frameHtml = wedModule.renderWeddingItineraryHTML({
    enabled: true, title: 'Programa', items: [{ time: '18:00', title: 'X' }]
  }, (s) => String(s), at('2029-06-05T10:00:00'));
  for (const corner of ['is-tl', 'is-tr', 'is-bl', 'is-br']) {
    assert.ok(frameHtml.includes(`wed-it-corner ${corner}`), `Esquina floral ${corner} presente`);
  }
  assert.ok(frameHtml.includes('wed-it-divider'), 'Divisor floral entre header y timeline');
  assert.ok(menuCssSrc.includes('.wed-it-corner'), 'CSS: esquinas botánicas');
  assert.ok(menuCssSrc.includes('.wed-it-divider'), 'CSS: divisor floral');
  assert.ok(menuCssSrc.includes('data:image/svg+xml'), 'Marco 100% inline (SVG data-URI, sin imágenes externas)');
  assert.ok(menuCssSrc.includes('pointer-events: none'), 'Esquinas sin interacción (decorativas)');
  console.log('✓ Marco floral: 4 esquinas + divisor + doble marco, todo inline sin assets externos');

  // 21. Neón multi-acentos: 6 colores elegibles para el layout Neon Nightbar
  assert.deepStrictEqual(Object.keys(presModule.NEON_ACCENTS), ['mint', 'cyan', 'magenta', 'amber', 'lime', 'violet'], '6 acentos neón');
  for (const [key, cfg] of Object.entries(presModule.NEON_ACCENTS)) {
    assert.ok(/^#[0-9A-Fa-f]{6}$/.test(cfg.hex), `Acento ${key}: hex válido`);
    assert.ok(/^\d{1,3}, \d{1,3}, \d{1,3}$/.test(cfg.rgb), `Acento ${key}: rgb válido`);
    assert.ok(cfg.label.length > 0, `Acento ${key}: con etiqueta`);
  }
  assert.strictEqual(presModule.resolveNeonAccent('magenta'), 'magenta', 'Clave válida pasa');
  assert.strictEqual(presModule.resolveNeonAccent('CYAN'), 'cyan', 'Case-insensitive');
  assert.strictEqual(presModule.resolveNeonAccent('turquesa'), 'mint', 'Basura → mint');
  assert.strictEqual(presModule.resolveNeonAccent(''), 'mint', 'Vacío → mint');
  assert.strictEqual(presModule.resolveNeonAccent(null), 'mint', 'Null → mint');
  // CSS: una clase por acento con su --neon, bloque con variables
  const neonCss = menuCssSrc;
  for (const [key, cfg] of Object.entries(presModule.NEON_ACCENTS)) {
    assert.ok(neonCss.includes(`body.layout-neon.neon-${key}`), `CSS: clase neon-${key}`);
    assert.ok(neonCss.includes(`--neon: ${cfg.hex}`), `CSS: neon-${key} fija su ${cfg.hex}`);
  }
  assert.ok(neonCss.includes('--neon-rgb'), 'CSS: canal rgb para glows con alfa');
  assert.ok(neonCss.includes('rgba(var(--neon-rgb)'), 'CSS: glows consumen la variable');
  assert.ok(!neonCss.includes('rgba(0, 245, 212'), 'CSS: sin menta hardcodeado fuera del default');
  // menu.js: clase neon-<x> solo con layout neon (+ preview ?neon=)
  assert.ok(menuSrc.includes('resolveNeonAccentMod'), 'menu.js importa el resolver de acento');
  assert.ok(menuSrc.includes("layoutClass === 'layout-neon'"), 'Acento solo con layout neon');
  assert.ok(menuSrc.includes('neon-${baseKey}'), 'Clase neon-<acento> dinámica');
  // Studio: selector visible solo en neon + save/load + backend allowlist
  assert.ok(studioHtmlSrc.includes('id="inputNeonAccent"'), 'Studio: selector de acento');
  assert.ok(studioHtmlSrc.includes('value="magenta"') && studioHtmlSrc.includes('value="violet"'), 'Studio: las 6 opciones');
  assert.ok(studioSrc.includes("restaurant.neonAccent = neonSelect.value || 'mint'"), 'Studio: guarda el acento');
  assert.ok(studioSrc.includes("el('inputNeonAccent').value = restaurant.neonAccent"), 'Studio: pobla el acento');
  assert.ok(studioSrc.includes("layoutSelect.value === 'neon'"), 'Studio: fila visible solo en neon');
  const sanitizeBe = require('../api/utils/sanitizeRestaurant.js');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T', neonAccent: 'amber' }).neonAccent, 'amber', 'Backend: ámbar pasa');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T', neonAccent: 'fucsia' }).neonAccent, 'mint', 'Backend: inválido → mint');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T' }).neonAccent, 'mint', 'Backend: ausente → mint');
  // 21b. Color libre (picker HEX): override del preset, solo #RRGGBB.
  // (El alias `resolveNeonCustomColor` se eliminó por Middle Man: se usa
  // `normalizeNeonHex` directo en menu.js y acá.)
  assert.ok(!('resolveNeonCustomColor' in presModule), 'Sin alias intermediario (Middle Man eliminado)');
  assert.strictEqual(presModule.normalizeNeonHex('#FF5733'), '#ff5733', 'Custom: normaliza a minúsculas');
  assert.strictEqual(presModule.normalizeNeonHex('#00F5D4'), '#00f5d4', 'Custom: menta libre pasa');
  assert.strictEqual(presModule.normalizeNeonHex('rojo'), '', 'Custom: nombre → vacío (manda preset)');
  assert.strictEqual(presModule.normalizeNeonHex('javascript:alert(1)'), '', 'Custom: nunca CSS arbitrario');
  assert.strictEqual(presModule.normalizeNeonHex(''), '', 'Custom: vacío → preset');
  assert.strictEqual(presModule.neonHexToRgb('#FF5733'), '255, 87, 51', 'Custom: hex→rgb para --neon-rgb');
  assert.strictEqual(presModule.neonHexToRgb('rojo'), '', 'Custom: rgb inválido → vacío');
  assert.ok(menuSrc.includes('normalizeNeonHexMod'), 'menu.js importa el normalizador directo');
  assert.ok(!menuSrc.includes('resolveNeonCustomColorMod'), 'menu.js ya no usa el alias');
  assert.ok(menuSrc.includes('neonHexToRgbMod'), 'menu.js importa el conversor rgb');
  assert.ok(menuSrc.includes("setProperty('--neon'"), 'menu.js pisa --neon inline con el libre');
  assert.ok(studioHtmlSrc.includes('id="inputNeonCustomEnabled"'), 'Studio: toggle de color libre');
  assert.ok(studioHtmlSrc.includes('id="inputNeonCustomColor"'), 'Studio: picker de color libre');
  assert.ok(studioSrc.includes('restaurant.neonCustomColor'), 'Studio: guarda el libre');
  assert.ok(studioSrc.includes("el('inputNeonCustomColor')"), 'Studio: puebla el picker');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T', neonCustomColor: '#FF5733' }).neonCustomColor, '#ff5733', 'Backend: libre válido pasa');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T', neonCustomColor: 'red' }).neonCustomColor, '', 'Backend: libre inválido → vacío');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ name: 'T' }).neonCustomColor, '', 'Backend: libre ausente → vacío');
  // 21c. updateBusinessTypeControls debe resolver su helper `el` en scope:
  // un `el(...)` sin definir es ReferenceError en el navegador (módulo ES =
  // strict mode) y aborta el filtro de temas + la mitad de updateLiveState
  // (theme/neon/banner/wifi/autosave) y de renderStudioUI (carta/QR/preview).
  const ubtcStart = studioSrc.indexOf('export function updateBusinessTypeControls()');
  assert.ok(ubtcStart !== -1, 'No se encontró updateBusinessTypeControls en studio.js');
  const ubtcEnd = studioSrc.indexOf('\nexport ', ubtcStart + 10);
  const ubtcBody = studioSrc.slice(ubtcStart, ubtcEnd === -1 ? undefined : ubtcEnd);
  // Sin comentarios: los backticks de la doc (`el(...)`) falsearían el índice.
  const ubtcCode = ubtcBody.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
  const ubtcDeclIdx = ubtcCode.indexOf('const el = id => document.getElementById(id);');
  const ubtcUseIdx = ubtcCode.search(/\bel\s*\(/);
  assert.ok(
    ubtcDeclIdx !== -1 && ubtcUseIdx !== -1 && ubtcDeclIdx < ubtcUseIdx,
    'REGRESIÓN: updateBusinessTypeControls debe definir su `el` local ANTES de usarlo (sin esto todo el Studio muere con ReferenceError)'
  );
  console.log('✓ Neón multi-acentos: 6 colores con variables CSS, selector en Studio, allowlist backend');

  // 22. Checkout blindado: local cerrado, delivery con datos, retorno MP
  assert.ok(menuSrc.includes('function isRestaurantOpenNow()'), 'Helper de horario del local');
  assert.ok(menuSrc.includes('El local está cerrado ahora'), 'Submit bloqueado con local cerrado');
  assert.ok(menuSrc.includes('Elegí tu zona de entrega'), 'Delivery exige zona con foco');
  assert.ok(menuSrc.includes('Escribí tu dirección de entrega'), 'Delivery exige dirección con foco');
  assert.ok(menuSrc.includes('orderMode: mode'), 'Modo viaja al backend (quote/pedido/preferencia)');
  assert.ok(menuSrc.includes("params.get('payment')"), 'initOrderTracking lee el retorno de MP');
  assert.ok(menuSrc.includes('Pago acreditado'), 'Confirmación al volver del pago exitoso');
  assert.ok(menuSrc.includes('replaceState'), 'La URL de retorno se limpia (sin repetir aviso)');
  assert.ok(menuSrc.includes('tipForPay'), 'Preferencia MP incluye la propina');
  assert.ok(menuSrc.includes('discountForPay'), 'Preferencia MP incluye el descuento');
  assert.ok(menuSrc.includes('deliveryFee: mode ==='), 'Preferencia MP incluye el envío');
  assert.ok(menuSrc.includes('aún no está disponible en este local'), 'MP sin medios revierte con aviso');
  console.log('✓ Checkout blindado: horario, delivery, retorno MP y pago completo');

  // 23. Batch B/C: multi-tracking, Studio honesto y en vivo, erase seguro
  assert.ok(menuSrc.includes('ORDER_TRACKING_LIST_KEY'), 'Tracking multi-pedido con lista (cap 5)');
  assert.ok(menuSrc.includes('getTrackedOrders()'), 'Lectura de la lista con migración legacy');
  assert.ok(menuSrc.includes('markTrackedOrderDone'), 'Terminal marca hecho y oculta el FAB sin pendientes');
  assert.ok(menuSrc.includes('selectTrackedOrder'), 'Selector de pedido en el modal');
  assert.ok(menuSrc.includes('orderTrackingList'), 'Contenedor de la lista en el modal');
  const autoSaveSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio/autoSave.js'), 'utf8');
  assert.ok(autoSaveSrc.includes('Sesión vencida'), 'Guardado distingue sesión vencida');
  assert.ok(autoSaveSrc.includes('Sin conexión'), 'Guardado distingue offline');
  assert.ok(!autoSaveSrc.includes('Guardado (Local)'), 'Adiós al falso "Guardado (Local)" en verde');
  assert.ok(studioSrc.includes('startOrdersPolling'), 'Pedidos en vivo con polling');
  assert.ok(studioSrc.includes('stopOrdersPolling'), 'Polling se detiene fuera de la pestaña');
  assert.ok(studioSrc.includes("'delayed', 'cancelled'") || studioSrc.includes('"delayed", "cancelled"') || studioSrc.includes('ORDER_EXTRA_STATES'), 'Demorar y cancelar disponibles');
  assert.ok(studioSrc.includes('¿Cancelar este pedido?'), 'Cancelar pide confirmación');
  assert.ok(studioSrc.includes('● NUEVO'), 'Pedidos nuevos destacados');
  const modalSrc = fs.readFileSync(path.join(__dirname, '../public/js/components/LoyaltyRewardsModal.js'), 'utf8');
  assert.ok(modalSrc.includes('if (!res.ok || !body.success)'), 'Erase solo limpia si el backend borró');
  const notifSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(notifSrc.includes('Aviso registrado en el local'), 'Mozo sin teléfono igual avisa (inbox+push)');
  const notifRouteSrc = fs.readFileSync(path.join(__dirname, '../api/routes/notifications.js'), 'utf8');
  assert.ok(notifRouteSrc.includes("z.enum(['owners', 'guests'])"), 'audience:all eliminado del contrato');
  console.log('✓ Batch B/C: multi-tracking, Studio honesto/en vivo, erase e inbox sin teléfono');

  // 24. Seis mejoras de bajo esfuerzo (preview de tema, sonido, duplicados,
  //     banner de fotos, cierre manual y respaldo JSON).
  // 24.1 Preview ?theme=<clave>: mismo patrón que ?morph= y ?neon=.
  assert.ok(menuSrc.includes("get('theme')"), 'menu.js lee el preview ?theme=');
  assert.ok(menuSrc.includes('if (themeParam && validThemes.includes(themeParam))'), 'Solo claves válidas (nunca tema roto)');
  // 24.2 Sonido de pedido nuevo: beep WebAudio + título + toggle + baseline.
  assert.ok(studioSrc.includes('function playOrderAlert('), 'Studio: beep de pedido nuevo');
  assert.ok(studioSrc.includes('AudioContext'), 'Beep por WebAudio, sin assets');
  assert.ok(studioSrc.includes('ordersBaselineDone'), 'La primera carga es base (no suena por lo viejo)');
  assert.ok(studioSrc.includes('freshPending'), 'Solo avisan los pendientes no vistos');
  assert.ok(studioSrc.includes('toggleOrderSound'), 'Toggle de sonido exportado a window');
  assert.ok(studioHtmlSrc.includes('id="inputOrderSoundEnabled"'), 'Studio: checkbox de sonido en Pedidos en vivo');
  assert.ok(studioSrc.includes('scango_order_sound'), 'Preferencia de sonido persistida en localStorage');
  // 24.3 Duplicar plato y categoría (contenido clonado, ids nuevos).
  const dishEditorSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio/dishEditor.js'), 'utf8');
  assert.ok(dishEditorSrc.includes('export function duplicateDish('), 'dishEditor: duplicateDish existe');
  assert.ok(dishEditorSrc.includes('cloneDishWithNewIdUtil'), 'El clonado vive en cloneUtils (§28)');
  assert.ok(dishEditorSrc.includes('data-js-click="duplicateDishItem|'), 'Botón duplicar en la tarjeta del plato');
  const catManagerSrc = fs.readFileSync(path.join(__dirname, '../public/js/studio/categoryManager.js'), 'utf8');
  assert.ok(catManagerSrc.includes('export function duplicateCategory('), 'categoryManager: duplicateCategory existe');
  assert.ok(catManagerSrc.includes('data-js-click="duplicateCategoryFromManager|'), 'Botón duplicar en el gestor de categorías');
  assert.ok(studioSrc.includes('duplicateDishItem'), 'Studio: wrapper duplicateDishItem');
  assert.ok(studioSrc.includes('duplicateCategoryFromManager'), 'Studio: wrapper duplicateCategoryFromManager');
  // 24.4 Banner de cobertura de fotos (informa, nunca bloquea).
  assert.ok(studioHtmlSrc.includes('id="photoCoverageBanner"'), 'Studio: contenedor del banner de fotos');
  assert.ok(dishEditorSrc.includes('updatePhotoCoverageBanner'), 'dishEditor: cómputo de cobertura');
  assert.ok(dishEditorSrc.includes('sin foto'), 'El banner cuenta platos sin imagen');
  // 24.5 Cierre manual forceClosed: badge + carta + submit + pago + backend.
  assert.ok(menuSrc.includes('restaurantData.forceClosed === true'), 'menu.js respeta el cierre manual');
  assert.ok(menuSrc.includes('Cerrado por el momento'), 'Badge y avisos con copy propio (sin "undefined hs")');
  assert.ok(menuSrc.includes('Local cerrado por el momento'), 'Carta pausada con mensaje dedicado');
  assert.ok(studioHtmlSrc.includes('id="inputForceClosed"'), 'Studio: toggle de cierre manual');
  assert.ok(studioSrc.includes('restaurant.forceClosed = forceClosedCheck.checked'), 'Studio: guarda el cierre');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ forceClosed: true }).forceClosed, true, 'Backend: true pasa');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({ forceClosed: 'si' }).forceClosed, false, 'Backend: no-booleano → false');
  assert.strictEqual(sanitizeBe.sanitizeRestaurantPayload({}).forceClosed, false, 'Backend: ausente → false');
  const apiIndexSrc = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  assert.ok(apiIndexSrc.includes('forceClosed:'), 'El menú público expone forceClosed');
  // 24.6 Respaldo JSON: exportar descarga, importar conserva identidad.
  assert.ok(studioHtmlSrc.includes('data-js-click="exportMenuJson"'), 'Studio: botón exportar');
  assert.ok(studioHtmlSrc.includes('data-js-click="fireClick|menuJsonFileInput"'), 'Studio: botón importar dispara el file input');
  assert.ok(studioHtmlSrc.includes('id="menuJsonFileInput"'), 'Studio: input de archivo JSON');
  assert.ok(studioSrc.includes('export function exportMenuJson()'), 'Studio: exportMenuJson existe');
  assert.ok(studioSrc.includes('export function importMenuJsonFile('), 'Studio: importMenuJsonFile existe');
  assert.ok(studioSrc.includes('carta-${restaurant.slug'), 'El archivo se nombra con el slug');
  console.log('✓ Seis mejoras: preview ?theme=, sonido de pedidos, duplicados, banner de fotos, cierre manual y respaldo JSON');

  // 25. Ticket de cocina imprimible (Fase 1): botón por pedido + contenedor
  //     print-only + CSS 80mm. Sin on*=, todo dato escapado, window-exportado.
  assert.ok(studioHtmlSrc.includes('id="orderTicketPrint"'), 'Studio: contenedor print-only del ticket');
  assert.ok(studioSrc.includes('export function printOrderTicket('), 'Studio: printOrderTicket existe');
  assert.ok(studioSrc.includes('data-js-click="printOrderTicket|'), 'Botón 🖨️ Ticket por pedido (sin on*=)');
  assert.ok(studioSrc.includes('lastOrdersCache'), 'El ticket sale de la última lista (sin re-fetch)');
  assert.ok(studioSrc.includes('window.print()'), 'Abre el diálogo del navegador');
  assert.ok(studioSrc.includes('printOrderTicket,') || studioSrc.includes('printOrderTicket }'), 'printOrderTicket exportado a window');
  // Todo dato del comensal (nombre, mesa, notas, ítems) va escapado.
  const ticketStart = studioSrc.indexOf('export function printOrderTicket(');
  const ticketEnd = studioSrc.indexOf('\nasync function setOrderStatus(', ticketStart + 10);
  const ticketBody = studioSrc.slice(ticketStart, ticketEnd === -1 ? undefined : ticketEnd);
  for (const field of ['escapeHtml(order.customer_name', 'escapeHtml(String(order.table_number)', 'escapeHtml(i.note)', 'escapeHtml(i.name']) {
    assert.ok(ticketBody.includes(field), `Ticket: ${field} escapado (XSS del comensal)`);
  }
  const studioCssSrc = fs.readFileSync(path.join(__dirname, '../public/css/studio.css'), 'utf8');
  assert.ok(studioCssSrc.includes('@media print'), 'studio.css: bloque print');
  assert.ok(studioCssSrc.includes('@page'), 'studio.css: tamaño de página térmico');
  assert.ok(studioCssSrc.includes('80mm'), 'Ticket 80mm');
  assert.ok(studioCssSrc.includes('#orderTicketPrint'), 'Solo el ticket visible al imprimir');
  assert.ok(studioCssSrc.includes('.ticket-paper'), 'Papel monoespaciado del ticket');
  console.log('✓ Ticket de cocina Fase 1: botón por pedido, print-only 80mm, datos escapados');

  // 26. Invitaciones por WhatsApp, una por invitado (rubro Eventos).
  const inviteModule = await import('../public/js/menu/eventInvitations.js');
  assert.strictEqual(typeof inviteModule.normalizeGuestPhone, 'function', 'normalizeGuestPhone debe existir');
  assert.strictEqual(typeof inviteModule.buildGuestInviteLink, 'function', 'buildGuestInviteLink debe existir');
  assert.strictEqual(typeof inviteModule.buildGuestInviteMessage, 'function', 'buildGuestInviteMessage debe existir');
  assert.strictEqual(typeof inviteModule.buildGuestInviteUrl, 'function', 'buildGuestInviteUrl debe existir');
  // Teléfono: solo dígitos, mínimo 8.
  assert.strictEqual(inviteModule.normalizeGuestPhone('598 99 123 456'), '59899123456', 'Espacios fuera, dígitos dentro');
  assert.strictEqual(inviteModule.normalizeGuestPhone('+59899123456'), '59899123456', 'El + no viaja a wa.me');
  assert.strictEqual(inviteModule.normalizeGuestPhone('1234567'), '', 'Muy corto → vacío (no invita)');
  assert.strictEqual(inviteModule.normalizeGuestPhone('llamame luego'), '', 'Sin dígitos → vacío');
  assert.strictEqual(inviteModule.normalizeGuestPhone(null), '', 'Null → vacío');
  // Link personal con nombre + token QR.
  const inviteLink = inviteModule.buildGuestInviteLink('https://fiesta.uy/', 'boda-mora-alex', { name: 'Valeria Sosa', qrToken: 'qr_abc123' });
  assert.ok(inviteLink.startsWith('https://fiesta.uy/m/boda-mora-alex?'), 'Base del evento sin doble barra');
  assert.ok(inviteLink.includes('invitado=Valeria+Sosa'), 'Nombre codificado en el link');
  assert.ok(inviteLink.includes('qr=qr_abc123'), 'Token QR en el link (lo resuelve el endpoint de invitado)');
  assert.strictEqual(inviteModule.buildGuestInviteLink('https://f.uy', '', { name: 'X' }), '', 'Sin slug → vacío');
  // Mensaje: nombres + fecha/lugar solo si existen, nunca "undefined".
  const inviteMsg = inviteModule.buildGuestInviteMessage({ coupleNames: 'Mora & Alex', date: '5 de Junio de 2029', venue: 'Salón Ensigna', guestName: 'Valeria', link: inviteLink });
  assert.ok(inviteMsg.includes('Mora & Alex') && inviteMsg.includes('Valeria') && inviteMsg.includes(inviteLink), 'Mensaje personal completo');
  const bareMsg = inviteModule.buildGuestInviteMessage({});
  assert.ok(!bareMsg.includes('undefined'), 'Sin datos no filtra "undefined"');
  // Copy por tipo de evento: antes "su boda" siempre (boda incluso en un cumpleaños).
  const bdayMsg = inviteModule.buildGuestInviteMessage({ coupleNames: 'Tita', eventType: 'birthday', guestName: 'Ana' });
  assert.ok(bdayMsg.includes('celebrar su cumpleaños 🎂'), 'Cumpleaños: verbo propio (nada de "boda")');
  assert.ok(!bdayMsg.includes('boda'), 'Cumpleaños: nunca dice "boda"');
  const quinceMsg = inviteModule.buildGuestInviteMessage({ eventType: 'cumple_15', guestName: 'Ana' });
  assert.ok(quinceMsg.includes('celebrar sus 15 años 👑') && quinceMsg.includes('_¡No faltes!_'), '15 años: verbo + cierre propios');
  const caterMsg = inviteModule.buildGuestInviteMessage({ eventType: 'CATERING', guestName: 'Ana' });
  assert.ok(caterMsg.includes('acompañarnos en su evento 🍽️'), 'Catering: copy propio (case-insensitive)');
  const unknownMsg = inviteModule.buildGuestInviteMessage({ eventType: 'fiesta-de-empresa', guestName: 'Ana' });
  assert.ok(unknownMsg.includes('celebrar su boda'), 'Tipo desconocido → default boda (nunca crashea)');
  const legacyMsg = inviteModule.buildGuestInviteMessage({ guestName: 'Ana' });
  assert.ok(legacyMsg.includes('celebrar su boda 🎉'), 'Sin eventType → mismo copy histórico (backward compat)');
  assert.strictEqual(inviteModule.resolveEventInviteCopy('birthday').verb, 'celebrar su cumpleaños', 'Resolver expone el copy por tipo');
  assert.strictEqual(inviteModule.resolveEventInviteCopy('').verb, 'celebrar su boda', 'Resolver default = boda');
  assert.ok(studioSrc.includes('eventType: ctx.eventType'), 'Studio: envía el tipo de evento al builder');
  // wa.me o null.
  const waUrl = inviteModule.buildGuestInviteUrl('59899123456', inviteMsg);
  assert.ok(waUrl && waUrl.startsWith('https://wa.me/59899123456?text='), 'wa.me con texto codificado');
  assert.strictEqual(inviteModule.buildGuestInviteUrl('123', inviteMsg), null, 'Teléfono inválido → null (no abre chat roto)');
  assert.strictEqual(inviteModule.buildGuestInviteUrl('59899123456', '  '), null, 'Sin mensaje → null');
  // Barrel + Studio + backend (teléfono del invitado).
  assert.ok(barrelSrc.includes("export * from './eventInvitations.js'"), 'El barrel debe exportar eventInvitations');
  assert.ok(studioHtmlSrc.includes('id="eventGuestsSection"'), 'Studio: sección de invitados (solo eventos)');
  assert.ok(studioHtmlSrc.includes('data-js-click="addEventGuest"'), 'Studio: botón agregar invitado sin on*=');
  assert.ok(studioSrc.includes('data-js-click="sendGuestInvite|'), 'Studio: botón invitar por invitado');
  assert.ok(studioSrc.includes('data-js-click="copyGuestInviteLink|'), 'Studio: botón copiar link personal');
  assert.ok(studioSrc.includes("from './menu/eventInvitations.js'"), 'Studio importa el builder puro');
  assert.ok(studioSrc.includes('addEventGuest, removeEventGuest'), 'Studio: handlers de invitados exportados a window');
  assert.ok(studioSrc.includes("getElementById('eventGuestsSection')"), 'Studio: la sección se muestra solo en eventos');
  // Endurecido tras revisión: el preview ?theme= respeta el lockdown y los
  // tokens se mintean con crypto (no adivinables por Math.random solo).
  assert.ok(menuSrc.includes("!HELADERIA_ONLY.includes(themeParam)"), 'Preview ?theme= en heladería cae a fiesta (lockdown sin excepciones)');
  assert.ok(studioSrc.includes('crypto.getRandomValues'), 'Tokens de invitado con entropía real');
  assert.ok(studioSrc.includes('mintGuestToken'), 'Helper único de tokens (alta + fallbacks)');
  const guestClean = sanitizeBe.sanitizeRestaurantPayload({ eventConfig: { guests: [{ name: 'Valeria', phone: '598 99 123 456' }] } });
  assert.strictEqual(guestClean.eventConfig.guests[0].phone, '59899123456', 'Backend: teléfono del invitado saneado a dígitos');
  const guestDirty = sanitizeBe.sanitizeRestaurantPayload({ eventConfig: { guests: [{ name: 'X', phone: 'llamame luego' }] } });
  assert.strictEqual(guestDirty.eventConfig.guests[0].phone, '', 'Backend: teléfono sin dígitos → vacío');
  // Hero de invitado en el menú: tarjeta de bienvenida con nombre/mesa del link.
  assert.ok(menuHtmlSrc.includes('id="guestInviteHero"'), 'menu.html: contenedor de la tarjeta de invitado');
  assert.ok(menuSrc.includes('parseGuestContext'), 'menu.js: importa parseGuestContext (nombre/mesa del link)');
  assert.ok(menuSrc.includes('function renderGuestInvite'), 'menu.js: render de la tarjeta de invitado');
  assert.ok(menuSrc.includes('nameEl.textContent = guestName'), 'menu.js: nombre con textContent (cero HTML inyectable)');
  assert.ok(menuSrc.includes('Mesa ${tableNumber}'), 'menu.js: la mesa del link se suma a la tarjeta');
  assert.ok(menuCssSrc.includes('.guest-invite-hero'), 'menu.css: estilos de la tarjeta (paleta del tema activo)');
  console.log('✓ Invitaciones por WhatsApp: link personal + mensaje + backend con teléfono');

  // 27. Térmica USB directa ESC/POS (Fase 2) + antigüedad en cocina.
  const escposModule = await import('../public/js/studio/escposTicket.js');
  const agingModule = await import('../public/js/studio/orderAging.js');
  // Builder puro: ops init → contenido → corte (espejo en bytes del Fase 1).
  assert.strictEqual(typeof escposModule.buildEscPosTicketOps, 'function', 'buildEscPosTicketOps debe existir');
  assert.strictEqual(escposModule.ESCPOS_TICKET_COLUMNS, 42, 'Ticket 80mm = 42 columnas');
  assert.ok(escposModule.ESCPOS_LIB_URL.includes('@point-of-sale/receipt-printer-encoder@4.0.1'), 'Librería MIT con pin exacto (nunca latest)');
  assert.ok(escposModule.ESCPOS_LIB_URL.startsWith('https://cdn.jsdelivr.net/npm/'), 'CDN ya permitido por la CSP');
  assert.strictEqual(escposModule.ESCPOS_LIB_GLOBAL, 'ReceiptPrinterEncoder', 'Global documentado del build UMD');
  assert.strictEqual(escposModule.sanitizeEscPosText('ñaño áéí'), 'ñaño áéí', 'Latin-1 (ñ/á) pasa tal cual a la codepage');
  assert.strictEqual(escposModule.sanitizeEscPosText('A ↳ B — C 🍕'), 'A > B - C ', 'Emoji y rarezas se mapean, nunca rompen bytes');
  const escOps = escposModule.buildEscPosTicketOps(
    { id: 'ord_1', status: 'pending', customer_name: 'Juan', table_number: '4', currency: '$', total: 850, created_at: '2029-06-05T20:00:00', items_snapshot: [{ quantity: 2, name: 'Milanesa', note: 'sin sal' }] },
    { restaurantName: 'Bodegón', currency: '$' }
  );
  assert.strictEqual(escOps[0].t, 'init', 'Primera op: initialize');
  assert.strictEqual(escOps[escOps.length - 1].t, 'cut', 'Última op: corte');
  assert.ok(escOps.some(o => o.t === 'rule'), 'Separadores de regla');
  assert.ok(escOps.some(o => o.t === 'feed'), 'Avance antes del corte');
  const escText = escOps.filter(o => o.t === 'line').map(o => o.v).join('\n');
  assert.ok(escText.includes('Bodegón'), 'Nombre del local (latin-1 intacto)');
  assert.ok(escText.includes('Cliente: Juan'), 'Cliente presente');
  assert.ok(escText.includes('Mesa: 4'), 'Mesa presente');
  assert.ok(escText.includes('2x Milanesa'), 'Cantidad × plato');
  assert.ok(escText.includes('> sin sal'), 'Nota del comensal');
  assert.ok(escText.includes('TOTAL: $ 850.00'), 'Total con 2 decimales');
  assert.ok(escText.includes('ord_1'), 'Id corto del pedido');
  const escEmpty = escposModule.buildEscPosTicketOps({ id: 'x' }, {});
  assert.ok(escEmpty.some(o => o.v === 'Sin detalle de items'), 'Sin ítems: estado honesto, no ticket vacío');
  // Antigüedad: minutos, texto criollo y niveles con umbrales 15/30.
  assert.strictEqual(agingModule.ORDER_AGE_WARN_MIN, 15, 'Aviso ámbar a los 15 min');
  assert.strictEqual(agingModule.ORDER_AGE_CRIT_MIN, 30, 'Crítico rojo a los 30 min');
  const ageBase = new Date('2029-06-05T20:00:00').getTime();
  assert.strictEqual(agingModule.orderAgeMinutes('2029-06-05T20:00:00', ageBase), 0, 'Recién creado = 0');
  assert.strictEqual(agingModule.orderAgeMinutes('2029-06-05T19:50:00', ageBase), 10, '10 minutos');
  assert.strictEqual(agingModule.orderAgeMinutes('basura', ageBase), null, 'Fecha inválida = null');
  assert.strictEqual(agingModule.formatOrderAge('2029-06-05T20:00:00', ageBase), 'recién', 'Menos de 1 min');
  assert.strictEqual(agingModule.formatOrderAge('2029-06-05T19:57:00', ageBase), 'hace 3 min', 'Minutos en criollo');
  assert.strictEqual(agingModule.formatOrderAge('2029-06-05T18:55:00', ageBase), 'hace 1 h 5 min', 'Horas en criollo');
  assert.strictEqual(agingModule.formatOrderAge('', ageBase), '—', 'Sin fecha = guion');
  assert.strictEqual(agingModule.orderAgeLevel('2029-06-05T19:50:00', ageBase, 'pending'), 'ok', '10 min pendiente = ok');
  assert.strictEqual(agingModule.orderAgeLevel('2029-06-05T19:44:00', ageBase, 'preparing'), 'warn', '16 min en cocina = warn');
  assert.strictEqual(agingModule.orderAgeLevel('2029-06-05T19:20:00', ageBase, 'pending'), 'crit', '40 min = crit');
  assert.strictEqual(agingModule.orderAgeLevel('2029-06-05T19:00:00', ageBase, 'delivered'), 'done', 'Entregado no envejece');
  assert.strictEqual(agingModule.orderAgeLevel('2029-06-05T19:00:00', ageBase, 'cancelled'), 'done', 'Cancelado no envejece');
  assert.deepStrictEqual(agingModule.orderAgeStyle('crit'), { color: '#F87171', weight: '800' }, 'Estilo crítico');
  assert.deepStrictEqual(agingModule.orderAgeStyle('ok'), { color: 'var(--text-dim)', weight: '400' }, 'Estilo normal usa variable del tema');
  // Cableado Studio: transporte propio + lib bajo demanda + ticker + botones.
  assert.ok(studioSrc.includes("from './studio/escposTicket.js'"), 'Studio importa el builder puro');
  assert.ok(studioSrc.includes("from './studio/orderAging.js'"), 'Studio importa el módulo de antigüedad');
  assert.ok(studioSrc.includes('export async function printOrderEscPos('), 'printOrderEscPos existe');
  assert.ok(studioSrc.includes('export async function connectUsbPrinter('), 'connectUsbPrinter existe (toggle)');
  assert.ok(studioSrc.includes('navigator.usb.requestDevice'), 'Transporte WebUSB propio (sin copiar drivers)');
  assert.ok(studioSrc.includes('transferOut'), 'Envío troceado al endpoint OUT');
  assert.ok(studioSrc.includes('getDevices'), 'Restaura el permiso ya otorgado sin selector');
  assert.ok(studioSrc.includes("codepage('auto')"), 'ñ/á/ú por codepage automática de la lib');
  assert.ok(studioSrc.includes('data-js-click="printOrderEscPos|'), 'Botón ⚡ por pedido');
  assert.ok(studioHtmlSrc.includes('id="usbPrinterBtn"'), 'Botón 🔌 en Pedidos en vivo');
  assert.ok(studioHtmlSrc.includes('id="usbPrinterStatus"'), 'Estado de la impresora visible');
  assert.ok(studioSrc.includes('data-order-age'), 'Chip ⏱ por tarjeta');
  assert.ok(studioSrc.includes('setInterval(updateOrderAges, 30000)'), 'Ticker de 30s sin re-fetch');
  assert.ok(studioSrc.includes('printOrderEscPos,'), 'printOrderEscPos exportado a window');
  assert.ok(studioSrc.includes('connectUsbPrinter,'), 'connectUsbPrinter exportado a window');
  console.log('✓ Térmica USB ESC/POS (lib MIT) + antigüedad en cocina con umbrales');

  // 28. Deuda de revisión saldada: listas compartidas sin drift + clon único.
  // Backend (CJS) y frontend (ESM) no pueden compartir módulo en runtime:
  // la guarda es el test — si alguien agrega un tema/estilo/acento de un
  // solo lado, esto falla en la próxima corrida.
  assert.deepStrictEqual(
    [...sanitizeBe.HELADERIA_THEMES],
    [...presModule.HELADERIA_THEMES],
    'HELADERIA_THEMES backend == frontend (agregar un tema exige ambos lados)'
  );
  assert.deepStrictEqual(
    [...sanitizeBe.ICE_CREAM_BUTTON_STYLES],
    Object.keys(presModule.ICE_CREAM_BUTTON_STYLES),
    'Estilos del armador backend == frontend'
  );
  assert.deepStrictEqual(
    [...sanitizeBe.NEON_ACCENT_KEYS],
    Object.keys(presModule.NEON_ACCENTS),
    'Acentos neón backend == frontend'
  );
  // Clonado único: dishEditor y categoryManager delegan en cloneUtils.
  const cloneModule = await import('../public/js/studio/cloneUtils.js');
  assert.strictEqual(typeof cloneModule.cloneDishWithNewId, 'function', 'cloneDishWithNewId debe existir');
  assert.strictEqual(typeof cloneModule.cloneCategoryWithNewId, 'function', 'cloneCategoryWithNewId debe existir');
  const origDish = { id: 'd_x', name: 'Milanesa', price: 500, tags: ['star'], outOfStock: true };
  const dishClone = cloneModule.cloneDishWithNewId(origDish);
  assert.notStrictEqual(dishClone.id, 'd_x', 'Id nuevo');
  assert.ok(dishClone.id.startsWith('d_'), 'Prefijo d_');
  assert.ok(dishClone.name.includes('(copia)'), 'Nombre marcado');
  assert.strictEqual(dishClone.outOfStock, false, 'El clon nace visible');
  assert.deepStrictEqual(dishClone.tags, ['star'], 'Deep copy del contenido');
  assert.strictEqual(origDish.name, 'Milanesa', 'El original no se muta');
  dishClone.tags.push('veggie');
  assert.deepStrictEqual(origDish.tags, ['star'], 'Independencia total del clon');
  const catClone = cloneModule.cloneCategoryWithNewId({ id: 'c_x', name: 'Bebidas' });
  assert.ok(catClone.id.startsWith('cat_'), 'Prefijo cat_');
  assert.ok(catClone.name.includes('(copia)'), 'Categoría marcada');
  const dishEditorSrc28 = fs.readFileSync(path.join(__dirname, '../public/js/studio/dishEditor.js'), 'utf8');
  assert.ok(dishEditorSrc28.includes('cloneDishWithNewIdUtil'), 'dishEditor delega el clonado');
  assert.ok(!dishEditorSrc28.includes('JSON.parse(JSON.stringify(dishes[idx]))'), 'dishEditor sin lógica de clon propia');
  const catManagerSrc28 = fs.readFileSync(path.join(__dirname, '../public/js/studio/categoryManager.js'), 'utf8');
  assert.ok(catManagerSrc28.includes('cloneDishWithNewIdUtil') && catManagerSrc28.includes('cloneCategoryWithNewIdUtil'), 'categoryManager delega el clonado');
  console.log('✓ Listas backend↔frontend sin drift + clonado único en cloneUtils');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE COMPONENTIZACIÓN DE MENU PASARON AL 100%!');
}

runMenuComponentizationTests().catch(err => {
  console.error('❌ Error en pruebas de componentización:', err);
  process.exit(1);
});
