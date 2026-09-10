import { expect, test } from 'bun:test';
test('learning retains failures without a healthy baseline and when GitHub comparison fails', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    let saved;
    mock.module('./backend/services/ivx-durable-store.ts', () => ({
      readDurableJson: async (_file, fallback) => structuredClone(saved ?? fallback),
      writeDurableJson: async (_file, value) => { saved = structuredClone(value); },
    }));
    mock.module('./backend/services/ivx-autonomous-task-engine.ts', () => ({ createTask: async () => { throw Error('unexpected task creation'); }, getAllTasks: async () => [] }));
    const { observeAndLearn } = await import('./backend/services/ivx-autonomous-learning-engine.ts');
    const failure = { sourceSha: 'a'.repeat(40), certified: false, working: 0, total: 112, diagnoses: ['HEARTBEAT_GAP'], runtimeError: 'query timeout' };
    await observeAndLearn(failure);
    await observeAndLearn(failure);
    assert.equal(saved.lastKnownGoodSha, null);
    assert.equal(saved.lessons.length, 1);
    assert.equal(saved.lessons[0].occurrences, 2);
    assert.equal(saved.lessons[0].repairVerified, false);
    assert.match(saved.lessons[0].fingerprint, /query timeout/);
    await observeAndLearn({ ...failure, certified: true });
    globalThis.fetch = async () => new Response(null, { status: 503 });
    const result = await observeAndLearn({ ...failure, sourceSha: 'b'.repeat(40) });
    assert.match(result.action, /COMPARE_FAILED/);
    assert.equal(saved.lessons.length, 2);
    assert.equal(saved.lessons[0].badSha, 'b'.repeat(40));
    assert.equal(saved.lessons[0].repairVerified, false);
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 8000 });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).not.toContain('Error:');
  expect(code).toBe(0);
});
