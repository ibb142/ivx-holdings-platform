/**
 * IVX Worker Access Tokens — short-lived, single-use, owner-authorized worker credentials.
 *
 * Replaces the need to store a raw Supabase owner session as a permanent Render
 * secret. The owner authenticates ONCE per action with their live Supabase JWT
 * (verified by the existing registered-owner bearer guard), and this service
 * mints a short-lived (5-15 minute), single-use, action + commit-SHA-bound
 * token. Only a SHA-256 hash of the token is ever persisted — the raw value is
 * returned exactly once, to the owner, at mint time, and never logged.
 *
 * The dedicated worker then presents this token (alongside its existing signed
 * HMAC identity — see ivx-internal-deploy-auth.ts) to consume the token
 * atomically. Consumption is one-time: a second presentation of the same raw
 * token is rejected as a replay.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readDurableJson, writeDurableJson } from './ivx-durable-store';

const TOKEN_STORE = 'logs/audit/worker-access-tokens/tokens.json';
const MAX_STORED_TOKENS = 500;
const MIN_TTL_MINUTES = 5;
const MAX_TTL_MINUTES = 15;
const DEFAULT_TTL_MINUTES = 10;

export type WorkerAccessAction = 'GITHUB_WRITE' | 'RENDER_DEPLOY' | 'PRODUCTION_DEPLOY' | 'QA_ONLY';

const ALLOWED_ACTIONS = new Set<WorkerAccessAction>(['GITHUB_WRITE', 'RENDER_DEPLOY', 'PRODUCTION_DEPLOY', 'QA_ONLY']);

export type WorkerAccessTokenRecord = {
  id: string;
  ownerId: string;
  action: WorkerAccessAction;
  commitSha: string;
  tokenHash: string;
  workerId: string | null;
  requestId: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdAt: string;
};

export type WorkerAccessTokenStore = {
  readJson<T>(file: string, fallback: T): Promise<T>;
  writeJson(file: string, value: unknown): Promise<void>;
};

const durableTokenStore: WorkerAccessTokenStore = {
  readJson: readDurableJson,
  writeJson: writeDurableJson,
};

export class WorkerAccessTokenError extends Error {
  readonly status: 400 | 401 | 403 | 409 | 422;
  readonly code: string;
  constructor(message: string, status: 400 | 401 | 403 | 409 | 422, code: string) {
    super(message);
    this.name = 'WorkerAccessTokenError';
    this.status = status;
    this.code = code;
  }
}

function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken, 'utf8').digest('hex');
}

function isValidCommitSha(value: string): boolean {
  return /^[a-f0-9]{40}$/i.test(value);
}

export function isAllowedWorkerAccessAction(value: unknown): value is WorkerAccessAction {
  return typeof value === 'string' && ALLOWED_ACTIONS.has(value as WorkerAccessAction);
}

export function normalizeTtlMinutes(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_MINUTES;
  return Math.min(MAX_TTL_MINUTES, Math.max(MIN_TTL_MINUTES, Math.round(parsed)));
}

export type GenerateWorkerAccessInput = {
  ownerId: string;
  action: WorkerAccessAction;
  commitSha: string;
  requestId: string;
  workerId?: string | null;
  ttlMinutes?: number;
};

export type GenerateWorkerAccessResult = {
  rawToken: string;
  record: Omit<WorkerAccessTokenRecord, 'tokenHash'>;
};

/**
 * Mints a new short-lived worker access token. Returns the raw token exactly
 * once — callers MUST NOT log it. Only the hash is persisted.
 */
export async function generateWorkerAccessToken(
  input: GenerateWorkerAccessInput,
  store: WorkerAccessTokenStore = durableTokenStore,
): Promise<GenerateWorkerAccessResult> {
  const commitSha = input.commitSha.trim().toLowerCase();
  if (!isValidCommitSha(commitSha)) {
    throw new WorkerAccessTokenError('A 40-character commitSha is required.', 400, 'INVALID_COMMIT_SHA');
  }
  if (!isAllowedWorkerAccessAction(input.action)) {
    throw new WorkerAccessTokenError('The requested action is not an allowed worker action.', 400, 'INVALID_ACTION');
  }
  if (!input.ownerId.trim()) {
    throw new WorkerAccessTokenError('An authenticated owner ID is required.', 401, 'MISSING_OWNER');
  }

  const ttlMinutes = normalizeTtlMinutes(input.ttlMinutes);
  const rawToken = randomBytes(32).toString('base64url');
  const now = new Date();
  const record: WorkerAccessTokenRecord = {
    id: crypto.randomUUID(),
    ownerId: input.ownerId,
    action: input.action,
    commitSha,
    tokenHash: hashToken(rawToken),
    workerId: input.workerId?.trim() || null,
    requestId: input.requestId,
    issuedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMinutes * 60_000).toISOString(),
    usedAt: null,
    revokedAt: null,
    revokedReason: null,
    createdAt: now.toISOString(),
  };

  const existing = await store.readJson<WorkerAccessTokenRecord[]>(TOKEN_STORE, []);
  existing.push(record);
  await store.writeJson(TOKEN_STORE, existing.slice(-MAX_STORED_TOKENS));

  const { tokenHash: _tokenHash, ...recordWithoutHash } = record;
  return { rawToken, record: recordWithoutHash };
}

export type ConsumeWorkerAccessInput = {
  rawToken: string;
  action: WorkerAccessAction;
  commitSha: string;
  workerId: string;
};

export type ConsumeWorkerAccessResult = {
  id: string;
  ownerId: string;
  action: WorkerAccessAction;
  commitSha: string;
};

/**
 * Atomically validates and consumes one worker access token. Enforces:
 * expiry, single-use, revocation, exact action match, exact commit-SHA match,
 * and (when the token is worker-bound) exact worker-ID match. Replays of an
 * already-used or unknown token are rejected.
 */
export async function consumeWorkerAccessToken(
  input: ConsumeWorkerAccessInput,
  store: WorkerAccessTokenStore = durableTokenStore,
): Promise<ConsumeWorkerAccessResult> {
  const presentedHash = hashToken(input.rawToken);
  const commitSha = input.commitSha.trim().toLowerCase();
  const tokens = await store.readJson<WorkerAccessTokenRecord[]>(TOKEN_STORE, []);
  const index = tokens.findIndex((token) => token.tokenHash === presentedHash);
  const record = index >= 0 ? tokens[index] : null;

  if (!record) {
    throw new WorkerAccessTokenError('Worker access token is invalid or unknown.', 401, 'TOKEN_INVALID');
  }
  if (record.revokedAt) {
    throw new WorkerAccessTokenError('Worker access token has been revoked.', 403, 'TOKEN_REVOKED');
  }
  if (record.usedAt) {
    throw new WorkerAccessTokenError('Worker access token has already been used.', 409, 'TOKEN_REPLAY');
  }
  if (Date.parse(record.expiresAt) <= Date.now()) {
    throw new WorkerAccessTokenError('Worker access token has expired.', 401, 'TOKEN_EXPIRED');
  }
  if (record.action !== input.action) {
    throw new WorkerAccessTokenError('Worker access token does not authorize this action.', 403, 'ACTION_MISMATCH');
  }
  if (record.commitSha !== commitSha) {
    throw new WorkerAccessTokenError('Worker access token does not authorize this commit.', 403, 'COMMIT_MISMATCH');
  }
  if (record.workerId && record.workerId !== input.workerId) {
    throw new WorkerAccessTokenError('Worker access token is bound to a different worker.', 403, 'WORKER_MISMATCH');
  }

  tokens[index] = { ...record, usedAt: new Date().toISOString() };
  await store.writeJson(TOKEN_STORE, tokens);

  return { id: record.id, ownerId: record.ownerId, action: record.action, commitSha: record.commitSha };
}

export async function revokeWorkerAccessToken(
  tokenId: string,
  reason: string,
  store: WorkerAccessTokenStore = durableTokenStore,
): Promise<boolean> {
  const tokens = await store.readJson<WorkerAccessTokenRecord[]>(TOKEN_STORE, []);
  const index = tokens.findIndex((token) => token.id === tokenId);
  if (index < 0) return false;
  const record = tokens[index];
  if (!record || record.usedAt || record.revokedAt) return false;
  tokens[index] = { ...record, revokedAt: new Date().toISOString(), revokedReason: reason.slice(0, 300) };
  await store.writeJson(TOKEN_STORE, tokens);
  return true;
}
