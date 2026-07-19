/**
 * IVX Senior Developer Worker — Proof Ledger and Approval Records.
 *
 * Append-only evidence store for autonomous senior developer runs.
 * Service-role writes from the worker; owner reads via RLS.
 */

export type IVXSeniorDevApprovalAction =
  | 'GITHUB_WRITE'
  | 'RENDER_DEPLOY'
  | 'DATABASE_MIGRATION'
  | 'SENSITIVE_OPERATION'
  | 'PRODUCTION_APPROVAL';

export type IVXSeniorDevApprovalRecord = {
  id: string;
  task_id: string;
  owner_id: string;
  action: IVXSeniorDevApprovalAction;
  scope: string | null;
  commit_sha: string | null;
  phrase: string;
  granted_at: string;
  expires_at: string | null;
  revoked_at: string | null;
};

export interface RecordApprovalInput {
  taskId: string;
  ownerId: string;
  action: IVXSeniorDevApprovalAction;
  phrase: string;
  scope?: string | null;
  commitSha?: string | null;
  expiresAt?: string | null;
}

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.IVX_SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const MANAGEMENT_API_BASE = 'https://api.supabase.com/v1';
const FALLBACK_PROJECT_REF = 'kvclcdjmjghndxsngfzb';

function managementProjectRef(): string {
  for (const raw of [process.env.IVX_SUPABASE_URL, process.env.EXPO_PUBLIC_SUPABASE_URL, process.env.SUPABASE_URL]) {
    const match = (raw ?? '').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
    if (match) return match[1] ?? '';
  }
  return FALLBACK_PROJECT_REF;
}

/** DDL for the 3 senior-dev worker tables + ivx_owner_ai_tasks column extensions. */
const SENIOR_DEV_DDL = `
ALTER TABLE IF EXISTS public.ivx_owner_ai_tasks
  ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS assigned_worker_id TEXT,
  ADD COLUMN IF NOT EXISTS approval_url TEXT,
  ADD COLUMN IF NOT EXISTS worker_data JSONB DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS files_changed TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS test_summary JSONB,
  ADD COLUMN IF NOT EXISTS commit_sha TEXT,
  ADD COLUMN IF NOT EXISTS render_deploy_id TEXT,
  ADD COLUMN IF NOT EXISTS runtime_sha TEXT,
  ADD COLUMN IF NOT EXISTS proof_ledger_id TEXT,
  ADD COLUMN IF NOT EXISTS resume_required BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS resume_phase TEXT,
  ADD COLUMN IF NOT EXISTS last_safe_checkpoint TEXT,
  ADD COLUMN IF NOT EXISTS pre_deploy_runtime_sha TEXT,
  ADD COLUMN IF NOT EXISTS expected_runtime_sha TEXT,
  ADD COLUMN IF NOT EXISTS deployment_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deployment_attempt INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS deployment_service_id TEXT,
  ADD COLUMN IF NOT EXISTS deployment_trigger_request_id TEXT,
  ADD COLUMN IF NOT EXISTS recovery_lease_owner TEXT,
  ADD COLUMN IF NOT EXISTS recovery_lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS recovery_attempt INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS recovery_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS task_version INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS base_sha TEXT,
  ADD COLUMN IF NOT EXISTS branch TEXT,
  ADD COLUMN IF NOT EXISTS owner_approval_id TEXT;
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_task_type_status
  ON public.ivx_owner_ai_tasks (task_type, status) WHERE task_type = 'senior_dev';
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_assigned_worker
  ON public.ivx_owner_ai_tasks (assigned_worker_id, status) WHERE assigned_worker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ivx_owner_ai_tasks_resume
  ON public.ivx_owner_ai_tasks (resume_required, status) WHERE resume_required = true;
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_worker_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL DEFAULT 'IVX-SENIOR-DEV-01',
  repository TEXT, branch TEXT, base_commit_sha TEXT,
  files_inspected TEXT[] DEFAULT '{}', files_changed TEXT[] DEFAULT '{}',
  test_results JSONB DEFAULT '{}', lint_results JSONB DEFAULT '{}',
  typecheck_results JSONB DEFAULT '{}', build_results JSONB DEFAULT '{}',
  commit_sha TEXT, rollback_tag TEXT, render_deploy_id TEXT, runtime_sha TEXT,
  health_results JSONB DEFAULT '{}', live_feature_result JSONB DEFAULT '{}',
  proof_ledger_id TEXT, error_message TEXT, logs TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'running',
  recovery_lease_event JSONB DEFAULT '{}',
  worker_restart_event JSONB DEFAULT '{}',
  parity_result JSONB DEFAULT '{}',
  deploy_http_response JSONB DEFAULT '{}',
  final_status TEXT, final_timestamp TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_worker_runs_task_id
  ON public.ivx_senior_dev_worker_runs (task_id);
CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_worker_runs_worker_status
  ON public.ivx_senior_dev_worker_runs (worker_id, status);
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  worker_id TEXT NOT NULL, checkpoint TEXT NOT NULL, metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_checkpoints_task_id
  ON public.ivx_senior_dev_checkpoints (task_id, created_at DESC);
CREATE TABLE IF NOT EXISTS public.ivx_senior_dev_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES public.ivx_owner_ai_tasks(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL, action TEXT NOT NULL, scope TEXT, commit_sha TEXT,
  phrase TEXT NOT NULL, granted_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_ivx_senior_dev_approvals_task_action
  ON public.ivx_senior_dev_approvals (task_id, action);
ALTER TABLE public.ivx_senior_dev_worker_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_senior_dev_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ivx_senior_dev_approvals ENABLE ROW LEVEL SECURITY;
`;

let seniorDevTablesEnsured = false;

/**
 * Self-bootstrap the senior dev worker tables via the Supabase Management API
 * (same proven pattern as ensureTaskTable in ivx-owner-ai-task-queue.ts).
 * Idempotent; non-fatal when SUPABASE_ACCESS_TOKEN is absent.
 */
export async function ensureSeniorDevTables(): Promise<boolean> {
  if (seniorDevTablesEnsured) return true;
  const token = (process.env.SUPABASE_ACCESS_TOKEN ?? '').trim();
  if (!token) {
    console.log('[IVXSeniorDevProof] self-bootstrap DDL skipped — SUPABASE_ACCESS_TOKEN absent');
    return false;
  }
  try {
    const res = await fetch(`${MANAGEMENT_API_BASE}/projects/${managementProjectRef()}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: SENIOR_DEV_DDL }),
      signal: AbortSignal.timeout(30_000),
    });
    console.log('[IVXSeniorDevProof] self-bootstrap DDL result', { httpStatus: res.status });
    seniorDevTablesEnsured = res.ok || res.status === 201;
    return seniorDevTablesEnsured;
  } catch (error) {
    console.log('[IVXSeniorDevProof] self-bootstrap DDL failed:', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}

function restHeaders(): Record<string, string> {
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function restFetch(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { ...restHeaders(), ...(init.headers ?? {}) } });
}

export async function recordApproval(input: RecordApprovalInput): Promise<IVXSeniorDevApprovalRecord | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const row = {
    task_id: input.taskId,
    owner_id: input.ownerId,
    action: input.action,
    scope: input.scope ?? null,
    commit_sha: input.commitSha ?? null,
    phrase: input.phrase,
    expires_at: input.expiresAt ?? null,
  };
  const res = await restFetch('ivx_senior_dev_approvals', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []) as IVXSeniorDevApprovalRecord[];
  return rows[0] ?? null;
}

export async function hasApproval(taskId: string, action: IVXSeniorDevApprovalAction): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  const res = await restFetch(`ivx_senior_dev_approvals?task_id=eq.${encodeURIComponent(taskId)}&action=eq.${action}&revoked_at=is.null&expires_at=gte.${encodeURIComponent(new Date().toISOString())}&limit=1`, {
    method: 'GET',
  });
  if (!res.ok) return false;
  const rows = await res.json().catch(() => []) as IVXSeniorDevApprovalRecord[];
  return rows.length > 0;
}

export interface ProofLedgerInput {
  taskId: string;
  workerId: string;
  repository?: string;
  branch?: string;
  baseCommitSha?: string;
  filesInspected?: string[];
  filesChanged?: string[];
  testResults?: Record<string, unknown>;
  lintResults?: Record<string, unknown>;
  typecheckResults?: Record<string, unknown>;
  buildResults?: Record<string, unknown>;
  commitSha?: string;
  rollbackTag?: string;
  renderDeployId?: string;
  runtimeSha?: string;
  healthResults?: Record<string, unknown>;
  liveFeatureResult?: Record<string, unknown>;
  status?: string;
  errorMessage?: string;
  logs?: string[];
}

export type IVXSeniorDevWorkerRun = {
  id: string;
  task_id: string;
  worker_id: string;
  status: string;
  commit_sha: string | null;
  render_deploy_id: string | null;
  runtime_sha: string | null;
  proof_ledger_id: string | null;
};

export async function writeProofLedger(input: ProofLedgerInput): Promise<IVXSeniorDevWorkerRun | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const row = {
    task_id: input.taskId,
    worker_id: input.workerId,
    repository: input.repository ?? null,
    branch: input.branch ?? null,
    base_commit_sha: input.baseCommitSha ?? null,
    files_inspected: input.filesInspected ?? [],
    files_changed: input.filesChanged ?? [],
    test_results: input.testResults ?? {},
    lint_results: input.lintResults ?? {},
    typecheck_results: input.typecheckResults ?? {},
    build_results: input.buildResults ?? {},
    commit_sha: input.commitSha ?? null,
    rollback_tag: input.rollbackTag ?? null,
    render_deploy_id: input.renderDeployId ?? null,
    runtime_sha: input.runtimeSha ?? null,
    health_results: input.healthResults ?? {},
    live_feature_result: input.liveFeatureResult ?? {},
    status: input.status ?? 'running',
    error_message: input.errorMessage ?? null,
    logs: input.logs ?? [],
  };
  const res = await restFetch('ivx_senior_dev_worker_runs', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    console.log('[IVXSeniorDevProof] writeProofLedger failed', { status: res.status, taskId: input.taskId });
    return null;
  }
  const rows = await res.json().catch(() => []) as IVXSeniorDevWorkerRun[];
  return rows[0] ?? null;
}

export async function updateProofLedger(runId: string, patch: Partial<ProofLedgerInput>): Promise<IVXSeniorDevWorkerRun | null> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  const res = await restFetch(`ivx_senior_dev_worker_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...patch,
      updated_at: new Date().toISOString(),
    }),
  });
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []) as IVXSeniorDevWorkerRun[];
  return rows[0] ?? null;
}

// ─── Self-Deploy Recovery Lease ───────────────────────────────────────────
// Optimistic-lock claim that prevents two runtimes from resuming the same
// self-deploying task after a restart. Uses task_version as a monotonic guard:
// the PATCH only matches if the row's current task_version equals the value
// the caller read, so a competing claim shows 0 rows updated.

export interface RecoveryLeaseInput {
  taskId: string;
  workerId: string;
  expectedTaskVersion: number;
  leaseDurationMs: number;
  idempotencyKey: string;
  recoveryAttempt: number;
}

export interface RecoveryLeaseResult {
  claimed: boolean;
  taskVersion: number | null;
  leaseExpiresAt: string | null;
  reason: string;
}

export async function claimRecoveryLease(input: RecoveryLeaseInput): Promise<RecoveryLeaseResult> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return { claimed: false, taskVersion: null, leaseExpiresAt: null, reason: 'supabase_not_configured' };
  }
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString();
  const newVersion = input.expectedTaskVersion + 1;
  // Only claim if either no active lease, or the existing lease already
  // expired, AND the row's task_version matches our read (optimistic lock).
  const filter = `&id=eq.${encodeURIComponent(input.taskId)}`
    + `&task_version=eq.${input.expectedTaskVersion}`
    + `&or=(recovery_lease_owner.is.null,recovery_lease_expires_at.lt.${encodeURIComponent(now.toISOString())})`;
  const res = await restFetch(`ivx_owner_ai_tasks?${filter}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      recovery_lease_owner: input.workerId,
      recovery_lease_expires_at: expiresAt,
      recovery_idempotency_key: input.idempotencyKey,
      recovery_attempt: input.recoveryAttempt,
      task_version: newVersion,
      heartbeat_at: now.toISOString(),
      updated_at: now.toISOString(),
    }),
  });
  if (!res.ok) {
    return { claimed: false, taskVersion: null, leaseExpiresAt: null, reason: `http_${res.status}` };
  }
  const rows = await res.json().catch(() => []) as { task_version?: number; recovery_lease_expires_at?: string }[];
  if (!rows[0]) {
    return { claimed: false, taskVersion: null, leaseExpiresAt: null, reason: 'optimistic_lock_contention' };
  }
  return {
    claimed: true,
    taskVersion: (rows[0].task_version as number | undefined) ?? newVersion,
    leaseExpiresAt: (rows[0].recovery_lease_expires_at as string | undefined) ?? expiresAt,
    reason: 'claimed',
  };
}

export async function releaseRecoveryLease(taskId: string, workerId: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return false;
  const res = await restFetch(
    `ivx_owner_ai_tasks?id=eq.${encodeURIComponent(taskId)}&recovery_lease_owner=eq.${encodeURIComponent(workerId)}`,
    {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        recovery_lease_owner: null,
        recovery_lease_expires_at: null,
        resume_required: false,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  return res.ok;
}
