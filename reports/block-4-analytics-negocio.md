# Block 4 — Analytics de Negocio en Studio (ticket promedio, top platos, export CSV)

> **Entregado:** 07/10/2026 · **Suite:** `npm test` 20/20 ✅ (antes 19) · **Cero mocks, 100% real.**

## Objetivo

Cerrar el loop del **Mozo Virtual** (Block 2): la herramienta que sube el ticket promedio no
tenía forma de **medir** si el ticket efectivamente sube. El dashboard de Analíticas de Studio
ya existía (KPIs de volumen, gráfico diario, heatmap, sucursales, eventos), pero le faltaba la
dimensión **financiera** y el detalle operativo que le importa al dueño:

- **No había ticket promedio ni ingresos** → los eventos de pedido nunca registraban el monto.
- **Top Platos mostraba IDs crudos** (`d_1`, `d_2`) en vez de nombres.
- **No había export** de las métricas para trabajar fuera de la plataforma.
- El fuerte del proyecto (telemetría rica con `dish_id`/`branch_id`/`metadata`) estaba
  **desconectado del menú público**: `menu.js` solo emitía 4 contadores legacy vía slug.

## Diagnóstico inicial

Había **dos sistemas de analítica paralelos** e incomunicados:

1. **Legacy**: `POST /api/public/analytics/event` `{slug, event}` → contadores en
   `restaurant.analytics` (visits/orders/reservations/waiterCalls). Lo único que emitía el menú.
2. **Telemetría moderna** (`api/services/telemetry.js` + `api/routes/analytics.js`): eventos con
   `dish_id`, `branch_id`, `metadata_json` → KPIs, gráficos, heatmap, sucursales. **Hueco
   fatal**: el dashboard decía "Top Platos d_1 (12)" porque los eventos de `dish_click` no
   existían en producción, y ningún pedido llevaba `amount`.

Bonus de auditoría: **bug latente pre-existente** — `api/index.js` usaba `telemetryService` en
las rutas de eventos (llamado de mozo / padre) **sin nunca importarlo** → cualquier llamada a
mozo en modo evento reventaba con `ReferenceError`. Nunca se había disparado en tests. Se
arregló con el `require` faltante (gracias al 500 que expuso el test nuevo).

## Entregables

### 1. Canal público unificado — `api/index.js`
`POST /api/public/analytics/event` acepta ahora `dish_click` y `order_placed` (además de los 4
legacy) con campos opcionales `dishId`, `branchId`, `amount`, y graba **en ambos sistemas**:
contadores legacy (`restaurant.analytics`) + telemetría rica. Saneamiento defensivo: cadenas
limitadas a 80 chars, `amount` numérico acotado a `[0, 1e9]` (NaN/negativo/inyección → se
descarta), whitelist estricta de eventos, rate-limit público intacto.

### 2. Métricas financieras — `api/services/telemetry.js`
- `getWeeklyAggregatedMetrics`: + `revenue` (suma de `metadata_json.amount` en pedidos) y
  `avgTicket` (= revenue / pedidos).
- `getBranchMetrics`: + `revenue` y `avgTicket` **por sucursal** (se agrupa por `branch_id`,
  `'main'` si no viene), que es lo que permite comparar locales y detectar cuál arrastra el
  ticket.

### 3. Nombres reales de platos — `api/routes/analytics.js`
Las agregaciones solo conocen `dish_id`; helper `attachDishNames()` resuelve el nombre contra
`restaurant.dishes[]` en `weekly` y en cada sucursal de `branches` (con fallback al ID).

### 4. Emisión rica desde el menú público — `public/js/menu.js`
Nuevo helper `trackPublicEvent(event, extra)` (fire-and-forget, incluye `branchId` detectado de
`?branch=` / `?sucursal=`):
- `addToCart()` → `dish_click` con `dishId` (la señal más fuerte de interés).
- Checkout exitoso → `order_placed` con `amount` (el total final, post-cupón/envío).
- Llamado al mozo → `waiter` por el mismo canal (ahora con `branchId`).

### 5. Dashboard de Studio — `public/studio.html` + `public/js/studio/analytics.js`
- **2 KPIs nuevos**: `💵 Ticket Promedio (7d)` (`avgTicket`) y `💰 Ingresos (est. 7d)`
  (`revenue`).
- **Sección 🏆 Top Platos**: tabla #/medalla, nombre real y clicks (Top 5).
- **Tabla de sucursales**: + columnas `💰 Ingresos` y `💵 Ticket` (y nombres de platos en vez
  de IDs).
- **Botón ⬇️ Exportar CSV**: descarga las métricas diarias del rango/filtros seleccionados con
  BOM UTF-8 (acentos OK en Excel).

### 6. Utilidad CSV pura — `public/js/utils/csvExport.js`
`buildDailyCsv()` 100% pura (sin DOM): headers, una fila por día, escaping RFC 4180
(comas/comillas/`;`/saltos), testeable en Node vía `import()`. `downloadCsv()` (solo navegador)
agrega el BOM. Es el **nuevo archivo nº 59** que valida el test de sintaxis ESM.

### 7. Test nuevo — `tests/test-analytics-business.js` (suite nº 20)
Flujos reales HTTP + DB, patrón de `test-security-endpoints.js`:
- **Parte A (puro)**: `buildDailyCsv` — headers, filas, escaping RFC 4180 (entrecomillado de
  comas y duplicación de comillas `""`).
- **Parte B (HTTP real)**: emite `visit x2`, `dish_click d_1 x2 + d_2 x1`, `order_placed 490`
  y `order_placed 190` (este con `branchId`) por el canal público → verifica:
  - `weekly`: orders=2, **revenue=680, avgTicket=340**, conversion=100%, top `d_1` con nombre
    `Burger QA` resuelto desde la carta.
  - `branches`: `main` 490/490 y `br_1_summer` 190/190.
  - `daily`: último día orders=2, revenue=680.
  - `legacy`: `restaurant.analytics` sincronizado (visits=2, orders=2).
  - `IDOR`: tenant ajeno → 403; evento fuera de whitelist → 400.

## Verificación en vivo

| Verificación | Resultado |
|---|---|
| `node tests/test-analytics-business.js` | ✅ 100% (7 sub-checks) |
| `npm test` (suite completa) | ✅ **20/20** — todas las suites verdes |
| Sintaxis ESM (`test-frontend-esm-syntax`) | ✅ 59 archivos parsean |
| Estructura HTML (`test-frontend-structure`) | ✅ `studio.html` divs balanceados, 13 modales a nivel body |
| `data/*.json` | ✅ revertidos a HEAD (los tests los mutan; no se commitean) |

## Estado del proyecto Depósito / Próximos bloques

- **Dato clave de diseño**: `mean` los eventos viven en `localTelemetryEvents` (memoria del
  proceso) hasta que se aplique la migración del Block 3 (`telemetry_events` en Supabase).
  Con la migración aplicada, el dashboard pasa a histórico real cloud sin tocar código.
- Con esto el loop Mozo queda cerrado: **recomendación → click → pedido → ticket → comparativa
  por sucursal → CSV**. 

Candidatos de continuación (para decidir): panel `/admin` maestro (MRR, churn, conversión
trial→pago), push notifications nativas (Capacitor), i18n multi-idioma, o cierre de deuda
técnica (tests aislados, archivos muertos, unificar doble analytics legacy/moderna ahora que
ya comparten canal).