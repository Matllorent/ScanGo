# 📊 Análisis de Integración con publicapis.dev
**Fecha:** 23 Oct 2026  
**Para:** Equipo ScanGo  
**Objetivo:** Evaluar APIs públicas gratuitas para potencial integración en ScanGo

---

## 🎯 Resumen Ejecutivo

Se analizaron **3 categorías principales** de publicapis.dev relevantes para ScanGo:

| Categoría | APIs Relevantes | Recomendación |
|-----------|----------------|---------------|
| **Currency Exchange** | exchangerate.host, Frankfurter, Cambio Uruguay, VATComply | ✅ **Usar** - exchangerate.host es gratuito sin rate limit |
| **Authentication & Authorization** | ReqKey, Clerk, Stytch, Warrant | ⚠️ **Evaluar** - ReqKey interesante para API key management |
| **Social** | Ayrshare, Discord, Facebook, Instagram, MirrorFly | ❌ **Descartar** - No aportan valor incremental a ScanGo |

---

## 1. Currency Exchange APIs

### Mejores Opciones para ScanGo:

| API | Costo | Rate Limit | Características | Veredicto |
|-----|-------|------------|-----------------|-----------|
| **exchangerate.host** | Gratis | Sin límite | 160+ monedas, tiempo real + histórico, sin API key requerida | ✅ **RECOMENDADO** |
| **Frankfurter** | Gratis | Sin límite | Enfocado en EUR, datos del BCE | ⚠️ Alternativa EUR |
| **Cambio Uruguay** | Gratis | No especificado | Tasas de casas de cambio uruguayas | ✅ **Para UYU específico** |
| **CurrencyFreaks** | Gratis 1K req/mes | 1,000/mes | 168+ monedas | ⚠️ Alternativa |
| **VATComply.com** | Gratis | Sin límite | Tasas + validación IVA + geolocalización IP | ✅ **Bonus: IVA + geolocalización** |

### Recomendación para ScanGo:
**exchangerate.host** es la mejor opción porque:
- Es completamente gratuito sin rate limit
- Soporta 160+ monedas incluyendo UYU y USD
- No requiere API key (simplifica integración)
- Ya tiene datos históricos para cotizaciones

**Uso en ScanGo:** Mostrar precios en múltiples monedas en el menú público según la ubicación del comensal o preferencia del dueño.

---

## 2. Authentication & Authorization APIs

### Análisis para ScanGo:

| API | Costo | Características | Relevancia para ScanGo |
|-----|-------|-----------------|------------------------|
| **ReqKey** | Gratis/Pago | Valida API keys, mide créditos, aplica rate limits, logs desde SDK | ⭐ **Interesante** - Podría reemplazar/validar la gestión de API keys de Studio |
| **Clerk** | Gratis hasta 7,500 MAU | Auth drop-in para React, manejo de sesiones, MFA | ⚠️ Overkill - ScanGo ya tiene su propio sistema de auth |
| **Stytch** | Pago | User infrastructure, email magic links, OAuth | ❌ No necesario - ScanGo ya tiene auth propio |
| **Warrant** | Pago | Authorization y control de acceso (RBAC) | ⚠️ Potencial para control de acceso granular en Studio |

### Recomendación:
**ReqKey** es interesante para ScanGo porque:
- Valida API keys de clientes que usen la API pública de ScanGo
- Mete rate limiting automático
- Logs de cada request
- SDK simple de integrar

Sin embargo, ScanGo ya tiene su propio sistema de auth y rate limiting funcional, por lo que ReqKey es una mejora opcional, no crítica.

---

## 3. Social APIs

### Análisis para ScanGo:

| API | Costo | Características | Relevancia para ScanGo |
|-----|-------|-----------------|------------------------|
| **Ayrshare** | Pago | Social media posting, analytics, multi-platform | ❌ No aplica - ScanGo no es plataforma social |
| **Discord** | Gratis | Bots, integración con Discord | ❌ No aplica |
| **Facebook/Instagram** | Gratis | Login, Share, Social Plugins | ⚠️ Podría usarse para login social (ya existe Google) |
| **MirrorFly Chat API** | Pago | Chat en tiempo real, SDK completo | ❌ No aplica - ScanGo usa WhatsApp |
| **Slack** | Gratis | Team messaging | ❌ No aplica |

### Recomendación:
**Descartar todas las APIs sociales.** ScanGo ya tiene:
- Login con Google (OAuth)
- Notificaciones por WhatsApp (directo, sin API intermedio)
- Web Push para notificaciones al dueño

No hay valor agregado en integrar APIs sociales adicionales.

---

## 4. Otras Categorías Relevantes (Breve)

### Weather APIs
ScanGo ya tiene integración con clima inteligente. No hay APIs gratuitas destacadas que superen la implementación actual.

### Video APIs
- **Rendobar** - Serverless FFmpeg para video transcoding. Podría ser útil para optimizar videos subidos por dueños, pero no es crítico.

### Security APIs
- **DomScan** - Dominios, WHOIS, TLS. Útil para validar dominios de restaurantes.
- **NetAPI** - Datos de dominios, comprometidos, etc.

---

## 📋 Recomendación Final para ScanGo

### Prioridad 1 - Implementar Inmediato:
1. **exchangerate.host** - Para mostrar precios en múltiples monedas en el menú público (complementa el selector de moneda ya implementado)

### Prioridad 2 - Evaluar en Futuro:
2. **ReqKey** - Para gestión de API keys y rate limiting de la API pública de ScanGo
3. **Cambio Uruguay** - Para tasas de cambio específicas del mercado uruguayo
4. **VATComply.com** - Para validación de IVA y geolocalización de IP

### Prioridad 3 - No Implementar:
- Todas las APIs de Social (no aportan valor a ScanGo)
- Auth0, Clerk, Stytch (ScanGo ya tiene su propio sistema de auth)

---

## 🔧 Código de Ejemplo - Integrar exchangerate.host en ScanGo

```javascript
// api/utils/currencyConverter.js
const { fetchWithTimeout } = require('./fetchWithTimeout');

const EXCHANGERATE_HOST = 'https://api.exchangerate.host';

async function convertCurrency(amount, from, to = 'UYU') {
  try {
    const res = await fetchWithTimeout(
      `${EXCHANGERATE_HOST}/convert?from=${from}&to=${to}&amount=${amount}`,
      5000
    );
    const data = await res.json();
    return data.result || amount;
  } catch (e) {
    console.warn('Currency conversion failed:', e.message);
    return amount; // Fallback: devolver monto original
  }
}

module.exports = { convertCurrency };
```

---

## ✅ Conclusión

publicapis.dev ofrece varias opciones gratuitas que podrían complementar ScanGo, pero **ninguna es crítica** para el funcionamiento actual. La plataforma ya tiene soluciones propias para autenticación, pagos (Mercado Pago), notificaciones (WhatsApp, Web Push), y clima. La única integración que agregaría valor inmediato es **exchangerate.host** para soporte de múltiples monedas en el menú público.

**Recomendación final:** Implementar exchangerate.host como complemento al selector de moneda ya implementado (QW2), y mantener el resto de la pila tecnológica actual.
