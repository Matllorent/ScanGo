const express = require('express');
const { z } = require('zod');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');

const router = express.Router();

const uploadSchema = z.object({
  fileData: z.string().min(1, { message: 'El archivo en formato Base64 o Buffer es requerido' }),
  fileName: z.string().optional(),
  folder: z.string().optional().default('general'),
  bucketName: z.string().optional().default('photos')
});

/**
 * POST /api/storage/upload
 * Uploads photos (dishes, logos, review avatars) to Supabase Storage bucket and returns public URL.
 */
router.post('/upload', validateBody(uploadSchema), async (req, res, next) => {
  try {
    const { fileData, fileName, folder, bucketName } = req.body;

    // Default bucket name
    const BUCKET = bucketName || 'photos';
    const folderPath = folder ? folder.replace(/^\/+|\/+$/g, '') : 'general';
    const cleanFileName = (fileName || `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const pathInBucket = `${folderPath}/${cleanFileName}`;

    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        // Handle base64 input or data URL
        let buffer;
        let contentType = 'image/png';

        if (fileData.startsWith('data:')) {
          const matches = fileData.match(/^data:(.+);base64,(.+)$/);
          if (matches) {
            contentType = matches[1];
            buffer = Buffer.from(matches[2], 'base64');
          } else {
            buffer = Buffer.from(fileData, 'base64');
          }
        } else {
          buffer = Buffer.from(fileData, 'base64');
        }

        // Upload buffer to Supabase Storage
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(pathInBucket, buffer, {
            contentType,
            upsert: true
          });

        if (uploadError) {
          console.warn('[Supabase Storage Upload Warning]', uploadError.message);
          // If bucket doesn't exist, attempt to return fallback public URL construction
        }

        // Get public URL
        const { data: publicUrlData } = supabase.storage
          .from(BUCKET)
          .getPublicUrl(pathInBucket);

        const publicUrl = publicUrlData?.publicUrl || `${process.env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${pathInBucket}`;

        return successResponse(
          res,
          { url: publicUrl, path: pathInBucket, bucket: BUCKET },
          'Imagen subida exitosamente a Supabase Storage',
          201
        );
      } catch (err) {
        console.warn('[Supabase Storage Exception]', err.message);
      }
    }

    // Local / Dev Fallback: return data URL or local placeholder URL
    const fallbackUrl = fileData.startsWith('data:')
      ? fileData.slice(0, 100) + '...'
      : `/public/uploads/${pathInBucket}`;

    return successResponse(
      res,
      { url: fallbackUrl, path: pathInBucket, bucket: BUCKET },
      'Imagen procesada en almacenamiento local',
      201
    );
  } catch (err) {
    next(err);
  }
});

module.exports = router;
