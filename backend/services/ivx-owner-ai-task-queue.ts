import { startAdaptivePoll } from './ivx-adaptive-poll';
import { boundedHealthProbe } from './ivx-bounded-health-probe';
import { createOwnerQueueProviderGate, ownerQueueWorkerReadiness } from './ivx-owner-queue-readiness';
/**
 * IVX Owner AI Durable Task Queue — P0 production reliability layer.
 *
 * Fixes the 503 failure mode: the owner message is persisted as a durable task
 * BEFORE any AI execution, the client gets a task id immediately (202), and a
 * background worker executes the AI call with bounded retries, jitter backoff,
 * dead-letter capture and restart recovery. A 60/90-second client timeout can
 * never lose an owner request again.
 *
 * State machine (owner mandate):
 *   RECEIVED → PERSISTED → QUEUED → RUNNING → (WAITING_APPROVAL) → RETRYING
 *   → COMPLETED → VERIFIED
 * Terminal: VERIFIED | FAILED | BLOCKED | CANCELED
 */

import { requestIVXAIText, validateIVXAIStartup, getProviderHealth, isIVXAIConfigured } from '../ivx-ai-runtime';
import { probeGatewayCompletion } from './ivx-ai-completion-probe';

export type IVXOwnerAITaskStatus =
  | 'RECEIVED'
  | 'PERSISTED'
  | 'QUEUED'
  | 'CLAIMED'
  | 'RUNNING'
  | 'WAITING_APPROVAL'
  | 'RETRYING'
  | 'PLANNING'
  | 'INSPECTING'
  | 'IMPLEMENTING'
  | 'TESTING'
  | 'COMMITTING'
  | 'DEPLOYING'
  | 'LIVE_VERIFYING'
  | 'ROLLING_BACK'
  | 'COMPLETED'
  | 'VERIFIED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELED';

export const IVX_TASK_TERMINAL_STATUSES: readonly IVXOwnerAITaskStatus[] = ['VERIFIED', 'FAILED', 'BLOCKED', 'CANCELED'] as const;

export function isTerminalTaskStatus(status: string): boolean {
  return (IVX_TASK_TERMINAL_STATUSES as readonly string[]).includes(status);
}

export interface IVXOwnerAITaskRow {
  id: string;
  trace_id: string;
  idempotency_key: string;
  conversation_id: string | null;
  message_id: string | null;
  prompt: string;
  status: IVXOwnerAITaskStatus;
  checkpoint: string;
  checkpoint_history: { checkpoint: string; at: string }[];
  retry_count: number;
  max_retries: number;
  next_retry_at: string | null;
  claimed_by: string | null;
  queue_lease_token?: string | null;
  queue_lease_until?: string | null;
  heartbeat_at: string | null;
  model: string | null;
  provider: string | null;
  answer: string | null;
  assistant_message_id: string | null;
  error_code: string | null;
  error_message: string | null;
  http_status: number | null;
  failure_source: string | null;
  durations: Record<string, number>;
  chaos: { failures_remaining: number; simulated_status: number } | null;
  dead_letter: boolean;
  task_type: string | null;
  assigned_worker_id: string | null;
  worker_data: Record<string, unknown> | null;
  files_changed: string[] | null;
  test_summary: Record<string, unknown> | null;
  commit_sha: string | null;
  render_deploy_id: string | null;
  runtime_sha: string | null;
  proof_ledger_id: string | null;
  task_version: number;
  recovery_attempt: number;
  pre_deploy_runtime_sha: string | null;
  resume_phase: string | null;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Pure, unit-testable reliability logic
// ---------------------------------------------------------------------------

export interface FailureClassification {
  transient: boolean;
  code: string;
}

const TRANSIENT_STATUS_CODES = new Set([429, 502, 503, 504, 408]);
const PERMANENT_STATUS_CODES = new Set([400, 401, 403, 404, 422]);
const TRANSIENT_MESSAGE_PATTERN = /timed?\s?out|timeout|connection reset|econnreset|econnrefused|socket hang ?up|network request failed|fetch failed|temporarily unavailable|service unavailable|rate.?limit|too many requests|aborted|etimedout|eai_again|overloaded/i;
const PERMANENT_MESSAGE_PATTERN = /invalid input|invalid credentials|invalid api key|unauthorized|forbidden|not configured|environment variables are missing|payload too large|invalid json/i;

/** Retry ONLY transient failures: 429/502/503/504, resets, timeouts (owner rule). */
export function classifyFailureForRetry(input: { httpStatus?: number | null; message: string }): FailureClassification {
  const status = input.httpStatus ?? null;
  if (status !== null && PERMANENT_STATUS_CODES.has(status)) {
    return { transient: false, code: `HTTP_${status}_PERMANENT` };
  }
  if (PERMANENT_MESSAGE_PATTERN.test(input.message)) {
    return { transient: false, code: 'PERMANENT_INPUT_OR_AUTH' };
  }
  if (status !== null && TRANSIENT_STATUS_CODES.has(status)) {
    return { transient: true, code: `HTTP_${status}_TRANSIENT` };
  }
  if (status !== null && status >= 500) {
    return { transient: true, code: `HTTP_${status}_TRANSIENT` };
  }
  if (TRANSIENT_MESSAGE_PATTERN.test(input.message)) {
    return { transient: true, code: 'NETWORK_OR_TIMEOUT_TRANSIENT' };
  }
  return { transient: false, code: 'UNKNOWN_PERMANENT' };
}

/** Exponential backoff with jitter. attempt is 1-based. */
export function computeRetryDelayMs(
  attempt: number,
  baseMs: number = 2_000,
  capMs: number = 60_000,
  jitterRatio: number = 0.25,
  random: () => number = Math.random,
): number {
  const exp = Math.min(capMs, baseMs * Math.pow(2, Math.max(0, attempt - 1)));
  const jitter = exp * jitterRatio * (random() * 2 - 1);
  return Math.max(500, Math.round(exp + jitter));
}

export interface FailureOutcome {
  status: Extract<IVXOwnerAITaskStatus, 'RETRYING' | 'FAILED'>;
  deadLetter: boolean;
}

/** Decide next status after a failed attempt. Exhausted transient retries → dead letter. */
export function nextStatusAfterFailure(retryCount: number, maxRetries: number, transient: boolean): FailureOutcome {
  if (!transient) return { status: 'FAILED', deadLetter: false };
  if (retryCount >= maxRetries) return { status: 'FAILED', deadLetter: true };
  return { status: 'RETRYING', deadLetter: false };
}

export type IVX503Source =
  | 'authentication_unavailable'
  | 'database_unavailable'
  | 'application_configuration'
  | 'application_relation_missing'
  | 'provider_transient'
  | 'gateway_or_render_edge'
  | 'timeout_converted'
  | 'queue_saturation'
  | 'unknown';

/** Classify where a 5xx on the owner AI route came from (Phase 1 instrumentation). */
export function classify503Source(input: { httpStatus: number; message: string }): IVX503Source {
  const m = input.message.toLowerCase();
  // Explicit subsystem failures must win over generic words such as provider
  // or timeout. A failed owner-profile lookup happens before model execution.
  if (m.includes('auth_service_unavailable')) return 'authentication_unavailable';
  if (m.includes('database_pressure') || m.includes('query read timeout')) return 'database_unavailable';
  if (m.includes('not configured') || m.includes('environment variables')) return 'application_configuration';
  if (m.includes('relation') || m.includes('schema')) return 'application_relation_missing';
  if (input.httpStatus === 504 || m.includes('timed out') || m.includes('timeout')) return 'timeout_converted';
  if (m.includes('queue') && (m.includes('full') || m.includes('saturat'))) return 'queue_saturation';
  if (m.includes('gateway') || m.includes('bad gateway') || m.includes('render')) return 'gateway_or_render_edge';
  // A 502/503 alone cannot identify which dependency failed.
  if (m.includes('provider') || m.includes('openai') || m.includes('rate limit')) return 'provider_transient';
  return 'unknown';
}

export interface ChaosState {
  failures_remaining: number;
  simulated_status: number;
}

/** Chaos injection (owner-only test hook): consume one synthetic failure. */
export function applyChaos(chaos: ChaosState | null): { shouldFail: boolean; simulatedStatus: number; updated: ChaosState | null } {
  if (!chaos || chaos.failures_remaining <= 0) return { shouldFail: false, simulatedStatus: 0, updated: chaos };
  return {
    shouldFail: true,
    simulatedStatus: chaos.simulated_status || 503,
    updated: { ...chaos, failures_remaining: chaos.failures_remaining - 1 },
  };
}

// ---------------------------------------------------------------------------
// Supabase REST persistence (service role — bypasses RLS deny-all)
// ---------------------------------------------------------------------------

const TASKS_TABLE = 'ivx_owner_ai_tasks';
const ASSISTANT_SENDER_ID = (process.env.IVX_ASSISTANT_SENDER_ID ?? '9b280e15-f9fd-459f-bf2d-530b1ed84cb1').trim();

function getSupabaseUrl(): string {
  for (const name of ['IVX_SUPABASE_URL', 'SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL']) {
    const value = (process.env[name] ?? '').trim();
    if (value) return value.replace(/\/$/, '');
  }
  return '';
}

function getServiceRoleKey(): string {
  return (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
}

export function isTaskQueueConfigured(): boolean {
  return getSupabaseUrl().length > 0 && getServiceRoleKey().length > 0;
}

function restHeaders(extra?: Record<string, string>): Record<string, string> {
  const key = getServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export const IVX_SUPABASE_QUEUE_RESILIENCE_MARKER = 'ivx-supabase-rest-resilience-2026-09-04-v2';
export const SUPABASE_REST_TIMEOUT_MS = Number.parseInt(process.env.IVX_SUPABASE_REST_TIMEOUT_MS ?? '8000', 10) || 8_000;
export const SUPABASE_REST_RETRY_ATTEMPTS = Math.min(3, Math.max(1, Number.parseInt(process.env.IVX_SUPABASE_REST_RETRY_ATTEMPTS ?? '2', 10) || 2));
export const SUPABASE_FAILURE_THRESHOLD = Math.max(3, Number.parseInt(process.env.IVX_SUPABASE_FAILURE_THRESHOLD ?? '5', 10) || 5);
export const SUPABASE_BACKOFF_MS = Math.max(1_000, Number.parseInt(process.env.IVX_SUPABASE_BACKOFF_MS ?? '5000', 10) || 5_000);
const SUPABASE_RETRY_BASE_MS = 250;
let consecutiveSupabaseFailures = 0;
let supabaseBackoffUntil = 0;

export function isTransientSupabaseStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

/**
 * Only retry operations whose duplicate/ambiguity behavior is provably safe.
 * GET/HEAD are read-only. The task-table POST is protected by the UNIQUE
 * idempotency_key and enqueueOwnerAITask resolves a 409 by reading the winner.
 * Generic PATCH and messages POST are deliberately not retried because a lost
 * response can make the mutation outcome ambiguous.
 */
export function isSafeSupabaseRestRetry(method: string | undefined, path: string): boolean {
  const normalized = (method ?? 'GET').toUpperCase();
  if (normalized === 'GET' || normalized === 'HEAD') return true;
  if (normalized === 'POST' && path.split('?')[0] === TASKS_TABLE) return true;
  return false;
}

export function getSupabaseCircuitState(): {
  marker: string;
  open: boolean;
  consecutiveFailures: number;
  backoffRemainingMs: number;
  failureThreshold: number;
  backoffMs: number;
  timeoutMs: number;
  retryAttempts: number;
} {
  return {
    marker: IVX_SUPABASE_QUEUE_RESILIENCE_MARKER,
    open: Date.now() < supabaseBackoffUntil,
    consecutiveFailures: consecutiveSupabaseFailures,
    backoffRemainingMs: Math.max(0, supabaseBackoffUntil - Date.now()),
    failureThreshold: SUPABASE_FAILURE_THRESHOLD,
    backoffMs: SUPABASE_BACKOFF_MS,
    timeoutMs: SUPABASE_REST_TIMEOUT_MS,
    retryAttempts: SUPABASE_REST_RETRY_ATTEMPTS,
  };
}

function transientSupabaseResponse(reason: string): Response {
  return new Response(JSON.stringify({ error: reason, marker: IVX_SUPABASE_QUEUE_RESILIENCE_MARKER }), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Retry-After': String(Math.max(1, Math.ceil(SUPABASE_BACKOFF_MS / 1000))) },
  });
}

function markSupabaseSuccess(): void {
  consecutiveSupabaseFailures = 0;
  supabaseBackoffUntil = 0;
}

function markSupabaseLogicalFailure(): void {
  consecutiveSupabaseFailures += 1;
  if (consecutiveSupabaseFailures >= SUPABASE_FAILURE_THRESHOLD) {
    supabaseBackoffUntil = Date.now() + SUPABASE_BACKOFF_MS;
  }
}

async function boundedSupabaseRetryDelay(response: Response | null, attempt: number): Promise<void> {
  const retryAfterRaw = response?.headers.get('retry-after') ?? '';
  const retryAfterSeconds = Number.parseFloat(retryAfterRaw);
  const headerDelay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0 ? retryAfterSeconds * 1000 : 0;
  const exponential = SUPABASE_RETRY_BASE_MS * Math.pow(2, Math.max(0, attempt - 1));
  const delayMs = Math.min(2_000, Math.max(exponential, headerDelay));
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function restFetch(path: string, init: RequestInit): Promise<Response> {
  if (Date.now() < supabaseBackoffUntil) {
    return transientSupabaseResponse('supabase_circuit_open');
  }

  const url = `${getSupabaseUrl()}/rest/v1/${path}`;
  const retrySafe = isSafeSupabaseRestRetry(init.method, path);
  const maxAttempts = retrySafe ? SUPABASE_REST_RETRY_ATTEMPTS : 1;
  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(SUPABASE_REST_TIMEOUT_MS),
      });
      lastResponse = response;

      if (!isTransientSupabaseStatus(response.status)) {
        markSupabaseSuccess();
        return response;
      }

      if (attempt < maxAttempts) {
        console.log('[IVXOwnerAITaskQueue] transient Supabase REST response; bounded retry', {
          path: path.split('?')[0],
          method: (init.method ?? 'GET').toUpperCase(),
          status: response.status,
          attempt,
          maxAttempts,
        });
        await boundedSupabaseRetryDelay(response, attempt);
      }
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        console.log('[IVXOwnerAITaskQueue] Supabase REST network failure; bounded retry', {
          path: path.split('?')[0],
          method: (init.method ?? 'GET').toUpperCase(),
          attempt,
          maxAttempts,
          message: error instanceof Error ? error.message : 'network_error',
        });
        await boundedSupabaseRetryDelay(null, attempt);
      }
    }
  }

  // Count one logical operation failure, not every internal retry. This prevents
  // a single slow Supabase request from opening a 30-second system-wide circuit.
  markSupabaseLogicalFailure();
  console.log('[IVXOwnerAITaskQueue] Supabase REST operation unavailable', {
    path: path.split('?')[0],
    method: (init.method ?? 'GET').toUpperCase(),
    attempts: maxAttempts,
    failures: consecutiveSupabaseFailures,
    circuitOpen: Date.now() < supabaseBackoffUntil,
    backoffMs: SUPABASE_BACKOFF_MS,
    message: lastError instanceof Error ? lastError.message : (lastResponse ? `HTTP_${lastResponse.status}` : 'network_error'),
  });

  if (lastResponse) return lastResponse;
  return transientSupabaseResponse('supabase_transient_failure');
}

function nowIso(): string {
  return new Date().toISOString();
}

function appendCheckpoint(history: { checkpoint: string; at: string }[] | null | undefined, checkpoint: string): { checkpoint: string; at: string }[] {
  const list = Array.isArray(history) ? history.slice(-40) : [];
  list.push({ checkpoint, at: nowIso() });
  return list;
}

export async function patchTask(id: string, patch: Record<string, unknown>, extraFilter: string = ''): Promise<IVXOwnerAITaskRow | null> {
  const res = await restFetch(`${TASKS_TABLE}?id=eq.${encodeURIComponent(id)}${extraFilter}`, {
    method: 'PATCH',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({ ...patch, updated_at: nowIso() }),
  });
  if (!res.ok) {
    console.log('[IVXOwnerAITaskQueue] patch failed', { id, status: res.status });
    return null;
  }
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  return rows[0] ?? null;
}

export async function getTask(id: string): Promise<IVXOwnerAITaskRow | null> {
  const res = await restFetch(`${TASKS_TABLE}?id=eq.${encodeURIComponent(id)}&limit=1`, {
    method: 'GET',
    headers: restHeaders(),
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  return rows[0] ?? null;
}

/** List self-deploy tasks that are in a resumable state (LIVE_VERIFYING with a deploy ID). */
export async function listSelfDeployResumableTasks(limit: number = 20): Promise<IVXOwnerAITaskRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  try {
    const res = await restFetch(`${TASKS_TABLE}?status=eq.LIVE_VERIFYING&render_deploy_id=not.is.null&order=created_at.desc&limit=${capped}`, {
      method: 'GET',
      headers: restHeaders(),
    });
    if (!res.ok) return [];
    return await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  } catch {
    return [];
  }
}

const taskListReads = new Map<number, Promise<IVXOwnerAITaskRow[]>>();

export async function listTasks(limit: number = 20): Promise<IVXOwnerAITaskRow[]> {
  const capped = Number.isFinite(limit) ? Math.min(Math.max(Math.trunc(limit), 1), 100) : 20;
  let pending = taskListReads.get(capped);
  if (!pending) {
    pending = (async () => {
      const res = await restFetch(`${TASKS_TABLE}?order=created_at.desc&limit=${capped}`, {
        method: 'GET',
        headers: restHeaders(),
      });
      if (!res.ok) return [];
      return await res.json().catch(() => []) as IVXOwnerAITaskRow[];
    })();
    taskListReads.set(capped, pending);
  }
  try {
    // Share only the in-flight read. Callers must not share mutable task state.
    return structuredClone(await pending);
  } finally {
    if (taskListReads.get(capped) === pending) taskListReads.delete(capped);
  }
}

export interface EnqueueTaskInput {
  prompt: string;
  conversationId?: string | null;
  messageId?: string | null;
  traceId?: string | null;
  idempotencyKey?: string | null;
  maxRetries?: number;
  chaos?: ChaosState | null;
}

export interface EnqueueTaskResult {
  task: IVXOwnerAITaskRow;
  duplicate: boolean;
}

function defaultIdempotencyKey(conversationId: string | null, prompt: string): string {
  let hash = 0;
  const input = `${conversationId ?? 'none'}:${prompt}`;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return `ownerai-${Math.abs(hash).toString(36)}-${input.length.toString(36)}`;
}

/**
 * Persist-first task intake: the owner message is written to the durable table
 * BEFORE any AI work. Same idempotency key never creates a duplicate task.
 */
export async function enqueueOwnerAITask(input: EnqueueTaskInput): Promise<EnqueueTaskResult> {
  const idempotencyKey = (input.idempotencyKey ?? '').trim() || defaultIdempotencyKey(input.conversationId ?? null, input.prompt);

  const existingRes = await restFetch(`${TASKS_TABLE}?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`, {
    method: 'GET',
    headers: restHeaders(),
  });
  if (existingRes.ok) {
    const rows = await existingRes.json().catch(() => []) as IVXOwnerAITaskRow[];
    if (rows[0]) return { task: rows[0], duplicate: true };
  }

  const traceId = (input.traceId ?? '').trim() || `ivx-task-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const row = {
    trace_id: traceId,
    idempotency_key: idempotencyKey,
    conversation_id: input.conversationId ?? null,
    message_id: input.messageId ?? null,
    prompt: input.prompt,
    status: 'QUEUED' satisfies IVXOwnerAITaskStatus,
    checkpoint: 'QUEUED',
    checkpoint_history: [
      { checkpoint: 'RECEIVED', at: nowIso() },
      { checkpoint: 'PERSISTED', at: nowIso() },
      { checkpoint: 'QUEUED', at: nowIso() },
    ],
    retry_count: 0,
    max_retries: Math.min(Math.max(input.maxRetries ?? 5, 0), 10),
    chaos: input.chaos ?? null,
    durations: {},
    dead_letter: false,
    created_at: nowIso(),
    updated_at: nowIso(),
  };

  const res = await restFetch(TASKS_TABLE, {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Unique-violation race: another instance inserted the same idempotency key.
    if (res.status === 409 || /duplicate key/i.test(detail)) {
      const retryRes = await restFetch(`${TASKS_TABLE}?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`, {
        method: 'GET',
        headers: restHeaders(),
      });
      const rows = retryRes.ok ? (await retryRes.json().catch(() => []) as IVXOwnerAITaskRow[]) : [];
      if (rows[0]) return { task: rows[0], duplicate: true };
    }
    throw new Error(`Task persistence failed (HTTP ${res.status}): ${detail.slice(0, 200)}`);
  }
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  if (!rows[0]) throw new Error('Task persistence returned no row.');
  return { task: rows[0], duplicate: false };
}

export async function cancelTask(id: string, reason: string): Promise<IVXOwnerAITaskRow | null> {
  const task = await getTask(id);
  if (!task) return null;
  if (isTerminalTaskStatus(task.status)) return task;
  return patchTask(id, {
    status: 'CANCELED' satisfies IVXOwnerAITaskStatus,
    checkpoint: 'CANCELED',
    checkpoint_history: appendCheckpoint(task.checkpoint_history, `CANCELED: ${reason.slice(0, 120)}`),
    error_code: 'CANCELED_BY_OWNER',
    error_message: reason.slice(0, 300),
  }, `&status=eq.${encodeURIComponent(task.status)}&updated_at=eq.${encodeURIComponent(task.updated_at)}`);
}

export async function retryTask(id: string): Promise<{ ok: boolean; task: IVXOwnerAITaskRow | null; reason?: string }> {
  const task = await getTask(id);
  if (!task) return { ok: false, task: null, reason: 'not_found' };
  if (task.status === 'RUNNING' || task.status === 'QUEUED' || task.status === 'RETRYING') {
    return { ok: false, task, reason: 'already_in_flight' };
  }
  if (task.status === 'COMPLETED' || task.status === 'VERIFIED') {
    return { ok: true, task, reason: 'already_completed' };
  }
  const updated = await patchTask(id, {
    status: 'QUEUED' satisfies IVXOwnerAITaskStatus,
    checkpoint: 'MANUAL_RETRY_QUEUED',
    checkpoint_history: appendCheckpoint(task.checkpoint_history, 'MANUAL_RETRY_QUEUED'),
    next_retry_at: null,
    claimed_by: null,
    queue_lease_token: null,
    queue_lease_until: null,
    dead_letter: false,
    error_code: null,
    error_message: null,
  }, `&status=eq.${encodeURIComponent(task.status)}&updated_at=eq.${encodeURIComponent(task.updated_at)}`);
  return { ok: updated !== null, task: updated };
}

/** Recover only expired general-owner leases; senior jobs retain their own authority. */
export async function recoverOrphanTasks(_staleMinutes: number = 3): Promise<number> {
  if (!isTaskQueueConfigured()) return 0;
  return queueRpc<number>('ivx_owner_ai_queue_recover', {});
}

/** Replay every dead-letter task (recoverable-failure replay, owner action). */
export async function replayDeadLetterTasks(): Promise<number> {
  const res = await restFetch(`${TASKS_TABLE}?dead_letter=is.true&status=eq.FAILED`, {
    method: 'PATCH',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      status: 'QUEUED' satisfies IVXOwnerAITaskStatus,
      checkpoint: 'DEAD_LETTER_REPLAYED',
      dead_letter: false,
      retry_count: 0,
      next_retry_at: null,
      claimed_by: null,
      error_code: null,
      error_message: null,
      updated_at: nowIso(),
    }),
  });
  if (!res.ok) return 0;
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  return rows.length;
}

// ---------------------------------------------------------------------------
// Background worker (executes tasks off the HTTP request path)
// ---------------------------------------------------------------------------

const WORKER_ID = `ivx-ownerai-worker-${Math.random().toString(36).slice(2, 10)}`;
const MAX_CONCURRENT_CLAIMS = Number.parseInt(process.env.IVX_QUEUE_MAX_CONCURRENT ?? '2', 10) || 2;
const HEARTBEAT_INTERVAL_MS = Number.parseInt(process.env.IVX_QUEUE_HEARTBEAT_MS ?? '15000', 10) || 15_000;
const SHUTDOWN_GRACE_MS = Number.parseInt(process.env.IVX_QUEUE_SHUTDOWN_GRACE_MS ?? '10000', 10) || 10_000;

let workerTimer: (() => void) | null = null;
let workerLastTickAt: string | null = null;
let workerTickRunning = false;
let workerShuttingDown = false;
let activeTaskCount = 0;
let activeHeartbeatTimers = new Map<string, ReturnType<typeof setInterval>>();

type ActiveOwnerLease = { task: IVXOwnerAITaskRow; lost: boolean; abort?: AbortController };
const activeOwnerLeases = new Map<string, ActiveOwnerLease>();
const queueSourceSha = () => (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT_SHA || process.env.SOURCE_VERSION || '').trim();
const queueInstanceId = () => process.env.RENDER_INSTANCE_ID || process.env.HOSTNAME || WORKER_ID;
class OwnerQueueLeaseLost extends Error {}

const ownerQueueProviderReady = createOwnerQueueProviderGate({
  configured: isIVXAIConfigured, health: getProviderHealth,
  validate: () => requestIVXAIText({ module: 'owner-room', requestId: `${WORKER_ID}-startup-${Date.now()}`,
    prompt: 'Reply with OK.', maxOutputTokens: 16, abortSignal: AbortSignal.timeout(10_000) }),
});

function loseOwnerLease(lease: ActiveOwnerLease) {
  lease.lost = true;
  lease.abort?.abort();
}

async function queueRpc<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const response = await restFetch(`rpc/${name}`, { method: 'POST', headers: restHeaders(), body: JSON.stringify(payload) });
  if (!response.ok) throw Object.assign(new Error(`Owner queue ${name} temporarily unavailable (HTTP ${response.status})`), { httpStatus: response.status });
  return await response.json() as T;
}

async function publishWorkerPulse(state: 'ready' | 'degraded' | 'draining') {
  return queueRpc<{ authorized: boolean; state: string }>('ivx_owner_ai_worker_pulse', {
    p_worker_id: WORKER_ID, p_source_sha: queueSourceSha(), p_instance_id: queueInstanceId(), p_state: state,
  });
}

async function updateOwnerLease(lease: ActiveOwnerLease, operation: string, payload: Record<string, unknown> = {}) {
  if (lease.lost && operation !== 'release') throw new OwnerQueueLeaseLost('Task lease authority was lost');
  const applied = await queueRpc<boolean>('ivx_owner_ai_queue_update', {
    p_task_id: lease.task.id, p_worker_id: WORKER_ID, p_lease_token: lease.task.queue_lease_token,
    p_operation: operation, p_payload: payload,
  });
  if (!applied) { loseOwnerLease(lease); throw new OwnerQueueLeaseLost('Task lease or owner authorization changed'); }
}

async function executeTask(task: IVXOwnerAITaskRow): Promise<void> {
  if (!task.queue_lease_token) throw new Error('Queue returned an unfenced task');
  activeTaskCount++;
  const lease: ActiveOwnerLease = { task, lost: false, abort: new AbortController() };
  activeOwnerLeases.set(task.id, lease);
  let heartbeatInFlight = false;
  const heartbeatTimer = setInterval(() => {
    if (heartbeatInFlight || lease.lost) return;
    heartbeatInFlight = true;
    void updateOwnerLease(lease, 'heartbeat').catch(() => { loseOwnerLease(lease); }).finally(() => { heartbeatInFlight = false; });
  }, HEARTBEAT_INTERVAL_MS);
  activeHeartbeatTimers.set(task.id, heartbeatTimer);
  const startedMs = Date.now(), queueMs = Math.max(0, startedMs - Date.parse(task.created_at));
  try {
    // A recovered answer checkpoint is reused. Publication is one transaction;
    // a lost HTTP response cannot create a second assistant message.
    if (!task.answer?.trim()) {
      const chaos = applyChaos(task.chaos);
      if (chaos.shouldFail) {
        await updateOwnerLease(lease, 'checkpoint', { chaos: chaos.updated });
        throw Object.assign(new Error(`SYNTHETIC_PROVIDER_${chaos.simulatedStatus} — service unavailable`), { httpStatus: chaos.simulatedStatus });
      }
      await updateOwnerLease(lease, 'checkpoint', { checkpoint: 'PROVIDER_CALLED' });
      const providerStart = Date.now();
      const result = await requestIVXAIText({ module: 'owner-room', requestId: `${task.trace_id}-attempt${task.retry_count + 1}`, prompt: task.prompt, maxOutputTokens: 2_000, abortSignal: lease.abort!.signal });
      const answer = result.text.trim();
      if (!answer) throw new Error('Provider returned an empty answer — temporarily unavailable');
      await updateOwnerLease(lease, 'checkpoint', { checkpoint: 'ANSWER_RECEIVED', answer,
        model: result.providerMetadata.model ?? null, provider: result.providerMetadata.provider ?? null,
        durations: { queueMs, providerMs: Date.now() - providerStart, totalMs: Date.now() - startedMs } });
    }
    if (lease.lost) throw new OwnerQueueLeaseLost('Lease lost before publication');
    const receipt = await queueRpc<{ applied: boolean }>('ivx_owner_ai_queue_complete', {
      p_task_id: task.id, p_worker_id: WORKER_ID, p_lease_token: task.queue_lease_token, p_sender_id: ASSISTANT_SENDER_ID,
    });
    if (!receipt.applied) throw new OwnerQueueLeaseLost('Completion refused after lease or owner authorization changed');
  } catch (error) {
    if (error instanceof OwnerQueueLeaseLost || lease.lost) return;
    const message = error instanceof Error ? error.message : 'Owner queue execution failed';
    const httpStatus = (error as { httpStatus?: number }).httpStatus ?? null;
    const classification = classifyFailureForRetry({ httpStatus, message });
    const attempt = task.retry_count + 1;
    const outcome = nextStatusAfterFailure(attempt, task.max_retries, classification.transient);
    // Conditional failure cannot overwrite a committed answer after an ambiguous
    // completion response, cancellation, takeover or shutdown.
    await updateOwnerLease(lease, 'failure', { status: outcome.status, checkpoint: `ATTEMPT_${attempt}_FAILED: ${classification.code}`,
      next_retry_at: outcome.status === 'RETRYING' ? new Date(Date.now() + computeRetryDelayMs(attempt)).toISOString() : null,
      dead_letter: outcome.deadLetter, error_code: classification.code, error_message: message.slice(0, 500),
      http_status: httpStatus, failure_source: classify503Source({ httpStatus: httpStatus ?? 500, message })
    }).catch(() => { loseOwnerLease(lease); });
  } finally {
    clearInterval(heartbeatTimer); activeHeartbeatTimers.delete(task.id); activeOwnerLeases.delete(task.id); activeTaskCount--;
  }
}

async function workerTick(): Promise<boolean> {
  if (workerTickRunning || !isTaskQueueConfigured() || workerShuttingDown) return false;
  workerTickRunning = true;
  workerLastTickAt = nowIso();
  try {
    // The initial observation reads the durable owner gates before any startup
    // generation. Authorization is checked again when publishing readiness and
    // atomically on every claim/checkpoint/completion.
    const provider = getProviderHealth();
    const wasReady = isIVXAIConfigured() && ['PROVIDER_READY', 'FALLBACK_READY'].includes(provider.state)
      && provider.lastHttpStatus === 200 && Number.isFinite(Date.parse(provider.lastValidationTime ?? ''));
    const observation = await publishWorkerPulse(wasReady ? 'ready' : 'degraded');
    if (workerShuttingDown || !await ownerQueueProviderReady(observation.authorized)) return false;
    if (!wasReady && !(await publishWorkerPulse('ready')).authorized) return false;
    if (workerShuttingDown) return false;
    const claimed = await queueRpc<{ authorized: boolean; tasks: IVXOwnerAITaskRow[] }>('ivx_owner_ai_queue_claim', {
      p_worker_id: WORKER_ID, p_limit: Math.min(2, MAX_CONCURRENT_CLAIMS),
    });
    if (!claimed.authorized || !Array.isArray(claimed.tasks) || claimed.tasks.length > 2) return false;
    await Promise.all(claimed.tasks.map(async task => {
      if (workerShuttingDown) {
        await updateOwnerLease({ task, lost: false }, 'release').catch(() => {});
        return false;
      }
      await executeTask(task);
    }));
    return claimed.tasks.length > 0;
  } catch (error) {
    console.warn('[IVXOwnerAITaskQueue] bounded worker tick failed', { error: error instanceof Error ? error.message : 'unknown' });
    return false;
  } finally { workerTickRunning = false; }
}

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';
const FALLBACK_PROJECT_REF = 'kvclcdjmjghndxsngfzb';

function managementProjectRef(): string {
  for (const raw of [process.env.IVX_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]) {
    const match = (raw ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (match) return match[1];
  }
  return FALLBACK_PROJECT_REF;
}

const TASK_TABLE_DDL = `
CREATE TABLE IF NOT EXISTS ivx_owner_ai_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  conversation_id text,
  message_id text,
  prompt text NOT NULL,
  status text NOT NULL DEFAULT 'RECEIVED',
  checkpoint text NOT NULL DEFAULT 'RECEIVED',
  checkpoint_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  retry_count int NOT NULL DEFAULT 0,
  max_retries int NOT NULL DEFAULT 5,
  next_retry_at timestamptz,
  claimed_by text,
  heartbeat_at timestamptz,
  model text,
  provider text,
  answer text,
  assistant_message_id text,
  error_code text,
  error_message text,
  http_status int,
  failure_source text,
  durations jsonb NOT NULL DEFAULT '{}'::jsonb,
  chaos jsonb,
  dead_letter boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_status ON ivx_owner_ai_tasks(status, created_at);
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_claimable ON ivx_owner_ai_tasks(next_retry_at, created_at) WHERE status IN ('QUEUED','RETRYING');
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_running_heartbeat ON ivx_owner_ai_tasks(heartbeat_at) WHERE status = 'RUNNING';
ALTER TABLE ivx_owner_ai_tasks ENABLE ROW LEVEL SECURITY;
`;

let tableEnsured = false;

/** Test-only hook: resets the bootstrap memo so each test starts with a clean module state. */
export function __resetBootstrapStateForTests(): void {
  tableEnsured = false;
}

const DDL_RETRY_ATTEMPTS = 3;
const DDL_RETRY_BASE_MS = 1_000;

export function isTransientBootstrapStatus(status: number): boolean {
  // 544 is a non-standard Supabase Management API / edge gateway status that
  // has been observed during cold-boot DDL. Retry it like any other 5xx or 429.
  return status >= 500 || status === 429 || status === 408 || status === 544;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Self-bootstrapping DDL: creates the durable task table through the Supabase
 * Management API (the only SQL path in the Render runtime — same pattern as
 * the migration runner). Idempotent; non-fatal when the token is absent.
 * Retries transient gateway errors (including 544) with bounded backoff.
 */
export async function ensureTaskTable(): Promise<boolean> {
  if (tableEnsured) return true;
  const probe = await checkDatabaseHealth();
  if (probe.ok) {
    tableEnsured = true;
    return true;
  }
  // A transient outage or credential failure is not evidence of a missing table.
  if (probe.detail.tableMissing !== true) return false;
  // Prefer the encrypted Owner Variables store over stale process.env.
  const { getIVXOwnerVariableRuntimeValue } = await import('../api/ivx-owner-variables');
  const token = (await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN', { preferStored: true })).trim();
  if (!token) {
    console.log('[IVXOwnerAITaskQueue] table missing and SUPABASE_ACCESS_TOKEN absent — cannot self-bootstrap DDL');
    return false;
  }
  for (let attempt = 1; attempt <= DDL_RETRY_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${MANAGEMENT_API_BASE}/projects/${managementProjectRef()}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: TASK_TABLE_DDL }),
        signal: AbortSignal.timeout(30_000),
      });
      console.log('[IVXOwnerAITaskQueue] self-bootstrap DDL result', { attempt, httpStatus: res.status });
      if (res.ok || res.status === 201) {
        tableEnsured = true;
        return true;
      }
      if (!isTransientBootstrapStatus(res.status) || attempt === DDL_RETRY_ATTEMPTS) {
        return false;
      }
      await sleep(DDL_RETRY_BASE_MS * attempt);
    } catch (error) {
      console.log('[IVXOwnerAITaskQueue] self-bootstrap DDL failed:', error instanceof Error ? error.message : 'unknown', { attempt });
      if (attempt === DDL_RETRY_ATTEMPTS) return false;
      await sleep(DDL_RETRY_BASE_MS * attempt);
    }
  }
  return false;
}

/** Start bounded worker observations and atomic claim/recovery on the execution plane. */
export function startOwnerAITaskWorker(intervalMs: number = 20_000): void {
  if (workerTimer || process.env.IVX_PROCESS_ROLE === 'api') return;
  workerShuttingDown = false;
  console.log('[IVXOwnerAITaskQueue] starting durable worker', { workerId: WORKER_ID, intervalMs, maxConcurrent: MAX_CONCURRENT_CLAIMS, heartbeatMs: HEARTBEAT_INTERVAL_MS });
  // Schema is deployed by the approved migration, never bootstrapped by a timer.
  workerTimer = startAdaptivePoll(workerTick, intervalMs, Math.max(intervalMs, 60_000), true);
}

/** Graceful shutdown: stop polling, wait for active tasks, clear heartbeat timers.
 * Called on SIGTERM/SIGINT to ensure Render doesn't kill tasks mid-execution. */
export async function stopOwnerAITaskWorker(graceMs: number = SHUTDOWN_GRACE_MS): Promise<void> {
  workerShuttingDown = true;
  void publishWorkerPulse('draining').catch(() => {});
  if (workerTimer) {
    workerTimer();
    workerTimer = null;
  }
  console.log('[IVXOwnerAITaskQueue] graceful shutdown initiated', { workerId: WORKER_ID, activeTasks: activeTaskCount, graceMs });
  const deadline = Date.now() + graceMs;
  while (activeTaskCount > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  for (const timer of activeHeartbeatTimers.values()) {
    clearInterval(timer);
  }
  activeHeartbeatTimers.clear();
  const outstanding = [...activeOwnerLeases.values()];
  for (const lease of outstanding) loseOwnerLease(lease);
  await Promise.all(outstanding.map(lease => updateOwnerLease(lease, 'release').catch(() => {})));
  if (activeTaskCount > 0) {
    console.warn('[IVXOwnerAITaskQueue] graceful shutdown exceeded grace period', { workerId: WORKER_ID, activeTasks: activeTaskCount });
  } else {
    console.log('[IVXOwnerAITaskQueue] graceful shutdown complete', { workerId: WORKER_ID });
  }
}

export function getWorkerRuntimeInfo(): { workerId: string; running: boolean; lastTickAt: string | null; activeTasks: number; shuttingDown: boolean } {
  return { workerId: WORKER_ID, running: workerTimer !== null, lastTickAt: workerLastTickAt, activeTasks: activeTaskCount, shuttingDown: workerShuttingDown };
}

// ---------------------------------------------------------------------------
// 5xx incident instrumentation (Phase 1)
// ---------------------------------------------------------------------------

export interface OwnerAIIncident {
  traceId: string;
  endpoint: string;
  method: string;
  httpStatus: number;
  durationMs: number;
  source: IVX503Source;
  message: string;
  at: string;
}

const incidentRing: OwnerAIIncident[] = [];
const INCIDENT_RING_MAX = 100;

export function recordOwnerAIIncident(incident: Omit<OwnerAIIncident, 'at'>): void {
  incidentRing.push({ ...incident, at: nowIso() });
  if (incidentRing.length > INCIDENT_RING_MAX) incidentRing.splice(0, incidentRing.length - INCIDENT_RING_MAX);
  console.log('[IVXOwnerAI-503-Instrumentation]', JSON.stringify(incident));
}

export function listOwnerAIIncidents(limit: number = 50): OwnerAIIncident[] {
  return incidentRing.slice(-Math.min(Math.max(limit, 1), INCIDENT_RING_MAX)).reverse();
}

export function computeIncidentAlerts(windowMinutes: number = 15): { total5xx: number; count503: number; countTimeout: number; windowMinutes: number } {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const recent = incidentRing.filter((i) => new Date(i.at).getTime() >= cutoff);
  return {
    total5xx: recent.length,
    count503: recent.filter((i) => i.httpStatus === 503).length,
    countTimeout: recent.filter((i) => i.source === 'timeout_converted').length,
    windowMinutes,
  };
}

// ---------------------------------------------------------------------------
// Health checks (Phase 5) — the service must NOT report healthy when the
// owner AI execution route is unavailable.
// ---------------------------------------------------------------------------

export interface HealthCheckResult {
  ok: boolean;
  detail: Record<string, unknown>;
}

export async function checkDatabaseHealth(): Promise<HealthCheckResult> {
  if (!isTaskQueueConfigured()) return { ok: false, detail: { reason: 'Database credentials unavailable', circuit: getSupabaseCircuitState() } };
  // A bounded table read proves REST and database access without generating the
  // entire OpenAPI schema on every health request.
  const probe = await boundedHealthProbe(`${getSupabaseUrl()}/rest/v1/${TASKS_TABLE}?select=id&limit=1`, restHeaders(),
    (body): body is Array<{ id: string }> => Array.isArray(body) && body.length <= 1 && body.every(row => typeof row?.id === 'string'));
  return { ok: probe.ok, detail: { table: TASKS_TABLE, httpStatus: probe.status, latencyMs: probe.latencyMs,
    tableMissing: probe.missingRelation === true, reason: probe.error ?? null,
    tableProbe: { status: probe.status, latencyMs: probe.latencyMs }, circuit: getSupabaseCircuitState() } };
}

export async function checkAuthHealth(): Promise<HealthCheckResult> {
  if (!isTaskQueueConfigured()) return { ok: false, detail: { reason: 'Auth credentials unavailable' } };
  const probe = await boundedHealthProbe(`${getSupabaseUrl()}/auth/v1/health`, restHeaders(),
    (body): body is { name: string } => Boolean(body && typeof body === 'object' && 'name' in body && typeof body.name === 'string' && body.name.length));
  return { ok: probe.ok, detail: { httpStatus: probe.status, latencyMs: probe.latencyMs, reason: probe.error ?? null } };
}

export function checkAIHealth(): HealthCheckResult {
  const startup = validateIVXAIStartup();
  const provider = getProviderHealth();
  const providerOk = (provider.state === 'PROVIDER_READY' || provider.state === 'FALLBACK_READY')
    && provider.lastHttpStatus === 200 && Boolean(provider.lastValidationTime);
  const budgetBlocked = /^Global AI budget admission blocked or unconfirmed;/.test(provider.error ?? '');
  const needsCredits = !budgetBlocked && (provider.lastHttpStatus === 402
    || /positive credit balance|insufficient_quota|billing_hard_limit/i.test(provider.error ?? ''));
  const validationPending = provider.state === 'PROVIDER_VALIDATING' || provider.state === 'FALLBACK_VALIDATING';
  const code = !startup.ok ? 'AI_CONFIGURATION_UNAVAILABLE' : providerOk ? null
    : budgetBlocked ? 'AI_GLOBAL_BUDGET_BLOCKED' : needsCredits ? 'AI_CREDITS_REQUIRED' : validationPending ? 'AI_VALIDATION_PENDING' : 'AI_UNAVAILABLE';
  return {
    ok: startup.ok && providerOk,
    detail: {
      startupOk: startup.ok,
      startupErrors: startup.errors,
      providerState: provider.state,
      code,
      lastHttpStatus: provider.lastHttpStatus,
      lastValidationTime: provider.lastValidationTime,
      provider: startup.provider,
      model: startup.model,
      keyPrefix: startup.keyPrefix,
      keyLoaded: startup.keyLoaded,
      baseUrl: startup.baseUrl,
      providerType: startup.providerType,
      ownerActionRequired: code === 'AI_CREDITS_REQUIRED'
        ? 'The AI provider requires a positive credit balance. Restore the provider balance and validate availability again.'
        : code === 'AI_GLOBAL_BUDGET_BLOCKED' ? 'Check the global AI budget and database availability, then validate again.'
        : code === 'AI_VALIDATION_PENDING' ? 'AI provider validation has not completed successfully.'
        : code ? 'AI provider is unavailable. Check configuration and /health/ai for the current failure.' : null,
    },
  };
}

/**
 * Live AI gateway probe — actually sends a minimal request to the configured
 * AI gateway endpoint to verify the key works RIGHT NOW (not just that it exists).
 * Returns ok=true if the gateway responded with a valid completion,
 * ok=false with a specific reason if it failed.
 *
 * This is the difference between "configured" and "working" — the regular
 * checkAIHealth reads the last observation; this performs a fresh completion.
 */
export async function probeAIGatewayLive(): Promise<{
  ok: boolean;
  status: number | null;
  reason: string;
  keyPrefix: string;
  endpoint: string | null;
  latencyMs: number;
  ownerActionRequired: string | null;
}> {
  const { getIVXAIGatewayApiKey, preloadIVXAIGatewayKeyFromOwnerVariables } = await import('../ivx-ai-runtime');
  await preloadIVXAIGatewayKeyFromOwnerVariables();
  const startup = validateIVXAIStartup();
  const apiKey = getIVXAIGatewayApiKey();
  const keyPrefix = apiKey ? `${apiKey.slice(0, 4)}***` : 'none';
  const endpoint = startup.baseUrl;
  const started = Date.now();

  if (!apiKey) {
    return {
      ok: false, status: null, keyPrefix, endpoint, latencyMs: 0,
      reason: 'No AI gateway key configured',
      ownerActionRequired: 'Set IVX_AI_GATEWAY_KEY (or OPENAI_API_KEY) on the Render service to enable AI chat.',
    };
  }
  if (!endpoint) {
    return {
      ok: false, status: null, keyPrefix, endpoint: null, latencyMs: 0,
      reason: 'No AI gateway endpoint resolved',
      ownerActionRequired: 'Check IVX_AI_GATEWAY_URL or ensure the key prefix (vck_ or sk_) resolves to a valid endpoint.',
    };
  }

  // Manual live probe verifies an actual minimal generation. Authentication-only
  // GET /models can succeed while billing, model access, or completion routing fails.
  const result = await probeGatewayCompletion({
    url: `${endpoint}/chat/completions`, apiKey, model: startup.model, provider: startup.provider,
  });
  return {
    ok: result.ok, status: result.status, keyPrefix, endpoint, latencyMs: result.latencyMs,
    reason: result.reason,
    ownerActionRequired: result.ok ? null : result.code === 'AI_CREDITS_REQUIRED'
      ? 'The provider requires a positive credit balance. Restore the balance and validate again.'
      : result.code === 'AI_GLOBAL_BUDGET_BLOCKED' ? 'Check the global AI budget and database availability, then validate again.'
      : result.status === 401 || result.status === 403
        ? 'The provider rejected its configured credential. Verify the existing provider binding.'
        : result.code === 'AI_PROBE_TIMEOUT' ? 'The provider did not finish a completion within 10 seconds.'
          : 'The provider did not return a valid completion. Check its availability and response contract.',
  };
}

export async function checkQueueHealth(): Promise<HealthCheckResult> {
  const runtime = getWorkerRuntimeInfo();
  const circuit = getSupabaseCircuitState();
  if (!isTaskQueueConfigured()) return { ok: false, detail: { reason: 'queue persistence not configured', circuit, ...runtime } };
  type Snapshot = { authorized: boolean; pending: Array<{ id: string; status: string; created_at: string }>; dead: Array<{ id: string }>; workers: unknown[] };
  const observation = await boundedHealthProbe(`${getSupabaseUrl()}/rest/v1/rpc/ivx_owner_ai_queue_health?p_source_sha=${encodeURIComponent(queueSourceSha())}`, restHeaders(),
    (body): body is Snapshot => {
      if (!body || typeof body !== 'object') return false;
      const value = body as Snapshot;
      return typeof value.authorized === 'boolean' && Array.isArray(value.pending) && value.pending.length <= 200
        && value.pending.every(row => typeof row?.id === 'string' && ['QUEUED', 'RETRYING', 'RUNNING'].includes(row.status) && Number.isFinite(Date.parse(row.created_at)))
        && Array.isArray(value.dead) && value.dead.length <= 100 && value.dead.every(row => typeof row?.id === 'string')
        && Array.isArray(value.workers) && value.workers.length <= 10;
    });
  if (!observation.ok) return { ok: false, detail: { ...runtime, circuit,
    reason: observation.error ?? 'Queue observation unavailable', telemetryAvailable: false,
    depth: null, deadLetterCount: null, saturated: null, staleQueue: null } };
  const snapshot = observation.value!, rows = snapshot.pending;
  const oldestAgeMinutes = rows.length ? Math.max(0, Math.round((Date.now() - Date.parse(rows[0].created_at)) / 60_000)) : 0;
  const saturated = rows.length >= 150;
  const stale = oldestAgeMinutes > 15;
  const shared = ownerQueueWorkerReadiness(snapshot.workers, queueSourceSha());
  return { ok: snapshot.authorized && shared.ready && !saturated && !stale && !circuit.open,
    detail: { ...runtime, circuit, consumerScope: 'general_owner_ai', running: shared.ready, localWorkerRunning: runtime.running,
      ownerAuthorized: snapshot.authorized,
      workers: shared.workers, workerObservationReason: shared.reason, telemetryAvailable: true, depth: rows.length, depthCapped: rows.length === 200,
      oldestQueuedAgeMinutes: oldestAgeMinutes, deadLetterCount: snapshot.dead.length, deadLetterCountCapped: snapshot.dead.length === 100,
      saturated, staleQueue: stale, alerts: computeIncidentAlerts() } };
}

export function checkProviderHealthDetail(): HealthCheckResult {
  const provider = getProviderHealth();
  return {
    ok: provider.state !== 'AI_UNAVAILABLE',
    detail: provider as unknown as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// Phase 6 — database env configuration audit (no credential requests by default)
// ---------------------------------------------------------------------------

const DB_ALIAS_VARS = [
  'SUPABASE_INSPECTION_DATABASE_URL',
  'SUPABASE_READONLY_DATABASE_URL',
  'SUPABASE_DATABASE_URL',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'SUPABASE_DB_PASSWORD',
] as const;

export function auditDatabaseEnvConfig(): {
  canonicalMode: string;
  canonicalPresent: boolean;
  canonicalVars: Record<string, boolean>;
  directPostgresAliases: Record<string, boolean>;
  directPostgresAvailable: boolean;
  conclusion: string;
} {
  const canonicalVars = {
    SUPABASE_URL: Boolean((process.env.SUPABASE_URL ?? '').trim()),
    IVX_SUPABASE_URL: Boolean((process.env.IVX_SUPABASE_URL ?? '').trim()),
    SUPABASE_SERVICE_ROLE_KEY: Boolean((process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim()),
  };
  const canonicalPresent = (canonicalVars.SUPABASE_URL || canonicalVars.IVX_SUPABASE_URL) && canonicalVars.SUPABASE_SERVICE_ROLE_KEY;
  const directPostgresAliases: Record<string, boolean> = {};
  for (const name of DB_ALIAS_VARS) directPostgresAliases[name] = Boolean((process.env[name] ?? '').trim());
  const directPostgresAvailable = Object.values(directPostgresAliases).some(Boolean);
  return {
    canonicalMode: 'supabase_rest_service_role',
    canonicalPresent,
    canonicalVars,
    directPostgresAliases,
    directPostgresAvailable,
    conclusion: canonicalPresent
      ? (directPostgresAvailable
        ? 'Canonical Supabase REST config present; direct Postgres alias also present.'
        : 'Canonical Supabase REST config present. Direct Postgres URLs are genuinely absent in this runtime; SQL-level inspection runs through the Supabase management API instead. No credential request required.')
      : 'CRITICAL: canonical Supabase configuration (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY) is missing from the runtime.',
  };
}
