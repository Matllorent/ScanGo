# Plan de Ejecución — Bloque "El Sistema" (oct-2026)

> Cómo ejecutamos las 4 features del backlog priorizado para que sean
> **escalables en serverless**, coherentes con la arquitectura existente y
> **superiores a la competencia**, no clones.
> Predecesores: `docs/estrategia-producto-oct-2026.md` (el por-qué) y
> `docs/kds-reservas-roadmap.md` (blueprint KDS).

## 0. Principios de ejecución (no negociables)

1. **Módulo puro + ruta fina** (el patrón de R1/R2/Bloques 1-4): toda la
   lógica testeada vive en `api/utils/*.js` (CJS puro, sin I/O) o
   `public/js/**` (ESM); la ruta/cron solo hace fetch + llamada al módulo +
   respuesta. El test golpea el módulo puro y la ruta en runtime — nunca
   duplica lógica.
2. **SQL first, JS scan después**: cuando la data crezca, el agregado debe
   poder pasar a `GROUP BY` SQL sin cambiar el módulo puro (el módulo recibe
   una LISTA de filas y decide; el llamador trae filas de Supabase o del
   espejo local — el dual-mode ya resuelve eso).
3. **Crones horarios productores + dedupe, NUNCA crones por huso por local**:
   un cron por huso horario no escala (24 jobs, drift de DST). Un solo cron
   HORARIO que pregunta "¿a este local le es la hora?" escala linealmente con
   locales y tolera reintentos. El dedupe vive en `notification_events`
   (tabla ya indexada, helper de R2 reutilizable, marcador `isRead:true` que
   no ensucia el inbox).
4. **Derivado, no estado**: si un dato se puede computar (agotados de hoy,
   cierre del día), se DERIVA con la fecha local del local via
   `utcOffsetMinutes` — cero crones de reset, cero drift de medianoche, y el
   mismo cálculo corre igual en dev local y Vercel (lección del Bloque D/E).
5. **Cero env vars nuevos**: el dato nuevo (huso del dueño) viaja en el
   documento del restaurante capturado desde el navegador del Studio (el
   mismo mecanismo del heatmap del Bloque D). Sin secretos ni config manual.
6. **Higiene incluida cuando comparte dominio**: los findings P1 (retención
   de `notification_events`) y P2 (escape HTML en emails) van en el commit
   de F1 porque comparten archivo/tabla con el feature — mismo dominio, una
   sola corrida de suites.

## 1. F1 — "El Cierre": resumen nocturno por email (el wow diario)

Qué es: email a las ~3 AM local del dueño con su día: pedidos, ingresos,
propinas, ticket promedio, top platos, hora pico. El dueño cuenta la plata al
otro día sin POS.

### Diseño
- **Cron horario** `GET /api/cron/night-summary` (`vercel.json`: `0 * * * *`,
  fail-closed con `verifyCronAuth` compartido del Bloque B). En cada tick:
  para cada restaurante con `nightSummaryEnabled !== false`, hora local =
  `localHourOf` (helper EXISTENTE y testeado) con `restaurant.
  utcOffsetMinutes` → si hour == summaryHour (default 3) → generar y enviar.
- **Huso capturado**: el Studio manda `utcOffsetMinutes` en `/api/studio/save`
  (input hidden fijado por JS con `-new Date().getTimezoneOffset()`, clamp
  ±840 en el sanitizer). Default del sanitizer: `-180` (UY/AR), documentado
  — nunca inventar por-local.
- **Dedupe**: `notification_events` type `night_summary`, clave en `data`:
  `{restaurantId, localDay}`. Doble tick del cron (retry de Vercel) con el
  mismo localDay → skip silencioso. Helper reutilizado de R2 (upsert con
  `onConflict:id`).
- **Cuándo NO manda** (anti-spam, honesto): 0 pedidos en el día local →
  skip (`skipped.NO_ORDERS` en el reporte del cron); demos → skip; ya
  enviado hoy → skip (dedupe). Trial SÍ recibe resumen: ver "por qué supera".
- **Cómputo puro** `api/utils/nightSummary.js`:
  `computeNightSummary(orders, { localDay, currency })` → `{ counts: {total,
  delivered, cancelled}, revenue, tips, avgTicket, topDishes (3, con qty),
  peakHour, firstOrderAt, lastOrderAt }`. Reglas: ingresos = `total` canónico
  (ya recomputado server-side en el alta), propinas APARTE (mismo criterio
  que analytics: no distorsionan el ticket), cancelados contados pero sin
  plata, cap de seguridad 500 pedidos/día por local (arriba de eso: "500+",
  el módulo puro nunca conoce el límite).
- **Fuente de datos**: query Supabase `orders` por `restaurant_id` +
  rango `[dayStartUtc, dayEndUtc)` del día LOCAL (índice existente
  `(restaurant_id, created_at)`); fallback espejo `data/orders.json`
  filtrado en JS (dual-mode, idéntico al patrón de reviewNudge).
- **Email** `sendNightSummaryEmail` en `api/services/email.js`: tabla HTML
  compacta, TODOS los campos escapados (de paso cierra el finding P2: mismo
  archivo, se agrega escapado a los interpoladores existentes), subject
  honesto `Tu cierre de hoy: N pedidos · $X`. Deep-link a Studio → Pedidos.
- **Registro**: entrada del cron en `openapi.yaml` (mismo patrón de los otros
  crons) + suite `tests/test-night-summary.js` (módulo puro: día vacío,
  borde de huso ±840, propinas aparte, cancelados, cap 500; cron: 401 sin
  secreto / 200 con secreto + dedupe doble-tick + skip sin pedidos; email:
  escaping regreso).

### Por qué supera a la competencia
- ChowNow/Flipdish encierran el reporte en su dashboard web; nosotros
  ENTREGAMOS el número donde el dueño vive (su email), sin login.
- El Z-report de un POS ($69+/mes): mismo dato, 1/7 del precio, sin hardware.
- **Palanca de conversión trial**: el resumen corre EN trial — "hoy ganaste
  $8.450 con ScanGo" es el mejor argumento para pagar que existe, y no cuesta
  nada extra (mismo email).
- Nadie del rango $7–$49 LATAM lo tiene (verificado en el radar de precios).

### Escalabilidad
1 tick/hora × pocas instancias Vercel = lectura de índice por restaurante
SOLO cuando matchea su hora local. Resend: máx 1 email/día/local, acotado
por diseño.

## 2. F2 — Vista Kitchen (KDS) v1: pantalla de cocina

Qué es: vista a pantalla completa (tablet vieja = monitor de cocina) con las
tarjetas de pedidos activos, envejecimiento por color y avance con un toque.

### Diseño (v1 = cero backend nuevo)
- **Página estática** `public/kitchen.html` servida por Vercel (mismo patrón
  que Studio: la seguridad real está en las APIs por cookie; el HTML es solo
  presentación). Cocina = tablet abierta a pantalla completa siempre → el
  HTML no necesita navegación ni SSR; la sesión la validan los endpoints con
  `requireAuth` + `tenantGuard` (espejo del Studio).
- **Data polling**: reutiliza lo que YA EXISTE — `GET
  /api/orders/restaurant/:id` (dueño) + `PATCH /api/orders/status/:orderId`
  (estados, tenant, push dirigido). El polling de 20s ya es el patrón de
  Pedidos en vivo; v1 lo reusa con UI dedicada. Cero endpoints nuevos =
  cero riesgo de contrato.
- **Módulos puros existentes reutilizados**: `orderAging.js` (⏱ 15 ámbar /
  30 rojo, ya testeado), beep WebAudio + badge NUEVO (ya en
  `loadRecentOrders`), ticket imprimible §25/§27 (ESC/POS por USB ya
  funciona).
- UI: columnas por estado (En cola → Confirmado → Preparando → Listo/En
  camino → Entregado). Una tarjeta = un pedido: número, mesa, age, ítems con
  qty, notas en rojo (alérgenos), toque = avanzar estado, cancelar con
  `showConfirmDialog` (nunca `window.confirm`).
- **v2 (post-validación)**: canal Realtime privado `realtime:kds:<id>`
  (RLS 002 ya lo permite con topics `realtime:%` + dueño autenticado) — el
  polling queda como fallback. Diseñamos hoy, implementamos después.

### Por qué supera
- Flipdish cobra el KDS aparte en su tier enterprise; ChowNow no lo tiene
  para el extremo chico. Ellos venden "sistema de cocina" como upsell de
  cientos de dólares; nosotros lo incluimos en $9.
- El KDS ya sabe ENVEJECER (cuánto esperó cada pedido) → la pregunta #1 del
  cocinero ("¿qué sale primero?") la responde el color, no el orden.

### Test
`tests/test-kitchen.js`: estructura estática (sin `on*=` = guard CSP,
labels, `role="dialog"` del cancelar) + lógica de columnas PURA
(`kitchenColumns.js`: qué pedido va a qué columna según estado — tabla de
decisión) + aging reutilizado + runtime contra server real (polling →
actualización sin recargar).

## 3. F3 — Agotados con memoria: stock diario derivado

Qué es: el dueño marca "vendo ~30 por día" → cuando hoy se vendieron 30, el
plato se pausa solo con badge "Agotado hoy" y **revive solo** mañana.

### Diseño (derivado, cero cron de reset)
- `dish.dailyStock` (número opt-in; `undefined` = sin memoria, el
  comportamiento actual queda intacto). Studio: input junto al flag manual
  de agotado.
- **Derivación en server** (módulo puro `api/utils/dailyStockTracker.js`):
  `computeSoldOutToday(dish, salesDeHoy)` → true si la qty vendida del
  plato en el día local >= dailyStock. La ventana del día local usa el MISMO
  `localDayOf` (huso capturado en F1) — la medianoche es la del dueño.
- Costo de mirar `orders` en cada vista del menú: la vista ya pasa por
  `menuCacheMiddleware` (60s) + single-flight → el agregado corre a lo sumo
  1 vez/min/local (~1440 consultas/día/local máximo, cada una con índice
  `(restaurant_id, created_at)`): costo independiente del tráfico.
- El flag MANUAL `soldOut` del dueño GANA siempre (lo auto-agotado solo
  informa). Sin manual, el server emite `dish.soldOutToday` derivado.
- Badge del menú: "Agotado hoy" reutiliza el estilo del manual (nombre
  tachado, botón "+" bloqueado, plato visible para contexto).

### Por qué supera
- Es la diferencia entre "carta" e "inventario pensante": en plena hora
  pico el dueño recibe UNA nota agrupada en su inbox (`notification_events`):
  "hoy se agotaron 3 platos". Inteligencia operativa que ningún competidor
  del rango entrega.
- mostraloweb (gratis) exige pausar a mano; Toast lo esconde en su POS.

### Test
`tests/test-daily-stock.js`: tabla de decisión (0 vendidos, stock exacto,
borde de huso, manual gana sobre auto, fallback espejo local) + payload
público con `soldOutToday` + campo documentado en `openapi.yaml`.

## 4. F4 — El QR es la demo: footer viral + atribución de altas

Qué es: menú público con footer discreto "Esta carta corre con ScanGo →
hacé la tuya en 60s", con tracking + atribución hasta el registro, y el kit
de mesa ya impreso conectado al loop.

### Diseño
- Footer del menú (oculto en demos con el flag `isDemo` existente), link a
  `/?ref=<slug>`:
  - evento público `scango_cta_click` (alta en el canal existente con su
    limiter por slug; la proyección de analytics ya es tolerante a tipos
    crudos nuevos).
  - Landing: `?ref=` se consume y viaja al registro → `restaurant.
    acquiredVia` (string limpio, máx 64, se escribe UNA vez al registro; 
    `stripPrivilegedFields` bloquea editarla después — P0 anti
    mass-assignment ya existe, solo extenderlo).
  - `/admin` overview: `GROUP BY acquiredVia` → "de qué carta vino cada
    dueño nuevo". Medir = decidir: un menú que trae 3 dueños es un partner
    a invitar al programa de referidos de la estrategia.
- **Kit de mesa ya construido** (`printTableStand`/
  `downloadAllTablesPDF`/`printReviewTent` existen en Studio): sólo
  AGREGAMOS al stand imprimido la línea `Esta carta corre con ScanGo ·
  <app_url>` bajo el QR (const exportable). Cero feature dev: es copy.

### Por qué supera
- El "hecho con X" de la competencia es adorno. Nuestro loop es el único
  del sector que mide conversión carta→dueño por local: transforma cada
  mesa en canal de venta y cada dueño en afiliado (coherente con el plan de
  CAC ≤$30).

### Test
`tests/test-viral-footer.js`: footer en DOM (no-demo, sin `on*=`), evento
permitido en el canal público, E2E de atribución (`?ref=` → registro →
`acquiredVia` persiste → `/admin` lo agrupa) + assert de que `/save` NO
puede escribir `acquiredVia` (regresión anti mass-assignment).

## 5. Orden de ejecución con commits

| Serie | Commit | Alcance | Suite nueva |
|---|---|---|---|
| 1 | `feat: el cierre` | F1 completo + P1 retención `notification_events` + P2 escape emails (mismo dominio) | `test-night-summary` |
| 2 | `feat: vista kitchen kds` | F2 v1 (polling) | `test-kitchen` |
| 3 | `feat: agotados con memoria` | F3 | `test-daily-stock` |
| 4 | `feat: footer viral + atribucion` | F4 + línea en kit impreso | `test-viral-footer` |

Cada serie puede incluir: suite nueva + `openapi.yaml` (si toca endpoints o
crons) + `AGENTS.md` (fila + propia) + `npm run check` verde + push
inmediato. NO mezclar series: cada una es revertible por separado.

## 6. Riesgos conocidos y cómo los neutraliza el diseño

| Riesgo | Neutralización |
|---|---|
| Costo Resend por email local/día | 1 email/día/local MÁXIMO; skip si 0 pedidos |
| Huso vacío en locales viejos | default `-180` (UY/AR) documentado; la fuente es la del heatmap |
| Cron horario doble-tick (retry Vercel) | dedupe por `notification_events` (patrón probado de R2) |
| Crecimiento del listado de pedidos en JS | cap 500/día + módulo recibe lista: swap a SQL GROUP BY sin tocar tests |
| Tablets viejas en cocina | KDS v1 sin imágenes: solo texto, dígitos y colores del tema |
| Obsesión por realtime | v2 diseñado (canal privado), no bloquea v1 |
| Spam de notificaciones "agotados" | 1 resumen agrupado por día por local |

## 7. Decisiones que hago al ejecutar (a revisar)

- La dependencia real entre features: F2/F3 usan el huso capturado en F1
  (sin F1 no hay frontera de día local). Por eso F1 primero — su captura de
  `utcOffsetMinutes` es infra común.
- Trials: "El Cierre" corre en trial (muestra valor, empuja el pago). Si
  resulta caro a escala se mira cuando existan 100 locales, no antes.
- El Z-report no envía push (no debe despertar a nadie): email only.
