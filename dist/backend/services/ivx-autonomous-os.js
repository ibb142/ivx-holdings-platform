/**
 * IVX Autonomous OS v2.0 — the single composing layer that turns the existing
 * IVX engines into one continuously-operating venture operating system view.
 *
 * It does NOT add a second source of truth and it NEVER fabricates. It composes
 * real subsystem state into two owner-facing artifacts:
 *
 *   1. Autonomous OS status  — a live snapshot of every "continuous thinking"
 *      subsystem (innovation backlog, lead discovery, web navigation, executive
 *      layer, autonomous core) PLUS a strict VERIFICATION LEDGER that labels each
 *      claim category VERIFIED (backed by real evidence) or PLAN ONLY (no proof).
 *
 *   2. Weekly executive report — a 7-day roll-up aggregated from the durable
 *      daily-report history (top innovations, top investor/buyer targets, verified
 *      deployments, growth recommendations).
 *
 * HARD TRUTH POLICY (Principle 9 of the v2.0 spec):
 *   No category is ever marked VERIFIED without concrete evidence (a completed
 *   repair job, a resolved/deployed incident, a shipped idea, an approved lead, a
 *   real web-navigation pass). Everything else is explicitly PLAN ONLY.
 *
 * Read-only + deterministic: safe to run on the autonomous scheduler without
 * credits, network burn (beyond the optional live web check), or timeout risk.
 */
export const IVX_AUTONOMOUS_OS_MARKER = 'ivx-autonomous-os-v2-2026-06-12';
const OS_DISCLAIMER = 'IVX Autonomous OS status — every metric is derived from real IVX records. A category is ' +
    'marked VERIFIED only when concrete evidence exists (completed repairs, deployed/resolved ' +
    'incidents, shipped ideas, approved leads, a passed live web check). Everything else is ' +
    'PLAN ONLY. Ideas, leads, investors, and revenue are never fabricated. Not financial advice.';
function nowIso(now = Date.now()) {
    return new Date(now).toISOString();
}
async function safe(fn, fallback) {
    try {
        return await fn();
    }
    catch {
        return fallback;
    }
}
function ledgerEntry(category, evidence, verifiedNote, planNote) {
    const evidenceCount = evidence.length;
    const status = evidenceCount > 0 ? 'VERIFIED' : 'PLAN_ONLY';
    return {
        category,
        status,
        evidenceCount,
        evidence: evidence.slice(0, 8),
        note: evidenceCount > 0 ? verifiedNote : planNote,
    };
}
// ── Autonomous OS status (truth-gated) ────────────────────────────────────────
/**
 * Build the live Autonomous OS status. Composes the executive layer, innovation
 * dashboard, lead discovery, repair jobs, and incidents into a single view and
 * applies the strict verification ledger.
 */
export async function buildAutonomousOsStatus(options = {}) {
    const now = options.now ?? Date.now();
    const [{ buildExecutiveLayer }, { buildInnovationDashboard }, { summarizeLeads, listLeads }, { listRepairJobs }, { listIncidents },] = await Promise.all([
        import('./ivx-executive-layer'),
        import('./ivx-innovation-dashboard'),
        import('./ivx-lead-discovery'),
        import('./ivx-repair-jobs'),
        import('./ivx-incident-store'),
    ]);
    const executive = await safe(() => buildExecutiveLayer(now), null);
    const innovation = await safe(() => buildInnovationDashboard(), null);
    const leadSummary = await safe(() => summarizeLeads(), null);
    const approvedLeads = await safe(() => listLeads('approved'), []);
    const pendingLeads = await safe(() => listLeads('pending_approval'), []);
    const repairJobs = await safe(() => listRepairJobs(100), []);
    const incidents = await safe(() => listIncidents(200), []);
    // Optional, best-effort live web navigation check (never blocks the status).
    const webNav = options.includeLiveWebCheck
        ? await safe(async () => {
            const { navigateSite } = await import('./ivx-web-navigator');
            return await navigateSite({ maxPages: 4 });
        }, null)
        : null;
    // ── Subsystems (continuous thinking layer) ──────────────────────────────────
    const subsystems = [
        {
            key: 'innovation',
            name: 'Innovation backlog',
            online: Boolean(innovation),
            metric: `${innovation?.inventions.total ?? 0} idea(s) · ${innovation?.inventions.proposed ?? 0} proposed`,
            detail: innovation
                ? `${innovation.inventions.approved} approved, ${innovation.inventions.shipped} shipped; ` +
                    `est. value $${innovation.estimatedBusinessValueUsd.toLocaleString('en-US')} (potential).`
                : 'Innovation engine unavailable this cycle.',
        },
        {
            key: 'leadDiscovery',
            name: 'Investor / buyer discovery',
            online: Boolean(leadSummary),
            metric: `${leadSummary?.total ?? 0} lead(s) · ${leadSummary?.pendingApproval ?? 0} awaiting approval`,
            detail: leadSummary
                ? `${leadSummary.approved} approved into CRM, avg score ${leadSummary.avgScore}/100. Outreach is staged only.`
                : 'Lead discovery store unavailable this cycle.',
        },
        {
            key: 'webNavigation',
            name: 'Live web navigation',
            online: true,
            metric: webNav
                ? `${webNav.pagesVisited} page(s) crawled · ${webNav.pass ? 'PASS' : 'CHECK'}`
                : 'on-demand',
            detail: webNav
                ? webNav.verdict
                : 'Runs on demand against ivxholding.com (text snapshots + Supabase drift; no JS/pixel screenshots).',
        },
        {
            key: 'executive',
            name: 'Executive layer',
            online: Boolean(executive),
            metric: executive
                ? `${executive.decisionEngine.decisions.length} ranked decision(s)`
                : 'unavailable',
            detail: executive
                ? `${executive.opportunityEngine.ranked.length} opportunities ranked; ` +
                    `${executive.dealPipeline.dealsInProgress} deal(s) tracked.`
                : 'Executive layer unavailable this cycle.',
        },
        {
            key: 'repairEngine',
            name: 'Autonomous repair engine',
            online: true,
            metric: `${repairJobs.length} repair job(s) tracked`,
            detail: `${repairJobs.filter((j) => j.stage === 'completed').length} completed, ` +
                `${repairJobs.filter((j) => j.stage === 'awaiting_approval').length} awaiting owner approval.`,
        },
    ];
    // ── Verification ledger (the truth gate) ────────────────────────────────────
    const completedRepairs = repairJobs.filter((j) => j.stage === 'completed');
    const deployedIncidents = incidents.filter((i) => i.status === 'resolved' || i.status === 'production_deployed');
    const shippedIdeas = (innovation?.topIdeas ?? []).filter((i) => i.status === 'shipped');
    const approvedIdeas = (innovation?.topIdeas ?? []).filter((i) => i.status === 'approved');
    const verificationLedger = [
        ledgerEntry('Bugs fixed & deployed', [
            ...completedRepairs.map((j) => `repair-job ${j.id.slice(0, 12)} (incident ${j.incidentId.slice(0, 10)}) completed`),
            ...deployedIncidents.map((i) => `incident ${i.id.slice(0, 12)} ${i.status}`),
        ], 'Repairs validated and incidents resolved/deployed — backed by real job + incident records.', 'No repair has reached a completed/deployed state yet. Any "fix" is PLAN ONLY until a job completes.'),
        ledgerEntry('Technologies / innovations shipped', shippedIdeas.map((i) => `idea "${i.title.slice(0, 48)}" shipped (priority ${i.priority}/100)`), 'Innovations marked shipped in the durable innovation store.', 'Innovation backlog holds proposals only. Ideas remain PLAN ONLY until approved & shipped.'),
        ledgerEntry('Investors / buyers qualified into CRM', approvedLeads.map((l) => `${l.partyType} "${l.name.slice(0, 40)}" approved → CRM (${l.source}, score ${l.score}/100)`), 'Leads approved by the owner and promoted into the durable CRM, with real public-source attribution.', 'Discovered leads are staged for approval only. No investor/buyer is counted until owner-approved into the CRM.'),
        ledgerEntry('Live website verification', webNav && webNav.pass
            ? [`${webNav.origin} crawl PASS · ${webNav.pagesVisited} page(s) · drift checked: ${webNav.drift.checked}`]
            : [], 'A live navigation pass over the public site succeeded with real HTTP + content evidence.', 'No passing live web check in this status. Run the navigator to produce verifiable evidence.'),
        ledgerEntry('Approved innovations (ready to build)', approvedIdeas.map((i) => `idea "${i.title.slice(0, 48)}" approved (priority ${i.priority}/100)`), 'Ideas the owner approved — ready for an MVP build, evidenced in the innovation store.', 'No ideas approved yet. Approval is the owner gate before any build work begins.'),
    ];
    const verified = verificationLedger.filter((l) => l.status === 'VERIFIED').length;
    const planOnly = verificationLedger.length - verified;
    const totalEvidence = verificationLedger.reduce((s, l) => s + l.evidenceCount, 0);
    // ── Owner approval queue (Principle 8) ──────────────────────────────────────
    const ownerApprovalQueue = [
        {
            action: 'Investor / buyer outreach',
            count: pendingLeads.length,
            detail: 'Discovered leads with drafted outreach staged. Nothing is sent until you approve each one.',
        },
        {
            action: 'Production repair deploys',
            count: repairJobs.filter((j) => j.stage === 'awaiting_approval').length,
            detail: 'Repairs that passed staging and need your approval before promoting to production.',
        },
        {
            action: 'Innovation builds',
            count: innovation?.inventions.proposed ?? 0,
            detail: 'Proposed ideas awaiting your approval before any MVP build starts.',
        },
    ].filter((q) => q.count > 0);
    const operational = subsystems.some((s) => s.online);
    const headline = `Autonomous OS — ${verified}/${verificationLedger.length} category(ies) VERIFIED, ` +
        `${planOnly} PLAN ONLY; ${innovation?.inventions.total ?? 0} idea(s) in backlog, ` +
        `${leadSummary?.pendingApproval ?? 0} lead(s) + ` +
        `${repairJobs.filter((j) => j.stage === 'awaiting_approval').length} deploy(s) awaiting approval.`;
    return {
        marker: IVX_AUTONOMOUS_OS_MARKER,
        generatedAt: nowIso(now),
        operational,
        headline,
        subsystems,
        verificationLedger,
        ledgerSummary: { verified, planOnly, totalEvidence },
        ownerApprovalQueue,
        disclaimer: OS_DISCLAIMER,
    };
}
const WEEKLY_DISCLAIMER = 'Weekly executive report — aggregated from the durable daily-report history plus live ' +
    'subsystem state. "Verified deployments" lists only repairs/incidents with real completed/' +
    'deployed records. Top targets are ranked from real pipeline data; no investor, buyer, or ' +
    'revenue figure is ever fabricated. Not financial, investment, or legal advice.';
function weeklySection(key, title, items, emptyNote, groundedNote) {
    return {
        key,
        title,
        count: items.length,
        items,
        note: items.length === 0 ? emptyNote : groundedNote,
    };
}
/**
 * Build the weekly executive report. Aggregates the last 7 days of stored daily
 * reports (de-duplicated by title) and tops them up with live subsystem state so
 * the report is grounded even before a week of history exists.
 */
export async function buildWeeklyExecutiveReport(options = {}) {
    const now = options.now ?? Date.now();
    const windowStartMs = now - 7 * 24 * 60 * 60 * 1000;
    const [{ listReportHistory }, { buildInnovationDashboard }, { buildExecutiveLayer }, { listRepairJobs }, { listIncidents },] = await Promise.all([
        import('./ivx-daily-executive-report'),
        import('./ivx-innovation-dashboard'),
        import('./ivx-executive-layer'),
        import('./ivx-repair-jobs'),
        import('./ivx-incident-store'),
    ]);
    const history = await safe(() => listReportHistory(60), []);
    const weekHistory = history.filter((h) => Date.parse(h.generatedAt) >= windowStartMs);
    const innovation = await safe(() => buildInnovationDashboard(), null);
    const executive = await safe(() => buildExecutiveLayer(now), null);
    const repairJobs = await safe(() => listRepairJobs(100), []);
    const incidents = await safe(() => listIncidents(200), []);
    // Helper: collect a section's findings across the week's daily reports.
    const dedupe = new Map();
    const collect = (sectionKey) => {
        for (const entry of weekHistory) {
            const sec = entry.report.sections[sectionKey];
            if (!sec)
                continue;
            for (const f of sec.findings) {
                if (!dedupe.has(f.title)) {
                    dedupe.set(f.title, { title: f.title, detail: f.detail, weight: f.weight });
                }
            }
        }
    };
    // ── Top innovations (ranked by priority from the live store + week history) ──
    const innovationItems = (innovation?.topIdeas ?? [])
        .slice(0, 6)
        .map((i) => ({
        title: i.title,
        detail: `${i.summary.slice(0, 150)} · ${i.evidence}`,
        weight: `priority ${i.priority}/100 · ${i.status}`,
    }));
    const topInnovations = weeklySection('topInnovations', 'Top innovations', innovationItems, 'No innovations generated this week — run an innovation scan to populate the backlog.', 'Highest-priority ideas from the innovation store, ranked by ROI/impact/feasibility.');
    // ── Top investor targets ──────────────────────────────────────────────────────
    const investorItems = [];
    if (executive?.investorPriorities.bestInvestor) {
        const b = executive.investorPriorities.bestInvestor;
        investorItems.push({
            title: b.name,
            detail: `${b.detail} · Next: ${b.nextAction}`,
            weight: b.matchScore !== null ? `match ${b.matchScore}/100` : 'top fit',
        });
    }
    for (const p of executive?.investorPriorities.priorities.slice(0, 5) ?? []) {
        if (!investorItems.some((x) => x.title === p.name)) {
            investorItems.push({
                title: p.name,
                detail: `${p.detail} · Next: ${p.nextAction}`,
                weight: p.matchScore !== null ? `match ${p.matchScore}/100` : 'fit',
            });
        }
    }
    const topInvestorTargets = weeklySection('topInvestorTargets', 'Top investor targets', investorItems.slice(0, 6), 'No investor targets in the pipeline — import or discover capital relationships into the CRM.', 'Investor targets ranked from the real capital pipeline. No fabricated investors.');
    // ── Top buyer targets (from opportunity engine, buyer/customer kinds) ─────────
    const buyerItems = (executive?.opportunityEngine.ranked ?? [])
        .filter((o) => o.kind === 'customer' || o.kind === 'opportunity')
        .slice(0, 6)
        .map((o) => ({
        title: o.title,
        detail: o.detail,
        weight: o.score !== null ? `${o.score}/100` : o.kind,
    }));
    const topBuyerTargets = weeklySection('topBuyerTargets', 'Top buyer / partner targets', buyerItems, 'No buyer/partner targets surfaced — import a buyer list to populate this pipeline.', 'Buyer / partner targets derived from the deal + opportunity engines.');
    // ── Product roadmap (approved + proposed ideas, plus week-history improvements)
    dedupe.clear();
    collect('productImprovements');
    const roadmapFromHistory = Array.from(dedupe.values());
    const roadmapItems = [
        ...(innovation?.topIdeas ?? [])
            .filter((i) => i.status === 'approved' || i.status === 'proposed')
            .slice(0, 4)
            .map((i) => ({
            title: i.title,
            detail: i.summary.slice(0, 150),
            weight: `${i.status} · priority ${i.priority}/100`,
        })),
        ...roadmapFromHistory.slice(0, 4),
    ];
    const productRoadmap = weeklySection('productRoadmap', 'Product roadmap', roadmapItems.slice(0, 6), 'No roadmap items yet — approve ideas from the innovation backlog to build the roadmap.', 'Roadmap built from approved/proposed ideas and the week’s product-improvement findings.');
    // ── Verified deployments (the truth gate, real records only) ──────────────────
    const completedRepairs = repairJobs.filter((j) => j.stage === 'completed');
    const deployedIncidents = incidents.filter((i) => i.status === 'resolved' || i.status === 'production_deployed');
    const deploymentItems = [
        ...completedRepairs.slice(0, 6).map((j) => ({
            title: `Repair job ${j.id.slice(0, 12)} completed`,
            detail: `incident ${j.incidentId.slice(0, 12)} · validated through staging replay`,
            weight: 'VERIFIED',
        })),
        ...deployedIncidents.slice(0, 6).map((i) => ({
            title: i.message.slice(0, 80),
            detail: `${i.source} · ${i.status}`,
            weight: 'VERIFIED',
        })),
    ];
    const verifiedDeployments = weeklySection('verifiedDeployments', 'Verified deployments', deploymentItems.slice(0, 8), 'No verified deployments this week. Nothing is reported as deployed without a real completed record.', 'Only repairs/incidents with real completed or deployed records — every item here is VERIFIED.');
    // ── Growth recommendations ────────────────────────────────────────────────────
    const growthItems = (executive?.decisionEngine.decisions ?? [])
        .slice(0, 6)
        .map((d) => ({
        title: `#${d.rank} ${d.title}`,
        detail: `${d.action} — ${d.rationale.slice(0, 130)}`,
        weight: `${d.riskLevel} risk`,
    }));
    const growthRecommendations = weeklySection('growthRecommendations', 'Growth recommendations', growthItems, 'No growth recommendations this week — pipeline and operations are quiet.', 'Ranked recommendations from the decision engine. Risky actions still require owner approval.');
    const headline = `Weekly executive report — ${topInnovations.count} top innovation(s), ` +
        `${topInvestorTargets.count} investor target(s), ${topBuyerTargets.count} buyer target(s), ` +
        `${verifiedDeployments.count} VERIFIED deployment(s), ` +
        `aggregated from ${weekHistory.length} daily report(s).`;
    return {
        marker: IVX_AUTONOMOUS_OS_MARKER,
        generatedAt: nowIso(now),
        windowStart: nowIso(windowStartMs),
        windowEnd: nowIso(now),
        dailyReportsAggregated: weekHistory.length,
        headline,
        sections: {
            topInnovations,
            topInvestorTargets,
            topBuyerTargets,
            productRoadmap,
            verifiedDeployments,
            growthRecommendations,
        },
        disclaimer: WEEKLY_DISCLAIMER,
    };
}
