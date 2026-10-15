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

    const user = db.findUserById(req.user.userId);
    if (!user) {
      return res.status(404).json({ success: false, error: 'Cuenta no encontrada', code: 'ACCOUNT_NOT_FOUND' });
    }
    const restaurant = db.findRestaurantByUserId(user.id);

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

    // 1) Imágenes del tenant en el bucket público (no quedan huérfanas).
    if (restaurant) {
      await storageService.deleteTenantFiles(user.id).catch((e) => {
        sentry.captureException(e, { source: 'account.delete.storage', tags: { userId: user.id } });
        console.warn('[Account Delete] No se pudieron borrar archivos de storage:', e.message);
      });
      await invalidateMenuCache(restaurant.slug).catch(() => {});
    }

    // 2) Datos: usuario + restaurante + asociados (local JSON + Supabase).
    await db.deleteRestaurantData(user.id, restaurant ? restaurant.id : null);

    return res.json({ success: true, deleted: true });
  } catch (e) {
    return next(e);
  }
});

module.exports = router;
