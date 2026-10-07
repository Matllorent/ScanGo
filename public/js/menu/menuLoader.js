/**
 * public/js/menu/menuLoader.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Menu data loading with caching, timeout, and offline resilience.
 * ─────────────────────────────────────────────────────────────────────────────
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const FETCH_TIMEOUT_MS = 3500;
const MAX_CACHE_SIZE = 100;

// In-memory cache with stale-while-revalidate
const _memoryCache = new Map();

/**
 * Get slug from URL
 * @returns {string}
 */
export function getSlug() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('slug')) return urlParams.get('slug');
  const parts = window.location.pathname.split('/');
  const mIndex = parts.indexOf('m');
  if (mIndex !== -1 && parts[mIndex + 1]) {
    return parts[mIndex + 1];
  }
  return 'demo';
}

/**
 * Generate cache key for menu data
 * @param {string} slug
 * @param {string} branch
 * @returns {string}
 */
function getCacheKey(slug, branch) {
  return `scango_cached_menu_${slug}${branch ? '_' + branch : ''}`;
}

/**
 * Load menu data with timeout, caching, and offline fallback
 * @param {Object} options
 * @param {string} [options.slug] - Restaurant slug (auto-detected if omitted)
 * @param {AbortSignal} [options.signal] - Abort signal for cancellation
 * @returns {Promise<Object>} Restaurant data
 */
export async function loadMenu({ slug, signal } = {}) {
  const restaurantSlug = slug || getSlug();
  const urlParams = new URLSearchParams(window.location.search);
  const branch = urlParams.get('branch') || urlParams.get('sucursal') || '';
  const cacheKey = getCacheKey(restaurantSlug, branch);

  // Demo mode: check localStorage
  if (restaurantSlug === 'demo') {
    try {
      const localDemo = localStorage.getItem('scango_demo_restaurant');
      if (localDemo) {
        return JSON.parse(localDemo);
      }
    } catch (e) {}
  }

  // Check memory cache (stale-while-revalidate)
  const cached = _memoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.data;
  }

  // Prepare fetch with timeout
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timeoutId = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null;
  const fetchSignal = signal || (controller ? controller.signal : undefined);

  try {
    const fetchUrl = `/api/menu/${restaurantSlug}${window.location.search}`;
    const res = await fetch(fetchUrl, { signal: fetchSignal });
    if (timeoutId) clearTimeout(timeoutId);

    if (!res.ok) {
      // Return stale cache if available on error
      const stale = _memoryCache.get(cacheKey);
      if (stale) {
        console.warn('[MenuLoader] Server error, returning stale cache');
        return stale.data;
      }
      throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    }

    const data = await res.json();
    const restaurant = data.restaurant;

    // Cache in memory and localStorage
    _memoryCache.set(cacheKey, { data: restaurant, expiresAt: Date.now() + CACHE_TTL_MS });
    try {
      localStorage.setItem(cacheKey, JSON.stringify(restaurant));
      localStorage.setItem('scango_cached_menu_' + restaurantSlug, JSON.stringify(restaurant));
    } catch (e) {}

    // Track visit analytics (fire and forget)
    fetch('/api/public/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: restaurantSlug, event: 'visit' })
    }).catch(() => {});

    return restaurant;
  } catch (err) {
    if (timeoutId) clearTimeout(timeoutId);

    // Offline fallback: try cache then localStorage
    const memoryCached = _memoryCache.get(cacheKey);
    if (memoryCached) {
      return memoryCached.data;
    }

    try {
      const localCached = localStorage.getItem(cacheKey) ||
        localStorage.getItem('scango_cached_menu_' + (slug || getSlug())) ||
        (slug === 'demo' ? localStorage.getItem('scango_demo_restaurant') : null);
      if (localCached) {
        return JSON.parse(localCached);
      }
    } catch (e) {}

    throw err;
  }
}

/**
 * Load menu for demo mode from localStorage
 * @returns {Object|null}
 */
export function loadDemoFromStorage() {
  try {
    const localDemo = localStorage.getItem('scango_demo_restaurant');
    if (localDemo) return JSON.parse(localDemo);
  } catch (e) {}
  return null;
}

/**
 * Clear cache for a specific slug
 * @param {string} slug
 */
export function invalidateCache(slug) {
  const urlParams = new URLSearchParams(window.location.search);
  const branch = urlParams.get('branch') || urlParams.get('sucursal') || '';
  const cacheKey = getCacheKey(slug, branch);
  _memoryCache.delete(cacheKey);
  try {
    localStorage.removeItem(cacheKey);
    localStorage.removeItem('scango_cached_menu_' + slug);
  } catch (e) {}
}

/**
 * Setup online/offline listeners
 * @param {Function} onOnline - Callback when connection restored
 * @param {Function} onOffline - Callback when connection lost
 */
export function setupNetworkListeners(onOnline, onOffline) {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

/**
 * Setup live sync via postMessage from Studio Editor
 * @param {Function} onUpdate - Called with updated restaurant data
 * @returns {Function} Cleanup function
 */
export function setupLiveSync(onUpdate) {
  const handler = (event) => {
    if (event.data && (event.data.type === 'UPDATE_LIVE_PREVIEW' || event.data.type === 'UPDATE_RESTAURANT')) {
      const updated = event.data.data || event.data.restaurant;
      if (updated) onUpdate(updated);
    }
  };
  window.addEventListener('message', handler);
  return () => window.removeEventListener('message', handler);
}