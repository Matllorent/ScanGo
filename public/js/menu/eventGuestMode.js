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
  if (modal) modal.classList.add('active');
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
  if (submitBtn) {
    if (submitBtn.disabled || submitBtn.dataset.busy === 'true') return;
    submitBtn.disabled = true;
    submitBtn.dataset.busy = 'true';
    submitBtn.innerHTML = '<span>⏳ Conectando con WhatsApp...</span>';
  }

  const name = document.getElementById('resName')?.value.trim() || 'Comensal';
  const date = document.getElementById('resDate')?.value || '';
  const time = document.getElementById('resTime')?.value || '';
  const guests = document.getElementById('resGuests')?.value || '1';
  const notes = document.getElementById('resNotes')?.value.trim() || '';

  const msg = formatReservationWhatsAppMessage({
    restaurantName: restaurantData.name || 'Local',
    name,
    date,
    time,
    guests,
    notes
  });

  const rawPhone = (restaurantData.phone || '').replace(/[^0-9]/g, '');
  const waUrl = `https://wa.me/${rawPhone}?text=${encodeURIComponent(msg)}`;

  fetch('/api/analytics/event', {
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
