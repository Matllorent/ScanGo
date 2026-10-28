/**
 * public/js/mozo/comandero.js
 * ───────────────────────────
 * Primitivas PURAS del comandero de mesa (Fase 2 del Sistema de Mozos):
 * el mozo toma el pedido en la mesa desde su PWA y el pedido sale REAL
 * (atribuido a su turno, `source='staff'`) hacia cocina/Studio.
 *
 * Sin DOM y sin red: la carta, el borrador y las reglas entran por parámetro
 * para verificarse en Node y en el navegador con la misma lógica.
 *
 * Reglas de la casa respetadas acá:
 *  - El payload de líneas es EXACTAMENTE el del checkout del comensal
 *    (`{dishId, quantity, note, choices}` con `groupId/selections`): el
 *    servidor cotiza con el MISMO quoteOrderItems — cero motor de precios
 *    duplicado. El subtotal mostrado viene de `/api/orders/quote` y el
 *    autoritativo es el 201.
 *  - La atribución (`waiter_id`/`table_id`/`source`) JAMÁS viaja en el body:
 *    la decide el server desde la sesión de turno. Este módulo solo arma
 *    `orderMode:'LOCAL'`, mesa y líneas.
 *  - Agotados (manual `outOfStock` o derivado `soldOutToday`, F3) se
 *    muestran con badge y se rechazan al agregar — display-only como el
 *    guard del comensal; el server es la última palabra.
 *  - Fase 3 — el comandero opera el Club: teléfono y nombre del comensal
 *    (opcionales), cupón y propina. El server ya procesa TODO para cualquier
 *    pedido (`customerPhone` → creditOrder acredita local+global con el
 *    multiplicador R3; `coupon.code` → claim atómico de recupero/catálogo;
 *    `tipAmount` → orders.tip_amount aparte del ticket promedio). Aquí solo
 *    se sanea con paridad EXACTA a las reglas del server: el teléfono acepta
 *    lo MISMO que `normalizePhone` del Club (7..15 dígitos, strip `+`/`00`) —
 *    un teléfono válido para el mozo ES válido para la acreditación. El
 *    teléfono tipeado pero incompleto BLOQUEA el envío (honesto, nunca un
 *    drop silencioso del Club que el mozo creía acreditar).
 */

export const MAX_DRAFT_LINES = 60;
export const MAX_LINE_QTY = 99;
export const MAX_LINE_NOTE = 250;
export const MAX_CHOICES_PER_GROUP = 100;

/* Fase 3 — paridad con el server (schema de pedidos + loyalty.normalizePhone). */
export const GUEST_PHONE_MIN_DIGITS = 7;  // loyalty.normalizePhone: < 7 → null
export const GUEST_PHONE_MAX_DIGITS = 15; // loyalty.normalizePhone: > 15 → null
export const MAX_GUEST_PHONE_LEN = 30;    // createOrderSchema.customerPhone max 30
export const MAX_GUEST_NAME_LEN = 100;    // createOrderSchema.customerName max 100
export const MAX_COUPON_CODE_LEN = 30;    // createOrderSchema.coupon.code max 30
export const MAX_TIP_AMOUNT = 1000000;    // createOrderSchema.tipAmount max 1e6

/** Slug con la misma allowlist que `sanitizeRefSlug` (viralRef): [a-z0-9-] máx 64. */
export function sanitizeComanderoSlug(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw || raw.length > 64) return '';
  return /^[a-z0-9-]+$/.test(raw) ? raw : '';
}

/**
 * Teléfono del comensal — PARIDAD EXACTA con `normalizePhone` de
 * api/services/loyalty.js (la identidad del Club): dígitos con `+` opcional,
 * strip del `+` inicial y del prefijo internacional `00`, acepta 7..15
 * dígitos. Con menos dígitos (o basura) devuelve `''` — el mozo ve el error
 * ANTES de enviar (draftIsSubmittable) y el server nunca acredita basura.
 */
export function sanitizeGuestPhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length < GUEST_PHONE_MIN_DIGITS || digits.length > GUEST_PHONE_MAX_DIGITS) return '';
  return digits;
}

/** Nombre del comensal (opcional): limpio, cap 100 — paridad del schema. */
export function sanitizeGuestName(raw) {
  return cleanText(raw, MAX_GUEST_NAME_LEN);
}

/** Código de cupón: trim + uppercase + sin espacios internos, cap 30 (schema). */
export function sanitizeCouponCode(raw) {
  const raw2 = String(raw == null ? '' : raw);
  if (!raw2.trim()) return '';
  return raw2.replace(/\s+/g, '').toUpperCase().slice(0, MAX_COUPON_CODE_LEN);
}

/** Propina como MONTO fijo: no negativa, ≤ 1e6, redondeo a 2 decimales (cents-safe). */
export function sanitizeTipAmount(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const capped = Math.min(MAX_TIP_AMOUNT, value);
  return Math.round(capped * 100) / 100;
}

function cleanText(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanId(value, maxLength = 120) {
  const raw = String(value == null ? '' : value).trim();
  if (!raw || raw.length > maxLength) return '';
  return /^[A-Za-z0-9_-]+$/.test(raw) ? raw : '';
}

/* ── Carta ────────────────────────────────────────────────────────────────── */

/**
 * Grupos activos de un plato (espejo de `getDishModifierGroups` de
 * api/utils/menuOptions.js: asignados por id + embebidos, activos).
 */
export function dishGroupsOf(dish, restaurantGroups = []) {
  if (!dish || typeof dish !== 'object') return [];
  const shared = Array.isArray(restaurantGroups) ? restaurantGroups : [];
  const assigned = Array.isArray(dish.modifierGroupIds)
    ? dish.modifierGroupIds.map((id) => shared.find((group) => group && group.id === id)).filter(Boolean)
    : [];
  const embedded = Array.isArray(dish.modifierGroups) ? dish.modifierGroups : [];
  return [...assigned, ...embedded].filter((group) => group && group.active !== false);
}

/** ¿El plato necesita el modal de opciones para armarse? */
export function dishNeedsOptions(dish, restaurantGroups = []) {
  return dishGroupsOf(dish, restaurantGroups).length > 0;
}

/**
 * Normaliza el payload PÚBLICO de `/api/menu/:slug` al modelo del comandero.
 * Estable: los platos SIEMPRE llevan `soldOut` (OR de manual + derivado F3),
 * `free` (precio $0 / sin precio, regla isFreePrice) y `needsOptions`.
 * Devuelve `null` con basura (la PWA muestra su mensaje honesto).
 */
export function normalizeComanderoMenu(menu) {
  if (!menu || typeof menu !== 'object') return null;
  const restaurantGroups = Array.isArray(menu.modifierGroups) ? menu.modifierGroups : [];
  const categories = (Array.isArray(menu.categories) ? menu.categories : [])
    .map((c) => ({ id: cleanId(c && c.id, 100), name: cleanText(c && c.name, 60) }))
    .filter((c) => c.id);
  const categoryNames = new Map(categories.map((c) => [c.id, c.name]));
  const dishes = (Array.isArray(menu.dishes) ? menu.dishes : [])
    .map((d) => {
      if (!d || typeof d !== 'object') return null;
      const id = cleanId(d.id);
      if (!id) return null;
      const price = Number(d.price);
      const soldOut = d.outOfStock === true || d.soldOutToday === true;
      const categoryId = cleanId(d.categoryId || d.category_id, 100);
      // Los ids de grupos viajan al modelo: dishGroupsOf(dish, menu.groups)
      // los resuelve después para validar y describir las opciones.
      const modifierGroupIds = (Array.isArray(d.modifierGroupIds) ? d.modifierGroupIds : [])
        .map((gid) => cleanId(gid, 80))
        .filter(Boolean);
      return {
        id,
        name: cleanText(d.name, 120) || 'Plato',
        desc: cleanText(d.description || d.desc, 160),
        price: Number.isFinite(price) && price > 0 ? price : null,
        free: !Number.isFinite(price) || price === 0,
        soldOut,
        needsOptions: dishNeedsOptions(d, restaurantGroups),
        categoryId,
        categoryName: categoryNames.get(categoryId) || 'General',
        modifierGroupIds,
        photoUrl: typeof d.photoUrl === 'string' && d.photoUrl ? d.photoUrl : '',
        iceCream: d.isCustomIceCream === true
      };
    })
    .filter(Boolean);
  return {
    restaurantId: cleanId(menu.id, 100),
    slug: sanitizeComanderoSlug(menu.slug),
    name: cleanText(menu.name, 120),
    currency: cleanText(menu.currency, 5) || '$',
    allowOrders: menu.allowMenuOrders !== false,
    categories,
    dishes,
    groups: restaurantGroups
  };
}

/** Busca un plato normalizado del comandero por id. */
export function findComanderoDish(menu, dishId) {
  if (!menu || !Array.isArray(menu.dishes)) return null;
  return menu.dishes.find((d) => d && d.id === dishId) || null;
}

/* ── Borrador ─────────────────────────────────────────────────────────────── */

/** Borrador del pedido en curso: mesa + líneas + nota general + extras del Club (Fase 3). */
export function createDraft() {
  return { tableNumber: '', tableLabel: '', note: '', lines: [], guestPhone: '', guestName: '', tipAmount: 0, couponCode: '' };
}

/** Fija la mesa del pedido (debe estar asignada al turno). */
export function setDraftTable(draft, table) {
  if (!draft || !table || !table.number) return draft || createDraft();
  draft.tableNumber = cleanText(table.number, 20);
  draft.tableLabel = cleanText(table.label, 40) || (/^\d+$/.test(draft.tableNumber) ? `Mesa ${draft.tableNumber}` : draft.tableNumber);
  return draft;
}

/**
 * Extras del comensal (Fase 3 — TODO opcional): el teléfono se guarda CRUDO
 * (trim, cap 30) para poder bloquear el envío honestamente cuando quedó
 * tipeado e incompleto — el body lo sanea con la regla del Club; el nombre
 * se guarda ya saneado (cap 100 del schema). Vaciar el campo lo REMUEVE.
 */
export function setDraftGuest(draft, { phone, name } = {}) {
  if (!draft) return draft || createDraft();
  if (phone !== undefined) {
    draft.guestPhone = String(phone == null ? '' : phone).trim().slice(0, MAX_GUEST_PHONE_LEN);
  }
  if (name !== undefined) {
    draft.guestName = sanitizeGuestName(name);
  }
  return draft;
}

/** Propina del comensal como monto fijo (saneada: ≥0, ≤1e6, 2 decimales). */
export function setDraftTipAmount(draft, value) {
  if (!draft) return draft || createDraft();
  draft.tipAmount = sanitizeTipAmount(value);
  return draft;
}

/** Cupón aplicado por el mozo (saneado: uppercase, sin espacios, cap 30). */
export function setDraftCoupon(draft, code) {
  if (!draft) return draft || createDraft();
  draft.couponCode = sanitizeCouponCode(code);
  return draft;
}

/**
 * Resumen legible del comensal para la barra ('Lucía · 59899111222') —
 * vacío sin datos. Puro: la PWA lo pinta con textContent.
 */
export function describeDraftGuest(draft) {
  if (!draft) return '';
  const name = sanitizeGuestName(draft.guestName);
  const phone = draft.guestPhone ? String(draft.guestPhone).trim() : '';
  return [name, phone].filter(Boolean).join(' · ');
}

/** Valida y agrega una línea al borrador (cota de líneas + qty + nota). */
export function addDraftLine(draft, line) {
  if (!draft || !line || !line.dishId) return null;
  if (draft.lines.length >= MAX_DRAFT_LINES) return null;
  const quantity = Math.max(1, Math.min(MAX_LINE_QTY, Math.floor(Number(line.quantity) || 1)));
  const entry = {
    dishId: cleanId(line.dishId),
    dishName: cleanText(line.dishName, 120),
    quantity,
    note: cleanText(line.note, MAX_LINE_NOTE),
    choices: sanitizeDraftChoices(line.choices),
    // Etiqueta humana para el resumen ("2× Chivito · Grande · sin cebolla").
    label: ''
  };
  entry.label = describeDraftLine(entry);
  draft.lines.push(entry);
  return entry;
}

export function removeDraftLine(draft, index) {
  if (!draft || !Array.isArray(draft.lines)) return false;
  if (index < 0 || index >= draft.lines.length) return false;
  draft.lines.splice(index, 1);
  return true;
}

export function clearDraftLines(draft) {
  if (!draft) return;
  draft.lines = [];
  draft.note = '';
}

/** Choices en el shape EXACTO del schema del server (groupId + selections). */
export function sanitizeDraftChoices(choices) {
  if (!Array.isArray(choices)) return [];
  const out = [];
  for (const choice of choices.slice(0, 50)) {
    if (!choice || typeof choice.groupId !== 'string' || !choice.groupId) continue;
    const selections = (Array.isArray(choice.selections) ? choice.selections : [])
      .map((s) => ({
        optionId: cleanId(s && s.optionId, 80),
        quantity: Math.max(1, Math.min(99, Math.floor(Number(s && s.quantity) || 1)))
      }))
      .filter((s) => s.optionId)
      .slice(0, 100);
    if (!selections.length) continue;
    out.push({ groupId: choice.groupId.slice(0, 80), selections });
  }
  return out;
}

/**
 * Espejo client de `validateAndPriceOrderLine` (api/utils/menuOptions.js):
 * required con 0 selecciones, límites min/max, cantidades enteras y una sola
 * presentación. Es validación de DISPLAY (feedback rápido al mozo); la
 * autoridad final siempre es el server (400 INVALID_DISH_OPTIONS).
 */
export function validateLineAgainstGroups(dish, choices, restaurantGroups = []) {
  if (!dish) return { ok: false, error: 'Ese plato no está más en la carta.' };
  const groups = dishGroupsOf(dish, restaurantGroups);
  const submitted = Array.isArray(choices) ? choices : [];
  const byGroupId = new Map();
  for (const selection of submitted) {
    if (!selection || typeof selection.groupId !== 'string' || byGroupId.has(selection.groupId)) {
      return { ok: false, error: 'La selección de opciones no es válida.' };
    }
    byGroupId.set(selection.groupId, selection);
  }
  for (const group of groups) {
    const submittedGroup = byGroupId.get(group.id);
    const selections = Array.isArray(submittedGroup && submittedGroup.selections) ? submittedGroup.selections : [];
    let selectionCount = 0;
    for (const selection of selections) {
      if (!selection || typeof selection.optionId !== 'string' || !selection.optionId) {
        return { ok: false, error: `Las opciones de "${group.name}" no son válidas.` };
      }
      const option = (group.options || []).find((candidate) => candidate && candidate.id === selection.optionId && candidate.active !== false);
      if (!option) return { ok: false, error: `Una opción de "${group.name}" ya no está disponible.` };
      const maxQuantity = option.maxQuantity || 100;
      const requested = Number(selection.quantity ?? 1);
      if ((group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split') &&
          (!Number.isInteger(requested) || requested <= 0 || requested > maxQuantity)) {
        return { ok: false, error: `La cantidad de "${option.name}" no es válida.` };
      }
      selectionCount += group.selectionMode === 'quantity' || group.selectionMode === 'quantity_split' ? requested : 1;
    }
    if (group.required && selectionCount === 0) {
      return { ok: false, error: `Elegí una opción para "${group.name}".` };
    }
    if (selectionCount < group.minSelections || selectionCount > group.maxSelections) {
      return { ok: false, error: `La selección de "${group.name}" no cumple sus límites.` };
    }
    if (group.kind === 'presentation' && selections.length > 1) {
      return { ok: false, error: 'Elegí una sola presentación.' };
    }
  }
  return { ok: true, error: '' };
}

/** Resumen de opciones elegidas: "Grande · Extra queso ×2". */
export function describeDraftChoices(dish, choices, restaurantGroups = []) {
  if (!Array.isArray(choices) || !choices.length) return '';
  const groups = dishGroupsOf(dish, restaurantGroups);
  const parts = [];
  for (const choice of choices) {
    const group = groups.find((g) => g && g.id === choice.groupId);
    const groupName = group ? group.name : 'Opciones';
    const labels = (choice.selections || [])
      .map((s) => {
        const option = group && Array.isArray(group.options) ? group.options.find((o) => o && o.id === s.optionId) : null;
        const name = option ? option.name : '';
        if (!name) return '';
        return s.quantity && s.quantity > 1 ? `${s.quantity}× ${name}` : name;
      })
      .filter(Boolean);
    if (labels.length) parts.push(`${groupName}: ${labels.join(', ')}`);
  }
  return parts.join(' · ');
}

/** Etiqueta completa de una línea del borrador. */
export function describeDraftLine(line) {
  if (!line) return '';
  const qty = line.quantity && line.quantity > 1 ? `${line.quantity}× ` : '';
  return `${qty}${line.dishName || 'Plato'}`;
}

/* ── Cuerpos de API ───────────────────────────────────────────────────────── */

/** Líneas al shape del schema (`createOrderItemSchema`) — sin atribución. */
export function draftLinesToPayload(draft) {
  if (!draft || !Array.isArray(draft.lines)) return [];
  return draft.lines.map((line) => ({
    dishId: line.dishId,
    quantity: line.quantity,
    note: line.note || '',
    choices: (line.choices || []).map((choice) => ({
      groupId: choice.groupId,
      selections: choice.selections.map((s) => ({
        optionId: s.optionId,
        ...(s.quantity > 1 ? { quantity: s.quantity } : {})
      }))
    }))
  }));
}

/**
 * Body para `POST /api/orders/quote` y `POST /api/orders` (mismo schema).
 * `orderMode:'LOCAL'` SIEMPRE (el comandero registra salón). La atribución
 * del mozo la agrega el SERVER.
 *
 * Fase 3 — extras del Club con SHAPE ESTABLE (patrón soldOutToday): el
 * teléfono y la propina viajan SIEMPRE ('' y 0 = valores no-op del schema) y
 * el cupón SOLO cuando hay código (objeto ausente = sin cupón).
 * `customerName` = nombre del comensal si el mozo lo cargó; sin él conserva
 * la etiqueta de mesa de la Fase 2 ('Mesa N').
 */
export function buildComanderoBody(draft, { restaurantId, utcOffsetMinutes = 0 } = {}) {
  if (!draft || !restaurantId) return null;
  const body = {
    restaurantId,
    orderMode: 'LOCAL',
    tableNumber: draft.tableNumber || '1',
    customerName: sanitizeGuestName(draft.guestName) || draft.tableLabel || 'Mesa',
    customerPhone: sanitizeGuestPhone(draft.guestPhone),
    tipAmount: sanitizeTipAmount(draft.tipAmount),
    notes: cleanText(draft.note, 300),
    items: draftLinesToPayload(draft),
    utcOffsetMinutes: Math.max(-840, Math.min(840, Math.floor(Number(utcOffsetMinutes) || 0)))
  };
  const couponCode = sanitizeCouponCode(draft.couponCode);
  if (couponCode) body.coupon = { code: couponCode };
  return body;
}

/**
 * ¿El borrador es enviable? Mesa elegida + ≥1 línea + carta con pedidos ON +
 * extras del Club coherentes (Fase 3): un teléfono tipeado pero incompleto
 * BLOQUEA el envío — el mozo tenía la intención de acreditar el Club y un
 * drop silencioso se lo mentiría.
 */
export function draftIsSubmittable(draft, menu) {
  if (!draft || !menu) return { ok: false, error: '' };
  if (menu.allowOrders === false) {
    return { ok: false, error: 'Este local muestra la carta sin aceptar pedidos por el momento.' };
  }
  if (!draft.tableNumber) return { ok: false, error: 'Elegí la mesa del pedido.' };
  if (!Array.isArray(draft.lines) || !draft.lines.length) {
    return { ok: false, error: 'Agregá al menos un plato al pedido.' };
  }
  if (draft.guestPhone && !sanitizeGuestPhone(draft.guestPhone)) {
    return {
      ok: false,
      error: `El teléfono del comensal parece incompleto (mínimo ${GUEST_PHONE_MIN_DIGITS} dígitos). Corregilo o borralo.`
    };
  }
  return { ok: true, error: '' };
}

/**
 * Ticket corto determinista para el confirm ("#AB12 enviado a cocina") —
 * MISMA derivación que `kitchenTicketNumber` del KDS (cola del id, mayúsculas).
 */
export function comanderoTicketNumber(order) {
  const id = String((order && (order.id || order.orderId)) || '');
  if (!id) return '#—';
  const tail = String(id).split('_').pop() || id;
  return `#${tail.slice(-4).toUpperCase()}`;
}
