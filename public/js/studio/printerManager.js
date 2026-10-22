/**
 * public/js/studio/printerManager.js
 * ──────────────────────────────────
 * Módulo ES para la gestión de impresión de tickets en ScanGo Studio.
 *
 * Soporta:
 *  - Impresión directa por WebUSB en impresoras térmicas ESC/POS (80mm)
 *  - Impresión estándar de ticket de cocina en diálogo del navegador (@media print)
 */

import {
  buildEscPosTicketOps as buildEscPosTicketOpsMod,
  ESCPOS_TICKET_COLUMNS as ESCPOS_TICKET_COLUMNS_MOD,
  ESCPOS_LIB_URL as ESCPOS_LIB_URL_MOD,
  ESCPOS_LIB_GLOBAL as ESCPOS_LIB_GLOBAL_MOD,
  ESCPOS_USB_CHUNK as ESCPOS_USB_CHUNK_MOD
} from './escposTicket.js';

let usbPrinterDevice = null;
let usbPrinterEndpoint = 0;
let escposLibPromise = null;

export function usbPrinterReady() {
  return Boolean(usbPrinterDevice && usbPrinterEndpoint > 0);
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

export function getEscPosEncoderClass() {
  if (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function') {
    return Promise.resolve(window[ESCPOS_LIB_GLOBAL_MOD]);
  }
  if (!escposLibPromise) {
    escposLibPromise = new Promise((resolve) => {
      try {
        const script = document.createElement('script');
        script.src = ESCPOS_LIB_URL_MOD;
        script.async = true;
        script.onload = () => resolve(
          (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function')
            ? window[ESCPOS_LIB_GLOBAL_MOD]
            : null
        );
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
        setTimeout(() => resolve(
          (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL_MOD] === 'function')
            ? window[ESCPOS_LIB_GLOBAL_MOD]
            : null
        ), 10000);
      } catch (e) {
        resolve(null);
      }
    });
  }
  return escposLibPromise;
}

export async function openUsbDevice(device) {
  await device.open();
  try {
    if (device.configuration === null || device.configuration === undefined) {
      await device.selectConfiguration(1);
    }
    const interfaces = (device.configuration && device.configuration.interfaces) || [];
    const printable = interfaces.find(i => i.alternate && i.alternate.interfaceClass === 7) || interfaces[0];
    if (!printable) throw new Error('no-interface');
    await device.claimInterface(printable.interfaceNumber);
    const outEp = ((printable.alternate && printable.alternate.endpoints) || [])
      .find(e => e.direction === 'out');
    if (!outEp) throw new Error('no-out-endpoint');
    usbPrinterDevice = device;
    usbPrinterEndpoint = outEp.endpointNumber;
    return true;
  } catch (e) {
    try {
      await device.close();
    } catch (closeErr) { /* ya estaba cerrada */ }
    usbPrinterDevice = null;
    usbPrinterEndpoint = 0;
    throw e;
  }
}

export async function connectUsbPrinter() {
  if (usbPrinterReady()) {
    try {
      if (usbPrinterDevice) await usbPrinterDevice.close();
    } catch (e) { /* best-effort */ }
    usbPrinterDevice = null;
    usbPrinterEndpoint = 0;
    setUsbStatus('');
    return;
  }
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    alert('Este navegador no soporta WebUSB. Usá Chrome o Edge en compu o Android.');
    return;
  }
  setUsbStatus('Buscando impresora…');
  try {
    const device = await navigator.usb.requestDevice({ filters: [] });
    await openUsbDevice(device);
    setUsbStatus(`Lista: ${device.productName || 'térmica USB'}`, true);
  } catch (e) {
    setUsbStatus('');
    if (e && e.name !== 'NotFoundError') {
      alert('No se pudo conectar la impresora USB. Probá con el botón 🖨️ Ticket.');
    }
  }
}

export async function restoreUsbPrinter() {
  try {
    if (typeof navigator === 'undefined' || !('usb' in navigator)) return;
    if (typeof navigator.usb.getDevices !== 'function') return;
    const devices = await navigator.usb.getDevices();
    if (devices.length) {
      await openUsbDevice(devices[0]);
      setUsbStatus(`Lista: ${devices[0].productName || 'térmica USB'}`, true);
    }
  } catch (e) { /* silencioso */ }
}

export async function sendToUsbPrinter(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < data.length; i += ESCPOS_USB_CHUNK_MOD) {
    await usbPrinterDevice.transferOut(usbPrinterEndpoint, data.slice(i, i + ESCPOS_USB_CHUNK_MOD));
  }
}

export function applyEscPosOps(encoder, ops) {
  for (const op of ops || []) {
    switch (op.t) {
      case 'init': encoder.initialize(); break;
      case 'align': encoder.align(op.v); break;
      case 'bold': encoder.bold(op.v !== false); break;
      case 'size': encoder.size(op.v); break;
      case 'line': encoder.line(op.v); break;
      case 'rule': encoder.rule(); break;
      case 'feed': encoder.newline(op.v || 1); break;
      case 'cut': encoder.cut(op.v || 'partial'); break;
      default: break;
    }
  }
  return encoder;
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
    const EncoderClass = await getEscPosEncoderClass();
    if (typeof EncoderClass !== 'function') throw new Error('lib-missing');
    const ops = buildEscPosTicketOpsMod(order, {
      restaurantName: (restaurant && (restaurant.name || restaurant.bizName)) || '',
      currency: order.currency || (restaurant && restaurant.currency) || '$'
    });
    const encoder = new EncoderClass({ columns: ESCPOS_TICKET_COLUMNS_MOD, language: 'esc-pos' });
    encoder.codepage('auto');
    applyEscPosOps(encoder, ops);
    const bytes = encoder.encode();
    try {
      await sendToUsbPrinter(bytes);
    } catch (sendErr) {
      try {
        if (usbPrinterDevice) await usbPrinterDevice.close();
      } catch (closeErr) { /* ya estaba muerta */ }
      usbPrinterDevice = null;
      usbPrinterEndpoint = 0;
      throw sendErr;
    }
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
