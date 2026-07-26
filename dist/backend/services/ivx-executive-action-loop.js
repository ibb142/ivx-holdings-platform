/**
 * IVX Executive Action Loop + Outcome Tracking (owner-only) — BLOCK 39.
 *
 * Closes the executive learning loop the owner asked for:
 *   recommendation → execution → outcome → learning → improved recommendation
 *
 * Each loop is a durable record that moves through stages as the owner (or an
 * autonomous run) acts on a recommendation, records what happened, and records
 * the measured outcome. The LEARNING step is a pure, deterministic aggregation
 * over past outcomes per category — it never invents a KPI, never claims a
 * success that wasn't recorded, and produces an evidence-backed "improved
 * recommendation" only from real prior results.
 *
 * Every loop also writes back into the Unified Executive Memory (BLOCK 39):
 *   - a `decision` memory when a recommendation is recorded,
 *   - an `execution_history` memory when execution is recorded,
 *   - an `outcome` memory (KPI impact + lessons learned) when the outcome lands,
 * so Owner AI / CRM AI / Autonomous Mode / Executive Layer all share one brain.
 *
 * Durable layout (mirrors the proven execution-trace / unified-memory stores):
 *   logs/audit/executive-action-loop/loops.jsonl   append-only event log
 *   logs/audit/executive-action-loop/loops.json    materialised current state
 *
 * Runtime-light + deterministic: only filesystem I/O + the unified-memory store,
 * no AI/network. Never throws into callers.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { remember, } from './ivx-unified-memory-store';
export const IVX_ACTION_LOOP_MARKER = 'ivx-executive-action-loop-2026-06-02';
const VALID_RISK = new Set(['low', 'medium', 'high']);
const VALID_OUTCOME = new Set(['success', 'failure', 'partial', 'unknown']);
const VALID_EXEC = new Set(['pending', 'executed', 'skipped', 'failed']);
const DIR = path.join(process.cwd(), 'logs', 'audit', 'executive-action-loop');
const LOG_PATH = path.join(DIR, 'loops.jsonl');
const STATE_PATH = path.join(DIR, 'loops.json');
const TMP_PATH = path.join(DIR, 'loops.json.tmp');
const MAX_LOOPS = 3000;
let writeChain = Promise.resolve();
function nowIso() {
    return new Date().toISOString();
}
function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `loop_${crypto.randomUUID()}`;
    }
    return `loop_${Date.now().toString(36)}_${Math.random().toString(16).slice(2)}`;
}
function asTrimmedString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function asCategory(value) {
    const v = asTrimmedString(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return v || 'general';
}
function asFiniteNumberOrNull(value) {
    if (value === null || value === undefined)
        return null;
    const n = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(n) ? n : null;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.map((v) => asTrimmedString(v)).filter(Boolean);
}
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
async function writeState(records) {
    await ensureDir();
    const bounded = records.slice(-MAX_LOOPS);
    await writeFile(TMP_PATH, JSON.stringify(bounded, null, 2), 'utf8');
    await rename(TMP_PATH, STATE_PATH);
}
async function appendEvent(event) {
    try {
        await ensureDir();
        await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // best-effort forensic log.
    }
}
function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
async function rememberSafely(input) {
    try {
        const result = await remember(input);
        return result.ok ? result.record.id : null;
    }
    catch {
        return null;
    }
}
export function validateRecommendation(input) {
    if (!asTrimmedString(input.title)) {
        return { ok: false, error: 'A recommendation title is required — the action loop never fabricates a record.' };
    }
    if (!asTrimmedString(input.action)) {
        return { ok: false, error: 'A concrete action is required for the recommendation.' };
    }
    return { ok: true };
}
/**
 * Step 1 — record a recommendation, starting a new action loop. Also writes a
 * `decision` memory into the unified memory so every brain shares it.
 */
export async function recordRecommendation(input) {
    const validation = validateRecommendation(input);
    if (!validation.ok)
        return validation;
    const source = input.source ?? 'executive_layer';
    const category = asCategory(input.category);
    const recommendation = {
        title: asTrimmedString(input.title),
        action: asTrimmedString(input.action),
        rationale: asTrimmedString(input.rationale),
        category,
        estimatedImpact: asTrimmedString(input.estimatedImpact),
        estimatedImpactUsd: asFiniteNumberOrNull(input.estimatedImpactUsd),
        riskLevel: input.riskLevel && VALID_RISK.has(input.riskLevel) ? input.riskLevel : 'medium',
    };
    const decisionMemoryId = await rememberSafely({
        kind: 'decision',
        title: recommendation.title,
        summary: recommendation.action,
        data: {
            rationale: recommendation.rationale,
            category,
            estimatedImpact: recommendation.estimatedImpact,
            estimatedImpactUsd: recommendation.estimatedImpactUsd,
            riskLevel: recommendation.riskLevel,
        },
        tags: ['decision', category],
        source,
        status: 'recommended',
    });
    return enqueueWrite(async () => {
        const records = await readState();
        const record = {
            id: createId(),
            stage: 'recommended',
            recommendation,
            execution: null,
            outcome: null,
            source,
            decisionMemoryId,
            executionMemoryId: null,
            outcomeMemoryId: null,
            createdAt: nowIso(),
            updatedAt: nowIso(),
        };
        records.push(record);
        await writeState(records);
        await appendEvent({ type: 'recommend', loopId: record.id, at: record.createdAt });
        return { ok: true, loop: record };
    });
}
/** Step 2 — record what was executed for a loop. Writes an execution_history memory. */
export async function recordExecution(loopId, input) {
    const status = VALID_EXEC.has(input.status) ? input.status : 'executed';
    const updated = await enqueueWrite(async () => {
        const records = await readState();
        const index = records.findIndex((r) => r.id === loopId);
        if (index === -1)
            return null;
        const prior = records[index];
        const execution = {
            status,
            detail: asTrimmedString(input.detail),
            executedAt: status === 'pending' ? null : nowIso(),
        };
        const next = {
            ...prior,
            stage: status === 'pending' ? 'recommended' : 'executed',
            execution,
            updatedAt: nowIso(),
        };
        records[index] = next;
        await writeState(records);
        await appendEvent({ type: 'execute', loopId, status, at: next.updatedAt });
        return next;
    });
    if (!updated)
        return null;
    const executionMemoryId = await rememberSafely({
        kind: 'execution_history',
        title: `Executed: ${updated.recommendation.title}`,
        summary: updated.execution?.detail || `Execution status: ${status}.`,
        data: {
            loopId,
            status,
            category: updated.recommendation.category,
            decisionMemoryId: updated.decisionMemoryId,
        },
        tags: ['execution', updated.recommendation.category, status],
        source: updated.source,
        status,
    });
    if (executionMemoryId && executionMemoryId !== updated.executionMemoryId) {
        return enqueueWrite(async () => {
            const records = await readState();
            const index = records.findIndex((r) => r.id === loopId);
            if (index === -1)
                return updated;
            records[index] = { ...records[index], executionMemoryId, updatedAt: nowIso() };
            await writeState(records);
            return records[index];
        });
    }
    return updated;
}
/** Compute the KPI delta when both endpoints are known. */
export function computeKpiImpact(before, after) {
    if (before === null || after === null)
        return null;
    return Math.round((after - before) * 1000) / 1000;
}
/**
 * Step 3 — record the measured outcome (KPI impact + lessons learned). Writes an
 * `outcome` memory linked to the decision so the learning step can read it back.
 */
export async function recordOutcome(loopId, input) {
    const result = VALID_OUTCOME.has(input.result) ? input.result : 'unknown';
    const before = asFiniteNumberOrNull(input.kpiBefore);
    const after = asFiniteNumberOrNull(input.kpiAfter);
    const outcome = {
        result,
        kpi: asTrimmedString(input.kpi),
        kpiBefore: before,
        kpiAfter: after,
        kpiImpact: computeKpiImpact(before, after),
        lessonsLearned: asStringArray(input.lessonsLearned),
        recordedAt: nowIso(),
    };
    const updated = await enqueueWrite(async () => {
        const records = await readState();
        const index = records.findIndex((r) => r.id === loopId);
        if (index === -1)
            return null;
        const prior = records[index];
        const next = {
            ...prior,
            stage: 'outcome_recorded',
            outcome,
            updatedAt: nowIso(),
        };
        records[index] = next;
        await writeState(records);
        await appendEvent({ type: 'outcome', loopId, result, at: next.updatedAt });
        return next;
    });
    if (!updated)
        return null;
    const outcomeMemoryId = await rememberSafely({
        kind: 'outcome',
        title: `Outcome: ${updated.recommendation.title}`,
        summary: outcome.kpi && outcome.kpiImpact !== null
            ? `${result} — ${outcome.kpi} moved ${outcome.kpiImpact >= 0 ? '+' : ''}${outcome.kpiImpact}.`
            : `Outcome: ${result}.`,
        data: {
            loopId,
            result,
            kpi: outcome.kpi,
            kpiBefore: outcome.kpiBefore,
            kpiAfter: outcome.kpiAfter,
            kpiImpact: outcome.kpiImpact,
            category: updated.recommendation.category,
            lessonsLearned: outcome.lessonsLearned,
            decisionMemoryId: updated.decisionMemoryId,
        },
        tags: ['outcome', updated.recommendation.category, result],
        source: updated.source,
        status: result,
        relatedIds: updated.decisionMemoryId ? [updated.decisionMemoryId] : [],
    });
    if (outcomeMemoryId && outcomeMemoryId !== updated.outcomeMemoryId) {
        return enqueueWrite(async () => {
            const records = await readState();
            const index = records.findIndex((r) => r.id === loopId);
            if (index === -1)
                return updated;
            records[index] = { ...records[index], outcomeMemoryId, updatedAt: nowIso() };
            await writeState(records);
            return records[index];
        });
    }
    return updated;
}
export async function listActionLoops(limit = 200) {
    const records = await readState();
    const bounded = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 200;
    return [...records].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, bounded);
}
export async function getActionLoop(id) {
    const records = await readState();
    return records.find((r) => r.id === id) ?? null;
}
/**
 * Pure learning derivation over loop records — extracted for unit testing. For
 * each category it aggregates real outcomes (success/failure/partial), the
 * average numeric KPI impact, and the distinct lessons learned, then derives an
 * improved recommendation grounded ONLY in those recorded results.
 */
export function deriveLearning(records) {
    const byCategory = new Map();
    for (const r of records) {
        const key = r.recommendation.category || 'general';
        const list = byCategory.get(key) ?? [];
        list.push(r);
        byCategory.set(key, list);
    }
    const categories = [];
    for (const [category, list] of byCategory) {
        const outcomes = list.filter((r) => r.outcome !== null);
        const successes = outcomes.filter((r) => r.outcome.result === 'success').length;
        const failures = outcomes.filter((r) => r.outcome.result === 'failure').length;
        const partials = outcomes.filter((r) => r.outcome.result === 'partial').length;
        const impacts = outcomes
            .map((r) => r.outcome.kpiImpact)
            .filter((v) => v !== null);
        const successRate = outcomes.length > 0 ? successes / outcomes.length : null;
        const avgKpiImpact = impacts.length > 0
            ? Math.round((impacts.reduce((s, v) => s + v, 0) / impacts.length) * 1000) / 1000
            : null;
        const lessonsLearned = Array.from(new Set(outcomes.flatMap((r) => r.outcome.lessonsLearned))).slice(0, 12);
        let improvedRecommendation;
        if (outcomes.length === 0) {
            improvedRecommendation = `No outcomes recorded yet for "${category}" — record results to start learning. Until then, treat its recommendations as unproven.`;
        }
        else if (successRate !== null && successRate >= 0.6) {
            improvedRecommendation = `"${category}" is working (${successes}/${outcomes.length} succeeded${avgKpiImpact !== null ? `, avg KPI impact ${avgKpiImpact >= 0 ? '+' : ''}${avgKpiImpact}` : ''}). Do more of it — prioritize this category in the next cycle.`;
        }
        else if (successRate !== null && successRate <= 0.34) {
            improvedRecommendation = `"${category}" is underperforming (${successes}/${outcomes.length} succeeded). Change the approach before repeating${lessonsLearned.length > 0 ? `; apply the recorded lessons: ${lessonsLearned.slice(0, 3).join('; ')}` : ''}.`;
        }
        else {
            improvedRecommendation = `"${category}" is mixed (${successes}/${outcomes.length} succeeded). Keep the wins, drop the failing variants${lessonsLearned.length > 0 ? `; lessons: ${lessonsLearned.slice(0, 3).join('; ')}` : ''}.`;
        }
        categories.push({
            category,
            totalLoops: list.length,
            withOutcome: outcomes.length,
            successes,
            failures,
            partials,
            successRate: successRate === null ? null : Math.round(successRate * 1000) / 1000,
            avgKpiImpact,
            lessonsLearned,
            improvedRecommendation,
        });
    }
    // Most-active + most-proven categories first.
    categories.sort((a, b) => b.withOutcome - a.withOutcome || b.totalLoops - a.totalLoops);
    return {
        marker: IVX_ACTION_LOOP_MARKER,
        generatedAt: nowIso(),
        totalLoops: records.length,
        categories,
        note: records.length === 0
            ? 'No action loops yet — recommendations + outcomes populate the learning report as the loop runs.'
            : 'Learning is derived only from recorded outcomes; categories with no outcomes are reported as unproven, never as successes.',
    };
}
/** Step 4 — learn from all recorded outcomes (durable, cross-session). */
export async function learnFromOutcomes() {
    const records = await readState();
    return deriveLearning(records);
}
export function summarizeActionLoopRecords(records) {
    const byStage = {
        recommended: 0,
        executing: 0,
        executed: 0,
        outcome_recorded: 0,
    };
    let withOutcome = 0;
    let successes = 0;
    let failures = 0;
    for (const r of records) {
        byStage[r.stage] = (byStage[r.stage] ?? 0) + 1;
        if (r.outcome) {
            withOutcome += 1;
            if (r.outcome.result === 'success')
                successes += 1;
            if (r.outcome.result === 'failure')
                failures += 1;
        }
    }
    return {
        marker: IVX_ACTION_LOOP_MARKER,
        generatedAt: nowIso(),
        total: records.length,
        byStage,
        withOutcome,
        successes,
        failures,
        successRate: withOutcome > 0 ? Math.round((successes / withOutcome) * 1000) / 1000 : null,
    };
}
export async function summarizeActionLoop() {
    const records = await readState();
    return summarizeActionLoopRecords(records);
}
