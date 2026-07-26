/**
 * IVX Autonomous Run Log — PERMANENT per-run evidence persistence (2026-07-26).
 *
 * WHY THIS EXISTS:
 *   The scheduler state file (`scheduler/state.json`) only records the LAST run
 *   per job kind (a single `runCount` + `lastSummary`). Hundreds of runs
 *   completed with no per-run evidence artifact — `runsWithoutEvidence: 556`
 *   vs `runsWithEvidence: 11`. This module closes that gap permanently.
 *
 * WHAT IT DOES:
 *   Persists EVERY autonomous engine/scheduler run as an individual, permanent,
 *   append-only record in the Supabase-backed durable event store. Each record
 *   carries the full evidence envelope: job id, worker id, engine, start/finish
 *   time, status, runtime, records discovered/inserted/updated, errors, source
 *   URLs, evidence artifact, commit SHA, deployment SHA.
 *
 * DURABILITY:
 *   Records are stored via `appendDurableEvent` into the `ivx_durable_events`
 *   Postgres table (Supabase). They survive server restarts, Render redeploys,
 *   and scheduler restarts. When Supabase is not configured (local dev/tests),
 *   records fall back to the local filesystem append-only JSONL log.
 *
 * HONESTY:
 *   - A run record is written for EVERY run, ok or failed, evidenced or empty.
 *   - `hasEvidence` is derived from the concrete artifact list (never faked).
 *   - Counts mirror the real engine result; nothing is fabricated.
 */
import path from 'node:path';
import { appendDurableEvent, readDurableEvents, isDurableStoreConfigured } from './ivx-durable-store';
import { appendFile, mkdir } from 'node:fs/promises';
export const IVX_AUTONOMOUS_RUN_LOG_MARKER = 'ivx-autonomous-run-log-2026-07-26';
const LOG_FILE = path.join(process.cwd(), 'logs', 'audit', 'scheduler', 'runs.jsonl');
const DOC_KEY = 'scheduler/runs.jsonl';
function nowIso() {
    return new Date().toISOString();
}
function generateRunId() {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `run-${ts}-${rand}`;
}
const WORKER_FOR_KIND = {
    daily_self_audit: 'W1',
    daily_drift_detection: 'W1',
    daily_executive_report: 'W8',
    daily_buyer_engine: 'W6',
    daily_investor_engine: 'W6',
    daily_jv_engine: 'W6',
    daily_tokenized_buyer_engine: 'W6',
    daily_technology_ideas: 'W12',
    daily_capital_outreach: 'W6',
    daily_deploy_monitor: 'W10',
    daily_enterprise_os: 'W8',
};
/**
 * Persist a single autonomous run as a permanent record in the durable store.
 * Returns the created run record (with its assigned runId).
 * Never throws — persistence failure is logged but does not break the scheduler.
 */
export async function recordAutonomousRun(input) {
    const finishedAt = nowIso();
    const evidence = input.evidence ?? [];
    const record = {
        runId: generateRunId(),
        kind: input.kind,
        engine: input.engine,
        workerId: input.workerId ?? WORKER_FOR_KIND[input.kind] ?? 'W8',
        startedAt: input.startedAt,
        finishedAt,
        durationMs: input.durationMs,
        status: input.status,
        recordsDiscovered: input.recordsDiscovered ?? 0,
        recordsInserted: input.recordsInserted ?? 0,
        recordsUpdated: input.recordsUpdated ?? 0,
        duplicatesSkipped: input.duplicatesSkipped ?? 0,
        outreachQueued: input.outreachQueued ?? 0,
        sendingEnabled: input.sendingEnabled ?? false,
        error: input.error ?? null,
        summary: input.summary,
        source: input.source ?? '',
        evidence,
        hasEvidence: evidence.length > 0,
        commitSha: input.commitSha ?? null,
        deploymentSha: input.deploymentSha ?? null,
        marker: IVX_AUTONOMOUS_RUN_LOG_MARKER,
    };
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(DOC_KEY, record);
        }
        else {
            await mkdir(path.dirname(LOG_FILE), { recursive: true });
            await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8');
        }
    }
    catch (err) {
        // Best-effort local fallback so the record still exists somewhere.
        try {
            await mkdir(path.dirname(LOG_FILE), { recursive: true });
            await appendFile(LOG_FILE, `${JSON.stringify(record)}\n`, 'utf8');
        }
        catch {
            // Never break the scheduler over logging.
            console.warn('[IvxAutonomousRunLog] persist failed:', err instanceof Error ? err.message : err);
        }
    }
    return record;
}
/** Read recent run records (newest first). Survives restarts/deploys. */
export async function readAutonomousRuns(limit = 100) {
    const capped = Math.max(1, Math.min(500, limit));
    try {
        if (isDurableStoreConfigured()) {
            const events = await readDurableEvents(DOC_KEY, capped);
            return events
                .map((e) => {
                const ev = e.event;
                if (!ev || ev.marker !== IVX_AUTONOMOUS_RUN_LOG_MARKER)
                    return null;
                return { ...ev, runId: ev.runId ?? 'unknown', finishedAt: e.createdAt };
            })
                .filter((r) => r !== null);
        }
    }
    catch {
        // fall through to empty
    }
    return [];
}
export async function summarizeAutonomousRunLog(limit = 500) {
    const runs = await readAutonomousRuns(limit);
    if (runs.length === 0)
        return null;
    const byEngineMap = new Map();
    let runsWithEvidence = 0;
    let failed = 0;
    // runs come newest-first; iterate to build per-engine summaries
    for (const run of runs) {
        if (run.hasEvidence)
            runsWithEvidence += 1;
        if (run.status === 'failed')
            failed += 1;
        const existing = byEngineMap.get(run.kind);
        if (existing) {
            existing.runCount += 1;
            if (run.hasEvidence)
                existing.withEvidence += 1;
            // newest-first, so the first one we see is the latest
            if (existing.lastRunAt === null) {
                existing.lastRunAt = run.finishedAt;
                existing.lastStatus = run.status;
                existing.lastSummary = run.summary;
            }
        }
        else {
            byEngineMap.set(run.kind, {
                kind: run.kind,
                engine: run.engine,
                runCount: 1,
                lastRunAt: run.finishedAt,
                lastStatus: run.status,
                lastSummary: run.summary,
                withEvidence: run.hasEvidence ? 1 : 0,
            });
        }
    }
    return {
        totalRuns: runs.length,
        runsWithEvidence,
        runsWithoutEvidence: runs.length - runsWithEvidence,
        failed,
        byEngine: Array.from(byEngineMap.values()).sort((a, b) => b.runCount - a.runCount),
    };
}
