/**
 * public/js/utils/placeholderDishSvg.js
 * SVG placeholder para platos sin foto en el menú público.
 * Es accesible (aria-hidden), usa currentColor para adaptarse al tema
 * y respeta prefers-reduced-motion (sin animación propia, solo estilo estático).
 */

export const PLACEHOLDER_DISH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" role="img" aria-hidden="true" focusable="false"><path d="M12 2c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2zm6 12c0 .6-.4 1-1 1h-3v4c0 .6-.4 1-1 1H8c-.6 0-1-.4-1-1v-4H5c-.6 0-1-.4-1-1s.4-1 1-1h3V4c0-.6.4-1 1-1s1 .4 1 1v3h3c.6 0 1 .4 1 1s-.4 1-1 1h-3v3h3c.6 0 1 .4 1 1" fill="currentColor" opacity="0.35"/></svg>`;

export function getPlaceholderDishSvg() {
  return PLACEHOLDER_DISH_SVG;
}
