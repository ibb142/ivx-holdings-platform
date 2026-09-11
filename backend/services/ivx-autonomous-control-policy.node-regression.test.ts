import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autonomousRepairCapacity } from './ivx-autonomous-control-policy';

test('autonomousRepairCapacity should be 112', () => {
  const mockEnv = {
    IVX_CAMPAIGN_MAX_CONCURRENCY: '12',
    IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY: '12',
  };
  const capacity = autonomousRepairCapacity(mockEnv);
  assert.strictEqual(capacity, 112, 'Expected repair capacity to be 112');
});
