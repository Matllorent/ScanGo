const crypto = require('crypto');

/**
 * Request Tracing Middleware
 * Assigns a unique X-Request-ID header to every incoming HTTP request for trace correlation.
 */
function requestIdMiddleware(req, res, next) {
  const existingId = req.headers['x-request-id'] || req.headers['x-correlation-id'];
  const requestId = existingId || (crypto.randomUUID ? crypto.randomUUID() : 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8));

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const startTime = Date.now();

  // Log response completion
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const logger = require('../utils/logger');
    logger.info('HTTP Request', {
      requestId,
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      responseTime
    });
  });

  next();
}

module.exports = requestIdMiddleware;
