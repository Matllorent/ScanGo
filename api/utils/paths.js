/**
 * api/utils/paths.js
 * ──────────────────
 * Fuente única de rutas del servidor: directorio `public/` (resuelto en
 * dev, cwd y layout Vercel) + opciones de sendFile. Lo usan api/index.js
 * (estáticos y páginas legales) y api/routes/menuSsr.js (SSR /m/:slug).
 */
const fs = require('fs');
const path = require('path');

// Resolve public directory reliably across environments
let PUBLIC_DIR = path.resolve(__dirname, '..', 'public');
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(process.cwd(), 'public');
}
if (!fs.existsSync(PUBLIC_DIR)) {
  PUBLIC_DIR = path.resolve(__dirname, 'public');
}

// Specific HTML routing (allowing dotfiles for paths containing .gemini)
const SEND_FILE_OPTIONS = { dotfiles: 'allow' };

module.exports = { PUBLIC_DIR, SEND_FILE_OPTIONS };
