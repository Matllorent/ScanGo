const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';
const ADMIN_SESSION_IDLE_TIMEOUT_SECONDS = 15 * 60;
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax'
};

function authMiddleware(req, res, next) {
  const authorization = req.headers.authorization || '';
  const token = req.cookies?.auth_token || (authorization.startsWith('Bearer ') ? authorization.slice(7) : '');
  if (!token) return res.status(401).json({ error: 'No autorizado' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch (error) {
    return res.status(401).json({ error: 'Token inválido o expirado' });
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
    const decoded = jwt.verify(token, JWT_SECRET);
    if (decoded?.role !== 'admin_master') {
      return res.status(403).json({ error: 'Acceso denegado: sesión administrativa no válida' });
    }
    const renewedToken = jwt.sign(
      { role: 'admin_master', timestamp: decoded.timestamp || Date.now() },
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

module.exports = { authMiddleware, adminMiddleware };