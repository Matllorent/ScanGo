/**
 * api/services/geminiMenuParser.js
 * Multi-page physical restaurant menu parser using Google GenAI SDK (@google/genai)
 * Model: gemini-3.8-flash (multimodal, structured JSON schema output)
 */

const { GoogleGenAI, Type } = require('@google/genai');
const crypto = require('crypto');

// El SDK de Gemini no expone timeout propio: una inferencia que acepta la
// conexión y nunca responde colgaría el request del Studio. Se corre la
// llamada en carrera con un timeout y, al agotarse, se degrada al fallback
// demo (mismo trato que cuota agotada / imagen ilegible).
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS) || 25000;

function withGeminiTimeout(promise) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(`Gemini agotó el timeout de ${GEMINI_TIMEOUT_MS}ms`);
      err.code = 'GEMINI_TIMEOUT';
      reject(err);
    }, GEMINI_TIMEOUT_MS);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Cache en memoria por hash de las imágenes (best-effort, como el resto de
// caches del repo): re-analizar las mismas páginas no quema cuota ni plata.
// TTL 30 min, cap 20 entradas con evicción de la más vieja.
const GEMINI_CACHE_TTL_MS = 30 * 60 * 1000;
const GEMINI_CACHE_MAX = 20;
const geminiResultCache = new Map(); // sha256 -> { at, result }

function geminiCacheKey(images) {
  const h = crypto.createHash('sha256');
  for (const img of images) {
    const raw = typeof img === 'string' ? img : (img.data || img || '');
    const mime = (img && img.mimeType) || 'image/jpeg';
    h.update(String(mime));
    h.update(String(raw));
  }
  return h.digest('hex');
}

function geminiCacheGet(key) {
  const hit = geminiResultCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > GEMINI_CACHE_TTL_MS) {
    geminiResultCache.delete(key);
    return null;
  }
  return hit.result;
}

function geminiCacheSet(key, result) {
  geminiResultCache.delete(key);
  geminiResultCache.set(key, { at: Date.now(), result });
  while (geminiResultCache.size > GEMINI_CACHE_MAX) {
    geminiResultCache.delete(geminiResultCache.keys().next().value);
  }
}

/**
 * Strict JSON schema matching the required menu output structure.
 * Usa el enum `Type` del SDK (forma canónica documentada) + `propertyOrdering`
 * para una salida estable entre llamadas.
 */
const MENU_RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    detectedStyle: {
      type: Type.OBJECT,
      properties: {
        primaryColor: {
          type: Type.STRING,
          description: 'Color primario predominante de la carta o marca en formato hexadecimal #RRGGBB (ej: #1F2937, #8B0000, #2D3748)'
        },
        accentColor: {
          type: Type.STRING,
          description: 'Color secundario o de acento llamativo en formato hexadecimal #RRGGBB (ej: #ECC94B, #E11D48, #38A169)'
        },
        vibe: {
          type: Type.STRING,
          description: 'Estilo estético detectado (ej: Rústico de Bodegón / Asador, Bistró Moderno, Cafetería Minimalista, Taquería Urbana, Bar Nocturno)'
        }
      },
      propertyOrdering: ['primaryColor', 'accentColor', 'vibe'],
      required: ['primaryColor', 'accentColor', 'vibe']
    },
    categories: {
      type: Type.ARRAY,
      description: 'Lista de secciones o categorías encontradas a lo largo de todas las páginas del menú',
      items: {
        type: Type.OBJECT,
        properties: {
          name: {
            type: Type.STRING,
            description: 'Nombre de la categoría (ej: Entradas, Pastas Caseras, Carnes a las Brasas, Tragos Clásicos, Postres)'
          },
          items: {
            type: Type.ARRAY,
            description: 'Platos, bebidas o productos que pertenecen a esta categoría',
            items: {
              type: Type.OBJECT,
              properties: {
                name: {
                  type: Type.STRING,
                  description: 'Nombre claro del plato o producto'
                },
                description: {
                  type: Type.STRING,
                  description: 'Ingredientes o descripción detallada del plato tal como figura en la carta (o texto vacío si no hay)'
                },
                price: {
                  type: Type.NUMBER,
                  description: 'Precio numérico del plato (0 si no figura precio explícito)'
                }
              },
              propertyOrdering: ['name', 'description', 'price'],
              required: ['name', 'price']
            }
          }
        },
        propertyOrdering: ['name', 'items'],
        required: ['name', 'items']
      }
    }
  },
  propertyOrdering: ['detectedStyle', 'categories'],
  required: ['detectedStyle', 'categories']
};

const SYSTEM_PROMPT = `Eres un sumiller, chef ejecutivo y diseñador de cartas gastronómicas de alta precisión.
Tu misión es digitalizar fielmente una carta de restaurante físico a partir de una o varias páginas (fotos/escaneos de portada, interiores, secciones de comida, cafetería, bebidas y postres).

Reglas de extracción y normalización:
1. Analiza todas las imágenes en conjunto como un único menú coherente.
2. Extrae todas las categorías en orden lógico de servicio (ej: Entradas, Principales, Guarniciones, Postres, Bebidas / Tragos).
3. Para cada plato:
   - Nombre: limpio, sin números de ítem ni símbolos raros.
   - Descripción: ingredientes, método de cocción o detalles indicados en la carta.
   - Precio: convierte cualquier formato monetario ($ 1.200, 12.50, €15, etc.) a un valor numérico positivo (ej: 1200 o 12.5). Si no tiene precio o dice 'S/P', pon 0.
4. Análisis de Estilo Visual (detectedStyle):
   - Infiere los colores primario y acento más representativos de la tipografía, logotipo, bordes o papel del menú en formato HEX (#RRGGBB).
   - Identifica la "vibe" o personalidad del lugar (ej. "Rústico y Cálido", "Bistró Elegante", "Urbano & Smash Burgers", "Café de Especialidad").
5. La salida DEBE ser estrictamente un objeto JSON que respete el esquema solicitado. No incluyas markdown adicional fuera del JSON.`;

/**
 * Parses menu images using Gemini 3.8 Flash multimodal API.
 * @param {Array<{data: string, mimeType: string}>} images List of image objects with base64 data and mimeType.
 * @returns {Promise<{detectedStyle: object, categories: Array}>}
 */
async function parseMenuWithGemini(images) {
  if (!images || !Array.isArray(images) || images.length === 0) {
    throw new Error('Debes proporcionar al menos una imagen de la carta.');
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.GOOGLE_GENAI_API_KEY;

  if (!apiKey) {
    // Graceful fallback for local development or when API key is not yet set
    console.warn('[GEMINI-MENU-PARSER] No GEMINI_API_KEY detected. Returning demo extracted menu.');
    return getFallbackDemoMenu();
  }

  // Cache por hash de las imágenes: re-analizar las mismas páginas no quema
  // cuota. Solo se cachean parseos REALES (nunca el fallback demo: si la cuota
  // se recupera, el próximo intento debe pegar de verdad).
  const cacheKey = geminiCacheKey(images);
  const cached = geminiCacheGet(cacheKey);
  if (cached) return cached;

  const ai = new GoogleGenAI({ apiKey });
  const model = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  const fallbackToDemo = (err, reason) => {
    const errText = [
      err?.message,
      err?.code,
      err?.status,
      err?.error?.message,
      err?.body?.error?.message,
      err?.details,
      JSON.stringify(err)
    ].filter(Boolean).join(' ');

    const hasTemporaryIssue = /UNAVAILABLE|RESOURCE_EXHAUSTED|quota|RATE_LIMIT|429|503|high demand|temporarily|too many requests|capacity|overloaded|GEMINI_TIMEOUT|timeout/i.test(errText);
    const isUnprocessableImage = /400|INVALID_ARGUMENT|Unable to process input image|bad image|cannot process|unsupported image/i.test(errText);
    if (hasTemporaryIssue || isUnprocessableImage) {
      if (isUnprocessableImage) {
        console.warn(`[GEMINI-MENU-PARSER] Image not readable by Gemini (${reason}). Falling back to demo menu. Tip: use JPG/PDF with good lighting.`);
      } else {
        console.warn(`[GEMINI-MENU-PARSER] Gemini temporarily unavailable (${reason}). Returning demo fallback menu.`);
      }
      return getFallbackDemoMenu();
    }
    return null;
  };

  // Format parts for Google GenAI SDK (supports images and PDF documents)
  const formattedParts = images.map((img, idx) => {
    let rawData = img.data || img;
    let mimeType = img.mimeType || 'image/jpeg';

    if (typeof rawData === 'string' && rawData.includes(';base64,')) {
      const split = rawData.split(';base64,');
      const match = split[0].match(/data:([^;]+)/);
      if (match) mimeType = match[1];
      rawData = split[1];
    }

    return {
      inlineData: {
        mimeType,
        data: rawData
      }
    };
  });

  try {
    const response = await withGeminiTimeout(ai.models.generateContent({
      model,
      contents: formattedParts,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: 'application/json',
        // responseJsonSchema es la vía canónica (responseSchema era el alias
        // legacy y ya no figura en la documentación del SDK).
        responseJsonSchema: MENU_RESPONSE_SCHEMA
      }
    }));

    let jsonString = response.text;
    if (!jsonString && response.candidates && response.candidates[0]?.content?.parts) {
      jsonString = response.candidates[0].content.parts.map(p => p.text).filter(Boolean).join('');
    }

    if (!jsonString) {
      throw new Error('Gemini no devolvió texto en la respuesta.');
    }

    const parsed = JSON.parse(jsonString);
    const result = sanitizeParsedMenu(parsed);
    geminiCacheSet(cacheKey, result);
    return result;
  } catch (err) {
    console.error('[GEMINI-MENU-PARSER-ERROR]', err);

    const fallback = fallbackToDemo(err, 'generateContent failed');
    if (fallback) return fallback;

    let msg = err.message || 'Error desconocido';
    if (msg.includes('API_KEY_INVALID') || msg.includes('API key not valid')) {
      msg = 'La clave GEMINI_API_KEY no es válida o está deshabilitada.';
    } else if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('Quota exceeded')) {
      msg = 'Se ha superado la cuota de la API de Gemini. Espera unos segundos o revisa tus límites en Google AI Studio.';
    }
    throw new Error(`Error al procesar la carta con Gemini: ${msg}`);
  }
}

/**
 * Sanitizes and validates the extracted menu data.
 */
function sanitizeParsedMenu(parsed) {
  const result = {
    detectedStyle: {
      primaryColor: '#1F2937',
      accentColor: '#ECC94B',
      vibe: 'Bistró Clásico Artesanal'
    },
    categories: [],
    // Los parseos reales NO son demo: el flag explícito evita que el caller
    // confunda una carta real con el fallback (que trae true).
    isDemoFallback: false
  };

  if (parsed.detectedStyle) {
    if (typeof parsed.detectedStyle.primaryColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.detectedStyle.primaryColor)) {
      result.detectedStyle.primaryColor = parsed.detectedStyle.primaryColor;
    }
    if (typeof parsed.detectedStyle.accentColor === 'string' && /^#[0-9A-Fa-f]{6}$/.test(parsed.detectedStyle.accentColor)) {
      result.detectedStyle.accentColor = parsed.detectedStyle.accentColor;
    }
    if (typeof parsed.detectedStyle.vibe === 'string' && parsed.detectedStyle.vibe.trim()) {
      result.detectedStyle.vibe = parsed.detectedStyle.vibe.trim().slice(0, 100);
    }
  }

  if (Array.isArray(parsed.categories)) {
    result.categories = parsed.categories.map((cat, catIdx) => {
      const catName = String(cat.name || '').trim().slice(0, 80);
      const items = Array.isArray(cat.items) ? cat.items.map((item) => ({
        name: (typeof item.name === 'string') ? item.name.trim().slice(0, 100) : '',
        description: String(item.description || '').trim().slice(0, 300),
        price: Math.max(0, parseFloat(item.price) || 0)
      })).filter(it => it.name.length > 0) : [];

      return {
        name: catName,
        items
      };
    }).filter(c => c.name.length > 0 && c.items.length > 0);
  }

  return result;
}

/**
 * Fallback menu used when no GEMINI_API_KEY is present in development/testing.
 */
function getFallbackDemoMenu() {
  return {
    detectedStyle: {
      primaryColor: '#1A202C',
      accentColor: '#ECC94B',
      vibe: 'Bistró Artesanal & Parrilla'
    },
    categories: [
      {
        name: 'Entradas & Tapas',
        items: [
          { name: 'Empanada Criolla Cortada a Cuchillo', description: 'Carne vacuna seleccionada, cebolla de verdeo y huevo de campo', price: 350 },
          { name: 'Provoleta a las Brasas con Orégano', description: 'Queso provolone fundido con aceite de oliva virgen extra y ají molido', price: 620 }
        ]
      },
      {
        name: 'Platos Principales',
        items: [
          { name: 'Bife de Chorizo Clásico (400g)', description: 'Corte de novillo a punto con papas rústicas al romero', price: 1450 },
          { name: 'Sorrentinos Caseros de Calabaza y Ricota', description: 'Con suave crema de salvia y nueces tostadas', price: 980 }
        ]
      },
      {
        name: 'Bebidas & Cafetería',
        items: [
          { name: 'Cerveza IPA Artesanal (Pinta)', description: 'Notas cítricas y amargor equilibrado', price: 420 },
          { name: 'Café Espresso Doble', description: 'Granos de especialidad tostado medio', price: 280 }
        ]
      }
    ],
    isDemoFallback: true
  };
}

module.exports = {
  parseMenuWithGemini,
  sanitizeParsedMenu,
  getFallbackDemoMenu,
  MENU_RESPONSE_SCHEMA,
  SYSTEM_PROMPT,
  GEMINI_TIMEOUT_MS
};
