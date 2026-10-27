/**
 * public/js/studio/printerManager.js
 * ──────────────────────────────────
 * Módulo ES para la gestión de impresión de tickets en ScanGo Studio.
 *
 * Soporta:
 *  - Impresión directa por WebUSB en impresoras térmicas ESC/POS (80mm)
 *  - Impresión estándar de ticket de cocina en diálogo del navegador (@media print)
 *
 * El transporte WebUSB vive en `public/js/print/webusbPrinter.js` (compartido
 * con la Vista Kitchen); acá queda SOLO la UI del Studio y el ticket HTML.
 */

import {
  buildEscPosTicketOps,
  ESCPOS_TICKET_COLUMNS
} from './escposTicket.js';
import {
  isPrinterReady,
  loadEncoderClass,
  openDevice,
  requestPrinter,
  restorePrinter,
  forgetPrinter,
  sendBytes,
  applyOps,
  printTicketOps
} from '../print/webusbPrinter.js';

export function usbPrinterReady() {
  return isPrinterReady();
}

export function setUsbStatus(text, ok) {
  const statusEl = document.getElementById('usbPrinterStatus');
  if (statusEl) {
    statusEl.textContent = text || '';
    statusEl.style.color = ok ? '#68D391' : 'var(--text-dim)';
  }
  const btn = document.getElementById('usbPrinterBtn');
  if (btn) btn.textContent = usbPrinterReady() ? '🔌 Desconectar' : '🔌 Impresora';
}

// Compatibilidad con llamadas históricas del Studio (el transporte real es el
// módulo compartido). No se usan en las páginas nuevas.
export const getEscPosEncoderClass = loadEncoderClass;
export const openUsbDevice = openDevice;
export const sendToUsbPrinter = sendBytes;
export const applyEscPosOps = applyOps;

export async function connectUsbPrinter() {
  if (usbPrinterReady()) {
    await forgetPrinter();
    setUsbStatus('');
    return;
  }
  setUsbStatus('Buscando impresora…');
  try {
    const device = await requestPrinter();
    setUsbStatus(`Lista: ${device.productName || 'térmica USB'}`, true);
  } catch (e) {
    setUsbStatus('');
    if (e && e.name !== 'NotFoundError') {
      alert('No se pudo conectar la impresora USB. Probá con el botón 🖨️ Ticket.');
    }
  }
}

export async function restoreUsbPrinter() {
  const device = await restorePrinter();
  if (device) setUsbStatus(`Lista: ${device.productName || 'térmica USB'}`, true);
}

export async function printOrderEscPos(orderId, lastOrdersCache, restaurant) {
  const order = (lastOrdersCache || []).find(o => String(o.id) === String(orderId));
  if (!order) {
    alert('No se encontró el pedido. Tocá "Actualizar" e intentá de nuevo.');
    return;
  }
  if (!usbPrinterReady()) {
    alert('Conectá primero la impresora USB con el botón 🔌 Impresora.');
    return;
  }
  setUsbStatus('Imprimiendo…');
  try {
    const EncoderClass = await loadEncoderClass();
    if (typeof EncoderClass !== 'function') throw new Error('lib-missing');
    const ops = buildEscPosTicketOps(order, {
      restaurantName: (restaurant && (restaurant.name || restaurant.bizName)) || '',
      currency: order.currency || (restaurant && restaurant.currency) || '$'
    });
    await printTicketOps(EncoderClass, ops);
    setUsbStatus('Ticket enviado a la térmica.', true);
  } catch (e) {
    setUsbStatus('');
    alert('No se pudo imprimir por USB. Probá con el botón 🖨️ Ticket.');
  }
}

export function printOrderTicket(orderId, lastOrdersCache, restaurant, escapeHtml, orderStatusLabels) {
  const box = document.getElementById('orderTicketPrint');
  if (!box) return;
  const order = (lastOrdersCache || []).find(o => String(o.id) === String(orderId));
  if (!order) {
    alert('No se encontró el pedido. Tocá "Actualizar" e intentá de nuevo.');
    return;
  }
  const status = order.status || 'pending';
  const label = (orderStatusLabels && orderStatusLabels[status]) || status;
  const items = Array.isArray(order.items_snapshot) ? order.items_snapshot : [];
  const currency = order.currency || (restaurant && restaurant.currency) || '$';
  const total = order.total != null ? order.total : order.amount;
  const when = order.created_at ? new Date(order.created_at).toLocaleString() : '';
  const lines = items.map(i => {
    const qty = Number(i.quantity) || 0;
    const name = escapeHtml(i.name || 'Ítem');
    const note = i.note ? `<div class="ticket-note">↳ ${escapeHtml(i.note)}</div>` : '';
    return `<div class="ticket-item"><div class="ticket-row"><span>${qty}× ${name}</span></div>${note}</div>`;
  }).join('') || '<div class="ticket-item">Sin detalle de ítems</div>';
  box.innerHTML = `
    <div class="ticket-paper">
      <p class="ticket-title">${escapeHtml((restaurant && (restaurant.name || restaurant.bizName)) || 'Mi local')}</p>
      <p class="ticket-sub">TICKET DE COCINA · ${escapeHtml(label)}</p>
      <hr class="ticket-sep">
      <div class="ticket-row"><span>Cliente:</span><span>${escapeHtml(order.customer_name || 'Cliente')}</span></div>
      ${order.table_number ? `<div class="ticket-row"><span>Mesa:</span><span>${escapeHtml(String(order.table_number))}</span></div>` : ''}
      <div class="ticket-row"><span>Fecha:</span><span>${escapeHtml(when)}</span></div>
      <div class="ticket-row"><span>Pedido:</span><span>${escapeHtml(String(order.id).slice(-6))}</span></div>
      <hr class="ticket-sep">
      ${lines}
      <hr class="ticket-sep">
      <div class="ticket-row ticket-total"><span>TOTAL:</span><span>${escapeHtml(currency)} ${Number(total || 0).toFixed(2)}</span></div>
      ${order.notes ? `<div class="ticket-notes"><strong>Notas:</strong> ${escapeHtml(order.notes)}</div>` : ''}
    </div>
  `;
  window.print();
}

// La constante se mantiene exportada para el contrato histórico del Studio.
export { ESCPOS_TICKET_COLUMNS };
