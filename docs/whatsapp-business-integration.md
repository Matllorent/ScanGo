# Integración WhatsApp Business — Arquitectura (oct-2026)

> Investigación con fuentes primarias (Meta Developers, changelog Cloud API, BSP rate cards).
> Estados de precios al **1 oct 2026** — re-verificar la rate card CSV antes de mover plata.

## 0. Principio

**wa.me / click-to-chat sigue siendo el default** (tier gratis, cero aprobación, cero fricción por
restaurante). La integración Cloud API es un **tier opt-in** que se activa por restaurante cuando el
dueño quiere automatizar — nunca reemplaza al link, lo extiende.

## 1. Estado del mercado (lo que un plan pre-2026 haría mal)

| Cambio | Impacto para ScanGo |
|---|---|
| Facturación por CONVERSACIÓN murió el 1 jul 2025 → por mensaje + volume tiers (utility/auth) | Cualquier doc que diga "USD/24h de ventana" está desactualizado |
| **1 oct 2026: mensajes de servicio dejan de ser gratis** (1.000 gratis/número/mes, luego tarifa de servicio) | Las respuestas libres dentro de la ventana 24h se cobran; hay cuello de costo en el soporte por chat |
| Utility templates DENTRO de la ventana también se cobran desde 1 oct 2026 | Confirmaciones de pedido ya no cuestan $0 ni adentro de la ventana |
| Free Entry Point: chats de Click-to-WhatsApp **ads** ahora 7 días gratuitos (antes 72h) | Los CTWA ads suben en el ranking de canales de captación |
| Pagos nativos en chat: solo India/Brazil (+piloto Singapur). **No hay pagos nativos en UY/AR** | MercadoPago sigue siendo el riel de dinero; WhatsApp es confirmación/notificación |
| On-Premises API muerta (23 oct 2025) | Solo Cloud API |
| `catalog` templates no disponibles en India (irrelevante p/ UY-AR) | OK |
| Embedded Signup **v2 obsoleta 15 oct 2026 → v4** / alternativa Hosted ES | El onboarding de sub-merchant debe apuntar a v4/Hosted |

## 2. Opciones prácticas para un SaaS chico

### (a) Link-first (hoy, $0)
- `wa.me/<E164>?text=` sin cap documentado; mantener el resumen del pedido < ~350 chars pre-encoded.
- Sin delivery/read receipts, sin callbacks, sin attachments: fire-and-forget.

### (b) Cloud API directo con Tech Provider + Embedded Signup v4 (recomendado)
- ScanGo hace Business Verification + App Review (`whatsapp_business_management|messaging`) + Access Verification → Embedded Signup sube su cap de 10 a **200 altas/7 días**.
- Cada restaurante agrega SU propia forma de pago en Meta Billing Hub → **Meta cobra al restaurante, no a ScanGo**.
- Coexistence: el número de WhatsApp Business App del dueño puede seguir recibiendo chats 1:1 personales (~20 msg/s cap; mensajes desde la WBA-app gratis, los de Cloud API facturados).
- Esfuerzo real: router `/api/whatsapp/*` (webhook receiver + sender + credenciales WABA por tenant en `restaurant.waba`) — sin tocar el modelo de dinero.

### (c) Broker/ISV (360dialog / Twilio)
- 360dialog: licencia plana ~€49/número/mes, sin markup por mensaje (bueno para white-label).
- Twilio: +$0.005/msg.
- Con volúmenes <5.000 msgs/mes, Tech Provider directo sale más barato (Meta cobra al merchant).

## 3. Dónde cae cada pieza en ScanGo

| Pieza WhatsApp | Origen ScanGo |
|---|---|
| Catálogo (SKUs, precios, fotos) | `restaurant.categories[]`/`dishes[]` — export único hacia Meta Commerce API |
| Carrito del comensal en WhatsApp | `type:"order"` webhook (`order.product_items[]{product_retailer_id,quantity,price}`) → mapear a `POST /api/orders` |
| Confirmación de pedido | interactive **`order_status`** (`review_order`, estados pending→completed/canceled) espejo de `PATCH /api/orders/status/:orderId` |
| Historia de estados al comensal | `statuses[]` (sent/delivered/read/failed) — reemplaza el humo del "y llegó por WhatsApp?" |
| Recupero de carrito abandonado | Marketing template OPT-IN (usa `consentMarketing` ya existente en fidelización) |
| Opt-out | `type:"system"` webhook → hard opt-out en el perfil del cliente |
| Calidad del número | `account_update` → `PHONE_NUMBER_QUALITY_UPDATE` — bloquear sender mal antes dañar red |

## 4. Fases

1. **Fase 0 (hoy)** — wa.me stays; docs sincronizadas (`/cookies`, Términos §2b WhatsApp).
2. **Fase 1 — env con credenciales propias (1 tenant demo)**: router webhook HMAC `X-Hub-Signature-256`, sink `type:"order"` → alta de pedido real vía la lógica existente, y `order_status` espejo. Sin App Review (número propio).
3. **Fase 2 — opt-in por restaurante**: catalog export (deshidratado del menú) + commerce settings + templates utility/marketing con aprobación por template (min-horas).
4. **Fase 3 — Tech Provider + Embedded Signup v4** (requiere 2–5 semanas de verificaciones meta; planear 3 semanas de App Review realista en 2026).

## 5. Costos por mercado (post-oct-2026, USD, aprox — confirmar CSV Meta)

| Mercado | Marketing | Utility/Auth | Servicio (>1k/mes) |
|---|---|---|---|
| Argentina | ~$0.09 | ~$0.04 | ~$0.04 |
| Uruguay (Rest of LATAM) | ~$0.10 | ~$0.03 | ~$0.03 |
| Brasil (ref.) | ~$0.06–0.09 | ~$0.01–0.02 | ~$0.02 |
