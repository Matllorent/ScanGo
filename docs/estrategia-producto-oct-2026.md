# Estrategia de Producto — Sector Restaurantes (oct-2026, revisión externa)

> Investigación de mercado + recursos + backlog priorizado. Nada de esto está
> implementado todavía: es el mapa para elegir próximos bloques.
> Complementa `docs/competitor-fornno.md` (Fornno UY) y `docs/kds-reservas-roadmap.md`.

## 1. Radar de competencia 2026 (con precios reales)

| Competidor | Modelo | Precio | Qué hace bien | Brecha con ScanGo |
|---|---|---|---|---|
| **ChowNow** (US) | Pedidos directos sin comisión | **$229/mes** + 2.95%+29¢ por transacción | Dato del cliente propio, app propia, marketing | 25× más caro, no LATAM, integra POS |
| **Flipdish** (EU) | Pedidos + app + pantallas | **desde €99/mes** | Multi-sucursal, apps nativas | 11× más caro, onboarding comercial |
| **MenuSifu / Toast / Square** | POS completo | $69–$165+/mes + fees | Todo el restaurante (caja, inventario, nómina) | Peso completo: requiere hardware y meses |
| **Menujo** | Menú + display | $0 / **$7** / **$12** | Precio más bajo del mercado, freemium | En precio como ScanGo; ellos son display-only, nosotros pedimos + WhatsApp |
| **Livedigitalmenus** | Menú + órdenes | $0 (20 ítems) → **$49/mo** | Setup llave-en-mano $299 | 5× ScanGo; ventana clara en el rango $9 |
| **MenuHoster / TableQR / ClickyMenu** | Menú por QR | $0–$89/mo | Content marketing sólido | Nos ganan SEO en inglés; no están en UY/AR |
| **Tixy QRmenu** (Suramérica) | QR + reservas + multi-idioma | n/d | LATAM, 10+ idiomas | Competidor regional directo a vigilar |
| **menus.uy** (UY) | Menú QR local | n/d | "Actualizá precios fácil, hosting incluido" | Sin pedidos desde la mesa aparente |
| **mostraloweb** (UY) | Carta digital | "gratis" + servicios | Pausa platos agotados, pedidos mesa/delivery | Local, light |
| **dobled.com.uy** (UY) | Menú digital + pantallas | Por proyecto | El MENÚ en pantalla física + QR | Apunta a cartelería física; complemento |
| **Fornno** (UY) | Sistema de crecimiento (6 módulos) | Sin precios públicos / cotización | Retención, agencia IA 24/7, data platform | Mercado arriba; ver `competitor-fornno.md` |

### Dónde está el hueco (el posicionamiento)
- **Rango $7–$49**: nadie LOCAL (UY/AR) se para ahí con **pedidos reales** + WhatsApp + fidelización. Los baratos son solo-mostrar-carta; los completos cuestan $99–$229.
- El dueño uruguayo pequeño paga hoy ~$100 único por una carta web estática (y sin pedidos). "QR + pedidos por WhatsApp en $9/mes" ES el hueco.
- **Riesgo de entrada**: PedidosYa (30%+ de comisión — el enemigo común que refuerza nuestro "0% comisión") y un futuro pivot de WhatsApp Business, pero ninguno es self-service.

## 2. Comparativa de precios — cómo posicionar el nuestro

- Mantener **Starter $9/mes → $79/año** (2 meses gratis) y **$12 event_once**. NO bajar: el ARR por dueño es lo que paga el hosting (Supabase + Vercel + email) con margen.
- Propuesta (aún no decidida): **plan "Crece" ~$19/mes** que agrupe las features de retención (fidelización + churn + reservas + KDS). El dato de CAC dice que un dueño mid-market paga $150–$250 cuando ve el retorno; es el puente para quien hoy mira Fornno y no puede entrar. **Condición**: crearla recién cuando el bundle tenga 2+ features de retención terminadas (KDS + Reservas).
- Tabla para la landing: compararnos sin miedo — "ScanGo $9 fijo" vs "app de pedidos $229/mes" vs "delivery con 20–30% de comisión".

## 3. Cómo conseguir clientes — canales por CAC (datos 2026)

Datum clave (benchmark SaaS SMB 2026): CAC de partner/referral ≈ **$150** e inbound ≈ **$200**, vs outbound $400 y eventos $500. Con LTV ~$108/año (dueño a $9/mes), el CAC objetivo es **≤ $30**: eso descarta outbound y eventos pagos. El plan:

1. **El QR es la demo (bucle viral por mesa)**: cada mesa con QR = demo siempre encendida. Agregar al menú público un footer discreto "Esta carta corre con ScanGo → hacé la tuya en 60s" (con tracking por slug para medir conversión por local). Costo 0, CAC ~$0.
2. **Referidos entre dueños (P2P): 1 mes gratis por referir** — los benchmarks muestran CAC 20–40% más bajo. Alta fricción natural en el rubro (los dueños se conocen en ferias gastronómicas).
3. **Partner/reseller: agencias de marketing locales** (Montevideo ya vende "servicio digital $200/mes" a restaurantes): véndeles el motor a $9 y déjalos revender a $50. Revenue share sin CAC propio. Empezar con 3 outreach manuales, no SPAM.
4. **SEO programático por ciudad** (el motor de `/soluciones` ya existe; clonar por ciudad: "carta digital y pedidos por WhatsApp en Montevideo / Punta del Este / Canelones…") — costo = tiempo de copy.
5. **Word-of-mouth + prueba social**: pedir a los primeros 5 clientes un video de 30s de su flujo de pedidos reales → reels orgánicos + hero de la landing.
6. **Kit de alta físico**: al activar, imprimir QR + carpa de reseña + sticker de mesa y enviárselo (costo ~$2-3). Reduce el churn del mes 1: el dueño ve el producto EN SU MESA, no en su laptop. El churn SMB (3–7%/mes) es el killer del LTV; esto lo ataca de frente.
7. **NO hacer**: Meta Ads ni LinkedIn con este LTV (el CAC objetivo lo prohíbe), ni giveaways sin mecanismo de retención detrás.

## 4. Backlog de producto priorizado (sector restaurante)

Orden por impacto/esfuerzo. Todo apalancado en infra existente.

| # | Feature | Por qué | Esfuerzo |
|---|---|---|---|
| 1 | **Vista Kitchen KDS v1** | Blueprint listo (polling + estados + aging ya existen); es lo que separa "carta" de "sistema" | medio (roadmap listo) |
| 2 | **Reservas con recordatorio 24h** | −30/50% no-shows (patrón Fornno); email + push ya cableados | medio |
| 3 | **Resumen nocturno de caja (Z-report por email 03:00)** | El dueño cuenta la plata al otro día; es la feature #1 pedida en entrevistas de POS | BAJO (cron + template email + orders del día) |
| 4 | **Agotados con memoria**: N ventas hoy → auto-pausa + badge, reactiva al día siguiente | Evita comensal decepcionado + trabajo manual del dueño | BAJO-MEDIO (telemetry + flag + cron reset) |
| 5 | ✅ **"Pedir de nuevo"** (HECHO oct-2026, 66ª suite): botón 🔁 para repetir el último pedido del comensal (localStorage propio, plan reconciliado contra la carta actual) | 1 tap reordena → ticket sube; rebill ~60% | BAJO |
| 6 | ✅ **Happy Hour visible** (HECHO oct-2026, 66ª suite): el kicker `schedule.timeStart/timeEnd` ya NO está latente — visible en TODOS los temas (slots por `dish-has-schedule` en moderna/basketball/ticker/sticker; el Studio ya editaba el horario por plato) | "Pedido en franja horaria" sube conversión | BAJO (hacer brillar la feature latente) |
| 7 | ✅ **Segmento "vinieron UNA vez y no volvieron"** (HECHO oct-2026, 66ª suite): R1 con `minVisits=1` — clamp [1,10] + selector de visitas en Studio (el composer de segundo mensaje quedó para fase 2) | El churn list hoy exige 2 visitas; el cliente de una sola visita es el más barato de reactivar | MUY BAJO (param + composer) |
| 8 | **Nudge de instalación PWA para el dueño** (studio ya es instalable, sin nudge) | Recordatorio de uso diario ↑ | MUY BAJO |
| 9 | ✅ **Reserva→recordatorio por WhatsApp** (HECHO oct-2026, 65ª suite): el dueño avisa/recorda desde SU agenda con un link `wa.me` prefilled por estado (patrón F8-v2; el cron que envíe WhatsApp directo = Cloud API, diferido) | El consumidor ya lo acepta | post #2 |
| 10 | **Wallet pass de fidelidad (R4 Fornno)** | Retención alta, pero Apple exige certificación $99/año | ALTO — diferir |

### Features que NO hacer (descartes conscientes)
- POS completo / nómina / inventario de cocina (dominado por Toast/Clover; meses de integración).
- App de delivery propia (el dueño hace la venta, no el delivery).
- CRM genérico — pegarse al flujo del menú, no hacer otro producto.

## 5. Herramientas GitHub seguras + recursos para subir el nivel

### Ya en el stack (auditoría continua estándar)
- **semgrep** (0 hallazgos) + **osv-scanner v2.6.0** + **gitleaks** en CI + **stryker** (mutation, opt-in) + **Playwright** (a11y en navegador real) + **@point-of-sale/receipt-printer-encoder** (MIT).

### Repos para estudiar (patrones, no copy-paste; revisar licencia)
- `satisfecho/pos` (AGPLv3 — self-hosted, multi-tenant, KDS/payments): estudiar estructura de su KDS y reservas; **NO copiar código** (AGPL infecta).
- `next-orders/food` (self-hosted delivery web): patrón food-schema limpio.
- `lineweb-restaurant-orders` (WordPress, libre): benchmark del sub-sector WP, que es el público objetivo real.
- `qr-code-ordering-system` (topic de GitHub): termómetro de features que la gente pide en OSS.

### Librerías seguras a incorporar cuando toque
- `qrcode` (npm, MIT) — server-side para carpa/stickers impresos del kit de alta (#6).
- `date-fns` solo si la lógica de horarios (ya con helpers propios testeados) se complica.

### Lecturas/videos recomendados (concretos, no relleno)
- **The Mom Test — Rob Fitzpatrick** (libro): cómo investigar sin preguntas sesgadas; aplicar a las próximas 10 entrevistas de locales.
- **Crossing the Chasm — Geoffrey Moore**: por qué el beachhead "locales chicos" es correcto y por qué las features de "sistema" (KDS, reservas) son las que cruzan el déficit.
- **Monetizing Innovation — Sawhney**: cómo empacar el $19 "Crece" sin matar el $9.
- Video: **Patrick Campbell (Paddle) — SaaS pricing teardown** (gratis en YouTube): framework para leer el valor-métrica de la competencia al mostrar precios.
- OWASP Cheat Sheets: **Input Validation**, **Rate Limiting**, **Abuse Case** (owasp.org, gratis) — guías del doc de auditoría abuse.
- **SaaS Churn Benchmark** (CRV/openvc): churn SMB 3–7%/mo → nuestra batalla real es el churn de mes 1–3 (kit físico + resumen nocturno lo atacan).

## 6. Orden sugerido del próximo bloque

1. **Resumen nocturno de caja** (X-small: cron + template + orders del día) → "wow diario", ataca el churn del mes 1.
2. **Vista Kitchen KDS v1** (roadmap listo) → sube el valor percibido de $9 a $19 (gate del plan Crece).
3. **Agotados con memoria** (small) → autonomía del dueño.
4. **Footer viral del QR + kit impreso** (small) → canal de adquisición perpetuo.
5. Plan $19 "Crece" DESPUÉS: cuando KDS + Reservas estén, el bundle se vende solo.
6. Cola F5–F8 (post F4, ver `docs/inspiracion-robos-oct-2026.md`): tendencia honesta (chip de me&u sobre nuestro popTier), estaciones de cocina (chips del KDS), estimación honesta de preparación (data real de `status_updated_at`) y cupón de recupero (R1 + motor de cupones existente).
