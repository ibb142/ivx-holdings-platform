import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describePilotSentinel } from './ivx-autonomous-coder-pilot';

describe('Pilot Sentinel Descriptor', () => {
  it('should have matching label and target', () => {
    const pilot = describePilotSentinel();
    assert.strictEqual(pilot.label, pilot.target);
  });
});