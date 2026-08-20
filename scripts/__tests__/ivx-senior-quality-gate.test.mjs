/**
 * Tests for the IVX Senior Developer Quality Gate.
 *
 * The central regression these tests protect against is the original defect:
 *   quality_ok = ok && evidence_ok
 * which let an agent be called "10/10" with zero tests, zero typecheck,
 * zero lint and zero security review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSeniorGate, summarizeFleet, AGENT_STATUS } from '../ivx-senior-quality-gate.mjs';

/** A record that satisfies only the OLD broken rule. */
const oldRuleWouldPass = {
  agentNumber: 1,
  agentId: 'ivx_holdings_1',
  runHttp: 200,
  ok: true,
  finalStatus: 'completed',
  sourceReference: 'src/foo.ts#L10',
  toolResultId: 'tr_123',
};

/** A fully evidenced non-code record. */
const baseClean = {
  ...oldRuleWouldPass,
  simulated: false,
  fakeSuccess: false,
};

test('REGRESSION: ok=true + evidence present is NOT sufficient', () => {
  const r = evaluateSeniorGate(oldRuleWouldPass);
  assert.equal(r.acceptedBySeniorGate, false,
    'the exact shape the old rule accepted must now be rejected');
  assert.ok(r.rejectionReasons.includes('simulated_not_proven_false'));
  assert.ok(r.rejectionReasons.includes('fakeSuccess_not_proven_false'));
});

test('base record with simulated/fakeSuccess proven false is accepted', () => {
  const r = evaluateSeniorGate(baseClean);
  assert.equal(r.acceptedBySeniorGate, true);
  assert.equal(r.status, AGENT_STATUS.PASS_SENIOR_GATE);
});

test('missing evidence is a FAIL, never a pass', () => {
  assert.equal(evaluateSeniorGate({ ...baseClean, sourceReference: '' }).acceptedBySeniorGate, false);
  assert.equal(evaluateSeniorGate({ ...baseClean, toolResultId: '' }).acceptedBySeniorGate, false);
});

test('"not reported" does not mean pass: absent simulated flag fails', () => {
  const { simulated, ...noFlag } = baseClean;
  assert.equal(evaluateSeniorGate(noFlag).acceptedBySeniorGate, false);
});

test('code change without tests fails with FAIL_TESTS', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/util.ts'],
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.acceptedBySeniorGate, false);
  assert.equal(r.status, AGENT_STATUS.FAIL_TESTS);
  assert.ok(r.rejectionReasons.includes('tests_missing'));
});

test('tests requested but not executed fails', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/util.ts'],
    tests: { executed: false, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.status, AGENT_STATUS.FAIL_TESTS);
  assert.ok(r.rejectionReasons.includes('tests_not_executed'));
});

test('code change with commitSha but empty changedFiles fails', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: [],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.acceptedBySeniorGate, false);
  assert.ok(r.rejectionReasons.includes('changedFiles_empty'));
});

test('auth file change demands security review and negative auth tests', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/api/ivx-owner-auth.ts'],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.applicable.securityChanged, true);
  assert.equal(r.status, AGENT_STATUS.FAIL_SECURITY);
  assert.ok(r.rejectionReasons.includes('securityReview_missing'));
  assert.ok(r.rejectionReasons.includes('negativeAuthTests_not_passed'));
});

test('fully evidenced security change passes', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/api/ivx-owner-auth.ts'],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
    securityReview: { executed: true, passed: true },
    negativeAuthTestsPassed: true,
    secretExposure: false,
    authorizationRegression: false,
  });
  assert.equal(r.acceptedBySeniorGate, true, JSON.stringify(r.rejectionReasons));
});

test('UI change demands accessibility, smoke test and state verification', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['app/(tabs)/home.tsx'],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.applicable.uiChanged, true);
  assert.equal(r.status, AGENT_STATUS.FAIL_ACCESSIBILITY);
  assert.ok(r.rejectionReasons.includes('blackScreen_not_proven_false'));
  assert.ok(r.rejectionReasons.includes('mobileSmokeTest_not_passed'));
});

test('performance-sensitive change demands performance review', () => {
  const r = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/queue/worker.ts'],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
  });
  assert.equal(r.applicable.perfSensitive, true);
  assert.equal(r.status, AGENT_STATUS.FAIL_PERFORMANCE);
});

test('deployment claim requires healthy health and exact SHA match', () => {
  const bad = evaluateSeniorGate({
    ...baseClean,
    commitSha: 'abc123',
    changedFiles: ['backend/x.ts'],
    tests: { executed: true, passed: true },
    typecheck: { executed: true, passed: true },
    lint: { executed: true, passed: true },
    deploymentEvidence: { health: 'healthy', versionCommit: 'DIFFERENT' },
  });
  assert.equal(bad.status, AGENT_STATUS.FAIL_DEPLOYMENT);
  assert.ok(bad.rejectionReasons.includes('deployment_version_sha_mismatch'));
});

test('status classification is exact, never generic SUCCESS', () => {
  assert.equal(evaluateSeniorGate({ contractHttp: 500 }).status, AGENT_STATUS.BLOCKED_CONTRACT);
  assert.equal(evaluateSeniorGate({ contractHttp: 200, runHttp: 401 }).status, AGENT_STATUS.BLOCKED_AUTH);
  assert.equal(evaluateSeniorGate({ contractHttp: 200, runHttp: 502 }).status, AGENT_STATUS.BLOCKED_API);
  assert.equal(evaluateSeniorGate({ finalStatus: 'no_task' }).status, AGENT_STATUS.NO_TASK);
  assert.equal(evaluateSeniorGate({ stale: true }).status, AGENT_STATUS.STALE);
  assert.equal(evaluateSeniorGate({ finalStatus: 'running' }).status, AGENT_STATUS.WORKING);
  assert.equal(evaluateSeniorGate({}).status, AGENT_STATUS.UNVERIFIED);
});

test('an agent that never ran is UNVERIFIED, not passed', () => {
  const r = evaluateSeniorGate({ agentNumber: 7, agentId: 'ivx_holdings_7' });
  assert.equal(r.status, AGENT_STATUS.UNVERIFIED);
  assert.equal(r.acceptedBySeniorGate, false);
  assert.ok(r.rejectionReasons.includes('no_run_result_recorded'));
});

test('fleet is NOT ok when fewer than expected agents are accepted', () => {
  const s = summarizeFleet([baseClean], 112);
  assert.equal(s.ok, false);
  assert.equal(s.acceptedBySeniorGate, 1);
  assert.equal(s.totalAgents, 1);
});

test('fleet is ok only when all expected agents pass', () => {
  const results = Array.from({ length: 3 }, (_, i) => ({ ...baseClean, agentNumber: i + 1 }));
  const s = summarizeFleet(results, 3);
  assert.equal(s.ok, true);
  assert.equal(s.acceptedBySeniorGate, 3);
  assert.equal(s.failed, 0);
  assert.equal(s.blocked, 0);
  assert.equal(s.unverified, 0);
});

test('fleet reports exact failing agent numbers and reasons', () => {
  const s = summarizeFleet([
    { ...baseClean, agentNumber: 1 },
    { agentNumber: 2, agentId: 'ivx_holdings_2' },
  ], 2);
  assert.equal(s.ok, false);
  assert.equal(s.unverified, 1);
  assert.deepEqual(s.failures.map((f) => f.agentNumber), [2]);
  assert.equal(s.failures[0].status, AGENT_STATUS.UNVERIFIED);
});

test('112 unverified agents can never yield ok', () => {
  const results = Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, agentId: `ivx_holdings_${i + 1}` }));
  const s = summarizeFleet(results, 112);
  assert.equal(s.ok, false);
  assert.equal(s.unverified, 112);
  assert.equal(s.acceptedBySeniorGate, 0);
});
