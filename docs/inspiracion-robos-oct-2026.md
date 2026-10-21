# Inspiración externa — ronda 2: features robables (oct-2026)

> Segundo barrido de inspiración después del plan `docs/plan-ejecucion-bloque-
> sistema-oct-2026.md` (F1–F4 ya definidos: El Cierre, KDS, agotados, footer
> viral). Esta ronda mira a los líderes mundiales del rubro (me&u/Mr Yum,
> Toast, Square, OpenTable/Zenchef) y a los repos OSS de KDS, y extrae lo que
> podemos adaptar con nuestra infra. Todo mapeado a features F5–F8 para la
> cola posterior a F4.

## Regla de oro (revisada en los 4 frentes)

Los líderes cobran caro por features que nosotros ya tenemos o podemos tener
derivando data propia. Toast IQ Grow cuesta $699/mes por "agentes de
marketing basados en data histórica" — nuestra R1 (churn) + R2 (reseñas) ya
son equivalentes reales con menos humo. La misión de esta ronda: quitarles el
humo y quedarnos con los patrones que generan valor medible.

## F5 — Tendencia honesta (robo de me&u/Mr Yum "Trending Items")

**Lo que hacen**: me&u destaca "See what's hot right now" — platos en
tendencia. Es una de sus 3 features de cabecera junto a "For You" (IA).

**Lo que tenemos**: `computePopTiers` (suite 52) YA deriva popularidad real
(`dish_click` + qty de pedidos, 90d de ventana) y el layout
`sizing=popularity` ya ENGRANDECE los top. Solo falta la voz: el chip
explícito en el plato.

**El diseño con el invariante intacto**: el payload público NUNCA expone
scores ni conteos (decisión previa, con guard de test). El server calcula la
ETIQUETA resuelta — `dish.trendingLabel: "🔥 Muy pedido esta semana"` — a
partir del tier 2 recomputado con ventana semanal. Sin query nueva en v1
(el agregado de tiers ya corre). El comensal ve el chip; el dueño lo
activa/apaga con un toggle (default ON). Cero PII, cero conteos crudos hacia
afuera.

**Esfuerzo**: MUY BAJO (el motor existe: un campo derivado + chip CSS + toggle).
**Superación del original**: me&u sin data no hace nada; nuestro módulo ya
tiene proxy del chef cuando falta data — la tendencia honesta funciona desde
el día 1 de cada local.

## F6 — Estación de cocina (robo de URY Mosaic / velox-pos, KDS OSS)

**Lo que hacen**: los KDS enterprise (cientos de dólares/mes) enrutan cada
ticket a una PANTALLA por estación (barra / cocina / fríos). El OSS
`URY Mosaic` (routing multi-cocina) y `velox-pos` (station routing) son la
referencia del patrón.

**Nuestro ángulo superior**: un local chico NO necesita 3 tablets — necesita
FILTRAR la misma pantalla. `dish.station` (string libre, máx 16, default
vacío) + chips de filtro en el KDS (`Todos · Barra · Cocina · Fríos`,
recordado por device). La infra exacta existe: el `dishEditor` ya hace
edición masiva por KEYWORD (mismo flujo que "marcar agotados los platos con
esta palabra") — el campo estación reutiliza ese patrón de CRUD.

**Esfuerzo**: BAJO (un campo + chip de filtro + tabla de decisión testeada).
Va dentro del commit de la serie 2 (KDS): es su acompañante natural.
**Superación del original**: Mosaic exige instalar un ERP entero; nuestro
filtro corre en la tablet que ya muestra el KDS v1, sin deploy extra.

## F7 — Estimación honesta de preparación (nadie del rango la tiene)

**El patrón**: decir al comensal "tu pedido estará listo en ~12 min" —
derivada de la data REAL de cocina (deltas `created_at → status_updated_at`
de pedidos entregados, últimos 7 días, mediana p50 y p90 por local). Las
columnas ya existen (`orders.status_updated_at` migración 004) y el badge
⏱ del Studio ya mide antigüedad — este feature es su espejo para el comensal.

**Reglas honestas (nunca miente)**:
- ≥ 20 pedidos en los últimos 7 días → estimación (`~12–18 min`, p50–p90).
- Sin data suficiente → `null` y el menú OMITE el chip (mismo criterio que
  el JSON-LD de horarios: omite, nunca inventa).
- Informativo y complementario: el estado REAL sigue llegando por tracking
  (token + push) — la estimación no reemplaza al tracking.
- Módulo puro `api/utils/prepEstimate.js` (calcula desde una lista de
  pedidos; el router trae las filas) — cero lógica duplicada client-side.

**Superación**: ChowNow muestra SLA inventado o nada; Toast lo esconde en su
POS. Con esto, ScanGo es la única carta del rango donde el comensal deja de
preguntar "¿cuánto falta?" — y cada pregunta que no se hace es un mozo menos
interrumpido en hora pico.

**Esfuerzo**: BAJO-MEDIO (una query de deltas + módulo puro + 2 chips de UI:
checkout y tracking).

## F8 — Cupón de recupero (el "Offers Agent" de Toast, sin humo)

**Lo que hace Toast ($699/mes)**: su Offers Agent crea promos por objetivo
("ganar de vuelta a clientes pasados") con data histórica. Nuestra R1 ya
produce la LISTA de riesgo (45d / 2 visitas) — falta el golpe concreto: el
CUPÓN.

**El diseño**: en el bloque "⏰ Clientes en riesgo" del Studio, el ✉️
Recuperar gana una variante con descuento:
- El dueño elige 10% / 15% / "envío gratis" y se genera un cupón REUSANDO el
  motor de cupones que YA FUNCIONA (`resolveCouponDiscount` con tests de
  propiedades + validación contra catálogo en el checkout blindado). Solo hay
  que persistir un catálogo de cupones por local (tabla nueva chiquita o JSON
  del restaurante).
- El envío viaja por el MISMO composer R1 (consentimiento + opt-out 409
  honestos + audit `REACTIVATION_SENT`).
- Caducidad fija 14 días (sin configurar: anti-abuso) y un solo uso por
  teléfono E.164 (la identidad de fidelización ya es esa PK — el mismo
  guard de canje unico sirve).

**Por qué es el paso siguiente lógico**: convierte R1 de "email recordatorio"
a "la oferta que hace volver" — sin inventar un motor de descuentos que ya
existe, probado y blindado.

**Esfuerzo**: MEDIO (catálogo de cupones + variante del composer + conteo de
uso). Va después de las 4 del plan: merece su bloque propio cuando el dueño
ya confía en la lista de riesgo.

## Otros patrones observados (decisiones de NO hacer — y por qué)

- **Google Maps agentic ordering (Ask Maps, con Square/Toast)**: pedidos
  conversacionales desde Maps. Nuestra carta ya es minable (JSON-LD +
  llms.txt) — cuando esto cruce la frontera a LATAM, la ingesta nos
  beneficia sin trabajar. No invertir ahora: Maps hace Google; nosotros
  hacemos el contenido, y el contenido ya está listo.
- **Square voice ordering**: bot de teléfono con IA. Cero relación con QR;
  hardware y regulación de cada país.
- **me&u "For You" (IA personalizada)**: nuestra versión pragmática es
  `Pedir de nuevo` (ya en backlog #5) + chip de tendencia (F5) — dos
  píldoras concretas sin humo de IA.
- **OpenTable deposits**: cut no-shows un 57% en promedio (su data, citada).
  Es el dogma del roadmap de RESERVAS: v1 con recordatorio 24h + aviso
  WhatsApp (gratis), y el depósito vía MP queda para fase 3 con su decisión
  legal de reembolsos (ver `reembolsos-runbook.md`).
- **OpenTable "gold status"**: tiering cross-restaurant — nuestra
  fidelización global (Bronce→Platino) ya cubre la idea. No duplicar.

## Repos útiles del round

- `ury-erp/mosaic` — KDS/KOT multi-cocina: patrones de routing por estación.
- `hafizhasyari/velox-pos` — POS+KDS (React): station routing por ítem.
- `pavanvattikala/FoodEase` — KOT realtime (Pusher): nuestro Realtime con
  guard RLS ya es superior en seguridad.
- `ishandutta2007/Awesome-Kitchen-Display-System` — meta-lista (32 repos):
  los 3 workflows vitales del dominio son **bump**, **completado por ítem**
  y **routing por estación**; los dos primeros ya están en el plan de F2.
- **topfood.app** (EU) — free tier con "AI menu import" como espada: mismo
  hueco de mercado; benchmark directo, no copiable por idioma.

## Cola actualizada (post F4)

| Orden | Feature | Origen | Esfuerzo |
|---|---|---|---|
| F5 | Tendencia honesta (chip) | me&u Trending | MUY BAJO |
| F6 | Estaciones de cocina (chips KDS) | URY Mosaic | BAJO (va con la serie 2) |
| F7 | Estimación honesta de preparación | propio (data real) | BAJO-MEDIO |
| F8 | Cupón de recupero | Toast Offers | MEDIO |
