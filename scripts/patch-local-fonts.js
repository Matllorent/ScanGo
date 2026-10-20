/**
 * Patch de HTMLs: reemplaza los links de Google Fonts por fuentes auto-hospedadas
 * (public/fonts/fonts.css + extended.css) y el Font Awesome de cdnjs por la copia
 * local public/fonts/fa/css/all.min.css. Idempotente (no re-patchea).
 */
const fs = require('fs');
const path = require('path');

const PUBLIC = path.join(__dirname, '..', 'public');
const LOCAL_LINKS = '  <link rel="stylesheet" href="/fonts/fonts.css">\n  <link rel="stylesheet" href="/fonts/extended.css">';

const files = [];
function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) { walk(full); continue; }
    if (f.name.endsWith('.html')) files.push(full);
  }
}
walk(PUBLIC);

let patched = 0;
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  let changed = false;

  // Google Fonts: preconnect(s) + stylesheet → links locales
  if (html.includes('fonts.googleapis.com')) {
    html = html.replace(/[ \t]*<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com"[^>]*>\r?\n?/g, '');
    html = html.replace(/[ \t]*<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com"[^>]*>\r?\n?/g, '');
    html = html.replace(/[ \t]*<link href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"[^>]*>\r?\n/g, (m) => LOCAL_LINKS + '\n');
    if (html.includes('fonts.googleapis.com')) throw new Error('google fonts pendiente en ' + file);
    changed = true;
  }

  // Font Awesome (admin) → copia local
  if (html.includes('cdnjs.cloudflare.com/ajax/libs/font-awesome')) {
    html = html.replace(/[ \t]*<link rel="stylesheet" href="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/font-awesome[^"]*"[^>]*>\r?\n?/g,
      '  <link rel="stylesheet" href="/fonts/fa/css/all.min.css">\n');
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(file, html);
    patched++;
    console.log('~', path.relative(PUBLIC, file));
  }
}
console.log('OK patch fuentes local (', patched, 'archivos )');
