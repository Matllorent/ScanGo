const assert = require('assert');
const backend = require('../api/utils/openStatus');

/**
 * Bloque 1 — Especificación ejecutable de horarios de atención.
 *
 * La regla de abierto/cerrado es la frontera más "de negocio" del SaaS: cierres
 * a la 02:00 (ventana nocturna), rango invertido, `forceClosed` que gana
 * siempre, cambio de horario con la página abierta. En vez de probar casos
 * sueltos con sleeps (o esperando la hora real), acá la regla es una función
 * pura con reloj INYECTABLE (`nowMs`) y se valida contra una TABLA DE DECISIÓN
 * (estilo specification-by-example) + un barrido determinista de paridad
 * entre los dos espejos (CJS backend / ESM frontend).
 *
 * Ventana nocturna (Bloque 1.1): un rango invertido `inicio > fin` (p.ej.
 * `18:00-02:00`) NO es config inválida: es una franja que cruza medianoche y
 * el local abre cuando `horaLocal >= inicio || horaLocal <= fin`. `23:00-00:00`
 * cubre [23:00, 24:00) más la medianoche exacta; `inicio == fin` se trata como
 * rango normal (abre solo ese instante, config degenerada).
 *
 * El espejo ESM vive en public/js/menu/openStatus.js y menu.js delega en él
 * (con `utcOffsetMinutes = -new Date().getTimezoneOffset()`), así el browser y
 * el server prueban la MISMA fórmula — la tabla de acá es la especificación.
 *
 * No muta data/ ni toca la red: sin sleeps, sin mocks, determinista.
 */

console.log('🧪 Horarios: tabla de decisión ejecutable + paridad backend/frontend...');

const at = (iso) => Date.parse(iso);

// ── 1) Tabla de decisión (specification-by-example) ─────────────────────────
// Cada fila: descripción de la regla de negocio → { restaurant, offset, nowMs }
// → decisión esperada. Los bordes son inclusivos (>= y <=) como en el frontend
// original. Rango invertido (inicio>fin) = ventana nocturna que cruza
// medianoche: abierto cuando horaLocal >= inicio O <= fin.
const openCases = [
  {
    desc: 'Sin horario configurado → política explícita: abierto',
    rest: { forceClosed: false, scheduleEnabled: true },
    offset: 0, nowMs: at('2026-10-13T03:00:00Z'),
    want: { open: true, reason: 'no_schedule' }
  },
  {
    desc: 'Horario deshabilitado aunque haya franja → abierto',
    rest: { forceClosed: false, scheduleEnabled: false, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T03:00:00Z'),
    want: { open: true, reason: 'no_schedule' }
  },
  {
    desc: 'Abre 12:00 y son las 13:00 → abierto',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T13:00:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Abre 12:00 y son las 11:59 → cerrado',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T11:59:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'Cierra 23:00 y son las 23:01 → cerrado',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T23:01:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'Cierra 23:00 y son las 23:00 exactas → abierto (borde inclusivo)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T23:00:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Ventana nocturna 18:00-02:00, 01:30 (después de medianoche, en el tramo fin) → ABIERTO',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    offset: 0, nowMs: at('2026-10-14T01:30:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Ventana nocturna 18:00-02:00, 23:00 (antes de medianoche, en el tramo inicio) → ABIERTO',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    offset: 0, nowMs: at('2026-10-13T23:00:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Ventana nocturna 18:00-02:00, 02:00 exactas → ABIERTO (borde inclusivo del fin)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    offset: 0, nowMs: at('2026-10-14T02:00:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Ventana nocturna 18:00-02:00, 17:59 → cerrado (todavía no abrió)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    offset: 0, nowMs: at('2026-10-13T17:59:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'Ventana nocturna 18:00-02:00, 03:00 → cerrado (fuera de ambos tramos)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    offset: 0, nowMs: at('2026-10-14T03:00:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'Ventana 23:00-00:00, 23:30 → ABIERTO (tramo [23:00, 24:00))',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '23:00-00:00' },
    offset: 0, nowMs: at('2026-10-13T23:30:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Ventana 23:00-00:00, 00:30 → cerrado (el tramo fin llega solo a la medianoche exacta)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '23:00-00:00' },
    offset: 0, nowMs: at('2026-10-14T00:30:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'Ventana 23:00-00:00, 12:00 → cerrado (fuera de la ventana)',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '23:00-00:00' },
    offset: 0, nowMs: at('2026-10-13T12:00:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  },
  {
    desc: 'forceClosed=true aunque el horario diga abierto → cerrado',
    rest: { forceClosed: true, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    offset: 0, nowMs: at('2026-10-13T13:00:00Z'),
    want: { open: false, reason: 'closed_force' }
  },
  {
    desc: 'forceClosed=true sin horario → cerrado (gana siempre)',
    rest: { forceClosed: true, scheduleEnabled: false },
    offset: 0, nowMs: at('2026-10-13T13:00:00Z'),
    want: { open: false, reason: 'closed_force' }
  },
  {
    desc: 'Formato inválido ("no-format") → sin horario → abierto',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: 'no-format' },
    offset: 0, nowMs: at('2026-10-13T13:00:00Z'),
    want: { open: true, reason: 'no_schedule' }
  },
  {
    desc: 'Offset desplaza la frontera: 13:00-23:00, 00:00Z con +13h → local 13:00 → abierto',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '13:00-23:00' },
    offset: 780, nowMs: at('2026-10-13T00:00:00Z'),
    want: { open: true, reason: 'open' }
  },
  {
    desc: 'Offset desplaza la frontera: 13:00-23:00, 00:00Z con +12h → local 12:00 → cerrado',
    rest: { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '13:00-23:00' },
    offset: 720, nowMs: at('2026-10-13T00:00:00Z'),
    want: { open: false, reason: 'closed_schedule' }
  }
];

// ── 2) Barrido determinista de paridad backend↔frontend ─────────────────────
// Variedades de restaurante (franjas típicas) × offsets representativos ×
// muestras de reloj cada 90 min durante 48 h + un sweep aleatorio con PRNG
// seed (mismo seed ⇒ mismos casos, reproducible). Ambos espejos deben devolver
// exactamente el mismo { open, reason } (el frontend ESM se importa en runtime).
function makeRng(seed) {
  let a = seed >>> 0;
  return {
    next() {
      a |= 0;
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
    int(min, max) { return min + Math.floor(this.next() * (max - min + 1)); },
    pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
    maybe(p) { return this.next() < p; }
  };
}

async function run() {
  let rows = 0;
  for (const c of openCases) {
    const got = backend.computeOpenStatus(c.rest, c.offset, c.nowMs);
    assert.deepStrictEqual(
      { open: got.open, reason: got.reason },
      { open: c.want.open, reason: c.want.reason },
      `Fila "${c.desc}": esperaba ${JSON.stringify(c.want)} pero dio ${JSON.stringify({ open: got.open, reason: got.reason })}`
    );
    rows++;
  }
  console.log(`✓ Tabla de decisión: ${rows} filas verdes (bordes inclusivos, offsets, forceClosed, ventanas nocturnas)`);

  // localHourOfNow: aritmética de offset pura (00:00Z + 60min = 01:00 local).
  assert.strictEqual(backend.localHourOfNow(at('2026-01-01T00:00:00Z'), 60), 1, 'offset +60 min desplaza 1h');
  assert.strictEqual(backend.localHourOfNow(at('2026-01-01T00:00:00Z'), -60), 23, 'offset -60 min → 23:00 del día anterior');
  assert.strictEqual(backend.localHourOfNow(at('2026-01-01T00:30:00Z'), 0), 0.5, 'media hora → 0.5');

  // Paridad backend ↔ frontend (espejo ESM del menú).
  const front = await import('../public/js/menu/openStatus.js');
  const variants = [
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '18:00-02:00' },
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '08:00-22:00' },
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '00:00-23:59' },
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: '23:00-00:00' },
    { forceClosed: false, scheduleEnabled: false },
    { forceClosed: false, scheduleEnabled: true, scheduleActiveHours: 'bad-format' },
    { forceClosed: true, scheduleEnabled: true, scheduleActiveHours: '12:00-23:00' },
    { forceClosed: true, scheduleEnabled: false }
  ];
  const offsets = [-720, -540, -300, 0, 60, 300, 720, 780, 840];
  const t0 = at('2026-10-13T00:00:00Z');
  let pairs = 0;
  for (const rest of variants) {
    for (const offset of offsets) {
      for (let ms = t0; ms <= t0 + 48 * 3600 * 1000; ms += 90 * 60 * 1000) {
        const b = backend.computeOpenStatus(rest, offset, ms);
        const f = front.computeOpenStatus(rest, offset, ms);
        assert.deepStrictEqual(f, b, `paridad backend≠frontend (rest=${JSON.stringify(rest.scheduleActiveHours)}, offset=${offset}, now=${new Date(ms).toISOString()})`);
        pairs++;
      }
    }
  }
  // Sweep aleatorio reproducible (misma seed ⇒ mismos casos).
  const rng = makeRng(20261012);
  const hoursPool = ['00:00-23:59', '12:00-23:00', '18:00-02:00', '08:00-22:00', '23:00-00:00', '09:30-17:45', 'bad'];
  for (let i = 0; i < 400; i++) {
    const rest = {
      forceClosed: rng.maybe(0.15),
      scheduleEnabled: rng.maybe(0.2) ? false : true,
      scheduleActiveHours: rng.pick(hoursPool)
    };
    const offset = rng.int(-840, 840);
    const nowMs = t0 + rng.int(0, 72 * 3600 * 1000);
    assert.deepStrictEqual(
      front.computeOpenStatus(rest, offset, nowMs),
      backend.computeOpenStatus(rest, offset, nowMs),
      `paridad aleatoria caso ${i}`
    );
    pairs++;
  }
  console.log(`✓ Paridad backend↔frontend: ${pairs} pares idénticos (tabla de horarios = la especificación)`);

  console.log('\n🎉 ¡HORARIOS EN VERDE: reloj inyectable + tabla de decisión + espejos idénticos!\n');
}

run().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});