const AppError = require('../utils/AppError');
const { retryQueue } = require('../utils/retryQueue');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { buildEmailFooterHtml, signUnsubscribeToken } = require('../utils/emailFooter');
const fs = require('fs');
const path = require('path');

/**
 * Lista de baja comercial (CAN-SPAM): correos que pidieron no recibir más
 * mensajes. Persistencia local atómica best-effort (mismo patrón que data/*.json);
 * en Vercel el espejo cae a /tmp — para una lista grande, replicar a cloud.
 */
const OPTOUTS_FILE = path.join(process.env.DATA_DIR || path.join(process.cwd(), 'data'), 'email_optouts.json');
const optedOut = new Set((() => {
  try { return JSON.parse(fs.readFileSync(OPTOUTS_FILE, 'utf8')); } catch { return []; }
})());

function persistOptOuts() {
  try {
    fs.mkdirSync(path.dirname(OPTOUTS_FILE), { recursive: true });
    const tmp = OPTOUTS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify([...optedOut], null, 2));
    fs.renameSync(tmp, OPTOUTS_FILE);
  } catch (e) {
    console.warn('[Email] optout persist fail:', e.message);
  }
}

function isOptedOut(to) {
  const arr = Array.isArray(to) ? to : [to];
  return arr.some(x => optedOut.has(String(x || '').toLowerCase()));
}

/** Marca una dirección como "no comercial" (idempotente, persiste). */
function markOptOut(email) {
  if (!email) return;
  optedOut.add(String(email).trim().toLowerCase());
  persistOptOuts();
}

/**
 * Enmascara una dirección de email para logs: conserva la primera letra del
 * Local-Part y el dominio completo (suficiente para operar, sin exponer PII).
 * `juan.perez@x.com` → `j***@x.com`. Nunca loguear emails crudos.
 */
function maskEmail(email) {
  const s = String(email || '');
  const at = s.lastIndexOf('@');
  if (at <= 1) return s.length ? s[0] + '***' : '***';
  return s.slice(0, 1) + '***' + s.slice(at);
}

/** Enmascara un destinatario o lista de destinatarios (string|string[]). */
function maskEmailList(to) {
  const arr = Array.isArray(to) ? to : [to];
  return arr.map(maskEmail).join(', ');
}

/** Escape HTML para interpolation en templates (sanea texto del propietario
 * (nombre/mensaje/codigo/cuppon): todo sale como texto literal, jamas marcado vivo. */
function escapeHtmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

    // CAN-SPAM §5: dirección postal física + motivo + enlace de baja en TODO email.
    // (La baja se procesa a nivel comercial: los transaccionales puntuales —recibo
    // de un pago— siguen saliendo, como permite la ley; el bloqueo duro es en promos.)
    if (typeof html === 'string' && !html.includes('ScanGo &middot;')) {
      html += Array.isArray(to)
        ? buildEmailFooterHtml()
        : buildEmailFooterHtml({ unsubscribeToken: signUnsubscribeToken(to) });
    }

    const resendApiKey = process.env.RESEND_API_KEY;
    const fromEmail = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

    if (!resendApiKey) {
      // PII redactada: nunca el email crudo en logs (solo el Local-Part parcial).
      console.log(`✉️ [Local Email Service Fallback] [${new Date().toISOString()}] To: ${maskEmailList(to)} | Subject: ${subject}`);
      return { provider: 'local_mock', success: true, timestamp: new Date().toISOString() };
    }

    try {
      const response = await fetchWithTimeout('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: fromEmail,
          to: Array.isArray(to) ? to : [to],
          subject,
          html: html || text || '<p>ScanGo</p>',
          text
        })
      });

      const responseData = await response.json().catch(() => ({}));

      if (response.ok) {
        // PII redactada: id del mensaje + destinatario enmascarado.
        console.log(`✉️ [Resend Email Sent] To: ${maskEmailList(to)} | ID: ${responseData.id}`);
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
    const subject = `¡Bienvenido a ScanGo, ${restaurantName}!`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2 style="color: #10b981;">¡Tu menú digital de ${restaurantName} ya está activo!</h2>
        <p>Gracias por unirte a ScanGo. Tenés <strong>7 días gratis</strong> para cargar tus platos, ajustar precios y personalizar la estética de tu menú: sin tarjeta y sin compromiso.</p>
        <p style="margin: 18px 0;"><a href="${studioUrl || 'https://scango.uy/studio'}" style="background: #10b981; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Empezar en el Panel Studio</a></p>
        ${menuUrl ? `<p>Tu menú público (ya compartible): <a href="${menuUrl}">${menuUrl}</a></p>` : ''}
        <p style="font-size: 12px; color: #888;">Te avisaremos por correo cuando tu prueba esté por terminar.</p>
      </div>
    `;
    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Admin Invitation Email
   */
  async sendAdminInvitationEmail({ to, name, restaurantName, inviteLink }) {
    const subject = `Invitación especial a ScanGo — ${restaurantName}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px;">
        <h2 style="color: #2563eb;">Hola ${name}, te invitamos a ScanGo</h2>
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
  /**
   * Send Review Request Email (R2 — "el día siguiente")
   * Email CONDUCTUAL post-entrega: se envía ~24h después de un pedido
   * entregado vía cron /api/cron/review-nudge. El link SIEMPRE apunta al
   * EMBUDO NEUTRAL de reseñas (4-5★ → Google, 1-3★ → feedback privado):
   * jamás pide "una reseña de 5 estrellas" (Google penaliza pedir solo
   * positivas y es la política del producto). Respeta opt-outs como toda
   * campaña: pidió la baja no recibe ni esto.
   */
  async sendReviewRequestEmail({ to, customerName, restaurantName, reviewUrl }) {
    if (!to || !reviewUrl) {
      throw new AppError('El destinatario (to) y el link (reviewUrl) son requeridos', 400, 'MISSING_EMAIL_FIELDS');
    }
    if (isOptedOut(to)) {
      console.log(`[Email] Review request skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
    const place = restaurantName || 'tu local favorito';
    const who = customerName ? `${customerName}, ` : '';
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b;">
        <h2>¿Cómo estuvo tu experiencia en ${place}?</h2>
        <p>Hola ${who}pediste en ${place} y queremos saber cómo te fue.</p>
        <p>Si salió rico, contanos; si algo falló, contanos también. Tu opinión llega directo al dueño.</p>
        <p><a href="${reviewUrl}" style="background: #059669; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Contar mi experiencia</a></p>
        <p style="font-size: 12px; color: #64748b;">Tu opinión ayuda a ${place} a mejorar cada semana.</p>
      </div>
    `;
    return this.sendEmail({ to, subject: `¿Cómo estuvo tu experiencia en ${place}?`, html });
  },

  async sendPromotionalEmail({ to, subject, body, restaurantName, promoCode, promoLink }) {    // CAN-SPAM §5(4)+(5): honoring opt-outs no es opcional. Quien pidió la baja
    // no recibe NINGÚN envío comercial, aunque llegue por otra campaña.
    if (isOptedOut(to)) {
      console.log(`[Email] Promo skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
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
   * Send Win-back Coupon Email (F8 Cupón de recupero).
   * Todo campo interpolado pasa por escapeHtml — el body del mensaje viene
   * del texto libre del dueño (cierre del finding P2 para este template):
   * HTML inyectado sale como texto, nunca como marcado vivo.
   */
  async sendWinbackCouponEmail({ to, restaurantName, message, couponCode, couponLabel, expiresAt, menuUrl }) {
    // CAN-SPAM §5(4)+(5): honoring opt-outs no es opcional (idéntico a las promos).
    if (isOptedOut(to)) {
      console.log(`[Email] Winback skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
    const place = escapeHtmlText(restaurantName || 'Tu restaurante');
    const msg = escapeHtmlText(message || '').trim();
    const code = escapeHtmlText(couponCode || '');
    const label = escapeHtmlText(couponLabel || '');
    const expires = escapeHtmlText(expiresAt || '');
    const link = typeof menuUrl === 'string' && menuUrl.startsWith('http')
      ? menuUrl
      : '';
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2>Te extra&ntilde;amos — ten&eacute;s un cup&oacute;n de ${place}</h2>
        ${msg ? `<p>${msg.replace(/\n/g, '<br>')}</p>` : ''}
        ${code ? `<div style="text-align:center; padding: 18px; border: 2px dashed #059669; border-radius: 8px; margin: 16px 0;">
          <div style="font-size: 13px; color: #64748b;">${label || 'Cup&oacute;n de bienvenida de vuelta'}</div>
          <div style="font-size: 26px; font-weight: bold; letter-spacing: 2px; color: #059669;">${code}</div>
          ${expires ? `<div style="font-size: 12px; color: #64748b;">V&aacute;lido hasta ${expires}</div>` : ''}
        </div>` : ''}
        ${link ? `<p><a href="${escapeHtmlText(link)}" style="background: #059669; color: white; padding: 12px 20px; text-decoration: none; border-radius: 6px; display: inline-block;">Ver carta y pedir</a></p>` : ''}
        <p style="font-size: 12px; color: #64748b;">Un solo uso. Si no quer&eacute;s recibir m&aacute;s avisos, pod&eacute;s darte de baja abajo.</p>
      </div>
    `;
    return this.sendEmail({ to, subject: `Volvé a ${restaurantName || 'tu local favorito'} — te guardamos un cupón`, html });
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
          <a href="${link}" style="background: #ef4444; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Activar Plan</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si no actualizás, tu menú sigue online 3 días más y después queda pausado.</p>
      </div>
    `
      : `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #f59e0b;">Tu prueba gratuita está por terminar</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Tu restaurante <strong>${restaurant}</strong> tiene <strong>${daysLeft} días</strong> restantes de prueba gratuita.</p>
        <p>Para mantener tu menú digital activo, actualizá tu plan:</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #f59e0b; color: #111; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Activar Plan</a>
        </p>
        <p style="font-size: 12px; color: #888;">Si no actualizás, tu menú sigue online 3 días más y después queda pausado.</p>
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
        <p style="font-size: 12px; color: #888;">Gracias por confiar en ScanGo.</p>
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
  },

  /**
   * Send Trial Expired Email (día 8: terminó la prueba, empieza la gracia de 3 días)
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name
   * @param {number} [options.graceDays] - Días que el menú sigue online sin pagar
   * @param {string} [options.studioUrl] - Studio upgrade URL
   * @param {string} [options.menuUrl] - Public menu URL
   * @returns {Promise<object>} sendEmail result
   */
  async sendTrialExpiredEmail({ to, userName, restaurantName, graceDays, studioUrl, menuUrl }) {
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const grace = Number(graceDays) || 3;
    const link = studioUrl || `${process.env.APP_URL || ''}/studio`;

    const subject = `Tu prueba gratuita de ScanGo terminó — ${restaurant}`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">Terminó tu prueba gratuita</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Los 7 días gratis de <strong>${restaurant}</strong> en ScanGo llegaron a su fin.</p>
        <p>Buena noticia: tu menú sigue <strong>online</strong> durante <strong>${grace} días más</strong> para que no pierdas ni un cliente. Activá tu plan para mantenerlo publicado.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #10b981; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Activar mi plan</a>
        </p>
        ${menuUrl ? `<p style="font-size: 12px;">Tu menú: <a href="${menuUrl}">${menuUrl}</a></p>` : ''}
        <p style="font-size: 12px; color: #888;">Pasados los ${grace} días de gracia, el menú queda pausado hasta que actives tu plan. Podés reactivarlo en cualquier momento.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  },

  /**
   * Send Menu Paused Email (día 11: se agotó la gracia post-trial)
   * @param {object} options
   * @param {string} options.to - Recipient email
   * @param {string} [options.userName] - Recipient display name
   * @param {string} [options.restaurantName] - Restaurant display name
   * @param {string} [options.studioUrl] - Studio upgrade URL
   * @returns {Promise<object>} sendEmail result
   */
  async sendMenuPausedEmail({ to, userName, restaurantName, studioUrl }) {
    const restaurant = restaurantName || 'Tu restaurante';
    const name = userName || 'Responsable';
    const link = studioUrl || `${process.env.APP_URL || ''}/studio`;

    const subject = `⚠️ El menú de ${restaurant} quedó pausado`;
    const html = `
      <div style="font-family: sans-serif; padding: 20px; color: #1e293b; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #ef4444;">Tu menú quedó pausado</h2>
        <p>Hola <strong>${name}</strong>,</p>
        <p>Se agotó el período de gracia de <strong>${restaurant}</strong> y tu menú digital dejó de estar disponible para tus clientes.</p>
        <p>Al activar tu plan se reactiva al instante: volvés a estar online con todos tus platos y precios tal como los dejaste.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #10b981; color: #fff; padding: 12px 24px; text-decoration: none; font-weight: bold; border-radius: 6px; display: inline-block;">Reactivar mi menú</a>
        </p>
        <p style="font-size: 12px; color: #888;">No se realizó ningún cobro: tu suscripción sólo se activa cuando pagás.</p>
      </div>
    `;

    return this.sendEmail({ to, subject, html });
  },
  async sendNewClientNotification({ to, source, clientEmail, clientName, restaurantName, slug, planName, menuUrl } = {}) {
    const recipients = to
      ? (Array.isArray(to) ? to : String(to).split(',').map(x => x.trim()).filter(Boolean))
      : String(process.env.OWNER_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL || process.env.NOTIFICATION_EMAIL || '')
          .split(',')
          .map(x => x.trim())
          .filter(Boolean);

    if (!recipients.length) {
      console.log('[NewClientNotification] No recipient configured (OWNER_NOTIFICATION_EMAIL); skipped.');
      return { provider: 'skipped', success: true, skipped: true };
    }

    const srcLabel = source === 'subscription' ? 'Nueva suscripcion' : source === 'google' ? 'Nuevo registro (Google)' : 'Nuevo registro';
    const subject = '[ScanGo] ' + srcLabel + ': ' + (restaurantName || clientEmail || 'cliente');
    const html = '<div style="font-family:sans-serif;padding:20px;color:#1e293b;max-width:600px;margin:0 auto;">'
      + '<h2 style="color:#10b981;">' + srcLabel + '</h2>'
      + '<p><strong>Cliente:</strong> ' + (clientName || '-') + '</p>'
      + '<p><strong>Email:</strong> ' + (clientEmail || '-') + '</p>'
      + '<p><strong>Restaurante:</strong> ' + (restaurantName || '-') + '</p>'
      + (slug ? '<p><strong>Slug:</strong> ' + slug + '</p>' : '')
      + (planName ? '<p><strong>Plan:</strong> ' + planName + '</p>' : '')
      + (menuUrl ? '<p><strong>Menu:</strong> <a href="' + menuUrl + '">' + menuUrl + '</a></p>' : '')
      + '<p style="font-size:12px;color:#888;">Fuente: ' + (source || 'register') + ' | ' + new Date().toISOString() + '</p>'
      + '</div>';
    return this.sendEmail({ to: recipients, subject, html });
  },

};

/**
   * Send internal notification to the owner/admin when a new client registers
   * or subscribes successfully. Recipient comes from OWNER_NOTIFICATION_EMAIL
   * (comma-separated supported) or ADMIN_NOTIFICATION_EMAIL env vars. If none
   * is configured, the call is a safe no-op (never throws, never blocks).
   */


// Helpers puros exportados (testeables): ocultan PII de destinatarios en logs.
emailService.maskEmail = maskEmail;
emailService.maskEmailList = maskEmailList;

module.exports = emailService;
// CAN-SPAM: helpers de opt-out comercial (usados por la ruta de baja y tests).
module.exports.markOptOut = markOptOut;
module.exports.isOptedOut = isOptedOut;
