/**
 * scripts/codemod-csp-events.js
 * Convierte atributos `on<TYPE>="EXPR"` → `data-js-<TYPE>="FN|arg1|arg2"` para
 * habilitar CSP estricto (script-src-attr 'none') vía public/js/dom-bindings.js.
 *
 * Uso:
 *   node scripts/codemod-csp-events.js --files public/menu.html public/js/menu.js ...  (imprime reporte, NO toca)
 *   node scripts/codemod-csp-events.js --files ... --apply                            (reescribe)
 *
 * Gramática aceptada por expresión:
 *   FN(args)  |  window.FN(args)  |  FN(this.ruta)  |  FN('str', 12, ${token}, this, event, true)
 *   document.getElementById('X').click()   →  fireClick|X
 *   event.preventDefault();                →  preventDefault
 *   this.style.color='X'                   →  data-js-style-color="X"
 *   if(event.target===this)FN()            →  data-js-<TYPE>-backdrop="FN" (solo dispara si el click es el overlay)
 *
 * Cualquier otra forma queda en el reporte UNHANDLED (revisión manual).
 */
const fs = require('fs');
const path = require('path');

const DRY = !process.argv.includes('--apply');
const filesArgIdx = process.argv.indexOf('--files');
const files = filesArgIdx >= 0 ? process.argv.slice(filesArgIdx + 1).filter(a => !a.startsWith('--')) : [];
const ROOT = path.resolve(__dirname, '..');

// NOTE: commas splitter that respects '...' , "..." y ${...}
function splitArgs(inner) {
  const out = [];
  let cur = '';
  let sq = false, dq = false, depth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (sq) { cur += ch; if (ch === "'") sq = false; continue; }
    if (dq) { cur += ch; if (ch === '"') dq = false; continue; }
    if (ch === "'") { sq = true; cur += ch; continue; }
    if (ch === '"') { dq = true; cur += ch; continue; }
    if (ch === '${') { depth++; cur += ch; continue; }
    if (depth > 0) { cur += ch; if (ch === '}') depth--; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseArg(raw) {
  const a = raw.trim();
  if (/^'(.*)'$/.test(a) || /^"(.*)"$/.test(a)) return a.slice(1, -1);
  if (/^\$\{.*\}$/.test(a)) return a;                       // token de template (ya interpolado en runtime)
  if (/^this(\.[A-Za-z_$][\w$]*)*$/.test(a)) return a;      // this, this.checked, this.dataset.dishId
  if (a === 'event') return a;
  if (/^-?\d+(\.\d+)?$/.test(a)) return a;
  if (a === 'true' || a === 'false') return a;
  return null;
}

function parseExpr(exprRaw) {
  const expr = exprRaw.trim().replace(/;+\s*$/g, '').trim();
  if (!expr) return null;

  // document.getElementById('X').click()
  let m = expr.match(/^document\.getElementById\('([^']+)'\)\.click\(\)$/);
  if (m) return { fn: 'fireClick', args: [m[1]] };

  if (expr === 'event.preventDefault()') return { fn: 'preventDefault', args: [] };
  if (expr === 'window.location.reload()') return { fn: 'reloadPage', args: [] };

  // this.style.color='X'  |  this.style.display='X'
  m = expr.match(/^this\.style\.(color|display)\s*=\s*'([^']+)'$/);
  if (m) return { styleProp: m[1], styleValue: m[2] };

  // if(event.target===this)FN()
  m = expr.match(/^if\(event\.target===this\)([A-Za-z_$][\w$]*)\(\)$/);
  if (m) return { fn: m[1], args: [], backdrop: true };

  // FN(args) | window.FN(args) | A.B.C(args) | A?.B.C(args)
  m = expr.match(/^(?:window\.)?([A-Za-z_$][\w$]*(?:(?:\?\.|\.)[A-Za-z_$][\w$]*)*)\(((?:[^()]|\$\{[^}]*\})*)\)$/);
  if (m) {
    const fn = m[1];
    const inner = m[2].trim();
    const args = inner ? splitArgs(inner) : [];
    const parsed = args.map(parseArg);
    if (parsed.some(x => x === null)) {
      return { unhandled: expr, reason: `arg no soportado: ${args.find((_, i) => parsed[i] === null)}` };
    }
    return { fn, args: parsed };
  }

  return { unhandled: expr, reason: 'forma no reconocida' };
}

function transform(src) {
  const re = /on([a-z]+)="([^"]*)"/g;
  let out = '';
  let last = 0;
  let m;
  const report = { handled: 0, unhandled: [], styled: [] };
  while ((m = re.exec(src))) {
    const type = m[1];
    const parsed = parseExpr(m[2]);
    out += src.slice(last, m.index);
    if (!parsed) {
      // Expresión vacía o recolectada: no tocar (ruido de metas con content= ya viene filtrado por on[a-z]+=).
      out += m[0];
    } else if (parsed.unhandled) {
      report.unhandled.push(parsed.unhandled);
      out += m[0];
    } else if (parsed.styleProp) {
      report.styled.push(`${parsed.styleProp}:${parsed.styleValue}`);
      // Estilos por evento: onerror="this.style.x='v'" → data-js-error-style-x (evento error),
      // onmouseover="this.style.color='v'" → data-js-mouseover-style-color, onclick → data-js-click-style-color
      out += `data-js-${type}-style-${parsed.styleProp}="${parsed.styleValue}"`;
    } else {
      report.handled++;
      const specs = [parsed.fn, ...parsed.args].map(s => s.replace(/"/g, '&quot;'));
      const attrVal = specs.join('|');
      // Backdrop: el binder solo dispara cuando el click es sobre el overlay mismo
      // (e.target === el), equivalente a `if(event.target===this)FN()`.
      const attrName = parsed.backdrop ? `data-js-${type}-backdrop` : `data-js-${type}`;
      out += `${attrName}="${attrVal}"`;
    }
    last = re.lastIndex;
  }
  out += src.slice(last);
  return { out, report };
}

for (const rel of files) {
  const full = path.join(ROOT, rel);
  let src = fs.readFileSync(full, 'utf8');
  const { out, report } = transform(src);
  const binderTag = '\n  <script src="/js/dom-bindings.js"></script>';
  let html = out;
  if (rel.endsWith('.html') && !out.includes('dom-bindings.js') && out.includes('</body>')) {
    html = out.replace('</body>', binderTag + '\n</body>');
  }
  console.log(`=== ${rel}: ${report.handled} convertidos, ${report.unhandled.length} UNHANDLED, ${report.styled.length} style-*`);
  for (const u of report.unhandled) console.log(`    UNHANDLED: ${u}`);
  if (!DRY) fs.writeFileSync(full, html);
}
if (DRY) console.log('\n(dry-run — pasá --apply para escribir)');