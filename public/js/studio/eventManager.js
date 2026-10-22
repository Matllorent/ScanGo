/**
 * public/js/studio/eventManager.js
 * ────────────────────────────────
 * Módulo ES para la gestión de Eventos y Bodas en ScanGo Studio.
 *
 * Funcionalidades:
 *  - Itinerario visual de boda/evento (momentos, horarios, iconos)
 *  - Lista de invitados y asignación de tokens QR personales
 *  - Generación de links y mensajes de invitación directa por WhatsApp
 */

import {
  normalizeGuestPhone as normalizeGuestPhoneMod,
  buildGuestInviteLink as buildGuestInviteLinkMod,
  buildGuestInviteMessage as buildGuestInviteMessageMod,
  buildGuestInviteUrl as buildGuestInviteUrlMod
} from '../menu/eventInvitations.js';

export const WEDDING_ITINERARY_ICONS = ['💒', '🤵', '👰', '💍', '🥂', '🍸', '🍽️', '🎂', '📸', '🎶', '💃', '🕺', '🌙', '✨', '🔔', '💐', '💛'];

export function getWeddingItineraryRef(restaurant) {
  if (!restaurant) return null;
  if (!restaurant.weddingItinerary || typeof restaurant.weddingItinerary !== 'object') {
    restaurant.weddingItinerary = { enabled: false, title: '', coupleNames: '', date: '', venue: '', items: [] };
  }
  if (!Array.isArray(restaurant.weddingItinerary.items)) restaurant.weddingItinerary.items = [];
  return restaurant.weddingItinerary;
}

export function renderWeddingItineraryRows(restaurant, escapeHtml) {
  const container = document.getElementById('weddingItineraryRows');
  if (!container) return;
  const it = getWeddingItineraryRef(restaurant);
  const items = it ? it.items : [];
  if (!items.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin momentos. Tocá "Agregar momento" para armar el programa (recepción, ceremonia, cena, fiesta…).</div>';
    return;
  }
  const iconOptions = (current) => WEDDING_ITINERARY_ICONS.map(ic =>
    `<option value="${ic}"${ic === current ? ' selected' : ''}>${ic}</option>`).join('');
  container.innerHTML = items.map((stop, i) => `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px;">
      <input type="text" class="form-input" value="${escapeHtml(String(stop.time || ''))}" maxlength="12" placeholder="18:00"
             data-js-input="updateWeddingItineraryField|${i}|time|this.value" style="width:76px; flex-shrink:0; font-size:11px; padding:6px 8px;" title="Hora del momento">
      <input type="text" class="form-input" value="${escapeHtml(String(stop.title || ''))}" maxlength="80" placeholder="Recepción de invitados"
             data-js-input="updateWeddingItineraryField|${i}|title|this.value" style="flex:1; font-size:11px; padding:6px 8px;" title="Momento">
      <select class="form-input" data-js-change="updateWeddingItineraryField|${i}|icon|this.value" style="width:64px; flex-shrink:0; font-size:14px; padding:6px 4px;" title="Icono">
        ${iconOptions(stop.icon || '💛')}
      </select>
      <button type="button" class="btn-nav" data-js-click="removeWeddingItineraryItem|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;">✕</button>
    </div>
  `).join('');
}

export function updateWeddingItineraryField(restaurant, index, field, value) {
  const it = getWeddingItineraryRef(restaurant);
  if (!it) return;
  const stop = it.items[index];
  if (!stop) return;
  if (field === 'time') stop.time = String(value || '').trim().slice(0, 12);
  else if (field === 'title') stop.title = String(value || '').trim().slice(0, 80);
  else if (field === 'icon') stop.icon = String(value || '💛').slice(0, 8);
}

export function addWeddingItineraryItem(restaurant, escapeHtml, triggerAutoSave) {
  const it = getWeddingItineraryRef(restaurant);
  if (!it) return;
  if (it.items.length >= 12) return;
  it.items.push({ time: '', title: '', icon: '💛' });
  renderWeddingItineraryRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function removeWeddingItineraryItem(restaurant, index, escapeHtml, triggerAutoSave) {
  const it = getWeddingItineraryRef(restaurant);
  if (!it) return;
  it.items.splice(index, 1);
  renderWeddingItineraryRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function getEventGuestsRef(restaurant) {
  if (!restaurant) return null;
  if (!restaurant.eventConfig || typeof restaurant.eventConfig !== 'object') {
    restaurant.eventConfig = {};
  }
  if (!Array.isArray(restaurant.eventConfig.guests)) restaurant.eventConfig.guests = [];
  return restaurant.eventConfig.guests;
}

export function mintGuestToken(prefix) {
  let rand = '';
  try {
    const bytes = new Uint8Array(6);
    crypto.getRandomValues(bytes);
    rand = Array.from(bytes, b => b.toString(36)).join('').slice(0, 8);
  } catch (e) {
    rand = Math.random().toString(36).slice(2, 10);
  }
  return `${prefix}_${Date.now().toString(36)}${rand}`;
}

export function getEventInviteContext(restaurant) {
  const it = (restaurant && restaurant.weddingItinerary) || {};
  return {
    coupleNames: it.coupleNames || (restaurant && (restaurant.name || restaurant.bizName)) || '',
    date: it.date || '',
    venue: it.venue || '',
    eventType:
      (restaurant && (restaurant.eventType || (restaurant.eventConfig && restaurant.eventConfig.eventType))) ||
      'wedding'
  };
}

export function buildGuestLink(restaurant, guest) {
  let origin = '';
  try {
    origin = window.location.origin;
  } catch (e) { /* sin window: link relativo imposible */ }
  return buildGuestInviteLinkMod(origin, restaurant && restaurant.slug, guest || {});
}

export function renderEventGuestRows(restaurant, escapeHtml) {
  const container = document.getElementById('eventGuestRows');
  if (!container || !restaurant) return;
  const guests = getEventGuestsRef(restaurant) || [];
  const count = document.getElementById('eventGuestCount');
  if (count) count.textContent = guests.length ? `${guests.length} invitado(s)` : '';
  if (!guests.length) {
    container.innerHTML = '<div style="font-size:11px; color:var(--text-dim); padding:6px 0;">Sin invitados. Tocá "Agregar invitado" para armar la lista (nombre + WhatsApp).</div>';
    return;
  }
  container.innerHTML = guests.map((g, i) => {
    const hasPhone = Boolean(normalizeGuestPhoneMod(g.phone || g.whatsapp));
    return `
    <div style="display:flex; gap:6px; align-items:center; margin-bottom:6px; flex-wrap:wrap;">
      <input type="text" class="form-input" value="${escapeHtml(String(g.name || ''))}" maxlength="80" placeholder="Nombre del invitado"
             data-js-input="updateEventGuestField|${i}|name|this.value" style="flex:2; min-width:120px; font-size:11px; padding:6px 8px;" title="Nombre">
      <input type="tel" class="form-input" value="${escapeHtml(String(g.phone || g.whatsapp || ''))}" maxlength="20" placeholder="WhatsApp (ej: 59899123456)"
             data-js-input="updateEventGuestField|${i}|phone|this.value" style="flex:1; min-width:110px; font-size:11px; padding:6px 8px;" title="WhatsApp">
      <button type="button" class="btn-nav" data-js-click="sendGuestInvite|${i}" style="padding:4px 8px; font-size:10px; ${hasPhone ? 'border-color:#25D366; color:#68D391;' : 'opacity:0.45;'}" title="${hasPhone ? 'Enviar invitación personal por WhatsApp' : 'Cargá un WhatsApp válido para invitar'}">💬 Invitar</button>
      <button type="button" class="btn-nav" data-js-click="copyGuestInviteLink|${i}" style="padding:4px 8px; font-size:10px;" title="Copiar link personal del invitado">🔗</button>
      <button type="button" class="btn-nav" data-js-click="removeEventGuest|${i}" style="padding:4px 8px; font-size:10px; border-color:#E53E3E; color:#F87171;" title="Quitar invitado">✕</button>
    </div>`;
  }).join('');
}

export function updateEventGuestField(restaurant, index, field, value, triggerAutoSave) {
  const guests = getEventGuestsRef(restaurant);
  if (!guests) return;
  const guest = guests[index];
  if (!guest) return;
  if (field === 'name') guest.name = String(value || '').trim().slice(0, 80);
  else if (field === 'phone') guest.phone = String(value || '').trim().slice(0, 20);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function addEventGuest(restaurant, escapeHtml, triggerAutoSave) {
  const guests = getEventGuestsRef(restaurant);
  if (!guests) return;
  if (guests.length >= 500) return;
  guests.push({
    id: mintGuestToken('gst'),
    name: '',
    phone: '',
    qrToken: mintGuestToken('qr')
  });
  renderEventGuestRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function removeEventGuest(restaurant, index, escapeHtml, triggerAutoSave) {
  const guests = getEventGuestsRef(restaurant);
  if (!guests || !guests[index]) return;
  guests.splice(index, 1);
  renderEventGuestRows(restaurant, escapeHtml);
  if (typeof triggerAutoSave === 'function') triggerAutoSave();
}

export function guestInviteMessage(restaurant, guest) {
  const ctx = getEventInviteContext(restaurant);
  return buildGuestInviteMessageMod({
    coupleNames: ctx.coupleNames,
    date: ctx.date,
    venue: ctx.venue,
    guestName: guest.name,
    link: buildGuestLink(restaurant, guest),
    eventType: ctx.eventType
  });
}

export function eventGuestStatus(text, isError) {
  const statusEl = document.getElementById('eventGuestMsg');
  if (!statusEl) return;
  statusEl.textContent = text || '';
  statusEl.style.color = isError ? '#F87171' : 'var(--text-dim)';
}

export function sendGuestInvite(restaurant, index, triggerAutoSave) {
  const guests = getEventGuestsRef(restaurant);
  const guest = guests && guests[index];
  if (!guest) return;
  if (!guest.qrToken) {
    guest.qrToken = mintGuestToken('qr');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
  const url = buildGuestInviteUrlMod(guest.whatsapp || guest.phone, guestInviteMessage(restaurant, guest));
  if (!url) {
    eventGuestStatus('Cargá un WhatsApp válido (con código de país) para invitar a este invitado.', true);
    return;
  }
  eventGuestStatus(`Invitación abierta para ${guest.name || 'el invitado'} en WhatsApp.`);
  window.open(url, '_blank');
}

export function copyGuestInviteLink(restaurant, index, triggerAutoSave) {
  const guests = getEventGuestsRef(restaurant);
  const guest = guests && guests[index];
  if (!guest) return;
  if (!guest.qrToken) {
    guest.qrToken = mintGuestToken('qr');
    if (typeof triggerAutoSave === 'function') triggerAutoSave();
  }
  const link = buildGuestLink(restaurant, guest);
  if (!link) {
    eventGuestStatus('No se pudo armar el link (falta el slug del evento).', true);
    return;
  }
  const done = () => eventGuestStatus('Link personal copiado al portapapeles.');
  const fail = () => eventGuestStatus('No se pudo copiar automáticamente: el link es ' + link, true);
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(link).then(done, fail);
    } else {
      const ta = document.createElement('textarea');
      ta.value = link;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      if (ok) done();
      else fail();
    }
  } catch (e) {
    fail();
  }
}
