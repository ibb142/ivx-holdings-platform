import { parseLandingProductivityEvidence } from './ivx-agent-productivity-verifier';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('should return null for zero productiveSeconds', () => {
  const summary = 'LANDING_P0_RESULT {"unit_id":"unit1","agent_number":1,"status":"PASS","started_at":"2026-09-11T00:00:00.000Z","completed_at":"2026-09-11T00:10:00.000Z","productive_seconds":0,"production_sha":"abc123"}';
  const result = parseLandingProductivityEvidence(summary);
  assert.strictEqual(result, null);
});
