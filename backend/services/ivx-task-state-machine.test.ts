/**
 * Phase 1: Task execution state machine — 17 states + legal transitions.
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
  test('has exactly 17 states', () => {
    expect(ALL_TASK_STATES.length).toBe(17);
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
    expect(isTerminalTaskState('BLOCKED')).toBe(true);
    expect(isTerminalTaskState('FAILED')).toBe(true);
    expect(isTerminalTaskState('NO_CHANGE_REQUIRED')).toBe(true);
    expect(isTerminalTaskState('DEPLOYED')).toBe(false);
    expect(TERMINAL_TASK_STATES.size).toBe(4);
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
    expect(stageToTaskState('COMPLETED')).toBe('VERIFIED');
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
