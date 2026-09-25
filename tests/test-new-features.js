const fs = require('fs');
const path = require('path');
const db = require('../src/db/db');

console.log('🧪 Iniciando verificación de las nuevas funcionalidades...');

// 1. Check HTML Accessibility & SEO
const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

// 1.1 Main Landmark
if (!indexHtml.includes('<main id="main-content">') || !indexHtml.includes('</main>')) {
  throw new Error('Falta la etiqueta semántica <main id="main-content">');
}
console.log('✓ Landmark <main> correctamente implementado');

// 1.2 Explicit dimensions on logos
if (!indexHtml.includes('width="45" height="44"') || !indexHtml.includes('width="39" height="38"')) {
  throw new Error('Faltan dimensiones explícitas en las imágenes del logo');
}
console.log('✓ Dimensiones explícitas (width y height) añadidas a logos');

// 1.3 Color contrast on badge
if (!indexHtml.includes('style="color:#4ade80; background:#143826; border-color:#22c55e;"')) {
  throw new Error('Falta el estilo de alto contraste en el badge de la demo');
}
console.log('✓ Contraste de color del badge corregido para superar 4.5:1');

// 1.4 Heading order
const h4Count = (indexHtml.match(/<h4/g) || []).length;
if (h4Count > 0) {
  throw new Error(`Se encontraron ${h4Count} etiquetas <h4> que rompen la jerarquía de encabezados`);
}
console.log('✓ Jerarquía de encabezados validada (h1 -> h2 -> h3, sin <h4> saltados)');

// 1.5 Redundant elements removed
if (indexHtml.includes('Probar Menú en Vivo 📱')) {
  throw new Error('El botón redundante "Probar Menú en Vivo 📱" no fue eliminado');
}
console.log('✓ Botón redundante "Probar Menú en Vivo 📱" eliminado');

// 1.6 WhatsApp button & Uruguay phone number
if (!indexHtml.includes('59897089957') || !indexHtml.includes('id="waFloatBtn"')) {
  throw new Error('Falta el botón flotante de WhatsApp o el número de Uruguay');
}
console.log('✓ Botón flotante de WhatsApp configurado con número de Uruguay (+598 97 089 957)');

// 1.7 Password Recovery Modal
if (!indexHtml.includes('id="forgotPasswordModal"') || !indexHtml.includes('openForgotPasswordModal')) {
  throw new Error('Falta el modal de recuperación de contraseña');
}
console.log('✓ Modal de recuperación de contraseña con doble opción implementado');

// 1.8 Dynamic Promo Banner & Pricing IDs
if (!indexHtml.includes('id="promoBanner"') || !indexHtml.includes('id="planMonthlyPrice"')) {
  throw new Error('Faltan identificadores para el banner promocional y precios dinámicos');
}
console.log('✓ Banner dinámico de descuentos y selectores de precios presentes');

// 2. Test DB Settings Methods
const initialSettings = db.getSettings();
if (!initialSettings.monthlyPrice || !initialSettings.annualPrice) {
  throw new Error('Error al obtener la configuración inicial de precios');
}
console.log('✓ db.getSettings() funciona correctamente:', initialSettings);

const updatedSettings = db.updateSettings({
  monthlyPrice: 12,
  annualPrice: 89,
  promoDiscountPercent: 40
});
if (updatedSettings.monthlyPrice !== 12 || updatedSettings.annualPrice !== 89) {
  throw new Error('Error al actualizar configuración en db.updateSettings');
}
console.log('✓ db.updateSettings() persiste y retorna valores actualizados');

// Restablecer valores estándar
db.updateSettings({
  monthlyPrice: 9,
  annualPrice: 69,
  annualDiscountPercent: 36,
  promoBannerEnabled: true,
  promoDiscountPercent: 50,
  promoBannerText: '🔥 ¡50% OFF por tiempo limitado en todos los planes! Lanzá tu carta hoy.'
});
console.log('✓ Configuración estándar restaurada');

console.log('\n🎉 ¡TODAS LAS VERIFICACIONES DE LAS NUEVAS FUNCIONALIDADES PASARON EXITOSAMENTE!');
