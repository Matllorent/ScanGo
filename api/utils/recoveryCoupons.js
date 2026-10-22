/**
 * api/utils/recoveryCoupons.js
 * ────────────────────────────
 * Cupones de recupero (F8 "Cupón de recupero"): módulo PURO — cero I/O, cero
 * require de src/db/routes/middleware (guard de arquitectura B).
 *
 * Qué hace (y qué NO hace):
 *  - Define la forma de un cupón de recupero: { id, code, source:'winback',
 *    type:'percent'|'free_delivery', value, label, createdAt, expiresAt,
 *    usedAt, usedByPhone, usedOrderId }.
 *  - Genera códigos no ambiguos con fuente de aleatoriedad INYECTABLE
 *    (el router usa crypto.randomInt; los tests usan PRNG fijo — determinismo
 *    testeable, mismo estilo que test-money-properties).
 *  - Valida vigencia: expiración, uso único y teléfono vinculado (solo si el
 *    pedido declara teléfono y el cupón fue emitido PARA otro teléfono; un
 *    pedido de mesa sin teléfono no queda bloqueado).
 *  - NO aplica descuentos (eso es `resolveCouponDiscount` en orderMoney.js);
 *    NO persiste (eso es la capa de servicio, ledger local + espejo webhooks
 *    de Supabase); NO toca el payload público (los códigos NUNCA viajan al
 *    menú — ver sanitizeRestaurant + menuResponse).
 *
 * Invariantes honrados (los mismos de la casa):
 *  - Cupón desconocido/inválido → el checkout lo descarta SIN romper el
 *    pedido (disuento 0; el comensal paga el total real de los platos).
 *  - Un solo uso por código; el registro audita quién lo usó (teléfono
 *    enmascarado en la capa de presentación, crudo SOLO en el ledger privado).
 */
'use strict';

const RECOVERY_COUPON_TYPES = ['percent', 'free_delivery'];

// Alfabeto sin caracteres ambiguos (sin 0/O, 1/I/L, 5/S): humano-legible en
// el email y de espacio suficiente para que el brute force no sea viable.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_BODY_LENGTH = 8;
const CODE_PREFIX = 'VOL';
const CODE_LABEL = 'Vuelve a pedir';

// Vida útil fija (anti-abuso, sin configuración dueño): 14 días.
const DEFAULT_TTL_DAYS = 14;

// Tope del ledger por instancia (que el plan free no crezca sin cota).
const MAX_COUPONS_PER_RESTAURANT = 50;

// Ofertas prédiseñadas del bloque cero-touch del Studio (2 clics).
const RECOVERY_OFFERS = [
  { discountType: 'percent', discountValue: 10, label: '10% OFF' },
  { discountType: 'percent', discountValue: 15, label: '15% OFF' },
  { discountType: 'free_delivery', discountValue: 0, label: 'Envío gratis' }
];

function generateCouponCodeNow(randomSource) {
  const rnd = typeof randomSource === 'function' ? randomSource : Math.random;
  let body = '';
  for (let i = 0; i < CODE_BODY_LENGTH; i++) {
    body += CODE_ALPHABET[Math.floor(rnd() * CODE_ALPHABET.length)];
  }
  return `${CODE_PREFIX}-${body}`;
}

/**
 * buildRecoveryCoupon — construye la fila del ledger.
 * @param {object} opts                                  — ver abajo.
 * @param {'percent'|'free_delivery'} opts.discountType
 * @param {number} opts.discountValue                    — clamp 5..50 para percent.
 * @param {number} [opts.createdAtMs]                    — inyectable (tests).
 * @param {number} [opts.ttlDays]                        — default 14.
 * @param {Function} [opts.randomSource]                 — inyectable (tests).
 * @param {string} [opts.boundPhone]                     — E.164 del destinatario (campaign → vacío).
 * @param {string} [opts.id]                             — id inyectable.
 */
function buildRecoveryCoupon({
  discountType,
  discountValue,
  createdAtMs,
  ttlDays,
  randomSource,
  boundPhone,
  id
}) {
  if (!RECOVERY_COUPON_TYPES.includes(discountType)) return null;
  const createdAt = Number.isFinite(createdAtMs) ? createdAtMs : Date.now();
  const value = discountType === 'percent'
    ? Math.min(50, Math.max(5, Math.round(Number(discountValue) || 0)))
    : 0;
  const ttl = Math.max(1, Number(ttlDays) || DEFAULT_TTL_DAYS);
  const code = generateCouponCodeNow(randomSource);
  const cleanPhone = typeof boundPhone === 'string' ? boundPhone.trim() : '';
  return {
    id: typeof id === 'string' && id ? id : null,
    code,
    source: 'winback',
    type: discountType,
    value,
    label: discountType === 'percent' ? `${value}% OFF` : 'Envío Gratis',
    offerLabel: RECOVERY_OFFERS.find(o => o.discountType === discountType && o.discountValue === value)?.label || CODE_LABEL,
    boundPhone: cleanPhone || null,
    createdAtMs: createdAt,
    createdAt: new Date(createdAt).toISOString(),
    expiresAt: new Date(createdAt + ttl * 24 * 60 * 60 * 1000).toISOString(),
    usedAt: null,
    usedByPhone: null,
    usedOrderId: null
  };
}

/** Normaliza el código tal como lo escribe el comensal (trim + mayúsculas). */
function normalizeCouponCode(code) {
  return String(code || '').trim().toUpperCase();
}

/** Busca la fila del ledger por código (case-insensitive). */
function findCouponByCode(rows, code) {
  const wanted = normalizeCouponCode(code);
  if (!wanted) return null;
  return (Array.isArray(rows) ? rows : []).find(r => normalizeCouponCode(r.code) === wanted) || null;
}

/**
 * isValidRecoveryCoupon — SOLO la semántica de vigencia (percentage/free va en money).
 * @returns {true | 'EXPIRED' | 'ALREADY_USED' | 'NOT_FOR_THIS_PHONE' | 'MALFORMED'}
 */
function isValidRecoveryCoupon(row, { nowMs, phone } = {}) {
  if (!row || typeof row !== 'object' || !row.code || !row.expiresAt) return 'MALFORMED';
  if (row.usedAt) return 'ALREADY_USED';
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  if (Date.parse(row.expiresAt) <= at) return 'EXPIRED';
  if (row.boundPhone && phone) {
    const p = String(phone).trim();
    if (p && normalizeCouponCode(p) !== normalizeCouponCode(row.boundPhone)) {
      return 'NOT_FOR_THIS_PHONE';
    }
  }
  return true;
}

/**
 * resolveRecoveryCouponValue — la fila EN FORMA DE configura de catálogo de
 * money (customCoupons shape) para que `resolveCouponDiscount` la resuelva
 * con la MISMA lógica clampada. Si el row no es válido, devuelve null
 * (descuento 0 — el pedido sigue, sin romper).
 */
function toCatalogShape(row) {
  if (!row || typeof row.code !== 'string') return null;
  return {
    code: row.code,
    type: RECOVERY_COUPON_TYPES.includes(row.type) ? row.type : 'percent',
    value: Number(row.value) || 0,
    label: row.label || row.offerLabel || CODE_LABEL
  };
}

/**
 * purgeRecoveryCoupons — recorta el ledger: descarta usados/expirados viejos
 * y conserva los más recientes. NO muta el array de entrada (devuelve uno nuevo).
 */
function purgeRecoveryCoupons(rows, { keepTotal = MAX_COUPONS_PER_RESTAURANT, keepUsed = 20, nowMs } = {}) {
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const live = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false;
    return !r.usedAt && Date.parse(r.expiresAt) > at;
  });
  const retired = (Array.isArray(rows) ? rows : []).filter((r) => {
    if (!r) return false;
    return r.usedAt || Date.parse(r.expiresAt) <= at;
  });
  return live.concat(retired.slice(-keepUsed)).slice(-keepTotal);
}

/**
 * summarizeRecoveryCoupons — resumen cero-touch para el Studio (data ya local).
 * Devuelve métricas honestas del catálogo de recupero del local.
 */
function summarizeRecoveryCoupons(rows, { nowMs } = {}) {
  const at = Number.isFinite(nowMs) ? nowMs : Date.now();
  const all = Array.isArray(rows) ? rows : [];
  const used = all.filter(r => r && r.usedAt);
  const live = all.filter(r => r && !r.usedAt && Date.parse(r.expiresAt) > at);
  return {
    total: all.length,
    liveCount: live.length,
    usedCount: used.length,
    expiredCount: all.length - live.length - used.length,
    nextExpiry: live.length ? live[0].expiresAt : null
  };
}

module.exports = {
  RECOVERY_COUPON_TYPES,
  RECOVERY_OFFERS,
  CODE_ALPHABET,
  CODE_BODY_LENGTH,
  MAX_COUPONS_PER_RESTAURANT,
  DEFAULT_TTL_DAYS,
  generateCouponCodeNow,
  buildRecoveryCoupon,
  normalizeCouponCode,
  findCouponByCode,
  isValidRecoveryCoupon,
  toCatalogShape,
  purgeRecoveryCoupons,
  summarizeRecoveryCoupons
};
