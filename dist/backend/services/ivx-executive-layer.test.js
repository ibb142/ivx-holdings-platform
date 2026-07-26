import { describe, expect, it } from 'bun:test';
import { buildDailyBriefing, buildStrategicPlan, buildOpportunityEngineView, buildDecisionEngineView, buildExecutionTracking, buildExecutiveScorecards, buildInvestorPriorities, buildDealPipelineView, buildAutonomousActionsView, buildLearningSummaryView, IVX_EXECUTIVE_LAYER_MARKER, } from './ivx-executive-layer';
function makeScheduler(overrides = {}) {
    const base = {
        marker: 'ivx-autonomous-scheduler-2026-06-02',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        enabled: true,
        jobs: {
            daily_self_audit: {
                kind: 'daily_self_audit',
                intervalMs: 86400000,
                lastRunAt: new Date().toISOString(),
                nextDueAt: new Date(Date.now() + 86400000).toISOString(),
                lastStatus: 'ok',
                lastDurationMs: 120,
                lastSummary: 'Self-audit a1: 3 proposal(s), 1 safe.',
                runCount: 4,
                failureCount: 0,
            },
            daily_enterprise_os: {
                kind: 'daily_enterprise_os',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_drift_detection: {
                kind: 'daily_drift_detection',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_executive_report: {
                kind: 'daily_executive_report',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_buyer_engine: {
                kind: 'daily_buyer_engine',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_investor_engine: {
                kind: 'daily_investor_engine',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_jv_engine: {
                kind: 'daily_jv_engine',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_tokenized_buyer_engine: {
                kind: 'daily_tokenized_buyer_engine',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_technology_ideas: {
                kind: 'daily_technology_ideas',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_capital_outreach: {
                kind: 'daily_capital_outreach',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
            daily_deploy_monitor: {
                kind: 'daily_deploy_monitor',
                intervalMs: 86400000,
                lastRunAt: null,
                nextDueAt: new Date().toISOString(),
                lastStatus: 'never',
                lastDurationMs: null,
                lastSummary: 'Not run yet.',
                runCount: 0,
                failureCount: 0,
            },
        },
    };
    return { ...base, ...overrides };
}
function makeLoopSummary(overrides = {}) {
    const base = {
        marker: 'ivx-executive-action-loop-2026-06-02',
        generatedAt: new Date().toISOString(),
        total: 5,
        byStage: { recommended: 1, executing: 0, executed: 1, outcome_recorded: 3 },
        withOutcome: 3,
        successes: 2,
        failures: 1,
        successRate: 0.667,
    };
    return { ...base, ...overrides };
}
function makeLearning(overrides = {}) {
    const base = {
        marker: 'ivx-executive-action-loop-2026-06-02',
        generatedAt: new Date().toISOString(),
        totalLoops: 5,
        categories: [
            {
                category: 'continuous_improvement',
                totalLoops: 4,
                withOutcome: 3,
                successes: 2,
                failures: 1,
                partials: 0,
                successRate: 0.667,
                avgKpiImpact: 1.5,
                lessonsLearned: ['Clean workspace.'],
                improvedRecommendation: '"continuous_improvement" is working (2/3 succeeded).',
            },
        ],
        note: 'Learning is derived only from recorded outcomes.',
    };
    return { ...base, ...overrides };
}
function makeImpact(overrides = {}) {
    const base = {
        marker: 'm',
        generatedAt: new Date().toISOString(),
        headline: 'h',
        opportunitiesFound: { today: 1, week: 3, month: 5 },
        capitalPipeline: { investorsDiscovered: 2, partnersDiscovered: 1, lendersDiscovered: 0, buyersDiscovered: 1, note: '' },
        revenuePotential: { estimatedOpportunityValueUsd: 1000000, capitalReachableUsd: 400000, dealsInProgress: 2, note: '' },
        improvements: { bugsFixed: 3, deploymentsCompleted: 2, productionIssuesPrevented: 1 },
        timeSaved: { hoursSaved: 10, tasksAutomated: 4, researchAutomated: 6, note: '' },
        ceoBriefing: {
            date: new Date().toISOString(),
            topOpportunity: { title: 'Top Opp', detail: 'detail', refId: 'o1' },
            topInvestor: { title: 'Inv', detail: 'd', refId: 'i1' },
            topBuyer: null,
            topRisk: { title: 'Open risk', detail: 'risk detail', refId: 'r1' },
            topImprovement: { title: 'Imp', detail: 'd', refId: null },
            topRevenueOpportunity: { title: 'Rev Opp', detail: 'd', refId: 'o2' },
            topPartnership: null,
        },
        scorecard: { date: '', discovered: '', improved: '', learned: '', recommends: '', expectedImpact: '' },
        businessGoals: {
            activeDeals: 2,
            investorPipeline: 2,
            buyerPipeline: 1,
            opportunitiesDiscovered: 5,
            improvementsDeployed: 2,
            revenueOpportunities: 3,
            conversionMetrics: '',
            growthMetrics: '',
        },
        priorityTasks: [],
        ownerFeed: { yesterday: '', today: '', recommendsNext: '', workingOn: '', needsDecision: '' },
        disclaimer: 'd',
    };
    return { ...base, ...overrides };
}
function makeCommand(overrides = {}) {
    const base = {
        marker: 'm',
        generatedAt: new Date().toISOString(),
        bestInvestorToday: { contactId: 'c1', name: 'Jane GP', company: 'Fund', matchScore: 88, dealName: 'Casa Rosario', evidence: ['e1', 'e2'] },
        bestBuyerToday: { contactId: 'c2', name: 'Buyer Co', company: 'B', matchScore: 75, dealName: 'Casa Rosario', evidence: ['e1'] },
        bestOpportunityToday: { id: 'd1', name: 'Casa Rosario', weightedScore: 90, recommendation: 'BUY', rationale: 'strong' },
        capitalPipeline: {
            totalPipeline: 2000000,
            capitalCommitted: 500000,
            capitalRaised: 300000,
            weightedPipeline: 900000,
            activeInvestors: 3,
            activeBuyers: 2,
            dealsInProgress: 2,
        },
        meetingsNeeded: [{ id: 'm1', name: 'A', company: 'X', reason: 'r', dealName: 'D' }],
        followUpsNeeded: [{ id: 'f1', name: 'B', company: 'Y', reason: 'r', dealName: 'D' }],
        dealsAtRisk: [{ id: 'd2', name: 'Risky', company: 'Z', reason: '5 contacted, 0 responses', dealName: 'Risky' }],
        capitalRaisedThisMonth: 250000,
        headline: 'h',
        note: 'n',
    };
    return { ...base, ...overrides };
}
function makeAutonomous(overrides = {}) {
    const base = {
        marker: 'm',
        generatedAt: new Date().toISOString(),
        environment: { nodeEnv: 'production', mode: 'production', productionBaseUrlConfigured: true, databaseConfigured: true, githubConfigured: true, aiGatewayConfigured: true },
        buckets: { completed: 8, pending: 2, blocked: 0, failed: 0, verified: 6, unverified: 1 },
        priority: { totalOpen: 0, tierCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, items: [] },
        capabilities: [
            { id: 'a', title: 'A', state: 'online', backedBy: 'x', detail: 'd' },
            { id: 'b', title: 'B', state: 'online', backedBy: 'x', detail: 'd' },
            { id: 'c', title: 'C', state: 'partial', backedBy: 'x', detail: 'd' },
            { id: 'd', title: 'D', state: 'online', backedBy: 'x', detail: 'd' },
        ],
        subsystems: {
            auditJobs: { total: 0, active: 0, completed: 0, failed: 0 },
            auditItemSets: { total: 0, items: 0 },
            repairJobs: { total: 0, failed: 0, awaitingApproval: 0 },
            incidents: { total: 0, open: 0, resolved: 0 },
            codeIndex: { available: true },
            codeGraph: { available: true },
            continuous: { status: 'idle', passesRun: 0, lastReason: null, deadlineAt: null },
        },
    };
    return { ...base, ...overrides };
}
function makeTask(overrides = {}) {
    return {
        id: 't1',
        ownerCommand: 'Improve IVX today',
        originalTask: 'Improve IVX today',
        status: 'completed',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        currentBlockIndex: 0,
        currentBlockId: null,
        totalBlocks: 4,
        completedBlockIds: ['b1', 'b2', 'b3', 'b4'],
        failedBlockIds: [],
        blockedBlockIds: [],
        ...overrides,
    };
}
describe('ivx-executive-layer', () => {
    it('exposes a stable marker', () => {
        expect(IVX_EXECUTIVE_LAYER_MARKER).toBe('ivx-executive-layer-2026-06-02');
    });
    it('daily briefing keeps cash runway honest-unknown', () => {
        const b = buildDailyBriefing(makeImpact(), makeCommand(), makeAutonomous());
        expect(b.cashRunway.value).toBe('Unknown');
        expect(b.cashRunway.note).toMatch(/burn/i);
        expect(b.revenue.value).toContain('$');
        expect(b.crmPipeline.value).toContain('active');
    });
    it('daily briefing aggregates real open risks', () => {
        const b = buildDailyBriefing(makeImpact(), makeCommand(), makeAutonomous());
        expect(b.openRisks.count).toBeGreaterThan(0);
        expect(b.openRisks.items.some((i) => i.includes('Open risk'))).toBe(true);
        expect(b.openRisks.items.some((i) => i.includes('Risky'))).toBe(true);
    });
    it('daily briefing reports degraded health when incidents are open', () => {
        const auton = makeAutonomous({ subsystems: { ...makeAutonomous().subsystems, incidents: { total: 2, open: 2, resolved: 0 } } });
        const b = buildDailyBriefing(makeImpact(), makeCommand(), auton);
        expect(b.productHealth.value).toBe('Degraded');
    });
    it('strategic plan produces 30/90/yearly goals grounded in counts', () => {
        const plan = buildStrategicPlan(makeImpact(), makeCommand());
        expect(plan.thirtyDay.length).toBeGreaterThan(0);
        expect(plan.ninetyDay.length).toBeGreaterThan(0);
        expect(plan.yearly.length).toBeGreaterThan(0);
        expect(plan.thirtyDay[0]?.title).toContain('Jane GP');
    });
    it('opportunity engine ranks detected leads/investors/customers', () => {
        const view = buildOpportunityEngineView(makeImpact(), makeCommand());
        expect(view.ranked.length).toBeGreaterThan(0);
        expect(view.ranked[0]?.rank).toBe(1);
        expect(view.investors).toBeGreaterThan(0);
        expect(view.customers).toBeGreaterThan(0);
        expect(view.leads).toBe(2);
    });
    it('decision engine ranks risk-first with impact + risk level', () => {
        const view = buildDecisionEngineView(makeImpact(), makeCommand(), makeAutonomous());
        expect(view.decisions.length).toBeGreaterThan(0);
        expect(view.decisions[0]?.riskLevel).toBe('high');
        expect(view.decisions[0]?.title).toContain('Resolve');
    });
    it('execution tracking sums planned/executed/remaining from blocks', () => {
        const tracking = buildExecutionTracking([makeTask(), makeTask({ id: 't2', status: 'running', totalBlocks: 3, completedBlockIds: ['x1'] })]);
        expect(tracking.planned).toBe(7);
        expect(tracking.executed).toBe(5);
        expect(tracking.remaining).toBe(2);
        expect(tracking.inProgress).toBe(1);
        expect(tracking.recent.length).toBe(2);
    });
    it('execution tracking counts blocked/failed tasks', () => {
        const tracking = buildExecutionTracking([makeTask({ status: 'failed' })]);
        expect(tracking.blocked).toBe(1);
    });
    it('scorecards return grade + level + signals for all four quadrants', () => {
        const exec = buildExecutionTracking([makeTask()]);
        const cards = buildExecutiveScorecards(makeImpact(), makeCommand(), makeAutonomous(), exec);
        for (const card of [cards.company, cards.ai, cards.engineering, cards.capital]) {
            expect(card.score).toBeGreaterThanOrEqual(0);
            expect(card.score).toBeLessThanOrEqual(100);
            expect(['A', 'B', 'C', 'D', 'F']).toContain(card.grade);
            expect(['high', 'medium', 'low']).toContain(card.level);
            expect(card.signals.length).toBeGreaterThan(0);
        }
    });
    it('investor priorities rank best investor + meetings + follow-ups', () => {
        const view = buildInvestorPriorities(makeCommand());
        expect(view.bestInvestor?.name).toBe('Jane GP');
        expect(view.priorities[0]?.rank).toBe(1);
        expect(view.meetingsNeeded).toBe(1);
        expect(view.followUpsNeeded).toBe(1);
        expect(view.priorities.length).toBe(3);
    });
    it('investor priorities stay honest-empty with no command data', () => {
        const empty = makeCommand({ bestInvestorToday: null, meetingsNeeded: [], followUpsNeeded: [] });
        const view = buildInvestorPriorities(empty);
        expect(view.bestInvestor).toBeNull();
        expect(view.priorities.length).toBe(0);
        expect(view.note).toMatch(/no investor priorities/i);
    });
    it('deal pipeline reports formatted totals + deals at risk', () => {
        const view = buildDealPipelineView(makeCommand());
        expect(view.totalPipeline).toContain(',');
        expect(view.raisedThisMonth).toContain(',');
        expect(view.activeInvestors).toBe(3);
        expect(view.dealsInProgress).toBe(2);
        expect(view.dealsAtRisk[0]?.name).toBe('Risky');
    });
    it('autonomous actions summarize scheduler runs + loop totals', () => {
        const view = buildAutonomousActionsView(makeScheduler(), makeLoopSummary());
        expect(view.schedulerEnabled).toBe(true);
        expect(view.totalRuns).toBe(4);
        expect(view.loopsRun).toBe(5);
        expect(view.outcomesRecorded).toBe(3);
        expect(view.actions.length).toBe(Object.keys(makeScheduler().jobs).length);
        expect(view.actions.some((a) => a.label === 'Daily self-audit')).toBe(true);
    });
    it('autonomous actions stay honest before the first run', () => {
        const view = buildAutonomousActionsView(makeScheduler({
            jobs: {
                ...makeScheduler().jobs,
                daily_self_audit: { ...makeScheduler().jobs.daily_self_audit, runCount: 0, lastStatus: 'never' },
            },
        }), makeLoopSummary({ total: 0, withOutcome: 0 }));
        expect(view.totalRuns).toBe(0);
        expect(view.note).toMatch(/has not completed a run/i);
    });
    it('learning summary surfaces per-category improved recommendations', () => {
        const view = buildLearningSummaryView(makeLearning(), makeLoopSummary());
        expect(view.totalLoops).toBe(5);
        expect(view.outcomesRecorded).toBe(3);
        expect(view.overallSuccessRate).toBe(0.667);
        expect(view.categories[0]?.category).toBe('continuous_improvement');
        expect(view.categories[0]?.improvedRecommendation).toMatch(/working/i);
    });
    it('capital scorecard rewards pipeline + raised + relationships', () => {
        const exec = buildExecutionTracking([]);
        const strong = buildExecutiveScorecards(makeImpact(), makeCommand(), makeAutonomous(), exec).capital;
        const emptyCommand = makeCommand({
            capitalPipeline: { totalPipeline: 0, capitalCommitted: 0, capitalRaised: 0, weightedPipeline: 0, activeInvestors: 0, activeBuyers: 0, dealsInProgress: 0 },
            capitalRaisedThisMonth: 0,
            bestInvestorToday: null,
        });
        const weak = buildExecutiveScorecards(makeImpact(), emptyCommand, makeAutonomous(), exec).capital;
        expect(strong.score).toBeGreaterThan(weak.score);
    });
});
