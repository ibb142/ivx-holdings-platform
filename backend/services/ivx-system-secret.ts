/**
 * Active IVX AI system secret resolver.
 *
 * Resolves the system key used to authorize fleet-control mutations
 * (POST /api/ivx/agents/:id/run, pause/resume/enable, certificate runs).
 *
 * Priority:
 *   1. Encrypted Owner Variables store (`IVX_AI_SYSTEM_SECRET`)
 *   2. Render/process environment `IVX_AI_SYSTEM_SECRET`
 *   3. Render/process environment `IVX_SYSTEM_SECRET`
 *   4. Legacy `IVX_OWNER_TOKEN` environment fallback
 *
 * The Owner Variables value is authoritative because it is the owner-managed
 * source of truth. This prevents a stale Render environment value from
 * shadowing a newly rotated fleet credential. Downstream mutation risk gates
 * remain unchanged.
 *
 * The resolved value is cached briefly so a 112-agent cycle does not hit the
 * variables store once per request.
 */
import { readIVXTrimmedString } from '../../expo/shared/ivx';

const CACHE_TTL_MS = 30_000;

let cached: { secret: string; at: number } | null = null;

/** Clears the cache after the owner saves or deletes the stored secret. */
export function invalidateIVXSystemSecretCache(): void {
  cached = null;
}

/** Resolves the currently active IVX AI system key (never logged). */
export async function resolveActiveIVXSystemSecret(): Promise<string> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return cached.secret;
  }

  let secret = '';

  try {
    // Dynamic import avoids a static import cycle with the owner-variables API.
    const { getIVXOwnerVariableRuntimeValue } = await import('../api/ivx-owner-variables');
    secret = (await getIVXOwnerVariableRuntimeValue('IVX_AI_SYSTEM_SECRET', { preferStored: true })).trim();
  } catch {
    secret = '';
  }

  if (!secret) {
    secret = readIVXTrimmedString(process.env.IVX_AI_SYSTEM_SECRET);
  }

  if (!secret) {
    secret = readIVXTrimmedString(process.env.IVX_SYSTEM_SECRET);
  }

  if (!secret) {
    secret = readIVXTrimmedString(process.env.IVX_OWNER_TOKEN);
  }

  cached = { secret, at: now };
  return secret;
}
