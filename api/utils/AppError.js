/**
 * Custom AppError class for operational API errors
 */
class AppError extends Error {
  /**
   * @param {string} message - Error description
   * @param {number} [statusCode=500] - HTTP Status Code
   * @param {string} [code='OPERATIONAL_ERROR'] - Error code string
   * @param {any} [details=null] - Additional error details
   */
  constructor(message, statusCode = 500, code = 'OPERATIONAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;
    this.timestamp = new Date().toISOString(); // ISO 8601 UTC format

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
