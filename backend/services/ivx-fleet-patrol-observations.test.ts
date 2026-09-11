import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { buildFleetDashboardSignals, createFleetDashboardReader } from './ivx-fleet-dashboard-signals';
import { fleetActivityLabel, patrolSourceFreshness, visibleFleetSignals } from '../../expo/shared/ivx/fleet-signals';

const sha = 'a'.repeat(40), now = Date.parse('2026-09-11T00:00:00Z');
function fixture(status = 'PASS') {
  const summary = 'LANDING_P0_RESULT ' + JSON.stringify({ v: 1, agent_number: 7, production_sha: sha, status,
    started_at: new Date(now - 2000).toISOString(), completed_at: new Date(now - 1000).toISOString(),
    productive_seconds: 1, api_checks: 1, browser_checks: 0, evidence: ['GET /health 200'] });
  return { measuredAt: new Date(now).toISOString(), states: [], assignments: [{ agentNumber: 7, taskCount: 1 }],
    activeTasks: [], instances: [], patrolObservations: [{ task_id: 'patrol-7', assigned_agent_number: 7,
      evidence: { evidenceId: 'proof-7', evidenceType: 'production_verification', source: 'continuous-patrol:health',
        summary, contentHash: createHash('sha256').update(summary).digest('hex'), commitSha: sha,
        deploymentId: null, createdAt: new Date(now - 900).toISOString() } }] };
}
test('persisted observations remain visible after lease release without certifying execution or repairs', () => {
  for (const status of ['PASS', 'FAIL', 'BLOCKED']) {
    const signals = buildFleetDashboardSignals(fixture(status), sha, now);
    expect(signals.counts.observed).toBe(1);
    expect(signals.counts.running).toBe(0);
    expect(signals.counts.productive).toBe(0);
    expect(signals.agents[6].observation?.outcome).toBe(status);
    expect(signals.agents[6].observation?.taskId).toBe('patrol-7');
    expect(visibleFleetSignals(signals, now)).not.toBeNull();
  }
});
test('a stalled optional observation read cannot block the dashboard or create 112 database reads', async () => {
  let calls = 0;
  const raw = fixture(); delete (raw as any).patrolObservations;
  const read = createFleetDashboardReader({ base: async () => raw, sha: () => sha, now: () => now,
    patrol: () => { calls++; return new Promise(() => {}); } });
  const samples = await Promise.all(Array.from({ length: 112 }, read));
  expect(calls).toBe(1);
  expect(samples.every(s => s.status === 'AVAILABLE' && s.counts.observed === null)).toBe(true);
});
test('a cached observation expires independently and cannot cross a deployment change', async () => {
  let clock = now, currentSha = sha;
  const rows = fixture().patrolObservations;
  const read = createFleetDashboardReader({ base: async () => ({ ...fixture(), patrolObservations: undefined,
    measuredAt: new Date(clock).toISOString() }), patrol: async () => rows, sha: () => currentSha, now: () => clock });
  await read(); await new Promise(resolve => setImmediate(resolve));
  expect((await read()).counts.observed).toBe(1);
  currentSha = 'b'.repeat(40);
  expect((await read()).counts.observed).toBeNull();
  currentSha = sha; clock += 15001;
  expect((await read()).counts.observed).toBeNull();
});
test('failed observation reads stay unknown and are retried at most once per refresh window', async () => {
  let calls = 0;
  const raw = fixture(); delete (raw as any).patrolObservations;
  const read = createFleetDashboardReader({ base: async () => raw, sha: () => sha, now: () => now,
    patrol: async () => { calls++; throw new Error('database unavailable'); } });
  await read(); await new Promise(resolve => setImmediate(resolve));
  const sample = await read();
  expect(sample.status).toBe('AVAILABLE'); expect(sample.counts.observed).toBeNull(); expect(calls).toBe(1);
});
test('missing persistence, wrong SHA, tampered evidence and stale observation cannot claim activity', () => {
  const absent = fixture(); delete (absent as any).patrolObservations;
  expect(buildFleetDashboardSignals(absent, sha, now).counts.observed).toBeNull();
  const empty = fixture(); empty.patrolObservations = [];
  expect(buildFleetDashboardSignals(empty, sha, now).counts.observed).toBe(0);
  const tampered = fixture(); tampered.patrolObservations[0].evidence.summary += ' ';
  expect(buildFleetDashboardSignals(tampered, sha, now).counts.observed).toBe(0);
  expect(buildFleetDashboardSignals(fixture(), 'b'.repeat(40), now).counts.observed).toBe(0);
  const stale = fixture(); stale.measuredAt = new Date(now + 121000).toISOString();
  expect(buildFleetDashboardSignals(stale, sha, now + 121000).counts.observed).toBe(0);
});
test('duplicate identities and fabricated totals cannot pass observation validation', () => {
  const duplicate = fixture(); duplicate.patrolObservations.push(duplicate.patrolObservations[0]);
  expect(() => buildFleetDashboardSignals(duplicate, sha, now)).toThrow('Ambiguous patrol');
  const signals = buildFleetDashboardSignals(fixture(), sha, now);
  expect(visibleFleetSignals({ ...signals, counts: { ...signals.counts, observed: 112 } }, now)).toBeNull();
  expect(visibleFleetSignals(signals, now + 15001)).toBeNull();
});

test('newly persisted QA cannot refresh an old source or invent missing timing', () => {
  const raw = fixture('BLOCKED'), evidence = raw.patrolObservations[0].evidence;
  const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length));
  record.source_observed_at = new Date(now - 61_000).toISOString();
  record.activity = { category: 'qa', active_seconds: 0.25, waiting_seconds: 0.75 };
  evidence.summary = 'LANDING_P0_RESULT ' + JSON.stringify(record);
  evidence.contentHash = createHash('sha256').update(evidence.summary).digest('hex');
  const signal = buildFleetDashboardSignals(raw, sha, now).agents[6];
  expect(signal.observation?.outcome).toBe('BLOCKED');
  expect(patrolSourceFreshness(signal.observation, now)).toBe('STALE');
  expect(signal.observation?.activity).toEqual({ category: 'qa', activeSeconds: 0.25, waitingSeconds: 0.75 });
  expect(fleetActivityLabel(signal)).toBe('QA BLOCKED');
  const legacy = buildFleetDashboardSignals(fixture(), sha, now).agents[6].observation;
  expect(patrolSourceFreshness(legacy, now)).toBe('UNKNOWN');
  expect(legacy?.activity).toBeNull();
  expect(patrolSourceFreshness({ ...legacy!, sourceObservedAt: new Date(now - 20_000).toISOString() }, now)).toBe('FRESH');
  expect(patrolSourceFreshness({ ...legacy!, sourceObservedAt: new Date(now + 1).toISOString() }, now)).toBe('UNKNOWN');
});

test('reported QA and waiting cannot exceed the measured observation interval', () => {
  const raw = fixture(), evidence = raw.patrolObservations[0].evidence;
  const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length));
  record.activity = { category: 'qa', active_seconds: 112, waiting_seconds: 1 };
  evidence.summary = 'LANDING_P0_RESULT ' + JSON.stringify(record);
  evidence.contentHash = createHash('sha256').update(evidence.summary).digest('hex');
  expect(buildFleetDashboardSignals(raw, sha, now).agents[6].observation?.activity).toBeNull();
});
