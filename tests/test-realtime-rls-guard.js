/**
 * tests/test-realtime-rls-guard.js
 * Guard de canales Realtime (migración 002 + flips private:true).
 *
 * CONTEXTO: realtime.messages es de supabase_realtime_admin; RLS ya está activa
 * por defecto y supautils permite crear políticas sin ser owner, pero NO
 * ALTER TABLE (falla con 42501 en cualquier proyecto y aborta la transacción).
 * Por eso este test exige que la migración NO tenga ALTER TABLE sobre
 * realtime.messages y que las políticas cubran join+receive (SELECT) y emisión
 * (INSERT) para anon y authenticated. Además verifica que los tres canales del
 * código están marcados private:true (requisito para que las políticas apliquen).
 *
 * Está en `npm test` (nº 23).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function runTests() {
  console.log('🧪 Verificando guard de canales Realtime (migración 002 + flips private)...');

  const migrationPath = path.join(ROOT, 'src', 'db', 'migrations', '002_realtime_channel_guard.sql');
  const sql = fs.readFileSync(migrationPath, 'utf8');

  // 1) El error 42501: NO se puede ejecutar NINGÚN ALTER TABLE sobre realtime.messages.
  assert.strictEqual(
    /ALTER\s+TABLE\s+(realtime\.)?messages/i.test(sql),
    false,
    '002 no debe contener ALTER TABLE sobre realtime.messages (supautils no lo permite → 42501)'
  );

  // 2) Políticas: join+receive (SELECT) y emisión (INSERT) para ambos roles.
  assert.ok(sql.includes('ON realtime.messages'), 'Las políticas deben apuntar a realtime.messages');
  for (const role of ['anon', 'authenticated']) {
    assert.ok(sql.includes(`FOR SELECT\n  TO ${role}`), `Política SELECT para ${role} (join + receive)`);
    assert.ok(sql.includes(`FOR INSERT\n  TO ${role}`), `Política INSERT para ${role} (emitir broadcasts)`);
  }
  assert.ok(sql.includes('(select realtime.topic())'), 'Debe usar realtime.topic() para filtrar por canal');
  assert.ok(sql.includes("LIKE 'realtime:%'"), 'Solo se permiten topics de carrito grupal (allowlist)');
  assert.ok(sql.includes('DROP POLICY IF EXISTS'), 'Idempotente: se puede re-ejecutar sin romper');

  // 3) Los tres canales del código deben unirse como PRIVADOS (activa las políticas).
  const gcm = fs.readFileSync(path.join(ROOT, 'public', 'js', 'components', 'GroupCartManager.js'), 'utf8');
  assert.ok(/private:\s*true/.test(gcm), 'GroupCartManager une el canal de mesa con private:true');

  const orders = fs.readFileSync(path.join(ROOT, 'api', 'routes', 'orders.js'), 'utf8');
  assert.ok(
    /channel\(.+config:\s*\{\s*private:\s*true\s*\}/s.test(orders),
    'orders.js (broadcastToTableChannel) une canales de carrito con private:true'
  );

  const index = fs.readFileSync(path.join(ROOT, 'api', 'index.js'), 'utf8');
  assert.ok(
    /event_waiters_.+config:\s*\{\s*private:\s*true\s*\}/s.test(index),
    'api/index.js une event_waiters_ con private:true'
  );

  // 4) El navegador carga supabase-js >= 2.44 (requisito de canales privados).
  for (const html of ['menu.html', 'index.html']) {
    const htmlSrc = fs.readFileSync(path.join(ROOT, 'public', html), 'utf8');
    assert.ok(
      /@supabase\/supabase-js@2/.test(htmlSrc),
      `${html} debe cargar @supabase/supabase-js@2 (canales privados desde v2.44)`
    );
  }

  console.log('✓ 002 sin ALTER TABLE killer + políticas SELECT/INSERT realtime:% para anon/authenticated');
  console.log('✓ Canales privados en GroupCartManager, orders.js e index.js + supabase-js@2 en el navegador');
  console.log('🎉 ¡GUARD DE CANALES REALTIME VERIFICADO AL 100%!');
}

try {
  runTests();
  process.exit(0);
} catch (err) {
  console.error('❌ Falló:', err.message);
  process.exit(1);
}