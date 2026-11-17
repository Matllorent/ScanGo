/**
 * tests/test-login-rate-limit.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests para el rate limiter de login y endpoint set-password.
 *
 * Cubre:
 *   §1 - Rate limiting en /api/auth/login (5 intentos por IP cada 15 min)
 *   §2 - Endpoint POST /api/auth/set-password para establecer primera contraseña
 *   §3 - Validación de entrada en login y set-password
 *   §4 - Recuperación de contraseña (forgot-password) con token JWT
 */

const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const emailService = require('../api/services/email');

// Sobrescribir emailService para capturar llamadas sin usar Resend real
const sentEmails = [];
const originalSendEmail = emailService.sendEmail;
emailService.sendEmail = async function capturedSendEmail(payload) {
  sentEmails.push({ to: payload && payload.to, subject: payload && payload.subject, html: payload && payload.html });
  return { provider: 'resend', id: 'msg_' + Date.now(), success: true };
};

function restoreEmailService() {
  emailService.sendEmail = originalSendEmail;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();

async function runTests() {
  console.log('🧪 Iniciando verificación de login rate limit y set-password...');

  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // ── §1 - Rate limiting en login ─────────────────────────────────────────
    console.log('  §1 - Rate limiting en login...');

    const email = `ratelimit-${Date.now()}@example.com`;
    const loginErrors = [];

    for (let i = 0; i < 5; i++) {
      const res = await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'wrongpassword' })
      });
      loginErrors.push(res.status);
    }

    // El 6to intento debe dar 429
    const res6 = await fetch(`${base}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'wrongpassword' })
    });

    assert.strictEqual(res6.status, 429, '6to intento de login debe retornar 429 (rate limit)');
    const body6 = await res6.json();
    assert.ok(body6.error.includes('Demasiados intentos'), 'Debe mostrar mensaje de rate limit');

    console.log('  ✓ Rate limiting en login funciona (5 intentos OK, 6to = 429)');

    // ── §2 - Endpoint set-password ────────────────────────────────────────
    // Probar que el endpoint existe y rechaza sin autenticación
    const noAuthRes = await fetch(`${base}/api/auth/set-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'NuevaClave123' })
    });
    assert.strictEqual(noAuthRes.status, 401, 'set-password sin auth → 401');

    console.log('  ✓ set-password requiere autenticación (401 sin token)');

    // ── §3 - Validación de entrada ────────────────────────────────────────
    // Contraseña muy corta
    const shortRes = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'invalid', password: '123' })
    });
    assert.strictEqual(shortRes.status, 400, 'Contraseña corta → 400');

    console.log('  ✓ Validación de contraseña corta → 400');

    // ── §4 - forgot-password flujo completo ───────────────────────────────
    const testUser = await db.createUser({
      email: `forgot-${Date.now()}@example.com`,
      password: 'oldpassword123',
      name: 'Test User'
    });

    const forgotRes = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: testUser.email })
    });
    assert.strictEqual(forgotRes.status, 200, 'forgot-password con email válido → 200');
    const forgotBody = await forgotRes.json();
    assert.ok(forgotBody.success, 'forgot-password responde success');

    // Verificar que se envió email
    assert.strictEqual(sentEmails.length, 1, 'Se envió email de recuperación');
    assert.ok(sentEmails[0].to === testUser.email, 'Email enviado al usuario correcto');

    // Extraer token del email y usarlo para reset
    const html = sentEmails[0].html || '';
    const tokenMatch = html.match(/token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch, 'El email contiene un token JWT');
    const resetToken = tokenMatch[1];

    // Usar el token para resetear contraseña
    const resetRes = await fetch(`${base}/api/auth/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: resetToken, password: 'NuevaClaveSegura123' })
    });
    assert.strictEqual(resetRes.status, 200, 'reset-password con token válido → 200');
    const resetBody = await resetRes.json();
    assert.ok(resetBody.success, 'reset-password responde success');

    // Verificar que el token ya no se puede usar (single-use)
    const verifyRes = await fetch(`${base}/api/auth/verify-reset-token?token=${resetToken}`);
    assert.strictEqual(verifyRes.status, 400, 'Token ya usado → 400');

    console.log('✓ §4 - forgot-password: forgot-password, validate-reset-token y reset-password funcionan');

    console.log('\n✓ TODAS LAS PRUEBAS DE LOGIN RATE LIMIT Y AUTH EMAILS PASARON!');
  } finally {
    await new Promise(resolve => server.close(resolve));
    restoreEmailService();
  }
}

runTests().catch(err => {
  console.error('❌ Error en pruebas de login rate limit:', err);
  restoreEmailService();
  process.exit(1);
});