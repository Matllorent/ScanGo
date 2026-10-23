/**
 * tests/k6/load-test-checkout.js
 * ────────────────────────────────
 * k6 load test for ScanGo checkout flow.
 *
 * ESCENARIO 1 — Pico hora comida:
 *   200 VU rampa 2min → 5min sostenido → 1min bajada
 *   70% GET /m/:slug
 *   20% POST /api/orders/quote + POST /api/orders
 *   10% loyalty/realtime endpoints
 *
 * ESCENARIO 2 — Concurrencia cupones winback:
 *   50 VU simultáneos intentando canjear EL MISMO cupón VOL-XXXXXXXX
 *   Valida atomicidad: solo 1 éxito, resto 409.
 *
 * Requisitos:
 *   - BASE_URL (ej: https://scango-rouge.vercel.app)
 *   - SLUGS_CSV opcional: CSV con columna 'slug' de restaurantes reales
 *   - AUTH_TOKEN opcional: JWT para endpoints autenticados (dueño)
 *   - WINBACK_COUPON opcional: código de cupón específico a testear (default genera uno)
 *
 * Ejecución:
 *   k6 run --env BASE_URL=https://scango-rouge.vercel.app tests/k6/load-test-checkout.js
 *   k6 run --env BASE_URL=https://scango-rouge.vercel.app --env SLUGS_CSV=./test-data/slugs.csv tests/k6/load-test-checkout.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter, Gauge } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { SharedArray } from 'k6/data';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import exec from 'k6/execution';

// ──────────────────────────────────────────────────────────────────────────
// Configuración desde variables de entorno
// ──────────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SLUGS_CSV = __ENV.SLUGS_CSV || '';
const AUTH_TOKEN = __ENV.AUTH_TOKEN || ''; // JWT del dueño para endpoints autenticados
const WINBACK_COUPON = __ENV.WINBACK_COUPON || `VOL-${uuidv4().slice(0, 8).toUpperCase()}`;

// ──────────────────────────────────────────────────────────────────────────
// Métricas personalizadas
// ──────────────────────────────────────────────────────────────────────────
const menuLatency = new Trend('menu_latency', true);
const quoteLatency = new Trend('quote_latency', true);
const orderLatency = new Trend('order_latency', true);
const loyaltyLatency = new Trend('loyalty_latency', true);
const couponValidateLatency = new Trend('coupon_validate_latency', true);

const menuErrors = new Rate('menu_errors');
const quoteErrors = new Rate('quote_errors');
const orderErrors = new Rate('order_errors');
const loyaltyErrors = new Rate('loyalty_errors');
const couponErrors = new Rate('coupon_errors');

const couponSuccess = new Counter('coupon_success');
const couponConflict = new Counter('coupon_conflict_409');
const couponFail = new Counter('coupon_fail_other');

const activeVUs = new Gauge('active_vus');

// ──────────────────────────────────────────────────────────────────────────
// Datos de prueba: slugs de restaurantes (desde CSV o hardcodeados)
// ──────────────────────────────────────────────────────────────────────────
let slugs = new SharedArray('restaurant slugs', function () {
  if (SLUGS_CSV) {
    const data = open(SLUGS_CSV);
    const lines = data.trim().split('\n').slice(1); // skip header
    return lines.map(l => l.split(',')[0].trim()).filter(Boolean);
  }
  // Fallback: slugs demo conocidos (demo, demo-heladeria, demo-perfumeria, demo-evento)
  return ['demo', 'demo-heladeria', 'demo-perfumeria', 'demo-evento'];
});

// Dishes mock para quote/orders (se rellenan dinámicamente desde /api/menu/:slug)
const dishCache = new Map();

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function getHeaders(extra = {}) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-load-test/1.0',
    ...extra,
  };
  if (AUTH_TOKEN) h['Authorization'] = `Bearer ${AUTH_TOKEN}`;
  return h;
}

function getIdempotencyKey() {
  return `idem_${uuidv4()}`;
}

function pickSlug() {
  return randomItem(slugs);
}

async function fetchDishes(slug) {
  if (dishCache.has(slug)) return dishCache.get(slug);
  const res = http.get(`${BASE_URL}/api/menu/${slug}`, {
    headers: getHeaders(),
    tags: { endpoint: 'menu_json' },
  });
  check(res, { 'menu JSON 200': (r) => r.status === 200 });
  if (res.status === 200) {
    try {
      const data = res.json();
      const dishes = (data.dishes || []).filter(d => d && d.id && !d.outOfStock);
      if (dishes.length) {
        dishCache.set(slug, dishes);
        return dishes;
      }
    } catch (e) { /* ignore */ }
  }
  // Fallback: dish sintético mínimo
  const fallback = [{ id: 'dish_1', name: 'Test Dish', price: 100 }];
  dishCache.set(slug, fallback);
  return fallback;
}

function buildOrderPayload(slug, dishes, overrides = {}) {
  const selected = Array.isArray(dishes) && dishes.length ? randomItem(dishes) : { id: 'dish_1', name: 'Test', price: 100 };
  const qty = Math.floor(Math.random() * 3) + 1;
  const now = new Date().toISOString();
  return {
    restaurantId: slug,
    tableNumber: String(Math.floor(Math.random() * 20) + 1),
    items: [{
      dishId: selected.id,
      quantity: qty,
      name: selected.name,
      price: selected.price,
    }],
    currency: 'USD',
    customerName: `LoadTest User ${uuidv4().slice(0, 6)}`,
    customerPhone: `+5989${Math.floor(10000000 + Math.random() * 90000000)}`,
    deliveryAddress: overrides.deliveryAddress || '',
    notes: 'Load test order',
    tipAmount: 0,
    captchaToken: '', // Turnstile no se valida en load test sin secreto
    orderMode: overrides.orderMode || 'TAKEAWAY',
    deliveryFee: 0,
    utcOffsetMinutes: -180, // UTC-3 (Uruguay)
    ...overrides,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Escenario 1: Pico hora comida
// ──────────────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // ─── Pico hora comida ───
    peak_lunch: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 200 },   // Rampa
        { duration: '5m', target: 200 },   // Sostenido
        { duration: '1m', target: 0 },     // Bajada
      ],
      gracefulRampDown: '30s',
      exec: 'peakLunch',
    },
    // ─── Concurrencia cupones winback ───
    winback_coupon_concurrency: {
      executor: 'shared-iterations',
      vus: 50,
      iterations: 50,          // 50 VU × 1 iteración = 50 intentos concurrentes
      maxDuration: '30s',
      startTime: '8m',         // Arranca después del pico (evita interferencia)
      exec: 'winbackCouponConcurrency',
    },
  },
  thresholds: {
    // SLOs del proyecto (AGENTS.md)
    'menu_latency{p95}': ['p(95)<500'],        // menú público p95 < 500ms
    'quote_latency{p95}': ['p(95)<1000'],      // API p95 < 1000ms
    'order_latency{p95}': ['p(95)<1000'],
    'loyalty_latency{p95}': ['p(95)<1000'],
    'menu_errors': ['rate<0.01'],               // error_rate < 1%
    'quote_errors': ['rate<0.01'],
    'order_errors': ['rate<0.01'],
    'loyalty_errors': ['rate<0.01'],
    // Atomicidad cupón winback: exactamente 1 éxito, 49 conflictos 409
    'coupon_success': ['count==1'],
    'coupon_conflict_409': ['count==49'],
    'coupon_fail_other': ['count==0'],
    // Checks globales
    'checks': ['rate>0.99'],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// VU iteration para escenario pico hora comida
// ──────────────────────────────────────────────────────────────────────────
export function peakLunch() {
  activeVUs.add(1);
  const slug = pickSlug();

  // 70% GET /m/:slug (menú público SSR)
  if (Math.random() < 0.7) {
    group('GET /m/:slug (SSR)', () => {
      const start = Date.now();
      const res = http.get(`${BASE_URL}/m/${slug}`, {
        headers: getHeaders({ 'Accept': 'text/html' }),
        tags: { endpoint: 'menu_ssr' },
      });
      menuLatency.add(Date.now() - start);
      const ok = check(res, {
        'menu SSR 200': (r) => r.status === 200,
        'menu has CSP': (r) => r.headers['Content-Security-Policy'] !== undefined,
        'menu no on* attrs': (r) => !r.body.includes('onClick') && !r.body.includes('onclick'),
      });
      menuErrors.add(!ok);
    });
    sleep(Math.random() * 0.5 + 0.1); // think time 100-600ms
    return;
  }

  // 20% quote + order
  if (Math.random() < 0.66) { // 0.2 / 0.3 ≈ 0.66
    const dishes = fetchDishes(slug);
    const payload = buildOrderPayload(slug, dishes);

    // POST /api/orders/quote
    group('POST /api/orders/quote', () => {
      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/orders/quote`, JSON.stringify(payload), {
        headers: getHeaders(),
        tags: { endpoint: 'quote' },
      });
      quoteLatency.add(Date.now() - start);
      const ok = check(res, {
        'quote 200': (r) => r.status === 200,
        'quote has amount': (r) => {
          try { return r.json().amount > 0; } catch { return false; }
        },
      });
      quoteErrors.add(!ok);
    });

    sleep(Math.random() * 0.3 + 0.05);

    // POST /api/orders (con idempotency-key)
    group('POST /api/orders', () => {
      const start = Date.now();
      const headers = getHeaders();
      headers['Idempotency-Key'] = getIdempotencyKey();
      const res = http.post(`${BASE_URL}/api/orders`, JSON.stringify(payload), {
        headers,
        tags: { endpoint: 'create_order' },
      });
      orderLatency.add(Date.now() - start);
      const ok = check(res, {
        'order 201': (r) => r.status === 201,
        'order has trackingToken': (r) => {
          try { return !!r.json().trackingToken; } catch { return false; }
        },
      });
      orderErrors.add(!ok);
    });
    sleep(Math.random() * 0.3 + 0.05);
    return;
  }

  // 10% loyalty/realtime endpoints
  group('Loyalty / Realtime endpoints', () => {
    const start = Date.now();
    const endpoints = [
      { path: `/api/loyalty/me`, body: { phone: `+5989${Math.floor(10000000 + Math.random() * 90000000)}` }, name: 'loyalty_me' },
      { path: `/api/public/analytics/event`, body: { slug, event: 'visit', consent: 'all' }, name: 'analytics_event' },
    ];
    const ep = randomItem(endpoints);
    const res = http.post(`${BASE_URL}${ep.path}`, JSON.stringify(ep.body), {
      headers: getHeaders(),
      tags: { endpoint: ep.name },
    });
    loyaltyLatency.add(Date.now() - start);
    const ok = check(res, { [`${ep.name} 2xx`]: (r) => r.status >= 200 && r.status < 300 });
    loyaltyErrors.add(!ok);
  });
  sleep(Math.random() * 0.2 + 0.05);
  activeVUs.add(-1);
}

// ──────────────────────────────────────────────────────────────────────────
// VU iteration para escenario concurrencia cupones winback
// ──────────────────────────────────────────────────────────────────────────
export function winbackCouponConcurrency() {
  activeVUs.add(1);

  // Requiere AUTH_TOKEN (dueño) para POST /api/loyalty/validate
  if (!AUTH_TOKEN) {
    console.warn('WINBACK: AUTH_TOKEN no configurado, saltando validación de cupón autenticada');
    // Simular intento público (fallará 401, pero medimos la latencia)
    const res = http.post(`${BASE_URL}/api/loyalty/validate`, JSON.stringify({ code: WINBACK_COUPON }), {
      headers: getHeaders(),
      tags: { endpoint: 'validate_coupon_noauth' },
    });
    couponValidateLatency.add(res.timings.duration);
    check(res, { 'validate 401 without auth': (r) => r.status === 401 });
    activeVUs.add(-1);
    return;
  }

  // Intentar validar el MISMO cupón desde 50 VU concurrentes
  const start = Date.now();
  const res = http.post(`${BASE_URL}/api/loyalty/validate`, JSON.stringify({ code: WINBACK_COUPON }), {
    headers: getHeaders(),
    tags: { endpoint: 'validate_coupon' },
  });
  couponValidateLatency.add(Date.now() - start);

  const ok = check(res, {
    'validate 200 (primer éxito)': (r) => r.status === 200,
    'validate 409 (conflicto)': (r) => r.status === 409,
  });

  if (res.status === 200) {
    couponSuccess.add(1);
  } else if (res.status === 409) {
    couponConflict.add(1);
  } else {
    couponFail.add(1);
    couponErrors.add(1);
  }

  activeVUs.add(-1);
}

// ──────────────────────────────────────────────────────────────────────────
// Setup / Teardown (opcional: pre-crear cupón winback para test de atomicidad)
// ──────────────────────────────────────────────────────────────────────────
export function setup() {
  if (!AUTH_TOKEN) {
    console.warn('SETUP: AUTH_TOKEN no provisto. El test de concurrencia de cupones usará 401 esperado.');
    return { couponCreated: false };
  }

  // Intentar crear un cupón winback real vía API del dueño
  // Nota: /api/loyalty/winback genera cupones VOL-XXXXXXXX atados a teléfonos.
  // Para test de atomicidad pura, necesitamos un cupón que YA EXISTA y sea válido.
  // Aquí podríamos llamar a un endpoint de test o crear uno manualmente en BD.
  // Por simplicidad, usamos WINBACK_COUPON de env y asumimos que existe.
  console.log(`SETUP: Usando cupón winback ${WINBACK_COUPON} para test de atomicidad`);
  return { couponCreated: true, couponCode: WINBACK_COUPON };
}

export function teardown(data) {
  console.log('TEARDOWN: Load test checkout completado');
  if (data.couponCreated) {
    console.log(`Cupón de prueba usado: ${data.couponCode}`);
  }
}