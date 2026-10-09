const jwt = require('jsonwebtoken');
const AppError = require('../utils/AppError');
const { checkSessionFreshness } = require('../utils/tokenRevocation');
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
 * @throws {{status, error, code}} en cualquier fallo.
 */
function authenticateRequest(req) {
  const authorization = req.headers.authorization || '';
  const token = req.cookies?.auth_token || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!token) throw new AppError('No autorizado', 401, 'UNAUTHORIZED');
  try {
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    const stale = checkSessionFreshness(decoded);
    if (stale) throw new AppError(stale.error, stale.status, stale.code);
    return decoded;
  } catch (e) {
    if (e instanceof AppError) throw e;
    // El reset borra las filas de dispositivo; acá solo resta exigir usuario vigente.
    const device = verifyDeviceToken(authorization.startsWith('Bearer ') ? authorization.slice(7) : token);
    if (!device) throw new AppError('Token inválido o expirado', 401, 'INVALID_TOKEN');
    try {
      const db = require('../../src/db/db');
      if (!db.findUserById(device.userId)) {
        throw new AppError('Usuario no encontrado', 401, 'USER_NOT_FOUND');
      }
    } catch (dbErr) {
      if (dbErr instanceof AppError) throw dbErr;
    }
    return { userId: device.userId, deviceTokenId: device.tokenId };
  }
}

function authMiddleware(req, res, next) {
  try {
    req.user = authenticateRequest(req);
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