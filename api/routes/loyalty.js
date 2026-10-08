const express = require('express');
const { z } = require('zod');
const loyaltyService = require('../services/loyalty');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { tenantGuard } = require('../middleware/tenantGuard');
const { loyaltyLimiter } = require('../middleware/rateLimits');

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
 * POST /api/loyalty/redeem
 * Público: canjea un premio local (por restaurante) o global (glob_*) y emite
 * un código de un solo uso que el dueño valida en Studio.
 */
router.post('/redeem', loyaltyLimiter, validateBody(redeemSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.redeemReward(req.validatedBody);
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
router.post('/credit', authMiddleware, tenantGuard, loyaltyLimiter, validateBody(creditSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.manualCredit({
      restaurantId: req.tenantId,
      phone: req.validatedBody.phone,
      points: req.validatedBody.points,
      reason: req.validatedBody.reason
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

/**
 * DELETE /api/loyalty/me
 * Derecho al olvido (RGPD / Ley 18.331 UY): borra TODA la data del cliente
 * (perfil, cuentas, ledger y códigos emitidos).
 */
router.delete('/me', loyaltyLimiter, validateBody(phoneSchema), async (req, res, next) => {
  try {
    const result = await loyaltyService.eraseCustomerData(req.validatedBody.phone);
    if (!result.erased) {
      return successResponse(res, result, 'No había datos para borrar', 200);
    }
    return successResponse(res, result, 'Datos del cliente eliminados por completo');
  } catch (err) {
    next(err);
  }
});

module.exports = router;