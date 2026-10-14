/**
 * scripts/load-test.js
 * ────────────────────
 * Prueba de carga SIN dependencias (k6 no está instalado y no se puede
 * instalar acá): concurrencia real con fetch nativo contra un server local.
 *
 * Mide p50/p95/p99 + tasa de error + códigos, y verifica el SLO documentado
 * (menú público p95 < 500ms, API p95 < 1000ms) y la degradación honesta
 * (429 con código, nunca 500 ni timeouts colgados).
 *
 * LÍMITE HONESTO: corre contra localhost (lógica de la app, sin red ni
 * Supabase real de por medio si se usa modo local). NO mide la infra de
 * producción (Vercel + Supabase). Para el SLO de prod hay que correrlo
 * contra staging con la misma matriz.
 *
 * Uso:
 *   PORT=4125 node api/index.js &   # server aparte
 *   node scripts/load-test.js --base http://localhost:4125 --slug demo-restaurante
 *   node scripts/load-test.js --base URL --slug SLUG --clients 50 --seconds 20 --help
 */
const CONCURRENCY_DEFAULT = 20;
const SECONDS_DEFAULT = 15;

// SLO documentado (api/utils/latencyTracker.js + AGENTS.md).
const SLO = { menu_p95_ms: 500, api_p95_ms: 1000 };

function parseArgs(argv) {
  const o = { base: 'http://localhost:3000', slug: 'demo-restaurante', clients: CONCURRENCY_DEFAULT, seconds: SECONDS_DEFAULT };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log('Uso: node scripts/load-test.js [--base URL] [--slug SLUG] [--clients N] [--seconds S]');
      process.exit(0);
    }
    if (a === '--base') o.base = String(argv[++i] || o.base).replace(/\/+$/, '');
    else if (a === '--slug') o.slug = String(argv[++i] || o.slug);
    else if (a === '--clients') o.clients = Math.max(1, Math.min(500, parseInt(argv[++i], 10) || CONCURRENCY_DEFAULT));
    else if (a === '--seconds') o.seconds = Math.max(5, Math.min(300, parseInt(argv[++i], 10) || SECONDS_DEFAULT));
  }
  return o;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function hit(url, body) {
  const started = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    let res;
    try {
      res = await fetch(url, body
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal }
        : { signal: controller.signal });
      await res.text().catch(() => '');
    } finally {
      clearTimeout(timer);
    }
    return { ok: res.status >= 200 && res.status < 500, status: res.status, ms: Date.now() - started, timeout: false };
  } catch (e) {
    return { ok: false, status: 0, ms: Date.now() - started, timeout: true };
  }
}

async function worker(opts, deadline, stats, pickRoute) {
  while (Date.now() < deadline) {
    const route = pickRoute();
    const r = route.method === 'POST'
      ? await hit(opts.base + route.path, route.body())
      : await hit(opts.base + route.path);
    stats.total++;
    if (r.timeout) stats.timeouts++;
    else if (r.status === 429) stats.r429++;
    else if (r.status >= 500) stats.r500++;
    else if (r.status >= 200 && r.status < 300) stats.r2xx++;
    else stats.other++;
    stats.samples[route.group].push(r.ms);
  }
}

async function main() {
  const opts = parseArgs(process.argv);
  // Mezcla realista de comensal: 70% lectura de carta, 20% menú JSON, 10% evento.
  // (El checkout con auth queda fuera: esto mide el camino público caliente.)
  const routes = [
    { group: 'menu', path: `/m/${opts.slug}`, method: 'GET', weight: 7 },
    { group: 'api', path: `/api/menu/${opts.slug}`, method: 'GET', weight: 2 },
    { group: 'api', path: '/api/public/analytics/event', method: 'POST', weight: 1, body: () => ({ slug: opts.slug, event: 'visit' }) }
  ];
  const bag = routes.flatMap((r) => Array(r.weight).fill(r));
  const pickRoute = () => bag[Math.floor(Math.random() * bag.length)];

  // Calentamiento: evita medir el arranque frío del server.
  await hit(opts.base + `/m/${opts.slug}`);
  await new Promise((r) => setTimeout(r, 500));

  const stats = { total: 0, r2xx: 0, r429: 0, r500: 0, other: 0, timeouts: 0, samples: { menu: [], api: [] } };
  const deadline = Date.now() + opts.seconds * 1000;
  console.log(`Carga: ${opts.clients} clientes × ${opts.seconds}s contra ${opts.base} (slug ${opts.slug})…`);
  await Promise.all(Array.from({ length: opts.clients }, () => worker(opts, deadline, stats, pickRoute)));

  const report = { opts, ...stats };
  for (const group of ['menu', 'api']) {
    const s = [...stats.samples[group]].sort((a, b) => a - b);
    report[group] = {
      n: s.length,
      p50: Math.round(percentile(s, 50)),
      p95: Math.round(percentile(s, 95)),
      p99: Math.round(percentile(s, 99)),
      max: s.length ? Math.round(s[s.length - 1]) : 0
    };
  }
  delete report.samples;
  const menuSlo = report.menu.p95 < SLO.menu_p95_ms;
  const apiSlo = report.api.p95 < SLO.api_p95_ms;
  report.slo = {
    menu_p95_lt_500ms: menuSlo,
    api_p95_lt_1000ms: apiSlo,
    no_hard_failures: stats.r500 === 0 && stats.timeouts === 0,
    pass: menuSlo && apiSlo && stats.r500 === 0 && stats.timeouts === 0
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.slo.pass) {
    console.error('SLO NO CUMPLIDO (ver detalle arriba)');
    process.exitCode = 1;
  } else {
    console.log('SLO CUMPLIDO (en este entorno: ver límites en el header del script)');
  }
}

main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
