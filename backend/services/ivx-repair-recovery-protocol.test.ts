import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRepairTestRuntime, repairRecoveryLesson } from './ivx-repair-recovery-protocol';

test('restores scope and CI lessons from durable failures without weakening the existing checks', () => {
  for (const [error, id] of [
    ['REPAIR_DEFECT_SCOPE_VIOLATION: unrelated investment score', 'DEFECT_SCOPE'],
    ['Required CI checks FAILED on an exact commit: qa-suite=completed/failure', 'CI_REGRESSION'],
  ]) {
    const restarted = JSON.parse(JSON.stringify({ error: 'wrapper '.repeat(150) + error }));
    const lesson = repairRecoveryLesson(restarted.error);
    assert.equal(lesson?.id, id);
    assert.equal(lesson?.protocol, 'ivx-repair-recovery-protocol-v3');
    assert.match(lesson!.instruction, id === 'CI_REGRESSION' ? /Preserve existing assertions/ : /Do not substitute a different business rule/);
  }
});

test('recognizes unsupported test globals and imports instead of repeating the same runtime failure', () => {
  for (const error of ["Cannot find module 'node-fetch'", 'jest is not defined', 'vi is not defined', "Cannot find name 'vi'"]) {
    const lesson = repairRecoveryLesson('REPAIR_REGRESSION_NOT_REPRODUCED\n' + error);
    assert.equal(lesson?.id, 'NODE_TEST_RUNTIME');
    assert.match(lesson!.instruction, /built-in fetch/);
    assert.match(lesson!.instruction, /node:test/);
  }
});

test('a missing patch target teaches explicit file creation without relaxing inspection', () => {
  const lesson = repairRecoveryLesson("ENOENT: no such file or directory, open '/app/backend/services/helper.ts'");
  assert.equal(lesson?.id, 'PATCH_CONTEXT');
  assert.match(lesson!.instruction, /create_file only for a verified missing/);
  assert.match(lesson!.instruction, /replace_exact for existing files/);
});

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
