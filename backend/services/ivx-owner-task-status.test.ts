import { expect, test } from 'bun:test';
import { parseOwnerTaskStatusCommand, readOwnerTaskStatus } from './ivx-owner-task-status';

test('the screenshot command preserves the internal CamelCase payload identity', () => {
  expect(parseOwnerTaskStatusCommand('/status --task="task_framework_patch_block_18_final"'))
    .toEqual({ taskId: 'task_framework_patch_block_18_final' });
  expect(parseOwnerTaskStatusCommand("/status --task 'task-2'" )).toEqual({ taskId: 'task-2' });
});

test('invalid commands fail explicitly instead of becoming model instructions', () => {
  for (const prompt of ['/status', '/status --task=""', '/status --task=x --deploy', '/status --task="../x"', '/status --task='+ 'a'.repeat(513)]) {
    expect(parseOwnerTaskStatusCommand(prompt)?.error).toBeTruthy();
  }
  expect(parseOwnerTaskStatusCommand('explain how /status works')).toBeNull();
});

test('an autonomous row reports only recorded execution evidence', async () => {
  let seniorReads = 0;
  const result = await readOwnerTaskStatus('task-1', async () => ({ taskId: 'task-1', state: 'RUNNING', commitSha: null }),
    async () => { seniorReads++; return null; });
  expect(result.task).toMatchObject({ taskId: 'task-1', state: 'RUNNING', commitSha: null });
  expect(result.answer).toContain('No deployment recorded');
  expect(seniorReads).toBe(0);
});

test('senior job lookup uses the same id and extracts persisted proof', async () => {
  const ids: string[] = [];
  const result = await readOwnerTaskStatus('job-1', async id => { ids.push(id); return null; },
    async id => { ids.push(id); return { jobId: id, status: 'testing', stage: 'TESTING', result: { commitSha: 'abc123', deployId: 'dep-real' } }; });
  expect(ids).toEqual(['job-1', 'job-1']);
  expect(result.task).toMatchObject({ source: 'senior_developer', state: 'testing', commitSha: 'abc123', deploymentId: 'dep-real' });
});

test('a linked developer job remains visible without inventing task completion', async () => {
  const result = await readOwnerTaskStatus('task-1', async () => ({ taskId: 'task-1', state: 'BLOCKED', developerJobId: 'job-1' }), async () => null);
  expect(result.answer).toContain('Developer job: job-1');
  expect(result.task).toMatchObject({ state: 'BLOCKED', developerJobId: 'job-1', commitSha: null });
});

test('an outage cannot be converted to task absence or fall through to another ledger', async () => {
  let secondary = 0;
  const result = await readOwnerTaskStatus('task-1', async () => { throw new Error('database timeout'); }, async () => { secondary++; return null; });
  expect(result.httpStatus).toBe(503); expect(result.code).toBe('TASK_STATUS_UNAVAILABLE'); expect(secondary).toBe(0);
});

test('payload identity mismatch fails closed and an absent task is reported as absent', async () => {
  expect((await readOwnerTaskStatus('task-1', async () => ({ taskId: 'other', state: 'COMPLETED' }), async () => null)).ok).toBe(false);
  const absent = await readOwnerTaskStatus('task-1', async () => null, async () => null);
  expect(absent.code).toBe('TASK_NOT_FOUND'); expect(absent.task).toBeNull();
});
