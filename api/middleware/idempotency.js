const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');

// Cache store for processed idempotency keys
const idempotencyStore = new Map(); // key -> { statusCode, body, expiresAt }

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
        .from('processed_webhooks')
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
      idempotencyStore.set(cleanKey, {
        statusCode: res.statusCode,
        body,
        expiresAt: Date.now() + 24 * 3600 * 1000 // 24 hours TTL
      });

      db.markWebhookProcessed(provider, cleanKey, 'idempotent_operation', req.body);
      if (supabase) {
        supabase.from('processed_webhooks').insert([{
          provider,
          event_id: cleanKey,
          processed_at: new Date().toISOString()
        }]).then().catch(e => console.warn('[Supabase Insert Idempotency]', e.message));
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = idempotencyMiddleware;
