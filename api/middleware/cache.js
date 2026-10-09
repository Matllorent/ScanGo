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

// In-Memory Cache with Mutex / Single-Flight to prevent Cache Stampede. Capa
// interna del SSR de /api/menu/:slug (TTL 5s, stale-while-revalidate). Vive acá
// para que invalidateMenuCache() la limpie junto con el LRU y el dueño no vea
// datos viejos por 5s tras guardar (p.ej. el toggle de pago online).
const menuCache = new Map(); // slug -> { data, expiresAt, fetchingPromise }
function getCachedMenu(slug, fetcherFn) {
  const now = Date.now();
  const entry = menuCache.get(slug);

  // Cache hit and still fresh (5 seconds TTL)
  if (entry && entry.expiresAt > now && entry.data) {
    return Promise.resolve(entry.data);
  }

  // Mutex: If a fetch is already in progress for this slug, join the existing promise (Prevents Cache Stampede!)
  if (entry && entry.fetchingPromise) {
    return entry.fetchingPromise;
  }

  // Stale-While-Revalidate: If stale data is available, return immediately while refreshing in background
  if (entry && entry.data) {
    const refreshPromise = Promise.resolve().then(fetcherFn).then(freshData => {
      menuCache.set(slug, { data: freshData, expiresAt: Date.now() + 5000, fetchingPromise: null });
      return freshData;
    }).catch((e) => { logger.warn('[Menu Cache Background Refresh]', { details: e.message, slug }); });
    entry.fetchingPromise = refreshPromise;
    return Promise.resolve(entry.data);
  }

  // Cold cache: First request fetches and sets promise
  const fetchingPromise = Promise.resolve().then(fetcherFn).then(freshData => {
    menuCache.set(slug, { data: freshData, expiresAt: Date.now() + 5000, fetchingPromise: null });
    return freshData;
  }).catch(err => {
    menuCache.delete(slug);
    throw err;
  });

  menuCache.set(slug, { data: null, expiresAt: 0, fetchingPromise });
  return fetchingPromise;
}

/**
 * Instant Cache Invalidation for a restaurant slug
 * @param {string} slug
 */
async function invalidateMenuCache(slug) {
  if (!slug) return;
  const cleanSlug = String(slug).toLowerCase().trim();

  memoryCache.delete(cleanSlug);
  for (const key of memoryCache.cache.keys()) {
    if (key.startsWith(`${cleanSlug}:`)) memoryCache.delete(key);
  }

  // Capa single-flight del SSR: claves `${slug}:branch:${branch}`.
  for (const key of menuCache.keys()) {
    if (key === cleanSlug || key.startsWith(`${cleanSlug}:`)) menuCache.delete(key);
  }

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

  // Include query params (lang, mealTime, hour, day, branch/sucursal) in cache key
  // branch/sucursal NO puede faltar: dos sucursales del mismo restaurante tienen
  // precios override y platillos custom distintos, y un menú cacheado bajo el slug
  // pelado contaminaría la vista sin ?branch= y entre sucursales (60s TTL).
  const branchParam = req.query.branch || req.query.sucursal || '';
  const cacheKey = `${slug}:${req.query.lang || 'es'}:${req.query.mealTime || req.query.hour || ''}:${req.query.day || ''}:${String(branchParam).toLowerCase().trim()}`;

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
  getCachedMenu,
  memoryCache
};
