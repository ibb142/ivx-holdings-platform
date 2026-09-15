import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyContinuityResult } from './ivx-autonomous-runtime-enforcer';

describe('classifyContinuityResult', () => {
  it('should return observed when state is ALREADY_VERIFIED', () => {
    const result = classifyContinuityResult({
      ok: true,
      action: 'TEST_ACTION',
      taskId: 'test_task',
      states: ['RUNNING', 'ALREADY_VERIFIED'],
    });
    assert.strictEqual(result, 'observed');
  });
});
