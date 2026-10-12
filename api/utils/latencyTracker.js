'use strict';

/**
 * api/utils/latencyTracker.js
 * ───────────────────────────
 * Percentiles de latencia por grupo de ruta, en memoria (single instance).
 * Cada request terminado registra su duración en el ring del grupo
 * (`req.path` → menú público `/m/*`, API `/api/*`, resto). Mantiene las
 * últimas `maxSamples` de cada grupo y calcula p50/p95/p99 bajo demanda.
 *
 * SLO de referencia (sección "Observabilidad — SLO" en AGENTS.md):
 *   - Menú público `/m/*`: p95 < 500ms (ventana del último día, best-effort).
 *   - API `/api/*`:        p95 < 1000ms.
 * Se expone en `/api/healthz` → `latency` para revisar ambos desde el uptime
 * check. Best-effort: en memoria, no persiste, no bloquea, costo O(1) push.
 */

const GROUPS = ['menu_public', 'api', 'other'];

/** Clasifica un path de ruta en su grupo de SLO. */
function groupFor(path = '') {
  const p = String(path || '');
  if (p.startsWith('/m/')) return 'menu_public';
  if (p.startsWith('/api/')) return 'api';
  return 'other';
}

class LatencyTracker {
  constructor(maxSamples = 2000) {
    this.maxSamples = maxSamples;
    this.buffers = new Map(GROUPS.map((g) => [g, []]));
    this.totalSamples = 0;
  }

  /** Registra la duración (ms) de un request terminado. O(1) amortizado. */
  record(path, durationMs) {
    const group = groupFor(path);
    const buf = this.buffers.get(group) || [];
    buf.push(Number(durationMs) || 0);
    if (buf.length > this.maxSamples) buf.shift();
    this.buffers.set(group, buf);
    this.totalSamples++;
  }

  /** Percentil sobre un array ordenado (null si vacío). */
  percentile(sorted, p) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return sorted[idx];
  }

  /** Snapshot de todos los grupos con p50/p95/p99 y básicos. */
  snapshot() {
    const out = {
      totalRequests: this.totalSamples,
      sampledAt: new Date().toISOString(),
      groups: {}
    };
    for (const [group, buf] of this.buffers.entries()) {
      const sorted = [...buf].sort((a, b) => a - b);
      const sum = sorted.reduce((s, x) => s + x, 0);
      out.groups[group] = {
        count: sorted.length,
        min: sorted.length ? sorted[0] : null,
        max: sorted.length ? sorted[sorted.length - 1] : null,
        mean: sorted.length ? +(sum / sorted.length).toFixed(1) : null,
        p50: this.percentile(sorted, 50),
        p95: this.percentile(sorted, 95),
        p99: this.percentile(sorted, 99)
      };
    }
    return out;
  }
}

// Singleton del proceso (mismo objeto que consulta /api/healthz).
const latencyTracker = new LatencyTracker();

module.exports = { LatencyTracker, latencyTracker, groupFor, GROUPS };