/**
 * tests/test-set-password.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests dedicados para POST /api/auth/set-password.
 *
 * Cubre:
 *   §1 - Establecer primera contraseña con sesión válida (200)
 *   §2 - Rechazar sin autenticación (401)
 *   §3 - Rechazar contraseña muy corta (400)
 *   §4 - Rechazar body vacío (400)
 *   §5 - Verificar que la nueva contraseña permite hacer login
 *   §6 - Verificar que la contraseña se hashea correctamente
 */

const assert = require('assert');
const http = require('http');
const jwt = require('jsonwebtoken');
const app = require('../api/index');
const db = require('../src/db/db');
const { comparePassword } = require('../api/utils/hash');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

function makeAuthCookie(user) {
  const pwdTs = user.updatedAt || user.createdAt || Date.now();
  const token = jwt.sign(
    { userId: user.id, email: user.email, pwdTs },
    JWT_SECRET,
    { expiresIn: '5m' }
  );
  return `auth_token=${token}`;
}

function postJson(port, path, body, cookie) {
  return fetch(`http://localhost:${port}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}

async function runTests() {
  console.log('🧪 Iniciando verificación de set-password...');

  const stamp = Date.now();
  const email = `setpw-${stamp}@example.com`;

  // Crear usuario con contraseña original
  const user = await db.createUser({
    email,
    password: 'contraseña_original_123',
    name: 'Usuario SetPassword',
    email_confirmed_at: new Date().toISOString()
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    // ── §1 - Establecer primera contraseña con sesión válida ──────────────
    console.log('  §1 - set-password con sesión válida...');
    const cookie = makeAuthCookie(user);

    const setRes = await postJson(port, '/api/auth/set-password', {
      newPassword: 'NuevaClaveSegura123'
    }, cookie);

    assert.strictEqual(setRes.status, 200, 'set-password válido → 200');
    const setBody = await setRes.json();
    assert.ok(setBody.success, 'set-password responde success');
    console.log('   ✓ set-password → 200 success');

    // Después del cambio de contraseña, updatedAt cambió → generar cookie fresca
    const userUpdated = await db.findUserById(user.id);
    assert.ok(userUpdated, 'Usuario existe después del set-password');
    const cookieFresh = makeAuthCookie(userUpdated);

    // ── §5 - Verificar que la nueva contraseña permite hacer login ────────
    console.log('  §5 - Login con nueva contraseña...');
    const loginRes = await postJson(port, '/api/auth/login', {
      email,
      password: 'NuevaClaveSegura123'
    });
    assert.strictEqual(loginRes.status, 200, 'Login con nueva contraseña → 200');
    const loginBody = await loginRes.json();
    assert.ok(loginBody.success, 'Login responde success');
    console.log('   ✓ Login con nueva contraseña → 200');

    // Verificar que la contraseña antigua ya no funciona
    const oldLoginRes = await postJson(port, '/api/auth/login', {
      email,
      password: 'contraseña_original_123'
    });
    assert.strictEqual(oldLoginRes.status, 401, 'Login con contraseña antigua → 401');
    console.log('   ✓ Contraseña antigua ya no funciona → 401');

    // ── §2 - Rechazar sin autenticación ──────────────────────────────────
    console.log('  §2 - set-password sin autenticación...');
    const noAuthRes = await postJson(port, '/api/auth/set-password', {
      newPassword: 'NuevaClave123'
    });
    assert.strictEqual(noAuthRes.status, 401, 'set-password sin auth → 401');
    console.log('   ✓ Sin auth → 401');

    // ── §3 - Rechazar contraseña muy corta ───────────────────────────────
    console.log('  §3 - set-password contraseña corta...');
    const shortRes = await postJson(port, '/api/auth/set-password', {
      newPassword: '123'
    }, cookieFresh);
    assert.strictEqual(shortRes.status, 400, 'Contraseña corta → 400');
    console.log('   ✓ Contraseña corta → 400');

    // ── §4 - Rechazar body vacío ──────────────────────────────────────────
    console.log('  §4 - set-password body vacío...');
    const emptyRes = await postJson(port, '/api/auth/set-password', {}, cookieFresh);
    assert.strictEqual(emptyRes.status, 400, 'Body vacío → 400');
    console.log('   ✓ Body vacío → 400');

    // ── §6 - Verificar que la contraseña se hashea correctamente ──────────
    console.log('  §6 - Verificar hash de contraseña...');
    assert.ok(userUpdated, 'Usuario existe después del set-password');
    const passwordMatch = await comparePassword('NuevaClaveSegura123', userUpdated.password);
    assert.strictEqual(passwordMatch, true, 'La nueva contraseña coincide con el hash');
    console.log('   ✓ Hash de contraseña correcto');

    console.log('\n✓ TODAS LAS PRUEBAS DE SET-PASSWORD PASARON!');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

runTests().catch(err => {
  console.error('❌ Error en pruebas de set-password:', err);
  process.exit(1);
});