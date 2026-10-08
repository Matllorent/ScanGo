/**
 * public/js/utils/csvExport.js
 * ─────────────────────────────
 * Utilidades puras de exportación CSV para el dashboard de Analítica.
 * buildDailyCsv() es 100% pura (sin DOM) → testeable en Node vía import().
 * downloadCsv() solo toca el DOM y se usa exclusivamente en el navegador.
 */

/**
 * Construye el CSV de métricas diarias (devuelve el texto; no toca DOM).
 * @param {Array<{date:string, visits?:number, dishClicks?:number, orders?:number, waiterCalls?:number, revenue?:number}>} dailyData
 * @param {{headers?: string[]}} [options]
 * @returns {string} Contenido CSV con header + una fila por día
 */
export function buildDailyCsv(dailyData, options = {}) {
  const headers = options.headers || [
    'Fecha', 'Visitas', 'Clics en Platos', 'Pedidos', 'Llamados Mozo', 'Ingresos (est.)'
  ];
  const rows = (dailyData || []).map(d => [
    d.date || '',
    d.visits ?? 0,
    d.dishClicks ?? 0,
    d.orders ?? 0,
    d.waiterCalls ?? 0,
    d.revenue ?? 0
  ]);

  const escapeCell = (value) => {
    const s = String(value);
    // RFC 4180: entrecomillar si contiene separador, salto o comilla
    if (/[",\n;]/.test(s)) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.map(escapeCell).join(',')];
  rows.forEach(row => lines.push(row.map(escapeCell).join(',')));
  return lines.join('\n');
}

/**
 * Descarga un CSV en el navegador (BOM UTF-8 para Excel con acentos).
 * @param {string} filename
 * @param {string} csvText
 */
export function downloadCsv(filename, csvText) {
  const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}