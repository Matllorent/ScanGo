# Guía de Buenas Prácticas — Gestión de Secretos en ScanGo

**Versión:** 1.0  
**Autor:** DevOps & Backend Security Specialist  
**Fecha:** 23 de octubre de 2026  
**Estado:** Borrador definitivo para revisión del Orquestador Principal y Security & Architecture Architect  
**Stack:** Express 5 + Node.js + Supabase PostgreSQL + frontend estático (Vercel) + Capacitor (Android)

---

## 1. Resumen ejecutivo

Esta guía define la forma definitiva, limpia y profesional de gestionar secretos y variables de entorno en ScanGo. Parte de una premisa irreductible:

> **La seguridad por oscuridad no es una estrategia principal.** Ofuscar nombres de variables de entorno o desplegar señuelos (decoys) puede ser una medida complementaria, nunca el control de seguridad. La confidencialidad de los secretos debe sostenerse sobre almacenamiento cifrado, acceso con mínimo privilegio, rotación planificada, detección de fugas y falla cerrada (fail-closed).

El objetivo es que cualquier ingeniero —interno o externo— sepa exactamente:

1. Cómo se nombran las variables de entorno.
2. Dónde y cómo se almacenan en cada entorno.
3. Cómo se rotan sin downtime.
4. Cómo se evitan fugas al repositorio y a las dependencias.
5. Qué principios de acceso se aplican.
6. Cómo se ve un `.env.example` de referencia.

---

## 2. Nomenclatura de variables de entorno

### 2.1 Convención general

Todas las variables de entorno de ScanGo siguen este patrón:

```
<PREFIJO>_<SUBSISTEMA>_<PROPÓSITO>[_SUFijo]
```

| Componente | Reglas | Ejemplo |
|------------|--------|---------|
| **PREFIJO** | Siempre `SCANGO_` para variables propias de la aplicación. Reservado para evitar colisiones con variables del runtime (Node, Vercel, Supabase). | `SCANGO_` |
| **SUBSISTEMA** | Área funcional en mayúsculas, sin guiones bajos internos. | `BILLING`, `DB`, `AUTH`, `EMAIL`, `PUSH`, `SEO`, `CRON` |
| **PROPÓSITO** | Qué representa la variable, en mayúsculas. | `API_KEY`, `WEBHOOK_SECRET`, `JWT_SECRET`, `SERVICE_ROLE_KEY` |
| **SUFIJO** (opcional) | Tipo de dato cuando hay ambigüedad: `_PUBLIC_KEY`, `_PRIVATE_KEY`, `_SUBJECT`, `_URL`, `_ID`, `_TOKEN`, `_SECRET`. | `_PUBLIC_KEY`, `_WEBHOOK_SECRET` |

**Reglas de formato:**
- Solo mayúsculas, dígitos y guiones bajos (`[A-Z0-9_]`).
- No usar puntos ni guiones medios en el nombre de la variable.
- Las variables con valores públicos (claves públicas, URLs, subject) terminan en sufijo descriptivo y **no** en `_SECRET`.
- Las variables que contienen secretos reales terminan siempre en `_SECRET`, `_KEY` (cuando es una clave de API) o `_WEBHOOK_SECRET`.

### 2.2 Prefijos reservados por plataforma (no tocar)

Estos son gestionados por la infraestructura y **no** deben renombrarse ni reutilizarse para lógica de aplicación:

| Variable | Origen | Uso en ScanGo |
|----------|--------|---------------|
| `SUPABASE_URL` | Supabase | Conexión del backend (service role) |
| `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SERVICE_KEY` | Supabase | Clave de servicio del backend (nunca al navegador) |
| `SUPABASE_ANON_KEY` | Supabase | Clave pública para Realtime en el navegador |
| `VERCEL_*`, `NODE_*`, `PORT` | Vercel / Node | Infraestructura, fuera de este estándar |

### 2.3 Catálogo de nombres por tipo de secreto

#### A) Claves de API de proveedores externos

| Proveedor | Variable | Descripción | Ejemplo (solo forma) |
|-----------|----------|-------------|----------------------|
| Mercado Pago | `SCANGO_MERCADOPAGO_ACCESS_TOKEN` | Token de acceso para crear preferencias y consultar pagos | `APP_USR-123456789...` |
| Mercado Pago | `SCANGO_MERCADOPAGO_CURRENCY` | Moneda por defecto (no es secreto, pero va aquí) | `USD` |
| Mercado Pago | `SCANGO_MERCADOPAGO_FX_<CUR>` | Factor de conversión para monedas no USD | `SCANGO_MERCADOPAGO_FX_UYU` |
| Stripe | `SCANGO_STRIPE_SECRET_KEY` | Clave secreta de Stripe (sk_live_...) | `sk_live_51...` |
| Stripe | `SCANGO_STRIPE_PRICE_<PLAN>` | ID de precio por plan (ej. starter_monthly) | `price_1R...` |
| Lemon Squeezy | `SCANGO_LEMONSQUEEZY_API_KEY` | API key de Lemon Squeezy | `ls_live_...` |
| Lemon Squeezy | `SCANGO_LEMONSQUEEZY_STORE_ID` | ID de tienda | `12345` |
| Resend | `SCANGO_RESEND_API_KEY` | API key de Resend | `re_...` |
| Resend | `SCANGO_EMAIL_FROM` | Remitente de emails transaccionales (no secreto) | `no-reply@scango.uy` |
| Gemini | `SCANGO_GEMINI_API_KEY` | Clave de Google Gemini Flash | `AIza...` |
| Sentry | `SCANGO_SENTRY_DSN` | DSN de Sentry (opcional) | `https://...@sentry.io/...` |
| Google OAuth | `SCANGO_GOOGLE_CLIENT_ID` | Client ID de OAuth (público) | `...apps.googleusercontent.com` |
| Google OAuth | `SCANGO_GOOGLE_CLIENT_SECRET` | Client Secret del flujo redirect móvil | `GOCSPX-...` |
| Turnstile (Cloudflare) | `SCANGO_TURNSTILE_SECRET` | Secreto de validación de CAPTCHA | `0x4AAAAAAA...` |

#### B) Credenciales de base de datos (Supabase)

| Variable | Descripción | Ejemplo (forma) |
|----------|-------------|-----------------|
| `SUPABASE_URL` | URL del proyecto Supabase | `https://olqdcudvstbawkcvsfdd.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio (backend, admin) | `eyJhbG...` (JWT) |
| `SUPABASE_SERVICE_KEY` | Alias de `SUPABASE_SERVICE_ROLE_KEY` | igual que arriba |
| `SUPABASE_ANON_KEY` | Clave anon pública (solo navegador/Realtime) | `eyJhbG...` |
| `SUPABASE_DB_URL` | URL directa de PostgreSQL (puerto 5432, para backups) | `postgresql://postgres:...@db...supabase.co:5432/postgres` |
| `SUPABASE_ACCESS_TOKEN` | Token de la Management API (CI/backups) | `sbp_...` |

> **Regla de oro:** `SUPABASE_SERVICE_ROLE_KEY` y `SUPABASE_DB_URL` nunca viajan al navegador ni al frontend Capacitor. Solo el backend (Node/Vercel) y CI las ven.

#### C) Claves de cifrado y firmas (JWT, HMAC, tracking)

| Variable | Descripción | Requisito | Ejemplo (forma) |
|----------|-------------|-----------|-----------------|
| `SCANGO_AUTH_JWT_SECRET` | Firma de JWT de sesión (usuarios, admin) | Mínimo 32 bytes, aleatorio, sin fallback en prod | `openssl rand -hex 64` |
| `SCANGO_GROUP_CART_SECRET` | Firma HMAC de QR de mesa / carrito grupal | Reutiliza `JWT_SECRET` como fallback solo en dev | `openssl rand -hex 32` |
| `SCANGO_ORDER_TRACKING_SECRET` | Firma del token sin estado de seguimiento de pedido | Cadena de fallback: `ORDER_TRACKING` → `GROUP_CART` → `JWT` | `openssl rand -hex 32` |
| `SCANGO_ADMIN_TOTP_SECRET` | Secreto TOTP 2FA del panel `/el-jefe` | Obligatorio en prod (fail-closed en boot) | base32 de 20+ bytes |
| `SCANGO_ADMIN_KEY` | Clave maestra del panel maestro (legacy) | Default `/el-jefe`; ofuscación solo como cortina adicional | alfanumérico |
| `SCANGO_ADMIN_PATH` | Ruta ofuscada del panel maestro | Regex `^\/[a-z0-9-]{2,64}$` | `/el-jefe` |

#### D) Claves de webhook (validación de proveedores de pago)

| Variable | Descripción | Uso |
|----------|-------------|-----|
| `SCANGO_MERCADOPAGO_WEBHOOK_SECRET` | Secreto para validar webhooks de MP | `timingSafeEqualHex` en el orchestrator |
| `SCANGO_STRIPE_WEBHOOK_SECRET` | Secreto de endpoint webhook de Stripe (whsec_...) | Validación de firma de Stripe |
| `SCANGO_LEMONSQUEEZY_WEBHOOK_SECRET` | Secreto de webhook de Lemon Squeezy | Validación de firma de Lemon |

#### E) IndexNow, VAPID y otros

| Variable | Descripción | Requisito |
|----------|-------------|-----------|
| `SCANGO_INDEXNOW_KEY` | Clave de verificación de dominio IndexNow | Debe matchear `[0-9a-fA-F-]{8,64}` (UUID/hex con guiones). Generar con `crypto.randomUUID()` |
| `SCANGO_INDEXNOW_ENABLED` | Activa/desactiva ping IndexNow | `false\|0\|no\|off` apaga aunque haya key válida |
| `SCANGO_VAPID_PUBLIC_KEY` | Clave pública VAPID (push web) | Se envía al navegador |
| `SCANGO_VAPID_PRIVATE_KEY` | Clave privada VAPID (push web) | Solo backend |
| `SCANGO_VAPID_SUBJECT` | Subject (mailto) de VAPID | `mailto:admin@scango.uy` |
| `SCANGO_CRON_SECRET` | Bearer/header para endpoints de cron en prod | `verifyCronAuth` fail-closed |
| `SCANGO_APP_URL` | URL base de la aplicación | `https://scango-rouge.vercel.app` |
| `SCANGO_HEALTH_URL` | URL del health check para uptime | `/api/healthz` |
| `SCANGO_TELEMETRY_RETENTION_DAYS` | Días de retención de telemetría | clamp `[30,730]`, default `183` |
| `SCANGO_ALLOW_NEW_SUBSCRIPTIONS` | Pausa registro y checkout global | `false\|0\|no\|off` → 503 en todas las instancias |

---

## 3. Almacenamiento y distribución de secretos

### 3.1 Desarrollo local

| Artefacto | Contenido | ¿Se commitea? | Notas |
|-----------|-----------|---------------|-------|
| `.env` | Secretos reales de desarrollo (JWT, claves de prueba de MP/Stripe, Supabase local) | **NO** | Listado en `.gitignore`. Cada desarrollador genera el suyo desde `.env.example`. |
| `.env.example` | Esqueleto con nombres de variables y valores placeholder/falsos | **SÍ** | Sirve de contrato. Nunca contiene secretos reales. |
| `data/*.json` | Store local JSON (users, restaurants, etc.) | **NO** (ya sacados del índice en oct-2026) | Mutados por tests; no son secretos pero contienen PII de pruebas. |

**Fallbacks permitidos solo en desarrollo:** `JWT_SECRET`, `GROUP_CART_SECRET` y `ORDER_TRACKING_SECRET` pueden caer a valores de dev (`dev_secret_menu_pizarron_2026`) **únicamente** si `NODE_ENV=development`. En producción la ausencia de estas variables debe hacer fallar el arranque (fail-closed).

### 3.2 Staging / Vercel (producción)

En Vercel las variables se declaran en el panel del proyecto (Settings → Environment Variables) o vía CLI:

```bash
# Ejemplo de asignación (valores reales se pegan en el panel, nunca en el repo)
vercel env add SCANGO_AUTH_JWT_SECRET production
vercel env add SCANGO_MERCADOPAGO_ACCESS_TOKEN production
vercel env add SCANGO_STRIPE_SECRET_KEY production
vercel env add SCANGO_RESEND_API_KEY production
vercel env add SCANGO_GEMINI_API_KEY production
vercel env add SCANGO_VAPID_PRIVATE_KEY production
vercel env add SCANGO_CRON_SECRET production
vercel env add SCANGO_INDEXNOW_KEY production
```

**Reglas para Vercel:**
- Las variables sensibles se marcan como **secretos** (ocultos en el panel y en los logs de build).
- Las variables necesarias en tiempo de build (`NEXT_PUBLIC_*` si las hubiera) se exponen con prefijo público; en ScanGo el frontend estático **no** recibe secretos de backend. `SUPABASE_ANON_KEY` es la excepción prevista (solo Realtime del navegador).
- El cron de Vercel (`vercel.json`) invoca `/api/cron/*` con `x-cron-secret: SCANGO_CRON_SECRET`. Ese secreto se configura como variable de entorno de Vercel y se lee en `verifyCronAuth`.

### 3.3 Supabase (secret management)

Supabase no es un gestor de secretos de propósito general, pero almacena claves de servicio en el proyecto cloud:

| Elemento | Dónde vive | Acceso |
|----------|------------|--------|
| `SUPABASE_SERVICE_ROLE_KEY` | Panel de Supabase → Settings → API | Solo backend y CI (backups) |
| `SUPABASE_ANON_KEY` | Panel de Supabase → Settings → API | Backend + navegador (Realtime, RLS) |
| `SUPABASE_ACCESS_TOKEN` | GitHub Actions secret (para Management API/backups) | Solo CI |

El backend lee `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` al boot. Si faltan, producción falla cerrado (no sirve `/api/*` ni `/m/*` sin hidratación cloud).

### 3.4 CI/CD (GitHub Actions secrets)

Los secretos de CI se guardan en **GitHub Settings → Secrets and variables → Actions** (o entorno de despliegue). Nunca en el workflow YAML ni en `.env` commiteado.

Secretos mínimos requeridos en CI:

| Secreto de GitHub | Uso | Entorno destino |
|-------------------|-----|-----------------|
| `SCANGO_AUTH_JWT_SECRET` | Arranque de tests e integración | Staging / Producción |
| `SUPABASE_SERVICE_ROLE_KEY` | Hidratación cloud + smoke test `db:smoke` | Staging / Producción |
| `SUPABASE_URL` | Conexión a Supabase en tests cloud | Staging / Producción |
| `MERCADOPAGO_ACCESS_TOKEN` | Checkout real en `test-e2e.js` (solo a mano) | Staging |
| `STRIPE_SECRET_KEY` | Webhooks de Stripe en tests | Staging |
| `RESEND_API_KEY` | Envío de emails en tests de notificaciones | Staging |
| `GEMINI_API_KEY` | Importación de menús con IA en tests | Staging |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Push web en tests de notificaciones | Staging |
| `GOOGLE_CLIENT_SECRET` | Login Google móvil en tests | Staging |
| `CRON_SECRET` | Autenticación de endpoints cron | Producción |
| `INDEXNOW_KEY` | Ping IndexNow + verificación `/{key}.txt` | Producción |
| `BACKUP_REPO_TOKEN` | Push opcional de `latest.dump` a repo privado | Backup workflow |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Operaciones del MCP `github` | Dev local / CI |

**Reglas de CI:**
- Los workflows imprimen `***` para secretos (GitHub las enmascara automáticamente si se registran como secretos).
- Nunca `echo` de secretos en logs.
- El job `secret-scan` de gitleaks escanea todo el historial (`fetch-depth: 0`) y falla si hay secreto real (ver `.gitleaks.toml` allowlist de falsos positivos verificados).

---

## 4. Rotación de secretos

### 4.1 Frecuencia recomendada

| Tipo de secreto | Frecuencia | Disparador adicional |
|-----------------|------------|----------------------|
| `SCANGO_AUTH_JWT_SECRET` | Cada 90 días | Ante sospecha de compromiso, rotación de empleado con acceso, o incidente de seguridad |
| `SCANGO_MERCADOPAGO_ACCESS_TOKEN` | Cada 90 días | Rotación en panel de Mercado Pago |
| `SCANGO_STRIPE_SECRET_KEY` | Cada 90 días | Rotación en panel de Stripe |
| `SCANGO_RESEND_API_KEY` | Cada 90 días | Rotación en panel de Resend |
| `SCANGO_GEMINI_API_KEY` | Cada 90 días | Rotación en Google Cloud Console |
| `SCANGO_VAPID_PRIVATE_KEY` | Cada 180 días | Re-suscripción de dispositivos (las suscripciones existentes siguen válidas con la misma llave pública; rotar la privada no invalida suscripciones, pero sí la capacidad de enviar) |
| `SCANGO_CRON_SECRET` | Cada 180 días | Actualizar también `vercel.json` / headers del cron |
| `SCANGO_INDEXNOW_KEY` | Solo si se sospecha compromiso | Rotar implica regenerar `/{key}.txt` y actualizar Bing/Yandex |
| `SCANGO_ADMIN_TOTP_SECRET` | Cada 180 días o por usuario | Reconfigurar app de autenticación |
| `SCANGO_ADMIN_KEY` / `ADMIN_PATH` | Cambio raramente | Solo si se rota la ruta del panel maestro (requiere tocar `vercel.json` y `regen-vercel-csp.js`) |

### 4.2 Rotación sin downtime (patrón de solapamiento)

ScanGo no usa un único secreto "duro" para todo, por lo que la rotación se hace por familia:

**Patrón de doble clave (overlap) para claves de firma/validación:**

1. Se genera el nuevo secreto (`v2`) y se agrega como variable de entorno **junto al anterior** (`v1`), usando un sufijo de versión temporal si el código lo soporta (ej. `SCANGO_AUTH_JWT_SECRET` = `v2`, y se mantiene una variable auxiliar `SCANGO_AUTH_JWT_SECRET_PREVIOUS` = `v1` durante la ventana de transición).
2. El código valida tokens contra **ambos** claves durante la ventana de solapamiento (máximo 7 días).
3. Los nuevos tokens se firman solo con `v2`.
4. Transcurrida la ventana, se elimina `v1` del entorno y se despliega nuevamente.

**Para claves de API de proveedores (MP, Stripe, Resend, Gemini):**
1. Crear la nueva clave en el panel del proveedor.
2. Agregarla a Vercel/GitHub Secrets.
3. Desplegar la aplicación con la nueva variable.
4. Verificar que los flujos funcionan (checkout real, envío de email, importación IA).
5. Revocar la clave antigua en el panel del proveedor.
6. Eliminar la variable antigua del entorno.

**Para `SUPABASE_SERVICE_ROLE_KEY`:**
- Rotar desde el panel de Supabase (Settings → API → regenerate).
- Actualizar inmediatamente en Vercel y en GitHub Actions secret.
- El backend debe seguir funcionando porque Supabase acepta la nueva clave al instante; no hay downtime si se actualiza antes de revocar la antigua (no se puede tener dos service keys activas simultáneamente en Supabase, por lo que la ventana es breve: segundos).

### 4.3 Invalidación de claves anteriores

| Secreto | Cómo se invalida lo anterior |
|---------|------------------------------|
| JWT | Cambiar `SCANGO_AUTH_JWT_SECRET` invalida todas las sesiones activas al instante (los tokens ya no verifican). Forzar re-login. |
| TOTP admin | Cambiar `SCANGO_ADMIN_TOTP_SECRET` invalida el 2FA del panel maestro. |
| Webhook (MP/Stripe) | Rotar el secreto en el panel del proveedor y en Vercel; los webhooks antiguos dejan de validarse. |
| VAPID privada | Las suscripciones existentes siguen válidas, pero solo la nueva privada puede enviar push. Rotar implica re-suscribir dispositivos para nuevos envíos si se invalida la antigua. |
| IndexNow | Regenerar `/{key}.txt` con la nueva clave y actualizar el registro en Bing/Yandex. |

### 4.4 Notificación al equipo

Cada rotación de secreto crítico (JWT, service role, API keys de pago, VAPID) debe ir acompañada de:

1. Un **PR** que actualice `.env.example` si cambian nombres de variables.
2. Un **comentario en el issue/PR** notificando: secreto rotado, fecha, entorno afectado, y quién lo hizo.
3. Para rotaciones que invalidan sesiones (JWT, TOTP): aviso en el canal de operaciones para que los usuarios vuelvan a autenticarse.
4. Entrada en el **log de cambios de operaciones** (runbook de despliegue).

---

## 5. Prevención de fugas (Secret Scanning)

### 5.1 `.gitignore` — regla fundamental

El `.gitignore` de ScanGo debe incluir, como mínimo:

```gitignore
# Secretos y configuración local
.env
.env.local
.env.*.local
.env.production
.env.staging

# Datos locales mutados por tests (contienen PII de pruebas)
data/*.json
!data/.gitkeep

# Dependencias y build
node_modules/
*.log
npm-debug.log*

# Cobertura y reportes
coverage/
.turbo/

# Capacitor / mobile
mobile/android/
mobile/ios/

# OS
.DS_Store
Thumbs.db
```

**Regla:** Si un archivo contiene un valor real de secreto, no entra al repositorio. `.env.example` sí entra, pero con valores falsos/placeholder.

### 5.2 Semgrep en CI (ya existe en `npm test`)

`npm run test:semgrep` ejecuta sobre `api/`, `src/` y `public/js/` con los rulesets:

- `p/security-audit`
- `p/owasp-top-ten`
- `p/javascript`

**Configuración recomendada en `.github/workflows/ci.yml`:**

```yaml
- name: Semgrep static analysis
  run: npm run test:semgrep
  continue-on-error: false
```

**Nota:** En `api/index.js` hay un falso positivo documentado con `// nosemgrep` (SSR de `/m/*`). Todo dato de usuario pasa por `escapeHtml()`/`safeJsonLd`.

### 5.3 Gitleaks en pre-commit y CI

El job `secret-scan` de CI usa el **binario CLI de gitleaks v8.30.1** (no el action oficial, que requiere licencia):

- Tarball oficial verificado por SHA256.
- `--redact` para no imprimir secretos en logs.
- `fetch-depth: 0` para escanear todo el historial.
- Allowlist de falsos positivos verificados en `.gitleaks.toml` (`[extend] useDefault`):
  - Placeholders de `.env.example`.
  - Passwords de fixture de tests (`test_password`, `otra_clave_123` en versiones históricas).
  - Payloads de ejemplo de la skill `benchmark.py` (token-optimizer).

**Pre-commit local:** `.githooks/pre-commit` ejecuta ESM + estructura + arquitectura. Se recomienda agregar gitleaks al pre-commit (instalar con `git config core.hooksPath .githooks`).

### 5.4 OSV-Scanner para dependencias

- Binario: `osv-scanner v2.6.0` (fuera del repo, verificado contra `SHA256SUMS`).
- Subcomando: `experimental-mcp` (stdio).
- Comando de auditoría de código fuente: `osv-scanner scan source -L package-lock.json`.
- Riesgo aceptado documentado: `braces@3.0.3` → `chokidar` → `nodemon` (dev-only) con GHSA-vfj7-8cjw-p6xm (CVE-2026-93687, HIGH 8.7, sin versión corregida publicada). **NO aplicar downgrade a nodemon@1.14.10.**

### 5.5 Checklist de prevención de fugas

- [ ] `.env` está en `.gitignore` y no está trackeado (`git check-ignore .env`).
- [ ] `.env.example` commiteado solo con placeholders.
- [ ] `data/*.json` no está trackeado (sacado del índice en oct-2026).
- [ ] Semgrep corre en CI (`npm run test:semgrep`).
- [ ] Gitleaks corre en CI con `fetch-depth: 0` y `--redact`.
- [ ] OSV-Scanner corre en CI (sin bloqueo, pero reporta vulnerabilidades).
- [ ] Ningún `console.log` o `captureMessage` imprime secretos (logs de email usan `maskEmail`).
- [ ] Sentry y logs reciben paths sin query (`split('?')[0]` — el `notification_url` trae `?secret=`).
- [ ] Pre-commit instalado (`core.hooksPath .githooks`).

---

## 6. Acceso y principios de seguridad

### 6.1 Principio de mínimo privilegio

| Rol / Actor | Secretos a los que accede | Justificación |
|-------------|---------------------------|---------------|
| Backend (Node/Vercel) | Todos los secretos de backend (JWT, service role, API keys de pago, webhook, VAPID privada, cron, IndexNow) | Necesarios para operar la API |
| Frontend (navegador / Capacitor) | Solo `SUPABASE_ANON_KEY` y claves públicas (Google Client ID, VAPID pública) | RLS protege Supabase; el frontend nunca firma webhooks ni accede a service role |
| Desarrollador local | Su propio `.env` con claves de prueba/sandbox | Nunca secretos de producción |
| CI/CD | Secretos de GitHub Actions necesarios para el job | Alcance por entorno (staging vs producción) |
| Soporte / operaciones | Acceso de lectura a paneles de proveedores (MP, Stripe, Resend) | Sin exportar claves a texto plano |

### 6.2 Nunca commitear secretos

Regla absoluta: **ningún valor real de secreto entra al repositorio git**. Esto incluye:
- `.env` con valores reales.
- Claves pegadas en código fuente (hardcoded).
- Tokens en comentarios de código.
- Secretos en archivos de configuración commiteados (`vercel.json` solo contiene nombres de variables, no valores).

Si se commitea un secreto por error:
1. Considerar el secreto **comprometido inmediatamente**.
2. Rotarlo en el proveedor y en todos los entornos.
3. Ejecutar gitleaks sobre el historial para confirmar alcance.
4. Si es necesario, reescribir el historial (`git filter-repo`) — solo como último recurso y con coordinación del equipo.

### 6.3 Variables de entorno vs. archivos de configuración

| Situación | Mecanismo recomendado |
|-----------|----------------------|
| Secretos (claves, tokens, secretos de webhook) | Variables de entorno (nunca archivo commiteado) |
| Configuración no secreta (URLs públicas, flags de feature, límites) | Variables de entorno o archivo de configuración commiteado (ej. `plans.json`) |
| Configuración específica de entorno (dev vs staging vs prod) | Variables de entorno por entorno en Vercel / `.env` local |
| Secretos del frontend navegador | Solo claves públicas (`SUPABASE_ANON_KEY`, VAPID pública). Ningún secreto de backend. |

### 6.4 Valores por defecto seguros (fail-closed)

| Variable | Comportamiento si falta |
|----------|------------------------|
| `SCANGO_AUTH_JWT_SECRET` | **Falla en boot** en producción. Fallback de dev solo si `NODE_ENV=development`. |
| `SUPABASE_SERVICE_ROLE_KEY` | **Falla en boot** en producción (no hidratación cloud → `/api/*` y `/m/*` no responden). |
| `SCANGO_MERCADOPAGO_ACCESS_TOKEN` | `createCheckout` devuelve `checkoutUrl: null` + `configuration.missing`; la ruta responde **503 `PAYMENT_PROVIDER_NOT_CONFIGURED`** (nunca URL trucha). |
| `SCANGO_STRIPE_SECRET_KEY` | Idem, 503 honesto. |
| `SCANGO_RESEND_API_KEY` | Email falla con error honesto; no se silencian los errores de envío. |
| `SCANGO_VAPID_*` | `/api/notifications/send` responde **503 `PUSH_NOT_CONFIGURED`**; el aviso de mozo degrada sin romper WhatsApp. |
| `SCANGO_GEMINI_API_KEY` | Degrada al fallback demo (nunca se cachea el fallback demo para no servir demo tras recuperar cuota). |
| `SCANGO_CRON_SECRET` | Cron responde **401** en producción sin secreto; con `x-cron-secret` responde 200. |
| `SCANGO_INDEXNOW_KEY` | Si no matchea `[0-9a-fA-F-]{8,64}`, el feature IndexNow queda desactivado (no se genera tráfico). |
| `SCANGO_ADMIN_TOTP_SECRET` | **Obligatorio en prod**; fail-closed en boot si falta. |
| `SCANGO_ALLOW_NEW_SUBSCRIPTIONS` | `false\|0\|no\|off` → 503 en registro y checkout en todas las instancias. |

---

## 7. Ejemplo de archivo `.env.example`

Este es el contrato de referencia. Todos los valores son **placeholders/falsos**. Cada desarrollador crea su `.env` copiando este archivo y remplazando los valores con secretos reales de entorno de desarrollo/sandbox.

```env
# =============================================================================
# ScanGo — Variables de entorno (referencia .env.example)
# =============================================================================
# Regla: este archivo se commitea SOLO con placeholders. Los valores reales
# viven en .env (local, no trackeado) o en Variables de Entorno de Vercel
# (staging/producción). Nunca commitear secretos reales.
# =============================================================================

# --- Entorno ---------------------------------------------------------------
NODE_ENV=development
APP_URL=http://localhost:3000
PORT=3000

# --- Auth y sesiones (JWT) -------------------------------------------------
# En producción NO usar fallback: la ausencia falla cerrado (fail-closed).
SCANGO_AUTH_JWT_SECRET=dev_jwt_secret_replace_me_in_production
# Sesión solo-cookie; app Capacitor usa credencial opaca revocable.
SCANGO_AUTH_SESSION_COOKIE_NAME=auth_token
SCANGO_AUTH_ADMIN_COOKIE_NAME=admin_token

# --- Admin / panel maestro (/el-jefe) --------------------------------------
SCANGO_ADMIN_KEY=el-jefe
SCANGO_ADMIN_PATH=/el-jefe
# 2FA obligatoria en producción (fail-closed en boot si falta).
SCANGO_ADMIN_TOTP_SECRET=BASE32_SECRET_REPLACE_ME

# --- Base de datos / Supabase ----------------------------------------------
# Backend usa service role; el navegador solo ve ANON_KEY.
SUPABASE_URL=https://olqdcudvstbawkcvsfdd.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service.role.replace_me
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.service.role.replace_me
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.anon.replace_me
# URL directa de PostgreSQL (puerto 5432) para backups y pg_dump.
SUPABASE_DB_URL=postgresql://postgres:replace_me@db.olqdcudvstbawkcvsfdd.supabase.co:5432/postgres
# Token de Management API para backups CI (GitHub Actions secret).
SUPABASE_ACCESS_TOKEN=sbp_replace_me

# --- Billing multi-proveedor -----------------------------------------------
# Proveedor por defecto para países fuera de UY/AR.
DEFAULT_BILLING_PROVIDER=lemonsqueezy
# Pausa registro y checkout global (false|0|no|off → 503 en todas las instancias).
ALLOW_NEW_SUBSCRIPTIONS=true

# Mercado Pago (UY/AR + monedas $|UYU|ARS|$U|USD)
SCANGO_MERCADOPAGO_ACCESS_TOKEN=APP_USR-123456789-replace_me
SCANGO_MERCADOPAGO_WEBHOOK_SECRET=replace_me_mp_webhook_secret
SCANGO_MERCADOPAGO_CURRENCY=USD
# Factores de conversión para monedas no USD (ejemplo):
# SCANGO_MERCADOPAGO_FX_UYU=39.50
# SCANGO_MERCADOPAGO_FX_ARS=950.00

# Stripe (resto del mundo)
SCANGO_STRIPE_SECRET_KEY=sk_test_replace_me
SCANGO_STRIPE_WEBHOOK_SECRET=whsec_replace_me
SCANGO_STRIPE_PRICE_STARTER_MONTHLY=price_test_replace_me
SCANGO_STRIPE_PRICE_STARTER_ANNUAL=price_test_replace_me

# Lemon Squeezy (fallback proveedor por defecto)
SCANGO_LEMONSQUEEZY_API_KEY=ls_live_replace_me
SCANGO_LEMONSQUEEZY_STORE_ID=12345
SCANGO_LEMONSQUEEZY_WEBHOOK_SECRET=replace_me_lemon_webhook_secret

# --- Email transaccional (Resend) ------------------------------------------
SCANGO_RESEND_API_KEY=re_replace_me
SCANGO_EMAIL_FROM=no-reply@scango.uy
# Pie legal de emails (dirección postal + motivo + baja).
COMPANY_POSTAL_ADDRESS=ScanGo, Calle Falsa 123, Montevideo, Uruguay
DMCA_EMAIL=dma@scango.uy

# --- Push Web (VAPID) ------------------------------------------------------
# Generar con: node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
SCANGO_VAPID_PUBLIC_KEY=BF_replace_me_vapid_public_key
SCANGO_VAPID_PRIVATE_KEY=replace_me_vapid_private_key
SCANGO_VAPID_SUBJECT=mailto:admin@scango.uy

# --- IA / importación de menús (Gemini Flash) ------------------------------
SCANGO_GEMINI_API_KEY=AIza_replace_me

# --- Monitoreo de errores (Sentry, opcional) -------------------------------
SCANGO_SENTRY_DSN=https://replace_me@sentry.io/project

# --- OAuth Google (login móvil, flujo redirect) ----------------------------
SCANGO_GOOGLE_CLIENT_ID=123456789012-abcdef.apps.googleusercontent.com
SCANGO_GOOGLE_CLIENT_SECRET=GOCSPX-replace_me
# Registrar https://<app>/api/auth/google/callback como URI de redirección en Google Cloud.

# --- Captcha invisible (Turnstile, Cloudflare) -----------------------------
SCANGO_TURNSTILE_SECRET=0x4AAAAAAA_replace_me

# --- Cron (endpoints /api/cron/*) ------------------------------------------
# Bearer/header requerido en producción. verifyCronAuth fail-closed.
SCANGO_CRON_SECRET=replace_me_cron_secret

# --- IndexNow (ping de motores de búsqueda) --------------------------------
# Generar con: node -e "console.log(require('crypto').randomUUID())"
# Debe matchear [0-9a-fA-F-]{8,64}. Sirve /{key}.txt y habilita el ping.
SCANGO_INDEXNOW_KEY=replace_me_uuid_indexnow
SCANGO_INDEXNOW_ENABLED=true

# --- QR de mesa / carrito grupal / tracking de pedido ----------------------
# Firma HMAC de QR de mesa (fallback a JWT_SECRET en dev).
SCANGO_GROUP_CART_SECRET=dev_group_cart_secret_replace_me
# Firma del token sin estado de seguimiento de pedido (orden de fallback:
# ORDER_TRACKING → GROUP_CART_SECRET → JWT_SECRET).
SCANGO_ORDER_TRACKING_SECRET=dev_order_tracking_secret_replace_me

# --- Telemetría y retención ------------------------------------------------
# Días de retención de telemetry_events (clamp [30,730], default 183).
TELEMETRY_RETENTION_DAYS=183

# --- Webhooks de pago idempotentes -----------------------------------------
# (sin variable adicional: se valida con los WEBHOOK_SECRET de cada proveedor)

# --- Descubrir / SEO / GEO -------------------------------------------------
# (sin variables extra: se derivan de APP_URL y la data del restaurante)

# --- Cookies / Clarity / Analítica -----------------------------------------
# Microsoft Clarity solo con consentimiento y ID real en <meta>.
SCANGO_CLARITY_ID=replace_me_clarity_project_id

# =============================================================================
# FIN .env.example
# =============================================================================
```

---

## 8. Matriz de responsabilidades y checklist de despliegue

### 8.1 ¿Quién gestiona qué?

| Actividad | Responsable | Herramienta |
|-----------|-------------|-------------|
| Crear `.env.local` | Cada desarrollador | Copia de `.env.example` |
| Agregar variable a Vercel | DevOps / Backend | Panel Vercel o `vercel env add` |
| Rotar clave de proveedor (MP/Stripe/Resend) | Backend + Finanzas | Panel del proveedor + Vercel |
| Rotar `SUPABASE_SERVICE_ROLE_KEY` | DevOps | Panel Supabase + Vercel + GitHub Secret |
| Revisar hallazgos de Semgrep / Gitleaks / OSV | Security Architect | CI + PR |
| Aprobar rotación de JWT / TOTP | Security Architect | PR + aviso en operaciones |
| Responder a fuga de secreto (commiteado) | Todo el equipo (incidente) | Rotación inmediata + gitleaks historial |

### 8.2 Checklist antes de cada despliegue a producción

- [ ] Ningún secreto real está commiteado (`git status` limpio de `.env` y `data/*.json`).
- [ ] `.env.example` actualizado si se agregaron o renombraron variables.
- [ ] Todas las variables requeridas en producción están en Vercel (no dependen de fallbacks de dev).
- [ ] `SCANGO_AUTH_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `SCANGO_ADMIN_TOTP_SECRET` presentes y válidos.
- [ ] `SCANGO_CRON_SECRET` configurado para los endpoints `/api/cron/*`.
- [ ] `SCANGO_INDEXNOW_KEY` (si se usa) matchea `[0-9a-fA-F-]{8,64}` y `/{key}.txt` desplegado.
- [ ] Semgrep y Gitleaks pasaron en CI.
- [ ] OSV-Scanner revisado (vulnerabilidades críticas/tendientes a parchear).
- [ ] Logs y Sentry no imprimen secretos ni query strings con `?secret=`.
- [ ] Documentación de rotación actualizada si cambió alguna clave.

---

## 9. Anexo: inventario de variables de entorno de ScanGo

| Variable | Entorno | Secreto | Fallback dev | Fail-closed en prod |
|----------|---------|---------|--------------|---------------------|
| `NODE_ENV` | Todos | No | `development` | No |
| `APP_URL` | Todos | No | `http://localhost:3000` | No |
| `PORT` | Local | No | `3000` | No |
| `SCANGO_AUTH_JWT_SECRET` | Todos | **Sí** | Solo si dev | **Sí** |
| `SCANGO_AUTH_SESSION_COOKIE_NAME` | Todos | No | `auth_token` | No |
| `SCANGO_AUTH_ADMIN_COOKIE_NAME` | Todos | No | `admin_token` | No |
| `SCANGO_ADMIN_KEY` | Todos | Sí | `/el-jefe` | No |
| `SCANGO_ADMIN_PATH` | Todos | No | `/el-jefe` | No |
| `SCANGO_ADMIN_TOTP_SECRET` | Todos | **Sí** | No | **Sí** |
| `SUPABASE_URL` | Todos | No | No | **Sí** |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend/CI | **Sí** | No | **Sí** |
| `SUPABASE_SERVICE_KEY` | Backend/CI | **Sí** | No | **Sí** |
| `SUPABASE_ANON_KEY` | Frontend + Backend | No | No | No |
| `SUPABASE_DB_URL` | Backend/CI (backups) | **Sí** | No | Sí (backups) |
| `SUPABASE_ACCESS_TOKEN` | CI | **Sí** | No | No |
| `DEFAULT_BILLING_PROVIDER` | Todos | No | `lemonsqueezy` | No |
| `ALLOW_NEW_SUBSCRIPTIONS` | Todos | No | `true` | No |
| `SCANGO_MERCADOPAGO_ACCESS_TOKEN` | Backend | **Sí** | No | 503 honesto |
| `SCANGO_MERCADOPAGO_WEBHOOK_SECRET` | Backend | **Sí** | No | Sí |
| `SCANGO_MERCADOPAGO_CURRENCY` | Todos | No | `USD` | No |
| `SCANGO_MERCADOPAGO_FX_*` | Backend | No | No | No |
| `SCANGO_STRIPE_SECRET_KEY` | Backend | **Sí** | No | 503 honesto |
| `SCANGO_STRIPE_WEBHOOK_SECRET` | Backend | **Sí** | No | Sí |
| `SCANGO_STRIPE_PRICE_*` | Backend | No | No | No |
| `SCANGO_LEMONSQUEEZY_API_KEY` | Backend | **Sí** | No | 503 honesto |
| `SCANGO_LEMONSQUEEZY_STORE_ID` | Backend | No | No | No |
| `SCANGO_LEMONSQUEEZY_WEBHOOK_SECRET` | Backend | **Sí** | No | Sí |
| `SCANGO_RESEND_API_KEY` | Backend | **Sí** | No | Error honesto |
| `SCANGO_EMAIL_FROM` | Backend | No | No | No |
| `COMPANY_POSTAL_ADDRESS` | Backend | No | No | No |
| `DMCA_EMAIL` | Backend | No | No | No |
| `SCANGO_VAPID_PUBLIC_KEY` | Frontend + Backend | No | No | No |
| `SCANGO_VAPID_PRIVATE_KEY` | Backend | **Sí** | No | 503 `PUSH_NOT_CONFIGURED` |
| `SCANGO_VAPID_SUBJECT` | Backend | No | No | No |
| `SCANGO_GEMINI_API_KEY` | Backend | **Sí** | No | Degrada a demo |
| `SCANGO_SENTRY_DSN` | Todos | No | No | No |
| `SCANGO_GOOGLE_CLIENT_ID` | Frontend + Backend | No | No | No |
| `SCANGO_GOOGLE_CLIENT_SECRET` | Backend | **Sí** | No | 503 honesto (móvil) |
| `SCANGO_TURNSTILE_SECRET` | Backend | **Sí** | No | Fail-open solo si CF inalcanzable |
| `SCANGO_CRON_SECRET` | Backend | **Sí** | No | **Sí** (401) |
| `SCANGO_INDEXNOW_KEY` | Backend | **Sí** | No | Desactiva feature |
| `SCANGO_INDEXNOW_ENABLED` | Backend | No | `true` (si key válida) | No |
| `SCANGO_GROUP_CART_SECRET` | Todos | **Sí** | Solo si dev | No |
| `SCANGO_ORDER_TRACKING_SECRET` | Todos | **Sí** | Solo si dev | No |
| `TELEMETRY_RETENTION_DAYS` | Backend | No | `183` | No |
| `SCANGO_CLARITY_ID` | Frontend | No | No | No-op honesto |

---

## 10. Decisión sobre ofuscación y señuelos (decoys)

Esta guía **no recomienda** la ofuscación de nombres de variables de entorno ni el despliegue de señuelos como control de seguridad principal, por las siguientes razones:

1. **Falsa sensación de seguridad:** un atacante con acceso al entorno (inyección, compromiso de servidor, dump de variables) leerá los secretos independientemente de cómo se llamen.
2. **Costo operativo:** renombrar variables rompe el contrato con Vercel, Supabase, CI y el código; los señuelos generan ruido en logs y alertas.
3. **Mantenibilidad:** cada nuevo integrante debe aprender un "diccionario secreto" en lugar de un estándar claro.

**Recomendación:** si el Orquestador y el Security & Architecture Architect desean capas adicionales, los señuelos pueden considerarse como **detección (honeytokens)** —por ejemplo, una variable `SCANGO_DECOY_KEY` que, si se usa, dispara una alerta— pero **nunca** como sustituto del almacenamiento cifrado, el mínimo privilegio, la rotación y el escaneo de secretos definido en esta guía.

---

### Fin de la guía

Próximos pasos sugeridos:
1. Revisar y aprobar esta guía por el Orquestador Principal y el Security & Architecture Architect.
2. Aplicar el `.env.example` en la rama principal.
3. Verificar que `.gitignore` cubre `.env` y `data/*.json`.
4. Confirmar que los jobs de CI (Semgrep, Gitleaks, OSV-Scanner) están activos en `.github/workflows/ci.yml`.
5. Programar la primera rotación de `SCANGO_AUTH_JWT_SECRET` y `SUPABASE_SERVICE_ROLE_KEY`.
