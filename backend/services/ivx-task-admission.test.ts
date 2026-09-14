import { expect, test } from 'bun:test';
import { parseTaskAdmission } from './ivx-task-admission';

const valid = {
  title: 'Fix App Guide', description: 'Repair the native route and verify it on device.',
  taskType: 'development', idempotencyKey: 'owner-app-guide-v1',
  acceptanceCriteria: [{ id: 'route', description: 'App Guide opens on device', verificationMethod: 'test_pass' }],
  dependencies: ['task-build'], executionOrder: 0, maxRetries: 0,
};

test('preserves caller requirements, dependencies and zero retries without certifying evidence', () => {
  const parsed = parseTaskAdmission(valid);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) return;
  expect(parsed.input.acceptanceCriteria).toEqual([{ ...valid.acceptanceCriteria[0], met: false, evidence: null }]);
  expect(parsed.input.dependencies).toEqual(['task-build']);
  expect(parsed.input.maxRetries).toBe(0);
  expect(parsed.input.idempotencyKey).toBe(valid.idempotencyKey);
});

test('rejects the incompatible dispatcher taxonomy and unstructured criteria', () => {
  for (const change of [{ taskType: 'DEVELOPER_WORKER' }, { acceptanceCriteria: '11/11 Green' }, { evidence: 'audit reference' }]) {
    expect(parseTaskAdmission({ ...valid, ...change }).ok).toBe(false);
  }
  expect(parseTaskAdmission({ task_id: 'task-existing', payload: valid }).ok).toBe(false);
});

test('requires caller idempotency and rejects malformed JSON, IDs and numeric coercion', () => {
  for (const body of [null, [], 'text', { ...valid, idempotencyKey: undefined }, { ...valid, title: {} },
    { ...valid, assignedAgentNumber: 113 }, { ...valid, assignedAgentNumber: '1' }, { ...valid, maxRetries: -1 }]) {
    expect(parseTaskAdmission(body).ok).toBe(false);
  }
});

test('cannot import completion, lease or approval flags through task admission', () => {
  for (const field of ['state', 'leaseHolder', 'approvalId', 'ownerApproved', 'commitSha']) {
    expect(parseTaskAdmission({ ...valid, [field]: 'forged' }).ok).toBe(false);
  }
  expect(parseTaskAdmission({ ...valid, acceptanceCriteria: [{ ...valid.acceptanceCriteria[0], met: true, evidence: 'claimed pass' }] }).ok).toBe(false);
  expect(parseTaskAdmission({ ...valid, acceptanceCriteria: [valid.acceptanceCriteria[0], valid.acceptanceCriteria[0]] }).ok).toBe(false);
});
