import { expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runIVXAutonomousCoder, type IVXAutonomousCoderInput, type IVXAutonomousCoderPatchOperation } from './services/ivx-autonomous-coder';

const source = 'backend/services/rollback-fixture.ts';
const added = 'backend/services/rollback-created.ts';
const original = 'export const existing = "B";\nexport const target = "A";\n';
const replace = (oldText: string, newText: string): IVXAutonomousCoderPatchOperation => ({ path: source, kind: 'replace_exact', oldText, newText, reason: 'Update target' });
const create = (file: string, content: string): IVXAutonomousCoderPatchOperation => ({ path: file, kind: 'create_file', oldText: '', newText: content, reason: 'Create target' });

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ivx-patch-rollback-'));
  try {
    await mkdir(path.dirname(path.join(root, source)), { recursive: true });
    await writeFile(path.join(root, source), original);
    await run(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}

function input(root: string, operations: IVXAutonomousCoderPatchOperation[], overrides: Partial<IVXAutonomousCoderInput> = {}): IVXAutonomousCoderInput {
  return {
    taskId: 'patch-rollback-fixture', goal: `Update the target in ${source}.`, ownerId: 'fixture',
    executionMode: 'code_change', approvalPolicy: 'owner_gated', projectRoot: root, maxLlmCalls: 1,
    llmCaller: async () => JSON.stringify({ rootCause: 'Incorrect target', technicalPlan: 'Update target', operations }),
    testRunner: async (_cwd, command) => ({ command, ok: false, exitCode: 1, stdoutTail: '', stderrTail: 'Fixture assertion failed', durationMs: 1 }),
    commitFn: async () => { throw new Error('A rejected patch must not be committed'); },
    ...overrides,
  };
}

test('failed sequential edits restore the exact original before another attempt', async () => fixture(async root => {
  const proof = await runIVXAutonomousCoder(input(root, [replace('"A"', '"C"'), replace('"C"', '"D"'), replace('absent text', 'unreachable')]));
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.commitSha).toBeNull();
  expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
}));

test('validation failure preserves an earlier occurrence of the replacement text', async () => fixture(async root => {
  const proof = await runIVXAutonomousCoder(input(root, [replace('"A"', '"B"')]));
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
}));

test('rejected idempotent create never deletes a pre-existing file', async () => fixture(async root => {
  const proof = await runIVXAutonomousCoder(input(root, [create(source, original)]));
  expect(proof.commitSha).toBeNull();
  expect(existsSync(path.join(root, source))).toBe(true);
  expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
}));

test('unexpected validation exceptions restore edited files and remove only new files', async () => fixture(async root => {
  const proof = await runIVXAutonomousCoder(input(root, [replace('"A"', '"C"'), create(added, 'export const added = true;')], {
    testRunner: async () => { throw new Error('Fixture validation transport failed'); },
  }));
  expect(proof.finalStatus).toBe('FAILED');
  expect(proof.error).toContain('Fixture validation transport failed');
  expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
  expect(existsSync(path.join(root, added))).toBe(false);
}));

test('a writer that changes the file before throwing is still rolled back', async () => fixture(async root => {
  const proof = await runIVXAutonomousCoder(input(root, [replace('"A"', '"C"')], {
    fileWriter: async (file, content) => {
      await writeFile(path.join(root, file), content);
      if (content !== original) throw new Error('Fixture write failed after mutation');
    },
  }));
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
}));

test('rollback failure stops further model calls and commits with an explicit failure', async () => fixture(async root => {
  let calls = 0;
  let commits = 0;
  const operations = [replace('"A"', '"C"')];
  const proof = await runIVXAutonomousCoder(input(root, operations, {
    maxLlmCalls: 6,
    llmCaller: async () => { calls++; return JSON.stringify({ rootCause: 'Incorrect target', technicalPlan: 'Update target', operations }); },
    fileWriter: async (file, content) => {
      if (content === original) throw new Error('Fixture restore denied');
      await writeFile(path.join(root, file), content);
    },
    commitFn: async () => { commits++; throw new Error('No commit allowed'); },
  }));
  expect(proof.finalStatus).toBe('FAILED');
  expect(proof.error).toContain('PATCH_ROLLBACK_FAILED');
  expect(calls).toBe(1);
  expect(commits).toBe(0);
}));

test('successful sequential edits verify their final content and reach the PR gate', async () => fixture(async root => {
  let commits = 0;
  const expected = original.replace('"A"', '"D"');
  const proof = await runIVXAutonomousCoder(input(root, [replace('"A"', '"C"'), replace('"C"', '"D"')], {
    testRunner: async (_cwd, command) => ({ command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1 }),
    commitFn: async (_files, branch) => {
      commits++;
      expect(await readFile(path.join(root, source), 'utf8')).toBe(expected);
      return { commitSha: 'a'.repeat(40), commitUrl: 'https://example.test/commit', branch };
    },
    prFn: async () => ({ prNumber: 1, prUrl: 'https://example.test/pr/1' }),
  }));
  expect(commits).toBe(1);
  expect(proof.prNumber).toBe(1);
  expect(await readFile(path.join(root, source), 'utf8')).toBe(expected);
}));
