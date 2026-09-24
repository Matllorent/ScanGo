const express = require('express');
const { z } = require('zod');
const emailService = require('../services/email');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

const welcomeEmailSchema = z.object({
  to: z.string().email({ message: 'Email inválido' }),
  restaurantName: z.string().min(1),
  menuUrl: z.string().optional().default('/'),
  studioUrl: z.string().optional().default('/studio')
});

const verificationEmailSchema = z.object({
  to: z.string().email({ message: 'Email inválido' }),
  verificationLink: z.string().url({ message: 'Enlace de verificación inválido' })
});

const promotionalEmailSchema = z.object({
  to: z.union([z.string().email(), z.array(z.string().email())]),
  subject: z.string().min(1, { message: 'Asunto requerido' }),
  body: z.string().min(1, { message: 'Cuerpo del mensaje requerido' }),
  restaurantName: z.string().optional(),
  promoCode: z.string().optional(),
  promoLink: z.string().optional()
});

/**
 * POST /api/email/welcome
 * Send welcome email
 */
router.post('/welcome', validateBody(welcomeEmailSchema), async (req, res, next) => {
  try {
    const { to, restaurantName, menuUrl, studioUrl } = req.body;
    const result = await emailService.sendWelcomeEmail({ to, restaurantName, menuUrl, studioUrl });
    return successResponse(res, result, 'Correo de bienvenida enviado exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/email/verification
 * Send verification email link
 */
router.post('/verification', validateBody(verificationEmailSchema), async (req, res, next) => {
  try {
    const { to, verificationLink } = req.body;
    const result = await emailService.sendVerificationEmail({ to, verificationLink });
    return successResponse(res, result, 'Correo de verificación enviado exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/email/promotions
 * Send promotional email campaign
 */
router.post('/promotions', validateBody(promotionalEmailSchema), async (req, res, next) => {
  try {
    const { to, subject, body, restaurantName, promoCode, promoLink } = req.body;
    const result = await emailService.sendPromotionalEmail({
      to,
      subject,
      body,
      restaurantName,
      promoCode,
      promoLink
    });
    return successResponse(res, result, 'Campaña de correo promocional enviada exitosamente');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
