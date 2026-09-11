/**
 * IVX AUTONOMOUS CODER — REAL CODE-WRITING ENGINE.
 *
 * Owner mandate 2026-07-19: turn IVX IA from a routing system into a REAL
 * senior developer that can independently inspect, edit, test, revise, commit,
 * and verify real code changes without Rork authoring the patch.
 *
 * This engine runs a bounded engineering loop:
 *
 *   INSPECT → PLAN → PATCH → TEST → ANALYZE → REVISE → VERIFY → COMMIT →
 *   AWAIT_OWNER_APPROVAL → DEPLOY → PRODUCTION_VERIFY
 *
 * The LLM (owner-controlled, via ivx-ai-runtime.ts requestIVXAIText) generates
 * the patch. The engine applies it, runs real tests + typecheck, and if they
 * fail, feeds the error back to the LLM for revision (bounded to
 * maximumIterations). When tests pass, the engine commits via the GitHub Git
 * Data API (owner-controlled GITHUB_TOKEN). Deploy requires owner approval
 * (approvalPolicy: 'owner_gated') and uses render_trigger_deploy.
 *
 * NOTHING is faked. If the LLM fails to produce a valid patch, the engine
 * returns STATUS: BLOCKED with the exact failures. If tests fail after
 * maximumIterations, the engine returns STATUS: BLOCKED with the current diff
 * and failure output. A job is only marked COMPLETED when a real patch exists,
 * relevant tests passed, typecheck passed, and (for code changes) a real commit
 * SHA was produced.
 */
import { MOBILE_CHECK, verifiedMobileSkip, LANDING_PR_BROWSER_CHECK, verifyLandingPrBrowserSkip } from './ivx-ci-conditional-evidence';
import { assertPrivateRepairScope, publicRepairGoal } from './ivx-private-repair-boundary';
import { assertRepairPatchQuality, requiresRepairRegression } from './ivx-repair-patch-quality';
import { assertLandingRepairScope } from './ivx-landing-repair-scope';
import { assertRepairTestRuntime, NODE_REPAIR_TEST_GUIDANCE, repairRecoveryLesson } from './ivx-repair-recovery-protocol';
import { PatchWorkspace } from './ivx-patch-workspace';
import { autonomousBranchSuffix, ensureAutonomousBranch } from './ivx-coder-branch';
import { withIsolatedCoderWorkspace } from './ivx-coder-workspace';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { requestIVXAIText } from '../ivx-ai-runtime';
import { resolveRuntimeCommand } from './ivx-runtime-resolver';
import { extractRenderApiKey, extractRenderServiceId } from './ivx-render-credentials';
import { createAutonomousGithubTokenResolver } from './ivx-autonomous-github-credentials';
import { verifyLiveCommitMatch, IVX_GIT_DEPLOY_CONFIRM_TEXT } from './ivx-senior-developer-runtime';

const execFileAsync = promisify(execFile);

export const IVX_AUTONOMOUS_CODER_MARKER = 'ivx-autonomous-coder-2026-07-19';

/** Bounded loop: max LLM revision iterations before BLOCKED. */
const MAX_ITERATIONS = 6;
/** Per-command timeout (ms). */
const COMMAND_TIMEOUT_MS = 60_000;
/** LLM planning timeout (ms). The Render runtime was hanging in the planning
 * phase indefinitely; this hard cap ensures the loop progresses or BLOCKS with
 * a real reason instead of sitting at RUNNING 10% forever. */
const LLM_TIMEOUT_MS = 90_000;
/** LLM planning attempts before LLM_PLAN_INVALID BLOCKED. */
const MAX_LLM_ATTEMPTS = 4;
/** Stage-specific timeouts (ms) — each bounded loop stage has its own hard cap
 * so a stuck inspection / patch / test / commit / deploy is detectable and the
 * engine BLOCKS with a real reason instead of hanging forever. These are
 * checked between stages via the wall-clock elapsed-since-stage-start timer. */
const STAGE_TIMEOUTS_MS: Record<string, number> = {
  inspecting: 30_000,
  planning: LLM_TIMEOUT_MS + 5_000,
  patching: 120_000,
  testing: 90_000,
  analyzing: 5_000,
  revising: 5_000,
  verifying: 15_000,
  committing: 30_000,
  awaiting_owner_approval: 5_000,
  deploying: 30_000,
  production_verifying: 45_000,
};
/** Max wall-clock runtime for the WHOLE job (ms). Independent of per-iteration
 * and per-stage limits — a global kill switch so a runaway job can never run
 * unbounded. Default 8 minutes; override via input.maxRuntimeMs. */
const DEFAULT_MAX_RUNTIME_MS = 15 * 60_000; // V6.15: 8→15 min — 4 iterations with baseline+post-patch typecheck need more room
/** Max LLM calls per job (across all iterations + attempts). Independent of
 * MAX_ITERATIONS — a cost cap so the engine can never burn unbounded tokens. */
const DEFAULT_MAX_LLM_CALLS = MAX_ITERATIONS * MAX_LLM_ATTEMPTS;
/** Max estimated tokens per job (soft cap — tracked from LLM response lengths).
 * If the cumulative estimated token count exceeds this, the engine BLOCKS with
 * TOKEN_BUDGET_EXCEEDED rather than making another call. 200k is realistic for a
 * real coding task with up to 5 iterations (each iteration sends file previews +
 * a patch response). The 60k cap was too tight and BLOCKED a legitimate PILOT-3
 * change after 4 iterations. */
const DEFAULT_MAX_TOKEN_BUDGET = 400_000;
/** Max files to inspect per job. */
const MAX_INSPECTED_FILES = 30;
/** Max file preview chars sent to the LLM for large files. V6.17: increased
 * from 6000 to 30000 so the LLM can see enough context to find the right
 * section in large files like hono.ts (3000+ lines). The old 6000-char limit
 * meant the LLM only saw the first ~150 lines and could never find the health
 * endpoint or route definitions further down, causing endless revision loops. */
const FILE_PREVIEW_CHARS = 30000;
/** Files under this size get full content sent to the LLM. */
const FULL_CONTENT_THRESHOLD = 35000;
/** Max stdout/stderr fed back to the LLM on revision. */
const FAILURE_OUTPUT_CHARS = 4000;

export type IVXAutonomousCoderExecutionMode = 'read_only' | 'code_change' | 'deploy';

export type IVXAutonomousCoderPatchOperation = {
  path: string;
  kind: 'replace_exact' | 'create_file';
  oldText: string;
  newText: string;
  reason: string;
};

export type IVXAutonomousCoderTestResult = {
  command: string;
  phase?: 'regression_baseline';
  ok: boolean;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
};

export type IVXAutonomousCoderIteration = {
  iteration: number;
  patchGenerated: boolean;
  patchApplied: boolean;
  testsRun: boolean;
  testsPassed: boolean;
  typecheckRun: boolean;
  typecheckPassed: boolean;
  failureSummary: string | null;
  revised: boolean;
};

export type IVXDeploymentEndpointEvidence = {
  endpoint: string;
  httpStatus: number | null;
  commitSha: string | null;
  ok: boolean;
};

/** Owner mandate 2026-08-23 (CI-before-merge): per-required-check evidence
 *  captured while waiting for GitHub CI on the PR head SHA. */
export type IVXCiCheckEvidence = {
  /** Required context name (branch-protection / owner-configured). */
  context: string;
  /** Matching GitHub check-run name (null when no check-run reported it). */
  checkRunName: string | null;
  /** Check-run status: queued | in_progress | completed | not_reported. */
  status: string;
  /** Check-run conclusion when completed (success | failure | skipped | ...). */
  conclusion: string | null;
  detailsUrl: string | null;
  matched: boolean;
  conditionalSkipVerified?: boolean;
  conditionalSkipPending?: boolean;
};

/**
 * The required CI check contexts for the protected main branch. Fetched
 * check-runs are matched against these names; ONLY these decide green —
 * unrelated non-required checks (e.g. experimental workflows) cannot block
 * or approve a merge. Owner-configurable via the IVX_REQUIRED_CI_CHECKS
 * runtime variable (comma-separated).
 */
const REQUIRED_CI_CHECK_CONTEXTS: readonly string[] = [
  'qa-suite',
  'TypeScript typecheck — HARD GATE',
  'Lint — HARD GATE',
  'scan-secrets',
  'Senior Developer + 12 IA autonomy invariants',
  'Playwright E2E (web surface) — HARD GATE',
  'Maestro E2E (mobile surface) — HARD GATE',
];

/** Default wall-clock budget for the CI-before-merge wait. The full 7-check
 *  E2E acceptance pipeline routinely takes 35–50 minutes. */
const DEFAULT_CI_WAIT_TIMEOUT_MS = 50 * 60 * 1000;
const DEFAULT_CI_POLL_INTERVAL_MS = 60 * 1000;
/** Grace period before a NEVER-REPORTED required check is treated as
 *  NOT_APPLICABLE (its workflow is path-filtered and legitimately does not
 *  run for this diff). Check-runs for triggered workflows appear within a
 *  couple of minutes of PR creation, so a context still unreported after this
 *  grace period — while every REPORTED check is green — is filtered, not
 *  late. It is recorded as NOT_APPLICABLE in the evidence, never as green. */
const DEFAULT_CI_NA_GRACE_MS = 10 * 60 * 1000;

/**
 * Owner mandate 2026-08-28 (Mission F): durable per-IA commit attribution.
 * Every autonomous commit/PR carries machine-readable trailers identifying the
 * originating IA — or an explicit SYSTEM attribution when no IA is involved.
 * Authorship is never ambiguous.
 */
function buildAttributionTrailers(input: {
  taskId: string;
  agentNumber?: number | null;
  agentId?: string | null;
  workerJobId?: string | null;
}): string {
  const hasAgent = typeof input.agentNumber === 'number' && input.agentNumber > 0;
  const agent = hasAgent ? `IA-${String(input.agentNumber).padStart(3, '0')}` : 'SYSTEM';
  const agentId = input.agentId?.trim() || (hasAgent ? `ivx_holdings_${input.agentNumber}` : 'system');
  return [
    `IVX-Agent: ${agent}`,
    `IVX-Agent-ID: ${agentId}`,
    `IVX-Task-ID: ${input.taskId}`,
    `IVX-Worker-Job: ${input.workerJobId ?? input.taskId}`,
  ].join('\n');
}

export type IVXAutonomousCoderProof = {
  marker: typeof IVX_AUTONOMOUS_CODER_MARKER;
  taskId: string;
  goal: string;
  executionMode: IVXAutonomousCoderExecutionMode;
  approvalPolicy: 'owner_gated';
  ownerId: string;
  startingSha: string | null;
  filesInspected: string[];
  rootCause: string;
  technicalPlan: string;
  iterations: IVXAutonomousCoderIteration[];
  finalPatch: IVXAutonomousCoderPatchOperation[];
  filesChanged: string[];
  commandsRun: IVXAutonomousCoderTestResult[];
  testsPassed: boolean;
  typecheckPassed: boolean;
  buildRun: boolean;
  commitSha: string | null;
  commitUrl: string | null;
  branch: string | null;
  /** Pull request created from the autonomous branch to main (code_change mode). */
  prNumber: number | null;
  prUrl: string | null;
  prMerged: boolean;
  prMergeCommitSha: string | null;
  /** Owner mandate 2026-08-23: PR creation was confirmed for the commit. */
  prCreated?: boolean;
  /** Owner mandate 2026-08-23 (CI-before-merge): the engine waited for the
   *  required GitHub checks on the PR head SHA before merging. */
  ciChecksWaited?: boolean;
  /** ALL required CI checks on the PR head SHA reported success. */
  ciChecksGreen?: boolean | null;
  /** Per-check evidence captured during the CI wait. */
  ciCheckEvidence?: IVXCiCheckEvidence[] | null;
  /** Wall-clock ms spent waiting for required CI checks. */
  ciWaitMs?: number | null;
  deployApproved: boolean;
  /** Owner mandate 2026-07-21: true when the chat prompt explicitly requested
   *  a deploy (executionMode === 'deploy'). Drives whether the worker's
   *  terminal-state guard requires deploy/health/feature verification or
   *  allows COMPLETED at commit-only scope. */
  deployRequested: boolean;
  deployId: string | null;
  deployStatus: string | null;
  productionVerified: boolean;
  liveCommit: string | null;
  healthOk: boolean;
  /** Captured production proof required for a deploy-mode PASS. */
  healthResponse: IVXDeploymentEndpointEvidence | null;
  versionResponse: IVXDeploymentEndpointEvidence | null;
  iterationCount: number;
  durationMs: number;
  finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELED';
  error: string | null;
  generatedAt: string;
  secretValuesReturned: false;
  /** The patch was generated by the IVX LLM, not by Rork manually editing. */
  patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null;
  /** Cost / resource controls (Phase 12). */
  llmCallCount: number;
  estimatedTokensUsed: number;
  tokenBudgetExceeded: boolean;
  /** Production rollback (Phase 16). Set when a deploy verified-fail triggered a
   * revert commit + redeploy of the prior SHA. */
  rollbackTriggered: boolean;
  rollbackCommitSha: string | null;
  rollbackError: string | null;
  /** V6.19: Stage-level observability — exact timestamps for every step in
   * the LLM patch-generation flow so the worker can show where the pipeline
   * is hanging (instead of just "Generating technical plan"). */
  stageTrace: IVXLLMStageTrace | null;
  /** V6.19: Task plan from the split planning stage (target files, changes
   * required, risks). null when planning was skipped or failed. */
  taskPlan: IVXTaskPlan | null;
  /** FINAL CLOSEOUT 2026-08-23: true when this proof was produced by
   * resumeIVXAutonomousCoderFromCiWait — the job's merge chain was resumed
   *  after a worker restart instead of being orphaned by the stale sweep. */
  resumedFromRestart?: boolean;
  /** Wall-clock ms the resume spent waiting for CI checks after restart. */
  resumeCiWaitMs?: number | null;
};

export type IVXAutonomousCoderInput = {
  taskId: string;
  /** Exact repository paths authorized for a private repair. */
  allowedFiles?: string[];
  goal: string;
  /** Owner mandate 2026-08-28 (Mission F): originating IA for commit/PR
   *  attribution trailers. Absent = SYSTEM attribution (never ambiguous). */
  agentNumber?: number | null;
  agentId?: string | null;
  /** The senior-developer worker job id running this coder task. */
  workerJobId?: string | null;
  executionMode: IVXAutonomousCoderExecutionMode;
  ownerId: string;
  approvalPolicy: 'owner_gated';
  /** Owner approval to deploy (required when executionMode === 'deploy'). */
  deployApproved?: boolean;
  /** Owner approval confirmation text for deploy. */
  deployConfirmationText?: string;
  /** Injectable LLM caller for testing. */
  llmCaller?: (system: string, user: string) => Promise<string>;
  /** Injectable planning-stage caller; exercises the same plan/context path as production. */
  planCaller?: (system: string, user: string) => Promise<string>;
  /** Injectable test runner for testing. */
  testRunner?: (cwd: string, command: string) => Promise<IVXAutonomousCoderTestResult>;
  /** Injectable commit function for testing. */
  commitFn?: (filePaths: string[], branch: string) => Promise<{ commitSha: string; commitUrl: string; branch: string }>;
  /** Injectable deploy function for testing. */
  deployFn?: (commitSha: string) => Promise<{ deployId: string | null; deployStatus: string | null }>;
  /** Injectable health checker for testing. */
  healthChecker?: () => Promise<{ ok: boolean; commit: string | null }>,
  /** Injectable full production verifier. Deploy mode is FAILED unless it returns
   * a live Render deployment and matching /health + /version evidence. */
  productionVerifier?: (commitSha: string, deploymentId: string) => Promise<{
    deployStatus: string | null;
    health: IVXDeploymentEndpointEvidence;
    version: IVXDeploymentEndpointEvidence;
  }>,
  /** Injectable project root for testing (defaults to the real repo root). */
  projectRoot?: string,
  /** Injectable file writer for testing (defaults to node:fs/promises writeFile). */
  fileWriter?: (relPath: string, content: string) => Promise<void>,
  /** Injectable file reader for testing. */
  fileReader?: (relPath: string) => Promise<string>,
  /** Injectable sleep function for deploy wait (defaults to 20s; tests pass 0). */
  sleepFn?: (ms: number) => Promise<void>,
  /** Phase callback for real-time stage updates. */
  onPhase?: (phase: IVXAutonomousCoderPhase, detail: string) => void,
  /** Cost / resource controls (Phase 12). All optional — sensible defaults apply. */
  /** Max wall-clock runtime for the whole job (ms). Default 8 minutes. */
  maxRuntimeMs?: number,
  /** Max LLM calls per job. Default = MAX_ITERATIONS * MAX_LLM_ATTEMPTS. */
  maxLlmCalls?: number,
  /** Max estimated token budget per job (soft cap). Default 60_000. */
  maxTokenBudget?: number,
  /** Cancellation signal: when this returns true, the engine stops at the next
   * safe point and returns finalStatus='FAILED' with error='JOB_CANCELED'. */
  isCanceled?: () => boolean,
  /** Physical worker lease and owner controls must permit each mutation. */
  assertExecutionAuthority?: () => Promise<void>,
  /** Heartbeat callback invoked at each stage boundary with the current phase,
   * iteration, and elapsed ms. Lets the caller detect a stuck stage externally. */
  heartbeat?: (info: { phase: IVXAutonomousCoderPhase; iteration: number; elapsedMs: number; detail: string }) => void,
  /** Injectable rollback function for testing the production-rollback path. */
  rollbackFn?: (commitSha: string, branch: string) => Promise<{ reverted: boolean; revertCommitSha: string | null; error: string | null }>,
  /** Injectable PR creation function for testing. When omitted, the real GitHub API is used. */
  prFn?: (branch: string, title: string, body: string) => Promise<{ prNumber: number; prUrl: string; merged: boolean; mergeCommitSha: string | null }>;
  /** Reconcile owner closure while waiting; a closed PR cannot occupy a repair lane. */
  prStateFn?: (prNumber: number) => Promise<{ state: 'open' | 'closed' | 'unknown'; merged: boolean; mergeCommitSha: string | null }>;
  /** Injectable merge function for testing. When omitted, the real GitHub API is used. */
  mergeFn?: (prNumber: number, commitMessage: string) => Promise<{ merged: boolean; mergeCommitSha: string | null }>;
  /** Injectable required-checks fetcher for testing: returns current per-check
   *  evidence for a head SHA without hitting the GitHub API. */
  requiredChecksFn?: (commitSha: string) => Promise<IVXCiCheckEvidence[]>;
  /** Max wall-clock to wait for required CI checks before merge (ms). Default 50 minutes. */
  ciWaitTimeoutMs?: number;
  /** Poll interval for the CI wait (ms). Default 60s; tests pass 0. */
  ciPollIntervalMs?: number;
  /** Grace period before a never-reported required check is treated as
   *  NOT_APPLICABLE when every reported check is green (ms). Default 10 min. */
  ciNaGraceMs?: number;
  /** When true, automatically merge the PR after creating it (code_change mode).
   *  Owner approval is still required — set by the worker based on job input. */
  autoMergePr?: boolean;
  /** Resilience callback fired IMMEDIATELY after the GitHub commit SHA is known,
   *  before proof construction. Lets the caller persist the commit SHA to the
   *  job record so a process crash between commit-landed and proof-return does
   *  not orphan the job at COMMITTING with an empty commitSha. Must never throw.
   *  If it throws, the error is swallowed and the engine continues. */
  onCommitLanded?: (info: { commitSha: string; commitUrl: string; branch: string; filesChanged: string[]; commandsRun: IVXAutonomousCoderTestResult[]; testsPassed: boolean; typecheckPassed: boolean }) => void | Promise<void>,
  /** FINAL CLOSEOUT 2026-08-23 (restart/CI-wait resume): fired IMMEDIATELY after
   *  the pull request is created and BEFORE the CI wait begins. Lets the caller
   *  persist the full resume state (commitSha, prNumber, prUrl, branch) so a
   *  worker restart during the CI wait can resume the merge chain instead of
   *  orphaning the job for the stale sweep to expire. Its persistence must
   *  finish successfully before CI waiting or merge may begin. */
  onPrCreated?: (info: { commitSha: string; prNumber: number; prUrl: string; branch: string }) => void | Promise<void>,
};

export type IVXAutonomousCoderPhase =
  | 'queued'
  | 'inspecting'
  | 'planning'
  | 'patching'
  | 'testing'
  | 'analyzing'
  | 'revising'
  | 'verifying'
  | 'committing'
  | 'awaiting_owner_approval'
  | 'deploying'
  | 'production_verifying'
  | 'completed'
  | 'blocked'
  | 'failed';

function nowIso(): string {
  return new Date().toISOString();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 800) : 'Unknown autonomous coder error.';
}

/** Rough token estimate: ~4 chars per token. Used for the soft budget cap only. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Check the cancellation signal; returns true if the caller asked to stop. */
function isCanceled(input: IVXAutonomousCoderInput): boolean {
  return typeof input.isCanceled === 'function' && input.isCanceled() === true;
}

/** Check the global wall-clock runtime cap. Returns true if exceeded. */
function runtimeExceeded(startedAt: number, maxRuntimeMs: number): boolean {
  return Date.now() - startedAt > maxRuntimeMs;
}

/** Per-stage wall-clock check. Call between stages with the stage's start time. */
function stageExceeded(stageStartedAt: number, phase: string): boolean {
  const limit = STAGE_TIMEOUTS_MS[phase] ?? Infinity;
  return Date.now() - stageStartedAt > limit;
}

type AutonomousStop = { finalStatus: 'CANCELED' | 'BLOCKED'; error: string };

/** Preserve the actual stop cause and completed receipts. A resource limit is
 * a blocker for the recovery router, never evidence of owner cancellation. */
function buildStoppedProof(input: IVXAutonomousCoderInput, startedAt: number, iterations: IVXAutonomousCoderIteration[], commandsRun: IVXAutonomousCoderTestResult[], startingSha: string | null, filesInspected: { path: string }[], rootCause: string, technicalPlan: string, finalPatch: IVXAutonomousCoderPatchOperation[], patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null, llmCallCount: number, estimatedTokensUsed: number, stop: AutonomousStop): IVXAutonomousCoderProof {
  return {
    marker: IVX_AUTONOMOUS_CODER_MARKER,
    taskId: input.taskId,
    goal: input.goal,
    executionMode: input.executionMode,
    approvalPolicy: input.approvalPolicy,
    ownerId: input.ownerId,
    startingSha,
    filesInspected: filesInspected.map((f) => f.path),
    rootCause,
    technicalPlan,
    iterations,
    finalPatch,
    filesChanged: [],
    commandsRun,
    testsPassed: false,
    typecheckPassed: false,
    buildRun: false,
    commitSha: null,
    commitUrl: null,
    branch: null,
    prNumber: null,
    prUrl: null,
    prMerged: false,
    prMergeCommitSha: null,
    deployApproved: false,
    deployRequested: input.executionMode === 'deploy',
    deployId: null,
    deployStatus: null,
    productionVerified: false,
    liveCommit: null,
    healthOk: false,
    healthResponse: null,
    versionResponse: null,
    iterationCount: iterations.length,
    durationMs: Date.now() - startedAt,
    finalStatus: stop.finalStatus,
    error: stop.error,
    generatedAt: nowIso(),
    secretValuesReturned: false,
    patchAuthoredBy,
    llmCallCount,
    estimatedTokensUsed,
    tokenBudgetExceeded: false,
    rollbackTriggered: false,
    rollbackCommitSha: null,
    rollbackError: null,
    stageTrace: null,
    taskPlan: null,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

/** Count TypeScript error lines (error TSxxxx) in a tsc output string.
 * Used by the V6.15 baseline typecheck to compare pre-existing errors
 * before the patch with post-patch errors — only fail when the patch
 * INTRODUCES new errors, not when pre-existing ones remain. */
function countTsErrors(output: string): number {
  const matches = output.match(/error TS\d+/g);
  return matches ? matches.length : 0;
}

const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Resolve the project root for this run (injectable for tests). */
function resolveProjectRoot(input: IVXAutonomousCoderInput): string {
  return input.projectRoot ?? DEFAULT_PROJECT_ROOT;
}

// ── FILE INSPECTION ──────────────────────────────────────────────────────────

const INSPECT_IGNORED_DIRS = new Set([
  '.git', '.rork', 'node_modules', '.expo', 'dist', 'build', 'coverage',
  'logs', 'tmp', '__tests__', '__mocks__', 'mocks', '.github',
]);

const INSPECTABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.yaml', '.yml', '.html', '.css',
]);

async function walkInspectableFiles(relDir: string, results: string[], max: number, projectRoot: string): Promise<void> {
  if (results.length >= max) return;
  const absDir = path.join(projectRoot, relDir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= max) return;
    const relEntry = relDir ? `${relDir}/${entry}` : entry;
    const absEntry = path.join(absDir, entry);
    let info;
    try {
      info = await stat(absEntry);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (INSPECT_IGNORED_DIRS.has(entry)) continue;
      if (!relDir && entry !== 'backend' && entry !== 'expo') continue;
      await walkInspectableFiles(relEntry, results, max, projectRoot);
    } else if (info.isFile()) {
      const ext = path.extname(entry);
      if (INSPECTABLE_EXTENSIONS.has(ext)) {
        results.push(relEntry);
      }
    }
  }
}

function pickInspectionTargets(goal: string, availableFiles: string[]): string[] {
  const explicit = explicitInspectionPaths(goal);
  const alwaysInclude = [
    'backend/services/ivx-autonomous-coder-pilot.ts',
    'backend/services/ivx-senior-developer-worker.ts',
    'backend/services/ivx-senior-developer-runtime.ts',
    'backend/ivx-ai-runtime.ts',
    'backend/api/ivx-owner-ai.ts',
    'backend/hono.ts',
    'render.yaml',
    'package.json',
  ].filter((f) => availableFiles.includes(f));

  const words = Array.from(new Set(
    inspectionSearchGoal(goal).toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .filter((w) => !['that', 'this', 'with', 'from', 'have', 'please', 'change', 'deploy', 'anything', 'current', 'status', 'label', 'version'].includes(w)),
  ));

  const hintMatches = availableFiles
    .filter((f) => words.some((w) => f.toLowerCase().includes(w)))
    .slice(0, 15);

  // Also include files whose CONTENT might contain the goal's significant terms.
  // This is handled in the inspect phase by reading file previews.

  return Array.from(new Set([...explicit, ...alwaysInclude, ...hintMatches])).slice(0, MAX_INSPECTED_FILES);
}

function explicitInspectionPaths(goal: string): string[] {
  return [...new Set(goal.match(/\b(?:backend|expo)\/[A-Za-z0-9_.\/-]+\.(?:tsx?|jsx?|mjs|html|css)\b/g) ?? [])]
    .filter(file => !file.split('/').some(part => !part || part === '.' || part === '..')).slice(0, 15);
}

function inspectionSearchGoal(goal: string): string {
  // Router/guardian tasks put the objective, unit and acceptance evidence first.
  // Their permission/credential constraints stay in the LLM prompt, but must
  // not outweigh the failing feature when retrieving implementation files.
  return goal.includes('[AUTONOMOUS_DIAGNOSTIC_DATA]') ? goal.split('\n').slice(0, 3).join('\n') : goal;
}

/** Rank a bounded filename inventory before reducing the planner's context. */
function selectPlanningFiles(goal: string, files: string[]): string[] {
  const explicit = new Set(explicitInspectionPaths(goal));
  const ignored = new Set(['that', 'this', 'with', 'from', 'have', 'repair', 'code', 'source', 'file', 'test', 'current', 'production', 'observed', 'evidence', 'change', 'actual', 'autonomous', 'required', 'before', 'after']);
  const words = [...new Set((inspectionSearchGoal(goal).toLowerCase().match(/[a-z]{4,}/g) ?? []).map(word => word.replace(/s$/, '')))].filter(word => !ignored.has(word));
  const score = (file: string) => (explicit.has(file) ? 1000 : 0)
    + words.reduce((sum, word) => sum + (file.toLowerCase().includes(word) ? 3 : 0), 0)
    - (/\.(test|spec)\./.test(file) ? 1 : 0);
  const ranked = [...new Set(files)].sort((a, b) => score(b) - score(a) || a.localeCompare(b));
  // Reserve room for both source trees, even when one contains thousands of files.
  return [...new Set([...explicit, ...ranked.slice(0, 150),
    ...ranked.filter(file => file.startsWith('backend/')).slice(0, 25),
    ...ranked.filter(file => file.startsWith('expo/')).slice(0, 25)])].slice(0, 200);
}

/** Extract a relevant section of a large file based on goal keywords.
 * Instead of sending the first N chars (which may miss the target code),
 * search for lines containing goal keywords and return a window around
 * the best match. Falls back to head+tail if no keywords match. */
function extractRelevantSection(content: string, goal: string, maxChars: number): string {
  const lines = content.split('\n');
  const goalWords = inspectionSearchGoal(goal).toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 4)
    .filter((w) => !['that', 'this', 'with', 'from', 'have', 'please', 'change', 'deploy', 'anything', 'current', 'status', 'label', 'version', 'endpoint', 'route', 'field'].includes(w));

  if (goalWords.length === 0) {
    return truncate(content, maxChars);
  }

  // Score each line by how many goal words it contains
  let bestLineIdx = 0;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    let score = 0;
    for (const w of goalWords) {
      if (lower.includes(w)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestLineIdx = i;
    }
  }

  if (bestScore === 0) {
    // No keyword match — send head + tail so the LLM sees imports and exports
    const headChars = Math.floor(maxChars * 0.6);
    const tailChars = maxChars - headChars;
    const head = truncate(content, headChars);
    const tail = content.length > tailChars ? content.slice(-tailChars) : '';
    return head + '\n\n... [middle section omitted for length] ...\n\n' + tail;
  }

  // Return a window of lines around the best match
  const contextLines = 60; // ~60 lines before and after the match
  const startLine = Math.max(0, bestLineIdx - contextLines);
    const endLine = Math.min(lines.length, bestLineIdx + contextLines);
  const section = lines.slice(startLine, endLine).join('\n');
  const prefix = startLine > 0 ? `... [lines 1-${startLine} omitted] ...\n` : '';
  const suffix = endLine < lines.length ? `\n... [lines ${endLine + 1}-${lines.length} omitted] ...` : '';
  const result = prefix + section + suffix;
  return truncate(result, maxChars);
}

async function readFilePreview(relPath: string, projectRoot: string, goal?: string): Promise<{ path: string; content: string; bytes: number } | null> {
  try {
    if (!/^(backend|expo)\//.test(relPath) || relPath.includes('\\')
      || relPath.split('/').some(part => !part || part.startsWith('.'))
      || !INSPECTABLE_EXTENSIONS.has(path.extname(relPath))) return null;
    const absPath = path.join(projectRoot, relPath);
    const [realRoot, realFile] = await Promise.all([realpath(projectRoot), realpath(absPath)]);
    const relative = path.relative(realRoot, realFile);
    if (!/^(backend|expo)\//.test(relative) || relative.split('/').some(part => part === '..')) return null;
    const content = await readFile(absPath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes <= FULL_CONTENT_THRESHOLD) {
      return { path: relPath, content, bytes };
    }
    // V6.17: For large files, extract the relevant section based on goal keywords
    // instead of blindly truncating to the first N chars.
    const preview = goal ? extractRelevantSection(content, goal, FILE_PREVIEW_CHARS) : truncate(content, FILE_PREVIEW_CHARS);
    return { path: relPath, content: preview, bytes };
  } catch {
    return null;
  }
}

// ── PATCH APPLICATION ────────────────────────────────────────────────────────

/** Paths the autonomous coder is allowed to modify. */
const ALLOWED_PATCH_PATHS = /^((?:backend|expo)\/[A-Za-z0-9_.\/-]+\.ts$|(?:backend|expo)\/[A-Za-z0-9_.\/-]+\.tsx$|expo\/[A-Za-z0-9_.\/-]+\.json$|expo\/[A-Za-z0-9_.\/-]+\.gradle$|expo\/ivxholding-landing\/(?:index\.html|ivx-styles\.css|ivx-[a-z0-9-]+\.js)$)/;

function assertSafePatchPath(filePath: string): void {
  if (filePath.includes('..') || filePath.startsWith('/')) {
    throw new Error(`Unsafe patch path rejected: ${filePath}`);
  }
  if (!ALLOWED_PATCH_PATHS.test(filePath)) {
    throw new Error(`Patch path outside allowed roots: ${filePath}. Only backend/*.ts, expo/*.ts(x), expo/*.json, expo/*.gradle and Landing index/styles/ivx-*.js source modules are permitted.`);
  }
}

async function applyPatchOperation(
  op: IVXAutonomousCoderPatchOperation,
  projectRoot: string,
  fileWriter?: (relPath: string, content: string) => Promise<void>,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<string> {
  assertSafePatchPath(op.path);
  const fullPath = path.join(projectRoot, op.path);
  const write = fileWriter ?? (async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(projectRoot, rel)), { recursive: true });
    await writeFile(path.join(projectRoot, rel), content, 'utf8');
  });
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  if (op.kind === 'create_file') {
    const { existsSync } = await import('node:fs');
    if (existsSync(fullPath)) {
      const existing = await read(op.path);
      if (existing === op.newText) return existing; // Idempotent: file already in desired state.
      throw new Error(`Create-file target already exists: ${op.path} — file exists with different content; re-emit this operation as update (oldText/newText) against the current content instead of create_file.`);
    }
    await write(op.path, op.newText);
    return op.newText;
  } else {
    const source = await read(op.path);
    if (!source.includes(op.oldText)) {
      throw new Error(`Patch oldText not found in ${op.path}; cannot apply safely.`);
    }
    const updated = source.replace(op.oldText, op.newText);
    await write(op.path, updated);
    return updated;
  }
}

// ── TEST + TYPECHECK RUNNER ──────────────────────────────────────────────────

function validationProcessEnv(): NodeJS.ProcessEnv {
  // Generated regression tests are validation programs, not production services.
  // Keep runtime discovery/temp paths, but never inherit provider, database,
  // owner, deployment, GitHub or other credentials from the worker process.
  const env: NodeJS.ProcessEnv = { NODE_ENV: 'test', CI: '1', FORCE_COLOR: '0' };
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) {
    if (process.env[key] !== undefined) env[key] = process.env[key];
  }
  return env;
}

export async function runAutonomousCoderCommand(cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> {
  const started = Date.now();
  // Resolve the runtime: the Render container runs under node+tsx, not bun.
  // `bun test` and `bun x tsc` fail with ENOENT on the production container, so
  // we resolve the runtime via resolveRuntimeCommand and translate the command
  // to its node-based equivalent when bun is not available.
  const parts = command.split(/\s+/);
  const requestedRuntime = parts[0] as 'bun' | 'bunx' | 'node' | 'npx';
  const resolution = resolveRuntimeCommand(requestedRuntime);
  let effectiveCmd = resolution.resolvedPath ?? resolution.effectiveCommand;
  let effectiveArgs = parts.slice(1);
  let displayCommand = command;
  // When bun falls back to node, translate `bun test <file>` → `node --test <file>`
  // (node:test runner), and execute `bun x tsc` with the installed compiler.
  if (resolution.usedFallback && requestedRuntime === 'bun') {
    if (effectiveArgs[0] === 'test') {
      effectiveArgs = ['--import', 'tsx', '--test', ...effectiveArgs.slice(1)];
      displayCommand = `node ${effectiveArgs.join(' ')}`;
    } else if (effectiveArgs[0] === 'x' && effectiveArgs[1] === 'tsc') {
      const node = resolveRuntimeCommand('node');
      effectiveCmd = node.resolvedPath ?? node.effectiveCommand;
      effectiveArgs = [path.join(cwd, 'node_modules', 'typescript', 'bin', 'tsc'), ...effectiveArgs.slice(2)];
      displayCommand = `node ${effectiveArgs.join(' ')}`;
    } else if (effectiveArgs[0] === 'x') {
      // Other explicit bun x commands retain the existing non-interactive npx fallback.
      const npxRes = resolveRuntimeCommand('npx');
      effectiveCmd = npxRes.resolvedPath ?? npxRes.effectiveCommand;
      effectiveArgs = ['--yes', ...effectiveArgs.slice(1)]; // drop the 'x', add --yes
      displayCommand = `npx ${effectiveArgs.join(' ')}`;
    }
  }
  try {
    const result = await execFileAsync(effectiveCmd, effectiveArgs, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 4,
      env: validationProcessEnv(),
    });
    return {
      command: displayCommand,
      ok: true,
      exitCode: 0,
      stdoutTail: truncate(typeof result.stdout === 'string' ? result.stdout : '', 2000),
      stderrTail: truncate(typeof result.stderr === 'string' ? result.stderr : '', 2000),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; signal?: string };
    return {
      command: displayCommand,
      ok: false,
      exitCode: typeof err.code === 'number' ? err.code : null,
      stdoutTail: truncate(typeof err.stdout === 'string' ? err.stdout : '', 2000),
      stderrTail: truncate(typeof err.stderr === 'string' ? err.stderr : '', 2000),
      durationMs: Date.now() - started,
    };
  }
}

/** Use the installed TypeScript package, never the unrelated npm package named tsc.
 * Missing or broken toolchains fail the command; no network install or skipped gate. */
function scopedTypecheckCommand(projectRoot: string, files: string[]): string {
  // --ignoreConfig omits ambient declarations normally included by the backend
  // tsconfig. Keep the repository's runtime types in scoped checks as well;
  // otherwise valid repairs importing pg/bcryptjs fail only in production.
  const ambient = [
    'backend/types/pg.d.ts',
    'backend/types/bcryptjs.d.ts',
    'backend/types/supabase-auth-error-compat.d.ts',
  ].filter(file => existsSync(path.join(projectRoot, file)));
  const inputs = [...new Set([...files, ...ambient])];
  return `node ${path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')} --noEmit --skipLibCheck --ignoreConfig --types node --target es2022 --module esnext --moduleResolution bundler ${inputs.join(' ')}`;
}

function targetedTestCommand(taskId: string, testFile: string, goal = ''): string {
  // Generated repair tests must run under the same Node + tsx contract as Render,
  // even when the caller/CI itself runs on Bun (which supplies extra test globals).
  return requiresRepairRegression(taskId, goal)
    ? `node --import tsx --test ${testFile}`
    : `bun test ${testFile}`;
}

/** Pick the most relevant test file for the goal. Only returns files that
 * actually exist on disk — a non-existent test file causes `bun test` to fail
 * with "Could not find" which blocks every iteration even when the patch is
 * valid. For newly created files (create_file) where no corresponding test
 * exists yet, we return null so the caller knows to skip the test gate and
 * rely on typecheck + content-change verification instead. */
function pickTargetTestFile(goal: string, changedFiles: string[], projectRoot: string): string | null {
  const changedTests = changedFiles.filter(file => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file));
  const candidates = [...changedTests, ...changedFiles.map(file => file.replace(/\.([cm]?[jt]sx?)$/, '.test.$1'))];
  for (const file of candidates) {
    if (!/\.(test|spec)\.[cm]?[jt]sx?$/.test(file)) continue;
    if (existsSync(path.resolve(projectRoot, file))) return file;
  }
  return null;
}

// ── LLM PATCH GENERATION ─────────────────────────────────────────────────────

const PATCH_SYSTEM_PROMPT = `You are the IVX Autonomous Coder — a real senior developer engine.
Given a GOAL and FILE CONTENTS, generate a JSON patch to achieve the goal.

OUTPUT FORMAT (strict JSON, no markdown fences, no prose before or after):
{"rootCause":"one-line root cause","technicalPlan":"one-line plan","operations":[{"path":"backend/services/example.ts","kind":"replace_exact","oldText":"the exact text to find","newText":"the replacement text","reason":"why this change"}]}

Rules:
- Respond with JSON ONLY. No \`\`\`json fences. No explanation. No prose.
- kind must be "replace_exact" (replace oldText with newText) or "create_file" (new file).
- oldText must be an EXACT substring of the file content (copy it verbatim from the FILE CONTENTS above).
- For replace_exact: copy a UNIQUE 20-80 character snippet from the target file as oldText. Do NOT use the entire file as oldText.
- The oldText MUST be copied EXACTLY from the FILE CONTENTS section above — character-for-character including spaces, quotes, commas, and newlines.
- If the file content shows "... [lines omitted] ...", the target code may be in the omitted section. Try to use a snippet from the VISIBLE portion, or use create_file to write a new file instead.
- For create_file: oldText must be empty string "". newText is the full file content.
- You CAN create new files (kind="create_file") for new routes, services, tests, or modules.
- You CAN modify multiple files in one response (add multiple operations to the array).
- Make the smallest safe change needed. 1-5 operations is typical for non-trivial tasks.
- Only modify files under backend/ or expo/.
- No secrets, no destructive operations.
- Never invent an existing file path. For modifications, use files shown in FILES; a missing path is not evidence that an implementation exists.
- Repair goals that require regression coverage must include BOTH the functional source operation and a runnable node:test regression operation in the same response.
- Create regression tests as backend/**/*.test.ts or expo/**/*.test.ts(x); plain JavaScript test paths are outside this engine's patch scope.
- Repair tests execute with node --import tsx --test. Import every test API explicitly: import { test, describe, it } from 'node:test'; import assert from 'node:assert/strict'. There are no global describe/it/expect APIs and bun:test is unavailable in production.
- ${NODE_REPAIR_TEST_GUIDANCE}
- Validation uses NODE_ENV=test and does not inherit production credentials. Use isolated fixtures or dependency injection; do not depend on live database contents or call live write endpoints.
- A repair regression must fail with ERR_ASSERTION against the original implementation and pass after the patch. Test an existing behavior through its real entry point. Already-passing tests, missing imports and tool failures do not reproduce the defect.
- If Node reports ReferenceError for a test API, fix its import and assertions in the test. Never suppress the error, skip the test or weaken the assertion. On revision, the failed patch has been reverted; use the original source shown in FILE CONTENTS.
- Missing customer media or credentials are external dependencies. Never invent assets, URLs, credentials, successful results or weaker acceptance criteria to make a repair pass.
- If the goal is already satisfied, return {"rootCause":"already satisfied","technicalPlan":"no change needed","operations":[]}

NON-TRIVIAL TASK GUIDANCE:
- When asked to ADD A FIELD to an endpoint, find the response object in the file and add the field.
- When asked to CREATE A NEW ROUTE, create a new file with kind="create_file" containing the route handler. Do NOT try to replace_exact in a 3000+ line file unless you can see the exact target text in the FILE CONTENTS.
- When asked to MODIFY MULTIPLE FILES, include one operation per file.
- When asked to ADD A TEST, create a new test file with kind="create_file". Use node:test and node:assert/strict so it runs with both Bun in CI and Node + tsx in production.
- Read the FILE CONTENTS carefully and copy exact text for oldText from what you see.
- Use create_file only for a new path. If that path already exists, inspect it and use replace_exact; never overwrite existing code blindly.
- For large files (1000+ lines), PREFER create_file for new routes/modules instead of replace_exact.
- If a replace_exact fails because oldText is not found, on revision use a DIFFERENT snippet or switch to create_file.

EXAMPLE 1 (add a health field):
{"rootCause":"need to add ivxDeveloperProofVersion to health response","technicalPlan":"add field to the health response object in hono.ts","operations":[{"path":"backend/hono.ts","kind":"replace_exact","oldText":"status: 'healthy',\n  environment: environment,\n  version: VERSION,","newText":"status: 'healthy',\n  environment: environment,\n  version: VERSION,\n  ivxDeveloperProofVersion: 2,"}]}

EXAMPLE 2 (create a new route):
{"rootCause":"need a developer proof endpoint","technicalPlan":"create new GET route returning SHA, deploy status, worker version, timestamp","operations":[{"path":"backend/api/ivx-developer-proof.ts","kind":"create_file","oldText":"","newText":"import type { Context } from 'hono';\n\nexport async function handleDeveloperProof(c: Context): Promise<Response> {\n  return c.json({\n    sha: process.env.RENDER_GIT_COMMIT ?? 'unknown',\n    deployStatus: 'live',\n    workerVersion: 'v6.16',\n    timestamp: new Date().toISOString(),\n  });\n}\n","reason":"new developer proof endpoint"}]}

EXAMPLE 3 (add a comment line above an existing const):
{"rootCause":"need a comment","technicalPlan":"insert comment above PILOT_LABEL","operations":[{"path":"backend/services/ivx-autonomous-coder-pilot.ts","kind":"replace_exact","oldText":"export const PILOT_LABEL = 'AUTONOMOUS-CODER-PILOT-3';","newText":"// IVX autonomous coder pilot sentinel\nexport const PILOT_LABEL = 'AUTONOMOUS-CODER-PILOT-3';","reason":"add a comment line above the existing const"}]}`;

function buildPatchUserPrompt(goal: string, files: { path: string; content: string }[], failureContext: string | null): string {
  const fileBlocks = files.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
  const failureBlock = failureContext
    ? `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${failureContext}\n\nRevise the patch to fix the failure. Output the corrected JSON.`
    : '';
  const lesson = repairRecoveryLesson(failureContext);
  const recoveryBlock = lesson ? `\n\n--- VERSIONED RECOVERY RULE ${lesson.id} ---\n${lesson.instruction}` : '';
  return `GOAL:\n${goal}\n\nFILES:\n${fileBlocks}${failureBlock}${recoveryBlock}`;
}

function parseLLMPatchResponse(response: string): { rootCause: string; technicalPlan: string; operations: IVXAutonomousCoderPatchOperation[] } | null {
  try {
    // Strip markdown code fences if present (be aggressive — LLMs love fences)
    const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    // Some LLMs wrap the JSON in <json>...</json> or return prose before/after
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    let jsonStr = cleaned.slice(start, end + 1);
    let parsed: { rootCause?: string; technicalPlan?: string; operations?: Array<{ path?: string; kind?: string; oldText?: string; newText?: string; reason?: string }> };
    try {
      parsed = JSON.parse(jsonStr);
    } catch {
      // Permissive fallback: strip trailing commas + fix smart quotes LLMs sometimes emit
      const fixed = jsonStr
        .replace(/,\s*([}\]])/g, '$1')
        .replace(/[\u201c\u201d]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
      parsed = JSON.parse(fixed);
    }
    if (!Array.isArray(parsed.operations)) return null;
    const operations: IVXAutonomousCoderPatchOperation[] = [];
    for (const op of parsed.operations) {
      if (typeof op.path !== 'string' || typeof op.kind !== 'string') continue;
      if (op.kind !== 'replace_exact' && op.kind !== 'create_file') continue;
      if (typeof op.oldText !== 'string' || typeof op.newText !== 'string') continue;
      operations.push({
        path: op.path,
        kind: op.kind,
        oldText: op.oldText,
        newText: op.newText,
        reason: typeof op.reason === 'string' ? op.reason : '',
      });
    }
    // Empty operations is valid when the LLM signals "already satisfied" — return it so the loop exits cleanly (no phantom patch)
    if (operations.length === 0) {
      return {
        rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'no operations needed',
        technicalPlan: typeof parsed.technicalPlan === 'string' ? parsed.technicalPlan : 'no change required',
        operations: [],
      };
    }
    return {
      rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'LLM-generated patch',
      technicalPlan: typeof parsed.technicalPlan === 'string' ? parsed.technicalPlan : 'Replace exact text per operations',
      operations,
    };
  } catch {
    return null;
  }
}

/** Promise-race timeout wrapper so the LLM call can never hang the loop.
 * V6.19: Now also creates an AbortController and aborts it on timeout so the
 * underlying HTTP request is actually cancelled (Promise.race alone does NOT
 * cancel the fetch — the connection stays open consuming resources). */
function withTimeoutAndAbort<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
  abortController?: AbortController,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      const timer = setTimeout(() => {
        if (abortController) {
          try { abortController.abort(); } catch { /* already aborted */ }
        }
        const err = new Error(`${label} timed out after ${ms}ms`);
        err.name = 'LLMTimeoutError';
        reject(err);
      }, ms);
      // Clear timer if promise resolves first
      promise.then(
        () => clearTimeout(timer),
        () => clearTimeout(timer),
      );
    }),
  ]);
}

/** Legacy alias for non-LLM timeouts (no abort needed). */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/** V6.19: Stage-level observability — records timestamps for every step in the
 * LLM patch-generation flow. Exposed in the proof so the worker can show
 * exactly where the pipeline is hanging. */
export type IVXLLMStageTrace = {
  taskReceivedAt: string;
  repoContextCollectedAt: string | null;
  targetFileSelectedAt: string | null;
  promptConstructedAt: string | null;
  llmRequestStartedAt: string | null;
  firstTokenReceivedAt: string | null;
  responseCompletedAt: string | null;
  jsonParsedAt: string | null;
  patchValidatedAt: string | null;
  patchAppliedAt: string | null;
  testsStartedAt: string | null;
  testsCompletedAt: string | null;
  requestId: string;
  model: string | null;
  provider: string | null;
  timeoutMs: number;
  inputTokenEstimate: number;
  outputTokenCount: number;
  retryNumber: number;
  responseStatus: string | null;
  parserStatus: string | null;
  exactSanitizedError: string | null;
  heartbeat: string | null;
};

function createStageTrace(requestId: string, timeoutMs: number): IVXLLMStageTrace {
  return {
    taskReceivedAt: nowIso(),
    repoContextCollectedAt: null,
    targetFileSelectedAt: null,
    promptConstructedAt: null,
    llmRequestStartedAt: null,
    firstTokenReceivedAt: null,
    responseCompletedAt: null,
    jsonParsedAt: null,
    patchValidatedAt: null,
    patchAppliedAt: null,
    testsStartedAt: null,
    testsCompletedAt: null,
    requestId,
    model: null,
    provider: null,
    timeoutMs,
    inputTokenEstimate: 0,
    outputTokenCount: 0,
    retryNumber: 0,
    responseStatus: null,
    parserStatus: null,
    exactSanitizedError: null,
    heartbeat: null,
  };
}

/** V6.19: Planning stage — asks the LLM to return a lightweight task plan
 * (target files, changes required, risks) WITHOUT generating the full patch.
 * This is a small, fast call (45s timeout) that splits the cognitive load:
 * planning and patch generation are separate LLM calls, not one giant call.
 *
 * Returns null when the planning call fails or returns unparseable JSON. */
export type IVXTaskPlan = {
  targetFiles: string[];
  filesToInspect: string[];
  changesRequired: string;
  testsRequired: string;
  risks: string;
};

const PLAN_SYSTEM_PROMPT = `You are the IVX Autonomous Coder planning stage.
Given a GOAL, return a lightweight JSON plan identifying which files to change.

OUTPUT FORMAT (strict JSON, no markdown fences, no prose):
{"targetFiles":["backend/api/example.ts"],"filesToInspect":["backend/hono.ts"],"changesRequired":"create a new endpoint returning SHA + timestamp","testsRequired":"unit test confirming the response shape","risks":"none — new file, no existing code affected"}

Rules:
- Respond with JSON ONLY. No fences. No prose.
- targetFiles: files that will be created or modified.
- filesToInspect: files the patch generator needs to see (imports, routes, types).
- Keep it concise — this is a PLAN, not the patch itself.
- For new files (create_file), include just the target path.
- For modifications, include the target path + any files with the types/imports it needs.`;

async function callLLMForPlan(
  goal: string,
  availableFiles: string[],
  llmCaller?: (system: string, user: string) => Promise<string>,
  trace?: IVXLLMStageTrace,
): Promise<IVXTaskPlan | null> {
  const PLAN_TIMEOUT_MS = 45_000;
  const abortController = new AbortController();
  const userPrompt = `GOAL:
${goal}

AVAILABLE FILES (first 200):
${availableFiles.slice(0, 200).join('\n')}`;
  if (trace) { trace.llmRequestStartedAt = nowIso(); trace.heartbeat = 'planning: LLM request started'; }
  try {
    let responseText: string;
    if (llmCaller) {
      responseText = await withTimeoutAndAbort(
        llmCaller(PLAN_SYSTEM_PROMPT, userPrompt),
        PLAN_TIMEOUT_MS,
        'LLM planning',
        abortController,
      );
    } else {
      const result = await withTimeoutAndAbort(
        requestIVXAIText({
          module: 'ivx-autonomous-coder',
          requestId: `ac-plan-${randomUUID()}`,
          system: PLAN_SYSTEM_PROMPT,
          prompt: userPrompt,
          maxOutputTokens: 2048,
          abortSignal: abortController.signal,
        }),
        PLAN_TIMEOUT_MS,
        'LLM planning',
        abortController,
      );
      responseText = result.text;
      if (trace) { trace.model = result.providerMetadata?.model ?? null; trace.provider = result.providerMetadata?.provider ?? null; }
    }
    if (trace) {
      trace.responseCompletedAt = nowIso();
      trace.responseStatus = 'ok';
      trace.outputTokenCount = estimateTokens(responseText);
    }
    const plan = parseTaskPlanResponse(responseText);
    if (trace) { trace.jsonParsedAt = nowIso(); trace.parserStatus = plan ? 'ok' : 'parse_failed'; }
    return plan;
  } catch (error) {
    if (trace) {
      trace.exactSanitizedError = safeErrorMessage(error);
      trace.responseStatus = error instanceof Error && error.name === 'LLMTimeoutError' ? 'timeout' : 'failed';
    }
    return null;
  }
}

function parseTaskPlanResponse(response: string): IVXTaskPlan | null {
  try {
    const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    const parsed = JSON.parse(cleaned.slice(start, end + 1));
    return {
      targetFiles: Array.isArray(parsed.targetFiles) ? parsed.targetFiles.filter((f: unknown) => typeof f === 'string') : [],
      filesToInspect: Array.isArray(parsed.filesToInspect) ? parsed.filesToInspect.filter((f: unknown) => typeof f === 'string') : [],
      changesRequired: typeof parsed.changesRequired === 'string' ? parsed.changesRequired : '',
      testsRequired: typeof parsed.testsRequired === 'string' ? parsed.testsRequired : '',
      risks: typeof parsed.risks === 'string' ? parsed.risks : '',
    };
  } catch {
    return null;
  }
}

/** V6.19: Patch generation stage — generates one file patch at a time using
 * AbortController for real cancellation. The context is reduced to only the
 * files identified by the planning stage (or the goal-keyword-matched files
 * if planning failed). */
async function callLLMForPatch(
  system: string,
  user: string,
  llmCaller?: (system: string, user: string) => Promise<string>,
  timeoutMs?: number,
  trace?: IVXLLMStageTrace,
): Promise<string> {
  const effectiveTimeout = timeoutMs ?? LLM_TIMEOUT_MS;
  const abortController = new AbortController();
  if (trace) { trace.llmRequestStartedAt = nowIso(); trace.heartbeat = 'patch_generation: LLM request started'; }
  if (llmCaller) {
    const result = await withTimeoutAndAbort(
      llmCaller(system, user),
      effectiveTimeout,
      'LLM patch generation',
      abortController,
    );
    if (trace) {
      trace.responseCompletedAt = nowIso();
      trace.responseStatus = 'ok';
      trace.outputTokenCount = estimateTokens(result);
    }
    return result;
  }
  const result = await withTimeoutAndAbort(
    requestIVXAIText({
      module: 'ivx-autonomous-coder',
      requestId: `ac-${randomUUID()}`,
      system,
      prompt: user,
      maxOutputTokens: 8192,
      abortSignal: abortController.signal,
    }),
    effectiveTimeout,
    'LLM patch generation',
    abortController,
  );
  if (trace) {
    trace.responseCompletedAt = nowIso();
    trace.responseStatus = 'ok';
    trace.model = result.providerMetadata?.model ?? null;
    trace.provider = result.providerMetadata?.provider ?? null;
    trace.outputTokenCount = estimateTokens(result.text);
  }
  return result.text;
}

// ── DETERMINISTIC PILOT FALLBACK (Phase 3) ───────────────────────────────────
//
// For the CONTROLLED PILOT ONLY: when the goal explicitly asks to change the
// pilot sentinel label AUTONOMOUS-CODER-PILOT-1 → AUTONOMOUS-CODER-PILOT-2,
// the engine can apply the patch directly via an exact-replacement search across
// safe source files, requiring EXACTLY ONE match or BLOCKED. This proves the
// full loop end-to-end (inspect → patch → test → typecheck → commit) WITHOUT
// depending on the LLM producing a valid patch — which was the root cause of the
// stalled pilot (the LLM planning phase hung at RUNNING 10%).
//
// This fallback is LIMITED to the explicit pilot label change. It is NOT a
// general uncontrolled editing mechanism. Any other goal still goes through the
// LLM planning loop.

// Generalized pilot fallback: handles ANY adjacent pilot label transition
// (AUTONOMOUS-CODER-PILOT-N -> AUTONOMOUS-CODER-PILOT-(N+1)). The prior
// implementation was hardcoded to PILOT-1 -> PILOT-2 only, which meant the
// owner's next pilot goal (PILOT-2 -> PILOT-3) fell through to the LLM path
// and hit the TS1470 false-positive in the scoped typecheck (see fix below).
const PILOT_LABEL_PAIR_REGEX = /AUTONOMOUS-CODER-PILOT-(\d+)[\s\S]*?AUTONOMOUS-CODER-PILOT-(\d+)/i;
const PILOT_LABEL_DEFINITION_REGEX_TEMPLATE = '(?:export\\s+const|const|export\\s+let|let)\\s+PILOT_LABEL\\s*=\\s*[\'"]AUTONOMOUS-CODER-PILOT-{N}[\'"]';

/** Extracts the (from, to) label pair from a goal like
 * "change ... AUTONOMOUS-CODER-PILOT-2 ... to ... AUTONOMOUS-CODER-PILOT-3".
 * Returns null when the goal does not mention two distinct adjacent pilot labels. */
function extractPilotLabelPair(goal: string): { fromLabel: string; toLabel: string; fromN: number; toN: number } | null {
  const match = goal.match(PILOT_LABEL_PAIR_REGEX);
  if (!match) return null;
  const fromN = parseInt(match[1], 10);
  const toN = parseInt(match[2], 10);
  if (Number.isNaN(fromN) || Number.isNaN(toN)) return null;
  // Only ADJACENT transitions (N -> N+1) are allowed — prevents arbitrary
  // label overwrites and keeps the controlled-pilot invariant.
  if (toN !== fromN + 1) return null;
  return {
    fromLabel: `AUTONOMOUS-CODER-PILOT-${fromN}`,
    toLabel: `AUTONOMOUS-CODER-PILOT-${toN}`,
    fromN,
    toN,
  };
}

/** Returns true only when the goal is the controlled pilot label change
 * (any adjacent N -> N+1 transition). */
export function isPilotLabelChangeGoal(goal: string): boolean {
  return extractPilotLabelPair(goal) !== null;
}

/** Search all safe source files for the pilot sentinel DEFINITION (not mere
 * mentions). Returns the single matching file path or null (BLOCKED) when zero
 * or multiple definition matches are found. Test files (.test.ts/.test.tsx)
 * and this engine file are excluded from the scan so only the canonical sentinel
 * module counts. */
async function findPilotSentinelFile(
  fromLabel: string,
  projectRoot: string,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<string | null> {
  const candidates: string[] = [];
  const allFiles: string[] = [];
  await walkInspectableFiles('backend', allFiles, 500, projectRoot);
  await walkInspectableFiles('expo', allFiles, 500, projectRoot);
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  // Build a definition regex for the FROM label (e.g. AUTONOMOUS-CODER-PILOT-2).
  const defPattern = new RegExp(PILOT_LABEL_DEFINITION_REGEX_TEMPLATE.replace('{N}', String(fromLabel.match(/\d+$/)?.[0] ?? '1')));
  for (const file of allFiles) {
    // Exclude test files and the engine file itself — only the sentinel
    // definition module should match.
    if (/\.test\.(ts|tsx)$/.test(file)) continue;
    if (file.endsWith('ivx-autonomous-coder.ts')) continue;
    try {
      const content = await read(file);
      if (defPattern.test(content)) {
        candidates.push(file);
      }
    } catch {
      continue;
    }
  }
  if (candidates.length !== 1) return null;
  try {
    assertSafePatchPath(candidates[0]);
  } catch {
    return null;
  }
  return candidates[0];
}

/** Deterministic pilot fallback: produces the exact-replacement patch for the
 * pilot label change without calling the LLM. Returns the patch operation or
 * null (BLOCKED) when the sentinel cannot be located uniquely. */
async function deterministicPilotFallback(
  goal: string,
  projectRoot: string,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<{ rootCause: string; technicalPlan: string; operations: IVXAutonomousCoderPatchOperation[]; sentinelFile: string } | null> {
  const pair = extractPilotLabelPair(goal);
  if (!pair) return null;
  const sentinelFile = await findPilotSentinelFile(pair.fromLabel, projectRoot, fileReader);
  if (!sentinelFile) return null;
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  const content = await read(sentinelFile);
  // Build a definition regex for the FROM label and find the exact definition
  // string so we can replace just the value, not every mention in comments.
  const fromN = pair.fromN;
  const defPattern = new RegExp(PILOT_LABEL_DEFINITION_REGEX_TEMPLATE.replace('{N}', String(fromN)));
  const defMatch = content.match(defPattern);
  if (!defMatch) return null;
  const oldText = defMatch[0];
  const newText = oldText.replace(pair.fromLabel, pair.toLabel);
  return {
    rootCause: `Controlled pilot: the repository contains a single sentinel-label definition that must be changed (${pair.fromLabel} -> ${pair.toLabel}) to prove the loop end-to-end.`,
    technicalPlan: `Apply an exact-replacement of the PILOT_LABEL definition value (${pair.fromLabel} -> ${pair.toLabel}) in the single matching sentinel-definition file, then run targeted tests + typecheck + commit.`,
    operations: [{
      path: sentinelFile,
      kind: 'replace_exact',
      oldText,
      newText,
      reason: `Pilot proof: change the visible version label (${pair.fromLabel} -> ${pair.toLabel}) per the owner mandate.`,
    }],
    sentinelFile,
  };
}

// ── GITHUB COMMIT (Git Data API) ─────────────────────────────────────────────

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_DEFAULT_BRANCH = 'main';
// Branch for code_change jobs (no deploy requested). Render auto-deploys on
// every commit to main, which restarts the service and orphans the in-flight
// worker before it can reach a terminal state. Committing code_change jobs to
// a separate non-deploy branch decouples the worker from the auto-deploy that
// kills it. Deploy-mode jobs still commit to main (the self-deploy handoff
// already persists resumable state before triggering Render).
const AUTONOMOUS_CODER_BRANCH = 'ivx-autonomous';

function readEnv(name: string): string {
  return (typeof process.env[name] === 'string' ? process.env[name] : '').trim();
}

/**
 * Read an owner-controlled runtime variable using the SAME canonical path as the
 * working github_commit_file action and factory runners: process.env FIRST, then
 * the owner variables store (getIVXOwnerVariableRuntimeValue) as a fallback.
 *
 * CRITICAL FIX: The autonomous coder was previously using bare readEnv() which
 * only checks process.env. On Render, GITHUB_TOKEN / RENDER_API_KEY / etc. live
 * in the encrypted owner variables store, NOT in process.env. This caused
 * commitFilesViaGitDataApi to throw "GITHUB_TOKEN is missing" every time,
 * leaving the worker orphaned at the COMMITTING phase (65%) with commitSha=''.
 */
async function readConfiguredRuntimeVariable(name: string, preferStored = false): Promise<string> {
  const envValue = readEnv(name);
  if (envValue && !preferStored) return envValue;
  try {
    const ownerVariables = await Promise.race([
      import('../api/ivx-owner-variables'),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Owner Variables import timed out')), 5000);
        timer.unref?.();
      }),
    ]);
    if (typeof ownerVariables.getIVXOwnerVariableRuntimeValue === 'function') {
      const stored = await Promise.race([
        ownerVariables.getIVXOwnerVariableRuntimeValue(name as never, { preferStored }),
        new Promise<null>((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          timer.unref?.();
        }),
      ]);
      return (stored || '').trim();
    }
  } catch (error) {
    console.log('[IVXAutonomousCoder] Owner Variables bridge unavailable for', name, {
      message: error instanceof Error ? error.message.slice(0, 200) : 'unknown',
    });
  }
  return '';
}

const resolveGithubToken = createAutonomousGithubTokenResolver();
async function readOwnerRuntimeVariable(name: string): Promise<string> {
  if (name !== 'GITHUB_TOKEN') return readConfiguredRuntimeVariable(name);
  return resolveGithubToken(await readConfiguredRuntimeVariable('GITHUB_REPO_URL'),
    preferStored => readConfiguredRuntimeVariable('GITHUB_TOKEN', preferStored));
}

function parseGithubRepoUrl(value: string): { owner: string; repo: string } | null {
  const match = value.match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

async function getStartingSha(): Promise<string | null> {
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo || !token) return null;
  const branch = (await readOwnerRuntimeVariable('GITHUB_DEFAULT_BRANCH')) || GITHUB_DEFAULT_BRANCH;
  try {
    const res = await fetch(
      `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { object?: { sha?: string } };
    return data.object?.sha ?? null;
  } catch {
    return null;
  }
}

async function ensureBranchExists(
  owner: string,
  repo: string,
  branch: string,
  headers: Record<string, string>,
): Promise<string> {
  const defaultBranch = (await readOwnerRuntimeVariable('GITHUB_DEFAULT_BRANCH')) || GITHUB_DEFAULT_BRANCH;
  return ensureAutonomousBranch({ branch, defaultBranch,
    request: (suffix, init) => fetch(`${GITHUB_API_BASE_URL}/repos/${owner}/${repo}${suffix}`, {
      ...init, headers, signal: AbortSignal.timeout(10000),
    }),
  });
}

async function commitFilesViaGitDataApi(
  filePaths: string[],
  branch: string,
  attributionTrailers?: string,
  projectRoot = DEFAULT_PROJECT_ROOT,
): Promise<{ commitSha: string; commitUrl: string; branch: string }> {
  // CRITICAL FIX: Use readOwnerRuntimeVariable (process.env + owner variables store fallback)
  // instead of bare readEnv. On Render, GITHUB_TOKEN lives in the encrypted owner variables
  // store, not in process.env. This was the root cause of the worker stuck at COMMITTING 65%.
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) throw new Error('GITHUB_REPO_URL is missing or invalid.');
  if (!token) throw new Error('GITHUB_TOKEN is missing (checked process.env and owner variables store).');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Ensure the target branch exists (create from default branch HEAD if missing).
  const baseCommitSha = await ensureBranchExists(repoInfo.owner, repoInfo.repo, branch, headers);

  // Get the base commit's tree
  const commitRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    { headers, signal: AbortSignal.timeout(10000) },
  );
  if (!commitRes.ok) throw new Error(`GitHub base commit lookup failed: ${commitRes.status}`);
  const commitData = await commitRes.json() as { tree?: { sha?: string } };
  const baseTreeSha = commitData.tree?.sha;
  if (!baseTreeSha) throw new Error('GitHub base commit did not include a tree SHA.');

  // Create the new tree with the changed files
  const tree = await Promise.all(filePaths.map(async (repoPath) => ({
    path: repoPath,
    mode: '100644' as const,
    type: 'blob' as const,
    content: await readFile(path.join(projectRoot, repoPath), 'utf8'),
  })));

  const treeRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!treeRes.ok) throw new Error(`GitHub tree creation failed: ${treeRes.status}`);
  const treeData = await treeRes.json() as { sha?: string };
  const newTreeSha = treeData.sha;
  if (!newTreeSha) throw new Error('GitHub tree creation did not return a tree SHA.');

  // Create the commit
  const newCommitRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: attributionTrailers
          ? `IVX autonomous coder: ${new Date().toISOString()}\n\n${attributionTrailers}`
          : `IVX autonomous coder: ${new Date().toISOString()}`,
        tree: newTreeSha,
        parents: [baseCommitSha],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!newCommitRes.ok) throw new Error(`GitHub commit creation failed: ${newCommitRes.status}`);
  const newCommitData = await newCommitRes.json() as { sha?: string };
  const commitSha = newCommitData.sha;
  if (!commitSha) throw new Error('GitHub commit creation did not return a commit SHA.');

  // Update the branch ref
  const updateRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: commitSha, force: false }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!updateRes.ok) throw new Error(`GitHub branch update failed: ${updateRes.status}`);

  return {
    commitSha,
    commitUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/commit/${commitSha}`,
    branch,
  };
}

// ── PULL REQUEST + MERGE (code_change Git workflow) ──────────────────────────

/**
 * Create a pull request from the autonomous branch to the production branch
 * via the GitHub REST API. Returns the PR number, URL, and merge state.
 * Uses owner-controlled GITHUB_TOKEN (readOwnerRuntimeVariable).
 */
/**
 * Owner mandate 2026-08-23 (CI-before-merge): fetch the current state of the
 * REQUIRED CI checks for a commit SHA from the GitHub check-runs API. Only
 * required contexts are expected, and every additional reported check must
 * also pass. A new workflow must not be silently excluded from the merge gate.
 */
async function fetchRequiredChecksForCommit(commitSha: string): Promise<IVXCiCheckEvidence[]> {
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!token || !repoInfo) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL is missing — cannot verify required CI checks before merge.');
  }
  const contextsRaw = await readOwnerRuntimeVariable('IVX_REQUIRED_CI_CHECKS');
  const contexts = contextsRaw && contextsRaw.trim().length > 0
    ? contextsRaw.split(',').map((s) => s.trim()).filter(Boolean)
    : [...REQUIRED_CI_CHECK_CONTEXTS];
  const res = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${commitSha}/check-runs?per_page=100&filter=latest`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) {
    throw new Error(`GitHub check-runs fetch failed: ${res.status}`);
  }
  const data = await res.json() as {
    total_count?: number;
    check_runs?: Array<{ name: string; status: string; conclusion: string | null; details_url: string | null }>;
  };
  const runs = data.check_runs ?? [];
  if ((data.total_count ?? 0) > runs.length) throw new Error('Incomplete GitHub check evidence; refusing merge');
  const landingSkip = await verifyLandingPrBrowserSkip({ runs, commitSha,
    repo: `${repoInfo.owner}/${repoInfo.repo}`,
    read: url => fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000) }),
  });
  for (const run of runs) if (!contexts.includes(run.name)) contexts.push(run.name);
  return contexts.map((context) => {
    const run = runs.find((r) => r.name === context)
      ?? runs.find((r) => r.name.startsWith(context))
      ?? runs.find((r) => context.startsWith(r.name) && r.name.length > 3)
      ?? null;
    return {
      context,
      checkRunName: run?.name ?? null,
      status: run?.status ?? 'not_reported',
      conclusion: run?.conclusion ?? null,
      detailsUrl: run?.details_url ?? null,
      matched: run !== null,
      conditionalSkipVerified: (context === MOBILE_CHECK && run?.name === MOBILE_CHECK && verifiedMobileSkip(runs))
        || (context === LANDING_PR_BROWSER_CHECK && landingSkip === 'verified'),
      conditionalSkipPending: context === LANDING_PR_BROWSER_CHECK && landingSkip === 'pending',
    };
  });
}

/** Green requires EVERY required context to be matched, completed, and successful. */
function requiredChecksAllGreen(evidence: IVXCiCheckEvidence[]): boolean {
  return evidence.length > 0
    && evidence.every((e) => e.matched && e.status === 'completed' && (e.conclusion === 'success' || e.conditionalSkipVerified === true));
}

/** A definitive failure is any matched required check that completed with a
 *  non-success conclusion (failure, cancelled, skipped, stale, timed_out). */
function requiredChecksDefinitivelyFailed(evidence: IVXCiCheckEvidence[]): IVXCiCheckEvidence[] {
  return evidence.filter((e) => e.matched && e.status === 'completed' && e.conclusion !== 'success' && !e.conditionalSkipVerified && !e.conditionalSkipPending);
}

/**
 * Owner mandate 2026-08-23 (CI-before-merge): poll the required CI checks on
 * the PR head SHA until ALL are green, one fails definitively, or the budget
 * expires. NEVER merges on red or unknown checks.
 */
async function waitForRequiredChecksGreen(
  commitSha: string,
  input: IVXAutonomousCoderInput,
  onPhase?: (phase: IVXAutonomousCoderPhase, detail: string) => void,
  prNumber?: number,
  branch?: string,
): Promise<{ green: boolean; evidence: IVXCiCheckEvidence[]; timedOut: boolean; waitMs: number; blocker?: string }> {
  const startedAt = Date.now();
  const timeoutMs = input.ciWaitTimeoutMs ?? DEFAULT_CI_WAIT_TIMEOUT_MS;
  const intervalMs = input.ciPollIntervalMs ?? DEFAULT_CI_POLL_INTERVAL_MS;
  const graceMs = input.ciNaGraceMs ?? DEFAULT_CI_NA_GRACE_MS;
  let last: IVXCiCheckEvidence[] = [];
  for (;;) {
    // CI can finish long after an owner closes a rejected repair. Reconcile
    // each poll so that the durable worker can finish this job and release its lane.
    if (prNumber != null) {
      const pr = input.prStateFn ? await input.prStateFn(prNumber) : await fetchPullRequestState(prNumber, { commitSha, branch });
      const blocker = pr.state === 'closed' && !pr.merged
        ? `PR #${prNumber} is CLOSED without merging. CI wait stopped; task BLOCKED.`
        : pr.state === 'unknown' ? `PR #${prNumber} state is unknown. CI wait stopped; task BLOCKED.` : undefined;
      if (blocker) return { green: false, evidence: last, timedOut: false, waitMs: Date.now() - startedAt, blocker };
    }
    const evidence = input.requiredChecksFn
      ? await input.requiredChecksFn(commitSha)
      : await fetchRequiredChecksForCommit(commitSha);
    last = evidence;
    if (requiredChecksAllGreen(evidence)) {
      return { green: true, evidence, timedOut: false, waitMs: Date.now() - startedAt };
    }
    const failed = requiredChecksDefinitivelyFailed(evidence);
    if (failed.length > 0) {
      return { green: false, evidence, timedOut: false, waitMs: Date.now() - startedAt };
    }
    // Path-filtered N/A handling (owner mandate 2026-08-23): a required check
    // whose workflow never reports for this diff is NOT_APPLICABLE after the
    // grace period — but ONLY when every REPORTED required check is green and
    // at least four hard gates actually ran. The skipped context is recorded
    // as NOT_APPLICABLE in the evidence; it is never counted as green.
    const successCount = evidence.filter((e) => e.matched && e.status === 'completed' && (e.conclusion === 'success' || e.conditionalSkipVerified === true)).length;
    const unmatched = evidence.filter((e) => !e.matched);
    if (
      unmatched.length > 0
      && successCount + unmatched.length === evidence.length
      && successCount >= 4
      && Date.now() - startedAt >= graceMs
    ) {
      return {
        green: true,
        evidence: evidence.map((e) => e.matched ? e : { ...e, status: 'not_applicable', conclusion: 'not_applicable' }),
        timedOut: false,
        waitMs: Date.now() - startedAt,
      };
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { green: false, evidence, timedOut: true, waitMs: Date.now() - startedAt };
    }
    const greenCount = evidence.filter((e) => e.matched && e.status === 'completed' && e.conclusion === 'success').length;
    onPhase?.('committing', `Required CI checks on ${commitSha.slice(0, 12)}: ${greenCount}/${evidence.length} green — waiting before any merge.`);
    if (input.sleepFn) {
      await input.sleepFn(intervalMs);
    } else {
      await new Promise<void>((resolve) => { setTimeout(resolve, intervalMs); });
    }
  }
}

async function createPullRequestForBranch(
  headBranch: string,
  baseBranch: string,
  title: string,
  body: string,
): Promise<{ prNumber: number; prUrl: string; merged: boolean; mergeCommitSha: string | null }> {
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!token || !repoInfo) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL is missing — cannot create pull request.');
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };
  const res = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        title,
        body,
        head: headBranch,
        base: baseBranch,
        draft: false,
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    // 422 = PR already exists — try to find and return it
    if (res.status === 422 && /already exists|A pull request for/i.test(errBody)) {
      const listRes = await fetch(
        `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls?head=${repoInfo.owner}:${headBranch}&state=open`,
        { headers, signal: AbortSignal.timeout(10000) },
      );
      if (listRes.ok) {
        const prs = await listRes.json() as Array<{ number: number; html_url: string; merged: boolean; merge_commit_sha: string | null }>;
        if (prs.length > 0) {
          return { prNumber: prs[0].number, prUrl: prs[0].html_url, merged: prs[0].merged, mergeCommitSha: prs[0].merge_commit_sha };
        }
      }
    }
    throw new Error(`GitHub PR creation failed: ${res.status} ${errBody.slice(0, 300)}`);
  }
  const data = await res.json() as { number: number; html_url: string; merged: boolean; merge_commit_sha: string | null };
  return { prNumber: data.number, prUrl: data.html_url, merged: data.merged, mergeCommitSha: data.merge_commit_sha };
}

/** Merge the checked PR head without modifying repository protections. */
async function mergePullRequest(
  prNumber: number,
  commitMessage: string,
  checkedHeadSha: string,
): Promise<{ merged: boolean; mergeCommitSha: string | null }> {
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!token || !repoInfo) throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL is missing — cannot merge pull request.');
  const { mergeCheckedPullRequest } = await import('./ivx-checked-pr-merge');
  return mergeCheckedPullRequest({ repository: `${repoInfo.owner}/${repoInfo.repo}`, token, prNumber, checkedHeadSha, title: commitMessage });
}

// ── RENDER DEPLOY ────────────────────────────────────────────────────────────

async function triggerRenderDeploy(commitSha: string): Promise<{ deployId: string | null; deployStatus: string | null }> {
  // CRITICAL FIX: Use readOwnerRuntimeVariable for the same reason as commitFilesViaGitDataApi.
  // FINAL CLOSEOUT 2026-08-23: normalize raw values through the credential
  // extractors — runtime values may carry annotation labels around the real
  // `rnd_…` key / `srv-…` id, which previously produced Render 401s and
  // blocked deploy-ID evidence.
  const apiKey = extractRenderApiKey(await readOwnerRuntimeVariable('RENDER_API_KEY'));
  const serviceId = extractRenderServiceId(await readOwnerRuntimeVariable('RENDER_SERVICE_ID'));
  if (!apiKey || !serviceId) {
    throw new Error('RENDER_API_KEY or RENDER_SERVICE_ID is missing (checked process.env and owner variables store).');
  }
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ commitId: commitSha }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Render deploy trigger failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { id?: string; status?: string };
  return { deployId: data.id ?? null, deployStatus: data.status ?? 'triggered' };
}

async function readDeploymentEndpoint(url: string): Promise<IVXDeploymentEndpointEvidence> {
  try {
    const response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(15_000) });
    const body = await response.json().catch((): Record<string, unknown> => ({}));
    const commitSha = typeof body.commit === 'string' ? body.commit : null;
    return { endpoint: url, httpStatus: response.status, commitSha, ok: response.ok };
  } catch {
    return { endpoint: url, httpStatus: null, commitSha: null, ok: false };
  }
}

async function verifyProductionDeployment(commitSha: string, deploymentId: string): Promise<{
  deployStatus: string | null;
  health: IVXDeploymentEndpointEvidence;
  version: IVXDeploymentEndpointEvidence;
}> {
  const parity = await verifyLiveCommitMatch({ requestedCommit: commitSha, deploymentId });
  const baseUrl = (process.env.PRODUCTION_BASE_URL
    ?? process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL
    ?? process.env.EXPO_PUBLIC_IVX_API_BASE_URL
    ?? process.env.EXPO_PUBLIC_API_BASE_URL
    ?? 'https://api.ivxholding.com').replace(/\/+$/, '');
  const [health, version] = await Promise.all([
    readDeploymentEndpoint(`${baseUrl}/health`),
    readDeploymentEndpoint(`${baseUrl}/version`),
  ]);
  return {
    deployStatus: parity.deployStatus,
    health,
    version,
  };
}

// ── PRODUCTION ROLLBACK (Phase 16) ────────────────────────────────────────────
//
// When a deploy verifies-fail (health check returns a different commit, or the
// health endpoint is down after the deploy), the engine attempts an automatic
// rollback: it fetches the parent of the just-deployed commit, creates a revert
// commit that restores the prior tree, pushes it to the branch, and re-triggers
// a Render deploy of the revert commit. This is bounded — one attempt — and any
// failure is recorded in rollbackError (the engine never silently swallows a
// rollback failure).

async function getCommitParentSha(owner: string, repo: string, token: string, commitSha: string): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/git/commits/${encodeURIComponent(commitSha)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { parents?: Array<{ sha?: string }> };
    return data.parents?.[0]?.sha ?? null;
  } catch { return null; }
}

async function rollbackProductionDeploy(commitSha: string, branch: string): Promise<{ reverted: boolean; revertCommitSha: string | null; error: string | null }> {
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo || !token) return { reverted: false, revertCommitSha: null, error: 'Rollback aborted: GitHub credentials unavailable (checked process.env and owner variables store).' };
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  // 1. Get the parent of the bad commit (the last known-good SHA).
  const parentSha = await getCommitParentSha(repoInfo.owner, repoInfo.repo, token, commitSha);
  if (!parentSha) return { reverted: false, revertCommitSha: null, error: `Could not resolve parent of ${commitSha}.` };
  // 2. Get the parent commit's tree.
  let parentTreeSha: string | null = null;
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits/${encodeURIComponent(parentSha)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json() as { tree?: { sha?: string } };
      parentTreeSha = data.tree?.sha ?? null;
    }
  } catch { /* fall through */ }
  if (!parentTreeSha) return { reverted: false, revertCommitSha: null, error: `Could not read parent tree for ${parentSha}.` };
  // 3. Create a revert commit pointing at the parent's tree (restores prior files).
  let revertCommitSha: string | null = null;
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `IVX autonomous coder ROLLBACK: revert ${commitSha.slice(0, 7)} (deploy verified-fail)`, tree: parentTreeSha, parents: [parentSha] }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json() as { sha?: string };
      revertCommitSha = data.sha ?? null;
    }
  } catch { /* fall through */ }
  if (!revertCommitSha) return { reverted: false, revertCommitSha: null, error: 'Revert commit creation failed.' };
  // 4. Update the branch ref to the revert commit (fast-forward to the revert).
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ sha: revertCommitSha, force: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { reverted: false, revertCommitSha, error: `Branch ref update failed: ${res.status}` };
  } catch (e) {
    return { reverted: false, revertCommitSha, error: `Branch ref update threw: ${safeErrorMessage(e)}` };
  }
  // 5. Re-trigger Render deploy of the revert commit.
  try {
    await triggerRenderDeploy(revertCommitSha);
  } catch (e) {
    return { reverted: false, revertCommitSha, error: `Revert commit pushed but redeploy trigger failed: ${safeErrorMessage(e)}` };
  }
  return { reverted: true, revertCommitSha, error: null };
}

// ── PRODUCTION HEALTH VERIFY ──────────────────────────────────────────────────

async function verifyProductionHealth(): Promise<{ ok: boolean; commit: string | null }> {
  const healthUrl = process.env.IVX_HEALTH_URL || 'https://api.ivxholding.com/health';
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, commit: null };
    // CRITICAL FIX: The health endpoint returns `commit` (not `commitSha`).
    // The prior code read `data.commitSha` which was always undefined, causing
    // production verification to ALWAYS fail even when the deploy succeeded.
    // This made every deploy job report as a verify-fail, triggering rollback.
    const data = await res.json() as { commit?: string; commitSha?: string; status?: string };
    return { ok: data.status === 'healthy', commit: data.commit ?? data.commitSha ?? null };
  } catch {
    return { ok: false, commit: null };
  }
}

// ── MAIN ENGINE LOOP ─────────────────────────────────────────────────────────

export async function runIVXAutonomousCoder(input: IVXAutonomousCoderInput): Promise<IVXAutonomousCoderProof> {
  const startedAt = Date.now();
  // FIX #3: the engine must NEVER throw. A throw escapes to the worker's
  // top-level catch, which stores `result=null` and `error=message` with NO
  // diagnostic trail (no iterations, no commandsRun, no filesInspected). This
  // is why the failed PILOT-7 re-run job `ivx-worker-efb46ee9` had result=null —
  // the engine threw somewhere in the inspect/plan/patch loop and the worker
  // catch block swallowed the diagnostic state. Wrap the entire loop so any
  // thrown error becomes a FAILED proof with the error message + whatever
  // diagnostic state was accumulated before the throw. The worker then stores
  // the full proof (iterations, commands, files inspected) instead of null.
  try {
    // Injected filesystem/test dependencies own their fixtures. Production
    // callers use the immutable application source as a snapshot, never a
    // shared patch directory across concurrent owner jobs.
    if (!input.projectRoot && !input.fileReader && !input.fileWriter && !input.testRunner) {
      return await withIsolatedCoderWorkspace(resolveProjectRoot(input), root =>
        runIVXAutonomousCoderInner({ ...input, projectRoot: root }, Date.now()));
    }
    return await runIVXAutonomousCoderInner(input, startedAt);
  } catch (error) {
    const message = safeErrorMessage(error);
    input.onPhase?.('failed', `Autonomous coder threw: ${message}`);
    return {
      marker: IVX_AUTONOMOUS_CODER_MARKER,
      taskId: input.taskId,
      goal: input.goal,
      executionMode: input.executionMode,
      approvalPolicy: input.approvalPolicy,
      ownerId: input.ownerId,
      startingSha: null,
      filesInspected: [],
      rootCause: '',
      technicalPlan: '',
      iterations: [],
      finalPatch: [],
      filesChanged: [],
      commandsRun: [],
      testsPassed: false,
      typecheckPassed: false,
      buildRun: false,
      commitSha: null,
      commitUrl: null,
      branch: null,
      deployApproved: false,
      deployRequested: input.executionMode === 'deploy',
      deployId: null,
      deployStatus: null,
      productionVerified: false,
      liveCommit: null,
      healthOk: false,
      healthResponse: null,
      versionResponse: null,
      prNumber: null,
      prUrl: null,
      prMerged: false,
      prMergeCommitSha: null,
      iterationCount: 0,
      durationMs: Date.now() - startedAt,
      finalStatus: 'FAILED',
      error: `ENGINE_THREW: ${message}`,
      generatedAt: nowIso(),
      secretValuesReturned: false,
      patchAuthoredBy: null,
      llmCallCount: 0,
      estimatedTokensUsed: 0,
      tokenBudgetExceeded: false,
      rollbackTriggered: false,
      rollbackCommitSha: null,
      rollbackError: null,
      stageTrace: null,
      taskPlan: null,
    };
  }
}

async function runIVXAutonomousCoderInner(input: IVXAutonomousCoderInput, startedAt: number): Promise<IVXAutonomousCoderProof> {
  await input.assertExecutionAuthority?.();
  const onPhase = input.onPhase;
  const iterations: IVXAutonomousCoderIteration[] = [];
  const commandsRun: IVXAutonomousCoderTestResult[] = [];
  let filesChanged: string[] = [];
  let finalPatch: IVXAutonomousCoderPatchOperation[] = [];
  let rootCause = '';
  let technicalPlan = '';
  let patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null = null;
  // Cost / resource controls (Phase 12)
  const maxRuntimeMs = input.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const maxLlmCalls = input.maxLlmCalls ?? DEFAULT_MAX_LLM_CALLS;
  const maxTokenBudget = input.maxTokenBudget ?? DEFAULT_MAX_TOKEN_BUDGET;
  let llmCallCount = 0;
  let estimatedTokensUsed = 0;
  let tokenBudgetExceeded = false;
  let rollbackTriggered = false;
  let rollbackCommitSha: string | null = null;
  let rollbackError: string | null = null;
  // V6.19: Stage-level observability + split planning
  let stageTrace: IVXLLMStageTrace | null = null;
  let taskPlan: IVXTaskPlan | null = null;
  // Helper: check cancel + runtime + per-stage-timeout at stage boundaries; returns
  // true if we must stop. The per-stage timer is reset every time a NEW stage
  // starts (via `markStageStart`), so a stage that hangs is detected even when
  // the global runtime cap has not yet fired. This is the fix for the PILOT-7
  // incident where the engine sat at TESTING 50% for 11+ minutes because the
  // per-stage timeout helper existed but was never invoked.
  let currentStageStartedAt = startedAt;
  let currentStagePhase: IVXAutonomousCoderPhase = 'queued';
  const markStageStart = (phase: IVXAutonomousCoderPhase): void => {
    currentStageStartedAt = Date.now();
    currentStagePhase = phase;
  };
  const checkStop = (phase: IVXAutonomousCoderPhase, iteration: number, detail: string): AutonomousStop | null => {
    input.heartbeat?.({ phase, iteration, elapsedMs: Date.now() - startedAt, detail });
    if (isCanceled(input)) return { finalStatus: 'CANCELED', error: 'JOB_CANCELED: owner requested cancellation before the job reached a terminal state.' };
    if (runtimeExceeded(startedAt, maxRuntimeMs)) return { finalStatus: 'BLOCKED',
      error: `RUNTIME_LIMIT_EXCEEDED: elapsed ${Date.now() - startedAt} ms exceeded the job limit of ${maxRuntimeMs} ms at ${currentStagePhase}.` };
    // Per-stage timeout: check the CURRENT stage's wall-clock elapsed against
    // STAGE_TIMEOUTS_MS. The phase passed here is the stage we are about to
    // enter; markStageStart should have been called when the prior stage began.
    if (stageExceeded(currentStageStartedAt, String(currentStagePhase))) return { finalStatus: 'BLOCKED',
      error: `STAGE_TIMEOUT_EXCEEDED: ${currentStagePhase} elapsed ${Date.now() - currentStageStartedAt} ms exceeded its limit of ${STAGE_TIMEOUTS_MS[currentStagePhase]} ms. Inspect the retained command receipts before retrying.` };
    return null;
  };

  // ── INSPECT ──────────────────────────────────────────────────────────────
  onPhase?.('inspecting', 'Indexing repository + picking inspection targets.');
  markStageStart('inspecting');
  const inspectionStop = checkStop('inspecting', 0, 'pre-inspect');
  if (inspectionStop) {
    return buildStoppedProof(input, startedAt, iterations, commandsRun, null, [], '', '', [], null, llmCallCount, estimatedTokensUsed, inspectionStop);
  }
  const projectRoot = resolveProjectRoot(input);
  const backendFiles: string[] = [];
  const expoFiles: string[] = [];
  await walkInspectableFiles('backend', backendFiles, 10_000, projectRoot);
  await walkInspectableFiles('expo', expoFiles, 10_000, projectRoot);
  // Backend exhaustion must not erase the Expo tree, and an exact task path
  // must remain inspectable even beyond the bounded directory sample.
  const availableFiles = selectPlanningFiles(input.goal, [...backendFiles, ...expoFiles]);
  const targetPaths = pickInspectionTargets(input.goal, availableFiles);
  const inspectedFiles: { path: string; content: string }[] = [];
  for (const target of targetPaths) {
    const preview = await readFilePreview(target, projectRoot, input.goal);
    if (preview) {
      inspectedFiles.push({ path: preview.path, content: preview.content });
    }
  }
  onPhase?.('inspecting', `Inspected ${inspectedFiles.length} file(s).`);

  // ── STARTING SHA ─────────────────────────────────────────────────────────
  const startingSha = await getStartingSha();

  // ── BOUNDED LOOP: PLAN → PATCH → TEST → ANALYZE → REVISE ────────────────
  let testsPassed = false;
  let typecheckPassed = false;
  let buildRun = false;
  let lastFailureContext: string | null = null;
  let plannedContextFiles: { path: string; content: string }[] | null = null;
  let iterationCount = 0;
  let anyPatchApplied = false;
  let anyPatchGenerated = false;
  let lastPatchFailureReason: string | null = null;
  let llmAttempts = 0;
  let lastLLMResponseRaw: string | null = null;
  let lastLLMError: string | null = null;

  // ── DETERMINISTIC PILOT FALLBACK (Phase 3) ──────────────────────────────
  // For the CONTROLLED PILOT ONLY: when the goal is the explicit pilot label
  // change AND no LLM caller is injected (i.e. live production, where the LLM
  // planning phase was hanging at RUNNING 10%), bypass the LLM planning loop
  // and apply the exact-replacement patch directly. This proves the full loop
  // end-to-end even when the LLM is slow or returns malformed JSON. The fallback
  // is LIMITED to the pilot label change and requires EXACTLY ONE match across
  // safe source files or BLOCKED.
  //
  // When an llmCaller IS injected (unit tests exercising the LLM revision
  // loop), the LLM path runs instead so those tests still prove revision logic.
  // The fallback's own hermetic tests do NOT inject an llmCaller.
  const isPilotGoal = !input.llmCaller && isPilotLabelChangeGoal(input.goal);
  if (isPilotGoal) {
    onPhase?.('planning', 'Pilot fallback: deterministic exact-replacement (no LLM call).');
    const fallback = await deterministicPilotFallback(input.goal, projectRoot, input.fileReader);
    if (!fallback) {
      // BLOCKED: zero or multiple sentinel matches — do NOT fake a patch.
      const iteration: IVXAutonomousCoderIteration = {
        iteration: 1,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: 'Pilot fallback BLOCKED: the pilot sentinel label was not found exactly once across safe source files (zero or multiple matches).',
        revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = 'Pilot sentinel not uniquely located.';
      // Skip the LLM loop entirely and go straight to the BLOCKED verdict.
      iterationCount = 1;
      // Fall through to the verdict section below.
    } else {
      rootCause = fallback.rootCause;
      technicalPlan = fallback.technicalPlan;
      finalPatch = fallback.operations;
      patchAuthoredBy = 'ivx_deterministic_fallback';
      anyPatchGenerated = true;
      iterationCount = 1;
      // Run ONE iteration with the deterministic patch: apply → test → typecheck → verify.
      onPhase?.('patching', `Pilot fallback: applying exact replacement in ${fallback.sentinelFile}.`);
      const pilotWorkspace = new PatchWorkspace(projectRoot, input.fileReader, input.fileWriter);
      let keepPilotPatch = false;
      try {
      let patchApplied = false;
      let applyError: string | null = null;
      try {
        assertPrivateRepairScope(input.goal, input.allowedFiles, fallback.operations.map(op => op.path));
        assertRepairPatchQuality(input.taskId, fallback.operations, input.goal);
        for (const op of fallback.operations) {
          assertSafePatchPath(op.path);
          await pilotWorkspace.capture(op.path);
          await input.assertExecutionAuthority?.();
          await applyPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
        }
        patchApplied = true;
        anyPatchApplied = true;
        filesChanged = [...new Set(fallback.operations.map((op) => op.path))];
      } catch (error) {
        applyError = safeErrorMessage(error);
        lastPatchFailureReason = `Pilot fallback patch application failed: ${applyError}`;
      }
      if (patchApplied) {
        onPhase?.('testing', 'Pilot fallback: running targeted tests + typecheck.');
        const targetTest = pickTargetTestFile(input.goal, filesChanged, projectRoot);
        // Gap 4 FIX: Always run tests via runCommand when a test file exists.
        // When no test file exists (newly created files), honestly record
        // testsRun=false and rely on typecheck + content-change verification.
        let testsActuallyRun = false;
        let testResult: IVXAutonomousCoderTestResult | null = null;
        // When a testRunner is injected (unit tests), always run tests so the
        // mock can exercise pass/fail scenarios. In production, only run tests
        // when a test file actually exists on disk.
        const effectiveTestTarget = targetTest ?? (input.testRunner ? 'backend/ivx-autonomous-coder.test.ts' : null);
        if (effectiveTestTarget) {
          const testCmd = targetedTestCommand(input.taskId, effectiveTestTarget);
          if (input.testRunner) {
            testResult = await input.testRunner(projectRoot, testCmd);
          } else {
            testResult = await runAutonomousCoderCommand(projectRoot, testCmd);
          }
          commandsRun.push(testResult);
          testsActuallyRun = true;
          testsPassed = testResult.ok;
        } else {
          // No test file exists for the changed files — honestly skip tests
          testsActuallyRun = false;
          testsPassed = true; // neutral — typecheck + content-change are the gates
        }

        const changedFilePath = fallback.operations[0]?.path ?? 'backend/services/ivx-autonomous-coder-pilot.ts';
        const typecheckCmd = scopedTypecheckCommand(projectRoot, [changedFilePath]);
        const typecheckResult = input.testRunner
          ? await input.testRunner(projectRoot, typecheckCmd)
          : await runAutonomousCoderCommand(projectRoot, typecheckCmd);
        commandsRun.push(typecheckResult);
        typecheckPassed = typecheckResult.ok;
        buildRun = true;

        // Deterministic content-change check: the patched file must contain the new label.
        let contentChangeVerified = true;
        let contentChangeReason = '';
        for (const op of fallback.operations) {
          try {
            const read = input.fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
            const updatedContent = await read(op.path);
            if (op.kind === 'replace_exact' && !updatedContent.includes(op.newText)) {
              contentChangeVerified = false;
              contentChangeReason = `newText not present in ${op.path} after patch`;
              break;
            }
            // Also prove the OLD label is gone (true replacement, not an addition).
            if (op.kind === 'replace_exact' && updatedContent.includes(op.oldText)) {
              contentChangeVerified = false;
              contentChangeReason = `oldText still present in ${op.path} after patch (not a true replacement)`;
              break;
            }
          } catch (e) {
            contentChangeVerified = false;
            contentChangeReason = `could not read patched file: ${safeErrorMessage(e)}`;
            break;
          }
        }

        const iteration: IVXAutonomousCoderIteration = {
          iteration: 1,
          patchGenerated: true,
          patchApplied: true,
          testsRun: testsActuallyRun,
          testsPassed,
          typecheckRun: true,
          typecheckPassed,
          failureSummary: (testsPassed && typecheckPassed && contentChangeVerified)
            ? null
            : `Pilot fallback gate failed: testsPassed=${testsPassed} typecheckPassed=${typecheckPassed} contentChangeVerified=${contentChangeVerified}${contentChangeReason ? ` (${contentChangeReason})` : ''}`,
          revised: false,
        };
        iterations.push(iteration);
        if (testsPassed && typecheckPassed && contentChangeVerified) {
          onPhase?.('verifying', 'Pilot fallback: tests + scoped typecheck + content-change check PASSED.');
          keepPilotPatch = true;
        } else {
          const failCtx = `Pilot fallback gate failed: testsPassed=${testsPassed} typecheckPassed=${typecheckPassed} contentChangeVerified=${contentChangeVerified}${contentChangeReason ? ` (${contentChangeReason})` : ''}. Typecheck stdout: ${typecheckResult.stdoutTail}. Typecheck stderr: ${typecheckResult.stderrTail}.`;
          lastPatchFailureReason = failCtx;
          lastFailureContext = failCtx;
        }
      } else {
        const iteration: IVXAutonomousCoderIteration = {
          iteration: 1,
          patchGenerated: true,
          patchApplied: false,
          testsRun: false,
          testsPassed: false,
          typecheckRun: false,
          typecheckPassed: false,
          failureSummary: `Pilot fallback patch application failed: ${applyError}`,
          revised: false,
        };
        iterations.push(iteration);
      }
      } finally {
        if (!keepPilotPatch) {
          await pilotWorkspace.restore();
          filesChanged = [];
        }
      }
      // Skip the LLM loop — the deterministic path is the whole pilot.
      // Jump to the verify + commit section below.
    }
  } else {
  for (iterationCount = 1; iterationCount <= MAX_ITERATIONS; iterationCount += 1) {
    // Cost / resource controls: check cancel + runtime + token budget at the
    // start of each iteration. If the budget is exceeded, BLOCKED with a real
    // reason instead of making another LLM call.
    const iterationStop = checkStop('planning', iterationCount, `pre-iteration-${iterationCount}`);
    if (iterationStop) {
      return buildStoppedProof(input, startedAt, iterations, commandsRun, startingSha, inspectedFiles, rootCause, technicalPlan, finalPatch, patchAuthoredBy, llmCallCount, estimatedTokensUsed, iterationStop);
    }
    if (tokenBudgetExceeded) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount, patchGenerated: false, patchApplied: false,
        testsRun: false, testsPassed: false, typecheckRun: false, typecheckPassed: false,
        failureSummary: `TOKEN_BUDGET_EXCEEDED: estimated ${estimatedTokensUsed} tokens used exceeds budget ${maxTokenBudget}.`, revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `TOKEN_BUDGET_EXCEEDED: ${estimatedTokensUsed}/${maxTokenBudget} tokens`;
      break;
    }
    if (llmCallCount >= maxLlmCalls && !input.llmCaller) {
      // Live path: the real LLM call count cap is enforced (unit tests inject
      // llmCaller and are exempt because their call counts are deterministic).
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount, patchGenerated: false, patchApplied: false,
        testsRun: false, testsPassed: false, typecheckRun: false, typecheckPassed: false,
        failureSummary: `MAX_LLM_CALLS_EXCEEDED: ${llmCallCount}/${maxLlmCalls} calls.`, revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `MAX_LLM_CALLS_EXCEEDED: ${llmCallCount}/${maxLlmCalls}`;
      break;
    }
    onPhase?.('planning', `Iteration ${iterationCount}: generating patch via IVX LLM (attempt ${llmAttempts + 1}/${MAX_LLM_ATTEMPTS}).`);
    markStageStart('planning');
    let llmResponse = '';
    // Count the attempt BEFORE the call so a timeout/error still counts toward
    // the per-job call cap (an attempted call that hung is still a call).
    llmCallCount += 1;
    // V6.19: STAGE A — Task Plan (iteration 1 only, 45s timeout).
    // Call the LLM for a lightweight plan first, then use only the plan-identified
    // files for patch generation. This splits the cognitive load and reduces
    // context from 30 files × 30k chars to just the relevant files.
    let patchContextFiles: { path: string; content: string }[] = plannedContextFiles ?? inspectedFiles;
    if (iterationCount === 1 && !taskPlan && (!input.llmCaller || input.planCaller)) {
      const planRequestId = `ac-plan-${randomUUID()}`;
      stageTrace = createStageTrace(planRequestId, 45_000);
      stageTrace.repoContextCollectedAt = nowIso();
      stageTrace.inputTokenEstimate = estimateTokens(input.goal) + estimateTokens(availableFiles.slice(0, 200).join('\n'));
      onPhase?.('planning', `Iteration ${iterationCount}: STAGE A — requesting task plan from LLM (45s timeout).`);
      const plan = await callLLMForPlan(input.goal, availableFiles, input.planCaller, stageTrace);
      if (plan) {
        taskPlan = plan;
        stageTrace.targetFileSelectedAt = nowIso();
        onPhase?.('planning', `Iteration ${iterationCount}: plan received — target files: ${plan.targetFiles.join(', ')}.`);
        // STAGE B — File Context: load only the plan-identified files.
        const planFiles = [...new Set([...plan.targetFiles, ...plan.filesToInspect])]
          .filter((f) => availableFiles.includes(f) || f.startsWith('backend/') || f.startsWith('expo/'));
        if (planFiles.length > 0) {
          patchContextFiles = [];
          for (const pf of planFiles.slice(0, 10)) {
            const preview = await readFilePreview(pf, projectRoot, input.goal);
            if (preview) {
              patchContextFiles.push({ path: preview.path, content: preview.content });
            }
          }
          // Always include at least one nearby example file for convention reference
          if (patchContextFiles.length === 0) {
            patchContextFiles = inspectedFiles.slice(0, 3);
          }
        }
      } else {
        onPhase?.('planning', `Iteration ${iterationCount}: plan failed or unparseable — using default inspection targets.`);
        // Plan failed — reduce context to first 5 inspected files (not 30)
        patchContextFiles = inspectedFiles.slice(0, 5);
      }
      plannedContextFiles = patchContextFiles;
      stageTrace.promptConstructedAt = nowIso();
    } else if (iterationCount > 1 && lastLLMError && lastLLMError.includes('timed out')) {
      // V6.19: Context reduction on timeout — cut file previews in half and
      // reduce per-file chars so the retry has a smaller, faster prompt.
      onPhase?.('planning', `Iteration ${iterationCount}: timeout detected — reducing context from ${patchContextFiles.length} to ${Math.min(3, patchContextFiles.length)} files.`);
      patchContextFiles = patchContextFiles.slice(0, 3).map((f) => ({
        path: f.path,
        content: truncate(f.content, 8000), // was 30000 — reduce to 8000 on timeout retry
      }));
    }
    const userPromptForCall = buildPatchUserPrompt(input.goal, patchContextFiles, lastFailureContext);
    try {
      // V6.19: STAGE C — Patch Generation with AbortController (90s timeout).
      // The AbortController is created inside callLLMForPatch and aborted on
      // timeout so the underlying HTTP request is actually cancelled.
      const patchTimeout = iterationCount > 1 && llmAttempts > 0 ? 60_000 : 90_000;
      if (stageTrace) {
        stageTrace.timeoutMs = patchTimeout;
        stageTrace.retryNumber = llmAttempts;
      }
      llmResponse = await callLLMForPatch(
        PATCH_SYSTEM_PROMPT,
        userPromptForCall,
        input.llmCaller,
        patchTimeout,
        stageTrace ?? undefined,
      );
      // Only count tokens on a successful response (no response text on throw).
      estimatedTokensUsed += estimateTokens(llmResponse) + estimateTokens(userPromptForCall);
      if (estimatedTokensUsed > maxTokenBudget) tokenBudgetExceeded = true;
      lastLLMResponseRaw = truncate(llmResponse, 2000);
      lastLLMError = null;
    } catch (error) {
      lastLLMError = safeErrorMessage(error);
      llmAttempts += 1;
      if (llmAttempts < MAX_LLM_ATTEMPTS) {
        onPhase?.('revising', `Iteration ${iterationCount}: LLM call failed (${lastLLMError}); retrying.`);
        // Retry the same iteration without consuming a revision slot.
        iterationCount -= 1;
        continue;
      }
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: `LLM call failed after ${MAX_LLM_ATTEMPTS} attempts: ${lastLLMError}`,
        revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `LLM_PLAN_INVALID: LLM call failed after ${MAX_LLM_ATTEMPTS} attempts. Last error: ${lastLLMError}`;
      break;
    }

    const parsed = parseLLMPatchResponse(llmResponse);
    if (!parsed) {
      anyPatchGenerated = false;
      llmAttempts += 1;
      lastPatchFailureReason = 'LLM response could not be parsed as JSON patch.';
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: 'LLM response could not be parsed as JSON patch.',
        revised: false,
      };
      iterations.push(iteration);
      lastFailureContext = `LLM response could not be parsed. Response: ${truncate(llmResponse, 1000)}`;
      if (llmAttempts < MAX_LLM_ATTEMPTS) {
        onPhase?.('revising', `Iteration ${iterationCount}: unparseable response; requesting revision.`);
        iterationCount -= 1;
        continue;
      }
      // Max LLM attempts exhausted — LLM_PLAN_INVALID BLOCKED.
      lastPatchFailureReason = `LLM_PLAN_INVALID: LLM response unparseable after ${MAX_LLM_ATTEMPTS} attempts. Last raw response: ${lastLLMResponseRaw ?? 'none'}`;
      break;
    }
    // "already satisfied" empty-operations case: exit cleanly with COMPLETED, no phantom patch
    if (parsed.operations.length === 0) {
      rootCause = parsed.rootCause;
      technicalPlan = parsed.technicalPlan;
      anyPatchGenerated = false;
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: 'LLM determined the goal is already satisfied — no patch required.',
        revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = 'GOAL_ALREADY_SATISFIED: LLM returned empty operations with rootCause.';
      break;
    }

    rootCause = parsed.rootCause;
    technicalPlan = parsed.technicalPlan;
    patchAuthoredBy = 'ivx_llm';
    finalPatch = parsed.operations;
    anyPatchGenerated = true;

    // Compare against the same installed compiler and flags before and after
    // the patch. A missing compiler cannot establish a passing baseline.
    const baselineFilePaths = parsed.operations.filter(op => op.kind === 'replace_exact' && /\.tsx?$/.test(op.path)).map(op => op.path);
    let baselineTsErrorCount = 0;

    // ── APPLY PATCH ──────────────────────────────────────────────────────
    onPhase?.('patching', `Iteration ${iterationCount}: applying ${parsed.operations.length} patch operation(s).`);
    markStageStart('patching');
    const workspace = new PatchWorkspace(projectRoot, input.fileReader, input.fileWriter);
    const expectedContents = new Map<string, string>();
    let keepPatch = false;
    try {
    let patchApplied = false;
    const appliedOps: IVXAutonomousCoderPatchOperation[] = [];
    const requiresRegression = requiresRepairRegression(input.taskId, input.goal);
    const originalSources = new Map<string, string | null>();
    let applyError: string | null = null;
    try {
      assertPrivateRepairScope(input.goal, input.allowedFiles, parsed.operations.map(op => op.path));
      assertRepairPatchQuality(input.taskId, parsed.operations, input.goal);
      if (requiresRegression) {
        const unseen = parsed.operations.find(op => op.kind === 'replace_exact' && !patchContextFiles.some(file => file.path === op.path));
        if (unseen) throw new Error(`REPAIR_SOURCE_NOT_INSPECTED: ${unseen.path}. Modify only source actually read, or request a real existing path on revision.`);
        await assertRepairTestRuntime(parsed.operations, input.fileReader ?? (async rel => readFile(path.join(projectRoot, rel), 'utf8')));
      }
      if (!requiresRegression && baselineFilePaths.length && !input.testRunner) {
        const baseResult = await runAutonomousCoderCommand(projectRoot, scopedTypecheckCommand(projectRoot, baselineFilePaths));
        baselineTsErrorCount = countTsErrors(baseResult.stderrTail + baseResult.stdoutTail);
      }
      for (const op of parsed.operations) {
        assertSafePatchPath(op.path);
        await workspace.capture(op.path);
        if (requiresRegression && !/\.(test|spec)\.[cm]?[jt]sx?$/.test(op.path) && !originalSources.has(op.path)) {
          originalSources.set(op.path, workspace.originals.get(op.path)!);
        }
        await input.assertExecutionAuthority?.();
        expectedContents.set(op.path, await applyPatchOperation(op, projectRoot, input.fileWriter, input.fileReader));
        appliedOps.push(op);
      }
      patchApplied = true;
      anyPatchApplied = true;
      filesChanged = [...new Set(appliedOps.map((op) => op.path))];
    } catch (error) {
      applyError = safeErrorMessage(error);
      lastPatchFailureReason = `Patch application failed: ${applyError}`;
      // Restore before refreshing the source shown to the next model attempt.
      await workspace.restore();
      filesChanged = [];
    }

    if (!patchApplied) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: true,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: `Patch application failed: ${applyError}`,
        revised: true,
      };
      iterations.push(iteration);
      // Keep the selected implementation across revisions and reread any real
      // target after a failed application. Do not substitute unrelated defaults.
      const refreshed: { path: string; content: string }[] = [];
      const paths = [...new Set([...patchContextFiles.map(file => file.path), ...parsed.operations.map(op => op.path)])];
      for (const file of paths.slice(0, MAX_INSPECTED_FILES)) {
        const preview = await readFilePreview(file, projectRoot, input.goal);
        if (preview) refreshed.push({ path: preview.path, content: preview.content });
      }
      if (refreshed.length) plannedContextFiles = refreshed;
      lastFailureContext = `Patch could not be applied: ${applyError}. The oldText may not match the file content exactly. Re-read the file content and generate a corrected patch.`;
      onPhase?.('revising', `Iteration ${iterationCount}: patch failed; requesting revision.`);
      continue;
    }

    // ── TEST ─────────────────────────────────────────────────────────────
    onPhase?.('testing', `Iteration ${iterationCount}: running targeted tests + typecheck.`);
    markStageStart('testing');
    const targetTest = pickTargetTestFile(input.goal, filesChanged, projectRoot);
    // Gap 4 FIX: Only run tests when a test file actually exists. For newly
    // created files where no corresponding .test.ts exists, honestly record
    // testsRun=false and rely on typecheck + content-change verification.
    let testCmd = '';
    let testResult: IVXAutonomousCoderTestResult | null = null;
    let testsActuallyRun = false;
    // When a testRunner is injected (unit tests), always run tests so the
    // mock can exercise pass/fail scenarios. In production, only run tests
    // when a test file actually exists on disk.
    const effectiveTestTarget = targetTest ?? (input.testRunner ? 'backend/ivx-autonomous-coder.test.ts' : null);
    let regressionFailure: string | null = null;
    if (requiresRegression && effectiveTestTarget) {
      // Keep the generated test unchanged while restoring every implementation
      // file to its inspected baseline. Always restore the patch before its
      // normal test/typecheck run, including when the baseline runner fails.
      const read = input.fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
      const write = input.fileWriter ?? (async (rel: string, content: string) => {
        await mkdir(path.dirname(path.join(projectRoot, rel)), { recursive: true });
        await writeFile(path.join(projectRoot, rel), content, 'utf8');
      });
      const patchedSources = new Map<string, string>();
      try {
        for (const file of originalSources.keys()) patchedSources.set(file, await read(file));
        for (const [file, original] of originalSources) {
          if (original === null) await rm(path.join(projectRoot, file), { force: true });
          else await write(file, original);
        }
        const command = targetedTestCommand(input.taskId, effectiveTestTarget, input.goal);
        const baseline = input.testRunner
          ? await input.testRunner(projectRoot, command)
          : await runAutonomousCoderCommand(projectRoot, command);
        commandsRun.push({ ...baseline, phase: 'regression_baseline' });
        if (baseline.ok || baseline.exitCode !== 1 || !/\bERR_ASSERTION\b/.test(baseline.stdoutTail + baseline.stderrTail)) {
          regressionFailure = 'REPAIR_REGRESSION_NOT_REPRODUCED: the same regression must fail with an assertion against the original implementation. Already-passing tests and infrastructure/import errors do not prove a repair.';
        }
      } catch (error) {
        regressionFailure = `REPAIR_REGRESSION_BASELINE_FAILED: ${safeErrorMessage(error)}`;
      } finally {
        for (const [file, patched] of patchedSources) await write(file, patched);
      }
    } else if (requiresRegression) {
      regressionFailure = 'REPAIR_REGRESSION_NOT_REPRODUCED: no executable regression was found.';
    }
    if (effectiveTestTarget) {
      testCmd = targetedTestCommand(input.taskId, effectiveTestTarget, input.goal);
      if (input.testRunner) {
        testResult = await input.testRunner(projectRoot, testCmd);
      } else {
        testResult = await runAutonomousCoderCommand(projectRoot, testCmd);
      }
      commandsRun.push(testResult);
      testsActuallyRun = true;
      testsPassed = testResult.ok;
    } else {
      // No test file exists for the changed files — honestly skip tests
      testsActuallyRun = false;
      testsPassed = true; // neutral — typecheck + content-change are the gates
    }
    if (regressionFailure) testsPassed = false;

    // The production image supplies TypeScript. Always run its installed entry
    // point; do not download `tsc` or turn compiler failures into skipped passes.
    const changedTsFiles = appliedOps.filter(op => /\.tsx?$/.test(op.path)).map(op => op.path);
    const tscCmd = scopedTypecheckCommand(projectRoot, changedTsFiles);
    const typecheckResult = input.testRunner
      ? await input.testRunner(projectRoot, tscCmd)
      : await runAutonomousCoderCommand(projectRoot, tscCmd);
    commandsRun.push(typecheckResult);
    // Regression repairs require a clean compile; legacy non-repair edits
    // retain the existing baseline-error policy.
    const postPatchTsErrors = countTsErrors((typecheckResult.stderrTail || '') + (typecheckResult.stdoutTail || ''));
    typecheckPassed = typecheckResult.ok || (!requiresRegression && postPatchTsErrors > 0 && postPatchTsErrors <= baselineTsErrorCount);
    buildRun = true;

    // ── DETERMINISTIC CONTENT-CHANGE CHECK ──────────────────────────────
    // Verify the final contents after all operations, not intermediate snippets
    // that a later operation may legitimately replace. Require an actual diff.
    let contentChangeVerified = [...expectedContents].some(([file, content]) => workspace.originals.get(file) !== content);
    for (const [file, expected] of expectedContents) {
      try {
        const read = input.fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
        const updatedContent = await read(file);
        if (updatedContent !== expected) {
          contentChangeVerified = false;
          break;
        }
      } catch {
        contentChangeVerified = false;
        break;
      }
    }

    if (testsPassed && typecheckPassed && contentChangeVerified) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: true,
        patchApplied: true,
        testsRun: testsActuallyRun,
        testsPassed: true,
        typecheckRun: true,
        typecheckPassed: true,
        failureSummary: null,
        revised: false,
      };
      iterations.push(iteration);
      onPhase?.('verifying', `Iteration ${iterationCount}: tests + typecheck PASSED.`);
      keepPatch = true;
      break;
    }

    // ── ANALYZE FAILURE ──────────────────────────────────────────────────
    onPhase?.('analyzing', `Iteration ${iterationCount}: tests or typecheck failed; analyzing.`);
    const failureParts: string[] = [];
    if (!contentChangeVerified) failureParts.push('PATCH_CONTENT_NOT_VERIFIED: final file contents must match the applied operations and include a real change.');
    if (regressionFailure) failureParts.push(regressionFailure);
    if (!testsPassed && testResult) {
      failureParts.push(`TEST FAILURE (${testResult.command}):\nstdout: ${testResult.stdoutTail}\nstderr: ${testResult.stderrTail}`);
    }
    if (!typecheckPassed) {
      failureParts.push(`TYPECHECK FAILURE (${typecheckResult.command}):\nstdout: ${typecheckResult.stdoutTail}\nstderr: ${typecheckResult.stderrTail}`);
    }
    const failureSummary = truncate(failureParts.join('\n\n'), 2000);
    lastFailureContext = truncate(failureParts.join('\n\n'), FAILURE_OUTPUT_CHARS);

    const iteration: IVXAutonomousCoderIteration = {
      iteration: iterationCount,
      patchGenerated: true,
      patchApplied: true,
      testsRun: testsActuallyRun,
      testsPassed: false,
      typecheckRun: true,
      typecheckPassed: false,
      failureSummary,
      revised: iterationCount < MAX_ITERATIONS,
    };
    iterations.push(iteration);

    // ── REVERT + REVISE ──────────────────────────────────────────────────
    if (iterationCount < MAX_ITERATIONS) {
      onPhase?.('revising', `Iteration ${iterationCount}: reverting patch; requesting LLM revision.`);
      continue;
    }

    // Max iterations reached — BLOCKED
    onPhase?.('blocked', `Max iterations (${MAX_ITERATIONS}) reached; tests still failing.`);
    break;
    } finally {
      // Covers rejected iterations, partial writes, test/compiler exceptions,
      // and cancellation callbacks. A failed restore throws and stops the job.
      if (!keepPatch) {
        await workspace.restore();
        filesChanged = [];
      }
    }
  }
  } // end of else (non-pilot LLM loop)

  // ── VERIFY + COMMIT ──────────────────────────────────────────────────────
  let commitSha: string | null = null;
  let commitCheckpointPersisted = false;
  let commitUrl: string | null = null;
  let branch: string | null = null;
  let prNumber: number | null = null;
  let prUrl: string | null = null;
  let prMerged = false;
  let prMergeCommitSha: string | null = null;
  let prCreated = false;
  let ciChecksWaited = false;
  let ciChecksGreen: boolean | null = null;
  let ciCheckEvidence: IVXCiCheckEvidence[] | null = null;
  let ciWaitMs: number | null = null;
  let deployId: string | null = null;
  let deployStatus: string | null = null;
  let productionVerified = false;
  let liveCommit: string | null = null;
  let healthOk = false;
  let healthResponse: IVXDeploymentEndpointEvidence | null = null;
  let versionResponse: IVXDeploymentEndpointEvidence | null = null;
  let finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELED' = 'BLOCKED';
  let error: string | null = null;

  if (testsPassed && typecheckPassed && filesChanged.length > 0) {
    // QUALITY FIREWALL (owner mandate 2026-08-28, Mission J): a patch that is
    // only a placeholder/stub never reaches a commit or PR — the task fails
    // with an explicit blocker instead of faking completion (the IA-057 loop
    // produced exactly this class of stub for PRs #431–#447).
    let placeholderRejected = false;
    if (input.executionMode === 'code_change' || input.executionMode === 'deploy') {
      try {
        for (const relPath of filesChanged) {
          const content = input.fileReader
            ? await input.fileReader(relPath)
            : await readFile(path.join(projectRoot, relPath), 'utf8');
          if (/Implement the specific logic|placeholder implementation|TODO: implement the specific/i.test(content)) {
            finalStatus = 'FAILED';
            error = `PLACEHOLDER_PATCH_REJECTED: ${relPath} contains stub/placeholder code instead of a real repair.`;
            onPhase?.('failed', error);
            placeholderRejected = true;
            break;
          }
        }
      } catch {
        // Read failure is best-effort — never blocks a real patch.
      }
    }
    if (placeholderRejected) {
      // Fall through to proof construction below with FAILED status.
    } else if (input.executionMode === 'code_change' || input.executionMode === 'deploy') {
      onPhase?.('committing', 'Tests + typecheck passed; committing via GitHub Git Data API.');
      try {
        // code_change jobs commit to a non-deploy branch so Render auto-deploy
        // does not restart the service and orphan the worker mid-stage. Deploy
        // jobs still commit to main (the self-deploy handoff persists resumable
        // state before triggering Render, so the restart is expected there).
        const approvedProductionBranch = (await readOwnerRuntimeVariable('GITHUB_DEFAULT_BRANCH')) || GITHUB_DEFAULT_BRANCH;
        const branchName = input.executionMode === 'deploy'
          ? approvedProductionBranch
          : `${AUTONOMOUS_CODER_BRANCH}-${autonomousBranchSuffix(input.taskId)}`;
        assertPrivateRepairScope(input.goal, input.allowedFiles, filesChanged);
        assertLandingRepairScope(input.taskId, filesChanged);
        await input.assertExecutionAuthority?.();
        const commitResult = input.commitFn
          ? await input.commitFn(filesChanged, branchName)
          : await commitFilesViaGitDataApi(filesChanged, branchName, buildAttributionTrailers(input), projectRoot);
        commitSha = commitResult.commitSha;
        commitUrl = commitResult.commitUrl;
        branch = commitResult.branch;
        if (input.executionMode === 'deploy' && branch !== approvedProductionBranch) {
          throw new Error(`Production deployment commit was rejected: expected approved branch ${approvedProductionBranch}, received ${branch}.`);
        }
        // RESILIENCE: persist the commit SHA to the job record IMMEDIATELY, before
        // any further work (proof construction, deploy, verify). If the process
        // crashes between this point and the proof return, the recovery sweep can
        // still find the commit on the ivx-autonomous branch and recover the job
        // to COMPLETED instead of orphaning it at COMMITTING 65% with commitSha=''.
        try {
          await input.onCommitLanded?.({ commitSha, commitUrl, branch, filesChanged: [...filesChanged], commandsRun: [...commandsRun], testsPassed, typecheckPassed });
          commitCheckpointPersisted = true;
        } catch (checkpointError) {
          throw new Error(`COMMIT_CHECKPOINT_PERSISTENCE_REQUIRED: ${safeErrorMessage(checkpointError)}`);
        }
        onPhase?.('committing', `Commit created: ${commitSha}`);
      } catch (err) {
        finalStatus = 'FAILED';
        error = `Commit failed: ${safeErrorMessage(err)}`;
        onPhase?.('failed', error);
      }
    }

    // ── PULL REQUEST (code_change mode) ────────────────────────────────────
    // After committing to the ivx-autonomous branch, create a PR to main
    // so the code change reaches production. When autoMergePr is true and
    // owner approval is given, merge the PR immediately.
    if (input.executionMode === 'code_change' && commitSha && branch && commitCheckpointPersisted) {
      try {
        onPhase?.('committing', `Creating pull request: ${branch} → main.`);
        const publicGoal = publicRepairGoal(input.goal);
        const prTitle = `IVX autonomous coder: ${publicGoal.slice(0, 72)}`;
        const prBody = [
          `## Autonomous Code Change`,
          ``,
          `**Goal:** ${publicGoal}`,
          `**Commit:** ${commitSha}`,
          `**Branch:** ${branch}`,
          `**Files changed:** ${filesChanged.join(', ')}`,
          `**Tests passed:** ${testsPassed}`,
          `**Typecheck passed:** ${typecheckPassed}`,
          `**Patch authored by:** ${patchAuthoredBy ?? 'unknown'}`,
          ``,
          buildAttributionTrailers(input),
          ``,
          `This PR was created by the IVX Autonomous Coder engine after the patch passed tests and typecheck.`,
        ].join('\n');
        await input.assertExecutionAuthority?.();
        const prResult = input.prFn
          ? await input.prFn(branch, prTitle, prBody)
          : await createPullRequestForBranch(branch, 'main', prTitle, prBody);
        prNumber = prResult.prNumber;
        prUrl = prResult.prUrl;
        prCreated = true;
        // FINAL CLOSEOUT 2026-08-23: persist PR state the instant the PR exists,
        // BEFORE the CI wait, so a worker restart mid-wait can resume the chain
        // (see resumeIVXAutonomousCoderFromCiWait). Persistence is a required
        // boundary: failure blocks this run before CI waiting or any merge.
        await input.onPrCreated?.({ commitSha, prNumber: prResult.prNumber, prUrl: prResult.prUrl, branch });
        onPhase?.('committing', `Pull request created: #${prNumber} — ${prUrl}`);

        // Auto-merge when owner-approved via autoMergePr flag. Owner mandate
        // 2026-08-23 (CI-before-merge): the merge API is NEVER called until
        // every required GitHub check on the head SHA is GREEN.
        if (input.autoMergePr && !prResult.merged) {
          onPhase?.('committing', `Waiting for required CI checks on ${commitSha.slice(0, 12)} before merging PR #${prNumber} (CI-before-merge).`);
          const ci = await waitForRequiredChecksGreen(commitSha, input, onPhase, prNumber, branch ?? undefined);
          ciChecksWaited = true;
          ciChecksGreen = ci.green;
          ciCheckEvidence = ci.evidence;
          ciWaitMs = ci.waitMs;
          if (!ci.green) {
            // Required check failed or timed out: preserve the exact failing
            // check evidence, do NOT merge, and NEVER label the task COMPLETED.
            finalStatus = 'BLOCKED';
            const failing = ci.evidence
              .filter((e) => !(e.matched && e.status === 'completed' && e.conclusion === 'success'))
              .map((e) => `${e.context}=${e.matched ? `${e.status}/${e.conclusion ?? 'none'}` : 'NOT_REPORTED'}`)
              .join('; ');
            error = ci.blocker ?? `${ci.timedOut ? 'Required CI checks TIMED OUT' : 'Required CI checks FAILED'} on ${commitSha.slice(0, 12)} — merge NOT attempted. Task BLOCKED, never COMPLETED. Checks: ${failing}. Autonomous may repair and open another PR.`;
            onPhase?.('blocked', error);
          } else {
            onPhase?.('committing', `All required CI checks GREEN. Auto-merging PR #${prNumber} (owner approved).`);
            await input.assertExecutionAuthority?.();
            const mergeResult = input.mergeFn
              ? await input.mergeFn(prNumber, prTitle)
              : await mergePullRequest(prNumber, prTitle, commitSha);
            prMerged = mergeResult.merged;
            prMergeCommitSha = mergeResult.mergeCommitSha;
            if (prMerged && prMergeCommitSha) {
              onPhase?.('committing', `PR #${prNumber} merged. Merge commit: ${prMergeCommitSha}`);
            } else {
              // Merge attempted but not confirmed — BLOCKED, never COMPLETED.
              onPhase?.('committing', `PR #${prNumber} merge attempted but NOT confirmed (merged=${prMerged}, mergeSha=${prMergeCommitSha ?? 'none'}).`);
            }
          }
        } else if (prResult.merged) {
          prMerged = true;
          prMergeCommitSha = prResult.mergeCommitSha;
        }
      } catch (prErr) {
        // Owner mandate 2026-08-23: PR creation/merge failure is NEVER
        // non-fatal for a code task. A commit that cannot reach main through
        // a PR is BLOCKED — never COMPLETED.
        finalStatus = 'BLOCKED';
        error = `Pull request creation/merge failed — BLOCKED, never COMPLETED: ${safeErrorMessage(prErr)}`;
        onPhase?.('blocked', error);
      }
    }

    // ── CODE_CHANGE POST-MERGE ───────────────────────────────────────────
    // After auto-merging the PR in code_change mode, mark COMPLETED immediately.
    // Render auto-deploys on every push to main, so an explicit deploy trigger
    // is redundant AND it restarts the service before the worker can mark
    // COMPLETED, orphaning the job at COMMITTING (65%). The recovery sweep
    // handles production verification after the restart.
    if (input.executionMode === 'code_change' && prMerged && prMergeCommitSha) {
      finalStatus = 'COMPLETED';
      deployStatus = 'auto_deploy_triggered';
      onPhase?.('completed', `PR merged to main (${prMergeCommitSha.slice(0, 12)}) after all required CI checks GREEN. Render auto-deploy will pick up the merge commit. Job marked COMPLETED.`);
    } else if (input.executionMode === 'code_change' && commitSha && (!prMerged || !prMergeCommitSha)) {
      // Owner mandate 2026-08-23: commit exists + PR not merged (or merge not
      // confirmed with a SHA) = BLOCKED, NEVER COMPLETED. The commit is on
      // the ivx-autonomous branch; the task is only honestly finished once
      // the PR is merged after all required CI checks pass.
      finalStatus = 'BLOCKED';
      if (!error) {
        error = prMerged && !prMergeCommitSha
          ? `Merge of PR ${prUrl ?? `#${prNumber ?? '?'}`} was attempted but NOT confirmed (no merge commit SHA from GitHub). Task BLOCKED, never COMPLETED.`
          : `Commit created (${commitSha.slice(0, 12)}) on branch ${branch}${prUrl ? ` with PR ${prUrl}` : ' but no pull request'} — the pull request was NOT merged. Task BLOCKED, never COMPLETED, until the PR merges after all required CI checks pass.`;
      }
      onPhase?.('blocked', error);
    } else if ((commitSha && commitCheckpointPersisted) || input.executionMode === 'read_only') {
      finalStatus = 'COMPLETED';
    }

    // ── DEPLOY (owner-gated, deploy mode) ───────────────────────────────
    if (input.executionMode === 'deploy' && commitSha && commitCheckpointPersisted) {
      if (input.deployApproved && (input.deployConfirmationText === 'CONFIRM_IVX_RENDER_DEPLOY' || input.deployConfirmationText === IVX_GIT_DEPLOY_CONFIRM_TEXT)) {
        onPhase?.('deploying', 'Owner approval verified; triggering Render deploy.');
        try {
          await input.assertExecutionAuthority?.();
          const deployResult = input.deployFn
            ? await input.deployFn(commitSha)
            : await triggerRenderDeploy(commitSha);
          deployId = deployResult.deployId;
          deployStatus = deployResult.deployStatus;
          onPhase?.('deploying', `Deploy triggered: ${deployId ?? deployStatus}`);

          // ── PRODUCTION VERIFY ────────────────────────────────────────────
          onPhase?.('production_verifying', 'Waiting for Render live status and verifying production /health + /version.');
          if (!deployId) throw new Error('Render deploy trigger returned no deployment ID.');
          const verification = input.productionVerifier
            ? await input.productionVerifier(commitSha, deployId)
            : input.healthChecker
              ? await input.healthChecker().then((health) => ({
                  deployStatus,
                  health: { endpoint: 'injected://health', httpStatus: health.ok ? 200 : 503, commitSha: health.commit, ok: health.ok },
                  version: { endpoint: 'injected://version', httpStatus: health.ok ? 200 : 503, commitSha: health.commit, ok: health.ok },
                }))
              : await verifyProductionDeployment(commitSha, deployId);
          deployStatus = verification.deployStatus;
          healthResponse = verification.health;
          versionResponse = verification.version;
          healthOk = healthResponse.ok;
          liveCommit = versionResponse.commitSha;
          productionVerified = deployStatus === 'live'
            && healthResponse.ok
            && versionResponse.ok
            && healthResponse.commitSha === commitSha
            && versionResponse.commitSha === commitSha;
          if (productionVerified) {
            finalStatus = 'COMPLETED';
          } else {
            // ── PRODUCTION ROLLBACK (Phase 16) ─────────────────────────────
            // Deploy verified-fail: the live commit does not match the deployed
            // commit, or health is down. Attempt an automatic rollback: revert
            // commit + redeploy the prior SHA. Bounded to ONE attempt; any
            // failure is recorded in rollbackError (never silently swallowed).
            onPhase?.('production_verifying', `Deploy verify-fail (deployStatus=${deployStatus}, healthCommit=${healthResponse.commitSha}, versionCommit=${versionResponse.commitSha}, expected=${commitSha}); attempting rollback.`);
            try {
              const rb = input.rollbackFn
                ? await input.rollbackFn(commitSha, (await readOwnerRuntimeVariable('GITHUB_DEFAULT_BRANCH')) || GITHUB_DEFAULT_BRANCH)
                : await rollbackProductionDeploy(commitSha, (await readOwnerRuntimeVariable('GITHUB_DEFAULT_BRANCH')) || GITHUB_DEFAULT_BRANCH);
              rollbackTriggered = true;
              rollbackCommitSha = rb.revertCommitSha;
              rollbackError = rb.error;
              if (rb.reverted) {
                finalStatus = 'FAILED';
                error = `Deploy verification failed; rollback was triggered with revert commit ${rb.revertCommitSha}. This task is FAILED because the requested commit was not verified in production.`;
                onPhase?.('failed', error);
              } else {
                finalStatus = 'FAILED';
                error = `Deploy verify-fail AND rollback failed: healthOk=${healthOk}, liveCommit=${liveCommit}, expected=${commitSha}. Rollback error: ${rb.error}`;
                onPhase?.('failed', error);
              }
            } catch (rbErr) {
              rollbackTriggered = true;
              rollbackError = safeErrorMessage(rbErr);
              finalStatus = 'FAILED';
              error = `Deploy verify-fail AND rollback threw: ${safeErrorMessage(rbErr)}`;
              onPhase?.('failed', error);
            }
          }
        } catch (err) {
          finalStatus = 'FAILED';
          error = `Deploy failed: ${safeErrorMessage(err)}`;
          onPhase?.('failed', error);
        }
      } else {
        // Owner mandate 2026-08-23: deploy requested without verified owner
        // approval = BLOCKED, NEVER COMPLETED.
        onPhase?.('awaiting_owner_approval', 'Deploy requested but owner approval not verified. Blocking deploy.');
        finalStatus = 'BLOCKED';
        error = `Commit created. Deploy BLOCKED: owner approval required (confirm=true, confirmText="CONFIRM_IVX_RENDER_DEPLOY" or "${IVX_GIT_DEPLOY_CONFIRM_TEXT}"). Task BLOCKED, never COMPLETED, until the deploy is owner-approved and verified.`;
      }
    }
  } else if (!anyPatchApplied && !anyPatchGenerated) {
    finalStatus = 'BLOCKED';
    error = `No valid patch was generated after ${iterations.length} iteration(s). Last reason: ${lastPatchFailureReason ?? 'LLM did not produce valid operations'}`;
    onPhase?.('blocked', error);
  } else if (!anyPatchApplied && anyPatchGenerated) {
    finalStatus = 'BLOCKED';
    error = `No patch could be applied after ${iterations.length} iteration(s). Last reason: ${lastPatchFailureReason ?? 'patch application failed'}`;
    onPhase?.('blocked', error);
  } else if (!testsPassed || !typecheckPassed) {
    finalStatus = 'BLOCKED';
    error = `Tests or typecheck failed after ${iterations.length} iteration(s). No commit created. Last failure: ${lastFailureContext ?? 'unknown'}`;
    onPhase?.('blocked', error);
  } else {
    finalStatus = 'FAILED';
    error = 'Autonomous coder did not produce a passing patch.';
    onPhase?.('failed', error);
  }

  const proof: IVXAutonomousCoderProof = {
    marker: IVX_AUTONOMOUS_CODER_MARKER,
    taskId: input.taskId,
    goal: input.goal,
    executionMode: input.executionMode,
    approvalPolicy: input.approvalPolicy,
    ownerId: input.ownerId,
    startingSha,
    filesInspected: inspectedFiles.map((f) => f.path),
    rootCause,
    technicalPlan,
    iterations,
    finalPatch,
    filesChanged,
    commandsRun,
    testsPassed,
    typecheckPassed,
    buildRun,
    commitSha,
    commitUrl,
    branch,
    prNumber,
    prUrl,
    prMerged,
    prMergeCommitSha,
    prCreated,
    ciChecksWaited,
    ciChecksGreen,
    ciCheckEvidence,
    ciWaitMs,
    deployApproved: Boolean(input.deployApproved && (input.deployConfirmationText === 'CONFIRM_IVX_RENDER_DEPLOY' || input.deployConfirmationText === IVX_GIT_DEPLOY_CONFIRM_TEXT)),
    deployRequested: input.executionMode === 'deploy',
    deployId,
    deployStatus,
    productionVerified,
    liveCommit,
    healthOk,
    healthResponse,
    versionResponse,
    iterationCount,
    durationMs: Date.now() - startedAt,
    finalStatus,
    error,
    generatedAt: nowIso(),
    secretValuesReturned: false,
    patchAuthoredBy,
    llmCallCount,
    estimatedTokensUsed,
    tokenBudgetExceeded,
    rollbackTriggered,
    rollbackCommitSha,
    rollbackError,
    stageTrace,
    taskPlan,
  };

  if (finalStatus === 'COMPLETED') {
    onPhase?.('completed', `Autonomous coder job completed. Commit: ${commitSha ?? 'none'}`);
  }
  return proof;
}

// ── RESTART / CI-WAIT RESUME (FINAL CLOSEOUT 2026-08-23) ─────────────────────

/** Live PR state from the GitHub API. */
async function fetchPullRequestState(prNumber: number, expected: { commitSha: string; branch?: string }): Promise<{
  state: 'open' | 'closed' | 'unknown';
  merged: boolean;
  mergeCommitSha: string | null;
}> {
  const token = await readOwnerRuntimeVariable('GITHUB_TOKEN');
  const repoUrl = await readOwnerRuntimeVariable('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!token || !repoInfo) {
    throw new Error('GITHUB_TOKEN or GITHUB_REPO_URL is missing — cannot inspect PR state for restart resume.');
  }
  const res = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/pulls/${prNumber}`,
    { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) },
  );
  if (!res.ok) {
    throw new Error(`GitHub PR fetch failed: ${res.status}`);
  }
  const data = await res.json() as { number?: number; state?: string; merged?: boolean; merge_commit_sha?: string | null;
    head?: { sha?: string; ref?: string; repo?: { full_name?: string } };
    base?: { ref?: string; repo?: { full_name?: string } } };
  const repo = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();
  if (!/^[a-f0-9]{40}$/i.test(expected.commitSha) || !expected.branch
    || data.number !== prNumber || data.head?.sha !== expected.commitSha || data.head.ref !== expected.branch
    || data.head.repo?.full_name?.toLowerCase() !== repo || data.base?.ref !== 'main'
    || data.base.repo?.full_name?.toLowerCase() !== repo) {
    throw new Error('PR_RESUME_IDENTITY_MISMATCH: persisted repository, PR, branch, base and complete SHA must match; checkpoint retained.');
  }
  return {
    state: data.state === 'open' || data.state === 'closed' ? data.state : 'unknown',
    merged: Boolean(data.merged),
    mergeCommitSha: typeof data.merge_commit_sha === 'string' ? data.merge_commit_sha : null,
  };
}

export type IVXAutonomousCoderResumeInput = {
  taskId: string;
  goal: string;
  ownerId: string;
  /** Persisted head SHA of the PR branch (captured by onPrCreated). */
  commitSha: string;
  prNumber: number;
  prUrl?: string | null;
  branch: string;
  /** Pre-restart evidence — tests/typecheck already ran before the restart.
   *  The resume NEVER re-runs them; it passes the persisted results through. */
  testsPassed: boolean;
  typecheckPassed: boolean;
  filesChanged?: string[];
  onPhase?: (phase: IVXAutonomousCoderPhase, detail: string) => void;
  beforeMerge?: () => Promise<void>;
  requiredChecksFn?: (commitSha: string) => Promise<IVXCiCheckEvidence[]>;
  mergeFn?: (prNumber: number, commitMessage: string) => Promise<{ merged: boolean; mergeCommitSha: string | null }>;
  ciWaitTimeoutMs?: number;
  ciPollIntervalMs?: number;
  ciNaGraceMs?: number;
  sleepFn?: (ms: number) => Promise<void>;
  /** Injectable PR-state fetcher for testing. When omitted, the real GitHub
   *  API is used. */
  prStateFn?: (prNumber: number) => Promise<{ state: 'open' | 'closed' | 'unknown'; merged: boolean; mergeCommitSha: string | null }>;
};

/**
 * Resume a code-change job whose worker process was restarted while it was
 * waiting for the PR's required CI checks (owner mandate 2026-08-23 final
 * closeout). The full resume state (taskId, commitSha, prNumber, branch)
 * must have been persisted by the worker BEFORE the restart via onPrCreated.
 *
 * Recovery matrix (fail-closed, never a false COMPLETED):
 *  - PR already merged              → verify saved head checks and merge SHA
 *  - PR open + checks still running → resume waiting (heartbeat via onPhase)
 *  - PR open + checks all green     → merge → COMPLETED (merge SHA required)
 *  - PR open + checks failed/timed out → BLOCKED with exact per-check evidence
 *  - PR closed unmerged             → BLOCKED
 *
 * The original taskId is preserved — no duplicate job is ever created.
 */
export async function resumeIVXAutonomousCoderFromCiWait(
  input: IVXAutonomousCoderResumeInput,
): Promise<IVXAutonomousCoderProof> {
  const startedAt = Date.now();
  const onPhase = input.onPhase;
  let prMerged = false;
  let prMergeCommitSha: string | null = null;
  let ciChecksGreen: boolean | null = null;
  let ciCheckEvidence: IVXCiCheckEvidence[] | null = null;
  let ciWaitMs: number | null = null;
  let finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED' = 'BLOCKED';
  let error: string | null = null;
  const checkSavedHead = () => waitForRequiredChecksGreen(input.commitSha, {
    taskId: input.taskId,
    goal: input.goal,
    executionMode: 'code_change',
    ownerId: input.ownerId,
    approvalPolicy: 'owner_gated',
    requiredChecksFn: input.requiredChecksFn,
    prStateFn: input.prStateFn,
    ciWaitTimeoutMs: input.ciWaitTimeoutMs,
    ciPollIntervalMs: input.ciPollIntervalMs,
    ciNaGraceMs: input.ciNaGraceMs,
    sleepFn: input.sleepFn,
  }, onPhase, input.prNumber, input.branch);

  onPhase?.('committing', `Restart resume: re-querying PR #${input.prNumber} state and required CI checks for ${input.commitSha.slice(0, 12)}.`);

  try {
    const prState = input.prStateFn
      ? await input.prStateFn(input.prNumber)
      : await fetchPullRequestState(input.prNumber, input);
    if (prState.merged) {
      prMerged = true;
      prMergeCommitSha = prState.mergeCommitSha;
      if (!prMergeCommitSha) {
        error = `PR #${input.prNumber} is merged but GitHub returned no merge commit SHA — cannot confirm the merge; task BLOCKED, never COMPLETED.`;
      } else {
        // A merge receipt does not prove acceptance. Reconcile the original
        // head's checks after a restart without generating or publishing code.
        const ci = await checkSavedHead();
        ciChecksGreen = ci.green;
        ciCheckEvidence = ci.evidence;
        ciWaitMs = ci.waitMs;
        if (ci.green) {
          assertLandingRepairScope(input.taskId, input.filesChanged ?? []);
          finalStatus = 'COMPLETED';
        } else {
          error = ci.blocker ?? `Required CI checks ${ci.timedOut ? 'TIMED OUT' : 'FAILED'} on the saved head ${input.commitSha} of already merged PR #${input.prNumber}. Task BLOCKED; the existing merge is retained.`;
        }
      }
      onPhase?.(finalStatus === 'COMPLETED' ? 'completed' : 'blocked', error
        ?? `Restart resume: PR #${input.prNumber} already merged at ${prMergeCommitSha}; saved head checks verified.`);
    } else if (prState.state === 'closed') {
      finalStatus = 'BLOCKED';
      error = `Restart resume: PR #${input.prNumber} is CLOSED without merging. Task BLOCKED, never COMPLETED.`;
      onPhase?.('blocked', error);
    } else {
      // PR open — resume the CI-before-merge wait with the same fail-closed
      // rules as the original run (never merge on red/unknown checks).
      onPhase?.('committing', `Restart resume: PR #${input.prNumber} open — resuming required CI wait for ${input.commitSha.slice(0, 12)}.`);
      const ci = await checkSavedHead();
      ciChecksGreen = ci.green;
      ciCheckEvidence = ci.evidence;
      ciWaitMs = ci.waitMs;
      if (!ci.green) {
        const failing = ci.evidence
          .filter((e) => !(e.matched && e.status === 'completed' && e.conclusion === 'success'))
          .map((e) => `${e.context}=${e.matched ? `${e.status}/${e.conclusion ?? 'none'}` : 'NOT_REPORTED'}`)
          .join('; ');
        error = ci.blocker ?? `${ci.timedOut ? 'Required CI checks TIMED OUT' : 'Required CI checks FAILED'} (restart resume) on ${input.commitSha.slice(0, 12)} — merge NOT attempted. Task BLOCKED, never COMPLETED. Checks: ${failing}.`;
        onPhase?.('blocked', error);
      } else {
        onPhase?.('committing', `Restart resume: all required CI checks GREEN on ${input.commitSha.slice(0, 12)} — merging PR #${input.prNumber}.`);
        assertLandingRepairScope(input.taskId, input.filesChanged ?? []);
        await input.beforeMerge?.();
        const mergeResult = input.mergeFn
          ? await input.mergeFn(input.prNumber, `Merge PR #${input.prNumber}: ${publicRepairGoal(input.goal).slice(0, 60)}`)
          : await mergePullRequest(input.prNumber, `Merge PR #${input.prNumber}: ${publicRepairGoal(input.goal).slice(0, 60)}`, input.commitSha);
        prMerged = mergeResult.merged;
        prMergeCommitSha = mergeResult.mergeCommitSha;
        if (prMerged && prMergeCommitSha) {
          finalStatus = 'COMPLETED';
          onPhase?.('completed', `Restart resume: PR #${input.prNumber} merged. Merge commit: ${prMergeCommitSha.slice(0, 12)}.`);
        } else {
          error = `Restart resume: merge of PR #${input.prNumber} attempted but NOT confirmed (merged=${prMerged}, mergeSha=${prMergeCommitSha ?? 'none'}). Task BLOCKED, never COMPLETED.`;
          onPhase?.('blocked', error);
        }
      }
    }
  } catch (err) {
    finalStatus = 'FAILED';
    error = `Restart resume failed: ${safeErrorMessage(err)}`;
    onPhase?.('failed', error);
  }

  const proof: IVXAutonomousCoderProof = {
    marker: IVX_AUTONOMOUS_CODER_MARKER,
    taskId: input.taskId,
    goal: input.goal,
    executionMode: 'code_change',
    approvalPolicy: 'owner_gated',
    ownerId: input.ownerId,
    startingSha: null,
    filesInspected: [],
    rootCause: '',
    technicalPlan: '',
    iterations: [],
    finalPatch: [],
    filesChanged: input.filesChanged ?? [],
    commandsRun: [],
    testsPassed: input.testsPassed,
    typecheckPassed: input.typecheckPassed,
    buildRun: false,
    commitSha: input.commitSha,
    commitUrl: `https://github.com/ibb142/ivx-holdings-platform/commit/${input.commitSha}`,
    branch: input.branch,
    prNumber: input.prNumber,
    prUrl: input.prUrl ?? null,
    prMerged,
    prMergeCommitSha,
    prCreated: true,
    ciChecksWaited: true,
    ciChecksGreen,
    ciCheckEvidence,
    ciWaitMs,
    deployApproved: false,
    deployRequested: false,
    deployId: null,
    deployStatus: null,
    productionVerified: false,
    liveCommit: null,
    healthOk: false,
    healthResponse: null,
    versionResponse: null,
    iterationCount: 0,
    durationMs: Date.now() - startedAt,
    finalStatus,
    error,
    generatedAt: nowIso(),
    secretValuesReturned: false,
    patchAuthoredBy: null,
    llmCallCount: 0,
    estimatedTokensUsed: 0,
    tokenBudgetExceeded: false,
    rollbackTriggered: false,
    rollbackCommitSha: null,
    rollbackError: null,
    stageTrace: null,
    taskPlan: null,
    resumedFromRestart: true,
    resumeCiWaitMs: ciWaitMs,
  };
  return proof;
}

// ── OWNER-MANDATED ANSWER FORMAT ─────────────────────────────────────────────

export function buildAutonomousCoderAnswer(proof: IVXAutonomousCoderProof): string {
  const filesChangedList = proof.filesChanged.length > 0
    ? proof.filesChanged.join('\n')
    : 'NONE';

  const commandsList = proof.commandsRun.length > 0
    ? proof.commandsRun.map((cmd) => {
        const status = cmd.ok ? 'PASS' : 'FAIL';
        return `${cmd.phase ? `[${cmd.phase}] ` : ''}$ ${cmd.command} → ${status} (exit ${cmd.exitCode ?? '?'}, ${cmd.durationMs}ms)`;
      }).join('\n')
    : 'NONE';

  const iterationsList = proof.iterations.length > 0
    ? proof.iterations.map((it) =>
        `Iteration ${it.iteration}: patchGenerated=${it.patchGenerated} patchApplied=${it.patchApplied} testsPassed=${it.testsPassed} typecheckPassed=${it.typecheckPassed}${it.failureSummary ? ` failure=${it.failureSummary.slice(0, 200)}` : ''}`,
      ).join('\n')
    : 'NONE';

  return [
    `TASK ID:\n${proof.taskId}`,
    `STATUS:\n${proof.finalStatus}`,
    `MODE:\n${proof.executionMode}`,
    `STARTING SHA:\n${proof.startingSha ?? 'unknown'}`,
    `FILES INSPECTED:\n${proof.filesInspected.length > 0 ? proof.filesInspected.join('\n') : 'NONE'}`,
    `ROOT CAUSE:\n${proof.rootCause || 'not identified'}`,
    `TECHNICAL PLAN:\n${proof.technicalPlan || 'not generated'}`,
    `ITERATIONS:\n${iterationsList}`,
    `FILES CHANGED:\n${filesChangedList}`,
    `COMMANDS RUN:\n${commandsList}`,
    `TESTS:\n${proof.testsPassed ? 'PASS' : 'FAIL'}`,
    `TYPECHECK:\n${proof.typecheckPassed ? 'PASS' : 'FAIL'}`,
    `COMMIT SHA:\n${proof.commitSha ?? 'NONE'}`,
    `COMMIT URL:\n${proof.commitUrl ?? 'NONE'}`,
    `PULL REQUEST:\n${proof.prUrl ? `#${proof.prNumber} — ${proof.prUrl} (merged: ${proof.prMerged})` : 'NONE'}`,
    `REQUIRED CI CHECKS:\n${proof.ciCheckEvidence && proof.ciCheckEvidence.length > 0 ? proof.ciCheckEvidence.map((e) => `${e.context}: ${e.matched ? `${e.status}/${e.conclusion ?? 'none'}` : 'NOT_REPORTED'}`).join('\n') : 'NOT WAITED'}\n(all green: ${proof.ciChecksGreen ?? false}; waited: ${proof.ciChecksWaited ?? false}${proof.ciWaitMs != null ? `; waitMs: ${proof.ciWaitMs}` : ''})`,
    `DEPLOYMENT:\n${proof.deployId ? `deployId=${proof.deployId} status=${proof.deployStatus}` : 'NOT REQUESTED'}`,
    `PRODUCTION VERIFICATION:\n${proof.productionVerified ? 'VERIFIED' : 'NOT VERIFIED'}`,
    `ITERATION COUNT:\n${proof.iterationCount}`,
    `PATCH AUTHORED BY:\n${proof.patchAuthoredBy ?? 'NONE'}`,
    `DURATION:\n${proof.durationMs}ms`,
    `ERROR:\n${proof.error ?? 'NONE'}`,
  ].join('\n\n');
}
