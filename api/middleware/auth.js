const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { checkSessionFreshness, isJtiRevoked } = require('../utils/tokenRevocation');
const { verifyDeviceToken } = require('../utils/deviceTokens');

// Fail-closed en producción: sin JWT_SECRET no se arranca (en dev se mantiene
// el fallback actual para no romper el flujo local ni la suite de tests).
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('Falta JWT_SECRET en producción (fail-closed: sin secreto no se arranca).');
}
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const ADMIN_SESSION_IDLE_TIMEOUT_SECONDS = 15 * 60;
// Tope absoluto aunque haya actividad continua (el deslizante solo no basta).
const ADMIN_SESSION_ABSOLUTE_TIMEOUT_SECONDS = 8 * 60 * 60;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

/**
 * Autenticación dual centralizada (una sola implementación):
 * 1) JWT de sesión (navegador, cookie httpOnly) + frescura (jti/pwdTs).
 * 2) Credencial opaca de dispositivo (app nativa, Bearer).
 *
 * P0-2: es ASYNC porque la frescura se verifica contra la nube (fuente de
 * verdad multi-réplica): una réplica con el usuario viejo en su JSON no puede
 * autenticar una cuenta borrada en otra. Orden deliberado:
 *   1. firma del JWT,
 *   2. jti revocado (logout) — NO depende de la nube,
 *   3. estado de la sesión en cloud/local,
 *   4. pwdTs contra el usuario FRESCO.
 * Si la nube no responde y tampoco hay espejo local → 503, nunca 401/404
 * (un corte de infraestructura no puede parecer un token inválido).
 *
 * @throws {AppError} en cualquier fallo.
 */
async function authenticateRequest(req) {
  const authorization = req.headers.authorization || '';
  const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  const token = req.cookies?.auth_token || bearer;
  if (!token) throw new AppError('No autorizado', 401, 'UNAUTHORIZED');

  const db = require('../../src/db/db');

  // ── 1) JWT de sesión ────────────────────────────────────────────────────
  let decoded = null;
  try {
    decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    decoded = null;
  }

  if (decoded) {
    // jti ANTES del lookup cloud: un logout debe dar 401 aunque la nube esté
    // fría o caída (antes el cold start devolvía USER_NOT_FOUND falso).
    if (decoded.jti && isJtiRevoked(decoded.jti)) {
      throw new AppError('Sesión revocada. Iniciá sesión nuevamente.', 401, 'SESSION_REVOKED');
    }
    if (!decoded.userId) return decoded;

    const state = await db.getUserSessionState(decoded.userId);
    if (state.status === 'unavailable') {
      throw new AppError('No se pudo verificar la sesión. Reintentá en unos segundos.', 503, 'USER_LOOKUP_UNAVAILABLE');
    }
    if (state.status === 'deleted' || state.status === 'missing') {
      throw new AppError('Usuario no encontrado', 401, 'USER_NOT_FOUND');
    }
    const stale = checkSessionFreshness(decoded, state.user || null);
    if (stale) throw new AppError(stale.error, stale.status, stale.code);
    req.authUser = state.user || null;
    return decoded;
  }

  // ── 2) Credencial opaca de dispositivo (app nativa) ─────────────────────
  if (!bearer) throw new AppError('Token inválido o expirado', 401, 'INVALID_TOKEN');
  const device = verifyDeviceToken(bearer);
  if (!device) throw new AppError('Token inválido o expirado', 401, 'INVALID_TOKEN');

  const state = await db.getUserSessionState(device.userId);
  if (state.status === 'unavailable') {
    throw new AppError('No se pudo verificar la sesión. Reintentá en unos segundos.', 503, 'USER_LOOKUP_UNAVAILABLE');
  }
  if (state.status === 'deleted' || state.status === 'missing') {
    throw new AppError('Usuario no encontrado', 401, 'USER_NOT_FOUND');
  }

  // El token de dispositivo lleva el pwdTs con el que se emitió: un reset en
  // otra réplica (updatedAt nuevo) lo mata acá.
  const current = (state.user && (state.user.updatedAt || state.user.createdAt)) || null;
  if (device.pwdTs) {
    const deviceTs = new Date(device.pwdTs).getTime();
    const currentTs = current ? new Date(current).getTime() : NaN;
    if (!Number.isFinite(deviceTs)) {
      throw new AppError('Sesión revocada por cambio de credenciales. Iniciá sesión nuevamente.', 401, 'SESSION_REVOKED');
    }
    if (Number.isFinite(currentTs) && deviceTs !== currentTs) {
      throw new AppError('Sesión revocada por cambio de credenciales. Iniciá sesión nuevamente.', 401, 'SESSION_REVOKED');
    }
  } else if (state.user && state.user.updatedAt) {
    throw new AppError('Sesión anterior al cambio de credenciales. Iniciá sesión nuevamente.', 401, 'SESSION_REVOKED');
  }

  req.authUser = state.user || null;
  return { userId: device.userId, deviceTokenId: device.tokenId };
}

async function authMiddleware(req, res, next) {
  try {
    req.user = await authenticateRequest(req);
    return next();
  } catch (e) {
    const status = (e && typeof e.statusCode === 'number') ? e.statusCode : 401;
    const body = { error: (e && e.message) || 'Token inválido o expirado' };
    if (e && e.code) body.code = e.code;
    return res.status(status).json(body);
  }
}

function adminMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = (authorization.startsWith('Bearer ') ? authorization.slice(7) : null) ||
    req.headers['x-admin-token'] ||
    req.cookies?.admin_token;

  if (!token) {
    return res.status(403).json({ error: 'Acceso denegado: se requiere una sesión administrativa autenticada con 2FA' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (decoded?.role !== 'admin_master') {
      return res.status(403).json({ error: 'Acceso denegado: sesión administrativa no válida' });
    }
    const sessionStart = decoded?.iat0 || decoded?.timestamp || Date.now();
    if (Date.now() - sessionStart > ADMIN_SESSION_ABSOLUTE_TIMEOUT_SECONDS * 1000) {
      return res.status(403).json({ error: 'Sesión administrativa expirada por tiempo máximo. Ingresá nuevamente con contraseña y código 2FA.' });
    }
    const renewedToken = jwt.sign(
      { role: 'admin_master', timestamp: Date.now(), iat0: sessionStart },
      JWT_SECRET,
      { expiresIn: ADMIN_SESSION_IDLE_TIMEOUT_SECONDS }
    );
    res.cookie('admin_token', renewedToken, COOKIE_OPTIONS);
    req.isAdmin = true;
    return next();
  } catch (error) {
    return res.status(403).json({ error: 'Sesión administrativa expirada. Ingresá nuevamente con contraseña y código 2FA.' });
  }
}

module.exports = { authMiddleware, adminMiddleware, authenticateRequest };