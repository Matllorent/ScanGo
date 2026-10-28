const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../../src/db/db');
const { getSupabaseClient } = require('../utils/supabase');
const { successResponse, errorResponse } = require('../utils/response');
const { validateBody, validateRequest, createOrderSchema } = require('../middleware/validation');
const idempotencyMiddleware = require('../middleware/idempotency');
const { tenantGuard } = require('../middleware/tenantGuard');
const { authenticateRequest } = require('../middleware/auth');
const { isCaptchaEnforced, verifyTurnstile } = require('../utils/captcha');
const AppError = require('../utils/AppError');
const sentry = require('../utils/sentry');
const logger = require('../utils/logger');
const { groupCartLimiter } = require('../middleware/rateLimits');
const { verifyGroupCartToken } = require('../utils/groupCartToken');
const { computeOpenStatus } = require('../utils/openStatus');
const { quoteOrderItems, resolveDeliveryFee, resolveCouponDiscount } = require('../utils/orderMoney');
const { z } = require('zod');
const loyaltyService = require('../services/loyalty');
const recoveryCoupons = require('../utils/recoveryCoupons');
const notificationsService = require('../services/notifications');
const { getPrepEstimateBundleForRestaurant } = require('../services/prepEstimate');
const { prepModeForOrder } = require('../utils/prepEstimate');
const { signOrderToken, verifyOrderToken } = require('../utils/orderTrackingToken');
const auditService = require('../services/audit');
const { resolveOptionalStaff } = require('../middleware/staffAuth');

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_menu_pizarron_2026';

// Estados del pedido que el dueño puede fijar y que el comensal ve en su
// seguimiento. Las etiquetas viajan en español para la vista pública.
const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'on_the_way', 'delayed', 'delivered', 'cancelled'];
const ORDER_STATUS_LABELS = {
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
 * Auth middleware inline (mirrors api/index.js) to protect order routes.
 * Verifies JWT from cookie or Authorization header and attaches req.user.
 */
function requireAuth(req, res, next) {
  try {
    req.user = authenticateRequest(req);
    next();
  } catch (e) {
    const status = (e && typeof e.statusCode === 'number') ? e.statusCode : 401;
    return res.status(status).json({ success: false, error: (e && e.message) || 'Token inválido o expirado', code: (e && e.code) || 'INVALID_TOKEN' });
  }
}

function requireGroupCartCapability(req, res, next) {
  const { restaurantId, tableNumber } = req.params;
  const token = req.headers['x-group-cart-token'];
  if (!verifyGroupCartToken(restaurantId, tableNumber, token)) {
    return res.status(403).json({ success: false, error: 'QR de mesa no autorizado', code: 'GROUP_CART_TOKEN_INVALID' });
  }
  next();
}



/**
 * Busca un pedido para seguimiento: primero el espejo local (dev/offline) y
 * luego la tabla `orders` de Supabase (fuente de verdad cloud).
 */
async function findOrderForTracking(orderId) {
  const local = db.findOrderById(orderId);
  if (local) return local;
  const supabase = getSupabaseClient();
  if (supabase) {
    try {
      const { data, error } = await supabase.from('orders').select('*').eq('id', orderId).limit(1);
      if (!error && Array.isArray(data) && data[0]) return data[0];
    } catch (e) { /* seguimiento nunca rompe por un error de lectura */ }
  }
  return null;
}

router.post('/quote', validateBody(createOrderSchema), (req, res, next) => {
  try {
    const restaurant = db.findRestaurantById(req.body.restaurantId) || db.findRestaurantBySlug(req.body.restaurantId);
    if (!restaurant) throw new AppError('Restaurante no encontrado para la cotización', 404, 'RESTAURANT_NOT_FOUND');
    const quote = quoteOrderItems(restaurant, req.body.items);
    enforceOrderBusinessRules({
      restaurant,
      subtotal: quote.amountInCents / 100,
      orderMode: req.body.orderMode,
      deliveryAddress: req.body.deliveryAddress,
      utcOffsetMinutes: req.body.utcOffsetMinutes
    });
    return successResponse(res, {
      ...quote,
      amount: quote.amountInCents / 100,
      currency: req.body.currency || restaurant.currency || '$'
    }, 'Cotización validada');
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/orders/coupon/validate
 * Público: el comensal valida un código ANTES de armar el pedido. Antes el
 * checkout solo comparaba contra `restaurant.customCoupons` (el catálogo
 * público del dueño): un cupón de recupero `VOL-XXXXXXXX` —privado por
 * diseño— se rechazaba en el navegador y nunca llegaba al servidor, así que
 * era imposible canjearlo. Acá se resuelve contra las DOS fuentes:
 * catálogo público + ledger privado de recupero, con veredicto honesto
 * (vencido / ya usado / de otro teléfono) y SIN consumir el código.
 * La autoridad final sigue en POST /api/orders (claim atómico).
 */
const couponValidateSchema = z.object({
  restaurantId: z.string().min(1, { message: 'ID de restaurante requerido' }),
  code: z.string().min(1, { message: 'Ingresá el código del cupón' }).max(40),
  phone: z.string().max(30).optional().default(''),
  orderMode: z.enum(['LOCAL', 'DELIVERY', 'TAKEAWAY']).optional().default('LOCAL')
});

router.post('/coupon/validate', validateBody(couponValidateSchema), async (req, res, next) => {
  try {
    const restaurant = db.findRestaurantById(req.body.restaurantId) || db.findRestaurantBySlug(req.body.restaurantId);
    if (!restaurant) throw new AppError('Restaurante no encontrado', 404, 'RESTAURANT_NOT_FOUND');

    const code = recoveryCoupons.normalizeCouponCode(req.body.code);
    const phone = String(req.body.phone || '').trim();

    // 1) Catálogo PÚBLICO del dueño (sin vencimiento ni teléfono: su diseño).
    const custom = (Array.isArray(restaurant.customCoupons) ? restaurant.customCoupons : [])
      .find((row) => recoveryCoupons.normalizeCouponCode(row && row.code) === code);
    if (custom) {
      const type = custom.type === 'free_delivery' ? 'free_delivery' : 'percent';
      const value = type === 'percent' ? Math.min(100, Math.max(0, Number(custom.value) || 0)) : 0;
      // Envío gratis solo aplica a delivery (misma regla que el pricing).
      if (type === 'free_delivery' && req.body.orderMode !== 'DELIVERY') {
        return successResponse(res, {
          valid: false,
          reason: 'NOT_APPLICABLE',
          message: 'Tu cupón es de envío gratis: elegí delivery para usarlo.',
          coupon: null
        }, 'Cupón validado');
      }
      return successResponse(res, {
        valid: true,
        reason: null,
        message: '',
        source: 'custom',
        coupon: { code: custom.code, type, value, label: custom.label || (type === 'percent' ? `${value}% OFF` : 'Envío Gratis') }
      }, 'Cupón válido');
    }

    // 2) Ledger PRIVADO de recupero (el código personal que salió por email,
    // push o WhatsApp). Nunca viaja al payload del menú.
    let row = null;
    try {
      row = recoveryCoupons.findCouponByCode(await loyaltyService.listRecoveryCoupons(restaurant.id), code);
    } catch (e) {
      logger.warn('[orders] ledger de cupones de recupero ilegible (validate)', { restaurantId: restaurant.id, error: e.message });
      return successResponse(res, {
        valid: false,
        reason: 'UNAVAILABLE',
        message: 'No pudimos verificar el cupón ahora. Reintentá en un momento.',
        coupon: null
      }, 'Cupón no verificado');
    }
    const verdict = recoveryCoupons.describeRecoveryCoupon(row, { phone, orderMode: req.body.orderMode });
    return successResponse(res, {
      valid: verdict.valid,
      reason: verdict.reason,
      message: verdict.message,
      source: row ? 'recovery' : null,
      coupon: verdict.coupon
    }, verdict.valid ? 'Cupón válido' : 'Cupón no aplicable');
  } catch (error) {
    next(error);
  }
});

/**
 * Reglas de negocio autoritativas (anti-pedido-inservible):
 * - Pedido mínimo del local (restaurant.minOrder) sobre el subtotal.
 * - Delivery exige dirección de entrega.
 * Se aplica en /quote, POST / y /mercadopago/preference por igual.
 */
/**
 * Autoridad server-side de abierto/cerrado (espejo de `isRestaurantOpenNow`
 * en public/js/menu/openStatus.js): el reloj del navegador no es la única
 * fuente. El cliente manda su `utcOffsetMinutes` y acá se recalcula la hora
 * local del local (UTC + offset) contra `scheduleActiveHours`. `forceClosed
 * === true` gana siempre. Sin horario configurado → abierto.
 *
 * La decisión vive en `computeOpenStatus` (api/utils/openStatus.js, puro):
 * `nowMs` inyectable permite congelar el reloj en la tabla de decisión de
 * tests/test-business-hours.js sin sleeps ni mocks (default: el real).
 */
function assertRestaurantOpen(restaurant, utcOffsetMinutes = 0, nowMs = Date.now()) {
  const status = computeOpenStatus(restaurant, utcOffsetMinutes, nowMs);
  if (status.open) return;
  if (status.reason === 'closed_force') {
    throw new AppError(
      'El local está cerrado por el momento. Volvé a consultar en unos minutos.',
      400,
      'RESTAURANT_CLOSED'
    );
  }
  throw new AppError(
    `El local está cerrado a esta hora (${status.hours} hs). Volvé en horario de atención.`,
    400,
    'RESTAURANT_CLOSED'
  );
}

function enforceOrderBusinessRules({ restaurant, subtotal, orderMode, deliveryAddress, utcOffsetMinutes }) {
  // Carta vitrina: el dueño muestra los platos sin aceptar pedidos (ni por
  // WhatsApp ni online). Mismo patrón que ONLINE_PAYMENT_DISABLED.
  if (restaurant.allowMenuOrders === false) {
    throw new AppError('Este local muestra su carta sin aceptar pedidos por el momento.', 403, 'MENU_ORDERS_DISABLED');
  }
  const minOrder = Number(restaurant.minOrder) || 0;
  if (minOrder > 0 && Number(subtotal) < minOrder) {
    throw new AppError(
      `Pedido mínimo de ${restaurant.currency || '$'} ${minOrder}. Agregá más platos para continuar.`,
      400,
      'MIN_ORDER_NOT_MET'
    );
  }
  if (orderMode === 'DELIVERY' && !String(deliveryAddress || '').trim()) {
    throw new AppError('Indicá la dirección de entrega para el delivery.', 400, 'DELIVERY_ADDRESS_REQUIRED');
  }
  assertRestaurantOpen(restaurant, utcOffsetMinutes);
}

/** quoteOrderItems / resolveDeliveryFee / resolveCouponDiscount viven en ../utils/orderMoney (Bloque 2). */

/**
 * F8-v2 — canje REAL del cupón de recupero (el `VOL-XXXXXXXX` que sale por
 * email/push/WhatsApp). `resolveCouponDiscount` es PURO y solo aplica un cupón
 * de recupero si (a) la fila está en el catálogo privado vigente Y (b) el
 * código figura en `claimedCodes`. Acá se resuelve la fila del ledger, se
 * valida (expiración / uso único / teléfono vinculado) y —solo en el pedido
 * real— se reclama ATÓMICAMENTE antes de cobrar.
 *
 * @param {boolean} claim  false = validar sin consumir (preferencia de pago);
 *                         true  = reclamar (el llamador finaliza o libera).
 * @returns {Promise<{rows: object[], claimedCodes: string[], claimed: object|null, rejected: object|null}>}
 *  - `rows`/`claimedCodes` van al pricing (ver resolveCouponDiscount).
 *  - `rejected` = veredicto honesto SOLO cuando el código EXISTE en el ledger
 *    del local pero no se puede usar (vencido / usado / otro teléfono). Un
 *    código desconocido mantiene el comportamiento histórico: sin descuento,
 *    sin romper el pedido (el cliente lo valida antes por /coupon/validate).
 */
async function resolveRecoveryCouponForCheckout({ restaurant, coupon, phone, orderMode, claim = false }) {
  const code = coupon && coupon.code ? recoveryCoupons.normalizeCouponCode(coupon.code) : '';
  if (!code) return { rows: [], claimedCodes: [], claimed: null, rejected: null };

  let row = null;
  try {
    row = recoveryCoupons.findCouponByCode(await loyaltyService.listRecoveryCoupons(restaurant.id), code);
  } catch (e) {
    // Fail-open honesto: sin ledger legible el cupón se comporta como
    // desconocido (nunca se cobra de más por un error de infraestructura y
    // nunca se regala un descuento sin evidencia).
    logger.warn('[orders] ledger de cupones de recupero ilegible', { restaurantId: restaurant.id, error: e.message });
    return { rows: [], claimedCodes: [], claimed: null, rejected: null };
  }
  if (!row) return { rows: [], claimedCodes: [], claimed: null, rejected: null };

  // Aplicabilidad ANTES de reclamar: un cupón de envío gratis pedido en mesa
  // no descuenta nada (el fee solo existe en DELIVERY) y, si se reclamara
  // primero, se quemaría sin beneficio para el comensal.
  const preVerdict = recoveryCoupons.describeRecoveryCoupon(row, { phone, orderMode });
  if (!preVerdict.valid) {
    return { rows: [], claimedCodes: [], claimed: null, rejected: preVerdict };
  }

  if (!claim) {
    return { rows: [row], claimedCodes: [code], claimed: null, rejected: null };
  }

  const result = await loyaltyService.claimRecoveryCoupon({ restaurantId: restaurant.id, code, phone });
  if (!result || !result.row || result.reason) {
    const verdict = recoveryCoupons.describeRecoveryCoupon(result && result.row ? result.row : row, { phone, orderMode });
    return { rows: [], claimedCodes: [], claimed: null, rejected: verdict };
  }
  // Se pasa la fila PRE-claim al pricing: el claim ya marcó usedAt y
  // catalogRecoveryRows filtra las filas no vigentes (el permiso real de
  // descuento es `claimedCodes`, validado atómicamente arriba).
  return { rows: [row], claimedCodes: [code], claimed: row, rejected: null };
}

/** Traduce el veredicto del cupón a un AppError honesto (409 usado / 422 resto). */
function recoveryCouponRejectionError(rejected) {
  if (!rejected) return null;
  const status = rejected.reason === 'ALREADY_USED' ? 409 : 422;
  return new AppError(rejected.message, status, `COUPON_${rejected.reason}`);
}

/**
 * POST /api/orders
 * Creates a new order with monetary precision and historical item snapshots
 */
router.post('/', idempotencyMiddleware, validateBody(createOrderSchema), async (req, res, next) => {
  let pendingCouponClaim = null;
  try {
    const { restaurantId, tableNumber, items, currency, customerName, customerPhone, deliveryAddress, notes, tipAmount, captchaToken, orderMode, deliveryFee } = req.body;

    // ── Comandero (Fase 2 del Sistema de Mozos) ──────────────────────────────
    // Si el request trae un Bearer de TURNO válido, el pedido se atribuye al
    // mozo (source='staff' + waiter_id de la SESIÓN + mesa asignada). Sin
    // header Authorization es un comensal como siempre. Con un token de turno
    // inválido → 401 fail-closed: un mozo con el QR vencido NUNCA se degrada
    // a comensal silenciosamente (creería que quedó firmado y no es así).
    const staffResult = await resolveOptionalStaff(req);
    if (!staffResult.ok) {
      return res.status(401).json({
        success: false,
        error: 'Tu turno venció o no es válido. Escaneá el QR de turno de nuevo.',
        code: staffResult.code
      });
    }
    const staffCtx = staffResult.ctx;

    // Anti-spam/farming (Turnstile invisible): solo cuando el despliegue lo
    // configuró. Sin secreto no se exige nada (flujo actual intacto). El
    // comandero lo salta: hay una sesión de turno verificada detrás.
    if (isCaptchaEnforced() && !staffCtx) {
      const captcha = await verifyTurnstile(captchaToken, req.ip);
      if (!captcha.ok) {
        return res.status(403).json({
          success: false,
          error: captcha.reason === 'CAPTCHA_REQUIRED'
            ? 'Verificá que no sos un robot para enviar el pedido'
            : 'Verificación de seguridad fallida. Reintentá el pedido.',
          code: captcha.reason || 'CAPTCHA_INVALID'
        });
      }
    }

    const restaurant = db.findRestaurantById(restaurantId) || db.findRestaurantBySlug(restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurante no encontrado para el pedido', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Aislamiento del turno: el QR de un mozo solo comanda su PROPIO local.
    // Un token de staff válido contra otro restaurante es un uso erróneo del
    // QR (o un intento de atribución cruzada) → 403 explícito.
    if (staffCtx && staffCtx.restaurant.id !== restaurant.id) {
      throw new AppError('Tu turno no pertenece a este local.', 403, 'STAFF_RESTAURANT_MISMATCH');
    }
    if (staffCtx) {
      if (staffCtx.staff.role !== 'waiter') {
        throw new AppError('Solo un mozo puede comandar pedidos de mesa.', 403, 'STAFF_ROLE_NOT_ALLOWED');
      }
      const assignments = restaurant.tableAssignments && typeof restaurant.tableAssignments === 'object'
        ? restaurant.tableAssignments
        : {};
      if (assignments[String(tableNumber)] !== staffCtx.staff.id) {
        throw new AppError('Esa mesa no está asignada a tu turno.', 403, 'TABLE_NOT_ASSIGNED');
      }
    }

    const orderCurrency = currency || restaurant.currency || 'USD';
    const utcNow = new Date().toISOString();

    const { itemsSnapshot, amountInCents } = quoteOrderItems(restaurant, items, utcNow);

    // Reglas autoritativas: pedido mínimo, dirección de delivery y abierto/cerrado.
    enforceOrderBusinessRules({
      restaurant,
      subtotal: amountInCents / 100,
      orderMode,
      deliveryAddress,
      utcOffsetMinutes: req.body.utcOffsetMinutes
    });

    // Totales canónicos server-side (lo que se cobra y se muestra en
    // seguimiento/vivo): platos + envío validado − cupón validado + propina.
    // `amount` conserva el subtotal de platos (no distorsiona analytics).
    const validDeliveryFee = resolveDeliveryFee(restaurant, orderMode, deliveryFee);
    // F8-v2: un cupón de recupero se RESUELVE contra el ledger privado y se
    // reclama atómicamente antes de cobrar (el catálogo público del dueño lo
    // resuelve el pricing puro como siempre). Un código existente pero no
    // usable devuelve un error honesto en vez de cobrar el total en silencio.
    const recovery = await resolveRecoveryCouponForCheckout({
      restaurant,
      coupon: req.body.coupon,
      phone: customerPhone,
      orderMode,
      claim: true
    });
    const rejection = recoveryCouponRejectionError(recovery.rejected);
    if (rejection) throw rejection;
    if (recovery.claimed) {
      // Claim provisional: si el pedido no llega a existir, el catch lo suelta
      // (un cupón no puede quedar quemado por un fallo de escritura).
      pendingCouponClaim = { code: recovery.claimed.code, restaurantId: restaurant.id };
    }
    const pricingRestaurant = recovery.rows.length
      ? { ...restaurant, recoveryCoupons: recovery.rows }
      : restaurant;
    const { discount: validDiscount, coupon: validCoupon } = resolveCouponDiscount({
      restaurant: pricingRestaurant,
      subtotal: amountInCents / 100,
      deliveryFee: validDeliveryFee,
      coupon: req.body.coupon,
      orderMode,
      phone: customerPhone,
      claimedCodes: recovery.claimedCodes
    });
    const validTip = Math.max(0, Number(tipAmount) || 0);
    const canonicalTotal = Math.max(0, Math.round((amountInCents / 100 + validDeliveryFee - validDiscount + validTip) * 100) / 100);

    const orderRecord = {
      id: 'ord_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      restaurant_id: restaurant.id,
      restaurantId: restaurant.id,
      table_number: String(tableNumber),
      tableNumber: String(tableNumber),
      // Modalidad del pedido (F0 del bloque Mozos/Cocina): la cocina necesita
      // saber si sale para salón, delivery o mostrador. Se persiste en local y
      // en cloud (`orders.order_mode`, migración 009) para que el KDS la pinte
      // sin inferirla del tableNumber (un delivery puede mandar mesa "0").
      order_mode: orderMode,
      orderMode: orderMode,
      // Atribución SERVER-SIDE (migración 010: waiter_id/table_id/source).
      // Jamás la decide el client: Zod strippea esos campos del body y lo que
      // vale acá sale de la sesión de turno (o 'customer' si no hay turno).
      // `table_id` guarda el número de la mesa asignada (las mesas viven en
      // restaurant.tableAssignments, que keyea por número).
      source: staffCtx ? 'staff' : 'customer',
      ...(staffCtx ? {
        waiter_id: staffCtx.staff.id,
        waiterId: staffCtx.staff.id,
        table_id: String(tableNumber),
        tableId: String(tableNumber)
      } : {}),
      items_snapshot: itemsSnapshot,
      itemsSnapshot: itemsSnapshot,
      amount: amountInCents / 100,
      total: canonicalTotal,
      amount_in_cents: amountInCents,
      currency: orderCurrency,
      status: 'pending',
      customer_name: customerName,
      customer_phone: customerPhone,
      delivery_address: deliveryAddress,
      notes: notes,
      is_group_order: Boolean(req.body.isGroupOrder),
      isGroupOrder: Boolean(req.body.isGroupOrder),
      participants: req.body.participants || [],
      group_session_id: req.body.groupSessionId || '',
      // Cupón VALIDADO contra el catálogo (el del cliente se ignora si no
      // existe: el descuento guardado es siempre el real).
      coupon: validCoupon,
      delivery_fee: validDeliveryFee,
      deliveryFee: validDeliveryFee,
      discount_amount: validDiscount,
      discountAmount: validDiscount,
      tip_amount: validTip,
      tipAmount: validTip,
      created_at: utcNow
    };

    // Token de seguimiento SIN estado (HMAC del id): el comensal lo guarda y
    // con él consulta el estado sin exponer datos personales.
    orderRecord.trackingToken = signOrderToken(orderRecord.id);

    // Espejo local (dev/offline). En cloud la fuente de verdad es Supabase.
    await db.addOrder(orderRecord);
    // El pedido ya existe: el claim deja de ser "provisional" (el catch no lo
    // suelta). La concreción con orderId viene después, best-effort.
    pendingCouponClaim = null;

    // F8-v2: el pedido YA existe → el claim provisional se concreta con su id
    // (la telemetría de recupero atribuye el ingreso por este orderId). Es
    // best-effort: si falla, el cupón queda usado igual (lo importante es que
    // no se pueda volver a usar) y el pedido no se pierde.
    if (recovery.claimed) {
      try {
        await loyaltyService.finalizeRecoveryClaim({
          restaurantId: restaurant.id,
          code: recovery.claimed.code,
          orderId: orderRecord.id,
          phone: customerPhone
        });
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.winbackFinalize',
          level: 'warn',
          tags: { restaurantId: restaurant.id },
          extra: { couponCode: recovery.claimed.code, orderId: orderRecord.id }
        });
      }
    }

    // Save to Supabase Cloud PostgreSQL (mapeo canónico en db.toCloudOrder).
    // Si el insert falla, el pedido queda marcado `cloudPending`: se responde
    // 201 igual (el comensal no debe sufrir un hipo de red), pero el registro
    // SE REPARA (boot) y el dueño lo ve igual (GET lo fusiona). Antes se
    // respondía 201 y el pedido quedaba invisible para siempre.
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const res = await db.insertCloudOrder(orderRecord);
        if (!res.ok && !res.skipped) throw new Error(res.error || 'cloud insert failed');
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.insert',
          level: 'warn',
          tags: { restaurantId: restaurant.id },
          extra: { orderId: orderRecord.id }
        });
        await db.markOrderCloudPending(orderRecord.id).catch(() => {});
      }
    }

    // Fidelización: acreditación automática de puntos/sellos (local + global).
    // El servicio captura sus propios errores: un problema aquí JAMÁS rompe el
    // alta del pedido ni la respuesta al comensal.
    const loyaltyResult = await loyaltyService.creditOrder({
      restaurant,
      customerPhone,
      customerName,
      orderId: orderRecord.id,
      amountInCents
    });
    if (loyaltyResult.credited) {
      orderRecord.loyalty = {
        credited: true,
        points: loyaltyResult.points,
        stamps: loyaltyResult.stamps,
        unlocks: loyaltyResult.unlocks
      };
    }

    return successResponse(
      res,
      orderRecord,
      'Pedido registrado exitosamente con snapshot histórico de precios',
      201
    );
  } catch (err) {
    if (pendingCouponClaim) {
      try {
        await loyaltyService.releaseRecoveryClaim({
          restaurantId: pendingCouponClaim.restaurantId,
          code: pendingCouponClaim.code
        });
      } catch (releaseErr) {
        sentry.captureException(releaseErr, {
          source: 'orders.winbackRelease',
          level: 'warn',
          extra: { couponCode: pendingCouponClaim.code, originalError: err.message }
        });
      }
    }
    next(err);
  }
});

/**
 * GET /api/orders/track/:token
 * Público: el comensal consulta el estado de su pedido con el token firmado
 * que recibió al pedir. Devuelve SOLO estado + resumen — nunca teléfono,
 * nombre, dirección ni notas.
 */
router.get('/track/:token', async (req, res, next) => {
  try {
    const orderId = verifyOrderToken(req.params.token);
    if (!orderId) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }
    const order = await findOrderForTracking(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    const orderRestaurantId = order.restaurant_id || order.restaurantId;
    const restaurant = db.findRestaurantById(orderRestaurantId);
    const status = ORDER_STATUSES.includes(order.status) ? order.status : 'pending';

    // F7/F7-v2: cuánto tardan los pedidos de este local — la estimación
    // general y la de la modalidad del pedido (null si aún no hay muestra
    // suficiente o el dueño lo apagó). Es un número del LOCAL, sin PII.
    let prepBundle = null;
    try {
      prepBundle = await getPrepEstimateBundleForRestaurant(restaurant);
    } catch (prepErr) {
      prepBundle = null;
    }
    const prepEstimate = prepBundle ? prepBundle.all : null;
    const prepEstimateByMode = prepBundle ? prepBundle.byMode : null;

    return successResponse(res, {
      orderId: order.id,
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
      restaurantName: restaurant ? (restaurant.name || restaurant.bizName || '') : '',
      tableNumber: order.table_number || order.tableNumber || '',
      currency: order.currency || '$',
      // Total canónico (platos + envío − cupón + propina). Pedidos viejos
      // solo traen `amount` (platos): se usa como fallback.
      total: order.total != null ? order.total : order.amount,
      subtotal: order.amount != null ? order.amount : order.total,
      deliveryFee: Number(order.delivery_fee != null ? order.delivery_fee : (order.deliveryFee || 0)) || 0,
      discount: Number(order.discount_amount != null ? order.discount_amount : (order.discountAmount || 0)) || 0,
      // Propina opcional declarada por el comensal (0 si no dejó).
      tip: Number(order.tip_amount != null ? order.tip_amount : (order.tipAmount || 0)) || 0,
      prepEstimate,
      // F7-v2: por modalidad + la modalidad canónica del pedido (migración
      // 009; filas históricas sin modo → LOCAL). Sin PII.
      prepEstimateByMode,
      orderMode: prepModeForOrder(order),
      items: (order.items_snapshot || order.itemsSnapshot || []).map(line => ({
        name: line.name,
        quantity: line.quantity
      })),
      updatedAt: order.status_updated_at || order.created_at
    }, 'Estado del pedido');
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/orders/status/:orderId
 * Dueño (tenant-guarded): avanza el estado del pedido. Persiste en el espejo
 * local + Supabase y avisa por push SOLO al comensal que hizo el pedido (por
 * teléfono). El push es best-effort: nunca rompe la actualización de estado.
 */
const orderStatusParamsSchema = z.object({
  orderId: z.string().min(1, { message: 'ID de pedido requerido' }).max(120)
});
const orderStatusBodySchema = z.object({
  status: z.string().min(1, { message: 'Estado requerido' }).max(30)
});
router.patch('/status/:orderId', requireAuth, tenantGuard, validateRequest({ params: orderStatusParamsSchema, body: orderStatusBodySchema }), async (req, res, next) => {
  try {
    const { orderId } = req.validatedParams;
    const { status } = req.validatedBody;

    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ success: false, error: 'Estado de pedido inválido', code: 'INVALID_ORDER_STATUS' });
    }

    const order = await findOrderForTracking(orderId);
    if (!order) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado', code: 'ORDER_NOT_FOUND' });
    }

    const orderRestaurantId = order.restaurant_id || order.restaurantId;
    const tenantId = req.tenantId || (req.user && req.user.tenantId);
    // Sin tenant propio no se puede operar (cierra el bypass de cuenta huérfana:
    // antes, tenantId falsy saltaba el chequeo y cualquiera mutaba el pedido).
    if (!tenantId) {
      return res.status(403).json({ success: false, error: 'Tu cuenta no tiene un local asociado', code: 'TENANT_REQUIRED' });
    }
    if (orderRestaurantId !== tenantId) {
      return res.status(403).json({ success: false, error: 'El pedido pertenece a otro local', code: 'ORDER_TENANT_MISMATCH' });
    }

    const updatedAt = new Date().toISOString();

    // 1) Espejo local
    const localUpdated = await db.updateOrderStatus(orderId, status, updatedAt);
    if (!localUpdated) {
      await db.addOrder({ ...order, status, status_updated_at: updatedAt });
    }

    // 2) Supabase (fuente de verdad cloud). Degrada si falta status_updated_at.
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error } = await supabase.from('orders')
          .update({ status, status_updated_at: updatedAt })
          .eq('id', orderId);
        if (error && /status_updated_at/i.test(error.message || '')) {
          await supabase.from('orders').update({ status }).eq('id', orderId);
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.updateStatus',
          level: 'warn',
          tags: { restaurantId: orderRestaurantId },
          extra: { orderId, status }
        });
      }
    }

    // 3) Aviso al comensal (best-effort; jamás rompe la actualización).
    let notification;
    try {
      const restaurant = db.findRestaurantById(orderRestaurantId);
      notification = await notificationsService.sendOrderStatusNotification({
        restaurantId: orderRestaurantId,
        customerPhone: order.customer_phone || order.customerPhone,
        status,
        orderId,
        slug: restaurant ? restaurant.slug : '',
        restaurantName: restaurant ? (restaurant.name || restaurant.bizName) : ''
      });
    } catch (e) {
      notification = { sent: false, error: e.code || e.message };
    }

    // Auditoría (fire-and-forget): quién movió qué pedido y de qué estado a cuál.
    auditService.logAction({
      tenantId: orderRestaurantId,
      userId: req.user && req.user.userId,
      requestId: req.requestId,
      action: 'ORDER_STATUS_CHANGE',
      entity: 'order',
      details: { orderId, from: order.status, to: status }
    });

    return successResponse(res, {
      orderId,
      status,
      statusLabel: ORDER_STATUS_LABELS[status],
      updatedAt,
      notification
    }, 'Estado del pedido actualizado');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/restaurant/:restaurantId
 * Retrieve orders for a restaurant (tenant-isolated, IDOR-protected).
 * El param es explícito (:restaurantId) porque tenantGuard ya no interpreta
 * el `:id` genérico como tenant (evita falsos 403 en rutas de recurso).
 */
/**
 * Comandero (Fase 2): los pedidos tomados por un mozo (source='staff', migración
 * 010) llevan el NOMBRE del mozo resuelto server-side para que el KDS y el
 * Studio muestren "por Marta" sin conocer ids del equipo. Lookup batch con
 * caché de proceso (60 s): el listado es la ruta más caliente del panel.
 * Falla silenciosa: sin staff legible el pedido se muestra sin chip (nunca
 * rompe el listado).
 */
const WAITER_NAME_CACHE_MS = 60 * 1000;
const waiterNameCache = new Map(); // restaurantId → { at, byId }

async function waiterNameMap(restaurantId) {
  const now = Date.now();
  const cached = waiterNameCache.get(restaurantId);
  if (cached && now - cached.at < WAITER_NAME_CACHE_MS) return cached.byId;
  let byId = new Map();
  try {
    const rows = await db.listStaff(restaurantId);
    byId = new Map((rows || []).filter((s) => s && s.id).map((s) => [s.id, s.name || 'Mozo']));
  } catch (e) {
    byId = new Map();
  }
  waiterNameCache.set(restaurantId, { at: now, byId });
  if (waiterNameCache.size > 200) {
    const oldest = waiterNameCache.keys().next().value;
    waiterNameCache.delete(oldest);
  }
  return byId;
}

async function attachWaiterNames(restaurantId, orders) {
  const list = Array.isArray(orders) ? orders : [];
  const staffIds = [...new Set(
    list
      .filter((o) => o && o.source === 'staff')
      .map((o) => o.waiter_id || o.waiterId || '')
      .filter(Boolean)
  )];
  if (!staffIds.length) return list;
  const byId = await waiterNameMap(restaurantId);
  if (!byId.size) return list;
  return list.map((o) => {
    if (!o || o.source !== 'staff') return o;
    const waiterId = o.waiter_id || o.waiterId || '';
    const name = byId.get(waiterId);
    return name ? { ...o, waiterName: name } : o;
  });
}

router.get('/restaurant/:restaurantId', requireAuth, tenantGuard, async (req, res, next) => {
  try {
    const restaurantId = req.params.restaurantId;
    // Aislamiento explícito a nivel handler (defensa en profundidad junto al
    // guard): solo el dueño del local (por id o slug) lista sus pedidos.
    const ownRestaurant = db.findRestaurantByUserId(req.user.userId);
    if (!ownRestaurant || (restaurantId !== ownRestaurant.id && restaurantId !== ownRestaurant.slug)) {
      return res.status(403).json({ success: false, error: 'El pedido pertenece a otro local', code: 'ORDER_TENANT_MISMATCH' });
    }
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('orders')
          .select('*')
          .eq('restaurant_id', restaurantId)
          .order('created_at', { ascending: false });

        if (!error && data && data.length > 0) {
          // Fusión outbox: pedidos solo-locales (insert cloud fallido) que la
          // nube todavía no tiene. Van marcados para que el dueño los distinga.
          const cloudIds = new Set(data.map(o => o && o.id));
          const pending = db.getCloudPendingOrders()
            .filter(o => (o.restaurant_id || o.restaurantId) === restaurantId && !cloudIds.has(o.id))
            .map(o => ({ ...o, cloudPending: true }));
          const merged = await attachWaiterNames(restaurantId, [...pending, ...data]);
          return successResponse(res, merged, 'Pedidos del restaurante recuperados');
        }
      } catch (e) {
        logger.warn('[Supabase Get Restaurant Orders]', { details: e.message, restaurantId });
      }
    }

    // Sin cloud (o sin filas todavía): espejo local ordenado por fecha.
    const localOrders = db.getOrders()
      .filter(o => (o.restaurant_id || o.restaurantId) === restaurantId)
      .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
    const merged = await attachWaiterNames(restaurantId, localOrders);
    return successResponse(res, merged, 'Pedidos del restaurante recuperados');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/mercadopago/preference
 * Genera una preferencia de pago directa de Mercado Pago Checkout Pro
 */
const mpService = require('../../src/services/mercadopago');

router.post('/mercadopago/preference', validateBody(createOrderSchema), async (req, res, next) => {
  try {
    const { restaurantId, items, customerName, currency, tipAmount, coupon, orderMode, deliveryFee, deliveryAddress } = req.body;
    const restaurant = db.findRestaurantById(restaurantId) || db.findRestaurantBySlug(restaurantId);
    if (!restaurant) {
      throw new AppError('Restaurante no encontrado para el pago', 404, 'RESTAURANT_NOT_FOUND');
    }

    // Vitrina primero: sin pedidos no hay nada que cobrar (antes que el gate
    // de pago online, para que el 403 sea el de vitrina aunque el pago esté OFF).
    if (restaurant.allowMenuOrders === false) {
      throw new AppError('Este local muestra su carta sin aceptar pedidos por el momento.', 403, 'MENU_ORDERS_DISABLED');
    }

    // El cobro online es SOLO una posibilidad que el dueño habilita. Sin el
    // interruptor, el endpoint no genera ninguna preferencia.
    if (restaurant.allowOnlinePayment !== true) {
      throw new AppError('El local no tiene habilitado el pago online', 403, 'ONLINE_PAYMENT_DISABLED');
    }

    const { itemsSnapshot, amountInCents } = quoteOrderItems(restaurant, items);
    const subtotal = amountInCents / 100;

    // Mismas reglas que el pedido: mínimo, dirección de delivery y abierto/cerrado.
    enforceOrderBusinessRules({ restaurant, subtotal, orderMode, deliveryAddress, utcOffsetMinutes: req.body.utcOffsetMinutes });

    // Total cobrado = platos + envío validado − cupón validado + propina.
    // (Antes solo iban los platos: se cobraba de menos y la propina se perdía.)
    const validDeliveryFee = resolveDeliveryFee(restaurant, orderMode, deliveryFee);
    // F8-v2: acá se VALIDA el cupón de recupero sin reclamarlo — pagar no es
    // canjear. El consumo real ocurre en POST /api/orders (claim atómico); si
    // se reclamara acá, el pedido posterior fallaría con ALREADY_USED. Un
    // código existente pero no usable se rechaza con el mismo error honesto
    // del pedido: nunca se cobra el total en silencio a quien cree tener un
    // descuento. Ventana conocida: dos pagos simultáneos con el mismo código
    // podrían generar dos preferencias; solo la primera orden lo consume.
    const recovery = await resolveRecoveryCouponForCheckout({
      restaurant,
      coupon,
      phone: req.body.customerPhone,
      orderMode,
      claim: false
    });
    const rejection = recoveryCouponRejectionError(recovery.rejected);
    if (rejection) throw rejection;
    const pricingRestaurant = recovery.rows.length
      ? { ...restaurant, recoveryCoupons: recovery.rows }
      : restaurant;
    const { discount, coupon: validCoupon } = resolveCouponDiscount({
      restaurant: pricingRestaurant,
      subtotal,
      deliveryFee: validDeliveryFee,
      coupon,
      orderMode,
      phone: req.body.customerPhone,
      claimedCodes: recovery.claimedCodes
    });
    const tip = Math.max(0, Number(tipAmount) || 0);
    const fullTotal = Math.max(0, Math.round((subtotal + validDeliveryFee - discount + tip) * 100) / 100);

    const orderCurrency = currency || restaurant.currency || 'UYU';
    const currencyId = ['UYU', '$U', '$'].includes(orderCurrency) ? 'UYU' : (orderCurrency === 'ARS' ? 'ARS' : 'USD');

    const mpItems = itemsSnapshot.map(item => {
      let desc = item.name;
      if (item.optionsSnapshot && item.optionsSnapshot.length) {
        const opts = item.optionsSnapshot.flatMap(g => (g.selections || []).map(s => s.name)).join(', ');
        if (opts) desc += ` (${opts})`;
      }
      return {
        id: item.dishId,
        title: `${item.quantity}x ${desc}`.slice(0, 255),
        quantity: 1,
        unit_price: item.totalItemAmount,
        currency_id: currencyId
      };
    });
    if (validDeliveryFee > 0) {
      mpItems.push({
        id: 'delivery',
        title: 'Costo de envío'.slice(0, 255),
        quantity: 1,
        unit_price: validDeliveryFee,
        currency_id: currencyId
      });
    }
    if (tip > 0) {
      mpItems.push({
        id: 'tip',
        title: 'Propina'.slice(0, 255),
        quantity: 1,
        unit_price: tip,
        currency_id: currencyId
      });
    }
    if (discount > 0) {
      mpItems.push({
        id: 'discount',
        title: `Descuento${validCoupon && validCoupon.code ? ` (${validCoupon.code})` : ''}`.slice(0, 255),
        quantity: 1,
        unit_price: -discount,
        currency_id: currencyId
      });
    }

    const externalRef = `ord_${Date.now()}_${restaurant.id.slice(0, 8)}`;
    const returnBase = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

    // Recién acá se exige MP configurado: el pedido ya se validó (404/403/
    // 400 honestos sin credenciales) y solo falta crearlo en Mercado Pago.
    if (!mpService.isConfigured()) {
      throw new AppError('Mercado Pago no está configurado en el servidor', 500, 'MP_NOT_CONFIGURED');
    }

    const preference = await mpService.createPreference({
      items: mpItems,
      payer: {
        name: customerName || 'Cliente ScanGo',
        email: 'pedido@scango.uy'
      },
      externalReference: externalRef,
      // El pedido del comensal es perecedero: 45 min para pagar, después el
      // link muere y no puede imputarse a un pedido viejo.
      expiresAt: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
      backUrls: {
        success: `${returnBase}/m/${restaurant.slug}?payment=success&ref=${externalRef}`,
        failure: `${returnBase}/m/${restaurant.slug}?payment=failure&ref=${externalRef}`,
        pending: `${returnBase}/m/${restaurant.slug}?payment=pending&ref=${externalRef}`
      },
      autoReturn: 'approved'
    });

    return successResponse(res, {
      preferenceId: preference.id,
      initPoint: preference.init_point,
      sandboxInitPoint: preference.sandbox_init_point,
      externalReference: externalRef,
      subtotal,
      deliveryFee: validDeliveryFee,
      discount,
      tip,
      total: fullTotal
    }, 'Preferencia de Checkout Pro generada exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/realtime-config
 * Proporciona credenciales públicas seguras para Supabase Realtime Channels.
 * NUNCA expone SUPABASE_SERVICE_ROLE_KEY — solo la anon key pública.
 */
router.get('/realtime-config', (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_ANON_KEY || '';
  return successResponse(res, {
    supabaseUrl,
    supabaseKey,
    enabled: Boolean(supabaseUrl && supabaseKey)
  }, 'Configuración de tiempo real recuperada');
});

/**
 * Almacén en memoria de pedidos grupales activos por mesa (fallback local)
 * Estructura: key = `${restaurantId}_mesa_${tableNumber}` -> { items: [], participants: [], updatedAt: string }
 */
const activeGroupTableCarts = new Map();

// TTL cleanup for active group carts (24h max age)
const GROUP_CART_TTL_MS = 24 * 60 * 60 * 1000;
function cleanupActiveGroupCarts() {
  const now = Date.now();
  for (const [key, cart] of activeGroupTableCarts.entries()) {
    if (cart.lastActivity && (now - cart.lastActivity > GROUP_CART_TTL_MS)) {
      activeGroupTableCarts.delete(key);
      logger.info('[GroupCart] Cleaned up expired cart', { key });
    }
  }
}
// Run cleanup every hour. `unref()` para que el timer no mantenga vivo el
// process en tests (que hacen require de api/index): sin esto, cualquier suite
// que lo importe se quedaba colgada para siempre después de pasar.
const groupCartCleanupTimer = setInterval(cleanupActiveGroupCarts, 60 * 60 * 1000);
if (typeof groupCartCleanupTimer.unref === 'function') groupCartCleanupTimer.unref();


/**
 * Genera el ID único del carrito grupal
 */
function getGroupCartId(restaurantId, tableNumber) {
  return `${restaurantId}_mesa_${tableNumber}`;
}

/**
 * Tombstones (IDs de items eliminados) de carritos grupales en memoria.
 * Clave: `tombstones:${getGroupCartId(restaurantId, tableNumber)}`.
 * Sirven para que un union-merge persistente NO resucite items borrados
 * por otro comensal. Se mantienen en memoria (TTL manual de 24h, igual que
 * activeGroupTableCarts) y se replican en la respuesta del sync para que el
 * cliente pueda purgar items locales fantasma.
 */
const activeGroupTableTombstones = new Map();
function cleanupActiveGroupTombstones() {
  const now = Date.now();
  for (const [key, entry] of activeGroupTableTombstones.entries()) {
    if (entry.expiresAt && now > entry.expiresAt) {
      activeGroupTableTombstones.delete(key);
    }
  }
}
const tombstoneCleanupTimer = setInterval(cleanupActiveGroupTombstones, 60 * 60 * 1000);
if (typeof tombstoneCleanupTimer.unref === 'function') tombstoneCleanupTimer.unref();

/**
 * Devuelve los tombstones actuales de un carrito (IDs de items eliminados).
 */
function tombstonesFor(key) {
  const entry = activeGroupTableTombstones.get(`tombstones:${key}`);
  return entry && Array.isArray(entry.ids) ? entry.ids : [];
}

/**
 * Devuelve un ID estable para un item del carrito grupal (clave de merge).
 */
function getCartItemId(item) {
  return item?.cartItemId || `cart_${item?.dish?.id || item?.dishId}_${item?.orderedById || 'anon'}`;
}

/**
 * Broadcast a un canal Supabase Realtime para notificar a los clientes de la
 * mesa. En vez de subscribe→send→unsubscribe por request (que en realtime-js
 * 2.x dispara RangeError: Maximum call stack size exceeded al encadenar
 * _schedulePendingDisconnect/_cancelPendingDisconnect), se mantiene un POOL de
 * canales persistentes: cada `channelName` se suscribe UNA vez y se reutiliza
 * para múltiples broadcasts, liberándose tras un período de inactividad.
 * `channel.send()` sin `subscribe()` previo NO envía nada (los paquetes se
 * encolan en un socket inexistente) — por eso el broadcast histórico del
 * server estaba completamente muerto.
 */
const serverBroadcastChannels = new Map(); // channelName -> { channel, lastUsedAt }
const BROADCAST_CHANNEL_IDLE_MS = 10 * 60 * 1000;

function cleanupServerBroadcastChannels() {
  const now = Date.now();
  for (const [channelName, entry] of serverBroadcastChannels.entries()) {
    if (now - entry.lastUsedAt > BROADCAST_CHANNEL_IDLE_MS) {
      try { entry.channel.unsubscribe(); } catch (e) { logger.warn('[GroupCart] Broadcast channel unsubscribe failed', { details: e.message, channelName }); }
      serverBroadcastChannels.delete(channelName);
    }
  }
}
const broadcastChannelCleanupTimer = setInterval(cleanupServerBroadcastChannels, 2 * 60 * 1000);
if (typeof broadcastChannelCleanupTimer.unref === 'function') broadcastChannelCleanupTimer.unref();

async function broadcastToTableChannel(supabase, channelName, event, payload) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      resolve(err);
    };

    let entry = serverBroadcastChannels.get(channelName);
    if (!entry) {
      try {
        const channel = supabase.channel(channelName, { config: { private: true } });
        entry = { channel, lastUsedAt: Date.now() };
        serverBroadcastChannels.set(channelName, entry);
      } catch (e) {
        return done(e);
      }
    }

    const channel = entry.channel;

    if (!entry.subscribed) {
      const timeout = setTimeout(() => {
        serverBroadcastChannels.delete(channelName);
        done(new Error('broadcast subscribe timeout'));
      }, 2500);

      channel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(timeout);
          entry.subscribed = true;
          entry.lastUsedAt = Date.now();
          channel.send({ type: 'broadcast', event, payload })
            .then(() => done())
            .catch((err) => {
              serverBroadcastChannels.delete(channelName);
              done(err);
            });
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          clearTimeout(timeout);
          serverBroadcastChannels.delete(channelName);
          done(new Error(`broadcast channel status: ${status}`));
        }
      });
      return;
    }

    entry.lastUsedAt = Date.now();
    channel.send({ type: 'broadcast', event, payload })
      .then(() => done())
      .catch((err) => {
        serverBroadcastChannels.delete(channelName);
        done(err);
      });
  });
}

/**
 * GET /api/orders/group/:restaurantId/:tableNumber
 * Recupera el carrito grupal activo de la mesa.
 * Usa Supabase si está disponible, si no fallback a memoria local.
 */
router.get('/group/:restaurantId/:tableNumber', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();

    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('group_carts')
          .select('*')
          .eq('id', key)
          .single();

        if (!error && data) {
          return successResponse(res, {
            restaurantId: data.restaurant_id,
            tableNumber: data.table_number,
            items: data.items || [],
            participants: data.participants || [],
            lastAction: data.last_action,
            lastUser: data.last_user,
            updatedAt: data.updated_at,
            deletedItemIds: tombstonesFor(key)
          }, 'Carrito grupal de mesa recuperado');
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.get',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Fallback a memoria local
    const localData = activeGroupTableCarts.get(key) || { items: [], participants: [], updatedAt: new Date().toISOString() };
    return successResponse(res, {
      ...localData,
      deletedItemIds: tombstonesFor(key)
    }, 'Carrito grupal de mesa recuperado');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/group/:restaurantId/:tableNumber/sync
 * Sincroniza y consolida el estado del carrito grupal de la mesa.
 * Usa union-merge por cartItemId con tombstones: nunca pierde items de otros
 * comensales que hicieron sync concurrente, y no resucita items eliminados.
 * Persiste en Supabase + emite broadcast Realtime al MISMO canal que escuchan
 * los clientes (`realtime:<slug>:mesa_<N>:<groupToken>`, evento `cart_update`).
 */
router.post('/group/:restaurantId/:tableNumber/sync', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const { items = [], participants = [], action = 'sync', fromUser = '', fromUserId = '', deletedCartItemIds = [], restaurantSlug = '' } = req.body;
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();
    const groupToken = (req.headers['x-group-cart-token'] || '').trim();

    // Estado actual: items existentes + participantes (para merge no destructivo)
    let existingItems = [];
    let currentParticipants = [];
    if (supabase) {
      try {
        const { data } = await supabase
          .from('group_carts')
          .select('items, participants')
          .eq('id', key)
          .single();
        if (data) {
          existingItems = Array.isArray(data.items) ? data.items : [];
          currentParticipants = Array.isArray(data.participants) ? data.participants : [];
        }
      } catch (e) { logger.warn('[Supabase Get Group Cart]', { details: e.message, restaurantId, tableNumber }); }
    } else {
      const current = activeGroupTableCarts.get(key);
      if (current) {
        existingItems = Array.isArray(current.items) ? current.items : [];
        currentParticipants = Array.isArray(current.participants) ? current.participants : [];
      }
    }

    // Tombstones del carrito (anti-resurrección de items borrados)
    const tombKey = `tombstones:${key}`;
    const tombstoneEntry = activeGroupTableTombstones.get(tombKey);
    const tombstones = new Set(tombstoneEntry ? tombstoneEntry.ids : []);

    // Union-merge por cartItemId: preserva items de otros comensales y respeta tombstones
    const mergedById = new Map();
    existingItems.forEach(item => {
      const id = getCartItemId(item);
      if (!tombstones.has(id)) mergedById.set(id, item);
    });
    (Array.isArray(items) ? items : []).forEach(item => {
      const id = getCartItemId(item);
      if (tombstones.has(id)) return;
      mergedById.set(id, item);
    });

    // Procesar eliminaciones explícitas (tombstone + borrado del merge)
    const deletedIds = new Set(
      (Array.isArray(deletedCartItemIds) ? deletedCartItemIds : []).map(id => String(id)).filter(Boolean)
    );
    if (action === 'remove' && req.body.item?.cartItemId) deletedIds.add(String(req.body.item.cartItemId));
    deletedIds.forEach(id => {
      mergedById.delete(id);
      tombstones.add(id);
    });

    const mergedItems = Array.from(mergedById.values());
    const mergedParticipants = Array.from(new Set([...currentParticipants, ...participants, fromUser].filter(Boolean)));

    const updatedState = {
      restaurantId,
      tableNumber: String(tableNumber),
      items: mergedItems,
      participants: mergedParticipants,
      lastAction: action,
      lastUser: fromUser,
      updatedAt: new Date().toISOString()
    };

    // Conservar tombstones 24h (expiran junto con el carrito)
    activeGroupTableTombstones.set(tombKey, {
      ids: Array.from(tombstones).slice(-200),
      expiresAt: Date.now() + GROUP_CART_TTL_MS
    });

    if (supabase) {
      try {
        // Upsert en Supabase
        await supabase.from('group_carts').upsert([{
          id: key,
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
          items: mergedItems,
          participants: mergedParticipants,
          last_action: action,
          last_user: fromUser,
          updated_at: updatedState.updatedAt
        }]);

        // Broadcasting al canal de los clientes (no bloquea la respuesta)
        if (restaurantSlug && groupToken) {
          const fullCart = {};
          mergedItems.forEach(item => { fullCart[getCartItemId(item)] = item; });
          const channelName = `realtime:${restaurantSlug}:mesa_${tableNumber}:${groupToken}`;
          broadcastToTableChannel(supabase, channelName, 'cart_update', {
            action: (action === 'remove') ? 'remove' : 'sync',
            fullCart,
            participants: mergedParticipants,
            fromUser,
            fromUserId,
            fromServer: true,
            tableNumber: String(tableNumber)
          }).catch(() => {
            sentry.captureMessage('groupCart.serverBroadcast.sync', {
              source: 'orders.groupCart.sync',
              level: 'warn',
              tags: { restaurantId, tableNumber, channelName }
            });
          });
        }
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.sync',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Siempre actualizar memoria local como fallback/cache
    activeGroupTableCarts.set(key, updatedState);
    return successResponse(res, updatedState, 'Carrito grupal sincronizado exitosamente');
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/group/:restaurantId/:tableNumber/clear
 * Limpia el carrito grupal una vez enviado el pedido.
 * Limpia items + tombstones en Supabase + broadcast al canal de clientes.
 * Los participantes se conservan: las personas siguen sentadas en la mesa y
 * pueden iniciar una nueva ronda.
 */
router.post('/group/:restaurantId/:tableNumber/clear', groupCartLimiter, requireGroupCartCapability, async (req, res, next) => {
  try {
    const { restaurantId, tableNumber } = req.params;
    const { restaurantSlug = '', fromUser = '' } = req.body || {};
    const key = getGroupCartId(restaurantId, tableNumber);
    const supabase = getSupabaseClient();
    const groupToken = (req.headers['x-group-cart-token'] || '').trim();

    let participants = [];

    if (supabase) {
      try {
        const { data } = await supabase
          .from('group_carts')
          .select('participants')
          .eq('id', key)
          .single();
        if (data && Array.isArray(data.participants)) participants = data.participants;
      } catch (e) { logger.warn('[Supabase Get Group Cart Participants]', { details: e.message, restaurantId, tableNumber }); }

      try {
        await supabase.from('group_carts').upsert([{
          id: key,
          restaurant_id: restaurantId,
          table_number: String(tableNumber),
          items: [],
          participants: participants,
          last_action: 'clear',
          last_user: fromUser,
          updated_at: new Date().toISOString()
        }]);
      } catch (e) {
        sentry.captureException(e, {
          source: 'orders.groupCart.clear',
          level: 'warn',
          tags: { restaurantId, tableNumber }
        });
      }
    }

    // Limpiar tombstone + carrito en memoria local
    activeGroupTableTombstones.delete(`tombstones:${key}`);
    const localData = activeGroupTableCarts.get(key);
    const nextParticipants = participants.length ? participants : (localData?.participants || []);
    activeGroupTableCarts.set(key, {
      restaurantId,
      tableNumber: String(tableNumber),
      items: [],
      participants: nextParticipants,
      lastAction: 'clear',
      lastUser: fromUser,
      updatedAt: new Date().toISOString()
    });

    // Broadcast al canal de los clientes: todos deben vaciar su carrito local
    if (supabase && restaurantSlug && groupToken) {
      const channelName = `realtime:${restaurantSlug}:mesa_${tableNumber}:${groupToken}`;
      broadcastToTableChannel(supabase, channelName, 'cart_update', {
        action: 'clear',
        fullCart: {},
        cart: {},
        participants: nextParticipants,
        fromUser,
        fromServer: true,
        tableNumber: String(tableNumber)
      }).catch(() => {
        sentry.captureMessage('groupCart.serverBroadcast.clear', {
          source: 'orders.groupCart.clear',
          level: 'warn',
          tags: { restaurantId, tableNumber, channelName }
        });
      });
    }

    return successResponse(res, { cleared: true, participants: nextParticipants }, 'Carrito grupal finalizado');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
