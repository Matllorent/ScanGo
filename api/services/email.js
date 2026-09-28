const AppError = require('../utils/AppError');
const { retryQueue } = require('../utils/retryQueue');

/**
 * Email Service for Transactional & Marketing Emails
 * Integrates Resend API client via native fetch with process.env credentials
 */
const emailService = {
  /**
   * Send a transactional or promotional email via Resend API
   * @param {object} options
   * @param {string|string[]} options.to - Recipient email(s)
   * @param {string} options.subject - Email subject
   * @param {string} [options.html] - HTML content
   * @param {string} [options.text] - Text content
   * @returns {Promise<object>} Response with messageId / status
   */
  async sendEmail({ to, subject, html, text }) {
    if (!to || !subject) {
      throw new AppError('El destinatario (to) y asunto (subject) son requeridos', 400, 'MISSING_EMAIL_FIELDS');
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendApiKey) {
      console.log(`✉️ [Local Email Service Fallback] [${new Date().toISOString()}] To: ${to} | Subject: ${subject}`);
      return { provider: 'local_mock', success: true, timestamp: new Date().toISOString() };
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: Array.isArray(to) ? to : [to],
          subject,
          html: html || text || '<p>Menú Pizarrón</p>',
          text
        })
      });

      const responseData = await response.json().catch(() => ({}));

      if (response.ok) {
        console.log(`✉️ [Resend Email Sent] To: ${to} | ID: ${responseData.id}`);
        return { provider: 'resend', id: responseData.id, success: true, responseData };
      } else {
        console.warn(`⚠️ [Resend Email Warning] Status ${response.status}:`, responseData);
        return { provider: 'resend', success: false, error: responseData.message || responseData, statusCode: response.status };
      }
    } catch (e) {
      console.error('❌ [Resend Email Exception]', e.message);
      return { provider: 'resend', success: false, error: e.message };
    }
  },

  /**
   * Resilient Non-blocking Background Queue Email Dispatcher
   */
  sendEmailAsync(emailData) {
    retryQueue.enqueue(() => this.sendEmail(emailData), { taskName: 'send_email' });
  },

  /**
   * Send Welcome Email
   */
  async sendWelcomeEmail({ to, restaurantName, menuUrl, studioUrl }) {
    const subject = `¡Bienvenido a Menú Pizarrón, ${restaurantName}!`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2 style="color: #10b981;">¡Tu menú digital de ${restaurantName} ya está activo!</h2>
        <p>Gracias por unirte a Menú Pizarrón SaaS. Ya podés cargar tus platos, ajustar precios y personalizar la estética de tu menú.</p>
        <p><a href="${studioUrl || 'https://menupizarron.com/studio'}" style="background: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Acceder al Panel Studio</a></p>
        ${menuUrl ? `<p>Tu menú público: <a href="${menuUrl}">${menuUrl}</a></p>` : ''}
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Admin Invitation Email
   */
  async sendAdminInvitationEmail({ to, name, restaurantName, inviteLink }) {
    const subject = `Invitación especial a Menú Pizarrón — ${restaurantName}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Hola ${name}, te invitamos a Menú Pizarrón SaaS</h2>
        <p>Has sido invitado como administrador del restaurante <strong>${restaurantName}</strong> con suscripción Pro activa.</p>
        <p>Para activar tu cuenta y establecer tu contraseña, hacé clic en el siguiente enlace seguro:</p>
        <p style="margin: 25px 0;">
          <a href="${inviteLink}" style="background: #2563eb; color: #ffffff; padding: 14px 24px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">Activar mi Cuenta y Configurar Clave</a>
        </p>
        <p style="font-size: 13px; color: #64748b;">Si no solicitaste esta invitación, podés ignorar este correo de forma segura.</p>
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Email Verification Link
   */
  async sendVerificationEmail({ to, verificationLink }) {
    const subject = 'Confirmá tu dirección de correo electrónico';
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2>Verificación de Cuenta</h2>
        <p>Hacé clic en el siguiente botón para confirmar tu casilla de correo y habilitar la publicación de tu menú:</p>
        <p><a href="${verificationLink}" style="background: #2563eb; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Confirmar mi Correo</a></p>
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Promotional Campaign Email to Clients
   */
  async sendPromotionalEmail({ to, subject, body, restaurantName, promoCode, promoLink }) {
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2>Especiales de ${restaurantName || 'Tu Restaurante Favorito'}</h2>
        <p>${body}</p>
        ${promoCode ? `<p style="font-size: 18px; font-weight: bold; color: #059669;">Cupón de Descuento: ${promoCode}</p>` : ''}
        ${promoLink ? `<p><a href="${promoLink}" style="background: #f59e0b; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver Menú y Pedir</a></p>` : ''}
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Trial Expiration Warning Email (3 days / last day)
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name (name || bizName)
   * @param {number} options.daysLeft - Days remaining in the trial
   * @param {string} [options.studioUrl] - Studio upgrade URL
   * @returns {Promise<object>} sendEmail result
   */
  async sendTrialWarningEmail({ to, userName, restaurantName, daysLeft, studioUrl }) {
    const isLastDay = Number(daysLeft) <= 1;
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const link = studioUrl || `${process.env.APP_URL || ''}/studio`;

    const subject = isLastDay
      ? '🚨 Último día de tu prueba gratuita'
      : `⚠️ Tu prueba gratuita expira en ${daysLeft} días`;

    const html = isLastDay
      ? `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">¡Último día de prueba gratuita!</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Tu restaurante <strong>${restaurant}</strong> tiene <strong>1 día</strong> restante de prueba gratuita.</p>
        <p>Actualizá tu plan ahora para evitar que tu menú se pause:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #ef4444; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Activar Plan Pro</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si no actualizás, tu menú se pausará automáticamente.</p>
      </div>
    `
      : `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Tu prueba gratuita está por terminar</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Tu restaurante <strong>${restaurant}</strong> tiene <strong>${daysLeft} días</strong> restantes de prueba gratuita.</p>
        <p>Para mantener tu menú digital activo, actualizá tu plan:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #f59e0b; color: #111; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Activar Plan Pro</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si no actualizás, tu menú se pausará automáticamente.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Payment Receipt / Subscription Activated Email
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name (name || bizName)
   * @param {string} [options.planName] - Human readable plan name
   * @param {string|Date} [options.renewsAt] - Next renewal date
   * @returns {Promise<object>} sendEmail result
   */
  async sendPaymentReceiptEmail({ to, userName, restaurantName, planName, renewsAt }) {
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const plan = planName || 'Pro Mensual';
    const renewDate = renewsAt ? new Date(renewsAt) : null;
    const renewLabel = renewDate && !isNaN(renewDate.getTime()) ? renewDate.toLocaleDateString() : 'N/A';

    const subject = `✓ Confirmación de pago - Plan ${plan}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #10b981;">¡Pago confirmado!</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Tu suscripción al plan <strong>${plan}</strong> está activa.</p>
        <p>Restaurante: <strong>${restaurant}</strong></p>
        <p>Próximo cobro: ${renewLabel}</p>
        <p style="font-size: 12px; color: #888;">Gracias por confiar en Menú Pizarrón SaaS.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Payment Failed Email (enters grace period)
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name (name || bizName)
   * @param {string} [options.planName] - Human readable plan name
   * @param {number} [options.gracePeriodDays] - Grace period in days
   * @param {string} [options.updatePaymentUrl] - Billing page URL
   * @returns {Promise<object>} sendEmail result
   */
  async sendPaymentFailedEmail({ to, userName, restaurantName, planName, gracePeriodDays, updatePaymentUrl }) {
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const plan = planName || 'Pro Mensual';
    const grace = Number(gracePeriodDays) || 7;
    const link = updatePaymentUrl || `${process.env.APP_URL || ''}/studio?tab=billing`;

    const subject = `⚠️ No pudimos procesar tu pago - ${restaurant}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">No pudimos procesar tu pago</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>El cargo de tu suscripción al plan <strong>${plan}</strong> del restaurante <strong>${restaurant}</strong> no pudo ser procesado.</p>
        <p>Tenés <strong>${grace} días</strong> para actualizar tu método de pago antes de que tu menú sea pausado.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #f59e0b; color: #111; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Actualizar Método de Pago</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si ya actualizaste tu tarjeta, ignorá este correo.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Dunning Reminder Email (grace period countdown: day 3 / day 1)
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name (name || bizName)
   * @param {string} [options.planName] - Human readable plan name
   * @param {number} options.daysLeft - Days left before pausing
   * @param {number} [options.gracePeriodDays] - Total grace period in days
   * @param {string} [options.updatePaymentUrl] - Billing page URL
   * @returns {Promise<object>} sendEmail result
   */
  async sendDunningReminderEmail({ to, userName, restaurantName, planName, daysLeft, gracePeriodDays, updatePaymentUrl }) {
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const plan = planName || 'Pro Mensual';
    const days = Number(daysLeft) || 0;
    const grace = Number(gracePeriodDays) || 7;
    const link = updatePaymentUrl || `${process.env.APP_URL || ''}/studio?tab=billing`;
    const accent = days <= 2 ? '#ef4444' : '#f59e0b';
    const plural = days === 1 ? '' : 's';

    const subject = `Recordatorio: Tu suscripción de ${restaurant} será pausada en ${days} día${plural}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: ${accent};">Tu suscripción será pausada en ${days} día${plural}</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>El restaurante <strong>${restaurant}</strong> tiene un pago pendiente del plan <strong>${plan}</strong>.</p>
        <p>Quedan <strong>${days} día${plural}</strong> de gracia (de ${grace} en total) antes de que tu menú sea pausado.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: ${accent}; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Regularizar Ahora</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si ya regularizaste el pago, ignorá este correo.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  }
};

module.exports = emailService;
