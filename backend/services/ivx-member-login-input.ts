export type MemberLoginInput = { email: string; password: string };

/** Reject malformed public-login input before any durable-store or auth I/O.
 * Special-use TLDs (including their subdomains) cannot receive public member
 * verification mail: https://www.iana.org/assignments/special-use-domain-names/.
 * This is input validation, not an account-existence or password check.
 */
export function memberLoginInput(body: unknown): MemberLoginInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const { email, password } = body as Record<string, unknown>;
  if (typeof email !== 'string' || typeof password !== 'string') return null;
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 254 || !password.length || password.length > 1024) return null;
  if (!/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(normalized)) return null;
  if (/\.(?:test|invalid|localhost|local|example)$/.test(normalized)) return null;
  // Password whitespace is significant; never silently change credentials.
  return { email: normalized, password };
}
