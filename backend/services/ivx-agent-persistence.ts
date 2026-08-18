/**
 * IVX Agent Persistence — durable Supabase state for the 112 IA agents.
 *
 * Persists (survives restart/redeploy — NOT RAM-only):
 *   - agent states:  per-agent health, lastHeartbeat, lastSuccessfulRun,
 *                    lastFailedRun, last tool/source/evidence, cost usage
 *   - executions:    one row per execution — taskId, toolsUsed, evidence,
 *                    sourceReference, output, costUsage, finalStatus,
 *                    realToolUsed, toolResultId, verifiedOutput, dedupKey
 *   - CRM prospects: buyer / investor / tokenized / partner / jv prospects
 *                    (separated types, dedup keys, objective scores,
 *                    compliance gates)
 *   - alerts:        stale heartbeat, stuck agent, output-without-evidence,
 *                    prohibited tool attempts
 *   - certificates:  IVX 112 Real Execution Certificate results
 *
 * Storage modes (auto-detected, same exported API either way):
 *   1. "dedicated"     — purpose-built tables (ivx_agent_states, ivx_agent_executions,
 *                        ivx_crm_prospects, ivx_agent_alerts, ivx_agent_certificates).
 *                        Self-bootstraps via the Supabase Management API when a
 *                        SUPABASE_ACCESS_TOKEN is available (env or encrypted
 *                        Owner Variables store — the proven ensureSeniorDevTables
 *                        pattern).
 *   2. "jobs_fallback" — the existing production ivx_agent_jobs table as a durable
 *                        typed document store (deterministic UUID primary keys give
 *                        dedup; payload JSONB carries the full typed row). Used when
 *                        dedicated tables cannot be created because the management
 *                        token is unavailable. Still 100% Supabase — never RAM.
 *
 * On 401/403 from any integration, the exact runtime credential binding used is
 * logged (binding NAME only — never the secret value).
 */
import { createHash } from 'node:crypto';

export const IVX_AGENT_PERSISTENCE_MARKER = 'ivx-agent-persistence-2026-08-18';

// ── Config resolution ────────────────────────────────────────────────────────

function readTrimmed(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export type SupabaseBinding = {
  url: string;
  key: string;
  urlBinding: string;
  keyBinding: string;
  missing: string[];
};

export function resolveSupabaseBinding(): SupabaseBinding {
  const urlCandidates: Array<[string, string]> = [
    ['SUPABASE_URL', readTrimmed(process.env.SUPABASE_URL)],
    ['EXPO_PUBLIC_SUPABASE_URL', readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL)],
    ['IVX_SUPABASE_URL', readTrimmed(process.env.IVX_SUPABASE_URL)],
  ];
  const keyCandidates: Array<[string, string]> = [
    ['SUPABASE_SERVICE_ROLE_KEY', readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY)],
    ['SUPABASE_SERVICE_KEY', readTrimmed(process.env.SUPABASE_SERVICE_KEY)],
  ];
  const url = urlCandidates.find(([, v]) => v.startsWith('https://'));
  const key = keyCandidates.find(([, v]) => v.length > 20);
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!key) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  return {
    url: url ? url[1].replace(/\/+$/, '') : '',
    key: key ? key[1] : '',
    urlBinding: url ? url[0] : 'SUPABASE_URL(absent)',
    keyBinding: key ? key[0] : 'SUPABASE_SERVICE_ROLE_KEY(absent)',
    missing,
  };
}

export function persistenceConfigured(): boolean {
  return resolveSupabaseBinding().missing.length === 0;
}

// ── REST core with credential-binding diagnostics ────────────────────────────

export type SbResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  credentialBinding: string;
};

async function sbRequest<T>(
  path: string,
  init: { method?: string; body?: unknown; prefer?: string } = {},
  timeoutMs = 15000,
): Promise<SbResult<T>> {
  const binding = resolveSupabaseBinding();
  const credentialBinding = `${binding.urlBinding}+${binding.keyBinding}`;
  if (binding.missing.length > 0) {
    return { ok: false, status: 0, data: null, error: `Supabase not configured: missing ${binding.missing.join(', ')}`, credentialBinding };
  }
  try {
    const res = await fetch(`${binding.url}/rest/v1/${path}`, {
      method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
      headers: {
        apikey: binding.key,
        Authorization: `Bearer ${binding.key}`,
        'Content-Type': 'application/json',
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let parsed: T | null = null;
    try { parsed = text ? (JSON.parse(text) as T) : null; } catch { parsed = null; }
    // Only expose parsed data on success — error bodies (PostgREST error JSON)
    // must never masquerade as data rows.
    const data: T | null = res.ok ? parsed : null;
    if (res.status === 401 || res.status === 403) {
      // Requirement: log the exact runtime identity/credential binding used.
      console.error('[IVXAgentPersistence] AUTH FAILURE — runtime credential binding rejected', {
        httpStatus: res.status,
        credentialBinding,
        path: path.split('?')[0],
      });
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : `HTTP ${res.status}: ${text.slice(0, 240)}`,
      credentialBinding,
    };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err), credentialBinding };
  }
}

/** Deterministic UUID (sha256-derived, valid v5-style format) for dedup PKs. */
function uuidFromKey(key: string): string {
  const h = createHash('sha256').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function computeEvidenceSha(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

// ── Row types ────────────────────────────────────────────────────────────────

export type AgentStateRow = {
  agent_id: string;
  agent_number: number;
  agent_name: string;
  company: string;
  division: string;
  status: string;
  health: string;
  availability: string;
  last_heartbeat: string | null;
  last_successful_run: string | null;
  last_failed_run: string | null;
  last_task_id: string | null;
  last_tool_used: string | null;
  last_source_reference: string | null;
  last_evidence_sha: string | null;
  last_error: string | null;
  last_duration_ms: number;
  retry_count: number;
  total_cost_usd: number;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  updated_at: string;
};

export type ExecutionRow = {
  task_id: string;
  run_id: string;
  agent_id: string;
  agent_number: number;
  workflow: string;
  task_type: string;
  final_status: 'pending' | 'running' | 'completed' | 'failed' | 'blocked';
  real_tool_used: boolean;
  tools_used: string[];
  tool_result_id: string | null;
  source_reference: string | null;
  verified_output: boolean;
  evidence: Record<string, unknown> | null;
  evidence_sha256: string | null;
  output: Record<string, unknown> | null;
  cost_usage: Record<string, unknown>;
  error: string | null;
  retry_count: number;
  duration_ms: number;
  dedup_key: string | null;
  simulated: boolean;
  started_at: string | null;
  finished_at: string | null;
};

export type ProspectRow = {
  prospect_type: 'buyer' | 'investor' | 'tokenized_asset' | 'partner' | 'jv';
  dedup_key: string;
  name: string;
  source_url: string;
  source_tool: string;
  jurisdiction: string | null;
  score: number | null;
  score_breakdown: Record<string, unknown> | null;
  qualified: boolean;
  status: string;
  compliance_gate: string;
  agent_id: string;
  task_id: string | null;
  company_scope: string;
  data: Record<string, unknown> | null;
};

export type AlertRow = {
  alert_type: 'stale_heartbeat' | 'stuck_agent' | 'output_without_evidence' | 'prohibited_tool_attempt' | 'auth_failure' | 'agent_unhealthy';
  agent_id: string | null;
  severity: 'info' | 'warning' | 'critical';
  detail: string;
};

export type CertificateRow = {
  certificate_id: string;
  run_id: string;
  workflow: string;
  total_agents: number;
  healthy: number;
  real_execution_verified: number;
  evidence_verified: number;
  persistence_verified: boolean;
  simulated_runs: number;
  unique_agents: number;
  passed: boolean;
  commit_sha: string | null;
  runtime_version: string;
  policy_checks: Record<string, unknown>;
  e2e_tests: Record<string, unknown>;
  summary: Record<string, unknown>;
  certified_at?: string;
};

// ── Storage mode detection + dedicated-table bootstrap ───────────────────────

type StoreMode = 'dedicated' | 'jobs_fallback' | 'unavailable';

let cachedMode: StoreMode | null = null;
let lastEnsureDetail = 'not yet probed';

const REAL_EXECUTION_DDL = `
create table if not exists public.ivx_agent_states (
  agent_id text primary key,
  agent_number int not null unique,
  agent_name text not null,
  company text not null default 'ivx_holdings',
  division text not null default 'A',
  status text not null default 'active',
  health text not null default 'unknown',
  availability text not null default 'available',
  last_heartbeat timestamptz,
  last_successful_run timestamptz,
  last_failed_run timestamptz,
  last_task_id text,
  last_tool_used text,
  last_source_reference text,
  last_evidence_sha text,
  last_error text,
  last_duration_ms bigint not null default 0,
  retry_count int not null default 0,
  total_cost_usd numeric not null default 0,
  total_runs int not null default 0,
  successful_runs int not null default 0,
  failed_runs int not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.ivx_agent_executions (
  task_id text primary key,
  run_id text not null,
  agent_id text not null,
  agent_number int not null,
  workflow text not null default 'ivx-112-real-execution-certificate',
  task_type text not null,
  final_status text not null default 'pending',
  real_tool_used boolean not null default false,
  tools_used jsonb not null default '[]'::jsonb,
  tool_result_id text,
  source_reference text,
  verified_output boolean not null default false,
  evidence jsonb,
  evidence_sha256 text,
  output jsonb,
  cost_usage jsonb not null default '{"usd":0}'::jsonb,
  error text,
  retry_count int not null default 0,
  duration_ms bigint not null default 0,
  dedup_key text,
  simulated boolean not null default false,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_ivx_agent_exec_run on public.ivx_agent_executions(run_id);
create unique index if not exists uq_ivx_agent_exec_dedup on public.ivx_agent_executions(dedup_key) where dedup_key is not null;
create table if not exists public.ivx_crm_prospects (
  id uuid primary key default gen_random_uuid(),
  prospect_type text not null,
  dedup_key text not null,
  name text not null,
  source_url text not null,
  source_tool text not null,
  jurisdiction text,
  score int,
  score_breakdown jsonb,
  qualified boolean not null default false,
  status text not null default 'new',
  compliance_gate text not null default 'blocked_pending_approval',
  agent_id text not null,
  task_id text,
  company_scope text not null default 'ivx_holdings',
  data jsonb,
  created_at timestamptz not null default now(),
  constraint uq_ivx_prospect unique (prospect_type, dedup_key)
);
create table if not exists public.ivx_agent_alerts (
  id uuid primary key default gen_random_uuid(),
  alert_type text not null,
  agent_id text,
  severity text not null default 'warning',
  detail text,
  created_at timestamptz not null default now()
);
create table if not exists public.ivx_agent_certificates (
  certificate_id text primary key,
  run_id text not null,
  workflow text not null,
  total_agents int not null,
  healthy int not null,
  real_execution_verified int not null,
  evidence_verified int not null,
  persistence_verified boolean not null,
  simulated_runs int not null,
  unique_agents int not null,
  passed boolean not null,
  commit_sha text,
  runtime_version text,
  policy_checks jsonb,
  e2e_tests jsonb,
  summary jsonb,
  certified_at timestamptz not null default now()
);
alter table public.ivx_agent_states enable row level security;
alter table public.ivx_agent_executions enable row level security;
alter table public.ivx_crm_prospects enable row level security;
alter table public.ivx_agent_alerts enable row level security;
alter table public.ivx_agent_certificates enable row level security;
select pg_notify('pgrst','reload schema');
`;

function managementProjectRef(): string {
  for (const raw of [process.env.SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.IVX_SUPABASE_URL]) {
    const match = (raw ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (match?.[1]) return match[1];
  }
  return 'kvclcdjmjghndxsngfzb';
}

async function resolveManagementToken(): Promise<{ token: string; binding: string }> {
  const envToken = readTrimmed(process.env.SUPABASE_ACCESS_TOKEN) || readTrimmed(process.env.IVX_OWNER_SUPABASE_ACCESS_TOKEN);
  if (envToken) {
    return { token: envToken, binding: process.env.SUPABASE_ACCESS_TOKEN ? 'env:SUPABASE_ACCESS_TOKEN' : 'env:IVX_OWNER_SUPABASE_ACCESS_TOKEN' };
  }
  try {
    const { getIVXOwnerVariableRuntimeValue } = await import('../api/ivx-owner-variables');
    const stored = readTrimmed(await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN', { preferStored: true }));
    if (stored) return { token: stored, binding: 'owner_variables:SUPABASE_ACCESS_TOKEN' };
  } catch (err) {
    console.log('[IVXAgentPersistence] owner variables bridge unavailable for SUPABASE_ACCESS_TOKEN:', err instanceof Error ? err.message.slice(0, 140) : 'unknown');
  }
  return { token: '', binding: 'unavailable' };
}

async function tryDedicatedBootstrap(): Promise<{ ok: boolean; detail: string }> {
  const { token, binding } = await resolveManagementToken();
  if (!token) {
    return { ok: false, detail: 'SUPABASE_ACCESS_TOKEN unavailable in env and owner variables — dedicated DDL deferred' };
  }
  try {
    const res = await fetch(`https://api.supabase.com/v1/projects/${managementProjectRef()}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: REAL_EXECUTION_DDL }),
      signal: AbortSignal.timeout(45000),
    });
    if (res.status === 401 || res.status === 403) {
      console.error('[IVXAgentPersistence] AUTH FAILURE — management token binding rejected', { httpStatus: res.status, credentialBinding: binding });
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, detail: `DDL HTTP ${res.status} via ${binding}: ${text.slice(0, 160)}` };
    }
    for (let i = 0; i < 5; i++) {
      const verify = await sbRequest<unknown[]>('ivx_agent_states?select=agent_id&limit=1');
      if (verify.ok) return { ok: true, detail: `dedicated tables created via ${binding}` };
      await new Promise((r) => setTimeout(r, 2000));
    }
    return { ok: false, detail: 'DDL applied but REST schema not yet visible' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

async function resolveStoreMode(force = false): Promise<StoreMode> {
  if (cachedMode && cachedMode !== 'unavailable' && !force) return cachedMode;
  const dedicated = await sbRequest<unknown[]>('ivx_agent_states?select=agent_id&limit=1');
  if (dedicated.ok) {
    cachedMode = 'dedicated';
    lastEnsureDetail = 'dedicated tables active';
    return cachedMode;
  }
  const bootstrap = await tryDedicatedBootstrap();
  if (bootstrap.ok) {
    cachedMode = 'dedicated';
    lastEnsureDetail = bootstrap.detail;
    return cachedMode;
  }
  const jobs = await sbRequest<unknown[]>('ivx_agent_jobs?select=id&limit=1');
  if (jobs.ok) {
    cachedMode = 'jobs_fallback';
    lastEnsureDetail = `durable jobs-table store active (Supabase ivx_agent_jobs); ${bootstrap.detail}`;
    return cachedMode;
  }
  cachedMode = 'unavailable';
  lastEnsureDetail = `no durable store reachable: ${jobs.error ?? 'unknown'}`;
  return cachedMode;
}

/**
 * Ensure a durable Supabase store is available. Idempotent.
 * ok=true means execution state WILL persist in Supabase (never RAM-only).
 */
export async function ensureRealExecutionTables(): Promise<{ ok: boolean; created: boolean; detail: string }> {
  const mode = await resolveStoreMode();
  return { ok: mode !== 'unavailable', created: false, detail: `${mode}: ${lastEnsureDetail}` };
}

export function activeStoreMode(): string {
  return cachedMode ?? 'unprobed';
}

// ── jobs_fallback typed-document helpers ─────────────────────────────────────

type JobDoc = { id: string; type: string; status: string; payload: Record<string, unknown>; created_at: string; updated_at: string };

const JOB_STATUS_MAP: Record<ExecutionRow['final_status'], string> = {
  pending: 'queued',
  running: 'running',
  completed: 'completed',
  failed: 'failed',
  blocked: 'failed',
};

function jobRow(id: string, type: string, status: string, prompt: string, payload: Record<string, unknown>): Record<string, unknown> {
  return { id, type, status, prompt, payload, agent_name: String(payload.agent_id ?? payload.agentId ?? 'system'), created_by_email: 'system@ivx-real-execution' };
}

async function jobsSelect(filter: string, limit: number): Promise<SbResult<JobDoc[]>> {
  return sbRequest<JobDoc[]>(`ivx_agent_jobs?${filter}&select=id,type,status,payload,created_at,updated_at&limit=${limit}`);
}

// ── State persistence ────────────────────────────────────────────────────────

export async function upsertAgentStates(rows: Array<Partial<AgentStateRow> & { agent_id: string; agent_number: number; agent_name: string }>): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  const now = new Date().toISOString();
  if (mode === 'dedicated') {
    return sbRequest('ivx_agent_states?on_conflict=agent_id', {
      method: 'POST',
      body: rows.map((r) => ({ ...r, updated_at: now })),
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  if (mode === 'jobs_fallback') {
    const existing = await jobsSelect('type=eq.ivx_rec_state', 300);
    const byAgent = new Map<string, Record<string, unknown>>();
    for (const doc of existing.data ?? []) {
      const p = doc.payload ?? {};
      if (typeof p.agent_id === 'string') byAgent.set(p.agent_id, p);
    }
    const body = rows.map((r) => {
      const merged = { ...(byAgent.get(r.agent_id) ?? {}), ...r, updated_at: now };
      return jobRow(uuidFromKey(`ivx-state:${r.agent_id}`), 'ivx_rec_state', 'completed', `IVX agent state ${r.agent_id}`, merged);
    });
    return sbRequest('ivx_agent_jobs?on_conflict=id', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchAgentStates(): Promise<SbResult<AgentStateRow[]>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest<AgentStateRow[]>('ivx_agent_states?select=*&order=agent_number.asc&limit=200');
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect('type=eq.ivx_rec_state', 300);
    const rows = (res.data ?? [])
      .map((d) => d.payload as unknown as AgentStateRow)
      .filter((p) => typeof p.agent_id === 'string')
      .sort((a, b) => a.agent_number - b.agent_number);
    return { ...res, data: rows as AgentStateRow[] };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

// ── Execution persistence ────────────────────────────────────────────────────

function executionDefaults(row: Partial<ExecutionRow> & { task_id: string; run_id: string; agent_id: string; agent_number: number; task_type: string }): ExecutionRow {
  return {
    workflow: 'ivx-112-real-execution-certificate',
    final_status: 'pending',
    real_tool_used: false,
    tools_used: [],
    tool_result_id: null,
    source_reference: null,
    verified_output: false,
    evidence: null,
    evidence_sha256: null,
    output: null,
    cost_usage: { usd: 0 },
    error: null,
    retry_count: 0,
    duration_ms: 0,
    dedup_key: row.task_id,
    simulated: false,
    started_at: null,
    finished_at: null,
    ...row,
  };
}

export async function insertExecutions(rows: Array<Partial<ExecutionRow> & { task_id: string; run_id: string; agent_id: string; agent_number: number; task_type: string }>): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest('ivx_agent_executions?on_conflict=task_id', {
      method: 'POST',
      body: rows,
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  }
  if (mode === 'jobs_fallback') {
    const body = rows.map((r) => {
      const full = executionDefaults(r);
      return jobRow(uuidFromKey(`ivx-exec:${full.task_id}`), 'ivx_rec_execution', JOB_STATUS_MAP[full.final_status], `IVX real execution ${full.task_id}`, full as unknown as Record<string, unknown>);
    });
    return sbRequest('ivx_agent_jobs?on_conflict=id', { method: 'POST', body, prefer: 'resolution=ignore-duplicates,return=minimal' });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function updateExecution(taskId: string, patch: Partial<ExecutionRow>): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest(`ivx_agent_executions?task_id=eq.${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: patch,
      prefer: 'return=minimal',
    });
  }
  if (mode === 'jobs_fallback') {
    const id = uuidFromKey(`ivx-exec:${taskId}`);
    const current = await jobsSelect(`id=eq.${id}`, 1);
    const existing = current.data?.[0]?.payload ?? {};
    const merged = { ...existing, ...patch } as unknown as ExecutionRow;
    return sbRequest(`ivx_agent_jobs?id=eq.${id}`, {
      method: 'PATCH',
      body: { payload: merged, status: JOB_STATUS_MAP[merged.final_status] ?? 'running' },
      prefer: 'return=minimal',
    });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchExecutionsByRun(runId: string): Promise<SbResult<ExecutionRow[]>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest<ExecutionRow[]>(`ivx_agent_executions?run_id=eq.${encodeURIComponent(runId)}&select=*&order=agent_number.asc&limit=500`);
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect(`type=eq.ivx_rec_execution&payload->>run_id=eq.${encodeURIComponent(runId)}`, 500);
    const rows = (res.data ?? [])
      .map((d) => d.payload as unknown as ExecutionRow)
      .sort((a, b) => a.agent_number - b.agent_number);
    return { ...res, data: rows };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchPendingExecutions(limit = 200): Promise<SbResult<ExecutionRow[]>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest<ExecutionRow[]>(`ivx_agent_executions?final_status=in.(pending,running)&select=*&order=created_at.asc&limit=${limit}`);
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect('type=eq.ivx_rec_execution&status=in.(queued,running)', limit);
    const rows = (res.data ?? [])
      .map((d) => d.payload as unknown as ExecutionRow)
      .filter((p) => p.final_status === 'pending' || p.final_status === 'running');
    return { ...res, data: rows };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

// ── CRM prospect persistence (dedup + separation + compliance gates) ─────────

export async function insertProspects(rows: ProspectRow[]): Promise<SbResult<Array<{ id: string }>>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest<Array<{ id: string }>>('ivx_crm_prospects?on_conflict=prospect_type,dedup_key', {
      method: 'POST',
      body: rows,
      prefer: 'resolution=ignore-duplicates,return=representation',
    });
  }
  if (mode === 'jobs_fallback') {
    const body = rows.map((r) => {
      const id = uuidFromKey(`ivx-prospect:${r.prospect_type}:${r.dedup_key}`);
      return jobRow(id, 'ivx_rec_prospect', 'completed', `IVX CRM prospect ${r.prospect_type}: ${r.name}`.slice(0, 180), { ...r, id } as unknown as Record<string, unknown>);
    });
    const res = await sbRequest<Array<{ id: string }>>('ivx_agent_jobs?on_conflict=id', { method: 'POST', body, prefer: 'resolution=ignore-duplicates,return=representation' });
    return res;
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchProspects(type: ProspectRow['prospect_type'], limit = 50): Promise<SbResult<Array<ProspectRow & { id: string; created_at: string }>>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest(`ivx_crm_prospects?prospect_type=eq.${type}&select=*&order=created_at.desc&limit=${limit}`);
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect(`type=eq.ivx_rec_prospect&payload->>prospect_type=eq.${type}&order=created_at.desc`, limit);
    const rows = (res.data ?? []).map((d) => ({ ...(d.payload as unknown as ProspectRow), id: d.id, created_at: d.created_at }));
    return { ...res, data: rows };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function countProspects(type: ProspectRow['prospect_type'], dedupKey: string): Promise<number> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    const res = await sbRequest<Array<{ id: string }>>(`ivx_crm_prospects?prospect_type=eq.${type}&dedup_key=eq.${encodeURIComponent(dedupKey)}&select=id`);
    return res.ok && Array.isArray(res.data) ? res.data.length : -1;
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect(`type=eq.ivx_rec_prospect&payload->>prospect_type=eq.${type}&payload->>dedup_key=eq.${encodeURIComponent(dedupKey)}`, 10);
    return res.ok && Array.isArray(res.data) ? res.data.length : -1;
  }
  return -1;
}

export async function updateProspect(id: string, patch: Record<string, unknown>): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest(`ivx_crm_prospects?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, prefer: 'return=minimal' });
  }
  if (mode === 'jobs_fallback') {
    const current = await jobsSelect(`id=eq.${encodeURIComponent(id)}`, 1);
    const existing = current.data?.[0]?.payload ?? {};
    return sbRequest(`ivx_agent_jobs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { payload: { ...existing, ...patch } },
      prefer: 'return=minimal',
    });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

// ── Alerts ───────────────────────────────────────────────────────────────────

export async function insertAlert(alert: AlertRow): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest('ivx_agent_alerts', { method: 'POST', body: [alert], prefer: 'return=minimal' });
  }
  if (mode === 'jobs_fallback') {
    const id = uuidFromKey(`ivx-alert:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`);
    const body = [jobRow(id, 'ivx_rec_alert', 'completed', `IVX alert ${alert.alert_type}`.slice(0, 180), { ...alert, id } as unknown as Record<string, unknown>)];
    return sbRequest('ivx_agent_jobs', { method: 'POST', body, prefer: 'return=minimal' });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchRecentAlerts(limit = 50): Promise<SbResult<Array<AlertRow & { id: string; created_at: string }>>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest(`ivx_agent_alerts?select=*&order=created_at.desc&limit=${limit}`);
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect('type=eq.ivx_rec_alert&order=created_at.desc', limit);
    const rows = (res.data ?? []).map((d) => ({ ...(d.payload as unknown as AlertRow), id: d.id, created_at: d.created_at }));
    return { ...res, data: rows };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

// ── Certificates ─────────────────────────────────────────────────────────────

export async function insertCertificate(row: CertificateRow): Promise<SbResult<unknown>> {
  const mode = await resolveStoreMode();
  const certified = { ...row, certified_at: row.certified_at ?? new Date().toISOString() };
  if (mode === 'dedicated') {
    return sbRequest('ivx_agent_certificates?on_conflict=certificate_id', {
      method: 'POST',
      body: [certified],
      prefer: 'resolution=merge-duplicates,return=minimal',
    });
  }
  if (mode === 'jobs_fallback') {
    const body = [jobRow(uuidFromKey(`ivx-cert:${certified.certificate_id}`), 'ivx_rec_certificate', certified.passed ? 'completed' : 'failed', `IVX 112 Real Execution Certificate ${certified.certificate_id}`, certified as unknown as Record<string, unknown>)];
    return sbRequest('ivx_agent_jobs?on_conflict=id', { method: 'POST', body, prefer: 'resolution=merge-duplicates,return=minimal' });
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

export async function fetchLatestCertificate(): Promise<SbResult<CertificateRow[]>> {
  const mode = await resolveStoreMode();
  if (mode === 'dedicated') {
    return sbRequest<CertificateRow[]>('ivx_agent_certificates?select=*&order=certified_at.desc&limit=1');
  }
  if (mode === 'jobs_fallback') {
    const res = await jobsSelect('type=eq.ivx_rec_certificate&order=created_at.desc', 1);
    const rows = (res.data ?? []).map((d) => d.payload as unknown as CertificateRow);
    return { ...res, data: rows };
  }
  return { ok: false, status: 0, data: null, error: lastEnsureDetail, credentialBinding: 'none' };
}

// ── Heartbeat loop (persists lastHeartbeat for all 112 agents) ───────────────

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const HEARTBEAT_STALE_MS = 5 * 60_000;

let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the durable heartbeat loop. Every minute, all 112 agent states get a
 * fresh last_heartbeat in Supabase.
 */
export function startAgentHeartbeatLoop(
  buildRows: () => Array<Partial<AgentStateRow> & { agent_id: string; agent_number: number; agent_name: string }>,
): { started: boolean } {
  if (heartbeatTimer) return { started: false };
  const beat = async (): Promise<void> => {
    try {
      const ensure = await ensureRealExecutionTables();
      if (!ensure.ok) return;
      const now = new Date().toISOString();
      const rows = buildRows().map((r) => ({ ...r, last_heartbeat: now }));
      const res = await upsertAgentStates(rows);
      if (!res.ok) {
        console.error('[IVXAgentPersistence] heartbeat upsert failed', { status: res.status, credentialBinding: res.credentialBinding, error: res.error?.slice(0, 160) });
      }
    } catch (err) {
      console.error('[IVXAgentPersistence] heartbeat loop error', err instanceof Error ? err.message.slice(0, 160) : 'unknown');
    }
  };
  void beat();
  heartbeatTimer = setInterval(() => { void beat(); }, HEARTBEAT_INTERVAL_MS);
  heartbeatTimer.unref?.();
  return { started: true };
}

export function heartbeatLoopRunning(): boolean {
  return heartbeatTimer !== null;
}
