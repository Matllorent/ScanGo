/**
 * api/utils/captcha.js
 * ────────────────────
 * Verificación Cloudflare Turnstile (invisible) para el alta de pedidos.
 * Sin `TURNSTILE_SECRET` no se exige nada (flujo actual sin cambios):
 * la protección es opt-in por despliegue.
 * obligatorio; un token inválido rechaza (403). Un fallo de RED hacia
 * Cloudflare degrada a abierto con warning (fail-open acotado: evita que una
 * caída de CF bloquee todos los pedidos; el evento queda en el log).
 */
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function isCaptchaEnforced() {
  return Boolean(process.env.TURNSTILE_SECRET);
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: true, skipped: true };
  const clean = String(token || '').trim();
  if (!clean) return { ok: false, reason: 'CAPTCHA_REQUIRED' };
  if (clean.length > 2000) return { ok: false, reason: 'CAPTCHA_INVALID' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    let res;
    try {
      res = await fetch(TURNSTILE_VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          secret,
          response: clean,
          ...(remoteIp ? { remoteip: remoteIp } : {})
        }).toString(),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timer);
    }
    const body = await res.json().catch(() => ({}));
    if (body && body.success === true) return { ok: true };
    return { ok: false, reason: 'CAPTCHA_INVALID' };
  } catch (e) {
    const logger = require('./logger');
    logger.warn('[Turnstile] verify inalcanzable, fail-open acotado', { details: e.message });
    return { ok: true, failOpen: true };
  }
}

module.exports = { isCaptchaEnforced, verifyTurnstile };
