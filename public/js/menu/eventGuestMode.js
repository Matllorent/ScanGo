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
    notes = '',
    phone = ''
  } = params;

  let msg = `📅 *SOLICITUD DE RESERVA - ${restaurantName.toUpperCase()}*\n\n`;
  msg += `👤 *Titular:* ${name}\n`;
  if (phone) {
    msg += `📱 *Teléfono:* ${phone}\n`;
  }
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
  resetReservationForm();

  // No permitir fechas pasadas en el selector de fecha
  const dateInput = document.getElementById('resDate');
  if (dateInput && !dateInput.getAttribute('min')) {
    const today = new Date();
    today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
    dateInput.setAttribute('min', today.toISOString().slice(0, 10));
  }
}

/**
 * Reservas de verdad (backlog #2): el modal vuelve a su estado FORMULARIO
 * (tras un éxito previo quedó el panel de éxito). Limpio error y éxito.
 */
export function resetReservationForm() {
  const form = document.getElementById('reservationForm');
  const intro = document.getElementById('resModalIntro');
  const successBox = document.getElementById('resSuccessBox');
  const msgEl = document.getElementById('resFormMsg');
  if (form) form.style.display = '';
  if (intro) intro.style.display = '';
  if (successBox) successBox.style.display = 'none';
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.display = 'none';
  }
}

/**
 * Muestra un error de forma honesta (del server o de la validación client).
 */
function showReservationError(message) {
  const msgEl = document.getElementById('resFormMsg');
  if (msgEl) {
    msgEl.textContent = `⚠️ ${message}`;
    msgEl.style.display = 'block';
  }
}

/**
 * Arma el link wa.me del panel de éxito con el MISMO formatter de siempre
 * (cero copia de copy). El click es el gesto del usuario → el navegador
 * permite window.open (antes el flujo moría si el popup blocker cortaba la
 * apertura automática post-fetch).
 */
function buildReservationWaUrl(restaurantData, fields) {
  const ownerPhone = String(restaurantData?.phone || '').replace(/[^0-9]/g, '');
  if (!ownerPhone) return '';
  const msg = formatReservationWhatsAppMessage({
    restaurantName: restaurantData.name || 'Local',
    name: fields.name,
    date: fields.date,
    time: fields.time,
    guests: fields.paxLabel ? `${fields.paxLabel}` : String(fields.pax),
    notes: fields.notes,
    phone: fields.phone
  });
  return `https://wa.me/${ownerPhone}?text=${encodeURIComponent(msg)}`;
}

/** Cablea los botones del panel de éxito (addEventListener, cero on*=). */
function wireReservationSuccessActions(restaurantData, fields) {
  const waBtn = document.getElementById('resSuccessWaBtn');
  const doneBtn = document.getElementById('resSuccessDoneBtn');
  const waUrl = buildReservationWaUrl(restaurantData, fields);
  if (waBtn) {
    if (waUrl) {
      waBtn.hidden = false;
      if (!waBtn.dataset.waBound) {
        waBtn.dataset.waBound = 'true';
        waBtn.addEventListener('click', () => window.open(waUrl, '_blank'));
      }
    } else {
      // Sin WhatsApp del local el botón no existe: la reserva ya está
      // registrada — nunca muestro un botón muerto.
      waBtn.hidden = true;
    }
  }
  if (doneBtn && !doneBtn.dataset.doneBound) {
    doneBtn.dataset.doneBound = 'true';
    doneBtn.addEventListener('click', () => {
      resetReservationForm();
      closeReservationModal();
    });
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
 * Submits the reservation form (Reservas de verdad, backlog #2).
 *
 * Flujo REAL: POST /api/reservations (alta + capacidad + captcha server-side)
 * → panel de éxito honesto con "📲 Avisar también por WhatsApp" como paso
 * OPCIONAL (el comensal decide; el window.open de ese botón es su propio
 * gesto — la carrera con el popup blocker ya no existe). La reserva queda
 * `requested` en el sistema y el dueño la confirma desde el Studio.
 *
 * DEMOS: sin alta server-side (la demo nunca registra datos reales) → flujo
 * WhatsApp puro de siempre. El server además devuelve 200 {demo:true} como
 * respaldo si algún día un demo llega a POST.
 *
 * @param {Event} e
 * @param {object} restaurantData - doc público del local
 * @param {() => string} getSlugFn
 * @param {{getCaptchaToken?: () => Promise<string>, showToast?: (m: string) => void}} ctx
 */
export async function submitReservation(e, restaurantData = {}, getSlugFn = () => '', ctx = {}) {
  if (e && e.preventDefault) e.preventDefault();
  const { getCaptchaToken = null, showToast = null } = ctx || {};

  const submitBtn = document.getElementById('resSubmitBtn');
  const submitLabel = document.getElementById('resSubmitLabel');
  const fields = {
    name: document.getElementById('resName')?.value.trim() || '',
    phone: document.getElementById('resPhone')?.value.trim() || '',
    email: document.getElementById('resEmail')?.value.trim() || '',
    date: document.getElementById('resDate')?.value || '',
    time: document.getElementById('resTime')?.value || '',
    guestsRaw: document.getElementById('resGuests')?.value || '',
    notes: document.getElementById('resNotes')?.value.trim() || ''
  };

  // ── Validación previa (la definitiva es el server; acá evito viajes al vacío)
  const errors = [];
  if (!fields.name) errors.push('Ingresá tu nombre.');

  const comensalPhone = fields.phone.replace(/[^0-9]/g, '');
  if (comensalPhone.length < 8) errors.push('Ingresá tu teléfono (lo usa el local para confirmarte).');

  if (!fields.date) {
    errors.push('Elegí una fecha.');
  } else {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const selected = new Date(`${fields.date}T00:00:00`);
    if (Number.isNaN(selected.getTime()) || selected.getTime() < today.getTime()) {
      errors.push('La fecha no puede ser anterior a hoy.');
    }
  }

  if (!fields.time) errors.push('Elegí un horario.');

  // El select usa '8+' como valor para "8 o más (mesa larga)"
  const guestsNum = fields.guestsRaw === '8+' ? 8 : parseInt(fields.guestsRaw, 10);
  if (!Number.isFinite(guestsNum) || guestsNum < 1) {
    errors.push('Elegí la cantidad de comensales.');
  }

  if (errors.length) {
    showReservationError(errors.join(' '));
    return;
  }
  fields.phone = comensalPhone;
  fields.pax = guestsNum;
  fields.paxLabel = fields.guestsRaw === '8+' ? '8+' : '';

  const msgEl = document.getElementById('resFormMsg');
  if (msgEl) {
    msgEl.textContent = '';
    msgEl.style.display = 'none';
  }

  const busy = submitBtn && (submitBtn.disabled || submitBtn.dataset.busy === 'true');
  if (busy) return;
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.dataset.busy = 'true';
  }
  if (submitLabel) submitLabel.textContent = '⏳ Enviando solicitud…';

  // ── DEMO: la demo nunca registra datos → WhatsApp puro (comportamiento viejo)
  if (restaurantData.isDemo === true) {
    fetch('/api/public/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: getSlugFn(), event: 'reservation' })
    }).catch(() => {});
    const waUrl = buildReservationWaUrl(restaurantData, fields);
    if (waUrl) window.open(waUrl, '_blank');
    else if (showToast) showToast('La demo no tiene WhatsApp configurado.');
    setTimeout(() => {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.dataset.busy = 'false';
      }
      if (submitLabel) submitLabel.textContent = '📅 Enviar Solicitud de Reserva';
      closeReservationModal();
    }, 1200);
    return;
  }

  // ── REAL: alta server-side
  let captchaToken = '';
  if (typeof getCaptchaToken === 'function') {
    try {
      captchaToken = (await getCaptchaToken()) || '';
    } catch (e2) {
      captchaToken = ''; // fail-open client: el server decide si lo exige
    }
  }

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: getSlugFn(),
        name: fields.name,
        phone: fields.phone,
        email: fields.email || undefined,
        date: fields.date,
        time: fields.time,
        pax: fields.guestsRaw,
        notes: fields.notes || undefined,
        captchaToken: captchaToken || undefined
      })
    });

    let body = null;
    try { body = await res.json(); } catch (e2) { body = null; }

    if (res.status === 201 && body && body.success) {
      // Panel de éxito honesto: la reserva EXISTE; el WhatsApp es complemento.
      const form = document.getElementById('reservationForm');
      const intro = document.getElementById('resModalIntro');
      const successBox = document.getElementById('resSuccessBox');
      const detail = document.getElementById('resSuccessDetail');
      if (form) form.style.display = 'none';
      if (intro) intro.style.display = 'none';
      if (detail) {
        const when = `📅 ${fields.date} · ⏰ ${fields.time} · 👥 ${fields.paxLabel || fields.pax} persona${(fields.paxLabel || fields.pax) === 1 ? '' : 's'}`;
        detail.textContent = `${when}. Te confirmamos por WhatsApp o teléfono — y te avisamos 24 h antes si nos dejaste tu email.`;
      }
      if (successBox) successBox.style.display = 'block';
      wireReservationSuccessActions(restaurantData, fields);

      // Telemetría del comensal (igual que el flujo viejo, consent server-side)
      fetch('/api/public/analytics/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slug: getSlugFn(), event: 'reservation' })
      }).catch(() => {});

      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.dataset.busy = 'false';
      }
      if (submitLabel) submitLabel.textContent = '📅 Enviar Solicitud de Reserva';
      return;
    }

    // Errores honestos por código (nunca "aplicado" cuando el server dijo no).
    let msg = (body && body.error) || 'No se pudo registrar la reserva. Probá de nuevo.';
    if (res.status === 429) msg = 'Demasiadas solicitudes seguidas. Esperá unos minutos.';
    else if ((body && body.code) === 'RESERVATIONS_DISABLED') msg = 'Este local no está aceptando reservas en línea.';
    else if ((body && body.code) === 'SLOT_UNAVAILABLE') msg = 'Esa franja ya no tiene lugar disponible. Probá otro horario.';
    else if ((body && body.code) === 'RESTAURANT_NOT_FOUND') msg = 'El local no está disponible en este momento.';
    else if ((body && body.code) === 'CAPTCHA_REQUIRED' || (body && body.code) === 'CAPTCHA_INVALID') msg = 'La verificación anti-robots falló. Probá de nuevo.';
    showReservationError(msg);
  } catch (e3) {
    showReservationError('No se pudo conectar con el local. Probá de nuevo en un momento.');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.dataset.busy = 'false';
    }
    if (submitLabel) submitLabel.textContent = '📅 Enviar Solicitud de Reserva';
  }
}
