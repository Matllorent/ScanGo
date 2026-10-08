#!/usr/bin/env node
/**
 * scripts/test-data-guard.js
 * ─────────────────────────
 * Guard de aislamiento de datos para `npm test`.
 *
 * Los tests mutan data/*.json (política del repo: cero mocks, flujos reales
 * con el store local). Este guard toma una foto de TODO data/ antes de correr
 * la suite y la restaura SIEMPRE al final (pase o falle), para que:
 *   1. Las mutaciones de QA jamás lleguen al commit.
 *   2. La suite sea repetible: cada corrida empieza desde el mismo estado.
 *   3. No haya que revertir a mano antes de commitear.
 *
 * Uso: `npm test` → este guard → spawn de `npm run test:core` (la cadena real).
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'menu-data-backup-'));

/** Copia todos los archivos actuales de data/ al backup. */
function snapshot() {
  if (!fs.existsSync(dataDir)) return [];
  const files = fs
    .readdirSync(dataDir)
    .filter((f) => fs.statSync(path.join(dataDir, f)).isFile());
  for (const f of files) {
    fs.copyFileSync(path.join(dataDir, f), path.join(backupDir, f));
  }
  return files;
}

/** Borra archivos nuevos y restaura los originales desde el backup. */
function restore(originalFiles) {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  const now = new Set(fs.readdirSync(dataDir).filter((f) => fs.statSync(path.join(dataDir, f)).isFile()));
  // Archivos que aparecieron durante la suite (datos de QA) → se eliminan
  for (const f of now) {
    if (!originalFiles.includes(f)) {
      try {
        fs.unlinkSync(path.join(dataDir, f));
      } catch (e) {
        console.warn(`[data-guard] No se pudo borrar ${f}:`, e.message);
      }
    }
  }
  // Archivos originales → se restauran tal cual estaban
  for (const f of originalFiles) {
    try {
      fs.copyFileSync(path.join(backupDir, f), path.join(dataDir, f));
    } catch (e) {
      console.warn(`[data-guard] No se pudo restaurar ${f}:`, e.message);
    }
  }
}

const originalFiles = snapshot();
console.log(`[data-guard] Snapshot de data/ (${originalFiles.length} archivos) → ${backupDir}`);

const result = spawnSync('npm', ['run', 'test:core'], { stdio: 'inherit', shell: true });

restore(originalFiles);
console.log(`[data-guard] Data restaurada (${originalFiles.length} archivos): la suite dejó data/ como estaba antes de correr.`);

process.exit(result.status === null ? 1 : result.status);