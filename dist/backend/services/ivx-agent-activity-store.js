/**
 * IVX background-agent activity store (owner-only).
 *
 * Durable, append-only record of every background agent run so the owner can
 * watch the live work queue on the tablet (IVX → Live Work):
 *   - opportunity scans
 *   - innovation scans
 *   - QA scans
 *   - capital matching
 *   - learning cycles
 *
 * For each run we persist what the agent is doing, WHY, its current status,
 * when it started, an expected-completion estimate, and (on finish) the real
 * outcome / proof. This is execution evidence, never a "please wait" placeholder.
 *
 * Layout (durable across restarts), mirrors the proven audit/opportunity stores:
 *   logs/audit/agent-activity/runs.jsonl   append-only event log (source of truth)
 *   logs/audit/agent-activity/runs.json    materialised current state (fast reads)
 *
 * Runtime-light + deterministic: only filesystem I/O, no AI/network. The store
 * itself never throws into callers — a failed persist is swallowed so wrapping
 * a real scan in activity tracking can never break the scan.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_AGENT_ACTIVITY_MARKER = 'ivx-agent-activity-2026-05-31';
const DIR = path.join(process.cwd(), 'logs', 'audit', 'agent-activity');
const LOG_PATH = path.join(DIR, 'runs.jsonl');
const STATE_PATH = path.join(DIR, 'runs.json');
const MAX_RUNS = 200;
/** Typical durations per agent kind (ms) for the expected-completion estimate. */
const TYPICAL_DURATION_MS = {
    opportunity_scan: 9000,
    innovation_scan: 9000,
    qa_scan: 12000,
    capital_matching: 9000,
    learning_cycle: 15000,
    supabase_check: 6000,
    self_improvement: 45000,
    other: 8000,
};
let writeChain = Promise.resolve();
async function ensureDir() {
    await mkdir(DIR, { recursive: true });
}
async function readState() {
    try {
        const raw = await readFile(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
async function writeState(runs) {
    await ensureDir();
    const bounded = runs.slice(0, MAX_RUNS);
    const tmp = `${STATE_PATH}.${Date.now()}.tmp`;
    await writeFile(tmp, JSON.stringify(bounded, null, 2), 'utf8');
    const { rename } = await import('node:fs/promises');
    await rename(tmp, STATE_PATH);
}
function enqueue(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
function genId() {
    return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
/**
 * Begin a background agent run. Returns the run id used to finish/fail it.
 * Never throws — persistence failures are swallowed so callers stay safe.
 */
export async function beginAgentRun(input) {
    const id = genId();
    const startedAt = new Date();
    const run = {
        id,
        kind: input.kind,
        label: input.label,
        why: input.why,
        status: 'running',
        startedAt: startedAt.toISOString(),
        expectedCompletionAt: new Date(startedAt.getTime() + (TYPICAL_DURATION_MS[input.kind] ?? 8000)).toISOString(),
        finishedAt: null,
        durationMs: null,
        detail: input.detail ?? 'Starting…',
        proof: null,
        error: null,
    };
    await enqueue(async () => {
        try {
            await ensureDir();
            await appendFile(LOG_PATH, `${JSON.stringify({ at: run.startedAt, event: 'begin', run })}\n`, 'utf8');
            const runs = await readState();
            await writeState([run, ...runs]);
        }
        catch {
            // Never break the wrapped scan on a persistence error.
        }
    });
    return id;
}
async function finishRun(id, status, patch) {
    await enqueue(async () => {
        try {
            const runs = await readState();
            const index = runs.findIndex((r) => r.id === id);
            if (index < 0)
                return;
            const existing = runs[index];
            const finishedAt = new Date();
            const updated = {
                ...existing,
                status,
                finishedAt: finishedAt.toISOString(),
                durationMs: finishedAt.getTime() - new Date(existing.startedAt).getTime(),
                detail: patch.detail ?? existing.detail,
                proof: patch.proof ?? existing.proof,
                error: patch.error ?? existing.error,
            };
            runs[index] = updated;
            await ensureDir();
            await appendFile(LOG_PATH, `${JSON.stringify({ at: updated.finishedAt, event: status, run: updated })}\n`, 'utf8');
            await writeState(runs);
        }
        catch {
            // Swallow — activity tracking must never break the wrapped scan.
        }
    });
}
/** Mark a run completed with optional proof. */
export async function completeAgentRun(id, proof, detail) {
    await finishRun(id, 'completed', { proof: proof ?? null, detail: detail ?? 'Completed.' });
}
/** Mark a run failed with an honest reason. */
export async function failAgentRun(id, error) {
    await finishRun(id, 'failed', { error, detail: 'Failed.' });
}
/** List recent agent runs (newest first). */
export async function listAgentRuns(limit = 50) {
    const runs = await readState();
    const safe = Math.max(1, Math.min(MAX_RUNS, Math.floor(limit)));
    return runs.slice(0, safe);
}
/**
 * Wrap a real async scan in activity tracking. The run is recorded as running,
 * then completed (with proof) or failed (with reason) based on the result. The
 * underlying value/exception is always propagated unchanged to the caller.
 */
export async function withAgentRun(input, fn) {
    const id = await beginAgentRun(input);
    try {
        const result = await fn();
        const proof = input.proofOf ? input.proofOf(result) : undefined;
        await completeAgentRun(id, proof);
        return result;
    }
    catch (error) {
        await failAgentRun(id, error instanceof Error ? error.message : 'Agent run failed.');
        throw error;
    }
}
