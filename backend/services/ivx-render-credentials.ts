/**
 * Render credential normalization.
 *
 * Owner mandate 2026-08-23 (final closeout): the runtime env values for
 * RENDER_API_KEY / RENDER_SERVICE_ID may carry annotation labels around the
 * real credential (e.g. "Render key rnd_xxx" or a service-id field holding
 * operational notes that merely CONTAIN the id). Sending the raw value to
 * api.render.com produced 401s and blocked deploy-ID evidence. These helpers
 * extract the real `rnd_…` API key and `srv-…` service id from any raw value,
 * without ever logging the secret itself.
 */

const RENDER_API_KEY_PATTERN = /rnd_[A-Za-z0-9]+/g;
const RENDER_SERVICE_ID_PATTERN = /srv-[a-z0-9]+/g;

/** All pattern matches in the value, longest first (annotation notes may
 *  contain short decoy tokens like "srv-a"; real Render ids are ~22 chars). */
function longestMatch(value: string, pattern: RegExp): string {
  const matches = value.match(pattern) ?? [];
  if (matches.length === 0) return '';
  return matches.reduce((best, current) => (current.length > best.length ? current : best), matches[0]);
}

/**
 * Extract a real Render API key (`rnd_…`) from a raw env/owner-variable value.
 * Returns the raw trimmed value only when it already IS a bare key.
 */
export function extractRenderApiKey(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const extracted = longestMatch(value, RENDER_API_KEY_PATTERN);
  if (extracted) return extracted;
  return value.startsWith('rnd_') ? value : '';
}

/**
 * Extract a real Render service id (`srv-…`) from a raw env/owner-variable value.
 * Returns the raw trimmed value only when it already IS a bare service id.
 */
export function extractRenderServiceId(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value) return '';
  const extracted = longestMatch(value, RENDER_SERVICE_ID_PATTERN);
  if (extracted) return extracted;
  return value.startsWith('srv-') ? value : '';
}

/** True when a candidate Render API key looks structurally valid. */
export function isPlausibleRenderApiKey(value: string | null | undefined): boolean {
  return extractRenderApiKey(value).length >= 8;
}

/** True when a candidate Render service id looks structurally valid. */
export function isPlausibleRenderServiceId(value: string | null | undefined): boolean {
  return extractRenderServiceId(value).length >= 8;
}
