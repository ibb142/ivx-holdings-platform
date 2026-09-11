import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import catalog from '../../scripts/ivx-phase4-unit-catalog.json';
import { LANDING_P0_UNITS, assignAgentForUnit, landingPatrolUnitFor } from './ivx-landing-p0-backlog';
import { evaluateSample, compareSamples, evaluateWindow } from '../../scripts/ivx-phase4-continuity.mjs';

const sha = 'a'.repeat(40);
const now = Date.parse('2026-09-11T00:00:00Z');
function observationSnapshot(at = now) {
  return { sourceSha: sha, sampledAt: new Date(at).toISOString(), data: Array.from({ length: 112 }, (_, i) => {
    const unit_evidence = catalog[String(i + 1) as keyof typeof catalog].map(unit => {
      const summary = `LANDING_P0_RESULT ${JSON.stringify({ v: 1, unit_id: unit, agent_number: i + 1, production_sha: sha,
        status: 'PASS', started_at: new Date(at - 1000).toISOString(), completed_at: new Date(at - 500).toISOString() })}`;
      return { evidenceId: `evidence-${i}-${at}-${unit}`, commitSha: sha, source: 'continuous-patrol:fixture', summary,
        contentHash: createHash('sha256').update(summary).digest('hex'), createdAt: new Date(at - 200).toISOString() };
    });
    return { assigned_agent_number: i + 1, task_id: `task-${i}`, state: 'QUEUED',
      idempotency_key: `landing-p0-patrol:${sha}:ia-${String(i + 1).padStart(3, '0')}`,
      latest_evidence: unit_evidence[0], unit_evidence };
  }) };
}

test('fresh ended observations do not require an active worker lease', () => {
  expect(evaluateSample(observationSnapshot()).freshPassingAgents).toBe(112);
  expect(evaluateSample(observationSnapshot()).passed).toBe(true);
});
test('missing and duplicated identities cannot produce an empty success', () => {
  expect(evaluateSample({ sourceSha: sha, data: [] }).passed).toBe(false);
  const s = observationSnapshot(); s.data[1] = s.data[0];
  expect(evaluateSample(s).agents[0].blockers).toContain('DUPLICATE_AGENT');
  expect(evaluateSample(s).agents[1].blockers).toContain('MISSING_AGENT');
});
test('stale observations and failed tasks stay blocked despite old PASS evidence', () => {
  const s = observationSnapshot(); s.sampledAt = new Date(now + 121000).toISOString(); s.data[0].state = 'FAILED';
  const report = evaluateSample(s);
  expect(report.freshPassingAgents).toBe(0);
  expect(report.agents[0].blockers).toContain('TASK_FAILED');
  expect(report.agents[1].blockers).toContain('QUEUE_WITHOUT_RECENT_PROGRESS');
});
test('modified, wrong-SHA and future evidence cannot certify a lane', () => {
  const s = observationSnapshot();
  s.data[0].latest_evidence.summary += 'modified';
  s.data[1].latest_evidence.commitSha = 'b'.repeat(40);
  s.data[2].latest_evidence.createdAt = new Date(now + 1000).toISOString();
  expect(evaluateSample(s).freshPassingAgents).toBe(109);
});
test('new evidence is progress while a new snapshot of the same evidence is not', () => {
  const before = observationSnapshot(), after = observationSnapshot(now + 60000);
  expect(compareSamples(before, after).agents.filter(agent => agent.newEvidence)).toHaveLength(112);
  after.data = before.data;
  expect(compareSamples(before, after).agents.some(agent => agent.newEvidence)).toBe(false);
});
test('24 elapsed hours with missing samples cannot certify continuous operation', () => {
  const report = evaluateWindow([observationSnapshot(), observationSnapshot(now + 86400000)]);
  expect(report.coverageGaps).toBe(1);
  expect(report.initialWindowPassed).toBe(false);
  expect(report.phase4Certified).toBe(false);
});
test('a deployment starts a different continuity window', () => {
  const after = observationSnapshot(now + 60000); after.sourceSha = 'b'.repeat(40);
  expect(compareSamples(observationSnapshot(), after).comparable).toBe(false);
});


test('unit catalog matches the authoritative patrol assignment for all 112 identities', () => {
  const expected = Object.fromEntries(Array.from({ length: 112 }, (_, i) => {
    const n = i + 1;
    const owned = LANDING_P0_UNITS.filter(u => u.check.kind !== 'certificate' && assignAgentForUnit(u) === n).map(u => u.unitId);
    return [n, owned.length ? owned : [landingPatrolUnitFor(n, 0).unitId]];
  }));
  expect(catalog).toEqual(expected);
});
function changeUnit(snapshot: ReturnType<typeof observationSnapshot>, agent: number, unit: string, patch: Record<string, unknown>) {
  const evidence = snapshot.data[agent - 1].unit_evidence.find(e => JSON.parse(e.summary.slice(18)).unit_id === unit)!;
  evidence.summary = 'LANDING_P0_RESULT ' + JSON.stringify({ ...JSON.parse(evidence.summary.slice(18)), ...patch });
  evidence.contentHash = createHash('sha256').update(evidence.summary).digest('hex');
}
test('IA15 min-count PASS cannot erase videos-present FAIL from a different unit', () => {
  const s = observationSnapshot();
  changeUnit(s, 15, 'deals.videos-present', { status: 'FAIL' });
  expect(evaluateSample(s).agents[14].passed).toBe(false);
  expect(evaluateSample(s).agents[14].blockers).toContain('UNIT_deals.videos-present_FAIL');
});
test('omitted, duplicated and stale units cannot certify coverage', () => {
  const missing = observationSnapshot(); missing.data[14].unit_evidence.pop();
  expect(evaluateSample(missing).passed).toBe(false);
  const duplicate = observationSnapshot(); duplicate.data[14].unit_evidence[1] = duplicate.data[14].unit_evidence[0];
  expect(evaluateSample(duplicate).passed).toBe(false);
  const stale = observationSnapshot();
  changeUnit(stale, 15, 'deals.videos-present', { started_at: new Date(now - 122000).toISOString(), completed_at: new Date(now - 121000).toISOString() });
  expect(evaluateSample(stale).passed).toBe(false);
});
test('legacy latest-only samples and malformed secondary evidence fail closed', () => {
  const legacy = observationSnapshot(); delete (legacy.data[14] as any).unit_evidence;
  expect(evaluateSample(legacy).passed).toBe(false);
  const malformed = observationSnapshot(); malformed.data[14].unit_evidence[1].summary += 'tampered';
  expect(evaluateSample(malformed).passed).toBe(false);
});
test('a resolved unit needs its own new passing evidence', () => {
  const s = observationSnapshot(); changeUnit(s, 15, 'deals.videos-present', { status: 'BLOCKED' });
  expect(evaluateSample(s).passed).toBe(false);
  changeUnit(s, 15, 'deals.videos-present', { status: 'PASS' });
  expect(evaluateSample(s).passed).toBe(true);
});
