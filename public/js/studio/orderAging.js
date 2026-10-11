/**
 * public/js/studio/orderAging.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Antigüedad de pedidos en cocina (puro, sin DOM en import, testeable en
 * Node): minutos desde `created_at`, texto en criollo y nivel de urgencia.
 * El Studio lo pinta como chip ⏱ en cada tarjeta y lo refresca cada 30s.
 * Umbrales: 15 min aviso (ámbar), 30 min crítico (rojo). Entregados y
 * cancelados no envejecen (nivel `done`, sin color de alerta).
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Minutos para pintar el chip en ámbar y en rojo (solo estados no terminales).
export const ORDER_AGE_WARN_MIN = 15;
export const ORDER_AGE_CRIT_MIN = 30;

// Estados que cierran el pedido: el tiempo deja de contar como urgencia.
export const ORDER_AGE_DONE = ['delivered', 'cancelled'];

/**
 * Minutos enteros desde la creación (null si la fecha no parsea).
 */
export function orderAgeMinutes(createdAt, nowMs = Date.now()) {
  const t = createdAt ? new Date(createdAt).getTime() : NaN;
  if (!Number.isFinite(t)) return null;
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const mins = Math.floor((now - t) / 60000);
  return mins < 0 ? 0 : mins;
}

/**
 * Texto corto en criollo ("recién", "hace 3 min", "hace 1 h 5 min").
 */
export function formatOrderAge(createdAt, nowMs = Date.now()) {
  const mins = orderAgeMinutes(createdAt, nowMs);
  if (mins === null) return '—';
  if (mins < 1) return 'recién';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest ? `hace ${hours} h ${rest} min` : `hace ${hours} h`;
}

/**
 * Nivel de urgencia: 'ok' | 'warn' | 'crit' | 'done' | 'unknown'.
 */
export function orderAgeLevel(createdAt, nowMs = Date.now(), status = 'pending') {
  if (ORDER_AGE_DONE.includes(status)) return 'done';
  const mins = orderAgeMinutes(createdAt, nowMs);
  if (mins === null) return 'unknown';
  if (mins >= ORDER_AGE_CRIT_MIN) return 'crit';
  if (mins >= ORDER_AGE_WARN_MIN) return 'warn';
  return 'ok';
}

/**
 * Estilo del chip según nivel (misma paleta del panel, sin CSS nuevo).
 */
export function orderAgeStyle(level) {
  if (level === 'crit') return { color: '#F87171', weight: '800' };
  if (level === 'warn') return { color: '#FBD38D', weight: '700' };
  return { color: 'var(--text-dim)', weight: '400' };
}
