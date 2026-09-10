import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

test('legacy engineering cannot claim an obsolete or current patrol as a module audit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ivx-patrol-boundary-'));
  const moduleUrl = (name: string) => JSON.stringify(new URL(`./${name}.ts`, import.meta.url).href);
  try {
    await mkdir(join(root, 'backend/services'), { recursive: true });
    await writeFile(join(root, 'backend/services/example.ts'), 'export const ready = true;');
    const script = `
      import assert from 'node:assert/strict';
      const load = async url => { const module = await import(url); return module.default ?? module; };
      const { isDurableStoreConfigured } = await load(${moduleUrl('ivx-durable-store')});
      const { postgresAtomicQueueSelected } = await load(${moduleUrl('ivx-postgres-autonomous-task-store')});
      const { createTask, getTaskById } = await load(${moduleUrl('ivx-autonomous-task-engine')});
      const { runRealEngineeringCycle } = await load(${moduleUrl('ivx-agent-real-engineering-cycle')});
      assert.equal(isDurableStoreConfigured(), false);
      assert.equal(postgresAtomicQueueSelected(), false);
      globalThis.fetch = async () => { throw new Error('Network forbidden in this isolated test'); };
      const current = 'a'.repeat(40), old = 'b'.repeat(40);
      for (const [agent, sha] of [[54, old], [79, current]]) {
        const task = (await createTask({ title: 'Landing continuous patrol', description: 'Synthetic patrol assignment',
          taskType: 'qa', priority: 'critical', assignedAgentNumber: agent,
          idempotencyKey: 'landing-p0-patrol:' + sha + ':ia-' + String(agent).padStart(3,'0') })).task;
        assert.ok(task);
        const result = await runRealEngineeringCycle({ agentId: 'ivx_holdings_' + agent, agentNumber: agent, sourceSha: current });
        const saved = await getTaskById(task.taskId);
        assert.equal(saved.state, 'QUEUED', 'A patrol must remain available to its dedicated executor');
        assert.equal(saved.leaseHolder, null, 'The engineering cycle must not claim a patrol lease');
        assert.equal(saved.evidence.length, 0, 'Module inspection is not Landing patrol evidence');
        assert.notEqual(result.taskId, task.taskId);
      }
    `;
    const result = await promisify(execFile)('node', ['--import', createRequire(import.meta.url).resolve('tsx'), '--input-type=module', '-e', script], { cwd: root, timeout: 20000 });
    assert.equal(result.stderr.includes('AssertionError'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
