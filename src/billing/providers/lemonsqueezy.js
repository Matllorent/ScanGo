const crypto = require('crypto');

const lemonProvider = {
  name: 'lemonsqueezy',

  verifyWebhookSignature(rawBody, signature, secret) {
    if (!secret || !signature) return false;
    try {
      const hmac = crypto.createHmac('sha256', secret);
      const digest = hmac.update(rawBody).digest('hex');
      const sig = Buffer.from(String(signature), 'utf8');
      const expected = Buffer.from(String(digest), 'utf8');
      if (sig.length !== expected.length) return false;
      return crypto.timingSafeEqual(expected, sig);
    } catch (e) {
      return false;
    }
  },

  /**
   * Hosted checkout de Lemon Squeezy.
   * `variantId` viene del orquestador (LEMONSQUEEZY_VARIANT_<PLAN> o
   * LEMONSQUEEZY_PLAN_<PERIOD>_VARIANT_ID). Sin variante real no hay checkout.
   * @returns {string|null}
   */
  createCheckoutUrl({ planId, variantId, customerEmail, restaurantId, redirectUrl }) {
    const storeId = process.env.LEMONSQUEEZY_STORE_ID;
    if (!storeId || !variantId) return null;

    const params = new URLSearchParams();
    if (customerEmail) params.set('checkout[email]', customerEmail);
    if (restaurantId) params.set('checkout[custom][restaurant_id]', restaurantId);
    if (planId) params.set('checkout[custom][plan_id]', planId);
    if (redirectUrl) params.set('checkout[redirect_url]', redirectUrl);

    // Los links de checkout de Lemon viven en /buy/<variant_id>
    return `https://${storeId}.lemonsqueezy.com/buy/${variantId}?${params.toString()}`;
  },

  parseWebhookPayload(payload) {
    const eventName = payload.meta && payload.meta.event_name;
    const eventId = payload.meta && payload.meta.custom_data && payload.meta.custom_data.event_id 
      || (payload.data && payload.data.id) 
      || ('ls_' + Date.now());
    const customData = (payload.meta && payload.meta.custom_data) || {};
    const restaurantId = customData.restaurant_id || null;
    const planId = customData.plan_id || null;

    const dataObj = (payload.data && payload.data.attributes) || {};
    const status = dataObj.status; // active | on_trial | past_due | cancelled | expired
    const renewsAt = dataObj.renews_at || dataObj.ends_at;

    let normalizedStatus = 'active';
    if (status === 'past_due') normalizedStatus = 'past_due';
    else if (status === 'cancelled' || status === 'expired') normalizedStatus = 'canceled';
    else if (status === 'on_trial') normalizedStatus = 'trialing';

    return {
      eventId,
      eventName,
      restaurantId,
      plan: planId,
      status: normalizedStatus,
      rawStatus: status,
      customerEmail: dataObj.user_email,
      renewsAt: renewsAt || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      provider: 'lemonsqueezy'
    };
  }
};

module.exports = lemonProvider;
