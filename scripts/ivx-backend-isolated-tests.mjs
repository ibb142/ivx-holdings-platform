import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function discoverBackendTests(tracked) {
  const files = tracked.filter(file => file.startsWith('backend/') && /[._](test|spec)\.[cm]?[jt]sx?$/.test(file)).sort();
  if (!files.length || new Set(files).size !== files.length) throw new Error('Backend test discovery is empty or duplicated');
  return files;
}

export async function runIsolatedTests(files, { cwd, outputDir, sourceSha, command = 'bun', prefix = ['test'], concurrency = 2, timeoutMs = 120_000 } = {}) {
  if (!files.length || new Set(files).size !== files.length) throw new Error('Every discovered suite must run exactly once');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Invalid test concurrency');
  await mkdir(outputDir, { recursive: true });
  const startedAt = new Date().toISOString(), results = new Array(files.length);
  let next = 0;
  async function worker() {
    while (next < files.length) {
      const index = next++, file = files[index], start = Date.now();
      const logPath = resolve(outputDir, `${String(index + 1).padStart(4, '0')}.log`);
      const result = await new Promise(done => {
        let output = '', timedOut = false, settled = false;
        const child = spawn(command, [...prefix, `./${file}`], { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
        const append = chunk => { output += chunk.toString(); if (output.length > 8_000_000) output = output.slice(-8_000_000); };
        child.stdout.on('data', append); child.stderr.on('data', append);
        const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
        const finish = (exitCode, signal, error) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          done({ file, sourceSha, startedAt: new Date(start).toISOString(), completedAt: new Date().toISOString(),
            durationMs: Date.now() - start, exitCode, signal, timedOut, error: error?.message ?? null,
            passed: exitCode === 0 && !signal && !timedOut && !error, output });
        };
        child.once('error', error => finish(null, null, error));
        child.once('close', (code, signal) => finish(code, signal, null));
      });
      await writeFile(logPath, result.output);
      const { output, ...receipt } = result;
      results[index] = { ...receipt, logFile: logPath };
      console.log(`${result.passed ? 'PASS' : 'FAIL'} ${file} (${result.durationMs}ms)`);
      if (!result.passed) console.error(output.split('\n').slice(-50).join('\n'));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));
  const report = { sourceSha, startedAt, completedAt: new Date().toISOString(), isolation: 'one process per discovered file',
    discovered: files.length, executed: results.length, passed: results.filter(r => r.passed).length,
    failed: results.filter(r => !r.passed).length, files: results,
    result: results.every(r => r.passed) ? 'PASS' : 'FAIL' };
  await writeFile(resolve(outputDir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ ...report, files: undefined }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const cwd = process.cwd();
    const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim();
    const tracked = execFileSync('git', ['ls-files', '-z', '--', 'backend'], { cwd, encoding: 'utf8' }).split('\0').filter(Boolean);
    const files = discoverBackendTests(tracked);
    const report = await runIsolatedTests(files, { cwd, sourceSha, outputDir: resolve(cwd, 'qa/evidence/backend-isolated') });
    process.exitCode = report.result === 'PASS' ? 0 : 1;
  } catch (error) {
    console.error(error); process.exitCode = 1;
  }
}
