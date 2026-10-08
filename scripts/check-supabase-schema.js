#!/usr/bin/env node
/**
 * scripts/check-supabase-schema.js
 * Inventario real del esquema Supabase vía PostgREST (service role).
 * Una tabla existe si `.from(t).select('id').limit(1)` responde 200 (aunque
 * esté vacía); si responde PGRST205 (relation does not exist) NO existe.
 * No hace writes: es read-only y 100% real (cero mocks).
 *
 * Uso: node scripts/check-supabase-schema.js
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (o alias) en .env.
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('❌ Falta SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY en .env');
  process.exit(1);
}

const TABLES = [
  'users',
  'restaurants',
  'webhooks',
  'group_carts',
  'orders',
  'reviews',
  'customer_feedback',
  'audit_logs',
  'push_subscriptions',
  'telemetry_events',
];

async function tableExists(supabase, table) {
  const { error, status } = await supabase.from(table).select('id').limit(1);
  if (!error) return { exists: true, status, note: '' };
  if (String(error.code || '') === 'PGRST205') {
    return { exists: false, status, note: 'RELACIÓN NO EXISTE (PGRST205)' };
  }
  if (String(error.message || '').includes('permission denied')) {
    return { exists: true, status, note: `existe pero sin acceso para esta rol (${error.message})` };
  }
  return { exists: false, status, note: `otro error: ${error.code} ${error.message}` };
}

(async () => {
  console.log(`📡 Supabase: ${new URL(SUPABASE_URL).host}\n`);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rows = [];
  for (const table of TABLES) {
    const result = await tableExists(supabase, table);
    const status = result.exists ? '✅ EXISTE' : '❌ FALTA';
    rows.push({ table, status, note: result.note });
    console.log(`  ${status.padEnd(10)} ${table.padEnd(20)} ${result.note}`);
  }

  const missing = rows.filter((r) => r.status.includes('❌')).map((r) => r.table);
  console.log('');
  if (missing.length === 0) {
    console.log('🎉 Todas las tablas declaradas en schema.sql existen en la nube.');
  } else {
    console.log(`⚠️  Faltan ${missing.length} tabla(s): ${missing.join(', ')}`);
    console.log('   Aplicá src/db/migrations/ (o schema.sql) en el SQL Editor de Supabase.');
  }
})();