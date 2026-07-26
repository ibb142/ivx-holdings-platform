/**
 * IVX Continuous Execution — multi-hour autonomous self-heal loops.
 *
 * The self-heal cycle (`ivx-self-heal-cycle`) runs the full verified loop ONCE:
 *   find blocker → prioritize → fix safely → run tests → verify production
 *     → rollback if needed → resume queued work → report ONLY verified results.
 *
 * What was missing is a *long-horizon driver* that runs that cycle repeatedly,
 * unattended, for minutes/hours, surviving process restarts and never claiming
 * progress it cannot prove. This module is that driver.
 *
 * Design:
 *   - A single durable session describes the horizon: maxDurationMs, max passes,
 *     interval between passes, and stop-on-clean behaviour.
 *   - Session + per-pass results persist to logs/audit/continuous/session.json
 *     and a passes.jsonl ledger, so a restart resumes from the recorded cursor.
 *   - A background ticker advances the session one pass at a time; each pass is
 *     a real `runSelfHealCycle` invocation whose proof is appended to the ledger.
 *   - Hard guardrails: pauses while the owner is active, never runs two passes
 *     concurrently, stops at the horizon, and stops early when the queue is clean
 *     (configurable) so it does not burn cycles on an empty backlog.
 *
 * This module never mutates source files. Its writes are durable JSON proof.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { runSelfHealCycle } from './ivx-self-heal-cycle';
import { evaluateNightOpsCanRun } from './ivx-night-ops';
export const IVX_CONTINUOUS_EXECUTION_MARKER = 'ivx-continuous-execution-2026-05-29';
const ROOT = path.join(process.cwd(), 'logs', 'audit', 'continuous');
const SESSION_FILE = path.join(ROOT, 'session.json');
const PASS_LEDGER = path.join(ROOT, 'passes.jsonl');
const EVENT_LOG = path.join(ROOT, 'events.log');
const MIN_INTERVAL_MS = 30_000;
const MAX_INTERVAL_MS = 60 * 60_000;
const MAX_HORIZON_MS = 12 * 60 * 60_000; // hard 12h ceiling
const MAX_PASSES_CEILING = 500;
const DEFAULT_CONFIG = {
    maxDurationMs: 2 * 60 * 60_000,
    maxPasses: 24,
    intervalMs: 5 * 60_000,
    suites: ['typecheck'],
    approverEmail: null,
    stopWhenClean: true,
};
let timer = null;
let passInFlight = false;
function nowIso() {
    return new Date().toISOString();
}
function uid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `cont-${crypto.randomUUID()}`;
    }
    return `cont-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function ensureDir() {
    try {
        await mkdir(ROOT, { recursive: true });
    }
    catch { /* ignore */ }
}
async function logEvent(event, detail) {
    try {
        await ensureDir();
        await appendFile(EVENT_LOG, `${nowIso()} ${event} ${detail}\n`, 'utf8');
    }
    catch { /* best-effort */ }
    console.log(`[IVXContinuous] ${event} ${detail}`);
}
function clampConfig(patch) {
    const suites = Array.isArray(patch.suites) && patch.suites.length > 0
        ? patch.suites.filter((s) => s === 'typecheck' || s === 'lint' || s === 'smoke')
        : DEFAULT_CONFIG.suites;
    return {
        maxDurationMs: Math.min(MAX_HORIZON_MS, Math.max(MIN_INTERVAL_MS, Math.round(patch.maxDurationMs ?? DEFAULT_CONFIG.maxDurationMs))),
        maxPasses: Math.min(MAX_PASSES_CEILING, Math.max(1, Math.round(patch.maxPasses ?? DEFAULT_CONFIG.maxPasses))),
        intervalMs: Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.round(patch.intervalMs ?? DEFAULT_CONFIG.intervalMs))),
        suites: suites.length > 0 ? suites : DEFAULT_CONFIG.suites,
        approverEmail: (patch.approverEmail ?? DEFAULT_CONFIG.approverEmail) || null,
        stopWhenClean: patch.stopWhenClean ?? DEFAULT_CONFIG.stopWhenClean,
    };
}
function freshSession(config) {
    return {
        marker: IVX_CONTINUOUS_EXECUTION_MARKER,
        sessionId: uid(),
        status: 'idle',
        config,
        createdAt: nowIso(),
        startedAt: null,
        deadlineAt: null,
        lastPassAt: null,
        finishedAt: null,
        passesRun: 0,
        cursorPass: 0,
        lastReason: null,
        totals: { verifiedPasses: 0, blockersFound: 0, rollbacksTriggered: 0, testFailures: 0 },
        recentPasses: [],
    };
}
async function readSession() {
    try {
        const raw = await readFile(SESSION_FILE, 'utf8');
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
async function writeSession(session) {
    await ensureDir();
    try {
        await writeFile(SESSION_FILE, JSON.stringify(session, null, 2), 'utf8');
    }
    catch { /* ignore */ }
}
async function appendPassLedger(record) {
    try {
        await ensureDir();
        await appendFile(PASS_LEDGER, JSON.stringify(record) + '\n', 'utf8');
    }
    catch { /* ignore */ }
}
/** Read the current session (or a synthetic idle one if none exists yet). */
export async function getContinuousSession() {
    const session = await readSession();
    if (session)
        return session;
    return freshSession(DEFAULT_CONFIG);
}
function reportToPassRecord(pass, report) {
    return {
        pass,
        cycleId: report.cycleId,
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        durationMs: report.durationMs,
        allVerified: report.allVerified,
        blockerFound: report.blocker.found,
        blockerTier: report.blocker.tier,
        blockerTitle: report.blocker.title,
        totalOpen: report.prioritization.totalOpen,
        testsPassed: report.tests.length > 0 && report.tests.every((t) => t.ok),
        rollbackTriggered: Boolean(report.rollback?.triggered),
        resumeQueued: report.resumeQueue.length,
    };
}
function horizonReached(session, now) {
    if (session.deadlineAt && now >= Date.parse(session.deadlineAt))
        return 'horizon reached (max duration)';
    if (session.passesRun >= session.config.maxPasses)
        return 'max passes reached';
    return null;
}
/**
 * Run a single pass if the session permits. Returns the updated session.
 * Safe to call from a ticker — it self-guards against concurrency, horizon, and
 * owner activity.
 */
export async function advanceContinuousSession(options = {}) {
    let session = await readSession();
    if (!session || session.status === 'completed' || session.status === 'stopped' || session.status === 'failed') {
        return session ?? freshSession(DEFAULT_CONFIG);
    }
    if (passInFlight) {
        return session;
    }
    const now = Date.now();
    const done = horizonReached(session, now);
    if (done) {
        session.status = 'completed';
        session.finishedAt = nowIso();
        session.lastReason = done;
        await writeSession(session);
        await logEvent('CONTINUOUS_SESSION_COMPLETED', `session=${session.sessionId} reason="${done}" passes=${session.passesRun}`);
        return session;
    }
    // Respect owner-active / production-incident guardrails (reuse night-ops gate).
    if (!options.force) {
        const gate = await evaluateNightOpsCanRun(true).catch(() => null);
        if (gate && (gate.ownerActive || gate.productionIncidentActive)) {
            session.status = 'paused';
            session.lastReason = gate.ownerActive ? 'owner active — paused' : `production incident active — paused`;
            await writeSession(session);
            await logEvent('CONTINUOUS_PASS_SKIPPED', `session=${session.sessionId} reason="${session.lastReason}"`);
            return session;
        }
    }
    passInFlight = true;
    try {
        session.status = 'running';
        await writeSession(session);
        const passNumber = session.passesRun + 1;
        await logEvent('CONTINUOUS_PASS_STARTED', `session=${session.sessionId} pass=${passNumber}`);
        const report = await runSelfHealCycle({
            suites: session.config.suites,
            approverEmail: session.config.approverEmail ?? undefined,
            resumeLimit: 20,
        });
        const record = reportToPassRecord(passNumber, report);
        await appendPassLedger(record);
        // Re-read in case the session changed underneath us, then apply this pass.
        session = (await readSession()) ?? session;
        session.passesRun = passNumber;
        session.cursorPass = passNumber;
        session.lastPassAt = record.finishedAt;
        session.recentPasses = [record, ...session.recentPasses].slice(0, 20);
        session.totals.verifiedPasses += record.allVerified ? 1 : 0;
        session.totals.blockersFound += record.blockerFound ? 1 : 0;
        session.totals.rollbacksTriggered += record.rollbackTriggered ? 1 : 0;
        session.totals.testFailures += record.testsPassed ? 0 : 1;
        await logEvent('CONTINUOUS_PASS_FINISHED', `session=${session.sessionId} pass=${passNumber} verified=${record.allVerified} open=${record.totalOpen}`);
        // Stop-when-clean: nothing left to do, end gracefully.
        if (session.config.stopWhenClean && !record.blockerFound && record.totalOpen === 0) {
            session.status = 'completed';
            session.finishedAt = nowIso();
            session.lastReason = 'queue clean — no open blockers';
            await writeSession(session);
            await logEvent('CONTINUOUS_SESSION_COMPLETED', `session=${session.sessionId} reason="queue clean" passes=${session.passesRun}`);
            return session;
        }
        const after = horizonReached(session, Date.now());
        if (after) {
            session.status = 'completed';
            session.finishedAt = nowIso();
            session.lastReason = after;
        }
        else {
            session.status = 'running';
            session.lastReason = `pass ${passNumber} complete — next in ${Math.round(session.config.intervalMs / 1000)}s`;
        }
        await writeSession(session);
        return session;
    }
    catch (error) {
        session = (await readSession()) ?? session;
        session.status = 'running'; // a single failed pass should not kill the horizon
        session.lastReason = `pass failed: ${error instanceof Error ? error.message : String(error)}`;
        await writeSession(session);
        await logEvent('CONTINUOUS_PASS_FAILED', `session=${session.sessionId} error="${session.lastReason}"`);
        return session;
    }
    finally {
        passInFlight = false;
    }
}
/** Start a new continuous-execution session and kick off the first pass. */
export async function startContinuousSession(patch = {}) {
    const config = clampConfig(patch);
    const session = freshSession(config);
    session.status = 'running';
    session.startedAt = nowIso();
    session.deadlineAt = new Date(Date.now() + config.maxDurationMs).toISOString();
    session.lastReason = 'session started';
    await writeSession(session);
    await logEvent('CONTINUOUS_SESSION_STARTED', `session=${session.sessionId} horizonMs=${config.maxDurationMs} maxPasses=${config.maxPasses} intervalMs=${config.intervalMs}`);
    // Fire the first pass immediately (don't await — let it run in the background).
    void advanceContinuousSession({ force: true }).catch(() => undefined);
    return session;
}
/** Stop the active session immediately. */
export async function stopContinuousSession() {
    const session = (await readSession()) ?? freshSession(DEFAULT_CONFIG);
    if (session.status === 'running' || session.status === 'paused') {
        session.status = 'stopped';
        session.finishedAt = nowIso();
        session.lastReason = 'stopped by owner';
        await writeSession(session);
        await logEvent('CONTINUOUS_SESSION_STOPPED', `session=${session.sessionId} passes=${session.passesRun}`);
    }
    return session;
}
/** Background ticker — advances the active session at the configured interval. */
export function startContinuousExecutionScheduler() {
    if (timer)
        return;
    if ((process.env.IVX_CONTINUOUS_SCHEDULER ?? 'on').toLowerCase() === 'off')
        return;
    // Tick every 30s; per-session intervalMs gates whether a pass actually runs.
    timer = setInterval(() => {
        void (async () => {
            try {
                const session = await readSession();
                if (!session || session.status === 'completed' || session.status === 'stopped' || session.status === 'failed')
                    return;
                // Honour the per-session pass interval.
                if (session.lastPassAt) {
                    const elapsed = Date.now() - Date.parse(session.lastPassAt);
                    if (elapsed < session.config.intervalMs)
                        return;
                }
                await advanceContinuousSession({ force: false });
            }
            catch (err) {
                console.warn('[IVXContinuous] scheduler tick failed:', err instanceof Error ? err.message : err);
            }
        })();
    }, 30_000);
    if (typeof timer.unref === 'function')
        timer.unref();
    console.log('[IVXContinuous] scheduler started');
}
export function stopContinuousExecutionScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
