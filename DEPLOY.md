# 🚀 ScanGo - Guía de Despliegue y Configuración de Producción

## Tabla de Contenidos

1. [Resumen Rápido](#resumen-rápido)
2. [Variables de Entorno Requeridas](#variables-de-entorno-requeridas)
3. [Despliegue en Vercel](#despliegue-en-vercel)
4. [Configuración de Supabase](#configuración-de-supabase)
5. [Activar IndexNow (SEO)](#activar-indexnow-seo)
6. [Configuración de Mercado Pago](#configuración-de-mercado-pago)
7. [Configuración de VAPID (Push Notifications)](#configuración-de-vapid-push-notifications)
8. [Configuración de Google OAuth](#configuración-de-google-oauth)
9. [Checklist Pre-Despliegue](#checklist-pre-despliegue)
10. [Troubleshooting](#troubleshooting)

---

## Resumen Rápido

```bash
# 1. Clonar el repositorio
git clone https://github.com/Matllorent/ScanGo.git
cd ScanGo

# 2. Instalar dependencias
npm ci

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores reales

# 4. Desplegar en Vercel
vercel --prod
```

---

## Variables de Entorno Requeridas

Todas las variables deben configurarse en **Vercel Dashboard → Settings → Environment Variables** y en el archivo `.env` local.

### Críticas (obligatorias para producción)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `JWT_SECRET` | Firma de tokens de sesión | `tu-clave-secreta-muy-larga-y-segura` |
| `GROUP_CART_SECRET` | Secreto para carritos grupales QR | `tu-clave-grupo-cart` |
| `ORDER_TRACKING_SECRET` | Secreto para tokens de seguimiento de pedidos | `tu-clave-tracking` |
| `SUPABASE_URL` | URL de tu proyecto Supabase | `https://xxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave de servicio de Supabase (solo backend) | `sb_publishable_xxx` |
| `SUPABASE_ANON_KEY` | Clave anónima para Realtime en navegador | `sb_publishable_xxx` |
| `APP_URL` | URL pública de tu aplicación | `https://tu-dominio.vercel.app` |

### Opcionales (según funcionalidad)

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `MERCADOPAGO_ACCESS_TOKEN` | Token de acceso Mercado Pago | `TEST-xxx` |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secreto de webhook MP | `whsec_xxx` |
| `MERCADOPAGO_CURRENCY` | Moneda por defecto | `USD` |
| `STRIPE_SECRET_KEY` | Clave secreta Stripe | `sk_test_xxx` |
| `STRIPE_WEBHOOK_SECRET` | Webhook secreto Stripe | `whsec_xxx` |
| `STRIPE_PRICE_<PLAN>` | Price IDs de Stripe | `price_xxx` |
| `LEMONSQUEEZY_API_KEY` | API key LemonSqueezy | `xxx` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Webhook secreto Lemon | `xxx` |
| `LEMONSQUEEZY_STORE_ID` | ID de tienda LemonSqueezy | `xxx` |
| `LEMONSQUEEZY_VARIANT_<PLAN>` | IDs de variante LemonSqueezy | `xxx` |
| `RESEND_API_KEY` | Clave API Resend (emails) | `re_xxx` |
| `EMAIL_FROM` | Remitente de emails | `noreply@scango.uy` |
| `GEMINI_API_KEY` | Clave API Gemini Flash (IA menús) | `xxx` |
| `GOOGLE_CLIENT_ID` | ID cliente Google OAuth | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Secreto OAuth Google | `xxx` |
| `VAPID_PUBLIC_KEY` | Clave pública VAPID (push) | `BN...` |
| `VAPID_PRIVATE_KEY` | Clave privada VAPID | `...` |
| `VAPID_SUBJECT` | Asunto VAPID | `mailto:soporte@scango.uy` |
| `INDEXNOW_KEY` | Clave de verificación IndexNow (UUID) | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `INDEXNOW_ENABLED` | Habilitar IndexNow | `true` |
| `TELEMETRY_RETENTION_DAYS` | Días de retención telemetría | `183` |
| `AUDIT_RETENTION_DAYS` | Días de retención auditoría | `365` |
| `ALLOW_NEW_SUBSCRIPTIONS` | Pausar registros (`false` para pausar) | `true` |
| `ADMIN_TOTP_SECRET` | Secreto 2FA panel admin | `JBSWY3DPEHPK3PXP` |
| `ADMIN_KEY` | Clave maestra panel `/el-jefe` | `tu-clave-maestra` |
| `ADMIN_PATH` | Ruta ofuscada panel admin | `/el-jefe` |

---

## Despliegue en Vercel

### 1. Conectar el repositorio

1. Ve a [Vercel Dashboard](https://vercel.com/dashboard)
2. Haz clic en **"Add New Project"**
3. Importa tu repositorio de GitHub: `Matllorent/ScanGo`
4. Configura:
   - **Framework Preset:** None (o Express.js)
   - **Build Command:** `npm ci` (o dejar vacío)
   - **Output Directory:** Dejar vacío o `.`
   - **Install Command:** `npm ci`

### 2. Agregar Variables de Entorno

En Vercel Dashboard → **Settings → Environment Variables**, agrega TODAS las variables listadas arriba en **ambos** entornos:
- **Production** (para producción)
- **Preview** (para previsualizaciones)
- **Development** (para desarrollo local, opcional)

### 3. Desplegar

```bash
vercel --prod
```

O usa el botón **Deploy** en el dashboard de Vercel.

---

## Configuración de Supabase

### 1. Crear Proyecto

1. Ve a [Supabase Dashboard](https://app.supabase.com)
2. Crea un nuevo proyecto
3. Obtén la URL y las claves de configuración

### 2. Ejecutar Migraciones

Ve al **SQL Editor** en Supabase y ejecuta en orden:

1. `src/db/migrations/001_realtime_operations_tables.sql`
2. `src/db/migrations/002_realtime_channel_guard.sql`
3. `src/db/migrations/003_loyalty_notifications.sql`
4. `src/db/migrations/004_order_tracking.sql`
5. `src/db/migrations/005_order_tips.sql`
6. `src/db/migrations/006_loyalty_claim_rpc.sql`

### 3. Configurar RLS

Asegúrate de que Row Level Security esté habilitado en todas las tablas. El backend usa `service_role` para todas las operaciones.

---

## 🔴 Activar IndexNow (SEO)

IndexNow notifica a Bing, Yandex, Seznam y Naver cuando se actualiza tu contenido, permitiendo indexación casi inmediata.

### Paso 1: Generar la clave

Ejecuta en tu terminal:

```bash
node -e "console.log(require('crypto').randomUUID())"
```

Esto generará algo como: `a1b2c3d4-e5f6-7890-abcd-ef1234567890`

### Paso 2: Agregar en Vercel Dashboard

Ve a **Settings → Environment Variables** y agrega:

| Variable | Valor |
|----------|-------|
| `INDEXNOW_KEY` | `a1b2c3d4-e5f6-7890-abcd-ef1234567890` (tu UUID) |
| `INDEXNOW_ENABLED` | `true` |

### Paso 3: Verificar

Visita: `https://tu-dominio.vercel.app/a1b2c3d4-e5f6-7890-abcd-ef1234567890.txt`

Debe devolver exactamente la clave que configuraste.

### Paso 4: Cómo funciona

Cuando el dueño guarda su menú (`POST /api/studio/save`), el sistema automáticamente:
1. Genera las URLs canónicas (`/m/:slug` y `/m/:slug?branch=x`)
2. Envía un ping a `https://api.indexnow.org/indexnow` con las URLs
3. Bing, Yandex, Seznam y Naver indexan la página casi inmediatamente

---

## Configuración de Mercado Pago

### 1. Crear Cuenta de Desarrollador

1. Ve a [Mercado Pago Developers](https://www.mercadopago.com/developers)
2. Crea una aplicación
3. Obtén tu `Access Token` y `Webhook Secret`

### 2. Configurar Webhook

En el panel de Mercado Pago:
- **URL:** `https://tu-dominio.vercel.app/api/billing/webhook/mercadopago`
- **Eventos:** `payment`

### 3. Variables de Entorno

| Variable | Origen |
|----------|--------|
| `MERCADOPAGO_ACCESS_TOKEN` | Credenciales de aplicación MP |
| `MERCADOPAGO_WEBHOOK_SECRET` | Webhook secreto MP |
| `MERCADOPAGO_CURRENCY` | `USD` o `UYU` |

---

## Configuración de VAPID (Push Notifications)

### 1. Generar Claves VAPID

Ejecuta en tu terminal:

```bash
node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"
```

### 2. Agregar en Vercel

| Variable | Valor |
|----------|-------|
| `VAPID_PUBLIC_KEY` | `BN...` (clave pública) |
| `VAPID_PRIVATE_KEY` | `...` (clave privada) |
| `VAPID_SUBJECT` | `mailto:soporte@scango.uy` |

---

## Configuración de Google OAuth (Login Móvil)

### 1. Google Cloud Console

1. Ve a [Google Cloud Console](https://console.cloud.google.com/)
2. Crea un proyecto o selecciona uno existente
3. Habilita la **Google Identity Services API**
4. Crea credenciales: **ID de cliente de OAuth 2.0**
5. Tipo de aplicación: **Aplicación web**
6. Orígenes de JavaScript autorizados: `https://tu-dominio.vercel.app`
7. URIs de redirección autorizados: `https://tu-dominio.vercel.app/api/auth/google/callback`

### 3. Variables de Entorno

| Variable | Valor |
|----------|-------|
| `GOOGLE_CLIENT_ID` | `xxx.apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | `GOCSPX-xxx` |

---

## Checklist Pre-Despliegue

- [ ] `.env` no está commiteado (verificar en `.gitignore`)
- [ ] `.env.example` tiene solo placeholders
- [ ] Todas las variables de entorno configuradas en Vercel
- [ ] `INDEXNOW_KEY` generada y configurada en Vercel
- `INDEXNOW_ENABLED=true` configurado
- `SUPABASE_SERVICE_ROLE_KEY` solo en backend (no en navegador)
- `ADMIN_TOTP_SECRET` configurado en producción (fail-closed en boot)
- Migraciones 001-006 aplicadas en Supabase
- Webhooks de Mercado Pago configurados
- Google OAuth URI de redirección configurada
- Pruebas de carga k6 ejecutadas (`npm run test:k6:all`)
- `npm test` pasando (54/54 tests)
- `npm run check` pasando (8/8 HARD checks)

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `401` en `/api/cron/*` | Verificar `CRON_SECRET` en Vercel |
| `403` en `/api/studio/save` | Verificar `ADMIN_TOTP_SECRET` en Vercel |
| `503 PUSH_NOT_CONFIGURED` | Configurar `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` |
| `503 PAYMENT_PROVIDER_NOT_CONFIGURED` | Configurar `MERCADOPAGO_ACCESS_TOKEN` |
| `IndexNow` no funciona | Verificar `INDEXNOW_KEY` y que `{key}.txt` es accesible |
| Sesión expira rápido | Verificar `JWT_SECRET` y `ADMIN_TOTP_SECRET` |
| `SUPABASE_SERVICE_ROLE_KEY` no está expuesta al frontend | Verificar que `SUPABASE_ANON_KEY` es la única en el frontend |

---

## Comandos Útiles

```bash
# Generar clave IndexNow
node -e "console.log(require('crypto').randomUUID())"

# Generar par VAPID
node -e "const w=require('web-push');console.log(w.generateVAPIDKeys())"

# Verificar despliegue
curl https://tu-dominio.vercel.app/api/healthz

# Verificar IndexNow
curl https://tu-dominio.vercel.app/TU-CLAVE.txt

# Ejecutar tests
npm test

# Ejecutar tests de carga
npm run test:k6:all
```

---

## Soporte

Para soporte, contacta: `soporte@scango.uy` o abre un issue en GitHub.
