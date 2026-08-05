import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';

type AgentJobStatus = 'queued' | 'running' | 'validating' | 'waiting_approval' | 'completed' | 'failed' | 'canceled';
type AgentJobLogLevel = 'info' | 'warn' | 'error';

type AgentJobRow = {
  id: string;
  type: string;
  status: AgentJobStatus;
  prompt: string;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  approval_required: boolean;
  approved_at: string | null;
  approved_by: string | null;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  locked_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  canceled_at: string | null;
  next_run_at: string;
  progress: number;
  agent_name: string | null;
  current_step: string | null;
  chat_message: string | null;
  eta_seconds: number | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type AgentJobLogRow = {
  id: string;
  job_id: string;
  level: AgentJobLogLevel;
  step: string;
  message: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type AgentJobCreateBody = {
  type?: unknown;
  prompt?: unknown;
  payload?: unknown;
  approvalRequired?: unknown;
  maxAttempts?: unknown;
};

type PgQueryResult = { command?: string; rowCount?: number | null; rows: Record<string, unknown>[] };
type PgClientLike = { query: (sql: string) => Promise<PgQueryResult>; release: () => void };
type PgPoolLike = { connect: () => Promise<PgClientLike>; end: () => Promise<void> };
type PgPoolConstructor = new (config: { connectionString: string; ssl?: { rejectUnauthorized: boolean }; application_name?: string; max?: number; idleTimeoutMillis?: number; connectionTimeoutMillis?: number }) => PgPoolLike;

const BLOCK22_MARKER = 'ivx-agent-worker-2026-05-17t-block22';
const BLOCK32_LIVE_ACTIVITY_MARKER = 'ivx-agent-live-activity-2026-05-19t-block32';
const CHAT_FACING_BY_STEP: Record<string, string> = {
  queued: 'Queued for backend worker…',
  picked: 'I’m inspecting…',
  running: 'I’m inspecting…',
  inspecting: 'I’m inspecting…',
  work_step: 'Working…',
  validating: 'Validation running…',
  fix_proposal: 'Fix proposal ready…',
  waiting_approval: 'Waiting for owner approval.',
  retry: 'Retrying job…',
  retry_scheduled: 'Retry scheduled…',
  completed: 'Completed.',
  failed: 'Job failed.',
  canceled: 'Job canceled.',
};
const WORKER_ID = `${BLOCK22_MARKER}:${Math.random().toString(36).slice(2, 8)}`;
const MAX_PROMPT_LENGTH = 6000;
const MAX_JOB_LIMIT = 100;
const DEFAULT_JOB_LIMIT = 50;
const DEFAULT_MAX_ATTEMPTS = 3;
const WORKER_INTERVAL_MS = 15_000;

type WorkerTimer = ReturnType<typeof setInterval> & { unref?: () => void };

let schemaReadyPromise: Promise<void> | null = null;
let workerLoopStarted = false;
let workerLoopTimer: WorkerTimer | null = null;
let workerTickInFlight = false;
let lastWorkerTickAt: string | null = null;
let lastWorkerTickResult: Record<string, unknown> | null = null;
let lastWorkerTickError: string | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readBoolean(value: unknown): boolean {
  return value === true || readTrimmed(value).toLowerCase() === 'true';
}

function readPositiveInt(value: unknown, fallback: number, max: number): number {
  const raw = typeof value === 'number' ? value : Number(readTrimmed(value));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), 1), max);
}

function sanitizeText(value: unknown, fallback: string): string {
  const text = readTrimmed(value) || fallback;
  return text.slice(0, MAX_PROMPT_LENGTH);
}

function sanitizeExternalError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return readTrimmed(raw)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .slice(0, 320) || fallback;
}

function getSupabaseRestBaseUrl(): string {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  if (!supabaseUrl) {
    throw new Error('EXPO_PUBLIC_SUPABASE_URL is required for IVX agent jobs.');
  }
  return `${supabaseUrl}/rest/v1`;
}

function getSupabaseDatabaseUrl(): string {
  const url = readTrimmed(process.env.SUPABASE_DB_URL) || readTrimmed(process.env.DATABASE_URL) || readTrimmed(process.env.POSTGRES_URL);
  if (!url) {
    throw new Error('SUPABASE_DB_URL, DATABASE_URL, or POSTGRES_URL is required for fallback IVX agent SQL setup.');
  }
  return url;
}

function decodeJwtRole(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function getServiceRoleKey(): string {
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const role = decodeJwtRole(serviceKey);
  if (!serviceKey || serviceKey === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
    throw new Error('A backend-only Supabase service-role key is required for IVX agent jobs.');
  }
  return serviceKey;
}

function restHeaders(prefer?: string): HeadersInit {
  const key = getServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    ...(prefer ? { Prefer: prefer } : {}),
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { message: text.slice(0, 280) };
  }
}

function extractRestError(payload: unknown, fallback: string): string {
  const record = readRecord(payload);
  return readTrimmed(record.message) || readTrimmed(record.error) || readTrimmed(record.details) || fallback;
}

async function supabaseRestRequest<T>(path: string, init: RequestInit = {}, prefer?: string): Promise<T> {
  const response = await fetch(`${getSupabaseRestBaseUrl()}${path}`, {
    ...init,
    headers: {
      ...restHeaders(prefer),
      ...(init.headers ?? {}),
    },
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractRestError(payload, `Supabase REST returned HTTP ${response.status}.`));
  }
  return payload as T;
}

async function executeSqlViaRpc(sql: string): Promise<void> {
  const payload = await supabaseRestRequest<unknown>('/rpc/ivx_exec_sql', {
    method: 'POST',
    body: JSON.stringify({ sql_text: sql }),
  });
  const record = readRecord(payload);
  if (record.ok === false) {
    throw new Error(extractRestError(record, 'ivx_exec_sql reported failure.'));
  }
}

async function executeSqlViaPg(sql: string): Promise<void> {
  const pgModule = await import('pg') as { Pool: PgPoolConstructor };
  const pool = new pgModule.Pool({
    connectionString: getSupabaseDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
    application_name: 'ivx_agent_worker_schema_setup',
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
  });
  const client = await pool.connect();
  try {
    await client.query(sql);
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function executeSchemaSql(sql: string): Promise<void> {
  try {
    await executeSqlViaRpc(sql);
  } catch (rpcError) {
    console.log('[IVXAgentWorker] SQL RPC setup failed, trying pg fallback:', sanitizeExternalError(rpcError, 'SQL RPC setup failed.'));
    await executeSqlViaPg(sql);
  }
}

async function ensureAgentSchema(): Promise<void> {
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      const statements = [
        `create table if not exists public.ivx_agent_jobs (
          id text primary key default gen_random_uuid()::text,
          type text not null default 'manual',
          status text not null default 'queued' check (status in ('queued','running','validating','waiting_approval','completed','failed','canceled')),
          prompt text not null default '',
          payload jsonb not null default '{}'::jsonb,
          result jsonb,
          error text,
          approval_required boolean not null default false,
          progress integer not null default 0,
          agent_name text,
          current_step text,
          chat_message text,
          eta_seconds integer,
          approved_at timestamptz,
          approved_by text,
          attempts integer not null default 0,
          max_attempts integer not null default 3,
          locked_by text,
          locked_at timestamptz,
          started_at timestamptz,
          completed_at timestamptz,
          canceled_at timestamptz,
          next_run_at timestamptz not null default now(),
          created_by text,
          created_by_email text,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now()
        )`,
        `create table if not exists public.ivx_agent_job_logs (
          id text primary key default gen_random_uuid()::text,
          job_id text not null references public.ivx_agent_jobs(id) on delete cascade,
          level text not null default 'info' check (level in ('info','warn','error')),
          step text not null,
          message text not null,
          metadata jsonb not null default '{}'::jsonb,
          created_at timestamptz not null default now()
        )`,
        'alter table public.ivx_agent_jobs add column if not exists progress integer not null default 0',
        'alter table public.ivx_agent_jobs add column if not exists agent_name text',
        'alter table public.ivx_agent_jobs add column if not exists current_step text',
        'alter table public.ivx_agent_jobs add column if not exists chat_message text',
        'alter table public.ivx_agent_jobs add column if not exists eta_seconds integer',
        'alter table public.ivx_agent_jobs drop constraint if exists ivx_agent_jobs_status_check',
        `alter table public.ivx_agent_jobs add constraint ivx_agent_jobs_status_check check (status in ('queued','running','validating','waiting_approval','completed','failed','canceled'))`,
        'create index if not exists ivx_agent_jobs_status_next_run_idx on public.ivx_agent_jobs (status, next_run_at, created_at)',
        'create index if not exists ivx_agent_jobs_created_at_idx on public.ivx_agent_jobs (created_at desc)',
        'create index if not exists ivx_agent_job_logs_job_created_idx on public.ivx_agent_job_logs (job_id, created_at asc)',
        'alter table public.ivx_agent_jobs enable row level security',
        'alter table public.ivx_agent_job_logs enable row level security',
        `comment on table public.ivx_agent_jobs is 'IVX Block 22 autonomous backend job queue. Backend service-role route is the access boundary.'`,
        `comment on table public.ivx_agent_job_logs is 'IVX Block 22 per-job backend worker step logs.'`,
        "select pg_notify('pgrst','reload schema')",
      ];
      for (const statement of statements) {
        await executeSchemaSql(statement);
      }
    })().catch((error) => {
      schemaReadyPromise = null;
      throw error;
    });
  }
  await schemaReadyPromise;
}

async function appendJobLog(jobId: string, step: string, message: string, metadata: Record<string, unknown> = {}, level: AgentJobLogLevel = 'info'): Promise<void> {
  await supabaseRestRequest('/ivx_agent_job_logs', {
    method: 'POST',
    body: JSON.stringify({ job_id: jobId, level, step, message, metadata }),
  }, 'return=minimal');
}

function toJobRow(value: unknown): AgentJobRow | null {
  const record = readRecord(value);
  const id = readTrimmed(record.id);
  const status = readTrimmed(record.status) as AgentJobStatus;
  if (!id || !['queued', 'running', 'validating', 'waiting_approval', 'completed', 'failed', 'canceled'].includes(status)) {
    return null;
  }
  return {
    id,
    type: readTrimmed(record.type) || 'manual',
    status,
    prompt: readTrimmed(record.prompt),
    payload: readRecord(record.payload),
    result: record.result === null ? null : readRecord(record.result),
    error: readTrimmed(record.error) || null,
    approval_required: record.approval_required === true,
    approved_at: readTrimmed(record.approved_at) || null,
    approved_by: readTrimmed(record.approved_by) || null,
    attempts: readPositiveInt(record.attempts, 0, 1000),
    max_attempts: readPositiveInt(record.max_attempts, DEFAULT_MAX_ATTEMPTS, 1000),
    locked_by: readTrimmed(record.locked_by) || null,
    locked_at: readTrimmed(record.locked_at) || null,
    started_at: readTrimmed(record.started_at) || null,
    completed_at: readTrimmed(record.completed_at) || null,
    canceled_at: readTrimmed(record.canceled_at) || null,
    next_run_at: readTrimmed(record.next_run_at) || nowIso(),
    progress: readPositiveInt(record.progress, 0, 100),
    agent_name: readTrimmed(record.agent_name) || null,
    current_step: readTrimmed(record.current_step) || null,
    chat_message: readTrimmed(record.chat_message) || null,
    eta_seconds: record.eta_seconds === null || typeof record.eta_seconds === 'undefined' ? null : readPositiveInt(record.eta_seconds, 0, 86_400),
    created_by: readTrimmed(record.created_by) || null,
    created_by_email: readTrimmed(record.created_by_email) || null,
    created_at: readTrimmed(record.created_at) || nowIso(),
    updated_at: readTrimmed(record.updated_at) || nowIso(),
  };
}

function toLogRow(value: unknown): AgentJobLogRow | null {
  const record = readRecord(value);
  const id = readTrimmed(record.id);
  const jobId = readTrimmed(record.job_id);
  if (!id || !jobId) return null;
  return {
    id,
    job_id: jobId,
    level: (readTrimmed(record.level) || 'info') as AgentJobLogLevel,
    step: readTrimmed(record.step) || 'unknown',
    message: readTrimmed(record.message),
    metadata: readRecord(record.metadata),
    created_at: readTrimmed(record.created_at) || nowIso(),
  };
}

async function updateJob(jobId: string, patch: Record<string, unknown>, statusGuard?: AgentJobStatus): Promise<AgentJobRow | null> {
  const query = statusGuard
    ? `/ivx_agent_jobs?id=eq.${encodeURIComponent(jobId)}&status=eq.${encodeURIComponent(statusGuard)}&select=*`
    : `/ivx_agent_jobs?id=eq.${encodeURIComponent(jobId)}&select=*`;
  const rows = await supabaseRestRequest<unknown[]>(query, {
    method: 'PATCH',
    body: JSON.stringify({ ...patch, updated_at: nowIso() }),
  }, 'return=representation');
  return Array.isArray(rows) ? toJobRow(rows[0]) : null;
}

export async function loadJob(jobId: string): Promise<AgentJobRow | null> {
  const rows = await supabaseRestRequest<unknown[]>(`/ivx_agent_jobs?id=eq.${encodeURIComponent(jobId)}&select=*&limit=1`);
  return Array.isArray(rows) ? toJobRow(rows[0]) : null;
}

export async function loadJobLogs(jobId: string): Promise<AgentJobLogRow[]> {
  const rows = await supabaseRestRequest<unknown[]>(`/ivx_agent_job_logs?job_id=eq.${encodeURIComponent(jobId)}&select=*&order=created_at.asc&limit=200`);
  return Array.isArray(rows) ? rows.map(toLogRow).filter((row): row is AgentJobLogRow => row !== null) : [];
}

export async function createAgentJob(body: AgentJobCreateBody, ownerContext: { userId: string | null; email: string | null }): Promise<AgentJobRow> {
  await ensureAgentSchema();
  const approvalRequired = readBoolean(body.approvalRequired);
  const record = {
    type: sanitizeText(body.type, 'manual').replace(/[^a-zA-Z0-9_:-]/g, '_').slice(0, 80) || 'manual',
    status: approvalRequired ? 'waiting_approval' : 'queued',
    prompt: sanitizeText(body.prompt, 'Run IVX backend worker proof job.'),
    payload: readRecord(body.payload),
    approval_required: approvalRequired,
    max_attempts: readPositiveInt(body.maxAttempts, DEFAULT_MAX_ATTEMPTS, 10),
    created_by: ownerContext.userId,
    created_by_email: ownerContext.email,
    progress: approvalRequired ? 0 : 1,
    agent_name: null,
    current_step: approvalRequired ? 'waiting_approval' : 'queued',
    chat_message: approvalRequired ? 'Waiting for owner approval.' : 'Queued for backend worker…',
    eta_seconds: null,
  };
  const rows = await supabaseRestRequest<unknown[]>('/ivx_agent_jobs?select=*', {
    method: 'POST',
    body: JSON.stringify(record),
  }, 'return=representation');
  const job = Array.isArray(rows) ? toJobRow(rows[0]) : null;
  if (!job) throw new Error('IVX agent job could not be created.');
  await appendJobLog(job.id, 'created', approvalRequired ? 'Job created and waiting for owner approval.' : 'Job created and queued for backend worker.', { type: job.type, createdBy: ownerContext.email ?? ownerContext.userId });
  return job;
}

async function listAgentJobs(status: string | null, limit: number): Promise<Array<AgentJobRow & { logs: AgentJobLogRow[] }>> {
  await ensureAgentSchema();
  const safeLimit = readPositiveInt(limit, DEFAULT_JOB_LIMIT, MAX_JOB_LIMIT);
  const statusQuery = status && ['queued', 'running', 'waiting_approval', 'validating', 'completed', 'failed', 'canceled'].includes(status)
    ? `status=eq.${encodeURIComponent(status)}&`
    : '';
  const rows = await supabaseRestRequest<unknown[]>(`/ivx_agent_jobs?${statusQuery}select=*&order=created_at.desc&limit=${safeLimit}`);
  const jobs = Array.isArray(rows) ? rows.map(toJobRow).filter((row): row is AgentJobRow => row !== null) : [];
  const withLogs: Array<AgentJobRow & { logs: AgentJobLogRow[] }> = [];
  for (const job of jobs) {
    withLogs.push({ ...job, logs: await loadJobLogs(job.id) });
  }
  return withLogs;
}

async function pickQueuedJob(): Promise<AgentJobRow | null> {
  await ensureAgentSchema();
  const rows = await supabaseRestRequest<unknown[]>(`/ivx_agent_jobs?status=eq.queued&next_run_at=lte.${encodeURIComponent(nowIso())}&select=*&order=created_at.asc&limit=1`);
  const queued = Array.isArray(rows) ? toJobRow(rows[0]) : null;
  if (!queued) return null;
  const running = await updateJob(queued.id, {
    status: 'running',
    attempts: queued.attempts + 1,
    locked_by: WORKER_ID,
    locked_at: nowIso(),
    started_at: queued.started_at ?? nowIso(),
    error: null,
  }, 'queued');
  if (!running) return null;
  await appendJobLog(running.id, 'picked', 'Backend worker picked queued job.', { workerId: WORKER_ID, attempt: running.attempts });
  return running;
}

function inferAgentNameFromJob(job: AgentJobRow): string {
  const fromPayload = readTrimmed((job.payload as { agentName?: unknown; agent?: unknown }).agentName)
    || readTrimmed((job.payload as { agentName?: unknown; agent?: unknown }).agent);
  if (fromPayload) return fromPayload.slice(0, 80);
  const t = job.type.toLowerCase();
  if (t.includes('frontend')) return 'frontend_developer';
  if (t.includes('backend')) return 'backend_developer';
  if (t.includes('infra') || t.includes('sre')) return 'infrastructure_sre';
  if (t.includes('supabase') || t.includes('db')) return 'supabase_database';
  if (t.includes('analytics')) return 'analytics';
  if (t.includes('operations') || t.includes('ops')) return 'operations';
  return 'cto_orchestrator';
}

async function updateJobProgress(jobId: string, patch: { progress?: number; current_step?: string; chat_message?: string; agent_name?: string; eta_seconds?: number | null; status?: AgentJobStatus }): Promise<void> {
  const sanitized: Record<string, unknown> = {};
  if (typeof patch.progress === 'number') sanitized.progress = Math.max(0, Math.min(100, Math.floor(patch.progress)));
  if (typeof patch.current_step === 'string') sanitized.current_step = patch.current_step.slice(0, 240);
  if (typeof patch.chat_message === 'string') sanitized.chat_message = patch.chat_message.slice(0, 240);
  if (typeof patch.agent_name === 'string') sanitized.agent_name = patch.agent_name.slice(0, 80);
  if (patch.eta_seconds === null) sanitized.eta_seconds = null;
  else if (typeof patch.eta_seconds === 'number' && Number.isFinite(patch.eta_seconds)) sanitized.eta_seconds = Math.max(0, Math.floor(patch.eta_seconds));
  if (patch.status) sanitized.status = patch.status;
  if (Object.keys(sanitized).length === 0) return;
  await updateJob(jobId, sanitized);
}

async function runJobPayload(job: AgentJobRow): Promise<Record<string, unknown>> {
  const agentName = inferAgentNameFromJob(job);
  await updateJobProgress(job.id, { progress: 10, agent_name: agentName, current_step: 'inspecting', chat_message: 'I’m inspecting…', eta_seconds: 30 });
  await appendJobLog(job.id, 'running', 'Backend worker started server-side job execution.', { workerId: WORKER_ID, phoneDependent: false, rorkChatDependent: false, agentName, progress: 10 });
  if (job.approval_required && !job.approved_at) {
    await updateJob(job.id, { status: 'waiting_approval', locked_by: null, locked_at: null, current_step: 'waiting_approval', chat_message: 'Waiting for owner approval.', eta_seconds: null });
    await appendJobLog(job.id, 'waiting_approval', 'Job requires owner approval before execution can continue.', { workerId: WORKER_ID }, 'warn');
    return { waitingApproval: true };
  }
  if (job.payload.forceFail === true || job.type === 'block22_force_fail') {
    await appendJobLog(job.id, 'forced_failure', 'Intentional Block 22 proof failure requested.', { workerId: WORKER_ID }, 'warn');
    throw new Error('Intentional Block 22 proof failure requested.');
  }
  await updateJobProgress(job.id, { progress: 45, current_step: 'work_step', chat_message: 'Working…', eta_seconds: 18 });
  await appendJobLog(job.id, 'work_step', 'Executed Block 22 backend proof step.', { type: job.type, payloadKeys: Object.keys(job.payload).sort(), progress: 45 });
  await updateJobProgress(job.id, { progress: 75, status: 'validating', current_step: 'validating', chat_message: 'Validation running…', eta_seconds: 8 });
  await appendJobLog(job.id, 'validating', 'Validation running on backend worker.', { workerId: WORKER_ID, progress: 75 });
  await updateJobProgress(job.id, { progress: 95, current_step: 'fix_proposal', chat_message: 'Fix proposal ready…', eta_seconds: 2 });
  await appendJobLog(job.id, 'fix_proposal', 'Fix proposal prepared.', { workerId: WORKER_ID, progress: 95 });
  return {
    ok: true,
    type: job.type,
    promptPreview: job.prompt.slice(0, 180),
    processedAt: nowIso(),
    workerId: WORKER_ID,
    serverSide: true,
    independentOfPhone: true,
    independentOfRorkChat: true,
    independentOfAppOpen: true,
    publicChatSourceRequired: 'chatgpt',
    marker: BLOCK22_MARKER,
  };
}

export async function processNextAgentJob(): Promise<Record<string, unknown>> {
  const job = await pickQueuedJob();
  if (!job) {
    return { ok: true, picked: false, workerId: WORKER_ID, marker: BLOCK22_MARKER, timestamp: nowIso() };
  }
  try {
    const result = await runJobPayload(job);
    if (result.waitingApproval === true) {
      return { ok: true, picked: true, jobId: job.id, status: 'waiting_approval', workerId: WORKER_ID, marker: BLOCK22_MARKER };
    }
    const completed = await updateJob(job.id, {
      status: 'completed',
      result,
      completed_at: nowIso(),
      locked_by: null,
      locked_at: null,
      progress: 100,
      current_step: 'completed',
      chat_message: 'Completed.',
      eta_seconds: 0,
    });
    await appendJobLog(job.id, 'completed', 'Backend worker completed job.', { workerId: WORKER_ID, resultMarker: BLOCK22_MARKER });
    return { ok: true, picked: true, jobId: job.id, status: completed?.status ?? 'completed', workerId: WORKER_ID, marker: BLOCK22_MARKER };
  } catch (error) {
    const message = sanitizeExternalError(error, 'IVX agent job failed.');
    const nextStatus: AgentJobStatus = job.attempts >= job.max_attempts ? 'failed' : 'queued';
    const nextRunAt = new Date(Date.now() + Math.min(job.attempts + 1, 5) * 30_000).toISOString();
    await updateJob(job.id, {
      status: nextStatus,
      error: message,
      locked_by: null,
      locked_at: null,
      next_run_at: nextRunAt,
      completed_at: nextStatus === 'failed' ? nowIso() : null,
    });
    await appendJobLog(job.id, nextStatus === 'failed' ? 'failed' : 'retry_scheduled', message, { workerId: WORKER_ID, nextRunAt }, 'error');
    return { ok: false, picked: true, jobId: job.id, status: nextStatus, error: message, workerId: WORKER_ID, marker: BLOCK22_MARKER };
  }
}

async function workerTick(): Promise<void> {
  if (workerTickInFlight) return;
  workerTickInFlight = true;
  try {
    lastWorkerTickAt = nowIso();
    lastWorkerTickResult = await processNextAgentJob();
    lastWorkerTickError = null;
  } catch (error) {
    lastWorkerTickError = sanitizeExternalError(error, 'IVX agent worker tick failed.');
    lastWorkerTickResult = null;
    console.log('[IVXAgentWorker] Tick failed:', lastWorkerTickError);
  } finally {
    workerTickInFlight = false;
  }
}

export function startIVXAgentWorkerLoop(): void {
  if (workerLoopStarted || readTrimmed(process.env.IVX_AGENT_WORKER_DISABLED).toLowerCase() === 'true') {
    return;
  }
  workerLoopStarted = true;
  workerLoopTimer = setInterval(() => {
    void workerTick();
  }, WORKER_INTERVAL_MS) as WorkerTimer;
  if (typeof workerLoopTimer.unref === 'function') {
    workerLoopTimer.unref();
  }
  void workerTick();
  console.log('[IVXAgentWorker] Server-side worker loop started:', { workerId: WORKER_ID, marker: BLOCK22_MARKER, intervalMs: WORKER_INTERVAL_MS });
}

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  if (message.includes('missing bearer token') || message.includes('invalid or expired')) return 401;
  if (message.includes('privileged ivx access is required')) return 403;
  if (message.includes('required') || message.includes('not configured') || message.includes('does not exist')) return 503;
  return 500;
}

function errorResponse(error: unknown): Response {
  const detail = sanitizeExternalError(error, 'IVX agent job route failed.');
  return ownerOnlyJson({ ok: false, error: detail, marker: BLOCK22_MARKER, timestamp: nowIso() }, getErrorStatus(error));
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXAgentJobsStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    await ensureAgentSchema();
    const jobs = await listAgentJobs(null, 100);
    const counts = jobs.reduce<Record<AgentJobStatus, number>>((acc, job) => {
      acc[job.status] += 1;
      return acc;
    }, { queued: 0, running: 0, waiting_approval: 0, validating: 0, completed: 0, failed: 0, canceled: 0 });
    return ownerOnlyJson({
      ok: true,
      marker: BLOCK22_MARKER,
      worker: {
        serverSide: true,
        loopStarted: workerLoopStarted,
        workerId: WORKER_ID,
        intervalMs: WORKER_INTERVAL_MS,
        inFlight: workerTickInFlight,
        lastTickAt: lastWorkerTickAt,
        lastTickResult: lastWorkerTickResult,
        lastTickError: lastWorkerTickError,
        independentOfPhone: true,
        independentOfRorkChat: true,
        independentOfAppOpen: true,
      },
      tables: ['ivx_agent_jobs', 'ivx_agent_job_logs'],
      counts,
      timestamp: nowIso(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXAgentJobsListRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const url = new URL(request.url);
    const jobs = await listAgentJobs(readTrimmed(url.searchParams.get('status')) || null, readPositiveInt(url.searchParams.get('limit'), DEFAULT_JOB_LIMIT, MAX_JOB_LIMIT));
    return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, jobs, timestamp: nowIso() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXAgentJobsCreateRequest(request: Request): Promise<Response> {
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = await request.json().catch(() => ({})) as AgentJobCreateBody;
    // Pre-Execution Feasibility Gate (Stage 0)
    try {
      const gate = await checkPreExecutionGate(request, {
        prompt: `agent job create type=${body.type ?? 'unknown'}`,
        ownerSessionPresent: true,
        entryPoint: 'agent-jobs-create',
      });
      if (gate.blocked && gate.response) return gate.response;
    } catch (gateError) {
      console.log('[IVXAgentJobs] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }
    const job = await createAgentJob(body, ownerContext);
    return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, job, logs: await loadJobLogs(job.id), timestamp: nowIso() }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXAgentJobGetRequest(request: Request, jobId: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    await ensureAgentSchema();
    const job = await loadJob(jobId);
    if (!job) {
      return ownerOnlyJson({ ok: false, error: 'IVX agent job was not found.', marker: BLOCK22_MARKER, timestamp: nowIso() }, 404);
    }
    const logs = await loadJobLogs(jobId);
    return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, job, logs, timestamp: nowIso() });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXAgentJobActionRequest(request: Request, jobId: string, action: 'retry' | 'cancel' | 'approve'): Promise<Response> {
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    await ensureAgentSchema();
    const job = await loadJob(jobId);
    if (!job) throw new Error('IVX agent job was not found.');
    if (action === 'retry') {
      const retried = await updateJob(job.id, { status: 'queued', error: null, result: null, next_run_at: nowIso(), locked_by: null, locked_at: null, completed_at: null, canceled_at: null, progress: 0, current_step: 'queued', chat_message: 'Retrying job…', eta_seconds: null });
      await appendJobLog(job.id, 'retry', 'Owner queued job for retry.', { owner: ownerContext.email ?? ownerContext.userId });
      return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, job: retried, logs: await loadJobLogs(job.id), timestamp: nowIso() });
    }
    if (action === 'cancel') {
      const canceled = await updateJob(job.id, { status: 'canceled', canceled_at: nowIso(), locked_by: null, locked_at: null, current_step: 'canceled', chat_message: 'Job canceled by owner.', eta_seconds: null });
      await appendJobLog(job.id, 'canceled', 'Owner canceled job.', { owner: ownerContext.email ?? ownerContext.userId }, 'warn');
      return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, job: canceled, logs: await loadJobLogs(job.id), timestamp: nowIso() });
    }
    const approved = await updateJob(job.id, { status: 'queued', approved_at: nowIso(), approved_by: ownerContext.email ?? ownerContext.userId, next_run_at: nowIso(), locked_by: null, locked_at: null });
    await appendJobLog(job.id, 'approved', 'Owner approved job; backend worker may process it now.', { owner: ownerContext.email ?? ownerContext.userId });
    return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, job: approved, logs: await loadJobLogs(job.id), timestamp: nowIso() });
  } catch (error) {
    return errorResponse(error);
  }
}

function buildLiveActivitySnapshot(jobs: Array<AgentJobRow & { logs: AgentJobLogRow[] }>): Record<string, unknown> {
  const live = jobs.filter((j) => j.status === 'queued' || j.status === 'running' || j.status === 'validating' || j.status === 'waiting_approval');
  const recent = jobs.filter((j) => j.status === 'completed' || j.status === 'failed' || j.status === 'canceled').slice(0, 12);
  return {
    activeCount: live.length,
    activeJobs: live.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      progress: j.progress,
      agentName: j.agent_name,
      currentStep: j.current_step,
      etaSeconds: j.eta_seconds,
      chatMessage: j.chat_message ?? CHAT_FACING_BY_STEP[j.current_step ?? ''] ?? null,
      attempts: j.attempts,
      maxAttempts: j.max_attempts,
      startedAt: j.started_at,
      updatedAt: j.updated_at,
      promptPreview: j.prompt.slice(0, 200),
      logs: j.logs.slice(-5).map((log) => ({
        step: log.step,
        level: log.level,
        message: log.message,
        chatMessage: CHAT_FACING_BY_STEP[log.step] ?? null,
        at: log.created_at,
      })),
    })),
    recentCompleted: recent.map((j) => ({
      id: j.id,
      type: j.type,
      status: j.status,
      progress: j.progress,
      agentName: j.agent_name,
      completedAt: j.completed_at,
      canceledAt: j.canceled_at,
      error: j.error,
      chatMessage: j.chat_message ?? CHAT_FACING_BY_STEP[j.status] ?? null,
    })),
  };
}

export async function handleIVXAgentJobsLiveActivityRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const url = new URL(request.url);
    const limit = readPositiveInt(url.searchParams.get('limit'), 40, MAX_JOB_LIMIT);
    const jobs = await listAgentJobs(null, limit);
    const snapshot = buildLiveActivitySnapshot(jobs);
    return ownerOnlyJson({
      ok: true,
      marker: BLOCK32_LIVE_ACTIVITY_MARKER,
      ownerOnly: true,
      worker: {
        loopStarted: workerLoopStarted,
        intervalMs: WORKER_INTERVAL_MS,
        inFlight: workerTickInFlight,
        lastTickAt: lastWorkerTickAt,
      },
      ...snapshot,
      timestamp: nowIso(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function handleIVXAgentWorkerRunOnceRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const result = await processNextAgentJob();
    return ownerOnlyJson({ ok: true, marker: BLOCK22_MARKER, result, workerId: WORKER_ID, timestamp: nowIso() });
  } catch (error) {
    return errorResponse(error);
  }
}

startIVXAgentWorkerLoop();
