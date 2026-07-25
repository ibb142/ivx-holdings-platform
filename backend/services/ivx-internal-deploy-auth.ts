import { createHmac, timingSafeEqual } from 'node:crypto';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';
import { consumeWorkerAccessToken, isAllowedWorkerAccessAction, WorkerAccessTokenError, type WorkerAccessAction } from './ivx-worker-access-token';

const NONCE_STORE = 'logs/audit/internal-deploy-auth/nonces.json';
const APPROVAL_STORE = 'logs/audit/owner-deployment-approvals/approvals.json';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_NONCES = 500;

export type InternalDeployAuthorization = {
  workerId: string;
  approvalId: string;
  requestedCommitSha: string;
  action: 'GITHUB_WRITE' | 'RENDER_DEPLOY' | 'PRODUCTION_DEPLOY';
  /** Present when this authorization was granted via a short-lived worker access token instead of the legacy owner-approval-ID store. */
  workerAccessTokenId?: string;
};

export type InternalDeployAuthStore = {
  readJson<T>(file: string, fallback: T): Promise<T>;
  writeJson(file: string, value: unknown): Promise<void>;
};

type UsedNonce = { nonce: string; expiresAt: number };
type StoredApproval = {
  id: string;
  ownerUserId: string;
  requestedCommitSha: string;
  action: InternalDeployAuthorization['action'];
  status: 'approved' | 'revoked';
  approvedAt: string;
  expiresAt: string;
  usedAt: string | null;
  requestId: string;
  createdAt: string;
};

const durableAuthStore: InternalDeployAuthStore = {
  readJson: readDurableJson,
  writeJson: writeDurableJson,
};

export class InternalDeployAuthError extends Error {
  readonly status: 401 | 403;
  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = 'InternalDeployAuthError';
    this.status = status;
  }
}

function trimmed(value: string | null | undefined): string {
  return value?.trim() ?? '';
}

function configuredSecret(): string {
  return trimmed(process.env.IVX_INTERNAL_DEPLOY_SECRET);
}

function configuredWorkerId(): string {
  return trimmed(process.env.IVX_INTERNAL_WORKER_ID);
}

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

function signaturePayload(input: { workerId: string; timestamp: string; nonce: string; method: string; pathname: string; body: string }): string {
  return [input.workerId, input.timestamp, input.nonce, input.method.toUpperCase(), input.pathname, input.body].join('\n');
}

type ParsedAuthorizationBody = {
  approvalId: string;
  requestedCommitSha: string;
  action: InternalDeployAuthorization['action'];
  workerAccessToken: string;
};

function parseAuthorizationBody(bodyText: string): ParsedAuthorizationBody {
  let raw: unknown;
  try {
    raw = JSON.parse(bodyText) as unknown;
  } catch {
    throw new InternalDeployAuthError('Signed worker requests require a JSON body.', 401);
  }
  const body = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const approvalId = typeof body.ownerApprovalId === 'string' ? body.ownerApprovalId.trim() : '';
  const requestedCommitSha = typeof body.requestedCommitSha === 'string' ? body.requestedCommitSha.trim().toLowerCase() : '';
  const action = typeof body.deploymentAction === 'string' ? body.deploymentAction.trim() : '';
  const workerAccessToken = typeof body.workerAccessToken === 'string' ? body.workerAccessToken.trim() : '';
  if (!/^[a-f0-9]{40}$/i.test(requestedCommitSha)) throw new InternalDeployAuthError('A 40-character requestedCommitSha is required.', 403);
  if (action !== 'GITHUB_WRITE' && action !== 'RENDER_DEPLOY' && action !== 'PRODUCTION_DEPLOY') throw new InternalDeployAuthError('The requested deployment action is not allowed.', 403);
  // Either a short-lived worker access token OR a legacy owner-approval-ID must be present.
  if (!workerAccessToken && (!approvalId || !/^[a-zA-Z0-9_-]{8,128}$/.test(approvalId))) {
    throw new InternalDeployAuthError('A valid ownerApprovalId or workerAccessToken is required.', 403);
  }
  return { approvalId, requestedCommitSha, action, workerAccessToken };
}

async function claimNonce(nonce: string, nowMs: number, store: InternalDeployAuthStore): Promise<void> {
  const stored = await store.readJson<UsedNonce[]>(NONCE_STORE, []);
  const active = stored.filter((item) => item.expiresAt > nowMs).slice(-MAX_NONCES);
  if (active.some((item) => item.nonce === nonce)) throw new InternalDeployAuthError('Worker nonce has already been used.', 401);
  active.push({ nonce, expiresAt: nowMs + MAX_CLOCK_SKEW_MS });
  await store.writeJson(NONCE_STORE, active);
}

export type OwnerDeploymentApprovalInput = {
  ownerUserId: string;
  requestedCommitSha: string;
  action: InternalDeployAuthorization['action'];
  requestId: string;
  expiresAt: string;
};

/** Creates a durable single-use owner approval after human JWT authorization. */
export async function createOwnerDeploymentApproval(input: OwnerDeploymentApprovalInput, store: InternalDeployAuthStore = durableAuthStore): Promise<StoredApproval> {
  const requestedCommitSha = input.requestedCommitSha.trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/i.test(requestedCommitSha)) throw new Error('requestedCommitSha must be a 40-character SHA.');
  if (Date.parse(input.expiresAt) <= Date.now()) throw new Error('expiresAt must be in the future.');
  const approvals = await store.readJson<StoredApproval[]>(APPROVAL_STORE, []);
  const approval: StoredApproval = {
    id: crypto.randomUUID(),
    ownerUserId: input.ownerUserId,
    requestedCommitSha,
    action: input.action,
    status: 'approved',
    approvedAt: new Date().toISOString(),
    expiresAt: input.expiresAt,
    usedAt: null,
    requestId: input.requestId,
    createdAt: new Date().toISOString(),
  };
  approvals.push(approval);
  await store.writeJson(APPROVAL_STORE, approvals.slice(-MAX_NONCES));
  return approval;
}

async function consumeApproval(input: InternalDeployAuthorization, store: InternalDeployAuthStore): Promise<void> {
  const approvals = await store.readJson<StoredApproval[]>(APPROVAL_STORE, []);
  const now = Date.now();
  const index = approvals.findIndex((approval) => approval.id === input.approvalId);
  const approval = index >= 0 ? approvals[index] : null;
  if (!approval || approval.status !== 'approved') throw new InternalDeployAuthError('No approved owner deployment record exists for this request.', 403);
  if (approval.usedAt) throw new InternalDeployAuthError('The owner deployment approval has already been used.', 403);
  if (Date.parse(approval.expiresAt) <= now) throw new InternalDeployAuthError('The owner deployment approval has expired.', 403);
  if (approval.requestedCommitSha !== input.requestedCommitSha || approval.action !== input.action) {
    throw new InternalDeployAuthError('The owner approval does not match the requested commit and action.', 403);
  }
  approvals[index] = { ...approval, usedAt: new Date(now).toISOString() };
  await store.writeJson(APPROVAL_STORE, approvals);
}

/** Validates and consumes a one-time signed worker deployment authorization. */
export async function authorizeInternalDeploymentRequest(request: Request, store: InternalDeployAuthStore = durableAuthStore): Promise<InternalDeployAuthorization> {
  const secret = configuredSecret();
  const expectedWorkerId = configuredWorkerId();
  if (!secret || !expectedWorkerId) throw new InternalDeployAuthError('Internal worker authentication is not configured.', 401);

  const workerId = trimmed(request.headers.get('X-IVX-Worker-ID'));
  const timestamp = trimmed(request.headers.get('X-IVX-Timestamp'));
  const nonce = trimmed(request.headers.get('X-IVX-Nonce'));
  const receivedSignature = trimmed(request.headers.get('X-IVX-Deploy-Signature'));
  if (!workerId || !timestamp || !nonce || !receivedSignature) throw new InternalDeployAuthError('Required signed worker authentication headers are missing.', 401);
  if (!secureEqual(workerId, expectedWorkerId)) throw new InternalDeployAuthError('Worker identity is not authorized.', 401);
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) throw new InternalDeployAuthError('Worker request timestamp is expired or invalid.', 401);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) throw new InternalDeployAuthError('Worker request nonce is invalid.', 401);

  const body = await request.clone().text();
  const expectedSignature = createHmac('sha256', secret).update(signaturePayload({ workerId, timestamp, nonce, method: request.method, pathname: new URL(request.url).pathname, body }), 'utf8').digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(receivedSignature) || !secureEqual(receivedSignature.toLowerCase(), expectedSignature)) throw new InternalDeployAuthError('Worker request signature is invalid.', 401);

  const parsed = parseAuthorizationBody(body);
  await claimNonce(nonce, Date.now(), store);

  // Short-lived worker access token path (preferred — no permanent owner
  // session ever stored in Render). Falls back to the legacy owner-approval-ID
  // store only when no token is presented.
  if (parsed.workerAccessToken) {
    let consumed: Awaited<ReturnType<typeof consumeWorkerAccessToken>>;
    try {
      consumed = await consumeWorkerAccessToken({
        rawToken: parsed.workerAccessToken,
        action: parsed.action as WorkerAccessAction,
        commitSha: parsed.requestedCommitSha,
        workerId,
      });
    } catch (error) {
      if (error instanceof WorkerAccessTokenError) {
        throw new InternalDeployAuthError(error.message, error.status === 401 ? 401 : 403);
      }
      throw error;
    }
    return {
      workerId,
      approvalId: consumed.id,
      requestedCommitSha: consumed.commitSha,
      action: parsed.action,
      workerAccessTokenId: consumed.id,
    };
  }

  const authorization: InternalDeployAuthorization = { workerId, approvalId: parsed.approvalId, requestedCommitSha: parsed.requestedCommitSha, action: parsed.action };
  await consumeApproval(authorization, store);
  return authorization;
}

/** Secret-safe startup configuration status for observability. */
export function internalDeployAuthRuntimeStatus(): { workerIdConfigured: boolean; secretConfigured: boolean } {
  return { workerIdConfigured: Boolean(configuredWorkerId()), secretConfigured: Boolean(configuredSecret()) };
}

export type InternalWorkerSignatureResult =
  | { ok: true; workerId: string }
  | { ok: false; reason: string };

/**
 * Verifies (and replay-protects) a signed internal-worker request WITHOUT
 * consuming an owner deployment approval. This is the lightweight sibling of
 * `authorizeInternalDeploymentRequest`, intended for authenticated read-only
 * calls the worker makes back to its own API (e.g. polling its own job status
 * during LIVE_VERIFYING) rather than for deployment-mutating actions.
 *
 * Uses the same HMAC scheme/headers (`X-IVX-Worker-ID`, `X-IVX-Timestamp`,
 * `X-IVX-Nonce`, `X-IVX-Deploy-Signature`) and nonce replay store as the
 * deployment-authorization path, so no new secret is introduced.
 */
export async function verifyInternalWorkerSignature(request: Request, store: InternalDeployAuthStore = durableAuthStore): Promise<InternalWorkerSignatureResult> {
  const secret = configuredSecret();
  const expectedWorkerId = configuredWorkerId();
  if (!secret || !expectedWorkerId) return { ok: false, reason: 'internal_worker_auth_not_configured' };

  const workerId = trimmed(request.headers.get('X-IVX-Worker-ID'));
  const timestamp = trimmed(request.headers.get('X-IVX-Timestamp'));
  const nonce = trimmed(request.headers.get('X-IVX-Nonce'));
  const receivedSignature = trimmed(request.headers.get('X-IVX-Deploy-Signature'));
  if (!workerId || !timestamp || !nonce || !receivedSignature) return { ok: false, reason: 'missing_signature_headers' };
  if (!secureEqual(workerId, expectedWorkerId)) return { ok: false, reason: 'worker_id_mismatch' };

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) return { ok: false, reason: 'timestamp_out_of_range' };
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)) return { ok: false, reason: 'invalid_nonce_format' };

  const body = await request.clone().text();
  const expectedSignature = createHmac('sha256', secret).update(signaturePayload({ workerId, timestamp, nonce, method: request.method, pathname: new URL(request.url).pathname, body }), 'utf8').digest('hex');
  if (!/^[a-f0-9]{64}$/i.test(receivedSignature) || !secureEqual(receivedSignature.toLowerCase(), expectedSignature)) return { ok: false, reason: 'signature_mismatch' };

  try {
    await claimNonce(nonce, Date.now(), store);
  } catch {
    return { ok: false, reason: 'nonce_already_used' };
  }

  return { ok: true, workerId };
}
