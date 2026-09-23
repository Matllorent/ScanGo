const { ZodError } = require('zod');
const { errorResponse } = require('../utils/response');

/**
 * Global Express Error Handler Middleware
 * Captures uncaught exceptions, Zod validation errors, and custom API errors.
 *
 * @param {Error} err - Error object
 * @param {import('express').Request} req - Express Request
 * @param {import('express').Response} res - Express Response
 * @param {import('express').NextFunction} next - Express Next Function
 */
function errorHandler(err, req, res, next) {
  // If headers already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(err);
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError || err.name === 'ZodError' || (err.issues && Array.isArray(err.issues))) {
    const firstError = err.issues?.[0]?.message || err.errors?.[0]?.message || 'Error de validación en los datos de entrada';
    const formattedDetails = typeof err.format === 'function' ? err.format() : (err.issues || err.errors);
    return errorResponse(res, firstError, 400, formattedDetails, 'VALIDATION_ERROR');
  }

  // Handle Syntax Errors (e.g., malformed JSON payload)
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return errorResponse(res, 'Sintaxis JSON malformada en el cuerpo de la solicitud', 400, null, 'BAD_REQUEST');
  }

  // Handle custom API operational errors (errors with status/statusCode)
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Error interno del servidor';
  const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR');
  const details = process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : null;

  // Log server error details for debugging
  if (statusCode >= 500) {
    console.error(`[API Error] ${req.method} ${req.originalUrl}:`, err);
  }

  return errorResponse(res, message, statusCode, details, errorCode);
}

module.exports = errorHandler;
