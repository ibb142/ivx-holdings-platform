import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describePilotSentinel } from './ivx-autonomous-coder-pilot';

describe('PilotSentinel Consistency Test', () => {
  it('should have matching PILOT_LABEL and PILOT_LABEL_TARGET', () => {
    const sentinel = describePilotSentinel();
    assert.strictEqual(sentinel.label, sentinel.target);
  });
});
