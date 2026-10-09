# ADR 0002: Trial 7 días + 3 de gracia

- Fecha: 2026-03-05
- Estado: Aceptado

## Contexto

El trial necesita convertir sin cortar el menú público de golpe:
bloquear el día 8 pierde ventas del restaurante y genera soporte.

## Decisión

Trial de 7 días con acceso total; días 8–10 `verifyAccess()` devuelve
`allowed:true` + `requiresPayment:true` (menú online, Studio con paywall
"Seguir editando"); día 11+ el menú se pausa. Excepción: una suscripción
que ya estuvo paga no recupera la gracia al degradarse.

## Consecuencias

- Hay espejo client en `checkStudioAccess` (Studio): cambiar uno exige
cambiar el otro.
- El cron marca `trialing` → `expired` y envía cada email una sola vez
(banderas `trialWarning3dSent`, `trialExpiredEmailSent`, etc.).
