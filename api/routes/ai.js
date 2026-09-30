/**
 * api/routes/ai.js
 * Endpoints for AI-powered menu parsing and automation
 */

const express = require('express');
const { z } = require('zod');
const { parseMenuWithGemini } = require('../services/geminiMenuParser');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

const parseMenuSchema = z.object({
  images: z.array(
    z.union([
      z.string().min(10, { message: 'Imagen Base64 requerida' }),
      z.object({
        data: z.string().min(10, { message: 'Datos Base64 requeridos' }),
        mimeType: z.string().optional()
      })
    ])
  ).min(1, { message: 'Debes enviar al menos una imagen de la carta' })
   .max(10, { message: 'Máximo 10 páginas por análisis' })
});

/**
 * POST /api/ai/parse-menu
 * Multimodal physical menu parser using Gemini Flash
 */
router.post('/parse-menu', validateBody(parseMenuSchema), async (req, res, next) => {
  try {
    const { images } = req.body;
    const result = await parseMenuWithGemini(images);
    return successResponse(res, result, 'Menú físico analizado exitosamente con Gemini Flash');
  } catch (err) {
    console.error('[AI-PARSE-MENU-ROUTE-ERROR]', err);
    return errorResponse(res, err.message || 'Error al procesar la carta con IA', 500, null, 'AI_PROCESSING_ERROR');
  }
});

module.exports = router;
