# Auditoría de abuso — comensal → restaurante / ScanGo (oct-2026)

> Modelado de amenazas de los vectores donde un comensal (o un script haciéndose
> pasar por comensal) puede dañar al restaurante, a otros comensales o al
> proyecto. Estado verificado contra el código real el 21-oct-2026 (`npm run
> check` verde, semgrep 0 hallazgos, OSV sin CVEs en el lockfile).

## Resumen ejecutivo

**Estado general: sólido.** Los flujos de dinero (cotización server-side, MP,
cupones, propina) y de identidad (loyalty E.164, sesiones, tenantGuard) están
bien blindados. Los **3 findings del bloque emails/retención quedaron RESUELTOS
en la Serie 1 de oct-2026** (A/A2 con escape + `safeEmailHref`; B con retención
en el cron mensual). Resta el vector C en backlog. Nada crítico (P0).

| Ref | Vector | Impacto | Estado |
|---|---|---|---|
| A | Emails con HTML sin escapar (owner-controlled) | Phishing entre clientes del dueño / reputación de dominio Resend | **P2 — RESUELTO (oct-2026): `escapeHtmlText` + `safeEmailHref` en email.js** |
| A2 | Fugas de HTML en emails de R2/R1 templates | ídem | **P2 — RESUELTO (oct-2026): misma política en las 14 plantillas** |
| B | `notification_events` sin retención | Crecimiento sin cota (plan free Supabase) | **P1 — RESUELTO (oct-2026): `purgeOldNotificationEvents` en el cron mensual** |
| C | Pedidos falsos al dueño (spam ~KDS/pedidos en vivo) | Ruido operativo, push repetidos | parcial (captcha opt-in) |
| D | Spam de aviso de mozo | Push al dueño 1/min por mesa | mitigado (dedupe) |
| E | Votos falsos en Descubrir (localStorage) | Ranking distorsionable | parcial, aceptado |
| F | Broadcast spam en carrito grupal (Realtime) | Ruido entre comensales de la MISMA mesa | mitigado (RLS topics) |
| G | Wa.me con notas del comensal | Inyección en mensaje de WhatsApp | mitigado (encodeURIComponent) |
| H | Brute force de códigos LOY-XXXX | Canjes ajenos | mitigado (limiter 30/15min + espacio de claves) |
| I | Flood de telemetry (multi-IP) | Costo storage plan free | parcial (limiter por slug + retención mensual) |
| J | Push subs falsas | Push a endpoints del atacante (inofensivo) | no-issue |
| K | Scraping de cartas | Público por diseño | no-issue (SEO establece que es el objetivo) |
| L | XSS en SSR / JS del menú | Con comensal como víctima | mitigado (CSP estricta + escapeHtmlBrowser + hashes) |
| M | Dinero: manipular montos/cupones/envío | Pérdida directa | mitigado (server recomputa todo; tests de propiedades) |
| N | Mass-assignment Studio save | Escalada plan/subscription | mitigado (stripPrivilegedFields + tests) |

## Detalle de findings

### A/A2 (P2) — RESUELTO (oct-2026): escape HTML en las plantillas de email
**La Política del archivo ahora es**: todo texto interpolado sale por
`escapeHtmlText()` (server-side, testeable y exportado) y TODO href por
`safeEmailHref()` (solo `http(s)://` o rutas absolutas de la propia app —
`javascript:`/`data:` jamás salen como href; el valor SIEMPRE va escapado).
Las 14 plantillas (welcome, invitación, verificación, reseña R2, promo R1,
receipt, failed, dunning, trial-warning/expired, menu-paused, new-client,
winback, **night summary F1**) usan la política; los asuntos quedan como texto
plano (los clientes de email no los interpretan). Regresión: `tests/
test-night-summary.js` §5 (hostiles `<script>`/`<img onerror>` → texto literal,
sin hrefs de esquema traicionero) + §4b para el email del cierre.

### B (P1) — RESUELTO (oct-2026): retención de `notification_events`
El cron mensual de retención (`api/cron/telemetry-retention.js`, mounted como
`/api/cron/telemetry-retention`) ahora también purga `notification_events`
`NOTIFICATIONS_RETENTION_DAYS` (default 180, clamp [30,730]) vía
`notificationsService.purgeOldNotificationEvents` (DELETE nube con filtro +
poda del espejo local; dry-run reporta sin borrar; los marcadores de dedupe
`review_nudge_request`/`night_summary` son isRead:true y caducan con la MISMA
política — su ventana de referencia es de horas, 180 días es holgado). Los
eventos VIVOS del inbox nunca se tocan. Regresión: `tests/test-night-summary.js`
§3b (dry-run sin mutación + purga real local cuando no hay nube); el ejercicio de
retención de test-hardening §B sigue tal cual.

### C — Pedidos falsos (spam operativo)
El limiter de orders es 60/15min **por IP**; una bot-farm con varias IPs puede
agotar pedidos `pending` al dueño (KDS/pedidos en vivo + pushes). No hay pago
obligatorio, así que el daño es ruido, no dinero. Mitigaciones existentes: captcha
Turnstile opt-in (`TURNSTILE_SECRET`), `forceClosed`, `allowMenuOrders=false`.
**Mejora propuesta** (backlog): detección de flood server-side (≥5 pendientes en
10min desde la misma mesa/teléfono → auto-cancel + nota en Pedidos en vivo) —
barato y visible para el dueño.

### D — Aviso de mozo
Idempotencia por click (60s) + dedupe por payload (10s). Un comensal insistente
genera 1 push/min; volumen acotado. **Estado: mitigado** (subir el dedupe a 60s
por slug+mesa sería trivial si se queja algún dueño).

### D2 — teléfono declarado en pedidos (tercero inocente)
El teléfono del comensal viaja con el pedido (delivery) y se persiste en
`push_subscriptions.customer_phone` (migración 004) — nunca en logs ni en el
canal de seguimiento público (`/track/:token` es un endpoint SIN PII). Riesgo
menor: un comensal puede declarar el teléfono de OTRA persona → el push de
estado del pedido le llegaría a un tercero (molestia puntual, sin fuga de
datos: el contenido del push es solo estado genérico y el seguimiento completo
queda protegido por el token HMAC del pedido). Verificar posesión por OTP sería
overkill para este caso.

### E — Votos en Descubrir
Un voto por navegador vía `localStorage` — reseteable por incógnito/farm. El
daño es distorsionar el ranking (sin dinero ni PII). **Decisión consciente:
aceptar** mientras el feed sea beta; si escala, subir la barra: voto firmado por
IP hash server-side con rate por slug (el limiter por slug ya existe y el canal
público es el mismo).

### F — Realtime carrito grupal
RLS migración 002: guests solo topics `realtime:%`, SELECT para join/receive e
INSERT para emitir. Un comensal puede floodear SU canal de mesa (afectar a los
comensales de esa mesa únicamente). El canal `event_waiters_` queda reservado a
service_role. **Estado: mitigado** (blast radius = una mesa). Si se quisiera más:
límite de mensajes broadcast en `GroupCartManager` — queda en backlog.

### G — WhatsApp wa.me
El menú arma el link con `encodeURIComponent` en los campos del comensal (nota,
nombre). Inyección de texto en el mensaje es cosa del propio comensal (se
perjudica solo). **No-issue**.

### H — Brute force canjes fidelización
Códigos `LOY-XXXX-XXXX` (alfabeto corto), pero limiter `loyaltyLimiter` 30/15min
+ validación tenant (403) + single-use con mutex/RPC atómico + OTP de posesión
para canje. A 30 intentos/15min, el espacio de claves es inabordable. **Mitigado**.

### I — Flood de telemetría
Canal público de analytics: 120 eventos/15min **por slug** (bucket por
restaurante). Un actor con IP-rotation puede escribir 115k eventos/día por local
≈ 3.5M/mes. La retención mensual (183d default) lo poda, pero la ventana de
almacenamiento puede doler en el plan free si un local grande es atacado.
**Mitigación parcial aceptada**; mejora barata: conteo de descarte observado en
`/api/healthz` cuando un slug supera N eventos/día (alarma temprana, sin bloquear
tráfico legítimo).

### J/K/L/M/N — Cerrados
- Push subs falsas: el atacante solo se spamea a sí mismo (endpoint propio).
VAPID no paga por envío.
- Scraping: público por diseño (SEO/GEO), decidido y documentado.
- XSS: CSP estricta en `/m/*` + cero `on*=` + escapeHtmlBrowser + hashes CSP +
semgrep/guard de flujo continuo.
- Dinero: `quoteOrderItems` recomputa TODO en server (platos, opciones, envío
por zonas, cupones, propina clamp, helado custom contra config del dueño);
cubierto por propiedades con PRNG seed fijo.
- Mass-assignment: `stripPrivilegedFields` en Studio save; webhooks con recency
guard + secretos comparados en tiempo constante.

## Qué vimos y NO encontramos (positivo)

- No hay camino comensal → admin/Studio (todo owner-guarded con limiter propio).
- `POST /api/account/delete-request` exige sesión + confirm; un atacante no
  puede borrar la cuenta del restaurante.
- Reset de password: token HMAC single-use atómico + rehash + revocación por pwdTs.
- Cron endpoints fail-closed con `CRON_SECRET` (todos los de este sprint incl.).
- R1/R2 exponen SOLO datos enmascarados (teléfono `j***`, email solo dominio) y
  los sends exigen consentimiento explícito con 409 honestos.
- `verifyLoyaltyOtp` single-use + HMAC + ventana corta; email first-write exige
  OTP al email previo.

## Acciones recomendadas (orden)

1. **(P1, ~30min)** Añadir purga de `notification_events` al cron de retención.
2. **(P2, ~1h)** Escapar HTML en los 4 templates de email (bienvenida, invitación,
   promo) + regresión en test-email-notifications.
3. **(backlog)** Flood detector de pedidos por mesa/teléfono.
4. **(backlog)** Alarma de anomalía de telemetría por slug en `/api/healthz`.

> Los P1/P2 NO tocan dinero ni identidad: son higiene. Pueden ir juntos en un
> solo commit después de las features del próximo bloque o antes — son pequeños.
