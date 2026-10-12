'use strict';

/**
 * api/utils/fetchWithTimeout.js
 * ─────────────────────────────
 * fetch() de Node no tiene timeout propio: un proveedor externo que acepta la
 * conexión y nunca responde (pasarela de pago, Resend, Redis/Upstash) dejaría
 * el request del dueño colgado sin límite. Este helper envuelve fetch con
 * AbortController: si el proveedor no responde en `timeoutMs` se aborta y la
 * operación falla rápido (el llamador decide si reintentar o responder
 * honesto); el timer se limpia siempre, también en éxito.
 *
 * Si el llamador ya pasó su propio `signal`, se combina con AbortSignal.any
 * (Node 20+) para respetar ambos; el primer abort gana.
 *
 * Errores: al agotar el timeout lanza un Error con `name='FetchTimeoutError'`
 * y `code='FETCH_TIMEOUT'` (cause = el AbortError original), para que los
 * callers distingan "el proveedor no respondió" de cualquier otro fallo.
 */

const DEFAULT_TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const signal = options.signal
      ? AbortSignal.any([options.signal, controller.signal])
      : controller.signal;
    return await fetch(url, { ...options, signal });
  } catch (err) {
    if (timedOut) {
      const timeoutError = new Error(
        `Fetch externo agotó el timeout de ${timeoutMs}ms: ${String(url).slice(0, 120)}`
      );
      timeoutError.name = 'FetchTimeoutError';
      timeoutError.code = 'FETCH_TIMEOUT';
      timeoutError.cause = err;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWithTimeout, DEFAULT_TIMEOUT_MS };