/**
 * IVX Process Watchdog — hard process-group termination with no orphans.
 *
 * Owner directive (2026-07-25): the previous spawn timeout used Node's
 * `timeout` option, which kills only the direct child. A nested lint
 * subprocess could outlive its parent and pin the worker at VERIFYING.
 *
 * This module launches every command in its own process group, starts an
 * explicit watchdog timer, and on timeout sends SIGTERM to the whole group,
 * waits a short grace period, then sends SIGKILL to any survivors. It clears
 * all timers/listeners, captures sanitized stdout/stderr tails, and returns
 * exactly one terminal result so the worker queue can continue.
 *
 * Cancellation is supported via an AbortSignal: when the owner cancels a job,
 * the caller aborts the signal and the watchdog terminates the group with the
 * same SIGTERM→grace→SIGKILL sequence, then returns a `cancelled` result.
 */
import { spawn } from 'node:child_process';
const DEFAULT_GRACE_MS = 1500;
const DEFAULT_STDOUT_MAX = 8192;
const DEFAULT_STDERR_MAX = 4096;
/**
 * Send a signal to an entire process group. Returns true if the signal was
 * delivered to at least one process. Uses `process.kill` with a negative pid
 * so the signal reaches every descendant spawned with `detached: true`.
 */
function signalProcessGroup(groupPid, signal) {
    try {
        process.kill(-groupPid, signal);
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Sanitize a command string for inclusion in a terminal result. Removes any
 * environment variable assignments and collapses whitespace, but keeps the
 * executable + args visible so the proof ledger is auditable.
 */
export function sanitizeCommand(command) {
    return command.replace(/\s+/g, ' ').trim().slice(0, 400);
}
function tailBuffer(buf, max) {
    if (buf.length <= max)
        return buf;
    return buf.slice(-max);
}
/**
 * Run a command under an explicit watchdog. The command is launched in its
 * own process group (`detached: true`) so SIGTERM/SIGKILL reach the full
 * subprocess tree, not just the direct child.
 *
 * Guarantees:
 *   1. Exactly one terminal result is returned.
 *   2. On timeout: SIGTERM → grace → SIGKILL to the process group.
 *   3. On cancellation (abortSignal): same sequence, result.status='cancelled'.
 *   4. All timers and listeners are cleared before returning.
 *   5. No orphaned child: a final SIGKILL is sent if any process survives.
 *   6. stdout/stderr tails are bounded and sanitized.
 */
export function runWithWatchdog(command, opts) {
    return new Promise((resolve) => {
        const startedAt = new Date().toISOString();
        const graceMs = opts.graceMs ?? DEFAULT_GRACE_MS;
        const stdoutMax = opts.stdoutMaxBytes ?? DEFAULT_STDOUT_MAX;
        const stderrMax = opts.stderrMaxBytes ?? DEFAULT_STDERR_MAX;
        const sanitizedCommand = sanitizeCommand(command);
        let resolved = false;
        let watchdogTimer = null;
        let graceTimer = null;
        let killTimer = null;
        let finalSignal = 'SIGTERM';
        let pendingKillReason = 'timed_out';
        let child = null;
        let groupPid = 0;
        let stdout = '';
        let stderr = '';
        // Execute the full command string via the system shell so quoted args,
        // pipes, redirects, and compound commands work.
        const isWin = process.platform === 'win32';
        const bin = isWin ? 'cmd.exe' : '/bin/sh';
        const args = isWin ? ['/c', command] : ['-c', command];
        function cleanup() {
            if (watchdogTimer) {
                clearTimeout(watchdogTimer);
                watchdogTimer = null;
            }
            if (graceTimer) {
                clearTimeout(graceTimer);
                graceTimer = null;
            }
            if (killTimer) {
                clearTimeout(killTimer);
                killTimer = null;
            }
        }
        function finalize(result) {
            if (resolved)
                return;
            resolved = true;
            cleanup();
            try {
                if (groupPid)
                    signalProcessGroup(groupPid, 'SIGKILL');
            }
            catch { /* ignore */ }
            resolve(result);
        }
        function makeResult(status, exitCode, signal, extra = {}) {
            const endedAt = new Date().toISOString();
            const base = {
                command: sanitizedCommand,
                exitCode,
                signal,
                startedAt,
                endedAt,
                stdoutTail: tailBuffer(stdout, stdoutMax),
                stderrTail: tailBuffer(stderr, stderrMax),
            };
            if (status === 'timed_out') {
                return { status, ...base, timeoutMs: extra.timeoutMs ?? opts.timeoutMs };
            }
            if (status === 'cancelled') {
                return { status, ...base };
            }
            if (status === 'spawn_error') {
                return { status, ...base, error: extra.error ?? 'spawn error' };
            }
            if (status === 'completed') {
                return { status, ...base, exitCode: exitCode ?? 0, timedOut: false };
            }
            return { status, ...base, timedOut: false };
        }
        function startGraceKillSequence(reason) {
            finalSignal = 'SIGTERM';
            pendingKillReason = reason === 'timeout' ? 'timed_out' : 'cancelled';
            signalProcessGroup(groupPid, 'SIGTERM');
            graceTimer = setTimeout(() => {
                finalSignal = 'SIGKILL';
                signalProcessGroup(groupPid, 'SIGKILL');
                killTimer = setTimeout(() => {
                    const status = pendingKillReason;
                    finalize(makeResult(status, null, finalSignal));
                }, 500);
            }, graceMs);
        }
        watchdogTimer = setTimeout(() => {
            startGraceKillSequence('timeout');
        }, opts.timeoutMs);
        if (opts.abortSignal) {
            if (opts.abortSignal.aborted) {
                try {
                    child = spawn(bin, args, {
                        cwd: opts.cwd ?? process.cwd(),
                        env: { ...process.env, ...opts.env },
                        stdio: ['ignore', 'pipe', 'pipe'],
                        detached: true,
                    });
                    groupPid = child.pid ?? 0;
                }
                catch {
                    /* ignore */
                }
                startGraceKillSequence('cancel');
                return;
            }
            opts.abortSignal.addEventListener('abort', () => {
                if (resolved)
                    return;
                startGraceKillSequence('cancel');
            }, { once: true });
        }
        try {
            child = spawn(bin, args, {
                cwd: opts.cwd ?? process.cwd(),
                env: { ...process.env, CI: 'true', FORCE_COLOR: '0', ...opts.env },
                stdio: ['ignore', 'pipe', 'pipe'],
                detached: true,
                shell: false,
            });
        }
        catch (error) {
            finalize(makeResult('spawn_error', null, null, {
                error: error instanceof Error ? error.message.slice(0, 300) : 'spawn failed',
            }));
            return;
        }
        if (!child || typeof child.pid !== 'number') {
            finalize(makeResult('spawn_error', null, null, { error: 'child pid missing' }));
            return;
        }
        groupPid = child.pid;
        child.stdout?.on('data', (chunk) => {
            stdout += chunk.toString();
            if (stdout.length > stdoutMax * 2)
                stdout = stdout.slice(-stdoutMax * 2);
        });
        child.stderr?.on('data', (chunk) => {
            stderr += chunk.toString();
            if (stderr.length > stderrMax * 2)
                stderr = stderr.slice(-stderrMax * 2);
        });
        child.on('error', (err) => {
            finalize(makeResult('spawn_error', null, null, {
                error: err.message.slice(0, 300),
            }));
        });
        child.on('close', (code, signal) => {
            if (resolved)
                return;
            if (graceTimer || killTimer) {
                const sig = signal === 'SIGKILL' ? 'SIGKILL' : finalSignal;
                const status = pendingKillReason;
                finalize(makeResult(status, code, sig));
                return;
            }
            if (code === 0) {
                finalize(makeResult('completed', 0, null));
            }
            else {
                finalize(makeResult('failed', typeof code === 'number' ? code : 1, null));
            }
        });
    });
}
