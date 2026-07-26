/**
 * IVX Enterprise Business Operating System — Phase 1.
 *
 * The unified layer that turns IVX from a Senior Developer into a complete
 * Enterprise Business OS. It binds every REAL, existing engine — buyer/investor/
 * JV sourcing (SEC EDGAR), capital pipeline, growth engine, innovation research,
 * daily executive report, deployment brain, continuous-improvement audits —
 * behind a single Executive Command Center and a registry of 12 specialized
 * executive agents.
 *
 * HARD HONESTY RULES (inherited from every engine this layer calls):
 *   - No mock services. Every agent run calls a real engine; counts come from
 *     real durable records (SEC filings, CRM stores, Render/GitHub APIs).
 *   - Every run is persisted to a durable ledger AND written into unified +
 *     enterprise memory with source attribution.
 *   - A failed engine reads as a failed run with the real error — never faked.
 *
 * Durable layout (mirrors the proven scheduler/memory stores):
 *   logs/audit/enterprise-os/state.json   per-agent last-run state + recent runs
 *   logs/audit/enterprise-os/runs.jsonl   append-only run ledger (forensics)
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_ENTERPRISE_OS_MARKER = 'ivx-enterprise-business-os-2026-07-02';
export const EXECUTIVE_AGENTS = {
    ceo: {
        id: 'ceo',
        name: 'CEO Agent',
        role: 'Daily executive briefing across revenue, capital, pipeline, and operations.',
        engine: 'ivx-daily-executive-report.generateAndStoreDailyReport',
        produces: 'Stored executive report grounded in real IVX records.',
    },
    cto: {
        id: 'cto',
        name: 'CTO Agent',
        role: 'Architecture health — drift detection against the captured baseline.',
        engine: 'ivx-architecture-drift.detectArchitectureDrift',
        produces: 'Architecture drift report with per-metric severity.',
    },
    senior_developer: {
        id: 'senior_developer',
        name: 'Senior Developer Agent',
        role: 'Daily self-audit of the codebase: tech debt, freeze risks, safe auto-improvements.',
        engine: 'ivx-continuous-improvement.runDailySelfAudit',
        produces: 'Audit run with proposals and safe-to-auto-apply plan.',
    },
    deployment: {
        id: 'deployment',
        name: 'Deployment Agent',
        role: 'Deployment brain — GitHub/Render/production commit match and next action.',
        engine: 'ivx-deployment-tools/deployment-brain.assessDeploymentBrain',
        produces: 'Live platform status, commit SHAs, deploy decision.',
    },
    qa: {
        id: 'qa',
        name: 'QA Agent',
        role: 'Production verification — live health endpoint and commit-match proof.',
        engine: 'ivx-enterprise-deployment-engine.getProductionHealth + verifyCommitMatch',
        produces: 'Live production health with commit SHA evidence.',
    },
    security: {
        id: 'security',
        name: 'Security Agent',
        role: 'Credential audit — presence and live validity of every deployment credential (masked).',
        engine: 'ivx-enterprise-deployment-engine.discoverCredentials',
        produces: 'Masked credential report; no secret values ever exposed.',
    },
    growth: {
        id: 'growth',
        name: 'Growth Agent',
        role: 'Growth engine — ranked growth ideas, JV drafts, tokenization concepts, outreach drafts.',
        engine: 'ivx-growth-engine.generateIdeas + getGrowthEngineOverview',
        produces: 'Ranked growth ideas persisted to the durable growth store.',
    },
    investor: {
        id: 'investor',
        name: 'Investor Agent',
        role: 'Investor discovery from public SEC EDGAR filings → durable CRM (deduped).',
        engine: 'ivx-autonomous-execution.runInvestorEngine',
        produces: 'Real investor records with SEC filing URLs as evidence.',
    },
    buyer: {
        id: 'buyer',
        name: 'Buyer Agent',
        role: '$10M+ buyer discovery from public SEC EDGAR filings → durable CRM (deduped).',
        engine: 'ivx-autonomous-execution.runBuyerEngine',
        produces: 'Real buyer records with SEC filing URLs as evidence.',
    },
    deal: {
        id: 'deal',
        name: 'Deal Agent',
        role: 'JV partner discovery and deal pipeline growth from public filings.',
        engine: 'ivx-autonomous-execution.runJvEngine',
        produces: 'Real JV partner records with filing evidence.',
    },
    research: {
        id: 'research',
        name: 'Research Agent',
        role: 'Innovation scan — technology/AI/product ideas derived from live IVX signals.',
        engine: 'ivx-innovation-engine.runInnovationScan',
        produces: 'Scored, de-duplicated innovation ideas in the durable backlog.',
    },
    operations: {
        id: 'operations',
        name: 'Operations Agent',
        role: 'Operations roll-up — CRM totals, outreach queue, scheduler job health.',
        engine: 'ivx-autonomous-execution.summarizeAutonomousExecution + scheduler state',
        produces: 'Grounded operations summary with per-job scheduler status.',
    },
};
export const EXECUTIVE_AGENT_IDS = Object.keys(EXECUTIVE_AGENTS);
export function isExecutiveAgentId(value) {
    return Object.prototype.hasOwnProperty.call(EXECUTIVE_AGENTS, value);
}
const DIR = path.join(process.cwd(), 'logs', 'audit', 'enterprise-os');
const STATE_PATH = path.join(DIR, 'state.json');
const TMP_PATH = path.join(DIR, 'state.json.tmp');
const LOG_PATH = path.join(DIR, 'runs.jsonl');
const MAX_RECENT_RUNS = 200;
let writeChain = Promise.resolve();
const inFlight = new Set();
function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
}
function freshAgentState(agentId) {
    return {
        agentId,
        lastRunAt: null,
        lastStatus: 'never',
        lastSummary: 'Not run yet.',
        runCount: 0,
        failureCount: 0,
    };
}
function freshState() {
    const agents = {};
    for (const id of EXECUTIVE_AGENT_IDS)
        agents[id] = freshAgentState(id);
    return { marker: IVX_ENTERPRISE_OS_MARKER, updatedAt: nowIso(), agents, recentRuns: [] };
}
function normalizeState(parsed) {
    const fresh = freshState();
    if (!parsed || typeof parsed !== 'object')
        return fresh;
    const obj = parsed;
    const agents = (obj.agents ?? {});
    const merged = {};
    for (const id of EXECUTIVE_AGENT_IDS) {
        merged[id] = { ...fresh.agents[id], ...(agents[id] ?? {}), agentId: id };
    }
    return {
        marker: IVX_ENTERPRISE_OS_MARKER,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : fresh.updatedAt,
        agents: merged,
        recentRuns: Array.isArray(obj.recentRuns)
            ? obj.recentRuns.filter((r) => !!r && typeof r === 'object').slice(0, MAX_RECENT_RUNS)
            : [],
    };
}
export async function getEnterpriseOsState() {
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
async function writeState(state) {
    const next = { ...state, updatedAt: nowIso() };
    if (isDurableStoreConfigured()) {
        await writeDurableJson(STATE_PATH, next);
        return;
    }
    await mkdir(DIR, { recursive: true });
    await writeFile(TMP_PATH, JSON.stringify(next, null, 2), 'utf8');
    await rename(TMP_PATH, STATE_PATH);
}
function enqueueWrite(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
async function appendRunLog(event) {
    try {
        if (isDurableStoreConfigured()) {
            await appendDurableEvent(LOG_PATH, event);
            return;
        }
        await mkdir(DIR, { recursive: true });
        await appendFile(LOG_PATH, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // forensic log is best-effort.
    }
}
function createRunId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `eos-${crypto.randomUUID()}`;
    }
    return `eos-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
async function executeCeo() {
    const { generateAndStoreDailyReport } = await import('./ivx-daily-executive-report');
    const entry = await generateAndStoreDailyReport({ trigger: 'manual' });
    return {
        ok: true,
        summary: `Executive briefing ${entry.reportDate}: ${entry.headline}`,
        evidence: [
            `reportId:${entry.reportId}`,
            `reportDate:${entry.reportDate}`,
            `sourcesScanned:${entry.report.sourcesScanned}`,
        ],
    };
}
async function executeCto() {
    const { detectArchitectureDrift } = await import('./ivx-architecture-drift');
    const drift = await detectArchitectureDrift();
    return {
        ok: true,
        summary: drift.summary,
        evidence: [
            `hasBaseline:${drift.hasBaseline}`,
            `overallSeverity:${drift.overallSeverity}`,
            `driftMetrics:${drift.drift.length}`,
        ],
    };
}
async function executeSeniorDeveloper() {
    const { runDailySelfAudit, planSafeAutoImprovements } = await import('./ivx-continuous-improvement');
    const audit = await runDailySelfAudit();
    const plan = await planSafeAutoImprovements({ audit });
    return {
        ok: true,
        summary: `Self-audit ${audit.auditId}: ${audit.summary.totalProposals} proposal(s), ${plan.safeProposals.length} safe to auto-apply.`,
        evidence: [
            `auditId:${audit.auditId}`,
            `filesScanned:${audit.techDebt.filesScanned}`,
            `highSeverity:${audit.summary.bySeverity.high}`,
        ],
    };
}
async function executeDeployment() {
    const { assessDeploymentBrain } = await import('./ivx-deployment-tools/deployment-brain');
    const brain = await assessDeploymentBrain();
    return {
        ok: brain.overallStatus !== 'broken',
        summary: `Deployment ${brain.overallStatus} — ${brain.nextAction}`,
        evidence: [
            `commitMatch:${brain.commitMatch}`,
            `github:${brain.commits.github ?? 'unknown'}`,
            `production:${brain.commits.production ?? 'unknown'}`,
            `decision:${brain.decision}`,
        ],
        error: brain.errors.length > 0 ? brain.errors.slice(0, 3).join('; ') : null,
    };
}
async function executeQa() {
    const { getProductionHealth, verifyCommitMatch } = await import('./ivx-enterprise-deployment-engine');
    const [health, match] = await Promise.all([getProductionHealth(), verifyCommitMatch()]);
    return {
        ok: health.ok,
        summary: `Production health ${health.ok ? 'OK' : 'FAILED'} (status ${health.status ?? 'unknown'}); commit match: ${match.match}.`,
        evidence: [
            `productionSha:${match.productionSha ?? 'unknown'}`,
            `githubSha:${match.githubSha ?? 'unknown'}`,
            `bootTime:${health.bootTime ?? 'unknown'}`,
        ],
        error: health.error ?? match.error ?? null,
    };
}
async function executeSecurity() {
    const { discoverCredentials } = await import('./ivx-enterprise-deployment-engine');
    const reports = await discoverCredentials();
    const present = reports.filter((r) => r.present).length;
    return {
        ok: true,
        summary: `Credential audit: ${present}/${reports.length} present (values masked, never exposed).`,
        evidence: reports.map((r) => `${r.name}:${r.status}`),
    };
}
async function executeGrowth() {
    const { generateIdeas, getGrowthEngineOverview } = await import('./ivx-growth-engine');
    const ideas = await generateIdeas({});
    const overview = await getGrowthEngineOverview();
    return {
        ok: true,
        summary: `Growth engine: ${ideas.length} ranked idea(s); ${overview.jvDeals} JV draft(s), ${overview.tokenizationConcepts} tokenization concept(s), ${overview.outreachDrafts} outreach draft(s).`,
        evidence: ideas.slice(0, 5).map((i) => `idea:${i.title} (rank ${i.rank})`),
    };
}
async function executeEngine(engine) {
    const { runBuyerEngine, runInvestorEngine, runJvEngine } = await import('./ivx-autonomous-execution');
    const result = engine === 'buyer' ? await runBuyerEngine(25) : engine === 'investor' ? await runInvestorEngine(25) : await runJvEngine(15);
    return {
        ok: result.ok,
        summary: `${result.engine}: ${result.savedToCrm} saved to CRM from ${result.discovered} discovered (${result.duplicatesSkipped} duplicate(s) skipped). ${result.note}`,
        evidence: result.evidence.slice(0, 8),
        error: result.error,
    };
}
async function executeResearch() {
    const { runInnovationScan } = await import('./ivx-innovation-engine');
    const scan = await runInnovationScan();
    return {
        ok: true,
        summary: `Research scan: ${scan.generatedCount} new idea(s); ${scan.ideas.length} in the ranked backlog.`,
        evidence: scan.ideas.slice(0, 5).map((i) => `idea:${i.title} [${i.category}]`),
    };
}
async function executeOperations() {
    const { summarizeAutonomousExecution } = await import('./ivx-autonomous-execution');
    const { getSchedulerState } = await import('./ivx-autonomous-scheduler');
    const [summary, sched] = await Promise.all([summarizeAutonomousExecution(), getSchedulerState()]);
    const jobs = Object.values(sched.jobs);
    const failing = jobs.filter((j) => j.lastStatus === 'failed').length;
    return {
        ok: true,
        summary: `Operations: CRM ${summary.crm.total} record(s) (${summary.crm.buyers} buyers, ${summary.crm.investors} investors, ${summary.crm.partners} partners); outreach ${summary.outreach.queued} queued, sending ${summary.outreach.sendingEnabled ? 'enabled' : 'disabled'}; scheduler ${failing}/${jobs.length} job(s) failing.`,
        evidence: jobs.map((j) => `${j.kind}:${j.lastStatus}`),
    };
}
async function executeAgent(agentId) {
    switch (agentId) {
        case 'ceo':
            return executeCeo();
        case 'cto':
            return executeCto();
        case 'senior_developer':
            return executeSeniorDeveloper();
        case 'deployment':
            return executeDeployment();
        case 'qa':
            return executeQa();
        case 'security':
            return executeSecurity();
        case 'growth':
            return executeGrowth();
        case 'investor':
            return executeEngine('investor');
        case 'buyer':
            return executeEngine('buyer');
        case 'deal':
            return executeEngine('jv');
        case 'research':
            return executeResearch();
        case 'operations':
            return executeOperations();
    }
}
// ── Memory wiring (unified + enterprise memory, best-effort) ─────────────────
async function rememberRun(run) {
    try {
        const { remember } = await import('./ivx-unified-memory-store');
        await remember({
            kind: 'execution_history',
            title: `${EXECUTIVE_AGENTS[run.agentId].name} run ${run.ranAt.slice(0, 10)}`,
            summary: run.summary,
            data: {
                runId: run.id,
                agentId: run.agentId,
                ok: run.ok,
                durationMs: run.durationMs,
                evidence: run.evidence.slice(0, 10),
            },
            tags: ['enterprise-os', run.agentId, 'executive-agent'],
            source: 'autonomous_mode',
            status: 'active',
        });
    }
    catch {
        // memory must never break an agent run.
    }
    try {
        const { writeMemory } = await import('./ivx-enterprise-memory');
        await writeMemory('agent_learning', `${EXECUTIVE_AGENTS[run.agentId].name}: ${run.ok ? 'ok' : 'failed'}`, run.summary, 'enterprise-business-os', { sourceAgent: run.agentId, importance: run.ok ? 'medium' : 'high', tags: ['enterprise-os', run.agentId] });
    }
    catch {
        // enterprise memory is best-effort.
    }
}
// ── Public API: run an executive agent ───────────────────────────────────────
/**
 * Run ONE executive agent NOW against its real engine, persist the run to the
 * durable ledger, and wire the result into unified + enterprise memory.
 * Concurrency-guarded per agent. Never throws.
 */
export async function runExecutiveAgent(agentId, trigger = 'owner') {
    const ranAt = nowIso();
    if (inFlight.has(agentId)) {
        return {
            id: createRunId(),
            agentId,
            ranAt,
            durationMs: 0,
            ok: false,
            summary: 'Agent already running.',
            evidence: [],
            error: 'Agent run already in flight.',
            trigger,
        };
    }
    inFlight.add(agentId);
    const start = Date.now();
    let run;
    try {
        const result = await executeAgent(agentId);
        run = {
            id: createRunId(),
            agentId,
            ranAt,
            durationMs: Date.now() - start,
            ok: result.ok,
            summary: result.summary,
            evidence: result.evidence,
            error: result.error ?? null,
            trigger,
        };
    }
    catch (error) {
        run = {
            id: createRunId(),
            agentId,
            ranAt,
            durationMs: Date.now() - start,
            ok: false,
            summary: `${EXECUTIVE_AGENTS[agentId].name} failed.`,
            evidence: [],
            error: error instanceof Error ? error.message : 'Agent execution failed.',
            trigger,
        };
    }
    finally {
        inFlight.delete(agentId);
    }
    await enqueueWrite(async () => {
        const state = await getEnterpriseOsState();
        const agent = state.agents[agentId];
        state.agents[agentId] = {
            ...agent,
            lastRunAt: run.ranAt,
            lastStatus: run.ok ? 'ok' : 'failed',
            lastSummary: run.error ? `${run.summary} (${run.error})` : run.summary,
            runCount: agent.runCount + 1,
            failureCount: agent.failureCount + (run.ok ? 0 : 1),
        };
        state.recentRuns = [run, ...state.recentRuns].slice(0, MAX_RECENT_RUNS);
        await writeState(state);
    });
    await appendRunLog({
        type: 'agent_run',
        runId: run.id,
        agentId,
        ok: run.ok,
        durationMs: run.durationMs,
        summary: run.summary,
        trigger,
        at: run.ranAt,
    });
    await rememberRun(run);
    return run;
}
/**
 * Build the live Executive Command Center by aggregating every real subsystem.
 * Each section degrades independently (a failing subsystem reads as null +
 * an alert) — the dashboard itself never fabricates data.
 */
export async function buildExecutiveCommandCenter() {
    const alerts = [];
    const [match, deploys, sched, pipeline, execution, growth, memory, osState] = await Promise.all([
        import('./ivx-enterprise-deployment-engine')
            .then((m) => m.verifyCommitMatch())
            .catch(() => null),
        import('./ivx-enterprise-deployment-engine')
            .then((m) => m.listRenderDeploys(3))
            .catch(() => null),
        import('./ivx-autonomous-scheduler')
            .then((m) => m.getSchedulerState())
            .catch(() => null),
        import('./ivx-capital-pipeline-store')
            .then((m) => m.summarizePipeline())
            .catch(() => null),
        import('./ivx-autonomous-execution')
            .then((m) => m.summarizeAutonomousExecution())
            .catch(() => null),
        import('./ivx-growth-engine')
            .then((m) => m.getGrowthEngineOverview())
            .catch(() => null),
        import('./ivx-enterprise-memory')
            .then((m) => m.getMemoryState())
            .catch(() => null),
        getEnterpriseOsState().catch(() => freshState()),
    ]);
    if (match && match.match === false) {
        alerts.push({
            severity: 'critical',
            title: 'Production is behind GitHub',
            detail: `GitHub ${match.githubSha ?? 'unknown'} vs production ${match.productionSha ?? 'unknown'} — a deploy is needed.`,
        });
    }
    if (match?.error) {
        alerts.push({ severity: 'warning', title: 'Commit verification error', detail: match.error });
    }
    const jobs = sched ? Object.values(sched.jobs) : [];
    const failingJobs = jobs.filter((j) => j.lastStatus === 'failed');
    for (const job of failingJobs) {
        alerts.push({
            severity: 'warning',
            title: `Autonomous job failing: ${job.kind}`,
            detail: job.lastSummary,
        });
    }
    if (execution && !execution.outreach.sendingEnabled) {
        alerts.push({
            severity: 'info',
            title: 'Outreach sending disabled',
            detail: 'Outreach drafts queue for owner approval; no email provider is enabled.',
        });
    }
    const failingAgents = Object.values(osState.agents).filter((a) => a.lastStatus === 'failed');
    for (const agent of failingAgents) {
        alerts.push({
            severity: 'warning',
            title: `Agent failing: ${EXECUTIVE_AGENTS[agent.agentId].name}`,
            detail: agent.lastSummary,
        });
    }
    const headline = [
        match ? (match.match ? 'Production in sync' : 'PRODUCTION BEHIND GITHUB') : 'Deployment state unverified',
        sched ? `${jobs.length - failingJobs.length}/${jobs.length} autonomous jobs healthy` : 'scheduler state unavailable',
        execution ? `CRM ${execution.crm.total} records` : 'CRM unavailable',
        pipeline ? `$${Math.round(pipeline.totalPipeline).toLocaleString('en-US')} open pipeline` : 'pipeline unavailable',
    ].join(' · ');
    return {
        marker: IVX_ENTERPRISE_OS_MARKER,
        generatedAt: nowIso(),
        headline,
        deployment: {
            commitMatch: match ? match.match : null,
            githubSha: match?.githubSha ?? null,
            productionSha: match?.productionSha ?? null,
            recentDeploys: (deploys?.deploys ?? []).map((d) => {
                const rec = d;
                return {
                    id: typeof rec.id === 'string' ? rec.id : null,
                    status: typeof rec.status === 'string' ? rec.status : null,
                    createdAt: typeof rec.createdAt === 'string' ? rec.createdAt : null,
                };
            }),
            error: match?.error ?? deploys?.error ?? null,
        },
        autonomousJobs: {
            total: jobs.length,
            failing: failingJobs.length,
            jobs: jobs.map((j) => ({
                kind: j.kind,
                lastStatus: j.lastStatus,
                lastRunAt: j.lastRunAt,
                lastSummary: j.lastSummary,
                runCount: j.runCount,
            })),
        },
        capital: pipeline
            ? {
                totalPipeline: pipeline.totalPipeline,
                capitalCommitted: pipeline.capitalCommitted,
                capitalRaised: pipeline.capitalRaised,
                weightedPipeline: pipeline.weightedPipeline,
                dealsInProgress: pipeline.dealsInProgress,
                closed: pipeline.closed,
            }
            : null,
        revenue: execution
            ? {
                crmTotal: execution.crm.total,
                buyers: execution.crm.buyers,
                investors: execution.crm.investors,
                partners: execution.crm.partners,
                outreachQueued: execution.outreach.queued,
                outreachSent: execution.outreach.sent,
                sendingEnabled: execution.outreach.sendingEnabled,
            }
            : null,
        growth: growth
            ? {
                ideas: growth.ideas,
                jvDeals: growth.jvDeals,
                tokenizationConcepts: growth.tokenizationConcepts,
                outreachDrafts: growth.outreachDrafts,
            }
            : null,
        memory: memory ? { totalEntries: memory.totalEntries, lastUpdated: memory.lastUpdated } : null,
        agents: EXECUTIVE_AGENT_IDS.map((id) => osState.agents[id]),
        recentRuns: osState.recentRuns.slice(0, 25),
        alerts,
    };
}
/** Recent audited agent runs — the evidence trail for the dashboard. */
export async function listEnterpriseOsRuns(limit = 50) {
    const state = await getEnterpriseOsState();
    const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(limit, MAX_RECENT_RUNS) : 50;
    return state.recentRuns.slice(0, safeLimit);
}
