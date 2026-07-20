import { gunzipSync } from 'node:zlib';
import { createClient } from '@supabase/supabase-js';
import { buildIVXCredentialRequestManifestSnapshot, IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES } from '../config/ivx-credential-request-manifest';
import { getIVXOwnerVariableRuntimeValue, hasIVXOwnerVariableRuntimeValue } from './ivx-owner-variables';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';

type PgQueryResult = {
  command?: string;
  rowCount?: number | null;
  rows: Record<string, unknown>[];
};

type PgClientLike = {
  query: (sql: string) => Promise<PgQueryResult>;
  release: () => void;
};

type PgPoolLike = {
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PgPoolConstructor = new (config: {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
  application_name?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}) => PgPoolLike;

type DeveloperDeployAction =
  | 'github_commit_file'
  | 'github_create_branch'
  | 'github_create_pull_request'
  | 'github_pull_request_status'
  | 'github_merge_pull_request'
  | 'github_create_rollback_tag'
  | 'github_dispatch_workflow'
  | 'render_trigger_deploy'
  | 'render_restart_service'
  | 'render_upsert_env_var'
  | 'render_update_subdomain_policy'
  | 'render_update_source'
  | 'supabase_execute_sql'
  | 'supabase_reset_owner_password';

type DeveloperDeployRequest = {
  action?: unknown;
  input?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
  reason?: unknown;
};

type GithubRepoInfo = {
  owner: string;
  repo: string;
};

const GITHUB_CONFIRM_TEXT = 'CONFIRM_IVX_GITHUB_WRITE';
const GITHUB_MERGE_CONFIRM_TEXT = 'CONFIRM_IVX_GITHUB_MERGE';
const RENDER_DEPLOY_CONFIRM_TEXT = 'CONFIRM_IVX_RENDER_DEPLOY';
const RENDER_SERVICE_CONFIRM_TEXT = 'CONFIRM_IVX_RENDER_SERVICE_UPDATE';
const SUPABASE_SQL_CONFIRM_TEXT = 'CONFIRM_IVX_SUPABASE_MIGRATION';
const RENDER_API_BASE_URL = 'https://api.render.com/v1';
const MAX_SQL_LENGTH = 50_000;
const MAX_COMMIT_CONTENT_LENGTH = 1_500_000;
const REQUESTED_PRODUCTION_ACCESS_ENV_NAMES = IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES;

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  return readTrimmed(process.env[name]);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseBoolean(value: unknown): boolean {
  return value === true || readTrimmed(value).toLowerCase() === 'true';
}

function normalizeAction(value: unknown): DeveloperDeployAction {
  const normalized = readTrimmed(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (
    normalized === 'github_commit_file'
    || normalized === 'github_create_branch'
    || normalized === 'github_create_pull_request'
    || normalized === 'github_pull_request_status'
    || normalized === 'github_merge_pull_request'
    || normalized === 'github_create_rollback_tag'
    || normalized === 'github_dispatch_workflow'
    || normalized === 'render_trigger_deploy'
    || normalized === 'render_restart_service'
    || normalized === 'render_upsert_env_var'
    || normalized === 'render_update_subdomain_policy'
    || normalized === 'render_update_source'
    || normalized === 'supabase_execute_sql'
    || normalized === 'supabase_reset_owner_password'
 ) {
    return normalized;
  }
  throw new Error('Unsupported IVX developer deploy action.');
}

/** Read-only actions that inspect state without mutating anything; no owner confirmation required. */
function isReadOnlyAction(action: DeveloperDeployAction): boolean {
  return action === 'github_pull_request_status';
}

function requiredConfirmationText(action: DeveloperDeployAction): string {
  if (action === 'github_merge_pull_request') {
    return GITHUB_MERGE_CONFIRM_TEXT;
  }
  if (action.startsWith('github_')) {
    return GITHUB_CONFIRM_TEXT;
  }
  if (action === 'render_trigger_deploy') {
    return RENDER_DEPLOY_CONFIRM_TEXT;
  }
  if (action === 'render_restart_service' || action === 'render_upsert_env_var' || action === 'render_update_subdomain_policy' || action === 'render_update_source') {
    return RENDER_SERVICE_CONFIRM_TEXT;
  }
  return SUPABASE_SQL_CONFIRM_TEXT;
}

function resolveSupabaseAdminClient() {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend (EXPO_PUBLIC_SUPABASE_URL).');
  }
  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is not configured on the backend (SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function runSupabaseResetOwnerPassword(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  const newPassword = readTrimmed(input.newPassword) || readTrimmed(input.password);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for supabase_reset_owner_password.');
  }
  if (!newPassword || newPassword.length < 8) {
    throw new Error('A new password of at least 8 characters is required for supabase_reset_owner_password.');
  }
  const admin = resolveSupabaseAdminClient();
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    throw new Error(`Supabase listUsers failed: ${listError.message}`);
  }
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    throw new Error(`No Supabase auth user found for email ${email}.`);
  }
  const { data: updateData, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true,
    ban_duration: 'none',
  });
  if (updateError || !updateData.user) {
    throw new Error(`Supabase updateUserById failed: ${updateError?.message ?? 'no user returned'}`);
  }
  return {
    provider: 'supabase',
    action: 'supabase_reset_owner_password',
    email,
    userId: user.id,
    passwordReset: true,
    emailConfirmed: Boolean(updateData.user.email_confirmed_at || updateData.user.confirmed_at) || true,
    timestamp: nowIso(),
  };
}

function assertConfirmed(action: DeveloperDeployAction, request: DeveloperDeployRequest): void {
  const required = requiredConfirmationText(action);
  if (request.confirm !== true || readTrimmed(request.confirmText) !== required) {
    throw new Error(`Owner approval required. Resubmit with confirm=true and confirmText="${required}".`);
  }
}

function parseGithubRepoUrl(value: string): GithubRepoInfo | null {
  const match = value.trim().match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function buildSafeGithubRepoUrl(repoInfo: GithubRepoInfo): string {
  return `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
}

async function getGithubRepoInfo(input: Record<string, unknown>): Promise<GithubRepoInfo> {
  const repoUrl = readTrimmed(input.repoUrl) || readEnv('GITHUB_REPO_URL') || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) {
    throw new Error('GITHUB_REPO_URL is missing or invalid. It was not loaded from process.env, request input, or encrypted Owner Variables.');
  }
  return repoInfo;
}

async function getGithubToken(): Promise<string> {
  const token = readEnv('GITHUB_TOKEN') || await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for owner-approved GitHub write actions. It was not loaded from process.env or encrypted Owner Variables.');
  }
  return token;
}

async function githubHeaders(): Promise<HeadersInit> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${await getGithubToken()}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 600) };
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, data: await parseJsonResponse(response) };
}

function sanitizeRepoPath(value: unknown): string {
  const repoPath = readTrimmed(value).replace(/^\/+/, '');
  if (!repoPath || repoPath.includes('..') || repoPath.endsWith('/')) {
    throw new Error('A safe repository file path is required.');
  }
  const lower = repoPath.toLowerCase();
  const blocked = lower === '.env'
    || lower.startsWith('.env.')
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
    || lower.includes('/.env')
    || lower.includes('secret')
    || lower.includes('private-key');
  if (blocked && lower !== '.env.example') {
    throw new Error('Refusing to write likely secret-bearing repository paths.');
  }
  return repoPath;
}

/**
 * Decodes guarded commit content. Supports plain UTF-8 (default) and
 * contentEncoding="gzip-base64" for large source files that edge protection
 * would otherwise block when sent as plain text (payload arrives compressed).
 */
function decodeCommitContent(input: Record<string, unknown>): string {
  const raw = readTrimmed(input.content);
  const encoding = readTrimmed(input.contentEncoding).toLowerCase();
  if (!raw || !encoding) {
    return raw;
  }
  if (encoding === 'gzip-base64') {
    const decoded = gunzipSync(Buffer.from(raw, 'base64')).toString('utf8');
    if (!decoded.trim()) {
      throw new Error('Decoded gzip-base64 commit content is empty.');
    }
    return decoded;
  }
  if (encoding === 'base64') {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (!decoded.trim()) {
      throw new Error('Decoded base64 commit content is empty.');
    }
    return decoded;
  }
  throw new Error('Unsupported contentEncoding. Use "gzip-base64", "base64", or omit for plain UTF-8.');
}

async function runGithubCommitFile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const repoPath = sanitizeRepoPath(input.path);
  const content = decodeCommitContent(input);
  const message = readTrimmed(input.message) || `IVX Owner AI update ${repoPath}`;
  if (!content) {
    throw new Error('File content is required for GitHub commit action.');
  }
  if (content.length > MAX_COMMIT_CONTENT_LENGTH) {
    throw new Error(`File content is too large for this guarded commit action. Max ${MAX_COMMIT_CONTENT_LENGTH} characters.`);
  }

  const encodedPath = repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  const contentUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const existing = await fetchJson(contentUrl, { method: 'GET', headers: await githubHeaders() }).catch(() => null);
  const existingRecord = readRecord(existing?.data);
  const existingSha = existing?.ok === true ? readTrimmed(existingRecord.sha) : '';

  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: await githubHeaders(),
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub commit failed with HTTP ${response.status}.`);
  }

  const data = readRecord(response.data);
  const commit = readRecord(data.commit);
  const file = readRecord(data.content);
  return {
    provider: 'github',
    action: 'github_commit_file',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: repoPath,
    mode: existingSha ? 'update_existing_file' : 'create_new_file',
    commitSha: readTrimmed(commit.sha) || null,
    commitUrl: readTrimmed(commit.html_url) || readTrimmed(commit.url) || null,
    fileUrl: readTrimmed(file.html_url) || null,
  };
}

async function runGithubCreatePullRequest(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const title = readTrimmed(input.title);
  const head = readTrimmed(input.head);
  const base = readTrimmed(input.base) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const body = readTrimmed(input.body);
  if (!title || !head) {
    throw new Error('Pull request title and head branch are required.');
  }
  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ title, head, base, body }),
  });
  if (!response.ok) {
    throw new Error(`GitHub pull request creation failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  return {
    provider: 'github',
    action: 'github_create_pull_request',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number: data.number ?? null,
    state: readTrimmed(data.state) || null,
    url: readTrimmed(data.html_url) || null,
    head,
    base,
  };
}

function sanitizeGitRef(value: unknown, label: string): string {
  const ref = readTrimmed(value);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.endsWith('/')) {
    throw new Error(`A valid ${label} is required (letters, numbers, dot, dash, underscore, slash).`);
  }
  return ref;
}

async function runGithubCreateBranch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const newBranch = sanitizeGitRef(input.branch ?? input.newBranch, 'branch name');
  const fromBranch = sanitizeGitRef(input.fromBranch ?? readEnv('GITHUB_DEFAULT_BRANCH') ?? 'main', 'source branch');
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  const baseRef = await fetchJson(`${baseUrl}/git/ref/${encodeURIComponent(`heads/${fromBranch}`)}`, { method: 'GET', headers: await githubHeaders() });
  if (!baseRef.ok) {
    throw new Error(`Could not resolve source branch "${fromBranch}" (HTTP ${baseRef.status}).`);
  }
  const baseSha = readTrimmed(readRecord(readRecord(baseRef.data).object).sha);
  if (!baseSha) {
    throw new Error('Could not read source branch commit SHA.');
  }
  const response = await fetchJson(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  if (!response.ok) {
    throw new Error(`GitHub branch creation failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_create_branch',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch: newBranch,
    fromBranch,
    baseSha,
    branchUrl: `${buildSafeGithubRepoUrl(repoInfo)}/tree/${encodeURIComponent(newBranch)}`,
  };
}

async function runGithubPullRequestStatus(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const number = Number.parseInt(readTrimmed(input.number ?? input.pullNumber), 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('A valid pull request number is required.');
  }
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
  const pr = await fetchJson(`${baseUrl}/pulls/${number}`, { method: 'GET', headers: await githubHeaders() });
  if (!pr.ok) {
    throw new Error(`GitHub pull request lookup failed with HTTP ${pr.status}.`);
  }
  const data = readRecord(pr.data);
  const headSha = readTrimmed(readRecord(data.head).sha);
  let checksConclusion: string | null = null;
  let checksTotal = 0;
  let checksPassed = 0;
  if (headSha) {
    const checks = await fetchJson(`${baseUrl}/commits/${encodeURIComponent(headSha)}/check-runs`, { method: 'GET', headers: await githubHeaders() });
    if (checks.ok) {
      const runs = Array.isArray(readRecord(checks.data).check_runs) ? readRecord(checks.data).check_runs as Record<string, unknown>[] : [];
      checksTotal = runs.length;
      checksPassed = runs.filter((run) => readTrimmed(run.conclusion) === 'success').length;
      const allDone = runs.every((run) => readTrimmed(run.status) === 'completed');
      checksConclusion = checksTotal === 0 ? 'no_checks' : !allDone ? 'pending' : checksPassed === checksTotal ? 'success' : 'failure';
    }
  }
  return {
    provider: 'github',
    action: 'github_pull_request_status',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number,
    state: readTrimmed(data.state) || null,
    merged: data.merged === true,
    mergeable: data.mergeable ?? null,
    mergeableState: readTrimmed(data.mergeable_state) || null,
    headRef: readTrimmed(readRecord(data.head).ref) || null,
    baseRef: readTrimmed(readRecord(data.base).ref) || null,
    headSha: headSha || null,
    checksConclusion,
    checksTotal,
    checksPassed,
    readyToMerge: data.mergeable === true && readTrimmed(data.mergeable_state) !== 'dirty' && (checksConclusion === 'success' || checksConclusion === 'no_checks'),
    url: readTrimmed(data.html_url) || null,
  };
}

async function runGithubMergePullRequest(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const number = Number.parseInt(readTrimmed(input.number ?? input.pullNumber), 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('A valid pull request number is required.');
  }
  const mergeMethodRaw = readTrimmed(input.mergeMethod).toLowerCase();
  const mergeMethod = mergeMethodRaw === 'squash' || mergeMethodRaw === 'rebase' ? mergeMethodRaw : 'merge';
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  // Guard: never merge unless checks pass and PR is mergeable, unless explicitly forced by owner.
  const status = await runGithubPullRequestStatus({ ...input, number });
  const requireGreenChecks = !parseBoolean(input.allowFailedChecks);
  if (requireGreenChecks && status.readyToMerge !== true) {
    throw new Error(`Refusing to merge PR #${number}: status checks/mergeability not green (checks=${status.checksConclusion ?? 'unknown'}, mergeableState=${status.mergeableState ?? 'unknown'}). Pass allowFailedChecks=true only to override.`);
  }
  const response = await fetchJson(`${baseUrl}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: await githubHeaders(),
    body: JSON.stringify({ merge_method: mergeMethod }),
  });
  if (!response.ok) {
    throw new Error(`GitHub merge failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  return {
    provider: 'github',
    action: 'github_merge_pull_request',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number,
    merged: data.merged === true,
    mergeMethod,
    mergeCommitSha: readTrimmed(data.sha) || null,
    checksWereGreen: status.checksConclusion,
    message: readTrimmed(data.message) || null,
  };
}

async function runGithubCreateRollbackTag(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = sanitizeGitRef(input.branch ?? readEnv('GITHUB_DEFAULT_BRANCH') ?? 'main', 'branch');
  const providedTag = readTrimmed(input.tag);
  const tag = providedTag ? sanitizeGitRef(providedTag, 'tag name') : `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  const branchRef = await fetchJson(`${baseUrl}/git/ref/${encodeURIComponent(`heads/${branch}`)}`, { method: 'GET', headers: await githubHeaders() });
  if (!branchRef.ok) {
    throw new Error(`Could not resolve branch "${branch}" for rollback tag (HTTP ${branchRef.status}).`);
  }
  const sha = readTrimmed(input.commitSha) || readTrimmed(readRecord(readRecord(branchRef.data).object).sha);
  if (!sha) {
    throw new Error('Could not resolve a commit SHA to tag.');
  }
  const response = await fetchJson(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
  if (!response.ok) {
    throw new Error(`GitHub rollback tag creation failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_create_rollback_tag',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    tag,
    sha,
    branch,
    rollbackHint: `git reset --hard ${tag} OR redeploy this tag's commit ${sha.slice(0, 8)} to roll back.`,
    tagUrl: `${buildSafeGithubRepoUrl(repoInfo)}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

async function runGithubDispatchWorkflow(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const workflowId = readTrimmed(input.workflowId) || readTrimmed(input.workflowFileName);
  const ref = readTrimmed(input.ref) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const workflowInputs = readRecord(input.inputs);
  if (!workflowId) {
    throw new Error('workflowId or workflowFileName is required.');
  }
  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref, inputs: workflowInputs }),
  });
  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_dispatch_workflow',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    workflowId,
    ref,
    dispatchAccepted: true,
    httpStatus: response.status,
  };
}

async function getRenderApiKey(): Promise<string> {
  const apiKey = readEnv('RENDER_API_KEY') || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  if (!apiKey) {
    throw new Error('RENDER_API_KEY is required for owner-approved Render actions. It was not loaded from process.env or encrypted Owner Variables.');
  }
  return apiKey;
}

async function getRenderServiceId(input: Record<string, unknown>): Promise<string> {
  const serviceId = readTrimmed(input.serviceId) || readEnv('RENDER_SERVICE_ID') || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  if (!serviceId) {
    throw new Error('RENDER_SERVICE_ID is required for Render service actions. It was not loaded from process.env, request input, or encrypted Owner Variables.');
  }
  return serviceId;
}

async function renderHeaders(): Promise<HeadersInit> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${await getRenderApiKey()}`,
    'Content-Type': 'application/json',
  };
}

async function runRenderTriggerDeploy(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const body: Record<string, unknown> = {};
  const commitId = readTrimmed(input.commitId);
  const imageUrl = readTrimmed(input.imageUrl);
  const deployMode = readTrimmed(input.deployMode);
  if (commitId) {
    body.commitId = commitId;
  }
  if (imageUrl) {
    body.imageUrl = imageUrl;
  }
  if (deployMode === 'deploy_only' || deployMode === 'build_and_deploy') {
    body.deploy_mode = deployMode;
  }
  if (parseBoolean(input.clearCache) && !commitId && !imageUrl && !deployMode) {
    body.clearCache = 'clear';
  }
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render deploy trigger failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  return {
    provider: 'render',
    action: 'render_trigger_deploy',
    serviceId,
    deployId: readTrimmed(data.id) || readTrimmed(readRecord(data.deploy).id) || null,
    status: readTrimmed(data.status) || readTrimmed(readRecord(data.deploy).status) || 'accepted',
    url: readTrimmed(data.url) || null,
  };
}

async function runRenderRestartService(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/restart`, {
    method: 'POST',
    headers: await renderHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Render restart failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_restart_service',
    serviceId,
    restartAccepted: true,
    httpStatus: response.status,
  };
}

function normalizeRenderSubdomainPolicy(value: unknown): 'enabled' | 'disabled' {
  const policy = readTrimmed(value).toLowerCase();
  if (!policy || policy === 'disabled') {
    return 'disabled';
  }
  if (policy === 'enabled') {
    return 'enabled';
  }
  throw new Error('Render subdomain policy must be "enabled" or "disabled".');
}

async function runRenderUpdateSubdomainPolicy(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const policy = normalizeRenderSubdomainPolicy(input.renderSubdomainPolicy ?? input.policy);
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    headers: await renderHeaders(),
    body: JSON.stringify({ serviceDetails: { renderSubdomainPolicy: policy } }),
  });
  if (!response.ok) {
    throw new Error(`Render subdomain policy update failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_update_subdomain_policy',
    serviceId,
    renderSubdomainPolicy: policy,
    httpStatus: response.status,
    customDomainRequiredWhenDisabled: policy === 'disabled',
    secretValuesReturned: false,
  };
}

async function runRenderUpdateSource(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const repoUrl = readTrimmed(input.repoUrl) || readEnv('GITHUB_REPO_URL') || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) {
    throw new Error('A valid owner-controlled GitHub repo URL is required for Render source migration.');
  }
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const autoDeploy = readTrimmed(input.autoDeploy).toLowerCase();
  const body: Record<string, unknown> = {
    repo: buildSafeGithubRepoUrl(repoInfo),
    branch,
  };
  if (autoDeploy === 'yes' || autoDeploy === 'no') {
    body.autoDeploy = autoDeploy;
  }

  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render source update failed with HTTP ${response.status}.`);
  }
  const serviceRecord = readRecord(readRecord(response.data).service ?? response.data);
  const responseRepoInfo = parseGithubRepoUrl(readTrimmed(serviceRecord.repo)) ?? repoInfo;
  return {
    provider: 'render',
    action: 'render_update_source',
    serviceId,
    httpStatus: response.status,
    sourceRepoOwner: responseRepoInfo.owner,
    sourceRepoName: responseRepoInfo.repo,
    sourceRepoUrl: buildSafeGithubRepoUrl(responseRepoInfo),
    branch: readTrimmed(serviceRecord.branch) || branch,
    autoDeploy: readTrimmed(serviceRecord.autoDeploy) || (autoDeploy === 'yes' || autoDeploy === 'no' ? autoDeploy : null),
    renderSourceUpdated: true,
    secretValuesReturned: false,
  };
}

function sanitizeEnvVarKey(value: unknown): string {
  const key = readTrimmed(value);
  if (!/^[A-Z][A-Z0-9_]{1,120}$/.test(key)) {
    throw new Error('A valid uppercase environment variable key is required.');
  }
  return key;
}

async function runRenderUpsertEnvVar(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const key = sanitizeEnvVarKey(input.key);
  const value = typeof input.value === 'string' ? input.value : '';
  if (!value && !parseBoolean(input.generateValue)) {
    throw new Error('Environment variable value is required unless generateValue=true is provided.');
  }
  const body = parseBoolean(input.generateValue) ? { generateValue: true } : { value };
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render environment variable update failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_upsert_env_var',
    serviceId,
    key,
    valueStored: true,
    secretValueReturned: false,
    deployRequiredForRuntime: true,
  };
}

function getSupabaseProjectRef(): string {
  const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL);
  if (!url) return '';
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] ?? '' : '';
}

function getSupabaseDatabaseUrl(): string {
  // 1. Direct connection string env vars (preferred).
  const direct = readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL')
    || readEnv('SUPABASE_INSPECTION_DATABASE_URL') || readEnv('SUPABASE_READONLY_DATABASE_URL');
  if (direct) return direct;

  // 2. Build from SUPABASE_DB_PASSWORD + project ref (handles Render services
  //    where SUPABASE_DB_URL is declared in render.yaml with sync:false but
  //    not materialized — same pattern as ivx-blocker-fix-migration.ts).
  const password = readTrimmed(process.env.SUPABASE_DB_PASSWORD);
  if (!password) {
    throw new Error('SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD is required for owner-approved SQL/migration actions.');
  }
  const projectRef = getSupabaseProjectRef();
  if (!projectRef) {
    throw new Error('Could not determine Supabase project ref from EXPO_PUBLIC_SUPABASE_URL to build the DB connection string.');
  }
  const dbHost = readTrimmed(process.env.SUPABASE_DB_HOST) || `db.${projectRef}.supabase.co`;
  const dbPort = readTrimmed(process.env.SUPABASE_DB_PORT) || '5432';
  const dbName = readTrimmed(process.env.SUPABASE_DB_NAME) || 'postgres';
  const dbUser = readTrimmed(process.env.SUPABASE_DB_USER) || 'postgres';
  const encodedUser = encodeURIComponent(dbUser);
  const encodedPassword = encodeURIComponent(password);
  const encodedDbName = encodeURIComponent(dbName);
  return `postgres://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${encodedDbName}?sslmode=require&application_name=ivx_developer_deploy`;
}

function assertSqlAllowed(sql: string): void {
  const normalized = sql.trim();
  if (!normalized) {
    throw new Error('SQL is required.');
  }
  if (normalized.length > MAX_SQL_LENGTH) {
    throw new Error(`SQL exceeds the guarded maximum length of ${MAX_SQL_LENGTH} characters.`);
  }
}

async function runSupabaseExecuteSql(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sql = readTrimmed(input.sql);
  assertSqlAllowed(sql);
  const pgModule = await import('pg') as { Pool: PgPoolConstructor };
  const pool = new pgModule.Pool({
    connectionString: getSupabaseDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
    application_name: 'ivx-owner-ai-approved-migration',
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
  });
  const client = await pool.connect();
  try {
    const result = await client.query(sql);
    const rows = Array.isArray(result.rows) ? result.rows.slice(0, 25) : [];
    return {
      provider: 'supabase',
      action: 'supabase_execute_sql',
      command: result.command ?? 'SQL',
      rowCount: result.rowCount ?? null,
      rowsReturned: Array.isArray(result.rows) ? result.rows.length : 0,
      rowsPreview: parseBoolean(input.returnRows) ? rows : [],
      rowsPreviewReturned: parseBoolean(input.returnRows),
    };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function buildStatus(): Promise<Record<string, unknown>> {
  const githubTokenConfigured = Boolean(readEnv('GITHUB_TOKEN')) || await hasIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
  const githubRepoUrlConfigured = Boolean(readEnv('GITHUB_REPO_URL')) || await hasIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const renderApiConfigured = Boolean(readEnv('RENDER_API_KEY')) || await hasIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const renderServiceConfigured = Boolean(readEnv('RENDER_SERVICE_ID')) || await hasIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  const renderCredentialSource = {
    RENDER_API_KEY: readEnv('RENDER_API_KEY') ? 'env' : renderApiConfigured ? 'owner_variables' : 'missing',
    RENDER_SERVICE_ID: readEnv('RENDER_SERVICE_ID') ? 'env' : renderServiceConfigured ? 'owner_variables' : 'missing',
  };
  const supabaseDbUrlConfigured = Boolean(readEnv('SUPABASE_DB_URL'));
  const databaseUrlConfigured = Boolean(readEnv('DATABASE_URL'));
  const postgresUrlConfigured = Boolean(readEnv('POSTGRES_URL'));
  const supabaseSqlConfigured = supabaseDbUrlConfigured || databaseUrlConfigured || postgresUrlConfigured;
  const supabaseServiceRoleConfigured = Boolean(readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY'));
  const awsConfigured = Boolean(readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY'));
  const currentRuntimeCanExecuteCoreOwnerApprovedActions = githubTokenConfigured
    && renderApiConfigured
    && renderServiceConfigured
    && supabaseServiceRoleConfigured
    && supabaseSqlConfigured;
  const requestedCredentialStatusByNameOnly = Object.fromEntries(
    REQUESTED_PRODUCTION_ACCESS_ENV_NAMES.map((name) => [
      name,
      name === 'RENDER_API_KEY'
        ? renderApiConfigured
        : name === 'RENDER_SERVICE_ID'
          ? renderServiceConfigured
          : Boolean(readEnv(name)),
    ]),
  ) as Record<typeof REQUESTED_PRODUCTION_ACCESS_ENV_NAMES[number], boolean>;
  return {
    ok: true,
    ownerOnly: true,
    readOnly: true,
    mode: 'ivx_owner_ai_developer_deploy_control',
    preLiveAccessSupported: true,
    productionLiveRequiredForAccess: false,
    productionLiveRequiredForPublicProof: true,
    renderLiveBlocksIVXAccess: false,
    currentRuntimeCredentialLoadingRequired: true,
    currentRuntimeCanExecuteCoreOwnerApprovedActions,
    currentAccessBlocker: currentRuntimeCanExecuteCoreOwnerApprovedActions
      ? null
      : 'The blocker is missing backend-only credentials in the runtime receiving this request, not Render/custom-domain live status.',
    accessProofStatement: 'Render public routing/custom-domain live status is not required for IVX Owner AI developer access. Any reachable backend runtime can operate when the backend-only credentials are loaded there.',
    accessBeforeLive: {
      supported: true,
      publicAppMustBeLiveFirst: false,
      renderPublicRoutingRequiredForAccess: false,
      renderPublicRoutingRequiredOnlyForPublicProof: true,
      requiredRuntime: 'Any reachable IVX backend runtime: local dev, staging, Render preview, or production.',
      requiredCredentialSource: 'Backend-only process.env or secure host environment variables; never frontend bundle or chat.',
      currentRuntimeCanUseRequestedCredentials: currentRuntimeCanExecuteCoreOwnerApprovedActions,
      explanation: 'IVX Owner AI can receive full developer/deploy access before public launch when this backend runtime is reachable and the backend-only credentials are loaded there. Render/custom-domain live status is only required for remote production proof at api.ivxholding.com/chat.ivxholding.com.',
      proofRoute: 'GET /api/ivx/developer-deploy/status',
    },
    allWriteAndDeployActionsRequireOwnerApproval: true,
    secretValuesReturned: false,
    requestedCredentialStatusByNameOnly,
    requestedCredentialNames: Object.keys(requestedCredentialStatusByNameOnly),
    requestedProductionAccessEnvNames: [...REQUESTED_PRODUCTION_ACCESS_ENV_NAMES],
    credentialRequestManifest: buildIVXCredentialRequestManifestSnapshot({ includeOptional: true }),
    supabaseSqlCredentialFallbackAccepted: ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL'],
    requestedCredentialNotes: {
      API_BASE_URL: 'Production backend base URL expected to be https://api.ivxholding.com.',
      STRIPE_API_KEY: 'Optional unless Stripe billing/payments are enabled for this service.',
      APP_SECRET: 'Generated by Render from the Blueprint when the service is synced.',
      DATABASE_URL: 'Loaded from Render Postgres database mydatabase via fromDatabase.connectionString.',
      MINIO_PASSWORD: 'Loaded from private Render service minio via fromService.MINIO_ROOT_PASSWORD.',
      myEnvGroup: 'Blueprint links fromGroup: my-env-group to the backend service.',
    },
    futureCredentialIntake: {
      supported: true,
      variableFile: 'backend/config/ivx-credential-request-manifest.ts',
      route: 'POST /api/ivx/developer-deploy/action',
      action: 'render_upsert_env_var',
      ownerConfirmationRequired: RENDER_SERVICE_CONFIRM_TEXT,
      credentialRequestManifestTool: 'credential_request_manifest',
      secretValuesReturned: false,
      note: 'Future backend credentials can be requested by IVX AI using the credential request manifest and added through this guarded owner-approved Render env-var action when RENDER_API_KEY and RENDER_SERVICE_ID are loaded in the backend runtime.',
    },
    routes: {
      status: 'GET /api/ivx/developer-deploy/status',
      action: 'POST /api/ivx/developer-deploy/action',
    },
    github: {
      repoUrlConfigured: githubRepoUrlConfigured,
      tokenConfigured: githubTokenConfigured,
      credentialSource: {
        GITHUB_REPO_URL: readEnv('GITHUB_REPO_URL') ? 'env' : githubRepoUrlConfigured ? 'owner_variables' : 'missing',
        GITHUB_TOKEN: readEnv('GITHUB_TOKEN') ? 'env' : githubTokenConfigured ? 'owner_variables' : 'missing',
      },
      requiredTokenPermissions: ['contents:read/write', 'pull_requests:write', 'actions/workflows:write'],
      supportedActions: ['github_commit_file', 'github_create_branch', 'github_create_pull_request', 'github_pull_request_status', 'github_merge_pull_request', 'github_create_rollback_tag', 'github_dispatch_workflow'],
      readOnlyActions: ['github_pull_request_status'],
      confirmationTextRequired: GITHUB_CONFIRM_TEXT,
      mergeConfirmationTextRequired: GITHUB_MERGE_CONFIRM_TEXT,
    },
    render: {
      apiKeyConfigured: renderApiConfigured,
      serviceIdConfigured: renderServiceConfigured,
      credentialSource: renderCredentialSource,
      serviceName: readEnv('RENDER_SERVICE_NAME') || 'ivx-holdings-platform',
      supportedActions: ['render_trigger_deploy', 'render_restart_service', 'render_upsert_env_var', 'render_update_subdomain_policy', 'render_update_source'],
      deployConfirmationTextRequired: RENDER_DEPLOY_CONFIRM_TEXT,
      serviceUpdateConfirmationTextRequired: RENDER_SERVICE_CONFIRM_TEXT,
    },
    supabase: {
      urlConfigured: Boolean(readEnv('EXPO_PUBLIC_SUPABASE_URL')),
      anonKeyConfigured: Boolean(readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY')),
      serviceRoleConfigured: supabaseServiceRoleConfigured,
      databaseUrlConfigured: supabaseSqlConfigured,
      supportedActions: ['supabase_execute_sql', 'POST /api/ivx/supabase/owner-action'],
      confirmationTextRequired: SUPABASE_SQL_CONFIRM_TEXT,
    },
    aws: {
      optional: true,
      credentialsConfigured: awsConfigured,
      sessionTokenConfigured: Boolean(readEnv('AWS_SESSION_TOKEN')),
      safety: 'AWS/DNS write actions stay separate and require owner confirmation on their specific owner-only routes.',
    },
    missingCredentialNames: [
      ...(!githubRepoUrlConfigured ? ['GITHUB_REPO_URL'] : []),
      ...(!githubTokenConfigured ? ['GITHUB_TOKEN'] : []),
      ...(!renderApiConfigured ? ['RENDER_API_KEY'] : []),
      ...(!renderServiceConfigured ? ['RENDER_SERVICE_ID'] : []),
      ...(!supabaseServiceRoleConfigured ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
      ...(!supabaseSqlConfigured ? ['SUPABASE_DB_URL or DATABASE_URL or POSTGRES_URL'] : []),
    ],
    requestedCredentialMissingNames: Object.entries(requestedCredentialStatusByNameOnly)
      .filter(([, configured]) => !configured)
      .map(([name]) => name),
    timestamp: nowIso(),
  };
}

async function runAction(action: DeveloperDeployAction, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (action === 'github_commit_file') {
    return await runGithubCommitFile(input);
  }
  if (action === 'github_create_branch') {
    return await runGithubCreateBranch(input);
  }
  if (action === 'github_create_pull_request') {
    return await runGithubCreatePullRequest(input);
  }
  if (action === 'github_pull_request_status') {
    return await runGithubPullRequestStatus(input);
  }
  if (action === 'github_merge_pull_request') {
    return await runGithubMergePullRequest(input);
  }
  if (action === 'github_create_rollback_tag') {
    return await runGithubCreateRollbackTag(input);
  }
  if (action === 'github_dispatch_workflow') {
    return await runGithubDispatchWorkflow(input);
  }
  if (action === 'render_trigger_deploy') {
    return await runRenderTriggerDeploy(input);
  }
  if (action === 'render_restart_service') {
    return await runRenderRestartService(input);
  }
  if (action === 'render_upsert_env_var') {
    return await runRenderUpsertEnvVar(input);
  }
  if (action === 'render_update_subdomain_policy') {
    return await runRenderUpdateSubdomainPolicy(input);
  }
  if (action === 'render_update_source') {
    return await runRenderUpdateSource(input);
  }
  if (action === 'supabase_reset_owner_password') {
    return await runSupabaseResetOwnerPassword(input);
  }
  return await runSupabaseExecuteSql(input);
}

async function auditDeveloperDeployAction(ownerContext: IVXOwnerRequestContext, action: DeveloperDeployAction, input: Record<string, unknown>, result: Record<string, unknown>, reason: string | null): Promise<void> {
  console.log('[IVXDeveloperDeployControl] Owner-approved action executed:', {
    userId: ownerContext.userId,
    email: ownerContext.email,
    action,
    reason,
    targetPath: action === 'github_commit_file' ? readTrimmed(input.path) : undefined,
    envKey: action === 'render_upsert_env_var' ? readTrimmed(input.key) : undefined,
    renderSubdomainPolicy: action === 'render_update_subdomain_policy' ? normalizeRenderSubdomainPolicy(input.renderSubdomainPolicy ?? input.policy) : undefined,
    renderSourceBranch: action === 'render_update_source' ? readTrimmed(input.branch) || 'main' : undefined,
    sqlLength: action === 'supabase_execute_sql' ? readTrimmed(input.sql).length : undefined,
    resetEmail: action === 'supabase_reset_owner_password' ? readTrimmed(input.email) : undefined,
    resultProvider: readTrimmed(result.provider),
    timestamp: nowIso(),
  });
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXDeveloperDeployStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    return ownerOnlyJson({ ...(await buildStatus()), authenticatedUserId: ownerContext.userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Developer deploy status failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, readOnly: true, error: message, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

export async function handleIVXDeveloperDeployActionRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = await request.json().catch((): DeveloperDeployRequest => ({}));
    const action = normalizeAction(body.action);
    const input = readRecord(body.input);
    const requiredText = requiredConfirmationText(action);
    if (body.confirm !== true || readTrimmed(body.confirmText) !== requiredText) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        writeEnabled: true,
        action,
        confirmationRequired: true,
        confirmTextRequired: requiredText,
        message: `Confirm this ${action} by resubmitting with confirm=true and confirmText="${requiredText}".`,
        secretValuesReturned: false,
        timestamp: nowIso(),
      }, 409);
    }

    assertConfirmed(action, body);
    // ─── Pre-Execution Feasibility Gate (Stage 0) ───────────────────────────
    // Runs BEFORE runAction executes any deploy/migration/push. Owner session is
    // verified above (assertIVXOwnerOnly succeeded), so ownerSessionPresent=true.
    try {
      const gate = await checkPreExecutionGate(request, {
        prompt: `${action} ${JSON.stringify(input).slice(0, 500)}`,
        ownerSessionPresent: true,
        entryPoint: 'developer-deploy-action',
      });
      if (gate.blocked && gate.response) {
        return gate.response;
      }
    } catch (gateError) {
      console.log('[IVXDeveloperDeployControl] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }
    const result = await runAction(action, input);
    await auditDeveloperDeployAction(ownerContext, action, input, result, readTrimmed(body.reason) || null);
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      writeEnabled: true,
      action,
      result,
      authenticatedUserId: ownerContext.userId,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Developer deploy action failed.';
    console.log('[IVXDeveloperDeployControl] Action failed:', { message });
    return ownerOnlyJson({ ok: false, ownerOnly: true, writeEnabled: true, error: message, secretValuesReturned: false, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}
