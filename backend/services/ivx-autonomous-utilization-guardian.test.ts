import { describe, expect, it } from 'bun:test';
import { UtilizationReasoningGuardian } from './ivx-autonomous-utilization-guardian';
import type { FleetSloSnapshot } from './ivx-fleet-slo';
import type { IVXWorkerJobInput } from './ivx-senior-developer-worker';
function fixture() {
  let now = Date.parse('2026-09-09T03:00:00Z');
  let enabled = true;
  const sample: FleetSloSnapshot = {
    marker: 'test', retry_policy: 'test', measured_at: new Date(now).toISOString(), commit_sha: 'a'.repeat(40),
    status: 'BREACH', target_agents: 112, productive_agents: 0, productive_deficit: 112,
    running_agents: 112, leased_agents: 112, heartbeat_agents: 112, retry_waiting_tasks: 0,
    evidence_window_seconds: 300, productivity_ratio: 0, durable: true, error: null,
  };
  const calls: IVXWorkerJobInput[] = [];
  let failure = false;
  const guardian = new UtilizationReasoningGuardian({ snapshot: () => sample, enabled: () => enabled, now: () => now,
    enqueue: async input => { calls.push(input); if (failure) throw new Error('EMERGENCY_STOP_ACTIVE'); return { job: { jobId: 'real-queue-id' }, attached: false }; },
  });
  return { guardian, sample, calls, advance: (ms = 60_000) => { now += ms; sample.measured_at = new Date(now).toISOString(); },
    disable: () => { enabled = false; }, fail: (value: boolean) => { failure = value; } };
}
describe('fleet evidence to reasoning worker', () => {
  it('routes persistent 112 heartbeats with no results into the code-change worker, without certifying recovery', async () => {
    const f = fixture();
    expect((await f.guardian.run()).action).toBe('CONFIRMING_BREACH');
    f.advance();
    const result = await f.guardian.run();
    expect(result.action).toBe('REPAIR_QUEUED');
    expect(result.diagnosis).toBe('EXECUTION_WITHOUT_RESULTS');
    expect(result.jobId).toBe('real-queue-id');
    expect(f.calls[0].executionMode).toBe('code_change');
    expect(f.calls[0].approveGitDeploy).toBe(false);
    expect(f.calls[0].goal).toContain('"productive_agents":0');
    expect(f.calls[0].goal).toContain('hypothesis, not a proven root cause');
  });
  it('does not mistake polling the same sample for a persistent incident', async () => {
    const f = fixture(); await f.guardian.run(); await f.guardian.run(); expect(f.calls).toHaveLength(0);
  });
  it('does not enqueue for missing, stale or non-durable telemetry', async () => {
    for (const change of [ { status: 'UNKNOWN' }, { durable: false }, { measured_at: '2020-01-01T00:00:00Z' } ]) {
      const f = fixture(); Object.assign(f.sample, change); expect((await f.guardian.run()).action).toBe('WAITING_FOR_EVIDENCE'); expect(f.calls).toHaveLength(0);
    }
  });
  it('respects observe-only policy', async () => {
    const f = fixture(); f.disable(); await f.guardian.run(); f.advance(); expect((await f.guardian.run()).action).toBe('OBSERVE_ONLY'); expect(f.calls).toHaveLength(0);
  });
  it('preserves queue emergency-stop failures and retries without marking success', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); f.fail(true);
    expect((await f.guardian.run()).action).toBe('ERROR'); expect(f.guardian.snapshot().jobId).toBeNull();
    f.fail(false); f.advance(); expect((await f.guardian.run()).action).toBe('REPAIR_QUEUED');
  });
  it('coalesces concurrent ticks and limits repeated repair submissions', async () => {
    const f = fixture(); await f.guardian.run(); f.advance();
    await Promise.all([f.guardian.run(), f.guardian.run()]); f.advance();
    expect((await f.guardian.run()).action).toBe('COOLDOWN'); expect(f.calls).toHaveLength(1);
  });
  it('requires new evidence confirmation after unknown telemetry or a changed SHA', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); f.sample.commit_sha = 'b'.repeat(40);
    expect((await f.guardian.run()).action).toBe('CONFIRMING_BREACH'); expect(f.calls).toHaveLength(0);
    f.sample.status = 'UNKNOWN'; await f.guardian.run(); f.sample.status = 'BREACH'; f.advance();
    expect((await f.guardian.run()).action).toBe('CONFIRMING_BREACH');
  });
  it('recognizes recovery only from the evidence monitor', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); await f.guardian.run();
    f.advance(); f.sample.status = 'MET'; f.sample.productive_agents = 112;
    expect((await f.guardian.run()).action).toBe('HEALTHY'); expect(f.calls).toHaveLength(1);
  });
});
