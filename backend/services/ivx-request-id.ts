/**
 * Simple request ID generation helper shared across backend services.
 */
export function createRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ivx-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
