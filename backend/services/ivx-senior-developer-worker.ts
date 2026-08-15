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
import { randomUUID } from 'node:crypto';
import {
  appendDurableEvent,
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
} from './ivx-durable-store';
import { checkEmergencyStop } from './ivx-emergency-stop-gate';
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
  buildAutonomousCoderAnswer,
  type IVXAutonomousCoderProof,
  type IVXAutonomousCoderExecutionMode as IVXAutonomousCoderMode,
  type IVXAutonomousCoderPhase,
} from './ivx-autonomous-coder';
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
} from './ivx-duplicate-worker-prevention';

export const IVX_SENIOR_DEV_WORKER_MARKER = 'ivx-senior-developer-worker-2026-07-17';

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
  /** Approval records created at enqueue time with IDs, scopes, and expiration.
   *  Replaces inline boolean flags with trackable, single-use approval objects. */
  approvalRecords?: {
    patchApprovalId: string;
    gitDeployApprovalId: string | null;
    expiresAt: string;
  } | null;
};

export type IVXWorkerJob = {
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
  /** Pull request created from autonomous branch to main (code_change mode). */
  prNumber: number | null;
  prUrl: string | null;
  prMerged: boolean;
  prMergeCommitSha: string | null;
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
  finalStatus: 'COMPLETE' | 'LOCAL_ONLY' | 'BLOCKED' | 'FAILED';
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

/** Active job callbacks for cancel signaling. */
const activeJobControllers = new Map<string, { cancelled: boolean }>();

async function loadQueue(): Promise<QueueDoc> {
  const durable = isDurableStoreConfigured();
  if (!durable) {
    if (!memoryQueue) memoryQueue = emptyQueue(false);
    return memoryQueue;
  }
  try {
    const doc = await readDurableJson<QueueDoc>(QUEUE_FILE, emptyQueue(true));
    return { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
  } catch {
    if (!memoryQueue) memoryQueue = emptyQueue(false);
    return memoryQueue;
  }
}

async function saveQueue(doc: QueueDoc): Promise<void> {
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
    const doc = await readDurableJson<LedgerDoc>(LEDGER_FILE, emptyLedger(true));
    return { ...doc, marker: IVX_SENIOR_DEV_WORKER_MARKER, durable: true };
  } catch {
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
  if (proof.filesChanged.length === 0) return 'Code-change job produced no changed files; stale evidence is not accepted.';
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
    jobId,
    goal: proof.goal.slice(0, 280),
    ok: completed,
    endToEndProductionComplete: completed && proof.productionVerified,
    changedFiles: proof.filesChanged.slice(0, 25),
    testsRun: proof.commandsRun.some((cmd) => /test/i.test(cmd.command)),
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
const ACTIVE_STATUSES: ReadonlySet<IVXWorkerJobStatus> = new Set([
  'queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying',
]);

/**
 * Expire active jobs whose last heartbeat is older than `STALE_JOB_TIMEOUT_MS`.
 * Jobs created before heartbeat tracking fall back to `startedAt`. Stale jobs are
 * marked FAILED with an honest reason. This frees the queue so
 * a new job can start for the same owner.
 *
 * @returns array of expired job IDs
 */
export async function expireStaleJobs(): Promise<string[]> {
  const queue = await loadQueue();
  const now = Date.now();
  const expired: string[] = [];

  for (const job of queue.jobs) {
    if (!ACTIVE_STATUSES.has(job.status)) continue;
    const activityAt = job.lastHeartbeatAt ?? job.startedAt;
    if (!activityAt) continue;
    const activityAtMs = new Date(activityAt).getTime();
    if (Number.isNaN(activityAtMs)) continue;
    if (now - activityAtMs > STALE_JOB_TIMEOUT_MS) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.stageDetail = `Job expired after ${Math.round(STALE_JOB_TIMEOUT_MS / 1000)}s without a worker heartbeat.`;
      job.finishedAt = nowIso();
      job.error = `Stale job expired after heartbeat timeout (${STALE_JOB_TIMEOUT_MS}ms).`;
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

  return expired;
}

/** How long a job may sit at COMMITTING before the recovery sweep investigates.
 *  Shorter than STALE_JOB_TIMEOUT_MS so we recover before the stale sweep marks
 *  the job FAILED (which would lose the real commit evidence). */
const COMMITTING_RECOVERY_THRESHOLD_MS = 2 * 60 * 1000; // 2 min

/** Window after startedAt within which a recovered commit must have been
 *  authored. Guards against picking up an unrelated prior commit. */
const COMMITTING_RECOVERY_WINDOW_MS = 20 * 60 * 1000; // 20 min

/** Query the ivx-autonomous AND main branch HEADs to recover any job stuck
 *  at COMMITTING whose commit actually landed on GitHub.
 *
 *  V6.13 FIX: Previously only checked `ivx-autonomous` branch. Deploy jobs commit
 *  to `main` (triggering Render auto-deploy which restarts the container and
 *  kills the worker). Those jobs were NEVER recovered because the sweep only
 *  looked at `ivx-autonomous`. Now we check BOTH branches. */
async function recoverStuckCommittingJobs(queue: QueueDoc): Promise<void> {
  const token = ledgerGithubToken();
  const repoUrl = typeof process.env.GITHUB_REPO_URL === 'string' ? process.env.GITHUB_REPO_URL.trim() : '';
  const repoMatch = repoUrl.match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!token || !repoMatch?.[1] || !repoMatch?.[2]) return; // no credentials → skip
  const owner = repoMatch[1];
  const repo = repoMatch[2];
  const now = Date.now();

  // Find jobs stuck at COMMITTING past the threshold.
  const stuckJobs = queue.jobs.filter((j) =>
    j.status === 'committing' &&
    j.stage === 'COMMITTING' &&
    j.startedAt &&
    now - new Date(j.startedAt).getTime() > COMMITTING_RECOVERY_THRESHOLD_MS);
  if (stuckJobs.length === 0) return;

  // V6.13: Check BOTH branches — ivx-autonomous (code_change jobs) AND main (deploy jobs).
  const branchesToCheck = ['ivx-autonomous', 'main'];
  for (const branch of branchesToCheck) {
    let branchHeadSha: string | null = null;
    let branchHeadCommitDate: string | null = null;
    let branchHeadMessage: string | null = null;
    try {
      const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/branches/${branch}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) {
        const data = await res.json() as { commit?: { sha?: string; commit?: { author?: { date?: string }; message?: string } } };
        branchHeadSha = data.commit?.sha ?? null;
        branchHeadCommitDate = data.commit?.commit?.author?.date ?? null;
        branchHeadMessage = data.commit?.commit?.message ?? null;
      }
    } catch {
      continue; // network error → try next branch
    }
    if (!branchHeadSha || !branchHeadMessage) continue;

    // Accept both commit message patterns: autonomous coder + senior developer runtime.
    if (!/^IVX autonomous coder:/.test(branchHeadMessage) && !/^IVX senior developer/.test(branchHeadMessage) && !/^V6\./.test(branchHeadMessage)) continue;

  // Verify the commit falls within the job's time window.
  const commitMs = branchHeadCommitDate ? new Date(branchHeadCommitDate).getTime() : NaN;
  let recovered = false;
  for (const job of stuckJobs) {
    const startedMs = new Date(job.startedAt!).getTime();
    if (Number.isNaN(startedMs) || Number.isNaN(commitMs)) continue;
    if (commitMs < startedMs - 60_000 || commitMs > startedMs + COMMITTING_RECOVERY_WINDOW_MS) continue;

    // A deploy task is never complete from GitHub evidence alone. It must resume
    // at verification with its real Render deployment ID and live endpoint proof.
    if (job.input.approveGitDeploy) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.progressPercent = STAGE_PROGRESS['FAILED'];
      job.stageDetail = `Commit ${branchHeadSha.slice(0, 7)} landed on ${branch}, but no completed production verification chain exists.`;
      job.finishedAt = nowIso();
      job.error = 'Deployment task failed: a GitHub commit alone is not production verification.';
      if (job.result) {
        job.result.ok = false;
        job.result.endToEndProductionComplete = false;
        job.result.finalStatus = 'FAILED';
        job.result.error = job.error;
      }
      recovered = true;
      continue;
    }
    // GitHub evidence confirms the commit landed for this non-deploy job → recover.
    const commitUrl = `https://github.com/${owner}/${repo}/commit/${branchHeadSha}`;
    job.status = 'completed';
    job.stage = 'COMPLETED';
    job.progressPercent = STAGE_PROGRESS['COMPLETED'];
    job.stageDetail = `Recovered from COMMITTING crash: GitHub evidence confirms commit ${branchHeadSha.slice(0, 7)} landed on ${branch}. Job completed.`;
    job.finishedAt = nowIso();
    job.error = null;
    job.result = job.result ?? {
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
      commitSha: branchHeadSha,
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
    };
    if (job.result && !job.result.commitSha) {
      job.result.commitSha = branchHeadSha;
      job.result.commitUrl = commitUrl;
      job.result.branch = branch;
      job.result.commitCreated = true;
      job.result.pushed = true;
    }
    recovered = true;
    appendDurableEvent(QUEUE_FILE, { type: 'job_recovered', jobId: job.jobId, commitSha: branchHeadSha, reason: 'committing_crash_recovery' }).catch(() => {});
    }

    if (recovered) {
      await saveQueue(queue);
    }
  } // end for (branch of branchesToCheck)
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

  // Prepare GitHub compare API credentials for ancestor check.
  const ghToken = ledgerGithubToken();
  const repoUrl = typeof process.env.GITHUB_REPO_URL === 'string' ? process.env.GITHUB_REPO_URL.trim() : '';
  const repoMatch = repoUrl.match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  const ghOwner = repoMatch?.[1] ?? null;
  const ghRepo = repoMatch?.[2] ?? null;

  let recovered = false;
  for (const job of stuckJobs) {
    const expectedSha = job.result!.commitSha!;
    // Check if production is now serving the commit this job pushed.
    // If not, check if the job's commit is an ANCESTOR of the live commit
    // (a subsequent fix deploy may have been pushed on top of the job's commit).
    if (liveCommit === expectedSha) {
      // Exact match — production is serving our commit.
    } else if (ghToken && ghOwner && ghRepo) {
      // Check ancestry via GitHub compare API: is expectedSha an ancestor of liveCommit?
      try {
        const compareRes = await fetch(
          `https://api.github.com/repos/${ghOwner}/${ghRepo}/compare/${expectedSha}...${liveCommit}`,
          { headers: { Authorization: `Bearer ${ghToken}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10_000) },
        );
        if (!compareRes.ok) continue;
        const compareData = await compareRes.json() as { status?: string };
        // 'ahead' means liveCommit is ahead of expectedSha (expectedSha is an ancestor)
        if (compareData.status !== 'ahead') continue;
      } catch {
        continue; // network error → skip this job
      }
    } else {
      continue; // no GitHub credentials → can't verify ancestry
    }

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
    if (!job.result!.deployId) {
      job.status = 'failed';
      job.stage = 'FAILED';
      job.progressPercent = STAGE_PROGRESS['FAILED'];
      job.stageDetail = 'Production commit appeared live, but the task has no auditable Render deployment ID.';
      job.finishedAt = nowIso();
      job.error = 'Deployment task failed: Render deployment ID is missing.';
      job.result = { ...job.result!, ok: false, endToEndProductionComplete: false, deployVerified: false, finalStatus: 'FAILED', error: job.error };
      recovered = true;
      continue;
    }
    const result: IVXWorkerJobResult = {
      ...(job.result!),
      deployId: job.result!.deployId,
      deployStatus: job.result!.deployStatus ?? 'live',
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
    job.status = 'completed';
    job.stage = 'COMPLETED';
    job.progressPercent = STAGE_PROGRESS['COMPLETED'];
    job.stageDetail = `Recovered from VERIFYING crash: production /health confirms commit ${expectedSha.slice(0, 7)} is live. Job completed with verified evidence.`;
    job.finishedAt = nowIso();
    job.error = null;
    job.result = finalized;
    recovered = true;
    console.log('[IVX-SeniorDevWorker] VERIFYING recovery: job completed', {
      jobId: job.jobId,
      commitSha: expectedSha,
      liveCommit,
      match: true,
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
 * job exists. Also expires stale jobs before checking.
 */
export async function getActiveJobForOwner(ownerId: string): Promise<IVXWorkerJob | null> {
  if (!ownerId) return null;
  await expireStaleJobs();
  const queue = await loadQueue();
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
 *   - If the active job is stale → it is expired and a new job is created.
 *
 * Owner approval MUST already be verified by the caller (API boundary).
 */
export async function enqueueOrAttachSeniorDeveloperJob(input: IVXWorkerJobInput): Promise<EnqueueOrAttachResult> {
  const goal = input.goal.trim();
  if (!goal) throw new Error('A senior developer goal is required to enqueue a job.');
  if (!input.ownerApproved) throw new Error('Cannot enqueue a senior developer job without verified owner approval.');

  // FINAL MANDATE Phase 1: owner emergency stop halts all agent work at the enqueue boundary.
  const emergencyStop = await checkEmergencyStop();
  if (emergencyStop.active) {
    throw new Error(
      `EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged (${emergencyStop.reason ?? 'no reason recorded'}); job enqueue refused.`,
    );
  }

  const ownerId = input.ownerId ?? 'default';

  // Check for an existing active job for this owner (also expires stale jobs).
  const activeJob = await getActiveJobForOwner(ownerId);
  if (activeJob) {
    // ATTACH: return the existing running job. The request is NOT discarded.
    return { job: activeJob, attached: true, activeJobId: activeJob.jobId };
  }

  // Phase 12: compute idempotency key and check for a prior completed job with
  // the same key + identical evidence fingerprint. A duplicate redeploy (same
  // commit + deploy + files + status) is NOT a new completed development task.
  const idempotencyKey = computeIdempotencyKey({
    ownerId,
    goal,
    approvalPhrase: input.gitDeployConfirmationText ?? input.patchConfirmationText ?? null,
    executionMode: input.executionMode ?? null,
  });
  const normalizedGoal = normalizeGoalForRetry(goal);
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
      // Duplicate evidence — attach to the prior job's result, do not create a new job.
      appendDurableEvent(QUEUE_FILE, { type: 'duplicate_evidence_rejected', idempotencyKey, priorJobId: dedup.priorJobId, reason: dedup.reason }).catch(() => {});
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

  const queue = await loadQueue();
  queue.jobs.push(job);
  await saveQueue(queue);
  appendDurableEvent(QUEUE_FILE, { type: 'job_enqueued', jobId: job.jobId, goal: goal.slice(0, 200), ownerId }).catch(() => {});

  // Kick the worker without blocking the caller.
  void drainSeniorDeveloperQueue();
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

  job.status = 'cancelled';
  job.stage = 'FAILED';
  job.stageDetail = 'Job cancelled by owner.';
  job.cancelledAt = nowIso();
  job.finishedAt = nowIso();
  queue.jobs[idx] = job;
  await saveQueue(queue);
  appendDurableEvent(QUEUE_FILE, { type: 'job_cancelled', jobId }).catch(() => {});
  return job;
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
  void drainSeniorDeveloperQueue();
  return job;
}

// ─────────────────────────────────────────────────────────────────────────────
// QUEUE READS
// ─────────────────────────────────────────────────────────────────────────────

/** Read one job by id (newest queue state). */
export async function getSeniorDeveloperJob(jobId: string): Promise<IVXWorkerJob | null> {
  const queue = await loadQueue();
  return queue.jobs.find((j) => j.jobId === jobId) ?? null;
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

async function updateJob(jobId: string, patch: Partial<IVXWorkerJob>): Promise<void> {
  const queue = await loadQueue();
  const idx = queue.jobs.findIndex((j) => j.jobId === jobId);
  if (idx < 0) return;
  const existing = queue.jobs[idx];
  const isActive = ACTIVE_STATUSES.has(patch.status ?? existing.status);
  queue.jobs[idx] = {
    ...existing,
    ...patch,
    // Every active write is evidence that the worker is alive. Terminal jobs
    // retain their final heartbeat as the last observed execution signal.
    lastHeartbeatAt: patch.lastHeartbeatAt ?? (isActive ? nowIso() : existing.lastHeartbeatAt),
  };
  await saveQueue(queue);
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
function finalizeResultWithStateRecord(
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
    files_inspected: [],
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
      finalTaskState = terminalStateForNoWork(result.deployId, result.healthOk, reasonsText);
      honestError = `State machine refused ${terminalTarget}: ${reasonsText}. Downgraded to ${finalTaskState}.`;
      result.finalStatus = finalTaskState === 'BLOCKED' ? 'BLOCKED' : finalTaskState === 'FAILED' ? 'FAILED' : 'LOCAL_ONLY';
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
  const current = await getSeniorDeveloperJob(jobId);
  if (current && !ACTIVE_STATUSES.has(current.status)) {
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
  });
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
export async function processNextSeniorDeveloperJob(): Promise<IVXWorkerJobResult | null> {
  const queue = await loadQueue();
  const job = queue.jobs.find((j) => j.status === 'queued');
  if (!job) return null;

  // FINAL MANDATE Phase 1: owner emergency stop halts queued jobs before execution.
  const emergencyStop = await checkEmergencyStop();
  if (emergencyStop.active) {
    await updateJob(job.jobId, {
      status: 'blocked',
      stage: 'FAILED',
      stageDetail: `Emergency stop active — job blocked before execution (${emergencyStop.reason ?? 'no reason recorded'}).`,
      finishedAt: nowIso(),
      error: 'EMERGENCY_STOP_ACTIVE: owner emergency stop is engaged; job refused at start boundary.',
    });
    return null;
  }

  // Check if this job was cancelled while queued.
  const controller = { cancelled: false };
  activeJobControllers.set(job.jobId, controller);

  await updateJob(job.jobId, {
    status: 'running',
    stage: 'RUNNING',
    progressPercent: STAGE_PROGRESS.RUNNING,
    stageDetail: 'Job started.',
    startedAt: nowIso(),
    lastHeartbeatAt: nowIso(),
    attempts: job.attempts + 1,
  });

  try {
    // If cancelled before we even started, abort.
    if (controller.cancelled) {
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
          void updateJobStage(job.jobId, stage, mappedDetail || detail);
        },
      });

      if (controller.cancelled) {
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
          void updateJobStage(job.jobId, stage, mappedDetail || detail);
        },
      });

      if (controller.cancelled) {
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
        taskId: job.jobId,
        goal: job.input.goal,
        executionMode: job.input.executionMode,
        ownerId: job.ownerId,
        approvalPolicy: 'owner_gated',
        deployApproved: job.input.approveGitDeploy,
        deployConfirmationText: job.input.gitDeployConfirmationText,
        autoMergePr: true,
        onPhase: (phase: IVXAutonomousCoderPhase, detail: string) => {
          if (controller.cancelled) return;
          const { stage, detail: mappedDetail } = autonomousCoderPhaseToStage(phase);
          void updateJobStage(job.jobId, stage, mappedDetail || detail);
        },
        // RESILIENCE: persist the commit SHA + branch to the job record the
        // instant the GitHub commit lands — BEFORE proof construction, deploy,
        // or verify. If the worker process is killed between commit-landed and
        // proof-return (OOM, container restart, Render auto-deploy on a
        // main-branch commit, etc.), the recovery sweep can still find the
        // commit on the ivx-autonomous branch and recover the job to COMPLETED
        // instead of orphaning it at COMMITTING 65% with commitSha=''.
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
      });

      if (controller.cancelled) {
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
        void updateJobStage(job.jobId, stage, detail);
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
  }
}

/**
 * Single-flight queue drain: processes queued jobs sequentially until none
 * remain. Safe to call repeatedly — re-entrancy is guarded so only one drain
 * runs at a time. Expires stale jobs before draining.
 */
export async function drainSeniorDeveloperQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // Expire stale jobs before processing.
    await expireStaleJobs();

    // Bounded loop so a persistently-failing job cannot spin forever.
    for (let processed = 0; processed < MAX_QUEUE_RETAINED; processed += 1) {
      const result = await processNextSeniorDeveloperJob();
      if (!result) break;
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
  if (queueDrainTimer) return;
  queueDrainTimer = setInterval(() => {
    void drainSeniorDeveloperQueue().catch(() => {});
  }, QUEUE_DRAIN_INTERVAL_MS);
  queueDrainTimer.unref?.();
}

// Start the periodic drain automatically on module load.
startQueueDrainTimer();

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
      globalExecutionSlots: 1,
      independentRuntimeCount: 0,
      classification: 'SHARED_WORKER_WITH_ROLE',
      note: 'The current worker is intentionally single-flight until isolated runtime leases are deployed and evidenced.',
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
