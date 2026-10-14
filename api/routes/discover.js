const express = require('express');
const db = require('../../src/db/db');
const telemetryService = require('../services/telemetry');
const billingOrchestrator = require('../../src/billing/orchestrator');
const { successResponse } = require('../utils/response');
const { discoverLimiter } = require('../middleware/rateLimits');
const { isValidLatLng, haversineKm } = require('../utils/geo');

const router = express.Router();

/**
 * ¿El local puede aparecer en Descubrir beta?
 * - Opt-in explícito del dueño (allowDiscovery === true, default false).
 * - Suscripción válida (misma vara que el sitemap: cancelados afuera +
 *   verifyAccess del orchestrator). Ante duda del checker → afuera.
 */
function isDiscoverEligible(restaurant) {
  if (!restaurant || restaurant.allowDiscovery !== true) return false;
  try {
    const sub = restaurant.subscription || {};
    if (sub.status === 'canceled') return false;
    const access = billingOrchestrator.verifyAccess(restaurant.id);
    if (access && access.allowed === false) return false;
    return true;
  } catch (e) {
    return false;
  }
}

function publicDish(d) {
  return {
    id: String(d.id || '').slice(0, 50),
    name: String(d.name || 'Plato').slice(0, 100),
    description: String(d.description || '').slice(0, 160),
    price: Math.max(0, Number(d.price) || 0),
    photoUrl: typeof d.photoUrl === 'string' ? d.photoUrl.slice(0, 5000) : '',
    videoUrl: typeof d.videoUrl === 'string' ? d.videoUrl.slice(0, 500) : ''
  };
}

/**
 * GET /api/discover/feed?city=&limit=&offset=
 * Feed público beta de platos (formato tiktok de la zona). Sin PII: nunca
 * teléfono, dirección, userId ni emails. Solo locales opt-in con
 * suscripción válida. Cache corto (60s) para no fundir la DB free.
 */
router.get('/feed', discoverLimiter, async (req, res, next) => {
  try {
    const limit = Math.min(24, Math.max(1, parseInt(req.query.limit, 10) || 12));
    const offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const city = String(req.query.city || '').trim().toLowerCase().slice(0, 100);
    // Radio de cercanía (opcional): ?lat=&lng=&radiusKm=. Sin coords del
    // comensal rige ciudad/todo. Los locales SIN coords propias quedan fuera
    // del radio (no se puede probar cercanía): el Studio lo advierte.
    let geo = null;
    const hasGeo = req.query.lat !== undefined || req.query.lng !== undefined;
    if (hasGeo) {
      const lat = Number(req.query.lat);
      const lng = Number(req.query.lng);
      const radiusKm = req.query.radiusKm === undefined ? 10 : Number(req.query.radiusKm);
      if (!isValidLatLng(lat, lng)) {
        return res.status(400).json({ success: false, error: 'lat/lng inválidos', code: 'INVALID_GEO' });
      }
      if (!Number.isFinite(radiusKm) || radiusKm < 1 || radiusKm > 50) {
        return res.status(400).json({ success: false, error: 'radiusKm 1..50', code: 'INVALID_RADIUS' });
      }
      geo = { lat, lng, radiusKm };
    }

    const pools = [];
    for (const r of db.getAllRestaurants()) {
      if (!isDiscoverEligible(r)) continue;
      if (city && String(r.city || '').toLowerCase().indexOf(city) === -1) continue;
      let distanceKm = null;
      if (geo) {
        const rLat = Number(r.latitude);
        const rLng = Number(r.longitude);
        const d = haversineKm(geo.lat, geo.lng, rLat, rLng);
        if (d === null || d > geo.radiusKm) continue;
        distanceKm = Math.round(d * 10) / 10;
      }
      const dishes = (r.dishes || [])
        .filter(d => d && !d.outOfStock && d.name)
        // Platos con horario (happy hour, menú ejecutivo): el feed es evergreen
        // y no evalúa franjas por espectador — se excluyen para no publicitar
        // lo no disponible (límite beta documentado, no bug).
        .filter(d => !(d.schedule && d.schedule.enabled))
        .sort((a, b) => Number(Boolean(b.photoUrl || b.videoUrl)) - Number(Boolean(a.photoUrl || a.videoUrl)))
        .slice(0, 6)
        .map(publicDish);
      if (!dishes.length) continue;
      pools.push({
        restaurant: {
          name: String(r.name || r.bizName || 'Local').slice(0, 80),
          slug: String(r.slug || '').slice(0, 80),
          logoUrl: typeof r.logoUrl === 'string' ? r.logoUrl.slice(0, 5000) : '',
          city: String(r.city || '').slice(0, 100),
          currency: String(r.currency || '$').slice(0, 5),
          // Vitrina: el deep-link a la carta sigue valiendo, pero el botón
          // dice "Ver carta" en vez de "Pedir" (no hay nada que pedir).
          ordersEnabled: r.allowMenuOrders !== false,
          ...(distanceKm === null ? {} : { distanceKm })
        },
        restaurantId: r.id,
        dishes
      });
    }
    // Con radio rige cercanía (los más próximos primero); sin radio,
    // round-robin justo entre locales.
    if (geo) {
      pools.sort((a, b) => (a.restaurant.distanceKm || 0) - (b.restaurant.distanceKm || 0));
    }

    // Round-robin entre locales (reparto justo del feed, sin favoritos).
    const interleaved = [];
    for (let i = 0; i < 6; i++) {
      for (const pool of pools) {
        if (pool.dishes[i]) {
          interleaved.push({ pool, dish: pool.dishes[i] });
        }
      }
    }

    // Me gusta (90d, por plato). Beta: tally en memoria sobre opted-ins.
    // Clave restaurantId:dishId: el mismo id de plato en dos locales NO
    // comparte contador (bug real: antes la clave era solo dish.id y los
    // likes fugaban entre restaurantes).
    // Paralelo (Promise.all): N locales = N consultas; en serie sumaba
    // latencias y el p95 del feed se iba con la cantidad de adheridos.
    const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const likeByDish = {};
    await Promise.all(pools.map(async (pool) => {
      try {
        const events = await telemetryService.getEvents(pool.restaurantId, { since, eventType: 'dish_like' });
        for (const e of events) {
          const key = String((e && (e.dish_id || e.dishId)) || '');
          if (key) {
            const scoped = `${pool.restaurantId}:${key}`;
            likeByDish[scoped] = (likeByDish[scoped] || 0) + 1;
          }
        }
      } catch (e) { /* un local sin telemetría no rompe el feed */ }
    }));

    const sort = String(req.query.sort || '').trim().toLowerCase();
    if (sort !== 'top' && sort !== '' && sort !== 'mix') {
      return res.status(400).json({ success: false, error: 'sort inválido (top|mix)', code: 'INVALID_SORT' });
    }

    const ranked = interleaved.map(({ pool, dish }) => ({
      ...dish,
      likeCount: likeByDish[`${pool.restaurantId}:${dish.id}`] || 0,
      restaurant: pool.restaurant
    }));
    // ?sort=top: tendencias primero sobre TODO el feed (estable por slug:id
    // ante empates), y recién después se pagina. top de una página sola
    // sería mentira: el primero de la página 2 podría tener más likes.
    if (sort === 'top') {
      ranked.sort((a, b) => (b.likeCount - a.likeCount) || String(a.restaurant.slug + a.id).localeCompare(String(b.restaurant.slug + b.id)));
    }
    const page = ranked.slice(offset, offset + limit);

    res.set('Cache-Control', 'public, max-age=60, s-maxage=120');
    return successResponse(res, {
      beta: true,
      items: page,
      total: interleaved.length,
      nextOffset: offset + limit < interleaved.length ? offset + limit : null
    }, 'Feed Descubrir beta');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
