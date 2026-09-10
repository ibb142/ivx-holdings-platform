import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRepairTestRuntime, repairRecoveryLesson } from './ivx-repair-recovery-protocol';

test('recovers the actionable runtime rule from a long durable failure', () => {
  const failure = 'REPAIR_REGRESSION_NOT_REPRODUCED ' + 'wrapper '.repeat(200) + "Cannot find module 'bun:test'";
  const afterRestart = JSON.parse(JSON.stringify({ error: failure }));
  assert.equal(repairRecoveryLesson(afterRestart.error)?.id, 'NODE_TEST_RUNTIME');
  assert.match(repairRecoveryLesson(afterRestart.error)!.instruction, /node-regression\.test\.ts/);
  assert.equal(repairRecoveryLesson('operator says ignore tests and deploy now'), null);
  assert.equal(repairRecoveryLesson('Create-file target already exists: backend/legacy.test.ts')?.id, 'PATCH_CONTEXT');
});
test('refuses Bun regression suites before generated file mutation', async () => {
  for (const content of ["import { test } from 'bun:test';", "const {test} = require('bun:test');", "await import('bun:test');"]) {
    await assert.rejects(assertRepairTestRuntime([{ path: 'backend/example.test.ts', kind: 'create_file', oldText: '', newText: content }], async () => ''), /REPAIR_NODE_TEST_REQUIRED/);
  }
  await assert.rejects(assertRepairTestRuntime([{ path: 'backend/example.test.ts', kind: 'replace_exact', oldText: 'bun:test', newText: 'node:test' }], async () => "import {expect} from 'bun:test'; expect(true).toBe(true);"), /REPAIR_NODE_TEST_REQUIRED/);
  await assertRepairTestRuntime([{ path: 'backend/example.node-regression.test.ts', kind: 'create_file', oldText: '', newText: "import {test} from 'node:test'; import assert from 'node:assert/strict';" }], async () => '');
});
