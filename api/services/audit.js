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
  PHOTO_UPLOADED: 'PHOTO_UPLOADED'
});

const AUDIT_ENTITIES = Object.freeze({
  restaurant: 'restaurant',
  review: 'review',
  subscription: 'subscription',
  account: 'account',
  order: 'order',
  loyalty: 'loyalty',
  notification: 'notification'
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
