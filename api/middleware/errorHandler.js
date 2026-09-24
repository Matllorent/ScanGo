const { ZodError } = require('zod');
const AppError = require('../utils/AppError');

/**
 * Global Express Error Handler Middleware
 * Standardizes responses and formats all timestamps exclusively in UTC (ISO 8601).
 *
 * @param {Error} err
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function errorHandler(err, req, res, next) {
  if (res.headersSent) {
    return next(err);
  }

  const utcTimestamp = new Date().toISOString(); // ISO 8601 UTC

  // Handle Custom AppError operational exceptions
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message,
      code: err.code || 'OPERATIONAL_ERROR',
      ...(err.details ? { details: err.details } : {}),
      timestamp: utcTimestamp
    });
  }

  // Handle Zod Validation Errors
  if (err instanceof ZodError || err.name === 'ZodError' || (err.issues && Array.isArray(err.issues))) {
    const firstError = err.issues?.[0]?.message || err.errors?.[0]?.message || 'Error de validación en los datos de entrada';
    const formattedDetails = typeof err.format === 'function' ? err.format() : (err.issues || err.errors);
    return res.status(400).json({
      success: false,
      error: firstError,
      code: 'VALIDATION_ERROR',
      details: formattedDetails,
      timestamp: utcTimestamp
    });
  }

  // Handle Malformed JSON Syntax Errors
  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    return res.status(400).json({
      success: false,
      error: 'Sintaxis JSON malformada en el cuerpo de la solicitud',
      code: 'BAD_REQUEST',
      timestamp: utcTimestamp
    });
  }

  // Handle standard HTTP / unhandled errors
  const statusCode = err.statusCode || err.status || 500;
  const message = err.message || 'Error interno del servidor';
  const errorCode = err.code || (statusCode >= 500 ? 'INTERNAL_SERVER_ERROR' : 'API_ERROR');
  const details = process.env.NODE_ENV !== 'production' && err.stack ? { stack: err.stack } : null;

  if (statusCode >= 500) {
    console.error(`[API Error 500] [${utcTimestamp}] ${req.method} ${req.originalUrl}:`, err);
  }

  return res.status(statusCode).json({
    success: false,
    error: message,
    code: errorCode,
    ...(details ? { details } : {}),
    timestamp: utcTimestamp
  });
}

module.exports = errorHandler;
