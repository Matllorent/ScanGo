const express = require('express');
const logger = require('../utils/logger');
const telemetryService = require('../services/telemetry');
const auditService = require('../services/audit');
const notificationsService = require('../services/notifications');
const { verifyCronAuth } = require('../middleware/cronAuth');

const router = express.Router();

/**
 * GET /api/cron/telemetry-retention
 * Purga de eventos de telemetría más viejos que TELEMETRY_RETENTION_DAYS
 * (default 183 días). La telemetría inserta una fila por scan/clic/pedido y
 * acumula sin límite: es la palanca de coste principal del plan free de
 * Supabase y alimenta la pausa por inactividad. Este cron la recorta una vez
 * por mes (vercel.json → crons).
 *
 * Además purga audit_logs más viejos que AUDIT_RETENTION_DAYS (default 365,
 * clamp [90, 1825]) y — finding P1 de la auditoría de abuse oct-2026 —
 * notification_events LEÍDOS más viejos que NOTIFICATIONS_RETENTION_DAYS
 * (default 180, clamp [30, 730]): esa tabla acumula a un evento por aviso de
 * mozo/pedido/reseña y también en S3 creciamiento no mostrado en el panel de coste. Retención más corta: son
 * avisos operativos, no registro de procesamiento.
 *
 * Seguridad: exige CRON_SECRET (producción falla cerrado sin él). Idempotente
 * por diseño (DELETE con filtro created_at). `?dryRun=1` solo reporta conteos
 * sin borrar. Nunca lanza: un fallo degrada a `{ error }` dentro del 200.
 */
router.get('/telemetry-retention', verifyCronAuth, async (req, res) => {
  try {
    const dryRun = req.query.dryRun === '1';
    const result = await telemetryService.purgeOldTelemetry({ dryRun });
    const audit = await auditService.purgeOldAuditLogs({ dryRun });
    const notifications = await notificationsService.purgeOldNotificationEvents({
      readOlderThanDays: process.env.NOTIFICATIONS_RETENTION_DAYS || 180,
      dryRun
    });
    logger.info('[Telemetry Retention] ejecutado', {
      details: `${dryRun ? 'DRY-RUN' : 'purga'} → scannedCloud=${result.scannedCloud} prunedCloud=${result.prunedCloud} prunedLocal=${result.prunedLocal} auditPrunedCloud=${audit.prunedCloud} notificationsPrunedCloud=${notifications.prunedCloud}`
    });
    return res.json({ success: true, ...result, audit, notifications });
  } catch (e) {
    logger.error('[Telemetry Retention] error inesperado', { details: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;