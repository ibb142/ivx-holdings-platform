import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { discoverBackendTests, runIsolatedTests } from './ivx-backend-isolated-tests.mjs';

test('discovery covers every supported suffix and rejects an empty or duplicated gate', () => {
  const files = ['backend/a.test.ts', 'backend/b.spec.tsx', 'backend/c_test.js', 'backend/d_spec.jsx', 'backend/e.test.mjs', 'backend/f.test.cts'];
  assert.deepEqual(discoverBackendTests([...files, 'backend/api.ts', 'expo/app.test.ts', 'backend/fixture.isolated-suite.ts']), files);
  assert.throws(() => discoverBackendTests(['backend/api.ts']));
  assert.throws(() => discoverBackendTests([files[0], files[0]]));
});

test('every file gets a separate process; a failed suite survives later passing suites in the report', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ivx-isolation-'));
  try {
    await writeFile(join(cwd, 'first.mjs'), "process.env.IVX_TEST_LEAK = 'set'; console.log('first'); process.exitCode = 7;");
    await writeFile(join(cwd, 'second.mjs'), "if (process.env.IVX_TEST_LEAK) throw new Error('process state leaked'); console.log('second');");
    const report = await runIsolatedTests(['first.mjs', 'second.mjs'], { cwd, outputDir: join(cwd, 'out'), sourceSha: 'a'.repeat(40), command: process.execPath, prefix: [], concurrency: 1 });
    assert.equal(report.discovered, 2); assert.equal(report.executed, 2);
    assert.equal(report.result, 'FAIL'); assert.equal(report.failed, 1); assert.equal(report.passed, 1);
    assert.equal(report.files[0].exitCode, 7); assert.equal(report.files[1].exitCode, 0);
    assert.match(await readFile(report.files[0].logFile, 'utf8'), /first/);
    assert.equal(JSON.parse(await readFile(join(cwd, 'out/report.json'), 'utf8')).result, 'FAIL');
  } finally { await rm(cwd, { recursive: true, force: true }); }
});

test('missing executables, hanging suites and empty execution cannot produce PASS', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'ivx-isolation-fail-'));
  try {
    const options = { cwd, outputDir: join(cwd, 'out'), sourceSha: 'b'.repeat(40), concurrency: 1 };
    await assert.rejects(runIsolatedTests([], options));
    const missing = await runIsolatedTests(['test.mjs'], { ...options, command: join(cwd, 'missing-binary') });
    assert.equal(missing.result, 'FAIL'); assert.match(missing.files[0].error, /ENOENT/);
    await writeFile(join(cwd, 'hang.mjs'), 'setInterval(() => {}, 1000);');
    const timeout = await runIsolatedTests(['hang.mjs'], { ...options, command: process.execPath, prefix: [], timeoutMs: 100 });
    assert.equal(timeout.result, 'FAIL'); assert.equal(timeout.files[0].timedOut, true);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
