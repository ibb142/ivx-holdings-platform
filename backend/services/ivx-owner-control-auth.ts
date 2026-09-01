/**
 * Canonical owner-control authorization for IVX fleet-control mutations.
 *
 * Resolves ONE authorization decision for endpoints such as
 * POST /api/ivx/agents/app-completion/control and POST /api/ivx/agents/:id/run.
 *
 * Accepted credentials (fail-closed — at least one must match):
 *   1. Canonical IVX system secret via resolveActiveIVXSystemSecret()
 *      (Render env IVX_AI_SYSTEM_SECRET -> stored Owner Variables ->
 *      IVX_SYSTEM_SECRET -> IVX_OWNER_TOKEN).
 *   2. Stored Owner Variables value of IVX_AI_SYSTEM_SECRET accepted as an
 *      explicit backward-compatible candidate so automation holding a rotated
 *      stored credential is not locked out while the env rotation propagates.
 *   3. GitHub Actions OIDC machine auth (X-IVX-GitHub-OIDC header) verified
 *      cryptographically and restricted to ibb142/ivx-holdings-platform@main.
 *
 * All comparisons are constant-time. Nothing is logged.
 */
import { timingSafeEqual } from 'node:crypto';
import { resolveActiveIVXSystemSecret, invalidateIVXSystemSecretCache } from './ivx-system-secret';
import { verifyIVXGitHubActionsOIDCRequest } from './ivx-github-actions-oidc';

function constantTimeEquals(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
  } catch {
    return false;
  }
}

async function storedOwnerSystemSecret(): Promise<string> {
  try {
    const { getIVXOwnerVariableRuntimeValue } = await import('../api/ivx-owner-variables');
    return ((await getIVXOwnerVariableRuntimeValue('IVX_AI_SYSTEM_SECRET', { preferStored: true })) || '').trim();
  } catch {
    return '';
  }
}

/**
 * Authorizes a fleet-control request.
 *
 * @param provided Credential sent by the caller (owner key or approval token). May be ''.
 * @param request  Optional raw Request — enables GitHub Actions OIDC machine auth.
 */
export async function authorizeIVXOwnerControl(provided: string, request?: Request): Promise<boolean> {
  const candidates: Array<Promise<string>> = [resolveActiveIVXSystemSecret(), storedOwnerSystemSecret()];
  for (const candidate of await Promise.all(candidates)) {
    if (candidate && provided && constantTimeEquals(provided, candidate)) {
      return true;
    }
  }
  if (request) {
    try {
      if (await verifyIVXGitHubActionsOIDCRequest(request)) return true;
    } catch {
      return false;
    }
  }
  return false;
}

export { invalidateIVXSystemSecretCache };
