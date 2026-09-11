import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { TRUTH_TIMEOUT_MS } from './ivx-postgres-autonomous-task-store';

describe('Telemetry Timeout Tests', () => {
  it('should have increased TRUTH_TIMEOUT_MS', () => {
    assert.strictEqual(TRUTH_TIMEOUT_MS, 15000);
  });
});
