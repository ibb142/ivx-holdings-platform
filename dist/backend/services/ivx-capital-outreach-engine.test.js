/**
 * Tests for the BLOCK 18 Capital Outreach Intelligence engine.
 * Pure + deterministic over scored prospect profiles — no I/O, no AI.
 */
import { describe, expect, it } from 'bun:test';
import { buildCapitalOutreachPlan, outreachPriority, primaryChannel, IVX_CAPITAL_OUTREACH_MARKER, } from './ivx-capital-outreach-engine';
function makeProspect(overrides) {
    const scores = overrides.scores ?? { confidence: 80, relevance: 90, dealFit: 85 };
    return {
        id: overrides.id ?? `prospect-${overrides.type}-${overrides.segment}`,
        type: overrides.type,
        segment: overrides.segment,
        companyType: overrides.companyType ?? 'Test company type',
        market: overrides.market ?? 'Pembroke Pines, FL',
        investmentFocus: overrides.investmentFocus ?? 'Test focus',
        publicSource: overrides.publicSource ?? 'Channel A · Channel B · Channel C',
        scores,
        overall: overrides.overall ?? 88,
        rationale: overrides.rationale ?? 'Because it fits Casa Rosario.',
        evidence: overrides.evidence ?? 'Grounded in live jv_deals "Casa Rosario".',
        signal: overrides.signal ?? 'Strong demand signal.',
        risks: overrides.risks ?? ['Some risk.'],
        nextAction: overrides.nextAction ?? 'Do the next thing.',
        matchedDealNames: overrides.matchedDealNames ?? ['Casa Rosario'],
        complianceNote: overrides.complianceNote ?? 'Compliance note.',
        status: overrides.status ?? 'new',
        createdAt: overrides.createdAt ?? '2026-05-31T00:00:00.000Z',
        updatedAt: overrides.updatedAt ?? '2026-05-31T00:00:00.000Z',
    };
}
describe('outreachPriority', () => {
    it('maps evidence-based overall scores to priority bands', () => {
        expect(outreachPriority(90)).toBe('high');
        expect(outreachPriority(85)).toBe('high');
        expect(outreachPriority(70)).toBe('medium');
        expect(outreachPriority(64)).toBe('low');
        expect(outreachPriority(0)).toBe('low');
    });
});
describe('primaryChannel', () => {
    it('returns the first channel from a separated public-source string', () => {
        expect(primaryChannel('SEC Form D filers · podcasts · databases')).toBe('SEC Form D filers');
        expect(primaryChannel('Single channel')).toBe('Single channel');
    });
});
describe('buildCapitalOutreachPlan', () => {
    it('returns a no-prospects plan with an honest headline when empty', () => {
        const plan = buildCapitalOutreachPlan([]);
        expect(plan.marker).toBe(IVX_CAPITAL_OUTREACH_MARKER);
        expect(plan.readiness).toBe('no-prospects');
        expect(plan.totalProspects).toBe(0);
        expect(plan.outreachStrategies).toHaveLength(0);
        expect(plan.brokerIntroductions).toHaveLength(0);
        expect(plan.partnershipTargets).toHaveLength(0);
        expect(plan.thirtyDayPlan).toHaveLength(4);
        expect(plan.headline.toLowerCase()).toContain('no scored prospects');
    });
    it('excludes dismissed prospects and ranks strategies by overall (desc)', () => {
        const prospects = [
            makeProspect({ type: 'investor', segment: 'Syndicator', overall: 94 }),
            makeProspect({ type: 'buyer', segment: 'Dismissed buyer', overall: 99, status: 'dismissed' }),
            makeProspect({ type: 'partner', segment: 'Brokerage', overall: 80 }),
        ];
        const plan = buildCapitalOutreachPlan(prospects);
        expect(plan.totalProspects).toBe(2);
        expect(plan.outreachStrategies.map((s) => s.segment)).toEqual(['Syndicator', 'Brokerage']);
        expect(plan.outreachStrategies.every((s) => s.segment !== 'Dismissed buyer')).toBe(true);
    });
    it('builds a four-step sequence per strategy anchored on the prospect channel + next action', () => {
        const plan = buildCapitalOutreachPlan([
            makeProspect({
                type: 'investor',
                segment: 'Family office',
                publicSource: 'Family-office directories · conferences',
                nextAction: 'Prepare an institutional one-pager.',
            }),
        ]);
        const strategy = plan.outreachStrategies[0];
        expect(strategy.primaryChannel).toBe('Family-office directories');
        expect(strategy.steps).toHaveLength(4);
        expect(strategy.steps[0].order).toBe(1);
        expect(strategy.steps[1].action).toContain('Prepare an institutional one-pager.');
        expect(strategy.steps.every((s) => s.channel === 'Family-office directories')).toBe(true);
    });
    it('recommends required securities + proforma packet items when capital-side prospects exist', () => {
        const plan = buildCapitalOutreachPlan([
            makeProspect({ type: 'investor', segment: 'Syndicator / fund GP' }),
            makeProspect({ type: 'partner', segment: 'Capital raiser / placement agent' }),
        ]);
        const items = plan.investorPacket.map((i) => i.item);
        expect(items).toContain('Underwriting proforma (NOI / ROI / IRR)');
        expect(items).toContain('Offering structure & accreditation summary (Reg D)');
        expect(items).toContain('Deal one-pager (per published IVX deal)');
        // proforma is required, not optional, when capital-side prospects exist
        const proforma = plan.investorPacket.find((i) => i.item.startsWith('Underwriting proforma'));
        expect(proforma.priority).toBe('required');
        expect(proforma.forSegments.length).toBeGreaterThan(0);
    });
    it('adds AML/FIRPTA packet only when an international buyer segment is present', () => {
        const withIntl = buildCapitalOutreachPlan([
            makeProspect({ type: 'buyer', segment: 'International luxury buyer (LatAm / EU / Canada)' }),
        ]);
        expect(withIntl.investorPacket.some((i) => i.item.includes('FIRPTA'))).toBe(true);
        const withoutIntl = buildCapitalOutreachPlan([
            makeProspect({ type: 'buyer', segment: 'South Florida second-home buyer' }),
        ]);
        expect(withoutIntl.investorPacket.some((i) => i.item.includes('FIRPTA'))).toBe(false);
    });
    it('derives broker introductions only from partner channels and ranks partnership targets', () => {
        const plan = buildCapitalOutreachPlan([
            makeProspect({ type: 'partner', segment: 'Luxury brokerage / referral partner', overall: 88 }),
            makeProspect({ type: 'partner', segment: 'Private credit / bridge lender (CRE)', overall: 92 }),
            makeProspect({ type: 'buyer', segment: 'Accredited fractional-ownership buyer', overall: 95 }),
        ]);
        // brokerage + lender are partner channels; the buyer is not a broker intro
        expect(plan.brokerIntroductions.map((b) => b.segment)).toEqual([
            'Private credit / bridge lender (CRE)',
            'Luxury brokerage / referral partner',
        ]);
        expect(plan.partnershipTargets[0].segment).toBe('Private credit / bridge lender (CRE)');
        expect(plan.partnershipTargets.every((t) => t.overall <= 100)).toBe(true);
    });
    it('produces a 30-day plan in four windows with targets drawn from the real ranking', () => {
        const plan = buildCapitalOutreachPlan([
            makeProspect({ type: 'investor', segment: 'Syndicator', overall: 94 }),
            makeProspect({ type: 'buyer', segment: 'Intl buyer', overall: 90 }),
            makeProspect({ type: 'partner', segment: 'Brokerage', overall: 88 }),
            makeProspect({ type: 'developer', segment: 'Redevelopment group', overall: 70 }),
        ]);
        expect(plan.readiness).toBe('ready');
        expect(plan.thirtyDayPlan).toHaveLength(4);
        expect(plan.thirtyDayPlan[0].window).toContain('Days 1–7');
        expect(plan.thirtyDayPlan[0].targets).toContain('Syndicator');
        expect(plan.thirtyDayPlan.every((p) => p.actions.length > 0)).toBe(true);
        expect(plan.disclaimer.toLowerCase()).toContain('no fabricated individuals');
    });
});
