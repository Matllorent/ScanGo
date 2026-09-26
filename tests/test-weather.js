const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { getWeatherContext, classifyTemperature, weatherCache } = require('../api/services/weather');

async function runTests() {
  assert.strictEqual(classifyTemperature(9.9), 'muy_frio');
  assert.strictEqual(classifyTemperature(10), 'frio');
  assert.strictEqual(classifyTemperature(17.9), 'frio');
  assert.strictEqual(classifyTemperature(18), 'templado');
  assert.strictEqual(classifyTemperature(23.9), 'templado');
  assert.strictEqual(classifyTemperature(24), 'caluroso');
  assert.strictEqual(classifyTemperature(30), 'caluroso');
  assert.strictEqual(classifyTemperature(30.1), 'muy_caluroso');
  assert.strictEqual(await getWeatherContext(''), null);

  const apiSource = fs.readFileSync(path.join(__dirname, '../api/index.js'), 'utf8');
  const studioSource = fs.readFileSync(path.join(__dirname, '../public/js/studio.js'), 'utf8');
  const menuSource = fs.readFileSync(path.join(__dirname, '../public/js/menu.js'), 'utf8');
  assert.ok(apiSource.includes('if (restaurant.smartWeatherEnabled && restaurant.city)'));
  assert.ok(apiSource.includes("weatherContext: weather?.weatherContext || null"));
  assert.ok(apiSource.includes('weatherContext: publicData.weatherContext'));
  assert.ok(studioSource.includes("'image/webp', 0.8"), 'Las imágenes deben convertirse a WebP con calidad 0.8');
  assert.ok(studioSource.includes('maxDimension = 1080'), 'La compresión debe limitar la dimensión a 1080 px');
  assert.ok(menuSource.includes("if (!context) return dishes"), 'El menú debe conservar el orden si el dueño lo desactiva');
  assert.ok(menuSource.includes('weatherTags || []).includes(context)'), 'El orden climático debe depender de etiquetas elegidas por el dueño');

  const originalFetch = global.fetch;
  try {
    weatherCache.clear();
    let fetchCount = 0;
    global.fetch = async url => {
      fetchCount += 1;
      if (String(url).includes('geocoding-api')) {
        return { ok: true, json: async () => ({ results: [{ latitude: -34.9, longitude: -56.2 }] }) };
      }
      return { ok: true, json: async () => ({ current: { temperature_2m: 31.2 } }) };
    };

    const first = await getWeatherContext('Montevideo');
    const second = await getWeatherContext(' montevideo ');
    assert.deepStrictEqual(first, { weatherContext: 'muy_caluroso', temperatureC: 31.2 });
    assert.deepStrictEqual(second, first);
    assert.strictEqual(fetchCount, 2, 'La caché debe evitar repetir geocodificación y pronóstico por ciudad');
    assert.ok(weatherCache.get('montevideo').expiresAt > Date.now());
    assert.ok(weatherCache.get('montevideo').expiresAt - Date.now() <= 60 * 60 * 1000);

    weatherCache.clear();
    let slowFetchCount = 0;
    global.fetch = (_, { signal }) => {
      slowFetchCount += 1;
      return new Promise(resolve => {
      signal.addEventListener('abort', () => resolve(null), { once: true });
      });
    };
    const startedAt = Date.now();
    assert.strictEqual(await getWeatherContext('Ciudad lenta'), null);
    assert.ok(Date.now() - startedAt < 500, 'Un proveedor lento debe volver al menú tradicional en menos de 500 ms');
    assert.strictEqual(weatherCache.get('ciudad lenta').value, null, 'Los errores/timeout deben quedar cacheados para evitar reintentos repetidos');
    assert.strictEqual(await getWeatherContext('ciudad lenta'), null);
    assert.strictEqual(slowFetchCount, 1, 'La caché negativa debe evitar repetir una llamada lenta');
  } finally {
    global.fetch = originalFetch;
    weatherCache.clear();
  }

  console.log('✓ Clima: umbrales, caché de 1 hora por ciudad y fallback rápido verificados');
}

runTests().catch(error => {
  console.error('❌ Error en pruebas de clima:', error);
  process.exit(1);
});