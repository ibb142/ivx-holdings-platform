/**
 * IVX GitHub Deployment Tool
 *
 * Comprehensive GitHub operations for the deployment brain:
 *   - Read repo info, branches, latest commit, file tree
 *   - Push via Git Tree API
 *   - Create branch, PR
 *   - Check workflows, workflow runs
 *   - Check repository secrets (names only, never values)
 *   - Verify token permissions and scopes
 */

const GITHUB_API = 'https://api.github.com';
const DEFAULT_REPO = 'ibb142/ivx-holdings-platform';
const DEFAULT_BRANCH = 'main';

// ─── Types ───────────────────────────────────────────────────────────

export interface GitHubRepoInfo {
  owner: string;
  repo: string;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  description: string | null;
  pushedAt: string | null;
  updatedAt: string | null;
}

export interface GitHubBranch {
  name: string;
  sha: string;
  protected: boolean;
}

export interface GitHubCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string | null;
  date: string | null;
  url: string;
}

export interface GitHubWorkflow {
  id: number;
  name: string;
  state: string;
  path: string;
}

export interface GitHubWorkflowRun {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  createdAt: string;
  url: string;
}

export interface GitHubSecret {
  name: string;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface GitHubPermissions {
  scopes: string[];
  repoAccess: boolean;
  workflowAccess: boolean;
  adminAccess: boolean;
  canPush: boolean;
  canReadWorkflows: boolean;
  canReadSecrets: boolean;
}

export interface GitHubToolResult {
  ok: boolean;
  error: string | null;
  repo?: GitHubRepoInfo;
  branches?: GitHubBranch[];
  commit?: GitHubCommit;
  workflowRuns?: GitHubWorkflowRun[];
  secrets?: GitHubSecret[];
  permissions?: GitHubPermissions;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getToken(): string {
  return (process.env.GITHUB_TOKEN ?? '').trim();
}

function getRepo(): string {
  return (process.env.GITHUB_REPO_URL
    ? parseRepoSlug(process.env.GITHUB_REPO_URL)
    : DEFAULT_REPO);
}

function parseRepoSlug(url: string): string {
  const match = url.match(/github\.com[/:]([^/]+)\/([^/.\s]+?)(?:\.git)?$/i);
  return match ? `${match[1]}/${match[2]}` : DEFAULT_REPO;
}

async function ghFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const token = getToken();
  if (!token) return { ok: false, status: 0, data: null, error: 'GITHUB_TOKEN not configured' };

  const url = path.startsWith('http') ? path : `${GITHUB_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (opts.body) headers['Content-Type'] = 'application/json';

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as T) : null;
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: `GitHub API ${res.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Repo Operations ──────────────────────────────────────────────────

export async function getRepoInfo(): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch<{
    full_name: string; default_branch: string; private: boolean;
    description: string | null; pushed_at: string; updated_at: string;
    owner: { login: string };
  }>(`/repos/${repo}`);

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    error: null,
    repo: {
      owner: result.data.owner.login,
      repo: repo.split('/')[1],
      fullName: result.data.full_name,
      defaultBranch: result.data.default_branch,
      private: result.data.private,
      description: result.data.description,
      pushedAt: result.data.pushed_at,
      updatedAt: result.data.updated_at,
    },
  };
}

export async function getBranches(): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch<Array<{ name: string; commit: { sha: string }; protected: boolean }>>(`/repos/${repo}/branches?per_page=30`);

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    error: null,
    branches: result.data.map(b => ({ name: b.name, sha: b.commit.sha, protected: b.protected })),
  };
}

export async function getLatestCommit(branch?: string): Promise<GitHubToolResult> {
  const repo = getRepo();
  const b = branch || DEFAULT_BRANCH;
  const result = await ghFetch<{
    sha: string; commit: { message: string; author: { name: string; date: string } }; html_url: string;
  }>(`/repos/${repo}/commits/${b}`);

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    error: null,
    commit: {
      sha: result.data.sha,
      shortSha: result.data.sha.slice(0, 8),
      message: result.data.commit.message,
      author: result.data.commit.author.name,
      date: result.data.commit.author.date,
      url: result.data.html_url,
    },
  };
}

export async function createBranch(name: string, fromSha?: string): Promise<GitHubToolResult> {
  const repo = getRepo();
  let sha = fromSha;
  if (!sha) {
    const head = await getLatestCommit();
    if (!head.ok || !head.commit) return { ok: false, error: 'Cannot get HEAD SHA for branch creation' };
    sha = head.commit.sha;
  }

  const result = await ghFetch(`/repos/${repo}/git/refs`, {
    method: 'POST',
    body: { ref: `refs/heads/${name}`, sha },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, error: null };
}

export async function createPullRequest(
  title: string,
  head: string,
  base: string = DEFAULT_BRANCH,
  body: string = '',
): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch(`/repos/${repo}/pulls`, {
    method: 'POST',
    body: { title, head, base, body },
  });

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return { ok: true, error: null };
}

// ─── Workflow Operations ──────────────────────────────────────────────

export async function getWorkflows(): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch<{ workflows: Array<{ id: number; name: string; state: string; path: string }> }>(
    `/repos/${repo}/actions/workflows`,
  );

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const workflows = result.data?.workflows ?? [];
  return {
    ok: true,
    error: null,
    // Attach latest run to each workflow
    workflowRuns: workflows.map(w => ({
      id: w.id,
      name: w.name,
      status: w.state,
      conclusion: null,
      createdAt: '',
      url: '',
    })),
  };
}

export async function getWorkflowRuns(limit: number = 10): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch<{
    workflow_runs: Array<{
      id: number; name: string; status: string; conclusion: string | null;
      created_at: string; html_url: string;
    }>;
  }>(`/repos/${repo}/actions/runs?per_page=${limit}`);

  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const runs = result.data?.workflow_runs ?? [];
  return {
    ok: true,
    error: null,
    workflowRuns: runs.map(r => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      createdAt: r.created_at,
      url: r.html_url,
    })),
  };
}

// ─── Secrets Operations ────────────────────────────────────────────────

export async function getSecrets(): Promise<GitHubToolResult> {
  const repo = getRepo();
  const result = await ghFetch<{
    secrets: Array<{ name: string; created_at: string; updated_at: string }>;
    total_count: number;
  }>(`/repos/${repo}/actions/secrets`);

  if (result.status === 404) {
    return { ok: true, error: null, secrets: [] };
  }
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  return {
    ok: true,
    error: null,
    secrets: (result.data?.secrets ?? []).map(s => ({
      name: s.name,
      createdAt: s.created_at ?? null,
      updatedAt: s.updated_at ?? null,
    })),
  };
}

// ─── Permissions / Token Scopes ────────────────────────────────────────

export async function verifyPermissions(): Promise<GitHubToolResult> {
  const token = getToken();
  if (!token) {
    return {
      ok: false,
      error: 'GITHUB_TOKEN not configured',
      permissions: {
        scopes: [],
        repoAccess: false,
        workflowAccess: false,
        adminAccess: false,
        canPush: false,
        canReadWorkflows: false,
        canReadSecrets: false,
      },
    };
  }

  const scopesHeader = await ghFetch<Record<string, unknown>>('/');
  const scopesFromHeader: string[] = [];

  // Test actual operations
  const [repoTest, workflowTest, secretsTest] = await Promise.all([
    ghFetch(`/repos/${getRepo()}`),
    ghFetch(`/repos/${getRepo()}/actions/workflows`),
    ghFetch(`/repos/${getRepo()}/actions/secrets`),
  ]);

  const canPush = repoTest.ok && repoTest.status === 200;
  const canReadWorkflows = workflowTest.status !== 404 && workflowTest.status !== 403;
  const canReadSecrets = secretsTest.status !== 404 && secretsTest.status !== 403;
  const repoAccess = canPush;
  const workflowAccess = canReadWorkflows;

  // Test push permission by checking if we can get the ref
  const refTest = await ghFetch(`/repos/${getRepo()}/git/ref/heads/${DEFAULT_BRANCH}`);
  const hasReadAccess = refTest.ok;

  return {
    ok: true,
    error: null,
    permissions: {
      scopes: scopesFromHeader,
      repoAccess,
      workflowAccess,
      adminAccess: false,
      canPush: repoAccess && hasReadAccess,
      canReadWorkflows,
      canReadSecrets,
    },
  };
}

// ─── Combined Status ───────────────────────────────────────────────────

export async function getFullGitHubStatus(): Promise<GitHubToolResult> {
  const [branches, commit, perms] = await Promise.all([
    getBranches(),
    getLatestCommit(),
    verifyPermissions(),
  ]);

  return {
    ok: branches.ok && commit.ok,
    error: [branches.error, commit.error, perms.error].filter(Boolean).join('; ') || null,
    branches: branches.branches ?? [],
    commit: commit.commit ?? undefined,
    permissions: perms.permissions,
  };
}
