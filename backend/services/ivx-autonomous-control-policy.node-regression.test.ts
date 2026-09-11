import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { autonomousRepairCapacity } from './ivx-autonomous-control-policy';

test('autonomousRepairCapacity - capacity calculation', () => {
  const env = {
    IVX_CAMPAIGN_MAX_CONCURRENCY: '20',
    IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY: '32',
  };
  const capacity = autonomousRepairCapacity(env);
  assert.equal(capacity, 32, 'Expected capacity to be maximum of configuration values');
});
