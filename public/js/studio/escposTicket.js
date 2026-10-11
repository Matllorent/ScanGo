/**
 * public/js/studio/escposTicket.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Ticket de cocina en bytes ESC/POS (Fase 2, sin DOM en import, testeable en
 * Node): convierte un pedido en una lista de operaciones puras que el Studio
 * aplica sobre la librería MIT `@point-of-sale/receipt-printer-encoder`
 * (Niels Leenheer 2024, cargada bajo demanda desde jsDelivr) y envía por
 * WebUSB a la térmica. El transporte USB vive en studio.js; acá no hay
 * `navigator` ni `window` para poder unit-testear sin navegador.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// Ancho estándar de ticket 80mm (42 columnas). La librería recorta sola.
export const ESCPOS_TICKET_COLUMNS = 42;

// Librería MIT versionada (pin exacto: ni `latest` ni rangos que cambien el
// binario bajo los pies). Se carga SOLO al conectar la impresora.
export const ESCPOS_LIB_URL = 'https://cdn.jsdelivr.net/npm/@point-of-sale/receipt-printer-encoder@4.0.1/dist/receipt-printer-encoder.umd.js';

// Global que expone el build UMD (nombre de la clase documentada).
export const ESCPOS_LIB_GLOBAL = 'ReceiptPrinterEncoder';

// La transferencia USB se trocea: algunos firmwares tragan mal >8KB.
export const ESCPOS_USB_CHUNK = 8000;

// Emojis y rarezas fuera de latin-1 no existen en las codepages térmicas:
// se mapean a ASCII legible (el resto se descarta, nunca se rompe el ticket).
const ESCPOS_TEXT_MAP = {
  '↳': '>', '—': '-', '–': '-', '“': '"', '”': '"', '‘': "'", '’': "'",
  '…': '...', '•': '-', '●': '*', '×': 'x', '·': '-', '✓': 'OK', '🔔': '*'
};

export function sanitizeEscPosText(value) {
  return String(value || '')
    .replace(/[↳—–“”‘’”…•●×·✓🔔]/g, ch => ESCPOS_TEXT_MAP[ch] || '')
    .replace(/[^\x20-\xFF]/g, '');
}

/**
 * Convierte un pedido en operaciones de ticket (init → contenido → corte).
 * Espejo en bytes del ticket Fase 1 (mismo contenido, sin HTML).
 * @param {object} order Pedido (items_snapshot, customer_name, ...)
 * @param {object} meta { restaurantName, currency }
 * @returns {Array} ops { t, v } aplicables con applyEscPosOps()
 */
export function buildEscPosTicketOps(order = {}, meta = {}) {
  const o = order || {};
  const currency = String(meta.currency || o.currency || '$').slice(0, 5);
  const restName = sanitizeEscPosText(meta.restaurantName || 'Mi local').slice(0, 42) || 'Mi local';
  const status = String(o.status || 'pending');
  const items = Array.isArray(o.items_snapshot) ? o.items_snapshot : [];
  const total = o.total != null ? o.total : o.amount;
  const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
  const customer = sanitizeEscPosText(o.customer_name || 'Cliente').slice(0, 32) || 'Cliente';
  const table = o.table_number != null && String(o.table_number).trim() !== ''
    ? sanitizeEscPosText(String(o.table_number)).slice(0, 20)
    : '';

  const ops = [
    { t: 'init' },
    { t: 'align', v: 'center' },
    { t: 'bold', v: true },
    { t: 'line', v: restName },
    { t: 'bold', v: false },
    { t: 'line', v: 'TICKET DE COCINA' },
    { t: 'align', v: 'left' },
    { t: 'rule' },
    { t: 'line', v: `Cliente: ${customer}` },
    ...(table ? [{ t: 'line', v: `Mesa: ${table}` }] : []),
    ...(when ? [{ t: 'line', v: `Fecha: ${sanitizeEscPosText(when).slice(0, 40)}` }] : []),
    { t: 'line', v: `Pedido: ${o.id ? sanitizeEscPosText(String(o.id).slice(-6)) : 's/n'} [${sanitizeEscPosText(status).slice(0, 20)}]` },
    { t: 'rule' }
  ];

  if (!items.length) {
    ops.push({ t: 'line', v: 'Sin detalle de items' });
  }
  for (const item of items) {
    const qty = Number(item.quantity) || 0;
    const name = sanitizeEscPosText(item.name || 'Item').slice(0, 36) || 'Item';
    ops.push({ t: 'line', v: `${qty}x ${name}` });
    if (item.note) {
      ops.push({ t: 'line', v: `> ${sanitizeEscPosText(item.note).slice(0, 38)}` });
    }
  }

  ops.push({ t: 'rule' });
  ops.push({ t: 'bold', v: true });
  ops.push({ t: 'line', v: `TOTAL: ${currency} ${Number(total || 0).toFixed(2)}` });
  ops.push({ t: 'bold', v: false });
  ops.push({ t: 'feed', v: 2 });
  ops.push({ t: 'cut', v: 'partial' });
  return ops;
}
