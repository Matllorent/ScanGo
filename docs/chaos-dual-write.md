# Drill de divergencia dual-write (runbook)

Simula una caída de Supabase para comprobar que el write local sigue OK y que
la replicación cloud degrada con warning (sin romper el alta).

## Pasos

1. **Backup**: copiá `data/` a `data.bak-<fecha>/` (restaurantes, usuarios, pedidos).
2. **Corte simulado**: en un proceso aparte (NO en `.env`), exportá
   `SUPABASE_URL=https://invalida.local` (manteniendo la service key real o
   cualquiera: el host inválido fuerza el fallo de red) y arrancá el server.
3. **Altas**: vía script, da de alta un restaurante (`db.saveRestaurant`) y un
   pedido (`db.addOrder` o `POST /api/orders`).
4. **Assert**: el write local responde OK (el restaurante/pedido existe en
   `data/*.json`) y los logs muestran el warn de replicación
   (`[Supabase Save Restaurant]` / similar) sin excepción.
5. **Medir**: con la config real restaurada, corré
   `node scripts/verify-dual-write-parity.js` y anotá `solo-local` /
   `divergentes` (el restaurante del drill debe salir en `solo-local`).
6. **Restore**: restaurá `data/` desde el backup y reintentá la réplica
   pendiente (regrabá el restaurante) si corresponde.

## Éxito

- Alta local OK durante el corte + warn (no throw) en logs.
- El script de paridad reporta la divergencia esperada y nada más.
- Post-restore: `solo-local` / `divergentes` vuelven a cero.

## Frecuencia

Mensual (o tras cada cambio en `src/db/db.js` / migraciones).
