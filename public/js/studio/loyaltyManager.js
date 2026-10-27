/**
 * public/js/studio/loyaltyManager.js
 * ──────────────────────────────────
 * Módulo ES para la gestión del Club de Fidelización en ScanGo Studio.
 * 
 * Funcionalidades:
 *  - Configuración del catálogo de beneficios/recompensas del local
 *  - Validación de códigos de canje ingresados por el comensal
 *  - Análisis de clientes en riesgo de churn y envío de emails de recupero
 */

import { apiFetch } from './api.js';

let churnListCache = [];

function getLoyaltyConfig(restaurant) {
  if (!restaurant) return null;
  if (!restaurant.loyaltyConfig) restaurant.loyaltyConfig = {};
  if (!Array.isArray(restaurant.loyaltyConfig.rewards)) restaurant.loyaltyConfig.rewards = [];
  return restaurant.loyaltyConfig;
}

export function renderLoyaltyRewardRows(restaurant, escapeHtml) {
  const container = document.getElementById('loyaltyRewardRows');
  if (!container) return;
  const cfg = getLoyaltyConfig(restaurant);
  const rewards = cfg ? cfg.rewards : [];
  if (!rewards.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin beneficios configurados. Tocá "Agregar beneficio" para armar tu catálogo.</div>';
    return;
  }
  container.innerHTML = rewards.map((r, i) => `
    <div style="display:flex; gap:8px; align-items:center; margin-bottom:6px;">
      <input type="text" id="loyaltyRewardTitle_${i}" class="form-input" value="${escapeHtml(String(r.title || ''))}" placeholder="Nombre del beneficio"
             data-js-input="updateLoyaltyRewardField|${i}|title|this.value" style="flex:1; font-size:11px; padding:6px 8px;">
      <input type="number" id="loyaltyRewardCost_${i}" class="form-input" value="${Number(r.pointsCost) || 0}" min="0" step="10"
             data-js-input="updateLoyaltyRewardField|${i}|cost|this.value" style="width:96px; font-size:11px; padding:6px 8px;" title="Puntos requeridos">
      <button type="button" class="btn-nav" data-js-click="removeLoyaltyReward|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
    </div>
  `).join('');
}

export function updateLoyaltyRewardField(restaurant, index, field, value) {
  const cfg = getLoyaltyConfig(restaurant);
  if (!cfg) return;
  const reward = cfg.rewards[index];
  if (!reward) return;
  if (field === 'title') reward.title = String(value || '').trim().slice(0, 60);
  else if (field === 'cost') reward.pointsCost = Math.max(0, Number(value) || 0);
}

export function addLoyaltyReward(restaurant, escapeHtml, triggerAutoSave) {
  const cfg = getLoyaltyConfig(restaurant);
  if (!cfg) return;
  cfg.rewards.push({ id: 'rew_' + Date.now().toString(36), title: '', pointsCost: 100 });
  renderLoyaltyRewardRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function removeLoyaltyReward(restaurant, index, escapeHtml, triggerAutoSave) {
  const cfg = getLoyaltyConfig(restaurant);
  if (!cfg) return;
  cfg.rewards.splice(index, 1);
  renderLoyaltyRewardRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export async function validateLoyaltyCode(escapeHtml) {
  const codeEl = document.getElementById('inputRedeemCode');
  const resultEl = document.getElementById('loyaltyValidateResult');
  if (!codeEl || !resultEl) return;
  const code = codeEl.value.trim().toUpperCase();
  if (!code) {
    resultEl.innerHTML = '<span style="color:#F87171;">Ingresá el código de canje del comensal.</span>';
    return;
  }
  resultEl.innerHTML = '<span style="color:var(--text-dim);">⏳ Validando…</span>';
  try {
    const body = await apiFetch('/api/loyalty/validate', { method: 'POST', body: JSON.stringify({ code }) });
    const d = body.data || {};
    resultEl.innerHTML = `<span style="color:#68D391;">✓ Código válido — ${escapeHtml(d.rewardTitle || 'canje')} (${escapeHtml(d.code || code)}) marcado como canjeado.</span>`;
    codeEl.value = '';
  } catch (e) {
    const msg = e && e.message ? e.message : 'Código no válido';
    resultEl.innerHTML = `<span style="color:#F87171;">✕ ${escapeHtml(msg)}</span>`;
  }
}

export function handleRedeemCodeEnter(event, escapeHtml) {
  if (event && event.key === 'Enter') validateLoyaltyCode(escapeHtml);
}

export async function loadChurnList(escapeHtml) {
  const list = document.getElementById('churnList');
  const daysEl = document.getElementById('inputChurnDays');
  const minVisitsEl = document.getElementById('inputChurnMinVisits');
  if (!list) return;
  const days = daysEl ? (Number(daysEl.value) || 45) : 45;
  const minVisits = minVisitsEl ? (Number(minVisitsEl.value) || 2) : 2;
  list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">⏳ Analizando…</div>';
  try {
    const body = await apiFetch(`/api/loyalty/churn?days=${encodeURIComponent(days)}&minVisits=${encodeURIComponent(minVisits)}`);
    if (!body.data) {
      list.innerHTML = `<div style="font-size:11px; color:#F87171;">${escapeHtml(body.error || 'No se pudo calcular la lista.')}</div>`;
      return;
    }
    const report = body.data;
    const candidates = report.candidates || [];
    churnListCache = candidates;
    if (!candidates.length) {
      list.innerHTML = `<div style="font-size:11px; color:#68D391;">✓ Sin clientes en riesgo con ausencia de ${report.thresholdDays} días y ${report.minVisits} ${report.minVisits === 1 ? 'visita' : 'visitas'} o más. Tu Club está saludable.</div>`;
      return;
    }
    list.innerHTML = `<div style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">${report.count} cliente(s) que no volvieron hace ${report.thresholdDays}+ días (${report.minVisits} ${report.minVisits === 1 ? 'visita' : 'visitas'} o más):</div>` +
      candidates.map((c) => `
        <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:8px; padding:10px 12px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; gap:8px;">
            <div style="flex:1;">
              <div style="font-size:12px; font-weight:700; color:#fff;">${escapeHtml(c.name || 'Cliente del Club')} <span style="color:var(--text-dim); font-weight:400;">(${escapeHtml(c.phoneMasked)})</span></div>
              <div style="font-size:10px; color:var(--text-dim); margin-top:2px;">
                ${c.daysSince} días sin venir · ${c.visits} visitas · ${c.points} pts
                ${c.consentBlocked ? ' · <span style="color:#F6AD55;">sin consentimiento de marketing</span>' : ''}
                ${c.hasEmail ? '' : ' · <span style="color:#F6AD55;">sin email en su tarjeta</span>'}
              </div>
            </div>
            ${c.hasEmail && !c.consentBlocked
              ? `<button type="button" class="btn-nav" data-js-click="sendReactivation|${escapeHtml(String(c.customerId))}" style="font-size:10px; padding:4px 8px; white-space:nowrap; align-self:flex-start;">✉️ Recuperar</button>`
              : ''}
          </div>
        </div>
      `).join('');
  } catch (e) {
    list.innerHTML = '<div style="font-size:11px; color:#F87171;">Error de conexión.</div>';
  }
}

export async function sendReactivation(customerId, escapeHtml, showConfirmDialog) {
  const id = String(customerId || '').trim();
  if (!id) return;
  const target = churnListCache.find(c => String(c.customerId) === id);
  const name = (target && target.name) || 'Cliente del Club';
  let confirmed = false;
  if (typeof showConfirmDialog === 'function') {
    try {
      confirmed = Boolean(await Promise.resolve(showConfirmDialog({
        icon: '✉️',
        title: 'Email de recupero',
        message: `Le decimos a ${name} que te extrañás, mostramos sus puntos y el link de tu carta.`,
        confirmText: 'Enviar email',
        confirmClass: 'btn-primary'
      })));
    } catch {
      confirmed = false;
    }
  }
  if (!confirmed) return;
  const list = document.getElementById('churnList');
  try {
    await apiFetch('/api/loyalty/reactivation', { method: 'POST', body: JSON.stringify({ customerId: id }) });
    loadChurnList(escapeHtml);
  } catch (e) {
    if (list) list.innerHTML = `<div style="font-size:11px; color:#F87171;">✕ ${escapeHtml(e.message || 'Error de conexión.')}</div>`;
  }
}

/** Crea un nodo con estilos inline y texto (SIEMPRE textContent: cero HTML inyectable). */
function winbackEl(tag, styleText, text) {
  const node = document.createElement(tag);
  if (styleText) node.style.cssText = styleText;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

/** Tarjeta de métrica del panel de recupero. */
function winbackMetric(label, value, color) {
  const card = winbackEl('div', 'background:var(--bg-base); border:1px solid var(--border); border-radius:6px; padding:8px; text-align:center;');
  card.appendChild(winbackEl('div', 'color:var(--text-dim);', label));
  card.appendChild(winbackEl('div', `font-weight:800; color:${color}; font-size:14px;`, value));
  return card;
}

function formatWinbackMoney(cents) {
  const amount = (Number(cents) || 0) / 100;
  return `$${amount.toLocaleString('es-UY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Pinta el reporte de la campaña (solo DOM API, cero HTML inyectable). */
function renderWinbackReport(container, data) {
  container.textContent = '';
  container.appendChild(winbackEl('div', 'color:#68D391; font-weight:700;', '✓ Campaña completada'));

  const stats = winbackEl('div', 'font-size:11px; color:var(--text-dim); margin-top:4px;');
  const parts = [
    ['📤 Enviados', data.sent || 0],
    ['📱 Push', data.pushed || 0],
    ['🚫 Sin consentimiento', data.blockedConsent || 0],
    ['📭 Sin email', data.blockedNoEmail || 0],
    ['📛 Opt-out', data.blockedOptOut || 0],
    ['👥 Candidatos', data.totalCandidates || 0]
  ];
  parts.forEach(([label, value], index) => {
    if (index > 0) stats.appendChild(document.createTextNode(' | '));
    stats.appendChild(document.createTextNode(`${label}: `));
    stats.appendChild(winbackEl('strong', '', value));
  });
  container.appendChild(stats);

  if (Array.isArray(data.errors) && data.errors.length) {
    container.appendChild(winbackEl(
      'div',
      'font-size:10px; color:#F87171; margin-top:4px;',
      `Errores: ${data.errors.map(e => `${e.customerId}:${e.reason}`).join(', ')}`
    ));
  }

  const recipients = Array.isArray(data.recipients) ? data.recipients : [];
  if (!recipients.length) return;
  container.appendChild(winbackEl('div', 'font-size:11px; color:var(--text-dim); margin-top:10px;', '💬 Reenviar por WhatsApp (opcional)'));
  const list = winbackEl('div', 'margin-top:4px; display:flex; flex-direction:column; gap:4px;');
  recipients.forEach((r) => {
    const row = winbackEl('div', 'display:flex; align-items:center; gap:8px; font-size:11px; flex-wrap:wrap;');
    row.appendChild(winbackEl('span', 'font-family:monospace; font-weight:700;', r.phoneMasked || '—'));
    row.appendChild(winbackEl('span', 'font-family:monospace; color:#60a5fa;', r.couponCode || ''));
    row.appendChild(winbackEl('span', 'color:var(--text-dim); font-size:10px;', `${r.couponLabel || ''}${r.channels && r.channels.email ? ' · ✉️' : ''}${r.channels && r.channels.push ? ' · 📱' : ''}`));
    if (r.waLink) {
      const link = winbackEl('a', 'color:#25D366; text-decoration:none; font-weight:700;', '💬 WhatsApp');
      link.href = r.waLink;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.appendChild(link);
    } else {
      row.appendChild(winbackEl('span', 'color:var(--text-dim); font-size:10px;', 'sin teléfono'));
    }
    list.appendChild(row);
  });
  container.appendChild(list);
}

/** Pinta la telemetría del circuito (métricas reales del ledger + pedidos). */
function renderWinbackTelemetry(container, telemetry) {
  container.textContent = '';
  const grid = winbackEl('div', 'display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-top:6px; font-size:10px;');
  const t = telemetry || {};
  grid.appendChild(winbackMetric(`Recuperados (${t.windowDays || 30}d)`, t.recoveredCount || 0, '#68D391'));
  grid.appendChild(winbackMetric('Cupones usados', t.couponsUsed || 0, '#60a5fa'));
  grid.appendChild(winbackMetric('Ingreso atribuido', formatWinbackMoney(t.attributedRevenueCents), '#fbbf24'));
  grid.appendChild(winbackMetric('Tasa de canje', `${Number(t.conversionRate) || 0}%`, '#f87171'));
  container.appendChild(grid);
  container.appendChild(winbackEl(
    'div',
    'font-size:10px; color:var(--text-dim); margin-top:6px;',
    `Emitidos ${t.couponsIssued || 0} · Vigentes ${t.couponsLive || 0} · Vencidos ${t.couponsExpired || 0}`
  ));
}

/**
 * F8 — Campaña Winback Zero-Touch
 * Lanza POST /api/loyalty/winback con la oferta elegida y muestra reporte
 * (con destinatarios y su link de WhatsApp) + telemetría real.
 */
export async function launchWinbackCampaign(escapeHtml, showConfirmDialog) {
  const resultEl = document.getElementById('winbackCampaignResult');
  const telemetryEl = document.getElementById('winbackTelemetry');
  const telemetryContent = document.getElementById('winbackTelemetryContent');
  const offerEl = document.getElementById('inputWinbackOffer');
  const daysEl = document.getElementById('inputWinbackDays');
  const minVisitsEl = document.getElementById('inputWinbackMinVisits');
  const messageEl = document.getElementById('inputWinbackMessage');
  if (!resultEl || !offerEl || !daysEl || !minVisitsEl) return;

  const offerType = offerEl.value;
  const daysSinceLastVisit = Number(daysEl.value) || 45;
  const minVisits = Number(minVisitsEl.value) || 2;
  const customMessage = messageEl?.value?.trim() || '';

  const offerLabels = {
    percent_10: '10% OFF',
    percent_15: '15% OFF',
    free_delivery: 'Envío Gratis'
  };
  const offerLabel = offerLabels[offerType] || offerType;

  let confirmed = false;
  if (typeof showConfirmDialog === 'function') {
    try {
      confirmed = Boolean(await Promise.resolve(showConfirmDialog({
        icon: '🚀',
        title: 'Lanzar campaña de recupero',
        message: `Se detectarán clientes en riesgo (ausencia ≥ ${daysSinceLastVisit} días, ≥ ${minVisits} visitas), se filtrará por consentimiento de marketing + email, se generarán cupones ${offerLabel} únicos (VOL-XXXXXXXX) atados a su teléfono y se enviarán los emails + push en lote. ¿Continuar?`,
        confirmText: 'Lanzar campaña',
        confirmClass: 'btn-primary'
      })));
    } catch {
      confirmed = false;
    }
  }
  if (!confirmed) return;

  resultEl.textContent = '';
  resultEl.appendChild(winbackEl('span', 'color:var(--text-dim);', '⏳ Lanzando campaña…'));
  try {
    const body = await apiFetch('/api/loyalty/winback', {
      method: 'POST',
      body: JSON.stringify({ offerType, daysSinceLastVisit, minVisits, customMessage })
    });
    const data = body.data || {};
    renderWinbackReport(resultEl, data);

    // Telemetría + panel de cupones (una sola pasada por el servidor).
    if (telemetryEl && telemetryContent) {
      telemetryEl.style.display = 'block';
      telemetryContent.textContent = '';
      telemetryContent.appendChild(winbackEl('span', 'color:var(--text-dim);', '⏳ Cargando telemetría…'));
      try {
        const telemetry = await apiFetch('/api/loyalty/winback/telemetry');
        renderWinbackTelemetry(telemetryContent, telemetry.data || {});
      } catch {
        telemetryContent.textContent = '';
        telemetryContent.appendChild(winbackEl('span', 'color:var(--text-dim);', 'Telemetría no disponible'));
      }
    }
    loadWinbackCoupons();
  } catch (e) {
    resultEl.textContent = '';
    resultEl.appendChild(winbackEl('div', 'color:#F87171;', `✕ ${e.message || 'Error de conexión.'}`));
  }
}

const WINBACK_STATUS_COPY = { live: 'Vigente', used: 'Usado', expired: 'Vencido' };
const WINBACK_STATUS_COLOR = { live: '#68D391', used: '#60a5fa', expired: '#F87171' };

/**
 * F8-v2 — Panel "Cupones de recupero": el dueño VE el circuito completo
 * (emitido → canjeado → ingreso atribuido) en vez de lanzar a ciegas.
 * GET /api/loyalty/winback/coupons (teléfono SIEMPRE enmascarado) + telemetría.
 */
export async function loadWinbackCoupons() {
  const panel = document.getElementById('winbackCouponsPanel');
  const summaryEl = document.getElementById('winbackCouponsSummary');
  if (!panel) return;
  panel.textContent = '';
  panel.appendChild(winbackEl('div', 'font-size:11px; color:var(--text-dim);', '⏳ Cargando cupones…'));
  if (summaryEl) summaryEl.textContent = '';

  try {
    const body = await apiFetch('/api/loyalty/winback/coupons');
    const data = body.data || {};
    const coupons = Array.isArray(data.coupons) ? data.coupons : [];
    const summary = data.summary || {};
    panel.textContent = '';

    if (summaryEl) {
      summaryEl.textContent = summary.total
        ? `${summary.liveCount || 0} vigentes · ${summary.usedCount || 0} usados · ${summary.expiredCount || 0} vencidos`
        : '';
    }
    if (!coupons.length) {
      panel.appendChild(winbackEl('div', 'font-size:11px; color:var(--text-dim);', 'Todavía no hay cupones. Lanzá una campaña para emitir los primeros.'));
      return;
    }

    const table = winbackEl('div', 'display:flex; flex-direction:column; gap:4px; margin-top:4px;');
    coupons.forEach((c) => {
      const row = winbackEl('div', 'display:flex; align-items:center; gap:8px; font-size:11px; flex-wrap:wrap; border-bottom:1px solid var(--border); padding-bottom:4px;');
      row.appendChild(winbackEl('span', 'font-family:monospace; font-weight:700; color:#60a5fa; min-width:104px;', c.code || '—'));
      row.appendChild(winbackEl('span', 'color:var(--text-dim); min-width:70px;', c.label || ''));
      const status = WINBACK_STATUS_COPY[c.status] || c.status || '—';
      row.appendChild(winbackEl('span', `font-weight:700; color:${WINBACK_STATUS_COLOR[c.status] || 'var(--text-dim)'}; min-width:56px;`, status));
      row.appendChild(winbackEl('span', 'font-family:monospace; color:var(--text-dim); min-width:84px;', c.phoneMasked || '—'));
      const date = c.status === 'used' && c.usedAt ? c.usedAt : c.expiresAt;
      const dateLabel = date ? new Date(date).toLocaleDateString('es-UY') : '';
      row.appendChild(winbackEl('span', 'color:var(--text-dim); font-size:10px;', c.status === 'used' ? `usado ${dateLabel}` : `vence ${dateLabel}`));
      if (c.status === 'used' && !c.usedOrderId) {
        row.appendChild(winbackEl('span', 'color:#fbbf24; font-size:10px;', 'sin pedido atribuido'));
      }
      table.appendChild(row);
    });
    panel.appendChild(table);
  } catch (e) {
    panel.textContent = '';
    panel.appendChild(winbackEl('div', 'color:#F87171; font-size:11px;', `✕ ${e.message || 'No se pudieron cargar los cupones.'}`));
  }
}
