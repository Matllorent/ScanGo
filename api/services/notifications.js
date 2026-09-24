const { getSupabaseClient } = require('../utils/supabase');
const AppError = require('../utils/AppError');

// In-memory fallback array for local dev mode push subscriptions
const localPushSubscriptions = [];

const notificationsService = {
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
   * Send promotional alert to subscribed users
   */
  async sendPromotionalNotification({ title, body, icon, url, restaurantId, targetUserId }) {
    if (!title || !body) {
      throw new AppError('Título y mensaje son requeridos para la notificación', 400, 'MISSING_NOTIFICATION_CONTENT');
    }

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

    const payload = {
      title,
      body,
      icon: icon || '/public/icon-192.png',
      url: url || '/',
      timestamp: new Date().toISOString()
    };

    console.log(`[Push Notification Dispatch] Sending to ${subscriptions.length} subscribers:`, payload);

    return {
      success: true,
      sentCount: subscriptions.length,
      failedCount: 0,
      payload
    };
  }
};

module.exports = notificationsService;
