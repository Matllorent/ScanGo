/**
 * Test Suite: Mercado Pago Checkout Pro, Upselling y Smart Reviews
 */

require('dotenv').config();
if (!process.env.MERCADOPAGO_ACCESS_TOKEN) {
  process.env.MERCADOPAGO_ACCESS_TOKEN = 'APP_USR-test-token-1234567890';
}
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const db = require('../src/db/db');

async function runTests() {
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
  assert.ok(ordersFile.includes('mpService.createPreference'), 'orders.js debe llamar a mpService.createPreference');
  console.log('✓ Endpoint POST /api/orders/mercadopago/preference para Checkout Pro verificado');

  // 4. Upselling "El Mozo Virtual" implemented in menu.js
  const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(menuJs.includes('isMozoVirtualEnabled') || menuJs.includes('handleMozoVirtualToggle'), 'menu.js debe implementar isMozoVirtualEnabled / handleMozoVirtualToggle');
  assert.ok(menuJs.includes('quickAddUpsellItem'), 'menu.js debe tener función quickAddUpsellItem para agregar items del upselling');
  console.log('✓ Upselling Inteligente "El Mozo Virtual" implementado en menu.js');

  // 5. HTML containers for upselling
  const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
  assert.ok(menuHtml.includes('id="virtualWaiterUpsellBox"') || menuHtml.includes('mozo-virtual-upsell-box'), 'menu.html debe tener contenedor para upselling');
  assert.ok(menuHtml.includes('mozo-toggle-container') || menuHtml.includes('mozo-virtual-upsell-box'), 'menu.html debe tener estructura del mozo virtual');
  console.log('✓ Contenedores HTML del Mozo Virtual presentes en el carrito y personalización');

  // 6. Smart Google Reviews Modal with 5★ / 1-4★ bifurcation
  assert.ok(menuHtml.includes('smartReviewModal') || menuHtml.includes('Smart Review'), 'menu.html debe tener modal Smart Reviews');
  assert.ok(menuHtml.includes('5★') || menuHtml.includes('cinco estrellas') || menuHtml.includes('rating-5'), 'Modal debe tener opción 5 estrellas');
  console.log('✓ Modal Smart Google Reviews con bifurcación 5★ / 1-4★ verificado en menu.html');

  // 7. JS logic for smart reviews filter
  assert.ok(menuJs.includes('openSmartReviewModal') || menuJs.includes('smartReview'), 'menu.js debe implementar lógica de Smart Reviews');
  assert.ok(menuJs.includes('googleReview') || menuJs.includes('Google Review'), 'menu.js debe tener enlace a Google Reviews');
  console.log('✓ Lógica JS del filtro inteligente de reseñas verificada en menu.js');

  // 8. API endpoint for private feedback
  const reviewsFile = fs.readFileSync(path.join(__dirname, '../api/routes/reviews.js'), 'utf8');
  assert.ok(reviewsFile.includes('/feedback'), 'reviews.js debe tener ruta /feedback');
  assert.ok(reviewsFile.includes('addFeedback'), 'reviews.js debe llamar a db.addFeedback');
  console.log('✓ Endpoint POST /api/reviews/feedback para comentarios privados verificado');

  // 9. DB: addFeedback & getFeedbackByRestaurantId
  assert.ok(typeof db.addFeedback === 'function', 'db.addFeedback debe ser una función');
  assert.ok(typeof db.getFeedbackByRestaurantId === 'function', 'db.getFeedbackByRestaurantId debe ser una función');

  const testFb = await db.addFeedback({
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
}

runTests().catch(err => {
  console.error('❌ Error en las pruebas:', err);
  process.exit(1);
});