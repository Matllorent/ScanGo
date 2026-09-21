const db = require('../db/db');
const lemonProvider = require('./providers/lemonsqueezy');
const stripeProvider = require('./providers/stripe');
const mpProvider = require('./providers/mercadopago');

const PROVIDERS = {
  lemonsqueezy: lemonProvider,
  stripe: stripeProvider,
  mercadopago: mpProvider
};

const PLANS = {
  starter_monthly: {
    name: 'Starter Mensual',
    priceUsd: 9,
    features: { maxDishes: 30, themes: 3, zonesDelivery: true, waiterCall: false, analytics: false }
  },
  starter_annual: {
    name: 'Starter Anual',
    priceUsd: 79,
    features: { maxDishes: 30, themes: 3, zonesDelivery: true, waiterCall: false, analytics: false }
  },
  pro_monthly: {
    name: 'Pro Mensual',
    priceUsd: 19,
    features: { maxDishes: 999, themes: 9, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  },
  pro_annual: {
    name: 'Pro Anual',
    priceUsd: 159,
    features: { maxDishes: 999, themes: 9, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  }
};

const billingOrchestrator = {
  resolveProvider(countryCode, currency) {
    if (['UY', 'AR'].includes((countryCode || '').toUpperCase()) && ['UYU', 'ARS', '$U'].includes(currency)) {
      return 'mercadopago';
    }
    return process.env.DEFAULT_BILLING_PROVIDER || 'lemonsqueezy';
  },

  createCheckout({ restaurantId, planId, customerEmail, countryCode, currency, returnUrl }) {
    const providerName = this.resolveProvider(countryCode, currency);
    const provider = PROVIDERS[providerName];
    if (!provider) throw new Error('Proveedor de pagos no soportado: ' + providerName);

    const redirectUrl = returnUrl || (process.env.APP_URL || 'http://localhost:3000') + '/studio?billing=success';

    return {
      provider: providerName,
      checkoutUrl: provider.createCheckoutUrl({
        variantId: planId,
        priceId: planId,
        planId,
        customerEmail,
        restaurantId,
        redirectUrl,
        successUrl: redirectUrl,
        cancelUrl: (process.env.APP_URL || 'http://localhost:3000') + '/studio?billing=canceled'
      })
    };
  },

  async processWebhook(providerName, headers, rawBody, payload) {
    const provider = PROVIDERS[providerName];
    if (!provider) throw new Error('Proveedor desconocido: ' + providerName);

    // 1. Signature Verification
    const secret = process.env[providerName.toUpperCase() + '_WEBHOOK_SECRET'] || 'dev_secret';
    const sigHeader = (headers && (headers['x-signature'] || headers['stripe-signature'])) || '';
    const isValid = provider.verifyWebhookSignature(rawBody, sigHeader, secret);
    if (!isValid && process.env.NODE_ENV === 'production') {
      throw new Error('Firma de webhook inválida para ' + providerName);
    }

    // 2. Parse payload
    const parsed = provider.parseWebhookPayload(payload);

    // 3. Idempotency check: Ignore duplicate events
    if (db.hasProcessedWebhook(providerName, parsed.eventId)) {
      return { success: true, duplicate: true, eventId: parsed.eventId };
    }

    // 4. Update restaurant subscription in DB
    if (parsed.restaurantId) {
      let graceDays = 7;
      db.updateSubscription(parsed.restaurantId, {
        status: parsed.status,
        provider: providerName,
        currentPeriodEnd: parsed.renewsAt,
        gracePeriodDaysRemaining: graceDays,
        lastPaymentError: parsed.status === 'past_due' ? 'Falló el cobro automático de la tarjeta' : null
      });

      console.log('[Billing] Suscripción actualizada: Rest=' + parsed.restaurantId + ' Status=' + parsed.status + ' Provider=' + providerName);
    }

    // 5. Mark webhook as processed
    db.markWebhookProcessed(providerName, parsed.eventId, parsed.eventName, parsed);

    return { success: true, eventId: parsed.eventId, status: parsed.status };
  },

  verifyAccess(restaurantId) {
    const rest = db.findRestaurantById(restaurantId);
    if (!rest) return { allowed: false, reason: 'restaurante_no_encontrado' };

    const sub = rest.subscription || {};
    const now = new Date();
    const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : now;

    // Active or Trialing: Full access
    if (sub.status === 'active' || sub.status === 'trialing') {
      return {
        allowed: true,
        status: sub.status,
        plan: sub.plan || 'pro_monthly',
        features: (PLANS[sub.plan] || PLANS.pro_monthly).features,
        inGracePeriod: false
      };
    }

    // Past Due: In Grace Period (7 days allowed before locking menu)
    if (sub.status === 'past_due') {
      const graceEnd = new Date(periodEnd.getTime() + 7 * 24 * 3600 * 1000);
      const isStillInGrace = now <= graceEnd;
      const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (24 * 3600 * 1000)));

      return {
        allowed: isStillInGrace,
        status: 'past_due',
        inGracePeriod: isStillInGrace,
        gracePeriodDaysRemaining: daysLeft,
        plan: sub.plan || 'pro_monthly',
        features: (PLANS[sub.plan] || PLANS.pro_monthly).features,
        warning: 'Cobro pendiente. Su menú se pausará en ' + daysLeft + ' días si no regulariza el pago.'
      };
    }

    // Canceled / Expired
    return {
      allowed: false,
      status: 'canceled',
      reason: 'suscripcion_inactiva',
      warning: 'Suscripción inactiva. Ingrese a su cuenta para renovar su menú.'
    };
  }
};

module.exports = billingOrchestrator;
