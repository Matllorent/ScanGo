const crypto = require('crypto');
const { latencyTracker } = require('../utils/latencyTracker');

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
    // Sin query strings en logs: pueden traer coords redondeadas (?lat=&lng=)
    // u otros datos del comensal. La ruta sola alcanza para operar.
    const rawPath = req.originalUrl || req.url || '';
    const cleanPath = String(rawPath).split('?')[0];
    // Slug del menú para atribuir picos por local (viene de path params ya
    // matcheados por el router; nunca de query ni body: no es PII).
    const slug = req.params && typeof req.params.slug === 'string' ? req.params.slug : undefined;
    logger.info('HTTP Request', {
      requestId,
      method: req.method,
      path: cleanPath,
      statusCode: res.statusCode,
      responseTime,
      ...(slug ? { slug } : {})
    });
    // Percentiles de latencia por grupo (menú público /api / resto): alimenta
    // el campo `latency` de /api/healthz y los SLO documentados.
    latencyTracker.record(req.path || req.url, responseTime);
  });

  next();
}

module.exports = requestIdMiddleware;
