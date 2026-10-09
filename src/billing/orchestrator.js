const db = require('../db/db');
const lemonProvider = require('./providers/lemonsqueezy');
const stripeProvider = require('./providers/stripe');
const mpProvider = require('./providers/mercadopago');
const sentry = require('../../api/utils/sentry');
const emailService = require('../../api/services/email');
const AppError = require('../../api/utils/AppError');

const PROVIDERS = {
  lemonsqueezy: lemonProvider,
  stripe: stripeProvider,
  mercadopago: mpProvider
};

// Fuente única de precios/trial: src/billing/plans.json (fallback a literales si falta).
let _plansConfig = {};
try {
  _plansConfig = require('./plans.json');
} catch (e) {
  _plansConfig = {};
}
function _planPrice(key, fallback) {
  const raw = _plansConfig && _plansConfig[key] && _plansConfig[key].price;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const PLANS = {
  starter_monthly: {
    name: 'Starter Mensual',
    priceUsd: _planPrice('starter_monthly', 9),
    features: { maxDishes: 30, themes: 3, zonesDelivery: true, waiterCall: false, analytics: false }
  },
  starter_annual: {
    name: 'Starter Anual',
    priceUsd: _planPrice('starter_annual', 79),
    features: { maxDishes: 30, themes: 3, zonesDelivery: true, waiterCall: false, analytics: false }
  },
  pro_monthly: {
    name: 'Pro Mensual',
    priceUsd: _planPrice('pro_monthly', 19),
    features: { maxDishes: 999, themes: 9, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  },
  pro_annual: {
    name: 'Pro Anual',
    priceUsd: _planPrice('pro_annual', 159),
    features: { maxDishes: 999, themes: 9, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  },
  // Pago único por evento (one-off): el dueño paga una vez y el menú queda
  // online hasta la fecha del evento. No se renueva: al vencer eventDate el
  // menú se pausa con la infra de `expiresAt` ya existente.
  event_once: {
    name: 'Evento Único',
    priceUsd: _planPrice('event_once', 12),
    features: { maxDishes: 999, themes: 9, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  }
};

/**
 * Redondea a 2 decimales para montos monetarios (evita errores de coma flotante)
 */
function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_DAYS = Number.isFinite(Number(_plansConfig.TRIAL_DAYS)) ? Number(_plansConfig.TRIAL_DAYS) : 7;
// Días extra en los que el menú público sigue online después de vencer el trial
// (el Studio muestra el paywall desde el día 8, pero el local no pierde visitas).
const TRIAL_GRACE_DAYS = 3;
const PAST_DUE_GRACE_DAYS = 7;

/**
 * Alias cortos que la UI manda al checkout (botones "Suscribirme" / "Activar Anual")
 * mapeados a las claves reales de plan.
 */
const PLAN_ALIASES = {
  monthly: 'pro_monthly',
  mensual: 'pro_monthly',
  pro: 'pro_monthly',
  annual: 'pro_annual',
  anual: 'pro_annual',
  starter: 'starter_monthly',
  // Aliases del plan de evento one-off (la UI manda 'event_once' o el token
  // legacy 'event' de la creación de eventos)
  evento: 'event_once',
  fiesta: 'event_once',
  event: 'event_once'
};

const billingOrchestrator = {
  /**
   * Normaliza cualquier alias de plan que llegue del frontend
   * ('monthly', 'annual', 'pro'…) a una clave real de PLANS.
   * Lanza 400 si el plan no existe (evita cobrar un plan equivocado).
   */
  normalizePlanId(planId) {
    const raw = String(planId || '').trim().toLowerCase();
    const key = PLAN_ALIASES[raw] || raw;
    if (!PLANS[key]) {
      throw new AppError(
        `Plan inválido "${planId}". Planes disponibles: ${Object.keys(PLANS).join(', ')}.`,
        400,
        'INVALID_PLAN'
      );
    }
    return key;
  },

  /**
   * Resuelve el proveedor de pago según país/moneda.
   * UY/AR → Mercado Pago (con fallback a otro proveedor si MP no está configurado).
   * El resto del mundo → DEFAULT_BILLING_PROVIDER (lemonsqueezy por defecto).
   */
  resolveProvider(countryCode, currency) {
    const cc = String(countryCode || '').toUpperCase();
    const cur = String(currency || '').toUpperCase();
    // '$' es la moneda por defecto que asigna el registro en Uruguay
    const mpCurrencies = ['UYU', 'ARS', '$U', '$', 'US$', 'USD'];
    const wantsMp = ['UY', 'AR'].includes(cc) && (mpCurrencies.includes(cur) || !cur);

    if (wantsMp) {
      if (this.isProviderConfigured('mercadopago')) return 'mercadopago';
      if (this.isProviderConfigured('stripe')) return 'stripe';
      if (this.isProviderConfigured('lemonsqueezy')) return 'lemonsqueezy';
      // Sin credenciales: devolvemos mercadopago para que createCheckout
      // reporte exactamente qué falta configurar en lugar de fallar opaco.
      return 'mercadopago';
    }

    const preferred = process.env.DEFAULT_BILLING_PROVIDER || 'lemonsqueezy';
    if (this.isProviderConfigured(preferred)) return preferred;
    const fallback = ['lemonsqueezy', 'stripe', 'mercadopago'].find(name => this.isProviderConfigured(name));
    return fallback || preferred;
  },

  /**
   * ¿El proveedor tiene credenciales/IDs suficientes para generar un checkout real?
   */
  isProviderConfigured(name) {
    if (name === 'mercadopago') {
      return typeof mpProvider.isConfigured === 'function' ? mpProvider.isConfigured() : false;
    }
    if (name === 'stripe') {
      return Boolean(process.env.STRIPE_SECRET_KEY && this.getProviderPlanId('stripe', 'pro_monthly'));
    }
    if (name === 'lemonsqueezy') {
      return Boolean(process.env.LEMONSQUEEZY_STORE_ID && this.getProviderPlanId('lemonsqueezy', 'pro_monthly'));
    }
    return false;
  },

  /**
   * IDs de precio/variante por plan y proveedor (variables de entorno).
   * Los IDs por plan tienen prioridad; si faltan caen a los genéricos por período.
   */
  getProviderPlanId(providerName, planId) {
    const plan = PLANS[planId] ? planId : 'pro_monthly';
    const period = plan.endsWith('_annual') ? 'ANNUAL' : 'MONTHLY';
    const planEnv = plan.toUpperCase();

    if (providerName === 'lemonsqueezy') {
      return process.env[`LEMONSQUEEZY_VARIANT_${planEnv}`]
        || process.env[`LEMONSQUEEZY_PLAN_${period}_VARIANT_ID`]
        || '';
    }
    if (providerName === 'stripe') {
      return process.env[`STRIPE_PRICE_${planEnv}`]
        || process.env[`STRIPE_PRICE_${period}`]
        || '';
    }
    return '';
  },

  /**
   * Lista de variables de entorno faltantes para que la UI muestre un error claro.
   */
  getProviderMissingConfig(providerName) {
    if (providerName === 'mercadopago') {
      const missing = [];
      if (!mpProvider.isConfigured || !mpProvider.isConfigured()) missing.push('MERCADOPAGO_ACCESS_TOKEN');
      return missing;
    }
    if (providerName === 'stripe') {
      const missing = [];
      if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
      if (!this.getProviderPlanId('stripe', 'pro_monthly')) missing.push('STRIPE_PRICE_MONTHLY');
      return missing;
    }
    const missing = [];
    if (!process.env.LEMONSQUEEZY_STORE_ID) missing.push('LEMONSQUEEZY_STORE_ID');
    if (!this.getProviderPlanId('lemonsqueezy', 'pro_monthly')) missing.push('LEMONSQUEEZY_PLAN_MONTHLY_VARIANT_ID');
    return missing;
  },

  /**
   * Devuelve el nombre legible de un plan (ej: 'pro_monthly' -> 'Pro Mensual')
   */
  getPlanName(planId) {
    return (PLANS[planId] || PLANS.pro_monthly).name;
  },

  /**
   * Descuento progresivo por posición de sucursal en el volumen.
   * @param {number} branchNumber - Posición de la sucursal (1 = principal)
   * @returns {number} Descuento entre 0 y 0.5
   */
  getBranchDiscount(branchNumber) {
    const position = Math.floor(Number(branchNumber) || 1);
    if (position <= 1) return 0;      // Sucursal 1 (Principal): sin descuento
    if (position === 2) return 0.20;  // Sucursal 2: 20% de descuento (paga 80%)
    if (position === 3) return 0.35;  // Sucursal 3: 35% de descuento (paga 65%)
    return 0.50;                      // Sucursales 4 en adelante: 50% (piso mínimo)
  },

  /**
   * Precio total escalonado por volumen de sucursales.
   * Suma el precio base de cada sucursal con su descuento progresivo:
   *   1ª = 100%, 2ª = 80%, 3ª = 65%, 4ª en adelante = 50%.
   *
   * @param {number} basePrice - Precio base del plan por sucursal
   * @param {number} branchCount - Cantidad de sucursales (mínimo 1: la principal)
   * @returns {number} Precio total redondeado a 2 decimales
   */
  calculateMultiBranchPrice(basePrice, branchCount) {
    const base = Number(basePrice);
    if (!Number.isFinite(base) || base <= 0) return 0;

    // Mínimo 1 sucursal (la principal); entradas inválidas o fracciones se truncan
    const count = Math.max(1, Math.floor(Number(branchCount) || 1));

    let total = 0;
    for (let i = 1; i <= count; i++) {
      total += round2(base * (1 - this.getBranchDiscount(i)));
    }
    return round2(total);
  },

  /**
   * Cantidad de sucursales de un restaurante (mínimo 1: la principal).
   * Usa el array `branches` validado por el helper de DB.
   * @param {object} restaurant
   * @returns {number}
   */
  getBranchCount(restaurant) {
    if (!restaurant) return 1;
    const branches = typeof db.getRestaurantBranches === 'function'
      ? db.getRestaurantBranches(restaurant)
      : (Array.isArray(restaurant.branches) ? restaurant.branches : []);
    return Math.max(1, branches.length);
  },

  /**
   * Evaluación de precio efectivo del plan para un restaurante,
   * aplicando el descuento escalonado por volumen de sucursales.
   *
   * @param {object} restaurant
   * @param {string} planId - Clave del plan (ej: 'pro_monthly')
   * @returns {object} pricing { planId, planName, currency, basePrice, branchCount, totalPrice, totalDiscount, hasMultiBranchDiscount }
   */
  getPlanPricing(restaurant, planId) {
    const planKey = PLANS[planId] ? planId : 'pro_monthly';
    const plan = PLANS[planKey];
    const branchCount = this.getBranchCount(restaurant);
    const totalPrice = this.calculateMultiBranchPrice(plan.priceUsd, branchCount);

    return {
      planId: planKey,
      planName: plan.name,
      currency: 'USD',
      basePrice: plan.priceUsd,
      branchCount,
      totalPrice,
      totalDiscount: round2(plan.priceUsd * branchCount - totalPrice),
      hasMultiBranchDiscount: branchCount > 1
    };
  },

  /**
   * Crea el checkout en el proveedor resuelto por país/moneda.
   * Es async porque Mercado Pago y Stripe requieren crear la sesión vía API.
   *
   * No lanza por falta de credenciales: devuelve `checkoutUrl: null` más
   * `configuration.missing` para que la ruta HTTP responda 503 con un mensaje
   * accionable. Lanza 400 sólo ante un plan inválido.
   */
  async createCheckout({ restaurantId, planId, customerEmail, countryCode, currency, returnUrl }) {
    const resolvedPlanId = this.normalizePlanId(planId);
    const providerName = this.resolveProvider(countryCode, currency);
    const provider = PROVIDERS[providerName];
    if (!provider) throw new AppError('Proveedor de pagos no soportado: ' + providerName, 400, 'PAYMENT_PROVIDER_UNSUPPORTED');

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const successUrl = returnUrl || `${appUrl}/studio?billing=success`;
    const cancelUrl = `${appUrl}/studio?billing=canceled`;
    const restaurant = db.findRestaurantById(restaurantId);

    const checkout = {
      provider: providerName,
      planId: resolvedPlanId,
      planName: PLANS[resolvedPlanId].name,
      checkoutUrl: null,
      // Precio efectivo por volumen de sucursales (los proveedores cobran vía variant/price ID)
      pricing: restaurant ? this.getPlanPricing(restaurant, resolvedPlanId) : null
    };

    if (!this.isProviderConfigured(providerName)) {
      checkout.configuration = { missing: this.getProviderMissingConfig(providerName) };
      return checkout;
    }

    try {
      checkout.checkoutUrl = await provider.createCheckoutUrl({
        planId: resolvedPlanId,
        variantId: this.getProviderPlanId('lemonsqueezy', resolvedPlanId),
        priceId: this.getProviderPlanId('stripe', resolvedPlanId),
        pricing: checkout.pricing,
        customerEmail,
        restaurantId,
        countryCode: countryCode || 'UY',
        currency: currency || (restaurant && restaurant.currency) || 'USD',
        successUrl,
        cancelUrl,
        redirectUrl: successUrl
      });
    } catch (e) {
      checkout.error = e.message;
      sentry.captureException(e, { source: 'billing.checkout', tags: { provider: providerName } });
    }

    return checkout;
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

    // 2. Parse payload (algunos proveedores resuelven el pago vía API — ej. Mercado Pago IPN)
    const parsed = await provider.parseWebhookPayload(payload);
    if (parsed.ignored) {
      return { success: true, ignored: true, eventId: parsed.eventId };
    }

    // 3. Idempotency check: Ignore duplicate events
    if (db.hasProcessedWebhook(providerName, parsed.eventId)) {
      return { success: true, duplicate: true, eventId: parsed.eventId };
    }

    // 4. Update restaurant subscription in DB
    if (parsed.restaurantId && parsed.status && parsed.status !== 'pending') {
      // El plan de evento one-off no se renueva: la validez llega hasta la fecha
      // del evento (expiresAt/eventDate), NO hasta el renewsAt del proveedor
      // (MP asume +30 días como si fuera una suscripción recurrente).
      const isEventOneOff = parsed.plan === 'event_once';
      let periodEnd = parsed.renewsAt;
      if (isEventOneOff) {
        const eventRest = db.findRestaurantById(parsed.restaurantId);
        const eventEnd = eventRest && (eventRest.expiresAt || eventRest.eventDate);
        if (eventEnd) periodEnd = new Date(eventEnd).toISOString();
      }

      const subUpdate = {
        status: parsed.status,
        provider: providerName,
        currentPeriodEnd: periodEnd,
        // Sin smart dunning en el one-off: no hay cobro recurrente que rechazar
        gracePeriodDaysRemaining: isEventOneOff ? 0 : PAST_DUE_GRACE_DAYS,
        lastPaymentError: parsed.status === 'past_due' ? 'Falló el cobro automático de la tarjeta' : null
      };
      // Conserva el plan comprado (Lemon/Stripe lo infieren del webhook; MP del external_reference)
      if (parsed.plan && PLANS[parsed.plan]) subUpdate.plan = parsed.plan;

      await db.updateSubscription(parsed.restaurantId, subUpdate);

      sentry.captureMessage('[Billing] Suscripción actualizada: Rest=' + parsed.restaurantId + ' Status=' + parsed.status + ' Provider=' + providerName, {
        level: 'info',
        tags: { restaurantId: parsed.restaurantId, status: parsed.status, provider: providerName }
      });

      // Send payment receipt email on successful payment
      if (parsed.status === 'active') {
        try {
          const restaurant = db.findRestaurantById(parsed.restaurantId);
          const user = restaurant ? db.findUserById(restaurant.userId) : null;
          if (user) {
            const planName = (PLANS[parsed.plan] || PLANS.pro_monthly).name;
            emailService.sendPaymentReceiptEmail({
              to: user.email,
              userName: user.name,
              restaurantName: restaurant.name || restaurant.bizName,
              planName,
              renewsAt: parsed.renewsAt
            }).catch(e => console.warn('[Billing] Failed to send receipt email:', e.message));
          }
        } catch (e) {
          console.warn('[Billing] Failed to send receipt email:', e.message);
        }
      }

      // Send payment failed email on past_due (single consolidated block)
      if (parsed.status === 'past_due') {
        try {
          const restaurant = db.findRestaurantById(parsed.restaurantId);
          const user = restaurant ? db.findUserById(restaurant.userId) : null;
          if (user) {
            const planName = (PLANS[parsed.plan] || PLANS.pro_monthly).name;
            emailService.sendPaymentFailedEmail({
              to: user.email,
              userName: user.name,
              restaurantName: restaurant.name || restaurant.bizName,
              planName,
              gracePeriodDays: 7,
              updatePaymentUrl: `${process.env.APP_URL || ''}/studio?tab=billing`
            }).catch(e => console.warn('[Billing] Failed to send payment failed email:', e.message));
          }
        } catch (e) {
          console.warn('[Billing] Failed to send payment failed email:', e.message);
        }
      }
    }

    // 5. Mark webhook as processed (await: el 200 al proveedor solo debe volver
    //    cuando el marcador de idempotencia está persistido en DB)
    await db.markWebhookProcessed(providerName, parsed.eventId, parsed.eventName, parsed);

    return { success: true, eventId: parsed.eventId, status: parsed.status };
  },

  /**
   * Estado de acceso cuando el trial de 7 días ya venció.
   * - Días 1-3 tras el vencimiento: el menú público sigue ONLINE (gracia post-trial)
   *   y se devuelve `requiresPayment: true` para que el Studio muestre el paywall.
   * - Día 4 en adelante: menú pausado.
   */
  buildTrialExpiredAccess(rest, sub, trialEnds, now) {
    const graceEnd = new Date(trialEnds.getTime() + TRIAL_GRACE_DAYS * DAY_MS);
    const inGrace = now <= graceEnd;
    const planKey = PLANS[sub.plan] ? sub.plan : 'pro_monthly';

    if (inGrace) {
      const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / DAY_MS));
      return {
        allowed: true,
        status: 'expired',
        trialExpired: true,
        requiresPayment: true,
        trialGraceDaysRemaining: daysLeft,
        plan: planKey,
        features: PLANS[planKey].features,
        pricing: this.getPlanPricing(rest, planKey),
        inGracePeriod: true,
        warning: `Tu prueba gratuita terminó. Tu menú sigue online ${daysLeft} día${daysLeft === 1 ? '' : 's'} más: activá tu plan para no perderlo.`
      };
    }

    return {
      allowed: false,
      status: 'expired',
      isTrialExpired: true,
      reason: 'trial_expirado',
      warning: 'Tu período de prueba gratuita ha finalizado. Actualizá tu suscripción para reactivar tu menú.'
    };
  },

  verifyAccess(restaurantId) {
    const rest = db.findRestaurantById(restaurantId);
    if (!rest) return { allowed: false, reason: 'restaurante_no_encontrado' };

    const sub = rest.subscription || {};
    const now = new Date();
    const periodEnd = sub.currentPeriodEnd ? new Date(sub.currentPeriodEnd) : now;

    // Active: Full access
    if (sub.status === 'active') {
      return {
        allowed: true,
        status: 'active',
        plan: sub.plan || 'pro_monthly',
        features: (PLANS[sub.plan] || PLANS.pro_monthly).features,
        pricing: this.getPlanPricing(rest, sub.plan || 'pro_monthly'),
        inGracePeriod: false
      };
    }

    // Trialing: Full access during the 7-day trial window
    if (sub.status === 'trialing') {
      const trialEnds = sub.trialEndsAt
        ? new Date(sub.trialEndsAt)
        : new Date(periodEnd.getTime() + TRIAL_DAYS * DAY_MS);
      if (now <= trialEnds) {
        const daysLeft = Math.max(0, Math.ceil((trialEnds.getTime() - now.getTime()) / DAY_MS));
        return {
          allowed: true,
          status: 'trialing',
          daysLeft,
          plan: sub.plan || 'pro_monthly',
          features: (PLANS[sub.plan] || PLANS.pro_monthly).features,
          pricing: this.getPlanPricing(rest, sub.plan || 'pro_monthly'),
          inGracePeriod: false
        };
      }
      return this.buildTrialExpiredAccess(rest, sub, trialEnds, now);
    }

    // Expired: primeros TRIAL_GRACE_DAYS el menú público sigue online (decisión de producto)
    if (sub.status === 'expired') {
      const trialEnds = sub.trialEndsAt ? new Date(sub.trialEndsAt) : null;
      // La gracia post-trial sólo aplica a suscripciones que nunca estuvieron pagas:
      // una suscripción degradada por dunning no vuelve a ganar 3 días de menú online.
      const wasPaid = Boolean(sub.downgradedAt) || Boolean(sub.provider && sub.provider !== 'trial');
      if (trialEnds && !wasPaid) return this.buildTrialExpiredAccess(rest, sub, trialEnds, now);
      return {
        allowed: false,
        status: 'expired',
        isTrialExpired: true,
        reason: 'suscripcion_inactiva',
        warning: 'Tu suscripción ha finalizado. Activá tu plan para reactivar tu menú.'
      };
    }

    // Past Due: In Grace Period (7 days allowed before locking menu)
    if (sub.status === 'past_due') {
      const graceEnd = new Date(periodEnd.getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
      const isStillInGrace = now <= graceEnd;
      const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / DAY_MS));

      return {
        allowed: isStillInGrace,
        status: 'past_due',
        inGracePeriod: isStillInGrace,
        gracePeriodDaysRemaining: daysLeft,
        plan: sub.plan || 'pro_monthly',
        features: (PLANS[sub.plan] || PLANS.pro_monthly).features,
        pricing: this.getPlanPricing(rest, sub.plan || 'pro_monthly'),
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
