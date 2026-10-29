'use strict';

/**
 * api/services/pickup.js — capa con I/O de Takeaway Programado (73ª suite).
 * El módulo puro vive en `api/utils/pickupSlots.js` (grilla + verificación,
 * cero I/O); este servicio solo:
 *  - gatea por el opt-in del dueño (`restaurant.allowPreOrders === true`),
 *  - consulta el p50 de TAKEAWAY (F7-v2) para derivar el lead si el dueño
 *    no lo fija,
 *  - amortigua con cache de 60s (la ruta más caliente del producto es el
 *    menú público; a lo sumo 1 generación por local por minuto).
 *
 * La forma del bundle es ESTABLE (patrón soldOutToday): `allowed` boolean
 * siempre presente; config/slots vacíos cuando el feature no opera. Nunca
 * lanza — un error de consulta se degrada a `{ allowed:false }` (un ETA es
 * información, jamás puede romper el menú).
 *
 * Deliberate skip de v1: capacidad por slot en el SERVICIO no existe (el
 * conteo real lo hace la ruta con `db.getSlotOrdersNear` justo antes de
 * cobrar); la grilla del payload no conoce niveles de llenado — una franja
 * llena se descubre al enviar el pedido (400 SLOT_FULL honesto).
 */
const pickupSlots = require('../utils/pickupSlots');
const { getPrepEstimateBundleForRestaurant } = require('./prepEstimate');

const PICKUP_CACHE_MS = 60000; // 60s, patrón menuCacheMiddleware
const PICKUP_CACHE_MAX = 200;

const pickupCache = new Map(); // key → { at, bundle }

/**
 * Bundle del feature para un local. Con reloj inyectado (no-producción)
 * NO usa cache: cada corrida congelada espera la misma lista.
 * @param {object} restaurant - doc del local
 * @param {{ nowMs?: number }} [opts]
 * @returns {{ allowed: boolean, config: object|null, leadMinutes: number|null,
 *             slots: Array, generatedAt: string }}
 */
async function getPickupBundleForRestaurant(restaurant, opts = {}) {
  const hasOpts = arguments.length > 1 && opts !== null && typeof opts === 'object';
  const passedNow = hasOpts && Object.prototype.hasOwnProperty.call(opts, 'nowMs') && opts.nowMs !== undefined;
  const rawNow = passedNow ? Number(opts.nowMs) : Date.now();
  const now = Number.isFinite(rawNow) ? rawNow : Date.now();
  const allowed = restaurant && restaurant.allowPreOrders === true;
  if (!allowed) {
    return {
      allowed: false,
      config: null,
      leadMinutes: null,
      slots: [],
      generatedAt: new Date(now || Date.now()).toISOString()
    };
  }

  const id = (restaurant && (restaurant.id || restaurant.slug)) || '';
  const minuteBucket = Math.floor((Number.isFinite(now) ? now : Date.now()) / 60000);
  const key = `${id}:m${minuteBucket}`;
  const hit = pickupCache.get(key);
  if (!passedNow && hit && Date.now() - hit.at < PICKUP_CACHE_MS) return hit.bundle;
  if (!passedNow && hit && Date.now() - hit.at >= PICKUP_CACHE_MS) pickupCache.delete(key);

  // El p50 de TAKEAWAY viaja con la carta: si la consulta falla, el lead
  // explícito del dueño igual opera (el catch solo degrada el DERIVADO).
  // El reloj inyectado se PROPAGA a F7: el lead derivado queda anclado al
  // mismo instante que la grilla (suites herméticas y, en producción, misma
  // ventana de 7 días que el resto del cálculo).
  let prepByMode = null;
  try {
    prepByMode = passedNow
      ? await getPrepEstimateBundleForRestaurant(restaurant, { nowMs: now })
      : await getPrepEstimateBundleForRestaurant(restaurant);
  } catch (err) {
    prepByMode = null;
  }

  const config = pickupSlots.sanitizePickupConfig(restaurant.pickupConfig);
  const leadMinutes = pickupSlots.computeLeadMinutes(config, prepByMode ? prepByMode.byMode : null);
  if (leadMinutes == null) {
    // Sin lead (ni declarado ni derivado) el feature NO opera para este local.
    return {
      allowed: false,
      config: null,
      leadMinutes: null,
      slots: [],
      generatedAt: new Date(now || Date.now()).toISOString()
    };
  }

  const slots = pickupSlots.buildPickupSlots({
    scheduleActiveHours: restaurant.scheduleActiveHours,
    scheduleEnabled: restaurant.scheduleEnabled,
    utcOffsetMinutes: restaurant.utcOffsetMinutes,
    nowMs: Number.isFinite(now) ? now : Date.now(),
    pickupConfig: config,
    prepEstimateByMode: prepByMode ? prepByMode.byMode : null
  });

  const bundle = {
    allowed: true,
    config,
    leadMinutes,
    slots,
    generatedAt: new Date(now || Date.now()).toISOString()
  };
  if (!passedNow) {
    pickupCache.set(key, { at: Date.now(), bundle });
    if (pickupCache.size > PICKUP_CACHE_MAX) {
      const oldest = pickupCache.keys().next().value;
      pickupCache.delete(oldest);
    }
  }
  return bundle;
}

function clearPickupBundleCache() {
  pickupCache.clear();
}

module.exports = { getPickupBundleForRestaurant, clearPickupBundleCache };
