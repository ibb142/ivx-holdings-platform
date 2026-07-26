/**
 * IVX enterprise audit engine — background, resumable, cursor-driven generation.
 *
 * Instead of relying on one giant LLM response (which truncates around the token
 * budget), the engine generates an audit in chunks of ~40 items each. After every
 * chunk it persists the result and advances a durable cursor (`cursorLastItem`).
 * Generation continues until the requested item count is reached, the model
 * signals completion, or a safety cap is hit.
 *
 * Resilience:
 *   - Each chunk is persisted before the next is requested, so an interruption
 *     loses at most the in-flight chunk.
 *   - `resumeAuditJob` restarts generation from the persisted cursor — no context
 *     loss, no re-generation of completed items.
 *   - The continuation prompt only carries the cursor + a short tail of the last
 *     chunk (a lightweight "continuation token"), so context stays bounded even
 *     for 5000+ item runs.
 */
import { requestIVXAIText } from '../ivx-ai-runtime';
import { extractItemNumbers, extractLastItemNumber } from './ivx-report-continuation';
import { appendAuditChunk, createAuditJob, getAuditJob, getLastChunkTail, updateAuditJob, } from './ivx-audit-job-store';
/** Absolute ceiling on chunks per job so a runaway loop can never spin forever. */
const MAX_CHUNKS_PER_JOB = 400;
/** Roughly how many items we ask the model to produce per chunk. */
const ITEMS_PER_CHUNK = 40;
/**
 * Chunk budget for a job. Scales with the requested target so a 5000-item run
 * is never cut short by a fixed cap, while open-ended jobs stay bounded. Allows
 * 2x head-room for chunks where the model under-produces items.
 */
function chunkCapForJob(targetItemCount) {
    if (!targetItemCount || targetItemCount <= 0) {
        return MAX_CHUNKS_PER_JOB;
    }
    const needed = Math.ceil(targetItemCount / ITEMS_PER_CHUNK) * 2;
    return Math.min(MAX_CHUNKS_PER_JOB, Math.max(8, needed));
}
/** Stop if the model fails to advance the item cursor this many times in a row. */
const MAX_CONSECUTIVE_STALLS = 2;
const AUDIT_SYSTEM_PROMPT = [
    'You are the IVX enterprise audit engine.',
    'You produce dense, structured, numbered audit rows — never filler prose.',
    'Each row uses the format: "<n>. <System Area> — <Status> — <Issue> — <Severity> — <Root Cause> — <Fix Needed> — <File> — <Verified>".',
    'Always continue numbering exactly where the previous chunk stopped. Never repeat earlier item numbers.',
    'Do not write closing summaries between chunks; only emit numbered rows.',
].join('\n');
/** Track jobs currently being driven in this process to avoid double-running. */
const activeRuns = new Set();
function buildFirstChunkPrompt(prompt, targetItemCount, fromItem, toItem) {
    const scope = targetItemCount ? `The full audit covers items 1 through ${targetItemCount}.` : 'This is an open-ended audit.';
    return [
        `Audit request: ${prompt}`,
        scope,
        `Produce audit rows ${fromItem} through ${toItem} now.`,
        'Output only the numbered rows for this range. No preamble, no summary.',
    ].join('\n');
}
function buildContinuationChunkPrompt(prompt, targetItemCount, lastItem, fromItem, toItem, tail) {
    const scope = targetItemCount ? `The full audit covers items 1 through ${targetItemCount}.` : 'This is an open-ended audit.';
    return [
        `Audit request: ${prompt}`,
        scope,
        `The previous chunk ended at item ${lastItem}.`,
        tail ? `For continuity, the tail of the previous chunk was:\n"""\n${tail}\n"""` : '',
        `Continue with items ${fromItem} through ${toItem}. Do NOT repeat items 1 through ${lastItem}.`,
        'Output only the numbered rows for this range. No preamble, no summary.',
    ]
        .filter(Boolean)
        .join('\n');
}
function isJobActiveStatus(status) {
    return status === 'queued' || status === 'running';
}
/**
 * Drive a job to completion in the background, persisting each chunk. Safe to
 * call fire-and-forget. Re-reads job status each loop so a pause/cancel issued
 * via the API takes effect between chunks.
 */
async function driveAuditJob(jobId) {
    if (activeRuns.has(jobId)) {
        return;
    }
    activeRuns.add(jobId);
    try {
        let job = await getAuditJob(jobId);
        if (!job) {
            return;
        }
        await updateAuditJob(jobId, { status: 'running', error: null });
        let consecutiveStalls = 0;
        while (true) {
            job = await getAuditJob(jobId);
            if (!job) {
                return;
            }
            // Respect pause/cancel requested through the API between chunks.
            if (job.status === 'paused' || job.status === 'cancelled') {
                console.log('[IVXAuditEngine] AUDIT_JOB_HALTED', { jobId, status: job.status });
                return;
            }
            const chunkCap = chunkCapForJob(job.targetItemCount);
            if (job.chunkCount >= chunkCap) {
                await updateAuditJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
                console.log('[IVXAuditEngine] AUDIT_JOB_CAP_REACHED', { jobId, chunkCount: job.chunkCount, chunkCap });
                return;
            }
            const lastItem = job.cursorLastItem;
            const target = job.targetItemCount;
            if (target !== null && lastItem >= target) {
                await updateAuditJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
                console.log('[IVXAuditEngine] AUDIT_JOB_COMPLETED', { jobId, finalItem: lastItem, target });
                return;
            }
            const fromItem = lastItem + 1;
            const toItem = target !== null ? Math.min(lastItem + ITEMS_PER_CHUNK, target) : lastItem + ITEMS_PER_CHUNK;
            const isFirst = job.chunkCount === 0;
            const tail = isFirst ? '' : await getLastChunkTail(jobId);
            const chunkPrompt = isFirst
                ? buildFirstChunkPrompt(job.prompt, target, fromItem, toItem)
                : buildContinuationChunkPrompt(job.prompt, target, lastItem, fromItem, toItem, tail);
            console.log('[IVXAuditEngine] AUDIT_CHUNK_STARTED', { jobId, chunkIndex: job.chunkCount, fromItem, toItem });
            let text = '';
            try {
                const result = await requestIVXAIText({
                    module: job.module,
                    requestId: `${jobId}-chunk${job.chunkCount + 1}`,
                    model: job.model ?? undefined,
                    system: AUDIT_SYSTEM_PROMPT,
                    prompt: chunkPrompt,
                    maxOutputTokens: job.maxOutputTokens,
                });
                text = result.text.trim();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'chunk generation failed';
                await updateAuditJob(jobId, { status: 'failed', error: message });
                console.log('[IVXAuditEngine] AUDIT_CHUNK_FAILED', { jobId, chunkIndex: job.chunkCount, error: message });
                return;
            }
            if (!text) {
                await updateAuditJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
                console.log('[IVXAuditEngine] AUDIT_JOB_EMPTY_CHUNK', { jobId });
                return;
            }
            const numbers = extractItemNumbers(text);
            const newLastItem = extractLastItemNumber(text);
            const itemStart = numbers.length > 0 ? Math.min(...numbers) : null;
            const itemEnd = numbers.length > 0 ? Math.max(...numbers) : null;
            const appended = await appendAuditChunk(jobId, { text, itemStart, itemEnd, itemCount: numbers.length });
            const cursorAfter = appended?.job.cursorLastItem ?? lastItem;
            console.log('[IVXAuditEngine] AUDIT_CHUNK_FINISHED', { jobId, throughItem: newLastItem, cursorAfter, itemStart, itemEnd, itemCount: numbers.length });
            // Stall guard: if the durable cursor didn't advance, the model produced no
            // new rows (empty or pure repetition). Use the persisted cursor — not the
            // raw max item number — so a model that legitimately restarts numbering
            // (1–40 each chunk) still counts as progress and is not falsely flagged.
            if (cursorAfter <= lastItem) {
                consecutiveStalls += 1;
                console.log('[IVXAuditEngine] AUDIT_CHUNK_STALLED', { jobId, lastItem, newLastItem, consecutiveStalls });
                if (consecutiveStalls >= MAX_CONSECUTIVE_STALLS) {
                    await updateAuditJob(jobId, { status: 'completed', completedAt: new Date().toISOString() });
                    console.log('[IVXAuditEngine] AUDIT_JOB_STALL_COMPLETED', { jobId, finalItem: lastItem });
                    return;
                }
            }
            else {
                consecutiveStalls = 0;
            }
        }
    }
    finally {
        activeRuns.delete(jobId);
    }
}
/** Create a new audit job and start background generation. */
export async function startAuditJob(input) {
    const job = await createAuditJob(input);
    console.log('[IVXAuditEngine] AUDIT_JOB_CREATED', {
        jobId: job.id,
        targetItemCount: job.targetItemCount,
        maxOutputTokens: job.maxOutputTokens,
    });
    void driveAuditJob(job.id);
    return job;
}
/**
 * Resume a job that was paused, failed, or interrupted (e.g. process restart).
 * Generation continues from the persisted cursor — completed chunks are kept.
 */
export async function resumeAuditJob(jobId) {
    const job = await getAuditJob(jobId);
    if (!job) {
        return null;
    }
    if (job.status === 'completed' || job.status === 'cancelled') {
        return job;
    }
    if (activeRuns.has(jobId)) {
        return job;
    }
    console.log('[IVXAuditEngine] AUDIT_CONTINUE_REQUESTED', { jobId, fromItem: job.cursorLastItem + 1 });
    const resumed = await updateAuditJob(jobId, { status: 'running', error: null });
    void driveAuditJob(jobId);
    return resumed ?? job;
}
export async function pauseAuditJob(jobId) {
    const job = await getAuditJob(jobId);
    if (!job || !isJobActiveStatus(job.status)) {
        return job;
    }
    return await updateAuditJob(jobId, { status: 'paused' });
}
export async function cancelAuditJob(jobId) {
    const job = await getAuditJob(jobId);
    if (!job) {
        return null;
    }
    return await updateAuditJob(jobId, { status: 'cancelled', completedAt: new Date().toISOString() });
}
