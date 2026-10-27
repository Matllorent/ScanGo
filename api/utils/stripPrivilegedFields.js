/**
 * api/utils/stripPrivilegedFields.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Anti mass-assignment (P0, extraído de api/routes/studio.js): la lista de
 * campos que el cliente NUNCA puede fijar por rutas de guardado (Studio
 * /save). La suscripción solo la mutan vías server-side (webhooks de pago,
 * cron, admin); `userId`/`id`/`createdAt`/`updatedAt` son identidad/versión;
 * `analytics` es proyección derivada de telemetría. `acquiredVia` (F4) es la
 * atribución del alta: la escribe SOLO el registro (server-side, validando que
 * la carta referente exista); un dueño no puede reescribir su origen.
 * `__proto__`/`constructor`/`prototype` cierran prototype-pollution vía merge.
 *
 * Pura e idempotente: aplicar de nuevo sobre la salida no cambia nada (lo
 * verifica tests/test-money-properties.js por properties). No muta el input.
 */
const PRIVILEGED_FIELDS = [
  'subscription', 'userId', 'id', 'analytics', 'createdAt', 'updatedAt',
  'recoveryCoupons', 'acquiredVia', '__proto__', 'constructor', 'prototype',
  // Reservas de verdad (backlog #2): las crea el comensal (server-side) y las
  // muta el dueño por /api/reservations. El autosave del Studio no puede
  // pisarlas con un snapshot vago (mismo tratamiento que recoveryCoupons).
  'reservations'
];

function stripPrivilegedFields(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const clean = { ...payload };
  for (const privileged of PRIVILEGED_FIELDS) {
    delete clean[privileged];
  }
  return clean;
}

module.exports = { PRIVILEGED_FIELDS, stripPrivilegedFields };