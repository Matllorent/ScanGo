const express = require('express');
const { z } = require('zod');
const storageService = require('../services/storage');
const { successResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const { authMiddleware } = require('../middleware/auth');
const { storageLimiter } = require('../middleware/rateLimits');
const db = require('../../src/db/db');

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

const videoUploadSchema = z.object({
  fileName: z.string().min(1).max(120).optional(),
  mimeType: z.enum(['video/mp4', 'video/webm'], { message: 'Solo video/mp4 o video/webm' }),
  // Tope pre-vuelo: el archivo nunca llega al servidor (subida directa).
  sizeBytes: z.number().int().positive().max(52428800, { message: 'Máximo 50 MB por video' })
});

/**
 * POST /api/storage/video-upload-url
 * Emite una URL firmada para subir un video de plato DIRECTO a Storage (los
 * bytes nunca tocan este servidor). Cupo de producto: MAX_VIDEOS_PER_RESTAURANT
 * videos por carta (alojados o linkeados) para no fundir la transferencia.
 */
router.post('/video-upload-url', authMiddleware, storageLimiter, validateBody(videoUploadSchema), async (req, res, next) => {
  try {
    const { fileName, mimeType, sizeBytes } = req.body;
    const restaurant = db.findRestaurantByUserId(req.user.userId);
    if (!restaurant) {
      return res.status(404).json({ success: false, error: 'Restaurante no encontrado', code: 'RESTAURANT_NOT_FOUND' });
    }
    const withVideo = (restaurant.dishes || []).filter(d => d && d.videoUrl).length;
    if (withVideo >= storageService.MAX_VIDEOS_PER_RESTAURANT) {
      return res.status(403).json({
        success: false,
        error: `Límite de ${storageService.MAX_VIDEOS_PER_RESTAURANT} videos por carta alcanzado. Quitá el video de un plato para subir otro.`,
        code: 'VIDEO_LIMIT_EXCEEDED'
      });
    }
    const result = await storageService.createVideoUploadUrl({
      fileName,
      mimeType,
      sizeBytes,
      tenantId: req.user.userId
    });
    return successResponse(res, { ...result, videosUsed: withVideo, videosMax: storageService.MAX_VIDEOS_PER_RESTAURANT }, 'URL de subida generada', 201);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
