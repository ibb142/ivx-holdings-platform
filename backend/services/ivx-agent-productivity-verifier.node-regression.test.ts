import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLandingProductivityEvidence } from './ivx-agent-productivity-verifier';

test('parseLandingProductivityEvidence handles agent numbers within bounds', () => {
  const summary = 'LANDING_P0_RESULT {"unit_id":"u1","agent_number":113,"status":"PASS","started_at":"2026-09-10T20:28:07.316Z","completed_at":"2026-09-10T21:28:07.316Z","productive_seconds":3600,"production_sha":"abc123"}';
  const result = parseLandingProductivityEvidence(summary);
  assert.notStrictEqual(result, null);
  assert.strictEqual(result?.agentNumber, 113);
});