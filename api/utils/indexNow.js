'use strict';

/**
 * api/utils/indexNow.js
 * ─────────────────────
 * IndexNow (Bing, Yandex, Seznam, Naver): notifica a los buscadores que una URL
 * cambió para solicitar indexación casi inmediata. Ninguna pieza es crítica para
 * el negocio → TODO es best-effort: nunca bloquea al caller, nunca lanza. Módulo
 * puro (cero require de db/billing — guard de arquitectura B).
 *
 * Piezas:
 *   - isValidIndexNowKey / getIndexNowKey / isIndexNowEnabled  (config fail-closed)
 *   - buildIndexNowUrl({ key, url })     → URL de ping por GET (spec), o null
 *   - getMenuUrlsForPing(appUrl, restaurant) → canonical principal + cada ?branch=
 *   - dispatchIndexNowPing({ key, urls, fetchImpl }) → POST bulk {host,key,keyLocation,urlList}
 *
 * El key DEBE ser [0-9a-fA-F-]{8,64} (UUID o string hex con guiones): es el mismo
 * patrón de la ruta de vercel.json que desvía /{key}.txt al API, así el archivo
 * de verificación responde en producción. Cualquier otra forma desactiva el
 * feature (fail-closed) — ver .env.example y AGENTS.md.
 *
 * Sin mocks: el fetch es inyectable SOLO para los tests (patrón test-weather);
 * en runtime el default usa fetchWithTimeout (Brecha A) para que un endpoint
 * colgado de IndexNow no deje el proceso esperando.
 */

const { fetchWithTimeout } = require('./fetchWithTimeout');

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
const KEY_PATTERN = /^[0-9a-fA-F-]{8,64}$/;
const PING_TIMEOUT_MS = 8000;

function isValidIndexNowKey(key) {
  return typeof key === 'string' && KEY_PATTERN.test(key.trim());
}

function getIndexNowKey() {
  const key = String(process.env.INDEXNOW_KEY || '').trim();
  return isValidIndexNowKey(key) ? key : '';
}

// Fail-closed: sin key o con INDEXNOW_ENABLED explícitamente false/0/no/off el
// ping nunca se dispara (un operador que no configuró nada no genera tráfico).
function isIndexNowEnabled() {
  const flag = String(process.env.INDEXNOW_ENABLED || '').trim().toLowerCase();
  if (flag === 'false' || flag === '0' || flag === 'no' || flag === 'off') return false;
  return Boolean(getIndexNowKey());
}

// URL de ping por GET (una URL por request). Retorna null si la key o la URL no
// son válidas (jamás dispara contra javascript:/data:).
function buildIndexNowUrl({ key, url }) {
  if (!isValidIndexNowKey(key)) return null;
  let parsed;
  try {
    parsed = new URL(String(url));
  } catch (e) {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  const ping = new URL(INDEXNOW_ENDPOINT);
  ping.searchParams.set('url', parsed.href);
  ping.searchParams.set('key', key.trim());
  return ping.href;
}

// URLs canónicas a notificar tras un save: /m/<slug> + cada sucursal real.
// Sin appUrl o sin slug → [] (el dispatch lo reporta como no_valid_urls).
function getMenuUrlsForPing(appUrl, restaurant) {
  if (!appUrl || !restaurant || !restaurant.slug) return [];
  const base = String(appUrl).replace(/\/+$/, '');
  const slug = encodeURIComponent(restaurant.slug);
  const urls = [`${base}/m/${slug}`];
  if (Array.isArray(restaurant.branches)) {
    for (const branch of restaurant.branches) {
      const branchSlug = branch && (branch.slug || branch.id);
      if (branchSlug) urls.push(`${base}/m/${slug}?branch=${encodeURIComponent(branchSlug)}`);
    }
  }
  return urls;
}

// Disparo bulk best-effort (POST con urlList — el método que IndexNow recomienda
// para varias URLs). Devuelve un resumen ({skipped} | {submitted,status,ok,body} |
// {submitted,ok:false,error,body}); NUNCA lanza. `body` se devuelve para que los
// tests aseveren el payload exacto sin red.
async function dispatchIndexNowPing({ key, urls, fetchImpl }) {
  const normalizedKey = String(key || '').trim();
  if (!isValidIndexNowKey(normalizedKey)) return { skipped: 'invalid_key' };

  const candidates = (Array.isArray(urls) ? urls : [urls]).map(u => String(u || '').trim()).filter(Boolean);
  const urlList = [];
  let host = '';
  for (const candidate of candidates) {
    let parsed;
    try {
      parsed = new URL(candidate);
    } catch (e) {
      continue;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) continue;
    if (!host) host = parsed.host;
    // IndexNow exige un único host por lote; descartamos URLs de hosts ajenos.
    if (parsed.host === host) urlList.push(parsed.href);
  }
  if (!urlList.length || !host) return { skipped: 'no_valid_urls' };

  const body = {
    host,
    key: normalizedKey,
    keyLocation: `https://${host}/${encodeURIComponent(normalizedKey)}.txt`,
    urlList
  };
  const http = typeof fetchImpl === 'function' ? fetchImpl : (opts) => fetchWithTimeout(INDEXNOW_ENDPOINT, opts, PING_TIMEOUT_MS);
  try {
    const res = await http(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify(body)
    });
    return { submitted: urlList.length, status: res.status, ok: res.ok === true, body };
  } catch (err) {
    return { submitted: urlList.length, ok: false, error: String((err && err.message) || err), body };
  }
}

module.exports = {
  INDEXNOW_ENDPOINT,
  isValidIndexNowKey,
  getIndexNowKey,
  isIndexNowEnabled,
  buildIndexNowUrl,
  getMenuUrlsForPing,
  dispatchIndexNowPing
};