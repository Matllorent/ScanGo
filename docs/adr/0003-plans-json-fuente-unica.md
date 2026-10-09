# ADR 0003: plans.json como fuente única de precios

- Fecha: 2026-04-12
- Estado: Aceptado

## Contexto

Los precios de planes (starter 9/79 USD, pro 19/159 USD) estaban
duplicados como literales en el orquestador de billing, el admin y
los tests: cualquier cambio de precio exigía tocar N archivos.

## Decisión

`src/billing/plans.json` es la fuente única de precios y períodos;
el código lo lee y solo usa literales como fallback si el archivo
falta o está corrupto (fail-open en precio conocido, nunca inventado).

## Consecuencias

- Cambiar un precio es editar un JSON, no código.
- Los tests validan el fallback a literales ante JSON ausente.
- El descuento multi-sucursal consume los mismos precios base.
