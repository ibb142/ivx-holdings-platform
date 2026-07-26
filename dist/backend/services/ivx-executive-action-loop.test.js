/**
 * Tests for the IVX Executive Action Loop + Outcome Tracking (BLOCK 39).
 *
 * Pure derivations (KPI impact, learning, summary) need no I/O. The durable
 * lifecycle test runs a full recommendation → execution → outcome cycle and
 * proves the loop persists + re-hydrates across a fresh read, then cleans up via
 * a category isolated by a unique suffix so the learning report is asserted only
 * over this test's records.
 */
import { describe, expect, test } from 'bun:test';
import { IVX_ACTION_LOOP_MARKER, validateRecommendation, computeKpiImpact, deriveLearning, summarizeActionLoopRecords, recordRecommendation, recordExecution, recordOutcome, getActionLoop, learnFromOutcomes, } from './ivx-executive-action-loop';
function uniqueSuffix() {
    return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function loop(partial) {
    return {
        id: partial.id ?? 'loop',
        stage: partial.stage ?? 'recommended',
        recommendation: partial.recommendation ?? {
            title: 'X',
            action: 'do X',
            rationale: '',
            category: 'general',
            estimatedImpact: '',
            estimatedImpactUsd: null,
            riskLevel: 'medium',
        },
        execution: partial.execution ?? null,
        outcome: partial.outcome ?? null,
        source: partial.source ?? 'executive_layer',
        decisionMemoryId: partial.decisionMemoryId ?? null,
        executionMemoryId: partial.executionMemoryId ?? null,
        outcomeMemoryId: partial.outcomeMemoryId ?? null,
        createdAt: partial.createdAt ?? '2026-06-02T00:00:00.000Z',
        updatedAt: partial.updatedAt ?? '2026-06-02T00:00:00.000Z',
    };
}
function outcomeLoop(category, result, kpiImpact) {
    return loop({
        recommendation: {
            title: `${category}-${result}`,
            action: 'a',
            rationale: '',
            category,
            estimatedImpact: '',
            estimatedImpactUsd: null,
            riskLevel: 'low',
        },
        stage: 'outcome_recorded',
        outcome: {
            result,
            kpi: 'kpi',
            kpiBefore: null,
            kpiAfter: null,
            kpiImpact,
            lessonsLearned: result === 'failure' ? ['try a warmer intro'] : [],
            recordedAt: '2026-06-02T00:00:00.000Z',
        },
    });
}
describe('validateRecommendation', () => {
    test('requires title + action', () => {
        expect(validateRecommendation({ title: '', action: 'x' }).ok).toBe(false);
        expect(validateRecommendation({ title: 'x', action: '' }).ok).toBe(false);
        expect(validateRecommendation({ title: 'x', action: 'y' }).ok).toBe(true);
    });
});
describe('computeKpiImpact', () => {
    test('delta when both known, null otherwise', () => {
        expect(computeKpiImpact(100, 130)).toBe(30);
        expect(computeKpiImpact(null, 130)).toBeNull();
        expect(computeKpiImpact(100, null)).toBeNull();
    });
});
describe('deriveLearning', () => {
    test('no outcomes → unproven, never a success claim', () => {
        const report = deriveLearning([loop({ recommendation: { title: 't', action: 'a', rationale: '', category: 'capital', estimatedImpact: '', estimatedImpactUsd: null, riskLevel: 'low' } })]);
        expect(report.marker).toBe(IVX_ACTION_LOOP_MARKER);
        const capital = report.categories.find((c) => c.category === 'capital');
        expect(capital?.withOutcome).toBe(0);
        expect(capital?.successRate).toBeNull();
        expect(capital?.improvedRecommendation).toContain('No outcomes recorded yet');
    });
    test('high success rate recommends more of it', () => {
        const report = deriveLearning([
            outcomeLoop('outreach', 'success', 10),
            outcomeLoop('outreach', 'success', 20),
            outcomeLoop('outreach', 'failure', null),
        ]);
        const outreach = report.categories.find((c) => c.category === 'outreach');
        expect(outreach?.successes).toBe(2);
        expect(outreach?.failures).toBe(1);
        expect(outreach?.successRate).toBeCloseTo(0.667, 2);
        expect(outreach?.avgKpiImpact).toBe(15);
        expect(outreach?.improvedRecommendation).toContain('working');
    });
    test('low success rate recommends changing the approach + surfaces lessons', () => {
        const report = deriveLearning([
            outcomeLoop('cold_email', 'failure', null),
            outcomeLoop('cold_email', 'failure', null),
            outcomeLoop('cold_email', 'success', 5),
        ]);
        const cat = report.categories.find((c) => c.category === 'cold_email');
        expect(cat?.improvedRecommendation).toContain('underperforming');
        expect(cat?.lessonsLearned).toContain('try a warmer intro');
    });
});
describe('summarizeActionLoopRecords', () => {
    test('rolls up stages + success rate', () => {
        const summary = summarizeActionLoopRecords([
            outcomeLoop('a', 'success', 1),
            outcomeLoop('a', 'failure', null),
            loop({ stage: 'recommended' }),
        ]);
        expect(summary.total).toBe(3);
        expect(summary.byStage.outcome_recorded).toBe(2);
        expect(summary.byStage.recommended).toBe(1);
        expect(summary.withOutcome).toBe(2);
        expect(summary.successRate).toBe(0.5);
    });
});
describe('durable lifecycle (cross-session)', () => {
    test('recommend → execute → outcome → learn', async () => {
        const category = `block39cat_${uniqueSuffix()}`;
        const created = await recordRecommendation({
            title: `Engage syndicator ${uniqueSuffix()}`,
            action: 'Send the owner-approved intro and book a meeting.',
            rationale: 'Highest-fit capital source.',
            category,
            estimatedImpactUsd: 250000,
            riskLevel: 'medium',
            source: 'executive_layer',
        });
        expect(created.ok).toBe(true);
        if (!created.ok)
            return;
        const id = created.loop.id;
        expect(created.loop.stage).toBe('recommended');
        expect(created.loop.recommendation.category).toBe(category);
        expect(created.loop.decisionMemoryId).not.toBeNull();
        const executed = await recordExecution(id, { status: 'executed', detail: 'Intro sent; meeting booked.' });
        expect(executed?.stage).toBe('executed');
        expect(executed?.execution?.status).toBe('executed');
        expect(executed?.execution?.executedAt).not.toBeNull();
        const withOutcome = await recordOutcome(id, {
            result: 'success',
            kpi: 'weighted pipeline',
            kpiBefore: 100000,
            kpiAfter: 350000,
            lessonsLearned: ['warm intros convert faster'],
        });
        expect(withOutcome?.stage).toBe('outcome_recorded');
        expect(withOutcome?.outcome?.result).toBe('success');
        expect(withOutcome?.outcome?.kpiImpact).toBe(250000);
        expect(withOutcome?.outcomeMemoryId).not.toBeNull();
        // Fresh read re-hydrates the full lifecycle (cross-session proof).
        const rehydrated = await getActionLoop(id);
        expect(rehydrated?.outcome?.kpiImpact).toBe(250000);
        // Learning derives this category from the recorded outcome only.
        const report = await learnFromOutcomes();
        const cat = report.categories.find((c) => c.category === category);
        expect(cat).toBeDefined();
        expect(cat?.withOutcome).toBe(1);
        expect(cat?.successes).toBe(1);
        expect(cat?.avgKpiImpact).toBe(250000);
        expect(cat?.improvedRecommendation).toContain('working');
    });
});
