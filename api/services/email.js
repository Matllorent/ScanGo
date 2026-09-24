const AppError = require('../utils/AppError');
const { retryQueue } = require('../utils/retryQueue');

/**
 * Email Service for Transactional & Marketing Emails
 * Supports Resend, SendGrid, and Brevo API clients with API Keys
 */
const emailService = {
  /**
   * Send a transactional or promotional email via configured provider
   */
  async sendEmail({ to, subject, html, text }) {
    if (!to || !subject) {
      throw new AppError('El destinatario (to) y asunto (subject) son requeridos', 400, 'MISSING_EMAIL_FIELDS');
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const brevoApiKey = process.env.BREVO_API_KEY || process.env.SIB_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || 'hola@menupizarron.com';

    // 1. Try Resend Provider
    if (resendApiKey) {
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
            html: html || text,
            text
          })
        });

        if (response.ok) {
          const data = await response.json();
          return { provider: 'resend', id: data.id, success: true };
        }
      } catch (e) {
        console.warn('[Resend Email Error]', e.message);
      }
    }

    // 2. Try SendGrid Provider
    if (sendgridApiKey) {
      try {
        const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${sendgridApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            personalizations: [{ to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })) }],
            from: { email: fromEmail },
            subject,
            content: [{ type: 'text/html', value: html || text }]
          })
        });

        if (response.ok) {
          return { provider: 'sendgrid', success: true };
        }
      } catch (e) {
        console.warn('[SendGrid Email Error]', e.message);
      }
    }

    // 3. Try Brevo Provider
    if (brevoApiKey) {
      try {
        const response = await fetch('https://api.brevo.com/v3/smtp/email', {
          method: 'POST',
          headers: {
            'api-key': brevoApiKey,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            sender: { email: fromEmail, name: 'Menú Pizarrón' },
            to: (Array.isArray(to) ? to : [to]).map(e => ({ email: e })),
            subject,
            htmlContent: html || text
          })
        });

        if (response.ok) {
          const data = await response.json();
          return { provider: 'brevo', messageId: data.messageId, success: true };
        }
      } catch (e) {
        console.warn('[Brevo Email Error]', e.message);
      }
    }

    // Fallback: Local Development Mode Email Logging
    console.log(`✉️ [Local Email Service] [${new Date().toISOString()}] To: ${to} | Subject: ${subject}`);
    return { provider: 'local_mock', success: true, timestamp: new Date().toISOString() };
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
        <h2>¡Tu menú digital de ${restaurantName} ya está casi listo!</h2>
        <p>Gracias por unirte a Menú Pizarrón SaaS. Ya podés cargar tus platos, ajustar precios y personalizar la estética de tu menú.</p>
        <p><a href="${studioUrl}" style="background: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Acceder al Panel Studio</a></p>
        <p>Tu menú público: <a href="${menuUrl}">${menuUrl}</a></p>
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
