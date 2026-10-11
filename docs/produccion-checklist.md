# 🚀 Checklist de Puesta en Producción — ScanGo / Menú Pizarrón SaaS

> Estado: **en ejecución** · Última actualización: 2026-10-11
> Dominio objetivo: `scango.uy` (a comprar) · Dominio de arranque: `*.vercel.app`
> Pasarela global elegida: **Lemon Squeezy** · Latam: **Mercado Pago**

## Resumen de estado

| Área | Estado |
|---|---|
| Suite de tests (37) | ✅ 37/37 en verde (incluye Realtime real y CSP 53/53) |
| Semgrep | ✅ 0 hallazgos |
| OSV-Scanner | ✅ solo `braces@3.0.3` (dev-only, riesgo aceptado documentado) |
| Supabase cloud | ✅ esquema completo, migraciones 001–006 aplicadas y verificadas en runtime |
| Commits pusheados a `origin/main` | ✅ (`68720df`, `3c882f4`) |
| Secretos generados en `.env` local | ✅ JWT_SECRET, GROUP_CART_SECRET, CRON_SECRET, MERCADOPAGO_WEBHOOK_SECRET |
| Fallbacks de dominio → `scango.uy` | ✅ (api/index.js, email.js, orders.js, tests, sitemap.xml) |
| Verificador de env | ✅ `node scripts/check-prod-env.js` |
| Vercel CLI | 🕐 instalando (`npm i -g vercel`) |
| Dominio DNS | ⛔ `scango.uy` NO resuelve — hay que registrarlo/comprarlo |
| Email real | ⛔ `EMAIL_FROM` usa `@resend.dev` — falta verificar dominio en Resend |
| Pasarela global | ⛔ sin Lemon Squeezy (API key, store, webhook, variants) |
| Google OAuth origin | ⛔ falta agregar el dominio de prod en Google Cloud Console |
| Deploy en Vercel | ⛔ pendiente |
| Sentry DSN | ⛔ pendiente (recomendado) |
| UptimeRobot | ⛔ pendiente (recomendado) |
| Play Store | ⏸️ fase 2 (Capacitor no instalado aún) |

---

## Fase 0 — Repositorio ✅

- [x] Push de commits pendientes: `git push origin main` → `f968e9f..3c882f4`
- [x] CI de GitHub valida en Node 22/24 (corre en cada push)

## Fase 1 — Código ✅

- [x] `api/index.js`: fallback de dominio `menupizarron.com` → `scango.uy` (robots dinámico, sitemap dinámico, OG/canonical SSR)
- [x] `api/services/email.js`: fallback del CTA del email → `scango.uy/studio`
- [x] `api/routes/orders.js`: `pedido@menupizarron.com` → `pedido@scango.uy`
- [x] `public/sitemap.xml`: URLs absolutas con dominio (Google rechaza `<loc>/</loc>` relativo)
- [x] Tests espejo actualizados (`test-menu-seo.js`, `test-email-notifications.js`)

## Fase 2 — Cuentas y servicios externos (manual, dashboard)

### 2.1. Dominio (arranque)
1. Usar el dominio `*.vercel.app` que asigna Vercel al linkear el proyecto.
2. **Comprar `scango.uy`** (registrar .uy: NIC Uruguay; o cualquier registrar para otro TLD).
3. Al estar disponible, en Vercel: *Project → Settings → Domains → Add `scango.uy`*.
4. DNS en el registrar: registro **A → `76.76.21.21`** (o CNAME `cname.vercel-dns.com`).
5. ⚠️ Al activar el dominio final:
   - Actualizar `APP_URL` en Vercel a `https://scango.uy`.
   - `public/robots.txt` (Sitemap:) y `public/sitemap.xml` (base), `public/index.html` (OG/canonical hardcodeados) y `public/llms.txt`.
   - Re-deployar.

### 2.2. Resend (emails transaccionales) — BLOQUEANTE para clientes reales
1. En [Resend](https://resend.com/domains): **Add Domain → `scango.uy`** (o el dominio comprado).
2. Agregar los registros DNS que da Resend (SPF `include:amazonses.com`… y DKIM `resend._domainkey`).
3. Verificar el dominio (botón *Verify*).
4. Crear remitente: *Email Addresses* → `pedidos@scango.uy` (o el que quieras).
5. Actualizar en Vercel: `EMAIL_FROM=pedidos@scango.uy` (NUNCA `onboarding@resend.dev`).

### 2.3. Lemon Squeezy (pasarela global) — BLOQUEANTE para vender fuera de UY/AR
1. Crear cuenta en [lemonSqueezy](https://www.lemonsqueezy.com) y completar merchant onboarding.
2. **Productos** (uno por plan, con los precios de `src/billing/plans.json`):
   - Starter Mensual — USD 9 · Starter Anual — USD 79
   - Pro Mensual — USD 19 · Pro Anual — USD 159
3. Anotar el **variant ID** de cada uno (URL del store `/buy/<variant_id>` o API).
4. **Settings → Webhooks → Add**: URL `https://<tu-dominio>/api/billing/webhook/lemonsqueezy`, secret random → ese es `LEMONSQUEEZY_WEBHOOK_SECRET`.
5. En Vercel: `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_PLAN_MONTHLY_VARIANT_ID`, `LEMONSQUEEZY_PLAN_ANNUAL_VARIANT_ID`, `DEFAULT_BILLING_PROVIDER=lemonsqueezy`.

### 2.4. Mercado Pago (Latam)
- Ya está el token de producción. Falta **configurar el deep link de cobro**: el server genera el `notification_url` con `?secret=<MERCADOPAGO_WEBHOOK_SECRET>` (ya generado). Verificar en [MP Developers](https://www.mercadopago.com.uy/developers) que la app acepte webhooks del dominio.

### 2.5. Google OAuth
- En [Google Cloud Console](https://console.cloud.google.com/) → Credenciales → el OAuth Client del `GOOGLE_CLIENT_ID`:
  - *Authorized JavaScript origins*: agregar `https://<tu-dominio>`.
  - *Authorized redirect URIs*: `https://<tu-dominio>/api/auth/google/callback`.

### 2.6. Sentry (monitoreo) — recomendado
1. Proyecto nuevo → copiar DSN.
2. En Vercel: `SENTRY_DSN`, `SENTRY_ENVIRONMENT=production`, `SENTRY_TRACES_SAMPLE_RATE=0.1`.

## Fase 3 — Secretos y Env en Vercel

Con `vercel link` hecho, setear en **Vercel → Project → Settings → Environment Variables** (Production + Preview):

| Var | Valor |
|---|---|
| `NODE_ENV` | `production` (Vercel lo setea solo; no es necesario) |
| `JWT_SECRET` | de `.env` local (generado) |
| `ADMIN_KEY` | de `.env` |
| `ADMIN_TOTP_SECRET` | de `.env` |
| `GROUP_CART_SECRET` | de `.env` (generado) |
| `CRON_SECRET` | de `.env` (generado) |
| `APP_URL` | `https://<tu-dominio.vercel.app>` |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | de `.env` |
| `RESEND_API_KEY` / `EMAIL_FROM` | EMAIL_FROM = remitente verificado |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | de `.env` |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` | de `.env` |
| `GOOGLE_CLIENT_ID` / `GEMINI_API_KEY` | de `.env` |
| `LEMONSQUEEZY_*` + `DEFAULT_BILLING_PROVIDER` | de 2.3 |
| `SENTRY_DSN` (opcional) | de 2.6 |
| `TURNSTILE_SECRET` / `TURNSTILE_SITEKEY` (opcional) | anti-farmeo del checkout |

**Verificación pre-deploy**: `node scripts/check-prod-env.js --strict` (lee `.env` local; para Vercel confiá en el dashboard + el healthz post-deploy).

## Fase 4 — Deploy Vercel

```bash
npm i -g vercel        # ok: ya instalando
vercel login           # abrir navegador, cuenta con GitHub (Matllorent/ScanGo)
vercel link            # enlazar al repo → crea .vercel/project.json
vercel env pull .env.production   # (opcional) tirás las env del dashboard
vercel --prod          # build + deploy
vercel domains         # listar el dominio *.vercel.app asignado
```

### Post-deploy — verificación integral

| Check | Comando/URL | Resultado esperado |
|---|---|---|
| API viva | `curl https://<dominio>/api/healthz` | `200`, `database.connected:true`, `schema.missing:[]` |
| Landing | `https://<dominio>/` | 200, CSP transicional, OG `scango.uy` correcto |
| Menú SSR | `https://<dominio>/m/demo` | 200, CSP estricta, JSON-LD |
| Menú API | `https://<dominio>/api/menu/demo-heladeria` | 200 con `isDemo` |
| Studio | `https://<dominio>/studio` | 200 (HTML estático; APIs piden auth) |
| Admin | `https://<dominio>/admin` | 200 |
| Legales | `/terminos` `/privacidad` `/cookies` `/reembolsos` `/aviso-legal` | 5× 200 |
| Headers duros | `curl -I https://<dominio>/` | CSP, HSTS, X-Frame-Options, etc. |
| Cron | `curl -H "Authorization: Bearer $CRON_SECRET" https://<dominio>/api/cron/billing-dunning` | 200 |
| E2E real | `node tests/test-e2e.js` (requiere MP real) | registro + checkout real + webhook |

## Fase 5 — Monitoreo y operación

- [ ] **UptimeRobot**: monitor HTTP `https://<dominio>/api/healthz`, intervalo 5 min, falla si no 200.
- [ ] **Sentry**: confirmar que `captureException` llega (generar un error a propósito o esperar el primer 4xx/5xx).
- [ ] **Backup Supabase**: activar PITR o al menos backups diarios (Dashboard → Database → Backups).
- [ ] **Kill-switch** documentado: `api/middleware/killSwitch.js` + panel admin.
- [ ] **Rotación de secretos**: documentar cuándo rotar `JWT_SECRET` (invalida sesiones) y `GROUP_CART_SECRET` (invalida QR de mesa activos).

## Fase 6 — Play Store (fase 2, opcional)

- [ ] `npm i @capacitor/core @capacitor/cli @capacitor/android`
- [ ] Copiar `mobile/capacitor.config.json` → raíz, `npx cap add android`
- [ ] `npm run mobile:sync`, firmar AAB (`android/app/release/app-release.aab`)
- [ ] Play Console: cuenta $25, ficha, íconos, capturas, política de privacidad = `https://<dominio>/privacidad`

## Notas de riesgo

- **`braces@3.0.3`** (CVE-2026-93687, HIGH, dev-only vía nodemon): sin versión corregida publicada. No bloquear; re-auditar en cada bump (`osv-scanner scan source -L package-lock.json`).
- **Cron en Vercel**: `vercel.json` lo define (`0 2 * * *`). Verificar que el plan de Vercel permita crons; caso contrario mover el dunning a un cron externo (GitHub Actions/UptimeRobot) apuntando al endpoint con `CRON_SECRET`.
- **Cambiar APP_URL en prod invalida sesiones OAuth/cookies** (dominio de cookie): planificar el corte cuando se migre de `*.vercel.app` al dominio propio (mismo día, ventana baja).
- **No commitear `.env`**: está en `.gitignore`; los secretos ya generados viven solo en local + Vercel dashboard.