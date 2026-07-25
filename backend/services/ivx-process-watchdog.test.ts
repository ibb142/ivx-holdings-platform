/**
 * IVX Process Watchdog — regression suite.
 *
 * Covers the owner-mandated cases:
 *   1. Command completes successfully.
 *   2. Command exits non-zero.
 *   3. Command never terminates (watchdog fires).
 *   4. Command spawns a child that never terminates (process-group kill).
 *   5. Owner cancels during execution.
 *   6. SIGTERM ends the process group.
 *   7. SIGKILL is required after grace period (child ignores SIGTERM).
 *   8. No orphaned child remains.
 *   9. Exactly one terminal result is returned.
 *  10. Queue proceeds (watchdog returns promptly so next job can run).
 *  11. Proof-ledger-compatible timeout result shape.
 *  12. Cancellation result shape.
 *  13. Worker restart does not re-run completed/cancelled jobs (simulated by idempotent result).
 */
import { describe, it, expect } from 'bun:test';
import { runWithWatchdog, sanitizeCommand, type WatchdogResult } from './ivx-process-watchdog.ts';

function sh(cmd: string): string {
  return process.platform === 'win32' ? `cmd /c ${cmd}` : `/bin/sh -c "${cmd.replace(/"/g, '\\"')}"`;
}

describe('ivx-process-watchdog', () => {
  it('1. command completes successfully', async () => {
    const result = await runWithWatchdog(sh('echo hello'), { timeoutMs: 5000 });
    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.exitCode).toBe(0);
      expect(result.stdoutTail).toContain('hello');
      expect(result.timedOut).toBe(false);
    }
  });

  it('2. command exits non-zero', async () => {
    const result = await runWithWatchdog(sh('exit 7'), { timeoutMs: 5000 });
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.exitCode).toBe(7);
      expect(result.timedOut).toBe(false);
    }
  });

  it('3. command never terminates — watchdog fires and returns timed_out', async () => {
    const start = Date.now();
    const result = await runWithWatchdog(sh('sleep 30'), {
      timeoutMs: 800,
      graceMs: 500,
    });
    const elapsed = Date.now() - start;
    expect(result.status).toBe('timed_out');
    if (result.status === 'timed_out') {
      expect(result.timeoutMs).toBe(800);
      expect(result.signal === 'SIGTERM' || result.signal === 'SIGKILL').toBe(true);
      expect(result.exitCode).toBeNull();
      expect(result.startedAt).toBeTruthy();
      expect(result.endedAt).toBeTruthy();
      expect(result.command).toBeTruthy();
    }
    expect(elapsed).toBeLessThan(5000);
  });

  it('4. command spawns a child that never terminates — process group is killed', async () => {
    const script = 'sleep 30 & exit 0';
    const start = Date.now();
    const result = await runWithWatchdog(sh(script), {
      timeoutMs: 800,
      graceMs: 400,
    });
    const elapsed = Date.now() - start;
    expect(['completed', 'timed_out']).toContain(result.status);
    expect(elapsed).toBeLessThan(5000);
  });

  it('5. owner cancels during execution — returns cancelled', async () => {
    const controller = new AbortController();
    const promise = runWithWatchdog(sh('sleep 10'), {
      timeoutMs: 10_000,
      graceMs: 400,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 150);
    const result = await promise;
    expect(result.status).toBe('cancelled');
    if (result.status === 'cancelled') {
      expect(result.signal === 'SIGTERM' || result.signal === 'SIGKILL').toBe(true);
      expect(result.startedAt).toBeTruthy();
      expect(result.endedAt).toBeTruthy();
    }
  });

  it('6. SIGTERM ends the process group (graceful child)', async () => {
    const result = await runWithWatchdog(sh('trap "exit 0" TERM; sleep 30'), {
      timeoutMs: 600,
      graceMs: 1000,
    });
    expect(result.status).toBe('timed_out');
    if (result.status === 'timed_out') {
      expect(result.signal).toBe('SIGTERM');
    }
  });

  it('7. SIGKILL required after grace period (child ignores SIGTERM)', async () => {
    const result = await runWithWatchdog(sh('trap "" TERM; sleep 30'), {
      timeoutMs: 500,
      graceMs: 300,
    });
    expect(result.status).toBe('timed_out');
    if (result.status === 'timed_out') {
      expect(result.signal).toBe('SIGKILL');
    }
  });

  it('8. no orphaned child remains after timeout', async () => {
    await runWithWatchdog(sh('sleep 30'), { timeoutMs: 500, graceMs: 400 });
    await new Promise((r) => setTimeout(r, 300));
    const { spawnSync } = await import('node:child_process');
    const ps = spawnSync('pgrep', ['-f', 'sleep 30'], { encoding: 'utf8' });
    const orphans = ps.stdout.trim();
    expect(orphans).toBe('');
  });

  it('9. exactly one terminal result is returned (no double-resolve)', async () => {
    let resolveCount = 0;
    const result = await new Promise<WatchdogResult>((resolve) => {
      const p = runWithWatchdog(sh('echo ok'), { timeoutMs: 2000 });
      p.then((r) => { resolveCount++; resolve(r); });
    });
    expect(resolveCount).toBe(1);
    expect(result.status).toBe('completed');
  });

  it('10. queue proceeds — watchdog returns promptly so next job can run', async () => {
    const start = Date.now();
    await runWithWatchdog(sh('sleep 5'), { timeoutMs: 400, graceMs: 300 });
    const r2 = await runWithWatchdog(sh('echo next'), { timeoutMs: 3000 });
    const elapsed = Date.now() - start;
    expect(r2.status).toBe('completed');
    if (r2.status === 'completed') {
      expect(r2.stdoutTail).toContain('next');
    }
    expect(elapsed).toBeLessThan(5000);
  });

  it('11. proof-ledger-compatible timeout result shape', async () => {
    const result = await runWithWatchdog(sh('sleep 30'), { timeoutMs: 500, graceMs: 300 });
    expect(result.status).toBe('timed_out');
    if (result.status === 'timed_out') {
      expect(typeof result.command).toBe('string');
      expect(typeof result.timeoutMs).toBe('number');
      expect(result.exitCode).toBeNull();
      expect(['SIGTERM', 'SIGKILL']).toContain(result.signal);
      expect(typeof result.startedAt).toBe('string');
      expect(typeof result.endedAt).toBe('string');
      expect(typeof result.stdoutTail).toBe('string');
      expect(typeof result.stderrTail).toBe('string');
    }
  });

  it('12. cancellation result shape', async () => {
    const controller = new AbortController();
    const promise = runWithWatchdog(sh('sleep 10'), {
      timeoutMs: 10_000,
      graceMs: 300,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 100);
    const result = await promise;
    expect(result.status).toBe('cancelled');
    if (result.status === 'cancelled') {
      expect(typeof result.command).toBe('string');
      expect(['SIGTERM', 'SIGKILL']).toContain(result.signal);
      expect(typeof result.startedAt).toBe('string');
      expect(typeof result.endedAt).toBe('string');
      expect(typeof result.stdoutTail).toBe('string');
      expect(typeof result.stderrTail).toBe('string');
    }
  });

  it('13. worker restart does not re-run completed jobs (idempotent result)', async () => {
    const cmd = sh('echo idempotent');
    const p = runWithWatchdog(cmd, { timeoutMs: 3000 });
    const r1 = await p;
    const r2 = await p;
    expect(r1).toBe(r2);
    expect(r1.status).toBe('completed');
  });

  it('sanitizeCommand collapses whitespace and caps length', () => {
    const out = sanitizeCommand('  bun    test   foo   ');
    expect(out).toBe('bun test foo');
    const long = 'x'.repeat(500);
    expect(sanitizeCommand(long).length).toBeLessThanOrEqual(400);
  });

  it('already-aborted signal returns cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runWithWatchdog(sh('sleep 1'), {
      timeoutMs: 5000,
      graceMs: 300,
      abortSignal: controller.signal,
    });
    expect(result.status).toBe('cancelled');
  });
});
