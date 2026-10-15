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
const headerModSrc = fs.readFileSync(path.join(__dirname, '../public/js/menu/menuHeader.js'), 'utf8');

assert.ok(menuCss.includes('object-fit: cover;'), 'menu.css debe usar object-fit: cover en .menu-banner-img');
assert.ok(menuCss.includes('.menu-banner-overlay'), 'menu.css debe superponer el degradado al banner');
assert.ok(menuJs.includes('menu-banner-status-slot') || headerModSrc.includes('menu-banner-status-slot'), 'menu.js debe ubicar la insignia de estado sobre el banner');
assert.ok(menuJs.includes('menu-banner-logo-slot') || headerModSrc.includes('menu-banner-logo-slot'), 'menu.js debe ubicar el logo sobre el banner');
console.log('Hero público con cover, degradado y logo/estado verificado');

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

// Respaldo por entorno (Vercel serverless): con ALLOW_NEW_SUBSCRIPTIONS=false
// el gate bloquea aunque la memoria diga true, y el getter lo refleja.
process.env.ALLOW_NEW_SUBSCRIPTIONS = 'false';
let envNext = false;
killSwitch.checkSubscriptionKillSwitch(mockReq, mockRes, () => { envNext = true; });
assert.strictEqual(envNext, false, 'Con env=false no llama next() aunque la memoria diga true');
assert.strictEqual(mockRes.statusCode, 503, 'Con env=false devuelve 503');
assert.strictEqual(killSwitch.getSubscriptionKillSwitch(), false, 'El getter refleja el bloqueo por entorno');
delete process.env.ALLOW_NEW_SUBSCRIPTIONS;
assert.strictEqual(killSwitch.getSubscriptionKillSwitch(), true, 'Sin la env, vuelve a mandar la memoria');
console.log('✓ Middleware y lógica del Kill-Switch (HTTP 503 estructurado) verificados');

// Check admin routes & UI
const adminRouterSrc = fs.readFileSync(path.join(__dirname, '../api/routes/admin.js'), 'utf8');
const adminHtml = fs.readFileSync(path.join(__dirname, '../public/admin.html'), 'utf8');
assert.ok(adminRouterSrc.includes("'/killswitch'"), 'routes/admin.js debe tener endpoints /api/admin/killswitch');
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

// 3b. GEO anti-drift: los precios y el trial que citan los archivos de IA deben
// coincidir con plans.json (fuente única de verdad). Antes llms-full.txt decía
// "Pro Anual USD $69" y "14 días de Free Trial": mentiras que una IA habría citado.
// Este guard falla si se cambian los precios y se olvida actualizar llms*.txt.
const plans = require('../src/billing/plans.json');
for (const [planId, cfg] of Object.entries(plans)) {
  if (planId === 'TRIAL_DAYS') continue;
  assert.ok(llmsTxt.includes(`$${cfg.price}`), `llms.txt debe citar el precio real de ${planId} ($${cfg.price})`);
  assert.ok(llmsFullTxt.includes(`$${cfg.price}`), `llms-full.txt debe citar el precio real de ${planId} ($${cfg.price})`);
}
assert.ok(llmsTxt.includes(`${plans.TRIAL_DAYS} días`), `llms.txt debe declarar ${plans.TRIAL_DAYS} días de prueba`);
assert.ok(llmsFullTxt.includes(`${plans.TRIAL_DAYS} días`), `llms-full.txt debe declarar ${plans.TRIAL_DAYS} días de prueba`);
assert.ok(!/\$69\b/.test(llmsFullTxt), 'llms-full.txt no debe contener el precio viejo $69');
assert.ok(!/14 días de Free Trial/.test(llmsFullTxt), 'llms-full.txt no debe declarar 14 días de prueba');
console.log('✓ GEO sin drift: precios y trial de llms*.txt == plans.json');

// 3c. GEO anti-drift de features: lo nuevo (embudo neutral, Descubrir beta)
// debe estar documentado para la IA, sin el copy viejo del filtro 5★/1-4★.
assert.ok(llmsTxt.includes('Descubrir'), 'llms.txt debe documentar Descubrir beta');
assert.ok(!llmsTxt.includes('1 a 4 estrellas se canalizan'), 'llms.txt no debe describir el embudo viejo');
assert.ok(llmsFullTxt.includes('/descubrir') && llmsFullTxt.includes('/api/discover/feed'), 'llms-full.txt debe documentar la página y el endpoint');
assert.ok(llmsFullTxt.includes('4-5'), 'llms-full.txt debe describir el embudo actual (4-5★ Google)');
console.log('✓ GEO features: embudo neutral + Descubrir documentados, copy viejo afuera');

// 3c. GEO ↔ soluciones: los archivos de IA deben exponer el hub y cada landing por
// rubro. Si se agrega un rubro y no se documenta acá, este guard lo detecta.
const seoSolutions = require('../api/utils/seoSolutions');
assert.ok(llmsTxt.includes('/soluciones'), 'llms.txt debe enlazar el hub /soluciones');
assert.ok(llmsFullTxt.includes('/soluciones'), 'llms-full.txt debe documentar /soluciones');
for (const solution of seoSolutions.getAllSolutions()) {
  assert.ok(llmsFullTxt.includes(`/soluciones/${solution.slug}`), `llms-full.txt debe listar /soluciones/${solution.slug}`);
}
console.log('✓ GEO ↔ soluciones: hub + 4 landings por rubro documentadas para la IA');

const indexHtml = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
assert.ok(indexHtml.includes('application/ld+json'), 'index.html debe tener bloque JSON-LD');
assert.ok(indexHtml.includes('"@type": "SoftwareApplication"'), 'index.html debe tener entidad SoftwareApplication');
assert.ok(indexHtml.includes('"@type": "FAQPage"'), 'index.html debe tener entidad FAQPage');
console.log('✓ Optimización para Modelos de IA (GEO: llms.txt, llms-full.txt y Schema JSON-LD) validada');

// 4. El Mozo Virtual: Motor Heurístico Avanzado y 100% Opcional
assert.ok(menuJs.includes('isMozoVirtualEnabled'), 'menu.js debe definir isMozoVirtualEnabled()');
assert.ok(menuJs.includes('handleMozoVirtualToggle'), 'menu.js debe definir handleMozoVirtualToggle()');
assert.ok(menuJs.includes('analyzeCartContextForUpsell'), 'menu.js debe definir analyzeCartContextForUpsell()');
assert.ok(menuJs.includes('mozo-reason-banner') || fs.readFileSync(path.join(__dirname, '../public/js/menu/cartUpsell.js'), 'utf8').includes('mozo-reason-banner'), 'menu/cartUpsell.js y css deben incluir banner de razón persuasiva');

const menuHtml = fs.readFileSync(path.join(__dirname, '../public/menu.html'), 'utf8');
assert.ok(menuHtml.includes('id="toggleMozoVirtual"'), 'menu.html debe tener checkbox #toggleMozoVirtual');
assert.ok(menuHtml.includes('data-js-change="handleMozoVirtualToggle|this.checked"'), 'menu.html debe vincular data-js-change al toggle (CSP estricto: usa dom-bindings)');

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
