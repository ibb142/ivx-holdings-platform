import { describe, expect, it } from 'bun:test';
import { buildCapitalPipeline, buildCeoBriefing, buildImprovementOutcomes, buildOpportunitiesFound, buildPriorityTasks, buildRevenuePotential, buildScorecard, buildTimeSaved, countWithinWindow, HOURS_SAVED_PER_AUTOMATED_TASK, HOURS_SAVED_PER_RESEARCH_ARTIFACT, } from './ivx-business-impact';
import { computeOverallScore } from './ivx-opportunity-store';
const NOW = Date.parse('2026-05-30T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
function makeOpportunity(overrides = {}) {
    const scores = { evidence: 80, risk: 70, speed: 60, capital: 90, upside: 85 };
    return {
        id: 'opp-1',
        title: 'Test opportunity',
        summary: 'x',
        category: 'real_estate',
        capitalRequiredUsd: 50,
        upsideLowUsd: 100,
        upsideHighUsd: 200,
        timeline: '~18 months',
        scores,
        overall: computeOverallScore(scores),
        confidence: 80,
        evidence: 'x',
        evidenceLinks: [],
        riskWarnings: [],
        legalWarning: 'x',
        nextActions: [],
        profitLadder: [],
        executionPlan: {
            actionPlan: [], contacts: [], documentsNeeded: [], fundingPath: '', expectedUpside: '', worstCaseRisk: '', nextThreeActions: [],
        },
        status: 'new',
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
        ...overrides,
    };
}
function makeInnovation(overrides = {}) {
    return {
        marker: 'm',
        generatedAt: new Date(NOW).toISOString(),
        inventions: { proposed: 2, approved: 1, rejected: 0, shipped: 1, total: 4 },
        experiments: { planned: 0, running: 1, completed: 3, abandoned: 0, total: 4 },
        hypotheses: { open: 0, testing: 0, validated: 0, invalidated: 0, total: 0 },
        estimatedBusinessValueUsd: 100_000,
        topIdeas: [],
        ...overrides,
    };
}
function makeTask(overrides = {}) {
    return {
        id: 'task-1',
        ownerCommand: 'Improve IVX today',
        originalTask: 'Improve IVX today',
        status: 'completed',
        createdAt: new Date(NOW - HOUR).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
        completedAt: new Date(NOW).toISOString(),
        currentBlockIndex: 3,
        currentBlockId: null,
        totalBlocks: 3,
        completedBlockIds: ['a', 'b', 'c'],
        failedBlockIds: [],
        blockedBlockIds: [],
        deploymentStatus: null,
        error: null,
        lastCrash: null,
        recoveryCount: 0,
        ...overrides,
    };
}
function makeIncident(overrides = {}) {
    return {
        id: 'inc-1',
        traceId: null,
        userId: null,
        conversationId: null,
        source: 'backend',
        checkpoint: null,
        fileLine: null,
        message: 'Something failed',
        stack: null,
        requestBodyPreview: null,
        responseStatus: null,
        environment: 'production',
        buildId: null,
        suggestedFix: null,
        severity: 'warning',
        status: 'resolved',
        diagnosis: null,
        approval: null,
        lifecycle: [],
        createdAt: new Date(NOW).toISOString(),
        updatedAt: new Date(NOW).toISOString(),
        ...overrides,
    };
}
describe('countWithinWindow', () => {
    it('counts only items inside the window', () => {
        const items = [
            { at: new Date(NOW - HOUR).toISOString() },
            { at: new Date(NOW - 2 * DAY).toISOString() },
            { at: new Date(NOW - 40 * DAY).toISOString() },
        ];
        expect(countWithinWindow(items, (i) => i.at, DAY, NOW)).toBe(1);
        expect(countWithinWindow(items, (i) => i.at, 7 * DAY, NOW)).toBe(2);
        expect(countWithinWindow(items, (i) => i.at, 60 * DAY, NOW)).toBe(3);
    });
    it('ignores unparseable timestamps', () => {
        const items = [{ at: 'not-a-date' }, { at: null }];
        expect(countWithinWindow(items, (i) => i.at, DAY, NOW)).toBe(0);
    });
});
describe('buildOpportunitiesFound', () => {
    it('buckets opportunities by created-at window', () => {
        const opps = [
            makeOpportunity({ id: 'a', createdAt: new Date(NOW - HOUR).toISOString() }),
            makeOpportunity({ id: 'b', createdAt: new Date(NOW - 3 * DAY).toISOString() }),
            makeOpportunity({ id: 'c', createdAt: new Date(NOW - 45 * DAY).toISOString() }),
        ];
        const found = buildOpportunitiesFound(opps, NOW);
        expect(found.today).toBe(1);
        expect(found.week).toBe(2);
        expect(found.month).toBe(2);
    });
});
describe('buildCapitalPipeline', () => {
    it('maps categories to pipeline signals and excludes closed/dismissed', () => {
        const opps = [
            makeOpportunity({ id: '1', category: 'investor' }),
            makeOpportunity({ id: '2', category: 'partnership' }),
            makeOpportunity({ id: '3', category: 'financing' }),
            makeOpportunity({ id: '4', category: 'real_estate' }),
            makeOpportunity({ id: '5', category: 'distressed_asset' }),
            makeOpportunity({ id: '6', category: 'investor', status: 'dismissed' }),
        ];
        const pipeline = buildCapitalPipeline(opps);
        expect(pipeline.investorsDiscovered).toBe(1);
        expect(pipeline.partnersDiscovered).toBe(1);
        expect(pipeline.lendersDiscovered).toBe(1);
        expect(pipeline.buyersDiscovered).toBe(2);
    });
});
describe('buildRevenuePotential', () => {
    it('sums evidenced upside and never invents unknown values', () => {
        const opps = [
            makeOpportunity({ id: '1', upsideLowUsd: 100, upsideHighUsd: 200, status: 'pursuing' }),
            makeOpportunity({ id: '2', upsideLowUsd: null, upsideHighUsd: null, status: 'watching' }),
            makeOpportunity({ id: '3', upsideLowUsd: 50, upsideHighUsd: 300, status: 'closed' }),
        ];
        const revenue = buildRevenuePotential(opps);
        // closed excluded from value; null stays 0 (never invented).
        expect(revenue.estimatedOpportunityValueUsd).toBe(200);
        expect(revenue.capitalReachableUsd).toBe(100);
        expect(revenue.dealsInProgress).toBe(2);
    });
});
describe('buildImprovementOutcomes', () => {
    it('counts resolved incidents, repair jobs, completed tasks, and prevented issues', () => {
        const incidents = [
            makeIncident({ id: 'i1', status: 'resolved', severity: 'warning' }),
            makeIncident({ id: 'i2', status: 'production_deployed', severity: 'critical' }),
            makeIncident({ id: 'i3', status: 'open', severity: 'error' }),
        ];
        const repairJobs = [
            { id: 'rj1', incidentId: 'i1', stage: 'completed', classification: 'low', steps: [], proposalArtifactPath: null, finalReport: null, error: null, createdAt: '', updatedAt: '' },
        ];
        const tasks = [makeTask({ id: 't1', status: 'completed' }), makeTask({ id: 't2', status: 'running' })];
        const outcomes = buildImprovementOutcomes(incidents, repairJobs, tasks);
        expect(outcomes.bugsFixed).toBe(3); // 2 resolved incidents + 1 repair job
        expect(outcomes.deploymentsCompleted).toBe(1); // 1 completed task
        expect(outcomes.productionIssuesPrevented).toBe(1); // only the non-critical resolved one
    });
});
describe('buildTimeSaved', () => {
    it('uses transparent per-unit constants', () => {
        const tasks = [makeTask({ id: 't1', status: 'completed' }), makeTask({ id: 't2', status: 'completed' })];
        const innovation = makeInnovation();
        const saved = buildTimeSaved(tasks, innovation, 5);
        const expectedTasks = 2 + innovation.experiments.completed; // 2 + 3
        const expectedResearch = innovation.inventions.total + 5; // 4 + 5
        expect(saved.tasksAutomated).toBe(expectedTasks);
        expect(saved.researchAutomated).toBe(expectedResearch);
        expect(saved.hoursSaved).toBe(Math.round(expectedTasks * HOURS_SAVED_PER_AUTOMATED_TASK + expectedResearch * HOURS_SAVED_PER_RESEARCH_ARTIFACT));
    });
});
describe('buildCeoBriefing', () => {
    it('selects the best opportunity per category and surfaces unresolved risk', () => {
        const opps = [
            makeOpportunity({ id: 'top', title: 'Top deal', category: 'real_estate', scores: { evidence: 90, risk: 90, speed: 90, capital: 90, upside: 95 }, overall: 95 }),
            makeOpportunity({ id: 'inv', title: 'Investor pool', category: 'investor' }),
            makeOpportunity({ id: 'part', title: 'Broker partnership', category: 'partnership' }),
        ];
        const incidents = [makeIncident({ id: 'open1', status: 'open', severity: 'critical', message: 'DB down' })];
        const briefing = buildCeoBriefing(opps, incidents, [makeTask()], makeInnovation(), NOW);
        expect(briefing.topOpportunity?.refId).toBe('top');
        expect(briefing.topInvestor?.refId).toBe('inv');
        expect(briefing.topPartnership?.refId).toBe('part');
        expect(briefing.topRisk?.title).toContain('critical');
        expect(briefing.topImprovement?.title).toBe('Improve IVX today');
    });
    it('returns null picks when no opportunities exist', () => {
        const briefing = buildCeoBriefing([], [], [], makeInnovation({ topIdeas: [] }), NOW);
        expect(briefing.topOpportunity).toBeNull();
        expect(briefing.topInvestor).toBeNull();
    });
});
describe('buildPriorityTasks', () => {
    it('puts risk first, then revenue, then improvement', () => {
        const opps = [makeOpportunity({ id: 'rev', title: 'Revenue deal', upsideHighUsd: 500 })];
        const incidents = [makeIncident({ id: 'open1', status: 'open', severity: 'error', message: 'route 500' })];
        const briefing = buildCeoBriefing(opps, incidents, [makeTask()], makeInnovation(), NOW);
        const tasks = buildPriorityTasks(briefing);
        expect(tasks).toHaveLength(3);
        expect(tasks[0].priority).toBe(1);
        expect(tasks[0].source).toBe('risk');
        expect(tasks[1].priority).toBe(2);
        expect(tasks[2].priority).toBe(3);
    });
});
describe('buildScorecard', () => {
    it('never promises guaranteed profit', () => {
        const opps = [makeOpportunity({ upsideHighUsd: 1000 })];
        const briefing = buildCeoBriefing(opps, [], [], makeInnovation(), NOW);
        const found = buildOpportunitiesFound(opps, NOW);
        const improvements = buildImprovementOutcomes([], [], [makeTask()]);
        const revenue = buildRevenuePotential(opps);
        const scorecard = buildScorecard(found, improvements, makeInnovation(), revenue, briefing, NOW);
        expect(scorecard.expectedImpact).toContain('not guaranteed');
        expect(scorecard.discovered).toContain('today');
    });
});
