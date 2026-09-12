import { test, expect } from 'bun:test';
import { join } from 'node:path';

test('Owner streaming cancellation and authorization in an isolated process', async () => {
  const child = Bun.spawn(['bun', 'test', join(import.meta.dir, 'ivx-owner-ai-stream.isolated-suite.ts')], {
    cwd: join(import.meta.dir, '..', '..'), stdout: 'pipe', stderr: 'pipe', env: { ...process.env },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`Owner streaming regression failed:\n${stdout}\n${stderr}`);
  expect(code).toBe(0);
}, 120_000);
