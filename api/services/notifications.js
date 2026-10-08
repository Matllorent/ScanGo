const { getSupabaseClient } = require('../utils/supabase');
const AppError = require('../utils/AppError');
const webpush = require('web-push');

// In-memory fallback array for local dev mode push subscriptions
const localPushSubscriptions = [];

/**
 * Configuración VAPID leída del entorno en cada uso (permite setear/rotar
 * llaves sin reiniciar y testear el degradado 503 en la misma instancia).
 */
function getVapidConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  return {
    publicKey,
    privateKey,
    subject: process.env.VAPID_SUBJECT || 'mailto:soporte@menu-pizarron.com'
  };
}

/**
 * Elimina una suscripción muerta (el push service respondió 404/410:
 * el navegador la dio de baja o venció).
 */
async function removeSubscription(endpoint) {
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    } catch (e) {
      console.warn('[Supabase Remove Push Subscription Warning]', e.message);
    }
  }
  const index = localPushSubscriptions.findIndex(s => s.endpoint === endpoint);
  if (index >= 0) localPushSubscriptions.splice(index, 1);
}

/**
 * Entrega real de Web Push (VAPID) a cada suscripción. Las que el push
 * service da de baja (404/410) se eliminan para no intentar de nuevo.
 * @returns {Promise<{checked: number, delivered: number, failed: number, removed: number}>}
 */
async function dispatchToSubscriptions(subscriptions, payload) {
  const config = getVapidConfig();
  if (!config) {
    throw new AppError(
      'Push no configurado: faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en el entorno',
      503,
      'PUSH_NOT_CONFIGURED'
    );
  }
  webpush.setVapidDetails(config.subject, config.publicKey, config.privateKey);
  const body = JSON.stringify(payload);
  let delivered = 0;
  let failed = 0;
  let removed = 0;
  for (const sub of subscriptions) {
    if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      failed++;
      continue;
    }
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body);
      delivered++;
    } catch (err) {
      if (err && (err.statusCode === 404 || err.statusCode === 410)) {
        await removeSubscription(sub.endpoint);
        removed++;
      } else {
        console.warn('[Push Delivery Failed]', err && err.message ? err.message : err);
        failed++;
      }
    }
  }
  return { checked: subscriptions.length, delivered, failed, removed };
}

const notificationsService = {
  getVapidConfig,

  /**
   * Save a Web Push / FCM subscription token
   */
  async saveSubscription({ userId, restaurantId, endpoint, keys }) {
    if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
      throw new AppError('Endpoint y llaves (p256dh, auth) son requeridos para la suscripción push', 400, 'INVALID_SUBSCRIPTION_PAYLOAD');
    }

    const subscription = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      user_id: userId || null,
      restaurant_id: restaurantId || null,
      endpoint,
      keys,
      created_at: new Date().toISOString()
    };

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('push_subscriptions')
          .upsert([subscription], { onConflict: 'endpoint' });
      } catch (e) {
        console.warn('[Supabase Save Push Subscription Warning]', e.message);
      }
    }

    // Keep in local cache
    const existingIndex = localPushSubscriptions.findIndex(s => s.endpoint === endpoint);
    if (existingIndex >= 0) {
      localPushSubscriptions[existingIndex] = subscription;
    } else {
      localPushSubscriptions.push(subscription);
    }

    return subscription;
  },

  /**
   * Lista suscripciones del restaurante (o de un usuario puntual).
   */
  async listSubscriptions({ restaurantId, targetUserId }) {
    let subscriptions = [];
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        let query = supabase.from('push_subscriptions').select('*');
        if (restaurantId) query = query.eq('restaurant_id', restaurantId);
        if (targetUserId) query = query.eq('user_id', targetUserId);
        const { data, error } = await query;
        if (!error && data) subscriptions = data;
      } catch (e) {
        console.warn('[Supabase Get Push Subscriptions Warning]', e.message);
      }
    }

    if (subscriptions.length === 0) {
      subscriptions = localPushSubscriptions.filter(s => {
        if (restaurantId && s.restaurant_id !== restaurantId) return false;
        if (targetUserId && s.user_id !== targetUserId) return false;
        return true;
      });
    }
    return subscriptions;
  },

  /**
   * Send a real Web Push to the restaurant's subscribers.
   * @throws AppError 503 PUSH_NOT_CONFIGURED si faltan llaves VAPID
   */
  async sendPromotionalNotification({ title, body, icon, url, restaurantId, targetUserId }) {
    if (!title || !body) {
      throw new AppError('Título y mensaje son requeridos para la notificación', 400, 'MISSING_NOTIFICATION_CONTENT');
    }

    const subscriptions = await this.listSubscriptions({ restaurantId, targetUserId });

    const payload = {
      title,
      body,
      icon: icon || '/icon-192.png',
      url: url || '/',
      timestamp: new Date().toISOString()
    };

    const dispatch = await dispatchToSubscriptions(subscriptions, payload);

    console.log(`[Push Notification Dispatch] ${dispatch.delivered} entregadas, ${dispatch.failed} fallidas, ${dispatch.removed} eliminadas de ${dispatch.checked}`);

    return {
      success: true,
      ...dispatch,
      payload
    };
  }
};

module.exports = notificationsService;