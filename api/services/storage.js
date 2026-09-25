const path = require('path');
const fs = require('fs');
const { getSupabaseClient } = require('../utils/supabase');
const AppError = require('../utils/AppError');

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Resolve public uploads directory
let PUBLIC_DIR = path.resolve(__dirname, '..', '..', 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(process.cwd(), 'public');
}
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
}

/**
 * Storage Service for managing uploads to Supabase Storage Bucket
 */
const storageService = {
  /**
   * Upload an image file buffer to Supabase Storage
   * @param {object} options
   * @param {Buffer|string} options.fileData - Base64 string or Buffer
   * @param {string} [options.mimeType] - MIME type
   * @param {string} [options.folder='general'] - Storage subfolder ('dishes', 'logos', 'reviews')
   * @param {string} [options.fileName] - Custom file name
   * @param {string} [options.bucket='photos'] - Bucket name
   * @returns {Promise<{ url: string, path: string, bucket: string }>}
   */
  async uploadImage({ fileData, mimeType, folder = 'general', fileName, bucket = 'photos' }) {
    let buffer;
    let detectedMimeType = mimeType || 'image/png';

    if (typeof fileData === 'string') {
      if (fileData.startsWith('data:')) {
        const matches = fileData.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (matches) {
          detectedMimeType = matches[1];
          buffer = Buffer.from(matches[2], 'base64');
        } else {
          buffer = Buffer.from(fileData, 'base64');
        }
      } else {
        buffer = Buffer.from(fileData, 'base64');
      }
    } else if (Buffer.isBuffer(fileData)) {
      buffer = fileData;
    } else {
      throw new AppError('Formato de archivo no soportado. Se requiere Buffer o string Base64.', 400, 'INVALID_FILE_FORMAT');
    }

    // Validate size limit (max 5 MB)
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      const sizeMb = (buffer.length / (1024 * 1024)).toFixed(2);
      throw new AppError(`El archivo excede el límite máximo permitido de 5 MB (Tamaño actual: ${sizeMb} MB).`, 400, 'FILE_TOO_LARGE');
    }

    // Validate MIME type format
    if (!ALLOWED_MIME_TYPES.includes(detectedMimeType.toLowerCase())) {
      throw new AppError(`Formato de imagen no permitido (${detectedMimeType}). Formatos aceptados: image/jpeg, image/png, image/webp.`, 400, 'UNSUPPORTED_IMAGE_FORMAT');
    }

    const cleanFolder = folder.replace(/^\/+|\/+$/g, '');
    const extension = detectedMimeType === 'image/jpeg' ? 'jpg' : (detectedMimeType === 'image/webp' ? 'webp' : 'png');
    const cleanFileName = fileName
      ? fileName.replace(/[^a-zA-Z0-9._-]/g, '_')
      : `img_${Date.now()}_${Math.random().toString(36).substr(2, 6)}.${extension}`;

    const storagePath = `${cleanFolder}/${cleanFileName}`;
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { error: uploadError } = await supabase.storage
          .from(bucket)
          .upload(storagePath, buffer, {
            contentType: detectedMimeType,
            upsert: true
          });

        if (uploadError) {
          console.warn('[Supabase Storage Upload Error]', uploadError.message);
        } else {
          const { data: publicUrlData } = supabase.storage
            .from(bucket)
            .getPublicUrl(storagePath);

          const publicUrl = publicUrlData?.publicUrl || `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${storagePath}`;

          return {
            url: publicUrl,
            path: storagePath,
            bucket
          };
        }
      } catch (err) {
        console.warn('[Supabase Storage Service Exception]', err.message);
      }
    }

    // Fallback: Save to local public uploads directory and return public URL path
    try {
      const targetDir = path.join(PUBLIC_DIR, 'uploads', bucket, cleanFolder);
      fs.mkdirSync(targetDir, { recursive: true });
      fs.writeFileSync(path.join(targetDir, cleanFileName), buffer);
      const localUrl = `/uploads/${bucket}/${storagePath}`;
      return {
        url: localUrl,
        path: storagePath,
        bucket
      };
    } catch (fsErr) {
      console.error('[Storage Local Fallback Error]', fsErr);
      // Fallback data-url if disk write fails
      const fallbackDataUrl = `data:${detectedMimeType};base64,${buffer.toString('base64')}`;
      return {
        url: fallbackDataUrl,
        path: storagePath,
        bucket
      };
    }
  }
};

module.exports = storageService;
