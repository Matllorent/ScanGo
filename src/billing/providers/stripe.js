const crypto = require('crypto');

const stripeProvider = {
  name: 'stripe',

  verifyWebhookSignature(rawBody, signatureHeader, secret) {
    if (!secret || !signatureHeader) return false;
    try {
      const parts = signatureHeader.split(',');
      const timestampPart = parts.find(p => p.startsWith('t='));
      const sigPart = parts.find(p => p.startsWith('v1='));
      if (!timestampPart || !sigPart) return false;

      const timestamp = timestampPart.split('=')[1];
      const sig = sigPart.split('=')[1];
      const payload = timestamp + '.' + rawBody;

      const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
    } catch (e) {
      return false;
    }
  },

  createCheckoutUrl({ priceId, customerEmail, restaurantId, successUrl, cancelUrl }) {
    // In production with stripe SDK: stripe.checkout.sessions.create(...)
    // Simulated direct checkout session link with metadata
    return 'https://checkout.stripe.com/c/pay/' + (priceId || 'cs_test_mock') + 
      '?prefilled_email=' + encodeURIComponent(customerEmail || '') + 
      '&client_reference_id=' + encodeURIComponent(restaurantId || '');
  },

  parseWebhookPayload(event) {
    const eventId = event.id || ('evt_' + Date.now());
    const eventType = event.type;
    const dataObj = (event.data && event.data.object) || {};

    const restaurantId = dataObj.client_reference_id 
      || (dataObj.metadata && dataObj.metadata.restaurant_id) 
      || null;

    let normalizedStatus = 'active';
    if (eventType === 'invoice.payment_failed') normalizedStatus = 'past_due';
    else if (eventType === 'customer.subscription.deleted') normalizedStatus = 'canceled';
    else if (dataObj.status === 'trialing') normalizedStatus = 'trialing';
    else if (dataObj.status === 'past_due' || dataObj.status === 'unpaid') normalizedStatus = 'past_due';

    const renewsAt = dataObj.current_period_end 
      ? new Date(dataObj.current_period_end * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();

    return {
      eventId,
      eventName: eventType,
      restaurantId,
      status: normalizedStatus,
      rawStatus: dataObj.status,
      customerEmail: dataObj.customer_email || (dataObj.customer_details && dataObj.customer_details.email),
      renewsAt,
      provider: 'stripe'
    };
  }
};

module.exports = stripeProvider;
