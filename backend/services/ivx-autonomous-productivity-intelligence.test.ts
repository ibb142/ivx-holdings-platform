import { describe, expect, test } from 'bun:test';
import { buildAutonomousProductivity24h, isVerifiedNetExecution } from './ivx-autonomous-productivity-intelligence';
import type { ExecutionRow } from './ivx-agent-persistence';

const NOW = Date.parse('2026-09-03T13:00:00.000Z');

function run(overrides: Partial<ExecutionRow> = {}): ExecutionRow {
  return {
    task_id: 'task-1', run_id: 'run-1', agent_id: 'ivx_holdings_1', agent_number: 1,
    workflow: 'engineering', task_type: 'audit', final_status: 'completed', real_tool_used: true,
    tools_used: ['repo_read'], tool_result_id: 'tool-1', source_reference: 'repo://source/1', verified_output: true,
    evidence: { evidenceFingerprint: 'fp-1' }, evidence_sha256: 'abc123', output: {}, cost_usage: { usd: 0 },
    error: null, retry_count: 0, duration_ms: 3_600_000, dedup_key: 'dedup-1', simulated: false,
    started_at: '2026-09-03T12:00:00.000Z', finished_at: '2026-09-03T13:00:00.000Z', ...overrides,
  };
}

describe('Autonomous productivity intelligence', () => {
  test('counts only evidence-backed execution as verified net work', () => {
    expect(isVerifiedNetExecution(run())).toBe(true);
    expect(isVerifiedNetExecution(run({ tool_result_id: null }))).toBe(false);
    expect(isVerifiedNetExecution(run({ source_reference: null }))).toBe(false);
    expect(isVerifiedNetExecution(run({ verified_output: false }))).toBe(false);
    expect(isVerifiedNetExecution(run({ simulated: true }))).toBe(false);
  });

  test('code-producing work requires commit SHA and passing tests', () => {
    const code = run({ task_type: 'development', evidence: { commitSha: '1234567', testsRun: true, testsPassed: true, evidenceFingerprint: 'code-1' } });
    expect(isVerifiedNetExecution(code)).toBe(true);
    expect(isVerifiedNetExecution({ ...code, evidence: { commitSha: '1234567', testsRun: true, testsPassed: false } })).toBe(false);
    expect(isVerifiedNetExecution({ ...code, evidence: { testsRun: true, testsPassed: true } })).toBe(false);
  });

  test('separates waste by cause', () => {
    const rows = [
      run(),
      run({ run_id: 'run-2', task_id: 'task-2', evidence: { evidenceFingerprint: 'fp-1' }, evidence_sha256: 'abc123' }),
      run({ run_id: 'run-3', task_id: 'task-3', final_status: 'failed', error: 'HTTP 500 same failure', evidence: { sourceSha: 'deadbee' } }),
      run({ run_id: 'run-4', task_id: 'task-4', final_status: 'blocked', error: 'owner gate' }),
      run({ run_id: 'run-5', task_id: 'task-5', final_status: 'running', retry_count: 2 }),
      run({ run_id: 'run-6', task_id: 'task-6', verified_output: false }),
    ];
    const metrics = buildAutonomousProductivity24h(rows, { now: NOW });
    expect(metrics.verifiedNetHours).toBe(1);
    expect(metrics.duplicateHours).toBe(1);
    expect(metrics.failedHours).toBe(1);
    expect(metrics.blockedHours).toBe(1);
    expect(metrics.retryWasteHours).toBe(1);
    expect(metrics.unverifiedHours).toBe(1);
    expect(metrics.wasteHours).toBe(5);
  });

  test('detects same SHA plus same error rerun', () => {
    const failed1 = run({ final_status: 'failed', run_id: 'f1', task_id: 'f1', error: 'CloudFront AccessDenied 403 request 123456', evidence: { sourceSha: '1512a3a' } });
    const failed2 = run({ final_status: 'failed', run_id: 'f2', task_id: 'f2', error: 'CloudFront AccessDenied 403 request 987654', evidence: { sourceSha: '1512a3a' } });
    const metrics = buildAutonomousProductivity24h([failed1, failed2], { now: NOW });
    expect(metrics.circuitBreakerTriggered).toBe(true);
    expect(metrics.noProgressLoops).toHaveLength(1);
    expect(metrics.noProgressLoops[0]?.count).toBe(2);
    expect(metrics.noProgressLoops[0]?.sourceSha).toBe('1512a3a');
  });

  test('reports landing hours and per-agent net production', () => {
    const landing = run({ agent_id: 'ivx_holdings_7', agent_number: 7, task_id: 'landing-1', run_id: 'landing-1', source_reference: 'expo/ivxholding-landing/index.html', evidence_sha256: 'landing-sha', evidence: { evidenceFingerprint: 'landing-result' }, duration_ms: 7_200_000 });
    const metrics = buildAutonomousProductivity24h([landing], { now: NOW, landingBudgetHours: 10 });
    expect(metrics.landing.verifiedNetHours).toBe(2);
    expect(metrics.landing.verifiedOutputs).toBe(1);
    expect(metrics.perAgent[0]?.agentNumber).toBe(7);
    expect(metrics.perAgent[0]?.verifiedNetHours).toBe(2);
  });
});
