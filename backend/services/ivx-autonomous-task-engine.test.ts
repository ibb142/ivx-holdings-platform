/**
 * IVX Autonomous Task Engine — unit tests for the 23-state machine, objective
 * planning, agent routing, approval gate, queue leasing, duplicate prevention,
 * and honest completion validator.
 */
import { describe, expect, it } from 'bun:test';
import {
  isValidTransition,
  isTaskCompleted,
  isTaskInProgress,
  ALL_TASK_STATES,
  TERMINAL_SUCCESS_STATES,
  TERMINAL_STATES,
  routeTaskToAgent,
  isActionAllowed,
  PERMISSION_MATRIX,
  validateCompletion,
  requiresApproval,
  ALL_PROTECTED_ACTIONS,
  type TaskState,
  type Task,
} from './ivx-autonomous-task-engine.js';

// ── Phase 4: 23-state task state machine ─────────────────────────────────────

describe('Phase 4 — 23-state task state machine', () => {
  it('defines exactly 23 states', () => {
    expect(ALL_TASK_STATES.length).toBe(23);
  });

  it('QUEUED is not completed', () => {
    expect(isTaskCompleted('QUEUED')).toBe(false);
  });

  it('RUNNING is not completed', () => {
    expect(isTaskCompleted('RUNNING')).toBe(false);
  });

  it('DEPLOYED is not verified (not completed)', () => {
    expect(isTaskCompleted('DEPLOYED')).toBe(false);
  });

  it('VERIFIED is completed', () => {
    expect(isTaskCompleted('VERIFIED')).toBe(true);
  });

  it('NO_ACTION_REQUIRED is completed', () => {
    expect(isTaskCompleted('NO_ACTION_REQUIRED')).toBe(true);
  });

  it('QUEUED is in progress', () => {
    expect(isTaskInProgress('QUEUED')).toBe(true);
  });

  it('BLOCKED is NOT in progress (it is blocked, not progressing)', () => {
    expect(isTaskInProgress('BLOCKED')).toBe(false);
  });

  it('FAILED is NOT in progress', () => {
    expect(isTaskInProgress('FAILED')).toBe(false);
  });

  it('CANCELLED is terminal', () => {
    expect(TERMINAL_STATES.includes('CANCELLED')).toBe(true);
  });

  it('VERIFIED is terminal', () => {
    expect(TERMINAL_STATES.includes('VERIFIED')).toBe(true);
  });

  it('validates state transitions correctly', () => {
    expect(isValidTransition('RECEIVED', 'VALIDATING')).toBe(true);
    expect(isValidTransition('QUEUED', 'LEASED')).toBe(true);
    expect(isValidTransition('LEASED', 'RUNNING')).toBe(true);
    expect(isValidTransition('RUNNING', 'EXECUTION_COMPLETED')).toBe(true);
    expect(isValidTransition('EXECUTION_COMPLETED', 'QA_IN_PROGRESS')).toBe(true);
    expect(isValidTransition('QA_IN_PROGRESS', 'READY_FOR_DEPLOYMENT')).toBe(true);
    expect(isValidTransition('READY_FOR_DEPLOYMENT', 'DEPLOYING')).toBe(true);
    expect(isValidTransition('DEPLOYING', 'DEPLOYED')).toBe(true);
    expect(isValidTransition('DEPLOYED', 'PRODUCTION_VERIFYING')).toBe(true);
    expect(isValidTransition('PRODUCTION_VERIFYING', 'VERIFIED')).toBe(true);
  });

  it('rejects invalid state transitions', () => {
    // Cannot jump from RECEIVED to RUNNING (must go through VALIDATING → PLANNING → QUEUED → LEASED)
    expect(isValidTransition('RECEIVED', 'RUNNING')).toBe(false);
    // Cannot go from QUEUED directly to VERIFIED
    expect(isValidTransition('QUEUED', 'VERIFIED')).toBe(false);
    // Cannot transition from a terminal state
    expect(isValidTransition('VERIFIED', 'QUEUED')).toBe(false);
    expect(isValidTransition('CANCELLED', 'QUEUED')).toBe(false);
    // Cannot self-transition
    expect(isValidTransition('QUEUED', 'QUEUED')).toBe(false);
  });

  it('allows FAILED → RETRYING (retry from failure)', () => {
    expect(isValidTransition('FAILED', 'RETRYING')).toBe(true);
  });

  it('allows PAUSED → RUNNING (resume)', () => {
    expect(isValidTransition('PAUSED', 'RUNNING')).toBe(true);
  });

  it('allows BLOCKED → WAITING_FOR_APPROVAL (blocked tasks can wait for approval)', () => {
    expect(isValidTransition('BLOCKED', 'WAITING_FOR_APPROVAL')).toBe(true);
  });
});

// ── Phase 6: Agent routing ───────────────────────────────────────────────────

describe('Phase 6 — agent routing', () => {
  it('routes development tasks to the mobile lead agent', () => {
    const result = routeTaskToAgent('development');
    expect(result).not.toBeNull();
    expect(result?.agentNumber).toBe(1);
    expect(result?.engine).toBe('ivx_mobile_lead');
  });

  it('routes security tasks to the security lead agent', () => {
    const result = routeTaskToAgent('security');
    expect(result).not.toBeNull();
    expect(result?.agentNumber).toBe(43);
  });

  it('routes investor research to the investor research engine', () => {
    const result = routeTaskToAgent('investor_research');
    expect(result).not.toBeNull();
    expect(result?.engine).toBe('ivx_investor_research');
  });

  it('routes deployment tasks to the deployment engine', () => {
    const result = routeTaskToAgent('deployment');
    expect(result).not.toBeNull();
    expect(result?.engine).toBe('ivx_deployment_engine');
  });

  it('routes QA tasks to the QA engineer', () => {
    const result = routeTaskToAgent('qa');
    expect(result).not.toBeNull();
    expect(result?.engine).toBe('ivx_qa_engineer');
  });
});

// ── Phase 6: Permission matrix ───────────────────────────────────────────────

describe('Phase 6 — permission matrix', () => {
  it('defines permission entries for all key engines', () => {
    expect(PERMISSION_MATRIX.length).toBeGreaterThanOrEqual(8);
    const engines = PERMISSION_MATRIX.map((e) => e.engine);
    expect(engines).toContain('ivx_mobile_lead');
    expect(engines).toContain('ivx_security_lead');
    expect(engines).toContain('ivx_investor_research');
    expect(engines).toContain('ivx_deployment_engine');
  });

  it('research engines cannot deploy', () => {
    const result = isActionAllowed('ivx_investor_research', 'production_deployment');
    expect(result.allowed).toBe(false);
  });

  it('research engines cannot write code', () => {
    const result = isActionAllowed('ivx_investor_research', 'code_writes');
    expect(result.allowed).toBe(false);
  });

  it('outreach engines require owner approval', () => {
    const outreach = PERMISSION_MATRIX.find((e) => e.engine === 'ivx_capital_outreach');
    expect(outreach?.ownerApprovalRequired).toBe(true);
  });

  it('QA engines cannot falsify completion (no code writes)', () => {
    const result = isActionAllowed('ivx_qa_engineer', 'code_writes');
    expect(result.allowed).toBe(false);
  });

  it('deployment engines require owner approval', () => {
    const deploy = PERMISSION_MATRIX.find((e) => e.engine === 'ivx_deployment_engine');
    expect(deploy?.ownerApprovalRequired).toBe(true);
  });

  it('reporting engines cannot mutate production', () => {
    const reporting = PERMISSION_MATRIX.find((e) => e.engine === 'ivx_analytics_lead');
    expect(reporting?.prohibitedActions).toContain('production_deployment');
  });
});

// ── Phase 7: Owner approval gate ─────────────────────────────────────────────

describe('Phase 7 — owner approval gate', () => {
  it('lists all 15 protected actions', () => {
    expect(ALL_PROTECTED_ACTIONS.length).toBe(15);
  });

  it('requires approval for github_write', () => {
    expect(requiresApproval('github_write')).toBe(true);
  });

  it('requires approval for production_deployment', () => {
    expect(requiresApproval('production_deployment')).toBe(true);
  });

  it('requires approval for secret_rotation', () => {
    expect(requiresApproval('secret_rotation')).toBe(true);
  });

  it('requires approval for external_outreach_sending', () => {
    expect(requiresApproval('external_outreach_sending')).toBe(true);
  });

  it('requires approval for member_deletion', () => {
    expect(requiresApproval('member_deletion')).toBe(true);
  });
});

// ── Phase 12: Honest completion validator ────────────────────────────────────

describe('Phase 12 — honest completion validator', () => {
  function makeTask(overrides: Partial<Task>): Task {
    return {
      taskId: 'task_test',
      objectiveId: null,
      parentTaskId: null,
      title: 'Test task',
      description: 'Test',
      taskType: 'development',
      state: 'VERIFIED',
      idempotencyKey: 'idem_test',
      assignedAgentNumber: 1,
      assignedEngine: 'ivx_mobile_lead',
      priority: 'medium',
      acceptanceCriteria: [],
      dependencies: [],
      executionOrder: 0,
      leaseHolder: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      retryCount: 0,
      maxRetries: 3,
      error: null,
      blocker: null,
      evidence: [],
      filesChanged: [],
      recordsChanged: 0,
      commitSha: null,
      deploymentId: null,
      approvalId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      traceId: null,
      ...overrides,
    };
  }

  it('rejects VERIFIED for a code task with no files changed', () => {
    const task = makeTask({ state: 'VERIFIED', taskType: 'development', filesChanged: [], evidence: [{ evidenceId: 'e1', evidenceType: 'log', source: 'test', contentHash: 'h1', summary: 'test', createdAt: new Date().toISOString(), commitSha: null, deploymentId: null }] });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('PARTIAL');
    expect(result.reason).toContain('no files were changed');
  });

  it('rejects VERIFIED for a task with no evidence', () => {
    const task = makeTask({ state: 'VERIFIED', evidence: [], filesChanged: ['file.ts'] });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('PARTIAL');
    expect(result.reason).toContain('no evidence');
  });

  it('returns FAILED for a failed task', () => {
    const task = makeTask({ state: 'FAILED', error: 'Build error' });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('FAILED');
  });

  it('returns BLOCKED for a blocked task', () => {
    const task = makeTask({ state: 'BLOCKED', blocker: 'Missing approval' });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('BLOCKED');
  });

  it('returns NOT_COMPLETED for an in-progress task', () => {
    const task = makeTask({ state: 'RUNNING' });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  it('returns NO_ACTION_REQUIRED for no-action tasks', () => {
    const task = makeTask({ state: 'NO_ACTION_REQUIRED' });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('NO_ACTION_REQUIRED');
  });

  it('returns PARTIAL when acceptance criteria are unmet', () => {
    const task = makeTask({
      state: 'VERIFIED',
      filesChanged: ['file.ts'],
      evidence: [{ evidenceId: 'e1', evidenceType: 'code_diff', source: 'file.ts', contentHash: 'h1', summary: 'diff', createdAt: new Date().toISOString(), commitSha: 'abc', deploymentId: null }],
      acceptanceCriteria: [
        { id: 'ac1', description: 'Code diff exists', verificationMethod: 'code_diff', met: true, evidence: 'diff' },
        { id: 'ac2', description: 'Tests pass', verificationMethod: 'test_pass', met: false, evidence: null },
      ],
    });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('PARTIAL');
    expect(result.unmetCriteria).toContain('Tests pass');
  });

  it('returns VERIFIED when all criteria are met with evidence and files changed', () => {
    const task = makeTask({
      state: 'VERIFIED',
      taskType: 'development',
      filesChanged: ['file.ts'],
      evidence: [{ evidenceId: 'e1', evidenceType: 'code_diff', source: 'file.ts', contentHash: 'h1', summary: 'diff', createdAt: new Date().toISOString(), commitSha: 'abc', deploymentId: null }],
      acceptanceCriteria: [
        { id: 'ac1', description: 'Code diff exists', verificationMethod: 'code_diff', met: true, evidence: 'diff' },
      ],
    });
    const result = validateCompletion(task);
    expect(result.verdict).toBe('VERIFIED');
  });
});