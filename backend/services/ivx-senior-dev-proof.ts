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

const SUPABASE_URL = (process.env.SUPABASE_URL ?? process.env.IVX_SUPABASE_URL ?? '').replace(/\/$/, '');
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

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
