import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { triageFindings } from './enterprise-finding-triage.mjs';

const sourceSha = 'a'.repeat(40);
function input(file, source, ruleId = 'UNSAFE_JSON_PARSE', severity = 'P1') {
  const findings = [{ file, ruleId, severity, line: 1, preview: source.split('\n')[0].trim().slice(0, 220) }];
  return { audit: { sourceSha, findings: { total: 1, p0: Number(severity === 'P0'), p1: Number(severity === 'P1'), p2: Number(severity === 'P2') } },
    findings, ledger: [{ file, lines: source.split('\n').length, sha256: createHash('sha256').update(source).digest('hex') }], readSource: () => source };
}
const history = JSON.stringify([{ ruleId: 'UNSAFE_JSON_PARSE', file: 'backend/api/example.ts', line: 1,
  preview: 'await response.json()', message: 'Review response contract' }]);
test('historical report data is classified with source evidence without changing the audit gate', () => {
  const result = triageFindings(input('qa/evidence/enterprise-line-findings.json', history));
  assert.equal(result.falsePositives, 1); assert.equal(result.findings[0].sourceVerified, true);
  assert.equal(result.originalCounts.p1, 1); assert.equal(result.auditGateUnchanged, true); assert.equal(result.certified, false);
});
test('missing or changed source cannot authorize suppression', () => {
  const data = input('qa/evidence/enterprise-line-findings.json', history);
  assert.equal(triageFindings({ ...data, readSource: () => null }).reviewRequired, 1);
  assert.throws(() => triageFindings({ ...data, readSource: () => history + ' ' }), /source hash/);
});
test('executable calls, QA skips, type and lint suppressions stay open', () => {
  for (const [rule, line] of [['UNSAFE_JSON_PARSE', 'await response.json()'], ['QA_CERT_SKIP', "status: 'SKIP'"],
    ['TS_IGNORE', '// @ts-ignore'], ['ESLINT_DISABLE', '// eslint-disable-next-line']]) {
    assert.equal(triageFindings(input('backend/api/owner.ts', line, rule)).reviewRequired, 1);
  }
});
test('blueprint JSON and P0 matches are never suppressed as historical reports', () => {
  assert.equal(triageFindings(input('backend/services/generated/blueprint.json', history)).reviewRequired, 1);
  assert.equal(triageFindings(input('qa/evidence/enterprise-line-findings.json', history, 'HARDCODED_SECRET', 'P0')).reviewRequired, 1);
});
test('only the exact reviewed explanatory comment qualifies', () => {
  const file = 'expo/__tests__/autonomous-owner-audit-failclosed.test.ts';
  const comment = '// Telemetry flows through the JSON-contract reader; raw response.json() is banned.';
  assert.equal(triageFindings(input(file, comment)).falsePositives, 1);
  assert.equal(triageFindings(input(file, 'await response.json()')).reviewRequired, 1);
});
test('rejects inconsistent totals, unsafe paths and duplicate finding identities', () => {
  const data = input('backend/api/owner.ts', 'await response.json()');
  assert.throws(() => triageFindings({ ...data, audit: { ...data.audit, findings: { total: 0 } } }), /totals/);
  assert.throws(() => triageFindings(input('../escape.ts', 'x')), /identity/);
  assert.throws(() => triageFindings({ ...data, findings: [...data.findings, ...data.findings], audit: { ...data.audit, findings: { total: 2, p0: 0, p1: 2, p2: 0 } } }), /Duplicate/);
});
