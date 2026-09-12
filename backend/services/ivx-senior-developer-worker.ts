import { readSharedSeniorActiveOwnerJob, sharedSeniorQueueEnabled, rememberSeniorQueue, patchSharedSeniorQueue, claimSharedSeniorJob, putSharedSeniorResult, readSharedSeniorDocument, readSharedSeniorWorkQueue, readSharedSeniorJob, appendSharedSeniorProofEvent } from './ivx-senior-shared-queue';
import { SENIOR_QUEUE_ACTIVE_STATUSES } from './ivx-senior-work-queue';
import type { CoderWorkspaceEvidence } from './ivx-coder-workspace';
import { createSeniorJobAdmission } from './ivx-senior-job-admission';
import { configuredAdmissionLimit } from './ivx-fleet-admission-policy';
import { registerSeniorExecutionMetrics } from './ivx-fleet-execution-metrics';
/**
 * IVX Self-Hosted Senior Developer Worker — removes the external platform dependency as the
 * code EXECUTOR.
 *
 * External platform is no longer required to run a development task. Instead:
 *   1. IVX IA (or the owner-gated API) submits an owner-approved task to this
 *      worker's durable job QUEUE.
 *   2. A single-flight WORKER drains the queue and runs the real end-to-end
 *      execution pipeline already implemented in `ivx-senior-developer-runtime`:
 *      repo read → file create/modify → tests → typecheck → build → commit →
 *      push → Render deploy → poll deploy → verify /health + /version.
 *   3. Every job's verifiable result is recorded in a durable PROOF LEDGER
 *      (Supabase-backed, survives Render's diskless restarts; in-memory fallback
 *      for local/test).
 *
 * HTTP 409 FIX (2026-07-17):
 *   - Per-owner single-flight: only one active task per owner at a time.
 *   - Duplicate requests ATTACH to the running job (return its jobId) instead
 *     of returning HTTP 409.
 *   - Stale jobs auto-expire after a configurable timeout.
 *   - Cancel Job and Resume Job endpoints.
 *   - Granular stage tracking: QUEUED → RUNNING → PATCHING → TESTING →
 *     COMMITTING → DEPLOYING → VERIFYING → COMPLETED/FAILED.
 *   - Live Work updated in real time with current stage and progress.
 *   - The user's request is NEVER discarded — it is queued or attached.
 *
 * Security:
 *   - Owner approval is enforced at the API boundary BEFORE a job is enqueued;
 *     the approval contract is stored on the job. The worker refuses to run a
 *     job whose `ownerApproved` flag is not true.
 *   - No secret values are ever stored on a job or in the ledger.
 */
import { createHash, randomUUID } from 'node:crypto';
import {
  appendDurableEvent,
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';
import { assertEmergencyStopInactive, checkEmergencyStop } from './ivx-emergency-stop-gate';
import { classifyTaskType } from './ivx-completion-validator';
import {
  IVX_GIT_DEPLOY_CONFIRM_TEXT,
  IVX_SAFE_PATCH_CONFIRM_TEXT,
  runIVXSeniorDeveloperTask,
  verifyLiveCommitMatch,
  type IVXSeniorDeveloperApprovedActionContract,
  type IVXSeniorDeveloperRunProof,
} from './ivx-senior-developer-runtime';
import {
  IVX_READONLY_INSPECTION_MARKER,
  runIVXReadOnlyInspection,
  buildReadOnlyInspectionAnswer,
  type IVXReadOnlyInspectionProof,
  type IVXInspectionExecutionMode,
  type IVXReadOnlyInspectionPhase,
} from './ivx-senior-developer-readonly-runtime';
import {
  IVX_QA_ONLY_MARKER,
  runIVXQAOnly,
  buildQAOnlyAnswer,
  type IVXQAOnlyProof,
  type IVXQAOnlyExecutionMode,
  type IVXQAOnlyPhase,
} from './ivx-senior-developer-qa-runtime';
import {
  IVX_AUTONOMOUS_CODER_MARKER,
  runIVXAutonomousCoder,
  resumeIVXAutonomousCoderFromCiWait,
  buildAutonomousCoderAnswer,
  type IVXAutonomousCoderProof,
  type IVXAutonomousCoderExecutionMode as IVXAutonomousCoderMode,
  type IVXAutonomousCoderPhase,
  type IVXCiCheckEvidence,
} from './ivx-autonomous-coder';
import { assertRepairResumeEvidence } from './ivx-repair-resume-evidence';
import { recoverCommittedPullRequest } from './ivx-commit-pr-recovery';
import { autonomousBranchSuffix } from './ivx-coder-branch';
import { committedFailurePatch, isCommittedRecoveryCandidate } from './ivx-senior-committed-recovery-policy';
import {
  IVX_FACTORY_ENGINE_MARKER,
  IVX_FACTORY_APPROVAL_PHRASE,
  runIVXFactoryJob,
  buildFactoryJobAnswer,
  type IVXFactoryJobProof,
  type IVXFactoryOperation,
} from './ivx-autonomous-coder-factory';
import { getRealFactoryRunners, commitFactoryFilesToGitHub } from './ivx-autonomous-coder-factory-runners';
import {
  assertCanTransition,
  stageToTaskState,
  terminalStateForNoWork,
  terminalStateForRefusedCompletion,
  type IVXTaskState,
} from './ivx-task-state-machine';
import {
  createExecutionRecord,
  appendCommand,
  appendTestResult,
  appendEvidence,
  completeExecutionRecord,
  validateExecutionRecord,
  type IVXExecutionRecord,
} from './ivx-execution-record';
import {
  computeIdempotencyKey,
  fingerprintEvidence,
  checkDuplicateEvidence,
  normalizeGoalForRetry,
  isSameTaskScope,
} from './ivx-duplicate-worker-prevention';

export const IVX_SENIOR_DEV_WORKER_MARKER = 'ivx-senior-developer-worker-2026-07-17';

/**
 * LIVE PILOT CERTIFICATION NOTE (2026-08-22): the full owner-chat loop
 * (chat -> worker -> patch -> tests -> typecheck -> commit -> PR) was proven
 * live in production by the autonomous coder pilot run (job
 * ivx-worker-f4a8b092, commit b1f467a290e3, PR #216).
 */

/** Repo-relative keys so the durable store derives stable doc keys. */
const QUEUE_FILE = 'logs/audit/senior-developer-worker/queue.json';
const LEDGER_FILE = 'logs/audit/senior-developer-worker/proof-ledger.json';

const MAX_QUEUE_RETAINED = 200;
const MAX_LEDGER_RETAINED = 200;

/**
 * Stale job expiration timeout (ms). A RUNNING job whose `startedAt` is older
 * than this is automatically expired (marked FAILED) so a new job can start.
 * Configurable via `IVX_WORKER_STALE_TIMEOUT_MS` env var.
 */
const STALE_JOB_TIMEOUT_MS: number = (() => {
  const env = process.env.IVX_WORKER_STALE_TIMEOUT_MS;
  const parsed = env ? Number.parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000; // 30 min default
})();

/** How often to run the stale-job sweep (ms). */
const STALE_CHECK_INTERVAL_MS = 60_000;

/**
 * IVX-CERT-INTEGRITY-001 corrective action: hard wall-clock ceiling for the
 * VERIFYING stage. verifyLiveCommitMatch() polls Render + the live /version
 * endpoint and could previously stall the whole job at VERIFYING/90%
 * indefinitely if either external call hung. Configurable via
 * IVX_WORKER_VERIFY_TIMEOUT_MS; defaults to 3 minutes.
 */
const VERIFY_STAGE_TIMEOUT_MS: number = (() => {
  const env = process.env.IVX_WORKER_VERIFY_TIMEOUT_MS;
  const parsed = env ? Number.parseInt(env, 10) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 3 * 60 * 1000;
})();

/** Granular execution stages tracked in real time. */
export type IVXWorkerJobStage =
  | 'QUEUED'
  | 'RUNNING'
  | 'PATCHING'
  | 'TESTING'
  | 'COMMITTING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED';

export type IVXWorkerJobStatus =
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
  | 'cancelled';

/** Map granular stages to progress percentages. */
const STAGE_PROGRESS: Record<IVXWorkerJobStage, number> = {
  QUEUED: 0,
  RUNNING: 10,
  PATCHING: 25,
  TESTING: 50,
  COMMITTING: 65,
  DEPLOYING: 80,
  VERIFYING: 90,
  COMPLETED: 100,
  FAILED: 0,
};

/** Owner-approved task accepted by the worker. Never carries secret values. */
export type IVXWorkerJobInput = {
  goal: string;
  /** Owner approval was verified at the API boundary before enqueue. */
  ownerApproved: boolean;
  /** Apply the prepared safe code patch. */
  approvePatch: boolean;
  /** Strict confirmation text required by the runtime patch gate
   *  (IVX_SAFE_PATCH_CONFIRM_TEXT). Without it, proposed patches BLOCK at the
   *  gate even when approvePatch=true. */
  patchConfirmationText?: string;
  /** Commit + push + deploy to production (real mutation). */
  approveGitDeploy: boolean;
  /** Strict confirmation text required by the git-deploy gate
   *  (IVX_GIT_DEPLOY_CONFIRM_TEXT). */
  gitDeployConfirmationText?: string;
  validationMode: 'focused' | 'typecheck';
  /** System bypass run (autonomous). Only set when role==='system'. */
  systemMode: boolean;
  /** Visible approval contract recorded for the audit trail (no secrets). */
  ownerApprovedAction: IVXSeniorDeveloperApprovedActionContract | null;
  /** Owner identifier for per-owner single-flight enforcement. */
  ownerId?: string;
  /** Execution mode: 'read_only' routes through the read-only inspection
   *  runtime (no file edits / commit / deploy / migrations). 'code_change'
   *  routes through the IVX Autonomous Coder engine (LLM-generated patch →
   *  apply → test → typecheck → commit, NO deploy). 'deploy' routes through
   *  the Autonomous Coder with deploy approval (commit → deploy → verify).
   *  'factory' routes through the IVX Factory Engine (create_directory /
   *  create_module / install_dependency / run_supabase_migration / run_build /
   *  create_tool / upgrade_self — owner-gated by CONFIRM_IVX_FACTORY_MODE).
   *  Undefined/absent routes through the full developer_executor pipeline
   *  (default, legacy behavior). */
  executionMode?: IVXInspectionExecutionMode | IVXAutonomousCoderMode | IVXQAOnlyExecutionMode | 'factory';
  /** Factory-mode operations (from the LLM plan). Required when executionMode === 'factory'. */
  factoryOperations?: IVXFactoryOperation[];
  /** Factory-mode approval phrase (must equal CONFIRM_IVX_FACTORY_MODE). */
  factoryApprovalPhrase?: string;
  /** Conversation ID from IVX IA Chat — used by the recovery sweep to persist
   *  the final evidence as an assistant message after the job completes. */
  conversationId?: string | null;
  /** Owner mandate 2026-08-23 (dashboard provenance): the IA agent the job is
   *  attributed to, if any. UNKNOWN provenance cannot receive a senior
   *  development certificate. */
  agentId?: string | null;
  agentNumber?: number | null;
  agentName?: string | null;
  /** Owner mandate 2026-08-28 (Mission 1/F): canonical correlation task id
   *  (e.g. the campaign record key) carried into commit/PR attribution. */
  taskId?: string | null;
  /** ID of the source chat message that created this job (chat → worker
   *  golden chain). Generated by the handoff when the caller has none. */
  sourceChatMessageId?: string | null;
  /** Who created this job: AUTONOMOUS (IA), HUMAN (owner via chat/API),
   *  CI, or SYSTEM (scheduler/watchdog). */
  actor?: 'AUTONOMOUS' | 'HUMAN' | 'CI' | 'SYSTEM';
  /** Approval records created at enqueue time with IDs, scopes, and expiration.
   *  Replaces inline boolean flags with trackable, single-use approval objects. */
  approvalRecords?: {
    patchApprovalId: string;
    gitDeployApprovalId: string | null;
    expiresAt: string;
  } | null;
};

export type IVXWorkerJob = {
  /** Physical isolation receipt retained after the active lease is released. */
  workspaceEvidence?: CoderWorkspaceEvidence & {
    jobId: string;
    taskId: string;
    ownerId: string;
    agentId: string | null;
    agentNumber: number | null;
    workerInstanceId: string | null;
    leaseExpiresAt: string | null;
    runtimeSha: string | null;
  };
  leaseWorkerInstanceId?: string | null;
  leaseExpiresAt?: string | null;
  jobId: string;
  status: IVXWorkerJobStatus;
  /** Granular execution stage (QUEUED, RUNNING, PATCHING, etc.). */
  stage: IVXWorkerJobStage;
  /** Progress percentage 0-100 based on the current stage. */
  progressPercent: number;
  /** Human-readable detail about the current stage. */
  stageDetail: string;
  input: IVXWorkerJobInput;
  /** Owner identifier for single-flight enforcement. */
  ownerId: string;
  createdAt: string;
  startedAt: string | null;
  /** Updated by every persisted stage change; prevents active work from being
   * misclassified as stale simply because it has been running for a while. */
  lastHeartbeatAt?: string | null;
  finishedAt: string | null;
  cancelledAt: string | null;
  attempts: number;
  /** Compact, secret-safe result summary once the job finishes. */
  result: IVXWorkerJobResult | null;
  error: string | null;
  /** Phase 12 idempotency key — deterministic per owner + normalized goal +
   *  approval context. Duplicate requests with the same key attach to the
   *  existing job instead of creating a duplicate. */
  idempotencyKey?: string;
};

/** Secret-safe proof summary written to the durable ledger. */
import type { IVXTaskType } from './ivx-completion-validator';

export type IVXWorkerJobResult = {
  workspaceEvidence?: CoderWorkspaceEvidence;
  jobId: string;
  goal: string;
  ok: boolean;
  endToEndProductionComplete: boolean;
  changedFiles: string[];
  testsRun: boolean;
  testsPassed: boolean;
  typecheckRun: boolean;
  typecheckPassed: boolean;
  buildRun: boolean;
  commitCreated: boolean;
  commitSha: string | null;
  commitUrl: string | null;
  pushed: boolean;
  branch: string | null;
  /** Owner mandate 2026-08-23 (dashboard provenance): repository files the
   *  autonomous runtime inspected before patching. */
  filesInspected?: string[];
  /** Pull request created from autonomous branch to main (code_change mode). */
  prNumber: number | null;
  prUrl: string | null;
  prMerged: boolean;
  prMergeCommitSha: string | null;
  /** Owner mandate 2026-08-23 (CI-before-merge): all required GitHub checks
   *  on the PR head SHA were green before the merge. null = not measured
   *  (legacy) — the terminal-state guard fails closed on null for code tasks. */
  ciChecksGreen?: boolean | null;
  /** Per-required-check evidence captured during the CI wait. */
  ciCheckEvidence?: IVXCiCheckEvidence[] | null;
  /** FINAL CLOSEOUT 2026-08-23 (restart/CI-wait resume): resume state persisted
   *  the instant the PR is created — BEFORE the CI wait begins — so a worker
   *  restart mid-wait resumes the merge chain with the same jobId instead of
   *  being orphaned for the stale sweep to expire. */
  ciResumeState?: {
    jobId: string;
    taskId: string;
    phase: 'CI_WAIT';
    commitSha: string;
    prNumber: number;
    prUrl: string;
    branch: string;
    mergeTarget: string;
    persistedAt: string;
  } | null;
  /** Owner mandate 2026-08-23: owner approval for a deploy was verified. */
  deployApproved?: boolean;
  deployId: string | null;
  deployStatus: string | null;
  deployVerified: boolean;
  /** Owner mandate 2026-07-21: true only when the chat prompt explicitly
   *  requested a deploy (executionMode === 'deploy' and owner approved).
   *  Drives whether the terminal-state guard requires deploy/health/feature
   *  verification or allows COMPLETED at commit-only scope. */
  deployRequested: boolean;
  liveCommit: string | null;
  commitMatch: boolean;
  healthOk: boolean;
  healthStatus: number | null;
  versionEndpoint: string | null;
  /** Captured deployment certification receipts; contain only endpoint, HTTP status, and SHA. */
  healthResponse?: { endpoint: string; httpStatus: number | null; commitSha: string | null; ok: boolean } | null;
  versionResponse?: { endpoint: string; httpStatus: number | null; commitSha: string | null; ok: boolean } | null;
  generatedFeatureSlug: string | null;
  auditFiles: { json: string; jsonl: string };
  /** IN_PROGRESS preserves a committed checkpoint without claiming a final outcome. */
  finalStatus: 'COMPLETE' | 'LOCAL_ONLY' | 'BLOCKED' | 'FAILED' | 'IN_PROGRESS';
  error: string | null;
  durable: boolean;
  generatedAt: string;
  /** Classification of the task type used by the completion validator to decide
   *  whether no-code-change is acceptable (e.g. DEPLOYMENT) or a failure
   *  (e.g. CODE_FIX). */
  taskType?: IVXTaskType;
  /** Factory-mode diagnostics: records whether the post-factory GitHub commit step
   *  fired and, if it did, the exact reason it succeeded or failed. Used to
   *  diagnose the COMMIT SHA NONE gap without depending on runtime logs. */
  factoryCommitDiagnostics?: {
    stepReached: boolean;
    approved: boolean;
    filesCreatedCount: number;
    finalStatus: string;
    commitAttempted: boolean;
    commitOk: boolean | null;
    commitError: string | null;
    commitSha: string | null;
  };
  /** Phase 11 structured execution record — the canonical 22-field record the
   *  narrative engine reads to generate the owner-facing response. Populated
   *  during execution and stored on the result so the answer-format can render
   *  the 7-section narrative from it. */
  executionRecord?: IVXExecutionRecord;
  /** Bounded command receipts retained in the shared queue and proof ledger.
   * Output is fingerprinted, not copied: test output can contain credentials. */
  validationEvidence?: {
    command: string;
    phase?: 'regression_baseline';
    kind: 'test' | 'typecheck' | 'other';
    ok: boolean;
    exitCode: number | null;
    durationMs: number;
    stdoutHash: string;
    stderrHash: string;
  }[];
  /** Phase 12 evidence fingerprint — deterministic hash of commitSha + deployId
   *  + filesChanged + finalStatus. Used by the duplicate-worker prevention to
   *  reject duplicate redeploys as separate completed development tasks. */
  evidenceFingerprint?: string;
  /** Phase 1 canonical task state — the 17-state machine value mapped from the
   *  worker stage via stageToTaskState(). Enforced by assertCanTransition() on
   *  terminal transitions. */
  taskState?: IVXTaskState;
};

type QueueDoc = {
  marker: typeof IVX_SENIOR_DEV_WORKER_MARKER;
  durable: boolean;
  updatedAt: string;
  jobs: IVXWorkerJob[];
};

type LedgerDoc = {
  marker: typeof IVX_SENIOR_DEV_WORKER_MARKER;
  durable: boolean;
  updatedAt: string;
  entries: IVXWorkerJobResult[];
};

function nowIso(): string {
  return new Date().toISOString();
}

function emptyQueue(durable: boolean): QueueDoc {
  return { marker: IVX_SENIOR_DEV_WORKER_MARKER, durable, updatedAt: nowIso(), jobs: [] };
}

function emptyLedger(durable: boolean): LedgerDoc {
  return { marker: IVX_SENIOR_DEV_WORKER_MARKER, durable, updatedAt: nowIso(), entries: [] };
}

/**
 * In-memory mirror so the queue/worker keep functioning even when Supabase is
 * not configured (local dev / tests) and to avoid a read-modify-write race
 * between the enqueue call and the async drain.
 */
let memoryQueue: QueueDoc | null = null;
let memoryLedger: LedgerDoc | null = null;
let draining = false;
const activeDrainExecutions = new Set<Promise<IVXWorkerJobResult | null>>();
let queueStopping = false;

/** Active job callbacks for cancel signaling. */
const activeJobControllers = new Map<string, { cancelled: boolean; interrupted?: boolean; executionMode?: string }>();

function recordJobInterruption(jobId: string, controller: { cancelled: boolean; interrupted?: boolean },
  reason: 'heartbeat_unconfirmed' | 'phase_write_unconfirmed' | 'authority_unconfirmed' | 'worker_shutdown', error?: unknown): void {
  if (controller.interrupted) return;
  controller.interrupted = true;
  controller.cancelled = true;
  const message = error instanceof Error ? error.message : '';
  const event = { type: 'job_interrupted', jobId, reason, observedAt: nowIso(),
    failureClass: /timeout|timed out/i.test(message) ? 'storage_timeout'
      : /lease|authority|concurrent|conflict/i.test(message) ? 'ownership_unconfirmed' : null,
    instanceId: process.env.RENDER_INSTANCE_ID ?? null };
  // A former holder may append an observation, never overwrite the job. The
  // process log retains the cause even when the durable event store is down.
  console.warn('[IVX repair interruption]', JSON.stringify(event));
  void appendSharedSeniorProofEvent(QUEUE_FILE, event);
}
registerSeniorExecutionMetrics(() => {
  const modes = [...activeJobControllers.values()].map(c => c.executionMode);
  return { activeRepairs: modes.filter(m => m === 'code_change' || m === 'deploy' || m === 'factory').length,
    activeQA: modes.filter(m => m === 'qa_only').length, activeInspections: modes.filter(m => m === 'read_only').length,
    activeUnclassified: modes.filter(m => !['code_change', 'deploy', 'factory', 'qa_only', 'read_only'].includes(m ?? '')).length,
    configuredSlots: getWorkerMaxConcurrency() };
});

/**
 * Bounded-concurrent drain support (2026-08-22): in-process claim registry so
 * parallel `processNextSeniorDeveloperJob()` calls never double-execute the
 * same queued job. Released when the job reaches a terminal status via
 * updateJob, or when expireStaleJobs removes/requeues it.
 */
const claimedJobIds = new Set<string>();

/** Max concurrent senior-developer job executions (configurable, bounded). */
export function getWorkerMaxConcurrency(): number {
  return configuredAdmissionLimit(process.env.IVX_WORKER_MAX_CONCURRENCY, 12);
}

/**
 * A dedicated Render worker owns durable queue execution in production. The
 * web process may enqueue/read jobs, but must not also claim them: the claim
 * registry is process-local and two runtimes could execute the same job.
 */
export function shouldExecuteWorkerQueueInThisProcess(): boolean {
  if (queueStopping || process.env.IVX_PROCESS_ROLE === 'api' || (process.env.IVX_SUPABASE_RECOVERY_MODE ?? '').trim().toLowerCase() === 'true') return false;
  const dedicatedEnabled = process.env.IVX_DEDICATED_WORKER_ENABLED === 'true';
  const workerProcess = process.env.IVX_WORKER_MODE === 'true';
  return !dedicatedEnabled || workerProcess;
}

async function loadQueue(): Promise<QueueDoc> {
  const durable = isDurableStoreConfigured();
  if (!durable) {
    if (sharedSeniorQueueEnabled()) throw new Error('Shared queue storage unavailable');
    if (!memoryQueue) memoryQueue = emptyQueue(false);
    return memoryQueue;
  }
  try {
    const doc = sharedSeniorQueueEnabled() ? await readSharedSeniorDocument<QueueDoc>(QUEUE_FILE, emptyQueue(true))
      : await readDurableJson<QueueDoc>(QUEUE_FILE, emptyQueue(true));
    const queue: QueueDoc = { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
    return sharedSeniorQueueEnabled() ? rememberSeniorQueue(queue) : queue;
  } catch (error) {
    if (sharedSeniorQueueEnabled()) throw error;
    if (!memoryQueue) memoryQueue = emptyQueue(false);
    return memoryQueue;
  }
}

async function saveQueue(doc: QueueDoc): Promise<void> {
  if (sharedSeniorQueueEnabled()) {
    memoryQueue = await patchSharedSeniorQueue(doc, claimedJobIds);
    return;
  }
  const trimmed: QueueDoc = {
    marker: IVX_SENIOR_DEV_WORKER_MARKER,
    durable: doc.durable,
    updatedAt: nowIso(),
    jobs: doc.jobs.slice(-MAX_QUEUE_RETAINED),
  };
  memoryQueue = trimmed;
  if (isDurableStoreConfigured()) {
    try {
      await writeDurableJson(QUEUE_FILE, trimmed);
    } catch {
      // Durable write failed — the in-memory mirror still keeps the worker alive.
    }
  }
}

async function loadQueueForJob(jobId: string): Promise<QueueDoc> {
  if (!sharedSeniorQueueEnabled()) return loadQueue();
  if (!isDurableStoreConfigured()) throw new Error('Shared queue storage unavailable');
  const job = await readSharedSeniorJob<IVXWorkerJob>(QUEUE_FILE, jobId);
  // The patch RPC merges only changed jobs against their exact snapshots. It
  // retains other owners' jobs and enforces the same worker/lease identity.
  return rememberSeniorQueue({ ...emptyQueue(true), jobs: job ? [job] : [] });
}

async function loadWorkQueue(): Promise<QueueDoc> {
  if (!sharedSeniorQueueEnabled()) return loadQueue();
  if (!isDurableStoreConfigured()) throw new Error('Shared queue storage unavailable');
  const doc = await readSharedSeniorWorkQueue<QueueDoc>(QUEUE_FILE, emptyQueue(true));
  // The exact full job snapshots remain valid CAS baselines. The SQL patch
  // retains every omitted historical row and other owners' concurrent work.
  const queue: QueueDoc = { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
  return rememberSeniorQueue(queue);
}

async function loadLedger(): Promise<LedgerDoc> {
  const durable = isDurableStoreConfigured();
  if (!durable) {
    if (memoryLedger && memoryLedger.entries.length > 0) return memoryLedger;
    // Diskless restart fallback: recover the ledger persisted to the GitHub
    // side branch so proof survives Render deploy restarts without Supabase.
    const fromGitHub = await githubLedgerRead();
    if (fromGitHub) {
      memoryLedger = fromGitHub;
      return fromGitHub;
    }
    if (!memoryLedger) memoryLedger = emptyLedger(false);
    return memoryLedger;
  }
  try {
    const doc = sharedSeniorQueueEnabled() ? await readSharedSeniorDocument<LedgerDoc>(LEDGER_FILE, emptyLedger(true))
      : await readDurableJson<LedgerDoc>(LEDGER_FILE, emptyLedger(true));
    return { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
  } catch (error) {
    if (sharedSeniorQueueEnabled()) throw error;
    if (!memoryLedger) memoryLedger = emptyLedger(false);
    return memoryLedger;
  }
}

// ── GitHub side-branch ledger persistence (no Supabase service key needed) ──
// The ledger is committed to a NON-deploy branch so Render autoDeploy (which
// watches main) never fires from a ledger write. No secrets are stored.

const LEDGER_GITHUB_BRANCH = 'ivx-proof-ledger';
const DEFAULT_LEDGER_REPO = 'ibb142/ivx-holdings-platform';

function ledgerGithubToken(): string {
  return typeof process.env.GITHUB_TOKEN === 'string' ? process.env.GITHUB_TOKEN.trim() : '';
}

function ledgerGithubRepo(): string {
  const raw = typeof process.env.GITHUB_REPO === 'string' ? process.env.GITHUB_REPO.trim() : '';
  const match = raw.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/);
  if (match && match[1].includes('/')) return match[1];
  return DEFAULT_LEDGER_REPO;
}

function ledgerGithubHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${ledgerGithubToken()}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
}

async function githubLedgerRead(): Promise<LedgerDoc | null> {
  const token = ledgerGithubToken();
  if (!token) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${ledgerGithubRepo()}/contents/${LEDGER_FILE}?ref=${LEDGER_GITHUB_BRANCH}`,
      { headers: ledgerGithubHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) return null;
    const data = await res.json() as { content?: string };
    if (!data.content) return null;
    const decoded = Buffer.from(data.content, 'base64').toString('utf8');
    const doc = JSON.parse(decoded) as LedgerDoc;
    if (!Array.isArray(doc.entries)) return null;
    return { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
  } catch {
    return null;
  }
}

async function githubEnsureLedgerBranch(): Promise<boolean> {
  const repo = ledgerGithubRepo();
  try {
    const refRes = await fetch(
      `https://api.github.com/repos/${repo}/git/ref/heads/${LEDGER_GITHUB_BRANCH}`,
      { headers: ledgerGithubHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (refRes.ok) return true;
    const mainRes = await fetch(
      `https://api.github.com/repos/${repo}/git/ref/heads/main`,
      { headers: ledgerGithubHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (!mainRes.ok) return false;
    const mainData = await mainRes.json() as { object?: { sha?: string } };
    const baseSha = mainData.object?.sha;
    if (!baseSha) return false;
    const createRes = await fetch(`https://api.github.com/repos/${repo}/git/refs`, {
      method: 'POST',
      headers: ledgerGithubHeaders(),
      body: JSON.stringify({ ref: `refs/heads/${LEDGER_GITHUB_BRANCH}`, sha: baseSha }),
      signal: AbortSignal.timeout(10000),
    });
    return createRes.ok;
  } catch {
    return false;
  }
}

async function githubLedgerWrite(doc: LedgerDoc): Promise<boolean> {
  const token = ledgerGithubToken();
  if (!token) return false;
  const repo = ledgerGithubRepo();
  try {
    if (!(await githubEnsureLedgerBranch())) return false;
    let existingSha: string | undefined;
    const currentRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${LEDGER_FILE}?ref=${LEDGER_GITHUB_BRANCH}`,
      { headers: ledgerGithubHeaders(), signal: AbortSignal.timeout(10000) },
    );
    if (currentRes.ok) {
      const current = await currentRes.json() as { sha?: string };
      existingSha = current.sha;
    }
    const putRes = await fetch(
      `https://api.github.com/repos/${repo}/contents/${LEDGER_FILE}`,
      {
        method: 'PUT',
        headers: ledgerGithubHeaders(),
        body: JSON.stringify({
          message: `chore(ledger): proof ledger update ${nowIso()}`,
          content: Buffer.from(JSON.stringify(doc, null, 2), 'utf8').toString('base64'),
          branch: LEDGER_GITHUB_BRANCH,
          ...(existingSha ? { sha: existingSha } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      },
    );
    return putRes.ok;
  } catch {
    return false;
  }
}

async function appendLedger(result: IVXWorkerJobResult): Promise<void> {
  if (sharedSeniorQueueEnabled()) {
    await putSharedSeniorResult(result);
    await appendSharedSeniorProofEvent(LEDGER_FILE, { type: 'proof_ledger_entry', ...result } as Record<string, unknown>);
    return;
  }
  // Phase 12: fingerprint the evidence and reject duplicate redeploys as
  // separate completed development tasks. A duplicate fingerprint (same
  // commitSha + deployId + filesChanged + finalStatus) is logged but the entry
  // is still recorded (marked as duplicate) so the ledger is complete.
  const fingerprint = fingerprintEvidence({
    commitSha: result.commitSha,
    deployId: result.deployId,
    filesChanged: result.changedFiles,
    finalStatus: result.finalStatus,
  });
  result.evidenceFingerprint = fingerprint;
  const current = await loadLedger();
  const priorMatch = current.entries.find((e) => e.evidenceFingerprint === fingerprint && e.jobId !== result.jobId);
  if (priorMatch) {
    appendDurableEvent(LEDGER_FILE, { type: 'duplicate_evidence_rejected', jobId: result.jobId, priorJobId: priorMatch.jobId, fingerprint }).catch(() => {});
  }
  const entries = [result, ...current.entries.filter((e) => e.jobId !== result.jobId)].slice(0, MAX_LEDGER_RETAINED);
  const doc: LedgerDoc = {
    marker: IVX_SENIOR_DEV_WORKER_MARKER,
    durable: isDurableStoreConfigured(),
    updatedAt: nowIso(),
    entries,
  };
  memoryLedger = doc;
  if (isDurableStoreConfigured()) {
    try {
      await writeDurableJson(LEDGER_FILE, doc);
      await appendDurableEvent(LEDGER_FILE, { type: 'proof_ledger_entry', ...result } as Record<string, unknown>);
    } catch {
      // Durable write failed — in-memory ledger still holds the entry.
    }
  } else {
    // No Supabase service key in this runtime — persist to the GitHub side
    // branch so proof survives Render's diskless deploy restarts.
    await githubLedgerWrite({ ...doc, durable: true });
  }
}

/**
 * Archive an externally-produced deployment proof (e.g. from the chat
 * deployment brain's /deploy-pipeline) into the same durable proof ledger the
 * worker writes, so /senior-proof and /senior-ledger surface it.
 */
export async function archiveDeploymentProofToLedger(entry: IVXWorkerJobResult): Promise<boolean> {
  try {
    await appendLedger(entry);
    return true;
  } catch {
    return false;
  }
}

/**
 * Derive a secret-safe proof summary from a read-only inspection proof. The
 * result shape is the same `IVXWorkerJobResult` the durable ledger stores for
 * developer_executor jobs, so /senior-proof and /senior-ledger surface it the
 * same way. All mutation flags are forced false (read-only mode never edits,
 * commits, pushes, or deploys).
 */
export function summarizeReadOnlyInspectionProof(
  jobId: string,
  proof: IVXReadOnlyInspectionProof,
): IVXWorkerJobResult {
  const finalStatus: IVXWorkerJobResult['finalStatus'] = proof.finalStatus === 'COMPLETED'
    ? 'COMPLETE'
    : proof.finalStatus === 'BLOCKED'
      ? 'BLOCKED'
      : 'FAILED';
  return {
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: proof.finalStatus === 'COMPLETED',
    endToEndProductionComplete: false,
    changedFiles: [],
    testsRun: proof.commandsRun.some((cmd) => cmd.kind === 'run_tests'),
    testsPassed: proof.commandsRun.some((cmd) => cmd.kind === 'run_tests') && proof.commandsRun.filter((cmd) => cmd.kind === 'run_tests').every((cmd) => cmd.ok),
    typecheckRun: proof.commandsRun.some((cmd) => cmd.kind === 'typecheck'),
    typecheckPassed: proof.commandsRun.some((cmd) => cmd.kind === 'typecheck') && proof.commandsRun.filter((cmd) => cmd.kind === 'typecheck').every((cmd) => cmd.ok),
    buildRun: false,
    commitCreated: false,
    commitSha: null,
    commitUrl: null,
    pushed: false,
    branch: null,
    prNumber: null,
    prUrl: null,
    prMerged: false,
    prMergeCommitSha: null,
    deployId: null,
    deployStatus: null,
    deployVerified: false,
    deployRequested: false,
    liveCommit: null,
    commitMatch: false,
    healthOk: false,
    healthStatus: null,
    versionEndpoint: null,
    generatedFeatureSlug: null,
    auditFiles: { json: '', jsonl: '' },
    finalStatus,
    error: proof.error,
    durable: isDurableStoreConfigured(),
    generatedAt: proof.generatedAt,
    taskType: classifyTaskType(proof.goal),
  };
}

export function summarizeFactoryJobProof(
  jobId: string,
  proof: IVXFactoryJobProof,
): IVXWorkerJobResult {
  const finalStatus: IVXWorkerJobResult['finalStatus'] = proof.finalStatus === 'COMPLETED'
    ? 'COMPLETE'
    : proof.finalStatus === 'BLOCKED'
      ? 'BLOCKED'
      : 'FAILED';
  const anyBuildOk = proof.buildsProduced.some((b) => b.ok);
  return {
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: proof.finalStatus === 'COMPLETED',
    endToEndProductionComplete: false,
    changedFiles: proof.filesCreated.slice(0, 25),
    testsRun: proof.operations.some((op) => op.kind === 'run_build'),
    testsPassed: proof.finalStatus === 'COMPLETED',
    typecheckRun: false,
    typecheckPassed: true,
    buildRun: proof.operations.some((op) => op.kind === 'run_build'),
    commitCreated: false,
    commitSha: null,
    commitUrl: null,
    pushed: false,
    branch: null,
    prNumber: null,
    prUrl: null,
    prMerged: false,
    prMergeCommitSha: null,
    deployId: null,
    deployStatus: null,
    deployVerified: false,
    deployRequested: false,
    liveCommit: null,
    commitMatch: false,
    healthOk: false,
    healthStatus: null,
    versionEndpoint: null,
    generatedFeatureSlug: proof.capabilitiesAdded.length > 0 ? proof.capabilitiesAdded.join(',') : null,
    auditFiles: { json: '', jsonl: '' },
    finalStatus,
    error: proof.error,
    durable: isDurableStoreConfigured(),
    generatedAt: proof.generatedAt,
    taskType: classifyTaskType(proof.goal),
  };
}

/**
 * Derive a secret-safe proof summary from a QA-only run proof. The result
 * shape is the same `IVXWorkerJobResult` the durable ledger stores for
 * developer_executor jobs, so /senior-proof and /senior-ledger surface it
 * the same way. All mutation flags are forced false (QA-only mode never
 * edits, commits, pushes, or deploys). Tests/typecheck flags reflect the
 * real QA run outcome.
 */
export function summarizeQAOnlyProof(
  jobId: string,
  proof: IVXQAOnlyProof,
): IVXWorkerJobResult {
  const finalStatus: IVXWorkerJobResult['finalStatus'] = proof.finalStatus === 'COMPLETED'
    ? 'COMPLETE'
    : proof.finalStatus === 'BLOCKED'
      ? 'BLOCKED'
      : 'FAILED';
  return {
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: proof.finalStatus === 'COMPLETED',
    endToEndProductionComplete: false,
    changedFiles: [],
    testsRun: proof.commandsRun.some((cmd) => cmd.kind === 'run_tests'),
    testsPassed: proof.finalStatus === 'COMPLETED' && proof.passed > 0 && proof.failed === 0,
    typecheckRun: proof.commandsRun.some((cmd) => cmd.kind === 'typecheck'),
    typecheckPassed: proof.commandsRun.some((cmd) => cmd.kind === 'typecheck') && proof.commandsRun.filter((cmd) => cmd.kind === 'typecheck').every((cmd) => cmd.ok),
    buildRun: false,
    commitCreated: false,
    commitSha: null,
    commitUrl: null,
    pushed: false,
    branch: null,
    prNumber: null,
    prUrl: null,
    prMerged: false,
    prMergeCommitSha: null,
    deployId: null,
    deployStatus: null,
    deployVerified: false,
    deployRequested: false,
    liveCommit: null,
    commitMatch: false,
    healthOk: false,
    healthStatus: null,
    versionEndpoint: null,
    generatedFeatureSlug: null,
    auditFiles: { json: '', jsonl: '' },
    finalStatus,
    error: proof.error,
    durable: isDurableStoreConfigured(),
    generatedAt: proof.generatedAt,
    taskType: classifyTaskType(proof.goal),
  };
}

/** Map a QA-only runtime phase to a worker job stage. */
function qaPhaseToStage(phase: IVXQAOnlyPhase): { stage: IVXWorkerJobStage; detail: string } {
  switch (phase) {
    case 'queued':
      return { stage: 'QUEUED', detail: 'QA-only run queued.' };
    case 'module_identified':
      return { stage: 'RUNNING', detail: 'Identifying module keywords from goal.' };
    case 'files_inspected':
      return { stage: 'RUNNING', detail: 'Inspecting module source files.' };
    case 'tests_selected':
      return { stage: 'TESTING', detail: 'Selecting test files matching the module.' };
    case 'tests_executed':
      return { stage: 'TESTING', detail: 'Running targeted module tests.' };
    case 'typecheck_run':
      return { stage: 'VERIFYING', detail: 'Running scoped typecheck.' };
    case 'lint_run':
      return { stage: 'VERIFYING', detail: 'Running lint.' };
    case 'completed':
      return { stage: 'COMPLETED', detail: 'QA-only run completed. No files changed, no commit, no deploy.' };
    case 'blocked':
      return { stage: 'FAILED', detail: 'QA-only run blocked (QA_TARGET_NOT_FOUND).' };
    case 'failed':
      return { stage: 'FAILED', detail: 'QA-only run failed.' };
    default:
      return { stage: 'RUNNING', detail: `Phase: ${phase}` };
  }
}

/**
 * Derive a secret-safe proof summary from an autonomous-coder run proof.
 * Same `IVXWorkerJobResult` shape the durable ledger stores, so /senior-proof
 * and /senior-ledger surface it the same way. Mutation flags reflect the
 * real autonomous-coder outcome (patch applied, commit created, deploy
 * triggered, production verified).
 */
/**
 * Reject stale or incomplete mutation evidence before it can enter the durable
 * ledger as a completed code-change or deploy job. A mutation must create a
 * commit after its captured starting SHA; a deploy must additionally prove the
 * new commit is live. This is intentionally stricter than a health-only check.
 */
function autonomousCoderMutationProofError(proof: IVXAutonomousCoderProof): string | null {
  const isMutation = proof.executionMode === 'code_change' || proof.executionMode === 'deploy';
  if (!isMutation || proof.finalStatus !== 'COMPLETED') return null;
  // A resumed job may find the PR already merged; the original files were
  // captured in the first run and are now in main, so an empty filesChanged
  // list is acceptable as long as the merge itself is confirmed.
  const resumeMerged = proof.resumedFromRestart && proof.prMerged;
  if (proof.filesChanged.length === 0 && !resumeMerged) return 'Code-change job produced no changed files; stale evidence is not accepted.';
  if (!proof.commitSha) return 'Code-change job produced no commit SHA; stale evidence is not accepted.';
  if (proof.startingSha && proof.commitSha === proof.startingSha) return 'Code-change job reused its starting commit SHA; stale evidence is not accepted.';
  if (proof.executionMode === 'deploy') {
    if (proof.branch !== 'main') return `Production deployment commit was rejected because it landed on ${proof.branch ?? 'no branch'}, not the approved production branch main.`;
    if (!proof.deployId) return 'Deploy job produced no Render deployment ID.';
    if (proof.deployStatus !== 'live') return `Deploy job did not reach Render live status (status=${proof.deployStatus ?? 'missing'}).`;
    if (!proof.healthOk || !proof.healthResponse?.ok || proof.healthResponse.commitSha !== proof.commitSha) return 'Deploy job did not verify a healthy production /health response with the requested commit.';
    if (!proof.versionResponse?.ok || proof.versionResponse.commitSha !== proof.commitSha) return 'Deploy job did not verify a production /version response with the requested commit.';
    if (!proof.productionVerified || proof.liveCommit !== proof.commitSha) return 'Deploy job did not verify its new commit in production.';
  }
  return null;
}

function validationEvidenceFromCommands(commands: IVXAutonomousCoderProof['commandsRun']): NonNullable<IVXWorkerJobResult['validationEvidence']> {
  return commands.slice(0, 24).map(cmd => ({
    command: cmd.command.slice(0, 1000),
    ...(cmd.phase ? { phase: cmd.phase } : {}),
    kind: /(?:^|\s)(?:test|--test)(?:\s|$)/.test(cmd.command) ? 'test' as const
      : /(?:^|[\s/])tsc(?:\s|$)|--noEmit\b/.test(cmd.command) ? 'typecheck' as const : 'other' as const,
    ok: cmd.ok,
    exitCode: cmd.exitCode,
    durationMs: cmd.durationMs,
    stdoutHash: createHash('sha256').update(cmd.stdoutTail).digest('hex'),
    stderrHash: createHash('sha256').update(cmd.stderrTail).digest('hex'),
  }));
}

export function summarizeAutonomousCoderProof(
  jobId: string,
  proof: IVXAutonomousCoderProof,
): IVXWorkerJobResult {
  const mutationProofError = autonomousCoderMutationProofError(proof);
  const completed = proof.finalStatus === 'COMPLETED' && mutationProofError === null;
  const finalStatus: IVXWorkerJobResult['finalStatus'] = completed
    ? (proof.commitSha ? 'COMPLETE' : 'LOCAL_ONLY')
    : proof.finalStatus === 'BLOCKED'
      ? 'BLOCKED'
      : 'FAILED';
  return {
    ...(proof.workspaceEvidence ? { workspaceEvidence: proof.workspaceEvidence } : {}),
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: completed,
    endToEndProductionComplete: completed && proof.productionVerified,
    changedFiles: proof.filesChanged.slice(0, 25),
    filesInspected: proof.filesInspected.slice(0, 25),
    testsRun: proof.commandsRun.some((cmd) => /(?:^|\s)(?:test|--test)(?:\s|$)/.test(cmd.command)),
    testsPassed: proof.testsPassed,
    typecheckRun: proof.commandsRun.some((cmd) => /tsc|typecheck|noEmit/i.test(cmd.command)),
    typecheckPassed: proof.typecheckPassed,
    buildRun: proof.buildRun,
    commitCreated: Boolean(proof.commitSha),
    commitSha: proof.commitSha,
    commitUrl: proof.commitUrl,
    pushed: Boolean(proof.commitSha),
    branch: proof.branch,
    prNumber: proof.prNumber ?? null,
    prUrl: proof.prUrl ?? null,
    prMerged: proof.prMerged ?? false,
    prMergeCommitSha: proof.prMergeCommitSha ?? null,
    ciChecksGreen: proof.ciChecksGreen ?? null,
    ciCheckEvidence: proof.ciCheckEvidence ?? null,
    deployApproved: proof.deployApproved,
    deployId: proof.deployId,
    deployStatus: proof.deployStatus,
    deployVerified: completed && proof.productionVerified,
    deployRequested: proof.deployApproved && completed && Boolean(proof.deployId),
    liveCommit: proof.liveCommit,
    commitMatch: completed && proof.productionVerified && proof.liveCommit === proof.commitSha,
    healthOk: completed && proof.healthOk,
    healthStatus: proof.healthResponse?.httpStatus ?? null,
    versionEndpoint: proof.versionResponse?.endpoint ?? null,
    healthResponse: proof.healthResponse,
    versionResponse: proof.versionResponse,
    generatedFeatureSlug: null,
    validationEvidence: validationEvidenceFromCommands(proof.commandsRun),
    auditFiles: { json: '', jsonl: '' },
    finalStatus,
    error: mutationProofError ?? proof.error,
    durable: isDurableStoreConfigured(),
    generatedAt: proof.generatedAt,
    taskType: classifyTaskType(proof.goal),
  };
}

/**
 * Derive a secret-safe proof summary from a full senior-developer run proof and
 * the optional deploy-match verification.
 */
export function summarizeProof(
  jobId: string,
  proof: IVXSeniorDeveloperRunProof,
  match: Awaited<ReturnType<typeof verifyLiveCommitMatch>> | null,
): IVXWorkerJobResult {
  const validations = proof.validations;
  const testValidation = validations.find((v) => /test|import-smoke/i.test(v.command)) ?? null;
  const typecheckValidation = validations.find((v) => /tsc|typecheck|noEmit/i.test(v.command)) ?? null;
  const commitSha = proof.gitDeployOperator.github.commitSha;
  const commitCreated = Boolean(commitSha) && proof.gitDeployOperator.github.commitAttempted;
  const deployId = proof.gitDeployOperator.render.deployId;
  const deployStatus = proof.gitDeployOperator.render.deployStatus;
  const healthOk = proof.productionVerification.ok;

  const finalStatus: IVXWorkerJobResult['finalStatus'] = proof.endToEndProductionComplete
    ? 'COMPLETE'
    : proof.ok
      ? 'LOCAL_ONLY'
      : proof.gitDeployOperator.status === 'blocked_missing_credentials'
        || proof.gitDeployOperator.status === 'ready_owner_approval_required'
        ? 'BLOCKED'
        : 'FAILED';

  return {
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: proof.ok,
    endToEndProductionComplete: proof.endToEndProductionComplete,
    changedFiles: proof.changedFiles.slice(0, 25),
    testsRun: testValidation !== null,
    testsPassed: validations.length > 0 && validations.every((v) => v.ok),
    typecheckRun: typecheckValidation !== null,
    typecheckPassed: typecheckValidation ? typecheckValidation.ok : false,
    buildRun: validations.length > 0,
    commitCreated,
    commitSha,
    commitUrl: proof.gitDeployOperator.github.commitUrl,
    pushed: commitCreated,
    branch: proof.gitDeployOperator.github.branch,
    prNumber: null,
    prUrl: null,
    prMerged: false,
    prMergeCommitSha: null,
    deployId,
    deployStatus,
    deployVerified: match?.match ?? false,
    deployRequested: proof.endToEndProductionComplete && Boolean(deployId),
    liveCommit: match?.liveCommit ?? null,
    commitMatch: match?.match ?? false,
    healthOk,
    healthStatus: proof.productionVerification.httpStatus,
    versionEndpoint: match?.versionEndpoint ?? null,
    generatedFeatureSlug: proof.generatedFeature.feature?.slug ?? null,
    auditFiles: proof.auditFiles,
    finalStatus,
    error: proof.ok ? null : (proof.gitDeployOperator.reason || proof.productionVerification.error || 'Run did not complete end-to-end.'),
    durable: isDurableStoreConfigured(),
    generatedAt: proof.generatedAt,
    taskType: classifyTaskType(proof.goal),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// STALE JOB EXPIRATION
// ─────────────────────────────────────────────────────────────────────────────

/** Statuses that are considered "active" (still in progress). */
const ACTIVE_STATUSES: ReadonlySet<IVXWorkerJobStatus> = new Set(SENIOR_QUEUE_ACTIVE_STATUSES);

/**
 * Expire active jobs whose last heartbeat is older than `STALE_JOB_TIMEOUT_MS`.
 * Jobs created before heartbeat tracking fall back to `startedAt`. Stale jobs are
 * marked FAILED with an honest reason. This frees the queue so
 * a new job can start for the same owner.
 *
 * @returns array of expired job IDs
 */
export async function expireStaleJobs(): Promise<string[]> {
  let queue = await loadWorkQueue();
  // Recover a commit before generic lease expiry can replay code generation.
  // An uncertain GitHub lookup also cannot authorize replay of COMMITTING work.
  try { await recoverStuckCommittingJobs(queue); }
  catch { /* An uncertain lookup never permits regeneration of COMMITTING work below. */ }
  queue = await loadWorkQueue();
  const now = Date.now();
  const expired: string[] = [];

  for (const job of queue.jobs) {
    if (!ACTIVE_STATUSES.has(job.status)) continue;
    // FINAL CLOSEOUT 2026-08-23: a job whose CI-wait resume is actively running
    // in this process is alive — its heartbeat is refreshed by the resume's
    // onPhase callbacks. Never expire it out from under the resume.
    if (activeCiResumeJobIds.has(job.jobId)) continue;
    // A published commit must resume verification, even when an older retry
    // left its phase at QUEUED/RUNNING. Never expire or recode that checkpoint.
    if (job.result?.commitSha) continue;
    if (sharedSeniorQueueEnabled()) {
      // A live physical lease outranks an old phase timestamp. Committed
      // work belongs to the dedicated recovery below, not generic expiry:
      // retaining an old lease identity in a FAILED patch blocks the sweep.
      if (job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) > now) continue;
    }
    const activityAt = job.lastHeartbeatAt ?? job.startedAt;
    if (!activityAt) continue;
    const activityAtMs = new Date(activityAt).getTime();
    if (Number.isNaN(activityAtMs)) continue;
    if (sharedSeniorQueueEnabled() && job.leaseExpiresAt && Date.parse(job.leaseExpiresAt) <= now && !job.result?.commitSha) {
      const missingCommitIdentity = job.stage === 'COMMITTING';
      job.status = !missingCommitIdentity && job.attempts < 3 ? 'queued' : 'failed';
      job.stage = job.status === 'queued' ? 'QUEUED' : 'FAILED';
      job.finishedAt = job.status === 'failed' ? nowIso() : null;
      job.progressPercent = STAGE_PROGRESS[job.stage];
      job.leaseWorkerInstanceId = null; job.leaseExpiresAt = null;
      job.error = missingCommitIdentity
        ? 'COMMIT_CHECKPOINT_IDENTITY_UNRESOLVED: expired commit phase retained for exact recovery; code generation was not replayed.'
        : 'Physical worker lease expired; recovery budget enforced.';
      job.stageDetail = job.error;
      expired.push(job.jobId);
      continue;
    }
    if (now - activityAtMs > STALE_JOB_TIMEOUT_MS) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.stageDetail = `Job expired after ${Math.round(STALE_JOB_TIMEOUT_MS / 1000)}s without a worker heartbeat.`;
      job.finishedAt = nowIso();
      job.error = `Stale job expired after heartbeat timeout (${STALE_JOB_TIMEOUT_MS}ms).`;
      if (sharedSeniorQueueEnabled()) {
        job.leaseWorkerInstanceId = null;
        job.leaseExpiresAt = null;
      }
      expired.push(job.jobId);
    }
  }

  if (expired.length > 0) {
    await saveQueue(queue);
    for (const jobId of expired) {
      appendDurableEvent(QUEUE_FILE, { type: 'job_expired', jobId, reason: 'stale_timeout' }).catch(() => {});
    }
  }

  // RESILIENCE LAYER 3: recover jobs stuck at COMMITTING whose worker process
  // was killed after the GitHub commit landed but before the proof returned.
  try {
    await recoverStuckCommittingJobs(queue as QueueDoc);
  } catch {
    // Recovery must never break the stale sweep.
  }

  // RESILIENCE LAYER 4: recover jobs stuck at VERIFYING whose worker process
  // was killed by the Render deploy it triggered. The onCommitLanded callback
  // already persisted the commit SHA to the job record before the deploy fired.
  // On the next boot (or periodic sweep), this recovery checks whether
  // production is now serving that commit and, if so, completes the job with
  // full verified evidence — the exact fix for the ivx-worker-ffe60f09 job
  // that was stuck at VERIFYING 90% forever.
  try {
    await recoverStuckVerifyingJobs(queue as QueueDoc);
  } catch {
    // Recovery must never break the stale sweep.
  }

  // RESILIENCE LAYER 5 (FINAL CLOSEOUT 2026-08-23): resume jobs whose worker
  // process was restarted while waiting for the PR's required CI checks. The
  // onPrCreated callback persisted the full resume state (commitSha, prNumber,
  // prUrl, branch) BEFORE the CI wait began; on boot or periodic sweep this
  // re-queries the PR + required checks and continues the merge chain with the
  // SAME jobId (never a duplicate, never a false COMPLETED).
  try {
    await recoverStuckCiWaitJobs(queue as QueueDoc);
  } catch {
    // Recovery must never break the stale sweep.
  }

  return expired;
}

/** How long a job may sit at COMMITTING before the recovery sweep investigates.
 *  Shorter than STALE_JOB_TIMEOUT_MS so we recover before the stale sweep marks
 *  the job FAILED (which would lose the real commit evidence). */
const COMMITTING_RECOVERY_THRESHOLD_MS = 2 * 60 * 1000; // 2 min

/** FINAL CLOSEOUT 2026-08-23 (restart/CI-wait resume): jobIds with a CI-wait
 *  resume actively running in this process. Guards both the stale sweep (never
 *  expire a resuming job) and the resume sweep (never spawn a duplicate
 *  resume for the same job). */
const activeCiResumeJobIds = new Set<string>();

/** How long a job may sit in the CI-wait state (commit landed + PR open,
 *  unmerged) before the resume sweep takes over (ms). Shorter than
 *  STALE_JOB_TIMEOUT_MS so the resume wins before the stale sweep expires the
 *  job — that expiry was the original gap (in-flight CI waits never resumed). */
const CI_WAIT_RESUME_THRESHOLD_MS = 90 * 1000; // 90s

/**
 * Resume code-change jobs whose worker process was killed while waiting for
 * the PR's required CI checks (FINAL CLOSEOUT 2026-08-23).
 *
 * Candidates: stale active jobs with a persisted commitSha, expired lease and no
 * confirmed merge. Recover a missing PR identity from the exact stored branch
 * before resuming; a commit alone never certifies completion. For each,
 * ONE background resume is spawned (guarded by activeCiResumeJobIds) that
 * re-queries the PR and required checks and continues the chain:
 *   checks running → keep waiting · checks green → merge · checks red → BLOCKED
 *   already merged → reconcile merge SHA → COMPLETED.
 *
 * The resume reuses the ORIGINAL jobId and taskId — no duplicate job is ever
 * created, and the job never falsely completes without a merged PR + green CI.
 */
async function recoverStuckCiWaitJobs(queue: QueueDoc): Promise<void> {
  const candidates = queue.jobs.filter((j) =>
    isCommittedRecoveryCandidate(j, Date.now(), CI_WAIT_RESUME_THRESHOLD_MS)
    && !activeCiResumeJobIds.has(j.jobId));
  if (candidates.length === 0) return;
  for (const job of candidates) {
    if (new Set([...claimedJobIds, ...activeCiResumeJobIds]).size >= getWorkerMaxConcurrency()) break;
    activeCiResumeJobIds.add(job.jobId);
    void resumeCiWaitJob(job.jobId).catch(() => {}).finally(() => {
      activeCiResumeJobIds.delete(job.jobId);
    });
  }
}

/** Background resume for a single CI-wait job. Runs the resumable coder entry
 *  point with the persisted state and finalizes the job exactly like the
 *  normal autonomous-coder path (COMPLETED only on a confirmed merge). */
async function resumeCiWaitJob(jobId: string): Promise<void> {
  if (queueStopping) return;
  try { await assertEmergencyStopInactive('senior-worker-ci-recovery'); }
  catch { return; } // Retain the durable job while owner control blocks recovery.
  let job = await getSeniorDeveloperJob(jobId);
  if (!job || !ACTIVE_STATUSES.has(job.status)) return;
  if (!job.result?.commitSha) return;
  if (sharedSeniorQueueEnabled()) {
    const claimed = await claimSharedSeniorJob<IVXWorkerJob>(jobId, true);
    if (!claimed) return;
    job = claimed; claimedJobIds.add(jobId);
  }
  const controller: { cancelled: boolean; interrupted?: boolean } = { cancelled: queueStopping, interrupted: queueStopping };
  activeJobControllers.set(jobId, Object.assign(controller, { executionMode: job.input.executionMode }));
  const heartbeat = sharedSeniorQueueEnabled() ? setInterval(() => {
    if (!controller.cancelled) void updateJob(jobId, { lastHeartbeatAt: nowIso() }, true).catch(error => recordJobInterruption(jobId, controller, 'heartbeat_unconfirmed', error));
  }, 20_000) : null;
  heartbeat?.unref?.();
  try {
  const commitSha = job.result?.commitSha;
  if (!commitSha || !job.result) return;
  let prNumber = job.result.prNumber;
  if (prNumber == null) {
    try {
      const token = ledgerGithubToken();
      if (!token) throw new Error('PR_RECOVERY_LOOKUP_FAILED: GitHub credential unavailable');
      const recovered = await recoverCommittedPullRequest({
        repo: ledgerGithubRepo(), branch: job.result.branch ?? '', commitSha,
        read: url => fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) }),
      });
      if (controller.cancelled) throw new Error('PR_RECOVERY_LOOKUP_FAILED: worker lease lost');
      const result = { ...job.result, ...recovered, prMerged: false, prMergeCommitSha: null,
        ciResumeState: { jobId, taskId: job.input.taskId ?? jobId, phase: 'CI_WAIT' as const,
          commitSha, ...recovered, branch: job.result.branch ?? '', mergeTarget: 'main', persistedAt: nowIso() } };
      await updateJob(jobId, { result, lastHeartbeatAt: nowIso() });
      job.result = result;
      prNumber = recovered.prNumber;
    } catch (error) {
      if (!controller.cancelled) {
        const reason = error instanceof Error ? error.message : 'PR_RECOVERY_LOOKUP_FAILED';
        const permanent = /PR_RECOVERY_(IDENTITY_REQUIRED|AMBIGUOUS|INCOMPLETE)/.test(reason);
        await updateJob(jobId, { error: reason, stageDetail: reason,
          ...(permanent ? { status: 'blocked' as const, stage: 'FAILED' as const, finishedAt: nowIso(),
            result: { ...job.result, ok: false, finalStatus: 'BLOCKED' as const, endToEndProductionComplete: false, error: reason } } : {}) });
      }
      return;
    }
  }
  const resumeStartedAt = nowIso();
  const savedCi = job.result.ciResumeState;
  const ciWaitStartedAt = savedCi?.jobId === jobId
    && savedCi.taskId === (job.input.taskId ?? jobId)
    && savedCi.commitSha === commitSha && savedCi.prNumber === prNumber
    && savedCi.branch === job.result.branch && savedCi.phase === 'CI_WAIT'
    ? savedCi.persistedAt : undefined;
  await updateJobStage(jobId, 'COMMITTING', `Worker restart detected — resuming CI wait for PR #${prNumber} (commit ${commitSha.slice(0, 12)}) with the original taskId. No duplicate job created.`);
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    taskId: job.input.taskId ?? job.jobId,
    goal: job.input.goal,
    ownerId: job.ownerId,
    commitSha,
    prNumber,
    prUrl: job.result?.prUrl ?? null,
    branch: job.result?.branch ?? '',
    testsPassed: job.result?.testsPassed === true,
    typecheckPassed: job.result?.typecheckPassed === true,
    filesChanged: job.result?.changedFiles ?? [],
    ciWaitStartedAt,
    isCanceled: () => controller.cancelled || queueStopping,
    beforeMerge: async () => {
      await assertEmergencyStopInactive('senior-worker-resumed-merge');
      if (controller.cancelled) throw new Error('Worker lease lost before resumed merge');
      assertRepairResumeEvidence(jobId, job.input.goal, job.result?.validationEvidence);
      await updateJob(jobId, { lastHeartbeatAt: nowIso() });
    },
    onPhase: (phase, detail) => {
      const { stage, detail: mappedDetail } = autonomousCoderPhaseToStage(phase);
      void updateJobStage(jobId, stage, detail || mappedDetail).catch(error => recordJobInterruption(jobId, controller, 'phase_write_unconfirmed', error));
    },
  });
  if (controller.interrupted || queueStopping) return;
  const result = summarizeAutonomousCoderProof(jobId, proof);
  // CI resume executes no new validation. Retain the same commit's persisted
  // receipts, including the original failing regression, through a restart.
  if (!result.validationEvidence?.length && job.result?.commitSha === commitSha) {
    result.validationEvidence = job.result.validationEvidence ?? [];
    result.testsRun = result.validationEvidence.some(receipt => receipt.kind === 'test' && receipt.phase !== 'regression_baseline');
    result.typecheckRun = result.validationEvidence.some(receipt => receipt.kind === 'typecheck');
  }
  const finalized = finalizeResultWithStateRecord(job, result);
  const status: IVXWorkerJobStatus = finalized.finalStatus === 'COMPLETE'
    ? 'completed'
    : finalized.finalStatus === 'BLOCKED'
      ? 'blocked'
      : 'failed';
  const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
  await updateJob(jobId, {
    status,
    stage: finalStage,
    progressPercent: STAGE_PROGRESS[finalStage],
    stageDetail: status === 'completed'
      ? `Restart resume COMPLETED: PR #${prNumber} merged after CI green (merge commit ${proof.prMergeCommitSha ?? 'none'}). Same jobId resumed — no duplicate job created. Resume started ${resumeStartedAt}.`
      : (finalized.error ?? `Restart resume of PR #${prNumber} did not complete.`),
    finishedAt: nowIso(),
    result: finalized,
    error: finalized.error,
  });
  await appendLedger(finalized);
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    claimedJobIds.delete(jobId); activeJobControllers.delete(jobId);
  }
}

/** Recover a lost commit checkpoint only from full task and job trailers.
 * Existing branches are never reset and validation results are never invented. */
async function recoverStuckCommittingJobs(queue: QueueDoc): Promise<void> {
  const now = Date.now();
  const candidates = queue.jobs.filter(job => job.status === 'committing' && job.stage === 'COMMITTING'
    && !job.result?.commitSha && job.result?.prNumber == null && job.startedAt
    && now - Date.parse(job.startedAt) > COMMITTING_RECOVERY_THRESHOLD_MS
    && (job.leaseExpiresAt == null || Date.parse(job.leaseExpiresAt) <= now)).slice(0, 4);
  if (!candidates.length) return;
  await assertEmergencyStopInactive('senior-worker-commit-checkpoint-recovery');
  const token = ledgerGithubToken();
  const match = (process.env.GITHUB_REPO_URL ?? '').match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!token || !match) return;
  const repo = `${match[1]}/${match[2]}`;
  for (const job of candidates) {
    const taskId = job.input.taskId ?? job.jobId;
    const suffix = autonomousBranchSuffix(taskId);
    // Old branches are read-only candidates. A time window or prefix alone
    // never identifies work; every candidate needs both full commit trailers.
    const branches = [...new Set([job.result?.branch,
      `ivx-autonomous-${suffix}`, `ivx-autonomous-${suffix.slice(0, -48)}`,
      'ivx-autonomous', 'main'].filter((value): value is string => Boolean(value)))];
    const matches = new Map<string, { sha: string; branch: string }>();
    for (const branch of branches) {
      const response = await fetch(`https://api.github.com/repos/${repo}/branches/${encodeURIComponent(branch)}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (response.status === 404) continue;
      if (!response.ok) throw new Error(`COMMIT_RECOVERY_LOOKUP_FAILED: HTTP ${response.status}`);
      const data = await response.json() as { commit?: { sha?: string; commit?: { message?: string } } };
      const sha = data.commit?.sha;
      const lines = (data.commit?.commit?.message ?? '').split(/\r?\n/);
      const trailer = (name: string, expected: string) => {
        const values = lines.filter(line => line.startsWith(`${name}:`));
        return values.length === 1 && values[0] === `${name}: ${expected}`;
      };
      if (!sha || !/^[a-f0-9]{40}$/i.test(sha)
        || !trailer('IVX-Worker-Job', job.jobId) || !trailer('IVX-Task-ID', taskId)
        || (job.input.agentId && !trailer('IVX-Agent-ID', job.input.agentId))) continue;
      matches.set(sha, { sha, branch });
    }
    if (matches.size !== 1) continue;
    const recovered = [...matches.values()][0];
    const reason = 'COMMIT_CHECKPOINT_RECOVERED: original commit retained; PR and validation recovery required.';
    const previous = job.result;
    job.result = {
      jobId: job.jobId, goal: job.input.goal.slice(0, 280), ok: false, finalStatus: 'BLOCKED',
      endToEndProductionComplete: false, changedFiles: [], testsRun: false, testsPassed: false,
      typecheckRun: false, typecheckPassed: false, buildRun: false,
      prNumber: null, prUrl: null, prMerged: false, prMergeCommitSha: null,
      deployId: null, deployStatus: null, deployVerified: false, deployRequested: false,
      liveCommit: null, commitMatch: false, healthOk: false, healthStatus: null, versionEndpoint: null,
      generatedFeatureSlug: null, auditFiles: { json: '', jsonl: '' }, durable: isDurableStoreConfigured(),
      generatedAt: nowIso(), ...previous,
      commitCreated: true, commitSha: recovered.sha,
      commitUrl: `https://github.com/${repo}/commit/${recovered.sha}`, pushed: true, branch: recovered.branch, error: reason,
    };
    // The existing CAS permits expired-lease requeue only with lease identity
    // cleared. A queued commit is excluded from normal code generation.
    job.status = 'queued'; job.stage = 'QUEUED'; job.progressPercent = STAGE_PROGRESS.QUEUED;
    job.finishedAt = null; job.error = reason; job.stageDetail = reason;
    job.leaseWorkerInstanceId = null; job.leaseExpiresAt = null;
    await saveQueue(queue);
    await appendDurableEvent(QUEUE_FILE, { type: 'commit_checkpoint_recovered', jobId: job.jobId,
      taskId, ownerId: job.ownerId, commitSha: recovered.sha, branch: recovered.branch, at: nowIso() });
    return; // Reload a fresh CAS baseline before recovering another job.
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RESILIENCE LAYER 4: recover jobs stuck at VERIFYING whose worker was killed
// by the Render deploy it triggered. The onCommitLanded callback already
// persisted the commit SHA to the job's result before the deploy fired. On the
// next boot (or periodic sweep), this recovery checks whether production is now
// serving that commit and, if so, completes the job with full verified evidence.
// ─────────────────────────────────────────────────────────────────────────────

/** How long a job may sit at VERIFYING before the recovery sweep investigates.
 *  Shorter than STALE_JOB_TIMEOUT_MS so we recover before the stale sweep marks
 *  the job FAILED (which would lose the real commit evidence). */
const VERIFYING_RECOVERY_THRESHOLD_MS = 90 * 1000; // 90s — deploy takes ~2-3 min

/** Query the live production /health endpoint and check if the commit SHA
 *  persisted on the job (via onCommitLanded) is now the live runtime commit. */
async function recoverStuckVerifyingJobs(queue: QueueDoc): Promise<void> {
  const now = Date.now();
  // Recover jobs stuck at VERIFYING/COMMITTING (worker killed by its own deploy)
  // AND FAILED jobs that have a real commitSha but commitMatch=false (the
  // verifyLiveCommitMatch poll ran too quickly before the Render deploy completed).
  const stuckJobs = queue.jobs.filter((j) =>
    j.result?.commitSha &&
    (j.leaseExpiresAt == null || Date.parse(j.leaseExpiresAt) <= now) &&
    // An unmerged code-change job belongs to PR/CI recovery. A later live SHA
    // cannot replace its missing PR identity or required-check evidence.
    !(j.status === 'committing' && j.result?.prMerged !== true) &&
    j.startedAt &&
    now - new Date(j.startedAt).getTime() > VERIFYING_RECOVERY_THRESHOLD_MS &&
    (
      // Stuck at VERIFYING/COMMITTING (worker process killed by deploy restart)
      ((j.status === 'verifying' || j.status === 'committing') &&
       (j.stage === 'VERIFYING' || j.stage === 'COMMITTING'))
      ||
      // FAILED with real commit but commitMatch=false (verify polled too fast)
      (j.status === 'failed' && j.result?.commitMatch === false)
    ));
  if (stuckJobs.length === 0) return;

  // Fetch the live production /health commit once.
  const baseUrl = (process.env.PRODUCTION_BASE_URL
    ?? process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL
    ?? process.env.EXPO_PUBLIC_IVX_API_BASE_URL
    ?? process.env.EXPO_PUBLIC_API_BASE_URL
    ?? 'https://api.ivxholding.com').replace(/\/+$/, '');
  let liveCommit: string | null = null;
  let liveHealthOk = false;
  let liveHttpStatus: number | null = null;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(10_000) });
    liveHttpStatus = res.status;
    liveHealthOk = res.ok;
    if (res.ok) {
      const data = await res.json().catch(() => ({})) as { commit?: string };
      liveCommit = typeof data.commit === 'string' ? data.commit : null;
    }
  } catch {
    return; // network error → skip this sweep cycle
  }
  if (!liveCommit) return;

  let recovered = false;
  for (const job of stuckJobs) {
    const expectedSha = job.result!.commitSha!;
    // An ancestor is not exact deployment evidence for this checkpoint.
    if (liveCommit !== expectedSha) continue;

    // A deploy-mode task requires the atomic evidence captured by the active
    // worker: real Render ID + live status + /health + /version + SHA parity.
    // A restart cannot recreate that chain from a later health check, so fail closed.
    if (job.input.executionMode === 'deploy' || job.input.approveGitDeploy) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.progressPercent = STAGE_PROGRESS['FAILED'];
      job.stageDetail = 'Deployment task interrupted before its complete Render, /health, and /version evidence chain was persisted.';
      job.finishedAt = nowIso();
      job.error = 'Deployment task failed: incomplete production certification evidence after restart.';
      job.result = { ...job.result!, ok: false, endToEndProductionComplete: false, deployVerified: false, finalStatus: 'FAILED', error: job.error };
      recovered = true;
      continue;
    }
    // A non-deploy job may be recovered from a commit/health match.
    if (!job.result!.deployId || job.result!.deployStatus !== 'live'
      || !job.result!.healthResponse?.ok || job.result!.healthResponse.commitSha !== expectedSha
      || !job.result!.versionResponse?.ok || job.result!.versionResponse.commitSha !== expectedSha) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.progressPercent = STAGE_PROGRESS['FAILED'];
      job.stageDetail = 'Production commit appeared live, but its saved Render, health and version evidence is incomplete.';
      job.finishedAt = nowIso();
      job.error = 'Deployment task failed: complete saved production verification evidence is required.';
      job.result = { ...job.result!, ok: false, endToEndProductionComplete: false, deployVerified: false, finalStatus: 'FAILED', error: job.error };
      recovered = true;
      continue;
    }
    const result: IVXWorkerJobResult = {
      ...(job.result!),
      deployId: job.result!.deployId,
      deployStatus: job.result!.deployStatus,
      deployVerified: true,
      deployRequested: job.input.approveGitDeploy,
      liveCommit,
      commitMatch: true,
      healthOk: liveHealthOk,
      healthStatus: liveHttpStatus,
      endToEndProductionComplete: true,
      ok: true,
      finalStatus: 'COMPLETE',
      error: null,
      generatedAt: nowIso(),
    };
    const finalized = finalizeResultWithStateRecord(job, result);
    const completed = finalized.finalStatus === 'COMPLETE';
    job.status = completed ? 'completed' : finalized.finalStatus === 'BLOCKED' ? 'blocked' : 'failed';
    job.stage = completed ? 'COMPLETED' : 'FAILED';
    job.progressPercent = STAGE_PROGRESS[job.stage];
    job.stageDetail = completed
      ? `Recovered from VERIFYING crash with saved deployment evidence for ${expectedSha}.`
      : finalized.error ?? 'Recovered verification did not pass the terminal evidence gate.';
    job.finishedAt = nowIso();
    job.error = finalized.error;
    job.result = finalized;
    recovered = true;
    console.log('[IVX-SeniorDevWorker] VERIFYING recovery: result reconciled', {
      jobId: job.jobId,
      commitSha: expectedSha,
      liveCommit,
      finalStatus: finalized.finalStatus,
    });
    appendDurableEvent(QUEUE_FILE, {
      type: 'job_recovered',
      jobId: job.jobId,
      commitSha: expectedSha,
      reason: 'verifying_crash_recovery',
      liveCommit,
    }).catch(() => {});
    // Persist the recovered result to the durable ledger.
    try {
      await appendLedger(finalized);
    } catch {
      // Ledger write failure is non-fatal — the job result is still on the queue.
    }
  }

  if (recovered) {
    await saveQueue(queue);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-OWNER SINGLE-FLIGHT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the active (in-progress) job for a given owner. Returns null if no active
 * job exists. Local queues expire stale jobs here; shared queues are read-only.
 */
export async function getActiveJobForOwner(ownerId: string): Promise<IVXWorkerJob | null> {
  if (!ownerId) return null;
  if (sharedSeniorQueueEnabled()) {
    if (!isDurableStoreConfigured()) throw new Error('Shared queue storage unavailable');
    return readSharedSeniorActiveOwnerJob<IVXWorkerJob>(QUEUE_FILE, ownerId);
  }
  // Shared queue reads must not run maintenance against another process's
  // lease. The dedicated worker sweeps/reclaims expired jobs independently.
  // Retain an existing job's identity while it waits for that recovery.
  if (!sharedSeniorQueueEnabled()) await expireStaleJobs();
  const queue = await loadWorkQueue();
  // Find the most recent active job for this owner.
  for (let i = queue.jobs.length - 1; i >= 0; i -= 1) {
    const job = queue.jobs[i];
    if (job.ownerId === ownerId && ACTIVE_STATUSES.has(job.status)) {
      return job;
    }
  }
  return null;
}

/**
 * Result of an enqueue-or-attach operation. When `attached` is true, the job
 * already existed and the request was NOT discarded — the caller gets the
 * active job's ID. When `attached` is false, a new job was created.
 */
export type EnqueueOrAttachResult = {
  job: IVXWorkerJob;
  attached: boolean;
  /** The active job that was already running, if attached. */
  activeJobId: string | null;
};

/**
 * Submit an owner-approved development task to the worker queue with per-owner
 * single-flight enforcement. If an active job already exists for the same
 * owner, the request ATTACHES to that job (returns its jobId) instead of
 * creating a duplicate or returning HTTP 409.
 *
 * The user's request is NEVER discarded:
 *   - If no active job exists → a new job is created and queued.
 *   - If an active job exists for the same owner → the request attaches to it.
 *   - Shared jobs retain their identity while workers recover expired leases.
 *
 * Owner approval MUST already be verified by the caller (API boundary).
 */
export async function enqueueOrAttachSeniorDeveloperJob(input: IVXWorkerJobInput): Promise<EnqueueOrAttachResult> {
  const goal = input.goal.trim();
  if (!goal) throw new Error('A senior developer goal is required to enqueue a job.');
  if (!input.ownerApproved) throw new Error('Cannot enqueue a senior developer job without verified owner approval.');

  // FINAL MANDATE Phase 1: owner emergency stop halts all agent work at the enqueue boundary.
  const emergencyStop = await checkEmergencyStop();
  if (emergencyStop.source === 'unavailable') throw new Error('EMERGENCY_STOP_UNAVAILABLE: job enqueue refused until owner control is readable.');
  if (emergencyStop.active) {
    throw new Error(
      `EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${emergencyStop.reason ?? 'no reason recorded'}); job enqueue refused.`,
    );
  }

  const ownerId = input.ownerId ?? 'default';

  // Check for an existing active job; shared-queue maintenance belongs to workers.
  const activeJob = await getActiveJobForOwner(ownerId);
  if (activeJob && (input.taskId && activeJob.input.taskId
    ? input.taskId === activeJob.input.taskId
    : isSameTaskScope(goal, activeJob.input.goal))) {
    // ATTACH (same task scope only): the new command is a retry/follow-up of
    // the running job. Reuse it so duplicate work is not enqueued.
    // A scheduler retry carrying the exact same taskId is an idempotent read,
    // not a new lifecycle event. Persisting job_attached for every poll/retry
    // created an unbounded event loop without representing new work.
    const exactTaskRetry = Boolean(
      input.taskId
      && activeJob.input.taskId
      && input.taskId === activeJob.input.taskId,
    );
    if (!exactTaskRetry) {
      appendDurableEvent(QUEUE_FILE, { type: 'job_attached', jobId: activeJob.jobId, ownerId, reason: 'same_task_scope' }).catch(() => {});
    }
    return { job: activeJob, attached: true, activeJobId: activeJob.jobId };
  }
  // DIFFERENT task scope: fall through and enqueue a separate job so the
  // command is never lost and never mis-attributed to the active job's
  // evidence. The queue serializes per-owner work safely.

  // Phase 12: compute idempotency key and check for a prior completed job with
  // the same key + identical evidence fingerprint. A duplicate redeploy (same
  // commit + deploy + files + status) is NOT a new completed development task.
  const idempotencyKey = computeIdempotencyKey({
    ownerId,
    goal,
    taskId: input.taskId,
    approvalPhrase: input.gitDeployConfirmationText ?? input.patchConfirmationText ?? null,
    executionMode: input.executionMode ?? null,
  });
  const normalizedGoal = normalizeGoalForRetry(goal);
  const queue = await loadQueue();

  // An owner may have several queued scopes. Its newest job is not necessarily
  // this retry's job; inspect the whole durable queue before attempting insert.
  const matchingActive = [...queue.jobs].reverse().find((candidate) => (
    candidate.ownerId === ownerId && candidate.idempotencyKey === idempotencyKey
    && ACTIVE_STATUSES.has(candidate.status)
  ));
  if (matchingActive) {
    return { job: matchingActive, attached: true, activeJobId: matchingActive.jobId };
  }

  // Exact campaign retries remain idempotent after the prior job has already
  // completed. The queue retains the full 112-agent campaign, so taskId is the
  // strongest correlation key and avoids manufacturing a second execution.
  const completedExactTask = input.taskId
    ? [...queue.jobs].reverse().find((job) => (
      job.ownerId === ownerId
      && job.input.taskId === input.taskId
      && job.status === 'completed'
    ))
    : null;
  if (completedExactTask) {
    return { job: completedExactTask, attached: true, activeJobId: completedExactTask.jobId };
  }

  const ledger = await loadLedger();
  const priorWithSameGoal = ledger.entries.find((e) => normalizeGoalForRetry(e.goal) === normalizedGoal && e.finalStatus === 'COMPLETE');
  if (priorWithSameGoal) {
    const priorFingerprint = fingerprintEvidence({
      commitSha: priorWithSameGoal.commitSha,
      deployId: priorWithSameGoal.deployId,
      filesChanged: priorWithSameGoal.changedFiles,
      finalStatus: priorWithSameGoal.finalStatus,
    });
    const newFingerprint = fingerprintEvidence({
      commitSha: null,
      deployId: null,
      filesChanged: [],
      finalStatus: 'COMPLETE',
    });
    const dedup = checkDuplicateEvidence(newFingerprint, [{ jobId: priorWithSameGoal.jobId, fingerprint: priorFingerprint }]);
    if (dedup.isDuplicate) {
      // Duplicate evidence — attach to the prior result when it is still in
      // the bounded queue. The old implementation logged a rejection and then
      // fell through to enqueue anyway, producing both events on every cycle.
      const priorJob = [...queue.jobs].reverse().find((job) => (
        job.jobId === dedup.priorJobId && job.status === 'completed'
      ));
      if (priorJob) {
        return { job: priorJob, attached: true, activeJobId: priorJob.jobId };
      }
    }
  }

  // No active job — create a new one.
  const job: IVXWorkerJob = {
    jobId: `ivx-worker-${randomUUID()}`,
    status: 'queued',
    stage: 'QUEUED',
    progressPercent: 0,
    stageDetail: 'Job queued and waiting for worker.',
    input: { ...input, goal },
    ownerId,
    createdAt: nowIso(),
    startedAt: null,
    lastHeartbeatAt: null,
    finishedAt: null,
    cancelledAt: null,
    attempts: 0,
    result: null,
    error: null,
    idempotencyKey,
  };

  queue.jobs.push(job);
  try {
    await saveQueue(queue);
  } catch (error) {
    if (!sharedSeniorQueueEnabled()) throw error;
    // Another replica can insert after our read, or a committed insert can lose
    // its acknowledgement. Reconcile by identity once, without replaying the
    // mutation or weakening PostgreSQL's uniqueness/lease checks.
    let persisted: QueueDoc;
    try { persisted = await loadQueue(); } catch { throw error; }
    const accepted = [...persisted.jobs].reverse().find((candidate) => (
      candidate.ownerId === ownerId && candidate.idempotencyKey === idempotencyKey
      && (ACTIVE_STATUSES.has(candidate.status) || candidate.status === 'completed')
    ));
    if (!accepted) throw error;
    return { job: accepted, attached: true, activeJobId: accepted.jobId };
  }
  appendDurableEvent(QUEUE_FILE, { type: 'job_enqueued', jobId: job.jobId, goal: goal.slice(0, 200), ownerId }).catch(() => {});

  // Kick the worker without blocking the caller.
  if (shouldExecuteWorkerQueueInThisProcess()) void drainSeniorDeveloperQueue();
  return { job, attached: false, activeJobId: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// CANCEL / RESUME
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancel a job. If the job is currently running, signals the controller to
 * stop. Marks the job as cancelled in the queue.
 */
export async function cancelSeniorDeveloperJob(jobId: string): Promise<IVXWorkerJob | null> {
  const queue = await loadQueue();
  const idx = queue.jobs.findIndex((j) => j.jobId === jobId);
  if (idx < 0) return null;
  const job = queue.jobs[idx];

  // Signal the running controller to stop (if one exists).
  const controller = activeJobControllers.get(jobId);
  if (controller) {
    controller.cancelled = true;
  }

  const cancelledAt = nowIso();
  await updateJob(jobId, { status: 'cancelled', stage: 'FAILED',
    stageDetail: 'Job cancelled by owner.', error: 'Job cancelled by owner.',
    cancelledAt, finishedAt: cancelledAt });
  appendDurableEvent(QUEUE_FILE, { type: 'job_cancelled', jobId, ownerId: job.ownerId,
    reason: 'owner_requested', cancelledAt }).catch(() => {});
  return getSeniorDeveloperJob(jobId);
}

/**
 * Resume a queued or blocked job. If the job is already running, returns it
 * as-is (attach behavior). If the job is cancelled or completed, returns null.
 */
export async function resumeSeniorDeveloperJob(jobId: string): Promise<IVXWorkerJob | null> {
  const queue = await loadQueue();
  const idx = queue.jobs.findIndex((j) => j.jobId === jobId);
  if (idx < 0) return null;
  const job = queue.jobs[idx];

  // Can only resume queued or blocked jobs.
  if (job.status !== 'queued' && job.status !== 'blocked') {
    return job; // Return as-is for running jobs (attach behavior).
  }

  // Reset to queued so the drain loop picks it up.
  job.status = 'queued';
  job.stage = 'QUEUED';
  job.progressPercent = 0;
  job.stageDetail = 'Job resumed by owner.';
  job.error = null;
  queue.jobs[idx] = job;
  await saveQueue(queue);
  appendDurableEvent(QUEUE_FILE, { type: 'job_resumed', jobId }).catch(() => {});

  // Kick the worker.
  if (shouldExecuteWorkerQueueInThisProcess()) void drainSeniorDeveloperQueue();
  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE READS
// ─────────────────────────────────────────────────────────────────────────────

/** Read one job by id (newest queue state). */
export async function getSeniorDeveloperJob(jobId: string): Promise<IVXWorkerJob | null> {
  const queue = await loadQueueForJob(jobId);
  const found = queue.jobs.find((j) => j.jobId === jobId) ?? null;
  if (found) return found;
  if (sharedSeniorQueueEnabled()) return null; // A process mirror cannot certify a missing durable job.
  // LOST-UPDATE GUARD (2026-08-28): concurrent load-modify-save cycles can
  // persist a stale durable queue copy that misses a job enqueued moments
  // earlier. The in-process mirror is authoritative for such races — never
  // report a live job as missing (the campaign dispatcher treats a null get()
  // as a hard failure and would fail honest agents with
  // "Worker job ... no longer found in the queue").
  return memoryQueue?.jobs.find((j) => j.jobId === jobId) ?? null;
}

/** List recent jobs (newest first). */
export async function listSeniorDeveloperJobs(limit: number = 25): Promise<IVXWorkerJob[]> {
  const queue = await loadQueue();
  const capped = Math.max(1, Math.min(MAX_QUEUE_RETAINED, Math.floor(limit)));
  return [...queue.jobs].reverse().slice(0, capped);
}

/** Read the durable proof ledger (newest first). */
export async function listSeniorDeveloperProofLedger(limit: number = 25): Promise<IVXWorkerJobResult[]> {
  const ledger = await loadLedger();
  const capped = Math.max(1, Math.min(MAX_LEDGER_RETAINED, Math.floor(limit)));
  return ledger.entries.slice(0, capped);
}

/** Compact last-proof summary read directly from the durable worker ledger. */
export type IVXWorkerLastProof = {
  lastJobId: string | null;
  lastCommitHash: string | null;
  lastDeployId: string | null;
  lastHealthStatus: number | null;
  lastVersionMatch: boolean;
  completedAt: string | null;
};

/**
 * Read the most recent proof entry directly from the worker ledger and project
 * it to the compact owner-facing shape. Returns nulls when the ledger is empty.
 */
export async function getSeniorDeveloperLastProof(): Promise<IVXWorkerLastProof> {
  const ledger = await loadLedger();
  const latest = ledger.entries[0] ?? null;
  if (!latest) {
    return {
      lastJobId: null,
      lastCommitHash: null,
      lastDeployId: null,
      lastHealthStatus: null,
      lastVersionMatch: false,
      completedAt: null,
    };
  }
  return {
    lastJobId: latest.jobId,
    lastCommitHash: latest.commitSha,
    lastDeployId: latest.deployId,
    lastHealthStatus: latest.healthStatus,
    lastVersionMatch: latest.commitMatch,
    completedAt: latest.generatedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE PROCESSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializes all load-modify-save cycles on the queue document. Without this,
 * the fire-and-forget phase updates (void updateJobStage(...)) race the final
 * awaited updateJob(...) and the LAST writer wins — the phase update's save
 * landed after the final write and clobbered result/finishedAt/error, so every
 * job (completed or failed) lost its final evidence. All updateJob writes now
 * run through this chain so no write is lost.
 */
let queueWriteChain: Promise<unknown> = Promise.resolve();
function withQueueWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = queueWriteChain.then(fn, fn);
  queueWriteChain = run.catch(() => undefined);
  return run;
}

async function updateJob(jobId: string, patch: Partial<IVXWorkerJob>, onlyIfActive = false, requireActive = false): Promise<void> {
  await withQueueWrite(async () => {
    const queue = await loadQueueForJob(jobId);
    const idx = queue.jobs.findIndex((j) => j.jobId === jobId);
    if (idx < 0) { if (requireActive) throw new Error('WORKER_AUTHORITY_UNCONFIRMED: job missing'); return; }
    const existing = queue.jobs[idx];
    // A late phase notification must check the state inside the serialized write.
    // Checking before entering this queue can resurrect a finished job.
    if (onlyIfActive && !ACTIVE_STATUSES.has(existing.status)) {
      if (requireActive) throw new Error('WORKER_AUTHORITY_UNCONFIRMED: job is not active');
      return;
    }
    const isActive = ACTIVE_STATUSES.has(patch.status ?? existing.status);
    queue.jobs[idx] = {
      ...existing,
      ...patch,
      // Every active write is evidence that the worker is alive. Terminal jobs
      // retain their final heartbeat as the last observed execution signal.
      lastHeartbeatAt: patch.lastHeartbeatAt ?? (isActive ? nowIso() : existing.lastHeartbeatAt),
    };
    const next = queue.jobs[idx];
    if (next.result && isActive && next.result.finalStatus === 'COMPLETE') {
      // A commit/PR receipt is recoverable work, not a completed repair. Keep
      // its identity and validation receipts while CI or deployment is pending.
      next.result = { ...next.result, ok: false, finalStatus: 'IN_PROGRESS' };
    } else if (next.result && next.status === 'cancelled') {
      next.result = { ...next.result, ok: false, finalStatus: 'FAILED',
        error: next.error ?? 'Job cancelled by owner.' };
    }
    await saveQueue(queue);
  });
  // Concurrent-drain claim release: once a job reaches a terminal status its
  // in-process claim is no longer needed, so a future retry may claim it again.
  if (patch.status && !ACTIVE_STATUSES.has(patch.status) && patch.status !== 'queued') {
    claimedJobIds.delete(jobId);
  }
}

/**
 * Phase 1 + 11: populate the structured execution record from the worker result,
 * map the worker stage to the canonical 17-state machine value, and enforce the
 * terminal transition via assertCanTransition(). If the terminal transition is
 * illegal (e.g. dev task VERIFIED with empty diff and no external cause), the
 * task is forced to its honest terminal state (BLOCKED/FAILED/NO_CHANGE_REQUIRED)
 * and the reason is recorded on the result so the narrative engine reports the
 * honest verdict.
 *
 * This is the SINGLE place where the state machine is enforced on the worker
 * execution path. Every execution branch (read-only / factory / autonomous /
 * developer_executor) funnels through this before appendLedger.
 */
export function finalizeResultWithStateRecord(
  job: IVXWorkerJob,
  result: IVXWorkerJobResult,
): IVXWorkerJobResult {
  const taskType = result.taskType ?? classifyTaskType(result.goal);
  const taskState = stageToTaskState(job.stage);

  // Build the 22-field execution record from the result.
  const record = createExecutionRecord({
    task_id: job.jobId,
    task_type: taskType,
    user_request: job.input.goal.slice(0, 1000),
    acceptance_criteria: [],
  });
  const enriched: IVXExecutionRecord = {
    ...record,
    status: taskState,
    root_cause: result.error ? result.error.slice(0, 500) : null,
    files_inspected: result.filesInspected?.slice(0, 50) ?? [],
    commands: (result.validationEvidence ?? []).map(cmd => ({
      command: cmd.command,
      exit_code: cmd.exitCode,
      output_summary: `${cmd.ok ? 'PASS' : 'FAIL'}; phase=${cmd.phase ?? 'validation'}; duration_ms=${cmd.durationMs}; stdout_sha256=${cmd.stdoutHash}; stderr_sha256=${cmd.stderrHash}`,
    })),
    tests: (result.validationEvidence ?? []).filter(cmd => cmd.kind === 'test').map(cmd => ({
      name: `${cmd.phase ? `[${cmd.phase}] ` : ''}${cmd.command}`,
      command: cmd.command,
      passed: cmd.ok,
      duration_ms: cmd.durationMs,
    })),
    started_at: Number.isFinite(Date.parse(job.startedAt ?? job.createdAt))
      ? Date.parse(job.startedAt ?? job.createdAt) : record.started_at,
    files_changed: result.changedFiles.slice(0, 50),
    commit_sha: result.commitSha,
    deployment_id: result.deployId,
    production_checks: result.healthOk
      ? [{
          check: 'production /health',
          result: result.healthStatus === null ? 'healthy' : `healthy (HTTP ${result.healthStatus})`,
          timestamp: Date.parse(result.generatedAt),
        }]
      : [],
    evidence: [
      ...(result.commitSha ? [{
        kind: 'commit' as const,
        label: 'GitHub commit',
        value: result.commitSha,
        timestamp: result.generatedAt,
        verified: Boolean(result.commitSha),
      }] : []),
      ...(result.deployId ? [{
        kind: 'deploy' as const,
        label: 'Render deploy',
        value: result.deployId,
        timestamp: result.generatedAt,
        verified: Boolean(result.deployId),
      }] : []),
      ...(result.healthOk ? [{
        kind: 'health' as const,
        label: 'Production health',
        value: 'healthy',
        timestamp: result.generatedAt,
        verified: true,
      }] : []),
    ],
    remaining_work: result.error ? [result.error.slice(0, 300)] : [],
    completed_at: Date.parse(result.generatedAt),
    verified_at: result.finalStatus === 'COMPLETE' && result.endToEndProductionComplete ? Date.parse(result.generatedAt) : null,
  };

  // Enforce the terminal transition via the state machine.
  // DEFECT FIX (cert-3C): the worker records only coarse stages on job.stage, so stageToTaskState()
  // may return RECEIVED even when the execution loop actually walked the full senior-developer
  // sequence (inspect -> patch -> test -> commit -> deploy -> verify). Applying the structural
  // legality check from RECEIVED rejects legitimate COMPLETE -> VERIFIED transitions with
  // "Illegal transition: RECEIVED -> VERIFIED". Fix: when the result reports finalStatus COMPLETE,
  // we treat the `from` state as PRODUCTION_VERIFYING (the final pre-terminal step of the loop) —
  // the completion RULES below (filesChangedCount / testsRun / testsPassed / deployId /
  // productionHealthOk / featureVerificationOk) are what actually decide whether VERIFIED is
  // honestly earned. For non-COMPLETE terminal targets (BLOCKED/FAILED/NO_CHANGE_REQUIRED) we
  // keep the honest `from` (any state may transition to a failure terminal).
  const isDevelopmentTask = taskType === 'CODE_FIX' || taskType === 'FEATURE' || taskType === 'UI_FIX';
  // Owner mandate 2026-07-21: COMPLETED is the honest success terminal for
  // commit-only CODE_CHANGE / QA_ONLY / READ_ONLY / FACTORY tasks. VERIFIED
  // remains the success terminal only when deploy was requested AND succeeded.
  const deployRequested = Boolean(result.deployRequested);
  const fullDeployVerified = deployRequested && result.endToEndProductionComplete;
  const terminalTarget: IVXTaskState = result.finalStatus === 'COMPLETE'
    ? (fullDeployVerified ? 'VERIFIED' : 'COMPLETED')
    : result.finalStatus === 'BLOCKED'
      ? 'BLOCKED'
      : result.finalStatus === 'FAILED'
        ? 'FAILED'
        : 'NO_CHANGE_REQUIRED';

  // Honest `from` for the transition guard:
  //   - COMPLETE + deployVerified -> PRODUCTION_VERIFYING (final pre-VERIFIED step).
  //   - COMPLETE + commit-only    -> READY_TO_DEPLOY (commit done, deploy skipped).
  //   - COMPLETE + read_only/qa_only -> ANALYZING / QA_IN_PROGRESS (no commit).
  //   - Otherwise -> the last recorded taskState (failure terminals are reachable from any state).
  const guardFrom: IVXTaskState = result.finalStatus === 'COMPLETE'
    ? (fullDeployVerified ? 'PRODUCTION_VERIFYING'
       : isDevelopmentTask ? 'READY_TO_DEPLOY'
       : taskType === 'QA_ONLY' ? 'QA_IN_PROGRESS'
       : 'ANALYZING')
    : taskState;

  // Map IVXTaskType -> IVXGuardTaskType for the guard (kept narrow on purpose).
  const guardTaskType = (taskType === 'CODE_FIX' ? 'CODE_FIX'
    : taskType === 'FEATURE' ? 'FEATURE'
    : taskType === 'UI_FIX' ? 'UI_FIX'
    : taskType === 'INVESTIGATION' ? 'INVESTIGATION'
    : taskType === 'QA_ONLY' ? 'QA_ONLY'
    : taskType === 'DEPLOYMENT' ? 'DEPLOY_ONLY'
    : 'FACTORY') as import('./ivx-task-state-machine').IVXGuardTaskType;

  const guard = assertCanTransition({
    from: guardFrom,
    to: terminalTarget,
    isDevelopmentTask,
    filesChangedCount: result.changedFiles.length,
    testsRun: result.testsRun,
    testsPassed: result.testsPassed,
    deployId: result.deployId,
    productionHealthOk: result.healthOk,
    featureVerificationOk: result.endToEndProductionComplete ? true : (taskType === 'INVESTIGATION' || taskType === 'QA_ONLY' ? null : false),
    externalCauseProven: false,
    deployRequested,
    typecheckPassed: result.typecheckPassed,
    commitVerified: Boolean(result.commitSha),
    taskType: guardTaskType,
    // Owner mandate 2026-08-23 (false-completion closeout): PR + CI gates.
    prCreated: result.prMerged === true || result.prNumber != null,
    prNumber: result.prNumber,
    requiredChecksGreen: result.ciChecksGreen ?? undefined,
    prMerged: result.prMerged === true,
    mergeSha: result.prMergeCommitSha,
    deployApproved: deployRequested ? result.deployApproved === true : undefined,
    productionShaMatches: deployRequested ? (result.commitMatch || null) : undefined,
  });

  let finalTaskState: IVXTaskState = terminalTarget;
  let honestError = result.error;
  if (!guard.ok && (terminalTarget === 'VERIFIED' || terminalTarget === 'COMPLETED')) {
    // The state machine refused the success terminal. Downgrade ONLY when the
    // refused reason is a REQUESTED-but-failed gate. If the reason is a
    // non-requested stage (deploy / feature verification when !deployRequested),
    // do NOT downgrade — that is the exact defect the owner mandated fixed.
    const reasonsText = guard.reasons.join('; ');
    const isNonRequestedStage = !deployRequested && /deploy|production|feature verification|VERIFIED/i.test(reasonsText);
    if (isNonRequestedStage) {
      // Keep COMPLETED. The guard was too strict for commit-only scope.
      finalTaskState = 'COMPLETED';
      // Do not surface the refused reason as an error — it is expected.
      result.finalStatus = 'COMPLETE';
      result.ok = true;
      result.endToEndProductionComplete = false; // deploy was not requested
    } else {
      // Owner mandate 2026-08-23: map each refused reason category to its
      // honest terminal (NOT_COMPLETED / BLOCKED / FAILED) — never COMPLETED.
      finalTaskState = terminalStateForRefusedCompletion(guard.reasons);
      honestError = `State machine refused ${terminalTarget}: ${reasonsText}. Downgraded to ${finalTaskState}.`;
      result.finalStatus = finalTaskState === 'NOT_COMPLETED' || finalTaskState === 'BLOCKED' ? 'BLOCKED' : finalTaskState === 'FAILED' ? 'FAILED' : 'LOCAL_ONLY';
      result.endToEndProductionComplete = false;
      result.ok = false;
    }
  }

  const completedRecord = completeExecutionRecord(enriched, finalTaskState, finalTaskState === 'VERIFIED');
  const validation = validateExecutionRecord(completedRecord);
  if (!validation.ok) {
    appendDurableEvent(LEDGER_FILE, {
      type: 'execution_record_validation_failed',
      jobId: job.jobId,
      missingFields: validation.missingFields,
      inconsistencies: validation.inconsistencies,
    }).catch(() => {});
  }

  result.executionRecord = completedRecord;
  result.taskState = finalTaskState;
  if (honestError && !result.error) {
    result.error = honestError;
  }
  return result;
}

/**
 * Update a job's execution stage and progress in real time. Called by the
 * worker as the runtime progresses through phases.
 */
async function updateJobStage(jobId: string, stage: IVXWorkerJobStage, detail: string): Promise<void> {
  // Terminal notifications arrive before the executor returns its complete
  // proof. Only the awaited final write may release the lease and close work.
  if (stage === 'COMPLETED' || stage === 'FAILED') {
    await updateJob(jobId, { stageDetail: detail }, true);
    return;
  }
  const statusMap: Record<IVXWorkerJobStage, IVXWorkerJobStatus> = {
    QUEUED: 'queued',
    RUNNING: 'running',
    PATCHING: 'patching',
    TESTING: 'testing',
    COMMITTING: 'committing',
    DEPLOYING: 'deploying',
    VERIFYING: 'verifying',
    COMPLETED: 'completed',
    FAILED: 'failed',
  };
  await updateJob(jobId, {
    stage,
    status: statusMap[stage],
    progressPercent: STAGE_PROGRESS[stage],
    stageDetail: detail,
  }, true);
}

/** Map a senior-developer runtime phase to a worker job stage. */
/** Map an autonomous-coder runtime phase to a worker job stage. */
function autonomousCoderPhaseToStage(phase: IVXAutonomousCoderPhase): { stage: IVXWorkerJobStage; detail: string } {
  switch (phase) {
    case 'queued':
      return { stage: 'QUEUED', detail: 'Autonomous coder job queued.' };
    case 'inspecting':
      return { stage: 'RUNNING', detail: 'Inspecting repository files.' };
    case 'planning':
      return { stage: 'RUNNING', detail: 'Generating technical plan + patch via IVX LLM.' };
    case 'patching':
      return { stage: 'PATCHING', detail: 'Applying LLM-generated patch.' };
    case 'testing':
      return { stage: 'TESTING', detail: 'Running targeted tests + typecheck.' };
    case 'analyzing':
      return { stage: 'TESTING', detail: 'Analyzing test failures.' };
    case 'revising':
      return { stage: 'PATCHING', detail: 'Revising patch after failure.' };
    case 'verifying':
      return { stage: 'VERIFYING', detail: 'Tests + typecheck passed; verifying.' };
    case 'committing':
      return { stage: 'COMMITTING', detail: 'Committing via GitHub Git Data API.' };
    case 'awaiting_owner_approval':
      return { stage: 'COMMITTING', detail: 'Awaiting owner approval for deploy.' };
    case 'deploying':
      return { stage: 'DEPLOYING', detail: 'Deploying to Render (owner-approved).' };
    case 'production_verifying':
      return { stage: 'VERIFYING', detail: 'Verifying production health.' };
    case 'completed':
      return { stage: 'COMPLETED', detail: 'Autonomous coder job completed.' };
    case 'blocked':
      return { stage: 'FAILED', detail: 'Autonomous coder blocked.' };
    case 'failed':
      return { stage: 'FAILED', detail: 'Autonomous coder failed.' };
    default:
      return { stage: 'RUNNING', detail: `Phase: ${phase}` };
  }
}

function phaseToStage(phase: string): { stage: IVXWorkerJobStage; detail: string } {
  switch (phase) {
    case 'queued':
      return { stage: 'QUEUED', detail: 'Task queued.' };
    case 'repo_brain_indexed':
    case 'repo_indexed':
      return { stage: 'RUNNING', detail: 'Repo brain indexed source tree.' };
    case 'plan_created':
      return { stage: 'RUNNING', detail: 'Execution plan created.' };
    case 'diff_proposed':
      return { stage: 'PATCHING', detail: 'Safe code diff prepared.' };
    case 'patch_approval_checked':
      return { stage: 'PATCHING', detail: 'Patch approval gate checked.' };
    case 'patch_applied':
      return { stage: 'PATCHING', detail: 'Code patch applied.' };
    case 'files_inspected':
      return { stage: 'RUNNING', detail: 'Read-only inspection: files inspected.' };
    case 'commands_run':
      return { stage: 'TESTING', detail: 'Read-only commands executed.' };
    case 'root_cause_identified':
      return { stage: 'VERIFYING', detail: 'Root cause identified.' };
    case 'validation_started':
      return { stage: 'TESTING', detail: 'Validation runner started.' };
    case 'validation_completed':
      return { stage: 'TESTING', detail: 'Validation runner completed.' };
    case 'git_deploy_operator_checked':
      return { stage: 'COMMITTING', detail: 'Git/deploy operator gate checked.' };
    case 'production_verified':
      return { stage: 'VERIFYING', detail: 'Production health verification attempted.' };
    case 'audit_saved':
      return { stage: 'VERIFYING', detail: 'Audit files saved.' };
    case 'completed':
      return { stage: 'COMPLETED', detail: 'Senior developer task completed.' };
    case 'blocked':
      return { stage: 'FAILED', detail: 'Task blocked before completion.' };
    case 'failed':
      return { stage: 'FAILED', detail: 'Task failed.' };
    default:
      return { stage: 'RUNNING', detail: `Phase: ${phase}` };
  }
}

/**
 * Run ONE queued job to completion through the real execution pipeline. Exposed
 * for explicit triggering and deterministic testing. Returns the result, or
 * null when there is no queued job.
 */
const admitSeniorJob = createSeniorJobAdmission<IVXWorkerJob>({
  read: loadWorkQueue, claimed: claimedJobIds, active: ACTIVE_STATUSES,
  staleAfterMs: STALE_JOB_TIMEOUT_MS, stopped: () => queueStopping,
  availableSlots: () => getWorkerMaxConcurrency() - new Set([...claimedJobIds, ...activeCiResumeJobIds]).size,
  claim: job => sharedSeniorQueueEnabled() ? claimSharedSeniorJob<IVXWorkerJob>(job.jobId) : Promise.resolve(job),
});

export async function processNextSeniorDeveloperJob(): Promise<IVXWorkerJobResult | null> {
  const job = await admitSeniorJob();
  if (!job) return null;

  const controller: { cancelled: boolean; interrupted?: boolean } = { cancelled: queueStopping, interrupted: queueStopping };
  let leaseHeartbeat: ReturnType<typeof setInterval> | null = null;
  activeJobControllers.set(job.jobId, Object.assign(controller, { executionMode: job.input.executionMode }));
  try {
  // FINAL MANDATE Phase 1: owner emergency stop halts queued jobs before execution.
  const emergencyStop = await checkEmergencyStop();
  if (emergencyStop.active || emergencyStop.source === 'unavailable') {
    await updateJob(job.jobId, {
      status: 'blocked',
      stage: 'FAILED',
      stageDetail: `Owner control ${emergencyStop.source === 'unavailable' ? 'unavailable' : 'stopped'} — job blocked before execution.`,
      finishedAt: nowIso(),
      error: emergencyStop.source === 'unavailable'
        ? 'EMERGENCY_STOP_UNAVAILABLE: job refused until owner control is readable.'
        : 'EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged; job refused at start boundary.',
    }, true);
    return null;
  }

  // Recheck authority inside the serialized write: cancellation can complete
  // while the admitted job awaits the owner-control read above.
  await updateJob(job.jobId, {
    status: 'running',
    stage: 'RUNNING',
    progressPercent: STAGE_PROGRESS.RUNNING,
    stageDetail: 'Job started.',
    startedAt: nowIso(),
    lastHeartbeatAt: nowIso(),
    attempts: sharedSeniorQueueEnabled() ? job.attempts : job.attempts + 1,
  }, true, true);

  leaseHeartbeat = sharedSeniorQueueEnabled() ? setInterval(() => {
    if (controller.cancelled) return;
    void updateJob(job.jobId, { lastHeartbeatAt: nowIso() }, true).catch(error => recordJobInterruption(job.jobId, controller, 'heartbeat_unconfirmed', error));
  }, 20_000) : null;
  leaseHeartbeat?.unref?.();
    // If cancelled before we even started, abort.
    if (controller.cancelled) {
        if (controller.interrupted) return null;
      await updateJob(job.jobId, {
        status: 'cancelled',
        stage: 'FAILED',
        finishedAt: nowIso(),
        cancelledAt: nowIso(),
        error: 'Job cancelled before execution.',
      });
      activeJobControllers.delete(job.jobId);
      return null;
    }

    // ── READ-ONLY INSPECTION BRANCH (owner mandate 2026-07-19) ───────────────
    // Read-only developer inspection prompts route through the same persistent
    // worker queue but run a strictly READ-ONLY pipeline: inspect files, search
    // code, run read-only tests/typecheck, identify root cause. NEVER edit,
    // commit, push, deploy, or apply migrations. Returns a structured proof +
    // the owner-mandated strict inspection format.
    if (job.input.executionMode === 'read_only') {
      const readOnlyProof = await runIVXReadOnlyInspection({
        goal: job.input.goal,
        onPhase: (phase: IVXReadOnlyInspectionPhase, detail: string) => {
          if (controller.cancelled) return;
          const { stage, detail: mappedDetail } = phaseToStage(phase);
          void updateJobStage(job.jobId, stage, detail || mappedDetail).catch(error => recordJobInterruption(job.jobId, controller, 'phase_write_unconfirmed', error));
        },
      });

      if (controller.cancelled) {
        if (controller.interrupted) return null;
        await updateJob(job.jobId, {
          status: 'cancelled',
          stage: 'FAILED',
          finishedAt: nowIso(),
          cancelledAt: nowIso(),
          error: 'Job cancelled during read-only inspection.',
        });
        activeJobControllers.delete(job.jobId);
        return null;
      }

      const readOnlyResult = summarizeReadOnlyInspectionProof(job.jobId, readOnlyProof);
      const result = finalizeResultWithStateRecord(job, readOnlyResult);
      const status: IVXWorkerJobStatus = result.finalStatus === 'COMPLETE' ? 'completed' : 'failed';
      const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
      await updateJob(job.jobId, {
        status,
        stage: finalStage,
        progressPercent: STAGE_PROGRESS[finalStage],
        stageDetail: status === 'completed'
          ? 'Read-only inspection completed. No files changed, no commit, no deploy.'
          : (result.error ?? 'Read-only inspection failed.'),
        finishedAt: nowIso(),
        result,
        error: result.error,
      });
      await appendLedger(result);
      activeJobControllers.delete(job.jobId);
      return result;
    }

    // ── QA-ONLY BRANCH (owner certification fix 2026-07-20) ─────────────────
    // QA-only requests ("Run QA on the IVX Chat module without modifying code")
    // route through the IVX QA-Only Runtime: inspect the requested module's
    // source files, select the matching test files, run targeted `bun test`,
    // run scoped typecheck, run lint when applicable, capture exit codes +
    // pass/fail/skip counts + duration. NEVER edit, commit, push, deploy, or
    // apply migrations. When the target module cannot be identified, returns
    // BLOCKED with errorCode QA_TARGET_NOT_FOUND (never a generic health check
    // as QA evidence). Produces an IVXQAOnlyProof written to the durable ledger.
    if (job.input.executionMode === 'qa_only') {
      const qaProof = await runIVXQAOnly({
        goal: job.input.goal,
        onPhase: (phase: IVXQAOnlyPhase, detail: string) => {
          if (controller.cancelled) return;
          const { stage, detail: mappedDetail } = qaPhaseToStage(phase);
          void updateJobStage(job.jobId, stage, detail || mappedDetail).catch(error => recordJobInterruption(job.jobId, controller, 'phase_write_unconfirmed', error));
        },
      });

      if (controller.cancelled) {
        if (controller.interrupted) return null;
        await updateJob(job.jobId, {
          status: 'cancelled',
          stage: 'FAILED',
          finishedAt: nowIso(),
          cancelledAt: nowIso(),
          error: 'Job cancelled during QA-only execution.',
        });
        activeJobControllers.delete(job.jobId);
        return null;
      }

      const qaResult = summarizeQAOnlyProof(job.jobId, qaProof);
      const result = finalizeResultWithStateRecord(job, qaResult);
      const status: IVXWorkerJobStatus = result.finalStatus === 'COMPLETE'
        ? 'completed'
        : result.finalStatus === 'BLOCKED'
          ? 'blocked'
          : 'failed';
      const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
      await updateJob(job.jobId, {
        status,
        stage: finalStage,
        progressPercent: STAGE_PROGRESS[finalStage],
        stageDetail: status === 'completed'
          ? `QA-only run completed. ${qaProof.passed} pass / ${qaProof.failed} fail / ${qaProof.skipped} skip. No files changed, no commit, no deploy.`
          : qaProof.errorCode === 'QA_TARGET_NOT_FOUND'
            ? 'QA-only run BLOCKED — no test files matched the requested module (QA_TARGET_NOT_FOUND).'
            : (result.error ?? 'QA-only run failed.'),
        finishedAt: nowIso(),
        result,
        error: result.error,
      });
      await appendLedger(result);
      activeJobControllers.delete(job.jobId);
      return result;
    }

    // ── FACTORY ENGINE BRANCH (owner mandate 2026-07-19) ────────────────────
    // factory execution mode routes through the IVX Factory Engine: the owner-
    // gated LLM plan produces a sequence of factory operations (create_directory,
    // create_module, install_dependency, run_supabase_migration, run_build,
    // create_tool, upgrade_self). Each operation runs with a structured proof,
    // and the job produces a single IVXFactoryJobProof. Factory mode requires
    // the explicit approval phrase CONFIRM_IVX_FACTORY_MODE — no factory
    // operation runs without it. This extends the autonomous coder from a
    // PATCH engine into a FACTORY engine that can build apps from scratch.
    if (job.input.executionMode === 'factory') {
      // Owner mandate 2026-07-20: inject REAL runners so factory operations execute
      // live on production, not just in unit tests. The runners read credentials from
      // process.env at RUNTIME (Render env) — no secrets in code. If a credential is
      // missing, the runner returns ok=false and the factory engine records a BLOCKED
      // proof (honest, no phantom success).
      const realRunners = getRealFactoryRunners();
      const factoryProof = await runIVXFactoryJob({
        taskId: job.jobId,
        goal: job.input.goal,
        ownerId: job.ownerId,
        approvalPhrase: job.input.factoryApprovalPhrase ?? '',
        operations: job.input.factoryOperations ?? [],
        migrationRunner: realRunners.migrationRunner,
        dependencyRunner: realRunners.dependencyRunner,
        buildRunner: realRunners.buildRunner,
      });

      // If the factory created files on disk, commit them to GitHub via the owner-
      // gated Git Data API (same canonical path the autonomous coder uses). This
      // makes create_directory + create_module operations PERSIST to the canonical
      // repo — the factory engine can now scaffold real modules live.
      let factoryCommitSha: string | null = null;
      let factoryCommitDiagnostics: IVXWorkerJobResult['factoryCommitDiagnostics'] = {
        stepReached: false,
        approved: factoryProof.approved,
        filesCreatedCount: factoryProof.filesCreated.length,
        finalStatus: factoryProof.finalStatus,
        commitAttempted: false,
        commitOk: null,
        commitError: null,
        commitSha: null,
      };
      if (factoryProof.approved && factoryProof.filesCreated.length > 0 && factoryProof.finalStatus === 'COMPLETED') {
        factoryCommitDiagnostics.stepReached = true;
        factoryCommitDiagnostics.commitAttempted = true;
        const commitMsg = `IVX factory engine: ${job.input.goal.slice(0, 120)}`;
        const commitResult = await commitFactoryFilesToGitHub(factoryProof.filesCreated, commitMsg);
        factoryCommitDiagnostics.commitOk = commitResult.ok;
        factoryCommitDiagnostics.commitError = commitResult.error;
        factoryCommitDiagnostics.commitSha = commitResult.commitSha;
        if (commitResult.ok && commitResult.commitSha) {
          factoryCommitSha = commitResult.commitSha;
        }
      }

      if (controller.cancelled) {
        if (controller.interrupted) return null;
        await updateJob(job.jobId, {
          status: 'cancelled',
          stage: 'FAILED',
          finishedAt: nowIso(),
          cancelledAt: nowIso(),
          error: 'Job cancelled during factory execution.',
        });
        activeJobControllers.delete(job.jobId);
        return null;
      }

      const factoryResult = summarizeFactoryJobProof(job.jobId, factoryProof);
      const result = finalizeResultWithStateRecord(job, factoryResult);
      if (factoryCommitSha) {
        result.commitCreated = true;
        result.commitSha = factoryCommitSha;
        result.commitUrl = `https://github.com/ibb142/ivx-holdings-platform/commit/${factoryCommitSha}`;
        result.pushed = true;
      }
      result.factoryCommitDiagnostics = factoryCommitDiagnostics;
      const status: IVXWorkerJobStatus = result.finalStatus === 'COMPLETE'
        ? 'completed'
        : result.finalStatus === 'BLOCKED'
          ? 'blocked'
          : 'failed';
      const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
      await updateJob(job.jobId, {
        status,
        stage: finalStage,
        progressPercent: STAGE_PROGRESS[finalStage],
        stageDetail: status === 'completed'
          ? `Factory job completed. ${factoryProof.filesCreated.length} files created, ${factoryProof.dependenciesInstalled.length} deps installed, ${factoryProof.migrationsApplied.length} migrations, ${factoryProof.buildsProduced.length} builds, ${factoryProof.toolsRegistered.length} tools registered, ${factoryProof.capabilitiesAdded.length} capabilities added.`
          : (result.error ?? 'Factory job failed.'),
        finishedAt: nowIso(),
        result,
        error: result.error,
      });
      await appendLedger(result);
      activeJobControllers.delete(job.jobId);
      return result;
    }

    // ── AUTONOMOUS CODER BRANCH (owner mandate 2026-07-19) ──────────────────
    // code_change / deploy execution modes route through the IVX Autonomous
    // Coder engine: the owner-controlled LLM generates a real patch, the engine
    // applies it in the repo, runs real tests + typecheck, iterates on failure
    // (bounded to MAX_ITERATIONS), commits via the GitHub Git Data API, and —
    // only when executionMode === 'deploy' AND owner approval is verified —
    // triggers render_trigger_deploy + verifies production health. This is the
    // real code-writing loop: the patch is authored by the IVX LLM, NOT by an external platform
    // manually editing the code.
    if (job.input.executionMode === 'code_change' || job.input.executionMode === 'deploy') {
      const coderProof = await runIVXAutonomousCoder({
        taskId: job.input.taskId ?? job.jobId,
        allowedFiles: job.input.ownerApprovedAction?.filesAffected,
        goal: job.input.goal,
        executionMode: job.input.executionMode,
        ownerId: job.ownerId,
        // Owner mandate 2026-08-28 (Mission F): per-IA commit attribution —
        // the identity flows dispatcher → worker → coder → commit/PR metadata.
        agentNumber: job.input.agentNumber ?? null,
        agentId: job.input.agentId ?? null,
        workerJobId: job.jobId,
        approvalPolicy: 'owner_gated',
        deployApproved: job.input.approveGitDeploy,
        deployConfirmationText: job.input.gitDeployConfirmationText,
        autoMergePr: true,
        isCanceled: () => controller.cancelled && !controller.interrupted,
        assertExecutionAuthority: async () => {
          if (controller.interrupted || queueStopping) throw new Error('WORKER_AUTHORITY_UNCONFIRMED: checkpoint retained for recovery');
          await assertEmergencyStopInactive('senior-worker-mutation');
          if (controller.cancelled) throw new Error('JOB_CANCELED: owner cancelled the job');
          try { await updateJob(job.jobId, { lastHeartbeatAt: nowIso() }, true, true); }
          catch (error) { recordJobInterruption(job.jobId, controller, 'authority_unconfirmed', error); throw error; }
        },
        onWorkspaceEvidence: async evidence => {
          const current = await getSeniorDeveloperJob(job.jobId);
          if (!current || (sharedSeniorQueueEnabled() && !current.leaseWorkerInstanceId)) {
            throw new Error('WORKSPACE_RECEIPT_REQUIRES_WORKER_LEASE');
          }
          const sha = process.env.RENDER_GIT_COMMIT ?? '';
          await updateJob(job.jobId, { workspaceEvidence: {
            ...evidence, jobId: job.jobId, taskId: job.input.taskId ?? job.jobId,
            ownerId: job.ownerId, agentId: job.input.agentId ?? null, agentNumber: job.input.agentNumber ?? null,
            workerInstanceId: current.leaseWorkerInstanceId ?? null, leaseExpiresAt: current.leaseExpiresAt ?? null,
            runtimeSha: /^[a-f0-9]{40}$/i.test(sha) ? sha : null,
          } }, true, true);
        },
        onPhase: (phase: IVXAutonomousCoderPhase, detail: string) => {
          if (controller.cancelled) return;
          const { stage, detail: mappedDetail } = autonomousCoderPhaseToStage(phase);
          void updateJobStage(job.jobId, stage, detail || mappedDetail).catch(error => recordJobInterruption(job.jobId, controller, 'phase_write_unconfirmed', error));
        },
        // RESILIENCE: persist the commit SHA + branch to the job record the
        // instant the GitHub commit lands — BEFORE proof construction, deploy,
        // or verify. If the worker process is killed between commit-landed and
        // proof-return (OOM, container restart, Render auto-deploy on a
        // main-branch commit, etc.), the recovery sweep can still find the
        // commit on the ivx-autonomous branch and recover the job to COMPLETED
        // instead of orphaning it at COMMITTING 65% with commitSha=''.
        onCommitLanded: async ({ commitSha, commitUrl, branch, filesChanged, commandsRun, testsPassed, typecheckPassed }) => {
          const validationEvidence = validationEvidenceFromCommands(commandsRun);
          await updateJob(job.jobId, {
            stage: 'COMMITTING',
            status: 'committing',
            progressPercent: STAGE_PROGRESS['COMMITTING'],
            stageDetail: `Commit created: ${commitSha}`,
            result: {
              jobId: job.jobId,
              goal: job.input.goal.slice(0, 280),
              ok: true,
              endToEndProductionComplete: false,
              changedFiles: filesChanged,
              validationEvidence,
              testsRun: validationEvidence.some(result => result.kind === 'test'),
              testsPassed,
              typecheckRun: validationEvidence.some(result => result.kind === 'typecheck'),
              typecheckPassed,
              buildRun: false,
              commitCreated: true,
              commitSha,
              commitUrl,
              pushed: true,
              branch,
              prNumber: null,
              prUrl: null,
              prMerged: false,
              prMergeCommitSha: null,
              deployId: null,
              deployStatus: null,
              deployVerified: false,
              deployRequested: job.input.executionMode === 'deploy',
              liveCommit: null,
              commitMatch: false,
              healthOk: false,
              healthStatus: null,
              versionEndpoint: null,
              generatedFeatureSlug: null,
              auditFiles: { json: '', jsonl: '' },
              finalStatus: 'COMPLETE',
              error: null,
              durable: isDurableStoreConfigured(),
              generatedAt: nowIso(),
              taskType: classifyTaskType(job.input.goal),
            },
          });
        },
        // FINAL CLOSEOUT 2026-08-23 (restart/CI-wait resume): persist the full
        // resume state the instant the PR exists — BEFORE the CI wait begins —
        // so a worker restart mid-wait resumes the merge chain with the SAME
        // jobId instead of being orphaned for the stale sweep to expire.
        onPrCreated: async ({ commitSha, prNumber, prUrl, branch }) => {
          const current = await getSeniorDeveloperJob(job.jobId);
          const prior = current?.result ?? null;
          // onCommitLanded always persists the full result BEFORE the PR is
          // created; if it is somehow missing, keep the last known-good
          // result untouched rather than writing a partial one.
          if (!prior || prior.commitSha !== commitSha || controller.cancelled) {
            throw new Error('PR_RESUME_PERSISTENCE_REQUIRED: committed identity or worker lease unavailable');
          }
          await updateJob(job.jobId, {
            stage: 'COMMITTING',
            status: 'committing',
            progressPercent: STAGE_PROGRESS['COMMITTING'],
            stageDetail: `Pull request #${prNumber} created — CI-wait resume state persisted (commit ${commitSha.slice(0, 12)}, branch ${branch}).`,
            result: {
              ...prior,
              prNumber,
              prUrl,
              prMerged: false,
              prMergeCommitSha: null,
              commitSha,
              branch,
              ciResumeState: {
                jobId: job.jobId,
                taskId: job.input.taskId ?? job.jobId,
                phase: 'CI_WAIT',
                commitSha,
                prNumber,
                prUrl,
                branch,
                mergeTarget: 'main',
                persistedAt: nowIso(),
              },
            },
          });
        },
      });

      if (controller.cancelled) {
        if (controller.interrupted) return null;
        await updateJob(job.jobId, {
          status: 'cancelled',
          stage: 'FAILED',
          finishedAt: nowIso(),
          cancelledAt: nowIso(),
          error: 'Job cancelled during autonomous coding.',
        });
        activeJobControllers.delete(job.jobId);
        return null;
      }

      const coderResult = summarizeAutonomousCoderProof(job.jobId, coderProof);
      const result = finalizeResultWithStateRecord(job, coderResult);
      const status: IVXWorkerJobStatus = result.finalStatus === 'COMPLETE'
        ? 'completed'
        : result.finalStatus === 'BLOCKED'
          ? 'blocked'
          : 'failed';
      const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
      await updateJob(job.jobId, {
        status,
        stage: finalStage,
        progressPercent: STAGE_PROGRESS[finalStage],
        stageDetail: status === 'completed'
          ? `Autonomous coder completed. Patch authored by ${coderProof.patchAuthoredBy ?? 'none'}, commit ${coderProof.commitSha ?? 'none'}, deploy ${coderProof.deployId ?? 'not requested'}.`
          : (result.error ?? 'Autonomous coder failed.'),
        finishedAt: nowIso(),
        result,
        error: result.error,
      });
      await appendLedger(result);
      activeJobControllers.delete(job.jobId);
      return result;
    }

    const proof = await runIVXSeniorDeveloperTask({
      goal: job.input.goal,
      approvePatch: job.input.approvePatch,
      patchConfirmationText: job.input.approvePatch ? IVX_SAFE_PATCH_CONFIRM_TEXT : '',
      approveGitDeploy: job.input.approveGitDeploy,
      gitDeployConfirmationText: job.input.approveGitDeploy ? IVX_GIT_DEPLOY_CONFIRM_TEXT : '',
      validationMode: job.input.validationMode,
      ownerApprovedAction: job.input.ownerApprovedAction ?? undefined,
      systemMode: job.input.systemMode,
      onPhase: (phase: string, _detail: string) => {
        if (controller.cancelled) return;
        const { stage, detail } = phaseToStage(phase);
        void updateJobStage(job.jobId, stage, detail).catch(error => recordJobInterruption(job.jobId, controller, 'phase_write_unconfirmed', error));
      },
      // RESILIENCE: persist the commit SHA + branch to the job record the
      // instant the GitHub commit lands — BEFORE the Render deploy triggers.
      // If the worker process is killed by the deploy restart (Render auto-
      // deploys on main-branch commit), the recovery sweep can still find the
      // commit SHA on the job and resume verification after restart.
      onCommitLanded: ({ commitSha, commitUrl, branch }) => {
        void updateJob(job.jobId, {
          stage: 'COMMITTING',
          status: 'committing',
          progressPercent: STAGE_PROGRESS['COMMITTING'],
          stageDetail: `Commit created: ${commitSha}`,
          result: {
            jobId: job.jobId,
            goal: job.input.goal.slice(0, 280),
            ok: true,
            endToEndProductionComplete: false,
            changedFiles: [],
            testsRun: true,
            testsPassed: true,
            typecheckRun: true,
            typecheckPassed: true,
            buildRun: false,
            commitCreated: true,
            commitSha,
            commitUrl,
            pushed: true,
            branch,
            prNumber: null,
            prUrl: null,
            prMerged: false,
            prMergeCommitSha: null,
            deployId: null,
            deployStatus: null,
            deployVerified: false,
            deployRequested: job.input.approveGitDeploy,
            liveCommit: null,
            commitMatch: false,
            healthOk: false,
            healthStatus: null,
            versionEndpoint: null,
            generatedFeatureSlug: null,
            auditFiles: { json: '', jsonl: '' },
            finalStatus: 'COMPLETE',
            error: null,
            durable: isDurableStoreConfigured(),
            generatedAt: nowIso(),
            taskType: classifyTaskType(job.input.goal),
          },
        });
      },
    });

    // Check cancellation after the run.
    if (controller.cancelled) {
        if (controller.interrupted) return null;
      await updateJob(job.jobId, {
        status: 'cancelled',
        stage: 'FAILED',
        finishedAt: nowIso(),
        cancelledAt: nowIso(),
        error: 'Job cancelled during execution.',
      });
      activeJobControllers.delete(job.jobId);
      return null;
    }

    // Deploy verification: if a commit landed, confirm production serves it.
    // HARD TIMEOUT (IVX-CERT-INTEGRITY-001 corrective action): races the
    // verification against VERIFY_STAGE_TIMEOUT_MS so a stalled Render poll or
    // hung /version fetch can never leave the job at VERIFYING indefinitely.
    // On timeout the job is explicitly failed with an honest, specific reason
    // instead of hanging at 90% forever.
    let match: Awaited<ReturnType<typeof verifyLiveCommitMatch>> | null = null;
    const commitSha = proof.gitDeployOperator.github.commitSha;
    if (commitSha && proof.gitDeployOperator.status === 'executed') {
      await updateJobStage(job.jobId, 'VERIFYING', 'Verifying live commit match on production.');
      const verifyStartedAt = Date.now();
      try {
        match = await Promise.race([
          verifyLiveCommitMatch({
            requestedCommit: commitSha,
            deploymentId: proof.gitDeployOperator.render.deployId,
          }),
          new Promise<never>((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('IVX_VERIFY_TIMEOUT')), VERIFY_STAGE_TIMEOUT_MS);
            timer.unref?.();
          }),
        ]);
      } catch (verifyError) {
        const timedOut = verifyError instanceof Error && verifyError.message === 'IVX_VERIFY_TIMEOUT';
        const elapsedMs = Date.now() - verifyStartedAt;
        const reason = timedOut
          ? `VERIFYING stage exceeded its ${VERIFY_STAGE_TIMEOUT_MS}ms hard timeout after ${elapsedMs}ms (commit ${commitSha.slice(0, 12)}, deploy ${proof.gitDeployOperator.render.deployId ?? 'none'}). Code was committed/deployed but live-commit verification could not complete in time.`
          : `VERIFYING stage failed after ${elapsedMs}ms: ${verifyError instanceof Error ? verifyError.message.slice(0, 300) : 'unknown error'}`;
        const timeoutResult = summarizeProof(job.jobId, proof, null);
        timeoutResult.finalStatus = 'FAILED';
        timeoutResult.error = reason;
        await updateJob(job.jobId, {
          status: 'failed',
          stage: 'FAILED',
          progressPercent: STAGE_PROGRESS.FAILED,
          stageDetail: reason,
          finishedAt: nowIso(),
          result: timeoutResult,
          error: reason,
        });
        await appendLedger(timeoutResult);
        activeJobControllers.delete(job.jobId);
        return timeoutResult;
      }
    }

    const proofResult = summarizeProof(job.jobId, proof, match);
    const result = finalizeResultWithStateRecord(job, proofResult);
    const status: IVXWorkerJobStatus = result.finalStatus === 'COMPLETE'
      ? 'completed'
      : result.finalStatus === 'LOCAL_ONLY'
        ? 'completed'
        : result.finalStatus === 'BLOCKED'
          ? 'blocked'
          : 'failed';

    const finalStage: IVXWorkerJobStage = status === 'completed' ? 'COMPLETED' : 'FAILED';
    await updateJob(job.jobId, {
      status,
      stage: finalStage,
      progressPercent: STAGE_PROGRESS[finalStage],
      stageDetail: status === 'completed' ? 'Job completed successfully.' : (result.error ?? 'Job failed.'),
      finishedAt: nowIso(),
      result,
      error: result.error,
    });
    await appendLedger(result);
    activeJobControllers.delete(job.jobId);
    return result;
  } catch (error) {
    if (controller.interrupted || queueStopping) return null; // Lost authority is not owner cancellation.
    const message = error instanceof Error ? error.message.slice(0, 500) : 'Worker run failed.';

    // P0 FIX (owner mandate 2026-08-10): Automatic recovery for transient failures.
    // Detect recoverable errors (transient GitHub API error, rate limit, stale
    // branch, provider timeout, network failure, credential refresh) and retry
    // the job WITHOUT asking the owner again. Bounded to MAX_AUTO_RETRIES.
    const TRANSIENT_ERROR_PATTERNS = [
      /HTTP 403/i,
      /HTTP 429/i,
      /rate.?limit/i,
      /secondary.?rate.?limit/i,
      /stale.?branch/i,
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /ENOTFOUND/i,
      /EAI_AGAIN/i,
      /fetch.?failed/i,
      /network.?error/i,
      /timeout/i,
      /abort/i,
      /5\d\d/i,
      /credential/i,
      /token.*(expired|invalid|revoked)/i,
    ];
    const isTransient = TRANSIENT_ERROR_PATTERNS.some((re) => re.test(message));
    // Read the durable checkpoint: the initially admitted job predates commit
    // publication. Retrying that snapshot recodes already published work and
    // can overwrite its branch while leaving the old commit in the queue.
    const current = await getSeniorDeveloperJob(job.jobId);
    if (!current || !ACTIVE_STATUSES.has(current.status)) return null;
    const committedPatch = committedFailurePatch(current, message, isTransient, nowIso());
    if (committedPatch) {
      await updateJob(job.jobId, committedPatch, true);
      return null;
    }
    const MAX_AUTO_RETRIES = 3;
    const currentAttempts = job.attempts;

    if (isTransient && currentAttempts < MAX_AUTO_RETRIES) {
      console.log(`[IVXWorker] transient_failure_retry: job=${job.jobId} attempt=${currentAttempts}/${MAX_AUTO_RETRIES} error=${message.slice(0, 200)}`);
      // Re-queue the job with exponential backoff. Owner approval PERSISTS —
      // the same task scope does NOT require re-authorization.
      const backoffMs = Math.min(2_000 * Math.pow(2, currentAttempts), 30_000);
      await updateJob(job.jobId, {
        status: 'queued',
        stage: 'QUEUED',
        progressPercent: 0,
        stageDetail: `Auto-retry ${currentAttempts + 1}/${MAX_AUTO_RETRIES} after transient failure: ${message.slice(0, 150)}. Backoff ${backoffMs}ms. Owner authorization preserved.`,
        finishedAt: null,
        error: `transient_failure (auto-retry ${currentAttempts + 1}/${MAX_AUTO_RETRIES}): ${message.slice(0, 200)}`,
      });
      activeJobControllers.delete(job.jobId);
      // Schedule re-drain after backoff.
      setTimeout(() => { void drainSeniorDeveloperQueue(); }, backoffMs).unref?.();
      return null;
    }

    // Retries exhausted or non-transient failure — report BLOCKED with exact evidence.
    const blockedReason = isTransient
      ? `Task failed after ${MAX_AUTO_RETRIES} auto-retries: ${message}`
      : `Task failed at execution: ${message}`;
    const failedResult: IVXWorkerJobResult = {
      jobId: job.jobId,
      goal: job.input.goal,
      ok: false,
      endToEndProductionComplete: false,
      changedFiles: [],
      testsRun: false,
      testsPassed: false,
      typecheckRun: false,
      typecheckPassed: false,
      buildRun: false,
      commitCreated: false,
      commitSha: null,
      commitUrl: null,
      pushed: false,
      branch: null,
      prNumber: null,
      prUrl: null,
      prMerged: false,
      prMergeCommitSha: null,
      deployId: null,
      deployStatus: null,
      deployVerified: false,
      deployRequested: false,
      liveCommit: null,
      commitMatch: false,
      healthOk: false,
      healthStatus: null,
      versionEndpoint: null,
      generatedFeatureSlug: null,
      auditFiles: { json: '', jsonl: '' },
      finalStatus: 'FAILED',
      error: blockedReason,
      durable: true,
      generatedAt: nowIso(),
    };
    await updateJob(job.jobId, {
      status: 'failed',
      stage: 'FAILED',
      stageDetail: blockedReason,
      finishedAt: nowIso(),
      error: blockedReason,
      result: failedResult,
    });
    await appendLedger(failedResult).catch(() => {});
    activeJobControllers.delete(job.jobId);
    return null;
  } finally {
    if (leaseHeartbeat) clearInterval(leaseHeartbeat);
    activeJobControllers.delete(job.jobId);
    claimedJobIds.delete(job.jobId);
  }
}

/**
 * Fill free execution slots without waiting for unrelated jobs or CI waits.
 * The pump is serialized; running executions retain their own promises and
 * physical leases. Admission still enforces configured capacity and owner
 * single-flight. Periodic/enqueue kicks can fill a slot while other work runs.
 */
export async function drainSeniorDeveloperQueue(): Promise<void> {
  if (draining || queueStopping) return;
  draining = true;
  try {
    // Shared recovery runs on the independent stale-sweep timer. It can wait
    // for storage or CI, so it must not gate admission of unrelated ready work.
    // The claim RPC still enforces physical leases and owner single-flight.
    if (!sharedSeniorQueueEnabled() && activeDrainExecutions.size === 0) await expireStaleJobs();
    const slots = Math.max(0, getWorkerMaxConcurrency() - activeDrainExecutions.size);
    for (let i = 0; !queueStopping && i < slots; i++) {
      const execution = processNextSeniorDeveloperJob();
      activeDrainExecutions.add(execution);
      void execution.then(result => {
        activeDrainExecutions.delete(execution);
        // Null/rejection can mean no work or uncertain storage. Let the next
        // bounded periodic kick retry; never spin on an empty or failed queue.
        if (result && !queueStopping) void drainSeniorDeveloperQueue().catch(() => {});
      }, () => { activeDrainExecutions.delete(execution); });
    }
  } finally {
    draining = false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STALE JOB SWEEP (periodic)
// ─────────────────────────────────────────────────────────────────────────────

/** Periodic stale job sweep — runs every STALE_CHECK_INTERVAL_MS. */
let staleSweepTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the periodic stale job sweep. Called once at server boot. Safe to call
 * multiple times — only one timer is ever active.
 */
export function startStaleJobSweep(): void {
  if (!shouldExecuteWorkerQueueInThisProcess()) return;
  if (staleSweepTimer) return;
  staleSweepTimer = setInterval(() => {
    void expireStaleJobs().catch(() => {});
  }, STALE_CHECK_INTERVAL_MS);
  staleSweepTimer.unref?.();
}

// Start the sweep automatically on module load.
startStaleJobSweep();

// ─────────────────────────────────────────────────────────────────────────────
// V6.15: PERIODIC QUEUE DRAIN TIMER
// ─────────────────────────────────────────────────────────────────────────────
// Root cause: jobs sit at QUEUED (0%) until manually resumed via /resume.
// The initial `void drainSeniorDeveloperQueue()` on enqueue fires once but if
// the drain is already in progress (draining=true) or the job is enqueued after
// the drain loop has exited, no timer picks it up. This periodic drain fires
// every 15 seconds, ensuring queued jobs are always picked up within 15s
// without manual intervention.
let queueDrainTimer: ReturnType<typeof setInterval> | null = null;
const QUEUE_DRAIN_INTERVAL_MS = 15_000;

export function startQueueDrainTimer(): void {
  if (!shouldExecuteWorkerQueueInThisProcess()) return;
  if (queueDrainTimer) return;
  queueDrainTimer = setInterval(() => {
    void drainSeniorDeveloperQueue().catch(() => {});
  }, QUEUE_DRAIN_INTERVAL_MS);
  queueDrainTimer.unref?.();
}

// Start the periodic drain automatically on module load.
startQueueDrainTimer();

export function stopSeniorDeveloperQueue(): void {
  queueStopping = true;
  if (queueDrainTimer) clearInterval(queueDrainTimer);
  if (staleSweepTimer) clearInterval(staleSweepTimer);
  queueDrainTimer = null; staleSweepTimer = null;
  for (const [jobId, controller] of activeJobControllers) recordJobInterruption(jobId, controller, 'worker_shutdown');
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS SURFACE
// ─────────────────────────────────────────────────────────────────────────────

/** Process start time for uptime reporting in the worker status snapshot. */
const WORKER_PROCESS_START_TIME = Date.now();

/** Worker capability snapshot — what this self-hosted executor can do without external platform. */
export function buildSeniorDeveloperWorkerStatus(): Record<string, unknown> {
  const uptimeMs = Date.now() - WORKER_PROCESS_START_TIME;
  return {
    ok: true,
    marker: IVX_SENIOR_DEV_WORKER_MARKER,
    executor: 'ivx-self-hosted-worker',
    externalRequiredAsExecutor: false,
    durableQueue: isDurableStoreConfigured(),
    perOwnerSingleFlight: true,
    uptimeSeconds: Math.floor(uptimeMs / 1000),
    concurrency: {
      scope: 'process',
      configuredExecutionSlots: getWorkerMaxConcurrency(),
      activeExecutions: activeJobControllers.size,
      reservedJobs: new Set([...claimedJobIds, ...activeCiResumeJobIds]).size,
      classification: 'BOUNDED_WORKER_WITH_OWNER_LEASES',
      note: 'These are local execution slots. Independent owners may run concurrently; shared PostgreSQL claims preserve per-owner single-flight.',
    },
    heartbeatTracking: true,
    staleJobTimeoutMs: STALE_JOB_TIMEOUT_MS,
    staleCheckIntervalMs: STALE_CHECK_INTERVAL_MS,
    granularStages: ['QUEUED', 'RUNNING', 'PATCHING', 'TESTING', 'COMMITTING', 'DEPLOYING', 'VERIFYING', 'COMPLETED', 'FAILED'],
    capabilities: {
      receiveOwnerApprovedTask: true,
      jobQueue: true,
      perOwnerSingleFlight: true,
      staleJobExpiration: true,
      cancelJob: true,
      resumeJob: true,
      attachToRunningJob: true,
      realTimeStageUpdates: true,
      executionSandbox: true,
      githubRepoReadWrite: true,
      fileCreateModify: true,
      testRunner: true,
      typecheckRunner: true,
      buildRunner: true,
      commitService: true,
      pushService: true,
      renderDeploy: true,
      deployPoll: true,
      healthVerify: true,
      versionVerify: true,
      proofLedger: true,
      ownerApprovalGate: true,
      secretSafeLogging: true,
    },
    routes: {
      enqueue: 'POST /api/ivx/senior-developer/worker/jobs',
      job: 'GET /api/ivx/senior-developer/worker/jobs/:jobId',
      jobs: 'GET /api/ivx/senior-developer/worker/jobs',
      cancel: 'POST /api/ivx/senior-developer/worker/jobs/:jobId/cancel',
      resume: 'POST /api/ivx/senior-developer/worker/jobs/:jobId/resume',
      active: 'GET /api/ivx/senior-developer/worker/active',
      ledger: 'GET /api/ivx/senior-developer/worker/ledger',
      status: 'GET /api/ivx/senior-developer/worker/status',
    },
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKWARDS-COMPATIBLE ENQUEUE (delegates to enqueueOrAttach)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Submit an owner-approved development task to the worker queue. The owner
 * approval MUST already be verified by the caller (API boundary). Returns the
 * created job; the worker drains the queue asynchronously.
 *
 * @deprecated Use `enqueueOrAttachSeniorDeveloperJob` for per-owner single-flight.
 */
export async function enqueueSeniorDeveloperJob(input: IVXWorkerJobInput): Promise<IVXWorkerJob> {
  const result = await enqueueOrAttachSeniorDeveloperJob(input);
  return result.job;
}
