/**
 * api/middleware/originCheck.js
 * ────────────────────────────
 * Defensa en profundidad anti-CSRF para APIs con auth por cookie:
 * si el request muta estado (POST/PUT/PATCH/DELETE) y viaja con cookie de
 * sesión, el Origin/Referer —cuando el browser lo envía— debe ser propio.
 * Sin Origin/Referer (curl, apps móviles, tests) se permite: el chequeo solo
 * endurece el caso browser, donde el atacante no puede suprimir el header.
 * SameSite=Lax sigue siendo la primera línea; esto es la segunda.
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedOrigins() {
  const list = [
    process.env.APP_URL,
    process.env.PUBLIC_URL,
    process.env.ADMIN_URL,
    process.env.LANDING_URL
  ]
    .flatMap((v) => String(v || '').split(','))
    .map((s) => s.trim().replace(/\/+$/, '').toLowerCase())
    .filter(Boolean);
  return list;
}

function originCheck(req, res, next) {
  try {
    if (SAFE_METHODS.has(req.method)) return next();
    const cookies = req.cookies || {};
    if (!cookies.auth_token && !cookies.admin_token) return next();
    const raw = req.headers.origin || req.headers.referer || '';
    if (!raw) return next();
    let host = '';
    try {
      host = new URL(raw).origin.toLowerCase().replace(/\/+$/, '');
    } catch {
      return next();
    }
    if (allowedOrigins().includes(host)) return next();
    // Desarrollo local y tests: loopback siempre permitido.
    if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return next();
    return res.status(403).json({
      success: false,
      error: 'Origen no permitido para esta operación',
      code: 'FORBIDDEN_ORIGIN'
    });
  } catch {
    return next();
  }
}

module.exports = originCheck;
