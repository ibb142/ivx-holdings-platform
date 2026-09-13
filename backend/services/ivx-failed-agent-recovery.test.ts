import { expect, test } from 'bun:test';
import { inspectFailedAgentRecovery, type FailedAgentRecoveryRow } from './ivx-failed-agent-recovery';
import { parseRecoveryArguments } from '../../scripts/ops/reconcile-failed-agents';

const row: FailedAgentRecoveryRow = {
  agentNumber: 1, taskId: 'task-1', finalStatus: 'failed', simulated: false,
  verifiedOutput: false, hasExecutionEvidence: false, taskState: 'RUNNING', payloadState: 'RUNNING',
  assignedAgentNumber: 1, taskVersion: '9007199254740993', leaseActive: false,
  leaseExpired: true, hasTaskEvidence: false, observedAt: '2026-09-13T19:00:00Z',
};
const input = { runId: 'selected-run', agentNumbers: [1] };

test('invalid selectors are rejected before reading; apply is deliberately unsupported', async () => {
  let calls = 0;
  for (const agents of [[], [0], [113], [1, 1], [1.5]]) {
    await expect(inspectFailedAgentRecovery({ ...input, agentNumbers: agents }, async () => {
      calls++; return { rows: [] };
    })).rejects.toThrow('INVALID_RECOVERY_AGENT_NUMBERS');
  }
  expect(calls).toBe(0);
  expect(() => parseRecoveryArguments(['--run-id=r', '--agent-numbers=1', '--apply'])).toThrow('Usage:');
  expect(() => parseRecoveryArguments(['--run-id=r', '--run-id=s'])).toThrow('Usage:');
  expect(() => parseRecoveryArguments(['--run-id=r', '--agent-numbers=1,1'])).toThrow();
  expect(parseRecoveryArguments(['--agent-numbers=1,18', '--run-id=r'])).toEqual({ runId: 'r', agentNumbers: [1,18] });
});

test('binds the selected run and preserves bigint versions without authorizing retries', async () => {
  const runId = "run'; delete from public.ivx_autonomous_tasks; --";
  let calls = 0;
  const report = await inspectFailedAgentRecovery({ ...input, runId }, async (sql, values) => {
    calls++; expect(sql).not.toContain(runId); expect(values).toEqual([runId, [1]]);
    return { rows: [row] };
  });
  expect(calls).toBe(1);
  expect(report.mutationsPerformed).toBe(0);
  expect(report.rows[0].taskVersion).toBe('9007199254740993');
  expect(report.rows[0].nextStep).toBe('CANONICAL_EXPIRED_LEASE_RECOVERY');
  expect(report.rows[0].retryAuthorized).toBe(false);
  expect(report.budgetReconciliation).toBe('NOT_CHECKED');
});

test('active leases, terminal states, evidence, simulation and mismatched identity cannot become a queue reset', async () => {
  const cases: Array<[Partial<FailedAgentRecoveryRow>, string]> = [
    [{ leaseActive: true, leaseExpired: false }, 'ACTIVE_LEASE_DO_NOT_RESET'],
    [{ taskState: 'FAILED', payloadState: 'FAILED' }, 'TERMINAL_TASK_REVIEW'],
    [{ finalStatus: 'unknown', hasExecutionEvidence: true }, 'RECONCILE_EXISTING_EVIDENCE'],
    [{ finalStatus: 'completed' }, 'RECONCILE_EXISTING_EVIDENCE'],
    [{ hasTaskEvidence: true }, 'RECONCILE_EXISTING_EVIDENCE'],
    [{ taskId: null, taskState: null }, 'EXECUTION_NOT_FOUND'],
    [{ taskState: null }, 'CANONICAL_TASK_NOT_FOUND'],
    [{ assignedAgentNumber: 18 }, 'CANONICAL_IDENTITY_REVIEW'],
    [{ payloadState: 'QUEUED' }, 'CANONICAL_IDENTITY_REVIEW'],
    [{ simulated: true }, 'SIMULATION_STATUS_REVIEW'],
    [{ leaseExpired: null }, 'MANUAL_RECONCILIATION_REQUIRED'],
    [{ taskState: 'RETRYING', payloadState: 'RETRYING' }, 'CANONICAL_RETRY_SCHEDULE'],
    [{ taskState: 'QUEUED', payloadState: 'QUEUED' }, 'ALREADY_QUEUED'],
  ];
  for (const [change, expected] of cases) {
    const report = await inspectFailedAgentRecovery(input, async () => ({ rows: [{ ...row, ...change }] }));
    expect(report.rows[0].nextStep).toBe(expected);
    expect(report.rows[0].retryAuthorized).toBe(false);
  }
});

test('incomplete observations and database failures do not produce a successful recovery report or retry', async () => {
  for (const rows of [[], [row, row], [{ ...row, agentNumber: 2 }], [{ ...row, observedAt: 'invalid' }]]) {
    await expect(inspectFailedAgentRecovery(input, async () => ({ rows }))).rejects.toThrow('RECOVERY_OBSERVATION_INCOMPLETE');
  }
  let calls = 0;
  await expect(inspectFailedAgentRecovery(input, async () => { calls++; throw new Error('connection lost'); }))
    .rejects.toThrow('connection lost');
  expect(calls).toBe(1);
});
