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
  if (!list) return;
  const days = daysEl ? (Number(daysEl.value) || 45) : 45;
  list.innerHTML = '<div style="font-size:11px; color:var(--text-dim);">⏳ Analizando…</div>';
  try {
    const body = await apiFetch(`/api/loyalty/churn?days=${encodeURIComponent(days)}`);
    if (!body.data) {
      list.innerHTML = `<div style="font-size:11px; color:#F87171;">${escapeHtml(body.error || 'No se pudo calcular la lista.')}</div>`;
      return;
    }
    const report = body.data;
    const candidates = report.candidates || [];
    churnListCache = candidates;
    if (!candidates.length) {
      list.innerHTML = `<div style="font-size:11px; color:#68D391;">✓ Sin clientes en riesgo con ausencia de ${report.thresholdDays} días. Tu Club está saludable.</div>`;
      return;
    }
    list.innerHTML = `<div style="font-size:11px; color:var(--text-dim); margin-bottom:6px;">${report.count} cliente(s) recurrentes que no volvieron hace ${report.thresholdDays}+ días:</div>` +
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

/**
 * F8 — Campaña Winback Zero-Touch
 * Lanza POST /api/loyalty/winback con la oferta elegida y muestra reporte + telemetría.
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
        message: `Se detectarán clientes en riesgo (ausencia ≥ ${daysSinceLastVisit} días, ≥ ${minVisits} visitas), se filtrará por consentimiento de marketing + email, se generarán cupones ${offerLabel} únicos (VOL-XXXXXXXX) atados a su teléfono y se enviarán los emails en lote. ¿Continuar?`,
        confirmText: 'Lanzar campaña',
        confirmClass: 'btn-primary'
      })));
    } catch {
      confirmed = false;
    }
  }
  if (!confirmed) return;

  resultEl.innerHTML = '<span style="color:var(--text-dim);">⏳ Lanzando campaña…</span>';
  try {
    const body = await apiFetch('/api/loyalty/winback', {
      method: 'POST',
      body: JSON.stringify({ offerType, daysSinceLastVisit, minVisits, customMessage })
    });
    const data = body.data || {};
    const { sent, blockedConsent, blockedNoEmail, blockedOptOut, totalCandidates, errors } = data;
    resultEl.innerHTML = `
      <div style="color:#68D391; font-weight:700;">✓ Campaña completada</div>
      <div style="font-size:11px; color:var(--text-dim); margin-top:4px;">
        📤 Enviados: <strong>${sent}</strong> &nbsp;|&nbsp;
        🚫 Sin consentimiento: <strong>${blockedConsent}</strong> &nbsp;|&nbsp;
        📭 Sin email: <strong>${blockedNoEmail}</strong> &nbsp;|&nbsp;
        📛 Opt-out: <strong>${blockedOptOut}</strong> &nbsp;|&nbsp;
        👥 Candidatos totales: <strong>${totalCandidates}</strong>
      </div>
      ${errors && errors.length ? `<div style="font-size:10px; color:#F87171; margin-top:4px;">Errores: ${errors.map(e => `${e.customerId}:${e.reason}`).join(', ')}</div>` : ''}
    `;
    // Mostrar telemetría
    if (telemetryEl && telemetryContent) {
      telemetryEl.style.display = 'block';
      telemetryContent.innerHTML = '<span style="color:var(--text-dim);">⏳ Cargando telemetría…</span>';
      try {
        const telemetry = await apiFetch('/api/loyalty/winback/telemetry');
        const t = telemetry.data || {};
        telemetryContent.innerHTML = `
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-top:6px; font-size:10px;">
            <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:6px; padding:8px; text-align:center;">
              <div style="color:var(--text-dim);">Recuperados (30d)</div>
              <div style="font-weight:800; color:#68D391; font-size:14px;">${t.recoveredCount || 0}</div>
            </div>
            <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:6px; padding:8px; text-align:center;">
              <div style="color:var(--text-dim);">Cupones usados</div>
              <div style="font-weight:800; color:#60a5fa; font-size:14px;">${t.couponsUsed || 0}</div>
            </div>
            <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:6px; padding:8px; text-align:center;">
              <div style="color:var(--text-dim);">Ingreso atribuido</div>
              <div style="font-weight:800; color:#fbbf24; font-size:14px;">$${(t.attributedRevenueCents || 0) / 100}</div>
            </div>
            <div style="background:var(--bg-base); border:1px solid var(--border); border-radius:6px; padding:8px; text-align:center;">
              <div style="color:var(--text-dim);">Tasa conversión</div>
              <div style="font-weight:800; color:#f87171; font-size:14px;">${t.conversionRate ? (t.conversionRate * 100).toFixed(1) + '%' : '—'}</div>
            </div>
          </div>
        `;
      } catch {
        telemetryContent.innerHTML = '<span style="color:var(--text-dim);">Telemetría no disponible</span>';
      }
    }
  } catch (e) {
    resultEl.innerHTML = `<div style="color:#F87171;">✕ ${escapeHtml(e.message || 'Error de conexión.')}</div>`;
  }
}
