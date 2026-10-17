# ADR 0006: Manifest canónico del motor de plantillas (layouts, imageMode, popularidad)

- Fecha: 2026-10-16
- Estado: Aceptado

## Contexto

Las morfologías del menú estaban duplicadas en cinco lugares sin una fuente
de verdad: la allowlist del sanitizer backend, los `validLayouts` del frontend
(`menuHeader.js`), las options del selector del Studio, el CSS
(`body.layout-*`) y el contrato OpenAPI. Agregar una morfología exigía
tocarlos a mano y cualquier drift pasaba inadvertido. Además, dos features
nuevas exigían declarar **capacidades por layout**: el modo de imagen
(miniaturas / sin fotos / una foto protagonista por categoría) y el tamaño
según popularidad (no aplicable a layouts de una sola columna como ticker o
a listas como delivery).

## Decisión

- **Un solo módulo CJS canónico** `api/utils/themeManifest.js` declara
  `LAYOUTS[]` con `{id, defaultImageMode, imageModes, menuSizing}`, los
  `*_THEME_IDS` y los helpers puros de resolución (`resolveImageMode`,
  `resolveMenuSizing`, `layoutSupports*`). El sanitizer importa
  `LAYOUT_IDS`; el backend nunca duplica la lista.
- **Espejo ESM generado** `public/js/menu/themeManifest.js` se produce con
  `scripts/regen-theme-manifest.js` (mismo patrón que
  `regen-vercel-csp` ↔ `test-csp`). Un guard (`npm run test:theme-manifest`,
  suite 52, HARD en `npm run check`) falla ante cualquier drift.
- **`imageMode`/`menuSizing` son intención del dueño** (`auto`/`uniform` por
  default, allowlist en el sanitizer) y viajan **resueltos** en
  `GET /api/menu/:slug` contra las capacidades del layout: un combo que la
  morfología no implementa nunca cuele. `grid` no agrega clase CSS (es el
  comportamiento histórico, cero regresión); `image-none`/`image-hero`/
  `sizing-popularity` son aditivos.
- **Popularidad honesta**: `computePopTiers` (puro) devuelve un derivado
  acotado (tier 2/1/0) a partir de señales reales (clics + pedidos, ventana
  90d); con menos de 30 muestras manda el proxy del chef. El payload público
  jamás ve scores ni conteos crudos. Vive aparte de `countAnalytics`
  (invariante diferencial intacto) y solo consulta telemetría cuando el dueño
  activó el sizing.
- **`?sizing=popularity` es preview** (espejo de `?morph=`/`?theme=`/`?img=`)
  y entra en las dos keys de cache del menú (middleware + single-flight) por
  la misma razón que `?branch=`: cambia la respuesta.

## Consecuencias

- Una morfología nueva = una entrada en el manifest + su bloque CSS + la
  option del Studio; el guard de paridad verifica las cuatro caras.
- Los previews no guardados no contaminan la cache ni entre sí.
- `minimalist` pasó a ser "Fine Dining" marfil y apareció `brutalist`; el
  contrato OpenAPI documenta los dos campos nuevos y `popTier`.
