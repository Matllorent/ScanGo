/**
 * public/js/discover.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Página /descubrir (beta, en prueba): feed cruzado de platos con el
 * reproductor Stories (public/js/menu/storiesLayout.js). Sin carrito mixto:
 * cada historia enlaza al local (/m/:slug?dish=:id) donde el pedido usa
 * solo su carta (logística honesta).
 * Módulo ES sin imports fuera de public/js (CSP + arquitectura).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { enterDiscoverMode, isStoriesOverlayOpen, exitStoriesMode } from './menu/storiesLayout.js';

const FEED_LIMIT = 24;
const GEO_KEY = 'scango_geo';
let allItems = [];
let nextOffset = null;
let loading = false;
// Ubicación aproximada del comensal (solo si la comparte). Se redondea a
// 3 decimales (~100m) ANTES de enviarla: la exacta nunca sale del teléfono.
let geo = null;

// Textos de la página (beta standalone, sin el manager del menú).
const DZ_TEXT = {
  es: {
    title: 'Descubrir', beta: 'BETA · PRUEBA',
    sub: 'El formato tiktok de la zona, en prueba.',
    cityPh: 'Filtrar por ciudad (vacío = todas)', ver: 'Ver',
    loading: 'Cargando platos…', geoAsk: 'Pidiendo tu ubicación… (solo se usa para el radio)',
    geoOn: 'Radio activo: solo locales cerca de vos.', geoOff: 'Radio desactivado. Mostrando por ciudad/todo.',
    noGeo: 'Sin ubicación: usá el filtro por ciudad.', geoBtn: 'Solo locales cerca de mí',
    empty: 'Todavía no hay platos en esta zona.',
    emptyOwner: 'Si tenés un local, activalo desde Studio → Aparecer en Descubrir.',
    more: 'Ver más platos', fail: 'No se pudo cargar el feed. Reintentá en unos segundos.',
    failMore: 'No se pudo cargar más. Reintentá en unos segundos.',
    countSuffix: 'platos en prueba · el pedido se hace en cada local.',
    ownerLine: '¿Tenés un local? Aparecé acá desde Studio → Mi Local → Aparecer en Descubrir. Solo suscripciones válidas, sin teléfono ni dirección expuestos.',
    backHome: '← Volver al inicio'
  },
  en: {
    title: 'Discover', beta: 'BETA · TRIAL',
    sub: 'The trial zone format, in testing.',
    cityPh: 'Filter by city (empty = all)', ver: 'Go',
    loading: 'Loading dishes…', geoAsk: 'Requesting your location… (only used for radius)',
    geoOn: 'Radius on: only places near you.', geoOff: 'Radius off. Showing by city/all.',
    noGeo: 'No location: use the city filter.', geoBtn: 'Only places near me',
    empty: 'No dishes in this area yet.',
    emptyOwner: 'Own a place? List it from Studio → Appear in Discover.',
    more: 'Load more dishes', fail: 'Could not load the feed. Try again in a few seconds.',
    failMore: 'Could not load more. Try again in a few seconds.',
    countSuffix: 'trial dishes · each order goes to its place.',
    ownerLine: 'Own a place? List it here from Studio → My Place → Appear in Discover. Valid subscriptions only, no phone or address exposed.',
    backHome: '← Back to home'
  },
  pt: {
    title: 'Descobrir', beta: 'BETA · TESTE',
    sub: 'O formato da zona, em teste.',
    cityPh: 'Filtrar por cidade (vazio = todas)', ver: 'Ver',
    loading: 'Carregando pratos…', geoAsk: 'Pedindo sua localização… (só usada para o raio)',
    geoOn: 'Raio ativo: só locais perto de você.', geoOff: 'Raio desativado. Mostrando por cidade/tudo.',
    noGeo: 'Sem localização: use o filtro por cidade.', geoBtn: 'Só locais perto de mim',
    empty: 'Ainda não há pratos nesta região.',
    emptyOwner: 'Tem um local? Ative em Studio → Aparecer em Descobrir.',
    more: 'Ver mais pratos', fail: 'Não foi possível carregar. Tente em alguns segundos.',
    failMore: 'Não foi possível carregar mais. Tente em alguns segundos.',
    countSuffix: 'pratos em teste · cada pedido vai ao seu local.',
    ownerLine: 'Tem um local? Apareça aqui em Studio → Meu Local → Aparecer em Descobrir. Só assinaturas válidas, sem telefone ou endereço expostos.',
    backHome: '← Voltar ao início'
  }
};

function dzLang() {
  try {
    const q = new URLSearchParams(window.location.search).get('lang');
    if (q && DZ_TEXT[q]) return q;
    const nav = (navigator.language || 'es').slice(0, 2).toLowerCase();
    if (DZ_TEXT[nav]) return nav;
  } catch (e) {}
  return 'es';
}

function dzT(key) {
  const lang = dzLang();
  return (DZ_TEXT[lang] && DZ_TEXT[lang][key]) || DZ_TEXT.es[key] || key;
}

function loadSavedGeo() {
  try {
    const raw = window.localStorage.getItem(GEO_KEY);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && Number.isFinite(obj.lat) && Number.isFinite(obj.lng)) {
      geo = { lat: obj.lat, lng: obj.lng };
    }
  } catch (e) {}
}

function saveGeo(lat, lng) {
  geo = { lat, lng };
  try {
    window.localStorage.setItem(GEO_KEY, JSON.stringify(geo));
  } catch (e) {}
  paintGeo();
}

function clearGeo() {
  geo = null;
  try {
    window.localStorage.removeItem(GEO_KEY);
  } catch (e) {}
  paintGeo();
}

function paintGeo() {
  const btn = document.getElementById('dzGeo');
  if (btn) {
    btn.classList.toggle('on', Boolean(geo));
    btn.setAttribute('aria-pressed', geo ? 'true' : 'false');
  }
}

function status(msg) {
  const box = document.getElementById('dzStatus');
  if (box) box.textContent = msg;
}

function cityValue() {
  const input = document.getElementById('dzCity');
  return input ? input.value.trim().slice(0, 100) : '';
}

async function fetchFeed(offset) {
  const params = new URLSearchParams({ limit: String(FEED_LIMIT) });
  if (offset) params.set('offset', String(offset));
  const city = cityValue();
  // El radio manda sobre la ciudad (no se mezclan criterios).
  if (geo) {
    params.set('lat', String(geo.lat));
    params.set('lng', String(geo.lng));
  } else if (city) {
    params.set('city', city);
  }
  const res = await fetch(`/api/discover/feed?${params.toString()}`);
  if (!res.ok) throw new Error(`feed ${res.status}`);
  const payload = await res.json().catch(() => ({}));
  const data = payload && payload.data ? payload.data : {};
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total) || 0,
    nextOffset: data.nextOffset === null || data.nextOffset === undefined ? null : Number(data.nextOffset)
  };
}

async function openFeed(startIndex) {
  if (loading) return;
  loading = true;
  try {
    if (isStoriesOverlayOpen()) exitStoriesMode();
    const first = await fetchFeed(0);
    allItems = first.items;
    nextOffset = first.nextOffset;
    paintMore();
    if (!allItems.length) {
      status(dzT('empty') + ' ' + dzT('emptyOwner'));
      return;
    }
    status(`${first.total} ${dzT('countSuffix')}`);
    enterDiscoverMode(allItems, startIndex || 0);
  } catch (e) {
    status(dzT('fail'));
  } finally {
    loading = false;
  }
}

function paintMore() {
  const more = document.getElementById('dzMore');
  if (more) more.style.display = nextOffset === null || nextOffset === undefined ? 'none' : '';
}

async function loadMore() {
  if (loading || nextOffset === null || nextOffset === undefined) return;
  loading = true;
  try {
    const page = await fetchFeed(nextOffset);
    // Dedupe por slug:id (el feed puede rotar entre páginas).
    const seen = new Set(allItems.map((it) => `${it?.restaurant?.slug}:${it?.id}`));
    for (const it of page.items) {
      const key = `${it?.restaurant?.slug}:${it?.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        allItems.push(it);
      }
    }
    const resumeAt = allItems.length;
    nextOffset = page.nextOffset;
    paintMore();
    if (isStoriesOverlayOpen()) exitStoriesMode();
    status(`${allItems.length} ${dzT('countSuffix')}`);
    enterDiscoverMode(allItems, resumeAt);
  } catch (e) {
    status(dzT('failMore'));
  } finally {
    loading = false;
  }
}

function requestGeo() {
  if (geo) {
    clearGeo();
    status(dzT('geoOff'));
    openFeed(0);
    return;
  }
  if (!navigator.geolocation) {
    status(dzT('noGeo'));
    return;
  }
  status(dzT('geoAsk'));
  try {
    navigator.geolocation.getCurrentPosition((pos) => {
      const lat = Math.round(pos.coords.latitude * 1000) / 1000;
      const lng = Math.round(pos.coords.longitude * 1000) / 1000;
      saveGeo(lat, lng);
      status(dzT('geoOn'));
      openFeed(0);
    }, () => {
      status(dzT('noGeo'));
    }, { timeout: 8000, maximumAge: 600000 });
  } catch (e) {
    status(dzT('noGeo'));
  }
}

function paintTexts() {
  document.title = `${dzT('title')} (beta) — ScanGo`;
  try {
    document.documentElement.lang = dzLang();
  } catch (e) {}
  const heroTitle = document.getElementById('dzHeroTitle');
  if (heroTitle) {
    heroTitle.textContent = '';
    heroTitle.appendChild(document.createTextNode(dzT('title') + ' '));
    const beta = document.createElement('span');
    beta.className = 'dz-beta';
    beta.textContent = dzT('beta');
    heroTitle.appendChild(beta);
  }
  const heroSub = document.getElementById('dzHeroSub');
  if (heroSub) heroSub.textContent = dzT('sub');
  const city = document.getElementById('dzCity');
  if (city) {
    city.setAttribute('placeholder', dzT('cityPh'));
    city.setAttribute('aria-label', dzT('cityPh'));
  }
  const go = document.getElementById('dzGo');
  if (go) go.textContent = dzT('ver');
  const more = document.getElementById('dzMore');
  if (more) more.textContent = dzT('more');
  const geoBtn = document.getElementById('dzGeo');
  if (geoBtn) geoBtn.setAttribute('aria-label', dzT('geoBtn'));
  const owner = document.getElementById('dzOwnerLine');
  if (owner) owner.textContent = dzT('ownerLine');
  const back = document.getElementById('dzBackLink');
  if (back) back.textContent = dzT('backHome');
  status(dzT('loading'));
}

function wire() {
  const go = document.getElementById('dzGo');
  const city = document.getElementById('dzCity');
  const more = document.getElementById('dzMore');
  const geoBtn = document.getElementById('dzGeo');
  if (go) go.addEventListener('click', () => openFeed(0));
  if (more) more.addEventListener('click', loadMore);
  if (geoBtn) {
    geoBtn.setAttribute('aria-pressed', 'false');
    geoBtn.setAttribute('aria-label', 'Solo locales cerca de mí');
    geoBtn.addEventListener('click', requestGeo);
  }
  if (city) {
    city.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        openFeed(0);
      }
    });
  }
  const params = new URLSearchParams(window.location.search);
  const cityParam = params.get('city');
  if (cityParam && city) city.value = cityParam.slice(0, 100);
  loadSavedGeo();
  paintGeo();
  paintTexts();
  openFeed(0);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wire);
} else {
  wire();
}
