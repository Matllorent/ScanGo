const express = require('express');
const logger = require('../utils/logger');
const db = require('../../src/db/db');
const { runSeoAudit } = require('../utils/seoAudit');
const auditService = require('../services/audit');
const { verifyCronAuth } = require('../middleware/cronAuth');

const router = express.Router();

/**
 * GET /api/cron/seo-audit
 * Auditor diario de salud SEO/GEO (solo lectura): recorre TODOS los
 * restaurantes, corre el mismo reporte puro del panel (api/utils/seoAudit.js)
 * y devuelve un resumen global + las alertas de nivel fail.
 *
 * Los hallazgos quedan en `audit_logs` (action=SEO_AUDIT_ALERT, fire-and-forget
 * vía auditService, nunca bloquea ni rompe) para que el dueño del proyecto
 * vea la evolución sin necesidad de tablas nuevas.
 *
 * Seguridad: exige CRON_SECRET (fail-closed en prod, como el resto de los
 * cron). Idempotente por diseño (no escribe sobre restaurantes). Nunca lanza:
 * un fallo degrada a `{ error }` dentro del 500.
 */
router.get('/seo-audit', verifyCronAuth, async (req, res) => {
  try {
    const restaurants = db.getAllRestaurants ? db.getAllRestaurants() : [];
    const results = restaurants
      .map((r) => ({ id: r.id, userId: r.userId, slug: String(r.slug || ''), ...runSeoAudit(r, { allRestaurants: restaurants }) }))
      .filter((r) => r.slug);

    const alerts = results
      .filter((r) => r.summary.fail > 0)
      .map((r) => ({
        slug: r.slug,
        score: r.score,
        fails: r.checks.filter((c) => c.status === 'fail').map((c) => c.id)
      }));

    // Registro no-bloqueante de las alertas (audit_logs, misma filosofía que el resto).
    for (const alert of alerts) {
      const owner = results.find((r) => r.slug === alert.slug);
      auditService.logAction({
        // tenant = el RESTAURANTE auditado (entidad de la alerta); el dueño
        // viaja como userId. Antes tenant=userId, lo que rompía el purge por
        // tenant del guard de tests y mezclaba entidades en audit_logs.
        tenantId: owner ? owner.id : null,
        userId: owner ? owner.userId : null,
        requestId: req.headers['x-request-id'] || 'cron-seo-audit',
        action: 'SEO_AUDIT_ALERT',
        entity: 'restaurant',
        details: { slug: alert.slug, score: alert.score, fails: alert.fails }
      });
    }

    const failCount = results.reduce((n, r) => n + r.summary.fail, 0);
    const warnCount = results.reduce((n, r) => n + r.summary.warn, 0);

    logger.info('[SEO Audit] ejecutado', {
      details: `audited=${results.length} failCount=${failCount} warnCount=${warnCount} alerts=${alerts.length}`
    });

    return res.json({ success: true, audited: results.length, failCount, warnCount, alerts });
  } catch (e) {
    logger.error('[SEO Audit] error inesperado', { details: e.message });
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;