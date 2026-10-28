/**
 * Security utilities for context-appropriate HTML escaping and URL sanitization.
 * Prevents Cross-Site Scripting (XSS) attacks while preserving inert user inputs.
 */

/**
 * Escapes characters with special meaning in HTML text content and attributes.
 * Replaces &, <, >, ", and ' with corresponding HTML entities.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const str = String(value);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapes attributes for safe inclusion in double-quoted HTML attributes.
 */
export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

/**
 * Validates dynamic URLs to ensure only safe protocols and relative paths are allowed.
 * Blocks dangerous schemes such as javascript:, vbscript:, and data:text/html.
 */
export function sanitizeUrl(url: unknown): string {
  if (url === null || url === undefined) {
    return '';
  }
  const trimmed = String(url).trim();
  if (trimmed === '') {
    return '';
  }

  // Safe relative paths or in-page anchors
  if (
    trimmed.startsWith('#') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('./') ||
    trimmed.startsWith('../')
  ) {
    return trimmed;
  }

  // Safe schemes
  const safeSchemeRegex = /^(https?:|mailto:|data:application\/json|data:text\/markdown)/i;
  if (safeSchemeRegex.test(trimmed)) {
    return trimmed;
  }

  // If unsafe or unknown scheme, return safe inert anchor
  return '#unsafe-url-blocked';
}
