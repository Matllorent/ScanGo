const express = require('express');
const { z } = require('zod');
const fs = require('fs');
const path = require('path');
const AppError = require('../utils/AppError');
const loyaltyService = require('../services/loyalty');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { loyaltyLimiter } = require('../middleware/rateLimits');
const { requireActiveSubscription } = require('../middleware/subscriptionGuard');
const { verifyCronAuth } = require('../middleware/cronAuth');
const auditService = require('../services/audit');
const { computeChurnCandidates } = require('../utils/churnRecovery');
const recoveryCoupons = require('../utils/recoveryCoupons');
const emailService = require('../services/email');
const notificationsService = require('../services/notifications');
const db = require('../../src/db/db');

const router = express.Router();

const phoneSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  restaurantId: z.string().optional()
});

const redeemSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  restaurantId: z.string().optional(),
  rewardId: z.string().min(1, { message: 'Premio requerido' }).max(60)
});

const challengeSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  purpose: z.enum(['redeem', 'erase', 'change-email'], { message: 'Propósito inválido' })
});

const redeemConfirmSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  restaurantId: z.string().optional(),
  rewardId: z.string().min(1, { message: 'Premio requerido' }).max(60),
  otp: z.string().min(6, { message: 'Código requerido' }).max(10)
});

const customerEmailSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  email: z.string().min(5, { message: 'Email inválido' }).max(100),
  otp: z.string().min(6).max(10).optional()
});

const eraseSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  restaurantId: z.string().optional(),
  otp: z.string().min(6, { message: 'Código requerido' }).max(10).optional()
});

const validateSchema = z.object({
  code: z.string().min(4, { message: 'Código inválido' }).max(30)
});

const creditSchema = z.object({
  phone: z.string().min(7, { message: 'Teléfono inválido' }).max(20),
  points: z.number().int().positive({ message: 'Puntos inválidos' }).max(100000),
  reason: z.string().max(200).optional().default('Ajuste manual')
});

/**
 * POST /api/loyalty/me
 * Público: tarjeta del comensal (identidad por teléfono normalizado).
 * Devuelve cuenta del local actual + estado global de la red + catálogo.
 */
router.post('/me', loyaltyLimiter, validateBody(phoneSchema), async (req, res, next) => {
  try {
    const card = await loyaltyService.getCustomerCard({
      phone: req.validatedBody.phone,
      restaurantId: req.validatedBody.restaurantId
    });
    if (!card) {
      // Cliente nuevo: devolvemos el shape vacío para que el frontend lo hidrate.
      return successResponse(res, { customer: null }, 'Cliente no registrado todavía', 200);
    }
    return successResponse(res, card, 'Tarjeta de fidelización');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/challenge
 * Emite un OTP al email del perfil para probar posesión antes de acciones
 * destructivas (canje, borrado, cambio de email). 202 + email enmascarado.
 */
router.post('/challenge', loyaltyLimiter, validateBody(challengeSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.requestLoyaltyOtp(req.validatedBody);
    return successResponse(res, result, 'Código enviado a tu email', 202);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/email
 * Registra el email del perfil (first-write; cambiarlo exige OTP al anterior).
 */
router.post('/email', loyaltyLimiter, validateBody(customerEmailSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.setCustomerEmail(req.validatedBody);
    return successResponse(res, result, 'Email registrado correctamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/redeem
 * Compatibilidad: canje directo SOLO si el perfil aún no tiene email
 * (flujo legacy). Con email registrado exige OTP (403 → usar /redeem/confirm).
 */
router.post('/redeem', loyaltyLimiter, validateBody(redeemSchema), async (req, res, next) => {
  try {
    const customer = await loyaltyService.findCustomerByPhone(req.validatedBody.phone);
    if (customer && customer.email) {
      throw new AppError(
        'Este canje requiere confirmación por email',
        403,
        'REDEEM_OTP_REQUIRED',
        { maskedEmail: loyaltyService.maskEmail(customer.email) }
      );
    }
    const result = await loyaltyService.redeemReward(req.validatedBody);
    return successResponse(res, result, 'Canje emitido correctamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/redeem/confirm
 * Canje con OTP verificado (prueba de posesión del email del perfil).
 */
router.post('/redeem/confirm', loyaltyLimiter, validateBody(redeemConfirmSchema), async (req, res, next) => {
  try {
    const { phone, otp, ...redeemBody } = req.validatedBody;
    if (!loyaltyService.verifyLoyaltyOtp(phone, 'redeem', otp)) {
      throw new AppError('Código incorrecto o vencido. Pedí uno nuevo.', 403, 'INVALID_OTP');
    }
    const result = await loyaltyService.redeemReward({ phone, ...redeemBody });
    return successResponse(res, result, 'Canje emitido correctamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/validate
 * Dueño: valida un código de canje en su local (IDOR protegido por tenantGuard).
 */
router.post('/validate', authMiddleware, tenantGuard, loyaltyLimiter, validateBody(validateSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.validateRedemptionCode({
      code: req.validatedBody.code,
      ownerRestaurantId: req.tenantId || null
    });
    // Auditoría (fire-and-forget): qué código se canjeó en qué local.
    // El código ya es de un solo uso y quedó spent: loguearlo es el rastro.
    auditService.logAction({
      tenantId: req.tenantId,
      userId: req.user && req.user.userId,
      requestId: req.requestId,
      action: 'LOYALTY_REDEEM_VALIDATED',
      entity: 'loyalty',
      details: {
        code: req.validatedBody.code,
        rewardTitle: result.rewardTitle,
        pointsCost: result.pointsCost,
        redeemedAt: result.redeemedAt
      }
    });
    return successResponse(res, result, 'Código validado y marcado como canjeado');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/credit
 * Dueño: acreditación manual de puntos (visitas in-person que no pasaron por
 * el flujo web). Suma también al saldo global de la red.
 */
router.post('/credit', authMiddleware, tenantGuard, requireActiveSubscription, loyaltyLimiter, validateBody(creditSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.manualCredit({
      restaurantId: req.tenantId,
      phone: req.validatedBody.phone,
      points: req.validatedBody.points,
      reason: req.validatedBody.reason
    });
    // Auditoría (fire-and-forget): crédito manual con teléfono enmascarado.
    auditService.logAction({
      tenantId: req.tenantId,
      userId: req.user && req.user.userId,
      requestId: req.requestId,
      action: 'LOYALTY_CREDIT',
      entity: 'loyalty',
      details: {
        phone: loyaltyService.maskPhone(req.validatedBody.phone),
        points: req.validatedBody.points,
        reason: req.validatedBody.reason
      }
    });
    return successResponse(res, result, 'Puntos acreditados manualmente');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/loyalty/customers
 * Dueño: clientes del local con saldo (teléfonos enmascarados, privacy-first).
 */
router.get('/customers', authMiddleware, tenantGuard, async (req, res, next) => {
  try {
    const customers = await loyaltyService.listRestaurantCustomers(req.tenantId);
    return successResponse(res, customers, 'Clientes del local');
  } catch (err) {
    next(err);
  }
});

const reactivationSchema = z.object({
  customerId: z.string().min(4, { message: 'Cliente requerido' }).max(64),
  message: z.string().max(400, { message: 'Mensaje demasiado largo' }).trim().optional(),
  promoCode: z.string().max(30, { message: 'Cupón demasiado largo' }).trim().optional()
});

/**
 * GET /api/loyalty/churn
 * Dueño: lista de clientes en riesgo de no volver (R1). La cuenta la arma el
 * módulo puro churnRecovery desde las cuentas REALES de fidelización del local
 * (ausencia contra su propia frecuencia); teléfonos enmascarados y email solo
 * como dominio, privacy-first como /customers.
 */
router.get('/churn', authMiddleware, tenantGuard, async (req, res, next) => {
  try {
    const report = await loyaltyService.listChurnCandidates(req.tenantId, {
      daysSinceLastVisit: req.query.days,
      minVisits: req.query.minVisits
    });
    return successResponse(res, report, 'Clientes en riesgo de no volver');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/loyalty/reactivation
 * Dueño: envía el email de recupero a UN cliente a la vez (data propia, cero
 * listas compradas). Honesto en cada caso: sin email del perfil → 422;
 * opt-out de marketing o baja de email → 409 (el email NO salió, avisarlo
 * para que el dueño no insista). Auditoría REACTIVATION_SENT con teléfono
 * enmascarado (nunca el crudo, igual que LOYALTY_CREDIT).
 */
router.post('/reactivation', authMiddleware, tenantGuard, requireActiveSubscription, loyaltyLimiter, validateBody(reactivationSchema), async (req, res, next) => {
  try {
    const target = loyaltyService.findReactivationTarget(req.tenantId, req.validatedBody.customerId);
    if (!target) {
      throw new AppError('El cliente no pertenece a este local', 404, 'CUSTOMER_NOT_FOUND');
    }
    const email = target.customer && typeof target.customer.email === 'string' ? target.customer.email.trim() : '';
    if (!email) {
      throw new AppError('El cliente todavía no registró un email en su tarjeta ScanGo', 422, 'NO_CUSTOMER_EMAIL');
    }
    if (target.customer.consentMarketing === false) {
      throw new AppError('El cliente no dio consentimiento de marketing. Solo avisos operativos.', 409, 'MARKETING_CONSENT_MISSING');
    }
    if (emailService.isOptedOut(email)) {
      throw new AppError('Este cliente pidió la baja de emails. No puede recibir campañas.', 409, 'CUSTOMER_OPTED_OUT');
    }

    const restaurant = db.findRestaurantById(req.tenantId);
    const restaurantName = (restaurant && restaurant.name) || 'Tu local favorito';
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const menuSlug = restaurant && restaurant.slug;
    const menuUrl = menuSlug ? `${appUrl}/m/${menuSlug}` : appUrl;
    const points = Math.max(0, Math.floor(Number(target.account && target.account.points)) || 0);
    const personalMessage = req.validatedBody.message
      ? `\n\n${req.validatedBody.message}`
      : '';
    const body = [
      `¡Te extrañamos, ${target.customer.name || 'amigo'}! Tenés ${points} puntitos esperando en tu tarjeta del Club.`,
      personalMessage.trim(),
      'Te dejamos el link de la carta para que pidas por WhatsApp cuando quieras:'
    ].filter(Boolean).join('\n\n');

    const result = await emailService.sendPromotionalEmail({
      to: email,
      subject: `¡Te extrañamos en ${restaurantName}!`,
      body,
      restaurantName,
      promoCode: req.validatedBody.promoCode,
      promoLink: menuUrl
    });

    auditService.logAction({
      tenantId: req.tenantId,
      userId: req.user && req.user.userId,
      requestId: req.requestId,
      action: 'REACTIVATION_SENT',
      entity: 'loyalty',
      details: {
        phone: loyaltyService.maskPhone(target.customer.phone),
        provider: result && result.provider,
        skipped: Boolean(result && result.skipped)
      }
    });

    return successResponse(res, { sent: true, emailMasked: emailService.maskEmail(email), provider: result.provider }, 'Email de recupero enviado');
  } catch (err) {
    next(err);
  }
});


const winbackCampaignSchema = z.object({
  offerType: z.enum(['percent_10', 'percent_15', 'free_delivery'], { message: 'Oferta inválida' }),
  daysSinceLastVisit: z.number().int().min(7).max(365).optional().default(45),
  minVisits: z.number().int().min(1).max(10).optional().default(2),
  customMessage: z.string().max(500, { message: 'Mensaje demasiado largo' }).trim().optional()
});

/**
 * POST /api/loyalty/winback
 * Dueño: lanza una campaña de recupero AUTOMATIZADA (F8).
 * - Detecta candidatos de churn con umbrales configurables
 * - Filtra SOLO los que tienen consentMarketing: true + email
 * - Genera cupones de uso único VOL-XXXXXXXX atados al teléfono (boundPhone)
 * - Dispara emails en lote (respetando opt-outs) con plantilla pre-diseñada
 * - Devuelve reporte: { sent, blockedConsent, blockedNoEmail, blockedOptOut, errors[] }
 * Zero-touch: el dueño solo elige la oferta (10%/15%/Envío Gratis) y lanza.
 */
router.post('/winback', authMiddleware, tenantGuard, requireActiveSubscription, loyaltyLimiter, validateBody(winbackCampaignSchema), async (req, res, next) => {
  try {
    const { offerType, daysSinceLastVisit, minVisits, customMessage } = req.validatedBody;
    const restaurantId = req.tenantId;

    // 1) Detectar candidatos de churn
    const report = await loyaltyService.listChurnCandidates(restaurantId, {
      daysSinceLastVisit,
      minVisits,
      nowMs: Date.now()
    });
    const candidates = report.candidates || [];

    // 2) Mapear oferta a parámetros de cupón
    const offerMap = {
      percent_10: { discountType: 'percent', discountValue: 10, label: '10% OFF' },
      percent_15: { discountType: 'percent', discountValue: 15, label: '15% OFF' },
      free_delivery: { discountType: 'free_delivery', discountValue: 0, label: 'Envío Gratis' }
    };
    const offer = offerMap[offerType];

    // 3) Preparar envío en lote
    const nowMs = Date.now();
    const restaurant = db.findRestaurantById(restaurantId);
    const restaurantName = (restaurant && restaurant.name) || 'Tu local favorito';
    const appUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const menuSlug = restaurant && restaurant.slug;
    const menuUrl = menuSlug ? `${appUrl}/m/${menuSlug}` : appUrl;

    let sent = 0;
    let blockedConsent = 0;
    let blockedNoEmail = 0;
    let blockedOptOut = 0;
    let pushed = 0;
    const recipients = [];
    const errors = [];

    for (const candidate of candidates) {
      // Obtener datos completos del cliente (email, teléfono real, consentimiento)
      const target = loyaltyService.findReactivationTarget(restaurantId, candidate.customerId);
      if (!target || !target.customer) {
        errors.push({ customerId: candidate.customerId, reason: 'CUSTOMER_NOT_FOUND' });
        continue;
      }
      const customer = target.customer;

      // Verificar email
      const email = customer.email ? customer.email.trim() : '';
      if (!email) {
        blockedNoEmail++;
        continue;
      }

      // Verificar consentimiento de marketing
      if (customer.consentMarketing === false) {
        blockedConsent++;
        continue;
      }

      // Verificar opt-out global
      if (emailService.isOptedOut(email)) {
        blockedOptOut++;
        continue;
      }

      // Generar cupón único atado al teléfono del cliente
      const coupon = await loyaltyService.createWinbackCoupon({
        restaurantId,
        discountType: offer.discountType,
        discountValue: offer.discountValue,
        nowMs,
        ttlDays: 14,
        randomSource: Math.random,
        boundPhone: customer.phone // E.164 normalizado
      });

      if (!coupon) {
        errors.push({ customerId: customer.customerId, reason: 'COUPON_GENERATION_FAILED' });
        continue;
      }

      // Push al cliente del Club (F8-v2): el cupón también llega a la app
      // instalada. Dirigido por teléfono + consentimiento (nunca a todos);
      // sin VAPID o sin suscripciones se saltea sin romper la campaña.
      let pushedToCustomer = false;
      try {
        const push = await notificationsService.sendWinbackCouponNotification({
          restaurantId,
          customerPhone: customer.phone,
          couponCode: coupon.code,
          offerLabel: offer.label,
          slug: menuSlug,
          restaurantName
        });
        pushedToCustomer = Boolean(push && Number(push.delivered) > 0);
        if (pushedToCustomer) pushed++;
      } catch (pushErr) {
        errors.push({ customerId: candidate.customerId, reason: 'PUSH_FAILED', detail: pushErr.message });
      }

      // Enviar email con plantilla winback
      const personalMessage = customMessage
        ? `\n\n${customMessage}`
        : '\n\nTe esperamos con este beneficio exclusivo para que vuelvas a disfrutar.';
      
      const body = [
        `¡Te extrañamos, ${customer.name || 'amigo'}!`,
        `Tenés ${customer.points || 0} puntitos esperando en tu tarjeta del Club.`,
        personalMessage,
        `Tu cupón: <strong>${coupon.code}</strong> (${offer.label})`,
        'Es de un solo uso, atado a tu teléfono y vence en 14 días.',
        `Pedí acá: <a href="${menuUrl}">${menuUrl}</a>`
      ].filter(Boolean).join('<br><br>');

      let emailSent = false;
      try {
        const result = await emailService.sendPromotionalEmail({
          to: email,
          subject: `¡Te extrañamos en ${restaurantName}! Tu cupón: ${coupon.code}`,
          body,
          restaurantName,
          promoCode: coupon.code,
          promoLink: menuUrl
        });

        // Auditoría
        await auditService.logAction({
          tenantId: restaurantId,
          userId: req.user && req.user.userId,
          requestId: req.requestId,
          action: 'WINBACK_SENT',
          entity: 'loyalty',
          details: {
            phone: loyaltyService.maskPhone(customer.phone),
            couponCode: coupon.code,
            offerType,
            provider: result && result.provider
          }
        });

        sent++;
        emailSent = true;
      } catch (emailErr) {
        errors.push({ customerId: customer.customerId, reason: 'EMAIL_SEND_FAILED', detail: emailErr.message });
      }

      // F8-v2: cada cliente con cupón queda en el reporte con un link de
      // WhatsApp listo para usar. Es el fallback operativo cuando el email no
      // salió (rebotó, no hay proveedor) y el canal natural del Club.
      // Privacidad: la UI muestra SOLO `phoneMasked`; el número completo vive
      // únicamente dentro de `waLink` (excepción operativa documentada, sin
      // exponerlo como campo separado ni en logs/auditoría).
      const waDigits = String(customer.phone || '').replace(/\D/g, '');
      const waMessage = [
        `¡Hola${customer.name ? ' ' + customer.name : ''}! Te esperamos en ${restaurantName}.`,
        `Tu cupón ${coupon.code} (${offer.label}) es de un solo uso y vence en 14 días.`,
        `Pedí acá: ${menuUrl}`
      ].join(' ');
      recipients.push({
        phoneMasked: loyaltyService.maskPhone(customer.phone),
        couponCode: coupon.code,
        couponLabel: offer.label,
        channels: { email: emailSent, push: pushedToCustomer },
        waLink: waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(waMessage)}` : null
      });
    }

    return successResponse(res, {
      sent,
      blockedConsent,
      blockedNoEmail,
      blockedOptOut,
      pushed,
      recipients,
      totalCandidates: candidates.length,
      errors: errors.length ? errors : undefined
    }, `Campaña de recupero completada: ${sent} enviados, ${pushed} con push, ${blockedConsent} sin consentimiento, ${blockedNoEmail} sin email, ${blockedOptOut} con opt-out`);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/loyalty/winback/coupons
 * Dueño: el ledger de cupones de recupero con privacidad. Nunca devuelve el
 * teléfono crudo (solo `phoneMasked`), ni `boundPhone`, ni `usedByPhone`.
 * `status` es derivado (live|used|expired) para que la UI no recalcule fechas.
 */
router.get('/winback/coupons', authMiddleware, tenantGuard, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurantId = req.tenantId;
    const rows = await loyaltyService.listRecoveryCoupons(restaurantId);
    const nowMs = Date.now();
    const summary = recoveryCoupons.summarizeRecoveryCoupons(rows, { nowMs });
    const coupons = rows.slice(0, 200).map((row) => {
      const shape = recoveryCoupons.toCatalogShape(row) || { code: '', type: 'percent', value: 0, label: '' };
      const status = row.usedAt ? 'used' : (Date.parse(row.expiresAt) > nowMs ? 'live' : 'expired');
      return {
        code: shape.code,
        label: shape.label,
        type: shape.type,
        value: shape.value,
        createdAt: row.createdAt || null,
        expiresAt: row.expiresAt || null,
        usedAt: row.usedAt || null,
        status,
        phoneMasked: loyaltyService.maskPhone(row.usedByPhone || row.boundPhone || ''),
        usedOrderId: row.usedOrderId || null
      };
    });
    return successResponse(res, { summary, coupons }, 'Cupones de recupero');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/loyalty/winback/telemetry
 * Dueño: ¿el circuito de recupero funciona? Emitidos / usados / vivos /
 * vencidos, clientes recuperados y plata atribuida por los pedidos REALES de
 * los cupones canjeados (ventana 30 días, cohorte por emisión).
 */
router.get('/winback/telemetry', authMiddleware, tenantGuard, requireActiveSubscription, async (req, res, next) => {
  try {
    const restaurantId = req.tenantId;
    const days = Number(req.query.days);
    const rows = await loyaltyService.listRecoveryCoupons(restaurantId);
    // Solo hace falta el pedido de cada cupón usado: no se escanea el archivo
    // entero de órdenes para una métrica del panel.
    const usedOrderIds = new Set(rows.filter(r => r && r.usedOrderId).map(r => r.usedOrderId));
    let orders = [];
    try {
      orders = db.getOrders().filter(o => o && usedOrderIds.has(o.id));
    } catch (e) {
      orders = []; // sin espejo legible: 0 plata atribuida, nunca inventada
    }
    const telemetry = recoveryCoupons.computeWinbackTelemetry(rows, {
      orders,
      nowMs: Date.now(),
      windowDays: Number.isFinite(days) && days > 0 ? Math.min(365, days) : 30,
      restaurantId
    });
    return successResponse(res, telemetry, 'Telemetría de recupero');
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/loyalty/me
 * Derecho al olvido (RGPD / Ley 18.331 UY): borra TODA la data del cliente
 * (perfil, cuentas, ledger y códigos emitidos).
 * Con email registrado exige OTP (evita borrado remoto por un tercero que
 * conoce el teléfono); sin email mantiene el flujo directo legacy.
 */
router.delete('/me', loyaltyLimiter, validateBody(eraseSchema), async (req, res, next) => {
  try {
    const { phone, otp } = req.validatedBody;
    const customer = await loyaltyService.findCustomerByPhone(phone);
    if (customer && customer.email && !loyaltyService.verifyLoyaltyOtp(phone, 'erase', otp)) {
      throw new AppError(
        'Para borrar tus datos confirmá el código enviado a tu email',
        403,
        'ERASE_OTP_REQUIRED',
        { maskedEmail: loyaltyService.maskEmail(customer.email) }
      );
    }
    const result = await loyaltyService.eraseCustomerData(phone);
    if (!result.erased) {
      return successResponse(res, result, 'No había datos para borrar', 200);
    }
    return successResponse(res, result, 'Datos del cliente eliminados por completo');
  } catch (err) {
    next(err);
  }
});

module.exports = router;