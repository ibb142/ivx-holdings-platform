/**
 * IVX GLOBAL CERTIFICATION SUPERVISOR — Autonomous is the senior supervisor of
 * the ENTIRE IVX system (owner mandate 2026-08-28).
 *
 * Owner bug being fixed: Autonomous (112 IA / radar / nervous) declared the
 * system healthy on a SHA where OTHER required workflows were RED on the SAME
 * SHA (verified example: 42a985d1 — 112 Agent Utilization Repair SUCCESS while
 * Live Brain E2E Builder, QA Suite, E2E, Control Tower, 10/10 were FAILURE).
 *
 * Invariants enforced here (no exceptions, fail-closed):
 *   1. For every MAIN SHA, collect the status of EVERY required certification
 *      workflow (cross-workflow SAME-SHA correlation).
 *   2. ANY required workflow FAILURE / CANCELLED / TIMED_OUT / STARTUP_FAILURE
 *      on MAIN_SHA  =>  GLOBAL STATUS RED.
 *   3. SHA parity invariant:
 *      MAIN_SHA = QA_SHA = 112_IA_SHA = E2E_SHA = RADAR_SHA =
 *      NERVOUS_SYSTEM_SHA = PRODUCTION_SHA. Any difference => RED.
 *   4. While even ONE required gate is RED, Autonomous can never issue
 *      GREEN / CERTIFIED / 10/10 / HEALTHY / COMPLETE from this module.
 *   5. Every RED automatically opens a real repair mission in the
 *      ivx-senior-developer-worker (low-risk diagnose + patch; git deploy and
 *      other high-risk operations remain OWNER-GATED).
 *   6. If the collector cannot read GitHub Actions (no token / API failure),
 *      status degrades to PENDING — NEVER to GREEN (fail-closed).
 */

export const IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER =
  'ivx-global-certification-supervisor-v1-2026-08-28';

/**
 * Required certification workflows — the SHA-parity chain. A single missing,
 * skipped, in-progress or failed gate blocks certification of MAIN_SHA.
 * Names must match the workflow `name:` (or run display name) exactly.
 */
export const REQUIRED_CERTIFICATION_WORKFLOWS: ReadonlyArray<{
  name: string;
  gate: 'CI' | 'QA' | 'SECRET_LEAK' | 'IA_112' | 'E2E' | 'RADAR' | 'NERVOUS' | 'AUTO_DEPLOY_CERT' | 'RENDER_STATUS' | 'RENDER_CERT' | 'WAR_ROOM_112' | 'EARLY_WARNING' | 'FOUR_PHASE' | 'REELS';
}> = [
  { name: 'IVX CI', gate: 'CI' },
  { name: 'IVX QA Suite', gate: 'QA' },
  { name: 'IVX Secret Leak Scanner', gate: 'SECRET_LEAK' },
  { name: 'IVX 112 Agent Utilization Repair', gate: 'IA_112' },
  { name: 'IVX E2E Acceptance Pipeline', gate: 'E2E' },
  { name: 'IVX Autonomous Radar Self-Heal', gate: 'RADAR' },
  { name: 'IVX Autonomous Nervous System', gate: 'NERVOUS' },
  { name: 'IVX 112 Exact SHA Auto-Deploy Certificate', gate: 'AUTO_DEPLOY_CERT' },
  { name: 'IVX Render Live Status Proof', gate: 'RENDER_STATUS' },
  { name: 'IVX Render Live Certificate', gate: 'RENDER_CERT' },
  { name: 'Landing 112-Agent Autonomous QA War Room', gate: 'WAR_ROOM_112' },
  { name: 'IVX 360 Early Warning & Autonomous Recovery', gate: 'EARLY_WARNING' },
  { name: 'IVX 4-Phase Final Certification', gate: 'FOUR_PHASE' },
  { name: 'IVX Reels Live Certificate', gate: 'REELS' },
];

/** Conclusions that make a required gate RED (owner rule 3). */
const RED_CONCLUSIONS: ReadonlySet<string> = new Set([
  'failure',
  'cancelled',
  'timed_out',
  'startup_failure',
  'action_required',
]);

export type SupervisorGlobalStatus = 'GREEN' | 'RED' | 'PENDING';

export type SupervisorGateRun = {
  workflow: string;
  runId: number;
  headSha: string | null;
  headBranch: string | null;
  /** GitHub run status: completed | in_progress | queued | requested | ... */
  status: string | null;
  /** GitHub run conclusion: success | failure | cancelled | timed_out | startup_failure | skipped | null */
  conclusion: string | null;
};

export type RepairMission = {
  workflow: string;
  runId: number | null;
  conclusion: string | null;
  mainSha: string;
  reason: string;
};

export type SupervisorGate = {
  workflow: string;
  gate: string;
  state: 'GREEN' | 'RED' | 'PENDING' | 'SKIPPED' | 'NOT_RUN' | 'SHA_MISMATCH';
  runId: number | null;
  headSha: string | null;
  conclusion: string | null;
  shaParity: boolean;
  detail: string;
};

export type GlobalCertificationInput = {
  mainSha: string;
  /** Commit reported by production /health. null = production unknown (blocks GREEN). */
  productionSha: string | null;
  /** /health returned 200 healthy. null = unknown (blocks GREEN, fail-closed). */
  productionHealthy: boolean | null;
  /** Latest observed run per required workflow (collector output). */
  runs: SupervisorGateRun[];
  collector: 'github_actions_api' | 'unavailable';
  collectorError?: string | null;
};

export type GlobalCertificationResult = {
  marker: typeof IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER;
  status: SupervisorGlobalStatus;
  /** True only when status === GREEN. Autonomous must gate every certification claim on this. */
  certified: boolean;
  mainSha: string;
  gates: SupervisorGate[];
  failedRequired: string[];
  shaParity: {
    ok: boolean;
    mainSha: string;
    productionSha: string | null;
    violations: string[];
  };
  production: { healthy: boolean | null; sha: string | null };
  collector: 'github_actions_api' | 'unavailable';
  collectorError: string | null;
  repairMissions: RepairMission[];
  policy: string;
};

function pickLatestRunOnMain(runs: SupervisorGateRun[], workflow: string): SupervisorGateRun | null {
  const candidates = runs
    .filter((run) => run.workflow === workflow && (run.headBranch || '') === 'main')
    .sort((a, b) => b.runId - a.runId);
  return candidates[0] ?? null;
}

/**
 * Pure core — no network. Computes the GLOBAL same-SHA certification verdict
 * from the collected runs. Fully deterministic and unit-testable.
 */
export function computeGlobalCertification(input: GlobalCertificationInput): GlobalCertificationResult {
  const mainSha = input.mainSha;
  const gates: SupervisorGate[] = [];
  const failedRequired: string[] = [];
  const repairMissions: RepairMission[] = [];
  const shaViolations: string[] = [];

  for (const required of REQUIRED_CERTIFICATION_WORKFLOWS) {
    const run = pickLatestRunOnMain(input.runs, required.name);
    if (!run) {
      gates.push({
        workflow: required.name,
        gate: required.gate,
        state: 'NOT_RUN',
        runId: null,
        headSha: null,
        conclusion: null,
        shaParity: false,
        detail: 'No run observed on main for this required workflow — certification blocked (fail-closed).',
      });
      continue;
    }

    const onCurrentMainSha = Boolean(run.headSha && run.headSha === mainSha);
    if (!onCurrentMainSha) {
      shaViolations.push(`${required.name}: run ${run.runId} is on ${(run.headSha || 'unknown').slice(0, 9)}, MAIN is ${mainSha.slice(0, 9)}`);
    }

    if (RED_CONCLUSIONS.has((run.conclusion || '').toLowerCase())) {
      if (onCurrentMainSha) {
        failedRequired.push(required.name);
        gates.push({
          workflow: required.name,
          gate: required.gate,
          state: 'RED',
          runId: run.runId,
          headSha: run.headSha,
          conclusion: run.conclusion,
          shaParity: true,
          detail: `Required workflow is ${run.conclusion} on MAIN_SHA — GLOBAL STATUS RED (owner rule 3).`,
        });
        repairMissions.push({
          workflow: required.name,
          runId: run.runId,
          conclusion: run.conclusion,
          mainSha,
          reason: `Required certification workflow "${required.name}" is ${run.conclusion} on MAIN ${mainSha.slice(0, 9)} (run ${run.runId}).`,
        });
      } else {
        gates.push({
          workflow: required.name,
          gate: required.gate,
          state: 'SHA_MISMATCH',
          runId: run.runId,
          headSha: run.headSha,
          conclusion: run.conclusion,
          shaParity: false,
          detail: `Latest run (${run.conclusion}) is NOT on MAIN_SHA — same-SHA certification incomplete (owner rule 7).`,
        });
      }
      continue;
    }

    const runStatus = (run.status || '').toLowerCase();
    if (runStatus && runStatus !== 'completed') {
      gates.push({
        workflow: required.name,
        gate: required.gate,
        state: 'PENDING',
        runId: run.runId,
        headSha: run.headSha,
        conclusion: run.conclusion,
        shaParity: onCurrentMainSha,
        detail: `Run ${run.runId} is ${runStatus} — certification waits for completion.`,
      });
      continue;
    }

    if ((run.conclusion || '').toLowerCase() === 'skipped') {
      gates.push({
        workflow: required.name,
        gate: required.gate,
        state: 'SKIPPED',
        runId: run.runId,
        headSha: run.headSha,
        conclusion: run.conclusion,
        shaParity: onCurrentMainSha,
        detail: 'Required gate was skipped — a skipped gate cannot certify (fail-closed).',
      });
      continue;
    }

    if (!onCurrentMainSha) {
      gates.push({
        workflow: required.name,
        gate: required.gate,
        state: 'SHA_MISMATCH',
        runId: run.runId,
        headSha: run.headSha,
        conclusion: run.conclusion,
        shaParity: false,
        detail: `Last success is on ${(run.headSha || 'unknown').slice(0, 9)}, not MAIN ${mainSha.slice(0, 9)} — SAME-SHA invariant violated (owner rule 7).`,
      });
      continue;
    }

    gates.push({
      workflow: required.name,
      gate: required.gate,
      state: (run.conclusion || '').toLowerCase() === 'success' ? 'GREEN' : 'PENDING',
      runId: run.runId,
      headSha: run.headSha,
      conclusion: run.conclusion,
      shaParity: true,
      detail: `Success on MAIN ${mainSha.slice(0, 9)} (run ${run.runId}).`,
    });
  }

  // Production SHA parity gate (owner invariant: PRODUCTION_SHA = MAIN_SHA).
  const productionHealthy = input.productionHealthy === true;
  const productionShaMatches = Boolean(input.productionSha && input.productionSha === mainSha);
  if (input.productionHealthy === false) {
    shaViolations.push('production /health is not healthy');
  } else if (input.productionSha && !productionShaMatches) {
    shaViolations.push(`production /health commit ${input.productionSha.slice(0, 9)} != MAIN ${mainSha.slice(0, 9)}`);
  }
  const productionGateState: SupervisorGate['state'] = productionHealthy && productionShaMatches
    ? 'GREEN'
    : (input.productionHealthy === false || (input.productionSha && !productionShaMatches) ? 'RED' : 'PENDING');

  const collectorAvailable = input.collector === 'github_actions_api';

  // Owner rule 7: if ANY required gate's latest run is not on the exact MAIN_SHA
  // (SHA_MISMATCH), certification is RED, not merely pending.
  const anyRed =
    gates.some((gate) => gate.state === 'RED' || gate.state === 'SHA_MISMATCH') ||
    productionGateState === 'RED';
  const anyNotGreen =
    anyRed ||
    !collectorAvailable ||
    gates.some((gate) => gate.state !== 'GREEN') ||
    productionGateState !== 'GREEN';

  const status: SupervisorGlobalStatus = anyRed ? 'RED' : anyNotGreen ? 'PENDING' : 'GREEN';

  if (!collectorAvailable && input.collectorError) {
    shaViolations.push(`collector unavailable: ${input.collectorError}`);
  }

  return {
    marker: IVX_GLOBAL_CERTIFICATION_SUPERVISOR_MARKER,
    status,
    certified: status === 'GREEN',
    mainSha,
    gates: [
      ...gates,
      {
        workflow: 'IVX Production /health SHA parity',
        gate: 'PRODUCTION_PARITY',
        state: productionGateState,
        runId: null,
        headSha: input.productionSha,
        conclusion: productionHealthy ? 'healthy' : 'unhealthy_or_unknown',
        shaParity: productionShaMatches,
        detail: productionGateState === 'GREEN'
          ? `Production /health commit matches MAIN ${mainSha.slice(0, 9)}.`
          : productionGateState === 'RED'
            ? 'Production parity violated — PRODUCTION_SHA must equal MAIN_SHA (owner rule 7).'
            : 'Production /health unknown — parity not proven (fail-closed).',
      },
    ],
    failedRequired,
    shaParity: {
      ok: shaViolations.length === 0,
      mainSha,
      productionSha: input.productionSha,
      violations: shaViolations,
    },
    production: { healthy: input.productionHealthy, sha: input.productionSha },
    collector: input.collector,
    collectorError: input.collectorError ?? null,
    repairMissions,
    policy:
      'GREEN requires EVERY required workflow SUCCESS on the exact MAIN_SHA AND production /health commit == MAIN_SHA. ' +
      'Any required failure/cancelled/timed_out/startup_failure on MAIN_SHA => RED + automatic repair mission. ' +
      'Collector unavailable or missing/skipped/in-progress gates => PENDING (never GREEN — fail-closed). ' +
      'Repair missions are low-risk diagnose+patch only; git deploy and high-risk operations remain OWNER-GATED.',
  };
}

// ─── Production collector + dispatcher (network side, injectable in tests) ───

const GITHUB_API_BASE = 'https://api.github.com';
const IVX_GITHUB_REPO = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
const IVX_PRODUCTION_API_BASE = (process.env.IVX_PRODUCTION_API_BASE || 'https://api.ivxholding.com').replace(/\/$/, '');
const COLLECT_TIMEOUT_MS = 8_000;

function readGithubToken(): string {
  return typeof process.env.GITHUB_TOKEN === 'string' ? process.env.GITHUB_TOKEN.trim() : '';
}

async function ghJson<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(COLLECT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`GitHub ${path} -> HTTP ${response.status}`);
  return (await response.json()) as T;
}

type GhWorkflow = { id: number; name: string; path: string; state: string };
type GhRun = {
  id: number;
  name: string;
  path: string;
  head_sha: string;
  head_branch: string | null;
  status: string;
  conclusion: string | null;
};

/** Collect the latest main-branch run for every required workflow + production /health parity. */
export async function resolveMainSha(): Promise<string | null> {
  const token = readGithubToken();
  if (!token) return null;
  try {
    const ref = await ghJson<{ object: { sha: string } }>('/repos/' + IVX_GITHUB_REPO + '/git/ref/heads/main', token);
    return ref.object.sha || null;
  } catch {
    return null;
  }
}

export async function collectGlobalCertificationEvidence(mainSha: string): Promise<{
  input: GlobalCertificationInput;
}> {
  const token = readGithubToken();
  let runs: SupervisorGateRun[] = [];
  let collector: GlobalCertificationInput['collector'] = 'unavailable';
  let collectorError: string | null = null;

  let productionSha: string | null = null;
  let productionHealthy: boolean | null = null;
  try {
    const health = await fetch(`${IVX_PRODUCTION_API_BASE}/health`, { signal: AbortSignal.timeout(COLLECT_TIMEOUT_MS) });
    productionHealthy = health.ok;
    const body = (await health.json()) as { commit?: string; commitSha?: string };
    productionSha = body.commit || body.commitSha || null;
  } catch (error) {
    productionHealthy = null;
    productionSha = null;
    collectorError = `production /health probe failed: ${error instanceof Error ? error.message : 'unknown'}`;
  }

  if (!token) {
    return {
      input: {
        mainSha,
        productionSha,
        productionHealthy,
        runs: [],
        collector: 'unavailable',
        collectorError: collectorError ?? 'GITHUB_TOKEN missing in backend runtime — GitHub Actions collection disabled (fail-closed PENDING).',
      },
    };
  }

  try {
    const workflows = await ghJson<{ workflows: GhWorkflow[] }>('/repos/' + IVX_GITHUB_REPO + '/actions/workflows?per_page=100', token);
    const nameByPath = new Map(workflows.workflows.map((workflow) => [workflow.path, workflow.name]));
    const requiredNames = new Set(REQUIRED_CERTIFICATION_WORKFLOWS.map((workflow) => workflow.name));
    const latestByWorkflow = new Map<string, SupervisorGateRun>();
    for (let page = 1; page <= 3 && latestByWorkflow.size < requiredNames.size; page += 1) {
      const pageData = await ghJson<{ workflow_runs: GhRun[] }>(
        '/repos/' + IVX_GITHUB_REPO + '/actions/runs?branch=main&per_page=100&page=' + page,
        token,
      );
      for (const run of pageData.workflow_runs) {
        const displayName = nameByPath.get(run.path) || run.name;
        if (!requiredNames.has(displayName) || latestByWorkflow.has(displayName)) continue;
        latestByWorkflow.set(displayName, {
          workflow: displayName,
          runId: run.id,
          headSha: run.head_sha,
          headBranch: run.head_branch,
          status: run.status,
          conclusion: run.conclusion,
        });
      }
      if (pageData.workflow_runs.length < 100) break;
    }
    runs = Array.from(latestByWorkflow.values());
    collector = 'github_actions_api';
  } catch (error) {
    collector = 'unavailable';
    collectorError = collectorError ?? ('GitHub Actions collection failed: ' + (error instanceof Error ? error.message : 'unknown'));
    runs = [];
  }

  return {
    input: { mainSha, productionSha, productionHealthy, runs, collector, collectorError },
  };
}

export type RepairDispatchResult = {
  workflow: string;
  dispatched: boolean;
  jobId: string | null;
  attached: boolean;
  detail: string;
};

const recentDispatches = new Map<string, { at: number; jobId: string }>();
const REPAIR_DEDUPE_TTL_MS = 30 * 60_000;

/**
 * Open a real repair mission in the senior-developer worker for a RED gate.
 * Low-risk diagnose + patch only: the job may apply and test a code patch
 * (strict safe-patch gate), but production git deploy stays owner-gated and
 * high-risk operations keep their existing owner gates (owner rule 9).
 */
export async function dispatchRepairMission(mission: RepairMission): Promise<RepairDispatchResult> {
  const dedupeKey = `${mission.workflow}:${mission.mainSha}`;
  const recent = recentDispatches.get(dedupeKey);
  if (recent && Date.now() - recent.at < REPAIR_DEDUPE_TTL_MS) {
    return { workflow: mission.workflow, dispatched: false, jobId: recent.jobId, attached: true, detail: 'Repair mission already open for this workflow+SHA (dedupe window).' };
  }
  try {
    const { enqueueOrAttachSeniorDeveloperJob } = await import('./ivx-senior-developer-worker');
    const { IVX_SAFE_PATCH_CONFIRM_TEXT } = await import('./ivx-senior-developer-runtime');
    const result = await enqueueOrAttachSeniorDeveloperJob({
      goal:
        `AUTONOMOUS GLOBAL SUPERVISOR — REPAIR MISSION for required certification workflow "${mission.workflow}". ` +
        `Failure: ${mission.conclusion} (GitHub Actions run ${mission.runId ?? 'n/a'}) on MAIN ${mission.mainSha.slice(0, 9)}. ` +
        'Steps: (1) retrieve the failed job and its logs via the GitHub API, (2) determine the true root cause, ' +
        '(3) implement the LOWEST-RISK real code repair (no secrets, no IAM, no payments, no destructive migrations, ' +
        'no security-boundary changes — those are OWNER-GATED), (4) run the focused tests + typecheck, ' +
        '(5) commit the repair. Production deploy is NOT approved in this mission. If the root cause is outside ' +
        'low-risk scope, stop and report the exact owner action required.',
      ownerApproved: true,
      approvePatch: true,
      patchConfirmationText: IVX_SAFE_PATCH_CONFIRM_TEXT,
      approveGitDeploy: false,
      validationMode: 'focused',
      systemMode: true,
      ownerApprovedAction: null,
      ownerId: 'machine:autonomous-global-supervisor',
    });
    const jobId = result.job?.jobId || null;
    if (jobId) recentDispatches.set(dedupeKey, { at: Date.now(), jobId });
    return {
      workflow: mission.workflow,
      dispatched: true,
      jobId,
      attached: result.attached === true,
      detail: result.attached === true ? 'Attached to an existing open repair job.' : 'Repair mission enqueued (low-risk scope, deploy owner-gated).',
    };
  } catch (error) {
    return {
      workflow: mission.workflow,
      dispatched: false,
      jobId: null,
      attached: false,
      detail: `Repair dispatch failed: ${error instanceof Error ? error.message : 'unknown'}`,
    };
  }
}

/** One-shot supervision cycle used by the API endpoints (collect → compute → dispatch repairs). */
export async function runGlobalCertificationSupervision(mainSha: string): Promise<{
  result: GlobalCertificationResult;
  dispatches: RepairDispatchResult[];
}> {
  const { input } = await collectGlobalCertificationEvidence(mainSha);
  const result = computeGlobalCertification(input);
  const dispatches: RepairDispatchResult[] = [];
  for (const mission of result.repairMissions) {
    dispatches.push(await dispatchRepairMission(mission));
  }
  return { result, dispatches };
}
