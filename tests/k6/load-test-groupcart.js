/**
 * tests/k6/load-test-groupcart.js
 * ──────────────────────────────────
 * k6 load test para carritos grupales (mesa QR) vía Supabase Realtime.
 *
 * ESCENARIO 3 — Carritos grupales:
 *   30 grupos × 4 comensales = 120 VU
 *   Cada comensal agrega platos concurrentes al mismo group_cart vía Realtime
 *   Simula: GET /sync → POST /sync (union-merge) → broadcast realtime
 *
 * Dado que k6 no tiene soporte nativo robusto para WebSockets
 * (la extensión `k6/x/websockets` es experimental y no siempre disponible),
 * este test simula el flujo Realtime mediante HTTP polling al endpoint /sync
 * y valida la consistencia del union-merge + tombstones.
 *
 * Requisitos:
 *   - BASE_URL
 *   - SLUGS_CSV (o usa slugs demo)
 *   - GROUP_CART_TOKEN: token HMAC para el endpoint /group/:restaurantId/:tableNumber
 *     (generar con: node -e "const {signGroupCartToken}=require('./api/utils/groupCartToken'); console.log(signGroupCartToken('slug','1'))")
 *   - RESTAURANT_ID: id del restaurante (para construir la key del carrito)
 *
 * Ejecución:
 *   k6 run --env BASE_URL=https://scango-rouge.vercel.app \
 *          --env GROUP_CART_TOKEN=<token> \
 *          --env RESTAURANT_ID=rest_xxx \
 *          tests/k6/load-test-groupcart.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Trend, Rate, Counter, Gauge } from 'k6/metrics';
import { uuidv4 } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import { SharedArray } from 'k6/data';
import { randomItem, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';
import exec from 'k6/execution';

// ──────────────────────────────────────────────────────────────────────────
// Configuración
// ──────────────────────────────────────────────────────────────────────────
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const SLUGS_CSV = __ENV.SLUGS_CSV || '';
const GROUP_CART_TOKEN = __ENV.GROUP_CART_TOKEN || '';
const RESTAURANT_ID = __ENV.RESTAURANT_ID || '';
const TABLE_NUMBER = __ENV.TABLE_NUMBER || '1'; // Mesa a testear (default: 1)

// Si no hay token ni restaurantId, usamos slug demo y generamos token en setup
const SLUG = __ENV.SLUG || 'demo';

// ──────────────────────────────────────────────────────────────────────────
// Métricas
// ──────────────────────────────────────────────────────────────────────────
const syncLatency = new Trend('groupcart_sync_latency', true);
const getLatency = new Trend('groupcart_get_latency', true);
const clearLatency = new Trend('groupcart_clear_latency', true);
const broadcastLatency = new Trend('groupcart_broadcast_latency', true);

const syncErrors = new Rate('groupcart_sync_errors');
const getErrors = new Rate('groupcart_get_errors');
const clearErrors = new Rate('groupcart_clear_errors');

const itemsAdded = new Counter('groupcart_items_added');
const itemsRemoved = new Counter('groupcart_items_removed');
const conflictsDetected = new Counter('groupcart_conflicts_detected'); // tombstones activados
const mergeSuccess = new Counter('groupcart_merge_success');

const activeVUs = new Gauge('active_vus');

// ──────────────────────────────────────────────────────────────────────────
// Datos: platos del restaurante
// ──────────────────────────────────────────────────────────────────────────
let slugs = new SharedArray('restaurant slugs', function () {
  if (SLUGS_CSV) {
    const data = open(SLUGS_CSV);
    const lines = data.trim().split('\n').slice(1);
    return lines.map(l => l.split(',')[0].trim()).filter(Boolean);
  }
  return ['demo', 'demo-heladeria', 'demo-perfumeria', 'demo-evento'];
});

let restaurantId = RESTAURANT_ID;
let slug = SLUG;
let tableNum = TABLE_NUMBER;
let groupCartToken = GROUP_CART_TOKEN;
let dishesCache = [];

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function getHeaders(extra = {}) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'User-Agent': 'k6-groupcart-test/1.0',
    ...extra,
  };
  if (groupCartToken) h['X-Group-Cart-Token'] = groupCartToken;
  return h;
}

function getGroupCartKey() {
  return `${restaurantId}_mesa_${tableNum}`;
}

async function fetchDishes(slug) {
  if (dishesCache.length) return dishesCache;
  const res = http.get(`${BASE_URL}/api/menu/${slug}`, {
    headers: getHeaders(),
    tags: { endpoint: 'menu_json' },
  });
  if (res.status === 200) {
    try {
      const data = res.json();
      dishesCache = (data.dishes || []).filter(d => d && d.id && !d.outOfStock);
      if (dishesCache.length) return dishesCache;
    } catch (e) { /* ignore */ }
  }
  // Fallback sintético
  dishesCache = [
    { id: 'dish_1', name: 'Plato Test 1', price: 150 },
    { id: 'dish_2', name: 'Plato Test 2', price: 200 },
    { id: 'dish_3', name: 'Plato Test 3', price: 120 },
  ];
  return dishesCache;
}

function randomDish() {
  return randomItem(dishesCache);
}

function buildSyncPayload(action, overrides = {}) {
  const dish = randomDish();
  const cartItemId = `cart_${dish.id}_${uuidv4().slice(0, 8)}`;
  const now = new Date().toISOString();

  const base = {
    items: [],
    participants: [`comensal_${exec.vu.idInInstance}`],
    action,
    fromUser: `Comensal ${exec.vu.idInInstance}`,
    fromUserId: `user_${exec.vu.idInInstance}`,
    deletedCartItemIds: [],
    restaurantSlug: slug,
    ...overrides,
  };

  if (action === 'add' || action === 'sync') {
    base.items = [{
      cartItemId,
      dishId: dish.id,
      name: dish.name,
      price: dish.price,
      quantity: randomIntBetween(1, 3),
      orderedById: `user_${exec.vu.idInInstance}`,
      orderedByName: `Comensal ${exec.vu.idInInstance}`,
      addedAt: now,
    }];
    itemsAdded.add(1);
  } else if (action === 'remove') {
    // Para remove, necesitamos un cartItemId existente.
    // En test real, vendría del GET previo. Aquí usamos uno sintético.
    base.deletedCartItemIds = [overrides.cartItemId || `cart_${dish.id}_${uuidv4().slice(0, 8)}`];
    base.items = [];
    itemsRemoved.add(1);
  }

  return base;
}

// ──────────────────────────────────────────────────────────────────────────
// Opciones del test
// ──────────────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // 30 grupos × 4 comensales = 120 VU concurrentes
    // Cada VU representa UN comensal en una mesa
    group_carts: {
      executor: 'constant-vus',
      vus: 120,               // 30 mesas × 4 comensales
      duration: '3m',         // 3 minutos de carga sostenida
      gracefulRampDown: '30s',
      exec: 'groupCartScenario',
      // Distribuir VUs en 30 grupos de 4 (tag personalizado para análisis)
      tags: { test_type: 'group_cart' },
    },
  },
  thresholds: {
    'groupcart_sync_latency{p95}': ['p(95)<1000'],
    'groupcart_get_latency{p95}': ['p(95)<500'],
    'groupcart_clear_latency{p95}': ['p(95)<1000'],
    'groupcart_sync_errors': ['rate<0.02'],
    'groupcart_get_errors': ['rate<0.01'],
    'groupcart_clear_errors': ['rate<0.01'],
    // Consistencia: merge success rate alto
    'groupcart_merge_success': ['count>100'],
    // Conflictos (tombstones) esperados pero bajos
    'checks': ['rate>0.95'],
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Setup: obtener restaurantId, token, platos
// ──────────────────────────────────────────────────────────────────────────
export function setup() {
  console.log('SETUP: Iniciando test de carritos grupales...');

  // Resolver restaurantId si no se proveyó
  if (!restaurantId && slug) {
    const res = http.get(`${BASE_URL}/api/menu/${slug}`, { headers: getHeaders() });
    if (res.status === 200) {
      try {
        const data = res.json();
        restaurantId = data.id || data.restaurantId;
        console.log(`SETUP: restaurantId resuelto: ${restaurantId}`);
      } catch (e) { /* ignore */ }
    }
  }

  // Generar token si no se proveyó (requiere secret del server)
  // Nota: en producción real, el token viene del QR de mesa.
  // Para load test local, podemos derivarlo si conocemos GROUP_CART_SECRET.
  if (!groupCartToken && restaurantId) {
    console.warn('SETUP: GROUP_CART_TOKEN no provisto. Los endpoints /group/* requerirán token válido (403 esperado).');
  }

  // Pre-cargar platos
  fetchDishes(slug);

  return {
    restaurantId,
    slug,
    tableNum,
    groupCartToken,
    dishesCount: dishesCache.length,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Escenario principal: cada VU = un comensal
// ──────────────────────────────────────────────────────────────────────────
export function groupCartScenario(data) {
  activeVUs.add(1);
  restaurantId = data.restaurantId;
  slug = data.slug;
  tableNum = data.tableNum;
  groupCartToken = data.groupCartToken;

  // Identidad del comensal: VU ID determina su "mesa virtual"
  // Agrupamos 4 VUs por mesa: mesa = Math.floor(vuId / 4)
  const mesaId = Math.floor((exec.vu.idInInstance - 1) / 4) + 1;
  const comensalIdx = ((exec.vu.idInInstance - 1) % 4) + 1;
  const myTable = `${tableNum}_${mesaId}`; // mesa virtual única por grupo de 4

  // ─── Fase 1: GET estado actual del carrito ───
  group('GET /group/:restaurantId/:tableNumber', () => {
    const start = Date.now();
    const res = http.get(`${BASE_URL}/api/orders/group/${restaurantId}/${myTable}`, {
      headers: getHeaders(),
      tags: { endpoint: 'group_get', mesa: myTable },
    });
    getLatency.add(Date.now() - start);
    const ok = check(res, {
      'group get 200': (r) => r.status === 200,
      'group has items array': (r) => {
        try { return Array.isArray(r.json().items); } catch { return false; }
      },
    });
    getErrors.add(!ok);
  });

  sleep(Math.random() * 0.2 + 0.05); // 50-250ms

  // ─── Fase 2: Agregar 1-3 items (POST /sync con action=add) ───
  const numItems = randomIntBetween(1, 3);
  for (let i = 0; i < numItems; i++) {
    group('POST /group/:restaurantId/:tableNumber/sync (add)', () => {
      const payload = buildSyncPayload('add');
      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/orders/group/${restaurantId}/${myTable}/sync`, JSON.stringify(payload), {
        headers: getHeaders(),
        tags: { endpoint: 'group_sync_add', mesa: myTable },
      });
      syncLatency.add(Date.now() - start);

      const ok = check(res, {
        'sync add 200': (r) => r.status === 200,
        'sync returns merged items': (r) => {
          try {
            const data = r.json();
            return Array.isArray(data.items) && data.items.length > 0;
          } catch { return false; }
        },
        'sync has participants': (r) => {
          try { return Array.isArray(r.json().participants); } catch { return false; }
        },
        'sync has tombstones': (r) => {
          try { return Array.isArray(r.json().deletedItemIds); } catch { return false; }
        },
      });
      syncErrors.add(!ok);
      if (ok) mergeSuccess.add(1);

      // Detectar conflictos: si el item que agregamos NO aparece en la respuesta,
      // podría haber sido tombstoneado por otro comensal (raro en add, común en remove)
      if (res.status === 200) {
        try {
          const data = res.json();
          const myItemId = payload.items[0]?.cartItemId;
          const found = data.items.some(it => it.cartItemId === myItemId);
          if (!found && myItemId) {
            conflictsDetected.add(1);
          }
        } catch (e) { /* ignore */ }
      }
    });
    sleep(Math.random() * 0.15 + 0.05); // 50-200ms entre adds
  }

  // ─── Fase 3: Ocasional remove (10% probabilidad) ───
  if (Math.random() < 0.1) {
    group('POST /group/:restaurantId/:tableNumber/sync (remove)', () => {
      // Para remove real, necesitamos un cartItemId existente.
      // Hacemos GET primero para obtener uno.
      const getRes = http.get(`${BASE_URL}/api/orders/group/${restaurantId}/${myTable}`, {
        headers: getHeaders(),
        tags: { endpoint: 'group_get_for_remove' },
      });
      let targetCartItemId = null;
      if (getRes.status === 200) {
        try {
          const items = getRes.json().items || [];
          if (items.length) targetCartItemId = randomItem(items).cartItemId;
        } catch (e) { /* ignore */ }
      }
      if (!targetCartItemId) {
        // Sin items para borrar, saltar
        return;
      }

      const payload = buildSyncPayload('remove', { cartItemId: targetCartItemId });
      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/orders/group/${restaurantId}/${myTable}/sync`, JSON.stringify(payload), {
        headers: getHeaders(),
        tags: { endpoint: 'group_sync_remove', mesa: myTable },
      });
      syncLatency.add(Date.now() - start);

      const ok = check(res, {
        'sync remove 200': (r) => r.status === 200,
        'item removed from cart': (r) => {
          try {
            const data = r.json();
            return !data.items.some(it => it.cartItemId === targetCartItemId);
          } catch { return false; }
        },
        'tombstone recorded': (r) => {
          try {
            return r.json().deletedItemIds?.includes(targetCartItemId) === true;
          } catch { return false; }
        },
      });
      syncErrors.add(!ok);
      if (ok) mergeSuccess.add(1);
    });
  }

  // ─── Fase 4: Clear final (solo 1 comensal por mesa, el último) ───
  if (comensalIdx === 4 && exec.iterationInInstance === 0) {
    group('POST /group/:restaurantId/:tableNumber/clear', () => {
      const start = Date.now();
      const res = http.post(`${BASE_URL}/api/orders/group/${restaurantId}/${myTable}/clear`, JSON.stringify({
        restaurantSlug: slug,
        fromUser: `Comensal ${exec.vu.idInInstance} (clear)`,
      }), {
        headers: getHeaders(),
        tags: { endpoint: 'group_clear', mesa: myTable },
      });
      clearLatency.add(Date.now() - start);
      const ok = check(res, {
        'clear 200': (r) => r.status === 200,
        'cart cleared': (r) => {
          try { return r.json().cleared === true && r.json().items.length === 0; } catch { return false; }
        },
        'participants preserved': (r) => {
          try { return Array.isArray(r.json().participants) && r.json().participants.length > 0; } catch { return false; }
        },
      });
      clearErrors.add(!ok);
    });
  }

  activeVUs.add(-1);
  sleep(Math.random() * 1 + 0.5); // 500-1500ms entre iteraciones
}

// ──────────────────────────────────────────────────────────────────────────
// Teardown
// ──────────────────────────────────────────────────────────────────────────
export function teardown(data) {
  console.log('TEARDOWN: Group cart load test completado');
  console.log(`  Restaurant: ${data.restaurantId} (${data.slug})`);
  console.log(`  Mesa base: ${data.tableNum}`);
  console.log(`  Platos disponibles: ${data.dishesCount}`);
}