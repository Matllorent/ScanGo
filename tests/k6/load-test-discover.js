/**
 * tests/k6/load-test-discover.js
 * ────────────────────────────────
 * k6 load test para el feed Descubrir beta (GET /api/discover/feed).
 *
 * ESCENARIO 4 — Descubrir feed:
 *   100 VU consultando /api/discover/feed con:
 *   - Geo (lat/lng/radiusKm)
 *   - Paginación (limit/offset)
 *   - Likes (dish_like)
 *   - Filtro por ciudad
 *   - Sort (top|mix)
 *
 * Requisitos:
 *   - BASE_URL
 *   - SLUGS_CSV opcional (para validar que los slugs del feed existen)
 *   - LAT/LNG opcional: coordenadas para test de radio (default: Montevideo centro)
 *   - CITY opcional: ciudad para filtrar
 *
 * Ejecución:
 *   k6 run --env BASE_URL=https://scango-rouge.vercel.app tests/k6/load-test-discover.js
 *   k6 run --env BASE_URL=https://scango-rouge.vercel.app --env LAT=-34.9011 --env LNG=-56.1645 --env CITY=montevideo tests/k6/load-test-discover.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import exec from 'k6/execution';

// ──────────────────────────────────────────────────────────────────────────
// Configuración
// ──────────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SLUGS_CSV = __ENV.SLUGS_CSV || '';
const LAT = __ENV.LAT ? parseFloat(__ENV.LAT) : -34.9011; // Montevideo centro
const LNG = __ENV.LNG ? parseFloat(__ENV.LNG) : -56.1645;
const RADIUS_KM = __ENV.RADIUS_KM ? parseInt(__ENV.RADIUS_KM, 10) : 10;
const CITY = __ENV.CITY || 'montevideo';
const SORT_MODES = ['top', 'mix', '']; // '' = default (round-robin)

// ──────────────────────────────────────────────────────────────────────────
// Métricas
// ──────────────────────────────────────────────────────────────────────────
const feedLatency = new Trend('discover_feed_latency', true);
const feedErrors = new Rate('discover_feed_errors');
const paginationLatency = new Trend('discover_pagination_latency', true);
const likeLatency = new Trend('discover_like_latency', true);

const totalItemsReceived = new Counter('discover_total_items');
const uniqueRestaurantsSeen = new Counter('discover_unique_restaurants');
const geoFilteredRequests = new Counter('discover_geo_filtered');
const cityFilteredRequests = new Counter('discover_city_filtered');
const topSortedRequests = new Counter('discover_top_sorted');
const mixSortedRequests = new Counter('discover_mix_sorted');

const activeVUs = new Gauge('active_vus');
const cacheHitRate = new Rate('discover_cache_hit_rate');

// ──────────────────────────────────────────────────────────────────────────
// Datos: slugs conocidos
// ──────────────────────────────────────────────────────────────────────────
let slugs = new SharedArray('restaurant slugs', function () {
  if (SLUGS_CSV) {
    const data = open(SLUGS_CSV);
    const lines = data.trim().split('\n').slice(1);
    return lines.map(l => l.split(',')[0].trim()).filter(Boolean);
  }
  return ['demo', 'demo-heladeria', 'demo-perfumeria', 'demo-evento'];
});

// Cache simple en memoria para detectar hits de cache del server (Cache-Control: max-age=60)
const feedCache = new Map();

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function getHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-discover-test/1.0',
    ...extra,
  };
}

function buildFeedParams(overrides = {}) {
  const params = {
    limit: overrides.limit || randomItem([12, 18, 24]),
    offset: overrides.offset || 0,
    city: overrides.city || (Math.random() < 0.7 ? CITY : ''),
    sort: overrides.sort || randomItem(SORT_MODES),
  };

  // 60% de requests con geo (radio de cercanía)
  if (Math.random() < 0.6 || overrides.geo) {
    params.lat = LAT + (Math.random() - 0.5) * 0.01; // jitter ±~500m
    params.lng = LNG + (Math.random() - 0.5) * 0.01;
    params.radiusKm = overrides.radiusKm || RADIUS_KM;
    geoFilteredRequests.add(1);
  }

  if (params.city) cityFilteredRequests.add(1);
  if (params.sort === 'top') topSortedRequests.add(1);
  else if (params.sort === 'mix') mixSortedRequests.add(1);

  return params;
}

function paramsToQuery(params) {
  const q = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && v !== null) q.set(k, String(v));
  });
  return q.toString();
}

function cacheKey(params) {
  return paramsToQuery(params);
}

// ──────────────────────────────────────────────────────────────────────────
// Opciones del test
// ──────────────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    discover_feed: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },   // Warmup
        { duration: '2m', target: 100 },   // Sostenido 100 VU
        { duration: '30s', target: 0 },    // Bajada
      ],
      gracefulRampDown: '30s',
      exec: 'discoverFeedScenario',
    },
    // Sub-escenario: paginación profunda (offsets altos)
    discover_pagination: {
      executor: 'constant-vus',
      vus: 20,
      duration: '1m',
      startTime: '1m',
      exec: 'discoverPaginationScenario',
    },
    // Sub-escenario: likes concurrentes (POST /api/public/analytics/event con dish_like)
    discover_likes: {
      executor: 'constant-vus',
      vus: 30,
      duration: '2m',
      startTime: '30s',
      exec: 'discoverLikesScenario',
    },
  },
  thresholds: {
    'discover_feed_latency{p95}': ['p(95)<800'],      // Feed con geo + likes: <800ms p95
    'discover_pagination_latency{p95}': ['p(95)<600'],
    'discover_like_latency{p95}': ['p(95)<500'],
    'discover_feed_errors': ['rate<0.01'],             // <1% errores
    'discover_cache_hit_rate': ['rate>0.3'],           // >30% cache hits (server cache 60s)
    'checks': ['rate>0.98'],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Escenario principal: feed con variaciones de parámetros
// ──────────────────────────────────────────────────────────────────────────
export function discoverFeedScenario() {
  activeVUs.add(1);

  const params = buildFeedParams();
  const query = paramsToQuery(params);
  const url = `${BASE_URL}/api/discover/feed?${query}`;

  // Detectar cache hit via header Cache-Control / Age
  const start = Date.now();
  const res = http.get(url, {
    headers: getHeaders(),
    tags: {
      endpoint: 'discover_feed',
      has_geo: params.lat ? 'true' : 'false',
      has_city: params.city ? 'true' : 'false',
      sort: params.sort || 'default',
    },
  });
  const latency = Date.now() - start;
  feedLatency.add(latency);

  // Verificar cache hit: header Age > 0 indica cache hit en CDN/edge
  const ageHeader = res.headers['Age'] || res.headers['age'];
  const isCacheHit = ageHeader && parseInt(ageHeader, 10) > 0;
  cacheHitRate.add(isCacheHit);

  const ok = check(res, {
    'feed 200': (r) => r.status === 200,
    'feed has items array': (r) => {
      try { return Array.isArray(r.json().items); } catch { return false; }
    },
    'feed has beta flag': (r) => {
      try { return r.json().beta === true; } catch { return false; }
    },
    'feed has total count': (r) => {
      try { return typeof r.json().total === 'number'; } catch { return false; }
    },
    'feed items have likeCount': (r) => {
      try {
        const items = r.json().items || [];
        return items.every(it => typeof it.likeCount === 'number');
      } catch { return false; }
    },
    'feed items have restaurant': (r) => {
      try {
        const items = r.json().items || [];
        return items.every(it => it.restaurant && it.restaurant.slug);
      } catch { return false; }
    },
    'feed respects limit': (r) => {
      try { return (r.json().items || []).length <= (params.limit || 24); } catch { return false; }
    },
    'feed no PII': (r) => {
      try {
        const body = JSON.stringify(r.json());
        return !body.includes('phone') && !body.includes('email') && !body.includes('address');
      } catch { return true; }
    },
    'response time < 2000ms': (r) => r.timings.duration < 2000,
  });

  feedErrors.add(!ok);

  if (res.status === 200) {
    try {
      const data = res.json();
      const items = data.items || [];
      totalItemsReceived.add(items.length);

      // Contar restaurantes únicos en esta respuesta
      const uniqueRestos = new Set(items.map(it => it.restaurant?.slug).filter(Boolean));
      uniqueRestaurantsSeen.add(uniqueRestos.size);

      // Validar que los slugs devueltos son de nuestra lista conocida (si hay CSV)
      if (slugs.length > 0) {
        const unknown = [...uniqueRestos].filter(s => !slugs.includes(s));
        if (unknown.length) {
          console.warn(`DESCUBRIR: Slugs no reconocidos en feed: ${unknown.join(', ')}`);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // Think time realista: usuario scrollea, lee, decide
  sleep(Math.random() * 2 + 0.5); // 500-2500ms

  activeVUs.add(-1);
}

// ──────────────────────────────────────────────────────────────────────────
// Escenario: paginación profunda (offsets altos)
// ──────────────────────────────────────────────────────────────────────────
export function discoverPaginationScenario() {
  activeVUs.add(1);

  // Paginamos hasta offset 200 (simula usuario que hace scroll infinito)
  const maxOffset = 200;
  const pageSize = 12;
  const numPages = Math.floor(maxOffset / pageSize);

  for (let page = 0; page < numPages; page++) {
    const offset = page * pageSize;
    const params = buildFeedParams({ offset, limit: pageSize, sort: '' });
    const query = paramsToQuery(params);
    const url = `${BASE_URL}/api/discover/feed?${query}`;

    const start = Date.now();
    const res = http.get(url, {
      headers: getHeaders(),
      tags: { endpoint: 'discover_pagination', page: String(page) },
    });
    paginationLatency.add(Date.now() - start);

    const ok = check(res, {
      'pagination 200': (r) => r.status === 200,
      'pagination has nextOffset or null': (r) => {
        try {
          const data = r.json();
          return data.nextOffset === null || typeof data.nextOffset === 'number';
        } catch { return false; }
      },
      'pagination items <= limit': (r) => {
        try { return (r.json().items || []).length <= pageSize; } catch { return false; }
      },
    });
    feedErrors.add(!ok);

    // Si no hay más items, parar
    if (res.status === 200) {
      try {
        if (!res.json().nextOffset) break;
      } catch (e) { break; }
    }

    sleep(Math.random() * 0.5 + 0.2); // 200-700ms entre páginas
  }

  activeVUs.add(-1);
}

// ──────────────────────────────────────────────────────────────────────────
// Escenario: likes concurrentes (simula dish_like via analytics event)
// ──────────────────────────────────────────────────────────────────────────
export function discoverLikesScenario() {
  activeVUs.add(1);

  // Primero obtener un feed para tener dishIds reales
  const params = buildFeedParams({ limit: 6 });
  const query = paramsToQuery(params);
  const feedRes = http.get(`${BASE_URL}/api/discover/feed?${query}`, {
    headers: getHeaders(),
    tags: { endpoint: 'discover_feed_for_likes' },
  });

  let dishIds = [];
  let restaurantIds = [];

  if (feedRes.status === 200) {
    try {
      const data = feedRes.json();
      dishIds = (data.items || []).map(it => it.id).filter(Boolean);
      restaurantIds = (data.items || []).map(it => it.restaurantId || it.restaurant?.slug).filter(Boolean);
    } catch (e) { /* ignore */ }
  }

  // Si no hay datos reales, usar sintéticos
  if (!dishIds.length) {
    dishIds = ['dish_1', 'dish_2', 'dish_3'];
    restaurantIds = [slug, slug, slug];
  }

  // Enviar 1-3 likes por iteración
  const numLikes = randomIntBetween(1, 3);
  for (let i = 0; i < numLikes; i++) {
    const dishId = randomItem(dishIds);
    const restaurantId = randomItem(restaurantIds);

    // POST /api/public/analytics/event con dish_like
    // El endpoint espera: { slug, event: 'dish_like', dishId, consent: 'all' }
    const payload = {
      slug: restaurantId,
      event: 'dish_like',
      dishId,
      consent: 'all', // necesario para que se registre (Ley 18.331)
    };

    const start = Date.now();
    const res = http.post(`${BASE_URL}/api/public/analytics/event`, JSON.stringify(payload), {
      headers: getHeaders(),
      tags: { endpoint: 'discover_like', dishId },
    });
    likeLatency.add(Date.now() - start);

    const ok = check(res, {
      'like 200': (r) => r.status === 200,
      'like recorded': (r) => {
        try { return r.json().recorded === true; } catch { return false; }
      },
      'like not blocked by consent': (r) => {
        try { return r.json().code !== 'CONSENT_NECESSARY'; } catch { return true; }
      },
    });
    feedErrors.add(!ok);

    sleep(Math.random() * 0.3 + 0.1); // 100-400ms entre likes
  }

  activeVUs.add(-1);
  sleep(Math.random() * 1 + 0.5);
}

// ──────────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ──────────────────────────────────────────────────────────────────────────
export function setup() {
  console.log('SETUP: Discover feed load test');
  console.log(`  Base URL: ${BASE_URL}`);
  console.log(`  Geo: ${LAT}, ${LNG} (radius ${RADIUS_KM}km)`);
  console.log(`  City filter: ${CITY}`);
  console.log(`  Slugs disponibles: ${slugs.length}`);

  // Warmup: una request para poblar cache del server
  const warmupParams = buildFeedParams({ limit: 12, sort: '' });
  const warmupUrl = `${BASE_URL}/api/discover/feed?${paramsToQuery(warmupParams)}`;
  http.get(warmupUrl, { headers: getHeaders() });

  return { warmupDone: true };
}

export function teardown(data) {
  console.log('TEARDOWN: Discover feed load test completado');
}