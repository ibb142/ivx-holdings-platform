/**
 * IVX Task Execution State Machine
 *
 * Owner mandate 2026-07-20 Phase 1: replace the simplified task status logic
 * with a real 17-state state machine that enforces legal transitions and the
 * owner's completion rules.
 *
 * Rules (enforced in canTransition + assertCanTransition):
 *   - DEPLOYED means only that a deployment occurred.
 *   - VERIFIED means the requested acceptance tests passed.
 *   - A task cannot become VERIFIED from /health alone.
 *   - A development task cannot become VERIFIED when no code changed unless the
 *     system proves that configuration, data, infrastructure, or an external
 *     dependency was the actual cause.
 *   - If no work was completed, status must be BLOCKED, FAILED, or
 *     NO_CHANGE_REQUIRED.
 *   - Never display "development completed" when the code diff is empty.
 *
 * This module is intentionally runtime-free and does NOT import worker types,
 * to avoid circular dependencies.
 */

export const IVX_TASK_STATE_MACHINE_MARKER = 'ivx-task-state-machine-2026-08-23';

export type IVXTaskState =
  | 'RECEIVED'
  | 'ANALYZING'
  | 'REPRODUCING'
  | 'ROOT_CAUSE_IDENTIFIED'
  | 'IMPLEMENTING'
  | 'CODE_CHANGED'
  | 'TESTING'
  | 'QA_REQUIRED'
  | 'QA_IN_PROGRESS'
  | 'READY_TO_DEPLOY'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'PRODUCTION_VERIFYING'
  | 'VERIFIED'
  | 'COMPLETED'
  | 'NOT_COMPLETED'
  | 'BLOCKED'
  | 'FAILED'
  | 'NO_CHANGE_REQUIRED';

export const ALL_TASK_STATES: readonly IVXTaskState[] = [
  'RECEIVED',
  'ANALYZING',
  'REPRODUCING',
  'ROOT_CAUSE_IDENTIFIED',
  'IMPLEMENTING',
  'CODE_CHANGED',
  'TESTING',
  'QA_REQUIRED',
  'QA_IN_PROGRESS',
  'READY_TO_DEPLOY',
  'DEPLOYING',
  'DEPLOYED',
  'PRODUCTION_VERIFYING',
  'VERIFIED',
  'COMPLETED',
  'NOT_COMPLETED',
  'BLOCKED',
  'FAILED',
  'NO_CHANGE_REQUIRED',
] as const;

export const TERMINAL_TASK_STATES: ReadonlySet<IVXTaskState> = new Set([
  'VERIFIED',
  'COMPLETED',
  'NOT_COMPLETED',
  'BLOCKED',
  'FAILED',
  'NO_CHANGE_REQUIRED',
]);

/**
 * Owner mandate 2026-08-23 (false-completion closeout): NOT_COMPLETED is the
 * honest terminal for a task whose requested gates were SKIPPED (e.g. tests or
 * typecheck skipped for a code task). It is NEVER a substitute for FAILED
 * (a gate ran and failed) or BLOCKED (an external prerequisite is missing).
 */

/**
 * Task types that drive the terminal-state completion rules. The guard uses
 * these to decide which gates are required for COMPLETED vs VERIFIED.
 * Owner mandate 2026-07-21: a task must NEVER finish FAILED when its requested
 * gates all succeeded; deploy/feature-verification are only required when
 * deployment was explicitly requested.
 */
export type IVXGuardTaskType =
  | 'CODE_FIX'
  | 'FEATURE'
  | 'UI_FIX'
  | 'DATA_FIX'
  | 'CONFIGURATION_FIX'
  | 'INFRASTRUCTURE_FIX'
  | 'DEPLOYMENT'
  | 'DEPLOY_ONLY'
  | 'QA_ONLY'
  | 'INVESTIGATION'
  | 'CONTENT_REQUEST'
  | 'BUSINESS_ANALYSIS'
  | 'FACTORY';

/**
 * Legal forward transitions. A task may not skip from RECEIVED straight to
 * DEPLOYED or VERIFIED — it must walk the senior-developer loop.
 */
const LEGAL_TRANSITIONS: ReadonlyMap<IVXTaskState, ReadonlySet<IVXTaskState>> = new Map([
  ['RECEIVED', new Set(['ANALYZING', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['ANALYZING', new Set(['REPRODUCING', 'ROOT_CAUSE_IDENTIFIED', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['REPRODUCING', new Set(['ROOT_CAUSE_IDENTIFIED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['ROOT_CAUSE_IDENTIFIED', new Set(['IMPLEMENTING', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['IMPLEMENTING', new Set(['CODE_CHANGED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['CODE_CHANGED', new Set(['TESTING', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['TESTING', new Set(['QA_REQUIRED', 'READY_TO_DEPLOY', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['QA_REQUIRED', new Set(['QA_IN_PROGRESS', 'BLOCKED', 'FAILED'])],
  ['QA_IN_PROGRESS', new Set(['READY_TO_DEPLOY', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['READY_TO_DEPLOY', new Set(['DEPLOYING', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['DEPLOYING', new Set(['DEPLOYED', 'BLOCKED', 'FAILED'])],
  ['DEPLOYED', new Set(['PRODUCTION_VERIFYING', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['PRODUCTION_VERIFYING', new Set(['VERIFIED', 'COMPLETED', 'NOT_COMPLETED', 'BLOCKED', 'FAILED'])],
  ['VERIFIED', new Set()],
  ['COMPLETED', new Set()],
  ['NOT_COMPLETED', new Set()],
  ['BLOCKED', new Set()],
  ['FAILED', new Set()],
  ['NO_CHANGE_REQUIRED', new Set()],
]);

/**
 * Transition guard: verifies a transition is legal per the state machine.
 * Also enforces the owner's completion rules:
 *   - A development task cannot transition to VERIFIED with an empty diff
 *     unless an external cause is proven.
 *   - A task cannot transition to VERIFIED from /health alone (requires
 *     featureVerificationOk).
 *   - A task cannot transition to VERIFIED with no deployment for development
 *     tasks.
 */
export type IVXTransitionGuardInput = {
  from: IVXTaskState;
  to: IVXTaskState;
  isDevelopmentTask: boolean;
  filesChangedCount: number;
  testsRun: boolean;
  testsPassed: boolean;
  deployId: string | null;
  productionHealthOk: boolean;
  featureVerificationOk: boolean | null;
  externalCauseProven: boolean;
  /** Owner mandate 2026-07-21: whether deployment was explicitly requested.
   *  When false, a CODE_CHANGE task may reach COMPLETED without deployId /
   *  productionHealthOk / featureVerificationOk. Defaults to false (treat
   *  missing as "deploy not requested") so legacy callers keep working. */
  deployRequested?: boolean;
  /** Whether a targeted typecheck was run and passed. Required for COMPLETED
   *  on development tasks. Defaults to false. */
  typecheckPassed?: boolean;
  /** Whether the GitHub commit was created and verified (commitSha present).
   *  Required for COMPLETED on development tasks and DEPLOY_ONLY. */
  commitVerified?: boolean;
  /** Task type used to decide which gates apply for COMPLETED. Falls back to
   *  isDevelopmentTask for legacy callers. */
  taskType?: IVXGuardTaskType;
  /** Owner mandate 2026-08-23 (false-completion closeout): a pull request was
   *  created for the commit. Required for COMPLETED on code tasks. */
  prCreated?: boolean | null;
  /** PR number of the created pull request. */
  prNumber?: number | null;
  /** ALL required GitHub checks on the PR head SHA reported success. Required
   *  for COMPLETED on code tasks (CI-before-merge mandate). */
  requiredChecksGreen?: boolean | null;
  /** The PR merge was confirmed by GitHub (merged=true). Required for COMPLETED
   *  on code tasks — commit exists + PR not merged = BLOCKED, never COMPLETED. */
  prMerged?: boolean | null;
  /** Merge commit SHA returned by GitHub on merge confirmation. Required when
   *  prMerged is true — merge attempted but not confirmed = BLOCKED. */
  mergeSha?: string | null;
  /** Owner approval for the deploy was verified (deploy mode). When deploy was
   *  requested and this is false, the task is BLOCKED, never COMPLETED. */
  deployApproved?: boolean | null;
  /** The deploy attempt failed after approval → FAILED. */
  deployFailed?: boolean | null;
  /** Production /version SHA matches the expected (merge) SHA. Mismatch →
   *  FAILED/BLOCKED, never COMPLETED. */
  productionShaMatches?: boolean | null;
  /** Tests were skipped under a formally allowed task type (recorded
   *  justification). When false/absent, skipped tests refuse COMPLETED. */
  testsSkipJustified?: boolean;
};

/**
 * Owner mandate 2026-08-23 (false-completion closeout): compute the honest
 * terminal state when the state machine refused a success terminal
 * (COMPLETED/VERIFIED). Category → state mapping is fail-closed:
 *   - skipped gates (tests/typecheck)           → NOT_COMPLETED
 *   - deploy failed / production SHA mismatch    → FAILED
 *   - missing external prerequisite (PR, CI,
 *     approval, merge confirmation, credentials) → BLOCKED
 *   - anything unrecognized                       → FAILED (never COMPLETED)
 */
export function terminalStateForRefusedCompletion(reasons: readonly string[]): IVXTaskState {
  const text = reasons.join('; ');
  if (/tests were skipped|typecheck was skipped|typecheck was not run/i.test(text)) return 'NOT_COMPLETED';
  if (/deploy failed|sha mismatch|production .{0,24}mismatch|rollback/i.test(text)) return 'FAILED';
  if (/pull request|pr |ci check|required check|approval|not merged|not confirmed|merge was not|token|credential|missing/i.test(text)) return 'BLOCKED';
  if (/tests failed|typecheck failed|failed/i.test(text)) return 'FAILED';
  return 'FAILED';
}

export type IVXTransitionGuardResult = {
  ok: boolean;
  legal: boolean;
  reasons: string[];
  from: IVXTaskState;
  to: IVXTaskState;
};

export function isTerminalTaskState(state: IVXTaskState): boolean {
  return TERMINAL_TASK_STATES.has(state);
}

export function canTransition(from: IVXTaskState, to: IVXTaskState): boolean {
  const allowed = LEGAL_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

export function assertCanTransition(input: IVXTransitionGuardInput): IVXTransitionGuardResult {
  const reasons: string[] = [];
  const { from, to } = input;

  // Check structural legality first.
  if (!canTransition(from, to)) {
    reasons.push(`Illegal transition: ${from} -> ${to} is not a permitted forward transition.`);
    return { ok: false, legal: false, reasons, from, to };
  }

  // Owner mandate 2026-07-21: COMPLETED is the honest success terminal for
  // tasks that fulfilled all REQUESTED gates but did not deploy / run feature
  // verification (e.g. "commit but do not deploy"). VERIFIED remains the
  // success terminal only for the full deploy + production-verify path.
  if (to === 'COMPLETED') {
    const tt = input.taskType;
    const isDev = input.isDevelopmentTask || tt === 'CODE_FIX' || tt === 'FEATURE' || tt === 'UI_FIX' || tt === 'DATA_FIX';
    const isReadOnly = tt === 'INVESTIGATION';
    const isQaOnly = tt === 'QA_ONLY';
    const isDeployOnly = tt === 'DEPLOY_ONLY';

    if (isDev) {
      // CODE_CHANGE + NO_DEPLOY: PATCH + TESTS + TYPECHECK + COMMIT + GITHUB_VERIFY = COMPLETED
      // CODE_CHANGE + DEPLOY: must go through VERIFIED, not COMPLETED.
      if (input.deployRequested) {
        reasons.push('A development task with deploy requested must reach VERIFIED via PRODUCTION_VERIFYING, not COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.filesChangedCount === 0) {
        reasons.push('A development task cannot become COMPLETED with an empty diff.');
        return { ok: false, legal: true, reasons, from, to };
      }
      // Tests gate: owner mandate 2026-08-23 — tests SKIPPED on a code task
      // refuse COMPLETED (NOT_COMPLETED) unless the skip is formally justified
      // by an allowed task type. When tests ran, they must pass.
      if (!input.testsRun && input.testsSkipJustified !== true) {
        reasons.push('Tests were skipped for a code task without a formally allowed justification — NOT_COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.testsRun && !input.testsPassed) {
        reasons.push('Files changed but tests failed — cannot become COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.typecheckPassed !== true) {
        reasons.push('Typecheck was skipped or failed for a code task — NOT_COMPLETED (typecheck is a hard gate).');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (!input.commitVerified) {
        reasons.push('Commit was not created / verified — cannot become COMPLETED for a development task.');
        return { ok: false, legal: true, reasons, from, to };
      }
      // Owner mandate 2026-08-23 (false-completion closeout): a code task may
      // only become COMPLETED when its commit reached main through a PULL
      // REQUEST whose required CI checks were GREEN and whose merge was
      // CONFIRMED by GitHub. Commit exists + PR not merged = BLOCKED.
      if (input.prCreated !== true) {
        reasons.push('Pull request was not created for the commit — BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.requiredChecksGreen !== true) {
        reasons.push('Required CI checks on the PR head SHA are not all green (CI-before-merge mandate) — BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.prMerged !== true) {
        reasons.push('Commit exists but the pull request was not merged — BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (!input.mergeSha) {
        reasons.push('Merge was attempted but not confirmed (no merge commit SHA from GitHub) — BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      // Deploy + production health + feature verification are NOT required
      // when deploy was not requested. Do not push any reason for them.
    } else if (isReadOnly) {
      // READ_ONLY: INSPECTION + FINDINGS = COMPLETED. No patch/commit/deploy.
      if (input.filesChangedCount > 0) {
        reasons.push('A read-only task cannot become COMPLETED with files changed.');
        return { ok: false, legal: true, reasons, from, to };
      }
    } else if (isQaOnly) {
      // QA_ONLY: TARGETED TESTS + RESULTS = COMPLETED. No patch/commit/deploy.
      if (!input.testsRun) {
        reasons.push('A QA-only task cannot become COMPLETED without targeted tests.');
        return { ok: false, legal: true, reasons, from, to };
      }
    } else if (isDeployOnly) {
      // DEPLOY_ONLY: VERIFIED COMMIT + DEPLOY + HEALTH = COMPLETED.
      if (!input.commitVerified) {
        reasons.push('A deploy-only task cannot become COMPLETED without a verified commit.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.deployApproved !== true) {
        reasons.push('A deploy-only task cannot become COMPLETED without verified owner approval for the deploy — BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.deployFailed === true) {
        reasons.push('Deploy failed — FAILED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (!input.deployId) {
        reasons.push('A deploy-only task cannot become COMPLETED without a deployId.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.productionShaMatches === false) {
        reasons.push('Production SHA mismatch after deploy — FAILED/BLOCKED, never COMPLETED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (!input.productionHealthOk) {
        reasons.push('A deploy-only task cannot become COMPLETED without production health confirmed.');
        return { ok: false, legal: true, reasons, from, to };
      }
    }
    // FACTORY tasks: require commitVerified + filesChangedCount > 0 to be COMPLETED.
    if (tt === 'FACTORY') {
      if (input.filesChangedCount === 0) {
        reasons.push('A factory task cannot become COMPLETED with no files created.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (!input.commitVerified) {
        reasons.push('A factory task cannot become COMPLETED without a verified commit.');
        return { ok: false, legal: true, reasons, from, to };
      }
    }
  }

  // Enforce completion rules on entry to VERIFIED.
  if (to === 'VERIFIED') {
    // Owner mandate 2026-08-23 (false-completion closeout): deploy gates.
    if (input.deployApproved !== true) {
      reasons.push('Deploy requested without verified owner approval — BLOCKED, never VERIFIED.');
      return { ok: false, legal: true, reasons, from, to };
    }
    if (input.deployFailed === true) {
      reasons.push('Deploy failed — FAILED, never VERIFIED.');
      return { ok: false, legal: true, reasons, from, to };
    }
    if (input.productionShaMatches === false) {
      reasons.push('Production SHA mismatch — FAILED/BLOCKED, never VERIFIED.');
      return { ok: false, legal: true, reasons, from, to };
    }
    if (input.isDevelopmentTask) {
      if (input.filesChangedCount === 0 && !input.externalCauseProven) {
        reasons.push(
          'A development task cannot become VERIFIED when no code changed unless an external cause (config/data/infra) is proven.',
        );
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.filesChangedCount === 0 && input.externalCauseProven && !input.deployId) {
        reasons.push('External-cause development task requires a deployment before VERIFIED.');
        return { ok: false, legal: true, reasons, from, to };
      }
      if (input.filesChangedCount > 0) {
        if (!input.testsRun) {
          reasons.push('Files changed but tests were not run — cannot become VERIFIED.');
          return { ok: false, legal: true, reasons, from, to };
        }
        if (!input.testsPassed) {
          reasons.push('Files changed but tests failed — cannot become VERIFIED.');
          return { ok: false, legal: true, reasons, from, to };
        }
        if (!input.deployId) {
          reasons.push('Files changed but no deployment occurred — cannot become VERIFIED.');
          return { ok: false, legal: true, reasons, from, to };
        }
        // The code must reach main through a merged PR before a deploy VERIFIED
        // terminal (owner mandate 2026-08-23).
        if (input.prMerged !== true) {
          reasons.push('Files changed but the pull request was not merged before deploy — BLOCKED, never VERIFIED.');
          return { ok: false, legal: true, reasons, from, to };
        }
        if (!input.productionHealthOk) {
          reasons.push('Files changed but production health is not confirmed — cannot become VERIFIED.');
          return { ok: false, legal: true, reasons, from, to };
        }
      }
    }
    // A task cannot become VERIFIED from /health alone.
    if (input.featureVerificationOk === false) {
      reasons.push('Feature verification failed — a task cannot become VERIFIED from /health alone.');
      return { ok: false, legal: true, reasons, from, to };
    }
    if (input.featureVerificationOk === null && input.isDevelopmentTask) {
      reasons.push('Feature verification was not performed — cannot become VERIFIED without it.');
      return { ok: false, legal: true, reasons, from, to };
    }
  }

  // Enforce entry to DEPLOYED: requires a deployId.
  if (to === 'DEPLOYED' && !input.deployId) {
    reasons.push('Cannot enter DEPLOYED without a deployId.');
    return { ok: false, legal: true, reasons, from, to };
  }

  // Enforce entry to CODE_CHANGED: requires filesChangedCount > 0.
  if (to === 'CODE_CHANGED' && input.filesChangedCount === 0) {
    reasons.push('Cannot enter CODE_CHANGED with an empty diff — never display "development completed" when the code diff is empty.');
    return { ok: false, legal: true, reasons, from, to };
  }

  return { ok: true, legal: true, reasons: [], from, to };
}

/**
 * Compute the honest terminal state when no work was completed.
 * Per the owner: "If no work was completed, status must be BLOCKED, FAILED, or
 * NO_CHANGE_REQUIRED."
 */
export function terminalStateForNoWork(
  deployId: string | null,
  productionHealthOk: boolean,
  error: string | null,
): IVXTaskState {
  if (error && /blocked|missing|denied|revoked|expired|unauthorized/i.test(error)) {
    return 'BLOCKED';
  }
  if (error) {
    return 'FAILED';
  }
  if (deployId && productionHealthOk) {
    // A redeploy occurred but no code changed — honest state is NO_CHANGE_REQUIRED,
    // NOT VERIFIED. The completion validator will report DEPLOYED_ONLY.
    return 'NO_CHANGE_REQUIRED';
  }
  return 'NO_CHANGE_REQUIRED';
}

/**
 * The 18-step senior-developer loop. Each step maps to a state transition.
 * This is the canonical sequence — the worker must not skip from request to
 * deployment.
 */
export const SENIOR_DEVELOPER_LOOP_STEPS: readonly { step: number; name: string; enterState: IVXTaskState }[] = [
  { step: 1, name: 'Understand the requested behavior', enterState: 'ANALYZING' },
  { step: 2, name: 'Retrieve relevant project context', enterState: 'ANALYZING' },
  { step: 3, name: 'Inspect the actual code', enterState: 'ANALYZING' },
  { step: 4, name: 'Locate related files and services', enterState: 'ANALYZING' },
  { step: 5, name: 'Reproduce the problem', enterState: 'REPRODUCING' },
  { step: 6, name: 'Record baseline behavior', enterState: 'REPRODUCING' },
  { step: 7, name: 'Identify the root cause', enterState: 'ROOT_CAUSE_IDENTIFIED' },
  { step: 8, name: 'Create an implementation plan', enterState: 'ROOT_CAUSE_IDENTIFIED' },
  { step: 9, name: 'Modify the correct files', enterState: 'IMPLEMENTING' },
  { step: 10, name: 'Run static checks', enterState: 'TESTING' },
  { step: 11, name: 'Run unit and integration tests', enterState: 'TESTING' },
  { step: 12, name: 'Run targeted regression tests', enterState: 'TESTING' },
  { step: 13, name: 'Build the application', enterState: 'TESTING' },
  { step: 14, name: 'Test on the required platform', enterState: 'QA_IN_PROGRESS' },
  { step: 15, name: 'Commit the changes', enterState: 'READY_TO_DEPLOY' },
  { step: 16, name: 'Deploy the exact commit', enterState: 'DEPLOYING' },
  { step: 17, name: 'Verify production behavior', enterState: 'PRODUCTION_VERIFYING' },
  { step: 18, name: 'Return evidence and remaining risks', enterState: 'VERIFIED' },
] as const;

/**
 * Map a worker stage name to a task state. This bridges the worker's
 * free-form stage strings to the canonical state machine.
 */
export function stageToTaskState(stage: string | null | undefined): IVXTaskState {
  const s = (stage ?? '').toUpperCase().replace(/[^A-Z_]/g, '_');
  if (s.includes('RECEIVED') || s.includes('QUEUED') || s.includes('PENDING')) return 'RECEIVED';
  if (s.includes('ANALYZ') || s.includes('INSPECT') || s.includes('INDEX')) return 'ANALYZING';
  if (s.includes('REPRODUC') || s.includes('BASELINE')) return 'REPRODUCING';
  if (s.includes('ROOT_CAUSE') || s.includes('ROOTCAUSE') || s.includes('PLAN')) return 'ROOT_CAUSE_IDENTIFIED';
  if (s.includes('IMPLEMENT') || s.includes('PATCH') || s.includes('EDIT')) return 'IMPLEMENTING';
  if (s.includes('CODE_CHANGED') || s.includes('CODECHANGE')) return 'CODE_CHANGED';
  if (s.includes('TEST')) return 'TESTING';
  if (s.includes('QA_REQUIRED') || s.includes('QAREQUIRED')) return 'QA_REQUIRED';
  if (s.includes('QA_IN_PROGRESS') || s.includes('QAINPROGRESS') || s.includes('QA')) return 'QA_IN_PROGRESS';
  if (s.includes('READY_TO_DEPLOY') || s.includes('READYTODEPLOY') || s.includes('READY')) return 'READY_TO_DEPLOY';
  if (s.includes('DEPLOYING') || s.includes('DEPLOY_IN_PROGRESS')) return 'DEPLOYING';
  if (s.includes('DEPLOYED') && !s.includes('VERIFY')) return 'DEPLOYED';
  if (s.includes('PRODUCTION_VERIFY') || s.includes('VERIFYING') || s.includes('VERIFY')) return 'PRODUCTION_VERIFYING';
  if (s.includes('NOT_COMPLETED')) return 'NOT_COMPLETED';
  if (s.includes('COMPLETED')) return 'COMPLETED';
  if (s.includes('VERIFIED') || s.includes('COMPLETE')) return 'VERIFIED';
  if (s.includes('BLOCKED')) return 'BLOCKED';
  if (s.includes('FAILED') || s.includes('ERROR')) return 'FAILED';
  if (s.includes('NO_CHANGE') || s.includes('NOCHANGE')) return 'NO_CHANGE_REQUIRED';
  return 'RECEIVED';
}
