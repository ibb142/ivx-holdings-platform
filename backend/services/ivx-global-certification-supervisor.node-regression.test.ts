import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeGlobalCertification, REQUIRED_CERTIFICATION_WORKFLOWS } from './ivx-global-certification-supervisor';

const mainSha = 'a'.repeat(40);
function input(conclusion: string, headSha = mainSha) {
  return {
    mainSha, productionSha: mainSha, productionHealthy: true,
    collector: 'github_actions_api' as const,
    runs: REQUIRED_CERTIFICATION_WORKFLOWS.map((entry, index) => ({
      workflow: entry.name, runId: index + 1, headBranch: 'main',
      headSha: index === 0 ? headSha : mainSha, status: 'completed',
      conclusion: index === 0 ? conclusion : 'success',
    })),
  };
}
test('skipped current-SHA gate blocks certification without a code repair mission', () => {
  const result = computeGlobalCertification(input('skipped'));
  assert.equal(result.status, 'PENDING');
  assert.equal(result.certified, false);
  assert.equal(result.gates[0].state, 'SKIPPED');
  assert.equal(result.repairMissions.length, 0);
});
test('skipped old-SHA gate retains the parity violation and blocks certification', () => {
  const result = computeGlobalCertification(input('skipped', 'b'.repeat(40)));
  assert.equal(result.status, 'RED');
  assert.equal(result.certified, false);
  assert.equal(result.shaParity.ok, false);
  assert.ok(result.shaParity.violations.length);
  assert.equal(result.repairMissions.length, 0);
});
test('actual current-SHA failure still creates a repair mission', () => {
  const result = computeGlobalCertification(input('failure'));
  assert.equal(result.status, 'RED');
  assert.equal(result.certified, false);
  assert.equal(result.repairMissions.length, 1);
  assert.equal(result.repairMissions[0].runId, 1);
});
test('all successful gates and production parity certify', () => {
  assert.equal(computeGlobalCertification(input('success')).certified, true);
});
