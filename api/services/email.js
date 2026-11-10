const AppError = require('../utils/AppError');
const { retryQueue } = require('../utils/retryQueue');
const { fetchWithTimeout } = require('../utils/fetchWithTimeout');
const { buildEmailFooterHtml, signUnsubscribeToken } = require('../utils/emailFooter');
const fs = require('fs');
const path = require('path');

/**
 * Templates de marca ScanGo (puros, sin I/O de Resend).
 * Cada uno devuelve { subject, html, text, from }.
 */
const emailTemplates = require('./emailTemplates');
const {
  welcome,
  verification,
  trialWarning,
  trialExpired,
  menuPaused,
  paymentReceipt,
  paymentFailed,
  dunningReminder,
  newClientNotification,
  nightSummary,
  reservationRequest,
  reservationReminder,
  reservationStatus,
  reviewRequest,
  winbackCoupon,
  promotional
} = emailTemplates;

/**
 * Lista de baja comercial (CAN-SPAM): correos que pidieron no recibir más
 * mensajes. Persistencia local atómica best-effort.
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

/** Href segura para los <a> de los emails (política del archivo, finding P2):
 *  solo http(s) o rutas absolutas de la misma app ("/studio"). Otros esquemas
 *  (javascript:, data:, belongs a otro host extraño) no salen como href —
 *  mejor el CTA sin link que un vector de phishing. El valor SIEMPRE va
 *  escapado para atributos. */
function safeEmailHref(url) {
  const raw = String(url || '');
  if (!raw) return '';
  if (!/^(https?:\/\/|\/)/i.test(raw)) return '';
  return escapeHtmlText(raw);
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
   * @param {string} [options.from] - From address (overrides default)
   * @returns {Promise<object>} Response with messageId / status
   */
  async sendEmail({ to, subject, html, text, from }) {
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
    const fromEmail = from || process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';

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

  // ────────────────────────────────────────────────────────────────────────
  // TEMPLATES DE MARCA SCANGO (cada uno con su `from` por tipo de correo)
  // ────────────────────────────────────────────────────────────────────────

  /** Bienvenida tras alta de cuenta (dueño). */
  async sendWelcomeEmail({ to, restaurantName, menuUrl, studioUrl }) {
    const t = welcome({ to, restaurantName, menuUrl, studioUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Verificación de correo tras registro. */
  async sendVerificationEmail({ to, verificationLink }) {
    const t = verification({ to, verificationLink });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Aviso de prueba gratuito por vencer (3 días / último día). */
  async sendTrialWarningEmail({ to, userName, restaurantName, daysLeft, studioUrl }) {
    const t = trialWarning({ to, userName, restaurantName, daysLeft, studioUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Prueba gratuita terminada (día 8, inicia gracia de 3 días). */
  async sendTrialExpiredEmail({ to, userName, restaurantName, graceDays, studioUrl, menuUrl }) {
    const t = trialExpired({ to, userName, restaurantName, graceDays, studioUrl, menuUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Menú pausado tras agotar gracia post-trial (día 11). */
  async sendMenuPausedEmail({ to, userName, restaurantName, studioUrl }) {
    const t = menuPaused({ to, userName, restaurantName, studioUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Recibo de pago / suscripción activada. */
  async sendPaymentReceiptEmail({ to, userName, restaurantName, planName, renewsAt }) {
    const t = paymentReceipt({ to, userName, restaurantName, planName, renewsAt });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Pago fallido (entra en gracia de dunning). */
  async sendPaymentFailedEmail({ to, userName, restaurantName, planName, gracePeriodDays, updatePaymentUrl }) {
    const t = paymentFailed({ to, userName, restaurantName, planName, gracePeriodDays, updatePaymentUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Recordatorio de dunning (día 3 / día 1 de gracia). */
  async sendDunningReminderEmail({ to, userName, restaurantName, planName, daysLeft, gracePeriodDays, updatePaymentUrl }) {
    const t = dunningReminder({ to, userName, restaurantName, planName, daysLeft, gracePeriodDays, updatePaymentUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Notificación al dueño: nuevo cliente / alta / suscripción. */
  async sendNewClientNotification({ to, source, clientEmail, clientName, restaurantName, slug, planName, menuUrl } = {}) {
    const t = newClientNotification({ to, source, clientEmail, clientName, restaurantName, slug, planName, menuUrl });
    if (!t.to || t.to.length === 0) {
      console.log('[NewClientNotification] No recipient configured (OWNER_NOTIFICATION_EMAIL); skipped.');
      return { provider: 'skipped', success: true, skipped: true };
    }
    return this.sendEmail({ to: t.to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Cierre nocturno (Z-report) al dueño — F1 "El Cierre". */
  async sendNightSummaryEmail({ to, restaurantName, localDay, currency, summary, studioUrl }) {
    const t = nightSummary({ to, restaurantName, localDay, currency, summary, studioUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Aviso al dueño: nueva reserva de comensal. */
  async sendReservationRequestEmail({ to, restaurantName, reservation }) {
    const t = reservationRequest({ to, restaurantName, reservation });
    if (!t) return { provider: 'local_mock', success: true, skipped: true, reason: 'UNKNOWN_STATUS' };
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Recordatorio 24h al comensal de su reserva. */
  async sendReservationReminderEmail({ to, customerName, restaurantName, date, time, menuUrl }) {
    const t = reservationReminder({ to, customerName, restaurantName, date, time, menuUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Ciclo de vida al comensal: confirmed / cancelled / no_show. */
  async sendReservationStatusEmail({ to, restaurantName, reservation, status }) {
    const t = reservationStatus({ to, restaurantName, reservation, status });
    if (!t) return { provider: 'local_mock', success: true, skipped: true, reason: 'UNKNOWN_STATUS' };
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Nudge de reseña al día siguiente de entrega (R2). */
  async sendReviewRequestEmail({ to, customerName, restaurantName, reviewUrl }) {
    if (!to || !reviewUrl) {
      throw new AppError('El destinatario (to) y el link (reviewUrl) son requeridos', 400, 'MISSING_EMAIL_FIELDS');
    }
    if (isOptedOut(to)) {
      console.log(`[Email] Review request skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
    const t = reviewRequest({ to, customerName, restaurantName, reviewUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Cupón de recuperación (winback) — envío al comensal. */
  async sendWinbackCouponEmail({ to, restaurantName, message, couponCode, couponLabel, expiresAt, menuUrl }) {
    if (isOptedOut(to)) {
      console.log(`[Email] Winback skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
    const t = winbackCoupon({ to, restaurantName, message, couponCode, couponLabel, expiresAt, menuUrl });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
  },

  /** Email promocional general (campaña de marketing). */
  async sendPromotionalEmail({ to, subject, body, restaurantName, promoCode, promoLink }) {
    if (isOptedOut(to)) {
      console.log(`[Email] Promo skipped (opt-out): ${maskEmailList(to)}`);
      return { provider: 'local_mock', success: true, skipped: true, reason: 'OPT_OUT' };
    }
    const t = promotional({ to, subject, body, restaurantName, promoCode, promoLink });
    return this.sendEmail({ to, subject: t.subject, html: t.html, text: t.text, from: t.from });
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
// Escape del finding P2: los tests pueden exigir el helper directo (+ guía de uso).
emailService.escapeHtmlText = escapeHtmlText;
emailService.safeEmailHref = safeEmailHref;

module.exports = emailService;
// CAN-SPAM: helpers de opt-out comercial (usados por la ruta de baja y tests).
module.exports.markOptOut = markOptOut;
module.exports.isOptedOut = isOptedOut;
