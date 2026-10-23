# Análisis Competitivo: Bonuxo vs NovityApp vs ScanGo (Fidelización + Wallet)

**Fecha:** 22 Oct 2026  
**Para:** Equipo ScanGo  
**Objetivo:** Evaluar viabilidad de Apple/Google Wallet para ScanGo y extraer quick wins tácticos

---

## 1. Resumen Ejecutivo

| Plataforma | Foco | Wallet Nativo | Stack Técnico | Precio Entrada | Mejor Para |
|------------|------|---------------|---------------|----------------|------------|
| **Bonuxo** | Multi-tenant SaaS global (LATAM, EU, US, AU) | ✅ `.pkpass` (Apple) + JWT RS256 (Google) + APNs/FCM push | .NET 8, PostgreSQL, Redis, React, Clean Architecture | **US$25/mo** (Lite, 1 local, 300 clientes) | Cafés, panaderías, barberías que quieren *solo* wallet sin app cliente |
| **NovityApp** | LATAM (Argentina, Brasil) especializado | ✅ Apple/Google Wallet + push nativo + email | No público (probablemente Node/React) | **Gratis** (100 clientes) → **US$15/mo** (Basic) | Restaurantes/cafés en Argentina/Brasil con POS Fudo |
| **ScanGo (actual)** | SaaS B2B2C menús QR + pedidos WhatsApp | ❌ Solo in-app/menu (PWA) | Express 5, vanilla JS, Supabase/JSON dual, Capacitor Android | **US$9/mo** (Starter) | Restaurantes que necesitan menú digital + pedidos + fidelización dual (local + red) |

**Conclusión rápida:** Bonuxo y NovityApp son **plataformas de fidelización pura con wallet nativo**; ScanGo es un **SaaS de menú digital con fidelización embebida**. El wallet nativo es su *core*, para nosotros sería *feature*.

---

## 2. Tabla Comparativa Detallada

### 2.1 Funcionalidades Core de Fidelización

| Feature | Bonuxo | NovityApp | ScanGo (Actual) |
|---------|--------|-----------|-----------------|
| **Tipos de programa** | 5: stamps, puntos, cashback, descuento progresivo, membership | Puntos + Niveles (Bronce/Plata/Oro personalizables) | Dual: Local (puntos/sellos/configurable) + Global (niveles Bronce→Platino por visitas, badges) |
| **Motor de acumulación** | Núcleo único con row locking `FOR UPDATE`, exactly-once (clave económica + índice parcial UNIQUE), outbox + reversiones tipadas | Puntos por compra (integración Fudo = automático) | Puntos por pedido (`pointsPerOrder`/`pointsPerCurrency`), sellos por visita (`stampsTarget`/`visitReward`), acreditación automática post-orden |
| **Expiración de puntos** | Job configurable (mín 30 días), avisos a 30 y 7 días | No documentado explícitamente | No implementado (solo ledger inmutable) |
| **Gamificación** | Ruleta de premios (generador criptográfico + gate anti-fraude Redis + auditoría PG) | Niveles con beneficios crecientes visibles en wallet | Niveles globales (Bronce→Platino) + insignias (badges) + beneficos de red |
| **Referidos** | No documentado | No documentado | Sistema de referidos implementado |
| **Recuperación churn** | No documentado | Campañas automáticas: cumpleaños, "te extrañamos", puntos dobles | **Módulo puro `churnRecovery.js`**: umbral contra frecuencia propia (45d/2 visitas), teléfono enmascarado, email solo dominio, audit `REACTIVATION_SENT` |
| **Nudge post-compra** | Push en wallet tras transacción | Push wallet + email automatizados | **Nudge day-after delivery** (`reviewNudge.js`): ventana 26-50h, embudo neutral 4-5★→Google / 1-3★→privado, dedupe global en `notification_events` |

### 2.2 Wallet Integration (Apple Wallet / Google Wallet)

| Aspecto | Bonuxo | NovityApp | ScanGo |
|---------|--------|-----------|--------|
| **Apple Wallet** | ✅ `.pkpass` firmado PKCS7 detached SHA-256; **device registration web service** propio; **APNs HTTP/2 push** tras cada transacción; monitor de expiración de certificado | ✅ "Tarjetas en Apple Wallet" — actualización tiempo real, código de barras escaneable, 100% personalizado logo/colores | ❌ No implementado |
| **Google Wallet** | ✅ **Save-to-wallet JWT RS256**; object patch updates; sync geo periódico | ✅ "Tarjetas en Google Wallet" — mismas capacidades que Apple | ❌ No implementado |
| **Distribución** | QR en mostrador, Scanner app para staff | QR en caja, link en bio, WhatsApp | QR de mesa + link `/m/:slug` + WhatsApp (pedido) |
| **Actualización pass** | Push APNs (Apple) / object patch (Google) tras cada transacción | Tiempo real tras venta Fudo o manual | N/A |
| **Notificaciones lock-screen** | APNs push (Apple) / notificaciones Wallet (Google, máx 3/24h) | Push wallet directo a pantalla bloqueo + email | **Web Push VAPID** (solo si usuario acepta + suscripción activa) |
| **Certificados Apple** | **Propios** (monitor expiración incluido) — **costo $99/año Apple Developer Program** | Probablemente propios o servicio tercero | — |

### 2.3 Arquitectura Técnica

| Componente | Bonuxo | NovityApp | ScanGo |
|------------|--------|-----------|--------|
| **Backend** | .NET 8, Clean Architecture (Domain/App/Infra/Api), EF Core global query filters para multi-tenancy | No público | Express 5, routers modulares (`api/routes/`), middleware pipeline, services |
| **DB** | PostgreSQL 16 + Redis 7 (cache, rate-limit, distributed lock, anti-fraud) | No público | **Dual Mode**: JSON local (`data/`) + Supabase (PostgreSQL) con RLS FORCE; hidratación snapshot al boot |
| **Realtime** | No documentado (polling?) | No documentado | **Supabase Realtime** (canales privados `realtime:%`, migración 002 guard) |
| **API POS/E-commerce** | **OpenAPI 3.0.3 v1.3.0**, 10 paths; API keys (hash SHA-256), 600 req/min, Idempotency-Key 24h; integraciones verificadas: **Fudo, TiendaNube, MercadoPago POS** | **Solo Fudo** (plan Premium), sincronización automática tiempo real | Webhooks billing (MP/Stripe/Lemon), **no hay API POS pública** |
| **Billing** | MercadoPago preapproval subscriptions; HMAC-SHA256 constant-time; reconciliación read-only | No documentado (probablemente MP en AR) | **Multi-provider orchestrator** (MP/Stripe/Lemon), smart dunning, trial 7+3, descuento multi-sucursal |
| **Seguridad** | JWT 15min + refresh 7d (hashed), BCrypt, TOTP 2FA, RBAC 4 roles, audit trail, CSP, AES-256-GCM, scrub PII antes de Sentry | No documentado | JWT + cookies httpOnly, `authMiddleware`/`requireAuth`, `tenantGuard`, `requireVerifiedEmail`, `rateLimits`, `killSwitch`, `idempotency`, CSP estricta/transicional, `script-src-attr 'none'` |
| **Observabilidad** | Sentry (tagged by tenant + correlation), Serilog estructurado | No documentado | `LatencyTracker` p50/p95/p99 en `/api/healthz`, `requestId` con slug (sin PII), telemetría canal público con consentimiento |
| **Infra/Deploy** | 9 apps en **Coolify** (backend, 6 frontends, PG, Redis); secrets required en deploy; liveness/readiness | No documentado | **Vercel** (serverless Express + static), cron jobs en `vercel.json`, Capacitor Android wrapper |

### 2.4 Modelo de Negocio / Precios

| Plan | Bonuxo (US) | NovityApp (ARS/USD) | ScanGo |
|------|-------------|---------------------|--------|
| **Gratis** | ❌ (14-day trial only) | ✅ 100 clientes, 2 premios, 1 sucursal, wallet passes | ❌ (trial 7 días + 3 gracia) |
| **Entry** | **Lite US$25/mo** (1 local, stamps, 300 clientes) | **Basic US$15/mo** (500 clientes, 10 premios, 3 sucursales, wallet) | **Starter US$9/mo** (menú + pedidos + fidelización dual + analytics) |
| **Mid** | **Plus US$45/mo** (todos tipos, clientes ilimitados, campañas, analytics, POS API) | **Premium US$39/mo** (2000 clientes, 50 premios, 10 sucursales, Fudo, tiers, notificaciones, catálogo custom) | **Starter Annual US$79/año** (equiv. $6.6/mo) |
| **Enterprise** | **From US$70/mo** (2 locales, panel multi-local, recomendaciones por cliente) | No documentado | No hay (planes únicos) |
| **Facturación** | Coordinación manual con equipo (no online payment yet) | Tarjeta/transferencia (implícito) | **Automático multi-provider** (MP/Stripe/Lemon), webhooks idempotentes |
| **Pago online suscripción** | ❌ No disponible aún | No documentado | ✅ Checkout real con expiración 24h (MP) / 45min (pedido comensal) |

### 2.5 Integraciones POS / E-commerce

| Integración | Bonuxo | NovityApp | ScanGo |
|-------------|--------|-----------|--------|
| **POS nativo** | **Fudo** (verificado en código), **MercadoPago POS adapter** | **Fudo** (solo plan Premium) | ❌ Ninguna |
| **E-commerce** | **TiendaNube** (verificado en código) | No documentado | ❌ Ninguna (pedidos via WhatsApp) |
| **API pública** | ✅ OpenAPI 3.0.3, API keys, webhooks firmados, idempotency | ❌ No pública | ❌ Solo webhooks billing + `/api/*` internas |
| **Webhooks** | Firmados, idempotentes, reconciliation service | No documentado | Billing (MP/Stripe/Lemon) + cron + IndexNow + review-nudge |

### 2.6 Diferenciadores Clave (vs Programa Básico de Puntos)

| Diferenciador | Bonuxo | NovityApp | ScanGo |
|---------------|--------|-----------|--------|
| **Wallet nativo** | ✅ Core del producto — pass vive en lock-screen, se actualiza solo | ✅ Core — "tarjeta vive en su bolsillo, siempre" | ❌ Solo in-app |
| **Push nativo wallet** | ✅ APNs (Apple) + Wallet notifications (Google) | ✅ Push wallet + email unificado | ✅ Web Push VAPID (requiere opt-in + suscripción activa) |
| **Automatización POS** | ✅ API keys + Fudo/TiendaNube/MP POS — puntos automáticos | ✅ Fudo sync tiempo real (Premium) | ❌ Manual (dueño avanza estado en Studio) |
| **Segmentación RFM** | No documentado | Por nivel/actividad en campañas | **Churn recovery** por frecuencia propia (45d/2 visitas), no scoring mágico |
| **Analytics accionables** | Dashboard + analytics en Plus+ | Dashboard con métricas (retención 97%, +42% ventas) | **Analytics de negocio**: ticket promedio, top platos, CSV export, canal público unificado |
| **Costo switching cliente** | **Cero** — no app, QR → wallet en 1 tap | **Cero** — QR/WhatsApp → wallet en 1 tap | **Bajo** — ya está en menú QR, pero sin wallet nativo |
| **Multi-local** | Panel multi-local (Enterprise) | Hasta 10 sucursales (Premium) | **Branches nativas** (`restaurant.branches[]`), precios override, SSR por sucursal `?branch=` |

### 2.7 Limitaciones / Fricciones Conocidas

| Limitación | Bonuxo | NovityApp | ScanGo (si añade wallet) |
|------------|--------|-----------|--------------------------|
| **Certificados Apple** | **$99/año** Developer Program + gestión certificado `.p12` + monitor expiración | Igual (probablemente propio) | **Nuevo costo fijo + complejidad ops** |
| **Pasos dinámicos** | Complejidad: device registration web service, APNs HTTP/2, object patch Google | Mismo reto técnico | **Alta**: generar `.pkpass` por cliente, firmar, servir, push updates |
| **Adopción real usuarios** | 97% retención pass (métrica propia) | 97% retención pass (métrica propia) | Desconocida — base instalada usa menú QR, no wallet |
| **Límites notificaciones** | Apple: solo campos con change message; Google: máx 3 notificaciones/24h | Mismos límites de plataforma | Web Push: sin límite duro, pero requiere suscripción VAPID |
| **Mantenimiento** | Certificados, APNs tokens, device registration, pass updates, schema changes | Mismo | **Carga operativa significativa** para equipo pequeño |
| **Pago suscripción** | ❌ Manual (equipo coordina) | No documentado | ✅ Totalmente automatizado |
| **POS integrations** | Solo Fudo/TiendaNube/MP POS (LATAM focus) | Solo Fudo (AR focus) | Ninguna — pedidos vía WhatsApp |

---

## 3. Quick Wins Tácticos para ScanGo (SIN Wallet Nativo)

Estos 5 quick wins se pueden implementar **ya** con la arquitectura actual, sin certificados Apple ni Google Wallet:

### QW1. **Tarjeta Digital en el Menú (PWA-installable) — "Mi Club en el Menú"**
- **Qué:** Una vista `/m/:slug#club` (o modal persistente) que muestra: saldo de puntos, nivel global, progreso a siguiente recompensa, QR escaneable para canje.
- **Cómo:** Ya tenés `LoyaltyRewardsModal` (data-driven, cero demo) + `GroupCartManager` + PWA installable. Añadí un **FAB fijo** 🎁 "Mi Club" en menú (solo si `loyaltyConfig` activo).
- **Valor:** Visibilidad constante sin wallet nativo. El comensal ve su progreso cada vez que abre el menú.
- **Esfuerzo:** ~2 días (nueva vista en `menu.js`, reusa componentes existentes).

### QW2. **Push de Progreso / "A 1 sello del premio" — Web Push Segmentado**
- **Qué:** Cuando `points >= rewardThreshold - 1` (o `stamps == stampsTarget - 1`), enviar Web Push VAPID: *"Te falta 1 visita para tu café gratis 🎁"*.
- **Cómo:** Ya tenés `push_subscriptions` con `customer_phone` + `consent_marketing` + `role: 'guest'`. Extendé `telemetry.js` para disparar evento `loyalty_near_reward` → `notificationsService.sendLoyaltyNudge(phone, reward)`.
- **Valor:** Recupera la "notificación en lock-screen" que da el wallet, pero via Web Push (funciona en Android/iOS si PWA instalado).
- **Esfuerzo:** ~1 día (nuevo evento telemetría + handler push + template).

### QW3. **Niveles Visibles en el Menú (Badge Dinámico)**
- **Qué:** Mostrar badge del nivel global (Bronce/Plata/Oro/Platino) en el header del menú + en el FAB del club.
- **Cómo:** El nivel global ya se calcula en `loyalty.js` (`computeGlobalTier`). Expone `globalTier` en `/api/menu/:slug` y renderizá en `menuHeader.js`.
- **Valor:** Gamificación visible sin wallet — el comensal ve su status cada visita.
- **Esfuerzo:** ~4 horas (campo en payload + render).

### QW4. **Catálogo de Recompensas Público (estilo Novity)**
- **Qué:** Página `/m/:slug/rewards` (o sección en menú) con cards de recompensas: nombre, puntos, botón "Canjear" → genera código `LOY-XXXX-XXXX`.
- **Cómo:** Ya tenés `restaurant.loyaltyConfig.rewards[]` + `validate`/`redeem` en `/api/loyalty`. Solo falta vista pública + SEO (JSON-LD `ItemList`).
- **Valor:** Iguala el "catálogo de recompensas" de Novity/Bonuxo — el comensal ve qué puede conseguir.
- **Esfuerzo:** ~1 día (nueva ruta SSR + vista + JSON-LD).

### QW5. **Campañas Automatizadas: Cumpleaños + Winback (ya tenés la base)**
- **Qué:** Activar `churnRecovery` (ya implementado) + añadir birthday nudge (telemetría `customer_profile.birthdate` → job cron mensual).
- **Cómo:** `customer_profiles` ya guarda `birthdate` (opcional). Cron `/api/cron/birthday-nudge` → `sendPromotionalEmail` + push si consentimiento.
- **Valor:** Iguala las "campañas de notificaciones" de Novity (cumpleaños, "te extrañamos") sin wallet.
- **Esfuerzo:** ~2 días (campo birthdate en perfil + cron + templates).

---

## 4. Dictamen de Factibilidad: Apple Wallet / Google Wallet para ScanGo

### 🔴 **VEREDICTO: POSTERGAR (No viable en 2026-Q4 / 2027-Q1)**

#### Justificación Técnica

| Factor | Realidad | Impacto para ScanGo |
|--------|----------|---------------------|
| **Certificados Apple** | $99/año Developer Program + certificado `.p12` Pass Type ID + renovación anual + monitor expiración | **Costo fijo + deuda operativa**. Bonuxo lo tiene en producción porque *es su core*. Para ScanGo es feature secundaria. |
| **Generación `.pkpass` por cliente** | Requiere: ZIP con `pass.json` + `manifest.json` + `signature` (PKCS7 detached SHA-256) + imágenes @1x/@2x/@3x + servir via HTTPS con `application/vnd.apple.pkpass` | **Complejidad backend significativa**. Necesitás librería (`passkit-generator`, `pkpass`) + almacenamiento temporal + cleanup. |
| **Device Registration Web Service (Apple)** | Endpoints obligatorios: `POST /v1/devices/<deviceLibraryIdentifier>/registrations/<passTypeIdentifier>/<serialNumber>`, `GET /v1/passes/<passTypeIdentifier>/<serialNumber>`, `DELETE` (unregister), `POST /v1/log` | **Infra nueva completa**. Bonuxo lo implementó entero. No es "llamar a API de Apple" — es *hostear el webservice que Apple llama*. |
| **APNs Push (Apple)** | HTTP/2 con token JWT (`.p8` key) + topic `pass.<passTypeIdentifier>` + payload `{"aps":{}}` tras cada update | **Otro certificado/llave + gestión tokens + reintentos + feedback service**. |
| **Google Wallet API** | Service Account + JWT RS256 (`save-to-wallet` + `object.patch` + `insert`) + Google Cloud project + habilitar Wallet API | **Más simple que Apple** (gratis, sin certificado anual), pero **otro proveedor + credenciales + schema propio**. |
| **Actualización de passes** | Apple: re-firmar `.pkpass` completo + push APNs; Google: `PATCH` object + notificación (máx 3/24h) | **Doble pipeline de updates**. Cada cambio de puntos/nivel = regenerar pass + push. |
| **Distribución** | QR con `https://tudominio.com/wallet/<serial>` → serve `.pkpass` / JWT | **Nuevas rutas públicas + CDN + cache invalidation**. |
| **Testing real** | Requiere dispositivos físicos iOS/Android + cuentas developer + TestFlight / Internal testing | **No se puede mockear bien**. Bonuxo hace load test en prod con sandbox keys. |

#### Justificación de Negocio

1. **ScanGo no es una loyalty platform** — es un **menu SaaS con fidelización embebida**. El wallet es *nice-to-have*, no *core value prop*.
2. **Costo de oportunidad**: 3-4 semanas de dev senior + $99/año + mantenimiento continuo vs. 5 quick wins arriba en ~1 semana que entregan 80% del valor percibido.
3. **Adopción incierta**: La base actual de ScanGo usa menú QR + WhatsApp. Forzar wallet añade fricción (escaneo QR → "Añadir a Wallet" → permisos). Web Push + PWA ya cubre notificaciones.
4. **Diferenciador real de ScanGo**: **Fidelización dual (local + global cross-restaurant)**. Bonuxo/Novity son single-tenant. El wallet nativo *no soporta* multi-tenancy cross-brand (un pass = un merchant). Para red global, el wallet nativo **rompe el modelo** (¿un pass por restaurante? ¿uno global? Apple/Google no soportan "coalition passes" bien).
5. **Competencia**: Si el dueño quiere wallet nativo, ya puede usar Bonuxo/Novity/Loopy Loyalty **junto a** ScanGo. No tenés que ganar esa batalla.

---

## 5. Si Fuera Viable: Roadmap Mínimo (Hipotético)

> **Solo para referencia si el contexto cambia (ej. gran cliente enterprise lo exige contractualmente)**

### Fase 0: Prerequisitos (Semana 1-2)
- [ ] Inscripción **Apple Developer Program** ($99/año) + **Pass Type ID** + certificado `.p12` Pass Signing
- [ ] **Google Cloud Project** + Wallet API habilitada + Service Account + clave `.p12`/JSON
- [ ] Dominio HTTPS válido para servir passes (ya tenés Vercel)
- [ ] Decisión: **librería vs custom**. Recomendado: `passkit-generator` (Node) o `pkpass` + custom APNs sender.

### Fase 1: Generación `.pkpass` + JWT Google (Semana 3-4)
- [ ] Servicio `WalletPassService` en `api/services/walletPass.js`
  - `generateApplePass(customer, restaurant, loyaltyState)` → buffer `.pkpass`
  - `generateGooglePassJWT(customer, restaurant, loyaltyState)` → JWT RS256
  - Template base: `pass.json` con `loyaltyPoints`, `secondaryFields` (nivel), `barcode` (Code128/QR con `loyaltyCode`), `relevantDate` (expiración puntos), `locations` (geofence sucursales)
- [ ] Endpoint `GET /api/wallet/pass/:serial` → sirve `.pkpass` (Apple) o redirige a `pay.google.com/gp/v/save/<jwt>` (Google)
- [ ] QR de enrolamiento en menú/Studio: `https://tudominio.com/api/wallet/enroll/:restaurantId/:phoneHash`

### Fase 2: Device Registration + APNs (Semana 5-6)
- [ ] Implementar **Apple Device Registration Web Service** (4 endpoints obligatorios)
- [ ] Guardar `deviceLibraryIdentifier` + `pushToken` por pass serial en `push_subscriptions` (extender schema)
- [ ] **APNs Sender**: HTTP/2 con JWT auth (`.p8` key), topic `pass.<passTypeId>`, payload `{"aps":{}, "w":{}}` (empty push = wallet refresh)
- [ ] **Google Object Patch**: `PATCH /walletobjects/v1/loyaltyObject/<id>` con `loyaltyPoints.balance` actualizado

### Fase 3: Integración con Motor Fidelización (Semana 7)
- [ ] Hook en `loyaltyService.creditPoints()` / `redeem()` → `walletPassService.updatePass(serial, newState)`
- [ ] Idempotencia: `serialNumber = restaurantId:customerPhoneHash` (estable)
- [ ] Fallback: si push falla → pass se actualiza en próximo `GET` (pull model)

### Fase 4: Fallback PWA / Web (Paralelo)
- [ ] **PWA Installable** ya existe (`public/sw.js`, `pwa-install-ready`). Mejorar: "Añadir a pantalla de inicio" → icono con badge de puntos (Web App Manifest `shortcuts` + `badge` API experimental).
- [ ] **Tarjeta digital en menú** (QW1 arriba) como fallback universal (funciona en desktop, Android sin Wallet, iOS sin Wallet).

### Coste Estimado (Solo Dev + Ops, sin oportunidad)
| Ítem | Costo |
|------|-------|
| Apple Developer Program | $99/año |
| Dev senior (4 semanas) | ~$12-16K (internos) |
| Mantenimiento/año (certs, APNs, schema changes) | ~$3-5K/año |
| **Total Año 1** | **~$15-21K** |
| **Valor incremental vs Quick Wins** | **Bajo** (ya tenés push, niveles, catálogo, churn recovery) |

---

## 6. Mejor Alternativa Web/PWA (Recomendada)

### **"Tarjeta Digital ScanGo" — Implementación Inmediata**

```
┌─────────────────────────────────────────────────────────────┐
│  MENÚ PÚBLICO (/m/:slug)                                    │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🎁 Mi Club  [Bronce ▼]  1,240 pts  ████████░░ 80%   │   │  ← Header persistente
│  └─────────────────────────────────────────────────────┘   │
│  [Carta] [Pedidos] [Mi Club] [Info]                         │
│                                                             │
│  Al click "Mi Club" → Modal/Bottom Sheet:                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  🎁 MI CLUB — Café Palermo                          │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  NIVEL: PLATA (500-2000 pts)                │    │   │
│  │  │  ████████████░░░░░░░░░░  1,240 / 2,000 pts  │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  🎯 PRÓXIMO PREMIO: Café gratis (500 pts)   │    │   │
│  │  │  Te faltan 260 pts → ~3 visitas             │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  📱 CÓDIGO PARA CANJEAR                      │    │   │
│  │  │  ┌─────────────────────────────────────┐    │    │   │
│  │  │  │  LOY-A1B2-C3D4  (QR escaneable)     │    │    │   │
│  │  │  └─────────────────────────────────────┘    │    │   │
│  │  │  [Copiar]  [Compartir]  [Actualizar]       │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  │  ┌─────────────────────────────────────────────┐    │   │
│  │  │  🏆 CATÁLOGO DE RECOMPENSAS                  │    │   │
│  │  │  ☕ Café gratis .............. 500 pts       │    │   │
│  │  │  🍰 Postre especial ......... 1,200 pts     │    │   │
│  │  │  🍽️ Cena para dos ............ 4,000 pts    │    │   │
│  │  └─────────────────────────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

**Ventajas vs Wallet Nativo:**
| Ventaja | Detalle |
|---------|---------|
| **Cero certificados** | No Apple Developer Program, no Google Cloud Wallet API |
| **Cross-platform real** | Funciona en desktop, iOS, Android, cualquier navegador |
| **Multi-tenancy nativo** | Un menú = un club. Red global = badges cruzados visibles en mismo UI |
| **Control total UX** | Diseño = tu design system (temas, layouts, imageMode, popularity) |
| **Analytics propios** | Telemetría `club_view`, `reward_redeem_click`, `qr_share` en tu canal |
| **Push vía Web Push** | Ya implementado (VAPID), segmentado por `customer_phone` + consentimiento |
| **PWA Installable** | Ya tenés `sw.js` + `manifest.json` + CTA flotante. "Añadir a pantalla de inicio" = icono con badge dinámico (experimental `navigator.setAppBadge()`). |
| **QR genérico en wallet** | Si el usuario *quiere* guardarlo en Apple/Google Wallet: genera un **pass genérico "ScanGo Club"** (uno solo para tu marca) con link profundo `https://tudominio.com/m/:slug#club`. Un pass, muchos restaurantes. |

**Esfuerzo:** ~5-7 días (reusa 90% de componentes existentes: `LoyaltyRewardsModal`, `loyaltyService`, `pushSubscriptions`, `telemetry`, PWA).

---

## 7. Recomendación Final

| Acción | Prioridad | Esfuerzo | Valor |
|--------|-----------|----------|-------|
| **NO implementar Apple/Google Wallet nativo en 2026** | 🔴 Decisión estratégica | — | Evita $15-21K + deuda técnica |
| **Implementar QW1-QW5 (Tarjeta digital en menú + push segmentado + niveles visibles + catálogo público + campañas auto)** | 🟢 **ALTA** | ~1 semana | 80% valor percibido, 5% costo |
| **Mejorar PWA: badge dinámico en icono + "Añadir a pantalla de inicio" prominente** | 🟡 Media | ~3 días | Mejora retención app-like |
| **Evaluar wallet nativo SOLO si:** <br>• Cliente enterprise >$5K/mo lo exige contractualmente<br>• Partnership con POS mayor (Fudo/Toast/Square) lo requiere<br>• Métricas muestran <20% adopción PWA tras 6 meses | 🔵 Baja | — | Decisión basada en datos, no FOMO |

---

## 8. Apéndice: Referencias Técnicas Clave

- **Bonuxo Case Study** (Alan Meglio): https://meglioalan.com/en/projects/bonuxo — arquitectura .NET, `.pkpass` PKCS7, APNs HTTP/2, device registration WS, Fudo/TiendaNube integration
- **NovityApp Website**: https://novityapp.com / https://novity.com.ar — pricing, Fudo integration, tier automation, push wallet + email
- **Apple Wallet Pass Docs**: https://developer.apple.com/wallet/loyalty-passes/ — pass.json schema, device registration API, APNs push
- **Google Wallet API**: https://developers.google.com/wallet/retail/loyalty-cards — JWT RS256, object.patch, save-to-wallet
- **ScanGo Actual**: `api/services/loyalty.js`, `api/routes/loyalty.js`, `public/js/components/LoyaltyRewardsModal.js`, `public/js/studio/onboardingChecklist.js`, `tests/test-loyalty-dual.js`, `tests/test-churn-recovery.js`, `tests/test-review-nudge.js`

---

*Documento generado tras investigación web + análisis código ScanGo. Para validación técnica profunda de wallet nativo, consultar a Alan Meglio (autor Bonuxo) o revisar librerías `passkit-generator` / `pkpass` en Node.*