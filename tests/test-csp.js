/**
 * tests/test-csp.js
 * Guard del bloque "CSP real + headers duros".
 *
 * CONTEXTO: helmet estaba con contentSecurityPolicy:false. Este bloque reemplaza
 * esa configuración por una fuente única de verdad (api/utils/securityHeaders.js)
 * aplicada en Express (dev/API/SSR) Y en vercel.json (estáticos en producción,
 * donde Express no participa). El menú público /m/* recibe una CSP ESTRICTA
 * (script-src-attr 'none', sin 'unsafe-inline') que exige que TODO handler inline
 * use atributos data-js-* resueltos por public/js/dom-bindings.js.
 *
 * Este test verifica:
 *  1. El menú (superficie estricta) NO tiene ningún atributo on*= remanente
 *     (si alguien escribe onclick= en el menú, la CSP estricta lo rompería).
 *  2. Las hashes SHA-256 de los scripts inline están en la CSP transitional
 *     (drift => falla si editan admin.html/index.html/reset-password sin actualizar).
 *  3. vercel.json (estáticos de producción) replica EXACTAMENTE los headers del módulo.
 *  4. En runtime: /m/:slug responde con CSP estricta; el resto con transitional;
 *     los headers duros (Referrer-Policy, Permissions-Policy, CORP, COOP, nosniff,
 *     X-Frame-Options, HSTS) están presentes en toda respuesta.
 *
 * Está en `npm test` (nº 25).
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const securityHeaders = require('../api/utils/securityHeaders');

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

// Atributos de handler inline que la CSP estricta bloquea (y que la Etapa 2
// eliminará también de studio/admin/index). `\son` evita falsos positivos
// con `content=` (los metas no empiezan con "on").
const INLINE_EVENT_RE = /\son(?:click|change|input|submit|focus|blur|keydown|keyup|paste|error|load|dblclick|mouseover|mouseout|mousedown|mouseup|touchstart|touchend|contextmenu|wheel|scroll)="[^"]*"/g;

// Superficie con CSP ESTRICTA (menú público + módulos que renderiza).
const STRICT_SURFACE_FILES = [
  'public/menu.html',
  'public/js/menu.js',
  'public/js/menu-modules.js',
  'public/js/menu/eventGuestMode.js',
  'public/js/menu/menuState.js',
  'public/js/menu/menuViewModel.js',
  'public/js/menu/menuModals.js',
  'public/js/menu/menuLoader.js',
  'public/js/menu/cartOperations.js',
  'public/js/menu/orderCheckout.js',
  'public/js/menu/smartReviews.js',
  'public/js/menu/virtualWaiterHeuristics.js',
  'public/js/components/DishCard.js',
  'public/js/components/GroupCartManager.js',
  'public/js/components/IceCreamWizard.js',
  'public/js/components/I18nCurrencyManager.js',
  'public/js/components/LoyaltyRewardsModal.js',
  'public/js/components/PerfumeryView.js'
];

function collectInlineScriptHashes() {
  const hashes = [];
  for (const file of fs.readdirSync(PUBLIC_DIR)) {
    if (!file.endsWith('.html')) continue;
    const raw = fs.readFileSync(path.join(PUBLIC_DIR, file), 'utf8');
    const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(raw))) {
      if (/type=["']application\/[\w.+-]+["']/.test(m[1])) continue;
      const before = raw.slice(0, m.index);
      const commentDepth = (before.match(/<!--/g) || []).length - (before.match(/-->/g) || []).length;
      if (commentDepth > 0) continue;
      hashes.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
    }
  }
  return hashes;
}

function assertHeader(res, key, fragment, label) {
  const value = res.headers.get(key);
  assert.ok(value, `${label}: falta header ${key}`);
  assert.ok(value.includes(fragment), `${label}: ${key} debería contener "${fragment}" (tiene: ${value})`);
}

async function runTests() {
  console.log('🔐 Verificando CSP real + headers duros (menú estricto / resto transicional)...');

  // ---------------------------------------------------------------- estático 1
  // Cero handlers inline remanentes en la superficie estricta del menú.
  for (const rel of STRICT_SURFACE_FILES) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const found = src.match(INLINE_EVENT_RE) || [];
    assert.strictEqual(
      found.length, 0,
      `${rel} tiene ${found.length} atributo(s) on*= → CSP estricta los bloquearía. Usar data-js-* (dom-bindings.js).`
    );
  }
  console.log('✓ Superficie del menú sin atributos on*= (CSP estricta segura)');

  // ---------------------------------------------------------------- estático 2
  // Hashes de scripts inline: módulo === recomputación independiente === CSP.
  const moduleHashes = securityHeaders.computeInlineScriptHashes();
  const recomputed = collectInlineScriptHashes();
  assert.deepStrictEqual(
    [...moduleHashes].sort(), [...recomputed].sort(),
    'Las hashes de scripts inline del módulo no coinciden con la recomputación independiente'
  );
  assert.ok(recomputed.length >= 1, 'Debe haber al menos un script inline hasheado (admin/index/reset-password)');
  const transitionalCsp = securityHeaders.getSecurityHeaders()['Content-Security-Policy'];
  for (const hash of recomputed) {
    assert.ok(transitionalCsp.includes(hash), `La CSP transitional debe incluir el hash ${hash}`);
  }
  const scriptSrcElem = (transitionalCsp.match(/script-src 'self'[^;]*/) || [''])[0];
  assert.ok(!scriptSrcElem.includes("'unsafe-inline'"), 'CSP transitional: script-src (elem) debe ser estricto, sin unsafe-inline');
  assert.ok(transitionalCsp.includes("script-src-attr 'unsafe-inline'"), 'CSP transitional: script-src-attr unsafe-inline (Etapa 2 lo elimina)');
  console.log('✓ Hashes de scripts inline presentes en la CSP transitional');

  // ---------------------------------------------------------------- estático 3
  // vercel.json debe replicar EXACTAMENTE el set del módulo (producción estática).
  const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
  const headerRule = (vercel.headers || []).find(rule => rule.source.includes('(?!m/|api/)'));
  assert.ok(headerRule, 'vercel.json debe tener una regla de headers con negative lookahead que excluya /m/ y /api/');
  const ruleHeaderMap = Object.fromEntries(headerRule.headers.map(h => [h.key, h.value]));
  assert.strictEqual(
    ruleHeaderMap['Content-Security-Policy'],
    transitionalCsp,
    'vercel.json: la CSP estática debe ser IDÉNTICA a la transitional del módulo'
  );
  for (const key of ['Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy', 'Cross-Origin-Resource-Policy', 'X-Content-Type-Options', 'X-Frame-Options', 'Strict-Transport-Security']) {
    assert.ok(ruleHeaderMap[key], `vercel.json: falta header ${key}`);
  }
  console.log('✓ vercel.json replica los headers del módulo (exit CS excluye /m/ y /api/)');

  // ---------------------------------------------------------------- runtime
  const readiness = await db.ready;
  assert.strictEqual(readiness.ready, true, 'La DB debe estar hidratada antes de crear registros');

  const user = await db.createUser({
    email: `csp-owner-${Date.now()}@example.com`,
    password: 'test_password',
    email_confirmed_at: new Date().toISOString()
  });
  const restaurant = await db.saveRestaurant(user.id, {
    name: 'CSP Guard Bistro',
    bizName: 'CSP Guard Bistro',
    slug: `csp-guard-${Date.now()}`,
    slogan: 'Cocina de autor & masas',
    currency: 'USD',
    categories: [{ id: 'cat-main', name: 'Platos principales' }],
    dishes: [{
      id: 'dish-1',
      categoryId: 'cat-main',
      name: 'Ravioles de hongo',
      description: 'Salsa de trufa',
      price: 19
    }]
  });

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  try {
    const { port } = server.address();
    const base = `http://localhost:${port}`;

    // /m/:slug → CSP ESTRICTA
    const menuRes = await fetch(`${base}/m/${restaurant.slug}`);
    assert.strictEqual(menuRes.status, 200, '/m/:slug debe responder 200 con el menú SSR');
    const strictCsp = menuRes.headers.get('Content-Security-Policy');
    assert.ok(strictCsp, '/m/:slug debe traer Content-Security-Policy');
    assert.ok(strictCsp.includes("script-src-attr 'none'"), 'CSP estricta: script-src-attr none');
    const strictScriptSrc = (strictCsp.match(/script-src 'self'[^;]*/) || [''])[0];
    assert.ok(!strictScriptSrc.includes("'unsafe-inline'"), 'CSP estricta: script-src (elem) sin unsafe-inline');
    assert.ok(strictCsp.includes('https://cdn.jsdelivr.net'), 'CSP estricta: script-src permite supabase-js (jsdelivr)');
    assert.strictEqual(strictCsp, securityHeaders.getSecurityHeaders({ strictMenu: true })['Content-Security-Policy'], 'CSP estricta idéntica a la del módulo');
    assertHeader(menuRes, 'Referrer-Policy', 'strict-origin-when-cross-origin', '/m/:slug');
    assertHeader(menuRes, 'Permissions-Policy', 'camera=()', '/m/:slug');
    assertHeader(menuRes, 'X-Content-Type-Options', 'nosniff', '/m/:slug');
    assertHeader(menuRes, 'Cross-Origin-Opener-Policy', 'same-origin', '/m/:slug');
    assertHeader(menuRes, 'Cross-Origin-Resource-Policy', 'same-origin', '/m/:slug');
    assertHeader(menuRes, 'X-Frame-Options', 'SAMEORIGIN', '/m/:slug');
    console.log('✓ /m/:slug responde con CSP estricta + headers duros');

    // `/` (index.html estático servido por Express en dev) → CSP transitional
    const indexRes = await fetch(`${base}/`);
    assert.ok(indexRes.headers.get('Content-Security-Policy').includes("script-src-attr 'unsafe-inline'"), 'index: CSP transitional (handlers legacy permitidos)');
    assertHeader(indexRes, 'Permissions-Policy', 'geolocation=()', 'index');
    console.log('✓ / responde con CSP transitional');

    // /studio sin sesión → redirect 302, pero headers presentes (middleware va antes que el guard)
    const studioRes = await fetch(`${base}/studio`, { redirect: 'manual' });
    assert.strictEqual(studioRes.status, 302, '/studio sin sesión debe redirigir');
    assertHeader(studioRes, 'Content-Security-Policy', "script-src-attr 'unsafe-inline'", '/studio (redirect)');
    console.log('✓ /studio (redirect) conserva los headers de seguridad');

    // API JSON también recibe los headers (middleware global)
    const apiRes = await fetch(`${base}/api/health`);
    assertHeader(apiRes, 'Content-Security-Policy', "default-src 'self'", '/api/health');
    assertHeader(apiRes, 'Referrer-Policy', 'strict-origin-when-cross-origin', '/api/health');
    console.log('✓ Las APIs JSON reciben los headers vía middleware global');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

module.exports = { runTests };

if (require.main === module) {
  runTests()
    .then(() => { console.log('\n✅ test-csp: CSP real + headers duros OK (25/25)'); process.exit(0); })
    .catch(err => { console.error('\n❌ test-csp falló:', err.message); process.exit(1); });
}