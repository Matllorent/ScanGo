# Intel competitiva — FORNNO (fornno.com, Uruguay, powered by Kairo Agency)

> Levantado oct-2026 de su web pública (hub + /secretaria + /fidelizacion).
> Posicionamiento: NO es un menú QR — se vende como "sistema de crecimiento para
> restaurantes": crecimiento, retención y automatización. Cero precios en la web
> (qualificación vendedor → demo por WhatsApp). Clientes: Chivipizza, Sanguche,
> La Burguería, Bonus, Sushi Time, etc. (restaurantes urbanos/YA grandes).

## 1. Qué venden (6 módulos)

| Módulo | Oferta | Labores reales |
|---|---|---|
| 01 Secretaría | Agente IA 24/7 en WhatsApp/Instagram: atiende consultas (carta, alérgenos), gestiona reservas, deriva al humano cuando es necesario | Es un chatbot (conocer carta+horarios+disponibilidad y negociar mesa) sobre WABA Cloud API |
| 02 Escalabilidad | Pedidos directos WhatsApp sin comisiones + campañas automáticas + ads geolocalizados | El pedido por link prefilled + ads remarketing = lo que ScanGo HACE por defecto |
| 03 Fidelización | Puntos ×$ (1 pto/$100), 4 niveles (Bronze/Gold/Platinum/VIP con multiplicador creciente 1/1.5/2/3), recompensas (descuentos/productos gratis/experiencias VIP), puntos dobles en cumpleaños, referidos, desafíos mensuales | Mismo modelo que `loyalty.js` dual pero con multiplicador por nivel, referidos y misión/desafíos |
| 04 App (CDP) | "Conocés a cada cliente mejor que ellos mismos": retención +38%, ticket $4.280, ROI 640%, "47 clientes recuperados este mes" | CRM/segments/emdash records de visitas + alertas de churn |
| 05 Agencia | Redes, video, identidad, reputación, reportes | Marketer ORION (agencia slotted a la SaaS; NO es réplica de software) |
| 06 Web | Sitio móvil + menú + reservas + SEO local | Lo que ScanGo YA es de fábrica (SSR/JSON-LD/soluciones/robots IA) |

Automatizaciones de Secretaría que son oro puro de producto:
confirmación de reserva automática, recordatorio 24h antes (les dicen −30/50% no-shows),
**solicitud de reseña post-visita al día siguiente** con link directo, alertas de
alergias/alto valor al equipo, registro automático del cliente en CRM, **seguimiento
post-cancelación que propone nueva fecha**.

## 2. Qué hace MEJOR que ScanGo hoy

1. **Posicionamiento**: hablan de RESULTADO (retención, ROI, clientes recuperados),
   no de features ("menú digital"). ScanGo vende funcionalidad; Fornno vendería flujo de caja.
2. **Churn-risk + campañas de recuperación automáticas**: su agente segmenta la base,
   rankea por riesgo de no volver y dispara campañas con 5–15% de conversión.
   ScanGo tiene la DATA (fidelización + telemetría + teléfono E.164) pero nunca la
   convierte en acciones automáticas de recupero.
3. **Agente IA (Secretaría)**: reservas que se autogestionan + auto-modificación.
   ScanGo tiene el "Mozo Virtual" para pedir, no un agente conversacional de consultas/reservas.
4. **Wallet nativo**: tarjeta de lealtad en Apple Wallet/Google Wallet + QR físico.
   ScanGo tiene el modal LoyaltyRewards (web), no la pasaporte en el bolsillo.
5. **Referidos, puntos dobles en cumpleaños, desafíos mensuales**: mecánicas de hábito.
   ScanGo solo tiene puntos/niveles/beneficios (sin game-loop).
6. **Recolectores de reseñas automáticas**: "al día siguiente de tu visita te pido reseña".
   ScanGo tiene el nudge post-entrega en menú (90s, 1/día) pero no outbound.

## 3. Qué ScanGo hace MEJOR (contra-argumentos de venta)

1. **Precio y self-service**: Fornno es contacto-ventas (demo 24h, sin precios publicados,
   agencia arriba). ScanGo = USD 9/mes, registro en 60 segundos, trial 7+3. Segmento
   PyME/mediano que no puede pagar Fornno ni está en su planeta de atención.
2. **Pedidos/comanda reales**: carrito grupal, mesa QR, pago online MP, propina, KDS,
   tickets ESC/POS, tracking comensal y **comandero del mozo** (oct-2026, Fase 2 Mozos:
   el mozo toma el pedido EN la mesa desde su PWA `/mozo` y el pedido sale real con
   atribución de turno — quién lo tomó y qué mesa — hacia KDS/Studio). La web de Fornno
   no muestra flujo de pedido (solo dice "+28 pedidos vía WhatsApp").
3. **SEO/GEO de fábrica**: sitemap dinámico, JSON-LD con horarios reales, llms.txt,
   landings por rubro, robots con crawlers de IA. Su "módulo Web" es más light.
4. **Cero negociación**: dueño swipea y arranca; no "dejanos tus datos".

## 4. Roadmap recomendado (aprendizajes convertibles)

Orden por razón $/esfuerzo, todo sobre arquitectura existente:

- **R1 · Outbound de recupero con datos propios** (la joya, R media):
  `restaurant.loyaltyConfig` + `customer_profiles.loyalty_accounts` YA saben quién dejó
  de venir. Cron semanal que arme lista de churn (última visita > X días, según su
  frecuencia propia) y dispare promo WhatsApp (wa.me manual configurable de dueño)
  o email (SEND /api/email ya hace). Fase 1 = solo email + composer "Reactivación"
  en Studio (mismo composer de promos, con la lista ya sugerida).
- **R2 · "El día después": nudge de reseña outbound por email** (SEA kit de Fornno
  "al día siguiente"): post `delivered` → email programado al día siguiente con link
  de reseña de Google (`?review=1` branch ya existe). Con RESEND API ya cableado es
  UN template más en `api/services/email.js` + cron/schedule de 1 día.
- **R3 · Multiplicador por nivel de lealtad** (HECHO oct-2026, 66ª suite): escalera
  opt-in `loyaltyConfig.levels` `{name, minVisits, multiplier}` — módulo puro CJS
  `api/utils/loyaltyLevels.js` + espejo ESM (paridad testeada), sanitizer (ABSENT si
  basura, clamp [1,10] pasos de 0.5, cap 5), `creditOrder` multiplica con el tier YA
  ganado (visitas ANTES del pedido; sin escalera → ×1, locales actuales intactos),
  ledger guarda `metadata.multiplier` y el modal del Club muestra la escalera.
  El canje sigue restable de AMBOS ledgers en sync (globalPoints = account.points).
- **R4 · Wallet passes** (después, costo de certificados Apple): tarjeta lealtad en
  Google Wallet es API simple (OAuth+JWT); Apple Wallet exige certificado pass type ID.
  Vale cuando haya volumen demostrado.
- **R5 · Agente Secretaría IA** (fase más lejana): Gemini ya está integrado (cartas);
  un agente de consultas sobre hallazgos (horarios, alérgenos, dirección) con
  Guardrails claros es viable con LLM+datos públicos del local. Reservas automáticas
  con negociación son cost y riesgo alto — NO es v1.
- **R6 · Landing "resultado, no features"**: aprender del COPY: reformular la landing
  ScanGo con métricas concretas (%dolls, "%dels sin comisión", "checkout en 60s"),
  un dashboard animado como su hero, y precios TRANSPARENTES como contraste
  (su debilidad estructural es no decir precios).

## 5. Veredicto

Fornno ataca el restaurante YA GRANDE (churn y ops a escala, agencia encima).
**ScanGo gana abajo**: el PyME que hoy no tiene nada, con self-service subito +
comercial sin fricción. Fundir un % de sus ideas (R1, R2, R3) en el pipeline da el
argumento de venta DUAL: "cumple el rol de menú+dijo Fornno en uno, SIN agencia ni
precios negociados".
