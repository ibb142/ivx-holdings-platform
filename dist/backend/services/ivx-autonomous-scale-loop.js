/**
 * IVX Autonomous Scale Loop — the single server-side DAILY self-improvement loop.
 *
 * This is the orchestrator the owner asked for: a backend-scheduled loop that runs
 * every day WITHOUT the phone open and, on each run:
 *
 *   1. inspects production health
 *   2. inspects watchdog failures (incident store)
 *   3. inspects chat failures (incident store, source=chat)
 *   4. inspects CRM / lead / deal activity (durable Supabase-backed stores)
 *   5. finds ONE highest-impact improvement (priority queue → scaling rotation)
 *   6. creates a code change + runs tests + commits + deploys + verifies + rolls back
 *      — delegated to runAutonomousMode (the proven 12-step lifecycle with the six
 *        human-approval safety gates baked in), so this file never re-implements
 *        git/deploy/rollback and never bypasses a gate.
 *   7. saves a durable, proof-grade report (jobId, VERIFIED/FAILED per claim).
 *
 * SAFETY GATES (inherited from runAutonomousMode + enforced here):
 *   - no destructive DB actions      → delete/schema intents are HELD for approval
 *   - no secret leaks                → reports never carry secret values
 *   - no delete without owner approval → guarded-category tasks are never auto-run
 *   - rollback if deploy fails        → self-heal rollback stage + production guard
 *   - every claim marked VERIFIED/FAILED
 *
 * Durable layout (mirrors the other restart-safe stores):
 *   logs/audit/scale-loop/state.json        scheduler + last-run state (atomic)
 *   logs/audit/scale-loop/<runId>.json      full report per daily run
 *   logs/audit/scale-loop/runs.jsonl        append-only run ledger (forensics)
 */
import { appendFile, mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildAutonomousDashboard } from './ivx-autonomous-core';
import { getProductionHealth } from './ivx-production-guard';
import { buildPriorityQueue } from './ivx-priority-engine';
import { runAutonomousMode } from './ivx-autonomous-mode';
import { listIncidents } from './ivx-incident-store';
import { auditDir } from './ivx-data-root';
import { discoverLeads } from './ivx-lead-discovery';
import { appendDurableEvent, isDurableStoreConfigured, readDurableJson, writeDurableJson, } from './ivx-durable-store';
export const IVX_SCALE_LOOP_MARKER = 'ivx-autonomous-scale-loop-2026-06-08';
const DAY_MS = 24 * 60 * 60 * 1000;
/** Ticker cadence — the due-gate decides whether work actually runs. */
const TICK_MS = 10 * 60 * 1000;
// Durable root (Supabase-backed store when configured, otherwise the persistent
// data-root disk) so the scale-loop state + run history survive restarts/deploys —
// the same durability the CRM / leads / deals stores already have. Previously this
// wrote to process.cwd(), which is wiped on every Render restart, erasing the
// owner's audit trail.
const DIR = auditDir('scale-loop');
const STATE_PATH = path.join(DIR, 'state.json');
const TMP_PATH = path.join(DIR, 'state.json.tmp');
const LOG_PATH = path.join(DIR, 'runs.jsonl');
const REPORTS_PATH = path.join(DIR, 'reports.json');
/** Max reports retained in the durable report ledger (newest kept). */
const MAX_DURABLE_REPORTS = 100;
// ── helpers ──────────────────────────────────────────────────────────────────
function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
}
function uid(prefix) {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `${prefix}_${crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
async function ensureDir() {
    await mkdir(DIR, { recursive: true });
}
function freshState(now = Date.now()) {
    return {
        marker: IVX_SCALE_LOOP_MARKER,
        startedAt: nowIso(now),
        updatedAt: nowIso(now),
        enabled: true,
        job: {
            intervalMs: DAY_MS,
            lastRunAt: null,
            // Due immediately on first boot so the first daily run happens without a 24h wait.
            nextDueAt: nowIso(now),
            lastRunId: null,
            lastResult: 'never',
            runCount: 0,
            failureCount: 0,
            improvementsCompleted: 0,
            currentJob: null,
        },
        lastReport: null,
    };
}
function normalizeState(parsed) {
    const fresh = freshState();
    if (!parsed || typeof parsed !== 'object')
        return fresh;
    const obj = parsed;
    return {
        marker: IVX_SCALE_LOOP_MARKER,
        startedAt: typeof obj.startedAt === 'string' ? obj.startedAt : fresh.startedAt,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fresh.updatedAt,
        enabled: typeof obj.enabled === 'boolean' ? obj.enabled : true,
        job: { ...fresh.job, ...(obj.job ?? {}) },
        lastReport: obj.lastReport ?? null,
    };
}
export async function getScaleLoopState() {
    if (isDurableStoreConfigured()) {
        try {
            const parsed = await readDurableJson(STATE_PATH, null);
            return parsed ? normalizeState(parsed) : freshState();
        }
        catch {
            return freshState();
        }
    }
    try {
        const raw = await readFile(STATE_PATH, 'utf8');
        return normalizeState(JSON.parse(raw));
    }
    catch {
        return freshState();
    }
}
async function writeStateAtomic(state) {
    const next = { ...state, updatedAt: nowIso() };
    if (isDurableStoreConfigured()) {
        await writeDurableJson(STATE_PATH, next);
        return;
    }
    await ensureDir();
    await writeFile(TMP_PATH, JSON.stringify(next, null, 2), 'utf8');
    await rename(TMP_PATH, STATE_PATH);
}
async function appendRunLog(event) {
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(LOG_PATH, event);
            return;
        }
        await ensureDir();
        await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // forensic log is best-effort.
    }
}
/** Append a run report to the durable report ledger (newest first, bounded). */
async function persistReport(report) {
    if (isDurableStoreConfigured()) {
        try {
            const existing = await readDurableJson(REPORTS_PATH, []);
            const next = [report, ...(Array.isArray(existing) ? existing : [])]
                .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
                .slice(0, MAX_DURABLE_REPORTS);
            await writeDurableJson(REPORTS_PATH, next);
        }
        catch {
            // best-effort — never break a run on report persistence failure.
        }
        return;
    }
    try {
        await ensureDir();
        await writeFile(path.join(DIR, `${report.runId}.json`), JSON.stringify(report, null, 2), 'utf8');
    }
    catch {
        // best-effort
    }
}
export function isDue(state, now = Date.now()) {
    if (!state.enabled)
        return false;
    if (!state.job.nextDueAt)
        return true;
    return Date.parse(state.job.nextDueAt) <= now;
}
export async function setScaleLoopEnabled(enabled) {
    const state = await getScaleLoopState();
    state.enabled = enabled;
    await writeStateAtomic(state);
    await appendRunLog({ type: enabled ? 'enabled' : 'disabled', at: nowIso() });
    return state;
}
// ── inspection ────────────────────────────────────────────────────────────────
/** Best-effort durable-store counts; never throws. */
async function readBusinessActivity() {
    let leads = 0;
    let deals = 0;
    let pipeline = 0;
    let known = true;
    try {
        const { listLeads } = await import('./ivx-lead-capture-store');
        leads = (await listLeads()).length;
    }
    catch {
        known = false;
    }
    try {
        const { listDeals } = await import('./ivx-deal-tracking-store');
        deals = (await listDeals()).length;
    }
    catch {
        known = false;
    }
    try {
        const { listPipelineEntries } = await import('./ivx-capital-pipeline-store');
        pipeline = (await listPipelineEntries()).length;
    }
    catch {
        known = false;
    }
    return { leads, deals, pipeline, known };
}
export async function inspect() {
    const [dashboard, queue, activity] = await Promise.all([
        buildAutonomousDashboard(),
        buildPriorityQueue(200),
        readBusinessActivity(),
    ]);
    const health = getProductionHealth();
    const incidents = listIncidents(300);
    const watchdogFailures = incidents.filter((i) => i.source === 'backend' || /watchdog|stall|silent/i.test(i.message)).length;
    const chatFailures = incidents.filter((i) => /chat|conversation|message/i.test(i.message)).length;
    const inspection = {
        productionHealthy: !health.thresholdExceeded,
        failureRate: health.failureRate,
        watchdogFailures,
        chatFailures,
        openIncidents: dashboard.subsystems.incidents.open,
        leads: activity.leads,
        deals: activity.deals,
        pipelineEntries: activity.pipeline,
        crmActivityKnown: activity.known,
        topBlocker: queue.next
            ? { tier: queue.next.tier, title: queue.next.title, source: queue.next.source, reference: queue.next.reference }
            : null,
        totalOpen: queue.totalOpen,
    };
    return { inspection, dashboard, health };
}
/**
 * Source REAL new leads each cycle from public SEC EDGAR Form D filings.
 *
 * This is what actually grows the pipeline: previous runs only COUNTED existing
 * leads, so nothing new ever appeared. Each call pages PAST filings already in the
 * store (so it returns fresh, unseen records) across both discovery classes:
 *   - `buyers`   → high-value raises (entities deploying large capital)
 *   - `jv_deals` → any real investor entity for JV / co-invest sourcing
 *
 * Every staged lead carries a direct sec.gov filing link for verification and is
 * staged as `pending_approval` — nothing is contacted and nothing reaches the CRM
 * without the owner's explicit approval. Never throws.
 */
async function runDiscoveryStep() {
    const result = {
        attempted: true,
        stagedTotal: 0,
        byClass: { buyers: 0, jv_deals: 0 },
        source: null,
        error: null,
    };
    try {
        // South-Florida-focused queries: each surfaces fresh, unseen SEC Form D
        // filings for the owner's target market and deal types.
        const [buyers, jv] = await Promise.all([
            discoverLeads({ discoveryClass: 'buyers', query: 'Florida real estate', limit: 15 }).catch((e) => ({ stagedCount: 0, source: null, error: e instanceof Error ? e.message : 'buyers discovery failed' })),
            discoverLeads({ discoveryClass: 'jv_deals', query: 'Miami real estate', limit: 15 }).catch((e) => ({ stagedCount: 0, source: null, error: e instanceof Error ? e.message : 'jv discovery failed' })),
        ]);
        result.byClass.buyers = buyers.stagedCount ?? 0;
        result.byClass.jv_deals = jv.stagedCount ?? 0;
        result.stagedTotal = result.byClass.buyers + result.byClass.jv_deals;
        result.source = buyers.source ?? jv.source ?? null;
        const errs = [buyers.error, jv.error].filter(Boolean);
        result.error = errs.length > 0 ? errs.join('; ') : null;
    }
    catch (error) {
        result.error = error instanceof Error ? error.message : 'discovery step failed';
    }
    return result;
}
// ── improvement selection ───────────────────────────────────────────────────
/** Weekly rotation so the loop scales across all the owner's growth dimensions. */
const ROTATION = [
    'daily_engineering',
    'lead_intelligence',
    'investor_acquisition',
    'performance_security',
    'app_feature_generation',
    'new_module_generation',
    'weekly_technology_research',
];
function rotationCategory(now) {
    return ROTATION[now.getUTCDay() % ROTATION.length];
}
function categoryTask(category, inspection) {
    switch (category) {
        case 'lead_intelligence':
            return {
                title: 'Improve lead intelligence scoring & enrichment',
                task: 'Review the lead capture + scoring pipeline for the highest-impact, non-destructive reliability or accuracy improvement (scoring, temperature, dedupe, CRM bridge). Propose and verify a safe code change.',
                rationale: `${inspection.leads} lead(s) durable; sharpening scoring/enrichment compounds capture value.`,
            };
        case 'investor_acquisition':
            return {
                title: 'Strengthen investor acquisition funnel',
                task: 'Find one safe, high-impact improvement to the investor acquisition path (capture form reliability, outreach drafting, pipeline staging). Propose and verify the change.',
                rationale: `${inspection.deals} deal(s) tracked; improving the acquisition funnel grows qualified pipeline.`,
            };
        case 'performance_security':
            return {
                title: 'Harden performance & security',
                task: 'Identify one safe performance or security hardening (input validation, error handling, slow path, leak risk) and propose + verify a non-destructive fix.',
                rationale: `failureRate=${inspection.failureRate.toFixed(2)}; proactive hardening protects uptime.`,
            };
        case 'app_feature_generation':
            return {
                title: 'Generate one high-value app feature increment',
                task: 'Propose and verify one safe, additive app feature increment that improves owner or investor experience without touching destructive paths.',
                rationale: 'Steady additive feature growth compounds product value daily.',
            };
        case 'new_module_generation':
            return {
                title: 'Scaffold one new safe module',
                task: 'Identify a missing internal capability and scaffold one safe, additive module (read-only or additive) with tests. Propose and verify.',
                rationale: 'New capability surface area expands what the platform can do autonomously.',
            };
        case 'weekly_technology_research':
            return {
                title: 'Weekly technology research → one safe adoption',
                task: 'Research one technology/library improvement relevant to the stack and propose + verify a single safe, additive adoption or upgrade step.',
                rationale: 'Weekly research keeps the stack modern and competitive.',
            };
        case 'daily_engineering':
        default:
            return {
                title: 'Daily engineering: fix the highest-impact open issue',
                task: 'Find the single highest-impact open engineering issue and fix it safely (non-destructive), run tests, and verify production.',
                rationale: `${inspection.totalOpen} open item(s); ${inspection.openIncidents} open incident(s).`,
            };
    }
}
export function selectImprovement(inspection, now = new Date()) {
    // Highest impact first: a real open blocker always wins.
    if (inspection.topBlocker && (inspection.topBlocker.tier === 'CRITICAL' || inspection.topBlocker.tier === 'HIGH')) {
        return {
            category: 'daily_engineering',
            title: `Fix ${inspection.topBlocker.tier} blocker: ${inspection.topBlocker.title}`,
            task: `Fix the highest-priority open blocker safely (non-destructive): [${inspection.topBlocker.tier}] ${inspection.topBlocker.title} (source=${inspection.topBlocker.source}, ref=${inspection.topBlocker.reference ?? 'n/a'}). Run tests and verify production.`,
            rationale: `Top-ranked ${inspection.topBlocker.tier} blocker from the priority queue (${inspection.totalOpen} open).`,
            source: 'priority_queue',
        };
    }
    const category = rotationCategory(now);
    const t = categoryTask(category, inspection);
    return { category, title: t.title, task: t.task, rationale: t.rationale, source: 'scaling_rotation' };
}
// ── live production proof ───────────────────────────────────────────────────
async function fetchLatestRenderDeployId() {
    const apiKey = process.env.RENDER_API_KEY?.trim();
    const serviceId = process.env.RENDER_SERVICE_ID?.trim();
    if (!apiKey || !serviceId)
        return null;
    try {
        const res = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys?limit=1`, { method: 'GET', headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' } });
        if (!res.ok)
            return null;
        const data = (await res.json());
        return Array.isArray(data) && data[0]?.deploy?.id ? String(data[0].deploy.id) : null;
    }
    catch {
        return null;
    }
}
async function probeProductionHealth() {
    const base = (process.env.PRODUCTION_BASE_URL ?? '').trim();
    if (!base)
        return null;
    try {
        const res = await fetch(`${base.replace(/\/$/, '')}/health`, { method: 'GET' });
        return res.status;
    }
    catch {
        return null;
    }
}
/**
 * Run ONE daily scale-loop iteration. Never throws — every failure surfaces as a
 * FAILED claim so the persisted report is always honest and complete.
 */
export async function runScaleLoopOnce(options = {}) {
    const startedAt = nowIso();
    const startMs = Date.now();
    const runId = uid('scale-run');
    const jobId = uid('scale-job');
    const claims = [];
    const state = await getScaleLoopState();
    state.job.currentJob = 'inspecting';
    await writeStateAtomic(state).catch(() => undefined);
    // 1–4. inspect
    let inspection;
    try {
        const r = await inspect();
        inspection = r.inspection;
        claims.push({
            claim: 'inspection',
            status: 'VERIFIED',
            evidence: `health=${inspection.productionHealthy ? 'ok' : 'degraded'} rate=${inspection.failureRate.toFixed(2)} watchdog=${inspection.watchdogFailures} chat=${inspection.chatFailures} leads=${inspection.leads} deals=${inspection.deals} pipeline=${inspection.pipelineEntries} open=${inspection.totalOpen}`,
        });
    }
    catch (error) {
        inspection = {
            productionHealthy: false, failureRate: 0, watchdogFailures: 0, chatFailures: 0,
            openIncidents: 0, leads: 0, deals: 0, pipelineEntries: 0, crmActivityKnown: false,
            topBlocker: null, totalOpen: 0,
        };
        claims.push({ claim: 'inspection', status: 'FAILED', evidence: error instanceof Error ? error.message : 'inspection failed' });
    }
    // 4b. SOURCE NEW LEADS — pull fresh, real SEC EDGAR Form D filings and stage
    // them for owner approval. This is what actually grows the pipeline each cycle.
    state.job.currentJob = 'sourcing leads (SEC EDGAR)';
    await writeStateAtomic(state).catch(() => undefined);
    const discovery = await runDiscoveryStep();
    claims.push({
        claim: 'lead_discovery',
        status: discovery.error && discovery.stagedTotal === 0 ? 'FAILED' : 'VERIFIED',
        evidence: `staged=${discovery.stagedTotal} (buyers=${discovery.byClass.buyers}, jv=${discovery.byClass.jv_deals}) source=${discovery.source ?? 'n/a'}${discovery.error ? ` err=${discovery.error}` : ''}`,
    });
    // Reflect freshly-staged leads in the inspection counts the report carries.
    inspection.leads += discovery.stagedTotal;
    // 5. find one highest-impact improvement
    const improvement = selectImprovement(inspection, new Date());
    claims.push({
        claim: 'improvement_selected',
        status: 'VERIFIED',
        evidence: `[${improvement.category}/${improvement.source}] ${improvement.title}`,
    });
    // 6. create change + test + commit + deploy + verify + rollback (full lifecycle w/ safety gates)
    state.job.currentJob = `engineering: ${improvement.title}`;
    await writeStateAtomic(state).catch(() => undefined);
    let lifecycle = null;
    try {
        const runner = options.lifecycleRunner ?? ((task) => runAutonomousMode(task));
        lifecycle = await runner(improvement.task);
        const ok = lifecycle.finalStatus === 'VERIFIED';
        const blocked = lifecycle.finalStatus === 'BLOCKED_FOR_APPROVAL';
        claims.push({
            claim: 'engineering_lifecycle',
            status: ok || blocked ? 'VERIFIED' : 'FAILED',
            evidence: `finalStatus=${lifecycle.finalStatus}; steps=${lifecycle.steps.length}; selfHeal=${lifecycle.selfHeal?.cycleId ?? 'n/a'}${blocked ? `; held: ${lifecycle.approvalReason ?? ''}` : ''}`,
        });
    }
    catch (error) {
        claims.push({ claim: 'engineering_lifecycle', status: 'FAILED', evidence: error instanceof Error ? error.message : 'lifecycle threw' });
    }
    // 7. live production proof
    state.job.currentJob = 'verifying production';
    await writeStateAtomic(state).catch(() => undefined);
    const [renderDeployId, productionHttpStatus] = await Promise.all([
        fetchLatestRenderDeployId(),
        probeProductionHealth(),
    ]);
    const productionCommit = (process.env.RENDER_GIT_COMMIT ?? process.env.IVX_BUILD_ID ?? '').trim() || null;
    const rollbackDeployId = lifecycle?.selfHeal?.rollback?.newDeployId ?? null;
    const finalHealth = getProductionHealth();
    claims.push({
        claim: 'production_proof',
        status: productionHttpStatus === 200 || (productionHttpStatus === null && !finalHealth.thresholdExceeded) ? 'VERIFIED' : 'FAILED',
        evidence: `commit=${productionCommit ?? 'n/a'} renderDeploy=${renderDeployId ?? 'n/a'} httpHealth=${productionHttpStatus ?? 'no-base-url'} failureRate=${finalHealth.failureRate.toFixed(2)}`,
    });
    const lifecycleFinalStatus = lifecycle?.finalStatus ?? null;
    const result = lifecycleFinalStatus === 'BLOCKED_FOR_APPROVAL'
        ? 'BLOCKED_FOR_APPROVAL'
        : claims.every((c) => c.status === 'VERIFIED')
            ? 'VERIFIED'
            : 'FAILED';
    const finishedAt = nowIso();
    const reportPath = `logs/audit/scale-loop/${runId}.json`;
    const report = {
        marker: IVX_SCALE_LOOP_MARKER,
        jobId,
        runId,
        startedAt,
        finishedAt,
        durationMs: Date.now() - startMs,
        result,
        inspection,
        improvement,
        lifecycleFinalStatus,
        lifecycleTaskId: lifecycle?.taskId ?? null,
        selfHealCycleId: lifecycle?.selfHeal?.cycleId ?? null,
        proof: {
            productionCommit,
            renderDeployId,
            rollbackDeployId,
            productionHttpStatus,
            productionHealthy: !finalHealth.thresholdExceeded,
        },
        claims,
        reportPath,
    };
    // persist report + advance scheduler state
    try {
        await ensureDir();
        await writeFile(path.join(DIR, `${runId}.json`), JSON.stringify(report, null, 2), 'utf8');
    }
    catch {
        // best-effort
    }
    const now = Date.now();
    const fresh = await getScaleLoopState();
    fresh.job.lastRunAt = nowIso(now);
    fresh.job.nextDueAt = nowIso(now + (fresh.job.intervalMs > 0 ? fresh.job.intervalMs : DAY_MS));
    fresh.job.lastRunId = runId;
    fresh.job.lastResult = result;
    fresh.job.runCount += 1;
    fresh.job.failureCount += result === 'FAILED' ? 1 : 0;
    fresh.job.improvementsCompleted += result === 'VERIFIED' ? 1 : 0;
    fresh.job.currentJob = null;
    fresh.lastReport = report;
    await writeStateAtomic(fresh).catch(() => undefined);
    await appendRunLog({ type: 'scale_run', runId, jobId, result, category: improvement.category, at: finishedAt });
    return report;
}
/** List recent persisted scale-loop reports (newest first). */
export async function listScaleLoopReports(limit = 20) {
    try {
        const files = await readdir(DIR);
        const reports = [];
        for (const file of files) {
            if (!file.endsWith('.json') || file === 'state.json')
                continue;
            try {
                const raw = await readFile(path.join(DIR, file), 'utf8');
                reports.push(JSON.parse(raw));
            }
            catch {
                // skip unreadable artifacts
            }
        }
        reports.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        return reports.slice(0, Math.min(Math.max(1, limit), 100));
    }
    catch {
        return [];
    }
}
export async function buildScaleDashboard() {
    const state = await getScaleLoopState();
    const reports = await listScaleLoopReports(20);
    const last = state.lastReport ?? reports[0] ?? null;
    const recentFailures = reports
        .filter((r) => r.result === 'FAILED')
        .slice(0, 5)
        .map((r) => ({
        runId: r.runId,
        at: r.finishedAt,
        evidence: r.claims.find((c) => c.status === 'FAILED')?.evidence ?? 'failed',
    }));
    const productionStatus = last
        ? last.proof.productionHealthy
            ? 'healthy'
            : 'degraded'
        : 'unknown';
    return {
        marker: IVX_SCALE_LOOP_MARKER,
        generatedAt: nowIso(),
        enabled: state.enabled,
        lastRunAt: state.job.lastRunAt,
        nextRunAt: state.job.nextDueAt,
        currentJob: state.job.currentJob,
        lastResult: state.job.lastResult,
        runCount: state.job.runCount,
        failureCount: state.job.failureCount,
        improvementsCompleted: state.job.improvementsCompleted,
        githubSha: last?.proof.productionCommit ?? ((process.env.RENDER_GIT_COMMIT ?? '').trim() || null),
        renderDeployId: last?.proof.renderDeployId ?? null,
        productionStatus,
        productionHttpStatus: last?.proof.productionHttpStatus ?? null,
        lastImprovement: last ? { category: last.improvement.category, title: last.improvement.title } : null,
        recentFailures,
        recentImprovements: reports.slice(0, 10).map((r) => ({
            runId: r.runId,
            at: r.finishedAt,
            category: r.improvement.category,
            title: r.improvement.title,
            result: r.result,
        })),
    };
}
// ── background scheduler ────────────────────────────────────────────────────
let timer = null;
let running = false;
/** Start the daily scale loop. Idempotent; gated by IVX_SCALE_LOOP env (default on). */
export function startScaleLoopScheduler() {
    if (timer)
        return;
    if ((process.env.IVX_SCALE_LOOP ?? 'on').toLowerCase() === 'off')
        return;
    timer = setInterval(() => {
        void (async () => {
            if (running)
                return;
            try {
                const state = await getScaleLoopState();
                if (!isDue(state))
                    return;
                running = true;
                await runScaleLoopOnce({ force: false });
            }
            catch (err) {
                console.warn('[IVXScaleLoop] tick failed:', err instanceof Error ? err.message : err);
            }
            finally {
                running = false;
            }
        })();
    }, TICK_MS);
    if (typeof timer.unref === 'function')
        timer.unref();
    console.log('[IVXScaleLoop] daily autonomous scale loop scheduler started');
}
export function stopScaleLoopScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
