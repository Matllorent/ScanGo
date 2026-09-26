const CACHE_TTL_MS = 60 * 60 * 1000;
const REQUEST_BUDGET_MS = 390;
const weatherCache = new Map();

function classifyTemperature(temperatureC) {
  if (temperatureC < 10) return 'muy_frio';
  if (temperatureC < 18) return 'frio';
  if (temperatureC < 24) return 'templado';
  if (temperatureC <= 30) return 'caluroso';
  return 'muy_caluroso';
}

async function fetchWeatherForCity(city, signal) {
  const geocodeUrl = new URL('https://geocoding-api.open-meteo.com/v1/search');
  geocodeUrl.search = new URLSearchParams({ name: city, count: '1', language: 'es', format: 'json' });
  const geocodeResponse = await fetch(geocodeUrl, { signal });
  if (!geocodeResponse.ok) return null;
  const geocodeData = await geocodeResponse.json();
  const place = geocodeData.results?.[0];
  if (!place || !Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return null;

  const forecastUrl = new URL('https://api.open-meteo.com/v1/forecast');
  forecastUrl.search = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m',
    forecast_days: '1'
  });
  const forecastResponse = await fetch(forecastUrl, { signal });
  if (!forecastResponse.ok) return null;
  const forecastData = await forecastResponse.json();
  const temperatureC = forecastData.current?.temperature_2m;
  if (!Number.isFinite(temperatureC)) return null;

  return { weatherContext: classifyTemperature(temperatureC), temperatureC };
}

async function getWeatherContext(city) {
  const normalizedCity = String(city || '').trim().toLocaleLowerCase();
  if (!normalizedCity) return null;

  const cached = weatherCache.get(normalizedCity);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (cached) weatherCache.delete(normalizedCity);

  const controller = new AbortController();
  let timeoutId;
  try {
    const timeout = new Promise(resolve => {
      timeoutId = setTimeout(() => {
        controller.abort();
        resolve(null);
      }, REQUEST_BUDGET_MS);
    });
    const result = await Promise.race([fetchWeatherForCity(normalizedCity, controller.signal), timeout]);
    weatherCache.set(normalizedCity, { value: result, expiresAt: Date.now() + CACHE_TTL_MS });
    if (weatherCache.size > 300) {
      const oldestKey = weatherCache.keys().next().value;
      weatherCache.delete(oldestKey);
    }
    return result;
  } catch (error) {
    weatherCache.set(normalizedCity, { value: null, expiresAt: Date.now() + CACHE_TTL_MS });
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { getWeatherContext, classifyTemperature, weatherCache };