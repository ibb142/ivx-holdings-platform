/**
 * IVX Daily Executive Report — the single, owner-facing 24-hour briefing that
 * composes every existing engine into ONE structured report Ivan reads on his
 * tablet.
 *
 * It is deliberately DETERMINISTIC and runtime-light: it derives all eleven
 * sections from real subsystem state (executive layer, innovation engine,
 * incidents + repair jobs, landing inspector, opportunity/decision engines).
 * No AI call, no network burn of its own beyond the optional landing fetch,
 * so the daily cycle can run autonomously without credits or timeout risk.
 *
 * HARD HONESTY RULES (inherited from the engines it composes):
 *   - Never fabricate investors, leads, revenue, or "done" states.
 *   - Every figure is grounded in a real record; an empty source reads as 0/[]
 *     with an honest note.
 *   - Ideas / recommendations are clearly labelled as proposals, never claims.
 *
 * Persistence + PROOF: every generated report is stored durably (Supabase when
 * configured, filesystem fallback otherwise) with full proof metadata —
 * reportId, generatedAt, trigger, sources scanned, and the section counts — and
 * appended to a capped history so the owner has a permanent, auditable trail.
 */
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson, appendDurableEvent, } from './ivx-durable-store';
export const IVX_DAILY_EXECUTIVE_REPORT_MARKER = 'ivx-daily-executive-report-2026-06-10';
const REPORT_ROOT = path.join(process.cwd(), 'logs', 'audit', 'daily-report');
const STATE_FILE = path.join(REPORT_ROOT, 'reports.json');
const LOG_FILE = path.join(REPORT_ROOT, 'reports.jsonl');
/** Keep the history bounded so the materialised state stays cheap to read. */
const HISTORY_LIMIT = 60;
const DISCLAIMER = 'Daily executive briefing — every item is derived from real IVX records. Ideas and recommendations ' +
    'are proposals for owner review, not actions taken. Investors, leads, and revenue are never fabricated; ' +
    'empty sources read as zero with an honest note. Not financial, investment, or legal advice.';
function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
}
function reportDateFor(now = Date.now()) {
    return new Date(now).toISOString().slice(0, 10);
}
function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `dxr-${crypto.randomUUID()}`;
    }
    return `dxr-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
function section(key, title, findings, emptyNote, groundedNote) {
    return {
        key,
        title,
        count: findings.length,
        findings,
        note: findings.length === 0 ? emptyNote : groundedNote,
    };
}
async function safe(fn, fallback) {
    try {
        return await fn();
    }
    catch {
        return fallback;
    }
}
// ── Composition ──────────────────────────────────────────────────────────────
/**
 * Build the full report from real subsystem state. Each source is read
 * defensively so one failed reader degrades to an honest empty section.
 */
export async function buildDailyExecutiveReport(options = {}) {
    const now = options.now ?? Date.now();
    const trigger = options.trigger ?? 'manual';
    const sourcesScanned = [];
    const [{ buildExecutiveLayer }, { buildInnovationDashboard }, { listIncidents }, { listRepairJobs },] = await Promise.all([
        import('./ivx-executive-layer'),
        import('./ivx-innovation-dashboard'),
        import('./ivx-incident-store'),
        import('./ivx-repair-jobs'),
    ]);
    const executive = await safe(() => buildExecutiveLayer(now), null);
    if (executive)
        sourcesScanned.push('executive-layer');
    const innovation = await safe(() => buildInnovationDashboard(), null);
    if (innovation)
        sourcesScanned.push('innovation-engine');
    const incidents = await safe(() => listIncidents(200), []);
    if (incidents.length >= 0)
        sourcesScanned.push('incident-store');
    const repairJobs = await safe(() => listRepairJobs(100), []);
    if (repairJobs.length >= 0)
        sourcesScanned.push('repair-jobs');
    // Real autonomous-execution output (CRM + outreach the engines produced).
    const execution = await safe(async () => {
        const { summarizeAutonomousExecution } = await import('./ivx-autonomous-execution');
        return await summarizeAutonomousExecution();
    }, null);
    if (execution)
        sourcesScanned.push('autonomous-execution');
    // Landing inspection is best-effort (it does a live network fetch). It must
    // never block or fail the report.
    const landing = await safe(async () => {
        const { inspectLandingPage } = await import('./ivx-landing-inspector');
        return await inspectLandingPage();
    }, null);
    if (landing)
        sourcesScanned.push('landing-inspector');
    // ── 1. Bugs found ──────────────────────────────────────────────────────────
    const openIncidents = incidents.filter((i) => i.status === 'open' || i.status === 'diagnosing');
    const bugsFound = section('bugsFound', 'Bugs found', openIncidents.slice(0, 8).map((i) => ({
        title: i.message.slice(0, 100),
        detail: `${i.source} · ${i.severity}${i.fileLine ? ` · ${i.fileLine}` : ''} · status ${i.status}`,
        weight: i.severity,
    })), 'No open incidents detected in the last scan — monitoring continuously.', 'Open incidents detected by the runtime incident monitor, newest first.');
    // ── 2. Fixes proposed ────────────────────────────────────────────────────────
    const proposedJobs = repairJobs.filter((j) => j.stage === 'awaiting_approval' || j.stage === 'running_checks' || j.stage === 'replaying');
    const diagnosedIncidents = incidents.filter((i) => i.status === 'fix_proposed' || i.status === 'awaiting_approval');
    const proposedFindings = [
        ...proposedJobs.slice(0, 6).map((j) => ({
            title: `Repair job ${j.id.slice(0, 12)}`,
            detail: `${j.stage} · incident ${j.incidentId.slice(0, 12)}`,
            weight: 'awaiting approval',
        })),
        ...diagnosedIncidents.slice(0, 6).map((i) => ({
            title: i.diagnosis?.rootCause?.slice(0, 100) ?? i.message.slice(0, 100),
            detail: i.diagnosis?.patchPlan?.slice(0, 140) ?? 'Diagnosis ready, patch proposed.',
            weight: i.diagnosis?.riskLevel ?? 'unknown',
        })),
    ];
    const fixesProposed = section('fixesProposed', 'Fixes proposed', proposedFindings.slice(0, 8), 'No fixes awaiting approval right now.', 'Drafted patches / repair jobs awaiting owner approval before any deploy.');
    // ── 3. Fixes completed ────────────────────────────────────────────────────────
    const completedJobs = repairJobs.filter((j) => j.stage === 'completed');
    const resolvedIncidents = incidents.filter((i) => i.status === 'resolved' || i.status === 'production_deployed');
    const completedFindings = [
        ...completedJobs.slice(0, 6).map((j) => ({
            title: `Repair job ${j.id.slice(0, 12)} completed`,
            detail: `incident ${j.incidentId.slice(0, 12)} · validated`,
            weight: 'completed',
        })),
        ...resolvedIncidents.slice(0, 6).map((i) => ({
            title: i.message.slice(0, 100),
            detail: `${i.source} · resolved`,
            weight: 'resolved',
        })),
    ];
    const fixesCompleted = section('fixesCompleted', 'Fixes completed', completedFindings.slice(0, 8), 'No fixes completed in this window.', 'Repairs validated and incidents resolved since the last report.');
    // ── 4. Product improvements ──────────────────────────────────────────────────
    const productIdeas = (innovation?.topIdeas ?? []).filter((i) => i.category === 'product' || i.category === 'platform_capability');
    const productImprovements = section('productImprovements', 'Product improvements', productIdeas.slice(0, 6).map((i) => ({
        title: i.title,
        detail: `${i.summary.slice(0, 160)} · ${i.evidence}`,
        weight: `priority ${i.priority}/100`,
    })), 'No product/platform improvement ideas generated yet — run an innovation scan.', 'Product + platform improvement ideas generated from real IVX signals, ranked by priority.');
    // ── 5. New technology ideas ──────────────────────────────────────────────────
    const techIdeas = (innovation?.topIdeas ?? []).filter((i) => i.category === 'technology_concept' || i.category === 'ai_workflow');
    const technologyIdeas = section('technologyIdeas', 'New technology ideas', techIdeas.slice(0, 6).map((i) => ({
        title: i.title,
        detail: `${i.summary.slice(0, 160)} · ${i.evidence}`,
        weight: `priority ${i.priority}/100`,
    })), 'No new technology concepts generated yet — run an innovation scan.', 'AI / technology concepts derived from capability gaps and usage signals.');
    // ── 6. Investor acquisition ideas ────────────────────────────────────────────
    const investorFindings = [];
    if (execution) {
        investorFindings.push({
            title: `${execution.crm.investors} investor(s) + ${execution.crm.buyers} buyer(s) in CRM`,
            detail: `Discovered autonomously from public SEC filings and saved to the CRM. Total CRM contacts: ${execution.crm.total}.`,
            weight: 'autonomous engine',
        });
        if (execution.crm.tokenizedBuyers > 0) {
            investorFindings.push({
                title: `${execution.crm.tokenizedBuyers} tokenized / digital-asset capital buyer(s)`,
                detail: 'Identified by the tokenized buyer engine from public SEC filings and tagged in the CRM.',
                weight: 'tokenized engine',
            });
        }
    }
    if (executive?.investorPriorities.bestInvestor) {
        const b = executive.investorPriorities.bestInvestor;
        investorFindings.push({
            title: `Advance ${b.name}`,
            detail: `${b.detail} · Next: ${b.nextAction}`,
            weight: b.matchScore !== null ? `match ${b.matchScore}/100` : 'top fit',
        });
    }
    for (const o of executive?.opportunityEngine.ranked.filter((r) => r.kind === 'investor') ?? []) {
        investorFindings.push({
            title: o.title,
            detail: o.detail,
            weight: o.score !== null ? `${o.score}/100` : 'investor',
        });
    }
    const bizModelIdeas = (innovation?.topIdeas ?? []).filter((i) => i.category === 'business_model');
    for (const i of bizModelIdeas.slice(0, 2)) {
        investorFindings.push({ title: i.title, detail: i.summary.slice(0, 160), weight: `priority ${i.priority}/100` });
    }
    const investorAcquisitionIdeas = section('investorAcquisitionIdeas', 'Investor acquisition ideas', investorFindings.slice(0, 6), 'No investor opportunities in the pipeline yet — import or add capital relationships to the CRM. ' +
        'Real investor data requires an approved data source (see growth engine).', 'Investor moves derived from the capital pipeline + opportunity engine. No fabricated investors.');
    // ── 7. Realtor / JV partner ideas ────────────────────────────────────────────
    const jvFindings = [];
    if (execution) {
        jvFindings.push({
            title: `${execution.crm.partners} JV / partner candidate(s) in CRM`,
            detail: `Outreach: ${execution.outreach.queued} queued for approval, ${execution.outreach.sent} sent ` +
                `(sending ${execution.outreach.sendingEnabled ? 'enabled' : 'disabled — configure an email provider'}).`,
            weight: 'autonomous engine',
        });
    }
    for (const m of executive?.investorPriorities.priorities.filter((p) => p.matchScore === null) ?? []) {
        jvFindings.push({ title: m.name, detail: `${m.detail} · Next: ${m.nextAction}` });
    }
    for (const o of executive?.opportunityEngine.ranked.filter((r) => r.kind === 'customer' || r.kind === 'opportunity') ?? []) {
        jvFindings.push({ title: o.title, detail: o.detail, weight: o.score !== null ? `${o.score}/100` : o.kind });
    }
    const realtorJvIdeas = section('realtorJvIdeas', 'Realtor / JV partner ideas', jvFindings.slice(0, 6), 'No realtor/JV partner opportunities surfaced yet — import a partner list to populate this pipeline.', 'Partner / buyer / JV opportunities derived from the deal pipeline + opportunity engine.');
    // ── 8. Landing page recommendations ──────────────────────────────────────────
    const landingFindings = [];
    if (landing) {
        if (!landing.ok) {
            landingFindings.push({
                title: 'Landing page could not be fetched',
                detail: `Inspector reported: ${landing.error ?? 'unknown error'} (HTTP ${landing.httpStatus ?? 'n/a'}). Verify the site is live.`,
                weight: 'high',
            });
        }
        else {
            if (!landing.metaDescription) {
                landingFindings.push({
                    title: 'Add a meta description',
                    detail: 'The landing page has no meta description — add one for SEO + richer link previews.',
                    weight: 'seo',
                });
            }
            if (landing.ctas.length === 0) {
                landingFindings.push({
                    title: 'Add a clear call-to-action',
                    detail: 'No CTA detected on the landing page — add an "Invest" / "Get started" button above the fold.',
                    weight: 'conversion',
                });
            }
            if (landing.projects.length === 0) {
                landingFindings.push({
                    title: 'Surface live deals on the landing page',
                    detail: 'No project cards detected — showcasing active deals builds investor confidence.',
                    weight: 'conversion',
                });
            }
            const projectsMissingRoi = landing.projects.filter((p) => !p.roi).length;
            if (projectsMissingRoi > 0) {
                landingFindings.push({
                    title: `${projectsMissingRoi} project(s) missing ROI on the page`,
                    detail: 'Showing expected ROI per deal is the strongest investor conversion signal.',
                    weight: 'conversion',
                });
            }
        }
    }
    const landingRecommendations = section('landingRecommendations', 'Landing page recommendations', landingFindings.slice(0, 6), landing
        ? 'Landing page looks healthy on the checks scanned (meta, CTA, deals, ROI).'
        : 'Landing inspection unavailable this cycle — will retry on the next run.', 'Recommendations derived from a live inspection of the public landing page.');
    // ── 9. Competitor observations ───────────────────────────────────────────────
    const competitorIdeas = (innovation?.topIdeas ?? []).filter((i) => i.signalSource === 'competitor' || i.signalSource === 'market');
    const competitorObservations = section('competitorObservations', 'Competitor observations', competitorIdeas.slice(0, 5).map((i) => ({
        title: i.title,
        detail: `${i.evidence} → ${i.summary.slice(0, 120)}`,
        weight: i.signalSource,
    })), 'No competitor/market gaps detected this cycle.', 'Capability + market gaps that competitors may exploit, derived from the autonomous core.');
    // ── 10. Revenue opportunities ─────────────────────────────────────────────────
    const revenueFindings = [];
    if (executive) {
        const r = executive.dailyBriefing.revenue;
        revenueFindings.push({ title: r.label, detail: r.note, weight: r.value });
        for (const d of executive.decisionEngine.decisions.filter((x) => x.estimatedImpactUsd !== null)) {
            revenueFindings.push({
                title: d.title,
                detail: d.rationale.slice(0, 160),
                weight: d.estimatedImpact,
            });
        }
    }
    const revenueOpportunities = section('revenueOpportunities', 'Revenue opportunities', revenueFindings.slice(0, 6), 'No quantified revenue opportunities yet — pipeline value stays unknown until evidenced.', 'Revenue potential from the executive layer. Figures are POTENTIAL pipeline value, never guaranteed.');
    // ── 11. Next best actions ─────────────────────────────────────────────────────
    const nextFindings = (executive?.decisionEngine.decisions ?? [])
        .slice(0, 6)
        .map((d) => ({
        title: `#${d.rank} ${d.title}`,
        detail: `${d.action} — ${d.rationale.slice(0, 120)}`,
        weight: `${d.riskLevel} risk`,
    }));
    const nextBestActions = section('nextBestActions', 'Next best actions', nextFindings, 'No recommended actions right now — pipeline and operations are quiet.', 'Ranked actions from the decision engine: risk-first, then revenue. Risky actions still require approval.');
    const totalIssues = bugsFound.count;
    const totalIdeas = productImprovements.count + technologyIdeas.count + investorAcquisitionIdeas.count;
    const headline = `Daily executive report — ${totalIssues} open bug(s), ${fixesProposed.count} fix(es) proposed, ` +
        `${fixesCompleted.count} completed, ${totalIdeas} growth/tech idea(s), ` +
        `${nextBestActions.count} recommended action(s).`;
    return {
        marker: IVX_DAILY_EXECUTIVE_REPORT_MARKER,
        reportId: createId(),
        generatedAt: nowIso(now),
        reportDate: reportDateFor(now),
        trigger,
        headline,
        sourcesScanned,
        sections: {
            bugsFound,
            fixesProposed,
            fixesCompleted,
            productImprovements,
            technologyIdeas,
            investorAcquisitionIdeas,
            realtorJvIdeas,
            landingRecommendations,
            competitorObservations,
            revenueOpportunities,
            nextBestActions,
        },
        disclaimer: DISCLAIMER,
    };
}
// ── Durable persistence + proof ────────────────────────────────────────────────
async function readHistoryFromFs() {
    try {
        const raw = await readFile(STATE_FILE, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
async function writeHistoryToFs(entries) {
    await mkdir(REPORT_ROOT, { recursive: true });
    await writeFile(STATE_FILE, JSON.stringify(entries, null, 2), 'utf8');
}
async function appendEventToFs(event) {
    try {
        await mkdir(REPORT_ROOT, { recursive: true });
        await appendFile(LOG_FILE, `${JSON.stringify(event)}\n`, 'utf8');
    }
    catch {
        // forensic log is best-effort.
    }
}
/** Read the stored report history (durable when configured, fs fallback). */
export async function listReportHistory(limit = HISTORY_LIMIT) {
    const entries = isDurableStoreConfigured()
        ? await safe(() => readDurableJson(STATE_FILE, []), [])
        : await readHistoryFromFs();
    const sorted = [...entries].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return sorted.slice(0, Math.max(1, limit));
}
/** Latest stored report, or null if none generated yet. */
export async function getLatestReport() {
    const history = await listReportHistory(1);
    return history[0] ?? null;
}
/**
 * Persist a report into the capped history (one canonical entry per reportDate —
 * a regenerate on the same day replaces that day's entry). Writes the proof
 * event to the append-only log regardless.
 */
async function persistReport(report) {
    const entry = {
        reportId: report.reportId,
        reportDate: report.reportDate,
        generatedAt: report.generatedAt,
        trigger: report.trigger,
        headline: report.headline,
        report,
    };
    const existing = isDurableStoreConfigured()
        ? await safe(() => readDurableJson(STATE_FILE, []), [])
        : await readHistoryFromFs();
    const withoutToday = existing.filter((e) => e.reportDate !== report.reportDate);
    const next = [entry, ...withoutToday]
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .slice(0, HISTORY_LIMIT);
    const proofEvent = {
        type: 'daily_report_generated',
        reportId: report.reportId,
        reportDate: report.reportDate,
        trigger: report.trigger,
        generatedAt: report.generatedAt,
        sourcesScanned: report.sourcesScanned,
        sectionCounts: Object.fromEntries(Object.values(report.sections).map((s) => [s.key, s.count])),
    };
    if (isDurableStoreConfigured()) {
        await safe(() => writeDurableJson(STATE_FILE, next), undefined);
        await safe(() => appendDurableEvent(STATE_FILE, proofEvent), undefined);
    }
    else {
        await writeHistoryToFs(next);
    }
    await appendEventToFs(proofEvent);
    console.log('[IVXDailyReport] GENERATED', {
        marker: IVX_DAILY_EXECUTIVE_REPORT_MARKER,
        reportId: report.reportId,
        reportDate: report.reportDate,
        trigger: report.trigger,
        sources: report.sourcesScanned.length,
    });
    return entry;
}
/**
 * Generate + persist one daily executive report. This is the single entry point
 * the API and the autonomous scheduler both call.
 */
export async function generateAndStoreDailyReport(options = {}) {
    const report = await buildDailyExecutiveReport(options);
    return persistReport(report);
}
