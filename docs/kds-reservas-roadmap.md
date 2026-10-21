# KDS + Reservas — Roadmap de producto (oct-2026)

Objetivo: que el dueño/percepción de "tengo cocina digital" sea mejor que la competencia tipo Mercado
Delivery POS Lite, SIN romper el monolito ni duplicar estados.

## 1. Lo que YA existe (cero costo)

- `Pedidos en vivo` nota polling 20s + estados `pending|confirmed|preparing|ready|on_the_way|delayed|delivered|cancelled` vía `PATCH /api/orders/status/:orderId` (audit `ORDER_STATUS_CHANGE`).
- Antigüedad en cocina: `orderAging.js` (chip ⏱, 15/30 min) + ticker 30s atado al polling.
- Ticket de cocina: 🖨️ (80mm PDF) + ⚡ USB ESC/POS térmica directa.
- Push realtime al dueño + tracking del comensal constepper + `?track=<token>`.
-(of) Propina y pago online ya blindados en `enforceOrderBusinessRules`.

## 2. KDS v1 ("Vista Kitchen" en Notificaciones)

- Toggle `Vista Kitchen` dentro de `Pedidos en vivo`: filtra `confirmed+preparing` Y `ready+on_the_way`
 en 2 columnas de tarjetas GRANDES (número pedido, mesa, ítems con modificadores, antigüedad grande,
 propina).
- Estado visible por SLO: cuántos pedidos con >15 min.
- **Sin contrato nuevo**: reusa `GET /api/orders?restaurantId=` y el mismo polling.
- Cero `on*=` y cero `innerHTML` con data (escape). A11y: `tablist` para cambiar columnas, skip-link intacto.

## 3. KDS v2

- Auto-vocación: audio WebAudio cuando entra pedido nuevo (ya hay beep opcional `scango_order_sound`).
- `KDS display mode`: pantalla completa sin nav (Studio ?kds=1) para dejar la tablet dedicada.
- Mutación de estado `preparing→ready` con un toque en la tarjeta grande (reuse `setOrderStatus` con confirm en window toasted).

## 4. Reservas (hoy es solo un chip WhatsApp)

Estados mínimos de una reserva: `requested | confirmed | seated | cancelled | no_show`.

- **Módulo**: `api/routes/reservations.js` + `restaurant.reservations[]` (dual-write, misma vía JSON↔Supabase del resto).
- **Flujo comensal**: chip "Reservar" abre modal con fecha/hora/pax/teléfono → alta con captcha →
 notificación al dueño (WhatsApp link prefilled como HOY + email).
- **Flujo dueño**: tab `Reservas` en Studio: lista por día, confirmar (fija franja), cancelar con motivo,
 marca `no_show`. Historial por teléfono enlazado con fidelización (teléfono ya es PK E.164 ahí — el
 anillo con loyalty es gratis).
- **Límites honestos**: cap de reservas simultáneas por franja horaria, buffer min entre reservas; rate
 limit por tenant; anti-abuso captcha ya existente.
- **Contract**: `openapi.yaml` 5 paths nuevos `POST/GET/PATCH /api/reservations*` + casos en test-openapi-contract.
- **Estimación**: Fase única shippeable; ~2/3 del esfuerzo es UI Studio (todo DOM-only).
