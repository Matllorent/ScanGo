/**
 * Sentry SDK Integration — Centralized Exception Capture
 *
 * Initializes Sentry only when SENTRY_DSN is configured.
 * In local/dev environments without DSN, all capture functions
 * are no-ops and errors are still printed to console cleanly.
 */

let Sentry = null;
let initialized = false;

function initSentry() {
  if (initialized) return Sentry;
  initialized = true;

  const dsn = process.env.SENTRY_DSN || '';
  if (!dsn) {
    return null;
  }

  try {
    // Dynamic require to avoid hard dependency when Sentry is not installed
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown',
      tracesSampleRate: parseFloat(process.env.SENTRY_TRACES_SAMPLE_RATE || '0.1'),
      beforeSend(event, hint) {
        // Sanitize sensitive data before sending to Sentry
        if (event.request && event.request.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
          delete event.request.headers['x-admin-token'];
          delete event.request.headers['x-admin-key'];
        }
        if (event.request && event.request.data) {
          delete event.request.data.password;
          delete event.request.data.adminKey;
          delete event.request.data.key;
        }
        return event;
      }
    });
    console.log('[Sentry] SDK initialized successfully');
  } catch (err) {
    console.warn('[Sentry] Failed to initialize:', err.message);
    Sentry = null;
  }

  return Sentry;
}

/**
 * Captures an exception in Sentry (if configured) and always logs to console.
 * @param {Error} error - The error to capture
 * @param {Object} context - Additional context (tags, extra data)
 */
function captureException(error, context = {}) {
  if (!error) return;

  // Always log to console for local/dev visibility
  const prefix = context.source ? `[${context.source}]` : '[Error]';
  if (context.level === 'warn') {
    console.warn(prefix, error.message || error);
  } else {
    console.error(prefix, error.message || error);
  }

  // Send to Sentry if initialized
  const sentry = initSentry();
  if (sentry) {
    try {
      sentry.withScope(scope => {
        if (context.tags) {
          Object.entries(context.tags).forEach(([key, value]) => scope.setTag(key, value));
        }
        if (context.extra) {
          scope.setExtras(context.extra);
        }
        if (context.level) {
          scope.setLevel(context.level);
        }
        sentry.captureException(error);
      });
    } catch (sentryErr) {
      console.warn('[Sentry] captureException failed:', sentryErr.message);
    }
  }
}

/**
 * Captures a message in Sentry (if configured).
 * @param {string} message - The message to capture
 * @param {Object} context - Additional context
 */
function captureMessage(message, context = {}) {
  const sentry = initSentry();
  if (!sentry) return;

  try {
    sentry.withScope(scope => {
      if (context.tags) {
        Object.entries(context.tags).forEach(([key, value]) => scope.setTag(key, value));
      }
      if (context.level) {
        scope.setLevel(context.level);
      }
      sentry.captureMessage(message, context.level || 'info');
    });
  } catch (sentryErr) {
    console.warn('[Sentry] captureMessage failed:', sentryErr.message);
  }
}

/**
 * Adds a breadcrumb for tracking user actions.
 * @param {string} message - Breadcrumb message
 * @param {Object} data - Additional data
 */
function addBreadcrumb(message, data = {}) {
  const sentry = initSentry();
  if (!sentry) return;

  try {
    sentry.addBreadcrumb({
      message,
      level: 'info',
      data,
      timestamp: Date.now() / 1000
    });
  } catch (e) { /* silent */ }
}

module.exports = {
  initSentry,
  captureException,
  captureMessage,
  addBreadcrumb
};
