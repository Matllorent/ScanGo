const mpService = require('../../services/mercadopago');

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Moneda en la que se cobra la suscripción.
 * Los planes se publican en USD, así que por defecto se cobra en USD.
 * Se puede forzar con MERCADOPAGO_CURRENCY (p. ej. 'UYU' o 'ARS').
 */
function resolveChargeCurrency(countryCode, currency) {
  const forced = (process.env.MERCADOPAGO_CURRENCY || '').toUpperCase();
  if (forced) return forced;
  const cc = String(countryCode || '').toUpperCase();
  const explicit = String(currency || '').toUpperCase();
  if (explicit === 'UYU' || explicit === 'ARS') return explicit;
  if (cc === 'AR') return 'ARS';
  return 'USD';
}

/**
 * Convierte el precio USD del plan a la moneda de cobro usando una tasa
 * configurable (MERCADOPAGO_FX_UYU / MERCADOPAGO_FX_ARS).
 * Sin tasa explícita no se inventa un tipo de cambio: se lanza un error claro.
 */
function toChargeAmount(amountUsd, chargeCurrency) {
  if (chargeCurrency === 'USD') return amountUsd;
  const rate = Number(process.env[`MERCADOPAGO_FX_${chargeCurrency}`]);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      `Mercado Pago cobraría en ${chargeCurrency} pero falta la tasa de cambio. ` +
      `Configurá MERCADOPAGO_FX_${chargeCurrency} (USD → ${chargeCurrency}) o MERCADOPAGO_CURRENCY=USD.`
    );
  }
  return Math.round(amountUsd * rate * 100) / 100;
}

/**
 * Consulta un pago a la API de Mercado Pago.
 * Los webhooks IPN/webhooks v2 sólo traen el id: sin este fetch no se puede
 * saber ni el restaurant ni el estado real del cobro.
 */
async function getPayment(paymentId) {
  const accessToken = mpService.getAccessToken();
  if (!accessToken) throw new Error('MERCADOPAGO_ACCESS_TOKEN no está configurado');

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Mercado Pago devolvió ${res.status} al consultar el pago ${paymentId}: ${data.message || 'error'}`);
  }
  return data;
}

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

  verifyWebhookSignature() {
    // La validación se hace en la ruta con el ?secret= que adjuntamos al
    // notification_url (MP no firma el body con HMAC salvo x-signature, que
    // requiere data.id + request-id del header).
    return true;
  },

  /**
   * Crea una preferencia real de Checkout Pro y devuelve su init_point.
   * Devuelve null si no hay credenciales (lo reporta el orquestador).
   */
  async createCheckoutUrl({ planId, pricing, customerEmail, restaurantId, successUrl, cancelUrl, countryCode, currency }) {
    if (!this.isConfigured()) return null;

    const chargeCurrency = resolveChargeCurrency(countryCode, currency);
    const amountUsd = pricing && Number.isFinite(pricing.totalPrice) ? pricing.totalPrice : 19;
    const unitPrice = toChargeAmount(amountUsd, chargeCurrency);

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET || '';
    const notificationUrl = `${appUrl}/api/billing/webhook/mercadopago` +
      (webhookSecret ? `?secret=${encodeURIComponent(webhookSecret)}` : '');

    const planName = (pricing && pricing.planName) || 'Plan ScanGo';
    const branchCount = (pricing && pricing.branchCount) || 1;

    const preference = await this.createPreference({
      items: [{
        id: planId,
        title: `ScanGo ${planName}`,
        description: `Suscripción ${planName} para ${branchCount} local${branchCount === 1 ? '' : 'es'}`,
        quantity: 1,
        unit_price: unitPrice,
        currency_id: chargeCurrency
      }],
      payer: { email: customerEmail },
      externalReference: `${restaurantId}:${planId}`,
      notificationUrl,
      autoReturn: 'approved',
      backUrls: {
        success: successUrl,
        failure: cancelUrl,
        pending: successUrl
      }
    });

    return preference.init_point || preference.sandbox_init_point || null;
  },

  /**
   * Webhook de Mercado Pago (IPN y webhooks v2).
   * El body sólo trae el id del pago: hay que consultarlo para conocer
   * restaurant, plan y estado reales.
   */
  async parseWebhookPayload(payload) {
    const source = payload || {};
    const type = String(source.type || source.topic || '').toLowerCase();
    const action = String(source.action || '').toLowerCase();
    const dataId = (source.data && source.data.id) || (typeof source.id === 'string' ? source.id : null) || source['data-id'] || null;

    const isPaymentEvent = type.includes('payment') || action.includes('payment');
    if (!isPaymentEvent || !dataId) {
      // merchant_order / plan / tooltip … no cambian la suscripción
      return {
        eventId: `mp_ignored_${type || 'unknown'}_${Date.now()}`,
        eventName: type || action || 'mercadopago_event',
        ignored: true
      };
    }

    const payment = await getPayment(dataId);
    const rawStatus = String(payment.status || '').toLowerCase();

    let status = 'pending';
    if (rawStatus === 'approved') status = 'active';
    else if (['rejected', 'cancelled', 'refunded', 'charged_back', 'expired'].includes(rawStatus)) status = 'past_due';
    else status = 'pending'; // pending | in_process | in_mediation | authorized → no toca la suscripción

    // external_reference viene de createCheckoutUrl: `${restaurantId}:${planId}`
    const reference = String(payment.external_reference || '');
    const sep = reference.lastIndexOf(':');
    const restaurantId = sep > 0 ? reference.slice(0, sep) : (reference || null);
    const planId = sep > 0 ? reference.slice(sep + 1) : null;

    const approvedAt = payment.date_approved ? new Date(payment.date_approved) : new Date();
    const renewsAt = new Date(approvedAt.getTime() + 30 * DAY_MS).toISOString();

    return {
      eventId: `mp_payment_${payment.id}_${rawStatus || 'unknown'}`,
      eventName: `payment.${rawStatus || 'updated'}`,
      restaurantId: restaurantId || null,
      plan: planId || null,
      status,
      rawStatus,
      customerEmail: (payment.payer && payment.payer.email) || payment.collector_email || null,
      renewsAt,
      provider: 'mercadopago'
    };
  }
};

module.exports = mpProvider;
module.exports.resolveChargeCurrency = resolveChargeCurrency;
module.exports.toChargeAmount = toChargeAmount;
