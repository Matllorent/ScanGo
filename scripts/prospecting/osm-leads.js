/**
 * scripts/prospecting/osm-leads.js
 * ─────────────────────────────────
 * Prospección de restaurantes 100% gratuita, sin API keys y legal:
 * fuente OpenStreetMap vía Overpass API (licencia ODbL — atribuir a
 * "© OpenStreetMap contributors" si se publica trabajo derivado).
 *
 * Pipeline: collect (Overpass, con mirrors + backoff) → dedupe (nombre +
 * coords) → enrich (un solo fetch cortés a la homepage, con timeout) →
 * score (A/B/C) → export (CSV con escape anti-inyección).
 *
 * Uso:
 *   node scripts/prospecting/osm-leads.js --bbox "-34.93,-56.22,-34.88,-56.16" --out leads-montevideo
 *   node scripts/prospecting/osm-leads.js --place "Montevideo, Uruguay" --limit 100 --out leads-montevideo
 *   node scripts/prospecting/osm-leads.js --help
 *
 * Notas honestas:
 * - Overpass es un recurso compartido con rate-limit: ante 429/504/timeout
 *   el script reintenta con backoff en otro mirror. No spamear.
 * - La cobertura OSM en Uruguay es parcial: faltan muchos locales y sobran
 *   POIs viejos. Es un punto de partida, no un censo.
 * - Sin emails: OSM casi nunca tiene email. El canal es teléfono/WhatsApp o
 *   visita. Respetar Ley 18.331 y reglas anti-spam de UY.
 * - User-Agent identificable: se acepta --contact "nombre <email>" y se usa
 *   como UA (política de uso de Overpass/Nominatim).
 */

const fs = require('fs');
const path = require('path');

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

const AMENITIES = ['restaurant', 'cafe', 'bar', 'fast_food', 'ice_cream', 'pizzeria'];

function parseArgs(argv) {
  const out = { bbox: '', place: '', limit: 200, out: 'leads', contact: 'menu-pizarron-prospecting' };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else if (a === '--bbox') out.bbox = String(argv[++i] || '');
    else if (a === '--place') out.place = String(argv[++i] || '');
    else if (a === '--limit') out.limit = Math.max(1, Math.min(2000, parseInt(argv[++i], 10) || 200));
    else if (a === '--out') out.out = String(argv[++i] || 'leads').replace(/[^a-zA-Z0-9_-]/g, '_');
    else if (a === '--contact') out.contact = String(argv[++i] || out.contact).slice(0, 120);
  }
  return out;
}

function printHelp() {
  console.log([
    'Uso: node scripts/prospecting/osm-leads.js [opciones]',
    '  --bbox "sur,oeste,norte,este"  Caja directa (ej: "-34.93,-56.22,-34.88,-56.16")',
    '  --place "Ciudad, País"         Geocodifica con Nominatim y usa su bbox',
    '  --limit N                     Máx. locales a enriquecer (default 200, cap 2000)',
    '  --out nombre                  Prefijo de salida (default "leads") → .csv',
    '  --contact "texto"             Identificación para el User-Agent (política de uso)',
    '  --help                        Esta ayuda'
  ].join('\n'));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function geocodePlace(place, contact) {
  const url = `${NOMINATIM}?format=json&limit=1&q=${encodeURIComponent(place)}`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': `menu-pizarron-prospecting/1.0 (${contact})`, Accept: 'application/json' }
  }, 20000);
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const rows = await res.json();
  if (!rows || !rows.length || !rows[0].boundingbox) throw new Error('Lugar no encontrado');
  const [s, n, w, e] = rows[0].boundingbox.map(Number);
  return `${s},${w},${n},${e}`;
}

function buildQuery(bbox, limit) {
  const perType = Math.max(10, Math.ceil(limit / AMENITIES.length));
  const clauses = AMENITIES.map((a) =>
    `node["amenity"="${a}"](${bbox});way["amenity"="${a}"](${bbox});`
  ).join('');
  return `[out:json][timeout:60];(${clauses});out body ${perType * AMENITIES.length};`;
}

async function overpassQuery(query, contact) {
  let lastErr = null;
  for (let attempt = 0; attempt < MIRRORS.length * 2; attempt++) {
    const mirror = MIRRORS[attempt % MIRRORS.length];
    try {
      const res = await fetchWithTimeout(mirror, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': `menu-pizarron-prospecting/1.0 (${contact})`
        },
        body: 'data=' + encodeURIComponent(query)
      }, 65000);
      if (res.status === 429 || res.status === 504) {
        lastErr = new Error(`Overpass ${res.status} en ${mirror}`);
        await sleep(5000 * (attempt + 1));
        continue;
      }
      if (!res.ok) {
        lastErr = new Error(`Overpass ${res.status} en ${mirror}`);
        await sleep(2000);
        continue;
      }
      return await res.json();
    } catch (e) {
      lastErr = e;
      await sleep(3000 * (attempt + 1));
    }
  }
  throw lastErr || new Error('Overpass no disponible');
}

function normName(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}

function collectLeads(data) {
  const seen = new Set();
  const leads = [];
  for (const el of (data && data.elements) || []) {
    const tags = el.tags || {};
    const name = String(tags.name || '').trim();
    if (!name) continue;
    const lat = el.lat ?? (el.center && el.center.lat);
    const lon = el.lon ?? (el.center && el.center.lon);
    const key = `${normName(name)}|${lat !== undefined ? Number(lat).toFixed(4) : ''},${lon !== undefined ? Number(lon).toFixed(4) : ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    leads.push({
      name,
      amenity: tags.amenity || '',
      phone: String(tags.phone || tags['contact:phone'] || '').slice(0, 40),
      website: String(tags.website || tags['contact:website'] || '').slice(0, 300),
      address: [tags['addr:street'], tags['addr:housenumber'], tags['addr:city']].filter(Boolean).join(' ').slice(0, 160),
      lat: lat ?? '',
      lon: lon ?? ''
    });
  }
  return leads;
}

function looksSocialOnly(url) {
  return /(facebook\.com|instagram\.com|tiktok\.com|wa\.me|linktr\.ee)/i.test(url || '');
}

async function enrichLead(lead, contact) {
  const out = { ...lead, siteStatus: lead.website ? 'unknown' : 'no_website', siteOk: false };
  if (!lead.website) return out;
  let url = lead.website.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'HEAD',
      headers: { 'User-Agent': `menu-pizarron-prospecting/1.0 (${contact})` },
      redirect: 'follow'
    }, 12000);
    out.siteStatus = `http_${res.status}`;
    out.siteOk = res.status >= 200 && res.status < 400;
    out.website = url;
  } catch (e) {
    try {
      const res = await fetchWithTimeout(url, {
        headers: { 'User-Agent': `menu-pizarron-prospecting/1.0 (${contact})`, Range: 'bytes=0-0' },
        redirect: 'follow'
      }, 12000);
      out.siteStatus = `http_${res.status}`;
      out.siteOk = res.status >= 200 && res.status < 500;
      out.website = url;
    } catch (e2) {
      out.siteStatus = 'unreachable';
      out.siteOk = false;
    }
  }
  return out;
}

function scoreLead(lead) {
  let score = 0;
  const why = [];
  if (!lead.website) {
    score += 60; why.push('SIN SITIO WEB');
  } else if (looksSocialOnly(lead.website)) {
    score += 45; why.push('solo redes sociales (sin web propia)');
  } else if (!lead.siteOk) {
    score += 40; why.push(`web caída (${lead.siteStatus})`);
  } else {
    score += 10; why.push('web activa (pitch: QR + pedidos)');
  }
  if (lead.phone) { score += 5; why.push('teléfono a la vista'); }
  else { why.push('sin teléfono en OSM'); }
  const tier = score >= 40 ? 'A' : score >= 20 ? 'B' : 'C';
  return { score, tier, why: why.join('; ') };
}

function openerFor(lead, tier) {
  const n = lead.name;
  if (tier === 'A' && !lead.website) {
    return `Hola ${n}: vi que no tienen web. Les armamos un menú QR con pedidos por WhatsApp, sin comisiones, en días. ¿Les muestro una demo con su carta?`;
  }
  if (lead.website && looksSocialOnly(lead.website)) {
    return `Hola ${n}: hoy dependen solo de redes. Un menú QR propio con pedidos por WhatsApp les evita comisiones. ¿Les preparo una demo gratis?`;
  }
  if (lead.website && !lead.siteOk) {
    return `Hola ${n}: su web no está respondiendo. Mientras tanto, un menú QR con pedidos por WhatsApp los mantiene vendiendo. ¿Les muestro cómo?`;
  }
  return `Hola ${n}: ¿ya tienen menú QR con pedidos por WhatsApp sin comisiones? Les preparo una demo con su carta, sin costo.`;
}

// Neutraliza CSV injection (mismo criterio que public/js/utils/csvExport.js):
// celdas que arrancan con = + - @ tab CR reciben prefijo apóstrofo.
function escapeCell(value) {
  const s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) return `'${s}`;
  return s;
}

function toCsv(rows) {
  const header = ['tier', 'score', 'name', 'amenity', 'phone', 'website', 'site_status', 'address', 'lat', 'lon', 'why', 'opener'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(header.map((h) => `"${escapeCell(r[h]).replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n') + '\n';
}

async function main() {
  const opts = parseArgs(process.argv);
  let bbox = opts.bbox;
  if (!bbox && opts.place) {
    console.log(`Geocodificando "${opts.place}"…`);
    bbox = await geocodePlace(opts.place, opts.contact);
    console.log(`bbox: ${bbox}`);
  }
  if (!bbox) {
    console.error('Pasá --bbox "s,o,n,e" o --place "Ciudad, País". (--help para ayuda)');
    process.exit(1);
  }
  console.log('Consultando Overpass (con mirrors + backoff)…');
  const data = await overpassQuery(buildQuery(bbox, opts.limit), opts.contact);
  const raw = collectLeads(data);
  console.log(`POIs con nombre: ${raw.length}`);
  const leads = raw.slice(0, opts.limit);
  const enriched = [];
  let i = 0;
  for (const lead of leads) {
    i++;
    if (i % 20 === 0) console.log(`Enriqueciendo ${i}/${leads.length}…`);
    enriched.push(await enrichLead(lead, opts.contact));
    await sleep(250); // cortesía: no martillar sitios ajenos
  }
  const scored = enriched.map((l) => {
    const s = scoreLead(l);
    return {
      tier: s.tier, score: s.score, name: l.name, amenity: l.amenity,
      phone: l.phone, website: l.website, site_status: l.siteStatus,
      address: l.address, lat: l.lat, lon: l.lon, why: s.why,
      opener: openerFor(l, s.tier)
    };
  }).sort((a, b) => b.score - a.score || String(a.name).localeCompare(String(b.name)));
  const outPath = path.resolve(process.cwd(), `${opts.out}.csv`);
  fs.writeFileSync(outPath, toCsv(scored), 'utf8');
  const tiers = { A: 0, B: 0, C: 0 };
  for (const r of scored) tiers[r.tier]++;
  console.log(`\nListo: ${scored.length} leads (A:${tiers.A} B:${tiers.B} C:${tiers.C}) → ${outPath}`);
  console.log('Atribución: © OpenStreetMap contributors (ODbL). No commitear datos de contacto a repos públicos.');
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
