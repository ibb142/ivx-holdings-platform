/**
 * IVX Enterprise Deployment Engine API Routes
 *
 * Public:  GET  /api/ivx/deploy/status  — deployment state (no secrets)
 * Public:  GET  /api/ivx/deploy/evidence — read-only latest evidence
 * Auth:    POST /api/ivx/deploy/trigger — explicit owner deploy
 * Auth:    POST /api/ivx/deploy/verify  — verify production
 * Auth:    POST /api/ivx/deploy/cycle   — disabled; GitHub governor is automatic authority
 * Auth:    POST /api/ivx/deploy/monitor/start — disabled; prevents autonomous redeploy loops
 * Auth:    POST /api/ivx/deploy/monitor/stop  — stop legacy in-process monitor
 */
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import {
  type DeploymentEvidence,
  getDeploymentState,
  initializeDeploymentEngine,
  triggerRenderDeploy,
  getGitHubHeadSha,
  getProductionHealth,
  verifyCommitMatch,
  discoverCredentials,
  generateEvidenceReport,
  stopAutonomousMonitor,
} from '../services/ivx-enterprise-deployment-engine';

// ─── CORS Helpers ──────────────────────────────────────────────────────

const PUBLIC_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
} as const;

function publicJson(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: PUBLIC_HEADERS });
}

// ─── OPTIONS ────────────────────────────────────────────────────────────

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}

// ─── PUBLIC: Deployment Status ──────────────────────────────────────────

export async function handleDeployStatus(): Promise<Response> {
  await initializeDeploymentEngine();
  const state = getDeploymentState();

  return publicJson({
    ok: true,
    initialized: state.initialized,
    autonomousMode: state.autonomousMode,
    driftDetected: state.driftDetected,
    lastCheck: state.lastCheck,
    lastDeploy: state.lastDeploy,
    deploymentCount: state.deploymentHistory.length,
    credentialCount: state.credentials.length,
    credentialsValid: state.credentials.filter(c => c.status === 'valid').length,
    credentialsMasked: state.credentials.map(c => ({ name: c.name, status: c.status, masked: c.masked })),
    currentEvidence: state.currentEvidence,
    timestamp: new Date().toISOString(),
  });
}

// ─── PUBLIC: Deployment Evidence (STRICTLY READ-ONLY) ──────────────────

export async function handleDeployEvidence(): Promise<Response> {
  // Never call runDeploymentCycle()/generateDeploymentEvidence() from a GET.
  // Those legacy helpers can trigger a Render deploy when drift is observed.
  const [github, prod, match] = await Promise.all([
    getGitHubHeadSha(),
    getProductionHealth(),
    verifyCommitMatch(),
  ]);
  const state = getDeploymentState();
  const latest = state.lastDeploy;
  const generatedAt = new Date().toISOString();
  const evidence: DeploymentEvidence = {
    generatedAt,
    githubHead: github.sha ? github.sha.slice(0, 8) : null,
    renderDeployId: latest?.id ?? null,
    renderDeployStatus: latest?.status ?? null,
    renderCommitSha: latest?.commitSha ?? null,
    productionCommitSha: prod.commitShort || (prod.commit ? prod.commit.slice(0, 8) : null),
    commitMatch: match.match,
    healthStatus: prod.status,
    deployDuration: latest?.duration ?? null,
    errors: [github.error, prod.error, match.error].filter((value): value is string => Boolean(value)),
    blockers: [],
    finalStatus: match.match && prod.ok ? 'COMPLETE' : 'UNVERIFIED',
  };

  return publicJson({
    ok: true,
    readOnly: true,
    evidence,
    report: generateEvidenceReport(evidence),
    timestamp: generatedAt,
  });
}

// ─── AUTH: Trigger Deploy (EXPLICIT OWNER ACTION ONLY) ─────────────────

export async function handleDeployTrigger(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const clearCache = false;
  const trigger = await triggerRenderDeploy(clearCache);

  if (!trigger.ok || !trigger.deploy) {
    return ownerOnlyJson({
      ok: false,
      error: trigger.error ?? 'Failed to trigger deploy',
      deploy: trigger.deploy,
    }, 502);
  }

  return ownerOnlyJson({
    ok: true,
    deploy: trigger.deploy,
    message: `Deploy triggered: ${trigger.deploy.id}`,
    timestamp: new Date().toISOString(),
  });
}

// ─── AUTH: Verify Production ───────────────────────────────────────────

export async function handleDeployVerify(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const [github, prod, match] = await Promise.all([
    getGitHubHeadSha(),
    getProductionHealth(),
    verifyCommitMatch(),
  ]);

  return ownerOnlyJson({
    ok: true,
    github,
    production: prod,
    commitMatch: match,
    timestamp: new Date().toISOString(),
  });
}

// ─── AUTH: Automatic Cycle Disabled ────────────────────────────────────

export async function handleDeployCycle(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  // Enforce one automatic deployment authority. The GitHub Actions
  // IVX Production Deploy Governor owns automatic exact-SHA deployment.
  // A legacy in-process cycle could otherwise see a rolling instance with an
  // older /health SHA and recursively redeploy the same commit.
  stopAutonomousMonitor();
  return ownerOnlyJson({
    ok: false,
    deployTriggered: false,
    error: 'Automatic backend deployment cycle disabled. IVX Production Deploy Governor is the single automatic deployment authority.',
    timestamp: new Date().toISOString(),
  }, 409);
}

// ─── AUTH: Credentials Audit ───────────────────────────────────────────

export async function handleDeployCredentialsAudit(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const credentials = await discoverCredentials();

  return ownerOnlyJson({
    ok: true,
    credentials: credentials.map(c => ({
      name: c.name,
      status: c.status,
      present: c.present,
      source: c.source,
      tested: c.tested,
      testResult: c.testResult,
      masked: c.masked,
    })),
    validCount: credentials.filter(c => c.status === 'valid').length,
    totalCount: credentials.length,
    timestamp: new Date().toISOString(),
  });
}

// ─── AUTH: Monitor Control ─────────────────────────────────────────────

export async function handleDeployMonitorStart(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  // Kill any monitor that may already exist in this process and refuse to
  // recreate it. This closes the verified same-SHA Render redeploy loop.
  stopAutonomousMonitor();
  return ownerOnlyJson({
    ok: false,
    error: 'Legacy in-process autonomous deployment monitor disabled. IVX Production Deploy Governor is the single automatic deployment authority.',
    autonomousMode: false,
    timestamp: new Date().toISOString(),
  }, 409);
}

export async function handleDeployMonitorStop(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  stopAutonomousMonitor();
  const state = getDeploymentState();

  return ownerOnlyJson({
    ok: true,
    message: 'Autonomous deployment monitor stopped',
    autonomousMode: state.autonomousMode,
    timestamp: new Date().toISOString(),
  });
}

// ─── PUBLIC: Health + Version (for external verification) ──────────────

export async function handleDeployHealth(): Promise<Response> {
  const [prod, match] = await Promise.all([
    getProductionHealth(),
    verifyCommitMatch(),
  ]);

  return publicJson({
    ok: prod.ok,
    status: prod.status ?? 'unknown',
    productionCommit: prod.commitShort || prod.commit,
    productionBootTime: prod.bootTime,
    commitMatch: match.match,
    githubHead: match.githubSha,
    productionSha: match.productionSha,
    timestamp: new Date().toISOString(),
  });
}
