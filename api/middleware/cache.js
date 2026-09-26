const logger = require('../utils/logger');

// High-Performance In-Memory LRU Cache Store
class LRUCache {
  constructor(limit = 500, ttlMs = 60000) {
    this.limit = limit;
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  get(key) {
    if (!this.cache.has(key)) return null;

    const entry = this.cache.get(key);
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    // Refresh position for LRU
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.value;
  }

  set(key, value, customTtl) {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.limit) {
      // Evict oldest entry
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }

    const ttl = customTtl || this.ttlMs;
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttl
    });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }
}

const memoryCache = new LRUCache(1000, 60000); // 1000 items, 60s TTL

/**
 * Instant Cache Invalidation for a restaurant slug
 * @param {string} slug
 */
async function invalidateMenuCache(slug) {
  if (!slug) return;
  const cleanSlug = String(slug).toLowerCase().trim();

  memoryCache.delete(cleanSlug);

  // Upstash Redis invalidation support if credentials configured
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      await fetch(`${redisUrl}/del/menu:${cleanSlug}`, {
        headers: { Authorization: `Bearer ${redisToken}` }
      });
    } catch (e) {
      logger.warn('[Upstash Redis Invalidation Error]', { slug: cleanSlug, details: e.message });
    }
  }

  logger.info('Cache invalidated instantly', { slug: cleanSlug });
}

/**
 * Express Caching Middleware for GET /api/menu/:slug
 */
function menuCacheMiddleware(req, res, next) {
  const slug = (req.params.slug || req.params.restaurant_slug || '').toLowerCase().trim();
  if (!slug) return next();

  // Include query params (lang, mealTime, hour, day) in cache key
  const cacheKey = `${slug}:${req.query.lang || 'es'}:${req.query.mealTime || req.query.hour || ''}:${req.query.day || ''}`;

  const cachedData = memoryCache.get(cacheKey);
  if (cachedData) {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    res.setHeader('X-Cache', 'HIT');
    res.setHeader('X-Response-Time-Target', '<30ms');
    return res.status(200).json(cachedData);
  }

  // Intercept res.json to cache fresh response
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (res.statusCode === 200 && body && !body.error && !body.inactive) {
      memoryCache.set(cacheKey, body, 60000); // 60s TTL
      res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=300');
    }
    res.setHeader('X-Cache', 'MISS');
    return originalJson(body);
  };

  next();
}

module.exports = {
  menuCacheMiddleware,
  invalidateMenuCache,
  memoryCache
};
