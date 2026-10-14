# Prospección (gratis, sin keys, legal)

Pipeline propio para generar listas de restaurantes candidatos al SaaS desde
**OpenStreetMap** (Overpass API, licencia **ODbL** — atribuir
"© OpenStreetMap contributors" si se publica trabajo derivado).

## Uso

```bash
node scripts/prospecting/osm-leads.js --place "Montevideo, Uruguay" --limit 100 --out leads-montevideo
node scripts/prospecting/osm-leads.js --bbox "-34.93,-56.22,-34.88,-56.16" --out leads-centro
node scripts/prospecting/osm-leads.js --help
```

Salida: `<out>.csv` con `tier,score,name,amenity,phone,website,site_status,address,lat,lon,why,opener`
(Tier A = sin web o web caída: el pitch natural del menú QR.)

## Reglas

- **Cero dependencias**: solo Node builtins. No entra en `npm test`.
- **Cortesía**: mirrors + backoff ante 429/504, un solo fetch por homepage con
  timeout, pausa de 250ms entre sitios, User-Agent identificable (`--contact`).
- **No commitear** los CSV con teléfonos a repos públicos (van al `.gitignore`
  por patrón `leads-*.csv`; el script no escribe dentro de `data/`).
- **Límites honestos**: OSM en UY es parcial (faltan locales, sobran POIs viejos);
  casi nunca hay email (el canal es teléfono/visita). Respetar Ley 18.331 y
  normativa anti-spam: es una lista para contacto comercial propio, no para
  revender ni para spam masivo.
- No scraping de Google Maps: viola sus ToS y contradice la política del
  proyecto (Términos §2b, "Maps como tercero, sin scraping").
