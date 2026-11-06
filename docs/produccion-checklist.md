# 🚀 Checklist de Puesta en Producción — ScanGo

> Estado: **en ejecución** · Última actualización: 2026-11-05
> Dominio objetivo: `scango.uy` (**activo**) · Prod viva: `https://www.scango.uy` (healthz healthy, DB cloud OK)
> **Host canónico: `https://www.scango.uy`** — el apex (`https://scango.uy`) también responde 200 (no hay redirect configurado): la cookie de sesión es host-only, así que el canónico debe ser www. El canonical/OG/JSON-LD de la landing y el sitemap ya apuntan a www; falta (manual, opcional) redirect apex→www en Vercel Domains.
> Pasarela global elegida: **Lemon Squeezy** · Latam: **Mercado Pago**

## Resumen de estado

| Área | Estado |
|---|---|
| Suite de tests (74) | ✅ 74/74 en verde en CI (Node 22+24, sin cloud) y local con cloud |
| Semgrep | ✅ 0 hallazgos |
| OSV-Scanner | ✅ re-auditado 2026-10-12: solo `braces@3.0.3` (dev-only, sin fix publicado, riesgo aceptado documentado) |
| Supabase cloud | ✅ esquema completo, migraciones 001–013 aplicadas y verificadas en runtime |
| Commits pusheados a `origin/main` | ✅ (migración de dominio `6b77654`…`fd59b2a`: CSP del hash inline, CSP de GIS, fallback FedCM, canonical www) |
| Secretos generados en `.env` local | ✅ JWT_SECRET, GROUP_CART_SECRET, CRON_SECRET (rotado), MERCADOPAGO_WEBHOOK_SECRET, INDEXNOW_KEY (`node -e "console.log(require('crypto').randomUUID())"`) |
| Fallbacks de dominio → `scango.uy` | ✅ (api/index.js, api/utils/seoDiscovery.js, email.js, orders.js, tests) |
| Verificador de env | ✅ `node scripts/check-prod-env.js` |
| Vercel CLI | ✅ instalado v63.1.2 (`npm i -g vercel`) + logueado/linkeado — el token de `%APPDATA%\com.vercel.cli\Data\auth.json` está **vencido** para la API REST: usar la CLI (`vercel ls`, `vercel inspect`, `vercel env`), no la API |
| Dominio DNS | ✅ `scango.uy` + `www.scango.uy` resuelven y sirven 200; `APP_URL=https://www.scango.uy`; MX raíz `mx1/mx2.improvmx.com`, SPF `include:spf.improvmx.com`, DMARC `p=none` (sin `rua`), DKIM `resend._domainkey` + `send.scango.uy` → `send.forge.rmta.net` publicados |
| Email real | ⛔ **BLOQUEANTE**: Resend responde 403 "The scango.uy domain is not verified" al enviar desde `pedidos@`/`hola@scango.uy`; `EMAIL_FROM` sigue en el sandbox `onboarding@resend.dev`, que **solo entrega al email del dueño de la cuenta** (`mat2001llorent@gmail.com`) y rebota 403 a cualquier otro destinatario. DNS publicados ≠ dominio verificado en la cuenta (la key del `.env` es send-only: `GET /domains` → 401 `restricted_api_key`) |
| Pasarela global | ⛔ sin Lemon Squeezy (API key, store, webhook, variants) |
| Google OAuth | ⚠️ flujo **verificado end-to-end en prod** (`/google/start?probe=1` → `ready:true`, `redirect_uri=https://www.scango.uy/api/auth/google/callback`, llega a `accounts.google.com`) + fallback FedCM en móvil; **falta confirmar que la pantalla de consentimiento esté en "Production"** (si está en *Testing*, solo entran los test users) |
| Deploy en Vercel | ✅ `https://www.scango.uy` viva (healthz 200, DB cloud, SSR, robots/sitemap dinámicos, IndexNow 200) — verificado 2026-11-05 |
| Contacto y datos legales | ✅ teléfono oficial `+598 93 640 039` (`wa.me/59893640039`) en landing, Studio, legales y `llms*.txt`; domicilio `Rambla República del Perú 815, Montevideo` en `/privacidad` y `/terminos`; sin razón social ni RUT (titular persona física); DMCA `soporte@scango.uy` |
| Sentry DSN | ⛔ pendiente (recomendado) |
| UptimeRobot | ⛔ pendiente (recomendado; hoy solo el workflow `uptime-check.yml` cada 6 h) |
| Play Store | ⏸️ fase 2 (Capacitor no instalado aún) |

### Verificación de producción — 2026-11-05 (medida, no supuesta)

| Check | Evidencia |
|---|---|
| Landing | `canonical`, `og:url`, `og:image`, `twitter:image` y el `url` del JSON-LD = `https://www.scango.uy` · **0** apariciones del apex en el HTML |
| Menú SSR | `/m/demo-heladeria` → canonical `https://www.scango.uy/m/demo-heladeria`, CSP estricta |
| Menús fantasma de fixtures | los 3 `csp-guard-*` → **404** (antes 200: menús de test indexados en producción) y fuera del sitemap |
| `/sitemap.xml` | 11 `<loc>`, todos bajo `https://www.scango.uy` |
| `/robots.txt` | dinámico, con `GPTBot`/`OAI-SearchBot`/`PerplexityBot`/`ClaudeBot`/`Google-Extended` y `Disallow` de `/studio`, `/admin`, `/el-jefe`, `/api/` |
| `/llms.txt` + `/llms-full.txt` | 200 |
| `/api/healthz` | `status: healthy` |
| `/api/menu/demo-heladeria` | 200 |
| IndexNow | `GET /<INDEXNOW_KEY>.txt` → 200 `text/plain`, body idéntico a la key |
| Altas | `POST /api/auth/register` con `{}` → **400** de validación (ya no 503 `SALES_CLOSED`; `ALLOW_NEW_SUBSCRIPTIONS=true` en Production y Preview) |
| Google | ver 2.5 |
| Email | ver 2.2 (único bloqueante real) |

---

## Fase 0 — Repositorio ✅

- [x] Push de commits pendientes: `git push origin main` → `f968e9f..3c882f4`
- [x] CI de GitHub valida en Node 22/24 (corre en cada push)

## Fase 1 — Código ✅

- [x] `api/index.js`: fallback de dominio `menupizarron.com` → `scango.uy` (robots dinámico, sitemap dinámico, OG/canonical SSR)
- [x] `api/utils/seoDiscovery.js`: compilador SEO/GEO puro (robots + IA, sitemap con sucursales, `OpeningHoursSpecification` derivado del horario real); los estáticos `public/robots.txt` y `public/sitemap.xml` fueron ELIMINADOS (sombra del dinámico en Vercel) y se sirven por Express en dev y prod (`vercel.json` los rutea a `/api/index.js`)
- [x] `api/services/email.js`: fallback del CTA del email → `scango.uy/studio`
- [x] `api/routes/orders.js`: `pedido@menupizarron.com` → `pedido@scango.uy`
- [x] Sitemap dinámico (Express): URLs absolutas con dominio (Google rechaza `<loc>/</loc>` relativo) — menús activos + sucursales + legales
- [x] Tests espejo actualizados (`test-menu-seo.js`, `test-email-notifications.js`)

## Fase 2 — Cuentas y servicios externos (manual, dashboard)

### 2.1. Dominio (arranque)
1. Usar el dominio `*.vercel.app` que asigna Vercel al linkear el proyecto.
2. **Comprar `scango.uy`** (registrar .uy: NIC Uruguay; o cualquier registrar para otro TLD).
3. Al estar disponible, en Vercel: *Project → Settings → Domains → Add `scango.uy`*.
4. DNS en el registrar: registro **A → `76.76.21.21`** (o CNAME `cname.vercel-dns.com`).
5. ⚠️ Al activar el dominio final (**hecho**):
   - `APP_URL` en Vercel = `https://www.scango.uy` (es la base que usan `api/utils/seoDiscovery.js`, el JSON-LD de las landings y el SSR `/m/*`).
   - `public/index.html` (OG/canonical/JSON-LD) apuntan a `https://www.scango.uy` desde `fd59b2a` — antes decían el apex y el sitemap decía www (señal contradictoria para Google).
   - `public/llms.txt` / `public/llms-full.txt`: enlaces relativos al host servido.
   - Re-deployar.
   - **Pendiente manual (opcional)**: configurar en *Vercel → Domains* el redirect `scango.uy` → `www.scango.uy`. Hoy **ambos hosts sirven 200** y el apex muestra el mismo sitio (contenido duplicado). El canónico ya apunta a www, así que Google consolida; el redirect solo lo hace explícito.

### 2.2. Resend (emails transaccionales) — BLOQUEANTE para clientes reales

**Estado verificado 2026-11-05 (API real, sin mocks):**

| Prueba | Resultado |
|---|---|
| `from: pedidos@scango.uy` / `hola@scango.uy` | ❌ 403 — `The scango.uy domain is not verified. Please add and verify your domain on https://resend.com/domains` |
| `from: onboarding@resend.dev` → `delivered@resend.dev` | ✅ 200 |
| `from: onboarding@resend.dev` → `destinatario.prueba.2026@gmail.com` | ❌ 403 — `You can only send testing emails to your own email address (mat2001llorent@gmail.com)` |
| `example.com` | ❌ 422 |
| `GET /domains` con la key del `.env` | ❌ 401 `restricted_api_key` (la key es send-only: no puede listar/crear dominios) |

Los registros DNS **ya están publicados** (DKIM `resend._domainkey.scango.uy`, `send.scango.uy` → `send.forge.rmta.net`, MX de ImprovMX en la raíz), pero el dominio **no está verificado en la cuenta de Resend**: publicar DNS no verifica nada por sí solo.

1. En [Resend](https://resend.com/domains): **Add Domain → `scango.uy`** (o reclamar el dominio si ya existe en otra cuenta/equipo).
2. Comparar los registros que da Resend con los publicados; si coincide todo, **Verify** debería pasar en minutos (si no, copiar los valores exactos que muestra Resend — pueden diferir de los actuales).
3. Crear remitente: *Email Addresses* → `pedidos@scango.uy` (o el que quieras).
4. Actualizar en Vercel (Production + Preview): `EMAIL_FROM=ScanGo <pedidos@scango.uy>` (NUNCA `onboarding@resend.dev`).
5. Redeployar y **enviar una prueba real a un Gmail que no sea el del dueño de la cuenta**: si llega, el bloqueante está cerrado (el 403 de "testing emails" es la señal exacta de que sigue en sandbox).

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

### 2.5. Google OAuth — verificado end-to-end, falta confirmar Consent Screen

**Estado verificado 2026-11-05 (producción real):**
- `GET /api/auth/google/start?probe=1&cb=…` → `{ready:true, salesClosed:false, clientId:"130484003654-…"}`.
- `GET /api/auth/google/start` responde alcanzando `accounts.google.com` con
  `redirect_uri=https://www.scango.uy/api/auth/google/callback` (el `GOOGLE_CLIENT_SECRET` está en Vercel).
- En navegador real (Playwright, service worker purgado): el click del modal de Google abre la pantalla de Google con el `client_id` y el `redirect_uri` correctos.
- Fallback FedCM (commit `03e3398`): en móvil/WebView, si `google.accounts.id.prompt()` no muestra nada (sin sesión de Google, `reason: 'unknown_reason'`), la landing navega al flujo redirect en vez de quedarse muda.

**Pendiente manual (1 solo punto):**
1. En [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services → OAuth consent screen**: confirmar que el *Publishing status* está en **In production** (no en *Testing*, que solo deja entrar a los *test users*).
2. En **Credentials** → el OAuth Client del `GOOGLE_CLIENT_ID`:
   - *Authorized JavaScript origins*: `https://www.scango.uy` (y opcionalmente `https://scango.uy` mientras el apex siga sirviendo 200).
   - *Authorized redirect URIs*: `https://www.scango.uy/api/auth/google/callback`.

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
| `APP_URL` | `https://www.scango.uy` (host limpio, sin Markdown ni barra final) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ANON_KEY` | de `.env` |
| `RESEND_API_KEY` / `EMAIL_FROM` | EMAIL_FROM = remitente verificado |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` | de `.env` |
| `MERCADOPAGO_ACCESS_TOKEN` / `MERCADOPAGO_WEBHOOK_SECRET` | de `.env` |
| `GOOGLE_CLIENT_ID` / `GEMINI_API_KEY` | de `.env` |
| `LEMONSQUEEZY_*` + `DEFAULT_BILLING_PROVIDER` | de 2.3 |
| `SENTRY_DSN` (opcional) | de 2.6 |
| `TURNSTILE_SECRET` / `TURNSTILE_SITEKEY` (opcional) | anti-farmeo del checkout |
| `INDEXNOW_KEY` | UUID/hex (`node -e "console.log(require('crypto').randomUUID())"`) — habilita el ping best-effort al guardar y sirve el archivo de verificación en `/{key}.txt` |

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

- [ ] **UptimeRobot**: monitor HTTP `https://<dominio>/api/healthz`, intervalo 5 min, falla si no 200. Mientras no exista, el workflow `.github/workflows/uptime-check.yml` golpea el health check cada 6 h desde GitHub (abre issue `[CAIDO]` si falla). UptimeRobot es la capa seria (intervalo corto + alertas por email/Telegram); el workflow es el fallback $0.
- [ ] **Sentry**: confirmar que `captureException` llega (generar un error a propósito o esperar el primer 4xx/5xx). Vars `SENTRY_DSN` en Vercel. Si no se quiere Sentry, al menos los logs de Vercel (Functions → Logs).
- [ ] **Backup de Supabase (Riesgo #1 — plan free sin backups ni PITR)**: activar el workflow `.github/workflows/backup-supabase.yml` (cron 02:10 UTC) configurando el secret `SUPABASE_DB_URL` en **Settings → Secrets and variables → Actions**:
  - Sacar la cadena en el dashboard de Supabase → **Settings → Database → Connection string → URI** (variante **pooler**, puerto **5432 en modo sesión** — la directa resuelve IPv6 y el runner de GitHub falla con `Network is unreachable`; el 6543 transaccional no soporta `pg_dump`, verificado 2026-10-29).
  - Formato pooler (modo sesión): `postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`. El password es el de la **base de datos**, no la anon/service key. El workflow reescribe solo una cadena directa o un 6543 al modo sesión, pero conviene dejar el secret ya correcto.
  - El workflow usa `pg_dump 17` vía Docker (el server es 17.6; el cliente de Ubuntu 24.04 es 16 y fallaría por mismatch de versión).
  - El workflow valida el dump (`pg_restore --list`) y lo sube como artifact (retención 90 días). OPCIONAL: crear un repo privado `backups-scango` en GitHub y configurar `BACKUP_REPO` (variable) + `BACKUP_REPO_TOKEN` (secret, PAT con scope `repo` a ese repo) para que además pushee `latest.dump`.
  - Restaurar si hiciera falta: `pg_restore --clean --if-exists --dbname "$SUPABASE_DB_URL" latest.dump` (probar en proyecto de staging primero).
  - **Ojo**: la conexión diaria amortigua la pausa por inactividad del plan free, pero NO es su garantía (la pausa se mide por actividad real de APIs). El backup existe para poder recuperar el proyecto tal cual si lo pausaran.
- [ ] **Kill-switch** documentado: `api/middleware/killSwitch.js` + panel admin.
- [ ] **Rotación de secretos**: documentar cuándo rotar `JWT_SECRET` (invalida sesiones) y `GROUP_CART_SECRET` (invalida QR de mesa activos).

## Fase 6 — Play Store (fase 2, opcional)

- [ ] `npm i @capacitor/core @capacitor/cli @capacitor/android`
- [ ] Copiar `mobile/capacitor.config.json` → raíz, `npx cap add android`
- [ ] `npm run mobile:sync`, firmar AAB (`android/app/release/app-release.aab`)
- [ ] Play Console: cuenta $25, ficha, íconos, capturas, política de privacidad = `https://<dominio>/privacidad`
- [ ] Ficha: sección "Borrado de cuenta/Data deletion" apuntando al modal del Studio (🏪 → Eliminar Cuenta), que ahora SÍ borra de verdad (punto 7).

## Fase 7 — Cierre de los 9 puntos de seguridad (auditorías)

Implementado en el repo y verificado por tests; resta solo lo que depende del deploy:

| # | Punto | Implementación | Estado |
|---|---|---|---|
| 1 | Backup Supabase (plan free sin backups) | `.github/workflows/backup-supabase.yml` (pg_dump diario 02:10 UTC + `pg_restore --list` + artifact 90d + push opcional a repo privado) | ⬅ **Configurar secret `SUPABASE_DB_URL`** |
| 2 | Auditoría de mutaciones (save/estado) | `auditService.logAction` conectado en `/api/studio/save` (`RESTAURANT_UPDATE`), orchestrator de webhooks (`SUBSCRIPTION_STATUS_CHANGE` / `SUBSCRIPTION_EVENT_STALE`) y moderación de reseñas (`REVIEW_MODERATED`). `test-account-erasure.js` lo verifica | ✔ |
| 3 | Secrets scan en CI | Job `secret-scan` en `.github/workflows/ci.yml`: gitleaks CLI v8.30.1 pin + verificación SHA256, `--redact`, historial completo | ✔ |
| 4 | CSV injection (CWE-1236) | `escapeCell` en `public/js/utils/csvExport.js` prefija `'` a celdas que arrancan con `= + - @ tab CR`; test en `test-analytics-business.js` | ✔ |
| 5 | Bucket público solo contenido público | Contrato documentado en `api/services/storage.js` (solo fotos platos/logos/reseñas; prohibido privado) + `deleteTenantFiles()` para el borrado de cuenta | ✔ |
| 6 | Webhooks fuera de orden (stale) | Guard de recency en `src/billing/orchestrator.js`: timestamp por provider (`lastWebhookEventAt`, providers exponen `eventCreatedAt`), evento viejo → 200 `{stale:true}` sin aplicar + audit. Test en `test-billing.js` §7 | ✔ |
| 7 | Derecho al olvido (borrado de cuenta real) | `POST /api/account/delete-request` (400 sin `confirm:true`, 401 anónimo, borra usuario+restaurante+asociados local/cloud+storage, sesión muerta, audit previo) + modal Studio cableado con confirmación escrita "ELIMINAR" y manejo honesto de errores. Test `test-account-erasure.js` | ✔ |
| 8 | PII en logs de email | `maskEmail`/`maskEmailList` en `api/services/email.js`: logs `To:` redactados (`j***@x.com`) | ✔ |
| 9 | Monitoreo $0 | `.github/workflows/uptime-check.yml` (cron 6h → `curl /api/healthz` → issue `[CAIDO]`) + checklist UptimeRobot/Sentry arriba | ⬅ **Crear UptimeRobot + `SENTRY_DSN`** |

Correr localmente: `npm test` (46 suites) y los individuales `npm run test:account-erasure`, `npm run test:billing`, `npm run test:analytics`, `npm run test:contract`.

## Notas de riesgo

- **`braces@3.0.3`** (CVE-2026-93687, HIGH, dev-only vía nodemon): sin versión corregida publicada. No bloquear; re-auditar en cada bump (`osv-scanner scan source -L package-lock.json`).
- **Cron en Vercel**: el plan **Hobby rechaza expresiones que corran más de una vez por día** (`0 * * * *`), y con eso **bloquea el deploy COMPLETO** (el deployment queda en `● Error` sin logs, sin llegar al build). Por eso `vercel.json` declara solo los 5 crons diarios/mensuales y los 2 horarios (`night-summary`, `reservation-reminders`) se invocan desde `.github/workflows/cron-hourly.yml` con `Bearer $CRON_SECRET` (secret obligatorio en **Settings → Secrets and variables → Actions**). Nunca agregar un cron sub-diario a `vercel.json` sin pasar a Pro.
- **`APP_URL` debe ser un host limpio**: un valor con Markdown pegado (`[https://x](https://x)`) no rompe el build pero corrompe el canonical/OG/JSON-LD del SSR y `CORS_ALLOWLIST`. Verificar el `<link rel="canonical">` de `/m/demo-heladeria` después de tocarla.
- **Cambiar APP_URL en prod invalida sesiones OAuth/cookies** (dominio de cookie): planificar el corte cuando se migre de `*.vercel.app` al dominio propio (mismo día, ventana baja).
- **No commitear `.env`**: está en `.gitignore`; los secretos ya generados viven solo en local + Vercel dashboard.