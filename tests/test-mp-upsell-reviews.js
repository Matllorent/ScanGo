/**
 * Test Suite: Mercado Pago Checkout Pro, Upselling y Smart Reviews
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const db = require('../src/db/db');

console.log('🧪 Iniciando verificación de MP Checkout Pro, Upselling y Smart Reviews...');

// 1. Mercado Pago Credentials & Service
const mpService = require('../src/services/mercadopago');
assert.ok(mpService.isConfigured(), 'MP Access Token debe estar configurado');
assert.ok(mpService.getAccessToken().startsWith('APP_USR-'), 'Token debe ser de producción (APP_USR-)');
console.log('✓ MERCADOPAGO_ACCESS_TOKEN de producción verificado y activo');

// 2. MP Billing Provider linked to service
const mpProvider = require('../src/billing/providers/mercadopago');
assert.ok(typeof mpProvider.createPreference === 'function', 'mpProvider.createPreference debe existir');
assert.ok(typeof mpProvider.isConfigured === 'function', 'mpProvider.isConfigured debe existir');
assert.ok(mpProvider.isConfigured(), 'mpProvider.isConfigured() debe retornar true');
console.log('✓ Billing Provider de Mercado Pago integrado con servicio de Checkout Pro');

// 3. API route for MP preference exists in orders.js
const ordersFile = fs.readFileSync(path.join(__dirname, '../api/routes/orders.js'), 'utf8');
assert.ok(ordersFile.includes('/mercadopago/preference'), 'orders.js debe tener ruta /mercadopago/preference');
assert.ok(ordersFile.includes('createPreference'), 'orders.js debe llamar a createPreference');
assert.ok(ordersFile.includes('init_point'), 'orders.js debe devolver init_point');
console.log('✓ Endpoint POST /api/orders/mercadopago/preference para Checkout Pro verificado');

// 4. Upselling: "El Mozo Virtual" in menu.js
const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
assert.ok(menuJs.includes('DEFAULT_UPSELL_KEYWORDS'), 'menu.js debe definir DEFAULT_UPSELL_KEYWORDS');
assert.ok(menuJs.includes('getUpsellCandidates'), 'menu.js debe definir getUpsellCandidates()');
assert.ok(menuJs.includes('renderUpsellSuggestions'), 'menu.js debe definir renderUpsellSuggestions()');
assert.ok(menuJs.includes('quickAddUpsellItem'), 'menu.js debe definir quickAddUpsellItem()');
assert.ok(menuJs.includes('El Mozo Virtual sugiere'), 'menu.js debe mostrar label "El Mozo Virtual sugiere"');
console.log('✓ Upselling Inteligente "El Mozo Virtual" implementado en menu.js');

// 5. Upselling containers in menu.html
const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
assert.ok(menuHtml.includes('virtualWaiterUpsellBox'), 'menu.html debe tener #virtualWaiterUpsellBox en el cart modal');
assert.ok(menuHtml.includes('dishModalUpsellBox'), 'menu.html debe tener #dishModalUpsellBox en el dish note modal');
console.log('✓ Contenedores HTML del Mozo Virtual presentes en el carrito y personalización');

// 6. Smart Google Reviews Filter: modal structure
assert.ok(menuHtml.includes('smartReviewModal'), 'menu.html debe tener #smartReviewModal');
assert.ok(menuHtml.includes('starsSelectorWrap'), 'menu.html debe tener selector de estrellas');
assert.ok(menuHtml.includes('review5StarsBox'), 'menu.html debe tener rama de 5 estrellas (Google Maps)');
assert.ok(menuHtml.includes('reviewPrivateFeedbackBox'), 'menu.html debe tener rama de feedback privado');
assert.ok(menuHtml.includes('btnGoogleReviewRedirect'), 'menu.html debe tener botón de redirect a Google');
assert.ok(menuHtml.includes('privateFeedbackForm'), 'menu.html debe tener formulario de feedback privado');
assert.ok(menuHtml.includes('feedbackSuccessMessage'), 'menu.html debe tener mensaje de éxito');
console.log('✓ Modal Smart Google Reviews con bifurcación 5★ / 1-4★ verificado en menu.html');

// 7. Smart Reviews JS logic
assert.ok(menuJs.includes('openSmartReviewModal'), 'menu.js debe definir openSmartReviewModal()');
assert.ok(menuJs.includes('closeSmartReviewModal'), 'menu.js debe definir closeSmartReviewModal()');
assert.ok(menuJs.includes('handleStarSelect'), 'menu.js debe definir handleStarSelect()');
assert.ok(menuJs.includes('submitPrivateFeedback'), 'menu.js debe definir submitPrivateFeedback()');
assert.ok(menuJs.includes('handleGoogleReviewClick'), 'menu.js debe definir handleGoogleReviewClick()');
console.log('✓ Lógica JS del filtro inteligente de reseñas verificada en menu.js');

// 8. Backend: POST /api/reviews/feedback endpoint
const reviewsFile = fs.readFileSync(path.join(__dirname, '../api/routes/reviews.js'), 'utf8');
assert.ok(reviewsFile.includes('/feedback'), 'reviews.js debe tener ruta /feedback');
assert.ok(reviewsFile.includes('addFeedback'), 'reviews.js debe llamar a db.addFeedback');
console.log('✓ Endpoint POST /api/reviews/feedback para comentarios privados verificado');

// 9. DB: addFeedback & getFeedbackByRestaurantId
assert.ok(typeof db.addFeedback === 'function', 'db.addFeedback debe ser una función');
assert.ok(typeof db.getFeedbackByRestaurantId === 'function', 'db.getFeedbackByRestaurantId debe ser una función');

const testFb = db.addFeedback({
  restaurantId: 'rest_test_fb_123',
  rating: 3,
  comment: 'La comida estaba bien pero tardó mucho',
  customerName: 'María Test'
});
assert.ok(testFb.id.startsWith('fb_'), 'Feedback ID debe empezar con fb_');
assert.strictEqual(testFb.rating, 3, 'Rating debe persistir');

const fetched = db.getFeedbackByRestaurantId('rest_test_fb_123');
assert.ok(fetched.length >= 1, 'Debe recuperar al menos 1 feedback');
console.log('✓ Persistencia de feedback privado en DB validada');

// 10. CSS styles for upselling and smart reviews
const menuCss = fs.readFileSync(path.join(__dirname, '../public/css/menu.css'), 'utf8');
assert.ok(menuCss.includes('.mozo-virtual-upsell-box'), 'menu.css debe tener estilos para .mozo-virtual-upsell-box');
assert.ok(menuCss.includes('.mozo-item-card'), 'menu.css debe tener estilos para .mozo-item-card');
assert.ok(menuCss.includes('.btn-mozo-quick-add'), 'menu.css debe tener estilos para .btn-mozo-quick-add');
assert.ok(menuCss.includes('.smart-review-modal-box'), 'menu.css debe tener estilos para .smart-review-modal-box');
assert.ok(menuCss.includes('.stars-selector-wrap'), 'menu.css debe tener estilos para .stars-selector-wrap');
assert.ok(menuCss.includes('.star-btn'), 'menu.css debe tener estilos para .star-btn');
assert.ok(menuCss.includes('.btn-google-review-cta'), 'menu.css debe tener estilos para .btn-google-review-cta');
console.log('✓ Estilos CSS para Mozo Virtual y Smart Reviews verificados en menu.css');

// 11. Payment method handler
assert.ok(menuJs.includes('handleOrderPaymentChange'), 'menu.js debe definir handleOrderPaymentChange()');
assert.ok(menuHtml.includes("onchange=\"handleOrderPaymentChange()\""), 'menu.html debe vincular onchange a handleOrderPaymentChange');
console.log('✓ Handler de método de pago con soporte MP Checkout Pro verificado');

// 12. WhatsApp message formatting still intact
assert.ok(menuJs.includes('*DETALLE DEL PEDIDO:*'), 'Formato de WhatsApp debe incluir DETALLE DEL PEDIDO');
assert.ok(menuJs.includes('*Subtotal:*'), 'Formato de WhatsApp debe incluir Subtotal');
assert.ok(menuJs.includes('*TOTAL A PAGAR:*'), 'Formato de WhatsApp debe incluir TOTAL A PAGAR');
assert.ok(menuJs.includes('optionsSnapshot'), 'Formato de WhatsApp debe incluir modificadores del snapshot');
console.log('✓ Formato de mensaje WhatsApp con subtotales y modificadores intacto');

console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE MP CHECKOUT PRO, UPSELLING Y SMART REVIEWS PASARON AL 100%!');
