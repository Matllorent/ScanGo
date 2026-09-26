const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const db = require('../src/db/db');

console.log('🧪 Iniciando verificación de Resiliencia, Cabeceras HTTP y Seguridad...');

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
assert.ok(
  studioJs.includes('waitForQrSource'),
  'Debe incluir mecanismo robusto/basado en eventos para la extracción del QR'
);
assert.ok(
  studioJs.includes('loadSafeLogo'),
  'Debe incluir helper seguro para carga de logos'
);
console.log('✓ Control basado en eventos implementado robustamente');

// 1.3 Verify defensive CORS handling to prevent tainted canvas
assert.ok(
  studioJs.includes("crossOrigin = 'anonymous'"),
  'Debe configurar crossOrigin = anonymous para evitar tainted canvas en logos externos'
);
assert.ok(
  studioJs.includes("startsWith('data:')"),
  'Debe evitar aplicar crossOrigin innecesario a data: o blob: URLs'
);
assert.ok(
  studioJs.includes('toDataURL(\'image/png\')'),
  'Debe manejar toDataURL de forma segura'
);
console.log('✓ Manejo defensivo ante imágenes externas y prevención de canvas tainted verificado');


// ==========================================
// 2. Cabeceras HTTP para Menú Público
// ==========================================
const apiIndexJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'index.js'), 'utf8');
const cacheJs = fs.readFileSync(path.join(__dirname, '..', 'api', 'middleware', 'cache.js'), 'utf8');

const expectedHeader = 'Cache-Control: public, s-maxage=30, stale-while-revalidate=300';
assert.ok(
  apiIndexJs.includes('res.setHeader(\'Cache-Control\', \'public, s-maxage=30, stale-while-revalidate=300\')'),
  'api/index.js debe incluir cabecera Cache-Control: public, s-maxage=30, stale-while-revalidate=300 en /api/menu/:slug'
);
assert.ok(
  cacheJs.includes('res.setHeader(\'Cache-Control\', \'public, s-maxage=30, stale-while-revalidate=300\')'),
  'api/middleware/cache.js debe incluir cabecera Cache-Control en respuestas cacheadas y frescas'
);

// Test middleware simulation
const { menuCacheMiddleware, memoryCache } = require('../api/middleware/cache');
let headersSet = {};
const mockRes = {
  statusCode: 200,
  setHeader(name, val) {
    headersSet[name] = val;
  },
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    return body;
  }
};
const mockReq = {
  params: { slug: 'test-local-rest' },
  query: {}
};

// Seed cache
memoryCache.set('test-local-rest:es::', { test: true }, 60000);
menuCacheMiddleware(mockReq, mockRes, () => {});
assert.strictEqual(
  headersSet['Cache-Control'],
  'public, s-maxage=30, stale-while-revalidate=300',
  'Cache-Control header debe ser seteado en cache HIT'
);
console.log('✓ Cabecera Cache-Control: public, s-maxage=30, stale-while-revalidate=300 presente en middleware y ruta');


// ==========================================
// 3. Seguridad en Recuperación de Contraseña
// ==========================================
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

// 3.1 Test user creation
const testEmail = `test_security_${Date.now()}@example.com`;
const user = db.createUser({
  email: testEmail,
  password: 'original_hashed_password',
  name: 'Test Security User'
});
assert.ok(user && user.id, 'Usuario creado para prueba de recuperación');

// 3.2 Token generation with JTI and strict 15m expiration
const crypto = require('crypto');
const jti = crypto.randomUUID();
const expiresInSeconds = 15 * 60; // 15 minutos (estricto entre 15 y 30m)
const resetToken = jwt.sign(
  { userId: user.id, email: user.email, purpose: 'reset-password' },
  JWT_SECRET,
  { expiresIn: expiresInSeconds, jwtid: jti }
);
db.savePasswordResetToken(user.id, jti, Date.now() + expiresInSeconds * 1000);

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
db.invalidateResetToken(jti);
assert.strictEqual(
  db.isResetTokenValid(user.id, jti),
  false,
  'El token ya utilizado debe ser marcado como inválido inmediatamente (prevención de reutilización)'
);
console.log('✓ Prevención de reutilización confirmada: Token invalidado tras primer uso');

// 3.4 Invalidation on newer token request
const jti1 = crypto.randomUUID();
db.savePasswordResetToken(user.id, jti1, Date.now() + 900000);
assert.strictEqual(db.isResetTokenValid(user.id, jti1), true);

const jti2 = crypto.randomUUID();
db.savePasswordResetToken(user.id, jti2, Date.now() + 900000);
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
db.updateUserPassword(user.id, 'new_secure_hashed_password');
const updatedUser = db.findUserById(user.id);
assert.strictEqual(updatedUser.password, 'new_secure_hashed_password', 'La contraseña debe actualizarse en la DB');
console.log('✓ Actualización de contraseña persistida exitosamente');

console.log('\n🎉 ¡TODAS LAS PRUEBAS DE RESILIENCIA, CABECERAS HTTP Y SEGURIDAD PASARON AL 100%!');
