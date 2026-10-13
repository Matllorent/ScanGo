# ADR 0005: Descubrir beta (feed cruzado opt-in, sin carrito mixto)

- Fecha: 2026-10-13
- Estado: Aceptado (beta, en prueba)

## Contexto

Un "tiktok de platos de la zona" tienta a mezclar carritos de varios
locales, lo cual es logísticamente inviable (cocinas, pagos y envíos
separados). Además el feed agregado facilita scraping y exige decidir
privacidad desde el día uno.

## Decisión

- Feed solo descubrimiento: opt-in explícito (`allowDiscovery`, default
  OFF) + suscripción válida. Sin PII (nunca teléfono, dirección, userId).
- Sin carrito mixto por diseño: cada historia enlaza a `/m/:slug?dish=:id`
  y el pedido se hace solo en la carta del local.
- Me gusta honesto: un voto por navegador + conteo del servidor, sin
  identidad fuerte (documentado, no vendido como antifraude).
- Página `/descubrir` con `noindex` mientras sea beta.

## Consecuencias

- Escalar a radio preciso o ranking global no cambia el contrato del feed.
- Si un local se arrepiente, apaga el toggle y desaparece del feed.
- La telemetría de likes usa el canal público existente (rate-limit por
  slug) con conteo por `restaurantId:dishId` (sin fuga entre locales).
