/**
 * IVX Vercel Deployment Tool
 *
 * Comprehensive Vercel operations:
 *   - Read projects
 *   - Trigger deploy
 *   - Check deployment status
 *   - Verify production URL
 *   - Check environment variables
 *   - Rollback deployment
 */

const VERCEL_API = 'https://api.vercel.com';

// ─── Types ───────────────────────────────────────────────────────────

export interface VercelProject {
  id: string;
  name: string;
  framework: string | null;
  latestDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VercelDeploy {
  id: string;
  url: string;
  state: string;
  createdAt: string;
  readyAt: string | null;
  target: string | null;
  commitSha: string | null;
  commitMessage: string | null;
}

export interface VercelEnvVar {
  key: string;
  type: string;
  target: string[];
  configured: boolean;
}

export interface VercelToolResult {
  ok: boolean;
  error: string | null;
  projects?: VercelProject[];
  project?: VercelProject;
  deploys?: VercelDeploy[];
  deploy?: VercelDeploy;
  envVars?: VercelEnvVar[];
}

// ─── Helpers ──────────────────────────────────────────────────────────

function getToken(): string {
  const token = (process.env.VERCEL_TOKEN ?? process.env.VERCEL_API_TOKEN ?? '').trim();
  return token;
}

function isConfigured(): boolean {
  return getToken().length > 0;
}

async function vercelFetch<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; data: T | null; error: string | null }> {
  const token = getToken();
  if (!token) return { ok: false, status: 0, data: null, error: 'VERCEL_TOKEN not configured' };

  const url = path.startsWith('http') ? path : `${VERCEL_API}${path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
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
      return { ok: false, status: res.status, data, error: `Vercel API ${res.status}: ${text.slice(0, 500)}` };
    }
    return { ok: true, status: res.status, data, error: null };
  } catch (err) {
    return { ok: false, status: 0, data: null, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─── Project Operations ───────────────────────────────────────────────

export async function listProjects(): Promise<VercelToolResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'VERCEL_TOKEN not configured — Vercel tool is inactive', projects: [] };
  }

  const result = await vercelFetch<{
    projects: Array<{
      id: string; name: string; framework: string | null;
      latestDeployments?: Array<{ id: string }>;
      createdAt: string; updatedAt: string;
    }>;
  }>('/v9/projects?limit=50');

  if (!result.ok || !result.data) {
    return { ok: false, error: result.error };
  }

  const projects: VercelProject[] = (result.data.projects ?? []).map(p => ({
    id: p.id,
    name: p.name,
    framework: p.framework,
    latestDeploymentId: p.latestDeployments?.[0]?.id ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  }));

  return { ok: true, error: null, projects };
}

export async function getProject(projectId: string): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  const result = await vercelFetch<Record<string, unknown>>(`/v9/projects/${encodeURIComponent(projectId)}`);

  if (!result.ok || !result.data) return { ok: false, error: result.error };

  return {
    ok: true,
    error: null,
    project: {
      id: String(result.data.id ?? ''),
      name: String(result.data.name ?? ''),
      framework: String(result.data.framework ?? null) || null,
      latestDeploymentId: null,
      createdAt: String(result.data.createdAt ?? ''),
      updatedAt: String(result.data.updatedAt ?? ''),
    },
  };
}

// ─── Deploy Operations ────────────────────────────────────────────────

export async function listDeployments(projectId: string, limit: number = 10): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  const result = await vercelFetch<{
    deployments: Array<{
      uid: string; url: string; state: string; created: number; ready: number | null;
      target: string | null; meta?: Record<string, unknown>;
    }>;
  }>(`/v6/deployments?projectId=${encodeURIComponent(projectId)}&limit=${limit}`);

  if (!result.ok || !result.data) return { ok: false, error: result.error };

  const deploys: VercelDeploy[] = (result.data.deployments ?? []).map(d => ({
    id: d.uid,
    url: d.url,
    state: d.state,
    createdAt: new Date(d.created).toISOString(),
    readyAt: d.ready ? new Date(d.ready).toISOString() : null,
    target: d.target,
    commitSha: (d.meta?.githubCommitSha as string) ?? null,
    commitMessage: (d.meta?.githubCommitMessage as string) ?? null,
  }));

  return { ok: true, error: null, deploys };
}

export async function getDeployment(deployId: string): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  const result = await vercelFetch<Record<string, unknown>>(`/v13/deployments/${encodeURIComponent(deployId)}`);

  if (!result.ok || !result.data) return { ok: false, error: result.error };

  return {
    ok: true,
    error: null,
    deploy: {
      id: String(result.data.uid ?? result.data.id ?? ''),
      url: String(result.data.url ?? ''),
      state: String(result.data.state ?? ''),
      createdAt: String(result.data.created ?? result.data.createdAt ?? ''),
      readyAt: String(result.data.ready ?? result.data.readyAt ?? null) || null,
      target: String(result.data.target ?? null) || null,
      commitSha: (result.data.meta as Record<string, unknown>)?.githubCommitSha as string ?? null,
      commitMessage: (result.data.meta as Record<string, unknown>)?.githubCommitMessage as string ?? null,
    },
  };
}

export async function triggerVercelDeploy(projectId: string, target: string = 'production'): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  // Vercel deploy is triggered by pushing to the connected Git repo
  // We can also use the Deploy Hook if configured
  const envResult = await getEnvVars(projectId);
  if (envResult.ok && envResult.envVars) {
    const hookVar = envResult.envVars.find(v => v.key.includes('DEPLOY_HOOK'));
    if (hookVar) {
      // There's a deploy hook configured — but we can't trigger it this way
      // Instead, check if the project is connected to a Git repo
    }
  }

  // Try to trigger a redeploy of the latest deployment
  const deploymentsResult = await listDeployments(projectId, 1);
  if (deploymentsResult.ok && deploymentsResult.deploys && deploymentsResult.deploys.length > 0) {
    const latestDeploy = deploymentsResult.deploys[0];
    // Can't directly trigger redeploy via API without a deploy hook
    return {
      ok: false,
      error: 'Direct deploy trigger requires a Vercel Deploy Hook URL. Push to the connected Git repository to trigger a deploy automatically.',
    };
  }

  return { ok: false, error: 'No existing deployments found and no deploy hook configured' };
}

export async function rollbackVercelDeploy(projectId: string, deployId: string): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  // Vercel instant rollback via their API
  const result = await vercelFetch<Record<string, unknown>>(
    `/v13/deployments/${encodeURIComponent(deployId)}/instant-rollback`,
    {
      method: 'POST',
      body: { projectId },
    },
  );

  if (!result.ok) {
    return { ok: false, error: result.error ?? 'Rollback failed' };
  }

  return { ok: true, error: null };
}

// ─── Environment Variables ────────────────────────────────────────────

export async function getEnvVars(projectId: string): Promise<VercelToolResult> {
  if (!isConfigured()) return { ok: false, error: 'VERCEL_TOKEN not configured' };

  const result = await vercelFetch<{
    envs: Array<{ key: string; type: string; target: string[] }>;
  }>(`/v9/projects/${encodeURIComponent(projectId)}/env`);

  if (!result.ok || !result.data) return { ok: false, error: result.error };

  const envVars: VercelEnvVar[] = (result.data.envs ?? []).map(e => ({
    key: e.key,
    type: e.type,
    target: e.target,
    configured: true,
  }));

  return { ok: true, error: null, envVars };
}

// ─── Combined Status ──────────────────────────────────────────────────

export async function getFullVercelStatus(): Promise<VercelToolResult> {
  if (!isConfigured()) {
    return { ok: false, error: 'VERCEL_TOKEN not configured — Vercel tool is inactive' };
  }

  const projectsResult = await listProjects();
  if (!projectsResult.ok || !projectsResult.projects?.length) {
    return { ok: false, error: projectsResult.error ?? 'No Vercel projects found' };
  }

  const primaryProject = projectsResult.projects[0];
  const [deploys, envVars] = await Promise.all([
    listDeployments(primaryProject.id, 5),
    getEnvVars(primaryProject.id),
  ]);

  return {
    ok: true,
    error: null,
    projects: projectsResult.projects,
    project: primaryProject,
    deploys: deploys.deploys ?? [],
    envVars: envVars.envVars ?? [],
  };
}
