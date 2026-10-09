# Política de Seguridad — Menú Pizarrón SaaS

## Versiones soportadas

| Versión | Soporte            |
|---------|--------------------|
| 2.x     | ✅ Recibe parches  |
| < 2.0   | ❌ Sin soporte     |

Solo la línea mayor `2.x` recibe correcciones de seguridad.

## Cómo reportar una vulnerabilidad

- Escribí a **hola@menu-pizarron.com** (el mismo de `EMAIL_FROM` en `.env.example`).
- Asunto: **`[SECURITY]` + breve descripción** (ej. `[SECURITY] XSS en /m/:slug`).
- **No abras un issue público** ni un PR con el exploit hasta que haya fix.

## Qué incluir en el reporte

1. Descripción del impacto (qué puede hacer un atacante).
2. Pasos para reproducirlo (requests, payload, entorno).
3. Versión/commit afectado y severidad estimada.
4. Tu contacto para pedirte más datos si hace falta.

## SLA de respuesta

- **Acuse de recibo:** 48 h.
- **Fix de vulnerabilidad crítica:** 7 días desde la confirmación.
- Te avisamos cuando el parche esté publicado para que verifiques.

## Alcance

**Dentro del alcance:**

- `api/` y `src/` (backend Express, middleware, servicios).
- Autenticación, autorización por tenant, billing y fidelización.

**Fuera del alcance:**

- `tests/` (fixtures y datos de prueba).
- `data/` local (archivos JSON de desarrollo, no contienen datos reales).

## Dependencias

Las dependencias se auditan con **osv-scanner** sobre `package-lock.json`
(también corre en CI). Los riesgos aceptados sin fix disponible se documentan
en `AGENTS.md` (ej. `braces` vía `chokidar` → `nodemon`, solo dev).
