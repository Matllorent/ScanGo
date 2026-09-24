const AppError = require('../utils/AppError');
const { retryQueue } = require('../utils/retryQueue');

/**
 * Email Service for Transactional & Marketing Emails
 * Integrates Resend API client via native fetch with environment variable credentials
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
    const fromEmail = process.env.RESEND_FROM_EMAIL || process.env.EMAIL_FROM || 'onboarding@resend.dev';

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
  }
};

module.exports = emailService;
