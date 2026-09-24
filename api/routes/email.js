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
 * GET /api/email/test-email (or GET /api/test-email)
 * Sends a real test email to mat2001llorent@gmail.com via Resend
 */
router.get('/test-email', async (req, res, next) => {
  try {
    const targetEmail = req.query.to || 'mat2001llorent@gmail.com';
    const result = await emailService.sendEmail({
      to: targetEmail,
      subject: '🧪 Prueba de Correo Real con Resend — Menú Pizarrón SaaS',
      html: `
        <div style="font-family: sans-serif; padding: 24px; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; background: #ffffff;">
          <h2 style="color: #10b981; margin-top: 0;">🚀 Confirmación de Integración de Resend</h2>
          <p>Este es un correo electrónico de prueba enviado exitosamente desde el backend de <strong>Menú Pizarrón SaaS</strong> utilizando la API Key de Resend.</p>
          <div style="background: #f8fafc; padding: 16px; border-left: 4px solid #10b981; border-radius: 4px; margin: 20px 0;">
            <p style="margin: 0; font-size: 14px; color: #334155;"><strong>Destinatario:</strong> ${targetEmail}</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #334155;"><strong>Remitente:</strong> onboarding@resend.dev</p>
            <p style="margin: 4px 0 0 0; font-size: 14px; color: #334155;"><strong>Fecha:</strong> ${new Date().toISOString()}</p>
          </div>
          <p style="font-size: 13px; color: #64748b; margin-bottom: 0;">Integración 100% activa y lista para producción.</p>
        </div>
      `
    });

    return successResponse(res, result, `Correo de prueba enviado a ${targetEmail} mediante Resend`);
  } catch (err) {
    next(err);
  }
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
