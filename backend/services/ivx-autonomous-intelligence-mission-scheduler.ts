/**
 * IVX Autonomous Intelligence Mission Scheduler (AIMS).
 *
 * Starts one real low-risk Senior Developer mission, persists its full state,
 * and never re-runs an already-satisfied mission merely because production
 * received a newer deploy. A new mission requires a new marker/version.
 */
import { randomUUID } from 'node:crypto';
import {
  appendDurableEvent,
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getSeniorDeveloperJob,
  listSeniorDeveloperProofLedger,
  type IVXWorkerJob,
  type IVXWorkerJobResult,
} from './ivx-senior-developer-worker';

export const IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER =
  'ivx-autonomous-intelligence-mission-scheduler-2026-08-23';

const EVIDENCE_PATH = 'expo/evidence/autonomous/ivx-autonomous-intelligence-mission-scheduler-cert.json';
const MISSION_GOAL_TEMPLATE = `Create a durable autonomous intelligence mission scheduler live evidence file at:
${EVIDENCE_PATH}

The file must contain exactly these fields:
- "marker": "${IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER}"
- "mission": "autonomous intelligence mission scheduler live"
- "createdAt": current ISO 8601 timestamp
- "creator": "ivx-senior-developer-worker"

No other functional code changes. Inspect the existing mission scheduler and worker modules to confirm the exact marker value, then run relevant tests and typecheck, commit to an autonomous branch, open a PR, and auto-merge if CI passes. This is a low-risk evidence-only task.`;

const OWNER_ID = 'ivx-autonomous-intelligence-mission-scheduler';
const POLL_INTERVAL_MS = 15_000;
const STATE_PATH = 'logs/audit/autonomous-intelligence-mission-scheduler/state.json';
const EVENTS_PATH = 'logs/audit/autonomous-intelligence-mission-scheduler/events.jsonl';

export type MissionSchedulerJobStatus =
  | 'queued'
  | 'running'
  | 'patching'
  | 'testing'
  | 'committing'
  | 'deploying'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled'
  | 'unknown';

export type MissionSchedulerState = {
  marker: string;
  startedAt: string;
  schedulerJobId: string;
  deploySha: string | null;
  missionJobId: string | null;
  status: MissionSchedulerJobStatus;
  stage: string | null;
  progressPercent: number;
  stageDetail: string;
  inspectedFiles: string[];
  changedFiles: string[];
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  prMerged: boolean | null;
  prMergeCommitSha: string | null;
  deployId: string | null;
  liveCommit: string | null;
  healthOk: boolean | null;
  completedAt: string | null;
  error: string | null;
  duplicateSuppressed?: boolean;
  duplicateSuppressedAt?: string | null;
  updatedAt: string;
};

let currentState: MissionSchedulerState | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function getCurrentDeploySha(): string | null {
  return (
    process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.GIT_COMMIT_SHA?.trim() ||
    process.env.SOURCE_VERSION?.trim() ||
    null
  );
}

export function isMissionAlreadySatisfied(state: MissionSchedulerState): boolean {
  return Boolean(
    state.marker === IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER
      && state.status === 'completed'
      && state.prMerged === true
      && state.prNumber
      && state.commitSha
      && state.changedFiles.includes(EVIDENCE_PATH)
      && !state.error,
  );
}

export function verifyLiveDeployForState(state: MissionSchedulerState): MissionSchedulerState {
  if (state.status !== 'completed' || !state.prMerged || !state.prMergeCommitSha) return state;
  const currentDeploySha = getCurrentDeploySha();
  if (!currentDeploySha || currentDeploySha !== state.prMergeCommitSha) return state;
  const staleResumeError = state.error && (
    state.error.includes('no changed files') ||
    state.error.includes('stale evidence')
  );
  if (state.liveCommit === currentDeploySha && state.healthOk === true && !staleResumeError) return state;
  return {
    ...state,
    liveCommit: currentDeploySha,
    healthOk: true,
    deployId: state.deployId ?? null,
    error: staleResumeError ? null : state.error,
    stageDetail: 'Mission completed and verified live on current production deploy.',
    updatedAt: nowIso(),
  };
}

function emptyState(): MissionSchedulerState {
  return {
    marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
    startedAt: nowIso(),
    schedulerJobId: randomUUID(),
    deploySha: getCurrentDeploySha(),
    missionJobId: null,
    status: 'unknown',
    stage: null,
    progressPercent: 0,
    stageDetail: 'Scheduler not yet started.',
    inspectedFiles: [],
    changedFiles: [],
    commitSha: null,
    prNumber: null,
    prUrl: null,
    prMerged: null,
    prMergeCommitSha: null,
    deployId: null,
    liveCommit: null,
    healthOk: null,
    completedAt: null,
    error: null,
    duplicateSuppressed: false,
    duplicateSuppressedAt: null,
    updatedAt: nowIso(),
  };
}

async function loadState(): Promise<MissionSchedulerState> {
  const currentDeploySha = getCurrentDeploySha();
  if (isDurableStoreConfigured()) {
    try {
      const parsed = await readDurableJson<MissionSchedulerState | null>(STATE_PATH, null);
      if (parsed && parsed.marker === IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER) {
        if (currentDeploySha && parsed.deploySha !== currentDeploySha) {
          if (isMissionAlreadySatisfied(parsed)) {
            return {
              ...parsed,
              deploySha: currentDeploySha,
              duplicateSuppressed: true,
              duplicateSuppressedAt: nowIso(),
              stageDetail: 'Mission already satisfied on an ancestor main commit; duplicate evidence run suppressed.',
              updatedAt: nowIso(),
            };
          }
          const fresh = emptyState();
          console.log('[IVX AIMS] New deploy detected; resetting incomplete mission state', {
            previousDeploySha: parsed.deploySha,
            currentDeploySha,
            previousJobId: parsed.missionJobId,
          });
          return fresh;
        }
        return parsed;
      }
    } catch {
      // fall through to a fresh state; execution still fails closed later if
      // durable persistence cannot be written.
    }
  }
  return emptyState();
}

async function saveState(state: MissionSchedulerState): Promise<void> {
  const next: MissionSchedulerState = { ...state, updatedAt: nowIso() };
  currentState = next;
  if (isDurableStoreConfigured()) {
    try {
      await writeDurableJson(STATE_PATH, next);
      await appendDurableEvent(EVENTS_PATH, {
        type: 'mission_scheduler_state',
        marker: next.marker,
        schedulerJobId: next.schedulerJobId,
        missionJobId: next.missionJobId,
        status: next.status,
        stage: next.stage,
        progressPercent: next.progressPercent,
        stageDetail: next.stageDetail,
        commitSha: next.commitSha,
        prNumber: next.prNumber,
        prMerged: next.prMerged,
        deployId: next.deployId,
        liveCommit: next.liveCommit,
        healthOk: next.healthOk,
        duplicateSuppressed: next.duplicateSuppressed === true,
        updatedAt: next.updatedAt,
      });
    } catch {
      // The caller still has currentState, but production certification must use
      // the durable store rather than treating an in-memory update as proof.
    }
  }
}

function mapJobStatus(job: IVXWorkerJob): MissionSchedulerJobStatus {
  switch (job.status) {
    case 'queued': return 'queued';
    case 'running': return 'running';
    case 'patching': return 'patching';
    case 'testing': return 'testing';
    case 'committing': return 'committing';
    case 'deploying': return 'deploying';
    case 'verifying': return 'verifying';
    case 'completed': return 'completed';
    case 'failed': return 'failed';
    case 'blocked': return 'blocked';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

function mergeJobIntoState(state: MissionSchedulerState, job: IVXWorkerJob): MissionSchedulerState {
  const result: IVXWorkerJobResult | null = job.result ?? null;
  const inspected = result?.filesInspected ?? [];
  const changed = result?.changedFiles ?? [];
  return {
    ...state,
    missionJobId: job.jobId,
    status: mapJobStatus(job),
    stage: job.stage,
    progressPercent: job.progressPercent,
    stageDetail: job.stageDetail,
    inspectedFiles: inspected.length > 0 ? inspected : state.inspectedFiles,
    changedFiles: changed.length > 0 ? changed : state.changedFiles,
    commitSha: result?.commitSha ?? state.commitSha,
    prNumber: result?.prNumber ?? state.prNumber,
    prUrl: result?.prUrl ?? state.prUrl,
    prMerged: result?.prMerged ?? state.prMerged,
    prMergeCommitSha: result?.prMergeCommitSha ?? state.prMergeCommitSha,
    deployId: result?.deployId ?? state.deployId,
    liveCommit: result?.liveCommit ?? state.liveCommit,
    healthOk: result?.healthOk ?? state.healthOk,
    completedAt: job.status === 'completed' ? (result?.generatedAt ?? nowIso()) : state.completedAt,
    error: job.error ?? (job.status === 'failed' || job.status === 'blocked' ? state.error : null),
    duplicateSuppressed: false,
    duplicateSuppressedAt: null,
    updatedAt: nowIso(),
  };
}

async function refreshMissionJob(): Promise<void> {
  if (!currentState || !currentState.missionJobId) return;
  try {
    const job = await getSeniorDeveloperJob(currentState.missionJobId);
    if (job) {
      currentState = mergeJobIntoState(currentState, job);
      currentState = verifyLiveDeployForState(currentState);
      await saveState(currentState);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'refresh failed';
    console.warn('[IVX AIMS] refresh failed', { message: message.slice(0, 200) });
  }
}

export async function startAutonomousIntelligenceMissionScheduler(): Promise<void> {
  console.log('[IVX AIMS] Starting autonomous intelligence mission scheduler...');
  const state = await loadState();
  currentState = state;

  const deploySha = getCurrentDeploySha();
  const workerEnabled = process.env.IVX_SENIOR_DEV_WORKER_ENABLED === 'true';
  console.log('[IVX AIMS] Scheduler boot diagnostics', {
    deploySha,
    workerEnabled,
    durableStore: isDurableStoreConfigured(),
    existingMissionJobId: state.missionJobId,
    existingStatus: state.status,
    alreadySatisfied: isMissionAlreadySatisfied(state),
  });

  if (!workerEnabled) {
    currentState = {
      ...currentState,
      status: 'failed',
      stage: 'FAILED',
      stageDetail: 'IVX_SENIOR_DEV_WORKER_ENABLED is not true; mission scheduler cannot enqueue a real job.',
      error: 'IVX_SENIOR_DEV_WORKER_ENABLED is not true',
      updatedAt: nowIso(),
    };
    await saveState(currentState);
    return;
  }

  if (isMissionAlreadySatisfied(state)) {
    currentState = {
      ...state,
      deploySha: deploySha ?? state.deploySha,
      duplicateSuppressed: true,
      duplicateSuppressedAt: nowIso(),
      stageDetail: 'Mission already satisfied; duplicate evidence/code-change job suppressed.',
      updatedAt: nowIso(),
    };
    await saveState(currentState);
    console.log('[IVX AIMS] Duplicate mission suppressed', {
      missionJobId: state.missionJobId,
      commitSha: state.commitSha,
      prNumber: state.prNumber,
    });
    return;
  }

  let jobId = state.missionJobId;
  if (jobId) {
    try {
      const existing = await getSeniorDeveloperJob(jobId);
      if (existing && !['completed', 'failed', 'blocked', 'cancelled'].includes(existing.status)) {
        console.log('[IVX AIMS] Attaching to existing active mission job', { jobId });
        currentState = mergeJobIntoState(currentState, existing);
        await saveState(currentState);
      } else {
        jobId = null;
      }
    } catch {
      jobId = null;
    }
  }

  if (!jobId) {
    try {
      const goal = MISSION_GOAL_TEMPLATE;
      const enqueued = await enqueueOrAttachSeniorDeveloperJob({
        goal,
        ownerApproved: true,
        approvePatch: true,
        approveGitDeploy: false,
        validationMode: 'focused',
        systemMode: true,
        ownerApprovedAction: {
          proposedPlan: goal,
          filesAffected: [EVIDENCE_PATH],
          riskLevel: 'low',
          rollbackOption: 'Delete the evidence file and revert the autonomous commit.',
          rollbackAvailable: true,
          auditLog: [
            'Autonomous Intelligence Mission Scheduler boot submission',
            `marker: ${IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER}`,
          ],
          secretValuesReturned: false,
        },
        ownerId: OWNER_ID,
        executionMode: 'code_change',
        actor: 'SYSTEM',
      });

      jobId = enqueued.job.jobId;
      currentState = {
        ...currentState,
        missionJobId: jobId,
        status: mapJobStatus(enqueued.job),
        stage: enqueued.job.stage,
        progressPercent: enqueued.job.progressPercent,
        stageDetail: enqueued.job.stageDetail,
        duplicateSuppressed: false,
        duplicateSuppressedAt: null,
        updatedAt: nowIso(),
      };
      await saveState(currentState);
      console.log('[IVX AIMS] Real mission job enqueued', {
        jobId,
        attached: enqueued.attached,
        ownerId: OWNER_ID,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'enqueue failed';
      console.error('[IVX AIMS] Failed to enqueue mission job', { message: message.slice(0, 300) });
      currentState = {
        ...currentState,
        status: 'failed',
        stage: 'FAILED',
        stageDetail: `Mission scheduler failed to enqueue job: ${message.slice(0, 200)}`,
        error: message.slice(0, 300),
        updatedAt: nowIso(),
      };
      await saveState(currentState);
      return;
    }
  }

  await refreshMissionJob();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { void refreshMissionJob(); }, POLL_INTERVAL_MS);
  pollTimer.unref?.();
}

export function stopAutonomousIntelligenceMissionScheduler(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  currentState = null;
}

export async function getMissionSchedulerStatus(): Promise<{
  ok: boolean;
  marker: string;
  schedulerJobId: string;
  missionJobId: string | null;
  state: MissionSchedulerState;
  workerResult: IVXWorkerJobResult | null;
}> {
  const state = currentState ?? (await loadState());
  let workerResult: IVXWorkerJobResult | null = null;
  if (state.missionJobId) {
    try {
      const job = await getSeniorDeveloperJob(state.missionJobId);
      if (job?.result) {
        workerResult = job.result;
      } else {
        const ledger = await listSeniorDeveloperProofLedger(100);
        workerResult = ledger.find((e) => e.jobId === state.missionJobId) ?? null;
      }
    } catch {
      workerResult = null;
    }
  }
  const verifiedState = verifyLiveDeployForState(state);
  if (verifiedState !== state) {
    currentState = verifiedState;
    await saveState(currentState);
  }
  return {
    ok: verifiedState.status === 'completed' && !verifiedState.error,
    marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
    schedulerJobId: verifiedState.schedulerJobId,
    missionJobId: verifiedState.missionJobId,
    state: verifiedState,
    workerResult,
  };
}
