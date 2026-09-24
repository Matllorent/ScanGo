const express = require('express');
const { z } = require('zod');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody, validateQuery } = require('../middleware/validation');
const requireVerifiedEmail = require('../middleware/requireVerifiedEmail');
const AppError = require('../utils/AppError');

const router = express.Router();

// Zod Schema for creating a review
const createReviewSchema = z.object({
  restaurantId: z.string().optional(),
  restaurant_id: z.string().optional(),
  rating: z.number().int().min(1, { message: 'La calificación debe ser de 1 a 5 estrellas' }).max(5),
  comment: z.string().min(1, { message: 'El comentario no puede estar vacío' }).max(500, { message: 'Máximo 500 caracteres' }),
  authorPhotoUrl: z.string().url().nullable().optional().or(z.literal('')),
  author_photo_url: z.string().url().nullable().optional().or(z.literal(''))
});

// Zod Schema for pagination query params
const paginationQuerySchema = z.object({
  limit: z.string().optional().transform(val => (val ? Math.max(1, Math.min(100, parseInt(val))) : 10)),
  offset: z.string().optional().transform(val => (val ? Math.max(0, parseInt(val)) : 0))
});

/**
 * Middleware to verify >= 30 days of subscription/account age
 */
function require30DaysSubscription(req, res, next) {
  const userId = req.user.userId;
  const restaurant = db.findRestaurantByUserId(userId);

  if (!restaurant) {
    return next(new AppError('Restaurante no encontrado para este usuario', 404, 'RESTAURANT_NOT_FOUND'));
  }

  const createdAt = new Date(restaurant.createdAt || restaurant.subscription?.createdAt || Date.now());
  const now = new Date();
  const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);

  if (diffDays < 30) {
    const daysRemaining = Math.ceil(30 - diffDays);
    return res.status(403).json({
      success: false,
      error: `Se requieren al menos 30 días transcurridos desde el registro para enviar reseñas. Te faltan ${daysRemaining} días.`,
      code: 'SUBSCRIPTION_AGE_INSUFFICIENT',
      details: { daysRemaining, daysActive: Math.floor(diffDays) },
      timestamp: new Date().toISOString()
    });
  }

  req.restaurant = restaurant;
  next();
}

/**
 * POST /api/reviews
 * Creates a new review (requires verified email and >= 30 days subscription)
 */
router.post('/', requireVerifiedEmail, validateBody(createReviewSchema), require30DaysSubscription, async (req, res, next) => {
  try {
    const { rating, comment, authorPhotoUrl, author_photo_url, restaurantId, restaurant_id } = req.body;
    const restId = restaurantId || restaurant_id || req.restaurant.id;
    const photoUrl = author_photo_url || authorPhotoUrl || null;
    const utcNow = new Date().toISOString(); // TIMESTAMPTZ UTC

    const newReview = {
      id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      restaurant_id: restId,
      restaurantId: restId,
      restaurantName: req.restaurant.name || req.restaurant.bizName,
      userId: req.user.userId,
      rating: parseInt(rating),
      comment: String(comment).trim().slice(0, 500),
      author_photo_url: photoUrl,
      authorPhotoUrl: photoUrl,
      status: 'pending',
      created_at: utcNow
    };

    db.addReview(newReview);

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('reviews').insert([{
          id: newReview.id,
          restaurant_id: newReview.restaurant_id,
          rating: newReview.rating,
          comment: newReview.comment,
          author_photo_url: newReview.author_photo_url,
          status: newReview.status,
          created_at: newReview.created_at
        }]);
      } catch (err) {
        console.warn('[Supabase Insert Review Warning]', err.message);
      }
    }

    return successResponse(res, newReview, 'Reseña enviada exitosamente. Estará visible una vez aprobada.', 201);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reviews/public
 * Returns paginated approved reviews (status = 'approved')
 */
router.get('/public', validateQuery(paginationQuerySchema), async (req, res, next) => {
  try {
    const { limit, offset } = req.validatedQuery || { limit: 10, offset: 0 };
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error, count } = await supabase
          .from('reviews')
          .select('*', { count: 'exact' })
          .eq('status', 'approved')
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (!error && data) {
          return res.status(200).json({
            success: true,
            message: 'Reseñas públicas recuperadas',
            data,
            pagination: {
              limit,
              offset,
              total: count || data.length
            },
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {
        console.warn('[Supabase Get Public Reviews]', e.message);
      }
    }

    // Local DB Adapter fallback
    const allApproved = db.getApprovedReviews();
    const paginated = allApproved.slice(offset, offset + limit);

    return res.status(200).json({
      success: true,
      message: 'Reseñas públicas recuperadas',
      data: paginated,
      pagination: {
        limit,
        offset,
        total: allApproved.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/reviews
 * Returns all reviews for admin moderation
 */
router.get('/admin', async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('reviews')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return successResponse(res, data, 'Todas las reseñas recuperadas para administración');
        }
      } catch (e) {
        console.warn('[Supabase Get Admin Reviews]', e.message);
      }
    }

    const all = db.getAllReviews();
    return successResponse(res, all, 'Todas las reseñas recuperadas para administración');
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/admin/reviews/:id/approve
 * Approves a review for public display
 */
router.patch('/admin/:id/approve', async (req, res, next) => {
  try {
    const reviewId = req.params.id;
    const updatedLocal = db.updateReviewStatus(reviewId, 'approved');

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase
          .from('reviews')
          .update({ status: 'approved' })
          .eq('id', reviewId);
      } catch (e) {
        console.warn('[Supabase Approve Review]', e.message);
      }
    }

    if (!updatedLocal) {
      throw new AppError('Reseña no encontrada', 404, 'REVIEW_NOT_FOUND');
    }

    return successResponse(res, updatedLocal, 'Reseña aprobada exitosamente');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
