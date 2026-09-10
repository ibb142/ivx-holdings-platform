import { expect, test } from 'bun:test';
test('daily learning uses exact identities and creates only the missing lane', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    import { strict as assert } from 'node:assert';
    let created = 0, fail = false;
    mock.module('./backend/services/ivx-durable-store.ts', () => ({ readDurableJson: async (_, fallback) => structuredClone(fallback), writeDurableJson: async () => {} }));
    mock.module('./backend/services/ivx-autonomous-task-engine.ts', () => ({
      getAllTasks: async () => { throw Error('historical payload scan forbidden'); },
      createTask: async input => { created++; assert.match(input.idempotencyKey, /:ia-112$/); return { ok: true, task: input }; }
    }));
    mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts', () => ({
      postgresAtomicQueueSelected: () => true,
      readPostgresTaskKeys: async keys => { if (fail) throw Error('database unavailable'); assert.equal(keys.length, 112); return keys.slice(0, 111); }
    }));
    const { observeAndLearn } = await import('./backend/services/ivx-autonomous-learning-engine.ts');
    const input = { sourceSha: 'a'.repeat(40), certified: false, working: 0, total: 112, diagnoses: ['HEARTBEAT_GAP'] };
    await observeAndLearn(input, { allowTaskCreation: true });
    assert.equal(created, 1);
    fail = true;
    await assert.rejects(observeAndLearn(input, { allowTaskCreation: true }), /database unavailable/);
    assert.equal(created, 1);
  `], { cwd: new URL('../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 8000 });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(error).not.toContain('Error:');
  expect(code).toBe(0);
});
