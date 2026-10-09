const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');

// Cache store for processed idempotency keys (cap + evicción LRU simple:
// máximo 1000 entradas; al insertar se borran primero las expiradas y luego
// las más viejas — Map preserva el orden de inserción).
const IDEMPOTENCY_MAX_ENTRIES = 1000;
const idempotencyStore = new Map(); // key -> { statusCode, body, expiresAt }

function evictIdempotencyEntries() {
  if (idempotencyStore.size < IDEMPOTENCY_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of idempotencyStore) {
    if (!entry || entry.expiresAt <= now) idempotencyStore.delete(key);
    if (idempotencyStore.size < IDEMPOTENCY_MAX_ENTRIES) return;
  }
  while (idempotencyStore.size >= IDEMPOTENCY_MAX_ENTRIES) {
    const oldest = idempotencyStore.keys().next().value;
    if (oldest === undefined) break;
    idempotencyStore.delete(oldest);
  }
}

/**
 * Enhanced Webhook & Order Idempotency Middleware
 * Reads `Idempotency-Key`, `X-Idempotency-Key`, or `event_id`
 */
async function idempotencyMiddleware(req, res, next) {
  const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'] || req.headers['x-event-id'] || req.body?.idempotencyKey || req.body?.idempotency_key;

  if (!idempotencyKey) {
    return next();
  }

  const cleanKey = String(idempotencyKey).trim();
  const provider = req.params.provider || req.headers['x-provider'] || 'order_payment';

  // Check in-memory store
  const cached = idempotencyStore.get(cleanKey);
  if (cached && Date.now() < cached.expiresAt) {
    logger.info('Idempotent request intercepted', { idempotencyKey: cleanKey });
    res.setHeader('X-Idempotent-Response', 'true');
    return res.status(cached.statusCode).json({
      ...cached.body,
      idempotent: true
    });
  }

  // Check local DB adapter
  let isProcessed = db.hasProcessedWebhook(provider, cleanKey);
  const supabase = getSupabaseClient();

  if (!isProcessed && supabase) {
    try {
      const { data } = await supabase
        .from('webhooks')
        .select('id')
        .eq('provider', provider)
        .eq('event_id', cleanKey)
        .single();
      if (data) isProcessed = true;
    } catch (e) {}
  }

  if (isProcessed) {
    res.setHeader('X-Idempotent-Response', 'true');
    return res.status(200).json({
      success: true,
      message: 'Solicitud duplicada ignorada (Clave de idempotencia procesada)',
      idempotent: true,
      idempotencyKey: cleanKey,
      timestamp: new Date().toISOString()
    });
  }

  // Intercept res.json to cache response payload for future retries
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      evictIdempotencyEntries();
      idempotencyStore.set(cleanKey, {
        statusCode: res.statusCode,
        body,
        expiresAt: Date.now() + 24 * 3600 * 1000 // 24 hours TTL
      });

      // Persistencia del marcador de idempotencia: el interceptor de res.json es
      // síncrono, así que solo se puede lanzar en background con catch explícito
      // (un rejection sin catch tumbaría el proceso durante un webhook de pago).
      db.markWebhookProcessed(provider, cleanKey, 'idempotent_operation', req.body)
        .catch((e) => logger.warn('[Idempotency] markWebhookProcessed failed', { details: e.message }));
    }
    return originalJson(body);
  };

  next();
}

module.exports = idempotencyMiddleware;
