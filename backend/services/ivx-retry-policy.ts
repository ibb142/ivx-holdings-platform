/** Shared retry policy for fleet work and its upstream requests. */
export const IVX_RETRY_POLICY_MARKER = 'ivx-fleet-retry-policy-2026-09-08-v1';
export const FLEET_RETRY_BUDGET_MS = 15 * 60_000;
export const FLEET_RETRY_BASE_MS = 1_000;
export const FLEET_RETRY_CAP_MS = 30_000;

export function retryDelayMs(retry: number, baseMs = FLEET_RETRY_BASE_MS, capMs = FLEET_RETRY_CAP_MS, random = Math.random): number {
  const ceiling = Math.min(Math.max(0, capMs), Math.max(0, baseMs) * 2 ** Math.min(30, Math.max(0, retry - 1)));
  const sample = random();
  if (!Number.isFinite(ceiling) || !Number.isFinite(sample)) throw new Error('Invalid retry policy');
  // Full jitter remains random even at the cap; capped additive jitter does not.
  return Math.floor(ceiling * Math.max(0, Math.min(1, sample)));
}

export function isTransientFailure(error: unknown, status?: number): boolean {
  if (status && status >= 400) return status === 408 || status === 429 || status >= 500 && status <= 599;
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error ?? '');
  if (/\b(401|403|404|400|422)\b|unauthori[sz]ed|forbidden|permission denied|owner.approval|missing credential/i.test(message)) return false;
  return /timeout|timed out|network|fetch failed|ECONN|EAI_AGAIN|rate.limit|\b(408|429|50[0-9]|51[0-1])\b|schema cache|temporar|service unavailable/i.test(message);
}

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? Math.max(0, timestamp - now) : 0;
}

export type RetryDecision = { retry: true; delayMs: number; nextRetry: number } | { retry: false; reason: 'attempt_budget' | 'time_budget' };
export function decideRetry(input: { retriesUsed: number; maxRetries: number; startedAtMs: number; nowMs: number; maxElapsedMs: number; baseMs?: number; capMs?: number; retryAfterMs?: number; random?: () => number }): RetryDecision {
  if (!Number.isInteger(input.retriesUsed) || input.retriesUsed < 0 || !Number.isFinite(input.maxRetries) || input.retriesUsed >= Math.max(0, input.maxRetries)) return { retry: false, reason: 'attempt_budget' };
  const nextRetry = input.retriesUsed + 1;
  const delayMs = Math.max(retryDelayMs(nextRetry, input.baseMs, input.capMs, input.random), input.retryAfterMs ?? 0);
  const elapsed = input.nowMs - input.startedAtMs;
  if (!Number.isFinite(elapsed) || elapsed < 0 || !Number.isFinite(input.maxElapsedMs) || elapsed + delayMs >= input.maxElapsedMs) return { retry: false, reason: 'time_budget' };
  return { retry: true, delayMs, nextRetry };
}

/** Process-wide upstream retry quota. First attempts never consume this quota. */
export class RetryQuota {
  private tokens: number;
  private updatedAt: number;
  constructor(private readonly capacity = 30, private readonly refillPerSecond = 2, private readonly clock = Date.now) {
    this.tokens = capacity;
    this.updatedAt = clock();
  }
  take(): boolean {
    const now = this.clock();
    this.tokens = Math.min(this.capacity, this.tokens + Math.max(0, now - this.updatedAt) / 1_000 * this.refillPerSecond);
    this.updatedAt = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

export type TaskRetryFields = {
  retryCount: number; maxRetries: number; retryStartedAt?: string | null;
  retryNotBefore?: string | null;
};
export function planTaskRetry(task: TaskRetryFields, now = Date.now(), random = Math.random) {
  const startedAt = task.retryStartedAt ?? new Date(now).toISOString();
  const decision = decideRetry({ retriesUsed: task.retryCount, maxRetries: task.maxRetries, startedAtMs: Date.parse(startedAt), nowMs: now, maxElapsedMs: FLEET_RETRY_BUDGET_MS, random });
  return {
    state: decision.retry ? 'RETRYING' as const : 'FAILED' as const,
    retryCount: decision.retry ? decision.nextRetry : task.retryCount,
    retryStartedAt: startedAt,
    retryNotBefore: decision.retry ? new Date(now + decision.delayMs).toISOString() : null,
    leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null,
    blocker: null,
    error: decision.retry ? null : `retry ${decision.reason} exhausted`,
    completedAt: decision.retry ? null : new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
  };
}

export function taskRetryDue(task: TaskRetryFields, now = Date.now()): boolean {
  if (!task.retryNotBefore) return true; // Existing tasks have no scheduled retry.
  const at = Date.parse(task.retryNotBefore);
  return Number.isFinite(at) && at <= now;
}

export function taskRetryExpired(task: TaskRetryFields, now = Date.now()): boolean {
  if (!task.retryStartedAt) return false;
  const started = Date.parse(task.retryStartedAt);
  return !Number.isFinite(started) || started > now || now - started >= FLEET_RETRY_BUDGET_MS;
}
