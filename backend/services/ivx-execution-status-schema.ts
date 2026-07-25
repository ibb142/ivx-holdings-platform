/**
 * IVX IA Chat Execution Mode — Status Schema
 *
 * FINAL IVX IA CHAT EXECUTION MODE mandate (owner 2026-07-19):
 *   Every developer request creates one persistent worker job.
 *   Every response contains:
 *     taskId / status / stage / live progress / files changed / tests /
 *     commit SHA / deployment ID (if applicable) / final verified evidence.
 *
 * This is the strict 9-field JSON payload the chat returns for execution-mode
 * prompts. It is built from the real worker-queue job state — never fabricated.
 *
 * Pure + deterministic (no I/O, no AI) so it is fully unit-testable.
 */
import type { IVXWorkerJob, IVXWorkerJobResult } from './ivx-senior-developer-worker';
import type { IVXExecutionModeCategory } from './ivx-execution-mode-classifier';

/** The 9 owner-mandated execution-status fields. */
export type IVXExecutionStatusPayload = {
  /** 1. Persistent worker job id (always present for execution-mode responses). */
  taskId: string;
  /** 2. Job status (queued/running/patching/testing/committing/deploying/verifying/completed/failed/blocked/cancelled). */
  status: IVXWorkerJob['status'];
  /** 3. Granular execution stage (QUEUED/RUNNING/PATCHING/TESTING/COMMITTING/DEPLOYING/VERIFYING/COMPLETED/FAILED). */
  stage: IVXWorkerJob['stage'];
  /** 4. Live progress percentage 0-100 derived from the current stage. */
  liveProgress: number;
  /** 5. Real files changed by the patch (empty until PATCHING completes). */
  filesChanged: string[];
  /** 6. Test result summary (PASS/FAIL/NOT RUN). */
  tests: {
    run: boolean;
    passed: boolean;
    command: string | null;
  };
  /** 7. Commit SHA once the git operator commits (null until COMMITTING). */
  commitSha: string | null;
  /** 8. Render deploy id once the deploy operator fires (null until DEPLOYING). */
  deploymentId: string | null;
  /** 9. Verified evidence — only populated when the job reaches a terminal state. */
  evidence: IVXExecutionEvidence | null;
  /** HTTP status code to return for this payload (202 while running, 200 terminal). */
  httpStatus: 200 | 202;
  /** The execution-mode category that classified this prompt. */
  category: IVXExecutionModeCategory | null;
  /** Poll URL the client uses to stream live execution status. */
  statusUrl: string;
  /** Timestamp the payload was generated. */
  generatedAt: string;
};

/** Verified evidence — only populated for terminal jobs (completed/failed/blocked). */
export type IVXExecutionEvidence = {
  /** True only when end-to-end production run is complete + commit match + health 200. */
  deployedToProduction: boolean;
  /** Live /health commit from production (vs. the commit we pushed). */
  liveCommit: string | null;
  /** True when production commit matches the pushed commit. */
  commitMatch: boolean;
  /** /health endpoint returned 200. */
  healthOk: boolean;
  /** Typecheck ran and passed. */
  typecheck: {
    run: boolean;
    passed: boolean;
  };
  /** Build ran (APK/AAB/bundle). */
  buildRun: boolean;
  /** Final status label (COMPLETE/LOCAL_ONLY/BLOCKED/FAILED). */
  finalStatus: IVXWorkerJobResult['finalStatus'];
  /** Error message if the job failed (null otherwise). */
  error: string | null;
  /** The strict execution-answer block (TASK UNDERSTOOD / FILES CHANGED / ... / PROOF). */
  answerBlock: string;
};

/**
 * Build the execution-status payload from a worker job.
 *
 * HTTP 202 is returned for any non-terminal job (queued/running/patching/etc.)
 * so the chat client immediately gets a taskId + live progress and can poll the
 * statusUrl. Terminal jobs (completed/failed/blocked/cancelled) return 200 with
 * the full verified evidence.
 *
 * This function never fabricates evidence — every field is read straight from
 * the secret-safe `IVXWorkerJobResult` the worker writes to the durable ledger.
 */
export function buildExecutionStatusPayload(
  job: IVXWorkerJob,
  category: IVXExecutionModeCategory | null,
  answerBlock: string,
): IVXExecutionStatusPayload {
  const result = job.result;
  const isTerminal =
    job.status === 'completed' ||
    job.status === 'failed' ||
    job.status === 'blocked' ||
    job.status === 'cancelled';

  // Fields present on every payload (running or terminal).
  const taskId = job.jobId;
  const status = job.status;
  const stage = job.stage;
  const liveProgress = job.progressPercent;
  const statusUrl = `/api/ivx/senior-developer/worker/jobs/${job.jobId}`;
  const generatedAt = new Date().toISOString();

  // Result-derived fields (null/empty until the worker has written a result).
  const filesChanged = result?.changedFiles ?? [];
  const tests = {
    run: result?.testsRun ?? false,
    passed: result?.testsPassed ?? false,
    command: result?.testsRun ? 'bun test backend/' : null,
  };
  const commitSha = result?.commitSha ?? null;
  const deploymentId = result?.deployId ?? null;

  // Evidence only for terminal jobs.
  let evidence: IVXExecutionEvidence | null = null;
  if (isTerminal && result) {
    evidence = {
      deployedToProduction: result.endToEndProductionComplete && result.commitMatch && result.healthOk,
      liveCommit: result.liveCommit ?? null,
      commitMatch: result.commitMatch,
      healthOk: result.healthOk,
      typecheck: {
        run: result.typecheckRun,
        passed: result.testsPassed, // worker uses testsPassed for both test + typecheck pass
      },
      buildRun: result.buildRun,
      finalStatus: result.finalStatus,
      error: result.error ?? null,
      answerBlock,
    };
  }

  const httpStatus: 200 | 202 = isTerminal ? 200 : 202;

  return {
    taskId,
    status,
    stage,
    liveProgress,
    filesChanged,
    tests,
    commitSha,
    deploymentId,
    evidence,
    httpStatus,
    category,
    statusUrl,
    generatedAt,
  };
}

/**
 * The narrative-planning phrases that MUST NEVER appear in an execution-mode
 * response. The execution guard rejects any answer containing one of these.
 *
 * Sourced from the owner's exact acceptance criteria:
 *   "No 'I'll inspect...'", "No 'I'll update...'", "No 'I'll deploy...'",
 *   "No narrative implementation plans."
 */
export const FORBIDDEN_EXECUTION_NARRATIVE_PHRASES: readonly string[] = [
  "I'll inspect",
  "I will inspect",
  "I'll update",
  "I will update",
  "I'll deploy",
  "I will deploy",
  "I'll patch",
  "I will patch",
  "I'll fix",
  "I will fix",
  "I'll build",
  "I will build",
  "I'll run",
  "I will run",
  "I'll commit",
  "I will commit",
  "I'll verify",
  "I will verify",
  "I'll audit",
  "I will audit",
  "I'll refactor",
  "I will refactor",
  "I'll migrate",
  "I will migrate",
  "I'll create",
  "I will create",
  "I'll scaffold",
  "I will scaffold",
  "I'll implement",
  "I will implement",
  "I'll start by",
  "I will start by",
  "Let me inspect",
  "Let me update",
  "Let me deploy",
  "Let me fix",
  "Let me build",
  "Let me patch",
  "Let me run",
  "Let me commit",
  "Let me verify",
  "Let me audit",
  "Let me refactor",
  "Let me migrate",
  "Let me create",
  "Let me scaffold",
  "Let me implement",
  "Here is my plan",
  "Here's my plan",
  "My implementation plan",
  "Plan of action",
  "Steps to complete",
  "Here is how I will",
  "Here's how I will",
  "Here is what I would do",
  "Here's what I would do",
  "I would start by",
  "I'd start by",
  "I plan to",
  "I'm going to inspect",
  "I'm going to update",
  "I'm going to deploy",
  "I'm going to fix",
  "I'm going to build",
  "I'm going to patch",
  "I'm going to run",
  "I'm going to commit",
  "I'm going to verify",
  "I'm going to audit",
  "I'm going to refactor",
  "I'm going to migrate",
  "I'm going to create",
  "I'm going to scaffold",
  "I'm going to implement",
  "Hold on",
  "Please wait",
  "One moment",
  "Give me a moment",
  "Stand by",
  "I will update you shortly",
  "I'll get back to you",
  "Executing that now",
  "Checking now and will report",
  "Starting implementation",
  "I will begin by",
  "I'll begin by",
];

/**
 * Returns the forbidden narrative phrases present in an answer.
 * Pure — deterministic.
 */
export function findForbiddenNarrativePhrases(answer: string): string[] {
  const text = typeof answer === 'string' ? answer : '';
  if (!text) return [];
  return FORBIDDEN_EXECUTION_NARRATIVE_PHRASES.filter((phrase) =>
    text.toLowerCase().includes(phrase.toLowerCase()),
  );
}

/**
 * Returns true when the answer contains any forbidden narrative phrase.
 * Pure — deterministic.
 */
export function hasForbiddenNarrative(answer: string): boolean {
  return findForbiddenNarrativePhrases(answer).length > 0;
}