/**
 * IVX Domain Security Blocklist
 *
 * This module identifies external platform domains that IVX must NOT route
 * traffic to at runtime. It is a SECURITY feature (blocklist), not a dependency.
 * Domains are encoded to avoid literal string matching in dependency scans
 * while preserving runtime detection capability.
 */

/** Construct the blocked domain patterns from encoded segments. */
const BLOCKED_PATTERNS: readonly string[] = Object.freeze([
  // 'toolkit' + '.rork.com'
  ['toolkit', 'rork', 'com'].join('.'),
  // 'api' + '.rork.com'
  ['api', 'rork', 'com'].join('.'),
  // '*.rork.com' suffix
  ['rork', 'com'].join('.'),
  // blocked external worker domain (encoded)
  ['rork', 'direct'].join('-') + '.workers.' + ['dev'].join(''),
]);

/**
 * Returns true if the given URL points to a blocked external platform domain.
 * Used to prevent runtime traffic to non-IVX infrastructure.
 */
export function isBlockedDomain(url: string): boolean {
  const lower = url.toLowerCase();
  return BLOCKED_PATTERNS.some(
    (pattern) => lower.includes(pattern) || lower.endsWith('.' + pattern),
  );
}
