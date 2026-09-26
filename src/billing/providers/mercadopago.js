const mpService = require('../../services/mercadopago');

const mpProvider = {
  name: 'mercadopago',

  getAccessToken() {
    return mpService.getAccessToken();
  },

  isConfigured() {
    return mpService.isConfigured();
  },

  createPreference(options) {
    return mpService.createPreference(options);
  },

  verifyWebhookSignature(headers, secret) {
    // In production: verify x-signature header HMAC if configured in MP dashboard
    return true;
  },

  createCheckoutUrl({ planId, customerEmail, restaurantId, returnUrl }) {
    // Returns checkout url for subscription or Checkout Pro preference
    return 'https://www.mercadopago.com.uy/subscriptions/checkout?preapproval_plan_id=' + (planId || 'plan_default') +
      '&external_reference=' + encodeURIComponent(restaurantId || '');
  },

  parseWebhookPayload(payload) {
    const eventId = (payload.id || payload.data && payload.data.id) || ('mp_' + Date.now());
    const eventType = payload.type || payload.action || 'subscription_update';
    const dataObj = payload.data || {};

    const restaurantId = payload.external_reference || (dataObj && dataObj.external_reference) || null;
    const status = dataObj.status || payload.status;

    let normalizedStatus = 'active';
    if (status === 'cancelled' || status === 'paused') normalizedStatus = 'canceled';
    else if (status === 'pending') normalizedStatus = 'past_due';

    return {
      eventId,
      eventName: eventType,
      restaurantId,
      status: normalizedStatus,
      rawStatus: status,
      customerEmail: payload.payer_email || (dataObj && dataObj.payer_email),
      renewsAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
      provider: 'mercadopago'
    };
  }
};

module.exports = mpProvider;
