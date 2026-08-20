/**
 * Runs the public chat SSE streaming suite in a dedicated bun process.
 *
 * The real assertions live in `public-chat-stream.isolated-suite.ts`. That file
 * has to stub the streaming endpoint's dependencies, and bun's `mock.module`
 * registry is process-global and effectively irreversible — once a specifier is
 * stubbed, every test file loaded afterwards in the same process gets the stub,
 * and re-registering the real module does not undo it (bun mutates the already
 * imported namespace in place).
 *
 * Running those stubs inside the shared backend process poisoned unrelated
 * suites: the authoritative-intent-router matrix scored 248/390 instead of
 * 390/390, and the chat-intent-router, identity-brain, conversation-brain and
 * ai-runtime suites failed in a full run while passing when run alone.
 *
 * Spawning a child process keeps the coverage identical and the stubs contained.
 */
import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';

const SUITE = join(import.meta.dir, 'public-chat-stream.isolated-suite.ts');

describe('public chat SSE streaming (isolated process)', () => {
  test('the streaming suite passes in its own process', async () => {
    const proc = Bun.spawn(['bun', 'test', SUITE], {
      cwd: join(import.meta.dir, '..', '..'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env },
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    const output = `${stdout}\n${stderr}`;

    if (exitCode !== 0) {
      // Surface the child's own reporter output so a failure here is as
      // actionable as it would be if the suite ran inline.
      throw new Error(`public chat SSE streaming suite failed:\n${output}`);
    }

    expect(output).toContain('4 pass');
    expect(output).toContain('0 fail');
  }, 120_000);
});
