#!/usr/bin/env node
/**
 * scripts/verify-dual-write-parity.js
 * Compara JSON local vs Supabase (service role) — SOLO LECTURA, cero PII.
 * - users: conteo + set de ids
 * - restaurants: conteo + set de ids + por id común: subscription.status y slug
 * Reporta: solo-local, solo-cloud, divergentes.
 * Sin service key → mensaje + exit 2 (como db:check).
 * Salida: JSON por stdout + resumen humano a stderr.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const os = require('os');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Falta SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env (modo local-only, nada que comparar).');
  process.exit(2);
}

const IS_VERCEL = process.env.VERCEL === '1' || process.env.VERCEL === 'true';
const DATA_DIR = IS_VERCEL
  ? path.join(os.tmpdir(), 'menu-pizarron-saas')
  : path.join(__dirname, '..', 'data');

function readJson(file, def = []) {
  if (!fs.existsSync(file)) return def;
  try {
    const v = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(v) ? v : def;
  } catch (e) {
    return def;
  }
}

async function fetchAll(client, table, columns) {
  const rows = [];
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await client.from(table).select(columns).range(from, from + PAGE - 1);
    if (error) throw new Error(`Supabase ${table}: ${error.code || ''} ${error.message || String(error)}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

(async () => {
  try {
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const localUsers = readJson(path.join(DATA_DIR, 'users.json'), []);
    const localRests = readJson(path.join(DATA_DIR, 'restaurants.json'), []);
    const localUserIds = new Set(localUsers.filter(u => u && u.id).map(u => String(u.id)));
    const localRestById = new Map(
      localRests.filter(r => r && r.id).map(r => [String(r.id), r])
    );

    const [cloudUsers, cloudRests] = await Promise.all([
      fetchAll(supabase, 'users', 'id'),
      fetchAll(supabase, 'restaurants', 'id,slug,subscription')
    ]);
    const cloudUserIds = new Set(cloudUsers.map(u => String(u.id)));
    const cloudRestById = new Map(cloudRests.map(r => [String(r.id), r]));

    const onlyLocalUsers = [...localUserIds].filter(id => !cloudUserIds.has(id)).sort();
    const onlyCloudUsers = [...cloudUserIds].filter(id => !localUserIds.has(id)).sort();

    const localRestIds = new Set(localRestById.keys());
    const cloudRestIds = new Set(cloudRestById.keys());
    const onlyLocalRests = [...localRestIds].filter(id => !cloudRestIds.has(id)).sort();
    const onlyCloudRests = [...cloudRestIds].filter(id => !localRestIds.has(id)).sort();

    const divergentes = [];
    for (const id of [...localRestIds].filter(x => cloudRestIds.has(x)).sort()) {
      const local = localRestById.get(id);
      const cloud = cloudRestById.get(id);
      const diff = {};
      const localStatus = local && local.subscription ? String(local.subscription.status || '') : '';
      const cloudSub = cloud && cloud.subscription && typeof cloud.subscription === 'object'
        ? String(cloud.subscription.status || '')
        : '';
      if (localStatus !== cloudSub) diff.subscriptionStatus = { local: localStatus, cloud: cloudSub };
      const localSlug = String(local.slug || '');
      const cloudSlug = String(cloud.slug || '');
      if (localSlug !== cloudSlug) diff.slug = { local: localSlug, cloud: cloudSlug };
      if (Object.keys(diff).length) divergentes.push({ id, ...diff });
    }

    const report = {
      users: {
        local: localUserIds.size,
        cloud: cloudUserIds.size,
        soloLocal: onlyLocalUsers,
        soloCloud: onlyCloudUsers
      },
      restaurants: {
        local: localRestIds.size,
        cloud: cloudRestIds.size,
        soloLocal: onlyLocalRests,
        soloCloud: onlyCloudRests,
        divergentes
      }
    };

    console.log(JSON.stringify(report, null, 2));
    const d = divergentes.length;
    console.error(
      `Paridad dual-write: users local=${report.users.local} cloud=${report.users.cloud} ` +
      `(solo-local=${onlyLocalUsers.length} solo-cloud=${onlyCloudUsers.length}) | ` +
      `restaurants local=${report.restaurants.local} cloud=${report.restaurants.cloud} ` +
      `(solo-local=${onlyLocalRests.length} solo-cloud=${onlyCloudRests.length} divergentes=${d})` +
      (d ? ' ⚠️ hay divergencias (ver JSON en stdout)' : ' ✅ sin divergencias')
    );
    // Salida natural (sin process.exit): en Windows, process.exit() con
    // sockets aún abiertos del pool fetch aborta el proceso (fail-fast libuv).
    process.exitCode = 0;
  } catch (e) {
    // Nunca excepción sin controlar: JSON de error por stdout + detalle a stderr, exit 1.
    console.log(JSON.stringify({ error: (e && e.message) || String(e) }));
    console.error(`verify-dual-write-parity falló: ${(e && e.message) || String(e)}`);
    process.exitCode = 1;
  }
})();
