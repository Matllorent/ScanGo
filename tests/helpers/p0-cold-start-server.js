/**
 * tests/helpers/p0-cold-start-server.js
 * ─────────────────────────────────────
 * Proceso hijo para el probe de cold start de P0-1: arranca la app real con
 * un `SCANGO_DATA_DIR` vacío (como una réplica nueva de Vercel) y espera a que
 * `db.ready` hidrate SOLO usuarios. El restaurante debe llegar por la
 * hidratación lazy de `/api/auth/me`, no por el boot.
 *
 * Imprime `P0_PORT=<puerto>` cuando está listo. El test lo mata al terminar.
 */
const http = require('http');
const db = require('../../src/db/db');
const app = require('../../api/index');

(async () => {
  await db.ready;
  const server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    process.stdout.write(`P0_PORT=${server.address().port}\n`);
  });
  const shutdown = () => {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
})().catch((err) => {
  console.error('[p0-cold-start-server]', err && err.stack ? err.stack : err);
  process.exit(1);
});
