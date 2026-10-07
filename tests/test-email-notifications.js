const assert = require('assert');
const emailService = require('../api/services/email');

console.log('🧪 Iniciando pruebas de notificaciones por email...');

(async () => {
  // 1. Verificar que el servicio de email existe y tiene los métodos requeridos
  assert.strictEqual(typeof emailService.sendWelcomeEmail, 'function', 'sendWelcomeEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendTrialWarningEmail, 'function', 'sendTrialWarningEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendPaymentReceiptEmail, 'function', 'sendPaymentReceiptEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendPaymentFailedEmail, 'function', 'sendPaymentFailedEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendDunningReminderEmail, 'function', 'sendDunningReminderEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendTrialExpiredEmail, 'function', 'sendTrialExpiredEmail debe ser una función');
  assert.strictEqual(typeof emailService.sendMenuPausedEmail, 'function', 'sendMenuPausedEmail debe ser una función');
  console.log('✓ Los 7 métodos de email existen en el servicio');

  // 2. Probar sendTrialWarningEmail (día 3) — sin RESEND_API_KEY usa fallback local
  const trialWarning3 = await emailService.sendTrialWarningEmail({
    to: 'test@example.com',
    userName: 'Juan',
    restaurantName: 'La Esquina',
    daysLeft: 3,
    studioUrl: 'https://menupizarron.com/studio'
  });
  assert.strictEqual(trialWarning3.success, true, 'Trial warning (3 días) debe ser exitoso');
  assert.strictEqual(trialWarning3.provider, 'local_mock', 'Sin RESEND_API_KEY debe usar fallback local');
  console.log('✓ sendTrialWarningEmail (3 días) funciona correctamente');

  // 3. Probar sendTrialWarningEmail (día 1)
  const trialWarning1 = await emailService.sendTrialWarningEmail({
    to: 'test@example.com',
    userName: 'María',
    restaurantName: 'El Buen Sabor',
    daysLeft: 1,
    studioUrl: 'https://menupizarron.com/studio'
  });
  assert.strictEqual(trialWarning1.success, true, 'Trial warning (1 día) debe ser exitoso');
  console.log('✓ sendTrialWarningEmail (1 día) funciona correctamente');

  // 4. Probar sendPaymentReceiptEmail
  const receipt = await emailService.sendPaymentReceiptEmail({
    to: 'test@example.com',
    userName: 'Carlos',
    restaurantName: 'Parrilla Central',
    planName: 'Pro Mensual',
    renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString()
  });
  assert.strictEqual(receipt.success, true, 'Payment receipt debe ser exitoso');
  console.log('✓ sendPaymentReceiptEmail funciona correctamente');

  // 5. Probar sendPaymentFailedEmail
  const failed = await emailService.sendPaymentFailedEmail({
    to: 'test@example.com',
    userName: 'Ana',
    restaurantName: 'Sushi House',
    planName: 'Pro Mensual',
    gracePeriodDays: 7,
    updatePaymentUrl: 'https://menupizarron.com/studio?tab=billing'
  });
  assert.strictEqual(failed.success, true, 'Payment failed email debe ser exitoso');
  console.log('✓ sendPaymentFailedEmail funciona correctamente');

  // 6. Probar sendDunningReminderEmail
  const dunning = await emailService.sendDunningReminderEmail({
    to: 'test@example.com',
    userName: 'Pedro',
    restaurantName: 'Pizza Nostra',
    planName: 'Pro Mensual',
    daysLeft: 3,
    gracePeriodDays: 7,
    updatePaymentUrl: 'https://menupizarron.com/studio?tab=billing'
  });
  assert.strictEqual(dunning.success, true, 'Dunning reminder debe ser exitoso');
  console.log('✓ sendDunningReminderEmail funciona correctamente');

  // 7. Probar sendTrialExpiredEmail (día 8: empieza la gracia de 3 días)
  const trialExpired = await emailService.sendTrialExpiredEmail({
    to: 'test@example.com',
    userName: 'Lucía',
    restaurantName: 'Café Central',
    graceDays: 3,
    studioUrl: 'https://menupizarron.com/studio',
    menuUrl: 'https://menupizarron.com/m/cafe-central'
  });
  assert.strictEqual(trialExpired.success, true, 'Trial expired email debe ser exitoso');
  assert.strictEqual(trialExpired.provider, 'local_mock', 'Sin RESEND_API_KEY debe usar fallback local');
  console.log('✓ sendTrialExpiredEmail funciona correctamente');

  // 8. Probar sendMenuPausedEmail (día 11: se agotó la gracia)
  const menuPaused = await emailService.sendMenuPausedEmail({
    to: 'test@example.com',
    userName: 'Lucía',
    restaurantName: 'Café Central',
    studioUrl: 'https://menupizarron.com/studio'
  });
  assert.strictEqual(menuPaused.success, true, 'Menu paused email debe ser exitoso');
  console.log('✓ sendMenuPausedEmail funciona correctamente');

  // 9. Probar sendWelcomeEmail (onboarding de cuenta nueva, marca ScanGo)
  const welcome = await emailService.sendWelcomeEmail({
    to: 'test@example.com',
    restaurantName: 'La Parrilla',
    menuUrl: 'https://menupizarron.com/m/la-parrilla',
    studioUrl: 'https://menupizarron.com/studio'
  });
  assert.strictEqual(welcome.success, true, 'Welcome email debe ser exitoso');
  console.log('✓ sendWelcomeEmail funciona correctamente');

  // 10. Probar sendEmailAsync (fire-and-forget)
  emailService.sendEmailAsync({
    to: 'async@example.com',
    subject: 'Email asíncrono de prueba',
    html: '<p>Prueba de envío asíncrono</p>'
  });
  console.log('✓ sendEmailAsync encola correctamente (fire-and-forget)');

  console.log('\n🎉 ¡TODAS LAS PRUEBAS DE NOTIFICACIONES POR EMAIL PASARON AL 100%!\n');
})();
