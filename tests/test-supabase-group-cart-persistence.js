#!/usr/bin/env node
/**
 * tests/test-supabase-group-cart-persistence.js — Smoke test REAL de
 * persistencia cloud del carrito grupal (cero mocks).
 *
 * - Sin credenciales Supabase  → SKIP exit 0 (modo JSON local).
 * - Tabla public.group_carts ausente (PGRST205) → SKIP exit 0 con la ruta de
 *   migración (npm run db:check + src/db/migrations/). Es la señal de que el
 *   bloque de migración todavía no fue aplicado.
 * - Tabla presente → round-trip real: upsert → select → assert → delete
 *   (limpia su propia basura). Cualquier fallo real → exit 1.
 *
 * NO está en `npm test` a propósito: depende de infraestructura cloud.
 * Ejecutalo a mano: node tests/test-supabase-group-cart-persistence.js
 */

require('dotenv').config();
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.log('⏭️  SKIP: sin credenciales Supabase en .env (modo JSON local).');
    return { skipped: true };
  }

  console.log(`📡 Smoke test de persistencia cloud: ${new URL(SUPABASE_URL).host}`);
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) ¿Existe la tabla?
  const probe = await supabase.from('group_carts').select('id').limit(1);
  if (probe.error && String(probe.error.code) === 'PGRST205') {
    console.log('⏭️  SKIP: public.group_carts no existe todavía (PGRST205).');
    console.log('   Aplicá src/db/migrations/001_realtime_operations_tables.sql en el SQL Editor');
    console.log('   (o revisá el inventario con: npm run db:check) y volvé a correr este test.');
    return { skipped: true, reason: 'migration not applied' };
  }
  if (probe.error) {
    throw new Error(`No se pudo sondear group_carts: ${probe.error.code} ${probe.error.message}`);
  }

  // 2) Round-trip real de un carrito de mesa QA
  const key = `qa_smoke_${Date.now()}_mesa_1`;
  const payload = {
    id: key,
    restaurant_id: 'rest_smoke_test',
    table_number: '1',
    items: [
      { cartItemId: 'ci_1', dish: { id: 'd_1', name: 'Burger Smoke', price: 490 }, qty: 1, orderedById: 'usr_a' },
      { cartItemId: 'ci_2', dish: { id: 'd_4', name: 'Flat White Smoke', price: 190 }, qty: 2, orderedById: 'usr_b' }
    ],
    participants: [{ userId: 'usr_a', name: 'Ana' }, { userId: 'usr_b', name: 'Bruno' }],
    last_action: 'sync',
    last_user: 'usr_a',
    updated_at: new Date().toISOString()
  };

  const { error: upsertErr } = await supabase.from('group_carts').upsert([payload]);
  assert.ifError(upsertErr);

  const { data, error: getErr } = await supabase.from('group_carts').select('*').eq('id', key).single();
  assert.ifError(getErr);
  assert.ok(data, 'La fila debe existir tras el upsert');
  assert.strictEqual(data.restaurant_id, 'rest_smoke_test');
  assert.strictEqual(data.table_number, '1');
  assert.strictEqual(Array.isArray(data.items) ? data.items.length : 0, 2, 'items deben persistir (2 items)');
  assert.strictEqual(Array.isArray(data.participants) ? data.participants.length : 0, 2, 'participants deben persistir (2)');
  assert.strictEqual(data.last_action, 'sync');

  // 3) Idempotencia del upsert (mismo id no duplica)
  const { error: upsert2Err } = await supabase.from('group_carts').upsert([payload]);
  assert.ifError(upsert2Err);
  const { count, error: countErr } = await supabase
    .from('group_carts').select('id', { count: 'exact' }).eq('id', key);
  assert.ifError(countErr);
  assert.strictEqual(count, 1, 'el upsert por id NO debe duplicar filas');

  // 4) Cleanup
  const { error: delErr } = await supabase.from('group_carts').delete().eq('id', key);
  assert.ifError(delErr);

  console.log('✅ Persistencia cloud de group_carts verificada (upsert / select / idempotencia / delete).');
  return { ok: true };
}

main()
  .then((r) => {
    if (!r.skipped) console.log('🎉 Smoke test de persistencia Supabase OK.');
  })
  .catch((err) => {
    console.error('❌ Smoke test de persistencia Supabase FALLÓ:', err.message);
    process.exit(1);
  });