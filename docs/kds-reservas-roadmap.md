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

## 4. Reservas de verdad + recordatorio 24h — ✅ IMPLEMENTADO (oct-2026, suite 65ª)

Estados: `requested | confirmed | seated | cancelled | no_show` (máquina total: terminales sin ida y vuelta, PATCH inválido → 409 `INVALID_RESERVATION_TRANSITION`).

- **Módulo**: `api/utils/reservations.js` (puro: parseo, capacidad, máquina, trim, selección de recordatorios) + `api/routes/reservations.js` + `restaurant.reservations[]` DENTRO del doc del local (columna `profile` JSONB — cero migración) + helpers con mutex en `src/db/db.js` (`addReservation`/`findReservationById`/`updateReservationStatus`).
- **Flujo comensal**: chip "Reservar" (menú) → modal fecha/hora/pax/teléfono/email → `POST /api/reservations` (201 + panel de éxito con botón "📲 Avisar también por WhatsApp" — el `wa.me` prefilled se abre DESPUÉS del alta, sin carrera de popup blocker). Server notifica al dueño por email fire-and-forget; el WhatsApp lo arma el cliente con su formatter de siempre.
- **Flujo dueño**: tab `Reservas` en Studio (`public/js/studio/reservationsManager.js`, agenda por día `?date=`): counts, lista por hora, confirmar → sentado → no vino, cancelar (con `showConfirmDialog` promesa) — render 100% DOM API. Anillo del Club por teléfono (lectura `getCustomerCard`, nunca crea).
- **Límites honestos**: `maxPerSlot` 4 activas por fecha+hora, `slotBufferMinutes` 30 entre horas distintas (la MISMA hora exacta la gobierna `maxPerSlot`, no el buffer — fix de la suite), `maxPax` 12 (`'8+'` → pax 8 + `paxLabel`), `maxAdvanceDays` 60. Un solo código público de capacidad: 409 `SLOT_UNAVAILABLE`. Limiter público 15/slug/15min + captcha Turnstile si está configurado.
- **Recordatorio 24h**: cron horario `/api/cron/reservation-reminders` (`0 * * * *`) con ventana [23,25]h sobre el instante local de la reserva (`local = UTC + offset`, huso del dueño), dedupe en `notification_events` (marcador SOLO cuando algo sale; `NO_CHANNEL` sin marcar → reintenta la hora siguiente), email transaccional al comensal (no respeta opt-out de promos) + push dirigido (guest + consent + teléfono coincidente).
- **Contract**: `openapi.yaml` — 3 paths `POST/GET /api/reservations` + `PATCH /api/reservations/{id}` (los crons NO entran al contrato, convención de la casa) + schemas `Reservation`/`ReservationClub`; casos en `test-openapi-contract.js`.
- Regresión: `npm run test:reservations` (65ª suite).
