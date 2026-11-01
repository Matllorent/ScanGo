/**
 * api/routes/account.js
 * ─────────────────────
 * Derecho al olvido (/api/account/delete-request, RGPD/Ley 18.331/Google
 * Play): borra usuario + restaurante + asociados (local y nube), imágenes del
 * tenant, revoca la sesión y audita ANTES del borrado. Limiter dedicado
 * 10/15min. Extraído de api/index.js sin cambios.
 * Se monta como app.use('/api/account', accountRouter).
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../../src/db/db');
const auditService = require('../services/audit');
const storageService = require('../services/storage');
const sentry = require('../utils/sentry');
const AppError = require('../utils/AppError');
const { authMiddleware } = require('../middleware/auth');
const { invalidateMenuCache } = require('../middleware/cache');

const router = express.Router();

// ==================== ACCOUNT ERASURE (RGPD / Ley 18.331 / Google Play) ====================
// POST /api/account/delete-request — derecho al olvido. El "Eliminar cuenta"
// del Studio quedaba huérfano (llamaba a esta ruta y el backend no existía →
// 404 silencioso que mentía "solicitud registrada"). Ahora borra de verdad:
// usuario + restaurante + datos asociados (local y nube), imágenes del bucket,
// revoca la sesión y deja auditoría ANTES del borrado. Requiere `confirm: true`
// explícito + sesión válida; limiter dedicado y estricto (10/15min).
const accountDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Demasiadas solicitudes de eliminación. Probá de nuevo en unos minutos.',
    code: 'RATE_LIMITED'
  }
});
router.post('/delete-request', accountDeleteLimiter, authMiddleware, async (req, res, next) => {
  try {
    const body = req.body || {};
    if (body.confirm !== true) {
      return res.status(400).json({
        success: false,
        error: 'Debés confirmar la eliminación definitiva con confirm: true.',
        code: 'CONFIRMATION_REQUIRED'
      });
    }

    // authenticateRequest ya validó frescura (cloud/local) y dejó el usuario
    // fresco en req.authUser; el findUserById es solo fallback.
    const user = req.authUser || db.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada', code: 'ACCOUNT_NOT_FOUND' });
    }

    // Resolver el local esperando la hidratación cloud (cold start): si la nube
    // no responde, 503 honesto — nunca borrar "a medias" un local que no se vio.
    let restaurant = null;
    try {
      restaurant = await db.lazyLoadRestaurantByUserId(user.id);
    } catch (e) {
      if (e && e.code === 'RESTAURANT_LOAD_FAILED') {
        throw new AppError('No pudimos verificar tu local en este momento. Reintentá en unos segundos.', 503, 'RESTAURANT_LOAD_FAILED');
      }
      throw e;
    }

    // Auditoría ANTES del borrado: queda como registro de procesamiento propio
    // (tabla audit_logs, no se borra con la cuenta).
    auditService.logAction({
      tenantId: restaurant ? restaurant.id : undefined,
      userId: user.id,
      requestId: req.requestId,
      action: 'ACCOUNT_DELETE',
      entity: 'account',
      details: {
        reason: String(body.reason || '').slice(0, 200) || 'Sin motivo',
        restaurantId: restaurant ? restaurant.id : null
      }
    });

    // 1) Datos PRIMERO: usuario + restaurante + asociados (nube verificada y
    //    después espejo local). Si la nube no confirma, lanza
    //    ACCOUNT_DELETE_FAILED y NO se toca el storage ni el JSON local: la
    //    cuenta sigue existiendo y el dueño puede reintentar.
    try {
      await db.deleteRestaurantData(user.id, restaurant ? restaurant.id : null);
    } catch (e) {
      if (e && e.code === 'ACCOUNT_DELETE_FAILED') {
        throw new AppError('No pudimos completar la eliminación en la nube. NO se borró nada; reintentá en unos minutos.', 503, 'ACCOUNT_DELETE_FAILED');
      }
      throw e;
    }

    // 2) Imágenes del tenant en el bucket público (no quedan huérfanas). Es
    //    best-effort: los datos ya se borraron y el storage no resucita cuentas.
    if (restaurant) {
      await storageService.deleteTenantFiles(user.id).catch((e) => {
        sentry.captureException(e, { source: 'account.delete.storage', tags: { userId: user.id } });
        console.warn('[Account Delete] No se pudieron borrar archivos de storage:', e.message);
      });
      await invalidateMenuCache(restaurant.slug).catch(() => {});
    }

    return res.json({ success: true, deleted: true });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
