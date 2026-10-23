# Análisis Competitivo — ScanGo vs Elmenu.uy, LoopVisit, DougMenu

**Fecha:** 23 Oct 2026  
**Analista:** Product & Competitor Analyst  
**Alcance:** Mercado Uruguay / Latam — Menús digitales QR + Fidelización

---

## Resumen Ejecutivo

| Plataforma | Tipo | Posicionamiento | Precio entrada | Amenaza para ScanGo |
|------------|------|-----------------|----------------|---------------------|
| **Elmenu.uy** | Menú digital + pedidos + delivery | "Todo en uno" local, hecho en Uruguay | $0 (gratis) → ~$30-50 USD/mes | **ALTA** — Competidor directo en Uruguay, misma propuesta de valor |
| **LoopVisit** | Fidelidad digital (Wallet-native) | Especialista en lealtad, no menús | USD 25/mes + IVA | **MEDIA** — Complementario, pero su wallet-native roba mindshare de fidelización |
| **DougMenu** | *No identificado como jugador relevante* | — | — | **BAJA** — Sin presencia web detectable en Latam/Uruguay |

> **Conclusión clave:** Elmenu.uy es la amenaza real. LoopVisit no compite en menús pero sí en fidelización (su wallet-native es superior al nuestro). DougMenu no existe como competidor detectable.

---

## 1. Elmenu.uy — Análisis Profundo

### 1.1 Modelo de Negocio & Pricing

| Plan | Precio (USD/mes) | Precio (UYU/mes) | Incluye |
|------|------------------|------------------|---------|
| **Básico** | $30 → $25 (promo) | ~$12.000 | Solo carta digital, QR, panel admin |
| **Delivery** | $75 → $50 | ~$24.000 | Carta + carrito + pedidos WhatsApp + delivery + tracking + multiidioma |
| **Premium** | $120 → $99 | ~$47.000 | Todo Delivery + pedidos mesa + carrito individual + mozos + panel tiempo real + soporte 24/7 |
| **Enterprise | A medida | A medida | Cadenas, multi-sucursal, SLA |

**Modelo:** SaaS puro, sin comisión por pedido.  
**Trial:** 7 días gratis, sin tarjeta.  
**Upsell cross:** Red publicitaria "Publicita en Fowst" (banners rotativos en todos los menús de la red).

### 1.2 Flujos de Pedido

```
QR en mesa → Menú web (multiidioma auto Google Translate) → Carrito individual por comensal (hasta 10 simultáneos)
    ↓
Checkout: WhatsApp (delivery/retiro) O Pago online (pasarelas no explicitadas en web)
    ↓
Panel tiempo real: Estado por mesa, notificaciones "comida lista", KDS básico
```

**Diferenciador:** Carrito **individual por persona** en mesa (hasta 10), no carrito grupal único. Cada comensal arma su pedido y el panel consolida.

### 1.3 Diseño Visual & UX

- **Temas:** No explícitos en web; "editor visual" + "carta precargada"
- **Multiidioma:** Google Translate automático (100+ idiomas) — **fortaleza para turismo**
- **Responsive:** Menú web estándar, sin PWA mencionado
- **Accesibilidad:** No documentada

### 1.4 Fidelización

**No tiene módulo nativo de fidelización.** El panel muestra "Tracking de clientes" y "Gestión de pedidos" pero no puntos/sellos/wallet.

### 1.5 Panel Dueño (Studio)

- Editor visual drag-and-drop
- Carta precargada (onboarding asistido)
- Subida ilimitada de imágenes
- Múltiples monedas (UYU/USD)
- QR personalizado
- Backups automáticos
- Panel tiempo real con estado por mesa
- Analytics: escaneos QR por día/semana/mes, filtro por sucursal/mesa, exportación

### 1.6 Integraciones

| Categoría | Detalle |
|-----------|---------|
| **Pagos** | No explicitan pasarelas (Mercado Pago probable en UY) |
| **WhatsApp** | Pedidos por WhatsApp nativo (click-to-chat) |
| **POS** | No documentado |
| **Delivery** | Sistema propio de delivery + gestión repartidores (plan Premium) |
| **Otros** | Google Translate API, red publicitaria propia |

### 1.7 Diferenciadores Técnicos

| Feature | Estado |
|---------|--------|
| PWA / Offline | "Funciona offline una vez cargado" (menú), pedidos requieren conexión |
| Realtime | Panel tiempo real (WebSocket probable) |
| Multi-tenant | Sí, multi-sucursal en Enterprise |
| White-label | No documentado |
| QR por mesa | Sí, individual |

### 1.8 Fortalezas vs ScanGo

| Fortaleza | Por qué duele |
|-----------|---------------|
| **Hecho en Uruguay** — Soporte local por WhatsApp, facturación local, impuestos locales | ScanGo es "extranjero" (aunque opere en UY) |
| **Google Translate nativo** — 100+ idiomas sin configuración | ScanGo requiere setup manual de traducciones |
| **Carrito individual por comensal** — Resuelve el problema "una persona pide para todos" | ScanGo usa carrito grupal + GroupCartManager |
| **Delivery integrado + repartidores** — Plan Premium incluye logística | ScanGo solo da el pedido; logística es problema del dueño |
| **Red publicitaria (Fowst Ads)** — Monetiza el tráfico de otros | Nuevo revenue stream que ScanGo no tiene |
| **Precios en UYU** — Sin riesgo cambiario para el comerciante | ScanGo cobra en USD |

### 1.9 Debilidades vs ScanGo

| Debilidad | Oportunidad ScanGo |
|-----------|-------------------|
| **Sin fidelización nativa** — Pierden retention post-pedido | ScanGo tiene **dual loyalty** (local + red global) + wallet |
| **Sin IA para importar menú** — "Carta precargada" = la cargan ellos manual | ScanGo tiene **Gemini Flash multimodal** (foto → menú en min) |
| **Sin propina integrada** — No mencionan tip en checkout | ScanGo tiene tip calculator + propina separada en analytics |
| **Sin seguimiento de pedido para comensal** — Solo panel dueño | ScanGo tiene **order tracking token + push dirigido** |
| **Sin temas visuales diferenciados** — Editor genérico | ScanGo tiene **10 layouts × 29 temas + neon multi-acento + explosivo** |
| **Sin PWA instalable real** — "Offline" solo cache estático | ScanGo tiene PWA + CTA instalación + service worker robusto |
| **Sin derechos RGPD/Ley 18.331** — No mencionan borrado de cuenta | ScanGo tiene **account erasure real + auditoría** |

---

## 2. LoopVisit — Análisis Profundo

### 2.1 Modelo de Negocio & Pricing

| Plan | Precio | Incluye |
|------|--------|---------|
| **Regular** | USD 25/mes + IVA (~$1.000 UYU) | 1 local, 1 tarjeta (sellos O puntos), hasta 100 clientes activos/mes, escáner equipo, gift cards, birthday rewards, avisos, base clientes |
| **Pro** | USD 49/mes + IVA (~$1.950 UYU) | Hasta 3 locales, hasta 500 clientes activos, hasta 3 tarjetas distintas, aviso automático "te extrañamos" (pronto), soporte 24/7 WhatsApp |
| **Empresas | Desde USD 99/mes + IVA | 3+ locales (aviso cercanía hasta 10), clientes ilimitados, precio a medida, puesta en marcha con equipo |

**Modelo:** SaaS por local, wallet-native (Apple Wallet + Google Wallet).  
**Trial:** 14 días gratis, sin tarjeta.

### 2.2 Fidelización — Core Product

| Mecánica | Detalle |
|----------|---------|
| **Sellos** | 1 visita = 1 sello. Dueño define cuántos completan tarjeta + premio. Ideal cafés, heladerías, barberías |
| **Puntos** | Puntos por compra (configurable). Catálogo de premios canjeables. |
| **Gift Cards** | Saldo regalable con número de tarjeta. Próximamente en web. |
| **Wallet-native** | **Clave:** Cliente guarda en Apple/Google Wallet **sin app**. Escanea QR en mostrador → suma sello/puntos. |
| **Cercanía** | Notificaciones por geofence (requiere permisos cliente) |
| **Automatizaciones** | "Te extrañamos" (win-back), cumpleaños (próximamente en Pro) |
| **Branding** | Colores, ícono, premio personalizados. La tarjeta lleva identidad del comercio. |

### 2.3 Panel Dueño

- Escáner web (celular del cajero) para leer passes del cliente
- Búsqueda de cliente si no tiene QR a mano
- Base de clientes con historial
- Avisos/push (limitados por plan)
- Multi-local en Pro/Enterprise

### 2.4 Integraciones

| Categoría | Detalle |
|-----------|---------|
| **Wallet** | Apple Wallet + Google Wallet (PassKit probable) |
| **POS** | No documentado |
| **Pagos** | No es procesador de pagos |
| **WhatsApp** | Avisos por WhatsApp (soporte 24/7 en Pro) |
| **Otros** | Mercado Pago para cobro de suscripción |

### 2.5 Fortalezas vs ScanGo (en fidelización)

| Fortaleza | Por qué duele |
|-----------|---------------|
| **Wallet-native real** — Sin app, sin fricción, pass en lock screen | ScanGo usa localStorage + notificaciones web push (menos adoption) |
| **Especialistas** — 100% foco en lealtad, UX pulida para ese caso | ScanGo es "menú + fidelización", fidelización es feature secundario |
| **Automatizaciones nativas** — Win-back, cumpleaños, cercanía | ScanGo tiene churn recovery + review nudge pero no geofence ni birthday |
| **Precios en UYU** — Facturación local, IVA incluido | ScanGo USD |
| **Hecho en Uruguay** — Soporte local, confianza país | Mismo factor que Elmenu |

### 2.6 Debilidades vs ScanGo

| Debilidad | Oportunidad ScanGo |
|-----------|-------------------|
| **No es menú digital** — Requiere menú aparte | ScanGo = **menú + fidelización integrados** (un solo QR, un solo panel) |
| **Sin pedidos** — No resuelve la comanda | ScanGo resuelve pedido + fidelización en mismo flujo |
| **Sin analytics de negocio** — Solo métricas de lealtad | ScanGo tiene ticket promedio, top platos, CSV, cohortes |
| **Límite clientes activos** — 100/500 según plan | ScanGo sin límites artificiales |
| **Sin multi-rubro** — Enfoque cafetería/heladería/barbería | ScanGo cubre restaurant, heladería, perfumería, eventos |

---

## 3. DougMenu — Hallazgo

**No se encontró presencia digital relevante** para "DougMenu" como plataforma de menús digitales en Uruguay/Latam. Posibles explicaciones:

1. **Nombre incorrecto** — Podría ser "DoogMenu", "Doug Menu", u otra variación
2. **Muy local/pequeño** — Solo presencia offline o boca a boca
3. **Proyecto abandonado** — Dominio caído o pivotado
4. **Confusión con "Doug's Place"** — Restaurante en Castro Valley, CA (EE.UU.), no plataforma SaaS

> **Recomendación:** No invertir cycles en DougMenu. Si el usuario tiene info específica (URL, contacto), re-evaluar.

---

## 4. Tabla Comparativa Consolidada

| Dimensión | **ScanGo** | **Elmenu.uy** | **LoopVisit** |
|-----------|------------|---------------|---------------|
| **Core** | Menú QR + Pedidos WhatsApp + Fidelización dual | Menú QR + Pedidos + Delivery | Fidelidad Wallet-native |
| **Pricing (entry)** | $9/mo (Starter) | $0 (Free) / ~$25/mo (Delivery) | USD 25/mo + IVA |
| **Pricing (pro)** | $9/mo (único plan, multi-branch discount) | ~$99/mo (Premium) | USD 49/mo + IVA (Pro) |
| **Comisión/pedido** | 0% | 0% | N/A |
| **Moneda facturación** | USD | UYU | UYU |
| **Trial** | 7+3 días (grace period) | 7 días | 14 días |
| **Menú digital** | ✅ Completo (10 layouts, 29 temas, imageMode, popularity sizing) | ✅ Editor visual, multiidioma auto | ❌ No tiene |
| **Pedidos mesa** | ✅ GroupCartManager (carrito grupal) | ✅ Carrito individual ×10 | ❌ |
| **Pedidos WhatsApp** | ✅ Nativo + carrito estructurado | ✅ Nativo | ❌ |
| **Pago online** | ✅ Mercado Pago (preferencia real + link propio) | ✅ (pasarela no explicitada) | ❌ |
| **Propina integrada** | ✅ Tip calculator (5%/10%/15%/custom) | ❌ No documentado | ❌ |
| **Seguimiento pedido (comensal)** | ✅ Token HMAC + push dirigido + modal stepper | ❌ Solo panel dueño | ❌ |
| **Fidelización** | ✅ Dual (local + red global) + wallet (en roadmap) | ❌ No tiene | ✅ Wallet-native (Apple/Google Wallet) |
| **Automatizaciones marketing** | ✅ Churn recovery, review nudge day-after, reactivación email | ❌ Solo tracking básico | ✅ Win-back, birthday, geofence |
| **IA importación menú** | ✅ Gemini Flash multimodal (foto/PDF → menú) | ❌ Carga manual asistida | ❌ |
| **Multi-sucursal** | ✅ Branches nativas + descuento escalonado | ✅ Enterprise only | ✅ Pro (3) / Enterprise (10+) |
| **Multi-idioma** | ✅ ES/EN/PT + detector automático | ✅ Google Translate 100+ (auto) | ❌ |
| **PWA / Offline** | ✅ PWA instalable + SW robusto (same-origin only) | ⚠️ "Offline una vez cargado" | ❌ |
| **Temas visuales** | ✅ 29 temas + 10 layouts + neon multi-acento + explosivo | ⚠️ Editor visual genérico | ❌ |
| **Analytics negocio** | ✅ Ticket prom, top platos, CSV, funnel reseñas, heatmap hora local | ⚠️ Solo escaneos QR | ⚠️ Solo métricas lealtad |
| **SEO/GEO** | ✅ Compiler (robots, sitemap, JSON-LD, IndexNow, llms.txt) | ❌ No documentado | ❌ |
| **Auditoría SEO** | ✅ Panel Studio + cron diario + score 0-100 | ❌ | ❌ |
| **Derecho al olvido (RGPD/18.331)** | ✅ Borrado real + auditoría + cloud sync | ❌ | ❌ |
| **Webhooks billing idempotentes** | ✅ Orchestrator multi-provider + recency guard | ❓ No documentado | ❓ |
| **CSP / Seguridad** | ✅ Estricta (script-src-attr none) + headers duros | ❓ | ❓ |
| **Soporte local UY** | ⚠️ Remoto (docs en español) | ✅ WhatsApp local | ✅ WhatsApp local |
| **Red publicitaria** | ❌ No tiene | ✅ Fowst Ads (banner rotativo) | ❌ |

---

## 5. Oportunidades de Mejora para ScanGo

### 5.1 Estratégicas (Alto Impacto, Mediano Plazo)

| # | Oportunidad | Por qué | Esfuerzo | Referencia Competidor |
|---|-------------|---------|----------|----------------------|
| **1** | **Wallet-native loyalty (Apple/Google Wallet)** | LoopVisit demuestra adoption 3-5x mayor vs web-push. El pass en lock-screen = recordatorio diario gratis. | Alto (PassKit / Apple Wallet API + Google Wallet API) | LoopVisit (core product) |
| **2** | **Carrito individual por comensal (opcional)** | Elmenu resuelve "una persona pide para todos" con carritos paralelos. Reduce fricción en grupos grandes. | Medio (extender GroupCartManager) | Elmenu.uy (Premium) |
| **3** | **Multiidioma automático (Google Translate / LibreTranslate)** | Turismo en Punta del Este/Montevideo exige menú en inglés/portugués sin trabajo del dueño. | Bajo-Medio (widget translate o proxy) | Elmenu.uy (100+ idiomas auto) |
| **4** | **Facturación en UYU + IVA incluido** | El comerciante uruguayo odia riesgo cambiario y facturas del exterior. | Medio (Stripe/MP local + contabilidad) | Elmenu.uy, LoopVisit |
| **5** | **Delivery integrado + gestor repartidores** | Elmenu Premium incluye logística. ScanGo podría partner con PedidosYa/UGO o white-label KDS. | Alto (ops + tech) | Elmenu.uy (Premium) |

### 5.2 Tácticas / Quick Wins (Bajo Esfuerzo, Alto Valor)

| # | Quick Win | Implementación | Archivos Clave | Días |
|---|-----------|----------------|----------------|------|
| **QW1** | **Badge "Hecho en Uruguay" + soporte WhatsApp local** | Agregar en landing, footer, Studio onboarding. Número WhatsApp UY real. | `public/index.html`, `public/js/index.js`, `public/studio.html` | 1 |
| **QW2** | **Selector de moneda UYU/USD en Studio** | Toggle en Mi Local → Guardar preferencia → Formatear precios en menú + SSR JSON-LD. | `api/utils/sanitizeRestaurant.js`, `public/js/utils/dishPriceFormatter.js`, `api/utils/seoDiscovery.js` | 2 |
| **QW3** | **Importar menú desde foto/PDF (IA) en onboarding** | Ya tienes `geminiMenuParser`. Exponer en registro: "Sube una foto de tu carta y la armamos gratis". | `public/index.html` (registro), `api/routes/ai.js`, `src/services/geminiMenuParser.js` | 3 |
| **QW4** | **Geofence / aviso por cercanía para fidelización** | Usar `navigator.geolocation` + service worker push cuando cliente cerca del local (opt-in). | `public/js/sw.js`, `public/js/menu/loyalty.js`, `api/services/notifications.js` | 5 |
| **QW5** | **Cumpleaños automático + gift card digital** | Cron diario → clientes con birthday hoy → push/email con código LOY-XXXX canjeable. | `api/cron/birthday-rewards.js`, `api/services/loyalty.js`, `public/js/components/LoyaltyRewardsModal.js` | 4 |
| **QW6** | **IndexNow automático al guardar menú** | Ya implementado en `api/utils/indexNow.js` + hook en `/api/studio/save`. **Solo activar**: setear `INDEXNOW_KEY` en Vercel. | `.env` (Vercel), `api/utils/indexNow.js` | 0.5 |
| **QW7** | **Precio "event_once" visible en landing pricing** | El plan $12/evento existe en `plans.json` pero no se muestra en pricing tabs. | `public/js/index.js` (`switchPricingRubro`), `src/billing/plans.json` | 0.5 |
| **QW8** | **QR por mesa individual (opcional) + carrito individual** | Extender `groupCartToken` para modo "individual" (un token por comensal). Toggle en Studio. | `api/utils/groupCartToken.js`, `public/js/components/GroupCartManager.js`, `public/js/studio.js` | 5 |
| **QW9** | **Exportar clientes a CSV desde Studio (Ley 18.331)** | Botón en tab Clientes → `csvExport.js` ya existe. Incluir teléfono enmascarado, visitas, puntos, consentimiento. | `public/js/studio.js`, `public/js/utils/csvExport.js`, `api/routes/loyalty.js` | 1 |
| **QW10** | **Partner badge "Compatible con LoopVisit" / "Importar de Elmenu"** | Landing page: "¿Ya usas Elmenu/LoopVisit? Migración gratis en 24h". Script de importación JSON. | `public/index.html`, `api/routes/ai.js` (nuevo endpoint import) | 3 |

---

## 6. Quick Wins Priorizados (Matriz ICE)

| Quick Win | Impacto (1-10) | Confianza (1-10) | Facilidad (1-10) | **ICE Score** | Prioridad |
|-----------|----------------|------------------|------------------|---------------|-----------|
| QW6: Activar IndexNow | 8 | 9 | 10 | **720** | 🔥 Inmediato |
| QW7: Mostrar plan Eventos en pricing | 7 | 10 | 10 | **700** | 🔥 Inmediato |
| QW1: Badge "Hecho en Uruguay" + WhatsApp local | 8 | 8 | 9 | **576** | 🔥 Semana 1 |
| QW2: Selector moneda UYU/USD | 7 | 9 | 7 | **441** | 🔥 Semana 1 |
| QW3: IA importación menú en onboarding | 9 | 8 | 6 | **432** | 🔥 Semana 2 |
| QW9: Export CSV clientes (RGPD) | 6 | 10 | 8 | **480** | 🔥 Semana 2 |
| QW10: Partner badge migración | 7 | 7 | 6 | **294** | 📅 Semana 3 |
| QW4: Geofence fidelización | 8 | 6 | 5 | **240** | 📅 Mes 1 |
| QW5: Cumpleaños + gift card | 7 | 7 | 6 | **294** | 📅 Mes 1 |
| QW8: QR mesa individual + carrito individual | 8 | 7 | 4 | **224** | 📅 Mes 2 |

---

## 7. Acciones Inmediatas (Esta Semana)

```bash
# 1. Activar IndexNow (0.5 días)
# En Vercel Dashboard → Environment Variables:
INDEXNOW_KEY=<uuid-generado-con-node-crypto-randomUUID>
INDEXNOW_ENABLED=true

# 2. Mostrar plan Eventos en pricing (0.5 días)
# Editar public/js/index.js → switchPricingRubro() → agregar tab "Eventos" con event_once

# 3. Badge "Hecho en Uruguay" + WhatsApp local (1 día)
# Editar public/index.html hero + footer
# Agregar número WhatsApp UY real en Studio onboarding

# 4. Selector moneda UYU/USD (2 días)
# Studio → Mi Local → "Moneda de facturación" (UYU/USD)
# dishPriceFormatter.js: respetar restaurant.currency
# seoDiscovery.js: priceRange en JSON-LD según moneda

# 5. IA importación menú en registro (3 días)
# Landing: "Sube foto/PDF → te armamos el menú gratis"
# Endpoint POST /api/ai/import-menu (ya existe geminiMenuParser)
# Onboarding: paso "Tu menú está listo → revisá y publicá"
```

---

## 8. Riesgos Competitivos a Monitorear

| Riesgo | Señal de Alerta | Acción Preventiva |
|--------|-----------------|-------------------|
| **Elmenu lanza fidelización wallet** | Blog post / changelog / beta en su panel | Tener wallet-native listo (QW4+QW5) antes de Q2 2027 |
| **LoopVisit lanza menú digital** | Job posting "Frontend React menú QR" / partnership con POS | Diferenciar: "Menú + Fidelización integrados = 1 QR, 1 panel, 1 factura" |
| **Nuevo entrant con pricing agresivo** | Plan $0/mes con todo incluido (freemium real) | Mantener plan Starter $9/mo + trial 7+3; no bajar precio, subir valor |
| **Mercado Pago cambia fees / API** | Anuncio oficial MP | Orchestrator multi-provider ya soporta Lemon/Stripe; testear mensual |
| **Google quita Translate gratis** | Deprecation notice | Evaluar LibreTranslate self-hosted o DeepL API como fallback |

---

## 9. Próximos Pasos Recomendados

1. **Esta semana:** Implementar QW6, QW7, QW1, QW2 (ICE > 400)
2. **Sprint 1 (2 sem):** QW3, QW9 — IA onboarding + export RGPD
3. **Sprint 2 (4 sem):** QW10, QW4 — Partner migration + geofence loyalty
4. **Sprint 3 (8 sem):** QW5, QW8 — Birthday automation + individual carts
5. **Estratégico (Q2 2027):** Wallet-native loyalty (PassKit) + Facturación UYU + Delivery partner

---

## Apéndice: Fuentes Primarias

| Plataforma | URLs Consultadas | Fecha Acceso |
|------------|------------------|--------------|
| Elmenu.uy | https://elmenu.uy/, https://www.fowst.com/ | 22-23 Oct 2026 |
| LoopVisit | https://www.loopvisit.uy/ | 22-23 Oct 2026 |
| DougMenu | Búsquedas múltiples (web, tracxn, play store) — sin resultados relevantes | 22-23 Oct 2026 |
| ScanGo (interno) | `AGENTS.md`, `docs/estrategia-producto-oct-2026.md`, `openapi.yaml`, codebase | 23 Oct 2026 |

---

*Fin del informe. Próxima actualización recomendada: Q1 2027 o tras lanzamiento de features competitivas detectadas.*