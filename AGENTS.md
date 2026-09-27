# AGENCIAS.md

## Proyecto

SaaS de menús digitales QR con pedidos por WhatsApp y suscripción recurrente. Express 5 + frontend estático (sin build step) + wrapper Capacitor para Android. Deploy en Vercel.

## Comandos

```bash
npm run dev          # desarrollo con nodemon (puerto 3000)
npm start            # producción
npm test             # todos los tests (secuencial, ver abajo)
npm run test:billing # test individual (también: :fixes, :features, :security, :layouts, :mp-upsell, :geo, :group-cart)
npm run mobile:sync  # sincronizar Capacitor
npm run mobile:build # copiar web a Android
```

## Arquitectura

- **Backend**: `api/index.js` (~1360 líneas) es el entrypoint principal con rutas inline. Routers modulares en `api/routes/`. Middleware en `api/middleware/`.
- **Frontend**: `public/` — HTML/CSS/JS plano, sin bundler ni framework. `menu.html` es el visor de menú público, `studio.html` el panel de restaurante, `admin.html` el panel maestro.
- **Base de datos**: dual-mode. Por defecto usa archivos JSON en `data/` (`restaurants.json`, `users.json`, etc.). Si hay `SUPABASE_URL` + key en env, sincroniza desde Supabase PostgreSQL al arrancar y escribe en ambos.
- **Billing**: multi-proveedor vía `src/billing/orchestrator.js` — Lemon Squeezy (default), Stripe, Mercado Pago (auto-selecciona para UY/AR).
- **Mobile**: Capacitor (`mobile/capacitor.config.json`), webDir apunta a `public/`.
- **Deploy**: `vercel.json` rutea `/api/*` → `api/index.js`, `/m/*` → `public/menu.html`, `/studio` → `public/studio.html`, `/admin` → `public/admin.html`.

## Testing

- Tests con `assert` de Node puro — sin framework (no Jest/Mocha).
- **Los tests mutan `data/*.json`** — crean restaurantes y usuarios reales en el store local. No son aislados.
- `tests/test-e2e.js` existe pero **no está incluido** en `npm test`.
- Para correr un test individual: `node tests/test-billing.js` o `npm run test:billing`.

## Configuración

Copiar `.env.example` → `.env`. Variables críticas: `JWT_SECRET`, `ADMIN_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, y las keys de cada pasarela de pago.

## Convenciones

- Cero mocks: flujos reales con DB y pasarelas de pago (ver `.cursorrules`).
- Mantener sincronizadas las rutas de API con las vistas del panel de administración.
- Sin linter ni formatter configurado. Sin CI/CD (no hay `.workspace/ci`).
- `tsconfig.json` existe pero el app corre JS puro — no hay paso de compilación.
