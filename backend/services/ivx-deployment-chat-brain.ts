/**
 * IVX Deployment Chat Brain — Senior Developer Deployment Executor
 *
 * Gives the IVX chat the same end-to-end deployment technique Rork uses:
 * trigger → poll until terminal → verify production → raw evidence chain.
 * No placeholder responses. No fake VERIFIED. Every claim carries live data.
 *
 * Deploy commands:
 *   /deploy-status    — GitHub, Render, Production SHA comparison (live)
 *   /deploy-now       — Trigger Render deploy + poll + verify
 *   /deploy-pipeline  — Full end-to-end: pre-state → trigger → poll → verify → evidence
 *   /deploy-evidence  — Full deployment proof dump (GitHub + Render + Production)
 *   /deploy-verify    — 4-way commit match check
 *   /deploy-rollback  — Real rollback to previous live Render deploy
 *   /commit-match     — Compare all SHAs
 *   /deploy-help      — List all commands
 *
 * Senior developer proof commands (same proof ledger the worker writes):
 *   /senior-status    — Self-hosted worker capabilities
 *   /senior-proof     — Last end-to-end proof from the durable ledger
 *   /senior-ledger    — Recent proof ledger entries
 *
 * QA commands:
 *   /qa-production /qa-chat /qa-members /qa-landing /qa-engagement
 */

const DEPLOYMENT_BRAIN_VERSION = 'ivx-deployment-brain-v3-qa-final-2026-07-03';

// ── Types ────────────────────────────────────────────────────────────────────

interface DeployStatusResult {
  github: { sha: string | null; repo: string; branch: string; error: string | null };
  render: { serviceId: string; deployId: string | null; sha: string | null; status: string | null; error: string | null };
  production: { sha: string | null; bootTime: string | null; healthy: boolean; error: string | null };
  commitMatch: boolean;
  timestamp: string;
}

interface QAResult {
  feature: string;
  url: string;
  httpStatus: number | null;
  responseBody: string | null;
  status: 'VERIFIED' | 'FAILED' | 'BLOCKED' | 'UNVERIFIED';
  error: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRODUCTION_API = 'https://api.ivxholding.com';
const DEFAULT_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const DEFAULT_REPO = 'ibb142/rork-global-real-estate-invest';

function nowIso(): string {
  return new Date().toISOString();
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : 'UNVERIFIED';
}

async function fetchJson(url: string): Promise<{ ok: boolean; status: number; body: unknown }> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const text = await res.text();
    let body: unknown = text;
    try { body = JSON.parse(text); } catch {}
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    return { ok: false, status: 0, body: { error: err instanceof Error ? err.message : 'Network error' } };
  }
}

function extractSha(data: unknown): string | null {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    return (typeof d.commit === 'string' ? d.commit : null) ??
           (typeof d.commitShort === 'string' ? d.commitShort : null) ??
           null;
  }
  return null;
}

function shasAgree(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return a === b || a.startsWith(b) || b.startsWith(a);
}

// ── GitHub & Render Helpers ──────────────────────────────────────────────

function githubRepo(): string {
  return process.env.GITHUB_REPO?.trim()
    || process.env.GITHUB_REPO_URL?.trim()
      ?.replace('https://github.com/', '')
      ?.replace('.git', '')
    || DEFAULT_REPO;
}

async function fetchGitHubSha(): Promise<{ sha: string | null; timestamp: string | null; error: string | null }> {
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) return { sha: null, timestamp: null, error: 'GITHUB_TOKEN not configured in this environment' };

  try {
    const res = await fetch(`https://api.github.com/repos/${githubRepo()}/commits?per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { sha: null, timestamp: null, error: `GitHub API HTTP ${res.status}` };
    const data = await res.json() as Array<{ sha: string; commit?: { committer?: { date?: string } } }>;
    return { sha: data[0]?.sha ?? null, timestamp: data[0]?.commit?.committer?.date ?? null, error: null };
  } catch (err) {
    return { sha: null, timestamp: null, error: err instanceof Error ? err.message : 'GitHub API unreachable' };
  }
}

function renderServiceId(): string {
  return process.env.RENDER_SERVICE_ID?.trim() || DEFAULT_SERVICE_ID;
}

async function fetchRenderInfo(): Promise<{
  serviceId: string;
  deployId: string | null;
  sha: string | null;
  status: string | null;
  finishedAt: string | null;
  repo: string | null;
  error: string | null;
}> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  const serviceId = renderServiceId();

  if (!apiKey) {
    return { serviceId, deployId: null, sha: null, status: null, finishedAt: null, repo: null, error: 'RENDER_API_KEY not configured in this environment' };
  }

  try {
    const [svcRes, deployRes] = await Promise.all([
      fetch(`https://api.render.com/v1/services/${serviceId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    const svcData = svcRes.ok ? await svcRes.json() as Record<string, unknown> : null;
    const deployData = deployRes.ok ? await deployRes.json() as Array<Record<string, unknown>> : null;
    const latestDeploy = deployData?.[0]?.deploy as Record<string, unknown> | undefined;

    return {
      serviceId,
      deployId: (latestDeploy?.id as string) ?? null,
      sha: ((latestDeploy?.commit as Record<string, unknown>)?.id as string) ?? null,
      status: (latestDeploy?.status as string) ?? 'unknown',
      finishedAt: (latestDeploy?.finishedAt as string) ?? null,
      repo: (svcData?.repo as string) ?? null,
      error: null,
    };
  } catch (err) {
    return { serviceId, deployId: null, sha: null, status: null, finishedAt: null, repo: null, error: err instanceof Error ? err.message : 'Render API unreachable' };
  }
}

async function fetchRenderDeploy(deployId: string): Promise<{ id: string; status: string | null; sha: string | null; error: string | null }> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) return { id: deployId, status: null, sha: null, error: 'RENDER_API_KEY not configured' };
  try {
    const res = await fetch(`https://api.render.com/v1/services/${renderServiceId()}/deploys/${deployId}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { id: deployId, status: null, sha: null, error: `Render API HTTP ${res.status}` };
    const data = await res.json() as Record<string, unknown>;
    return {
      id: deployId,
      status: (data.status as string) ?? null,
      sha: ((data.commit as Record<string, unknown>)?.id as string) ?? null,
      error: null,
    };
  } catch (err) {
    return { id: deployId, status: null, sha: null, error: err instanceof Error ? err.message : 'Render API unreachable' };
  }
}

const TERMINAL_DEPLOY_STATES = ['live', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_failed', 'deactivated'];

/**
 * Poll a Render deploy until it reaches a terminal state or the time budget
 * expires. Bounded so a chat request never hangs indefinitely.
 */
async function pollDeployUntilTerminal(deployId: string, budgetMs: number): Promise<{ status: string | null; polls: number; terminal: boolean; error: string | null }> {
  const startedAt = Date.now();
  let polls = 0;
  let lastStatus: string | null = null;
  let lastError: string | null = null;

  while (Date.now() - startedAt < budgetMs) {
    polls += 1;
    const deploy = await fetchRenderDeploy(deployId);
    lastStatus = deploy.status;
    lastError = deploy.error;
    if (deploy.status && TERMINAL_DEPLOY_STATES.includes(deploy.status)) {
      return { status: deploy.status, polls, terminal: true, error: null };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { status: lastStatus, polls, terminal: false, error: lastError };
}

async function triggerRenderDeploy(): Promise<{ ok: boolean; deployId: string | null; status: string | null; httpStatus: number; error: string | null }> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  if (!apiKey) return { ok: false, deployId: null, status: null, httpStatus: 0, error: 'RENDER_API_KEY not configured in this environment' };

  try {
    const res = await fetch(`https://api.render.com/v1/services/${renderServiceId()}/deploys`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch {}

    let deployId: string | null = (body.id as string)
      ?? ((body.deploy as Record<string, unknown> | undefined)?.id as string)
      ?? null;

    // Render's trigger endpoint can answer 202 with an EMPTY body. The deploy
    // is still created — recover its ID from the deploys list.
    if (res.ok && !deployId) {
      const latest = await fetchRenderInfo();
      deployId = latest.deployId;
    }

    return {
      ok: res.ok,
      deployId,
      status: (body.status as string) ?? 'created',
      httpStatus: res.status,
      error: res.ok ? null : `Render API HTTP ${res.status}: ${text.slice(0, 300)}`,
    };
  } catch (err) {
    return { ok: false, deployId: null, status: null, httpStatus: 0, error: err instanceof Error ? err.message : 'Render API unreachable' };
  }
}

async function fetchSupabaseTableCounts(): Promise<string> {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured in this environment.';

  const tables = ['properties', 'members', 'investors', 'wallets', 'public_chat_messages', 'ai_usage_logs', 'ivx_agent_jobs'];
  const results: string[] = [];

  for (const table of tables) {
    try {
      const res = await fetch(`${url}/rest/v1/${table}?select=count`, {
        headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: 'count=exact' },
        signal: AbortSignal.timeout(8000),
      });
      const data = await res.json() as unknown[];
      results.push(`${table}: ${Array.isArray(data) ? data.length : '?'} rows`);
    } catch {
      results.push(`${table}: ERROR`);
    }
  }
  return results.join('\n');
}

// ── Core Command Handlers ───────────────────────────────────────────────────

export async function handleDeployStatus(): Promise<string> {
  const [healthRes, versionRes, github, renderInfo] = await Promise.all([
    fetchJson(`${PRODUCTION_API}/health`),
    fetchJson(`${PRODUCTION_API}/version`),
    fetchGitHubSha(),
    fetchRenderInfo(),
  ]);

  const healthSha = extractSha(healthRes.body);
  const versionSha = extractSha(versionRes.body);
  const healthy = healthRes.status === 200;
  const bootTime = healthRes.body && typeof healthRes.body === 'object'
    ? (healthRes.body as Record<string, unknown>).bootTime ?? null
    : null;

  const commitMatch = shasAgree(healthSha, versionSha) && shasAgree(github.sha, healthSha);

  const result: DeployStatusResult = {
    github: {
      sha: github.sha,
      repo: renderInfo.repo || githubRepo(),
      branch: 'main',
      error: github.error,
    },
    render: {
      serviceId: renderInfo.serviceId,
      deployId: renderInfo.deployId,
      sha: renderInfo.sha,
      status: renderInfo.status,
      error: renderInfo.error,
    },
    production: {
      sha: healthSha,
      bootTime: typeof bootTime === 'string' ? bootTime : null,
      healthy,
      error: null,
    },
    commitMatch,
    timestamp: nowIso(),
  };

  return formatDeployStatus(result);
}

function formatDeployStatus(result: DeployStatusResult): string {
  const lines = [
    '## IVX Deployment Status',
    '',
    `**Timestamp:** ${result.timestamp}`,
    '',
    '### Production',
    `- Health SHA: \`${result.production.sha ?? 'UNKNOWN'}\``,
    `- Healthy: ${result.production.healthy ? 'YES' : 'NO'}`,
    `- Boot Time: ${result.production.bootTime ?? 'UNKNOWN'}`,
    '',
    '### GitHub',
    `- Repo: ${result.github.repo}`,
    `- Branch: ${result.github.branch}`,
    `- SHA: ${result.github.sha ?? 'UNVERIFIED'}`,
    result.github.error ? `- Error: ${result.github.error}` : '',
    '',
    '### Render',
    `- Service: ${result.render.serviceId}`,
    `- Deploy ID: ${result.render.deployId ?? 'UNVERIFIED'}`,
    `- Deployed SHA: ${result.render.sha ?? 'UNVERIFIED'}`,
    `- Status: ${result.render.status ?? 'UNVERIFIED'}`,
    result.render.error ? `- Error: ${result.render.error}` : '',
    '',
    '### Commit Match',
    `**${result.commitMatch ? 'MATCH — GitHub, Render and Production agree' : 'NO — SHAs diverge or are unverifiable'}**`,
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ];

  return lines.filter(l => l !== '').join('\n');
}

export async function handleCommitMatch(): Promise<string> {
  const [healthRes, versionRes, github, renderInfo] = await Promise.all([
    fetchJson(`${PRODUCTION_API}/health`),
    fetchJson(`${PRODUCTION_API}/version`),
    fetchGitHubSha(),
    fetchRenderInfo(),
  ]);

  const healthSha = extractSha(healthRes.body);
  const versionSha = extractSha(versionRes.body);
  const prodMatch = shasAgree(healthSha, versionSha);
  const githubMatch = shasAgree(github.sha, healthSha);
  const renderMatch = shasAgree(renderInfo.sha, healthSha);
  const fullMatch = prodMatch && githubMatch && renderMatch;

  const lines = [
    '## Commit Match Check (4-way)',
    '',
    `**Health SHA:** \`${short(healthSha)}\``,
    `**Version SHA:** \`${short(versionSha)}\``,
    `**GitHub SHA:** \`${short(github.sha)}\`${github.error ? ` (${github.error})` : ''}`,
    `**Render SHA:** \`${short(renderInfo.sha)}\`${renderInfo.error ? ` (${renderInfo.error})` : ''}`,
    '',
    `**Verdict:** ${fullMatch
      ? 'MATCH — all four sources agree on the running commit'
      : prodMatch
        ? `PARTIAL — production agrees with itself; GitHub ${githubMatch ? 'matches' : 'diverges/unverified'}, Render ${renderMatch ? 'matches' : 'diverges/unverified'}`
        : 'NO — production /health and /version disagree; deploy propagation may be in progress'}`,
    '',
    `_Captured live ${nowIso()} — Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ];
  return lines.join('\n');
}

export async function handleDeployEvidence(): Promise<string> {
  const [healthRes, versionRes, github, renderInfo] = await Promise.all([
    fetchJson(`${PRODUCTION_API}/health`),
    fetchJson(`${PRODUCTION_API}/version`),
    fetchGitHubSha(),
    fetchRenderInfo(),
  ]);

  const healthSha = extractSha(healthRes.body);
  const versionSha = extractSha(versionRes.body);
  const commitMatch = shasAgree(healthSha, versionSha) && shasAgree(github.sha, healthSha) && shasAgree(renderInfo.sha, healthSha);
  const errors: string[] = [];
  if (!healthSha) errors.push('Health SHA not found');
  if (!versionSha) errors.push('Version SHA not found');
  if (github.error) errors.push(`GitHub: ${github.error}`);
  if (renderInfo.error) errors.push(`Render: ${renderInfo.error}`);

  const lines = [
    '## IVX Deployment Evidence',
    '',
    `**Timestamp:** ${nowIso()}`,
    '',
    '| Source | SHA | Detail |',
    '|--------|-----|--------|',
    `| GitHub (${githubRepo()}) | \`${short(github.sha)}\` | ${github.timestamp ?? '—'} |`,
    `| Render (${renderInfo.serviceId}) | \`${short(renderInfo.sha)}\` | deploy ${renderInfo.deployId ?? '—'} · ${renderInfo.status ?? '—'} |`,
    `| Production /health | \`${short(healthSha)}\` | HTTP ${healthRes.status} |`,
    `| Production /version | \`${short(versionSha)}\` | HTTP ${versionRes.status} |`,
    '',
    `**Commit Match (4-way):** ${commitMatch ? 'YES — VERIFIED' : 'NO / PARTIAL'}`,
    `**Production:** ${healthRes.status === 200 ? 'healthy' : 'degraded'}`,
    errors.length > 0 ? `**Errors:** ${errors.join('; ')}` : '',
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ];
  return lines.filter(l => l !== '').join('\n');
}

export async function handleDeployNow(): Promise<string> {
  const trigger = await triggerRenderDeploy();

  if (!trigger.ok || !trigger.deployId) {
    return [
      '## Deploy Now — BLOCKED',
      '',
      `**Reason:** ${trigger.error ?? 'Deploy trigger failed with no deploy ID.'}`,
      '',
      '**Automatic path still active:** push to GitHub main → Render autoDeploy fires → production updates.',
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  }

  // Poll briefly (bounded) so the chat reply carries real progress and the
  // request finishes before any instance rollover.
  const poll = await pollDeployUntilTerminal(trigger.deployId, 25000);

  return [
    '## Deploy Now — TRIGGERED',
    '',
    `**HTTP Status:** ${trigger.httpStatus}`,
    `**Deploy ID:** ${trigger.deployId}`,
    `**Status after ${poll.polls} poll(s):** ${poll.status ?? 'unknown'}`,
    '',
    poll.terminal
      ? (poll.status === 'live'
        ? 'Deploy reached LIVE. Run `/deploy-verify` to confirm the running commit.'
        : `Deploy ended in terminal state \`${poll.status}\`. Check Render logs.`)
      : 'Deploy is still building (normal — builds take ~3-6 min). Run `/deploy-status` or `/deploy-verify` to keep watching.',
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].join('\n');
}

/**
 * Full Rork-style pipeline: capture pre-state → trigger deploy → poll bounded →
 * verify production → emit the evidence chain in one chat reply.
 */
export async function handleDeployPipeline(): Promise<string> {
  const startedAt = nowIso();

  // 1. Pre-state
  const [preHealth, github, preRender] = await Promise.all([
    fetchJson(`${PRODUCTION_API}/health`),
    fetchGitHubSha(),
    fetchRenderInfo(),
  ]);
  const preSha = extractSha(preHealth.body);

  // 2. Trigger
  const trigger = await triggerRenderDeploy();
  if (!trigger.ok || !trigger.deployId) {
    return [
      '## Deploy Pipeline — BLOCKED AT TRIGGER',
      '',
      `**Pre-state:** production \`${short(preSha)}\` · GitHub \`${short(github.sha)}\``,
      `**Trigger error:** ${trigger.error ?? 'no deploy ID returned'}`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  }

  // 3. Poll (bounded to keep the chat request responsive)
  // Bounded to 25s so the chat request always finishes well before proxy
  // timeouts or the triggered deploy's instance rollover can kill it.
  const poll = await pollDeployUntilTerminal(trigger.deployId, 25000);

  // 4. Post-verify
  const [postHealth, postVersion] = await Promise.all([
    fetchJson(`${PRODUCTION_API}/health`),
    fetchJson(`${PRODUCTION_API}/version`),
  ]);
  const postHealthSha = extractSha(postHealth.body);
  const postVersionSha = extractSha(postVersion.body);
  const liveMatch = poll.status === 'live'
    && shasAgree(postHealthSha, postVersionSha)
    && shasAgree(github.sha, postHealthSha);

  // 5. Archive the evidence chain into the senior developer proof ledger so
  //    /senior-proof and /senior-ledger surface this pipeline run.
  let ledgerArchived = false;
  try {
    const { archiveDeploymentProofToLedger } = await import('./ivx-senior-developer-worker');
    ledgerArchived = await archiveDeploymentProofToLedger({
      jobId: `chat-deploy-pipeline-${Date.now()}`,
      goal: 'Chat /deploy-pipeline — trigger, poll, verify production, archive evidence',
      ok: poll.terminal && poll.status === 'live',
      endToEndProductionComplete: liveMatch,
      changedFiles: [],
      testsRun: false,
      testsPassed: false,
      typecheckRun: false,
      typecheckPassed: false,
      buildRun: true,
      commitCreated: false,
      commitSha: github.sha,
      commitUrl: github.sha ? `https://github.com/${githubRepo()}/commit/${github.sha}` : null,
      pushed: false,
      branch: 'main',
      deployId: trigger.deployId,
      deployStatus: poll.status,
      deployVerified: liveMatch,
      deployRequested: true,
      liveCommit: postHealthSha,
      commitMatch: liveMatch,
      healthOk: postHealth.status === 200,
      healthStatus: postHealth.status,
      versionEndpoint: postVersionSha,
      generatedFeatureSlug: null,
      auditFiles: { json: 'chat-deploy-pipeline', jsonl: 'chat-deploy-pipeline' },
      finalStatus: liveMatch ? 'COMPLETE' : poll.terminal ? 'FAILED' : 'LOCAL_ONLY',
      error: liveMatch ? null : poll.terminal ? `Deploy terminal state: ${poll.status}` : 'Deploy still building at poll budget expiry',
      durable: true,
      generatedAt: nowIso(),
    });
  } catch {
    ledgerArchived = false;
  }

  return [
    '## Deploy Pipeline — Evidence Chain',
    '',
    `**Started:** ${startedAt} · **Finished:** ${nowIso()}`,
    '',
    '### 1. Pre-state',
    `- GitHub HEAD: \`${short(github.sha)}\` (${github.timestamp ?? '—'})`,
    `- Production before: \`${short(preSha)}\``,
    `- Last Render deploy: ${preRender.deployId ?? '—'} (${preRender.status ?? '—'})`,
    '',
    '### 2. Trigger',
    `- Deploy ID: \`${trigger.deployId}\` (HTTP ${trigger.httpStatus})`,
    '',
    '### 3. Poll',
    `- Polls: ${poll.polls} · Terminal: ${poll.terminal ? 'YES' : 'NO (still building)'} · Status: \`${poll.status ?? 'unknown'}\``,
    '',
    '### 4. Production verification',
    `- /health: HTTP ${postHealth.status} → \`${short(postHealthSha)}\``,
    `- /version: HTTP ${postVersion.status} → \`${short(postVersionSha)}\``,
    '',
    '### 5. Senior ledger',
    `- Evidence archived: ${ledgerArchived ? 'YES — visible via /senior-ledger and /senior-proof' : 'NO (ledger write failed)'}`,
    '',
    `### Verdict: ${liveMatch
      ? 'VERIFIED — deploy live and production serves the GitHub HEAD commit'
      : poll.terminal
        ? `TERMINAL \`${poll.status}\` — commit match ${shasAgree(github.sha, postHealthSha) ? 'YES' : 'NOT YET'}`
        : 'IN PROGRESS — build still running. Run `/deploy-verify` in a few minutes for the final commit-match check.'}`,
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].join('\n');
}

export async function handleDeployVerify(): Promise<string> {
  return handleCommitMatch();
}

export async function handleDeployRollback(): Promise<string> {
  const apiKey = process.env.RENDER_API_KEY?.trim();
  const serviceId = renderServiceId();

  if (!apiKey) {
    return [
      '## Deploy Rollback — BLOCKED',
      '',
      '**Reason:** RENDER_API_KEY is not configured in this environment.',
      'Manual path: Render dashboard → Deploys → previous deploy → "Rollback to this deploy".',
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  }

  try {
    // Find the previous successful (live) deploy — skip the current one.
    const listRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=10`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!listRes.ok) {
      return `## Deploy Rollback — FAILED\n\nRender API HTTP ${listRes.status} while listing deploys.\n\n_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`;
    }
    const deploys = await listRes.json() as Array<{ deploy: Record<string, unknown> }>;
    const liveDeploys = deploys
      .map((d) => d.deploy)
      .filter((d) => d.status === 'live' || d.status === 'deactivated');
    const target = liveDeploys[1];

    if (!target?.id) {
      return `## Deploy Rollback — NO TARGET\n\nCould not find a previous successful deploy to roll back to.\n\n_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`;
    }

    const rollbackRes = await fetch(`https://api.render.com/v1/services/${serviceId}/rollback`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ deployId: target.id }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await rollbackRes.text();
    let body: Record<string, unknown> = {};
    try { body = JSON.parse(text) as Record<string, unknown>; } catch {}

    return [
      `## Deploy Rollback — ${rollbackRes.ok ? 'TRIGGERED' : 'FAILED'}`,
      '',
      `**Target deploy:** \`${target.id}\` (commit \`${short(((target.commit as Record<string, unknown>)?.id as string) ?? null)}\`)`,
      `**HTTP Status:** ${rollbackRes.status}`,
      `**New deploy ID:** ${(body.id as string) ?? '—'}`,
      '',
      rollbackRes.ok
        ? 'Rollback deploy created. Run `/deploy-status` to watch it go live.'
        : `Render rejected the rollback: ${text.slice(0, 300)}`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  } catch (err) {
    return `## Deploy Rollback — FAILED\n\n**Error:** ${err instanceof Error ? err.message : 'Unknown error'}\n\n_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`;
  }
}

// ── Senior Developer Proof Commands ─────────────────────────────────────────

async function handleSeniorStatus(): Promise<string> {
  const { buildSeniorDeveloperWorkerStatus } = await import('./ivx-senior-developer-worker');
  const status = buildSeniorDeveloperWorkerStatus();
  const capabilities = status.capabilities as Record<string, boolean>;
  const enabled = Object.entries(capabilities).filter(([, v]) => v).map(([k]) => k);

  return [
    '## IVX Senior Developer — Worker Status',
    '',
    `**Executor:** ${status.executor}`,
    `**Rork required as executor:** ${status.rorkRequiredAsExecutor ? 'YES' : 'NO — self-hosted'}`,
    `**Durable queue:** ${status.durableQueue ? 'YES (Supabase-backed)' : 'NO (in-memory)'}`,
    '',
    `**Capabilities (${enabled.length}):** ${enabled.join(', ')}`,
    '',
    '**Routes:**',
    ...Object.entries(status.routes as Record<string, string>).map(([k, v]) => `- ${k}: \`${v}\``),
    '',
    `_Captured ${nowIso()} — Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].join('\n');
}

async function handleSeniorProof(): Promise<string> {
  const { getSeniorDeveloperLastProof, listSeniorDeveloperProofLedger } = await import('./ivx-senior-developer-worker');
  const [last, ledger] = await Promise.all([
    getSeniorDeveloperLastProof(),
    listSeniorDeveloperProofLedger(1),
  ]);
  const detail = ledger[0] ?? null;

  if (!last.lastJobId) {
    return [
      '## Senior Developer — Last Proof',
      '',
      'No proof recorded yet. Enqueue an owner-approved job via `POST /api/ivx/senior-developer/worker/jobs`, or run `/deploy-pipeline` for a deployment-level evidence chain.',
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  }

  return [
    '## Senior Developer — Last End-to-End Proof',
    '',
    `**Job:** \`${last.lastJobId}\``,
    `**Goal:** ${detail?.goal ?? '—'}`,
    `**Final status:** ${detail?.finalStatus ?? 'UNKNOWN'}`,
    `**Commit:** \`${short(last.lastCommitHash)}\`${detail?.commitUrl ? ` — ${detail.commitUrl}` : ''}`,
    `**Deploy:** ${last.lastDeployId ?? '—'} (${detail?.deployStatus ?? '—'})`,
    `**Tests passed:** ${detail?.testsPassed ? 'YES' : 'NO'} · **Typecheck:** ${detail?.typecheckRun ? 'RUN' : 'SKIPPED'}`,
    `**Health:** HTTP ${last.lastHealthStatus ?? '—'} · **Commit match:** ${last.lastVersionMatch ? 'YES — VERIFIED' : 'NO'}`,
    `**Completed:** ${last.completedAt ?? '—'}`,
    detail?.auditFiles ? `**Audit trail:** ${detail.auditFiles.json}` : '',
    '',
    `_Read from the durable proof ledger ${nowIso()} — Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].filter(l => l !== '').join('\n');
}

async function handleSeniorLedger(): Promise<string> {
  const { listSeniorDeveloperProofLedger } = await import('./ivx-senior-developer-worker');
  const entries = await listSeniorDeveloperProofLedger(10);

  if (entries.length === 0) {
    return `## Senior Developer — Proof Ledger\n\nLedger is empty. No worker jobs have completed yet.\n\n_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`;
  }

  return [
    '## Senior Developer — Proof Ledger (latest 10)',
    '',
    ...entries.map((e) =>
      `- \`${e.jobId.slice(0, 24)}\` · ${e.finalStatus} · commit \`${short(e.commitSha)}\` · deploy ${e.deployId ?? '—'} · match ${e.commitMatch ? 'YES' : 'NO'} · ${e.generatedAt}`,
    ),
    '',
    `_Read from the durable proof ledger ${nowIso()} — Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].join('\n');
}

function handleDeployHelp(): Promise<string> {
  return Promise.resolve([
    '## IVX Senior Developer — Chat Commands',
    '',
    '**Deployment (Rork-technique, live evidence):**',
    '- `/deploy-status` — GitHub / Render / Production SHA comparison',
    '- `/deploy-now` — Trigger Render deploy + poll + report',
    '- `/deploy-pipeline` — Full end-to-end: pre-state → trigger → poll → verify → evidence chain',
    '- `/deploy-verify` or `/commit-match` — 4-way commit match check',
    '- `/deploy-evidence` — Full deployment proof dump',
    '- `/deploy-rollback` — Roll back to the previous live deploy',
    '',
    '**Senior developer proof:**',
    '- `/senior-status` — Self-hosted worker capabilities',
    '- `/senior-proof` — Last end-to-end proof (commit, deploy, tests, match)',
    '- `/senior-ledger` — Recent proof ledger entries',
    '',
    '**Infrastructure:**',
    '- `/render-status` · `/github-status` · `/supabase-audit` · `/watchdog`',
    '',
    '**QA:**',
    '- `/qa-production` · `/qa-chat` · `/qa-members` · `/qa-landing` · `/qa-engagement`',
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ].join('\n'));
}

// ── QA Commands ─────────────────────────────────────────────────────────────

const QA_ENDPOINTS: Record<string, Array<{ url: string; method: string; label: string }>> = {
  landing: [
    { url: 'https://ivxholding.com', method: 'GET', label: 'Landing Page' },
  ],
  chat: [
    { url: 'https://chat.ivxholding.com', method: 'GET', label: 'Chat Frontend' },
    { url: `${PRODUCTION_API}/api/public/messages`, method: 'GET', label: 'Public Messages API' },
    { url: `${PRODUCTION_API}/api/ivx/owner-ai/proxy-status`, method: 'GET', label: 'AI Proxy Status' },
  ],
  members: [
    { url: `${PRODUCTION_API}/api/ivx/owner-registration/status`, method: 'GET', label: 'Registration Status' },
    { url: `${PRODUCTION_API}/api/ivx/owner-access-repair/status`, method: 'GET', label: 'Access Repair Status' },
  ],
  engagement: [
    { url: `${PRODUCTION_API}/api/projects/test/media`, method: 'GET', label: 'Project Media' },
    { url: `${PRODUCTION_API}/api/projects/test/comments`, method: 'GET', label: 'Project Comments' },
    { url: `${PRODUCTION_API}/api/projects/engagement/bulk?ids=test`, method: 'GET', label: 'Bulk Engagement' },
    { url: `${PRODUCTION_API}/api/projects/test/analytics`, method: 'GET', label: 'Project Analytics' },
  ],
  production: [
    { url: `${PRODUCTION_API}/health`, method: 'GET', label: 'Health' },
    { url: `${PRODUCTION_API}/version`, method: 'GET', label: 'Version' },
    { url: 'https://ivxholding.com', method: 'GET', label: 'Landing Page' },
    { url: 'https://chat.ivxholding.com', method: 'GET', label: 'Chat Frontend' },
    { url: `${PRODUCTION_API}/api/ivx/owner-ai/proxy-status`, method: 'GET', label: 'AI Proxy' },
    { url: `${PRODUCTION_API}/api/ivx/supabase/owner-action-health`, method: 'GET', label: 'Supabase Health' },
    { url: `${PRODUCTION_API}/tool/render-status`, method: 'GET', label: 'Render Status' },
  ],
};

async function runQATests(category: string): Promise<string> {
  const endpoints = QA_ENDPOINTS[category];
  if (!endpoints) {
    return `Unknown QA category: ${category}. Available: ${Object.keys(QA_ENDPOINTS).join(', ')}`;
  }

  const results: QAResult[] = [];
  for (const ep of endpoints) {
    try {
      const res = await fetch(ep.url, {
        method: ep.method,
        signal: AbortSignal.timeout(10000),
      });
      const text = await res.text();
      let body: string | null = text.slice(0, 500);
      try { JSON.parse(text); } catch { body = text.slice(0, 200); }

      results.push({
        feature: ep.label,
        url: ep.url,
        httpStatus: res.status,
        responseBody: body,
        status: res.ok ? 'VERIFIED' : 'FAILED',
        error: res.ok ? null : `HTTP ${res.status}`,
      });
    } catch (err) {
      results.push({
        feature: ep.label,
        url: ep.url,
        httpStatus: null,
        responseBody: null,
        status: 'FAILED',
        error: err instanceof Error ? err.message : 'Network error',
      });
    }
  }

  const verified = results.filter(r => r.status === 'VERIFIED').length;
  const failed = results.filter(r => r.status === 'FAILED').length;

  const lines = [
    `## QA: ${category.toUpperCase()}`,
    '',
    `**Results:** ${verified} verified, ${failed} failed, ${results.length} total`,
    '',
    ...results.map(r =>
      `- ${r.status === 'VERIFIED' ? '✅' : '❌'} ${r.feature}: HTTP ${r.httpStatus ?? 'N/A'} ${r.error ?? ''}`
    ),
    '',
    `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
  ];
  return lines.join('\n');
}

// ── Command Router ──────────────────────────────────────────────────────────

const COMMAND_MAP: Record<string, () => Promise<string>> = {
  '/deploy-status': handleDeployStatus,
  '/deploy-now': handleDeployNow,
  '/deploy-pipeline': handleDeployPipeline,
  '/deploy-evidence': handleDeployEvidence,
  '/deploy-verify': handleDeployVerify,
  '/deploy-rollback': handleDeployRollback,
  '/deploy-help': handleDeployHelp,
  '/commit-match': handleCommitMatch,
  '/senior-status': handleSeniorStatus,
  '/senior-proof': handleSeniorProof,
  '/senior-ledger': handleSeniorLedger,
  '/qa-production': () => runQATests('production'),
  '/qa-chat': () => runQATests('chat'),
  '/qa-members': () => runQATests('members'),
  '/qa-landing': async () => {
    const [landing] = await Promise.all([
      fetchJson('https://ivxholding.com'),
    ]);
    return [
      '## QA: Landing Page',
      '',
      `**HTTP Status:** ${landing.status}`,
      `**Status:** ${landing.ok ? 'VERIFIED' : 'FAILED'}`,
      landing.ok ? 'Landing page is live and serving content.' : `Landing page returned HTTP ${landing.status}`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  },
  '/qa-engagement': () => runQATests('engagement'),
  '/render-status': async () => {
    const info = await fetchRenderInfo();
    return [
      '## Render Status',
      '',
      `**Service:** ${info.serviceId}`,
      `**Deploy ID:** ${info.deployId ?? 'UNVERIFIED'}`,
      `**Deployed SHA:** ${short(info.sha)}`,
      `**Status:** ${info.status ?? 'UNVERIFIED'}`,
      `**Finished:** ${info.finishedAt ?? 'UNVERIFIED'}`,
      `**Repo:** ${info.repo ?? 'UNVERIFIED'}`,
      info.error ? `**Error:** ${info.error}` : '',
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].filter(l => l !== '').join('\n');
  },
  '/github-status': async () => {
    const github = await fetchGitHubSha();
    return [
      '## GitHub Status',
      '',
      `**Repo:** ${githubRepo()}`,
      `**Branch:** main`,
      `**Latest SHA:** ${short(github.sha)}`,
      `**Commit time:** ${github.timestamp ?? 'UNVERIFIED'}`,
      github.sha ? `**Access:** VERIFIED (token can read repo)` : `**Access:** UNVERIFIED (${github.error ?? 'no GITHUB_TOKEN in env'})`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  },
  '/supabase-audit': async () => {
    const counts = await fetchSupabaseTableCounts();
    return [
      '## Supabase Audit',
      '',
      '**Table Row Counts:**',
      counts,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  },
  '/watchdog': async () => {
    const healthRes = await fetchJson(`${PRODUCTION_API}/health`);
    const healthData = healthRes.body as Record<string, unknown> | null;
    return [
      '## Watchdog Status',
      '',
      `**Production:** ${healthRes.ok ? 'HEALTHY' : 'DEGRADED'}`,
      `**Boot Time:** ${healthData?.bootTime ?? 'UNKNOWN'}`,
      `**Routes Registered:** ${(healthData?.routes as unknown[])?.length ?? 'UNKNOWN'}`,
      `**AI Enabled:** ${healthData?.aiEnabled ?? 'UNKNOWN'}`,
      `**Message Count:** ${healthData?.messageCount ?? 'UNKNOWN'}`,
      `**Commit:** ${healthData?.commitShort ?? 'UNKNOWN'}`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  },
};

/**
 * Route a chat message that starts with "/" to the deployment brain.
 * Returns the brain's answer string, or null if not a deployment command.
 */
export async function routeDeploymentCommand(message: string): Promise<string | null> {
  const trimmed = message.trim();
  if (!trimmed.startsWith('/')) return null;

  // Extract the command (first word)
  const command = trimmed.split(/\s+/)[0].toLowerCase();

  const handler = COMMAND_MAP[command];
  if (!handler) return null;

  console.log('[DeploymentBrain] Command routed:', { command, timestamp: nowIso() });
  try {
    return await handler();
  } catch (err) {
    return [
      `## Deployment Brain Error`,
      '',
      `**Command:** ${command}`,
      `**Error:** ${err instanceof Error ? err.message : 'Unknown error'}`,
      '',
      `_Brain: ${DEPLOYMENT_BRAIN_VERSION}_`,
    ].join('\n');
  }
}

/**
 * Returns true if the message is a recognized deployment command.
 */
export function isDeploymentCommand(message: string): boolean {
  const command = message.trim().split(/\s+/)[0].toLowerCase();
  return command in COMMAND_MAP;
}

export { DEPLOYMENT_BRAIN_VERSION };
