export const IVX_EXECUTIVE_LAYER_MARKER = 'ivx-executive-layer-2026-06-02';
const EXECUTIVE_DISCLAIMER = 'Executive operations reporting only — every figure is derived from real IVX records. ' +
    'Revenue/upside figures are POTENTIAL pipeline value, never guaranteed. Cash runway requires ' +
    'burn/expense data IVX does not yet track. Not financial, investment, or legal advice.';
// ── Helpers ──────────────────────────────────────────────────────────────────
function usd(value) {
    return `$${Math.round(value).toLocaleString('en-US')}`;
}
function clamp(value, min = 0, max = 100) {
    if (!Number.isFinite(value))
        return min;
    return Math.max(min, Math.min(max, value));
}
function gradeFor(score) {
    if (score >= 90)
        return 'A';
    if (score >= 80)
        return 'B';
    if (score >= 70)
        return 'C';
    if (score >= 55)
        return 'D';
    return 'F';
}
function levelFor(score) {
    if (score >= 75)
        return 'high';
    if (score >= 50)
        return 'medium';
    return 'low';
}
// ── 1. Daily business briefing ────────────────────────────────────────────────
export function buildDailyBriefing(impact, command, autonomous, now = Date.now()) {
    const revenuePotential = impact.revenuePotential.estimatedOpportunityValueUsd;
    const pipeline = command.capitalPipeline;
    const openRiskItems = [];
    if (impact.ceoBriefing.topRisk) {
        openRiskItems.push(`${impact.ceoBriefing.topRisk.title}: ${impact.ceoBriefing.topRisk.detail}`);
    }
    for (const d of command.dealsAtRisk.slice(0, 3)) {
        openRiskItems.push(`Deal at risk — ${d.name}: ${d.reason}`);
    }
    if (autonomous.subsystems.incidents.open > 0) {
        openRiskItems.push(`${autonomous.subsystems.incidents.open} open incident(s) in the operations dashboard.`);
    }
    if (autonomous.buckets.failed > 0 || autonomous.buckets.blocked > 0) {
        openRiskItems.push(`${autonomous.buckets.failed} failed + ${autonomous.buckets.blocked} blocked work item(s) need attention.`);
    }
    // Product health derived from operations buckets + incidents.
    const healthyWork = autonomous.buckets.verified + autonomous.buckets.completed;
    const unhealthyWork = autonomous.buckets.failed + autonomous.buckets.blocked;
    const openIncidents = autonomous.subsystems.incidents.open;
    const productHealthLabel = openIncidents === 0 && unhealthyWork === 0
        ? 'Healthy'
        : openIncidents > 0 || unhealthyWork > healthyWork
            ? 'Degraded'
            : 'Stable';
    return {
        date: new Date(now).toISOString(),
        revenue: {
            label: 'Revenue (pipeline potential)',
            value: revenuePotential > 0 ? usd(revenuePotential) : '$0',
            note: revenuePotential > 0
                ? `Potential upside across active opportunities; conservative reachable ${usd(impact.revenuePotential.capitalReachableUsd)}. Not guaranteed.`
                : 'No quantified revenue in the pipeline yet — stays unknown until evidenced.',
        },
        crmPipeline: {
            label: 'CRM pipeline',
            // Audit 2026-07-19: the entries counted here are capital-pipeline rows
            // auto-seeded from jv_deals (source=verified_deal) with partyType=investor —
            // they are DEAL FUNDING TARGETS, not active investor relationships. The
            // owner-dashboard confirms investors.active=0. Label honestly.
            value: `${pipeline.dealsInProgress} active deal-funding target(s)`,
            note: `${pipeline.activeInvestors} capital-pipeline target(s) (auto-seeded from deals, NOT active investor relationships) + ${pipeline.activeBuyers} buyer(s) active · ${pipeline.dealsInProgress} deal(s) in progress · 0 active investor relationships per CRM.`,
        },
        investorPipeline: {
            label: 'Investor pipeline (capital being sought)',
            value: usd(pipeline.totalPipeline),
            note: `Capital being sought across ${pipeline.dealsInProgress} deal-funding target(s) — NOT committed capital, NOT funds received. Weighted ${usd(pipeline.weightedPipeline)} · ${usd(pipeline.capitalCommitted)} committed · ${usd(command.capitalRaisedThisMonth)} raised this month.`,
        },
        cashRunway: {
            label: 'Cash runway',
            value: 'Unknown',
            note: 'Runway requires monthly burn + cash-on-hand inputs IVX does not yet track. Add expense/cash data to compute it — never estimated blindly.',
        },
        productHealth: {
            label: 'Product health',
            value: productHealthLabel,
            note: `${healthyWork} verified/completed vs ${unhealthyWork} failed/blocked work item(s); ${openIncidents} open incident(s).`,
        },
        openRisks: {
            count: openRiskItems.length,
            items: openRiskItems.slice(0, 6),
            note: openRiskItems.length === 0
                ? 'No open risks surfaced from incidents, deals, or operations right now.'
                : 'Risks aggregated from the CEO briefing, deals at risk, and the operations dashboard.',
        },
    };
}
// ── 2. Strategic planner ────────────────────────────────────────────────────
export function buildStrategicPlan(impact, command) {
    const pipeline = command.capitalPipeline;
    const opps = impact.opportunitiesFound;
    const raisedThisMonth = command.capitalRaisedThisMonth;
    const activeRelationships = pipeline.activeInvestors + pipeline.activeBuyers;
    const thirtyDay = [
        {
            title: command.bestInvestorToday ? `Advance ${command.bestInvestorToday.name}` : 'Build the investor pipeline',
            metric: command.bestInvestorToday
                ? `Book a meeting on ${command.bestInvestorToday.dealName} (match ${command.bestInvestorToday.matchScore}/100)`
                : 'Add 5 qualified capital relationships to the CRM',
            rationale: command.bestInvestorToday
                ? 'Highest-fit capital source today — converting it is the fastest path to committed capital.'
                : 'A populated CRM is the prerequisite for every downstream capital workflow.',
        },
        {
            title: 'Clear the open risks',
            metric: `Resolve ${command.dealsAtRisk.length} deal(s) at risk + ${command.followUpsNeeded.length} follow-up(s)`,
            rationale: 'Protecting in-flight relationships preserves more value than starting new ones.',
        },
        {
            title: 'Keep discovering opportunities',
            metric: `Sustain ${Math.max(opps.week, 5)}+ scanned opportunities / week`,
            rationale: `${opps.week} found this week — a steady top-of-funnel feeds the pipeline.`,
        },
    ];
    const ninetyDay = [
        {
            title: 'Grow the qualified pipeline',
            metric: `Reach ${Math.max(activeRelationships * 2, 10)} active investor/buyer relationships`,
            rationale: `${activeRelationships} active today — doubling the qualified base compounds raise capacity.`,
        },
        {
            title: 'Close the first tracked deal',
            metric: pipeline.dealsInProgress > 0
                ? `Move ${pipeline.dealsInProgress} in-progress deal(s) to committed`
                : 'Originate and commit the first deal',
            rationale: 'A first close validates the deployment platform end-to-end and unlocks references.',
        },
        {
            title: 'Establish a repeatable raise cadence',
            metric: `Raise ${usd(Math.max(raisedThisMonth * 3, 250000))} over the quarter`,
            rationale: 'A 90-day target turns one-off raises into a predictable capital engine.',
        },
    ];
    const yearly = [
        {
            title: 'Scale the capital deployment platform',
            metric: `Build a ${usd(Math.max(pipeline.totalPipeline * 4, 5000000))} weighted pipeline`,
            rationale: 'A durable multi-deal pipeline is the foundation of an autonomous capital business.',
        },
        {
            title: 'Operate autonomously at >99% reliability',
            metric: 'Owner-route + deliverable success rate ≥99% sustained',
            rationale: 'Reliable autonomous operations let the owner step back from day-to-day execution.',
        },
        {
            title: 'Diversify the portfolio',
            metric: 'Close deals across ≥3 markets / asset classes',
            rationale: 'Diversification de-risks the portfolio and widens the addressable investor base.',
        },
    ];
    return {
        thirtyDay,
        ninetyDay,
        yearly,
        note: 'Goals are targets derived from current real counts — directional, not guarantees. They re-derive as the pipeline grows.',
    };
}
// ── 3. Opportunity engine ─────────────────────────────────────────────────────
export function buildOpportunityEngineView(impact, command) {
    const capital = impact.capitalPipeline;
    const ranked = [];
    let rank = 1;
    if (command.bestInvestorToday) {
        ranked.push({
            rank: rank++,
            kind: 'investor',
            title: command.bestInvestorToday.name,
            detail: `${command.bestInvestorToday.company} · best fit for ${command.bestInvestorToday.dealName}`,
            score: command.bestInvestorToday.matchScore,
        });
    }
    if (command.bestBuyerToday) {
        ranked.push({
            rank: rank++,
            kind: 'customer',
            title: command.bestBuyerToday.name,
            detail: `${command.bestBuyerToday.company} · best buyer for ${command.bestBuyerToday.dealName}`,
            score: command.bestBuyerToday.matchScore,
        });
    }
    if (command.bestOpportunityToday) {
        ranked.push({
            rank: rank++,
            kind: 'opportunity',
            title: command.bestOpportunityToday.name,
            detail: `${command.bestOpportunityToday.recommendation} · ${command.bestOpportunityToday.rationale}`,
            score: command.bestOpportunityToday.weightedScore,
        });
    }
    if (impact.ceoBriefing.topOpportunity) {
        ranked.push({
            rank: rank++,
            kind: 'opportunity',
            title: impact.ceoBriefing.topOpportunity.title,
            detail: impact.ceoBriefing.topOpportunity.detail,
            score: null,
        });
    }
    const leads = command.meetingsNeeded.length + command.followUpsNeeded.length;
    const investors = capital.investorsDiscovered + command.capitalPipeline.activeInvestors;
    const customers = capital.buyersDiscovered + command.capitalPipeline.activeBuyers;
    return {
        leads,
        investors,
        customers,
        ranked,
        note: ranked.length === 0
            ? 'No ranked opportunities yet — run an opportunity/capital scan to populate the engine.'
            : 'Leads, investors, and customers detected from the CRM, capital matching, and opportunity scans.',
    };
}
// ── 4. Decision engine ────────────────────────────────────────────────────────
export function buildDecisionEngineView(impact, command, autonomous) {
    const decisions = [];
    let rank = 1;
    // Highest priority: protect against open risk.
    if (impact.ceoBriefing.topRisk) {
        decisions.push({
            rank: rank++,
            title: `Resolve: ${impact.ceoBriefing.topRisk.title}`,
            action: 'Triage and clear the top risk before advancing new work.',
            rationale: impact.ceoBriefing.topRisk.detail,
            estimatedImpact: 'Protects reliability + in-flight value',
            estimatedImpactUsd: null,
            riskLevel: 'high',
        });
    }
    // Capture the best investor today.
    if (command.bestInvestorToday) {
        decisions.push({
            rank: rank++,
            title: `Engage ${command.bestInvestorToday.name}`,
            action: `Send the owner-approved intro for ${command.bestInvestorToday.dealName} and book a meeting.`,
            rationale: `Highest-fit capital source (match ${command.bestInvestorToday.matchScore}/100). Evidence: ${command.bestInvestorToday.evidence.join('; ')}`,
            estimatedImpact: 'Advances committed capital',
            estimatedImpactUsd: command.capitalPipeline.weightedPipeline > 0 ? command.capitalPipeline.weightedPipeline : null,
            riskLevel: 'medium',
        });
    }
    // Capture the highest revenue opportunity.
    const revenuePick = impact.ceoBriefing.topRevenueOpportunity ?? impact.ceoBriefing.topOpportunity;
    if (revenuePick) {
        const usdValue = impact.revenuePotential.estimatedOpportunityValueUsd;
        decisions.push({
            rank: rank++,
            title: `Advance revenue opportunity: ${revenuePick.title}`,
            action: 'Move the highest-upside opportunity to the next pipeline stage.',
            rationale: revenuePick.detail,
            estimatedImpact: usdValue > 0 ? `Up to ${usd(usdValue)} potential (not guaranteed)` : 'Pipeline growth',
            estimatedImpactUsd: usdValue > 0 ? usdValue : null,
            riskLevel: 'medium',
        });
    }
    // Clear follow-ups / meetings if backlog is forming.
    const attentionCount = command.meetingsNeeded.length + command.followUpsNeeded.length;
    if (attentionCount > 0) {
        decisions.push({
            rank: rank++,
            title: 'Clear the relationship backlog',
            action: `Action ${command.meetingsNeeded.length} meeting(s) + ${command.followUpsNeeded.length} follow-up(s) awaiting a next step.`,
            rationale: 'Stale relationships decay; timely follow-up is the cheapest conversion lever.',
            estimatedImpact: 'Improves conversion rate',
            estimatedImpactUsd: null,
            riskLevel: 'low',
        });
    }
    // Keep IVX improving when capacity allows.
    if (autonomous.buckets.failed === 0 && autonomous.subsystems.incidents.open === 0) {
        decisions.push({
            rank: rank++,
            title: 'Run "Improve IVX today"',
            action: 'Operations are clean — spend a safe cycle improving the platform.',
            rationale: 'No open incidents or failed work — a good window to invest in compounding improvements.',
            estimatedImpact: 'Compounding platform quality',
            estimatedImpactUsd: null,
            riskLevel: 'low',
        });
    }
    return {
        decisions,
        note: decisions.length === 0
            ? 'No recommended actions right now — pipeline and operations are quiet.'
            : 'Recommendations ranked risk-first, then revenue, grounded in real subsystem state. Impact in USD is potential pipeline value, never guaranteed.',
    };
}
// ── 5. Execution tracking ─────────────────────────────────────────────────────
export function buildExecutionTracking(tasks) {
    let planned = 0;
    let executed = 0;
    let remaining = 0;
    let inProgress = 0;
    let blocked = 0;
    for (const t of tasks) {
        planned += t.totalBlocks;
        executed += t.completedBlockIds.length;
        const left = Math.max(0, t.totalBlocks - t.completedBlockIds.length);
        remaining += left;
        if (t.status === 'running' || t.status === 'queued')
            inProgress += 1;
        if (t.status === 'blocked' || t.status === 'failed')
            blocked += 1;
    }
    const recent = [...tasks]
        .sort((a, b) => Date.parse(b.updatedAt ?? '') - Date.parse(a.updatedAt ?? ''))
        .slice(0, 5)
        .map((t) => ({
        title: t.ownerCommand.slice(0, 80) || 'Task',
        status: t.status,
        progress: `${t.completedBlockIds.length}/${t.totalBlocks} blocks`,
    }));
    return {
        planned,
        executed,
        remaining,
        inProgress,
        blocked,
        recent,
        note: tasks.length === 0
            ? 'No orchestrator tasks yet — planned/executed/remaining populate as IVX runs work.'
            : 'Planned/executed/remaining are summed from durable orchestrator block state (survives restarts).',
    };
}
// ── 6. Executive scorecards ───────────────────────────────────────────────────
function makeScorecard(title, score, signals) {
    const s = Math.round(clamp(score));
    return { title, score: s, grade: gradeFor(s), level: levelFor(s), signals };
}
export function buildExecutiveScorecards(impact, command, autonomous, execution) {
    // Company — outcomes: opportunities discovered, improvements deployed, revenue in pipeline.
    const oppScore = Math.min(40, impact.businessGoals.opportunitiesDiscovered * 8);
    const improveScore = Math.min(30, impact.improvements.deploymentsCompleted * 6);
    const revenueScore = impact.revenuePotential.estimatedOpportunityValueUsd > 0 ? 30 : 0;
    const company = makeScorecard('Company', oppScore + improveScore + revenueScore, [
        `${impact.businessGoals.opportunitiesDiscovered} opportunities discovered`,
        `${impact.improvements.deploymentsCompleted} improvements deployed`,
        impact.revenuePotential.estimatedOpportunityValueUsd > 0
            ? `${usd(impact.revenuePotential.estimatedOpportunityValueUsd)} potential pipeline value`
            : 'No quantified revenue yet',
    ]);
    // AI — share of autonomous capabilities online.
    const caps = autonomous.capabilities;
    const onlineCaps = caps.filter((c) => c.state === 'online').length;
    const partialCaps = caps.filter((c) => c.state === 'partial').length;
    const aiScore = caps.length > 0 ? ((onlineCaps + partialCaps * 0.5) / caps.length) * 100 : 0;
    const ai = makeScorecard('AI', aiScore, [
        `${onlineCaps}/${caps.length} autonomous capabilities online`,
        `${partialCaps} partial`,
        `AI gateway ${autonomous.environment.aiGatewayConfigured ? 'configured' : 'not configured'}`,
    ]);
    // Engineering — verified/completed vs failed/blocked + open incidents.
    const b = autonomous.buckets;
    const goodWork = b.verified + b.completed;
    const totalWork = goodWork + b.failed + b.blocked + b.pending;
    const workScore = totalWork > 0 ? (goodWork / totalWork) * 70 : 50;
    const incidentPenalty = Math.min(20, autonomous.subsystems.incidents.open * 5);
    const executionScore = execution.blocked === 0 ? 30 : Math.max(0, 30 - execution.blocked * 5);
    const engineering = makeScorecard('Engineering', workScore + executionScore - incidentPenalty, [
        `${goodWork} verified/completed work item(s)`,
        `${b.failed} failed · ${b.blocked} blocked`,
        `${autonomous.subsystems.incidents.open} open incident(s)`,
    ]);
    // Capital — pipeline health + raised + best-investor presence.
    const pipeline = command.capitalPipeline;
    const pipelineScore = pipeline.totalPipeline > 0 ? 35 : 0;
    const raisedScore = command.capitalRaisedThisMonth > 0 ? 30 : 0;
    const relationshipScore = Math.min(20, (pipeline.activeInvestors + pipeline.activeBuyers) * 4);
    const investorScore = command.bestInvestorToday ? 15 : 0;
    const capital = makeScorecard('Capital', pipelineScore + raisedScore + relationshipScore + investorScore, [
        `${usd(pipeline.totalPipeline)} total pipeline`,
        `${usd(command.capitalRaisedThisMonth)} raised this month`,
        `${pipeline.activeInvestors + pipeline.activeBuyers} active relationship(s)`,
    ]);
    return { company, ai, engineering, capital };
}
// ── 7. Investor priorities ───────────────────────────────────────
export function buildInvestorPriorities(command) {
    const priorities = [];
    let rank = 1;
    let bestInvestor = null;
    if (command.bestInvestorToday) {
        bestInvestor = {
            rank: rank++,
            name: command.bestInvestorToday.name,
            detail: `${command.bestInvestorToday.company} · best fit for ${command.bestInvestorToday.dealName} (match ${command.bestInvestorToday.matchScore}/100)`,
            matchScore: command.bestInvestorToday.matchScore,
            nextAction: `Send the owner-approved intro for ${command.bestInvestorToday.dealName} and book a meeting.`,
        };
        priorities.push(bestInvestor);
    }
    for (const m of command.meetingsNeeded.slice(0, 3)) {
        priorities.push({
            rank: rank++,
            name: m.name,
            detail: `${m.company || m.dealName} — ${m.reason}`,
            matchScore: null,
            nextAction: 'Book the meeting to advance this relationship.',
        });
    }
    for (const f of command.followUpsNeeded.slice(0, 3)) {
        priorities.push({
            rank: rank++,
            name: f.name,
            detail: `${f.company || f.dealName} — ${f.reason}`,
            matchScore: null,
            nextAction: 'Send the follow-up — stale relationships decay.',
        });
    }
    return {
        bestInvestor,
        meetingsNeeded: command.meetingsNeeded.length,
        followUpsNeeded: command.followUpsNeeded.length,
        priorities,
        note: priorities.length === 0
            ? 'No investor priorities yet — add capital relationships to the CRM to populate this.'
            : 'Ranked from the best-fit investor today plus meetings + follow-ups awaiting a next step.',
    };
}
// ── 8. Deal pipeline ──────────────────────────────────────────
export function buildDealPipelineView(command) {
    const p = command.capitalPipeline;
    return {
        totalPipeline: usd(p.totalPipeline),
        weightedPipeline: usd(p.weightedPipeline),
        committed: usd(p.capitalCommitted),
        raisedThisMonth: usd(command.capitalRaisedThisMonth),
        activeInvestors: p.activeInvestors,
        activeBuyers: p.activeBuyers,
        dealsInProgress: p.dealsInProgress,
        dealsAtRisk: command.dealsAtRisk.slice(0, 5).map((d) => ({ name: d.name, reason: d.reason })),
        note: p.totalPipeline > 0 || p.dealsInProgress > 0
            ? 'Pipeline totals are derived from real Capital Pipeline + deal records; weighted = probability-adjusted. Potential, not guaranteed.'
            : 'No tracked deals yet — the pipeline populates as relationships move through the stages.',
    };
}
// ── 9. Autonomous actions taken ──────────────────────────────────
const SCHEDULER_JOB_LABELS = {
    daily_self_audit: 'Daily self-audit',
    daily_drift_detection: 'Architecture drift detection',
};
export function buildAutonomousActionsView(scheduler, loopSummary, runEvidence) {
    const actions = [];
    let totalRuns = 0;
    for (const job of Object.values(scheduler.jobs)) {
        totalRuns += job.runCount;
        actions.push({
            kind: job.kind,
            label: SCHEDULER_JOB_LABELS[job.kind] ?? job.kind,
            status: job.lastStatus,
            lastRunAt: job.lastRunAt,
            runCount: job.runCount,
            summary: job.lastSummary,
        });
    }
    // Audit 2026-07-19 Finding 3: split totalRuns by evidence so the UI cannot
    // imply every run produced persisted proof. Prefer the architecture-map
    // classification (runEvidence) when supplied; otherwise derive conservatively
    // from the scheduler jobs themselves (a run counts as evidenced only if its
    // last run produced a summary artifact and ended ok).
    const runsWithEvidence = runEvidence
        ? runEvidence.completedWithEvidence
        : Object.values(scheduler.jobs).filter((j) => j.lastStatus === 'ok' && Boolean(j.lastSummary)).length;
    const runsWithoutEvidence = runEvidence
        ? runEvidence.completedWithoutEvidence
        : Math.max(0, totalRuns - runsWithEvidence);
    return {
        schedulerEnabled: scheduler.enabled,
        totalRuns,
        runsWithEvidence,
        runsWithoutEvidence,
        loopsRun: loopSummary.total,
        outcomesRecorded: loopSummary.withOutcome,
        actions,
        note: totalRuns === 0
            ? 'The autonomous scheduler is armed but has not completed a run yet — actions appear here after the first daily cycle.'
            : `Autonomous actions are real scheduled runs (self-audit + drift detection). ${runsWithEvidence} run(s) produced persisted evidence; ${runsWithoutEvidence} completed without a persisted evidence artifact. Each drives a recommendation→execution→outcome loop.`,
    };
}
// ── 10. Learning summary ──────────────────────────────────────
export function buildLearningSummaryView(learning, loopSummary) {
    const categories = learning.categories.slice(0, 6).map((c) => ({
        category: c.category,
        successRate: c.successRate,
        withOutcome: c.withOutcome,
        improvedRecommendation: c.improvedRecommendation,
    }));
    return {
        totalLoops: learning.totalLoops,
        outcomesRecorded: loopSummary.withOutcome,
        overallSuccessRate: loopSummary.successRate,
        categories,
        note: learning.note,
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
const EMPTY_COMMAND = {
    marker: 'unavailable',
    generatedAt: new Date(0).toISOString(),
    bestInvestorToday: null,
    bestBuyerToday: null,
    bestOpportunityToday: null,
    capitalPipeline: {
        totalPipeline: 0,
        capitalCommitted: 0,
        capitalRaised: 0,
        weightedPipeline: 0,
        activeInvestors: 0,
        activeBuyers: 0,
        dealsInProgress: 0,
    },
    meetingsNeeded: [],
    followUpsNeeded: [],
    dealsAtRisk: [],
    capitalRaisedThisMonth: 0,
    headline: 'Capital command center unavailable.',
    note: 'Source unavailable.',
};
/**
 * Build the full Owner AI Executive Layer. Read-only; gathers every source
 * defensively so one failure never breaks the executive view.
 */
export async function buildExecutiveLayer(now = Date.now()) {
    const [{ buildBusinessImpactDashboard }, { buildCapitalCommandCenter }, { buildAutonomousDashboard }, { listTasks }, { getSchedulerState, freshSchedulerState }, { learnFromOutcomes, summarizeActionLoop }, { buildAiArchitectureMap },] = await Promise.all([
        import('./ivx-business-impact'),
        import('./ivx-capital-command-center'),
        import('./ivx-autonomous-core'),
        import('./ivx-task-state-store'),
        import('./ivx-autonomous-scheduler'),
        import('./ivx-executive-action-loop'),
        import('./ivx-ai-architecture-map'),
    ]);
    const emptyLoopSummary = {
        marker: 'unavailable',
        generatedAt: new Date(now).toISOString(),
        total: 0,
        byStage: { recommended: 0, executing: 0, executed: 0, outcome_recorded: 0 },
        withOutcome: 0,
        successes: 0,
        failures: 0,
        successRate: null,
    };
    const emptyLearning = {
        marker: 'unavailable',
        generatedAt: new Date(now).toISOString(),
        totalLoops: 0,
        categories: [],
        note: 'Learning report unavailable.',
    };
    const [impact, command, autonomous, tasks, scheduler, learning, loopSummary, archMap] = await Promise.all([
        safe(() => buildBusinessImpactDashboard(now), null),
        safe(() => buildCapitalCommandCenter(), EMPTY_COMMAND),
        safe(() => buildAutonomousDashboard(), null),
        safe(() => listTasks(100), []),
        safe(() => getSchedulerState(), freshSchedulerState(now)),
        safe(() => learnFromOutcomes(), emptyLearning),
        safe(() => summarizeActionLoop(), emptyLoopSummary),
        safe(() => buildAiArchitectureMap('executive-layer'), null),
    ]);
    // Audit 2026-07-19 Finding 3 + 2026-07-26 run-log upgrade: prefer the
    // PERMANENT run-log summary (one durable record per execution, with concrete
    // evidence artifacts) over the conservative architecture-map derivation.
    // Falls back to the arch-map classification when the run log is empty.
    let runEvidence = archMap?.autonomousRunClassification ?? undefined;
    try {
        const { summarizeAutonomousRunLog } = await import('./ivx-autonomous-run-log');
        const runLogSummary = await summarizeAutonomousRunLog(500);
        if (runLogSummary && runLogSummary.totalRuns > 0) {
            runEvidence = {
                completedWithEvidence: runLogSummary.runsWithEvidence,
                completedWithoutEvidence: runLogSummary.runsWithoutEvidence,
                failed: runLogSummary.failed,
            };
        }
    }
    catch {
        // run-log read is best-effort; keep the arch-map fallback.
    }
    // business-impact and autonomous dashboards are required for derivation; if a
    // reader failed, fall back to a freshly-built empty-but-valid dashboard.
    const impactDash = impact ?? (await buildBusinessImpactDashboard(now));
    const autonomousDash = autonomous ?? (await buildAutonomousDashboard());
    const dailyBriefing = buildDailyBriefing(impactDash, command, autonomousDash, now);
    const strategicPlan = buildStrategicPlan(impactDash, command);
    const opportunityEngine = buildOpportunityEngineView(impactDash, command);
    const decisionEngine = buildDecisionEngineView(impactDash, command, autonomousDash);
    const executionTracking = buildExecutionTracking(tasks);
    const investorPriorities = buildInvestorPriorities(command);
    const dealPipeline = buildDealPipelineView(command);
    const autonomousActions = buildAutonomousActionsView(scheduler, loopSummary, runEvidence);
    const learningSummary = buildLearningSummaryView(learning, loopSummary);
    const scorecards = buildExecutiveScorecards(impactDash, command, autonomousDash, executionTracking);
    const headline = `Executive briefing: ${dailyBriefing.crmPipeline.value} CRM relationships, ${dailyBriefing.investorPipeline.value} investor pipeline, ${dailyBriefing.openRisks.count} open risk(s). Company ${scorecards.company.grade} · AI ${scorecards.ai.grade} · Engineering ${scorecards.engineering.grade} · Capital ${scorecards.capital.grade}.`;
    return {
        marker: IVX_EXECUTIVE_LAYER_MARKER,
        generatedAt: new Date(now).toISOString(),
        headline,
        dailyBriefing,
        strategicPlan,
        opportunityEngine,
        decisionEngine,
        executionTracking,
        investorPriorities,
        dealPipeline,
        autonomousActions,
        learningSummary,
        scorecards,
        disclaimer: EXECUTIVE_DISCLAIMER,
    };
}
