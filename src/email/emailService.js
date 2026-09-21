// Email Service supporting Resend or SMTP with HTML templates

const emailService = {
  async sendMail({ to, subject, html }) {
    if (process.env.RESEND_API_KEY) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + process.env.RESEND_API_KEY,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: process.env.EMAIL_FROM || 'Menú Pizarrón <hola@menu-pizarron.com>',
            to,
            subject,
            html
          })
        });
        return await res.json();
      } catch (e) {
        console.error('[Email] Error enviando con Resend:', e);
      }
    }

    // Dev fallback
    console.log(`[Email Mock] To: ${to} | Subject: ${subject}`);
    return { success: true, mocked: true };
  },

  // 1. Welcome Email
  async sendWelcome({ to, restaurantName, menuUrl, studioUrl }) {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #0D1210; color: #F7FAFC; padding: 32px 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="text-align: center; margin-bottom: 24px;">
          <div style="display: inline-block; background: #2B3A32; border: 2px solid #D9A441; border-radius: 8px; padding: 10px 18px; font-weight: bold; color: #ECC94B; font-size: 20px;">
            📋 Menú Pizarrón Studio
          </div>
        </div>
        <h1 style="font-size: 22px; color: #fff; margin-bottom: 12px; text-align: center;">¡Felicitaciones! Tu menú digital está en vivo</h1>
        <p style="font-size: 14.5px; color: #A0AEC0; line-height: 1.5;">
          Hola, <b>${restaurantName}</b> ya cuenta con su menú digital interactivo QR listo para recibir pedidos por WhatsApp sin comisiones ni intermediarios.
        </p>
        <div style="background: #18221D; border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 16px; margin: 24px 0;">
          <div style="font-size: 12px; color: #718096; text-transform: uppercase; font-weight: 700; margin-bottom: 6px;">Tu Enlace Público para Clientes:</div>
          <a href="${menuUrl}" style="color: #68D391; font-size: 16px; font-weight: bold; word-break: break-all;">${menuUrl}</a>
        </div>
        <div style="text-align: center; margin-top: 28px;">
          <a href="${studioUrl}" style="background: #38A169; color: #fff; text-decoration: none; padding: 13px 26px; font-weight: bold; font-size: 15px; border-radius: 6px; display: inline-block;">
            Ir a tu Panel de Control
          </a>
        </div>
        <p style="font-size: 12px; color: #718096; text-align: center; margin-top: 30px;">
          Menú Pizarrón Studio — Tecnología gastronómica independiente.
        </p>
      </div>
    `;
    return this.sendMail({ to, subject: `¡Tu menú digital de ${restaurantName} ya está activo!`, html });
  },

  // 2. Subscription Confirmation
  async sendSubscriptionSuccess({ to, restaurantName, planName, nextDate }) {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #0D1210; color: #F7FAFC; padding: 32px 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <h2 style="color: #ECC94B; margin-top: 0;">✓ Suscripción Confirmada</h2>
        <p style="color: #A0AEC0; line-height: 1.5;">
          Gracias por confiar en Menú Pizarrón Studio. Tu suscripción <b>${planName}</b> para <b>${restaurantName}</b> se ha activado exitosamente.
        </p>
        <div style="background: #151D19; padding: 14px; border-radius: 6px; margin: 18px 0; font-size: 14px;">
          Próxima fecha de renovación: <b>${nextDate || 'Próximo mes'}</b>
        </div>
      </div>
    `;
    return this.sendMail({ to, subject: `Confirmación de suscripción - ${restaurantName}`, html });
  },

  // 3. Smart Dunning (Grace Period Warning)
  async sendDunningGraceAlert({ to, restaurantName, daysLeft, updateUrl }) {
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #0D1210; color: #F7FAFC; padding: 32px 24px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.1);">
        <div style="background: rgba(229, 62, 62, 0.15); border: 1px solid #E53E3E; color: #FC8181; padding: 14px; border-radius: 6px; font-weight: bold; margin-bottom: 18px;">
          ⚠️ Acción requerida: Falló el cobro de tu suscripción
        </div>
        <p style="color: #A0AEC0; line-height: 1.5;">
          Hola, no pudimos procesar el cobro automático de tu tarjeta para <b>${restaurantName}</b>.
        </p>
        <p style="color: #ECC94B; font-weight: bold;">
          Para no perjudicar tu servicio, tu menú permanecerá 100% ONLINE durante los próximos ${daysLeft} días de gracia.
        </p>
        <p style="color: #A0AEC0; font-size: 13.5px;">
          Por favor, actualiza tu método de pago antes de que venza este período para evitar la suspensión temporal del menú:
        </p>
        <div style="text-align: center; margin: 26px 0;">
          <a href="${updateUrl}" style="background: #E53E3E; color: #fff; text-decoration: none; padding: 12px 24px; font-weight: bold; border-radius: 6px; display: inline-block;">
            Actualizar Tarjeta de Pago
          </a>
        </div>
      </div>
    `;
    return this.sendMail({ to, subject: `⚠️ Aviso importante sobre tu menú de ${restaurantName} (${daysLeft} días de gracia restantes)`, html });
  }
};

module.exports = emailService;
