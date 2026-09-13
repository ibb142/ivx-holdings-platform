import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describePilotSentinel } from './ivx-autonomous-coder-pilot';

describe('Pilot Sentinel', () => {
  it('should have updated PILOT_LABEL to target value', () => {
    const sentinel = describePilotSentinel();
    assert.strictEqual(sentinel.label, 'AUTONOMOUS-CODER-PILOT-3');
  });
});