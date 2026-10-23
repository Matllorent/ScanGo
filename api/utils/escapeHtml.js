const path = require('path');

/**
 * Backend escapeHtml utility - re-exports the legacy CommonJS escapeHtml
 * from public/js/utils/escapeHtml.js to avoid duplication.
 */
const escapeHtmlModule = require(path.join(__dirname, '..', '..', 'public', 'js', 'utils', 'escapeHtml'));

module.exports = escapeHtmlModule.escapeHtml;