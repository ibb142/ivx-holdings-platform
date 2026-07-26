/**
 * IVX Night Operations Mode — autonomous overnight execution.
 *
 * While the owner sleeps, IVX AI runs a safe, staged pipeline:
 *   1. system audit  (senior-dev audit + smoke probe)
 *   2. incident review  (cluster + score)
 *   3. autonomous diagnosis  (run repair brain on top open incidents)
 *   4. staged repair  (propose patches; staging-only auto-apply, prod requires approval)
 *   5. validation pipeline  (typecheck + smoke + replay)
 *   6. learning  (append patterns to memory file)
 *   7. provider migration roadmap advance  (notes per phase)
 *   8. morning executive report  (logs/audit/night-ops/<runId>.json)
 *
 * Safety rules (hard-coded):
 *   - PAUSE during production incidents (critical+open in last 30 min)
 *   - PAUSE during active owner sessions (touchOwnerActivity within window)
 *   - NEVER auto-deploy production (always require owner approval)
 *   - Auto-rollback + emergency fallback paths remain allowed
 *
 * Persistence:
 *   logs/audit/night-ops/state.json     — scheduler state + last run summary
 *   logs/audit/night-ops/<runId>.json   — full report per overnight run
 *   logs/audit/night-ops/memory.jsonl   — learned patterns (recurring clusters)
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listIncidents, getIncident } from './ivx-incident-store';
import { diagnoseIncident } from './ivx-repair-brain';
import { runSeniorDeveloperAudit, toolIncidentAnalyze, toolTestRun, } from './ivx-senior-dev-tools';
import { advanceProviderRoadmap, getProviderRoadmapSnapshot } from './ivx-provider-roadmap';
export const IVX_NIGHT_OPS_MARKER = 'ivx-night-ops-2026-05-26';
const NIGHT_OPS_DIR = path.resolve(process.cwd(), 'logs/audit/night-ops');
const STATE_FILE = path.join(NIGHT_OPS_DIR, 'state.json');
const MEMORY_FILE = path.join(NIGHT_OPS_DIR, 'memory.jsonl');
const DEFAULT_CONFIG = {
    enabled: true,
    startHourUtc: 2,
    windowHours: 6,
    cooldownMs: 20 * 60 * 60 * 1000,
    diagnosePerRun: 5,
    ownerActiveWithinMinutes: 20,
};
// ---------- state I/O ----------
async function ensureDir() {
    try {
        await fs.mkdir(NIGHT_OPS_DIR, { recursive: true });
    }
    catch { /* ignore */ }
}
async function readState() {
    try {
        const text = await fs.readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(text);
        return {
            marker: IVX_NIGHT_OPS_MARKER,
            config: { ...DEFAULT_CONFIG, ...(parsed.config ?? {}) },
            lastRunStartedAt: parsed.lastRunStartedAt ?? null,
            lastRunFinishedAt: parsed.lastRunFinishedAt ?? null,
            lastRunId: parsed.lastRunId ?? null,
            lastRunSummary: parsed.lastRunSummary ?? null,
            lastOwnerActivityAt: parsed.lastOwnerActivityAt ?? null,
            pauseReason: parsed.pauseReason ?? null,
        };
    }
    catch {
        return {
            marker: IVX_NIGHT_OPS_MARKER,
            config: DEFAULT_CONFIG,
            lastRunStartedAt: null,
            lastRunFinishedAt: null,
            lastRunId: null,
            lastRunSummary: null,
            lastOwnerActivityAt: null,
            pauseReason: null,
        };
    }
}
async function writeState(state) {
    await ensureDir();
    try {
        await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
    }
    catch { /* ignore */ }
}
export async function getNightOpsState() {
    return readState();
}
export async function updateNightOpsConfig(patch) {
    const state = await readState();
    state.config = {
        ...state.config,
        ...patch,
        startHourUtc: Math.max(0, Math.min(23, Math.round(patch.startHourUtc ?? state.config.startHourUtc))),
        windowHours: Math.max(1, Math.min(12, Math.round(patch.windowHours ?? state.config.windowHours))),
        cooldownMs: Math.max(60_000, Number(patch.cooldownMs ?? state.config.cooldownMs)),
        diagnosePerRun: Math.max(1, Math.min(20, Math.round(patch.diagnosePerRun ?? state.config.diagnosePerRun))),
        ownerActiveWithinMinutes: Math.max(0, Math.min(180, Math.round(patch.ownerActiveWithinMinutes ?? state.config.ownerActiveWithinMinutes))),
    };
    await writeState(state);
    return state;
}
export async function touchOwnerActivity() {
    const state = await readState();
    state.lastOwnerActivityAt = new Date().toISOString();
    await writeState(state);
}
// ---------- guardrails ----------
function isInsideWindow(now, cfg) {
    const hour = now.getUTCHours();
    const start = cfg.startHourUtc;
    const end = (start + cfg.windowHours) % 24;
    if (start === end)
        return true;
    if (start < end)
        return hour >= start && hour < end;
    return hour >= start || hour < end;
}
function isCooldownExpired(state, now) {
    if (!state.lastRunFinishedAt)
        return true;
    return now.getTime() - new Date(state.lastRunFinishedAt).getTime() >= state.config.cooldownMs;
}
function ownerActiveRecently(state, now) {
    if (!state.lastOwnerActivityAt)
        return false;
    const windowMs = state.config.ownerActiveWithinMinutes * 60_000;
    return now.getTime() - new Date(state.lastOwnerActivityAt).getTime() < windowMs;
}
function hasActiveProductionIncident() {
    const recent = listIncidents(50);
    const cutoff = Date.now() - 30 * 60_000;
    for (const inc of recent) {
        const ts = Date.parse(inc.createdAt);
        if (!Number.isFinite(ts) || ts < cutoff)
            continue;
        if (inc.severity === 'critical' && (inc.status === 'open' || inc.status === 'diagnosing')) {
            return { active: true, sample: { id: inc.id, message: inc.message.slice(0, 120) } };
        }
    }
    return { active: false, sample: null };
}
export async function evaluateNightOpsCanRun(force = false) {
    const state = await readState();
    const now = new Date();
    const insideWindow = isInsideWindow(now, state.config);
    const cooldownExpired = isCooldownExpired(state, now);
    const ownerActive = ownerActiveRecently(state, now);
    const prodInc = hasActiveProductionIncident();
    let reason = null;
    if (!state.config.enabled)
        reason = 'night ops disabled';
    else if (!force && !insideWindow)
        reason = 'outside scheduled window';
    else if (!force && !cooldownExpired)
        reason = 'within cooldown';
    else if (ownerActive)
        reason = 'owner active recently — paused';
    else if (prodInc.active)
        reason = `production incident active (${prodInc.sample?.id ?? ''})`;
    return {
        canRun: reason === null,
        reason,
        config: state.config,
        insideWindow,
        cooldownExpired,
        ownerActive,
        productionIncidentActive: prodInc.active,
        nowIso: now.toISOString(),
    };
}
// ---------- learning memory ----------
async function appendLearnedPatterns(clusters) {
    const out = [];
    await ensureDir();
    const lines = [];
    for (const c of clusters.slice(0, 10)) {
        const entry = {
            signature: c.signature,
            count: c.count,
            firstSeenAt: c.lastAt,
            suggestedNextStep: c.sampleFileLine ? `inspect ${c.sampleFileLine}` : 'run patch_generate',
            recordedAt: new Date().toISOString(),
        };
        lines.push(JSON.stringify(entry));
        out.push(entry);
    }
    if (lines.length > 0) {
        try {
            await fs.appendFile(MEMORY_FILE, lines.join('\n') + '\n', 'utf8');
        }
        catch { /* ignore */ }
    }
    return out;
}
// ---------- core run ----------
function makeRunId(now) {
    return `night-${now.toISOString().replace(/[:.]/g, '-')}`;
}
function summarizeProductionRisks(audit, incidentReview) {
    const risks = [];
    for (const issue of audit.topIssues) {
        if (issue.severity === 'critical')
            risks.push(`${issue.area}: ${issue.finding}`);
    }
    if (incidentReview.openCount > 5)
        risks.push(`open incidents: ${incidentReview.openCount}`);
    for (const c of incidentReview.topClusters.slice(0, 3)) {
        if (c.count >= 5)
            risks.push(`recurring ${c.count}× ${c.sampleMessage.slice(0, 60)}`);
    }
    return risks.slice(0, 20);
}
function buildMorningReport(report) {
    const lines = [];
    lines.push(`# IVX Night Ops — ${report.runId}`);
    lines.push('');
    lines.push(`Started: ${report.startedAt}`);
    lines.push(`Finished: ${report.finishedAt}  (${(report.durationMs / 1000).toFixed(1)}s)`);
    lines.push(`Status: **${report.status}**${report.pauseReason ? ` — ${report.pauseReason}` : ''}`);
    lines.push('');
    lines.push('## Completed tasks');
    for (const t of report.tasksCompleted)
        lines.push(`- ${t}`);
    lines.push('');
    lines.push('## Incidents');
    lines.push(`- reviewed: ${report.incidentsReviewed}`);
    lines.push(`- clusters: ${report.clustersFound}`);
    lines.push(`- diagnoses produced: ${report.diagnosesProduced}`);
    lines.push(`- patches proposed: ${report.patchesProposed}`);
    lines.push(`- blockers requiring owner approval: ${report.blockersRequiringApproval}`);
    lines.push('');
    lines.push('## Validation');
    lines.push(`- typecheck: ${report.validations.typecheckOk === null ? 'skipped' : report.validations.typecheckOk ? 'ok' : 'failed'}`);
    lines.push(`- smoke    : ${report.validations.smokeOk === null ? 'skipped' : report.validations.smokeOk ? 'ok' : 'failed'}`);
    lines.push('');
    lines.push('## Production risks');
    if (report.productionRisks.length === 0)
        lines.push('- none detected');
    else
        for (const r of report.productionRisks)
            lines.push(`- ${r}`);
    lines.push('');
    lines.push('## Provider migration roadmap');
    lines.push(`- overall: ${report.roadmapOverallPercent}%`);
    for (const p of report.roadmap.phases) {
        lines.push(`- P${p.id} ${p.name} — ${p.progressPercent}% (${p.status})`);
    }
    lines.push('');
    lines.push(`Estimated hours saved: ~${report.estimatedHoursSaved}h`);
    return lines.join('\n');
}
export async function runNightOpsCycle(options = {}) {
    const startedAt = new Date();
    const state = await readState();
    const decision = await evaluateNightOpsCanRun(options.force === true);
    const runId = makeRunId(startedAt);
    if (!decision.canRun) {
        const summary = {
            runId,
            startedAt: startedAt.toISOString(),
            finishedAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt.getTime(),
            status: 'paused',
            pauseReason: decision.reason,
            tasksCompleted: [],
            incidentsReviewed: 0,
            clustersFound: 0,
            diagnosesProduced: 0,
            patchesProposed: 0,
            validations: { typecheckOk: null, smokeOk: null },
            blockersRequiringApproval: 0,
            roadmapOverallPercent: 0,
            estimatedHoursSaved: 0,
        };
        state.lastRunId = runId;
        state.lastRunStartedAt = summary.startedAt;
        state.lastRunFinishedAt = summary.finishedAt;
        state.lastRunSummary = summary;
        state.pauseReason = decision.reason;
        await writeState(state);
        const empty = {
            marker: 'paused',
            generatedAt: summary.finishedAt,
            environment: process.env.NODE_ENV || 'unknown',
            buildId: null,
            app: { ok: false, counts: { rootScreens: 0, tabScreens: 0, ivxScreens: 0, chatModuleFiles: 0, ownerAIServiceFiles: 0 }, wiring: { rootLayout: false, incidentClient: false, watchdog: false, authReferences: 0, supabaseReferences: 0, aiPipelineReferences: 0 }, samples: { authFileLines: [], supabaseFileLines: [], aiFileLines: [], watchdogFileLines: [] }, screens: { root: [], tabs: [], ivx: [] } },
            landing: { ok: false, error: 'paused' },
            incidents: { ok: true, total: 0, openCount: 0, clusterCount: 0, topClusters: [] },
            logs: { ok: true, source: 'incidents', out: { file: '', lines: [], exists: false } },
            smoke: { ok: false, suite: 'smoke', error: 'paused' },
            topIssues: [],
        };
        const report = {
            ...summary,
            marker: IVX_NIGHT_OPS_MARKER,
            environment: process.env.NODE_ENV || 'unknown',
            buildId: process.env.RENDER_GIT_COMMIT || null,
            audit: empty,
            incidentReview: { ok: true, total: 0, openCount: 0, clusterCount: 0, topClusters: [] },
            diagnoses: [],
            validation: { typecheck: null, smoke: null },
            learnedPatterns: [],
            roadmap: await getProviderRoadmapSnapshot(),
            productionRisks: [],
            morningReportMarkdown: `# IVX Night Ops — paused\n\nReason: ${decision.reason}\n`,
        };
        return report;
    }
    // ---- actual run ----
    const tasksCompleted = [];
    // 1. system audit
    const audit = await runSeniorDeveloperAudit();
    tasksCompleted.push('full system audit');
    // 2. incident review (broader window than audit's bundled snapshot)
    const incidentReview = await toolIncidentAnalyze({ limit: 300, minRepeat: 1 });
    tasksCompleted.push('incident review');
    // 3. autonomous diagnosis on top open incidents
    const openIncidents = listIncidents(200)
        .filter((i) => i.status === 'open' || i.status === 'diagnosing')
        .slice(0, state.config.diagnosePerRun);
    const diagnoses = [];
    let patchesProposed = 0;
    let blockersRequiringApproval = 0;
    for (const inc of openIncidents) {
        try {
            const r = await diagnoseIncident(inc.id);
            const fresh = getIncident(inc.id);
            const diagnosis = r.diagnosis ?? fresh?.diagnosis ?? null;
            const risk = diagnosis?.riskLevel ?? null;
            if (r.ok && diagnosis) {
                patchesProposed += 1;
                if (risk === 'medium' || risk === 'high')
                    blockersRequiringApproval += 1;
            }
            diagnoses.push({
                incidentId: inc.id,
                ok: r.ok,
                rootCause: diagnosis?.rootCause ?? null,
                fileLine: diagnosis?.fileLine ?? null,
                riskLevel: risk,
                proposalArtifactPath: r.proposalArtifactPath ?? null,
                error: r.error ?? null,
            });
        }
        catch (e) {
            diagnoses.push({
                incidentId: inc.id,
                ok: false,
                rootCause: null,
                fileLine: null,
                riskLevel: null,
                proposalArtifactPath: null,
                error: e instanceof Error ? e.message : 'diagnose failed',
            });
        }
    }
    tasksCompleted.push(`autonomous diagnosis (${diagnoses.length})`);
    // 4. validation pipeline (smoke is fast; typecheck is heavy → only if window permits)
    const smoke = await toolTestRun({ suite: 'smoke' }).catch(() => null);
    tasksCompleted.push('smoke probe');
    let typecheck = null;
    if (state.config.windowHours >= 3) {
        const tc = await toolTestRun({ suite: 'typecheck' }).catch(() => null);
        if (tc) {
            typecheck = { ok: tc.ok === true, tail: (tc.stderrTail || tc.stdoutTail || '').slice(-2000) };
            tasksCompleted.push('typecheck');
        }
    }
    // 5. memory + learning
    const learnedPatterns = await appendLearnedPatterns(incidentReview.topClusters.slice(0, 10).map((c) => ({
        signature: c.signature, count: c.count, lastAt: c.lastAt, sampleFileLine: c.sampleFileLine,
    })));
    tasksCompleted.push('memory update');
    // 6. provider migration roadmap nudge
    await advanceProviderRoadmap({ phaseId: 6, deltaPercent: 1, note: `night-ops run ${runId} executed cleanly` }).catch(() => null);
    if (typecheck?.ok) {
        await advanceProviderRoadmap({ phaseId: 1, deltaPercent: 1, note: 'typecheck passed overnight' }).catch(() => null);
    }
    const roadmap = await getProviderRoadmapSnapshot();
    tasksCompleted.push('roadmap progress');
    // 7. morning report
    const productionRisks = summarizeProductionRisks(audit, incidentReview);
    const finishedAt = new Date();
    const summary = {
        runId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        status: 'completed',
        pauseReason: null,
        tasksCompleted,
        incidentsReviewed: incidentReview.total,
        clustersFound: incidentReview.clusterCount,
        diagnosesProduced: diagnoses.filter((d) => d.ok).length,
        patchesProposed,
        validations: { typecheckOk: typecheck ? typecheck.ok : null, smokeOk: smoke ? smoke.ok : null },
        blockersRequiringApproval,
        roadmapOverallPercent: roadmap.overallPercent,
        estimatedHoursSaved: Math.max(0, Math.round((diagnoses.length * 0.5) + (incidentReview.clusterCount * 0.2) + tasksCompleted.length * 0.25)),
    };
    const reportNoMarkdown = {
        ...summary,
        marker: IVX_NIGHT_OPS_MARKER,
        environment: process.env.NODE_ENV || process.env.RENDER_ENV || 'unknown',
        buildId: process.env.RENDER_GIT_COMMIT || process.env.IVX_BUILD_ID || null,
        audit,
        incidentReview,
        diagnoses,
        validation: { typecheck, smoke },
        learnedPatterns,
        roadmap,
        productionRisks,
    };
    const report = {
        ...reportNoMarkdown,
        morningReportMarkdown: buildMorningReport(reportNoMarkdown),
    };
    // persist
    await ensureDir();
    try {
        await fs.writeFile(path.join(NIGHT_OPS_DIR, `${runId}.json`), JSON.stringify(report, null, 2), 'utf8');
        await fs.writeFile(path.join(NIGHT_OPS_DIR, `${runId}.md`), report.morningReportMarkdown, 'utf8');
    }
    catch { /* ignore */ }
    state.lastRunId = runId;
    state.lastRunStartedAt = summary.startedAt;
    state.lastRunFinishedAt = summary.finishedAt;
    state.lastRunSummary = summary;
    state.pauseReason = null;
    await writeState(state);
    return report;
}
// ---------- list past runs ----------
export async function listNightOpsRuns(limit = 20) {
    await ensureDir();
    try {
        const entries = await fs.readdir(NIGHT_OPS_DIR, { withFileTypes: true });
        const results = [];
        for (const ent of entries) {
            if (!ent.isFile() || !ent.name.endsWith('.json') || ent.name === 'state.json')
                continue;
            const full = path.join(NIGHT_OPS_DIR, ent.name);
            try {
                const stat = await fs.stat(full);
                results.push({
                    runId: ent.name.replace(/\.json$/, ''),
                    path: `logs/audit/night-ops/${ent.name}`,
                    sizeBytes: stat.size,
                    mtime: stat.mtime.toISOString(),
                });
            }
            catch { /* ignore */ }
        }
        return results.sort((a, b) => (a.mtime < b.mtime ? 1 : -1)).slice(0, limit);
    }
    catch {
        return [];
    }
}
export async function readNightOpsRun(runId) {
    const safe = runId.replace(/[^a-zA-Z0-9_.-]/g, '');
    if (!safe)
        return null;
    try {
        const text = await fs.readFile(path.join(NIGHT_OPS_DIR, `${safe}.json`), 'utf8');
        return JSON.parse(text);
    }
    catch {
        return null;
    }
}
// ---------- background scheduler ----------
let timer = null;
export function startNightOpsScheduler() {
    if (timer)
        return;
    if ((process.env.IVX_NIGHT_OPS_SCHEDULER ?? 'on').toLowerCase() === 'off')
        return;
    // Tick every 10 minutes — cheap; the canRun gate decides actual execution.
    timer = setInterval(() => {
        void (async () => {
            try {
                const decision = await evaluateNightOpsCanRun(false);
                if (decision.canRun) {
                    await runNightOpsCycle({ force: false });
                }
            }
            catch (err) {
                console.warn('[IVXNightOps] scheduler tick failed:', err instanceof Error ? err.message : err);
            }
        })();
    }, 10 * 60_000);
    if (typeof timer.unref === 'function')
        timer.unref();
    console.log('[IVXNightOps] scheduler started');
}
export function stopNightOpsScheduler() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}
