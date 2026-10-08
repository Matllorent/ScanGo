/**
 * public/js/menu/eventGuestMode.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Event Visual Themes, Guest Token Resolution & Table Reservations Handler
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Resolves the visual event theme CSS class based on restaurant businessType and URL query.
 * @param {object} restaurantData Restaurant metadata
 * @param {string|URLSearchParams} search Query string or URLSearchParams
 * @returns {string|null} CSS class name (e.g. 'theme-wedding', 'theme-cumple15') or null
 */
export function resolveEventTheme(restaurantData = {}, search = window.location.search) {
  const urlParams = typeof search === 'string' ? new URLSearchParams(search) : search;
  const eventParam = urlParams.get('event');

  const isEvent = restaurantData.businessType === 'events' ||
    eventParam === 'true' ||
    eventParam === 'wedding' ||
    eventParam === 'cumple_15' ||
    eventParam === 'birthday' ||
    eventParam === 'catering';

  if (!isEvent) return null;

  let resolved = eventParam;
  if (!resolved && restaurantData.businessType === 'events') {
    resolved = 'wedding';
  }

  if (resolved === 'cumple_15') return 'theme-cumple15';
  if (resolved === 'birthday') return 'theme-birthday';
  if (resolved === 'catering') return 'theme-catering';
  return 'theme-wedding';
}

/**
 * Extracts guest and seating parameters from URL.
 * @param {string|URLSearchParams} search Query string or URLSearchParams
 * @returns {object} { guestName, tableNumber, guestToken }
 */
export function parseGuestContext(search = window.location.search) {
  const params = typeof search === 'string' ? new URLSearchParams(search) : search;
  const guestName = params.get('invitado') || params.get('guest') || '';
  const tableNumber = params.get('mesa') || params.get('table') || '';
  const guestToken = params.get('token') || params.get('qr') || '';
  return { guestName, tableNumber, guestToken };
}

/**
 * Formats structured WhatsApp reservation message.
 */
export function formatReservationWhatsAppMessage(params = {}) {
  const {
    restaurantName = 'RESTAURANTE',
    name = '',
    date = '',
    time = '',
    guests = 1,
    notes = ''
  } = params;

  let msg = `📅 *SOLICITUD DE RESERVA - ${restaurantName.toUpperCase()}*\n\n`;
  msg += `👤 *Titular:* ${name}\n`;
  msg += `📆 *Fecha:* ${date}\n`;
  msg += `⏰ *Hora:* ${time} hs\n`;
  msg += `👥 *Comensales:* ${guests}\n`;
  if (notes) {
    msg += `📝 *Observaciones:* ${notes}\n`;
  }
  msg += `\n_¿Tienen disponibilidad para confirmar la reserva?_\n`;
  msg += `_Enviado desde ScanGo_`;
  return msg;
}

/**
 * Opens reservation modal
 */
export function openReservationModal() {
  const modal = document.getElementById('reservationModal');
  if (!modal) return;
  modal.classList.add('active');

  // No permitir fechas pasadas en el selector de fecha
  const dateInput = document.getElementById('resDate');
  if (dateInput && !dateInput.getAttribute('min')) {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    dateInput.setAttribute('min', today.toISOString().slice(0, 10));
  }

  // Limpiar error previo al reabrir
  const msgEl = document.getElementById('resFormMsg');
  if (msgEl) {
    msgEl.style.display = 'none';
    msgEl.textContent = '';
  }
}

/**
 * Closes reservation modal
 */
export function closeReservationModal() {
  const modal = document.getElementById('reservationModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Submits reservation form and redirects to WhatsApp.
 */
export function submitReservation(e, restaurantData = {}, getSlugFn = () => '') {
  if (e && e.preventDefault) e.preventDefault();

  const submitBtn = e?.target ? e.target.querySelector('button[type="submit"]') : null;
  const originalText = submitBtn ? submitBtn.innerHTML : '';
  const msgEl = document.getElementById('resFormMsg');

  // ── Validación previa (evita wa.me rotos y reservas inválidas) ──────────
  const name = document.getElementById('resName')?.value.trim() || '';
  const date = document.getElementById('resDate')?.value || '';
  const time = document.getElementById('resTime')?.value || '';
  const guestsRaw = document.getElementById('resGuests')?.value || '';
  const notes = document.getElementById('resNotes')?.value.trim() || '';
  const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');

  const errors = [];

  if (!name) errors.push('Ingresá tu nombre.');
  if (!rawPhone) errors.push('El local no tiene un WhatsApp configurado para reservas.');

  if (!date) {
    errors.push('Elegí una fecha.');
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(`${date}T00:00:00`);
    if (Number.isNaN(selected.getTime()) || selected.getTime() < today.getTime()) {
      errors.push('La fecha no puede ser anterior a hoy.');
    }
  }

  if (!time) errors.push('Elegí un horario.');

  // El select usa '8+' como valor para "8 o más (mesa larga)"
  const guestsNum = guestsRaw === '8+' ? 8 : parseInt(guestsRaw, 10);
  if (!Number.isFinite(guestsNum) || guestsNum < 1) {
    errors.push('Elegí la cantidad de comensales.');
  }

  if (errors.length) {
    if (msgEl) {
      msgEl.textContent = '⚠️ ' + errors.join(' ');
      msgEl.style.display = 'block';
    }
    return;
  }

  // Validación superada: limpiar cualquier error previo del intento anterior
  // (evita mensajes fantasma al reintentar con datos correctos).
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.display = 'none';
  }

  if (submitBtn) {
    if (submitBtn.disabled || submitBtn.dataset.busy === 'true') return;
    submitBtn.disabled = true;
    submitBtn.dataset.busy = 'true';
    submitBtn.innerHTML = '<span>⏳ Conectando con WhatsApp...</span>';
  }

  const msg = formatReservationWhatsAppMessage({
    restaurantName: restaurantData.name || 'Local',
    name,
    date,
    time,
    guests: guestsNum === 8 ? '8 o más' : String(guestsNum),
    notes
  });

  const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;

  fetch('/api/public/analytics/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug: getSlugFn(), event: 'reservation' })
  }).catch(() => {});

  window.open(waUrl, '_blank');

  setTimeout(() => {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.dataset.busy = 'false';
      submitBtn.innerHTML = originalText;
    }
    closeReservationModal();
  }, 1500);
}
