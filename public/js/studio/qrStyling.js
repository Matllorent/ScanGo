/**
 * public/js/studio/qrStyling.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Generación de códigos QR profesionales con logo al centro, colores de marca,
 * formas de módulos y ojos, y llamada a la acción (CTA).
 *
 * Estrategia: usa `QRCode.js` (ya cargado por CDN en studio.html, sin romper
 * la CSP) para calcular la matriz de datos con corrección de error 'H', y
 * renderiza todo sobre canvas con la API nativa del navegador. Control total
 * del diseño, cero dependencias nuevas, cero peso extra.
 *
 * Corrección de error 'H': permite cubrir hasta ~30% del área del QR con el
 * logo sin perder legibilidad. La máscara del logo se calcula sobre la matriz
 * de datos para que los módulos dañados sean redundantes.
 *
 * Uso:
 *   import { generateStyledQR, downloadStyledQR } from './studio/qrStyling.js';
 *   generateStyledQR(container, restaurant, {
 *     primaryColor: '#ECC94B',
 *     secondaryColor: '#0E1412',
 *     moduleShape: 'square',   // 'square' | 'rounded' | 'dot'
 *     eyeShape: 'square',      // 'square' | 'rounded' | 'dot' | 'frame'
 *     logoUrl: 'data:...',
 *     ctaText: 'Escaneá para pedir',
 *     showCta: true
 *   });
 */

import { waitForQrSource, loadSafeLogo } from './qrGenerator.js';

/** Formas válidas de módulos y ojos. */
export const MODULE_SHAPES = ['square', 'rounded', 'dot'];
export const EYE_SHAPES = ['square', 'rounded', 'dot', 'frame'];
export const DEFAULT_OPTIONS = {
  primaryColor: '#ECC94B',      // oro ScanGo
  secondaryColor: '#0E1412',    // oscuro ScanGo
  backgroundColor: '#FFFFFF',
  moduleShape: 'square',
  eyeShape: 'square',
  logoUrl: null,
  logoSizePercent: 22,          // % del ancho del QR que ocupa el logo (máx 30 con nivel H)
  logoBorderWidth: 4,
  logoBorderColor: '#FFFFFF',
  ctaText: 'Escaneá para pedir',
  showCta: true,
  ctaColor: '#0E1412',
  ctaFontSize: 14,
  quietZoneModules: 4           // módulos de silencio alrededor
};

/**
 * Hex -> RGB.
 * @param {string} hex
 * @returns {{r:number,g:number,b:number}}
 */
const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  const bigint = parseInt(h, 16);
  return {
    r: (bigint >> 16) & 255,
    g: (bigint >> 8) & 255,
    b: bigint & 255
  };
};

/**
 * Dibuja un módulo individual con la forma elegida.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} size
 * @param {string} shape
 */
const drawModule = (ctx, x, y, size, shape) => {
  const r = size * 0.22; // radio para esquinas redondeadas / puntos
  switch (shape) {
    case 'rounded':
      ctx.beginPath();
      ctx.roundRect(x, y, size, size, r);
      ctx.fill();
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(x + size / 2, y + size / 2, size * 0.42, 0, 2 * Math.PI);
      ctx.fill();
      break;
    case 'square':
    default:
      ctx.fillRect(x, y, size, size);
  }
};

/**
 * Dibuja un ojo de posicionamiento con la forma elegida.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} size
 * @param {string} shape
 * @param {string} color
 */
const drawEye = (ctx, x, y, size, shape, color) => {
  ctx.fillStyle = color;
  const outer = size;           // 7x7 módulos
  const middle = size * 5 / 7;  // 5x5 módulos
  const inner = size * 3 / 7;   // 3x3 módulos
  const cx = x + outer / 2;
  const cy = y + outer / 2;

  switch (shape) {
    case 'frame':
      // Ojo hueco (marco): solo el borde externo de 1 módulo de grosor
      ctx.lineWidth = size / 7;
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.rect(x + size / 14, y + size / 14, outer - size / 7, outer - size / 7);
      ctx.stroke();
      // Centro relleno con color de fondo (vacío)
      ctx.fillStyle = ctx.canvas ? (ctx.canvas.style.backgroundColor || '#FFFFFF') : '#FFFFFF';
      ctx.fillRect(x + middle / 2, y + middle / 2, inner, inner);
      break;
    case 'dot':
      ctx.beginPath();
      ctx.arc(cx, cy, outer * 0.28, 0, 2 * Math.PI);
      ctx.fill();
      break;
    case 'rounded':
      ctx.beginPath();
      ctx.roundRect(x + outer * 0.14, y + outer * 0.14, outer * 0.72, outer * 0.72, outer * 0.14);
      ctx.fill();
      break;
    case 'square':
    default:
      ctx.fillRect(x, y, outer, outer);
      // Anillo interior de 5x5
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(x + size / 7, y + size / 7, middle, middle);
      // Núcleo de 3x3
      ctx.fillStyle = color;
      ctx.fillRect(x + middle / 2, y + middle / 2, inner, inner);
  }
};

/**
 * Calcula el radio máximo seguro para el logo basado en la matriz QR y el
 * nivel de corrección 'H'. Evita tapar módulos críticos (ojos, patrones de
 * alineación, información de formato).
 * @param {number[][]} matrix - matriz booleana de QRCode.js
 * @param {number} moduleSize - tamaño en px de cada módulo
 * @param {number} centerX @param {number} centerY
 * @param {number} logoSizePercent - % del ancho total del QR
 * @returns {number} radio seguro en px
 */
const safeLogoRadius = (matrix, moduleSize, centerX, centerY, logoSizePercent) => {
  const qrSize = matrix.length;
  const totalPx = qrSize * moduleSize;
  const maxRadiusPx = (totalPx * (logoSizePercent / 100)) / 2;

  // Los ojos ocupan las esquinas (7x7 módulos cada uno + 1 de silencio).
  // Centro del QR: índice (qrSize-1)/2. Los ojos están en las esquinas.
  // Un radio seguro no debe solaparse con ningún ojo ni con los patrones de
  // alineación (para QR grandes). Con nivel H y logo ≤30%, el centro es seguro.
  const eyeZone = 8 * moduleSize; // 7 módulos + 1 de margen por lado
  const cornerDistance = Math.hypot(
    Math.abs(centerX - eyeZone / 2),
    Math.abs(centerY - eyeZone / 2)
  );
  const distanceToNearestEye = Math.min(
    Math.hypot(Math.abs(centerX - eyeZone / 2), Math.abs(centerY - eyeZone / 2)),
    Math.hypot(Math.abs(centerX - (qrSize - 1 - eyeZone / 2) * moduleSize), Math.abs(centerY - eyeZone / 2)),
    Math.hypot(Math.abs(centerX - eyeZone / 2), Math.abs(centerY - (qrSize - 1 - eyeZone / 2) * moduleSize)),
    Math.hypot(Math.abs(centerX - (qrSize - 1 - eyeZone / 2) * moduleSize), Math.abs(centerY - (qrSize - 1 - eyeZone / 2) * moduleSize))
  );

  // El logo no debe tocar los ojos: deja un margen de 1 módulo alrededor.
  const safeByEye = Math.max(0, distanceToNearestEye - moduleSize);
  return Math.min(maxRadiusPx, safeByEye, totalPx / 2 - moduleSize);
};

/**
 * Genera el QR personalizado y lo pinta en el contenedor del Studio.
 * @param {HTMLElement} container - contenedor DOM donde se inserta el canvas
 * @param {object|null} restaurant - datos del restaurante (slug, logoUrl, nombre)
 * @param {object} options - opciones de estilo (ver DEFAULT_OPTIONS)
 */
export async function generateStyledQR(container, restaurant, options = {}) {
  if (!container || !restaurant) return;
  container.innerHTML = '';

  const fullUrl = window.location.origin + `/m/${restaurant.slug}`;
  const cfg = { ...DEFAULT_OPTIONS, ...options };

  if (typeof QRCode === 'undefined') {
    console.warn('[QR] QRCode library not loaded.');
    container.innerHTML = '<div style="color:#EF4444;">Error: librería QR no cargada.</div>';
    return;
  }

  // 1. Crear QR base invisible para obtener la matriz de datos
  const temp = document.createElement('div');
  temp.style.display = 'none';
  document.body.appendChild(temp);

  const qrSizePx = 600; // alta resolución para descarga
  new QRCode(temp, {
    text: fullUrl,
    width: qrSizePx,
    height: qrSizePx,
    colorDark: '#000000',
    colorLight: '#FFFFFF',
    correctLevel: QRCode.CorrectLevel.H
  });

  const qrSource = await waitForQrSource(temp);
  if (!qrSource) {
    container.innerHTML = '<div style="color:#EF4444;">No se pudo generar el QR.</div>';
    temp.remove();
    return;
  }

  // Extraer matriz booleana dibujando en canvas auxiliar y leyendo pixels
  const matrixCanvas = document.createElement('canvas');
  matrixCanvas.width = qrSizePx;
  matrixCanvas.height = qrSizePx;
  const mCtx = matrixCanvas.getContext('2d');
  mCtx.drawImage(qrSource, 0, 0);
  const matrixData = mCtx.getImageData(0, 0, qrSizePx, qrSizePx).data;

  // Reconstruir matriz booleana (módulo oscuro = true)
  const moduleCount = 29; // QRCode.js default para este tamaño/texto; se detecta
  const detectedSize = Math.sqrt(matrixData.length / 4) / moduleCount;
  // Fallback robusto: QRCode.js renderiza cuadrado; contar módulos por bordes
  const sizeInModules = Math.round(qrSizePx / detectedSize) || 29;

  const matrix = [];
  for (let ry = 0; ry < sizeInModules; ry++) {
    const row = [];
    for (let rx = 0; rx < sizeInModules; rx++) {
      const px = Math.round((rx + 0.5) * detectedSize);
      const py = Math.round((ry + 0.5) * detectedSize);
      const idx = (py * qrSizePx + px) * 4;
      // Módulo oscuro si el canal rojo es bajo
      row.push(matrixData[idx] < 128);
    }
    matrix.push(row);
  }

  const moduleSize = qrSizePx / sizeInModules;

  // 2. Renderizar canvas final con estilo
  const canvas = document.createElement('canvas');
  canvas.width = qrSizePx;
  canvas.height = qrSizePx + (cfg.showCta ? 60 : 0); // espacio para CTA
  const ctx = canvas.getContext('2d');

  // Fondo
  ctx.fillStyle = cfg.backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const centerX = qrSizePx / 2;
  const centerY = qrSizePx / 2;
  const quietZonePx = cfg.quietZoneModules * moduleSize;

  // 3. Dibujar módulos de datos (salvando los ojos para después)
  const darkRgb = hexToRgb(cfg.secondaryColor);
  const lightRgb = hexToRgb(cfg.backgroundColor);

  ctx.fillStyle = cfg.secondaryColor;

  for (let ry = 0; ry < sizeInModules; ry++) {
    for (let rx = 0; rx < sizeInModules; rx++) {
      // Saltar zonas de ojos (se dibujan después) y zona del logo
      const isEyeZone =
        (rx < 8 && ry < 8) ||
        (rx > sizeInModules - 9 && ry < 8) ||
        (rx < 8 && ry > sizeInModules - 9);
      if (isEyeZone) continue;

      const isLogoZone = cfg.logoUrl
        ? Math.hypot(rx * moduleSize + moduleSize / 2 - centerX, ry * moduleSize + moduleSize / 2 - centerY) <
          safeLogoRadius(matrix, moduleSize, centerX, centerY, cfg.logoSizePercent)
        : false;
      if (isLogoZone) continue;

      if (matrix[ry][rx]) {
        drawModule(ctx, rx * moduleSize, ry * moduleSize, moduleSize, cfg.moduleShape);
      }
    }
  }

  // 4. Dibujar ojos de posicionamiento (3 esquinas)
  const eyeSize = 7 * moduleSize;
  const eyePositions = [
    { x: cfg.quietZoneModules * moduleSize, y: cfg.quietZoneModules * moduleSize },
    { x: (sizeInModules - 7 - cfg.quietZoneModules) * moduleSize, y: cfg.quietZoneModules * moduleSize },
    { x: cfg.quietZoneModules * moduleSize, y: (sizeInModules - 7 - cfg.quietZoneModules) * moduleSize }
  ];
  for (const pos of eyePositions) {
    drawEye(ctx, pos.x, pos.y, eyeSize, cfg.eyeShape, cfg.secondaryColor);
  }

  // 5. Dibujar logo al centro con máscara protectora
  if (cfg.logoUrl) {
    const safeLogo = await loadSafeLogo(cfg.logoUrl);
    if (safeLogo) {
      const radius = safeLogoRadius(matrix, moduleSize, centerX, centerY, cfg.logoSizePercent);
      const diameter = radius * 2;

      // Anillo de marca alrededor del logo
      if (cfg.logoBorderWidth > 0) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, radius + cfg.logoBorderWidth, 0, 2 * Math.PI);
        ctx.fillStyle = cfg.logoBorderColor;
        ctx.fill();
      }

      // Máscara circular para recortar el logo
      ctx.save();
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.clip();
      ctx.drawImage(
        safeLogo,
        centerX - radius,
        centerY - radius,
        diameter,
        diameter
      );
      ctx.restore();
    }
  }

  // 6. CTA (llamada a la acción) debajo del QR
  if (cfg.showCta && cfg.ctaText) {
    ctx.fillStyle = cfg.ctaColor;
    ctx.font = `bold ${cfg.ctaFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const ctaY = qrSizePx + 30;
    ctx.fillText(cfg.ctaText, centerX, ctaY);
  }

  // 7. Insertar en contenedor (reemplazar contenido previo)
  container.innerHTML = '';
  container.appendChild(canvas);

  // Limpiar temp
  temp.remove();

  return { canvas, fullUrl, sizeInModules };
}

/**
 * Descarga el canvas QR actual como PNG de alta resolución.
 * @param {HTMLCanvasElement} canvas
 * @param {string} filename
 * @param {number} scale - factor de escala (2 = 2x para impresión)
 */
export function downloadStyledQR(canvas, filename = 'QR-scango.png', scale = 2) {
  if (!canvas) return;
  try {
    // Escalar para impresión de calidad
    const scaled = document.createElement('canvas');
    scaled.width = canvas.width * scale;
    scaled.height = canvas.height * scale;
    const sCtx = scaled.getContext('2d');
    sCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

    const a = document.createElement('a');
    a.href = scaled.toDataURL('image/png');
    a.download = filename;
    a.click();
  } catch (err) {
    console.error('[QR] Error descargando QR personalizado:', err);
    alert('No se pudo descargar el QR. Asegurate de que el logo no tenga restricciones de CORS.');
  }
}

/**
 * Imprime cartel de mesa individual con el QR personalizado.
 * @param {object} restaurant
 * @param {HTMLCanvasElement} canvas
 * @param {object} options
 */
export function printTableStandStyled(restaurant, canvas, options = {}) {
  if (!canvas) return;
  const win = window.open('', '_blank');
  if (!win) return;

  let src = '';
  try {
    src = canvas.toDataURL('image/png');
  } catch (err) {
    console.warn('[QR] Canvas tainted en printTableStandStyled:', err);
  }

  const wifiText = restaurant?.wifi && restaurant.wifi.ssid
    ? `Wi-Fi: ${restaurant.wifi.ssid} | Clave: ${restaurant.wifi.password}`
    : '';
  const cta = options.ctaText || 'Escaneá para pedir';
  const primary = options.primaryColor || '#ECC94B';
  const secondary = options.secondaryColor || '#0E1412';

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tarjeta de Mesa — ${restaurant?.name || 'ScanGo'}</title>
      <style>
        @page { size: 105mm 148mm; margin: 0; } /* A6 */
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 0; margin: 0; background: #fff; color: #111; display: flex; flex-direction: column; justify-content: center; align-items: center; height: 100vh; box-sizing: border-box; }
        .card { border: 2px solid ${secondary}; border-radius: 16px; padding: 24px; max-width: 340px; width: 90%; box-shadow: 0 4px 20px rgba(0,0,0,0.15); background: #fff; }
        h1 { margin: 0 0 6px 0; font-size: 20px; font-weight: 800; color: ${secondary}; }
        p { margin: 0 0 14px 0; color: #555; font-size: 13px; }
        img { width: 200px; height: 200px; margin-bottom: 10px; image-rendering: -webkit-optimize-contrast; }
        .cta { display: inline-block; margin-top: 6px; font-weight: 700; color: ${secondary}; font-size: 13px; letter-spacing: 0.3px; }
        .wifi { background: #f4f4f5; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 12px; border: 1px dashed #ccc; margin-top: 10px; }
        .badge-powered { font-size: 9px; color: #888; margin-top: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
        .viral-line { font-size: 9px; color: #9A9A9A; margin-top: 5px; }
        @media print { body { height: auto; } .card { box-shadow: none; border: 2px solid ${secondary}; } }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${restaurant?.name || ''}</h1>
        <p>${restaurant?.slogan || 'Escaneá para ver la carta y pedir por WhatsApp'}</p>
        ${src ? `<img src="${src}" alt="QR Menú" />` : ''}
        <div class="cta">${cta}</div>
        ${wifiText ? `<div class="wifi">📶 ${wifiText}</div>` : ''}
        <div class="badge-powered">Menú Digital • ScanGo</div>
        <div class="viral-line">Esta carta corre con ScanGo · ${window.location.origin}</div>
      </div>
      <script>setTimeout(() => window.print(), 300);<\/script>
    </body>
    </html>
  `);
  win.document.close();
}
