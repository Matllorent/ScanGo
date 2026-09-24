const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse } = require('../utils/response');

/**
 * Webhook Idempotency Middleware
 * Verifies if `event_id` was already processed in `processed_webhooks` table.
 * If processed, returns 200 OK immediately. Otherwise, allows execution and marks as processed.
 */
async function webhookIdempotency(req, res, next) {
  const provider = req.params.provider || req.headers['x-provider'] || req.body?.provider || 'generic';
  const eventId = req.headers['x-event-id'] || req.headers['x-request-id'] || req.body?.id || req.body?.event_id || req.body?.eventId || req.query.eventId;

  if (!eventId) {
    // If no eventId header/field present, proceed to standard handler
    return next();
  }

  req.webhookContext = { provider, eventId };

  // Check local DB cache or Supabase processed_webhooks
  let isProcessed = db.hasProcessedWebhook(provider, String(eventId));

  const supabase = getSupabaseClient();
  if (!isProcessed && supabase) {
    try {
      const { data } = await supabase
        .from('processed_webhooks')
        .select('id')
        .eq('provider', provider)
        .eq('event_id', String(eventId))
        .single();

      if (data) {
        isProcessed = true;
      }
    } catch (e) {
      // Record not found or error, proceed
    }
  }

  if (isProcessed) {
    return res.status(200).json({
      success: true,
      message: 'Evento duplicado ya procesado anteriormente (idempotencia activada)',
      idempotent: true,
      provider,
      eventId: String(eventId),
      timestamp: new Date().toISOString()
    });
  }

  // Intercept res.send / res.json to mark webhook as processed on success response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      const utcNow = new Date().toISOString();
      db.markWebhookProcessed(provider, String(eventId), req.body?.type || req.body?.event || 'webhook', req.body);

      if (supabase) {
        supabase.from('processed_webhooks').insert([{
          provider,
          event_id: String(eventId),
          processed_at: utcNow
        }]).then().catch(e => console.warn('[Supabase Insert Processed Webhook]', e.message));
      }
    }
    return originalJson(body);
  };

  next();
}

module.exports = webhookIdempotency;
