const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');
const { retryQueue } = require('../utils/retryQueue');
const AppError = require('../utils/AppError');

// Local in-memory audit logs cache for dev mode
const localAuditLogs = [];

/**
 * Catálogo cerrado de acciones auditables. Un typo ya no crea una acción
 * fantasma: logAction valida y rechaza con INVALID_AUDIT_ACTION.
 * Al agregar un flujo nuevo que audite, registrar su acción acá.
 */
const AUDIT_ACTIONS = Object.freeze({
  RESTAURANT_UPDATE: 'RESTAURANT_UPDATE',
  REVIEW_MODERATED: 'REVIEW_MODERATED',
  SUBSCRIPTION_STATUS_CHANGE: 'SUBSCRIPTION_STATUS_CHANGE',
  SUBSCRIPTION_EVENT_STALE: 'SUBSCRIPTION_EVENT_STALE',
  ACCOUNT_DELETE: 'ACCOUNT_DELETE',
  SEO_AUDIT_ALERT: 'SEO_AUDIT_ALERT',
  ORDER_STATUS_CHANGE: 'ORDER_STATUS_CHANGE',
  LOYALTY_CREDIT: 'LOYALTY_CREDIT',
  LOYALTY_REDEEM_VALIDATED: 'LOYALTY_REDEEM_VALIDATED',
  PROMO_SENT: 'PROMO_SENT',
  REACTIVATION_SENT: 'REACTIVATION_SENT',
  WINBACK_SENT: 'WINBACK_SENT',
  WINBACK_REVOKED: 'WINBACK_REVOKED',
  BIRTHDAY_NUDGE_SENT: 'BIRTHDAY_NUDGE_SENT',
  PHOTO_UPLOADED: 'PHOTO_UPLOADED',
  VIDEO_UPLOADED: 'VIDEO_UPLOADED',
  DISH_CREATE: 'DISH_CREATE',
  DISH_UPDATE: 'DISH_UPDATE',
  DISH_DELETE: 'DISH_DELETE',
  // Sistema de Mozos y Cocina (Fase 1)
  STAFF_CREATED: 'STAFF_CREATED',
  STAFF_UPDATED: 'STAFF_UPDATED',
  STAFF_DELETED: 'STAFF_DELETED',
  STAFF_CREDENTIAL_ROTATED: 'STAFF_CREDENTIAL_ROTATED',
  STAFF_SESSIONS_REVOKED: 'STAFF_SESSIONS_REVOKED',
  STAFF_TABLE_ASSIGN: 'STAFF_TABLE_ASSIGN',
  STAFF_SHIFT_START: 'STAFF_SHIFT_START',
  STAFF_SHIFT_END: 'STAFF_SHIFT_END',
  // Reservas de verdad (backlog #2)
  RESERVATION_CREATED: 'RESERVATION_CREATED',
  RESERVATION_STATUS_CHANGE: 'RESERVATION_STATUS_CHANGE',
  RESERVATION_REMINDER_SENT: 'RESERVATION_REMINDER_SENT'
});

const AUDIT_ENTITIES = Object.freeze({
  restaurant: 'restaurant',
  review: 'review',
  subscription: 'subscription',
  account: 'account',
  order: 'order',
  loyalty: 'loyalty',
  notification: 'notification',
  dish: 'dish',
  staff: 'staff',
  staff_session: 'staff_session',
  reservation: 'reservation'
});

function assertValidAuditRef(action, entity) {
  if (!action || !AUDIT_ACTIONS[action]) {
    throw new AppError(`Acción de auditoría desconocida: ${String(action)}`, 500, 'INVALID_AUDIT_ACTION');
  }
  if (!entity || !AUDIT_ENTITIES[entity]) {
    throw new AppError(`Entidad de auditoría desconocida: ${String(entity)}`, 500, 'INVALID_AUDIT_ENTITY');
  }
}

const auditService = {
  /**
   * Asynchronously record an audit log entry for mutating/destructive actions
   * @param {object} options
   * @param {string} [options.tenantId] - Restaurant/Tenant ID
   * @param {string} [options.userId] - User ID performing the action
   * @param {string} [options.requestId] - X-Request-ID correlation ID
   * @param {string} options.action - Action name (una clave de AUDIT_ACTIONS)
   * @param {string} options.entity - Affected entity name (una clave de AUDIT_ENTITIES)
   * @param {object} [options.details] - Mutation details payload
   */
  logAction({ tenantId, userId, requestId, action, entity, details }) {
    // Validación sincrónica: un typo falla rápido en vez de crear una
    // acción fantasma que nadie puede filtrar.
    assertValidAuditRef(action, entity);
    // Non-blocking fire-and-forget async execution via retry queue
    retryQueue.enqueue(async () => {
      const utcNow = new Date().toISOString();
      const auditEntry = {
        id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
        tenant_id: tenantId || 'system',
        user_id: userId || 'system',
        request_id: requestId || 'untracked',
        action,
        entity,
        details_json: details || {},
        created_at: utcNow
      };

      const supabase = getSupabaseClient();
      if (supabase) {
        try {
          await supabase.from('audit_logs').insert([auditEntry]);
        } catch (e) {
          logger.warn('[Audit Service Supabase Warning]', { error: e.message, action, requestId });
        }
      }

      localAuditLogs.push(auditEntry);
      if (localAuditLogs.length > 2000) localAuditLogs.shift();

      logger.info(`[Audit Log] ${action} on ${entity}`, {
        tenantId,
        userId,
        requestId,
        action,
        entity
      });
    }, { taskName: `audit_log_${action}` });
  },

  getAuditLogs(tenantId) {
    if (tenantId) {
      return localAuditLogs.filter(a => a.tenant_id === tenantId);
    }
    return localAuditLogs;
  },

  /**
   * Lectura best-effort desde la nube con fallback al cache local.
   * getAuditLogs() se mantiene sincrónico por compatibilidad (lo usa el test
   * de borrado de cuenta); este método es para paneles que sí pueden esperar.
   */
  async listAuditLogs({ tenantId, limit = 100 } = {}) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        let query = supabase.from('audit_logs').select('*').order('created_at', { ascending: false }).limit(limit || 100);
        if (tenantId) query = query.eq('tenant_id', tenantId);
        const { data, error } = await query;
        if (!error && Array.isArray(data)) return data;
      } catch (e) {
        logger.warn('[Audit List Warning]', { error: e.message });
      }
    }
    const rows = tenantId ? localAuditLogs.filter(a => a.tenant_id === tenantId) : localAuditLogs.slice();
    return rows.slice(-(limit || 100)).reverse();
  }
};

module.exports = auditService;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
module.exports.AUDIT_ENTITIES = AUDIT_ENTITIES;

/**
 * Retención de audit_logs (ciclo de vida): la tabla cloud crecía sin cota
 * (el espejo local sí tiene cap 2000). Default 365 días, clamp [90, 1825]:
 * la auditoría es registro de procesamiento/compliance y se conserva más que
 * la telemetría. Nunca lanza; dryRun solo reporta.
 */
function auditRetentionCutoffIso(olderThanDays) {
  const requested = Number(olderThanDays ?? process.env.AUDIT_RETENTION_DAYS);
  const days = Number.isFinite(requested) && requested > 0 ? Math.min(1825, Math.max(90, requested)) : 365;
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
}

async function purgeOldAuditLogs({ olderThanDays, dryRun = false } = {}) {
  const cutoff = auditRetentionCutoffIso(olderThanDays);
  const result = { cutoff, mode: 'local', dryRun, scannedLocal: 0, prunedLocal: 0, scannedCloud: 0, prunedCloud: 0 };
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      const { count, error: countError } = await supabase
        .from('audit_logs')
        .select('id', { count: 'exact', head: true })
        .lt('created_at', cutoff);
      if (countError) throw new Error(`COUNT audit_logs: ${countError.message}`);
      result.scannedCloud = count || 0;
      if (!dryRun && (count || 0) > 0) {
        const { error } = await supabase.from('audit_logs').delete().lt('created_at', cutoff);
        if (error) throw new Error(`DELETE audit_logs: ${error.message}`);
        result.prunedCloud = count;
        result.mode = 'supabase';
      }
    }
    const before = localAuditLogs.length;
    const kept = localAuditLogs.filter((a) => !a.created_at || a.created_at >= cutoff);
    result.scannedLocal = before;
    result.prunedLocal = before - kept.length;
    if (!dryRun) {
      localAuditLogs.length = 0;
      localAuditLogs.push(...kept);
    }
    return result;
  } catch (e) {
    logger.warn('[Audit Retention] falló parcialmente', { error: e.message, cutoff });
    result.error = e.message;
    return result;
  }
}

module.exports.purgeOldAuditLogs = purgeOldAuditLogs;
module.exports.auditRetentionCutoffIso = auditRetentionCutoffIso;
