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

import { requestIVXAIText, validateIVXAIStartup, getProviderHealth } from '../ivx-ai-runtime';

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
  resume_required: boolean | null;
  resume_phase: string | null;
  last_safe_checkpoint: string | null;
  pre_deploy_runtime_sha: string | null;
  expected_runtime_sha: string | null;
  deployment_requested_at: string | null;
  deployment_attempt: number | null;
  deployment_service_id: string | null;
  deployment_trigger_request_id: string | null;
  recovery_lease_owner: string | null;
  recovery_lease_expires_at: string | null;
  recovery_attempt: number | null;
  recovery_idempotency_key: string | null;
  task_version: number | null;
  base_sha: string | null;
  branch: string | null;
  owner_approval_id: string | null;
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
  if (m.includes('not configured') || m.includes('environment variables')) return 'application_configuration';
  if (m.includes('relation') || m.includes('schema')) return 'application_relation_missing';
  if (input.httpStatus === 504 || m.includes('timed out') || m.includes('timeout')) return 'timeout_converted';
  if (m.includes('queue') && (m.includes('full') || m.includes('saturat'))) return 'queue_saturation';
  if (m.includes('gateway') || m.includes('bad gateway') || m.includes('render')) return 'gateway_or_render_edge';
  if (input.httpStatus === 502 || input.httpStatus === 503 || m.includes('provider') || m.includes('openai') || m.includes('rate limit')) return 'provider_transient';
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

async function restFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${getSupabaseUrl()}/rest/v1/${path}`;
  return fetch(url, init);
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

export async function listTasks(limit: number = 20): Promise<IVXOwnerAITaskRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const res = await restFetch(`${TASKS_TABLE}?order=created_at.desc&limit=${capped}`, {
    method: 'GET',
    headers: restHeaders(),
  });
  if (!res.ok) return [];
  return await res.json().catch(() => []) as IVXOwnerAITaskRow[];
}

/**
 * List self-deploy resumable senior-dev tasks for the boot recovery scanner.
 * Returns tasks where resume_required=true, status is a resumable post-handoff
 * state, commit_sha is present (real work was committed), and there is no
 * active recovery lease held by another worker. Ordered oldest-first so the
 * recovery scanner honors FIFO and avoids starvation of later queued tasks.
 */
export async function listSelfDeployResumableTasks(limit: number = 20): Promise<IVXOwnerAITaskRow[]> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const now = encodeURIComponent(nowIso());
  const statusFilter = 'status=in.(DEPLOYMENT_REQUESTED,DEPLOYING,LIVE_VERIFYING,RETRYING)';
  const resumeFilter = 'resume_required=eq.true';
  const commitFilter = 'commit_sha=not.is.null';
  // Either no lease owner, or the lease has already expired (stale lease).
  const leaseFilter = `or=(recovery_lease_owner.is.null,recovery_lease_expires_at.lt.${now})`;
  const order = 'order=created_at.asc';
  const res = await restFetch(
    `${TASKS_TABLE}?${statusFilter}&${resumeFilter}&${commitFilter}&${leaseFilter}&${order}&limit=${capped}`,
    { method: 'GET', headers: restHeaders() },
  );
  if (!res.ok) return [];
  return await res.json().catch(() => []) as IVXOwnerAITaskRow[];
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
  });
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
    dead_letter: false,
    error_code: null,
    error_message: null,
  });
  return { ok: updated !== null, task: updated };
}

/** Requeue tasks stuck RUNNING with a stale heartbeat (Render restart recovery). */
export async function recoverOrphanTasks(staleMinutes: number = 3): Promise<number> {
  if (!isTaskQueueConfigured()) return 0;
  const cutoff = new Date(Date.now() - staleMinutes * 60_000).toISOString();
  const res = await restFetch(
    `${TASKS_TABLE}?status=eq.RUNNING&heartbeat_at=lt.${encodeURIComponent(cutoff)}`,
    {
      method: 'PATCH',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        status: 'RETRYING' satisfies IVXOwnerAITaskStatus,
        checkpoint: 'RECOVERED_AFTER_RESTART',
        claimed_by: null,
        next_retry_at: nowIso(),
        updated_at: nowIso(),
      }),
    },
  );
  if (!res.ok) return 0;
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  if (rows.length > 0) {
    console.log('[IVXOwnerAITaskQueue] recovered orphan tasks after restart', { count: rows.length, ids: rows.map((r) => r.id) });
  }
  return rows.length;
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
const MAX_CONCURRENT_CLAIMS = 2;

let workerTimer: ReturnType<typeof setInterval> | null = null;
let workerLastTickAt: string | null = null;
let workerTickRunning = false;

async function claimTask(candidate: IVXOwnerAITaskRow): Promise<IVXOwnerAITaskRow | null> {
  // Optimistic claim: only wins if the row is still claimable.
  const res = await restFetch(
    `${TASKS_TABLE}?id=eq.${encodeURIComponent(candidate.id)}&status=in.(QUEUED,RETRYING)`,
    {
      method: 'PATCH',
      headers: restHeaders({ Prefer: 'return=representation' }),
      body: JSON.stringify({
        status: 'RUNNING' satisfies IVXOwnerAITaskStatus,
        checkpoint: 'RUNNING',
        checkpoint_history: appendCheckpoint(candidate.checkpoint_history, `RUNNING attempt ${candidate.retry_count + 1} on ${WORKER_ID}`),
        claimed_by: WORKER_ID,
        heartbeat_at: nowIso(),
        updated_at: nowIso(),
      }),
    },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
  return rows[0] ?? null;
}

async function persistAssistantReply(task: IVXOwnerAITaskRow, answer: string): Promise<string | null> {
  if (!task.conversation_id) return null;
  const res = await restFetch('messages?select=id', {
    method: 'POST',
    headers: restHeaders({ Prefer: 'return=representation' }),
    body: JSON.stringify({
      conversation_id: task.conversation_id,
      sender_id: ASSISTANT_SENDER_ID,
      text: answer,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`Assistant reply persistence failed (HTTP ${res.status}): ${detail.slice(0, 160)} — temporarily unavailable`);
  }
  const rows = await res.json().catch(() => []) as { id?: string }[];
  return rows[0]?.id ?? null;
}

async function executeTask(task: IVXOwnerAITaskRow): Promise<void> {
  const startedMs = Date.now();
  const queueMs = Math.max(0, startedMs - new Date(task.created_at).getTime());
  try {
    // Chaos injection (owner test hook): synthetic transient failure.
    const chaos = applyChaos(task.chaos);
    if (chaos.shouldFail) {
      await patchTask(task.id, { chaos: chaos.updated });
      const err = new Error(`SYNTHETIC_PROVIDER_${chaos.simulatedStatus} (owner chaos injection) — service unavailable`) as Error & { httpStatus: number };
      err.httpStatus = chaos.simulatedStatus;
      throw err;
    }

    await patchTask(task.id, {
      checkpoint: 'PROVIDER_CALLED',
      checkpoint_history: appendCheckpoint(task.checkpoint_history, 'PROVIDER_CALLED'),
      heartbeat_at: nowIso(),
    });

    const providerStart = Date.now();
    const result = await requestIVXAIText({
      module: 'owner-room',
      requestId: `${task.trace_id}-attempt${task.retry_count + 1}`,
      prompt: task.prompt,
      maxOutputTokens: 2_000,
    });
    const providerMs = Date.now() - providerStart;
    const answer = result.text.trim();
    if (!answer) throw new Error('Provider returned an empty answer — temporarily unavailable');

    await patchTask(task.id, {
      checkpoint: 'ANSWER_RECEIVED',
      heartbeat_at: nowIso(),
    });

    const assistantMessageId = await persistAssistantReply(task, answer);

    await patchTask(task.id, {
      status: 'COMPLETED' satisfies IVXOwnerAITaskStatus,
      checkpoint: 'COMPLETED',
      answer,
      assistant_message_id: assistantMessageId,
      model: result.providerMetadata.model ?? null,
      provider: result.providerMetadata.provider ?? null,
      error_code: null,
      error_message: null,
      http_status: 200,
      failure_source: null,
    });

    // VERIFIED = answer exists + (persisted to the conversation OR no conversation target).
    const verified = answer.length > 0 && (task.conversation_id === null || assistantMessageId !== null);
    await patchTask(task.id, {
      status: (verified ? 'VERIFIED' : 'COMPLETED') satisfies IVXOwnerAITaskStatus,
      checkpoint: verified ? 'VERIFIED' : 'COMPLETED',
      checkpoint_history: appendCheckpoint(task.checkpoint_history, verified ? 'VERIFIED' : 'COMPLETED_UNVERIFIED_PERSISTENCE'),
      durations: { queueMs, providerMs, totalMs: Date.now() - startedMs },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'owner AI task execution failed';
    const httpStatus = (error as { httpStatus?: number }).httpStatus ?? null;
    const classification = classifyFailureForRetry({ httpStatus, message });
    const attempt = task.retry_count + 1;
    const outcome = nextStatusAfterFailure(attempt, task.max_retries, classification.transient);
    const delayMs = computeRetryDelayMs(attempt);
    const source = classify503Source({ httpStatus: httpStatus ?? 500, message });

    console.log('[IVXOwnerAITaskQueue] task attempt failed', {
      taskId: task.id,
      traceId: task.trace_id,
      attempt,
      transient: classification.transient,
      nextStatus: outcome.status,
      deadLetter: outcome.deadLetter,
      httpStatus,
      source,
    });

    await patchTask(task.id, {
      status: outcome.status,
      checkpoint: outcome.status === 'RETRYING' ? `RETRY_SCHEDULED_ATTEMPT_${attempt + 1}` : (outcome.deadLetter ? 'DEAD_LETTER' : 'FAILED_PERMANENT'),
      checkpoint_history: appendCheckpoint(task.checkpoint_history, `ATTEMPT_${attempt}_FAILED: ${classification.code}`),
      retry_count: attempt,
      next_retry_at: outcome.status === 'RETRYING' ? new Date(Date.now() + delayMs).toISOString() : null,
      claimed_by: null,
      dead_letter: outcome.deadLetter,
      error_code: classification.code,
      error_message: message.slice(0, 500),
      http_status: httpStatus,
      failure_source: source,
      durations: { queueMs, totalMs: Date.now() - startedMs },
    });
  }
}

async function workerTick(): Promise<void> {
  if (workerTickRunning || !isTaskQueueConfigured()) return;
  workerTickRunning = true;
  workerLastTickAt = nowIso();
  try {
    const now = encodeURIComponent(nowIso());
    const res = await restFetch(
      `${TASKS_TABLE}?status=in.(QUEUED,RETRYING)&or=(next_retry_at.is.null,next_retry_at.lte.${now})&order=created_at.asc&limit=${MAX_CONCURRENT_CLAIMS}`,
      { method: 'GET', headers: restHeaders() },
    );
    if (!res.ok) return;
    const candidates = await res.json().catch(() => []) as IVXOwnerAITaskRow[];
    for (const candidate of candidates) {
      // CRITICAL: senior_dev tasks are owned by the IVX-SENIOR-DEV-01 autonomous
      // worker (backend/services/ivx-senior-dev-worker.ts), which runs the real
      // 8-phase engineering pipeline (PLANNING→INSPECTING→IMPLEMENTING→TESTING→
      // WAITING_APPROVAL→COMMITTING→DEPLOYING→LIVE_VERIFYING→VERIFIED).
      // The general queue worker must NEVER claim senior_dev tasks — doing so
      // would call the chat AI, get a text answer, and falsely mark the task
      // VERIFIED in ~10s with commitSha=null, deployId=null, filesChanged=[]
      // (the exact fake certification the owner forbade). Skip them here so the
      // senior dev worker is the sole executor of senior_dev tasks.
      //
      // We mark via trace_id (always "senior-dev-..." from the submit endpoint)
      // because the task_type column is only created by the self-bootstrap DDL,
      // which requires SUPABASE_ACCESS_TOKEN and may not have run yet. trace_id
      // is in the original CREATE TABLE and is always present, so it is the
      // reliable marker. task_type is checked too as a belt-and-suspenders.
      const isSeniorDev = (candidate.task_type === 'senior_dev')
        || (typeof candidate.trace_id === 'string' && candidate.trace_id.startsWith('senior-dev-'));
      if (isSeniorDev) {
        continue;
      }
      const claimed = await claimTask(candidate);
      if (claimed) await executeTask(claimed);
    }
  } catch (error) {
    console.log('[IVXOwnerAITaskQueue] worker tick error (non-fatal):', error instanceof Error ? error.message : 'unknown');
  } finally {
    workerTickRunning = false;
  }
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
ALTER TABLE ivx_owner_ai_tasks ENABLE ROW LEVEL SECURITY;
`;

let tableEnsured = false;

/**
 * Self-bootstrapping DDL: creates the durable task table through the Supabase
 * Management API (the only SQL path in the Render runtime — same pattern as
 * the migration runner). Idempotent; non-fatal when the token is absent.
 */
export async function ensureTaskTable(): Promise<boolean> {
  if (tableEnsured) return true;
  const probe = await checkDatabaseHealth();
  if (probe.ok) {
    tableEnsured = true;
    return true;
  }
  const token = (process.env.SUPABASE_ACCESS_TOKEN ?? '').trim();
  if (!token) {
    console.log('[IVXOwnerAITaskQueue] table missing and SUPABASE_ACCESS_TOKEN absent — cannot self-bootstrap DDL');
    return false;
  }
  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/projects/${managementProjectRef()}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: TASK_TABLE_DDL }),
      signal: AbortSignal.timeout(30_000),
    });
    console.log('[IVXOwnerAITaskQueue] self-bootstrap DDL result', { httpStatus: res.status });
    tableEnsured = res.ok || res.status === 201;
    return tableEnsured;
  } catch (error) {
    console.log('[IVXOwnerAITaskQueue] self-bootstrap DDL failed:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

/** Start the durable worker: DDL bootstrap + restart recovery first, then a polling loop. */
export function startOwnerAITaskWorker(intervalMs: number = 5_000): void {
  if (workerTimer) return;
  console.log('[IVXOwnerAITaskQueue] starting durable worker', { workerId: WORKER_ID, intervalMs });
  void ensureTaskTable().then(() => recoverOrphanTasks()).catch(() => 0);
  workerTimer = setInterval(() => { void workerTick(); }, intervalMs);
  (workerTimer as { unref?: () => void }).unref?.();
}

export function getWorkerRuntimeInfo(): { workerId: string; running: boolean; lastTickAt: string | null } {
  return { workerId: WORKER_ID, running: workerTimer !== null, lastTickAt: workerLastTickAt };
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
  if (!isTaskQueueConfigured()) {
    return { ok: false, detail: { reason: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing in runtime' } };
  }
  const started = Date.now();
  try {
    const res = await restFetch(`${TASKS_TABLE}?select=id&limit=1`, { method: 'GET', headers: restHeaders() });
    return {
      ok: res.ok,
      detail: { httpStatus: res.status, latencyMs: Date.now() - started, table: TASKS_TABLE },
    };
  } catch (error) {
    return { ok: false, detail: { reason: error instanceof Error ? error.message : 'database probe failed', latencyMs: Date.now() - started } };
  }
}

export function checkAIHealth(): HealthCheckResult {
  const startup = validateIVXAIStartup();
  const provider = getProviderHealth();
  const providerOk = provider.state !== 'AI_UNAVAILABLE';
  return {
    ok: startup.ok && providerOk,
    detail: {
      startupOk: startup.ok,
      startupErrors: startup.errors,
      providerState: provider.state,
      provider: startup.provider,
      model: startup.model,
    },
  };
}

export async function checkQueueHealth(): Promise<HealthCheckResult> {
  const runtime = getWorkerRuntimeInfo();
  if (!isTaskQueueConfigured()) return { ok: false, detail: { reason: 'queue persistence not configured', ...runtime } };
  try {
    const res = await restFetch(
      `${TASKS_TABLE}?status=in.(QUEUED,RETRYING,RUNNING)&select=id,status,created_at,dead_letter&order=created_at.asc&limit=200`,
      { method: 'GET', headers: restHeaders() },
    );
    if (!res.ok) return { ok: false, detail: { reason: `queue read failed HTTP ${res.status}`, ...runtime } };
    const rows = await res.json().catch(() => []) as { status: string; created_at: string }[];
    const oldest = rows[0]?.created_at ?? null;
    const oldestAgeMinutes = oldest ? Math.round((Date.now() - new Date(oldest).getTime()) / 60_000) : 0;
    const dlRes = await restFetch(`${TASKS_TABLE}?dead_letter=is.true&status=eq.FAILED&select=id&limit=100`, { method: 'GET', headers: restHeaders() });
    const deadLetters = dlRes.ok ? ((await dlRes.json().catch(() => [])) as unknown[]).length : -1;
    const saturated = rows.length >= 150;
    const stale = oldestAgeMinutes > 15;
    return {
      ok: runtime.running && !saturated && !stale,
      detail: {
        ...runtime,
        depth: rows.length,
        oldestQueuedAgeMinutes: oldestAgeMinutes,
        deadLetterCount: deadLetters,
        saturated,
        staleQueue: stale,
        alerts: computeIncidentAlerts(),
      },
    };
  } catch (error) {
    return { ok: false, detail: { reason: error instanceof Error ? error.message : 'queue probe failed', ...runtime } };
  }
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
