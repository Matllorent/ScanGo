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
      if (Buffer.from(sig, 'utf8').length !== Buffer.from(expectedSig, 'utf8').length) return false;
      return crypto.timingSafeEqual(Buffer.from(sig, 'utf8'), Buffer.from(expectedSig, 'utf8'));
    } catch (e) {
      return false;
    }
  },

  /**
   * Crea una Checkout Session real vía API y devuelve su URL hosted.
   * `priceId` viene del orquestador (STRIPE_PRICE_<PLAN> o STRIPE_PRICE_<PERIOD>).
   * @returns {Promise<string|null>}
   */
  async createCheckoutUrl({ priceId, customerEmail, restaurantId, planId, successUrl, cancelUrl }) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey || !priceId) return null;

    const body = new URLSearchParams({
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: JSON.stringify([{ price: priceId, quantity: 1 }]),
      client_reference_id: restaurantId || '',
      'metadata[restaurant_id]': restaurantId || '',
      'metadata[plan_id]': planId || ''
    });
    if (customerEmail) body.set('customer_email', customerEmail);

    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error((data.error && data.error.message) || `Stripe devolvió ${res.status} al crear el checkout`);
    }
    return data.url || null;
  },

  parseWebhookPayload(event) {
    const eventId = event.id || ('evt_' + Date.now());
    const eventType = event.type;
    const dataObj = (event.data && event.data.object) || {};

    const restaurantId = dataObj.client_reference_id 
      || (dataObj.metadata && dataObj.metadata.restaurant_id) 
      || null;
    const planId = (dataObj.metadata && dataObj.metadata.plan_id) || null;

    let normalizedStatus = 'active';
    if (eventType === 'invoice.payment_failed') normalizedStatus = 'past_due';
    else if (eventType === 'customer.subscription.deleted') normalizedStatus = 'canceled';
    else if (dataObj.status === 'trialing') normalizedStatus = 'trialing';
    else if (dataObj.status === 'past_due' || dataObj.status === 'unpaid') normalizedStatus = 'past_due';

    const renewsAt = dataObj.current_period_end 
      ? new Date(dataObj.current_period_end * 1000).toISOString()
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    return {
      eventId,
      eventName: eventType,
      restaurantId,
      plan: planId,
      status: normalizedStatus,
      rawStatus: dataObj.status,
      customerEmail: dataObj.customer_email || (dataObj.customer_details && dataObj.customer_details.email),
      renewsAt,
      provider: 'stripe'
    };
  }
};

module.exports = stripeProvider;
