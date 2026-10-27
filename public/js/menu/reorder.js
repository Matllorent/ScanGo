/**
 * public/js/menu/reorder.js
 * ─────────────────────────────────────────────────────────────────────────────
 * #5 "Pedir de nuevo" (backlog de la estrategia, oct-2026).
 *
 * Snapshot CLIENT-SIDE del último pedido confirmado del comensal en ESTE
 * local: la fuente es el MISMO payload que viaja a POST /api/orders (cero
 * transformación inventada), guardado en SU localStorage por slug. Al volver
 * a la carta, un FAB 🔁 reconstruye las líneas contra la carta ACTUAL:
 *  - el plato ya no existe → se salta (aviso honesto)
 *  - agotado (manual `outOfStock` o derivado `soldOutToday` de F3) → se salta
 *  - fuera de su horario (`schedule.behavior`) → se salta
 *  - opciones que ya no existen → se filtran; si un grupo requerido queda
 *    vacío la línea se salta (el server es la autoridad final en /quote)
 *  - helado a medida → se salta (el armador es un toque y los ids son de la
 *    configuración VIVA del dueño; no hay snapshot del armado)
 *
 * Módulo PURO de decisión (misma disciplina que orderTracking/tipCalculator):
 * cero DOM en import, seguro en Node; localStorage solo con try/catch y el
 * flujo de UI (FAB/toast/carrito) vive en menu.js con ctx explícito.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { isDishSoldOut } from '../utils/dishAvailability.js';

const REORDER_KEY = 'scango_reorder';
const SKIP_REASONS = {
  custom: 'Helado a medida: armalo de nuevo 🍨',
  missing: 'ya no está en la carta',
  soldout: 'agotado',
  schedule: 'fuera de horario',
  options: 'cambió sus opciones'
};
// Un mapa {[slug]: snapshot} con tope de locales: el comensal prueba varias
// cartas; la última de cada una vale más que el histórico completo.
const REORDER_MAX_SLUGS = 5;
// Líneas por snapshot: un pedido real no pasa de una docena; el tope acota el
// payload (la nota del comensal viaja dentro: máx 250 como en el modal).
const REORDER_MAX_ITEMS = 30;
const NOTE_MAX = 250;

function readReorderMap() {
  try {
    const raw = localStorage.getItem(REORDER_KEY);
    const map = raw ? JSON.parse(raw) : null;
    return (map && typeof map === 'object' && !Array.isArray(map)) ? map : {};
  } catch (e) {
    return {};
  }
}

function writeReorderMap(map) {
  try { localStorage.setItem(REORDER_KEY, JSON.stringify(map)); } catch (e) {}
}

function isValidSlug(slug) {
  return typeof slug === 'string' && slug.length > 0 && slug.length <= 120;
}

/**
 * Guarda el snapshot del pedido confirmado para `slug` (overwrite: "último
 * pedido" es el último, no el historial). `payloadItems` son los payloads ya
 * construidos por toOrderItemPayload — se sanea por línea (defensivo: nunca
 * persiste basura aunque la carta esté rota) y se recorta el mapa por savedAt.
 */
export function saveReorderForSlug(slug, payloadItems) {
  if (!isValidSlug(slug) || !Array.isArray(payloadItems)) return false;
  const items = [];
  for (const item of payloadItems.slice(0, REORDER_MAX_ITEMS)) {
    if (!item || typeof item !== 'object') continue;
    const dishId = typeof item.dishId === 'string' ? item.dishId.slice(0, 80) : '';
    const quantity = Math.max(1, Math.min(99, Math.floor(Number(item.quantity)) || 1));
    if (!dishId) continue;
    const note = typeof item.note === 'string' ? item.note.slice(0, NOTE_MAX) : '';
    const choices = sanitizeStoredChoicesRaw(item.choices);
    const entry = { dishId, quantity, note, choices };
    if (item.customIceCream) entry.customIceCream = true; // marcado: rebuild lo salta
    items.push(entry);
  }
  if (!items.length) return false;

  const map = readReorderMap();
  map[slug] = { savedAt: Date.now(), items };
  // Tope de locales: fuera los más viejos (los slugs conservados son los recientes).
  const entries = Object.entries(map)
    .filter(([key, value]) => isValidSlug(key) && value && Array.isArray(value.items) && value.items.length)
    .sort((a, b) => (Number(b[1].savedAt) || 0) - (Number(a[1].savedAt) || 0))
    .slice(0, REORDER_MAX_SLUGS);
  writeReorderMap(Object.fromEntries(entries));
  return true;
}

export function getReorderForSlug(slug) {
  if (!isValidSlug(slug)) return null;
  const snapshot = readReorderMap()[slug];
  if (!snapshot || !Array.isArray(snapshot.items) || !snapshot.items.length) return null;
  return snapshot;
}

export function forgetReorderForSlug(slug) {
  if (!isValidSlug(slug)) return;
  const map = readReorderMap();
  if (map[slug]) {
    delete map[slug];
    writeReorderMap(map);
  }
}

/** Saneo crudo del shape de choices del payload (ids y cantidades). */
function sanitizeStoredChoicesRaw(choices) {
  if (!Array.isArray(choices)) return [];
  return choices.map(choice => ({
    groupId: typeof choice?.groupId === 'string' ? choice.groupId.slice(0, 80) : '',
    selections: (Array.isArray(choice?.selections) ? choice.selections : []).map(sel => ({
      optionId: typeof sel?.optionId === 'string' ? sel.optionId.slice(0, 80) : '',
      quantity: Math.max(1, Math.min(99, Math.floor(Number(sel?.quantity)) || 1))
    })).filter(sel => sel.optionId)
  })).filter(choice => choice.groupId);
}

/**
 * Reconcilia las choices guardadas contra los grupos VIGENTES del plato:
 *  - grupos/opciones que ya no existen se filtran;
 *  - si un grupo requerido se queda sin selección, la línea no es repetible
 *    (el /quote del server la rechazaría igual — mejor avisar arriba).
 * Devuelve { choices, valid }.
 */
function reconcileChoices(storedChoices, groups) {
  const normalized = Array.isArray(groups) ? groups : [];
  const choices = [];
  for (const stored of Array.isArray(storedChoices) ? storedChoices : []) {
    const group = normalized.find(candidate => candidate && candidate.id === stored.groupId);
    if (!group || !Array.isArray(group.options) || !group.options.length) continue;
    const selections = [];
    for (const selection of stored.selections || []) {
      if (!group.options.some(option => option && option.id === selection.optionId)) continue;
      if (selections.some(existing => existing.optionId === selection.optionId)) continue;
      selections.push({ optionId: selection.optionId, quantity: selection.quantity });
    }
    if (selections.length) choices.push({ groupId: group.id, selections });
  }
  for (const group of normalized) {
    if (!group || group.required !== true) continue;
    const count = choices.find(choice => choice.groupId === group.id)
      ?.selections.reduce((sum, selection) => sum + selection.quantity, 0) || 0;
    if (!count) return { choices, valid: false };
  }
  return { choices, valid: true };
}

/**
 * Construye el plan de repetición: qué líneas van al carrito y qué líneas se
 * saltan (con motivo). PUREZA: no toca el carrito ni el DOM; el snapshot y las
 * cartas entran por parámetro. `getDishGroups(dish)` la inyecta menu.js (su
 * `getDishModifierGroups` ya normaliza legacy variants) y
 * `isDishAvailableNow(dish)` es el chequeo de horario del plato (schedule).
 *
 * @param {{ savedAt:number, items:Array }} snapshot - lo devuelto por getReorderForSlug
 * @param {object} deps { dishes, getDishGroups, isDishAvailableNow }
 * @returns {{ lines: Array<{dish, quantity, note, choices}>, skipped: Array<{label, reason, copy}> }}
 */
export function buildReorderPlan(snapshot, { dishes, getDishGroups, isDishAvailableNow } = {}) {
  const lines = [];
  const skipped = [];
  if (!snapshot || !Array.isArray(snapshot.items) || !Array.isArray(dishes)) {
    return { lines, skipped };
  }
  for (const item of snapshot.items) {
    if (!item || typeof item !== 'object') continue;
    if (item.customIceCream) {
      skipped.push({ label: '', reason: 'custom', copy: SKIP_REASONS.custom });
      continue;
    }
    const dish = dishes.find(d => d && d.id === item.dishId);
    if (!dish) {
      skipped.push({ label: '', reason: 'missing', copy: SKIP_REASONS.missing });
      continue;
    }
    if (isDishSoldOut(dish)) {
      skipped.push({ label: dish.name || '', reason: 'soldout', copy: SKIP_REASONS.soldout });
      continue;
    }
    if (typeof isDishAvailableNow === 'function' && !isDishAvailableNow(dish)) {
      skipped.push({ label: dish.name || '', reason: 'schedule', copy: SKIP_REASONS.schedule });
      continue;
    }
    const { choices, valid } = reconcileChoices(item.choices, typeof getDishGroups === 'function' ? getDishGroups(dish) : []);
    if (!valid) {
      skipped.push({ label: dish.name || '', reason: 'options', copy: SKIP_REASONS.options });
      continue;
    }
    lines.push({
      dish,
      quantity: Math.max(1, Math.min(99, Math.floor(Number(item.quantity)) || 1)),
      note: typeof item.note === 'string' ? item.note : '',
      choices
    });
  }
  return { lines, skipped };
}

/** Copia del toast: líneas agregadas + saltos con nombres (máx 2 citados). */
export function describeReorderPlan(plan) {
  const { lines, skipped } = plan || { lines: [], skipped: [] };
  if (!lines.length) {
    return 'Los platos de tu último pedido ya no están disponibles. Elegí algo nuevo 🙂';
  }
  const addedCount = lines.reduce((sum, line) => sum + line.quantity, 0);
  let message = `🛒 ${addedCount} ${addedCount === 1 ? 'plato agregado' : 'platos agregados'}`;
  if (skipped.length) {
    const named = skipped.filter(s => s.label).map(s => s.label).slice(0, 2).join(', ');
    message += ` · ${skipped.length} ${skipped.length === 1 ? 'omitido' : 'omitidos'}`;
    if (named) message += ` (${named})`;
  }
  return message;
}
