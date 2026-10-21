const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('public/index.html');
const css = read('public/css/index.css');
const client = read('public/js/index.js');
const auth = read('api/routes/auth.js');

assert.ok(html.includes('Comenzar 7 días gratis con Google'), 'La landing y el modal deben ofrecer el alta con Google');
assert.ok(html.includes('window.loadGoogleIdentityServices'), 'GIS debe cargarse bajo demanda para proteger el LCP');
assert.ok(client.includes("https://accounts.google.com/gsi/client") === false, 'El script externo debe cargarse desde el loader diferido de HTML');
assert.ok(client.includes("fetch('/api/auth/google'"), 'El ID token debe validarse en el backend');
assert.ok(auth.includes("router.post('/google'"));
assert.ok(auth.includes('verifyIdToken({'));
assert.ok(auth.includes('audience: GOOGLE_CLIENT_ID'));
assert.ok(auth.includes('googleProfile.email_verified !== true'));

assert.ok(!html.includes('id="monthlySalesSlider"'), 'Sin slider de calculadora');
assert.ok(!html.includes('id="deliveryCommissionValue"'), 'Sin comparador de comisiones');
assert.ok(!html.includes('id="monthlySavingsValue"'), 'Sin cifra de ahorro calculada');
assert.ok(!client.includes('sales * 0.2'), 'Sin matemática de comisiones en el cliente');

assert.ok(html.includes('id="demo-interactiva"'));
assert.ok(html.includes('data-js-click="simAddDish|Burger Criolla|490"')); // handler migrado a data-js-* (CSP script-src-attr none)
// El simulador también ofrece quitar: el botón − nace oculto y aparece recién
// cuando ese plato está en el carrito (mismo comportamiento que la carta real).
assert.ok(html.includes('data-sim-dish="Burger Criolla"'), 'cada plato del simulador se identifica por nombre');
assert.ok(html.includes('data-js-click="simRemoveDish|Burger Criolla"'), 'el simulador tiene botón − por plato');
assert.ok(/class="sim-btn-remove" hidden/.test(html), 'el botón − del simulador nace oculto (solo tras agregar)');
assert.ok(client.includes('function simRemoveDish('), 'simRemoveDish implementado en el cliente');
assert.ok(client.includes('function syncSimRemoveButtons('), 'el estado de los botones − se sincroniza con el carrito');
assert.ok(client.includes('syncSimRemoveButtons();'), 'updateSimUI sincroniza los botones −');
assert.ok(css.includes('.sim-btn-remove'), 'estilo propio del botón − del simulador');
assert.ok(css.includes('.sim-btn-remove[hidden]'), 'el botón − oculto no ocupa espacio');
assert.ok(css.includes('@media (max-width: 600px)'));
assert.ok(!html.includes('monthlySalesSlider'), 'Calculadora de ahorro eliminada del HTML');
assert.ok(!html.includes('savings-section'), 'Sin rastro de la sección eliminada');
assert.ok(!client.includes('initSavingsCalculator'), 'Sin calculadora en el cliente');
assert.ok(!css.includes('.savings-layout'), 'Sin CSS huérfano de la calculadora');
assert.ok(html.includes('compare-section'), 'Comparativa estática en su lugar');
assert.ok(html.includes('Lo que te cobran las apps vs ScanGo'), 'Título comparativo');
assert.ok(html.includes('0% siempre'), 'Columna ScanGo sin comisiones');
assert.ok(html.includes('href="#precios"'), 'CTA ancla a precios (sin JS)');
assert.ok(css.includes('.compare-table'), 'Estilos de la comparativa');

// Precios por rubro: mismas tarjetas, mensaje adaptado + preselección
assert.ok(html.includes('data-pricing-rubro="heladeria"'), 'Pestaña Heladería en precios');
assert.ok(html.includes('data-pricing-rubro="perfumery"'), 'Pestaña Perfumería en precios');
assert.ok(html.includes('data-pricing-rubro="events"'), 'Pestaña Eventos en precios');
assert.ok(html.includes('data-js-click="switchPricingRubro|heladeria"'), 'Tabs sin on*= (CSP script-src-attr none)');
assert.ok(html.includes('id="pricingEventGrid"'), 'Tarjeta de pago único por evento');
assert.ok(html.includes('$12 <span>USD / evento</span>'), 'Evento a precio fijo event_once');
assert.ok(html.includes('id="planMonthlyName"') && html.includes('id="planAnnualFeatures"'), 'Nombres y features con id para re-render por rubro');
assert.ok(client.includes('function switchPricingRubro'), 'switchPricingRubro en el cliente');
assert.ok(client.includes('currentPricingRubro'), 'Rubro activo rastreado para el CTA');
assert.ok(client.includes("getElementById('regBusinessType')"), 'El registro hereda el rubro de la pestaña');
assert.ok(css.includes('.pricing-rubro-tab'), 'Estilos de pestañas de rubro');

console.log('✓ Landing: Google seguro, ahorro en vivo y simulador sin registro verificados');

// ── R6: banda de hechos (resultado por hechos verificables, cero métricas inventadas) ──
assert.ok(html.includes('id="hechos"'), 'La banda de hechos #hechos debe existir (posicionamiento contra demos sin precios)');
assert.ok(html.includes('class="facts-band"'), 'La banda de hechos renderiza sus chips');
const factChips = (html.match(/class="fact-chip"/g) || []).length;
assert.ok(factChips === 4, `La banda tiene 4 hechos reales (hay ${factChips})`);
assert.ok(html.includes('Comisión sobre tus pedidos'), 'Fact 0% comisión presente');
assert.ok(html.includes('El sistema grande vende demo. Nosotros publicamos la verdad.'), 'Headline anti-demo presente');
assert.ok(html.includes('US$ 9') && html.includes('Precio público y fijo'), 'Precio transparente reforzado en la banda');
assert.ok(css.includes('.facts-band') && css.includes('.fact-chip'), 'CSS de la banda de hechos presente');
console.log('✓ R6: banda de hechos verificable presente (4 chips + CSS)');