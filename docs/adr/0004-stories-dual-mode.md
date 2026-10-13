# ADR 0004: layout Stories con modo dual mesa/casa

- Fecha: 2026-10-13
- Estado: Aceptado

## Contexto

El QR de la mesa y el link para delivery pedían experiencias distintas:
en mesa manda la carta completa; en casa convierte el formato historia
vertical. Duplicar la carta (dos fuentes) hubiese generado drift de
precios, horarios y disponibilidad.

## Decisión

Un solo `layout-stories` con dos entradas: QR clásico (carta normal con
anillos de destacados) y `?morph=stories` o default del dueño (overlay
full-screen). El overlay se construye LEYENDO las `.dish-card` ya
renderizadas: hereda categorías, Happy Hour, agotados y horarios sin
duplicar lógica. El video por plato es link MP4/WebM directo (nunca
subida base64) con la foto como póster.

## Consecuencias

- Cero drift posible entre modos: misma fuente, misma data.
- `public/js/menu/storiesLayout.js` es el único dueño del overlay;
  `menu.js` conserva wrappers del mismo nombre (contratos intactos).
- Costo acotado por diseño: un solo video a la vez, `preload="none"`,
  tope 15 s, `media-src` sin `data:`.
