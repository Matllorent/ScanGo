const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');
const { retryQueue } = require('../utils/retryQueue');

// Local in-memory audit logs cache for dev mode
const localAuditLogs = [];

const auditService = {
  /**
   * Asynchronously record an audit log entry for mutating/destructive actions
   * @param {object} options
   * @param {string} [options.tenantId] - Restaurant/Tenant ID
   * @param {string} [options.userId] - User ID performing the action
   * @param {string} [options.requestId] - X-Request-ID correlation ID
   * @param {string} options.action - Action name (e.g. 'PRICE_UPDATE', 'DELETE_DISH', 'ROLE_CHANGE')
   * @param {string} options.entity - Affected entity name ('dish', 'category', 'team_member', 'restaurant')
   * @param {object} [options.details] - Mutation details payload
   */
  logAction({ tenantId, userId, requestId, action, entity, details }) {
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
  }
};

module.exports = auditService;
