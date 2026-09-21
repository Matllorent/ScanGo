# Guía de Despliegue: Vercel y Google Play Store
## Menú Pizarrón Studio SaaS

Esta guía detalla los pasos exactos para poner en producción la plataforma SaaS en **Vercel** y publicar la aplicación oficial de administración en **Google Play Store** (Android AAB/APK).

---

## 1. Despliegue en Vercel (Producción Serverless)

El proyecto ya incluye el archivo `vercel.json` configurado para enrutar tanto la API serverless (`/api/*`), los menús dinámicos (`/m/*`), el Studio (`/studio`) y los archivos estáticos (`public/*`).

### Pasos:
1. **Instalar Vercel CLI** (si no lo tienes instalado):
   ```bash
   npm install -g vercel
   ```
2. **Iniciar sesión en Vercel**:
   ```bash
   vercel login
   ```
3. **Desplegar**:
   ```bash
   # En la raíz del proyecto:
   vercel --prod
   ```
4. **Configurar Variables de Entorno en el Dashboard de Vercel**:
   - `JWT_SECRET`: Llave secreta para tokens JWT (ej. `seguridad_menu_pizarron_saas_2026`).
   - `APP_URL`: Dominio final en producción (ej. `https://menupizarron.com` o `https://tu-proyecto.vercel.app`).
   - `LEMONSQUEEZY_API_KEY` y `LEMONSQUEEZY_STORE_ID`: Claves de tu tienda Lemon Squeezy (Merchant of Record).
   - `LEMONSQUEEZY_WEBHOOK_SECRET`: Secreto configurado en el Webhook de Lemon Squeezy apuntando a `https://tu-dominio.vercel.app/api/billing/webhook/lemonsqueezy`.
   - `MERCADOPAGO_ACCESS_TOKEN`: Token de producción de Mercado Pago para cobros locales en Latam.
   - `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`: (Opcional) Si decides activar Stripe.
   - `RESEND_API_KEY`: API key de Resend para envío de correos transaccionales automáticos.

---

## 2. Publicación en Google Play Store (Capacitor Android)

El proyecto está preparado para envolver el Studio web en una app nativa Android optimizada y ligera.

### Requisitos Previos:
- **Node.js** v18+ y npm instalados.
- **Android Studio** instalado con Android SDK 33+ y Command-line Tools.
- Cuenta de desarrollador en **Google Play Console** ($25 USD pago único).

### Paso 1: Instalar dependencias de Capacitor
En la raíz del proyecto ejecuta:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/android
```

### Paso 2: Inicializar y agregar la plataforma Android
```bash
# Copia la configuración de mobile/capacitor.config.json a la raíz:
copy mobile\capacitor.config.json capacitor.config.json

# Inicializar plataforma Android:
npx cap add android
```

### Paso 3: Sincronizar los archivos web
Cada vez que hagas cambios en el frontend, ejecuta:
```bash
npm run mobile:sync
# o manualmente:
npx cap sync android
```

### Paso 4: Abrir en Android Studio
```bash
npx cap open android
```

### Paso 5: Generar el paquete de producción (AAB - Android App Bundle)
1. En Android Studio, ve al menú: **Build** > **Generate Signed Bundle / APK...**
2. Selecciona **Android App Bundle** y haz clic en **Next**.
3. **Key store path**: Crea o selecciona tu archivo de firma `.jks` (guarda bien la contraseña y el archivo de claves).
4. Elige la variante de compilación: **release**.
5. Marca las casillas de verificación de firma (V1 y V2).
6. Haz clic en **Finish**. Android Studio compilará el archivo `.aab` listo para Play Store (ubicado en `android/app/release/app-release.aab`).

### Paso 6: Subir a Google Play Console
1. Entra a [Google Play Console](https://play.google.com/console/).
2. Haz clic en **Crear app**:
   - Nombre: `Menú Pizarrón Studio`
   - Idioma predeterminado: `Español (Latinoamérica)`
   - Tipo: `Aplicación` / `Gratis`
3. En la sección **Producción**, crea una nueva versión y sube el archivo `app-release.aab`.
4. Completa la ficha de la tienda:
   - **Ícono de la app**: PNG de 512 x 512 px.
   - **Gráfico de funciones**: PNG de 1024 x 500 px.
   - **Capturas de pantalla**: 4 capturas de celular mostrando el panel Studio, el catálogo de platos y la generación de QR.
   - **Política de Privacidad**: Enlace a la política alojada en tu dominio (ej: `https://tu-dominio.com/privacidad.html`).
5. Envía la app a revisión. Google Play suele aprobarla en 24 a 48 horas.
