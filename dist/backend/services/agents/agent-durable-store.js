/**
 * IVX Phase 1 — Durable agent store.
 *
 * The multi-agent framework (Block 25) kept tasks / audit / memory / handoffs in
 * in-process Maps that reset on every server restart. This store makes them
 * durable so the agent team never forgets its work between deploys.
 *
 * Design mirrors the proven unified-executive-memory store:
 *   logs/audit/agent-state/agent-state.json     materialised snapshot (fast read)
 *   logs/audit/agent-state/agent-state.jsonl     append-only event log (forensics)
 *
 * Honesty + safety rules:
 *   - Pure filesystem I/O, no AI/network, never throws into callers (a failed
 *     persist is swallowed so remembering can never break the action that
 *     produced it).
 *   - The framework stays the source of truth at runtime; this store only
 *     snapshots it and rehydrates it on boot.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
export const AGENT_DURABLE_STORE_MARKER = 'ivx-agent-durable-store-2026-06-09';
const DIR = path.join(process.cwd(), 'logs', 'audit', 'agent-state');
const STATE_PATH = path.join(DIR, 'agent-state.json');
const TMP_PATH = path.join(DIR, 'agent-state.json.tmp');
const LOG_PATH = path.join(DIR, 'agent-state.jsonl');
let writeChain = Promise.resolve();
async function ensureDir() {
    await mkdir(DIR, { recursive: true });
}
/** Serialize writes so concurrent persists can't race or corrupt the snapshot. */
function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
/** Persist a full snapshot atomically (temp-file + rename). Never throws. */
export function persistAgentState(snapshot) {
    return enqueueWrite(async () => {
        try {
            await ensureDir();
            const full = {
                marker: AGENT_DURABLE_STORE_MARKER,
                savedAt: new Date().toISOString(),
                tasks: snapshot.tasks,
                audit: snapshot.audit,
                memory: snapshot.memory,
                handoffs: snapshot.handoffs,
            };
            await writeFile(TMP_PATH, JSON.stringify(full), 'utf8');
            await rename(TMP_PATH, STATE_PATH);
        }
        catch {
            // Best-effort: a failed persist must never break the agent action.
        }
    });
}
/** Append a single lifecycle event for forensics. Never throws. */
export async function appendAgentEvent(event) {
    try {
        await ensureDir();
        await appendFile(LOG_PATH, `${JSON.stringify({ ...event, at: event.at ?? new Date().toISOString() })}\n`, 'utf8');
    }
    catch {
        // Forensic log is best-effort.
    }
}
/** Read the durable snapshot for rehydration on boot. Returns null when absent. */
export async function loadAgentState() {
    try {
        const raw = await readFile(STATE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object')
            return null;
        const record = parsed;
        return {
            marker: typeof record.marker === 'string' ? record.marker : AGENT_DURABLE_STORE_MARKER,
            savedAt: typeof record.savedAt === 'string' ? record.savedAt : '',
            tasks: Array.isArray(record.tasks) ? record.tasks : [],
            audit: Array.isArray(record.audit) ? record.audit : [],
            memory: Array.isArray(record.memory) ? record.memory : [],
            handoffs: Array.isArray(record.handoffs) ? record.handoffs : [],
        };
    }
    catch {
        return null;
    }
}
