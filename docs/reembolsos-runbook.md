# Runbook — Reembolsos (proceso operativo)

> Cuándo usarlo: un cliente (dueño de local) solicita un reembolso por
> cualquier canal (email/WhatsApp) o detectás un `refunded`/`charged_back`
> en el dashboard de una pasarela sin haberlo iniciado vos.

## Estado del sistema (leer primero)

Un webhook de reembolso **pausa automáticamente el estado de la suscripción**:

| Pasarela | Evento que procesamos | Efecto en la app |
|---|---|---|
| Mercado Pago | `refunded` / `charged_back` (rawStatus del pago) | `past_due` → gracia 7 días → menú pausado |
| Lemon Squeezy | `subscription_payment_refunded` / `order_refunded` (eventName) | `past_due` → idem |
| Stripe | `charge.refunded` / `refund.*` / `invoice.refunded` / `charge.dispute.funds_withdrawn` | `past_due` → idem |

Durante esos 7 días de gracia el cliente **sigue con el menú online**
(`verifyAccess` → `allowed: true`) para que no pierda clientes mientras
resolves su caso. Luego el cron lo pausa si la deuda sigue.

**Excepción email:** los eventos de refund NO disparan el email de
"no pudimos procesar tu pago" (fue el cliente quien pidió la devolución —
notificarle un fallo de cobro sería confuso).

## Checklist operativo (cuando llega un pedido de reembolso)

1. **Verificar identidad** del solicitante contra la cuenta en la app
   (email del dueño registrado + nombre del local). Nunca reembolsar a
   terceros sin validar propiedad.
2. **Clasificar el caso:**
   - `A` — Primer cobro, ≤ 14 días, service sin adopción clara → **reembolso total** (política `/reembolsos`).
   - `B` — Cobro duplicado / doble suscripción por el mismo motivo → reembolso del cobro extra + fusionar/ajustar suscripción.
   - `C` — > 14 días o servicio largamente usado → reembolso **proporcional** (días restantes del ciclo) como gesto, o declinar y ofrecer cancelar sin cobro futuro.
   - `D` — Fraud/abuso (descuento pedido tras explotar el trial, segunda cuerda del mismo usuario) → declinar y documentar.
3. **Ejecutar el refund en la pasarela que cobró** (dashboards mandatorios):
   - **Lemon Squeezy:** Orders → refund (MoR: ellos gestionan taxes/chargeback).
   - **Stripe:** Payments → refund del `charge_id` (o `invoice.refunded`).
   - **Mercado Pago:** Payments → devolución, o `POST /v1/payments/{id}/refunds`.
4. **Cerrar la suscripción si corresponde** (caso A/C con baja): si el
   reemplazo no es un nuevo cobro, **cancelar** para que no llegue el
   próximo ciclo. Ver `/reembolsos` §4 — el cliente también puede darse de
   baja solo desde Studio (`POST /api/billing/cancel`).
5. **Verificar automatización:** a los ~1–2 min del refund, el webhook debe
   haber seteado subscription.status = `past_due`. Confirmar con
   `npm run db:check` (o en Admin → overview) que la suscripción quedó en
   `past_due` y con `lastWebhookEventAt` actualizado. Si no llegó el
   webhook (raro), el evento atrasado de `Stripe` puede descartarse por
   `lastWebhookEventAt` más reciente — forzar un nuevo evento desde la
   pasarela o ajustar a mano por SQL/Edit local (mismo criterio: dejar
   `past_due`) y documentarlo.
6. **Confirmar al cliente** por su canal y registrar el caso en este
   runbook (fecha, pasarela, monto, motivo, clasificación A–D).

## Criterio asumido (idempotencia de decisión)
- **Un refund no re-verifica el dinero**: el reembolso queda documentado en
  la pasarela; la app solo refleja el estado, no re-cobra ni reintenta.
- La `idempotencia` de webhooks (`providers/event_id` unique) evita aplicar
  dos veces el mismo refund.
- Un `refund` de pedido `event_once` (cobro único por evento) pausa el menú
  si el evento quedaba cobrado; se opera a mano en la pasarela igual que el
  resto.
