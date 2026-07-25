import { createHmac, randomBytes } from 'node:crypto';

import type { InternalDeployAuthorization } from './ivx-internal-deploy-auth';

export type InternalDeploymentApprovalRequest = {
  ownerApprovalId: string;
  requestedCommitSha: string;
  deploymentAction: InternalDeployAuthorization['action'];
};

function requiredEnv(name: 'IVX_INTERNAL_DEPLOY_SECRET' | 'IVX_INTERNAL_WORKER_ID'): string {
  const value = process.env[name]?.trim() ?? '';
  if (!value) throw new Error(`${name} is not configured for the internal worker.`);
  return value;
}

function internalApiBaseUrl(): string {
  const raw = process.env.IVX_INTERNAL_API_URL?.trim() || 'https://api.ivxholding.com';
  return raw.replace(/\/$/, '');
}

/** Builds a short-lived HMAC request from the dedicated worker without exposing its secret. */
export function createInternalDeploymentAuthorizationRequest(input: InternalDeploymentApprovalRequest): Request {
  const workerId = requiredEnv('IVX_INTERNAL_WORKER_ID');
  const secret = requiredEnv('IVX_INTERNAL_DEPLOY_SECRET');
  const endpoint = `${internalApiBaseUrl()}/api/ivx/senior-developer/internal-deployment-authorizations/consume`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString('base64url');
  const body = JSON.stringify(input);
  const pathname = new URL(endpoint).pathname;
  const payload = [workerId, timestamp, nonce, 'POST', pathname, body].join('\n');
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  return new Request(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IVX-Worker-ID': workerId,
      'X-IVX-Timestamp': timestamp,
      'X-IVX-Nonce': nonce,
      'X-IVX-Deploy-Signature': signature,
    },
    body,
  });
}

/** Consumes one owner approval immediately before the corresponding protected action. */
export async function consumeInternalDeploymentApproval(input: InternalDeploymentApprovalRequest): Promise<void> {
  const response = await fetch(createInternalDeploymentAuthorizationRequest(input));
  if (response.ok) return;
  const payload = await response.json().catch((): { error?: unknown } => ({}));
  const message = typeof payload.error === 'string' ? payload.error : `Internal authorization request failed with HTTP ${response.status}.`;
  throw new Error(message.slice(0, 500));
}

export type SignedInternalGetRequestResult =
  | { ok: true; request: Request; authSource: 'internal_worker_hmac'; workerId: string }
  | { ok: false; reason: string; authSource: 'internal_worker_hmac' };

/**
 * Builds a signed, replay-protected GET request to the worker's own production
 * API using the same HMAC scheme as deployment-authorization consumption, but
 * WITHOUT any approval body (read-only calls carry no owner approval id).
 * Returns a structured failure (instead of throwing) when the worker's own
 * signing credentials are not configured, so callers can log a precise,
 * secret-safe reason rather than crash.
 */
export function createSignedInternalGetRequest(pathname: string): SignedInternalGetRequestResult {
  const authSource = 'internal_worker_hmac' as const;
  const workerId = process.env.IVX_INTERNAL_WORKER_ID?.trim() ?? '';
  const secret = process.env.IVX_INTERNAL_DEPLOY_SECRET?.trim() ?? '';
  if (!workerId) return { ok: false, reason: 'IVX_INTERNAL_WORKER_ID is not configured for the internal worker.', authSource };
  if (!secret) return { ok: false, reason: 'IVX_INTERNAL_DEPLOY_SECRET is not configured for the internal worker.', authSource };

  const endpoint = `${internalApiBaseUrl()}${pathname}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomBytes(24).toString('base64url');
  const body = '';
  const urlPathname = new URL(endpoint).pathname;
  const payload = [workerId, timestamp, nonce, 'GET', urlPathname, body].join('\n');
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  const request = new Request(endpoint, {
    method: 'GET',
    headers: {
      'X-IVX-Worker-ID': workerId,
      'X-IVX-Timestamp': timestamp,
      'X-IVX-Nonce': nonce,
      'X-IVX-Deploy-Signature': signature,
    },
  });
  return { ok: true, request, authSource, workerId };
}
