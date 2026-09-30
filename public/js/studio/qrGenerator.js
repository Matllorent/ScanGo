/**
 * public/js/studio/qrGenerator.js
 * ───────────────────────────────
 * Módulo ES para generación de QR en Canvas y exportación en PDF de carteles de mesas.
 * Extraído de studio.js (generateQrCode, downloadQrPng, printTableStand, downloadAllTablesPDF).
 */

/**
 * Espera de forma reactiva y dirigida por eventos a que QRCode.js monte el canvas o img.
 * @param {HTMLElement} holder
 * @returns {Promise<HTMLCanvasElement|HTMLImageElement|null>}
 */
export function waitForQrSource(holder) {
  return new Promise((resolve) => {
    const qrCanvas = holder.querySelector('canvas');
    if (qrCanvas && qrCanvas.width > 0) return resolve(qrCanvas);

    const qrImg = holder.querySelector('img');
    if (qrImg && qrImg.complete && qrImg.naturalWidth > 0) return resolve(qrImg);

    if (qrImg) {
      qrImg.addEventListener('load', () => resolve(qrImg), { once: true });
      qrImg.addEventListener('error', () => resolve(null), { once: true });
      return;
    }

    let resolved = false;
    const observer = new MutationObserver(() => {
      const canvasEl = holder.querySelector('canvas');
      if (canvasEl && canvasEl.width > 0) {
        resolved = true;
        observer.disconnect();
        return resolve(canvasEl);
      }
      const imgEl = holder.querySelector('img');
      if (imgEl) {
        if (imgEl.complete && imgEl.naturalWidth > 0) {
          resolved = true;
          observer.disconnect();
          return resolve(imgEl);
        }
        imgEl.addEventListener('load', () => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve(imgEl);
          }
        }, { once: true });
        imgEl.addEventListener('error', () => {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve(null);
          }
        }, { once: true });
      }
    });

    observer.observe(holder, { childList: true, subtree: true });

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        const fallbackCanvas = holder.querySelector('canvas');
        const fallbackImg = holder.querySelector('img');
        resolve(fallbackCanvas || fallbackImg || null);
      }
    }, 1200);
  });
}

/**
 * Carga logo defensivo con gestión de CORS para evitar canvas tainted.
 * @param {string} url
 * @returns {Promise<HTMLImageElement|null>}
 */
export function loadSafeLogo(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const logo = new Image();
    if (!url.startsWith('data:') && !url.startsWith('blob:')) {
      logo.crossOrigin = 'anonymous';
    }
    logo.addEventListener('load', () => resolve(logo), { once: true });
    logo.addEventListener('error', (err) => {
      console.warn('[QR] No se pudo cargar el logo con CORS o falló la imagen externa. Fallback seguro sin tainting.', err);
      resolve(null);
    }, { once: true });
    logo.src = url;
  });
}

/**
 * Genera el QR Code con el badge central en el contenedor del Studio.
 * @param {object} restaurant
 */
export function generateQrCode(restaurant) {
  const container = document.getElementById('qrcodeCanvasContainer');
  if (!container || !restaurant) return;
  container.innerHTML = '';
  const fullUrl = window.location.origin + `/m/${restaurant.slug}`;

  if (typeof QRCode === 'undefined') {
    console.warn('[QR] QRCode library not loaded.');
    return;
  }

  const tempHolder = document.createElement('div');
  new QRCode(tempHolder, {
    text: fullUrl,
    width: 240,
    height: 240,
    colorDark: "#0E1412",
    colorLight: "#FFFFFF",
    correctLevel: QRCode.CorrectLevel.H
  });

  Promise.all([waitForQrSource(tempHolder), loadSafeLogo(restaurant.logoUrl)])
    .then(([qrSource, safeLogo]) => {
      const canvas = document.createElement('canvas');
      canvas.width = 240;
      canvas.height = 240;
      const ctx = canvas.getContext('2d');

      if (qrSource) {
        ctx.drawImage(qrSource, 0, 0, 240, 240);
      } else {
        container.innerHTML = '';
        container.appendChild(tempHolder);
        return;
      }

      const center = 120;
      const badgeRadius = 32;

      ctx.save();
      ctx.beginPath();
      ctx.arc(center, center, badgeRadius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ECC94B';
      ctx.stroke();

      const drawDefaultIcon = () => {
        ctx.beginPath();
        ctx.arc(center, center, badgeRadius, 0, 2 * Math.PI);
        ctx.fillStyle = '#151E1A';
        ctx.fill();
        ctx.font = '26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🍽️', center, center + 2);
      };

      if (safeLogo) {
        try {
          ctx.beginPath();
          ctx.arc(center, center, badgeRadius, 0, 2 * Math.PI);
          ctx.closePath();
          ctx.clip();
          ctx.drawImage(safeLogo, center - badgeRadius, center - badgeRadius, badgeRadius * 2, badgeRadius * 2);
        } catch (e) {
          console.warn('[QR] Error dibujando logo en canvas, aplicando ícono seguro:', e);
          drawDefaultIcon();
        }
      } else {
        drawDefaultIcon();
      }
      ctx.restore();

      container.innerHTML = '';
      container.appendChild(canvas);
    })
    .catch((err) => {
      console.error('[QR] Error renderizando QR:', err);
      container.innerHTML = '';
      container.appendChild(tempHolder);
    });
}

/**
 * Descarga el canvas QR actual como PNG.
 * @param {object} restaurant
 */
export function downloadQrPng(restaurant) {
  const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
  if (!canvas) return;
  try {
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = `QR-${restaurant?.slug || 'menu'}-menu-pizarron.png`;
    a.click();
  } catch (err) {
    console.error('[QR] Error al descargar imagen del QR (canvas tainted o bloqueado por CORS):', err);
    alert('No se pudo generar la descarga del QR debido a restricciones de seguridad (CORS) de la imagen del logo.');
  }
}

/**
 * Abre ventana emergente para imprimir cartel de mesa individual.
 * @param {object} restaurant
 */
export function printTableStand(restaurant) {
  const win = window.open('', '_blank');
  if (!win) return;
  const canvas = document.querySelector('#qrcodeCanvasContainer canvas');
  let src = '';
  try {
    src = canvas ? canvas.toDataURL('image/png') : '';
  } catch (err) {
    console.warn('[QR] Canvas tainted en printTableStand:', err);
  }
  const wifiText = restaurant?.wifi && restaurant.wifi.ssid ? `Wi-Fi: ${restaurant.wifi.ssid} | Clave: ${restaurant.wifi.password}` : '';

  win.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Tarjeta de Mesa — ${restaurant?.name || 'ScanGo'}</title>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; text-align: center; padding: 30px; background: #fff; color: #111; }
        .card { border: 2px solid #222; border-radius: 16px; padding: 28px; max-width: 380px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.1); }
        h1 { margin: 0 0 6px 0; font-size: 24px; font-weight: 800; }
        p { margin: 0 0 16px 0; color: #555; font-size: 14px; }
        img { width: 220px; height: 220px; margin-bottom: 12px; }
        .wifi { background: #f4f4f5; padding: 10px 14px; border-radius: 8px; font-weight: 600; font-size: 13px; border: 1px dashed #ccc; }
        .badge-powered { font-size: 10px; color: #888; margin-top: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
      </style>
    </head>
    <body>
      <div class="card">
        <h1>${restaurant?.name || ''}</h1>
        <p>${restaurant?.slogan || 'Escaneá para ver la carta y pedir por WhatsApp'}</p>
        ${src ? `<img src="${src}" alt="QR Menú" />` : ''}
        ${wifiText ? `<div class="wifi">📶 ${wifiText}</div>` : ''}
        <div class="badge-powered">Menú Digital • Menú Pizarrón Studio</div>
      </div>
      <script>setTimeout(() => window.print(), 300);<\/script>
    </body>
    </html>
  `);
  win.document.close();
}

/**
 * Genera PDF con todas las mesas configuradas usando jsPDF.
 * @param {object} restaurant
 */
export async function downloadAllTablesPDF(restaurant) {
  const tableInput = document.getElementById('inputTableCount');
  const tableCount = parseInt(tableInput?.value) || 10;
  if (tableCount < 1 || tableCount > 100) {
    alert('Por favor indica una cantidad de mesas entre 1 y 100.');
    return;
  }

  if (!window.jspdf || !window.jspdf.jsPDF) {
    alert('Cargando librería de PDF... Por favor espera un instante y reintenta.');
    return;
  }

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const primaryColor = [21, 30, 26]; // #151E1A
  const goldColor = [236, 201, 75]; // #ECC94B
  const textDimColor = [120, 130, 125];
  const wifiText = restaurant?.wifi && restaurant.wifi.ssid ? `Wi-Fi: ${restaurant.wifi.ssid}  |  Clave: ${restaurant.wifi.password}` : '';

  function makeQrDataUrl(url) {
    return new Promise((resolve) => {
      const temp = document.createElement('div');
      temp.style.display = 'none';
      document.body.appendChild(temp);
      new QRCode(temp, {
        text: url,
        width: 300,
        height: 300,
        colorDark: "#0E1412",
        colorLight: "#FFFFFF",
        correctLevel: QRCode.CorrectLevel.H
      });

      const cleanupAndResolve = () => {
        const canvas = temp.querySelector('canvas');
        const img = temp.querySelector('img');
        let dataUrl = '';
        try {
          if (canvas) {
            dataUrl = canvas.toDataURL('image/png');
          } else if (img) {
            dataUrl = img.src;
          }
        } catch (e) {
          console.warn('[PDF] Error generando dataUrl del QR:', e);
        }
        if (temp.parentNode) document.body.removeChild(temp);
        resolve(dataUrl);
      };

      const canvas = temp.querySelector('canvas');
      if (canvas && canvas.width > 0) return cleanupAndResolve();

      const img = temp.querySelector('img');
      if (img) {
        if (img.complete && img.naturalWidth > 0) return cleanupAndResolve();
        img.addEventListener('load', cleanupAndResolve, { once: true });
        img.addEventListener('error', cleanupAndResolve, { once: true });
        return;
      }

      let done = false;
      const obs = new MutationObserver(() => {
        const c = temp.querySelector('canvas');
        const i = temp.querySelector('img');
        if (c || (i && i.complete)) {
          if (!done) {
            done = true;
            obs.disconnect();
            cleanupAndResolve();
          }
        }
      });
      obs.observe(temp, { childList: true, subtree: true });
      setTimeout(() => {
        if (!done) {
          done = true;
          obs.disconnect();
          cleanupAndResolve();
        }
      }, 800);
    });
  }

  for (let m = 1; m <= tableCount; m++) {
    if (m > 1) pdf.addPage();

    const tableUrl = `${window.location.origin}/m/${restaurant?.slug}?mesa=${m}`;
    const qrData = await makeQrDataUrl(tableUrl);

    pdf.setDrawColor(...goldColor);
    pdf.setLineWidth(1.5);
    pdf.roundedRect(15, 15, 180, 267, 8, 8, 'D');

    pdf.setDrawColor(...primaryColor);
    pdf.setLineWidth(0.4);
    pdf.roundedRect(18, 18, 174, 261, 6, 6, 'D');

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(26);
    pdf.setTextColor(...primaryColor);
    pdf.text(restaurant?.name || 'Menú Pizarrón', 105, 42, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(12);
    pdf.setTextColor(...textDimColor);
    pdf.text(restaurant?.slogan || 'Carta Digital & Pedidos desde tu mesa', 105, 52, { align: 'center' });

    pdf.setFillColor(...goldColor);
    pdf.roundedRect(65, 62, 80, 16, 8, 8, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(16, 22, 20);
    pdf.text(`MESA  Nº ${m}`, 105, 73, { align: 'center' });

    if (qrData) {
      pdf.addImage(qrData, 'PNG', 50, 88, 110, 110);
    }

    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(14);
    pdf.setTextColor(...primaryColor);
    pdf.text('Escaneá con tu cámara para ver la carta', 105, 212, { align: 'center' });

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10);
    pdf.setTextColor(...textDimColor);
    pdf.text('Pedí directo al mozo o a WhatsApp sin esperar', 105, 220, { align: 'center' });

    if (wifiText) {
      pdf.setFillColor(245, 247, 246);
      pdf.setDrawColor(220, 225, 222);
      pdf.setLineWidth(0.3);
      pdf.roundedRect(35, 230, 140, 16, 4, 4, 'FD');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(9);
      pdf.setTextColor(...primaryColor);
      pdf.text(`📶  ${wifiText}`, 105, 240, { align: 'center' });
    }

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(150, 155, 152);
    pdf.text('Generado con ScanGo Menú Pizarrón • www.scango.app', 105, 270, { align: 'center' });
  }

  pdf.save(`Carteles-Mesas-${restaurant?.slug || 'menu'}.pdf`);
}
