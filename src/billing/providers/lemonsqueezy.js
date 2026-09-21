const crypto = require('crypto');

const lemonProvider = {
  name: 'lemonsqueezy',

  verifyWebhookSignature(rawBody, signature, secret) {
    if (!secret || !signature) return false;
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = Buffer.from(hmac.update(rawBody).digest('hex'), 'utf8');
      const sig = Buffer.from(signature, 'utf8');
      return crypto.timingSafeEqual(digest, sig);
    } catch (e) {
      return false;
    }
  },

  createCheckoutUrl({ variantId, customerEmail, restaurantId, redirectUrl }) {
    // Generates Lemon Squeezy hosted checkout with custom data
    const storeId = process.env.LEMONSQUEEZY_STORE_ID || 'demo_store';
    const baseUrl = 'https://' + storeId + '.lemonsqueezy.com/checkout/buy/' + (variantId || 'default');
    const params = new URLSearchParams();
    if (customerEmail) params.append('checkout[email]', customerEmail);
    if (restaurantId) params.append('checkout[custom][restaurant_id]', restaurantId);
    if (redirectUrl) params.append('checkout[redirect_url]', redirectUrl);
    return baseUrl + '?' + params.toString();
  },

  parseWebhookPayload(payload) {
    const eventName = payload.meta && payload.meta.event_name;
    const eventId = payload.meta && payload.meta.custom_data && payload.meta.custom_data.event_id 
      || (payload.data && payload.data.id) 
      || ('ls_' + Date.now());
    const customData = (payload.meta && payload.meta.custom_data) || {};
    const restaurantId = customData.restaurant_id || null;

    const dataObj = (payload.data && payload.data.attributes) || {};
    const status = dataObj.status; // active | on_trial | past_due | cancelled | expired
    const renewsAt = dataObj.renews_at || dataObj.ends_at;

    let normalizedStatus = 'active';
    if (status === 'past_due' || status === 'unpaid') normalizedStatus = 'past_due';
    else if (status === 'cancelled' || status === 'expired') normalizedStatus = 'canceled';
    else if (status === 'on_trial') normalizedStatus = 'trialing';

    return {
      eventId,
      eventName,
      restaurantId,
      status: normalizedStatus,
      rawStatus: status,
      customerEmail: dataObj.user_email,
      renewsAt: renewsAt || new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      provider: 'lemonsqueezy'
    };
  }
};

module.exports = lemonProvider;
