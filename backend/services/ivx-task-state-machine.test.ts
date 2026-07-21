/**
 * Phase 1: Task execution state machine — 18 states + legal transitions.
 * Owner mandate 2026-07-21: added COMPLETED terminal state for commit-only /
 * QA-only / read-only / factory tasks that fulfilled all REQUESTED gates but
 * did not deploy. A task must NEVER finish FAILED when its requested gates
 * all succeeded.
 */
import { describe, expect, test } from 'bun:test';
import {
  assertCanTransition,
  canTransition,
  isTerminalTaskState,
  stageToTaskState,
  terminalStateForNoWork,
  ALL_TASK_STATES,
  TERMINAL_TASK_STATES,
} from './ivx-task-state-machine';
import { createInMemoryLeaseStore } from './ivx-duplicate-worker-prevention';

describe('IVX Task State Machine', () => {
  test('has exactly 18 states', () => {
    expect(ALL_TASK_STATES.length).toBe(18);
  });

  test('RECEIVED cannot skip to DEPLOYED', () => {
    expect(canTransition('RECEIVED', 'DEPLOYED')).toBe(false);
  });

  test('RECEIVED cannot skip to VERIFIED', () => {
    expect(canTransition('RECEIVED', 'VERIFIED')).toBe(false);
  });

  test('RECEIVED -> ANALYZING is legal', () => {
    expect(canTransition('RECEIVED', 'ANALYZING')).toBe(true);
  });

  test('CODE_CHANGED requires filesChangedCount > 0', () => {
    const r = assertCanTransition({
      from: 'IMPLEMENTING', to: 'CODE_CHANGED',
      isDevelopmentTask: true, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('empty diff');
  });

  test('VERIFIED requires feature verification for dev tasks', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: null, externalCauseProven: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('Feature verification was not performed');
  });

  test('VERIFIED rejected when feature verification failed', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: false, externalCauseProven: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('Feature verification failed');
  });

  test('VERIFIED rejected when dev task has no code change and no external cause', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: true, externalCauseProven: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('no code changed unless an external cause');
  });

  test('VERIFIED allowed for dev task with code change + tests + deploy + feature verification', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: true, externalCauseProven: false,
    });
    expect(r.ok).toBe(true);
  });

  test('VERIFIED allowed for external-cause dev task with deploy + feature verification', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: true, externalCauseProven: true,
    });
    expect(r.ok).toBe(true);
  });

  test('DEPLOYED requires deployId', () => {
    const r = assertCanTransition({
      from: 'DEPLOYING', to: 'DEPLOYED',
      isDevelopmentTask: true, filesChangedCount: 1,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('deployId');
  });

  test('terminal states are terminal', () => {
    expect(isTerminalTaskState('VERIFIED')).toBe(true);
    expect(isTerminalTaskState('COMPLETED')).toBe(true);
    expect(isTerminalTaskState('BLOCKED')).toBe(true);
    expect(isTerminalTaskState('FAILED')).toBe(true);
    expect(isTerminalTaskState('NO_CHANGE_REQUIRED')).toBe(true);
    expect(isTerminalTaskState('DEPLOYED')).toBe(false);
    expect(TERMINAL_TASK_STATES.size).toBe(5);
  });

  test('terminalStateForNoWork returns BLOCKED for auth errors', () => {
    expect(terminalStateForNoWork(null, false, 'token expired or revoked')).toBe('BLOCKED');
  });

  test('terminalStateForNoWork returns FAILED for generic errors', () => {
    expect(terminalStateForNoWork(null, false, 'build failed')).toBe('FAILED');
  });

  test('terminalStateForNoWork returns NO_CHANGE_REQUIRED for redeploy with no code', () => {
    expect(terminalStateForNoWork('dep-1', true, null)).toBe('NO_CHANGE_REQUIRED');
  });

  test('stageToTaskState maps worker stages', () => {
    expect(stageToTaskState('VERIFYING')).toBe('PRODUCTION_VERIFYING');
    expect(stageToTaskState('DEPLOYED')).toBe('DEPLOYED');
    expect(stageToTaskState('COMPLETED')).toBe('COMPLETED');
    expect(stageToTaskState('BLOCKED')).toBe('BLOCKED');
    expect(stageToTaskState('FAILED')).toBe('FAILED');
    expect(stageToTaskState('')).toBe('RECEIVED');
  });

  test('in-memory lease store: acquire + renew + release', () => {
    const store = createInMemoryLeaseStore();
    const lease = store.acquire('job-1', 'worker-a', 60000);
    expect(lease).not.toBe(null);
    // Another worker cannot acquire.
    expect(store.acquire('job-1', 'worker-b', 60000)).toBe(null);
    // Same worker can renew.
    expect(store.renew('job-1', 'worker-a', 60000)).not.toBe(null);
    // Wrong worker cannot release.
    expect(store.release('job-1', 'worker-b')).toBe(false);
    // Owner worker can release.
    expect(store.release('job-1', 'worker-a')).toBe(true);
    expect(store.current('job-1')).toBe(null);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Owner mandate 2026-07-21: terminal-state completion rules.
// A task must NEVER finish FAILED when its REQUESTED gates all succeeded.
// CODE_CHANGE + NO_DEPLOY: PATCH + TESTS + TYPECHECK + COMMIT + GITHUB_VERIFY = COMPLETED
// CODE_CHANGE + DEPLOY:     PATCH + TESTS + TYPECHECK + COMMIT + DEPLOY + PRODUCTION_VERIFY = COMPLETED (via VERIFIED)
// READ_ONLY:                INSPECTION + FINDINGS = COMPLETED
// QA_ONLY:                  TARGETED TESTS + RESULTS = COMPLETED
// DEPLOY_ONLY:              VERIFIED COMMIT + DEPLOY + HEALTH = COMPLETED
// ─────────────────────────────────────────────────────────────────────────────
describe('IVX Terminal State Completion Rules (owner mandate 2026-07-21)', () => {
  test('1. Commit requested, deploy not requested → COMPLETED after commit verification', () => {
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: true, commitVerified: true, taskType: 'CODE_FIX',
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('2. Deploy requested → not COMPLETED/VERIFIED until deploy + production verify pass', () => {
    // COMPLETED is rejected when deployRequested=true (must go via VERIFIED).
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: true, typecheckPassed: true, commitVerified: true, taskType: 'CODE_FIX',
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('deploy requested must reach VERIFIED');
    // And VERIFIED is rejected without deployId + health + feature verification.
    const r2 = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'VERIFIED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
    });
    expect(r2.ok).toBe(false);
  });

  test('3. Read-only task → COMPLETED with no patch/commit/deploy', () => {
    const r = assertCanTransition({
      from: 'ANALYZING', to: 'COMPLETED',
      isDevelopmentTask: false, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: false, commitVerified: false, taskType: 'INVESTIGATION',
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('4. QA-only task → COMPLETED after targeted tests, no patch', () => {
    const r = assertCanTransition({
      from: 'QA_IN_PROGRESS', to: 'COMPLETED',
      isDevelopmentTask: false, filesChangedCount: 0,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: true, commitVerified: false, taskType: 'QA_ONLY',
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('5. Commit succeeds but tests fail → not COMPLETED (FAILED)', () => {
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: false, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: true, commitVerified: true, taskType: 'CODE_FIX',
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('tests failed');
  });

  test('6. Commit succeeds and GitHub verification passes → COMPLETED', () => {
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: true, filesChangedCount: 1,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: true, commitVerified: true, taskType: 'CODE_FIX',
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('7. Non-requested production verification missing → no failure', () => {
    // deployRequested=false, productionHealthOk=false, featureVerificationOk=null
    // → COMPLETED is still allowed (deploy/feature-verify NOT required).
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: true, filesChangedCount: 2,
      testsRun: true, testsPassed: true, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: true, commitVerified: true, taskType: 'CODE_FIX',
    });
    expect(r.ok).toBe(true);
    expect(r.reasons).toEqual([]);
  });

  test('DEPLOY_ONLY → COMPLETED requires verified commit + deployId + health', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'COMPLETED',
      isDevelopmentTask: false, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: 'dep-1',
      productionHealthOk: true, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: true, typecheckPassed: false, commitVerified: true, taskType: 'DEPLOY_ONLY',
    });
    expect(r.ok).toBe(true);
  });

  test('DEPLOY_ONLY → COMPLETED rejected without deployId', () => {
    const r = assertCanTransition({
      from: 'PRODUCTION_VERIFYING', to: 'COMPLETED',
      isDevelopmentTask: false, filesChangedCount: 0,
      testsRun: false, testsPassed: false, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: true, typecheckPassed: false, commitVerified: true, taskType: 'DEPLOY_ONLY',
    });
    expect(r.ok).toBe(false);
    expect(r.reasons[0]).toContain('deployId');
  });

  test('FACTORY → COMPLETED requires files + verified commit', () => {
    const r = assertCanTransition({
      from: 'READY_TO_DEPLOY', to: 'COMPLETED',
      isDevelopmentTask: false, filesChangedCount: 3,
      testsRun: false, testsPassed: false, deployId: null,
      productionHealthOk: false, featureVerificationOk: null, externalCauseProven: false,
      deployRequested: false, typecheckPassed: false, commitVerified: true, taskType: 'FACTORY',
    });
    expect(r.ok).toBe(true);
  });

  test('COMPLETED is reachable from READY_TO_DEPLOY, CODE_CHANGED, TESTING, QA_IN_PROGRESS, ANALYZING', () => {
    expect(canTransition('READY_TO_DEPLOY', 'COMPLETED')).toBe(true);
    expect(canTransition('CODE_CHANGED', 'COMPLETED')).toBe(true);
    expect(canTransition('TESTING', 'COMPLETED')).toBe(true);
    expect(canTransition('QA_IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(canTransition('ANALYZING', 'COMPLETED')).toBe(true);
    expect(canTransition('RECEIVED', 'COMPLETED')).toBe(true);
  });
});
