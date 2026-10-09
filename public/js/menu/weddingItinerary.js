/**
 * public/js/menu/weddingItinerary.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Itinerario visual de bodas/eventos: cronograma elegante data-driven.
 * Módulo puro (sin DOM en import): se puede testear en Node con `import()`.
 *
 * Modelo (restaurant.weddingItinerary):
 * {
 *   enabled: true,
 *   title: 'Programa de Boda',       // título de la sección
 *   coupleNames: 'Mora & Alex',       // pareja / anfitriones
 *   date: '5 de Junio de 2029',       // fecha en texto libre
 *   venue: 'Salón Ensigna…',          // lugar en texto libre
 *   items: [{ time: '18:00', title: 'Recepción', icon: '🥂' }]
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const WEDDING_ITINERARY_DEFAULTS = {
  title: 'Programa de Boda',
  maxItems: 12,
  fallbackIcon: '💛',
  /** Minutos antes del primer momento en que ya se muestra "en vivo". */
  liveLeadMinutes: 120,
  /** Minutos después del último momento antes de darlo por finalizado. */
  liveGraceMinutes: 60,
  /** Cada cuánto se re-renderiza el timeline en vivo (ms). */
  liveRefreshMs: 30000
};

/** Iconos sugeridos para momentos típicos (el dueño puede usar cualquier emoji). */
export const WEDDING_MOMENT_ICONS = [
  '💒', '🤵', '👰', '💍', '🥂', '🍸', '🍽️', '🎂',
  '📸', '🎶', '💃', '🕺', '🌙', '✨', '🔔', '💐'
];

function cleanText(value, maxLen) {
  return String(value ?? '').trim().slice(0, maxLen);
}

/**
 * Normaliza el itinerario crudo del restaurante a un shape seguro.
 * Nunca lanza: ante basura devuelve `{ enabled:false, ..., items:[] }`.
 */
export function sanitizeWeddingItinerary(raw) {
  const empty = {
    enabled: false,
    title: WEDDING_ITINERARY_DEFAULTS.title,
    coupleNames: '',
    date: '',
    eventDay: '',
    venue: '',
    items: []
  };
  if (!raw || typeof raw !== 'object') return empty;
  const items = Array.isArray(raw.items) ? raw.items : [];
  const rawDay = typeof raw.eventDay === 'string' ? raw.eventDay.trim() : '';
  return {
    enabled: raw.enabled === true,
    title: cleanText(raw.title, 60) || WEDDING_ITINERARY_DEFAULTS.title,
    coupleNames: cleanText(raw.coupleNames || raw.couple || '', 80),
    date: cleanText(raw.date, 60),
    eventDay: /^\d{4}-\d{2}-\d{2}$/.test(rawDay) ? rawDay : '',
    venue: cleanText(raw.venue, 120),
    items: items
      .slice(0, WEDDING_ITINERARY_DEFAULTS.maxItems)
      .map((it) => ({
        time: cleanText(it && it.time, 12),
        title: cleanText(it && it.title, 80),
        icon: cleanText(it && it.icon, 8) || WEDDING_ITINERARY_DEFAULTS.fallbackIcon
      }))
      .filter((it) => it.time || it.title)
  };
}

function defaultEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parsea una hora de momento a minutos del día. Acepta "18:00", "18.00",
 * "18h00", "9:05". Devuelve null si no es una hora válida.
 */
export function parseItineraryTime(value) {
  const m = String(value ?? '').trim().match(/^(\d{1,2})\s*[:.h]\s*(\d{2})/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

function toISODate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

/**
 * Resuelve el estado en vivo del itinerario respecto a `now`.
 * Tiempos absolutos con acarreo nocturno: si un momento es menor que el
 * anterior (pasa la medianoche, ej. 00:15), suma +24h. Así el orden del dueño
 * manda y la fiesta puede cruzar la medianoche.
 *
 * @param {Array} items Ítems ya sanitizados [{time,title,icon}]
 * @param {Date|string|number} now Referencia temporal (default: ahora)
 * @param {string} eventDay 'YYYY-MM-DD' del evento ('' = se asume hoy)
 * @returns {object} { mode, currentIndex, nextIndex, daysLeft, progressPct,
 *   timedCount, firstTime, lastTime }
 *   mode: 'countdown' (faltan días) | 'upcoming' (hoy, falta para empezar) |
 *         'live' (en curso) | 'finished' (terminó) | 'static' (sin horas válidas)
 */
export function resolveItineraryProgress(items, now = new Date(), eventDay = '') {
  const list = Array.isArray(items) ? items : [];
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowValid = !Number.isNaN(nowDate.getTime());
  const at = nowValid ? nowDate : new Date();

  // Minutos absolutos con acarreo nocturno según el orden del dueño.
  const abs = [];
  let carry = 0;
  let prev = -1;
  list.forEach((stop) => {
    const t = parseItineraryTime(stop && stop.time);
    if (t === null) {
      abs.push(null);
      return;
    }
    if (prev >= 0 && t < prev) carry += 1440;
    prev = t;
    abs.push(t + carry);
  });
  const timedIdx = abs.map((v, i) => (v === null ? -1 : i)).filter((i) => i >= 0);
  if (!timedIdx.length) {
    return { mode: 'static', currentIndex: -1, nextIndex: -1, daysLeft: 0, progressPct: 0, timedCount: 0, firstTime: '', lastTime: '' };
  }

  const todayISO = toISODate(at);
  const dayISO = /^\d{4}-\d{2}-\d{2}$/.test(eventDay || '') ? eventDay : todayISO;
  // Días calendario restantes (solo cuando hay fecha configurada).
  let daysLeft = 0;
  if (dayISO !== todayISO) {
    const ms = new Date(`${dayISO}T00:00:00`) - new Date(`${todayISO}T00:00:00`);
    daysLeft = Math.round(ms / 86400000);
  }
  if (daysLeft > 0) {
    return { mode: 'countdown', currentIndex: -1, nextIndex: timedIdx[0], daysLeft, progressPct: 0, timedCount: timedIdx.length, firstTime: list[timedIdx[0]].time, lastTime: list[timedIdx[timedIdx.length - 1]].time };
  }

  // Misma escala para hoy, la madrugada siguiente (acarreo) o días después:
  // minutos absolutos desde la medianoche del DÍA DEL EVENTO. Así 00:30 del
  // día siguiente vale 1470 y sigue en vivo si la fiesta cruzó la medianoche.
  const baseMidnight = new Date(`${dayISO}T00:00:00`).getTime();
  const nowAbs = Math.floor((at.getTime() - baseMidnight) / 60000);
  const first = abs[timedIdx[0]];
  const last = abs[timedIdx[timedIdx.length - 1]];
  const lead = WEDDING_ITINERARY_DEFAULTS.liveLeadMinutes;
  const grace = WEDDING_ITINERARY_DEFAULTS.liveGraceMinutes;

  if (nowAbs < first - lead) {
    return { mode: 'upcoming', currentIndex: -1, nextIndex: timedIdx[0], daysLeft: 0, progressPct: 0, timedCount: timedIdx.length, firstTime: list[timedIdx[0]].time, lastTime: list[timedIdx[timedIdx.length - 1]].time };
  }
  if (nowAbs > last + grace) {
    return { mode: 'finished', currentIndex: timedIdx[timedIdx.length - 1], nextIndex: -1, daysLeft: 0, progressPct: 100, timedCount: timedIdx.length, firstTime: list[timedIdx[0]].time, lastTime: list[timedIdx[timedIdx.length - 1]].time };
  }
  let current = -1;
  for (const i of timedIdx) {
    if (abs[i] <= nowAbs) current = i;
    else break;
  }
  const next = timedIdx.find((i) => abs[i] > nowAbs) ?? -1;
  const span = Math.max(1, last - first);
  const progressPct = Math.max(0, Math.min(100, Math.round(((nowAbs - first) / span) * 100)));
  return { mode: 'live', currentIndex: current, nextIndex: next, daysLeft: 0, progressPct, timedCount: timedIdx.length, firstTime: list[timedIdx[0]].time, lastTime: list[timedIdx[timedIdx.length - 1]].time };
}

/**
 * Renderiza el timeline como HTML. Devuelve '' si está apagado o sin momentos
 * (el llamador oculta la sección en ese caso).
 * @param {object} itinerary Ya sanitizado (o crudo: se sanitiza adentro)
 * @param {function} escapeFn Escapador HTML (en el menú se pasa escapeHtml)
 * @param {Date|string|number} now Referencia para el estado en vivo (default: ahora)
 */
export function renderWeddingItineraryHTML(itinerary, escapeFn = defaultEscape, now = new Date()) {
  const it = sanitizeWeddingItinerary(itinerary);
  if (!it.enabled || it.items.length === 0) return '';
  const esc = typeof escapeFn === 'function' ? escapeFn : defaultEscape;
  const state = resolveItineraryProgress(it.items, now, it.eventDay);

  let statusHtml = '';
  if (state.mode === 'countdown') {
    const label = state.daysLeft === 1 ? 'Falta 1 día' : `Faltan ${state.daysLeft} días`;
    statusHtml = `<div class="wed-it-status" role="status">⏳ ${esc(label)} para la fiesta</div>`;
  } else if (state.mode === 'upcoming') {
    statusHtml = `<div class="wed-it-status" role="status">🕒 Comenzamos a las ${esc(state.firstTime)}</div>`;
  } else if (state.mode === 'live') {
    const currentTitle = state.currentIndex >= 0 ? it.items[state.currentIndex].title : '';
    statusHtml = `<div class="wed-it-status is-live" role="status"><span class="wed-it-live-dot" aria-hidden="true"></span> En vivo${currentTitle ? ` · ${esc(currentTitle)}` : ''}</div>`;
    statusHtml += `<div class="wed-it-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.progressPct}" aria-label="Avance del evento"><span style="width:${state.progressPct}%"></span></div>`;
  } else if (state.mode === 'finished') {
    statusHtml = `<div class="wed-it-status" role="status">✅ ¡Gracias por acompañarnos!</div>`;
  }

  const header = `
    <div class="wed-it-head">
      ${it.date ? `<div class="wed-it-date">${esc(it.date)}</div>` : ''}
      ${it.coupleNames ? `<div class="wed-it-couple">${esc(it.coupleNames)}</div>` : ''}
      <h2 class="wed-it-title">${esc(it.title)}</h2>
      ${statusHtml}
    </div>`;

  const stops = it.items.map((stop, idx) => {
    const isNow = idx === state.currentIndex && state.mode === 'live';
    const isPast = state.mode === 'finished'
      || (state.mode === 'live' && state.currentIndex >= 0 && idx < state.currentIndex)
      || (state.mode === 'live' && state.currentIndex === -1 && state.nextIndex >= 0 && idx < state.nextIndex);
    const isNext = idx === state.nextIndex && (state.mode === 'live' || state.mode === 'upcoming');
    const cls = [
      'wed-it-stop',
      idx % 2 === 1 ? 'is-right' : 'is-left',
      isNow ? 'is-now' : '',
      isPast ? 'is-past' : '',
      isNext ? 'is-next' : ''
    ].filter(Boolean).join(' ');
    return `
    <li class="${cls}"${isNow ? ' aria-current="true"' : ''}>
      <div class="wed-it-card">
        <span class="wed-it-icon" aria-hidden="true">${esc(stop.icon)}</span>
        <div class="wed-it-text">
          ${stop.time ? `<div class="wed-it-time">${esc(stop.time)}</div>` : ''}
          ${stop.title ? `<div class="wed-it-moment">${isPast && !isNow ? '✓ ' : ''}${esc(stop.title)}</div>` : ''}
          ${isNow ? '<div class="wed-it-now-badge">AHORA</div>' : ''}
          ${isNext && !isNow ? '<div class="wed-it-next-tag">Siguiente</div>' : ''}
        </div>
      </div>
      <span class="wed-it-node" aria-hidden="true">${isNow ? '🔴' : '💛'}</span>
    </li>`;
  }).join('');

  const footer = it.venue
    ? `<div class="wed-it-venue">${esc(it.venue)}</div>`
    : '';

  const corners = `
    <span class="wed-it-corner is-tl" aria-hidden="true"></span>
    <span class="wed-it-corner is-tr" aria-hidden="true"></span>
    <span class="wed-it-corner is-bl" aria-hidden="true"></span>
    <span class="wed-it-corner is-br" aria-hidden="true"></span>`;
  const divider = '<div class="wed-it-divider" aria-hidden="true"></div>';

  return `${corners}${header}${divider}<ol class="wed-it-timeline">${stops}</ol>${footer}`;
}
