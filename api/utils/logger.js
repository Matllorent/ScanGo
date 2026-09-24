const crypto = require('crypto');

/**
 * High-performance Structured JSON Logger
 */
const logger = {
  formatLog(level, message, meta = {}) {
    return JSON.stringify({
      level,
      message,
      timestamp: new Date().toISOString(), // ISO 8601 UTC
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
      ...(meta.path ? { path: meta.path } : {}),
      ...(meta.method ? { method: meta.method } : {}),
      ...(meta.statusCode ? { statusCode: meta.statusCode } : {}),
      ...(meta.responseTime ? { responseTime: `${meta.responseTime}ms` } : {}),
      ...(meta.tenantId ? { tenantId: meta.tenantId } : {}),
      ...(meta.details ? { details: meta.details } : {}),
      ...(meta.stack ? { stack: meta.stack } : {})
    });
  },

  info(message, meta) {
    console.log(this.formatLog('info', message, meta));
  },

  warn(message, meta) {
    console.warn(this.formatLog('warn', message, meta));
  },

  error(message, meta) {
    console.error(this.formatLog('error', message, meta));
  },

  debug(message, meta) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(this.formatLog('debug', message, meta));
    }
  }
};

module.exports = logger;
