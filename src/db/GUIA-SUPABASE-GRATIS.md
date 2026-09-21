# 🐘 Guía Paso a Paso: Activar Base de Datos Gratuita en Supabase

Esta guía te explica cómo tener tu base de datos profesional en la nube **100% gratis**, con copias de seguridad automáticas y sin necesidad de tarjeta de crédito.

---

## ¿Por qué Supabase es la mejor opción para tu negocio?

1. **Plan Gratuito Permanente:** Te da 500 MB de base de datos PostgreSQL dedicada. Un restaurante con 50 platos ocupa menos de 0.05 MB. ¡Te alcanza para más de **10.000 restaurantes** sin pagar un solo centavo!
2. **Backups Diarios Automáticos:** Si algo pasa, Supabase guarda copias diarias de tus datos.
3. **Escalabilidad Económica:** Si en el futuro tenés miles de clientes y superás el límite gratuito, el plan Pro cuesta solo **$25 USD/mes**, lo cual representa menos del 3% si ya estás facturando cientos de dólares.
4. **Compatible con Vercel:** Se conecta en 1 segundo y los datos nunca se pierden cuando Vercel actualiza tu web o app móvil.

---

## Paso 1: Crear tu cuenta en Supabase (2 minutos)

1. Entrá a [https://supabase.com](https://supabase.com) y hacé clic en **"Start your project"**.
2. Podés iniciar sesión con tu cuenta de GitHub o con tu correo electrónico.
3. Creá una nueva organización (ej: `Menú Pizarrón`).

---

## Paso 2: Crear tu Proyecto

1. Hacé clic en el botón verde **"New Project"**.
2. Completá los datos:
   - **Name:** `menu-pizarron-saas`
   - **Database Password:** Creá una contraseña segura y anotala.
   - **Region:** Elegí **"São Paulo (South America)"** o **"East US"** (para máxima velocidad en Uruguay/Argentina/Latam).
   - **Pricing Plan:** Dejá seleccionado **Free ($0/month)**.
3. Hacé clic en **"Create new project"**. Esperá 1 minuto mientras Supabase prepara tu base de datos.

---

## Paso 3: Crear las Tablas con 1 Clic (SQL)

1. En el menú de la izquierda de Supabase, hacé clic en el ícono de **"SQL Editor"** (ícono de terminal `>_`).
2. Hacé clic en **"New Query"**.
3. Abrí el archivo [`src/db/schema.sql`](file:///C:/Users/Flor%20Alcaraz/.gemini/antigravity/scratch/menu-pizarron-saas/src/db/schema.sql) de tu proyecto, copiá todo su contenido y pegalo en el editor de Supabase.
4. Hacé clic en el botón verde **"Run"** (o presiona Ctrl + Enter).
5. Verás el mensaje: `Success. No rows returned`. ¡Listo! Las tablas de usuarios, restaurantes y pagos ya están creadas.

---

## Paso 4: Obtener tus Claves de Conexión

1. En el menú de la izquierda, andá al engranaje de **Project Settings** (abajo de todo) → **API**.
2. Vas a ver dos datos clave:
   - **Project URL:** Es algo como `https://abcdefghijk.supabase.co`.
   - **Project API Keys:** Buscá la clave llamada `service_role` (hacé clic en *Reveal* para copiarla).

---

## Paso 5: Pegar las Claves en Vercel

1. Entrá a tu panel de [Vercel](https://vercel.com) → Tu proyecto `menu-pizarron-saas`.
2. Andá a **Settings** → **Environment Variables**.
3. Agregá estas dos variables:
   - `SUPABASE_URL`: Tu Project URL que copiaste en el paso anterior.
   - `SUPABASE_SERVICE_KEY`: La clave `service_role` que copiaste.
4. Hacé un nuevo deploy o guardá los cambios.

**¡Tu sistema SaaS ya está conectado a una base de datos profesional en la nube, blindada y para siempre!**
