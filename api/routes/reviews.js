const express = require('express');
const { z } = require('zod');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody } = require('../middleware/validation');
const requireEmailVerified = require('../middleware/requireEmailVerified');

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

/**
 * Helper middleware to check +30 days of active subscription/account
 */
function require30DaysSubscription(req, res, next) {
  const userId = req.user.userId;
  const restaurant = db.findRestaurantByUserId(userId);

  if (!restaurant) {
    return errorResponse(res, 'Restaurante no encontrado para este usuario', 404, null, 'RESTAURANT_NOT_FOUND');
  }

  // Calculate account / subscription duration in days
  const createdAt = new Date(restaurant.createdAt || restaurant.subscription?.createdAt || Date.now());
  const now = new Date();
  const diffDays = (now.getTime() - createdAt.getTime()) / (1000 * 3600 * 24);

  if (diffDays < 30) {
    const daysRemaining = Math.ceil(30 - diffDays);
    return errorResponse(
      res,
      `Se requieren al menos 30 días de antigüedad de suscripción para enviar reseñas. Te faltan ${daysRemaining} días.`,
      403,
      { daysRemaining, daysActive: Math.floor(diffDays) },
      'SUBSCRIPTION_AGE_INSUFFICIENT'
    );
  }

  req.restaurant = restaurant;
  next();
}

/**
 * POST /api/reviews
 * Creates a new customer review (requires auth, email verification, and +30 days subscription)
 */
router.post('/', requireEmailVerified, validateBody(createReviewSchema), require30DaysSubscription, async (req, res, next) => {
  try {
    const { rating, comment, authorPhotoUrl, author_photo_url, restaurantId, restaurant_id } = req.body;
    const restId = restaurantId || restaurant_id || req.restaurant.id;
    const photoUrl = author_photo_url || authorPhotoUrl || null;

    const newReview = {
      id: 'rev_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      restaurant_id: restId,
      restaurantId: restId,
      restaurantName: req.restaurant.name || req.restaurant.bizName,
      userId: req.user.userId,
      rating: parseInt(rating),
      comment: String(comment).slice(0, 500),
      author_photo_url: photoUrl,
      authorPhotoUrl: photoUrl,
      status: 'pending',
      created_at: new Date().toISOString()
    };

    // Save to local DB adapter
    db.addReview(newReview);

    // Save to Supabase Cloud PostgreSQL table `reviews` if connected
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
        console.warn('[Supabase Insert Review]', err.message);
      }
    }

    return successResponse(res, newReview, 'Reseña enviada exitosamente. Estará visible una vez sea aprobada.', 201);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reviews/public
 * Returns approved reviews only (status = 'approved')
 */
router.get('/public', async (req, res, next) => {
  try {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('reviews')
          .select('*')
          .eq('status', 'approved')
          .order('created_at', { ascending: false });

        if (!error && data) {
          return successResponse(res, data, 'Reseñas públicas recuperadas');
        }
      } catch (e) {
        console.warn('[Supabase Get Public Reviews]', e.message);
      }
    }

    // Fallback to local DB adapter
    const approved = db.getApprovedReviews();
    return successResponse(res, approved, 'Reseñas públicas recuperadas');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/reviews
 * Returns all reviews for moderation (admin master key required)
 */
router.get('/admin/all', async (req, res, next) => {
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

    // Update in local DB adapter
    const updatedLocal = db.updateReviewStatus(reviewId, 'approved');

    // Update in Supabase Cloud PostgreSQL
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
      return errorResponse(res, 'Reseña no encontrada', 404, null, 'REVIEW_NOT_FOUND');
    }

    return successResponse(res, updatedLocal, 'Reseña aprobada y publicada exitosamente');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
