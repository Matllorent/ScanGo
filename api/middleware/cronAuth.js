'use strict';

const crypto = require('crypto');

/**
 * api/middleware/cronAuth.js
 * ──────────────────────────
 * Guard compartido para los cron jobs montados en `/api/cron/*`.
 *
 * En producción exige CRON_SECRET (Authorization: Bearer <token> o header
 * `x-cron-secret`); sin CRON_SECRET configurado el cron falla CERRADO con 503
 * (un cron público que borre datos es un vector de ataque). En desarrollo sin
 * secreto pasa (los tests pueden ejercitar el cron localmente).
 */
function verifyCronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET || '';
  if (!cronSecret) {
    if (process.env.NODE_ENV === 'production') {
      return res.status(503).json({
        success: false,
        error: 'Cron deshabilitado: configura CRON_SECRET en el entorno.',
        code: 'CRON_AUTH_NOT_CONFIGURED'
      });
    }
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cronSecretHeader = req.headers['x-cron-secret'] || '';

  const provided = token || cronSecretHeader;

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'Cron secret requerido',
      code: 'CRON_AUTH_REQUIRED'
    });
  }

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(cronSecret, 'utf8');

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return res.status(401).json({
      success: false,
      error: 'Cron secret inválido',
      code: 'CRON_AUTH_INVALID'
    });
  }

  next();
}

module.exports = { verifyCronAuth };