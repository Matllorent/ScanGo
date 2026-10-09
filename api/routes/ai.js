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
const { authMiddleware } = require('../middleware/auth');

const parseMenuSchema = z.object({
  // Tope por imagen (~3.7MB decodificados): 10 imágenes entran en el body de
  // 25mb sin que una sola acapare la memoria antes de llegar a Gemini.
  images: z.array(
    z.union([
      z.string().min(10, { message: 'Imagen Base64 requerida' }).max(5000000, { message: 'Imagen demasiado grande' }),
      z.object({
        data: z.string().min(10, { message: 'Datos Base64 requeridos' }).max(5000000, { message: 'Imagen demasiado grande' }),
        mimeType: z.string().optional()
      })
    ])
  ).min(1, { message: 'Debes enviar al menos una imagen de la carta' })
   .max(10, { message: 'Máximo 10 páginas por análisis' })
});

/**
 * POST /api/ai/parse-menu
 * Multimodal physical menu parser using Gemini Flash.
 * Requiere sesión: sin auth, anónimos quemarían la cuota de Gemini.
 */
router.post('/parse-menu', authMiddleware, validateBody(parseMenuSchema), async (req, res, next) => {
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
