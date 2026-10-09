const express = require('express');
const { z } = require('zod');
const storageService = require('../services/storage');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { storageLimiter } = require('../middleware/rateLimits');

const router = express.Router();

const uploadSchema = z.object({
  // Tope pre-decodificación: el string Base64 ya está en memoria al validar.
  fileData: z.string().min(1, { message: 'El contenido del archivo (Base64) es requerido' }).max(7000000, { message: 'Archivo demasiado grande' }),
  mimeType: z.string().optional(),
  fileName: z.string().optional(),
  folder: z.enum(['dishes', 'logos', 'reviews', 'general']).optional().default('general'),
  bucket: z.literal('photos').optional().default('photos')
});

/**
 * POST /api/storage/upload
 * Route for uploading dish, logo, and review images with strict size & MIME type validation
 */
router.post('/upload', authMiddleware, storageLimiter, validateBody(uploadSchema), async (req, res, next) => {
  try {
    const { fileData, mimeType, fileName, folder, bucket } = req.body;

    const result = await storageService.uploadImage({
      fileData,
      mimeType,
      fileName,
      folder,
      bucket,
      tenantId: req.user.userId
    });

    return successResponse(res, result, 'Imagen subida exitosamente', 201);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
