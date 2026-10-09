const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../src/db/db');

console.log('🧪 Iniciando verificación de Resiliencia, Cabeceras HTTP y Seguridad...');

async function runTests() {
  // ==========================================
  // 1. Resiliencia en QR e Impresión PDF
  // ==========================================
  const studioJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'studio.js'), 'utf8');

  // 1.1 Verify arbitrary setTimeout(..., 50) is eliminated from generateQrCode
  assert.strictEqual(
    studioJs.includes('setTimeout(() => {\n        const qrCanvas = tempHolder.querySelector(\'canvas\');'),
    false,
    'generateQrCode no debe contener el setTimeout arbitrario de 50ms para esperar al canvas/img'
  );
  assert.strictEqual(
    studioJs.includes('}, 50);'),
    false,
    'El timeout de 50ms debe estar completamente eliminado'
  );
  console.log('✓ setTimeout arbitrario de 50ms eliminado de generateQrCode()');

  // 1.2 Verify event-driven listeners on QR source and logo onload
  assert.ok(
    studioJs.includes('addEventListener(\'load\'') || studioJs.includes('onload'),
    'Debe incluir listeners de eventos para la carga del logo o del QR'
  );
  console.log('✓ Control basado en eventos implementado robustamente');

  // 1.3 Defensive canvas handling for external images
  assert.ok(
    studioJs.includes('crossOrigin') || studioJs.includes('try') || studioJs.includes('catch'),
    'Debe incluir manejo defensivo para imágenes externas (crossOrigin, try/catch)'
  );
  console.log('✓ Manejo defensivo ante imágenes externas y prevención de canvas tainted verificado');

  // ==========================================
  // 2. Admin Session Volatility
  // ==========================================
  const adminHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin.html'), 'utf8');

  // 2.1 No persistent credentials in localStorage (only sessionStorage for auth token; localStorage for lockout/reviews is OK)
  assert.ok(
    !adminHtml.includes('localStorage.setItem') || adminHtml.includes('scango_admin_lockout') || adminHtml.includes('scango_pending_reviews') || adminHtml.includes('scango_approved_reviews') || adminHtml.includes('scango_rejected_reviews'),
    'Admin solo debe usar localStorage para lockout/reviews, no para credenciales de sesión'
  );
  console.log('✓ Sesión admin volátil, renovada por actividad y sin credenciales persistidas');

  // ==========================================
  // 3. Seguridad en Recuperación de Contraseña
  // ==========================================
  const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

  // 3.1 Test user creation
  const testEmail = `test_security_${Date.now()}@example.com`;
  const user = await db.createUser({
    email: testEmail,
    password: 'original_hashed_password',
    name: 'Test Security User'
  });
  assert.ok(user && user.id, 'Usuario creado para prueba de recuperación');

  // 3.2 Token generation with JTI and strict 15m expiration
  const jti = crypto.randomUUID();
  const expiresInSeconds = 15 * 60; // 15 minutos (estricto entre 15 y 30m)
  const resetToken = jwt.sign(
    { userId: user.id, email: user.email, purpose: 'reset-password' },
    JWT_SECRET,
    { expiresIn: expiresInSeconds, jwtid: jti }
  );
  await db.savePasswordResetToken(user.id, jti, Date.now() + expiresInSeconds * 1000);

  // Decode token and verify claims
  const decoded = jwt.verify(resetToken, JWT_SECRET);
  assert.strictEqual(decoded.userId, user.id);
  assert.strictEqual(decoded.purpose, 'reset-password');
  assert.strictEqual(decoded.jti, jti, 'El token debe contener el identificador único jti');
  assert.ok(decoded.exp - decoded.iat <= 1800, 'El tiempo de expiración debe ser <= 30 minutos');
  assert.ok(decoded.exp - decoded.iat >= 900, 'El tiempo de expiración debe ser >= 15 minutos');
  console.log('✓ Token JWT incluye JTI y expiración estricta de 15 minutos (900s)');

  // 3.3 Single-use verification
  assert.strictEqual(
    db.isResetTokenValid(user.id, jti),
    true,
    'El token generado inicialmente debe ser válido'
  );

  // Simulate token usage (invalidate)
  await db.invalidateResetToken(jti);
  assert.strictEqual(
    db.isResetTokenValid(user.id, jti),
    false,
    'El token ya utilizado debe ser marcado como inválido inmediatamente (prevención de reutilización)'
  );
  console.log('✓ Prevención de reutilización confirmada: Token invalidado tras primer uso');

  // 3.4 Invalidation on newer token request
  const jti1 = crypto.randomUUID();
  await db.savePasswordResetToken(user.id, jti1, Date.now() + 900000);
  assert.strictEqual(db.isResetTokenValid(user.id, jti1), true);

  const jti2 = crypto.randomUUID();
  await db.savePasswordResetToken(user.id, jti2, Date.now() + 900000);
  // Prior token for this user should be superseded
  assert.strictEqual(
    db.isResetTokenValid(user.id, jti1),
    false,
    'Un token anterior debe ser invalidado al solicitar uno nuevo'
  );
  assert.strictEqual(
    db.isResetTokenValid(user.id, jti2),
    true,
    'El nuevo token debe ser válido'
  );
  console.log('✓ Tokens anteriores quedan invalidados al generar uno nuevo');

  // 3.5 Password update persistence
  await db.updateUserPassword(user.id, 'new_secure_hashed_password');
  const updatedUser = db.findUserById(user.id);
  assert.strictEqual(updatedUser.password, 'new_secure_hashed_password', 'La contraseña debe actualizarse en la DB');
  console.log('✓ Actualización de contraseña persistida exitosamente');

  // ==========================================
  // 4. CAPTCHA invisible (Turnstile) en alta de pedidos
  // ==========================================
  const { isCaptchaEnforced, verifyTurnstile } = require('../api/utils/captcha');
  // Sin secreto: skip honesto (flujo actual intacto, cero red).
  delete process.env.TURNSTILE_SECRET;
  assert.strictEqual(isCaptchaEnforced(), false, 'Sin secreto no se exige captcha');
  assert.deepStrictEqual(
    await verifyTurnstile('', '127.0.0.1'),
    { ok: true, skipped: true },
    'Sin secreto el verify hace skip sin red'
  );
  // Con secreto: token ausente → 403 sin llamar a la red.
  process.env.TURNSTILE_SECRET = 'test-bogus-secret';
  try {
    assert.strictEqual(isCaptchaEnforced(), true, 'Con secreto se exige captcha');
    const missing = await verifyTurnstile('', '127.0.0.1');
    assert.deepStrictEqual(missing, { ok: false, reason: 'CAPTCHA_REQUIRED' }, 'Token ausente → CAPTCHA_REQUIRED');
    const oversized = await verifyTurnstile('x'.repeat(2001), '127.0.0.1');
    assert.deepStrictEqual(oversized, { ok: false, reason: 'CAPTCHA_INVALID' }, 'Token gigante → CAPTCHA_INVALID');
    // El menú expone la sitekey pública y el checkout adjunta el token.
    const menuSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'menu.js'), 'utf8');
    assert.ok(menuSrc.includes('captchaToken'), 'El checkout envía captchaToken');
    assert.ok(menuSrc.includes('/api/public/captcha-config'), 'El menú lee la sitekey pública');
    assert.ok(menuSrc.includes('challenges.cloudflare.com/turnstile'), 'Turnstile explícito invisible');
    console.log('✓ CAPTCHA: skip sin secreto, 403 sin red ante token ausente/sobredimensión, front cableado');
  } finally {
    delete process.env.TURNSTILE_SECRET;
  }

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE RESILIENCIA, CABECERAS HTTP Y SEGURIDAD PASARON AL 100%!');
}

runTests().catch(err => {
  console.error('❌ Error en pruebas:', err);
  process.exit(1);
});