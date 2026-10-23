const db = require('../db/db');
const lemonProvider = require('./providers/lemonsqueezy');
const stripeProvider = require('./providers/stripe');
const mpProvider = require('./providers/mercadopago');
const sentry = require('../../api/utils/sentry');
const emailService = require('../../api/services/email');
const auditService = require('../../api/services/audit');
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

// Plan único: Starter Mensual/Anual con TODO incluido (sin tiers). Los planes
// `pro_*` existieron hasta oct-2026 y se mantienen como alias legacy para no
// romper suscripciones/webhooks ya cobrados: resuelven al Starter equivalente.
const PLANS = {
  starter_monthly: {
    name: 'Starter Mensual',
    priceUsd: _planPrice('starter_monthly', 9),
    features: { maxDishes: 200, themes: 17, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  },
  starter_annual: {
    name: 'Starter Anual',
    priceUsd: _planPrice('starter_annual', 79),
    features: { maxDishes: 200, themes: 17, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  },
  // Pago único por evento (one-off): el dueño paga una vez y el menú queda
  // online hasta la fecha del evento. No se renueva: al vencer eventDate el
  // menú se pausa con la infra de `expiresAt` ya existente.
  event_once: {
    name: 'Evento Único',
    priceUsd: _planPrice('event_once', 12),
    features: { maxDishes: 100, themes: 12, zonesDelivery: true, waiterCall: true, wifiCard: true, analytics: true }
  }
};

// Límite de platos en trial (antes de activar plan): 50 platos máx
const TRIAL_MAX_DISHES = 50;

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
  monthly: 'starter_monthly',
  mensual: 'starter_monthly',
  annual: 'starter_annual',
  anual: 'starter_annual',
  starter: 'starter_monthly',
  pro: 'starter_monthly',
  // Aliases del plan de evento one-off (la UI manda 'event_once' o el token
  // legacy 'event' de la creación de eventos)
  evento: 'event_once',
  fiesta: 'event_once',
  event: 'event_once'
};

// Planes legacy (pre plan-único oct-2026): suscripciones y webhooks viejos
// traen `pro_monthly`/`pro_annual`; resuelven al Starter equivalente con los
// mismos features, sin cobrar de más ni romper el acceso.
const LEGACY_PLAN_ALIASES = {
  pro_monthly: 'starter_monthly',
  pro_annual: 'starter_annual'
};

// Resuelve cualquier clave de plan (real, alias UI o legacy) a una clave
// válida de PLANS. Nunca devuelve un plan inexistente.
function resolvePlanKey(planId) {
  const raw = String(planId || '').trim().toLowerCase();
  const key = PLAN_ALIASES[raw] || LEGACY_PLAN_ALIASES[raw] || raw;
  return PLANS[key] ? key : 'starter_monthly';
}

const billingOrchestrator = {
  /**
   * Normaliza cualquier alias de plan que llegue del frontend
   * ('monthly', 'annual', 'pro'…) a una clave real de PLANS.
   * Lanza 400 si el plan no existe (evita cobrar un plan equivocado).
   */
  normalizePlanId(planId) {
    const raw = String(planId || '').trim().toLowerCase();
    const key = PLAN_ALIASES[raw] || LEGACY_PLAN_ALIASES[raw] || raw;
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
      return Boolean(process.env.STRIPE_SECRET_KEY && this.getProviderPlanId('stripe', 'starter_monthly'));
    }
    if (name === 'lemonsqueezy') {
      return Boolean(process.env.LEMONSQUEEZY_STORE_ID && this.getProviderPlanId('lemonsqueezy', 'starter_monthly'));
    }
    return false;
  },

  /**
   * IDs de precio/variante por plan y proveedor (variables de entorno).
   * Los IDs por plan tienen prioridad; si faltan caen a los genéricos por período.
   */
  getProviderPlanId(providerName, planId) {
    const plan = resolvePlanKey(planId);
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
      if (!this.getProviderPlanId('stripe', 'starter_monthly')) missing.push('STRIPE_PRICE_MONTHLY');
      return missing;
    }
    const missing = [];
    if (!process.env.LEMONSQUEEZY_STORE_ID) missing.push('LEMONSQUEEZY_STORE_ID');
    if (!this.getProviderPlanId('lemonsqueezy', 'starter_monthly')) missing.push('LEMONSQUEEZY_PLAN_MONTHLY_VARIANT_ID');
    return missing;
  },

  /**
   * Devuelve el nombre legible de un plan (ej: 'starter_monthly' -> 'Starter Mensual')
   */
  getPlanName(planId) {
    return PLANS[resolvePlanKey(planId)].name;
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
   * @param {string} planId - Clave del plan (ej: 'starter_monthly')
   * @returns {object} pricing { planId, planName, currency, basePrice, branchCount, totalPrice, totalDiscount, hasMultiBranchDiscount }
   */
  getPlanPricing(restaurant, planId) {
    const planKey = resolvePlanKey(planId);
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
   * Obtiene el límite máximo de platos para un restaurante según su plan/suscripción.
   * - Trial: TRIAL_MAX_DISHES (50)
   * - Plan activo: plan.features.maxDishes
   * - Plan vencido/past_due: plan.features.maxDishes (no se reducen platos ya creados)
   * - Sin suscripción válida: TRIAL_MAX_DISHES
   * @param {object} restaurant
   * @returns {number}
   */
  getMaxDishes(restaurant) {
    if (!restaurant) return TRIAL_MAX_DISHES;
    const sub = restaurant.subscription;
    if (!sub || typeof sub !== 'object') return TRIAL_MAX_DISHES;
    
    // Trial activo (primeros 7 días)
    const now = Date.now();
    const trialEnds = sub.trialEndsAt ? new Date(sub.trialEndsAt).getTime() : 0;
    const inTrial = Number.isFinite(trialEnds) && now < trialEnds;
    if (inTrial) return TRIAL_MAX_DISHES;
    
    // Post-trial gracia (días 8-10): aún en trial para efectos de cuota
    const graceEnd = trialEnds + TRIAL_GRACE_DAYS * DAY_MS;
    if (now < graceEnd) return TRIAL_MAX_DISHES;
    
    // Plan activo o past_due: usa el límite del plan
    const planKey = resolvePlanKey(sub.plan);
    const plan = PLANS[planKey];
    return plan?.features?.maxDishes ?? TRIAL_MAX_DISHES;
  },

  /**
   * Verifica si un restaurante puede crear más platos (para validación en save/dish endpoints).
   * @param {object} restaurant
   * @param {number} newDishesCount - Cantidad de platos nuevos a agregar
   * @returns {object} { allowed: boolean, current: number, max: number, error?: string }
   */
  checkDishQuota(restaurant, newDishesCount = 0) {
    const current = Array.isArray(restaurant?.dishes) ? restaurant.dishes.length : 0;
    const max = this.getMaxDishes(restaurant);
    const wouldExceed = current + newDishesCount > max;
    return {
      allowed: !wouldExceed,
      current,
      max,
      error: wouldExceed ? `Límite de platos excedido (${current}/${max}). Actualizá tu plan para agregar más.` : undefined
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
    // Anti open-redirect: el returnUrl solo puede ser misma-app (relativo o
    // mismo origen que APP_URL). Hoy ninguna ruta lo manda (siempre default),
    // pero si se expone, un valor atacante redirigiría al dueño tras pagar.
    let successUrl = `${appUrl}/studio?billing=success`;
    if (typeof returnUrl === 'string' && returnUrl) {
      const clean = returnUrl.trim();
      if (clean.startsWith('/')) {
        successUrl = appUrl + clean;
      } else {
        try {
          const appOrigin = new URL(appUrl).origin;
          if (new URL(clean).origin === appOrigin) successUrl = clean;
        } catch { /* URL inválida → default */ }
      }
    }
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

    // 3. Idempotency check: Ignore duplicate events (local + Supabase, porque
    // en serverless el JSON local se pierde entre instancias/reinicios).
    if (await db.hasProcessedWebhookAsync(providerName, parsed.eventId)) {
      return { success: true, duplicate: true, eventId: parsed.eventId };
    }

    // 4. Update restaurant subscription in DB
    if (parsed.restaurantId && parsed.status && parsed.status !== 'pending') {
      const currentRest = db.findRestaurantById(parsed.restaurantId);
      const appliedTs = (currentRest && currentRest.subscription && currentRest.subscription.lastWebhookEventAt) || {};

      // 4.0 Guard de recency: un evento que llega FUERA DE ORDEN no debe
      //     revertir la suscripción a un estado obsoleto. Ej.: un
      //     `payment_failed` de hace 3 días entregado tarde, después de un
      //     `payment_success` más nuevo, NO puede mandar la suscripción a
      //     past_due. El proveedor recibe 200 (ack) pero el evento se ignora
      //     y queda en la auditoría como SUBSCRIPTION_EVENT_STALE.
      if (
        parsed.eventCreatedAt &&
        appliedTs[providerName] &&
        new Date(parsed.eventCreatedAt).getTime() <= new Date(appliedTs[providerName]).getTime()
      ) {
        auditService.logAction({
          tenantId: parsed.restaurantId,
          action: 'SUBSCRIPTION_EVENT_STALE',
          entity: 'subscription',
          details: {
            provider: providerName,
            eventName: parsed.eventName,
            eventId: parsed.eventId,
            eventCreatedAt: parsed.eventCreatedAt,
            lastAppliedAt: appliedTs[providerName]
          }
        });
        sentry.captureMessage('[Billing] Evento stale descartado: ' + providerName + ' ' + parsed.eventId, {
          level: 'info',
          tags: { restaurantId: parsed.restaurantId, provider: providerName, eventId: parsed.eventId }
        });
        return { success: true, stale: true, eventId: parsed.eventId };
      }
      const newTsMap = parsed.eventCreatedAt ? { ...appliedTs, [providerName]: parsed.eventCreatedAt } : appliedTs;

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
        lastPaymentError: parsed.status === 'past_due' ? 'Falló el cobro automático de la tarjeta' : null,
        // Recency: el timestamp del último evento APLICADO por proveedor.
        ...(Object.keys(newTsMap).length ? { lastWebhookEventAt: newTsMap } : {})
      };
      // Conserva el plan comprado (Lemon/Stripe lo infieren del webhook; MP del external_reference)
      if (parsed.plan && PLANS[parsed.plan]) subUpdate.plan = parsed.plan;

      await db.updateSubscription(parsed.restaurantId, subUpdate);

      auditService.logAction({
        tenantId: parsed.restaurantId,
        action: 'SUBSCRIPTION_STATUS_CHANGE',
        entity: 'subscription',
        details: {
          provider: providerName,
          eventName: parsed.eventName,
          eventId: parsed.eventId,
          from: currentRest && currentRest.subscription && currentRest.subscription.status,
          to: parsed.status
        }
      });

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
            const planName = PLANS[resolvePlanKey(parsed.plan)].name;
            emailService.sendPaymentReceiptEmail({
              to: user.email,
              userName: user.name,
              restaurantName: restaurant.name || restaurant.bizName,
              planName,
              renewsAt: parsed.renewsAt
            }).catch(e => console.warn('[Billing] Failed to send receipt email:', e.message));
            emailService.sendNewClientNotification({
              source: 'subscription',
              clientEmail: user.email,
              clientName: user.name,
              restaurantName: restaurant.name || restaurant.bizName,
              slug: restaurant.slug,
              planName,
              menuUrl: `${process.env.APP_URL || ''}/m/${restaurant.slug}`
            }).catch(e => console.warn('[Billing] Failed to send new-client notification:', e.message));
          }
        } catch (e) {
          console.warn('[Billing] Failed to send receipt email:', e.message);
        }
      }

      // Send payment failed email on past_due (single consolidated block)
      // Excepción refund: cuando el evento que causó past_due es un reembolso
      // procesado en la pasarela, "no pudimos cobrar" confundiria al cliente
      // (el dinero ya volvio a pedido del CLIENTE: reembolso, no fallo).
      const isRefundEvent = /refund/i.test(String(parsed.eventName || ''));
      if (parsed.status === 'past_due' && !isRefundEvent) {
        try {
          const restaurant = db.findRestaurantById(parsed.restaurantId);
          const user = restaurant ? db.findUserById(restaurant.userId) : null;
          if (user) {
            const planName = PLANS[resolvePlanKey(parsed.plan)].name;
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
    const planKey = resolvePlanKey(sub.plan);

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
        plan: sub.plan || 'starter_monthly',
        features: PLANS[resolvePlanKey(sub.plan)].features,
        pricing: this.getPlanPricing(rest, sub.plan),
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
          plan: sub.plan || 'starter_monthly',
          features: PLANS[resolvePlanKey(sub.plan)].features,
          pricing: this.getPlanPricing(rest, sub.plan),
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
        plan: sub.plan || 'starter_monthly',
        features: PLANS[resolvePlanKey(sub.plan)].features,
        pricing: this.getPlanPricing(rest, sub.plan),
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

module.exports = { ...billingOrchestrator, TRIAL_MAX_DISHES };
