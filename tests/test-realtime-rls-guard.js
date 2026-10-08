/**
 * tests/test-realtime-rls-guard.js
 * Guard de canales Realtime (migración 002). La autorización por topic se
 * aplica a mano (SQL Editor / Management API), igual que la 001: este test es
 * estático y verifica que la migración exista y contenga las políticas
 * correctas, para que nadie la borre o la debilite sin que falle npm test.
 *
 * Está en `npm test` (nº 23).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function runTests() {
  console.log('🧪 Verificando guard de canales Realtime (migración 002)...');

  const migrationPath = path.join(__dirname, '..', 'src', 'db', 'migrations', '002_realtime_channel_guard.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.ok(sql.includes('realtime.messages'), 'La migración debe apuntar a realtime.messages');
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'), 'Debe habilitar RLS en realtime.messages');
  assert.ok(sql.includes('realtime.topic()'), 'Debe usar realtime.topic() para filtrar por canal');
  assert.ok(sql.includes("LIKE 'realtime:%'"), 'Los clientes solo unen topics de carrito grupal (allowlist)');
  assert.ok(sql.includes('TO anon'), 'Política para comensales anónimos (anon key del menú)');
  assert.ok(sql.includes('TO authenticated'), 'Política para usuarios autenticados');
  assert.ok(sql.includes('DROP POLICY IF EXISTS'), 'Idempotente: se puede re-ejecutar sin romper');

  console.log('✓ 002: RLS en realtime.messages + allowlist de topics (realtime:%) para anon/authenticated');
  console.log('🎉 ¡GUARD DE CANALES REALTIME VERIFICADO AL 100%!');
}

try {
  runTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}