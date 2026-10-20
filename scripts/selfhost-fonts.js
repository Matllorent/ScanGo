/**
 * Self-host fonts: descarga a public/fonts/ los pesos que faltan (Caveat,
 * Plus Jakarta Sans) y Font Awesome 6.5.1 (css + woff2) que admin.html hoy
 * carga de Google Fonts / cdnjs. Motivo: fugas de IP a terceros al cargar
 * fuentes (sentencia Múnich / RGPD) — cero requests de fuente a terceros.
 * Idempotente: si el archivo existe, no lo vuelve a bajar.
 */
const fs = require('fs');
const path = require('path');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const FONTS_DIR = path.join(__dirname, '..', 'public', 'fonts');
const FA_DIR = path.join(FONTS_DIR, 'fa');
const FA_CSS_DIR = path.join(FA_DIR, 'css');
const FA_WEBFONTS_DIR = path.join(FA_DIR, 'webfonts');

const FAMILIES = [
  { name: 'Caveat', weights: [600, 700] },
  { name: 'Plus Jakarta Sans', weights: [400, 600, 700, 800] }
];

async function getCss(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error('css fetch ' + res.status + ' ' + url);
  return res.text();
}

function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function downloadFontFamily({ name, weights }) {
  const weightsParam = weights.join(';');
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(name).replace(/%20/g, '+')}:wght@${weightsParam}&display=swap`;
  const raw = await getCss(cssUrl);
  // Solo los bloques latin y latin-ext (los que usa ES/PT/EN)
  const blocks = raw.split('/* ').filter(b => b.startsWith('latin'));
  const out = [];
  for (const block of blocks) {
    const subset = block.slice(0, block.indexOf(' */')).trim();
    const weight = /font-weight:\s*(\d+)/.exec(block)[1];
    const italic = /font-style:\s*italic/.test(block);
    const url = /url\((https:[^)]+\.woff2)\)/.exec(block)[1];
    const safeName = `${slug(name)}-${weight}${italic ? 'i' : ''}-${subset}.woff2`.replace('-latin-ext', 'latin-ext');
    const dest = path.join(FONTS_DIR, safeName);
    if (fs.existsSync(dest)) {
      console.log('~', safeName, '(ya estaba)');
    } else {
      const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
      fs.writeFileSync(dest, buf);
      console.log('+', safeName, buf.length, 'bytes');
    }
    const unicodeRange = /unicode-range:\s*([^;]+);/.exec(block)[1];
    out.push(`/* ${name} ${weight}${italic ? 'i' : ''} ${subset} */\n@font-face {\n  font-family: '${name}';\n  font-style: ${italic ? 'italic' : 'normal'};\n  font-weight: ${weight};\n  font-display: swap;\n  src: url(/fonts/${safeName}) format('woff2');\n  unicode-range: ${unicodeRange};\n}`);
  }
  return out;
}

async function downloadFontAwesome() {
  const version = '6.5.1';
  const cssUrl = `https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version}/css/all.min.css`;
  fs.mkdirSync(FA_WEBFONTS_DIR, { recursive: true });
  const destCss = path.join(FA_CSS_DIR, 'all.min.css');
  fs.mkdirSync(FA_CSS_DIR, { recursive: true });
  let css;
  if (fs.existsSync(destCss)) {
    console.log('~ fa/all.min.css (ya estaba)');
    css = fs.readFileSync(destCss, 'utf8');
  } else {
    css = await (await fetch(cssUrl, { headers: { 'User-Agent': UA } })).text();
    fs.writeFileSync(destCss, css);
    console.log('+ fa/all.min.css', css.length, 'bytes');
  }
  const urls = new Set([...css.matchAll(/url\(\.\.\/webfonts\/([^)]+)\)/g)].map(m => m[1]));
  for (const rel of urls) {
    const dest = path.join(FA_WEBFONTS_DIR, rel);
    if (fs.existsSync(dest)) { console.log('~', rel, '(ya estaba)'); continue; }
    const buf = Buffer.from(await (await fetch(`https://cdnjs.cloudflare.com/ajax/libs/font-awesome/${version}/webfonts/${rel}`)).arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log('+', rel, buf.length, 'bytes');
  }
}

(async () => {
  const out = [];
  for (const fam of FAMILIES) out.push(await downloadFontFamily(fam));
  await downloadFontAwesome();

  const extCss = path.join(FONTS_DIR, 'extended.css');
  const body = out.flat().join('\n') + '\n';
  // Genera el CSS extendido SOLO si cambió (evita rewrites con plata/hora)
  const existing = fs.existsSync(extCss) ? fs.readFileSync(extCss, 'utf8') : '';
  if (existing !== body) {
    fs.writeFileSync(extCss, body);
    console.log('~ fonts/extended.css', out.flat().length, '@font-face');
  } else {
    console.log('~ fonts/extended.css (sin cambios)');
  }
  console.log('OK self-host fonts');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
