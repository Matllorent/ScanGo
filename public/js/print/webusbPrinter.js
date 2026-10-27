/**
 * public/js/print/webusbPrinter.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Transporte WebUSB GENÉRICO para impresoras térmicas ESC/POS (80 mm).
 * Compartido por el Studio (Pedidos en vivo) y la Vista Kitchen (KDS): la
 * lógica de abrir el dispositivo, cargar la librería MIT bajo demanda y
 * trocear los bytes vive en UN solo lugar.
 *
 * Este módulo no pinta UI: cada página decide sus botones/estados. Tampoco
 * conoce pedidos: el builder puro (`escposTicket.js`) arma las operaciones y
 * acá solo se convierten a bytes y se envían.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import {
  ESCPOS_TICKET_COLUMNS,
  ESCPOS_LIB_URL,
  ESCPOS_LIB_GLOBAL,
  ESCPOS_USB_CHUNK
} from '../studio/escposTicket.js';

let printerDevice = null;
let printerEndpoint = 0;
let encoderLibPromise = null;

/** ¿El navegador expone WebUSB? (Chrome/Edge en compu o Android). */
export function isWebUsbSupported() {
  return typeof navigator !== 'undefined' && Boolean(navigator.usb);
}

/** ¿Hay una impresora abierta y con endpoint OUT listo? */
export function isPrinterReady() {
  return Boolean(printerDevice && printerEndpoint > 0);
}

export function getPrinterName() {
  return (printerDevice && printerDevice.productName) || 'térmica USB';
}

/**
 * Carga la librería MIT `@point-of-sale/receipt-printer-encoder` bajo demanda
 * (pin exacto en jsDelivr, ya permitido por la CSP). Cachea la promesa: una
 * sola inyección por página.
 */
export function loadEncoderClass() {
  if (typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL] === 'function') {
    return Promise.resolve(window[ESCPOS_LIB_GLOBAL]);
  }
  if (!encoderLibPromise) {
    encoderLibPromise = new Promise((resolve) => {
      try {
        const script = document.createElement('script');
        script.src = ESCPOS_LIB_URL;
        script.async = true;
        script.onload = () => resolve(
          typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL] === 'function'
            ? window[ESCPOS_LIB_GLOBAL]
            : null
        );
        script.onerror = () => resolve(null);
        document.head.appendChild(script);
        setTimeout(() => resolve(
          typeof window !== 'undefined' && typeof window[ESCPOS_LIB_GLOBAL] === 'function'
            ? window[ESCPOS_LIB_GLOBAL]
            : null
        ), 10000);
      } catch {
        resolve(null);
      }
    });
  }
  return encoderLibPromise;
}

/**
 * Abre un dispositivo ya elegido y reclama la interfaz de impresora (clase 7)
 * + su endpoint OUT. Si algo falla, cierra el dispositivo para no dejarlo a
 * medio abrir.
 */
export async function openDevice(device) {
  await device.open();
  try {
    if (device.configuration === null || device.configuration === undefined) {
      await device.selectConfiguration(1);
    }
    const interfaces = (device.configuration && device.configuration.interfaces) || [];
    const printable = interfaces.find((i) => i.alternate && i.alternate.interfaceClass === 7) || interfaces[0];
    if (!printable) throw new Error('no-interface');
    await device.claimInterface(printable.interfaceNumber);
    const outEp = ((printable.alternate && printable.alternate.endpoints) || [])
      .find((e) => e.direction === 'out');
    if (!outEp) throw new Error('no-out-endpoint');
    printerDevice = device;
    printerEndpoint = outEp.endpointNumber;
    return true;
  } catch (e) {
    try {
      await device.close();
    } catch { /* ya estaba cerrada */ }
    printerDevice = null;
    printerEndpoint = 0;
    throw e;
  }
}

/** Cierra la impresora actual (best-effort) y olvida el endpoint. */
export async function forgetPrinter() {
  try {
    if (printerDevice) await printerDevice.close();
  } catch { /* best-effort */ }
  printerDevice = null;
  printerEndpoint = 0;
}

/**
 * Abre el selector de WebUSB y deja la impresora lista. Lanza
 * `WEBUSB_UNSUPPORTED` si el navegador no lo soporta (la UI decide el copy).
 */
export async function requestPrinter() {
  if (!isWebUsbSupported()) {
    const err = new Error('WebUSB no disponible');
    err.code = 'WEBUSB_UNSUPPORTED';
    throw err;
  }
  const device = await navigator.usb.requestDevice({ filters: [] });
  await openDevice(device);
  return device;
}

/**
 * Restaura un permiso YA otorgado (sin selector). Silencioso: si no hay
 * dispositivos o el navegador no soporta `getDevices`, devuelve null.
 */
export async function restorePrinter() {
  try {
    if (!isWebUsbSupported() || typeof navigator.usb.getDevices !== 'function') return null;
    const devices = await navigator.usb.getDevices();
    if (!devices.length) return null;
    await openDevice(devices[0]);
    return devices[0];
  } catch {
    return null;
  }
}

/** Envía bytes al endpoint OUT en trozos de 8 KB (límite sano de WebUSB). */
export async function sendBytes(bytes) {
  if (!isPrinterReady()) {
    const err = new Error('Impresora no conectada');
    err.code = 'PRINTER_NOT_READY';
    throw err;
  }
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  for (let i = 0; i < data.length; i += ESCPOS_USB_CHUNK) {
    await printerDevice.transferOut(printerEndpoint, data.slice(i, i + ESCPOS_USB_CHUNK));
  }
}

/** Aplica las operaciones puras del builder sobre una instancia del encoder. */
export function applyOps(encoder, ops) {
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

/**
 * Puerta única de impresión: encoder + codepage automática (ñ/á/ú) + bytes.
 * Si el envío falla, cierra la impresora para que el próximo toque reconecte
 * en vez de quedar con un endpoint muerto.
 */
export async function printTicketOps(EncoderClass, ops) {
  if (typeof EncoderClass !== 'function') {
    const err = new Error('Librería ESC/POS no disponible');
    err.code = 'ENCODER_LIB_MISSING';
    throw err;
  }
  const encoder = new EncoderClass({ columns: ESCPOS_TICKET_COLUMNS, language: 'esc-pos' });
  encoder.codepage('auto');
  applyOps(encoder, ops);
  const bytes = encoder.encode();
  try {
    await sendBytes(bytes);
  } catch (e) {
    await forgetPrinter();
    throw e;
  }
}
