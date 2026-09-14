import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingTaskEvidence } from './ivx-landing-task-evidence';
import { encodeLandingResult, type LandingResultRecord } from './ivx-landing-p0-backlog';

const validRecord: LandingResultRecord = {
  v: 1,
  unit_id: 'valid-unit',
  agent_number: 1,
  status: 'PASS',
  production_sha: 'a'.repeat(40),
  started_at: new Date().toISOString(),
  completed_at: new Date().toISOString(),
  productive_seconds: 30,
  api_checks: 1,
  browser_checks: 0,
  bugs_found: [],
  fixes_applied: [],
  blocked_reason: null,
  evidence: [],
  repair: false
};

test('landingTaskEvidence validation includes source check', () => {
  assert.throws(() => {
    landingTaskEvidence(validRecord, '', 'test_result');
  }, /LANDING_EVIDENCE_SOURCE_REQUIRED/, 'Expected source validation error');

  assert.doesNotThrow(() => {
    landingTaskEvidence(validRecord, 'valid-source', 'test_result');
  }, 'Source provided should not cause error');
});