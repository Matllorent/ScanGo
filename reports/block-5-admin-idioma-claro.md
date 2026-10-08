# Block 5 — Panel `/admin` maestro en español llano

**Objetivo del operador:** «hagámoslo pero que sea en lenguaje en español, dejemos de lado palabras complicadas de negocios».

El panel sigue un criterio simple: **nada de MRR, churn, conversión o recurrencia**. Todo se dice como se dice en la mesa del restaurante.

## Qué cambió

### Backend (`api/index.js` — `/api/admin/overview`)
- **Plata que entra al mes** (antes "MRR Estimado" = `activos × $9` hardcodeado): ahora se calcula de verdad, restaurante por restaurante:
  - Usa `billingOrchestrator.getPlanPricing()` → precio real del plan (starter 9/79, pro 19/159) **con el descuento escalonado por sucursales** (2ª=80%, 3ª=65%, 4ª+=50%).
  - Los planes anuales se reparten entre 12 para compararlos como "al mes".
  - Solo cuentan los clientes con `status: 'active'` (los que pagan hoy).
- **Clientes nuevos esta semana**: los que se registraron hace menos de 7 días.
- **Renovaciones en 7 días**: lista real (`renewalsList`) de clientes que pagan y se les renueva el pago dentro de la semana — con nombre, plan legible, fecha y cuánto dejan al mes.
- **Pruebas que terminan en 7 días**: lista real (`trialsEndingList`) de pruebas gratis que vencen esta semana.
- **Conversión de la prueba, en criollo**: de los que ya terminaron su prueba gratis, cuántos siguen pagando hoy (`trialBecamePaying` de `trialFinished`, con porcentaje). Sin jerga: el panel lo muestra como "**X de Y siguen pagando (Z%)**".
- Se mapea `branches` de Supabase para que el descuento multi-sucursal valga también en modo cloud.
- `mrrEst` queda como alias legacy con el mismo valor (ningún consumidor externo se rompe).

### Frontend (`public/admin.html`)
- **Fila 1 de tarjetas**, renombrada sin jerga:
  - `Total Restaurantes` → **Restaurantes registrados** · *Todos los restaurantes*
  - `Suscripciones Activas` → **Clientes que están pagando** · *Pagan hoy*
  - `En Prueba Gratuita` → **En prueba gratis** · *Prueba de 7 días*
  - `En Período de Gracia` → **Con el pago atrasado** · *Siguen online 7 días más*
  - `MRR Estimado` → **Plata que entra al mes** · *Aproximada, según el plan de cada uno*
  - `Membresías Vencidas` → **Clientes que dejaron de pagar** · *Prueba vencida o plan cancelado*
- **Fila 2 de tarjetas (nueva)**, "movimientos":
  - **Clientes nuevos esta semana** · *Se unieron hace menos de 7 días*
  - **Renovaciones en 7 días** · *Se les renueva el pago*
  - **Pruebas que terminan en 7 días** · *Les queda menos de una semana*
  - **De los que ya terminaron la prueba, siguen pagando** (X de Y) · *Z% se quedan*
- **Tabla "Lo que viene esta semana" (nueva)**: qué pasa (se renueva el pago / termina la prueba), restaurante con enlace al menú, cuándo y plata que entra al mes. Estado vacío: *"Nada programado para esta semana. ¡Todo al día! 🌿"*.
- **Tabla de clientes** en criollo: columnas `Estado del pago`, `Plan`, `Se unió`, `Acciones`; estados traducidos a *Pagando / Prueba gratis / Pago atrasado / Dejó de pagar / Cancelado / Pausado*; planes y pasarelas con nombre legible (Starter Mensual, Pro Anual, Mercado Pago…).
- **Gráficos**: torta → *Clientes pagando / Prueba gratis / Pago atrasado / Se fueron*; sección → *Estado de pago de los restaurantes* y *Actividad de los menús*.
- **Export CSV** con los mismos valores en español llano.

### Test nuevo — `tests/test-admin-panel.js` (suite nº 21)
Cero mocks, todo real:
- Login admin con **2FA TOTP real** (`generateTotpToken` RFC 6238) contra `.env` real.
- 4 restaurantes reales sembrados: uno paga plan anual con 2 sucursales (**23.85/mes** exactos: 159 + 159×0.8 = 286.2/año ÷ 12), uno en prueba que vence en 3 días, uno que se fue, uno que pasó la prueba y paga.
- Verifica por HTTP: plata/mes ≥ la de la semilla, el restaurante con renovación en 5 días aparece con 23.85, el de prueba en 3 días aparece en "pruebas que terminan", conversión ≥ «2 de 3», el que renueva en 15 días NO está en la lista de 7, overview sin sesión → 403.

## Verificación
- `npm test` → **21/21 verde** (antes 20).
- `data/*.json` revertidos a HEAD tras la suite; árbol limpio antes del commit.

## Queda pendiente (operador)
- Aplicar `src/db/migrations/001_realtime_operations_tables.sql` (Block 3) en el SQL Editor de Supabase para que `telemetry_events` y las otras 6 tablas pasen a cloud. El dashboard de analytics de Studio sigue en memoria del proceso hasta entonces.