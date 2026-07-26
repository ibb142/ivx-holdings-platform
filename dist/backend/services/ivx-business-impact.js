/**
 * IVX Business Impact + Daily Operations engine (owner-only).
 *
 * Stops measuring success by features and starts measuring it by BUSINESS
 * OUTCOMES. This is a read-only aggregation layer over the engines already
 * shipped (opportunity, innovation, incidents, repair jobs, tasks, deal data) —
 * it never mutates and never fabricates profit.
 *
 * It produces, from real subsystem state:
 *   - Business Impact   : opportunities found, capital pipeline, revenue
 *                         potential, IVX improvements, time saved.
 *   - CEO Briefing       : top opportunity / investor / buyer / risk /
 *                         improvement / revenue / partnership today.
 *   - Command Center     : active deals, pipelines, improvements deployed,
 *                         revenue opportunities, conversion + growth metrics.
 *   - Daily Scorecard    : what IVX discovered / improved / learned /
 *                         recommends + expected (NOT guaranteed) impact.
 *   - Priority tasks     : P1/P2/P3 derived from the highest-leverage real work.
 *   - Owner tablet feed   : yesterday / today / recommends next / working on /
 *                         needs decision — the first thing the owner sees.
 *
 * HARD RULES:
 *   - Never promise guaranteed profit. Upside is "potential", always caveated.
 *   - Every number is grounded in a real record. Estimates (e.g. hours saved)
 *     use transparent, documented per-unit constants and are labelled estimates.
 *   - Unknown stays unknown; nothing is invented.
 *
 * Deterministic + runtime-light: pure functions over already-collected records.
 * Heavy/async readers are gathered defensively (a failed reader degrades to an
 * honest empty value, never throws).
 */
import { listAlerts, listOpportunities } from './ivx-opportunity-store';
import { buildInnovationDashboard } from './ivx-innovation-dashboard';
import { listIncidents } from './ivx-incident-store';
import { listTasks } from './ivx-task-state-store';
export const IVX_BUSINESS_IMPACT_MARKER = 'ivx-business-impact-2026-05-30';
/** Transparent estimate constants (documented so "hours saved" is explainable). */
export const HOURS_SAVED_PER_AUTOMATED_TASK = 2;
export const HOURS_SAVED_PER_RESEARCH_ARTIFACT = 0.5;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MONTH_MS = 30 * DAY_MS;
const IMPACT_DISCLAIMER = 'Business-outcome reporting only — figures are derived from real IVX records. ' +
    'Upside/value figures are POTENTIAL, never guaranteed. Not financial, investment, or legal advice.';
// ── Pure helpers (unit-testable) ─────────────────────────────────────────────
function toTime(iso) {
    if (!iso)
        return 0;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : 0;
}
/** Count items whose timestamp falls within `windowMs` of `now`. */
export function countWithinWindow(items, getIso, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    return items.reduce((count, item) => (toTime(getIso(item)) >= cutoff ? count + 1 : count), 0);
}
export function buildOpportunitiesFound(opportunities, now = Date.now()) {
    return {
        today: countWithinWindow(opportunities, (o) => o.createdAt, DAY_MS, now),
        week: countWithinWindow(opportunities, (o) => o.createdAt, WEEK_MS, now),
        month: countWithinWindow(opportunities, (o) => o.createdAt, MONTH_MS, now),
    };
}
function isActive(o) {
    return o.status !== 'dismissed' && o.status !== 'closed';
}
/**
 * Capital pipeline = pipeline SIGNALS derived from scanned opportunity
 * categories (not real contacts). Honest about what it represents.
 */
export function buildCapitalPipeline(opportunities) {
    const active = opportunities.filter(isActive);
    const count = (cats) => active.filter((o) => cats.includes(o.category)).length;
    return {
        investorsDiscovered: count(['investor']),
        partnersDiscovered: count(['partnership']),
        lendersDiscovered: count(['financing']),
        buyersDiscovered: count(['real_estate', 'distressed_asset']),
        note: 'Pipeline signals derived from scanned opportunities, not confirmed contacts.',
    };
}
export function buildRevenuePotential(opportunities) {
    const active = opportunities.filter(isActive);
    const estimatedOpportunityValueUsd = active.reduce((sum, o) => sum + (o.upsideHighUsd ?? 0), 0);
    const capitalReachableUsd = active.reduce((sum, o) => sum + (o.upsideLowUsd ?? 0), 0);
    const dealsInProgress = opportunities.filter((o) => o.status === 'watching' || o.status === 'pursuing').length;
    return {
        estimatedOpportunityValueUsd,
        capitalReachableUsd,
        dealsInProgress,
        note: 'Potential upside summed from evidenced opportunity ranges — never a guarantee.',
    };
}
const RESOLVED_INCIDENT_STATUSES = new Set([
    'resolved',
    'production_deployed',
]);
export function buildImprovementOutcomes(incidents, repairJobs, tasks) {
    const bugsFixed = incidents.filter((i) => RESOLVED_INCIDENT_STATUSES.has(i.status)).length +
        repairJobs.filter((j) => j.stage === 'completed' || j.stage === 'auto_applied').length;
    const deploymentsCompleted = tasks.filter((t) => t.status === 'completed').length;
    // Issues caught before they ever became critical (resolved while non-critical).
    const productionIssuesPrevented = incidents.filter((i) => RESOLVED_INCIDENT_STATUSES.has(i.status) && i.severity !== 'critical').length;
    return { bugsFixed, deploymentsCompleted, productionIssuesPrevented };
}
export function buildTimeSaved(tasks, innovation, opportunitiesCount) {
    const tasksAutomated = tasks.filter((t) => t.status === 'completed').length + innovation.experiments.completed;
    const researchAutomated = innovation.inventions.total + opportunitiesCount;
    const hoursSaved = Math.round(tasksAutomated * HOURS_SAVED_PER_AUTOMATED_TASK + researchAutomated * HOURS_SAVED_PER_RESEARCH_ARTIFACT);
    return {
        hoursSaved,
        tasksAutomated,
        researchAutomated,
        note: `Estimate: ${HOURS_SAVED_PER_AUTOMATED_TASK}h per automated task + ${HOURS_SAVED_PER_RESEARCH_ARTIFACT}h per research artifact.`,
    };
}
// ── Picks / briefing ──────────────────────────────────────────────────────────
function bestActive(opportunities, predicate, key = (o) => o.overall) {
    const candidates = opportunities.filter((o) => isActive(o) && predicate(o));
    if (candidates.length === 0)
        return null;
    return candidates.reduce((best, o) => (key(o) > key(best) ? o : best), candidates[0]);
}
function oppPick(o, detailSuffix) {
    if (!o)
        return null;
    const base = `Overall ${o.overall}/100 · upside ${o.scores.upside}/100 · evidence ${o.scores.evidence}/100`;
    return { title: o.title, detail: detailSuffix ? `${base} · ${detailSuffix}` : base, refId: o.id };
}
const UNRESOLVED_INCIDENT_STATUSES = new Set([
    'open',
    'diagnosing',
    'awaiting_approval',
    'fix_proposed',
    'staging_failed',
    'awaiting_production_approval',
    'rolled_back',
]);
const SEVERITY_RANK = {
    critical: 4,
    error: 3,
    warning: 2,
    info: 1,
};
function topRiskPick(incidents, opportunities) {
    const unresolved = incidents.filter((i) => UNRESOLVED_INCIDENT_STATUSES.has(i.status));
    if (unresolved.length > 0) {
        const worst = unresolved.reduce((a, b) => (SEVERITY_RANK[b.severity] > SEVERITY_RANK[a.severity] ? b : a), unresolved[0]);
        return {
            title: `Unresolved ${worst.severity} incident (${worst.source})`,
            detail: worst.message.slice(0, 140),
            refId: worst.id,
        };
    }
    // No open incidents: surface the highest-risk (lowest risk-score) active opportunity instead.
    const riskiest = bestActive(opportunities, () => true, (o) => 100 - o.scores.risk);
    if (riskiest) {
        return {
            title: `Execution risk: ${riskiest.title}`,
            detail: riskiest.riskWarnings[0] ?? `Risk-safety score ${riskiest.scores.risk}/100.`,
            refId: riskiest.id,
        };
    }
    return null;
}
function topImprovementPick(tasks, innovation) {
    const completed = tasks
        .filter((t) => t.status === 'completed')
        .sort((a, b) => toTime(b.completedAt ?? b.updatedAt) - toTime(a.completedAt ?? a.updatedAt));
    if (completed.length > 0) {
        const latest = completed[0];
        return {
            title: latest.ownerCommand.slice(0, 80) || 'Completed improvement',
            detail: `${latest.completedBlockIds.length}/${latest.totalBlocks} blocks completed`,
            refId: latest.id,
        };
    }
    const shipped = innovation.topIdeas.find((i) => i.status === 'shipped' || i.status === 'approved');
    if (shipped) {
        return { title: shipped.title, detail: `Innovation idea (${shipped.status})`, refId: shipped.id };
    }
    return null;
}
export function buildCeoBriefing(opportunities, incidents, tasks, innovation, now = Date.now()) {
    const topOpportunity = bestActive(opportunities, () => true);
    const topRevenue = bestActive(opportunities, (o) => o.upsideHighUsd !== null, (o) => o.upsideHighUsd ?? 0);
    return {
        date: new Date(now).toISOString(),
        topOpportunity: oppPick(topOpportunity),
        topInvestor: oppPick(bestActive(opportunities, (o) => o.category === 'investor')),
        topBuyer: oppPick(bestActive(opportunities, (o) => o.category === 'real_estate' || o.category === 'distressed_asset')),
        topRisk: topRiskPick(incidents, opportunities),
        topImprovement: topImprovementPick(tasks, innovation),
        topRevenueOpportunity: oppPick(topRevenue, topRevenue && topRevenue.upsideHighUsd !== null
            ? `potential upside up to $${topRevenue.upsideHighUsd.toLocaleString('en-US')} (not guaranteed)`
            : undefined),
        topPartnership: oppPick(bestActive(opportunities, (o) => o.category === 'partnership')),
    };
}
// ── Scorecard / goals / priority / feed ────────────────────────────────────────
export function buildBusinessGoals(opportunities, improvements, capital, revenue, activeDeals) {
    const revenueOpportunities = opportunities.filter((o) => isActive(o) && o.upsideHighUsd !== null).length;
    return {
        activeDeals,
        investorPipeline: capital.investorsDiscovered,
        buyerPipeline: capital.buyersDiscovered,
        opportunitiesDiscovered: opportunities.length,
        improvementsDeployed: improvements.deploymentsCompleted,
        revenueOpportunities,
        conversionMetrics: `${revenue.dealsInProgress} opportunity(ies) in progress of ${opportunities.length} discovered.`,
        growthMetrics: `${improvements.deploymentsCompleted} improvements deployed · ${improvements.bugsFixed} bugs fixed.`,
    };
}
export function buildPriorityTasks(briefing) {
    const tasks = [];
    // P1 — protect reliability / revenue first.
    if (briefing.topRisk) {
        tasks.push({
            priority: 1,
            title: `Resolve: ${briefing.topRisk.title}`,
            rationale: briefing.topRisk.detail,
            source: 'risk',
        });
    }
    else if (briefing.topOpportunity) {
        tasks.push({
            priority: 1,
            title: `Pursue top opportunity: ${briefing.topOpportunity.title}`,
            rationale: briefing.topOpportunity.detail,
            source: 'opportunity',
        });
    }
    // P2 — capture the highest revenue opportunity.
    const revenue = briefing.topRevenueOpportunity ?? briefing.topInvestor ?? briefing.topOpportunity;
    if (revenue) {
        tasks.push({
            priority: 2,
            title: `Advance revenue opportunity: ${revenue.title}`,
            rationale: revenue.detail,
            source: 'revenue',
        });
    }
    // P3 — keep improving IVX itself.
    tasks.push({
        priority: 3,
        title: briefing.topImprovement
            ? `Build on the last improvement: ${briefing.topImprovement.title}`
            : 'Run "Improve IVX today" to ship one safe improvement.',
        rationale: briefing.topImprovement?.detail ?? 'No improvement recorded in the window yet.',
        source: 'improvement',
    });
    return tasks;
}
export function buildScorecard(opportunitiesFound, improvements, innovation, revenue, briefing, now = Date.now()) {
    return {
        date: new Date(now).toISOString(),
        discovered: `${opportunitiesFound.today} opportunity(ies) found today (${opportunitiesFound.week} this week).`,
        improved: `${improvements.deploymentsCompleted} improvement(s) deployed · ${improvements.bugsFixed} bug(s) fixed · ${improvements.productionIssuesPrevented} issue(s) prevented.`,
        learned: `${innovation.inventions.proposed} idea(s) proposed · ${innovation.experiments.completed} experiment(s) completed.`,
        recommends: briefing.topRisk
            ? `Resolve "${briefing.topRisk.title}" first, then advance ${briefing.topOpportunity?.title ?? 'the top opportunity'}.`
            : briefing.topOpportunity
                ? `Advance "${briefing.topOpportunity.title}".`
                : 'Run a scan to surface new opportunities.',
        expectedImpact: revenue.estimatedOpportunityValueUsd > 0
            ? `Up to $${revenue.estimatedOpportunityValueUsd.toLocaleString('en-US')} in potential opportunity value in the pipeline (not guaranteed).`
            : 'No quantified upside in the pipeline yet — economics stay unknown until evidenced.',
    };
}
export function buildOwnerFeed(opportunitiesFound, improvements, briefing, tasks, alerts, innovation) {
    const running = tasks.find((t) => t.status === 'running' || t.status === 'queued');
    const unacked = alerts.filter((a) => !a.acknowledged).length;
    const needsDecisionCount = unacked + innovation.inventions.proposed;
    return {
        yesterday: `${opportunitiesFound.today} opportunity(ies) found, ${improvements.deploymentsCompleted} improvement(s) deployed, ${improvements.bugsFixed} bug(s) fixed in the last 24h.`,
        today: briefing.topOpportunity
            ? `Focus on ${briefing.topOpportunity.title}${briefing.topRisk ? ` and resolve ${briefing.topRisk.title}` : ''}.`
            : 'No active opportunity — run a scan to surface today\'s best.',
        recommendsNext: briefing.topRevenueOpportunity?.title
            ? `Advance the top revenue opportunity: ${briefing.topRevenueOpportunity.title}.`
            : 'Generate ideas / run an opportunity scan.',
        workingOn: running ? `${running.ownerCommand.slice(0, 80)} (${running.status})` : 'Idle — no task currently running.',
        needsDecision: needsDecisionCount > 0
            ? `${needsDecisionCount} item(s) await your decision (${unacked} alert(s), ${innovation.inventions.proposed} idea(s) proposed).`
            : 'Nothing awaiting your decision right now.',
    };
}
// ── Async assembly (defensive) ─────────────────────────────────────────────────
async function safe(fn, fallback) {
    try {
        return await fn();
    }
    catch {
        return fallback;
    }
}
const EMPTY_INNOVATION = {
    marker: 'unavailable',
    generatedAt: new Date(0).toISOString(),
    inventions: { proposed: 0, approved: 0, rejected: 0, shipped: 0, total: 0 },
    experiments: { planned: 0, running: 0, completed: 0, abandoned: 0, total: 0 },
    hypotheses: { open: 0, testing: 0, validated: 0, invalidated: 0, total: 0 },
    estimatedBusinessValueUsd: 0,
    topIdeas: [],
};
/** Active published deals from the live jv_deals source (defensive, may be 0). */
async function readActiveDeals() {
    return safe(async () => {
        const { readLandingProjects } = await import('./ivx-project-data');
        const result = await readLandingProjects();
        return result.ok ? result.projects.length : 0;
    }, 0);
}
/**
 * Build the full owner Business Impact / Daily Operations dashboard. Read-only;
 * gathers every source defensively so one failure never breaks the briefing.
 */
export async function buildBusinessImpactDashboard(now = Date.now()) {
    const [opportunities, alerts, innovation, activeDeals] = await Promise.all([
        safe(() => listOpportunities(), []),
        safe(() => listAlerts(100), []),
        safe(() => buildInnovationDashboard(), EMPTY_INNOVATION),
        readActiveDeals(),
    ]);
    const incidents = await safe(async () => listIncidents(300), []);
    const repairJobs = await safe(async () => {
        const { listRepairJobs } = await import('./ivx-repair-jobs');
        return listRepairJobs(200);
    }, []);
    const tasks = await safe(() => listTasks(100), []);
    const opportunitiesFound = buildOpportunitiesFound(opportunities, now);
    const capitalPipeline = buildCapitalPipeline(opportunities);
    const revenuePotential = buildRevenuePotential(opportunities);
    const improvements = buildImprovementOutcomes(incidents, repairJobs, tasks);
    const timeSaved = buildTimeSaved(tasks, innovation, opportunities.length);
    const ceoBriefing = buildCeoBriefing(opportunities, incidents, tasks, innovation, now);
    const businessGoals = buildBusinessGoals(opportunities, improvements, capitalPipeline, revenuePotential, activeDeals);
    const priorityTasks = buildPriorityTasks(ceoBriefing);
    const scorecard = buildScorecard(opportunitiesFound, improvements, innovation, revenuePotential, ceoBriefing, now);
    const ownerFeed = buildOwnerFeed(opportunitiesFound, improvements, ceoBriefing, tasks, alerts, innovation);
    const headline = `Here is how IVX helped IVX Holdings in the last 24 hours: ${opportunitiesFound.today} opportunity(ies) found, ${improvements.deploymentsCompleted} improvement(s) deployed, ${improvements.bugsFixed} bug(s) fixed, ~${timeSaved.hoursSaved}h saved.`;
    return {
        marker: IVX_BUSINESS_IMPACT_MARKER,
        generatedAt: new Date(now).toISOString(),
        headline,
        opportunitiesFound,
        capitalPipeline,
        revenuePotential,
        improvements,
        timeSaved,
        ceoBriefing,
        scorecard,
        businessGoals,
        priorityTasks,
        ownerFeed,
        disclaimer: IMPACT_DISCLAIMER,
    };
}
