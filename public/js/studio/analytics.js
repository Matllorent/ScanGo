/**
 * public/js/studio/analytics.js
 * ─────────────────────────────
 * Módulo ES para el Dashboard de Analítica (gráficos Chart.js, heatmap, KPIs, sucursales y eventos).
 * Extraído de studio.js (loadAnalytics, fetchAnalytics, updateKPIs, updateBranchFilter,
 * updateEventFilter, renderDailyChart, renderHeatmap, renderBranchMetrics, renderEventMetrics).
 */

import { getValidBranches } from './billing.js';
import { buildDailyCsv, downloadCsv } from '../utils/csvExport.js';
import { escapeHtml } from '../utils/escapeHtmlBrowser.js';

let dailyChartInstance = null;
let _lastDaily = [];

export async function fetchAnalytics(url) {
  const token = localStorage.getItem('menu_pizarron_token');
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const data = await res.json();
    return res.ok ? data.data : null;
  } catch (e) {
    return null;
  }
}

export function updateKPIs(metrics) {
  const els = {
    visits: document.getElementById('kpiVisits'),
    dishClicks: document.getElementById('kpiDishClicks'),
    orders: document.getElementById('kpiOrders'),
    conversion: document.getElementById('kpiConversion'),
    waiter: document.getElementById('kpiWaiter'),
    avgTicket: document.getElementById('kpiAvgTicket'),
    revenue: document.getElementById('kpiRevenue')
  };
  if (els.visits) els.visits.textContent = metrics?.qrScans || 0;
  if (els.dishClicks) els.dishClicks.textContent = metrics?.dishClicks || 0;
  if (els.orders) els.orders.textContent = metrics?.ordersPlaced || 0;
  if (els.conversion) els.conversion.textContent = (metrics?.conversionRatePercent || 0).toFixed(1);
  if (els.waiter) els.waiter.textContent = metrics?.waiterCalls || 0;
  if (els.avgTicket) els.avgTicket.textContent = (metrics?.avgTicket || 0).toFixed(2);
  if (els.revenue) els.revenue.textContent = (metrics?.revenue || 0).toFixed(2);
}

export function updateBranchFilter(restaurant) {
  const select = document.getElementById('analyticsBranchFilter');
  if (!select) return;
  const current = select.value;
  const existingBranches = getValidBranches(restaurant);

  let options = '<option value="">Todas las sucursales</option>';
  options += '<option value="main">🏠 Principal</option>';
  existingBranches.forEach(b => {
    options += `<option value="${b.id}">${b.name}</option>`;
  });
  select.innerHTML = options;
  select.value = current;
}

export function updateEventFilter(events) {
  const select = document.getElementById('analyticsEventFilter');
  if (!select) return;
  const current = select.value;
  let options = '<option value="">Todos los eventos</option>';
  if (events && events.length) {
    events.forEach(e => {
      options += `<option value="${e.eventId}">${e.eventId}</option>`;
    });
  }
  select.innerHTML = options;
  select.value = current;
}

export function renderDailyChart(dailyData) {
  const ctx = document.getElementById('dailyChart')?.getContext('2d');
  if (!ctx || typeof Chart === 'undefined') return;

  if (dailyChartInstance) dailyChartInstance.destroy();

  const labels = dailyData?.map(d => {
    const date = new Date(d.date);
    return date.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
  }) || [];
  const visits = dailyData?.map(d => d.visits) || [];
  const clicks = dailyData?.map(d => d.dishClicks) || [];
  const orders = dailyData?.map(d => d.orders) || [];

  dailyChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Visitas (QR)',
          data: visits,
          borderColor: '#ECC94B',
          backgroundColor: 'rgba(236, 201, 75, 0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 3
        },
        {
          label: 'Clics en Platos',
          data: clicks,
          borderColor: '#60a5fa',
          backgroundColor: 'rgba(96, 165, 250, 0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 3
        },
        {
          label: 'Pedidos',
          data: orders,
          borderColor: '#4ade80',
          backgroundColor: 'rgba(74, 222, 128, 0.1)',
          tension: 0.3,
          fill: true,
          pointRadius: 3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: '#fff', font: { size: 10 } } },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#888', font: { size: 9 } } }
      }
    }
  });
}

export function renderHeatmap(heatmapData) {
  const container = document.getElementById('hourlyHeatmap');
  if (!container) return;

  if (!heatmapData || !heatmapData.length) {
    container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-dim);">No hay datos de heatmap disponibles</div>';
    return;
  }

  const maxVal = Math.max(...heatmapData.map(h => h.total));

  let html = '<div style="display:grid; grid-template-columns: 60px repeat(7, 1fr); gap:2px; font-size:10px;">';
  html += '<div style="padding:4px; text-align:center; font-weight:700; color:var(--text-dim);">Hora</div>';
  ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].forEach(d => {
    html += `<div style="padding:4px; text-align:center; font-weight:700; color:var(--text-dim);">${d}</div>`;
  });

  heatmapData.forEach(h => {
    html += `<div style="padding:4px; text-align:right; color:var(--text-dim); font-family:var(--font-mono);">${h.label}</div>`;
    h.days.forEach((val) => {
      const intensity = maxVal > 0 ? Math.min(1, val / maxVal) : 0;
      const hue = 120 - intensity * 120;
      const opacity = 0.3 + intensity * 0.7;
      html += `<div style="height:28px; background:hsl(${hue}, 70%, ${40 + intensity * 30}%); opacity:${opacity}; border-radius:4px; display:flex; align-items:center; justify-content:center; color:${intensity > 0.5 ? '#000' : '#fff'}; font-weight:700; font-size:9px;">${val || ''}</div>`;
    });
  });
  html += '</div>';
  container.innerHTML = html;
}

/**
 * Renderiza el Top 5 de platos con nombre real (resuelto en el backend).
 * @param {Array<{dishId: string, name?: string, clicks: number}>} topDishes
 */
export function renderTopDishes(topDishes) {
  const tbody = document.getElementById('topDishesBody');
  if (!tbody) return;

  if (!topDishes || !topDishes.length) {
    tbody.innerHTML = '<tr><td colspan="3" style="padding:20px; text-align:center; color:var(--text-dim);">Sin clicks de platos todavía. Interactuá con la carta para ver el ranking.</td></tr>';
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  let html = '';
  topDishes.slice(0, 5).forEach((d, i) => {
    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-size:14px; text-align:center;">${medals[i] || (i + 1)}</td>
        <td style="padding:8px; font-weight:700; color:#fff;">${escapeHtml(d.name || d.dishId || '—')}</td>
        <td style="padding:8px; text-align:center; color:#60a5fa; font-family:var(--font-mono); font-weight:700;">${d.clicks}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

export function renderBranchMetrics(branches) {
  const tbody = document.getElementById('branchMetricsBody');
  if (!tbody) return;

  if (!branches || !branches.length) {
    tbody.innerHTML = '<tr><td colspan="8" style="padding:20px; text-align:center; color:var(--text-dim);">No hay datos de sucursales</td></tr>';
    return;
  }

  let html = '';
  branches.forEach(b => {
    const topDishesStr = b.topDishes?.map(d => `${d.name || d.dishId || d.dish_id} (${d.clicks})`).join(', ') || '—';
    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-weight:700; color:#fff;">${b.branchId === 'main' ? '🏠 Principal' : b.branchId}</td>
        <td style="padding:8px; text-align:center; color:var(--accent-gold);">${b.visits}</td>
        <td style="padding:8px; text-align:center; color:#60a5fa;">${b.dishClicks}</td>
        <td style="padding:8px; text-align:center; color:#4ade80;">${b.orders}</td>
        <td style="padding:8px; text-align:center; color:#f87171;">${b.waiterCalls}</td>
        <td style="padding:8px; text-align:center; color:#fbbf24; font-family:var(--font-mono);">${(b.revenue ?? 0).toFixed(2)}</td>
        <td style="padding:8px; text-align:center; color:#34d399; font-family:var(--font-mono);">${(b.avgTicket ?? 0).toFixed(2)}</td>
        <td style="padding:8px; color:var(--text-dim); font-size:9px;">${topDishesStr}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

export function renderEventMetrics(events) {
  const section = document.getElementById('eventsMetricsSection');
  const tbody = document.getElementById('eventsMetricsBody');
  if (!section || !tbody) return;

  if (!events || !events.length) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';
  let html = '';
  events.forEach(e => {
    html += `
      <tr style="border-bottom:1px solid var(--border);">
        <td style="padding:8px; font-weight:700; color:#fff;">${e.eventId}</td>
        <td style="padding:8px; text-align:center; color:var(--accent-gold);">${e.scans}</td>
        <td style="padding:8px; text-align:center; color:#60a5fa;">${e.clicks}</td>
        <td style="padding:8px; text-align:center; color:#4ade80;">${e.orders}</td>
        <td style="padding:8px; text-align:center; color:#fbbf24;">${e.uniqueVisitors}</td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

export async function loadAnalytics(restaurant) {
  const token = localStorage.getItem('menu_pizarron_token');
  if (!token || !restaurant?.id) return;

  const days = parseInt(document.getElementById('analyticsTimeRange')?.value) || 30;
  const branchId = document.getElementById('analyticsBranchFilter')?.value || undefined;
  const eventId = document.getElementById('analyticsEventFilter')?.value || undefined;

  try {
    const [weekly, daily, heatmap, branches, events] = await Promise.all([
      fetchAnalytics(`/api/analytics/weekly/${restaurant.id}`),
      fetchAnalytics(`/api/analytics/daily/${restaurant.id}?days=${days}${branchId ? '&branchId=' + branchId : ''}${eventId ? '&eventId=' + eventId : ''}`),
      fetchAnalytics(`/api/analytics/heatmap/${restaurant.id}?days=7${branchId ? '&branchId=' + branchId : ''}${eventId ? '&eventId=' + eventId : ''}`),
      fetchAnalytics(`/api/analytics/branches/${restaurant.id}?days=${days}`),
      fetchAnalytics(`/api/analytics/events/${restaurant.id}`)
    ]);

    // Guardar el último daily para el export CSV (filtros actuales)
    _lastDaily = daily || [];

    if (weekly?.metrics) updateKPIs(weekly.metrics);
    updateBranchFilter(restaurant);
    updateEventFilter(events);
    renderDailyChart(daily);
    renderTopDishes(weekly?.topDishes || []);
    renderHeatmap(heatmap);
    renderBranchMetrics(branches);
    renderEventMetrics(events);
  } catch (err) {
    console.warn('[Analytics] Error loading data:', err.message);
  }
}

/**
 * Exporta a CSV las métricas diarias del rango y filtros seleccionados
 * (BOM UTF-8 para que Excel respete acentos).
 */
export function exportAnalytics() {
  if (!_lastDaily || !_lastDaily.length) {
    alert('No hay datos diarios para exportar todavía. Cargá la pestaña Analíticas primero.');
    return;
  }
  const csv = buildDailyCsv(_lastDaily);
  const dateStamp = new Date().toISOString().split('T')[0];
  downloadCsv(`analiticas-${dateStamp}.csv`, csv);
}
