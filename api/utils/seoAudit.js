'use strict';

/**
 * api/utils/seoAudit.js
 * ─────────────────────
 * Auditor de salud SEO/GEO por restaurante — FUNCIÓN PURA (sin I/O, sin db).
 *
 * Genera el reporte del panel "Salud SEO" del Studio y alimenta el cron
 * diario `/api/cron/seo-audit` (alertas de calidad de carta).
 *
 * Cada check devuelve `{ id, label, status: 'ok'|'warn'|'fail', hint }`.
 * - `fail`   → problema que deja el menú en mal estado para buscadores/IA
 *              (página vacía, precios inválidos, horario roto, sub cancelada…).
 * - `warn`   → mejora recomendada (datos locales incompletos, duplicados…).
 * - `ok`     → todo correcto; el hint da contexto útil para el dueño.
 *
 * El score es 0–100: cada `fail` resta 25, cada `warn` resta 5 (clamp).
 * Nos apoyamos en `seoDiscovery.buildOpeningHoursFromSchedule` (misma fuente
 * de verdad de horarios que el JSON-LD del SSR y `computeOpenStatus`).
 */

const { buildOpeningHoursFromSchedule } = require('./seoDiscovery');

const HINT_STYLE = {
  ok: '',
  warn: ' (recomendación)',
  fail: ''
};

function buildChecks(restaurant, allRestaurants = []) {
  const r = restaurant || {};
  const categories = Array.isArray(r.categories) ? r.categories : [];
  const dishes = Array.isArray(r.dishes) ? r.dishes : [];
  const branches = Array.isArray(r.branches) ? r.branches : [];
  const slug = String(r.slug || '');
  const checks = [];
  const add = (id, label, status, hint) =>
    checks.push({ id, label, status, hint: hint + HINT_STYLE[status], weight: status === 'fail' ? 25 : status === 'warn' ? 5 : 0 });

  // 1. URL pública indexable.
  if (!slug) {
    add('url', 'URL pública (slug)', 'fail', 'El menú no tiene slug asignado: no existe /m/:slug que indexar.');
  } else {
    add('url', 'URL pública (slug)', 'ok', `El menú vive en /m/${slug} y queda en el sitemap.`);
  }

  // 2. Carta publicada (una página vacía no vale para SEO ni para el comensal).
  if (categories.length === 0 && dishes.length === 0) {
    add('menu', 'Carta publicada', 'fail', 'La carta está vacía: sin categorías ni platos el menú no tiene contenido.');
  } else if (categories.length === 0) {
    add('menu', 'Carta publicada', 'fail', 'Hay platos sueltos pero ninguna categoría: el menú se ve incompleto.');
  } else {
    add('menu', 'Carta publicada', 'ok', `${categories.length} categoría(s) y ${dishes.length} plato(s) publicados.`);
  }

  // 3. Precios coherentes (negativos/NaN rompen el cobro y la percepción de calidad).
  const badPrices = dishes.filter((d) => typeof d.price === 'number' && (!Number.isFinite(d.price) || d.price < 0));
  if (badPrices.length > 0) {
    add('prices', 'Precios coherentes', 'fail', `${badPrices.length} plato(s) con precio negativo o inválido.`);
  } else if (dishes.some((d) => typeof d.price !== 'number')) {
    add('prices', 'Precios coherentes', 'warn', 'Algunos platos no tienen precio numérico (se muestran como "Sin costo").');
  } else {
    add('prices', 'Precios coherentes', 'ok', `${dishes.length} platos con precio numérico consistente.`);
  }

  // 4. Sucursales sin referencias muertas (overridePrices a platos inexistentes).
  const dishIds = new Set(dishes.map((d) => d.id).filter(Boolean));
  const deadBranchOverrides = branches
    .map((b) => {
      const overrides = b.overridePrices || {};
      const dead = Object.keys(overrides).filter((id) => !dishIds.has(id));
      return dead.length > 0 ? { branch: b.name || b.slug || b.id, dead } : null;
    })
    .filter(Boolean);
  if (deadBranchOverrides.length > 0) {
    add(
      'branchOverrides',
      'Sucursales coherentes',
      'warn',
      `${deadBranchOverrides.length} sucursal(es) con overridePrices de platos que ya no existen (se ignoran al cotizar).`
    );
  } else if (branches.length > 0) {
    add('branchOverrides', 'Sucursales coherentes', 'ok', `${branches.length} sucursal(es) sin referencias muertas.`);
  } else {
    add('branchOverrides', 'Sucursales coherentes', 'ok', 'Sin sucursales configuradas (no aplica).');
  }

  // 5. Sin duplicados obvios de nombre dentro de una misma categoría.
  const dupNames = categories
    .map((c) => {
      const names = dishes
        .filter((d) => d.categoryId === c.id)
        .map((d) => String(d.name || '').trim().toLowerCase())
        .filter(Boolean);
      const dups = names.filter((n, i) => names.indexOf(n) !== i);
      return dups.length > 0 ? { category: c.name, count: dups.length } : null;
    })
    .filter(Boolean);
  if (dupNames.length > 0) {
    add('duplicates', 'Nombres únicos', 'warn', `${dupNames.length} categoría(s) con platos que comparten nombre exacto (confunde al comensal).`);
  } else if (dishes.length > 0) {
    add('duplicates', 'Nombres únicos', 'ok', 'Sin nombres repetidos dentro de una misma categoría.');
  } else {
    add('duplicates', 'Nombres únicos', 'ok', 'Sin platos para comparar.');
  }

  // 6. Horario válido: derivamos el schema con la MISMA fuente que el JSON-LD.
  const derived = buildOpeningHoursFromSchedule(r);
  if (r.scheduleEnabled === true) {
    if (derived) {
      add('schedule', 'Horario publicado', 'ok', `Abierto ${derived.openingHours}. Se expone en el marcado JSON-LD.`);
    } else {
      add('schedule', 'Horario publicado', 'fail', 'El horario activo no tiene un formato válido ("HH:MM-HH:MM") y no se puede publicar.');
    }
  } else {
    add('schedule', 'Horario publicado', 'warn', 'Sin horario configurado: buscadores y comensales no saben cuándo está abierto. Se omite del JSON-LD.');
  }

  // 7. Datos locales (teléfono / dirección / ciudad): la señal #1 del SEO local.
  const hasPhone = Boolean(String(r.phone || '').trim());
  const hasAddress = Boolean(String(r.address || '').trim()) || branches.some((b) => Boolean(String(b.address || '').trim()));
  const hasCity = Boolean(String(r.city || '').trim());
  const missingLocal = [hasPhone ? null : 'teléfono', hasAddress ? null : 'dirección', hasCity ? null : 'ciudad'].filter(Boolean);
  if (missingLocal.length === 0) {
    add('localData', 'Datos locales', 'ok', 'Teléfono, dirección y ciudad presentes (señal clave de SEO local).');
  } else {
    add('localData', 'Datos locales', 'warn', `Falta(n): ${missingLocal.join(', ')}. Google Business y el comercio local dependen de estos datos.`);
  }

  // 8. Descripción corta (slogan → meta description / og:description).
  if (String(r.slogan || r.description || '').trim()) {
    add('description', 'Descripción corta', 'ok', 'La descripción alimenta la meta description y el OG compartido.');
  } else {
    add('description', 'Descripción corta', 'warn', 'Sin slogan: el menú se comparte con la descripción genérica.');
  }

  // 9. Marca visible (banner y/o logo): sin imagen el share se ve pobre.
  const banner = String(r.bannerUrl || '').trim();
  const logo = String(r.logoUrl || '').trim();
  if (banner || logo) {
    add('branding', 'Imagen de marca', 'ok', banner ? 'Banner configurado (alimenta el og:image).' : 'Logo configurado (se recomienda además un banner).');
  } else {
    add('branding', 'Imagen de marca', 'warn', 'Sin banner ni logo: la carta y el compartir en redes se ven genéricos.');
  }

  // 10. Marcado estructurado viable (el SSR emite JSON-LD si hay qué mostrar).
  const menuSections = categories.length;
  if (slug && menuSections > 0) {
    add('jsonLd', 'Marcado JSON-LD', 'ok', `${menuSections} sección(es) de menú embebidas en el SSR (Rich Results).`);
  } else {
    add('jsonLd', 'Marcado JSON-LD', 'fail', 'Sin slug o categorías el SSR no emite secciones de menú en el JSON-LD.');
  }

  // 11. Suscripción activa (regla de negocio: cancelada queda fuera del sitemap).
  const subStatus = r.subscription && r.subscription.status;
  if (subStatus === 'canceled' || subStatus === 'expired') {
    add('subscription', 'Suscripción activa', 'fail', `Suscripción ${subStatus}: el menú NO se incluye en el sitemap ni en el robots.`);
  } else {
    add('subscription', 'Suscripción activa', 'ok', 'El menú se incluye en el sitemap (suscripción vigente).');
  }

  // 12. Slug único en la red (colisión rompería la URL de otro local).
  if (slug) {
    const collisions = allRestaurants.filter((x) => x && x.slug === slug && x.id !== r.id && x.userId !== r.userId).length;
    if (collisions > 0) {
      add('slugUniqueness', 'Slug único', 'fail', `Otro restaurante usa el slug /m/${slug}: la URL es ambigua.`);
    } else {
      add('slugUniqueness', 'Slug único', 'ok', `El slug /m/${slug} es único en la plataforma.`);
    }
  }

  return checks;
}

/**
 * Reporte completo de salud SEO/GEO para un restaurante.
 * @param {{}} restaurant - Restaurante (fuente ya validada por la db).
 * @param {{ allRestaurants?: Array }} options - Para checks globales (slugs).
 * @returns {{ score: number, summary: { total: number, ok: number, warn: number, fail: number }, checks: Array<{id,label,status,hint}> }}
 */
function runSeoAudit(restaurant, options = {}) {
  const allRestaurants = Array.isArray(options.allRestaurants) ? options.allRestaurants : [];
  const checks = buildChecks(restaurant, allRestaurants);
  const summary = checks.reduce(
    (acc, c) => {
      acc[c.status] += 1;
      acc.total += 1;
      return acc;
    },
    { total: 0, ok: 0, warn: 0, fail: 0 }
  );
  // fail = 25 puntos, warn = 5 puntos (máx 6 fails → 0).
  const penalty = checks.reduce((n, c) => n + c.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  return { score, summary, checks };
}

module.exports = { runSeoAudit };