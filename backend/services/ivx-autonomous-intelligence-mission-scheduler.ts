import { readDurableJson, writeDurableJson } from './ivx-durable-store';
import { enqueueOrAttachSeniorDeveloperJob, getSeniorDeveloperJob } from './ivx-senior-developer-worker';

export const IVX_AUTONOMOUS_INTELLIGENCE_MISSION_MARKER = 'ivx-autonomous-intelligence-mission-2026-08-23';
const STORE_KEY = 'autonomous-intelligence/mission-20260823.json';
const OWNER_ID = 'ivx-owner-intelligence-upgrade-20260823';
const TICK_MS = 60_000;

export type IntelligenceMissionState = {
  marker: string;
  enabled: boolean;
  currentJobIndex: number;
  jobIds: Array<string | null>;
  jobStatuses: Array<string | null>;
  startedAt: string | null;
  updatedAt: string;
  completedAt: string | null;
  blockedReason: string | null;
};

const JOBS = [
  'JOB 1/5 — Implement the IVX Autonomous Intelligence Upgrade reasoning core from docs/autonomous/IVX-AUTONOMOUS-INTELLIGENCE-MISSION.md: evidence-first diagnosis, at least 3 hypotheses for non-trivial failures, architecture/root-cause/security/regression/test-strategy review passes, and an independent critic verdict before patch advancement. Inspect real current code first. Add targeted tests and preserve fail-closed behavior. Do not weaken Owner Gates.',
  'JOB 2/5 — Implement no-fake-fix enforcement, blast-radius/consequence analysis, and bounded self-correction from docs/autonomous/IVX-AUTONOMOUS-INTELLIGENCE-MISSION.md. Reject TODO-as-fix, empty stubs, hardcoded PASS, disabled tests, swallowed errors, fabricated evidence, and fake certification. Persist exact failure cause and revise from evidence. Add targeted tests and preserve Owner Gates.',
  'JOB 3/5 — Implement durable engineering memory, codebase dependency graph, and runtime incident correlation from docs/autonomous/IVX-AUTONOMOUS-INTELLIGENCE-MISSION.md. Reuse the existing durable store. Correlate GitHub/Render/API/CI/database/dashboard evidence without exposing secrets. Add tests proving restart-safe memory and dependency/risk lookup.',
  'JOB 4/5 — Implement behavior-specific verification, evidence-derived confidence, specialist routing, and multi-agent review from docs/autonomous/IVX-AUTONOMOUS-INTELLIGENCE-MISSION.md. Confidence must be derived from evidence quality, never arbitrary. High-complexity tasks require diagnosis, alternative diagnosis, critic/security review, and a recorded final decision. Add tests.',
  'JOB 5/5 — Implement final Owner controls/self-healing/benchmark certification from docs/autonomous/IVX-AUTONOMOUS-INTELLIGENCE-MISSION.md. Preserve PAUSE/STOP/DISABLE DEPLOY/DISABLE CODE WRITES/ROLLBACK controls; never auto-run destructive or high-risk owner-gated actions. Add a >=100-scenario benchmark harness covering auth, mobile black screen, API 500, DB query, stale deploy, CI, security, credentials, dependencies, performance, migrations, UI state, concurrency and data integrity. Publish a fail-closed final certificate only if all hard gates and measurable evidence pass.',
] as const;

function freshState(): IntelligenceMissionState {
  return {
    marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_MARKER,
    enabled: true,
    currentJobIndex: 0,
    jobIds: Array(JOBS.length).fill(null),
    jobStatuses: Array(JOBS.length).fill(null),
    startedAt: null,
    updatedAt: new Date().toISOString(),
    completedAt: null,
    blockedReason: null,
  };
}

async function readState(): Promise<IntelligenceMissionState> {
  const state = await readDurableJson<IntelligenceMissionState | null>(STORE_KEY, null);
  if (!state || state.marker !== IVX_AUTONOMOUS_INTELLIGENCE_MISSION_MARKER) return freshState();
  return state;
}

async function persist(state: IntelligenceMissionState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  await writeDurableJson(STORE_KEY, state);
}

let inFlight = false;
let timer: ReturnType<typeof setInterval> | null = null;

export async function runAutonomousIntelligenceMissionTick(): Promise<IntelligenceMissionState> {
  if (inFlight) return readState();
  inFlight = true;
  try {
    const state = await readState();
    if (!state.enabled || state.completedAt) return state;

    if (process.env.IVX_SENIOR_DEV_WORKER_ENABLED !== 'true') {
      state.blockedReason = 'IVX_SENIOR_DEV_WORKER_ENABLED is not true; mission cannot execute.';
      await persist(state);
      return state;
    }

    const index = state.currentJobIndex;
    if (index >= JOBS.length) {
      state.completedAt = new Date().toISOString();
      state.blockedReason = null;
      await persist(state);
      return state;
    }

    const existingJobId = state.jobIds[index];
    if (existingJobId) {
      const job = await getSeniorDeveloperJob(existingJobId);
      if (!job) {
        state.blockedReason = `Durable mission references missing worker job ${existingJobId}.`;
        await persist(state);
        return state;
      }
      state.jobStatuses[index] = job.status;
      if (job.status === 'completed') {
        state.currentJobIndex = index + 1;
        state.blockedReason = null;
        if (state.currentJobIndex >= JOBS.length) state.completedAt = new Date().toISOString();
        await persist(state);
        return state;
      }
      if (job.status === 'failed' || job.status === 'blocked' || job.status === 'cancelled') {
        state.blockedReason = `Job ${index + 1} is ${job.status}; mission is fail-closed and will not advance automatically.`;
        await persist(state);
        return state;
      }
      state.blockedReason = null;
      await persist(state);
      return state;
    }

    const queued = await enqueueOrAttachSeniorDeveloperJob({
      goal: JOBS[index],
      ownerApproved: true,
      approvePatch: true,
      approveGitDeploy: false,
      validationMode: 'focused',
      systemMode: true,
      ownerApprovedAction: null,
      ownerId: OWNER_ID,
      conversationId: 'autonomous-intelligence-mission-20260823',
      sourceChatMessageId: `mission-20260823-job-${index + 1}`,
      actor: 'AUTONOMOUS',
      executionMode: 'code_change',
    });

    state.startedAt ??= new Date().toISOString();
    state.jobIds[index] = queued.job.jobId;
    state.jobStatuses[index] = queued.job.status;
    state.blockedReason = null;
    await persist(state);
    return state;
  } catch (error) {
    const state = await readState();
    state.blockedReason = error instanceof Error ? error.message : String(error);
    await persist(state);
    return state;
  } finally {
    inFlight = false;
  }
}

export function startAutonomousIntelligenceMissionScheduler(): void {
  if (timer) return;
  const kick = setTimeout(() => { void runAutonomousIntelligenceMissionTick(); }, 45_000);
  kick.unref?.();
  timer = setInterval(() => { void runAutonomousIntelligenceMissionTick(); }, TICK_MS);
  timer.unref?.();
}

export async function getAutonomousIntelligenceMissionState(): Promise<IntelligenceMissionState> {
  return readState();
}
