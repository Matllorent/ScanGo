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
