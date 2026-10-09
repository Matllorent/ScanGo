const db = require('../../src/db/db');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');

/**
 * Multi-Tenant Guard Middleware (IDOR Protection)
 * Injects tenant_id into req context and ensures authenticated users only access their own restaurant tenant data.
 */
function tenantGuard(req, res, next) {
  if (!req.user || !req.user.userId) {
    return next(new AppError('No autorizado', 401, 'UNAUTHORIZED'));
  }

  const userRestaurant = db.findRestaurantByUserId(req.user.userId);
  if (userRestaurant) {
    req.tenantId = userRestaurant.id;
    req.user.tenantId = userRestaurant.id;
  }

  // IDOR check for target restaurant or tenant ID parameters.
  // NOTA: a propósito NO se mira `req.params.id` genérico: en rutas de recurso
  // (p.ej. /status/:orderId) ese `:id` es el recurso, no el tenant, y tratarlo
  // como tenant provocaba falsos 403 (o chequeo contra el valor equivocado).
  // Las rutas de tenant usan params explícitos (:tenantId/:restaurantId) o
  // body/header (restaurantId/tenant_id/x-tenant-id).
  const targetTenantId = req.params.tenantId || req.params.restaurantId || req.body?.restaurantId || req.body?.tenant_id || req.headers['x-tenant-id'];

  // Cuenta autenticada SIN restaurante propio (p.ej. registro sin local) que
  // apunta a un tenant: se deniega. Antes pasaba de largo y los handlers con
  // `if (tenantId && ...)` también la dejaban operar sobre datos ajenos.
  if (targetTenantId && !userRestaurant) {
    logger.warn('[IDOR Attempt Blocked: orphan account]', {
      userId: req.user.userId,
      targetTenantId,
      path: req.originalUrl
    });
    return res.status(403).json({
      success: false,
      error: 'Tu cuenta no tiene un local asociado',
      code: 'TENANT_REQUIRED',
      timestamp: new Date().toISOString()
    });
  }

  if (targetTenantId && userRestaurant && targetTenantId !== userRestaurant.id && targetTenantId !== userRestaurant.slug) {
    logger.warn('[IDOR Attempt Blocked]', {
      userId: req.user.userId,
      userTenantId: userRestaurant.id,
      targetTenantId,
      path: req.originalUrl
    });
    return res.status(403).json({
      success: false,
      error: 'Acceso denegado a recursos de otro inquilino (Protección IDOR activa)',
      code: 'IDOR_ACCESS_DENIED',
      timestamp: new Date().toISOString()
    });
  }

  next();
}

/**
 * Mass Assignment & DTO Sanitizer
 * White-lists req.body attributes to prevent privilege escalation (e.g. role='admin', is_admin=true).
 * @param {string[]} allowedFields - List of authorized field names
 */
function sanitizeDTO(allowedFields) {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      // Strip forbidden escalation keys explicitly
      const forbiddenKeys = ['role', 'roles', 'isAdmin', 'is_admin', 'permissions', 'email_confirmed_at'];
      for (const key of forbiddenKeys) {
        if (key in req.body && (!allowedFields || !allowedFields.includes(key))) {
          delete req.body[key];
        }
      }

      if (allowedFields && allowedFields.length > 0) {
        const cleanBody = {};
        for (const field of allowedFields) {
          if (field in req.body) {
            cleanBody[field] = req.body[field];
          }
        }
        req.body = cleanBody;
      }
    }
    next();
  };
}

module.exports = {
  tenantGuard,
  sanitizeDTO
};
