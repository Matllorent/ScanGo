const express = require('express');
const crypto = require('crypto');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const logger = require('../utils/logger');

const router = express.Router();

const GRACE_PERIOD_DAYS = 7;
const FREE_PLAN = 'free';

/**
 * Verifica el token de autorización del cron job.
 * Soporta Authorization: Bearer <token> o x-cron-secret header.
 */
function verifyCronAuth(req, res, next) {
  const cronSecret = process.env.CRON_SECRET || '';
  if (!cronSecret) {
    // Si no hay secret configurado, permite acceso (desarrollo)
    return next();
  }

  const authHeader = req.headers['authorization'] || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  const cronSecretHeader = req.headers['x-cron-secret'] || '';

  const provided = token || cronSecretHeader;

  if (!provided) {
    return res.status(401).json({
      success: false,
      error: 'Cron secret requerido',
      code: 'CRON_AUTH_REQUIRED'
    });
  }

  const providedBuf = Buffer.from(provided, 'utf8');
  const expectedBuf = Buffer.from(cronSecret, 'utf8');

  if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return res.status(401).json({
      success: false,
      error: 'Cron secret inválido',
      code: 'CRON_AUTH_INVALID'
    });
  }

  next();
}

/**
 * GET /api/cron/billing-dunning
 * Ejecuta el proceso de dunning: revisa restaurantes con estado 'past_due'
 * cuya fecha de gracia haya expirado y los degrada automáticamente al plan Free.
 *
 * Configurar en Vercel Cron Jobs (vercel.json):
 *   { "path": "/api/cron/billing-dunning", "schedule": "0 2 * * *" }
 */
router.get('/billing-dunning', verifyCronAuth, async (req, res) => {
  const startTime = Date.now();
  const results = {
    scanned: 0,
    downgraded: 0,
    errors: [],
    details: []
  };

  try {
    const supabase = getSupabaseClient();
    const now = new Date();
    const allRestaurants = db.getAllRestaurants ? db.getAllRestaurants() : [];

    // También obtener de Supabase si está disponible
    let supabaseRestaurants = [];
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('restaurants')
          .select('id, subscription, updated_at')
          .eq('subscription->>status', 'past_due');

        if (!error && data) {
          supabaseRestaurants = data;
        }
      } catch (e) {
        logger.warn('[Dunning Cron] Error consultando Supabase:', e.message);
      }
    }

    // Combinar IDs únicas de ambas fuentes
    const candidateIds = new Set();
    allRestaurants.forEach(r => {
      if (r.subscription && r.subscription.status === 'past_due') {
        candidateIds.add(r.id);
      }
    });
    supabaseRestaurants.forEach(r => {
      if (r.subscription && r.subscription.status === 'past_due') {
        candidateIds.add(r.id);
      }
    });

    results.scanned = candidateIds.size;

    for (const restaurantId of candidateIds) {
      try {
        const restaurant = db.findRestaurantById(restaurantId);
        if (!restaurant) continue;

        const sub = restaurant.subscription || {};
        if (sub.status !== 'past_due') continue;

        // Calcular fecha de expiración de gracia
        const periodEnd = sub.currentPeriodEnd
          ? new Date(sub.currentPeriodEnd)
          : (sub.updatedAt ? new Date(sub.updatedAt) : new Date());
        const graceEnd = new Date(periodEnd.getTime() + GRACE_PERIOD_DAYS * 24 * 3600 * 1000);

        // Si la gracia no ha expirado, saltar
        if (now <= graceEnd) {
          const daysLeft = Math.max(0, Math.ceil((graceEnd.getTime() - now.getTime()) / (24 * 3600 * 1000)));
          results.details.push({
            restaurantId,
            action: 'skipped',
            reason: `Grace period still active (${daysLeft} days left)`
          });
          continue;
        }

        // Downgrade a plan Free
        const downgradedSubscription = {
          status: 'expired',
          plan: FREE_PLAN,
          provider: sub.provider || 'dunning_cron',
          previousPlan: sub.plan || 'pro_monthly',
          downgradedAt: now.toISOString(),
          downgradeReason: 'grace_period_expired',
          gracePeriodDaysRemaining: 0,
          updatedAt: now.toISOString(),
          updated_at: now.toISOString()
        };

        // Actualizar en DB local
        db.updateSubscription(restaurantId, downgradedSubscription);

        // Actualizar en Supabase
        if (supabase) {
          try {
            await supabase
              .from('restaurants')
              .update({
                subscription: downgradedSubscription,
                updated_at: now.toISOString()
              })
              .eq('id', restaurantId);
          } catch (e) {
            logger.warn(`[Dunning Cron] Error actualizando Supabase para ${restaurantId}:`, e.message);
          }
        }

        results.downgraded++;
        results.details.push({
          restaurantId,
          action: 'downgraded',
          previousPlan: sub.plan || 'pro_monthly',
          newPlan: FREE_PLAN,
          graceExpiredAt: graceEnd.toISOString()
        });

        logger.info(`[Dunning Cron] Restaurante ${restaurantId} degradado a plan Free (gracia expirada)`);

      } catch (err) {
        results.errors.push({
          restaurantId,
          error: err.message
        });
        logger.error(`[Dunning Cron] Error procesando ${restaurantId}:`, err.message);
      }
    }

    const duration = Date.now() - startTime;

    logger.info('[Dunning Cron] Ejecución completada', {
      scanned: results.scanned,
      downgraded: results.downgraded,
      errors: results.errors.length,
      durationMs: duration
    });

    return res.status(200).json({
      success: true,
      message: `Dunning completado: ${results.downgraded} restaurantes degradados de ${results.scanned} escaneados`,
      results,
      timestamp: now.toISOString(),
      durationMs: duration
    });

  } catch (err) {
    logger.error('[Dunning Cron] Error fatal:', err.message);
    return res.status(500).json({
      success: false,
      error: 'Error ejecutando dunning cron',
      details: err.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
