import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configuredAdmissionLimit } from './ivx-fleet-admission-policy';

test('Admission limit is not zero', () => {
  assert.strictEqual(configuredAdmissionLimit('0', 10), 1);
  assert.strictEqual(configuredAdmissionLimit('5', 10), 5);
  assert.strictEqual(configuredAdmissionLimit(undefined, 10), 10);
});
