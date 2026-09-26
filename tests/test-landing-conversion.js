const assert = require('assert');
const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('public/index.html');
const css = read('public/css/index.css');
const client = read('public/js/index.js');
const auth = read('api/routes/auth.js');

assert.ok(html.includes('Probar 7 días gratis con Google'), 'La landing y el modal deben ofrecer el alta con Google');
assert.ok(html.includes('window.loadGoogleIdentityServices'), 'GIS debe cargarse bajo demanda para proteger el LCP');
assert.ok(client.includes("https://accounts.google.com/gsi/client") === false, 'El script externo debe cargarse desde el loader diferido de HTML');
assert.ok(client.includes("fetch('/api/auth/google'"), 'El ID token debe validarse en el backend');
assert.ok(auth.includes("router.post('/google'"));
assert.ok(auth.includes('verifyIdToken({'));
assert.ok(auth.includes('audience: GOOGLE_CLIENT_ID'));
assert.ok(auth.includes('googleProfile.email_verified !== true'));

assert.ok(html.includes('id="monthlySalesSlider"') && html.includes('value="100000"'));
assert.ok(html.includes('id="deliveryCommissionValue">$20.000/mes'));
assert.ok(html.includes('id="monthlySavingsValue">$19.991/mes'));
assert.ok(client.includes('sales * 0.2'));
assert.ok(client.includes('deliveryCommission - 9'));

assert.ok(html.includes('id="demo-interactiva"'));
assert.ok(html.includes("simAddDish('Burger Criolla', 490)"));
assert.ok(css.includes('.savings-layout'));
assert.ok(css.includes('@media (max-width: 600px)'));

console.log('✓ Landing: Google seguro, ahorro en vivo y simulador sin registro verificados');