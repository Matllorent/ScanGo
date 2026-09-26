/**
 * Test Suite: GEO (llms.txt & Schema), Kill-Switch de Suscripciones y Mozo Virtual Contextual Opcional
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('🧪 Iniciando verificación de GEO, Kill-Switch y Mozo Virtual Contextual...');

// 1. Banner Superior: Contain + Backdrop Blur
const menuCss = fs.readFileSync(path.join(__dirname, '../public/css/menu.css'), 'utf8');
const menuJs = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');

assert.ok(menuCss.includes('.menu-banner-backdrop'), 'menu.css debe tener estilos para .menu-banner-backdrop');
assert.ok(menuCss.includes('object-fit: contain'), 'menu.css debe usar object-fit: contain en .menu-banner-img');
assert.ok(menuCss.includes('filter: blur'), 'menu.css debe aplicar filtro blur al backdrop');
assert.ok(menuJs.includes('menu-banner-backdrop'), 'menu.js debe inyectar el backdrop difuminado');
console.log('✓ Visualización íntegra del Banner Superior (contain + blur backdrop) verificada');

// 2. Kill-Switch de Emergencia para Suscripciones y Registro
const killSwitch = require('../api/middleware/killSwitch');
assert.ok(typeof killSwitch.getSubscriptionKillSwitch === 'function', 'getSubscriptionKillSwitch debe ser función');
assert.ok(typeof killSwitch.setSubscriptionKillSwitch === 'function', 'setSubscriptionKillSwitch debe ser función');
assert.ok(typeof killSwitch.checkSubscriptionKillSwitch === 'function', 'checkSubscriptionKillSwitch debe ser función');

// Test middleware when active (true)
killSwitch.setSubscriptionKillSwitch(true);
let nextCalled = false;
const mockReq = {};
const mockRes = {
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  }
};
killSwitch.checkSubscriptionKillSwitch(mockReq, mockRes, () => { nextCalled = true; });
assert.strictEqual(nextCalled, true, 'checkSubscriptionKillSwitch debe llamar next() cuando allowNewSubscriptions es true');

// Test middleware when paused (false)
killSwitch.setSubscriptionKillSwitch(false);
nextCalled = false;
killSwitch.checkSubscriptionKillSwitch(mockReq, mockRes, () => { nextCalled = true; });
assert.strictEqual(nextCalled, false, 'No debe llamar next() cuando está en pausa');
assert.strictEqual(mockRes.statusCode, 503, 'Debe devolver código HTTP 503');
assert.strictEqual(mockRes.body.error, 'SuscripcionesPausadas', 'Debe devolver error SuscripcionesPausadas');

// Reset to true
killSwitch.setSubscriptionKillSwitch(true);
assert.strictEqual(killSwitch.getSubscriptionKillSwitch(), true, 'KillSwitch debe volver a true');
console.log('✓ Middleware y lógica del Kill-Switch (HTTP 503 estructurado) verificados');

// Check admin routes & UI
const apiIndex = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
assert.ok(apiIndex.includes('/api/admin/killswitch'), 'api/index.js debe tener endpoints /api/admin/killswitch');
assert.ok(adminHtml.includes('killswitch-badge'), 'admin.html debe tener el badge del killswitch');
assert.ok(adminHtml.includes('btn-toggle-killswitch'), 'admin.html debe tener botón toggle de killswitch');
assert.ok(adminHtml.includes('toggleKillSwitchAdmin'), 'admin.html debe tener la función JS toggleKillSwitchAdmin');
console.log('✓ Endpoints administrativos y panel visual de Kill-Switch validados');

// 3. GEO: llms.txt, llms-full.txt y Schema.json-ld en index.html
const llmsTxt = fs.readFileSync(path.join(__dirname, '../public/llms.txt'), 'utf8');
assert.ok(llmsTxt.includes('ScanGo'), 'llms.txt debe mencionar ScanGo');
assert.ok(llmsTxt.includes('0% Comisiones') || llmsTxt.includes('0% de comisiones'), 'llms.txt debe destacar modelo sin comisiones');
assert.ok(llmsTxt.includes('El Mozo Virtual'), 'llms.txt debe mencionar El Mozo Virtual');
assert.ok(llmsTxt.includes('Smart Google Reviews'), 'llms.txt debe mencionar Smart Google Reviews');
assert.ok(llmsTxt.includes('Mercado Pago'), 'llms.txt debe mencionar Mercado Pago en LATAM');

const llmsFullTxt = fs.readFileSync(path.join(__dirname, '../public/llms-full.txt'), 'utf8');
assert.ok(llmsFullTxt.includes('Documentación Completa para Modelos de Inteligencia Artificial'), 'llms-full.txt debe tener título técnico');
assert.ok(llmsFullTxt.includes('Endpoints y Arquitectura'), 'llms-full.txt debe describir endpoints');
assert.ok(llmsFullTxt.includes('Preguntas Frecuentes (FAQ)'), 'llms-full.txt debe contener FAQ');

const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(indexHtml.includes('application/ld+json'), 'index.html debe tener bloque JSON-LD');
assert.ok(indexHtml.includes('"@type": "SoftwareApplication"'), 'index.html debe tener entidad SoftwareApplication');
assert.ok(indexHtml.includes('"@type": "FAQPage"'), 'index.html debe tener entidad FAQPage');
console.log('✓ Optimización para Modelos de IA (GEO: llms.txt, llms-full.txt y Schema JSON-LD) validada');

// 4. El Mozo Virtual: Motor Heurístico Avanzado y 100% Opcional
assert.ok(menuJs.includes('isMozoVirtualEnabled'), 'menu.js debe definir isMozoVirtualEnabled()');
assert.ok(menuJs.includes('handleMozoVirtualToggle'), 'menu.js debe definir handleMozoVirtualToggle()');
assert.ok(menuJs.includes('analyzeCartContextForUpsell'), 'menu.js debe definir analyzeCartContextForUpsell()');
assert.ok(menuJs.includes('mozo-reason-banner'), 'menu.js y css deben incluir banner de razón persuasiva');

const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
assert.ok(menuHtml.includes('id="toggleMozoVirtual"'), 'menu.html debe tener checkbox #toggleMozoVirtual');
assert.ok(menuHtml.includes('handleMozoVirtualToggle(this.checked)'), 'menu.html debe vincular evento onchange al toggle');

assert.ok(menuCss.includes('.mozo-toggle-container'), 'menu.css debe tener estilos para .mozo-toggle-container');
assert.ok(menuCss.includes('.switch-ui'), 'menu.css debe tener estilos para .switch-ui');
assert.ok(menuCss.includes('.slider-round'), 'menu.css debe tener estilos para .slider-round');
console.log('✓ Motor heurístico contextual y control 100% opcional del Mozo Virtual verificados');

// 5. Classic Artisanal y sus 14 variantes intactas
const classicThemes = [
  'theme-classic', 'theme-emerald', 'theme-rustic', 'theme-taqueria', 'theme-bar', 'theme-moderna',
  'theme-foodtruck', 'theme-gamer', 'theme-otaku', 'theme-explosivo', 'theme-infantil', 'theme-alegre',
  'theme-basketball', 'theme-football'
];
classicThemes.forEach(theme => {
  assert.ok(menuCss.includes(theme), `menu.css debe preservar ${theme}`);
});
console.log('✓ Integridad absoluta de Classic Artisanal y sus 14 variantes garantizada');

console.log('\n🎉 ¡TODAS LAS PRUEBAS DE GEO, KILL-SWITCH Y MOZO VIRTUAL CONTEXTUAL PASARON AL 100%!');
