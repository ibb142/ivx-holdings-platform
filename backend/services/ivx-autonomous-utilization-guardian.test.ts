import { describe, expect, it } from 'bun:test';
import { UtilizationReasoningGuardian } from './ivx-autonomous-utilization-guardian';
import type { FleetSloSnapshot } from './ivx-fleet-slo';
import type { IVXWorkerJob, IVXWorkerJobInput } from './ivx-senior-developer-worker';
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
  let repair: Pick<IVXWorkerJob, 'jobId' | 'status' | 'error' | 'finishedAt'> | null = null;
  const guardian = new UtilizationReasoningGuardian({ snapshot: () => sample, enabled: () => enabled, now: () => now,
    readRepair: async () => repair,
    enqueue: async input => { calls.push(input); if (failure) throw new Error('EMERGENCY_STOP_ACTIVE'); repair = { jobId: calls.length === 1 ? 'real-queue-id' : `repair-${calls.length}`, status: 'queued', error: null, finishedAt: null }; return { job: repair, attached: false }; },
  });
  return { guardian, sample, calls, advance: (ms = 60_000) => { now += ms; sample.measured_at = new Date(now).toISOString(); },
    disable: () => { enabled = false; }, fail: (value: boolean) => { failure = value; },
    finish: (status: IVXWorkerJob['status'], error: string | null = null) => { repair = { jobId: repair?.jobId ?? 'restored-repair', status, error, finishedAt: new Date(now).toISOString() }; } };
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
    for (const change of [ { durable: false }, { measured_at: '2020-01-01T00:00:00Z' } ]) {
      const f = fixture(); Object.assign(f.sample, change); expect((await f.guardian.run()).action).toBe('WAITING_FOR_EVIDENCE'); expect(f.calls).toHaveLength(0);
    }
  });
  it('respects observe-only policy', async () => {
    const f = fixture(); f.disable(); await f.guardian.run(); f.advance(); expect((await f.guardian.run()).action).toBe('OBSERVE_ONLY'); expect(f.calls).toHaveLength(0);
  });
  it('preserves queue emergency-stop failures and retries without marking success', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); f.fail(true);
    expect((await f.guardian.run()).action).toBe('ERROR'); expect(f.guardian.snapshot().jobId).toBeNull();
    expect(f.guardian.snapshot().blockedDependency).toBe('owner_stop_active');
    f.fail(false); f.advance(); expect((await f.guardian.run()).action).toBe('RETRY_BACKOFF');
    expect(f.guardian.snapshot().blockedDependency).toBe('owner_stop_active');
    expect(f.calls).toHaveLength(1);
    f.advance(); expect((await f.guardian.run()).action).toBe('REPAIR_QUEUED');
    expect(f.guardian.snapshot().blockedDependency).toBeUndefined();
  });
  it('coalesces concurrent ticks and limits repeated repair submissions', async () => {
    const f = fixture(); await f.guardian.run(); f.advance();
    await Promise.all([f.guardian.run(), f.guardian.run()]); f.advance();
    expect((await f.guardian.run()).action).toBe('REPAIR_RUNNING'); expect(f.calls).toHaveLength(1);
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

describe('durable repair outcome supervision', () => {
  it('detects a cancelled repair during cooldown and feeds its failure into the next attempt', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); await f.guardian.run();
    f.finish('cancelled', 'Physical worker lease expired'); f.advance();
    expect((await f.guardian.run()).action).toBe('REPAIR_FAILED');
    expect(f.guardian.snapshot().lastRepairOutcome?.status).toBe('cancelled');
    f.advance(); expect((await f.guardian.run()).action).toBe('RETRY_BACKOFF');
    f.advance(); expect((await f.guardian.run()).action).toBe('REPAIR_QUEUED');
    expect(f.calls).toHaveLength(2);
    expect(f.calls[1].goal).toContain('Physical worker lease expired');
  });
  it('keeps an active repair attached after the old cooldown expires', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); await f.guardian.run();
    f.advance(20 * 60_000);
    expect((await f.guardian.run()).action).toBe('REPAIR_RUNNING');
    expect(f.calls).toHaveLength(1);
  });
  it('restores a prior failed repair from durable state after restart', async () => {
    const f = fixture(); f.finish('failed', 'GitHub default branch ref lookup failed: 401');
    expect((await f.guardian.run()).action).toBe('REPAIR_FAILED');
    expect(f.guardian.snapshot().jobId).toBe('restored-repair');
    expect(f.calls).toHaveLength(0);
    f.advance(120_000); await f.guardian.run();
    expect(f.calls[0].goal).toContain('GitHub default branch ref lookup failed: 401');
  });
  it('does not certify a completed patch while live fleet evidence still breaches', async () => {
    const f = fixture(); await f.guardian.run(); f.advance(); await f.guardian.run();
    f.finish('completed'); f.advance();
    expect((await f.guardian.run()).action).toBe('AWAITING_RECOVERY_EVIDENCE');
    f.advance(); expect((await f.guardian.run()).action).toBe('COOLDOWN');
    f.sample.status = 'MET'; f.sample.productive_agents = 112;
    expect((await f.guardian.run()).action).toBe('HEALTHY');
  });
  it('redacts credentials from failure evidence', async () => {
    const f = fixture(); f.finish('failed', 'Authorization Bearer ghp_secret_value https://example.invalid/?token=private');
    await f.guardian.run();
    expect(JSON.stringify(f.guardian.snapshot())).not.toContain('secret_value');
    expect(JSON.stringify(f.guardian.snapshot())).not.toContain('token=private');
  });
});

describe('telemetry outage recovery bridge', () => {
  it('routes two fresh failed observations to reasoning without pretending the evidence is durable', async () => {
    const f = fixture();
    Object.assign(f.sample, { status: 'UNKNOWN', durable: false, productive_agents: null,
      failure_stage: 'read', failure_kind: 'timeout' });
    expect((await f.guardian.run()).diagnosis).toBe('TELEMETRY_UNAVAILABLE');
    await f.guardian.run();
    expect(f.calls).toHaveLength(0);
    f.advance();
    expect((await f.guardian.run()).action).toBe('REPAIR_QUEUED');
    expect(f.calls[0].goal).toContain('"failure_kind":"timeout"');
    expect(f.calls[0].goal).toContain('UNKNOWN, not zero');
    expect(f.sample.durable).toBe(false);
    expect(f.sample.productive_agents).toBeNull();
    expect(f.calls[0].approvePatch).toBe(false);
    expect(f.calls[0].approveGitDeploy).toBe(false);
  });
  it('does not turn stale or future UNKNOWN observations into new failures', async () => {
    for (const measured_at of ['2020-01-01T00:00:00Z', '2099-01-01T00:00:00Z']) {
      const f = fixture(); Object.assign(f.sample, { status: 'UNKNOWN', durable: false, measured_at });
      await f.guardian.run(); await f.guardian.run();
      expect(f.guardian.snapshot().action).toBe('WAITING_FOR_EVIDENCE');
      expect(f.calls).toHaveLength(0);
    }
  });
  it('keeps outage repair observe-only when repair policy is disabled', async () => {
    const f = fixture(); f.disable(); Object.assign(f.sample, { status: 'UNKNOWN', durable: false });
    await f.guardian.run(); f.advance();
    expect((await f.guardian.run()).action).toBe('OBSERVE_ONLY');
    expect(f.calls).toHaveLength(0);
  });
  it('bounds retries when the repair queue itself is unavailable and resumes after it recovers', async () => {
    const f = fixture(); Object.assign(f.sample, { status: 'UNKNOWN', durable: false });
    f.fail(true); await f.guardian.run(); f.advance(); await f.guardian.run();
    for (let n = 0; n < 10; n++) await f.guardian.run();
    expect(f.calls).toHaveLength(1);
    expect(f.guardian.snapshot().action).toBe('RETRY_BACKOFF');
    expect(f.guardian.snapshot().jobId).toBeNull();
    f.advance(120_000); f.fail(false);
    expect((await f.guardian.run()).action).toBe('REPAIR_QUEUED');
    expect(f.calls).toHaveLength(2);
  });
});
