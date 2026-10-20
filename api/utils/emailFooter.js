/**
 * Pie de email legal (CAN-SPAM §5 + RGPD):
 * TODOS los emails transaccionales/comerciales que salen del servicio llevan:
 *  1. Identidad remitente (ScanGo) + dirección postal física válida
 *     (COMPANY_POSTAL_ADDRESS; placeholder honesto hasta comprar el dominio).
 *  2. Motivo del contacto ("porque registraste tu negocio").
 *  3. Enlace de baja con token HMAC (GET /api/email/unsubscribe/:token):
 *     la baja bloquea envíos COMERCIALES futuros a esa dirección
 *     (los transaccionales puntuales —recibo del pago-, siguen, como permite CAN-SPAM).
 * Puro: cero I/O (la verificación/escritura vive en routes/email.js y en el servicio).
 */
const crypto = require('crypto');

const DEFAULT_POSTAL = 'ScanGo — Av. 18 de Julio 1234, Montevideo, Uruguay';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(str) {
  return Buffer.from(String(str).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

function unsubscribeSecret() {
  return process.env.EMAIL_UNSUB_SECRET || process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
}

/** Token `base64url(email).hmac` — permite baja sin exponer el email en claro. */
function signUnsubscribeToken(email) {
  const payload = base64url(String(email || '').toLowerCase());
  const mac = crypto.createHmac('sha256', unsubscribeSecret()).update(payload).digest('hex').slice(0, 32);
  return `${payload}.${mac}`;
}

/** Verifica un token de baja → { email } | null. Comparación en tiempo constante. */
function verifyUnsubscribeToken(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 2) return null;
    const [payload, mac] = parts;
    const expected = crypto.createHmac('sha256', unsubscribeSecret()).update(payload).digest('hex').slice(0, 32);
    const a = Buffer.from(mac, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const email = fromBase64url(payload).trim().toLowerCase();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email } : null;
  } catch {
    return null;
  }
}

/** Pie legal completo (HTML). `unsubscribeToken` opcional (email 1 a 1). */
function buildEmailFooterHtml({ unsubscribeToken, appUrl } = {}) {
  const base = process.env.APP_URL || process.env.PUBLIC_URL || appUrl || 'https://scango-rouge.vercel.app';
  const postal = process.env.COMPANY_POSTAL_ADDRESS || DEFAULT_POSTAL;
  const unsubLine = unsubscribeToken
    ? `<p style="margin: 0;">Si ya no quer&eacute;s recibir estos correos, <a href="${base}/api/email/unsubscribe/${unsubscribeToken}" style="color:#64748b;">cancel&aacute; la suscripci&oacute;n aqu&iacute;</a>. Pod&eacute;s escribirnos para preguntas: respond&eacute; a este correo.</p>`
    : `<p style="margin: 0;">Si ya no quer&eacute;s recibir estos correos, escribinos respondiendo a este correo.</p>`;
  return `
  <div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; line-height: 1.6;">
    <p style="margin: 0 0 4px;">Te enviamos este correo porque registraste o usaste un local en ScanGo.</p>
    <p style="margin: 0 0 4px;">ScanGo &middot; ${postal}</p>
    ${unsubLine}
  </div>`;
}

module.exports = {
  buildEmailFooterHtml,
  signUnsubscribeToken,
  verifyUnsubscribeToken,
  DEFAULT_POSTAL
};
