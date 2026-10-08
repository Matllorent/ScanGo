/**
 * tests/test-realtime-live-guard.js
 * E2E REAL del guard de canales Realtime (requiere migración 002 aplicada en
 * Supabase). Conecta con la anon key — exactamente como el navegador del
 * comensal — y valida el contrato de seguridad de punta a punta:
 *   1) JOIN privado a topic `realtime:%` (carrito grupal) → SUBSCRIBED
 *      (política SELECT anon: unirse y recibir).
 *   2) BROADCAST en ese canal → ok (política INSERT anon: emitir cart_update).
 *   3) JOIN privado a topic ajeno (`event_waiters_*`) → RECHAZADO
 *      (deny-by-default: anon no tiene política fuera de realtime:%).
 *
 * Sin mocks: habla con el Realtime real del proyecto. Si la 002 no está
 * aplicada, el paso 1 falla y el test lo dice explícitamente (contrato de
 * despliegue: SQL 002 ANTES que el código private:true).
 *
 * Si no hay SUPABASE_URL / SUPABASE_ANON_KEY en .env, hace SKIP (exit 0).
 * Está en `npm test` (nº 24).
 */
require('dotenv').config();
const assert = require('assert');
const { createClient } = require('@supabase/supabase-js');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;

function joinChannel(client, topic) {
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } });
    const timer = setTimeout(() => resolve({ status: 'TIMED_OUT', error: null, channel }), 12000);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve({ status, error: err || null, channel });
      }
      // Estados intermedios (SUBSCRIBING) se ignoran hasta llegar a uno final.
    });
  });
}

async function run() {
  console.log('🧪 Verificando guard de canales Realtime en el proyecto REAL (migración 002)...');
  if (!URL || !ANON) {
    console.log('⏭️  SKIP: sin SUPABASE_URL/SUPABASE_ANON_KEY no se puede probar Realtime en vivo.');
    return;
  }

  const client = createClient(URL, ANON);
  const nonce = Date.now();
  const allowedTopic = `realtime:guard-live-${nonce}:mesa_1:${nonce}`;
  const deniedTopic = `event_waiters_guard_${nonce}`;

  // 1. anon DEBE poder unirse (privado) a un carrito grupal realtime:%.
  const okJoin = await joinChannel(client, allowedTopic);
  console.log(`  JOIN privado anon -> realtime:%   → ${okJoin.status}${okJoin.error ? ` (${okJoin.error.message})` : ''}`);

  // 2. anon DEBE poder emitir broadcasts en realtime:% (política INSERT).
  if (okJoin.status === 'SUBSCRIBED') {
    const sendResult = await okJoin.channel.send({
      type: 'broadcast',
      event: 'cart_update',
      payload: { guard: nonce }
    });
    console.log(`  BROADCAST anon  -> realtime:%  → ${String(sendResult)}`);
    assert.strictEqual(sendResult, 'ok', 'anon debe poder emitir broadcasts en topics realtime:% (política INSERT)');
  }

  // 3. anon NO debe poder unirse a un topic ajeno privado (event_waiters_*).
  const deniedJoin = await joinChannel(client, deniedTopic);
  console.log(`  JOIN privado anon -> ajeno      → ${deniedJoin.status}${deniedJoin.error ? ` (denegado: ${deniedJoin.error.message})` : ''}`);

  await client.removeAllChannels();

  assert.strictEqual(okJoin.status, 'SUBSCRIBED',
    'anon DEBE poder unirse/recepcionar canales realtime:% (SELECT) — ¿la migración 002 se aplicó?');
  assert.notStrictEqual(deniedJoin.status, 'SUBSCRIBED',
    'anon NO debe poder unirse a topics ajenos (event_waiters_*) — deny-by-default');

  console.log('✓ JOIN + broadcast anon en realtime:% OK (SELECT+INSERT) y topics ajenos rechazados');
  console.log('🎉 ¡GUARD DE CANALES REALTIME VERIFICADO EN VIVO AL 100%!');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Falló:', err.message);
    process.exit(1);
  });