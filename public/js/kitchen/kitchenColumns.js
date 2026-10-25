/**
 * public/js/kitchen/kitchenColumns.js
 * ─────────────────────────────────────────────────────────────────────────────
 * KDS "Vista Kitchen" (F2 del bloque "El Sistema", oct-2026) — módulo puro,
 * cero I/O y cero DOM: la tabla de decisión de qué pedido va a qué columna de
 * la pizarra de cocina + el modelo de tarjeta. La UI (kitchen.js) solo render;
 * el avance de estado viaja SIEMPRE por `PATCH /api/orders/status/:orderId`
 * (el mismo endpoint del Studio: cero endpoints nuevos = cero riesgo de
 * contrato).
 *
 * Reglas (testeadas en tests/test-kitchen.js §2):
 *  - Cinco columnas fijas: En cola → Confirmado → Preparando → Listo/En
 *    camino → Entregado (spec docs/plan-ejecucion-bloque-sistema-oct-2026 §2).
 *  - `delayed` vive en PREPARANDO: si el dueño lo marcó demorado sigue siendo
 *    trabajo de la cocina (no salió); la tarjeta suma una píldora "Demorado".
 *  - `cancelled` NO entra a la pizarra (columnIdForStatus → null): es un
 *    terminal de error, la cocina ya no tiene nada que hacer con él.
 *  - Estado DESCONOCIDO (una versión futura del backend, un typo): el pedido
 *    NUNCA desaparece de la pizarra → cae en "En cola" con su estado crudo
 *    visible. Invariante: la cocina no pierde trabajo por drift de estados.
 *  - Avance por toque (nextKitchenStatus): pending → confirmed → preparing →
 *    ready → on_the_way → delivered; `delayed` → delivered directo. Cancelar
 *    NUNCA va por toque (destructivo: showConfirmDialog).
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const KDS_COLUMN_IDS = ['queue', 'confirmed', 'preparing', 'ready', 'delivered'];

export const KITCHEN_COLUMNS = [
  { id: 'queue', title: 'En cola', statuses: ['pending'] },
  { id: 'confirmed', title: 'Confirmados', statuses: ['confirmed'] },
  { id: 'preparing', title: 'Preparando', statuses: ['preparing', 'delayed'] },
  { id: 'ready', title: 'Listo / En camino', statuses: ['ready', 'on_the_way'] },
  { id: 'delivered', title: 'Entregados', statuses: ['delivered'] }
];

// Índice rápido estado → columnId (construido de la tabla canónica: una sola
// fuente de verdad para columnas y lookup).
const COLUMN_BY_STATUS = new Map();
for (const col of KITCHEN_COLUMNS) {
  for (const status of col.statuses) {
    COLUMN_BY_STATUS.set(status, col.id);
  }
}

/**
 * Columna del KDS para un estado: id de columna o null cuando el pedido no
 * pinta (cancelled). Un estado que el KDS no conoce NO esconde el pedido:
 * cae en 'queue' — la cocina lo ve con su estado crudo en vez de perderlo.
 */
export function columnIdForStatus(status) {
  if (COLUMN_BY_STATUS.has(status)) {
    return COLUMN_BY_STATUS.get(status);
  }
  if (status === 'cancelled') return null;
  return 'queue';
}

/**
 * Siguiente estado del toque en la tarjeta (cero confirmación: avanzar no
 * destruye). Devuelve null cuando no hay más avance (delivered/cancelled o
 * estado desconocido).
 */
export function nextKitchenStatus(status) {
  const advance = {
    pending: 'confirmed',
    confirmed: 'preparing',
    preparing: 'ready',
    ready: 'on_the_way',
    on_the_way: 'delivered',
    delayed: 'delivered'
  };
  return Object.prototype.hasOwnProperty.call(advance, status) ? advance[status] : null;
}

/**
 * Etiquetas de estado (las mismas strings del Studio y del backend
 * ORDER_STATUS_LABELS — espejo literal para no diverger).
 */
export const KITCHEN_STATUS_LABELS = {
  pending: 'Recibido',
  confirmed: 'Confirmado',
  preparing: 'En preparación',
  ready: 'Listo',
  on_the_way: 'En camino',
  delayed: 'Demorado',
  delivered: 'Entregado',
  cancelled: 'Cancelado'
};

/**
 * Número de ticket corto y determinista para gritar en cocina: cola del id
 * ('ord_<ts>_<rand>' → última cola), en mayúsculas y con `#`.
 */
export function kitchenTicketNumber(order) {
  const id = String((order && (order.id || order.orderId)) || '');
  if (!id) return '#—';
  const tail = String(id).split('_').pop() || id;
  return `#${tail.slice(-4).toUpperCase()}`;
}

/**
 * Dispara el modelo de una tarjeta del KDS desde una fila de pedido real
 * (la MISMA fila que produce GET /api/orders/restaurant/:id — dual-mode,
 * camel/snake mezclado como todo el repo). Tolerante: elementos sin forma
 * conocida (incluido el snapshot del helado a medida) no rompen el render,
 * y el `optionsSnapshot` (modificadores del comensal) se aplana a labels.
 * Cancelled/unknown: columnId null/queue según tabla (arriba).
 */
export function buildKitchenCardModel(order) {
  if (!order || typeof order !== 'object') return null;

  const rawItems = order.items_snapshot || order.itemsSnapshot || [];
  const items = [];
  for (const it of (Array.isArray(rawItems) ? rawItems : [])) {
    if (!it || typeof it !== 'object') continue;
    const qty = Number(it.quantity);
    const qtyLabel = Number.isFinite(qty) && qty > 1 ? `${qty}× ` : '';
    const name = String(it.name || 'Item personalizado');
    const mods = [];
    if (Array.isArray(it.optionsSnapshot)) {
      for (const choice of it.optionsSnapshot) {
        if (!choice || typeof choice !== 'object' || choice.kind === 'presentation') continue;
        const sel = [];
        for (const s of (Array.isArray(choice.selections) ? choice.selections : [])) {
          if (!s || !s.name) continue;
          const n = Number(s.quantity);
          sel.push(Number.isFinite(n) && n > 1 ? `${n}× ${String(s.name)}` : String(s.name));
        }
        if (sel.length) {
          mods.push(`${String(choice.groupName || 'Opciones')}: ${sel.join(', ')}`);
        }
      }
    }
    const note = String(it.note || '').trim();
    items.push({ label: qtyLabel + name, mods, note });
  }

  const status = String(order.status || 'pending');
  const customer = String(order.customer_name || '').trim();
  return {
    id: String(order.id || ''),
    columnId: columnIdForStatus(status),
    status,
    statusLabel: KITCHEN_STATUS_LABELS[status] || stringSafe(status),
    ticketNumber: kitchenTicketNumber(order),
    table: stringSafe(order.table_number || order.tableNumber),
    customer,
    items,
    notes: stringSafe(order.notes),
    delayed: status === 'delayed',
    pending: status === 'pending',
    terminal: status === 'delivered' || status === 'cancelled',
    cancelled: status === 'cancelled',
    createdAt: String(order.created_at || order.createdAt || '')
  };
}

function stringSafe(v) {
  return String(v == null ? '' : v).trim();
}
