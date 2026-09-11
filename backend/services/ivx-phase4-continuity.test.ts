import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { evaluateSample, compareSamples, evaluateWindow } from '../../scripts/ivx-phase4-continuity.mjs';

const sha = 'a'.repeat(40);
const now = Date.parse('2026-09-11T00:00:00Z');
function observationSnapshot(at = now) {
  return { sourceSha: sha, sampledAt: new Date(at).toISOString(), data: Array.from({ length: 112 }, (_, i) => {
    const summary = `LANDING_P0_RESULT ${JSON.stringify({ v: 1, agent_number: i + 1, production_sha: sha,
      status: 'PASS', started_at: new Date(at - 1000).toISOString(), completed_at: new Date(at - 500).toISOString() })}`;
    return { assigned_agent_number: i + 1, task_id: `task-${i}`, state: 'QUEUED',
      idempotency_key: `landing-p0-patrol:${sha}:ia-${String(i + 1).padStart(3, '0')}`,
      latest_evidence: { evidenceId: `evidence-${i}-${at}`, commitSha: sha, source: 'continuous-patrol:fixture', summary,
        contentHash: createHash('sha256').update(summary).digest('hex'), createdAt: new Date(at - 200).toISOString() } };
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
