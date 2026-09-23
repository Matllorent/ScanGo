/**
 * Standard HTTP Response Helpers for Express API
 */

/**
 * Sends a standardized success HTTP response.
 * @param {import('express').Response} res - Express Response object
 * @param {any} [data=null] - Payload to return
 * @param {string} [message='Operación exitosa'] - Optional success message
 * @param {number} [statusCode=200] - HTTP Status Code
 * @param {object} [extra={}] - Additional fields to merge into top-level response
 */
function successResponse(res, data = null, message = 'Operación exitosa', statusCode = 200, extra = {}) {
  const payload = {
    success: true,
    ...(message ? { message } : {}),
    ...(data !== null && data !== undefined ? (typeof data === 'object' && !Array.isArray(data) && extra.flatData ? data : { data }) : {}),
    ...extra
  };
  delete payload.flatData;
  return res.status(statusCode).json(payload);
}

/**
 * Sends a standardized error HTTP response.
 * @param {import('express').Response} res - Express Response object
 * @param {string} [message='Error en la solicitud'] - Error message
 * @param {number} [statusCode=400] - HTTP Status Code
 * @param {any} [details=null] - Additional error details (e.g., Zod error format, validation details)
 * @param {string|null} [code=null] - Error code string
 */
function errorResponse(res, message = 'Error en la solicitud', statusCode = 400, details = null, code = null) {
  const payload = {
    success: false,
    error: message,
    ...(details !== null && details !== undefined ? { details } : {}),
    ...(code ? { code } : {})
  };
  return res.status(statusCode).json(payload);
}

module.exports = {
  successResponse,
  errorResponse,
  sendSuccess: successResponse,
  sendError: errorResponse
};
