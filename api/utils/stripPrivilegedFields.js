/**
 * api/utils/stripPrivilegedFields.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Anti mass-assignment (P0, extraído de api/routes/studio.js): la lista de
 * campos que el cliente NUNCA puede fijar por rutas de guardado (Studio
 * /save). La suscripción solo la mutan vías server-side (webhooks de pago,
 * cron, admin); `userId`/`id`/`createdAt`/`updatedAt` son identidad/versión;
 * `analytics` es proyección derivada de telemetría. `__proto__`/`constructor`/
 * `prototype` cierran prototype-pollution vía merge.
 *
 * Pura e idempotente: aplicar de nuevo sobre la salida no cambia nada (lo
 * verifica tests/test-money-properties.js por properties). No muta el input.
 */
const PRIVILEGED_FIELDS = [
  'subscription', 'userId', 'id', 'analytics', 'createdAt', 'updatedAt',
  'recoveryCoupons', '__proto__', 'constructor', 'prototype'
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