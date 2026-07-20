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

export const IVX_TASK_STATE_MACHINE_MARKER = 'ivx-task-state-machine-2026-07-20';

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
  'BLOCKED',
  'FAILED',
  'NO_CHANGE_REQUIRED',
] as const;

export const TERMINAL_TASK_STATES: ReadonlySet<IVXTaskState> = new Set([
  'VERIFIED',
  'BLOCKED',
  'FAILED',
  'NO_CHANGE_REQUIRED',
]);

/**
 * Legal forward transitions. A task may not skip from RECEIVED straight to
 * DEPLOYED or VERIFIED — it must walk the senior-developer loop.
 */
const LEGAL_TRANSITIONS: ReadonlyMap<IVXTaskState, ReadonlySet<IVXTaskState>> = new Map([
  ['RECEIVED', new Set(['ANALYZING', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['ANALYZING', new Set(['REPRODUCING', 'ROOT_CAUSE_IDENTIFIED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['REPRODUCING', new Set(['ROOT_CAUSE_IDENTIFIED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['ROOT_CAUSE_IDENTIFIED', new Set(['IMPLEMENTING', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['IMPLEMENTING', new Set(['CODE_CHANGED', 'BLOCKED', 'FAILED', 'NO_CHANGE_REQUIRED'])],
  ['CODE_CHANGED', new Set(['TESTING', 'BLOCKED', 'FAILED'])],
  ['TESTING', new Set(['QA_REQUIRED', 'READY_TO_DEPLOY', 'BLOCKED', 'FAILED'])],
  ['QA_REQUIRED', new Set(['QA_IN_PROGRESS', 'BLOCKED', 'FAILED'])],
  ['QA_IN_PROGRESS', new Set(['READY_TO_DEPLOY', 'BLOCKED', 'FAILED'])],
  ['READY_TO_DEPLOY', new Set(['DEPLOYING', 'BLOCKED', 'FAILED'])],
  ['DEPLOYING', new Set(['DEPLOYED', 'BLOCKED', 'FAILED'])],
  ['DEPLOYED', new Set(['PRODUCTION_VERIFYING', 'BLOCKED', 'FAILED'])],
  ['PRODUCTION_VERIFYING', new Set(['VERIFIED', 'BLOCKED', 'FAILED'])],
  ['VERIFIED', new Set()],
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
};

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

  // Enforce completion rules on entry to VERIFIED.
  if (to === 'VERIFIED') {
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
  if (s.includes('VERIFIED') || s.includes('COMPLETE')) return 'VERIFIED';
  if (s.includes('BLOCKED')) return 'BLOCKED';
  if (s.includes('FAILED') || s.includes('ERROR')) return 'FAILED';
  if (s.includes('NO_CHANGE') || s.includes('NOCHANGE')) return 'NO_CHANGE_REQUIRED';
  return 'RECEIVED';
}
