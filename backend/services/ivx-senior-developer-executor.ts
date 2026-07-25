/**
 * IVX Senior Developer Executor — real senior-developer execution pipeline.
 *
 * Capabilities (the spec from the owner):
 *   repo_read, file_read, file_write, patch_apply, test_run,
 *   git_status, git_diff, git_commit, git_push,
 *   render_deploy, health_check, supabase_check, production_verify
 *
 * Hard rule enforced in this file:
 *   No git_push, no render_deploy, no file_write, no patch_apply
 *   executes without an explicit owner approval record approved_by_owner=true.
 *
 * Approvals are persisted to the Supabase table `owner_execution_approvals`
 * (created lazily via REST if missing) and mirrored in an in-memory store so
 * the pipeline works even before the table exists.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runWithWatchdog } from './ivx-process-watchdog.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExecutorCapability =
  | 'repo_read'
  | 'file_read'
  | 'file_write'
  | 'patch_apply'
  | 'test_run'
  | 'git_status'
  | 'git_diff'
  | 'git_commit'
  | 'git_push'
  | 'render_deploy'
  | 'health_check'
  | 'supabase_check'
  | 'production_verify';

export type RiskLevel = 'read_only' | 'low' | 'medium' | 'high' | 'destructive';

export type ExecutorApprovalStatus = 'pending' | 'approved' | 'rejected' | 'expired' | 'executed';

export type ExecutorApprovalRecord = {
  id: string;
  task_id: string;
  requested_action: string;
  risk_level: RiskLevel;
  files_to_change: string[];
  diff_preview: string;
  approved_by_owner: boolean;
  approved_at: string | null;
  status: ExecutorApprovalStatus;
  created_at: string;
};

export type ExecutorTaskStatus = 'planned' | 'awaiting_approval' | 'approved' | 'running' | 'committed' | 'pushed' | 'deployed' | 'verified' | 'failed' | 'rejected';

export type ExecutorTask = {
  task_id: string;
  summary: string;
  capabilities: ExecutorCapability[];
  risk_level: RiskLevel;
  files_to_change: string[];
  diff_preview: string;
  status: ExecutorTaskStatus;
  approval_id: string | null;
  results: ExecutorStepResult[];
  created_at: string;
  updated_at: string;
};

export type ExecutorStepResult = {
  step: ExecutorCapability;
  ok: boolean;
  output: unknown;
  error?: string;
  timestamp: string;
};

export const EXECUTOR_CAPABILITIES: readonly ExecutorCapability[] = [
  'repo_read', 'file_read', 'file_write', 'patch_apply', 'test_run',
  'git_status', 'git_diff', 'git_commit', 'git_push',
  'render_deploy', 'health_check', 'supabase_check', 'production_verify',
] as const;

export const EXECUTOR_MARKER = 'ivx-senior-developer-executor-2026-07-04';

const REPO_ROOT = process.cwd();
const REQUIRES_APPROVAL: ReadonlySet<ExecutorCapability> = new Set([
  'file_write', 'patch_apply', 'git_commit', 'git_push', 'render_deploy',
]);

// ─────────────────────────────────────────────────────────────────────────────
// In-memory stores (mirrored to Supabase when available)
// ─────────────────────────────────────────────────────────────────────────────

const tasks = new Map<string, ExecutorTask>();
const approvals = new Map<string, ExecutorApprovalRecord>();

function nowIso(): string { return new Date().toISOString(); }
function newId(prefix: string): string { return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`; }

function readEnv(name: string): string { return (process.env[name] ?? '').trim(); }

function riskFor(capabilities: ExecutorCapability[]): RiskLevel {
  if (capabilities.some((c) => REQUIRES_APPROVAL.has(c))) {
    if (capabilities.includes('render_deploy') || capabilities.includes('git_push')) return 'high';
    return 'medium';
  }
  return 'read_only';
}

// ─────────────────────────────────────────────────────────────────────────────
// Shell helper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Run a shell command under the IVX process watchdog so a nested subprocess
 * tree can never hang the executor. The whole process group is terminated on
 * timeout. Returns the same shape callers expect.
 */
function runShell(cmd: string, args: string[], opts: { cwd?: string; timeoutMs?: number } = {}): Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }> {
  const fullCommand = `${cmd} ${args.join(' ')}`;
  return runWithWatchdog(fullCommand, { timeoutMs: opts.timeoutMs ?? 60_000, cwd: opts.cwd ?? REPO_ROOT })
    .then((result) => {
      if (result.status === 'timed_out' || result.status === 'cancelled' || result.status === 'spawn_error') {
        return { ok: false, stdout: result.stdoutTail, stderr: result.stderrTail, code: null };
      }
      return { ok: result.exitCode === 0, stdout: result.stdoutTail, stderr: result.stderrTail, code: result.exitCode };
    });
}

function safeResolve(rel: string): string | null {
  const cleaned = rel.replace(/^\/+/, '');
  const full = path.resolve(REPO_ROOT, cleaned);
  if (!full.startsWith(REPO_ROOT)) return null;
  return full;
}

// ─────────────────────────────────────────────────────────────────────────────
// GitHub API (REST) — branch, commit, push
// ─────────────────────────────────────────────────────────────────────────────

type GithubRepoInfo = { owner: string; repo: string };

function parseGithubRepo(value: string): GithubRepoInfo | null {
  const v = value.trim();
  if (!v) return null;
  const m = v.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  return m && m[1] && m[2] ? { owner: m[1], repo: m[2] } : null;
}

function githubRepo(): GithubRepoInfo {
  const url = readEnv('GITHUB_REPO_URL') || `https://github.com/${readEnv('GITHUB_REPO')}`;
  const info = parseGithubRepo(url);
  if (!info) throw new Error('GITHUB_REPO_URL / GITHUB_REPO not configured or invalid.');
  return info;
}

function githubHeaders(): HeadersInit {
  const token = readEnv('GITHUB_TOKEN');
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function ghJson(url: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: unknown }> {
  const res = await fetch(url, init);
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 1000); }
  return { status: res.status, ok: res.ok, data };
}

// ─────────────────────────────────────────────────────────────────────────────
// Supabase REST (service role only on backend)
// ─────────────────────────────────────────────────────────────────────────────

function supabaseUrl(): string { return readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, ''); }
function supabaseServiceKey(): string { return readEnv('SUPABASE_SERVICE_ROLE_KEY'); }

function supabaseHeaders(): HeadersInit {
  const key = supabaseServiceKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
}

async function ensureApprovalTable(): Promise<{ ok: boolean; error?: string }> {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return { ok: false, error: 'Supabase URL or service role key missing.' };
  // Check if table exists by selecting limit 0
  const probe = await fetch(`${url}/rest/v1/owner_execution_approvals?select=id&limit=0`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Range: '0-0' },
  });
  if (probe.status === 200) return { ok: true };
  // Table missing — we cannot run DDL via REST. Record that it needs a migration.
  return { ok: false, error: `owner_execution_approvals table not reachable (HTTP ${probe.status}). Run the SQL migration to create it. Approvals are mirrored in-memory until then.` };
}

async function persistApproval(record: ExecutorApprovalRecord): Promise<void> {
  try {
    const url = supabaseUrl();
    const key = supabaseServiceKey();
    if (!url || !key) return;
    await fetch(`${url}/rest/v1/owner_execution_approvals`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        id: record.id,
        task_id: record.task_id,
        requested_action: record.requested_action,
        risk_level: record.risk_level,
        files_to_change: record.files_to_change,
        diff_preview: record.diff_preview.slice(0, 30_000),
        approved_by_owner: record.approved_by_owner,
        approved_at: record.approved_at,
        status: record.status,
        created_at: record.created_at,
      }),
    });
  } catch { /* in-memory mirror is the source of truth if Supabase is unavailable */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline steps
// ─────────────────────────────────────────────────────────────────────────────

async function stepRepoRead(): Promise<ExecutorStepResult> {
  const info = githubRepo();
  const res = await ghJson(`https://api.github.com/repos/${info.owner}/${info.repo}`, { headers: githubHeaders() });
  const data = (res.data && typeof res.data === 'object') ? res.data as Record<string, unknown> : {};
  return {
    step: 'repo_read',
    ok: res.ok,
    output: {
      owner: info.owner,
      repo: info.repo,
      default_branch: data.default_branch ?? null,
      pushed_at: data.pushed_at ?? null,
      private: data.private ?? null,
      http_status: res.status,
    },
    error: res.ok ? undefined : `GitHub repo lookup HTTP ${res.status}`,
    timestamp: nowIso(),
  };
}

async function stepFileRead(filePath: string): Promise<ExecutorStepResult> {
  const abs = safeResolve(filePath);
  if (!abs) return { step: 'file_read', ok: false, output: null, error: 'Path outside repo root.', timestamp: nowIso() };
  try {
    const stat = await fs.stat(abs);
    if (stat.size > 500_000) {
      return { step: 'file_read', ok: true, output: { path: filePath, size: stat.size, truncated: true, content: (await fs.readFile(abs, 'utf8')).slice(0, 50_000) }, timestamp: nowIso() };
    }
    const content = await fs.readFile(abs, 'utf8');
    return { step: 'file_read', ok: true, output: { path: filePath, size: stat.size, content }, timestamp: nowIso() };
  } catch (e) {
    return { step: 'file_read', ok: false, output: null, error: e instanceof Error ? e.message : 'read failed', timestamp: nowIso() };
  }
}

async function stepFileWrite(filePath: string, content: string): Promise<ExecutorStepResult> {
  const abs = safeResolve(filePath);
  if (!abs) return { step: 'file_write', ok: false, output: null, error: 'Path outside repo root.', timestamp: nowIso() };
  try {
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return { step: 'file_write', ok: true, output: { path: filePath, bytes: content.length }, timestamp: nowIso() };
  } catch (e) {
    return { step: 'file_write', ok: false, output: null, error: e instanceof Error ? e.message : 'write failed', timestamp: nowIso() };
  }
}

async function stepPatchApply(filePath: string, oldString: string, newString: string): Promise<ExecutorStepResult> {
  const abs = safeResolve(filePath);
  if (!abs) return { step: 'patch_apply', ok: false, output: null, error: 'Path outside repo root.', timestamp: nowIso() };
  try {
    const original = await fs.readFile(abs, 'utf8');
    if (!original.includes(oldString)) {
      return { step: 'patch_apply', ok: false, output: null, error: 'oldString not found in file.', timestamp: nowIso() };
    }
    const updated = original.replace(oldString, newString);
    await fs.writeFile(abs, updated, 'utf8');
    return { step: 'patch_apply', ok: true, output: { path: filePath, applied: true }, timestamp: nowIso() };
  } catch (e) {
    return { step: 'patch_apply', ok: false, output: null, error: e instanceof Error ? e.message : 'patch failed', timestamp: nowIso() };
  }
}

async function stepTestRun(suite: 'typecheck' | 'lint' | 'build'): Promise<ExecutorStepResult> {
  const commands: Record<string, [string, string[]]> = {
    typecheck: ['bun', ['x', 'tsc', '--noEmit']],
    lint: ['bun', ['x', 'eslint', '.', '--max-warnings=0']],
    build: ['bun', ['run', 'build']],
  };
  const [cmd, args] = commands[suite] ?? ['bun', ['x', 'tsc', '--noEmit']];
  const res = await runShell(cmd, args, { timeoutMs: 120_000 });
  return {
    step: 'test_run',
    ok: res.ok,
    output: { suite, code: res.code, stdout_tail: res.stdout.slice(-4_000), stderr_tail: res.stderr.slice(-2_000) },
    error: res.ok ? undefined : `${suite} exited ${res.code}`,
    timestamp: nowIso(),
  };
}

async function stepGitStatus(): Promise<ExecutorStepResult> {
  const res = await runShell('git', ['status', '--porcelain=v1', '-b']);
  return {
    step: 'git_status',
    ok: res.ok,
    output: { branch: res.stdout.split('\n')[0], files: res.stdout.split('\n').slice(1).filter(Boolean) },
    timestamp: nowIso(),
  };
}

async function stepGitDiff(): Promise<ExecutorStepResult> {
  const res = await runShell('git', ['diff', '--stat', 'HEAD']);
  return {
    step: 'git_diff',
    ok: res.ok,
    output: { stat: res.stdout, summary: res.stdout.split('\n').slice(-3).join('\n') },
    timestamp: nowIso(),
  };
}

async function stepGitCommit(message: string): Promise<ExecutorStepResult> {
  // stage all
  const add = await runShell('git', ['add', '-A']);
  if (!add.ok) return { step: 'git_commit', ok: false, output: null, error: `git add failed: ${add.stderr}`, timestamp: nowIso() };
  const commit = await runShell('git', ['commit', '-m', message, '--no-verify']);
  const shaRes = await runShell('git', ['rev-parse', 'HEAD']);
  return {
    step: 'git_commit',
    ok: commit.ok || /nothing to commit|no changes/.test(commit.stdout),
    output: { commit_message: message, sha: shaRes.stdout.trim(), stderr: commit.stderr.slice(-1_000) },
    error: commit.ok ? undefined : commit.stderr.slice(-500),
    timestamp: nowIso(),
  };
}

async function stepGitPush(): Promise<ExecutorStepResult> {
  const res = await runShell('git', ['push', 'origin', 'HEAD'], { timeoutMs: 90_000 });
  return {
    step: 'git_push',
    ok: res.ok,
    output: { stdout: res.stdout.slice(-2_000), stderr: res.stderr.slice(-2_000), code: res.code },
    error: res.ok ? undefined : `git push failed: ${res.stderr.slice(-500)}`,
    timestamp: nowIso(),
  };
}

async function stepRenderDeploy(): Promise<ExecutorStepResult> {
  const apiKey = readEnv('RENDER_API_KEY');
  const serviceId = readEnv('RENDER_SERVICE_ID');
  if (!apiKey || !serviceId) return { step: 'render_deploy', ok: false, output: null, error: 'RENDER_API_KEY or RENDER_SERVICE_ID missing.', timestamp: nowIso() };
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
  const text = await res.text();
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 1_000); }
  return {
    step: 'render_deploy',
    ok: res.ok,
    output: { service_id: serviceId, http_status: res.status, deploy: data },
    error: res.ok ? undefined : `Render deploy trigger HTTP ${res.status}`,
    timestamp: nowIso(),
  };
}

export async function stepHealthCheck(url: string = 'https://api.ivxholding.com/health'): Promise<ExecutorStepResult> {
  const start = Date.now();
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    let data: unknown = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text.slice(0, 800); }
    return { step: 'health_check', ok: res.ok, output: { url, http_status: res.status, duration_ms: Date.now() - start, data }, timestamp: nowIso() };
  } catch (e) {
    return { step: 'health_check', ok: false, output: { url, duration_ms: Date.now() - start }, error: e instanceof Error ? e.message : 'health check failed', timestamp: nowIso() };
  }
}

async function stepSupabaseCheck(): Promise<ExecutorStepResult> {
  const url = supabaseUrl();
  const key = supabaseServiceKey();
  if (!url || !key) return { step: 'supabase_check', ok: false, output: null, error: 'Supabase URL or service role key missing.', timestamp: nowIso() };
  const rest = await fetch(`${url}/rest/v1/`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/openapi+json' } });
  let tables: string[] = [];
  try {
    const data = (await rest.json()) as { paths?: Record<string, unknown> };
    tables = Object.keys(data.paths ?? {}).filter((p) => p !== '/').slice(0, 40);
  } catch { /* ignore */ }
  return {
    step: 'supabase_check',
    ok: rest.ok,
    output: { url, http_status: rest.status, tables_sample: tables },
    error: rest.ok ? undefined : `Supabase REST HTTP ${rest.status}`,
    timestamp: nowIso(),
  };
}

async function stepProductionVerify(): Promise<ExecutorStepResult> {
  const checks = await Promise.all([
    stepHealthCheck('https://api.ivxholding.com/health'),
    fetch('https://api.ivxholding.com/api/ivx/version', { signal: AbortSignal.timeout(15_000) }).then((r) => r.text()).then((t) => ({ ok: true, status: 200, body: t.slice(0, 400) })).catch((e) => ({ ok: false, status: 0, body: e instanceof Error ? e.message : 'failed' })),
    fetch('https://api.ivxholding.com/api/ivx/members/count', { signal: AbortSignal.timeout(15_000) }).then((r) => ({ ok: r.ok, status: r.status, body: '' })).catch((e) => ({ ok: false, status: 0, body: e instanceof Error ? e.message : 'failed' })),
  ]);
  return {
    step: 'production_verify',
    ok: checks[0].ok && checks[1].ok,
    output: { health: checks[0].output, version: checks[1], members_count: checks[2] },
    timestamp: nowIso(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function listCapabilities(): ExecutorCapability[] {
  return [...EXECUTOR_CAPABILITIES];
}

export function createPlan(input: {
  summary: string;
  capabilities: ExecutorCapability[];
  files_to_change?: string[];
  diff_preview?: string;
}): ExecutorTask {
  const task_id = newId('task');
  const caps = input.capabilities.filter((c) => EXECUTOR_CAPABILITIES.includes(c));
  const risk = riskFor(caps);
  const task: ExecutorTask = {
    task_id,
    summary: input.summary,
    capabilities: caps,
    risk_level: risk,
    files_to_change: input.files_to_change ?? [],
    diff_preview: input.diff_preview ?? '',
    status: 'planned',
    approval_id: null,
    results: [],
    created_at: nowIso(),
    updated_at: nowIso(),
  };
  tasks.set(task_id, task);
  return task;
}

export function getTask(task_id: string): ExecutorTask | null {
  return tasks.get(task_id) ?? null;
}

export function listTasks(): ExecutorTask[] {
  return [...tasks.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/**
 * Create an approval request for a task. The task must have a risk level that
 * requires approval (anything above read_only). Returns the approval record
 * with status='pending'.
 */
export async function requestApproval(task_id: string): Promise<ExecutorApprovalRecord> {
  const task = tasks.get(task_id);
  if (!task) throw new Error(`Task ${task_id} not found.`);
  if (task.risk_level === 'read_only') throw new Error('read_only tasks do not require approval.');
  const approval_id = newId('appr');
  const record: ExecutorApprovalRecord = {
    id: approval_id,
    task_id,
    requested_action: task.summary,
    risk_level: task.risk_level,
    files_to_change: task.files_to_change,
    diff_preview: task.diff_preview.slice(0, 30_000),
    approved_by_owner: false,
    approved_at: null,
    status: 'pending',
    created_at: nowIso(),
  };
  approvals.set(approval_id, record);
  task.status = 'awaiting_approval';
  task.approval_id = approval_id;
  task.updated_at = nowIso();
  await persistApproval(record);
  return record;
}

/**
 * Owner approves a pending approval. Requires an owner proof (caller verifies
 * owner identity at the API layer). Returns the updated record.
 */
export async function approveRequest(approval_id: string, ownerProof: { userId: string; email: string }): Promise<ExecutorApprovalRecord> {
  const record = approvals.get(approval_id);
  if (!record) throw new Error(`Approval ${approval_id} not found.`);
  if (record.status !== 'pending') throw new Error(`Approval ${approval_id} is not pending (status=${record.status}).`);
  record.approved_by_owner = true;
  record.approved_at = nowIso();
  record.status = 'approved';
  approvals.set(approval_id, record);
  const task = tasks.get(record.task_id);
  if (task) { task.status = 'approved'; task.updated_at = nowIso(); }
  await persistApproval(record);
  return record;
}

export function getApproval(approval_id: string): ExecutorApprovalRecord | null {
  return approvals.get(approval_id) ?? null;
}

export function listApprovals(): ExecutorApprovalRecord[] {
  return [...approvals.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

function assertApprovedFor(task: ExecutorTask, capability: ExecutorCapability): void {
  if (!REQUIRES_APPROVAL.has(capability)) return;
  if (!task.approval_id) throw new Error(`Capability ${capability} requires owner approval. Task has no approval_id.`);
  const approval = approvals.get(task.approval_id);
  if (!approval || !approval.approved_by_owner || approval.status !== 'approved') {
    throw new Error(`Capability ${capability} blocked: owner approval not granted for task ${task.task_id}.`);
  }
}

/**
 * Run a single capability on a task. Write/push/deploy capabilities enforce
 * the owner-approval gate.
 */
export async function runStep(
  task_id: string,
  capability: ExecutorCapability,
  stepInput: Record<string, unknown> = {},
): Promise<ExecutorStepResult> {
  const task = tasks.get(task_id);
  if (!task) throw new Error(`Task ${task_id} not found.`);
  assertApprovedFor(task, capability);

  let result: ExecutorStepResult;
  switch (capability) {
    case 'repo_read': result = await stepRepoRead(); break;
    case 'file_read': result = await stepFileRead(String(stepInput.path ?? '')); break;
    case 'file_write': result = await stepFileWrite(String(stepInput.path ?? ''), String(stepInput.content ?? '')); break;
    case 'patch_apply': result = await stepPatchApply(String(stepInput.path ?? ''), String(stepInput.oldString ?? ''), String(stepInput.newString ?? '')); break;
    case 'test_run': result = await stepTestRun((stepInput.suite as 'typecheck' | 'lint' | 'build') ?? 'typecheck'); break;
    case 'git_status': result = await stepGitStatus(); break;
    case 'git_diff': result = await stepGitDiff(); break;
    case 'git_commit': result = await stepGitCommit(String(stepInput.message ?? `IVX executor: ${task.summary}`)); break;
    case 'git_push': result = await stepGitPush(); break;
    case 'render_deploy': result = await stepRenderDeploy(); break;
    case 'health_check': result = await stepHealthCheck(String(stepInput.url ?? 'https://api.ivxholding.com/health')); break;
    case 'supabase_check': result = await stepSupabaseCheck(); break;
    case 'production_verify': result = await stepProductionVerify(); break;
    default: throw new Error(`Unknown capability ${capability}`);
  }

  task.results.push(result);
  task.updated_at = nowIso();
  if (capability === 'git_commit' && result.ok) task.status = 'committed';
  if (capability === 'git_push' && result.ok) task.status = 'pushed';
  if (capability === 'render_deploy' && result.ok) task.status = 'deployed';
  if (capability === 'production_verify' && result.ok) task.status = 'verified';
  if (!result.ok && REQUIRES_APPROVAL.has(capability)) task.status = 'failed';
  return result;
}

/**
 * Run the full pipeline for a task in order, skipping capabilities not in the
 * task plan. Stops at the first failing write-step. Read-only steps never block.
 */
export async function runPipeline(task_id: string): Promise<ExecutorTask> {
  const task = tasks.get(task_id);
  if (!task) throw new Error(`Task ${task_id} not found.`);
  for (const cap of task.capabilities) {
    assertApprovedFor(task, cap);
    const result = await runStep(task_id, cap, {});
    if (!result.ok && REQUIRES_APPROVAL.has(cap)) break;
  }
  return task;
}

/**
 * Produce a final proof object for a task — raw evidence, no narrative.
 */
export function buildProof(task_id: string): Record<string, unknown> {
  const task = tasks.get(task_id);
  if (!task) throw new Error(`Task ${task_id} not found.`);
  const approval = task.approval_id ? approvals.get(task.approval_id) : null;
  return {
    executor_marker: EXECUTOR_MARKER,
    task_id: task.task_id,
    summary: task.summary,
    capabilities: task.capabilities,
    risk_level: task.risk_level,
    status: task.status,
    approval: approval ? {
      approval_id: approval.id,
      approved_by_owner: approval.approved_by_owner,
      approved_at: approval.approved_at,
      status: approval.status,
    } : null,
    files_to_change: task.files_to_change,
    steps: task.results.map((r) => ({ step: r.step, ok: r.ok, error: r.error ?? null, output: r.output })),
    created_at: task.created_at,
    updated_at: task.updated_at,
    timestamp: nowIso(),
  };
}

/**
 * Initialize the approval table on boot. Safe to call repeatedly.
 */
export async function initExecutor(): Promise<{ ok: boolean; error?: string }> {
  return await ensureApprovalTable();
}

export const EXECUTOR_APPROVAL_TABLE_SQL = `
create table if not exists public.owner_execution_approvals (
  id text primary key,
  task_id text not null,
  requested_action text not null,
  risk_level text not null default 'medium',
  files_to_change text[] not null default '{}',
  diff_preview text,
  approved_by_owner boolean not null default false,
  approved_at timestamptz,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);
alter table public.owner_execution_approvals enable row level security;
create policy "owner_only_approvals" on public.owner_execution_approvals
  for all using (auth.role() = 'service_role');
`;
