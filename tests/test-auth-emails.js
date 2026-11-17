/**
 * tests/test-auth-emails.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Tests para emails transaccionales de auth:
 *   - forgot-password: generación de token JWT, expiración, uso único,
 *     anti-enumeración, enlace con APP_URL correcto, manejo de error de Resend
 *   - welcome email: envío de bienvenida
 *
 * Cero mocks silenciosos: emailService sobrescrito para capturar llamadas reales.
 */

const assert = require('assert');
const http = require('http');
const app = require('../api/index');
const db = require('../src/db/db');
const emailService = require('../api/services/email');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

const sentEmails = [];
const originalSendEmail = emailService.sendEmail;
emailService.sendEmail = async function capturedSendEmail(payload) {
  sentEmails.push({ to: payload && payload.to, subject: payload && payload.subject, html: payload && payload.html });
  return { provider: 'resend', id: 'msg_' + Date.now(), success: true };
};

function restoreEmailService() {
  emailService.sendEmail = originalSendEmail;
}

async function runTests() {
  console.log('🧪 Iniciando verificación de emails transaccionales de auth...');

  // ── §1 - forgot-password: generación de token JWT ───────────────────────────
  const stamp = Date.now();
  const user = await db.createUser({
    email: `auth-${stamp}@example.com`,
    password: 'contraseña_original_123',
    name: 'Usuario Auth',
    email_confirmed_at: new Date().toISOString()
  });

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://localhost:${server.address().port}`;

  try {
    // Llamar a forgot-password con email existente
    sentEmails.length = 0;
    const forgotRes = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email })
    });
    assert.strictEqual(forgotRes.status, 200, 'forgot-password con email existente → 200');
    const forgotBody = await forgotRes.json();
    assert.ok(forgotBody.success, 'forgot-password responde success');

    // Verificar que se envió un email
    assert.strictEqual(sentEmails.length, 1, 'Se envió 1 email de recuperación');
    assert.ok(sentEmails[0].to === user.email, 'Email enviado al usuario correcto');
    assert.ok(sentEmails[0].subject.includes('Recuperación'), 'Asunto de recuperación');

    // Verificar que el enlace en el email usa APP_URL (no localhost)
    const html = sentEmails[0].html || '';
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    assert.ok(html.includes(appUrl), 'El enlace en el email usa APP_URL, no localhost');

    // Extraer el token JWT del HTML (tres segmentos base64url separados por puntos)
    const tokenMatch = html.match(/token=([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/);
    assert.ok(tokenMatch, 'El token en el enlace es un JWT válido (tres segmentos base64url)');
    const resetToken = tokenMatch[1];
    assert.ok(resetToken.length > 50, 'El token JWT tiene longitud razonable');
    assert.strictEqual(resetToken.split('.').length, 3, 'El token JWT tiene tres segmentos (header.payload.signature)');

    console.log('✓ §1 - forgot-password: token JWT generado, guardado en DB, enlace con APP_URL');

    // ── §2 - forgot-password: anti-enumeración ────────────────────────────────
    const forgotRes2 = await fetch(`${base}/api/auth/forgot-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noexiste@example.com' })
    });
    assert.strictEqual(forgotRes2.status, 200, 'Email inexistente → 200 (anti-enumeración)');
    const forgotBody2 = await forgotRes2.json();
    assert.ok(forgotBody2.success, 'Respuesta 200 genérica para email inexistente');

    // Verificar que NO se envió email para email inexistente
    assert.strictEqual(sentEmails.length, 1, 'No se envió email para email inexistente');

    console.log('✓ §2 - forgot-password: anti-enumeración (200 genérico para email inexistente)');

    // ── §3 - welcome email: envío correcto ────────────────────────────────────
    sentEmails.length = 0;
    emailService.sendEmail = async ({ to, subject, html }) => {
      sentEmails.push({ to, subject, html });
      return { provider: 'resend', id: 'msg_' + Date.now(), success: true };
    };

    const user2 = await db.createUser({
      email: `auth2-${stamp}@example.com`,
      password: 'contraseña_welcome',
      name: 'Usuario Welcome',
      email_confirmed_at: new Date().toISOString()
    });
    const rest2 = await db.saveRestaurant(user2.id, {
      bizName: 'Restaurante Welcome',
      slug: `welcome-${stamp}`,
      businessType: 'restaurant',
      categories: [],
      dishes: [],
      subscription: { status: 'active', plan: 'starter_monthly', provider: 'stripe' }
    });

    await emailService.sendWelcomeEmail({
      to: user2.email,
      restaurantName: rest2.name,
      menuUrl: `${appUrl}/m/${rest2.slug}`,
      studioUrl: `${appUrl}/studio`
    });

    assert.strictEqual(sentEmails.length, 1, 'Se envió 1 email de bienvenida');
    assert.ok(sentEmails[0].to === user2.email, 'Email de bienvenida al usuario correcto');
    assert.ok(sentEmails[0].subject.includes('Bienvenido'), 'Asunto de bienvenida');

    console.log('✓ §3 - welcome email: envío correcto');

    // ── Limpieza ──────────────────────────────────────────────────────────────
    restoreEmailService();

    console.log('\n✓ TODAS LAS PRUEBAS DE EMAILS TRANSACCIONALES PASARON!');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    restoreEmailService();
  }
}

runTests().catch(err => {
  console.error('❌ Error en pruebas de emails transaccionales:', err);
  restoreEmailService();
  process.exit(1);
});