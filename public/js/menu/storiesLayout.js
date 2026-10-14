/**
 * public/js/menu/storiesLayout.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Layout Stories: la carta como historias full-screen (modo dual).
 * - En mesa: QR clásico → carta normal con anillos de destacados (📖).
 * - En casa: link con ?morph=stories (o default del dueño) → overlay directo.
 * Comportamiento de storie real: scroll-snap, segmentos clicables, avance
 * automático 6s (pausa al mantener + modales + pestaña oculta + reduced-motion),
 * tap izq/der, swipe-down para salir, reanuda donde quedaste (por local),
 * deep-link "Ver en carta" (sale + enfoca el plato con flash) y compartir.
 * El overlay se construye LEYENDO las .dish-card ya renderizadas: respeta
 * categorías, precios Happy Hour, agotados y horarios sin duplicar lógica.
 * Solo DOM API + textContent/setAttribute (cero innerHTML con data, CSP-safe).
 * Sin PII en storage: solo guarda el índice por slug de local.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { flashDishCard } from './orderTracking.js';

const STORY_MS = 6000;
const STORY_VIDEO_MAX_MS = 15000;
const TICK_MS = 100;
const SWIPE_EXIT_PX = 110;
let overlay = null;
let storyNodes = [];
let current = 0;
let elapsed = 0;
let timer = null;
let triggerEl = null;
let badgeObserver = null;
let dishesObserver = null;
let autoEntered = false;
let pausedHolds = 0;
let touchStartY = null;
let touchStartX = null;
let hintShown = false;
// root(section) → <video> de esa historia (solo si el plato tiene video válido).
const nodeVideo = new WeakMap();
// Datos crudos por overlay (para montar medios bajo demanda).
let storyData = [];
let storiesIO = null;

function onPointerUp() {
  pausedHolds = Math.max(0, pausedHolds - 1);
}

function prefersReducedMotion() {
  try {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) {
    return false;
  }
}

function menuSlug() {
  try {
    const m = window.location.pathname.match(/\/m\/([^\/?#]+)/);
    const raw = m ? m[1] : 'default';
    return String(raw).replace(/[^a-z0-9_-]/gi, '').slice(0, 60) || 'default';
  } catch (e) {
    return 'default';
  }
}

function storiesPosKey() {
  return 'scango_stories_pos_' + menuSlug();
}

function loadSavedPos(total) {
  try {
    const raw = window.localStorage.getItem(storiesPosKey());
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 0 && n < total) return n;
  } catch (e) {}
  return 0;
}

function savePos() {
  try {
    window.localStorage.setItem(storiesPosKey(), String(current));
  } catch (e) {}
}

function wantsVideo() {
  if (prefersReducedMotion()) return false;
  try {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn && conn.saveData) return false;
  } catch (e) {}
  return true;
}

function isValidVideoUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  const s = url.trim();
  if (!/^https:\/\//i.test(s)) return false;
  try {
    const path = new URL(s).pathname.toLowerCase();
    return path.endsWith('.mp4') || path.endsWith('.webm');
  } catch (e) {
    return false;
  }
}

// El video vive en window.restaurantData (puente vivo de menu.js): se busca
// por id y se revalida en cliente (el backend ya lo saneó al guardar).
function lookupDishVideo(id) {
  try {
    const data = window.restaurantData;
    const dishes = data && Array.isArray(data.dishes) ? data.dishes : [];
    for (const d of dishes) {
      if (d && String(d.id) === String(id) && isValidVideoUrl(d.videoUrl)) return d.videoUrl;
    }
  } catch (e) {}
  return '';
}

function readCartCount() {
  try {
    const badge = document.getElementById('cartCountBadge');
    if (!badge) return 0;
    const m = String(badge.textContent || '').match(/(\d+)/);
    return m ? parseInt(m[1], 10) : 0;
  } catch (e) {
    return 0;
  }
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

// i18n del overlay (manager del menú si existe; fallback español inline).
function stT(key, fallback) {
  try {
    const m = window.i18nManager;
    if (m && typeof m.t === 'function') {
      const v = m.t(key);
      if (v && v !== key) return v;
    }
  } catch (e) {}
  return fallback;
}

/**
 * Lee los platos del DOM ya renderizado (respeta filtros/horarios/precio).
 * @returns {Array<{id,name,desc,price,photo,soldout,cat}>}
 */
export function collectStories() {
  const cards = document.querySelectorAll('#dishesContainer .dish-card');
  const out = [];
  Array.prototype.forEach.call(cards, (card) => {
    if (!(card instanceof HTMLElement)) return;
    if (card.offsetParent === null) return; // ocultas por filtro/búsqueda
    let id = '';
    if (card.id && card.id.indexOf('dish_card_') === 0) {
      id = card.id.slice('dish_card_'.length);
    } else {
      const btn = card.querySelector('[data-dish-id]');
      if (btn) id = btn.getAttribute('data-dish-id') || '';
    }
    if (!id) return;
    const nameEl = card.querySelector('.dish-name');
    const descEl = card.querySelector('.dish-desc');
    const priceEl = card.querySelector('.dish-price');
    const img = card.querySelector('.dish-thumb');
    const section = card.closest ? card.closest('.category-section') : null;
    const catEl = section ? section.querySelector('.category-title span') : null;
    out.push({
      id,
      name: nameEl ? nameEl.textContent.trim() : 'Plato',
      desc: descEl ? descEl.textContent.trim() : '',
      price: priceEl ? priceEl.textContent.trim().replace(/\s+/g, ' ') : '',
      photo: img && img.getAttribute('src') ? img.getAttribute('src') : '',
      video: lookupDishVideo(id),
      soldout: card.classList.contains('dish-sold'),
      cat: catEl ? catEl.textContent.trim() : ''
    });
  });
  return out;
}

export function isStoriesOverlayOpen() {
  return Boolean(overlay && overlay.isConnected);
}

function currentLimit() {
  try {
    const node = storyNodes[current];
    const vid = node ? nodeVideo.get(node.root) : null;
    const dur = vid && Number.isFinite(vid._stDurMs) ? vid._stDurMs : 0;
    if (dur > 0 && dur <= STORY_VIDEO_MAX_MS) return dur;
  } catch (e) {}
  return STORY_MS;
}

function paintSegments() {
  const limit = currentLimit();
  storyNodes.forEach((node, idx) => {
    const bar = node.segFill;
    if (!bar) return;
    if (idx < current) bar.style.width = '100%';
    else if (idx > current) bar.style.width = '0%';
    else bar.style.width = Math.min(100, (elapsed / limit) * 100) + '%';
  });
}

function paintBadges() {
  if (!overlay) return;
  const n = readCartCount();
  const badges = overlay.querySelectorAll('[data-st-cart]');
  Array.prototype.forEach.call(badges, (b) => { b.textContent = String(n); });
}

function stopTimer() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

function modalsOpen() {
  const ids = ['dishNoteModal', 'cartModal'];
  return ids.some((id) => {
    const m = document.getElementById(id);
    return m && m.classList.contains('active');
  });
}

function pauseAllVideos() {
  storyNodes.forEach((node) => {
    try {
      const vid = nodeVideo.get(node.root);
      if (vid && typeof vid.pause === 'function') vid.pause();
    } catch (e) {}
  });
}

// Un solo video suena/reproduce a la vez: el de la historia activa, y solo
// si nada lo pausa (hold, modales, pestaña oculta). iOS en ahorro puede
// rechazar play(): se captura y queda el póster + timer (nunca rompe).
function reconcileVideos(shouldPlay) {
  storyNodes.forEach((node, idx) => {
    let vid = null;
    try {
      vid = nodeVideo.get(node.root);
      if (!vid || !vid.isConnected) return;
    } catch (e) {
      return;
    }
    if (idx === current && shouldPlay) {
      try {
        vid.preload = 'auto';
        const p = vid.play();
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    } else {
      try {
        vid.pause();
        if (idx !== current) vid.preload = 'none';
      } catch (e) {}
    }
  });
}

function startTimer() {
  stopTimer();
  if (prefersReducedMotion()) return; // solo avance manual
  timer = setInterval(() => {
    const blocked = document.hidden || modalsOpen() || pausedHolds > 0;
    reconcileVideos(!blocked && wantsVideo());
    if (blocked) return;
    const limit = currentLimit();
    elapsed += TICK_MS;
    if (elapsed >= limit) {
      goTo(current + 1);
      return;
    }
    paintSegments();
  }, TICK_MS);
}

// Rotación/resize con overlay abierto: re-ancla la historia actual (el snap
// solo se recalcula al soltar; sin esto se puede quedar a mitad de dos).
function onStoriesResize() {
  if (!isStoriesOverlayOpen()) return;
  scrollToCurrent('auto');
}

function scrollToCurrent(behavior) {
  const node = storyNodes[current];
  if (!node || !node.root || !overlay) return;
  // Saltos largos: instantáneos (evitan pelear con el snap a mitad de camino);
  // adyacentes: suaves (sensación de storie).
  let mode = behavior;
  if (!mode) {
    mode = 'smooth';
    try {
      const feed = overlay.querySelector('[data-st-feed]');
      const dist = feed ? Math.abs(node.root.offsetTop - feed.scrollTop) : 0;
      if (feed && dist > feed.clientHeight * 2.5) mode = 'auto';
    } catch (e) {}
  }
  try {
    const feed = overlay.querySelector('[data-st-feed]');
    if (feed && typeof feed.scrollTo === 'function') {
      feed.scrollTo({ top: node.root.offsetTop, behavior: mode });
      return;
    }
  } catch (e) {}
  try {
    node.root.scrollIntoView({ behavior: mode, block: 'start' });
  } catch (e2) {}
}

function goTo(i) {
  if (!storyNodes.length) return;
  current = ((i % storyNodes.length) + storyNodes.length) % storyNodes.length;
  elapsed = 0;
  savePos();
  pauseAllVideos();
  paintSegments();
  scrollToCurrent();
  startTimer();
}

function syncFromScroll() {
  if (!overlay) return;
  // Throttle por rAF: el handler corre por evento de scroll y cada pasada
  // mide N rects (400 historias = 400 lecturas). Sin esto, jank en gama baja.
  if (syncFromScroll._queued) return;
  syncFromScroll._queued = true;
  const run = () => {
    syncFromScroll._queued = false;
    if (!overlay) return;
    const feed = overlay.querySelector('[data-st-feed]');
    if (!feed) return;
    const feedTop = feed.getBoundingClientRect().top;
    let best = 0;
    let bestDist = Infinity;
    storyNodes.forEach((node, idx) => {
      const d = Math.abs(node.root.getBoundingClientRect().top - feedTop);
      if (d < bestDist) {
        bestDist = d;
        best = idx;
      }
    });
    if (best !== current) {
      current = best;
      elapsed = 0;
      savePos();
      paintSegments();
      startTimer();
    }
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else run();
}

function shareStory(st) {
  try {
    // En Descubrir se comparte el plato exacto (deep-link ?dish=); en la
    // carta normal, la URL del local (el comensal ya está ahí).
    if (st && st.slug) {
      const url = `${window.location.origin}/m/${st.slug}?dish=${encodeURIComponent(st.id)}`;
      if (navigator.share) {
        navigator.share({ title: st.name, url }).catch(() => {});
        return;
      }
      try {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
          navigator.clipboard.writeText(url).catch(() => {});
          return;
        }
      } catch (e) {}
      try {
        window.prompt('Copiá el link de este plato:', url);
      } catch (e2) {}
      return;
    }
    if (typeof window.shareRestaurantUrl === 'function') {
      window.shareRestaurantUrl();
      return;
    }
    if (navigator.share) {
      navigator.share({ title: st.name, url: window.location.href }).catch(() => {});
    }
  } catch (e) {}
}

function emptyPhoto() {
  const ph = el('div', 'st-bg st-bg-empty');
  const glyph = el('span', null, '🍽️');
  glyph.setAttribute('aria-hidden', 'true');
  ph.appendChild(glyph);
  return ph;
}

function buildStory(st, idx, total, brand) {
  const root = el('section', 'st-story');
  root.setAttribute('data-i', String(idx));
  root.setAttribute('aria-label', st.name + ' (' + (idx + 1) + ' de ' + total + ')');
  // Slot de medios: la concha es barata y de alto fijo (100dvh); la foto o el
  // video se montan solo cuando la historia entra en ventana (±2 pantallas).
  // Así una carta de 400 platos no crea 400 <img>/<video> de una.
  const slot = el('div', 'st-media');
  slot.setAttribute('aria-hidden', 'true');
  root.appendChild(slot);

  // Pista de gestos solo en la primera historia y solo una vez por carga.
  if (idx === 0 && !hintShown) {
    hintShown = true;
    const hint = el('div', 'st-hint', stT('storiesHint', '↓ Deslizá para salir · Mantené para pausar'));
    hint.setAttribute('aria-hidden', 'true');
    root.appendChild(hint);
  }

  // Segmentos clicables (salto directo como en stories reales).
  const segs = el('div', 'st-segs');
  segs.setAttribute('aria-hidden', 'true');
  let segFill = null;
  for (let k = 0; k < total; k++) {
    const s = el('button', 'st-seg');
    s.setAttribute('type', 'button');
    s.setAttribute('tabindex', '-1');
    s.setAttribute('aria-hidden', 'true');
    const f = el('i');
    s.appendChild(f);
    ((target) => {
      s.addEventListener('click', (ev) => {
        ev.stopPropagation();
        goTo(target);
      });
    })(k);
    segs.appendChild(s);
    if (k === idx) segFill = f;
  }
  root.appendChild(segs);

  const top = el('div', 'st-top');
  const logoSrc = st.brandLogo || brand.logo;
  if (logoSrc) {
    const logo = el('img', 'st-logo');
    logo.setAttribute('src', logoSrc);
    logo.setAttribute('alt', '');
    logo.setAttribute('aria-hidden', 'true');
    logo.setAttribute('referrerpolicy', 'no-referrer');
    logo.addEventListener('error', () => {
      try {
        if (logo.isConnected) logo.remove();
      } catch (e) {}
    });
    top.appendChild(logo);
  }
  const name = el('div', 'st-brand');
  // Modo Descubrir: cada historia trae su local (override por historia).
  name.appendChild(el('strong', null, st.brandTitle || brand.title));
  const brandSub = st.brandSub !== undefined ? st.brandSub : brand.sub;
  if (brandSub) name.appendChild(el('small', null, brandSub));
  top.appendChild(name);

  const shareBtn = el('button', 'st-share', '↗');
  shareBtn.setAttribute('type', 'button');
  shareBtn.setAttribute('aria-label', stT('storiesShareLocal', 'Compartir este local'));
  shareBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    shareStory(st);
  });
  top.appendChild(shareBtn);

  const cartBtn = el('button', 'st-cart', '🛒');
  cartBtn.setAttribute('type', 'button');
  cartBtn.setAttribute('aria-label', stT('storiesViewCart', 'Ver pedido'));
  const n = el('i', null, '0');
  n.setAttribute('data-st-cart', '1');
  cartBtn.appendChild(n);
  cartBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    if (typeof window.openCartModal === 'function') window.openCartModal();
  });
  // Vitrina: sin carrito (el dueño muestra la carta sin aceptar pedidos).
  // window.restaurantData es el puente vivo de menu.js.
  try {
    const restData = window.restaurantData;
    if (restData && restData.allowMenuOrders === false) cartBtn.style.display = 'none';
  } catch (e) {}
  top.appendChild(cartBtn);

  const exitBtn = el('button', 'st-exit', '✕');
  exitBtn.setAttribute('type', 'button');
  exitBtn.setAttribute('aria-label', stT('storiesClose', 'Cerrar historias y ver carta completa'));
  exitBtn.addEventListener('click', (ev) => {
    ev.stopPropagation();
    exitStoriesMode();
  });
  top.appendChild(exitBtn);
  root.appendChild(top);

  const prev = el('div', 'st-tap st-tap-prev');
  prev.setAttribute('aria-hidden', 'true');
  prev.addEventListener('click', (ev) => { ev.stopPropagation(); goTo(current - 1); });
  const next = el('div', 'st-tap st-tap-next');
  next.setAttribute('aria-hidden', 'true');
  next.addEventListener('click', (ev) => { ev.stopPropagation(); goTo(current + 1); });
  root.appendChild(prev);
  root.appendChild(next);

  const info = el('div', 'st-info');
  info.appendChild(el('div', 'st-cat', (st.cat ? st.cat + ' · ' : '') + (idx + 1) + '/' + total));
  info.appendChild(el('h2', 'st-name', st.name));
  if (st.desc) info.appendChild(el('p', 'st-desc', st.desc));
  if (st.soldout) info.appendChild(el('p', 'st-sold', stT('storiesSoldOut', 'Agotado por el momento')));
  const row = el('div', 'st-row');
  row.appendChild(el('div', 'st-price', st.price));
  if (st.slug) {
    // Modo Descubrir: sin carrito mixto (logística). Me gusta + deep-link
    // al local, donde el pedido se hace solo con su carta.
    const like = el('button', 'st-like', '❤');
    like.setAttribute('type', 'button');
    like.setAttribute('aria-label', 'Me gusta ' + st.name);
    like.setAttribute('aria-pressed', 'false');
    const likeKey = st.slug + ':' + st.id;
    const liked = isDishLiked(likeKey);
    like.classList.toggle('on', liked);
    if (liked) like.setAttribute('aria-pressed', 'true');
    const cnt = el('span', 'st-like-count', String((st.likeCount || 0) + (liked ? 1 : 0)));
    like.appendChild(cnt);
    like.addEventListener('click', (ev) => {
      ev.stopPropagation();
      toggleDishLike(likeKey, st, like);
    });
    row.appendChild(like);
    // Vitrina: el deep-link a la carta sigue valiendo, pero el botón dice
    // "Ver carta" en vez de "Pedir" (en ese local no hay nada que pedir).
    const canOrder = st.ordersEnabled !== false;
    const orderLabel = canOrder ? stT('storiesOrder', 'Pedir →') : stT('storiesSeeInMenu', '📍 Ver en carta');
    const order = el('a', 'st-order', orderLabel);
    order.setAttribute('href', '/m/' + st.slug + '?dish=' + encodeURIComponent(st.id));
    order.setAttribute('aria-label', orderLabel + ' ' + st.name);
    row.appendChild(order);
  } else {
    // Vitrina: la historia muestra sin "+ Agregar" (window.addToCart además
    // lo ignora; el server responde 403 a cualquier pedido).
    let ordersOn = true;
    try {
      const restData = window.restaurantData;
      if (restData && restData.allowMenuOrders === false) ordersOn = false;
    } catch (e) {}
    if (!ordersOn) {
      const badge = el('p', 'st-sold', stT('storiesShowcase', 'Solo carta · sin pedidos'));
      info.appendChild(el('div', 'st-row')).appendChild(badge);
    } else {
      const add = el('button', 'st-add', st.soldout ? stT('storiesSoldOut', 'Agotado') : stT('storiesAdd', '+ Agregar'));
      add.setAttribute('type', 'button');
      if (st.soldout) {
        add.setAttribute('disabled', 'true');
        add.setAttribute('aria-disabled', 'true');
      } else {
        add.setAttribute('aria-label', stT('storiesAdd', '+ Agregar') + ' ' + st.name);
        add.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (typeof window.addToCart === 'function') window.addToCart(st.id);
        });
      }
      row.appendChild(add);
    }
  }
  info.appendChild(row);

  // Deep-link: salir y enfocar el plato en la carta normal (solo modo carta;
  // en Descubrir el botón Pedir ya lleva al local).
  if (!st.slug) {
    const links = el('div', 'st-links');
    const gotoDish = el('button', 'st-goto', stT('storiesSeeInMenu', '📍 Ver en carta'));
    gotoDish.setAttribute('type', 'button');
    gotoDish.setAttribute('aria-label', stT('storiesSeeInMenu', '📍 Ver en carta') + ': ' + st.name);
    gotoDish.addEventListener('click', (ev) => {
      ev.stopPropagation();
      exitStoriesMode({ focusDishId: st.id });
    });
    links.appendChild(gotoDish);
    info.appendChild(links);
  }
  root.appendChild(info);

  return { root, segFill, idx, mediaMounted: false };
}

/**
 * Monta el medio (foto/video) de una historia. Idempotente.
 */
function mountMedia(node) {
  if (!node || node.mediaMounted || !node.root.isConnected) return;
  const st = storyData[node.idx];
  if (!st) return;
  const slot = node.root.querySelector('.st-media');
  if (!slot) return;
  if (st.video && wantsVideo()) {
    const vid = el('video', 'st-bg st-video');
    vid.muted = true;
    vid.loop = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    vid.setAttribute('muted', '');
    vid.setAttribute('loop', '');
    vid.setAttribute('preload', 'metadata');
    vid.setAttribute('disablepictureinpicture', '');
    vid.setAttribute('aria-hidden', 'true');
    vid.setAttribute('tabindex', '-1');
    try {
      vid.src = st.video;
      if (st.photo) vid.setAttribute('poster', st.photo);
    } catch (e) {}
    // Video que no carga (host caído, link muerto) → placeholder, nunca negro.
    vid.addEventListener('error', () => {
      try {
        if (vid.isConnected) vid.replaceWith(emptyPhoto());
      } catch (e) {}
    });
    // Duración real → el avance se ata al video (tope 15s, fallback 6s).
    vid.addEventListener('loadedmetadata', () => {
      try {
        if (Number.isFinite(vid.duration) && vid.duration > 0) {
          vid._stDurMs = Math.min(vid.duration * 1000, STORY_VIDEO_MAX_MS);
        }
      } catch (e) {}
    });
    slot.appendChild(vid);
    nodeVideo.set(node.root, vid);
  } else if (st.photo) {
    const img = el('img', 'st-bg');
    img.setAttribute('src', st.photo);
    img.setAttribute('alt', '');
    img.setAttribute('aria-hidden', 'true');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('decoding', 'async');
    img.setAttribute('referrerpolicy', 'no-referrer');
    // Foto rota (URL muerta del dueño) → placeholder, nunca ícono roto.
    img.addEventListener('error', () => {
      try {
        if (img.isConnected) img.replaceWith(emptyPhoto());
      } catch (e) {}
    });
    slot.appendChild(img);
  } else {
    slot.appendChild(emptyPhoto());
  }
  node.mediaMounted = true;
}

/**
 * Desmonta el medio al salir de ventana: pausa el video (corta la
 * descarga) y libera el nodo. El re-montaje recarga desde caché HTTP.
 */
function unmountMedia(node) {
  if (!node || !node.mediaMounted) return;
  try {
    const vid = nodeVideo.get(node.root);
    if (vid && typeof vid.pause === 'function') {
      try { vid.pause(); } catch (e) {}
      try { vid.removeAttribute('src'); } catch (e2) {}
    }
    nodeVideo.delete(node.root);
    const slot = node.root.querySelector('.st-media');
    if (slot) {
      while (slot.firstChild) slot.removeChild(slot.firstChild);
    }
  } catch (e) {}
  node.mediaMounted = false;
}

const STORY_LIKES_KEY = 'scango_likes';
const STORY_LIKES_MAX = 200;

function readLikedSet() {
  try {
    const raw = window.localStorage.getItem(STORY_LIKES_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    return obj && typeof obj === 'object' ? obj : {};
  } catch (e) {
    return {};
  }
}

function isDishLiked(key) {
  try {
    return Boolean(readLikedSet()[key]);
  } catch (e) {
    return false;
  }
}

// Me gusta honesto de beta: un like por navegador (localStorage) + contador
// del servidor. Sin identidad no hay anti-fraude fuerte: el rate-limit por
// slug del canal público frena el spam masivo. Documentado, no vendido.
function toggleDishLike(key, st, likeBtn) {
  if (isDishLiked(key)) return;
  try {
    const set = readLikedSet();
    set[key] = 1;
    const keys = Object.keys(set);
    while (keys.length > STORY_LIKES_MAX) delete set[keys.shift()];
    window.localStorage.setItem(STORY_LIKES_KEY, JSON.stringify(set));
  } catch (e) {}
  likeBtn.classList.add('on');
  likeBtn.setAttribute('aria-pressed', 'true');
  const cnt = likeBtn.querySelector('.st-like-count');
  if (cnt) {
    const n = parseInt(cnt.textContent, 10);
    cnt.textContent = String((Number.isFinite(n) ? n : 0) + 1);
  }
  try {
    fetch('/api/public/analytics/event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: st.slug, event: 'dish_like', dishId: st.id })
    }).catch(() => {});
  } catch (e) {}
}

export function enterStoriesMode(startIndex, customStories, customBrand) {
  if (isStoriesOverlayOpen()) return true;
  const stories = Array.isArray(customStories) ? customStories : collectStories();
  if (!stories.length) return false;

  triggerEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const titleEl = document.getElementById('restaurantName');
  const statusEl = document.getElementById('statusOpenClosedBadge');
  const logoImg = document.querySelector('#restaurantLogoContainer img');
  const brand = customBrand || {
    title: titleEl ? titleEl.textContent.trim() : 'Menú',
    sub: statusEl ? statusEl.textContent.trim().replace(/\s+/g, ' ') : '',
    logo: logoImg && logoImg.getAttribute('src') ? logoImg.getAttribute('src') : ''
  };

  overlay = el('div');
  overlay.id = 'storiesOverlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Carta en historias');

  const feed = el('div', 'st-feed');
  feed.setAttribute('data-st-feed', '1');
  storyData = stories;
  storyNodes = stories.map((st, idx) => buildStory(st, idx, stories.length, brand));
  storyNodes.forEach((node) => feed.appendChild(node.root));
  overlay.appendChild(feed);

  // Virtualización: el medio se monta al entrar en ventana (±2 pantallas)
  // y se desmonta al salir (corta la descarga). Sin IO (navegador viejo):
  // se monta todo como antes (correcto > óptimo).
  if (typeof IntersectionObserver !== 'undefined') {
    try {
      storiesIO = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const idx = parseInt(entry.target.getAttribute('data-i'), 10);
          const node = storyNodes[idx];
          if (!node) return;
          if (entry.isIntersecting) mountMedia(node);
          else unmountMedia(node);
        });
      }, { root: feed, rootMargin: '200% 0px', threshold: 0 });
      storyNodes.forEach((node) => storiesIO.observe(node.root));
    } catch (e) {
      storiesIO = null;
    }
  }
  if (!storiesIO) storyNodes.forEach(mountMedia);

  document.body.appendChild(overlay);
  document.body.classList.add('stories-open');
  try {
    document.body.style.overflow = 'hidden';
  } catch (e) {}

  const initial = Number.isFinite(startIndex) ? startIndex : loadSavedPos(stories.length);
  current = Math.max(0, Math.min(stories.length - 1, initial));
  elapsed = 0;
  mountMedia(storyNodes[current]);
  paintSegments();
  paintBadges();
  scrollToCurrent('auto');

  feed.addEventListener('scroll', syncFromScroll, { passive: true });
  feed.addEventListener('pointerdown', () => { pausedHolds++; });
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('resize', onStoriesResize);

  // Swipe-down para salir (gesto de storie real). Solo en la primera
  // historia y con arrastre mayormente vertical: no pelea con el snap.
  feed.addEventListener('touchstart', (ev) => {
    try {
      const t = ev.touches[0];
      touchStartY = t.clientY;
      touchStartX = t.clientX;
    } catch (e) {
      touchStartY = null;
      touchStartX = null;
    }
  }, { passive: true });
  feed.addEventListener('touchend', (ev) => {
    try {
      if (touchStartY === null) return;
      const t = ev.changedTouches[0];
      const dy = t.clientY - touchStartY;
      const dx = Math.abs(t.clientX - touchStartX);
      if (current === 0 && dy > SWIPE_EXIT_PX && dx < 60) exitStoriesMode();
    } catch (e) {}
    touchStartY = null;
    touchStartX = null;
  }, { passive: true });

  const badgeTarget = document.getElementById('cartCountBadge');
  if (badgeTarget && typeof MutationObserver !== 'undefined') {
    badgeObserver = new MutationObserver(paintBadges);
    badgeObserver.observe(badgeTarget, { childList: true, characterData: true, subtree: true });
  }

  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      exitStoriesMode();
      return;
    }
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowRight') {
      goTo(current + 1);
      return;
    }
    if (ev.key === 'ArrowUp' || ev.key === 'ArrowLeft') {
      goTo(current - 1);
      return;
    }
    // Trampa de Tab dentro del overlay (diálogo inmersivo).
    if (ev.key === 'Tab' && overlay) {
      const items = overlay.querySelectorAll('button:not([disabled])');
      const focusables = Array.prototype.filter.call(items, (b) => b.offsetParent !== null);
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }
  };
  overlay._stKeyHandler = onKey;
  window.addEventListener('keydown', onKey);

  startTimer();
  try {
    const firstExit = overlay.querySelector('.st-exit');
    if (firstExit) firstExit.focus({ preventScroll: true });
  } catch (e) {
    try {
      const firstExit = overlay.querySelector('.st-exit');
      if (firstExit) firstExit.focus();
    } catch (e2) {}
  }
  return true;
}

export function exitStoriesMode(opts) {
  if (!isStoriesOverlayOpen()) {
    if (opts && opts.focusDishId) flashDishCard(opts.focusDishId);
    return;
  }
  stopTimer();
  pauseAllVideos();
  if (badgeObserver) {
    try { badgeObserver.disconnect(); } catch (e) {}
    badgeObserver = null;
  }
  if (storiesIO) {
    try { storiesIO.disconnect(); } catch (e) {}
    storiesIO = null;
  }
  window.removeEventListener('resize', onStoriesResize);
  if (overlay._stKeyHandler) {
    window.removeEventListener('keydown', overlay._stKeyHandler);
  }
  window.removeEventListener('pointerup', onPointerUp);
  try {
    overlay.remove();
  } catch (e) {
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }
  overlay = null;
  storyNodes = [];
  storyData = [];
  pausedHolds = 0;
  touchStartY = null;
  touchStartX = null;
  document.body.classList.remove('stories-open');
  try {
    document.body.style.overflow = '';
  } catch (e) {}
  if (opts && opts.focusDishId) {
    flashDishCard(opts.focusDishId);
    triggerEl = null;
    return;
  }
  if (triggerEl && document.contains(triggerEl)) {
    try { triggerEl.focus({ preventScroll: true }); } catch (e) {}
  }
  triggerEl = null;
}

export function toggleStoriesMode() {
  if (isStoriesOverlayOpen()) exitStoriesMode();
  else enterStoriesMode();
}

/**
 * Modo Descubrir beta: feed cruzado de platos (formato tiktok de la zona).
 * Cada historia pertenece a UN local; el pedido se hace solo en su carta
 * (deep-link /m/:slug?dish=:id). Sin carrito mixto por logística.
 * @param {Array} items items del feed (/api/discover/feed)
 * @param {number} startIndex índice inicial
 */
export function enterDiscoverMode(items, startIndex) {
  if (isStoriesOverlayOpen()) return true;
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return false;
  const stories = list.map((it) => {
    const rest = (it && it.restaurant) || {};
    const currency = String(rest.currency || '$');
    const dist = Number(rest.distanceKm);
    const where = [String(rest.city || ''), Number.isFinite(dist) ? `a ${dist} km` : ''].filter(Boolean).join(' · ');
    return {
      id: String(it.id || ''),
      name: String(it.name || 'Plato'),
      desc: String(it.description || ''),
      price: `${currency} ${Number(it.price) || 0}`,
      photo: typeof it.photoUrl === 'string' ? it.photoUrl : '',
      video: typeof it.videoUrl === 'string' ? it.videoUrl : '',
      cat: String(rest.city || ''),
      slug: String(rest.slug || ''),
      likeCount: Number(it.likeCount) || 0,
      brandTitle: String(rest.name || 'Local'),
      brandSub: where,
      brandLogo: typeof rest.logoUrl === 'string' ? rest.logoUrl : '',
      ordersEnabled: rest.ordersEnabled !== false
    };
  }).filter((st) => st.id && st.slug);
  if (!stories.length) return false;
  return enterStoriesMode(Number.isFinite(startIndex) ? startIndex : 0, stories, {
    title: 'Descubrir',
    sub: 'beta · la zona',
    logo: ''
  });
}

/**
 * Anillos de destacados (estilo IG) sobre la carta normal: cada categoría
 * con platos abre las historias justo en su primer plato.
 */
export function renderStoriesTray() {
  try {
    const tray = document.getElementById('storiesTray');
    const rings = document.getElementById('storiesTrayRings');
    if (!tray || !rings) return;
    if (isStoriesOverlayOpen()) {
      tray.style.display = 'none';
      return;
    }
    const trayTitle = tray.querySelector('.stories-tray-title');
    if (trayTitle) trayTitle.textContent = stT('storiesTrayTitle', '📖 Historias');
    const stories = collectStories();
    // Limpia anillos previos (re-render por filtros/búsqueda).
    while (rings.firstChild) rings.removeChild(rings.firstChild);
    if (stories.length < 2) {
      tray.style.display = 'none';
      return;
    }
    const seen = {};
    stories.forEach((st, idx) => {
      const key = st.cat || 'Carta';
      if (seen[key] !== undefined) return;
      seen[key] = idx;
      const btn = el('button', 'st-ring');
      btn.setAttribute('type', 'button');
      btn.setAttribute('aria-label', key + ' ' + stT('storiesViewMenu', 'Ver como historias').toLowerCase());
      const face = el('span', 'st-ring-face');
      if (st.photo) {
        const img = el('img');
        img.setAttribute('src', st.photo);
        img.setAttribute('alt', '');
        img.setAttribute('aria-hidden', 'true');
        img.setAttribute('loading', 'lazy');
        img.setAttribute('referrerpolicy', 'no-referrer');
        face.appendChild(img);
      } else {
        face.appendChild(el('span', null, '🍽️'));
      }
      btn.appendChild(face);
      btn.appendChild(el('span', 'st-ring-label', key.length > 12 ? key.slice(0, 11) + '…' : key));
      ((target) => {
        btn.addEventListener('click', () => enterStoriesMode(target));
      })(idx);
      rings.appendChild(btn);
    });
    tray.style.display = '';
  } catch (e) {}
}

function observeDishes() {
  try {
    const container = document.getElementById('dishesContainer');
    if (!container || typeof MutationObserver === 'undefined' || dishesObserver) return;
    dishesObserver = new MutationObserver(() => renderStoriesTray());
    dishesObserver.observe(container, { childList: true, subtree: false });
  } catch (e) {}
}

// La bandeja vive y muere con la carta: se renderiza con cada menú listo
// y se refresca ante re-renders (filtros/búsqueda), sin tocar menu.js.
try {
  window.addEventListener('scango:menu-ready', () => {
    observeDishes();
    renderStoriesTray();
  });
} catch (e) {}

/**
 * Entrada automática (una vez por carga): layout del dueño = stories
 * o preview ?morph=stories → overlay directo (link "para casa").
 */
export function maybeAutoEnterStories() {
  if (isStoriesOverlayOpen()) return;
  let layout = '';
  try {
    const m = document.body.className.match(/layout-(\S+)/);
    layout = m ? m[1] : '';
  } catch (e) {}
  // Si el layout dejó de ser stories (preview del Studio), se habilita
  // re-entrar cuando vuelva: el flag es por sesión de layout, no de carga.
  if (layout !== 'stories') {
    autoEntered = false;
    return;
  }
  if (autoEntered) return;
  autoEntered = true;
  if (!enterStoriesMode()) autoEntered = false;
}
