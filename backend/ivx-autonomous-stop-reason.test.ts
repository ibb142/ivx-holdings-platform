import { expect, spyOn, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runIVXAutonomousCoder, type IVXAutonomousCoderInput } from './services/ivx-autonomous-coder';

const source = 'backend/services/stop-fixture.ts';
const original = 'export const value = 1;';

async function fixture(run: (input: IVXAutonomousCoderInput, advance: (ms: number) => void) => Promise<void>) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'ivx-stop-reason-'));
  await mkdir(path.dirname(path.join(root, source)), { recursive: true });
  await writeFile(path.join(root, source), original);
  let now = Date.now();
  const clock = spyOn(Date, 'now').mockImplementation(() => now);
  try {
    await run({
      taskId: 'stop-reason-fixture', goal: `Update ${source}`, ownerId: 'fixture',
      executionMode: 'code_change', approvalPolicy: 'owner_gated', projectRoot: root,
      llmCaller: async () => JSON.stringify({ rootCause: 'Incorrect value', technicalPlan: 'Update value', operations: [
        { path: source, kind: 'replace_exact', oldText: 'value = 1', newText: 'value = 2', reason: 'Update value' },
      ] }),
      testRunner: async (_cwd, command) => ({ command, ok: false, exitCode: 1, durationMs: 1, stdoutTail: '', stderrTail: 'Fixture test failed' }),
      commitFn: async () => { throw new Error('Stopped work must never commit'); },
    }, ms => { now += ms; });
    expect(await readFile(path.join(root, source), 'utf8')).toBe(original);
  } finally {
    clock.mockRestore();
    await rm(root, { recursive: true, force: true });
  }
}

test('runtime budget exhaustion is BLOCKED with its limit, never owner cancellation', async () => fixture(async (input, advance) => {
  let calls = 0;
  const proof = await runIVXAutonomousCoder({ ...input, maxRuntimeMs: 100,
    heartbeat: () => advance(101), llmCaller: async () => { calls++; return '{}'; },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.error).toContain('RUNTIME_LIMIT_EXCEEDED');
  expect(proof.error).toContain('100 ms');
  expect(proof.error).not.toContain('owner requested');
  expect(calls).toBe(0);
}));

test('an overlong test phase keeps its receipts and stops with STAGE_TIMEOUT_EXCEEDED', async () => fixture(async (input, advance) => {
  let calls = 0;
  const llm = input.llmCaller!;
  const proof = await runIVXAutonomousCoder({ ...input,
    llmCaller: async (system, user) => { calls++; return llm(system, user); },
    testRunner: async (_cwd, command) => {
      advance(60_000);
      return { command, ok: false, exitCode: 1, durationMs: 60_000, stdoutTail: '', stderrTail: 'Fixture validation timeout' };
    },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.error).toContain('STAGE_TIMEOUT_EXCEEDED');
  expect(proof.error).toContain('testing');
  expect(proof.error).toContain('90000 ms');
  expect(proof.error).not.toContain('JOB_CANCELED');
  expect(proof.commandsRun).toHaveLength(2);
  expect(proof.iterations).toHaveLength(1);
  expect(calls).toBe(1);
}));

test('explicit owner cancellation retains its own terminal reason', async () => fixture(async input => {
  const proof = await runIVXAutonomousCoder({ ...input, isCanceled: () => true });
  expect(proof.finalStatus).toBe('CANCELED');
  expect(proof.error).toContain('JOB_CANCELED');
  expect(proof.commitSha).toBeNull();
}));
