import { describe, expect, it } from 'bun:test';
import { buildProspectActionPlan, buildProspectResearch, buildProspectOutreachDraft, classifyResearchChannel, outreachTypeForProspect, } from './ivx-capital-action-engine';
function makeProspect(overrides = {}) {
    return {
        id: 'prospect-1',
        type: 'investor',
        segment: 'Real-estate syndicator / fund GP',
        companyType: 'Syndicator / fund general partner',
        market: 'Pembroke Pines, FL',
        investmentFocus: 'Aggregating LP capital into larger RE positions',
        publicSource: 'SEC Form D (Reg D 506) filers · syndication communities · fund databases',
        scores: { confidence: 90, relevance: 88, dealFit: 94 },
        overall: 91,
        rationale: 'Selected because IVX deal "Casa Rosario" is a fractional real-estate deal.',
        evidence: 'Grounded in live jv_deals "Casa Rosario": price ~$1,400,000, 30% ROI.',
        signal: 'Fractional/JV structure with 30% stated ROI is co-syndication-ready.',
        risks: ['Securities compliance + LP disclosures required before pooling capital.'],
        nextAction: 'Approach a syndicator to co-raise on this position; agree on carry/fee split.',
        matchedDealNames: ['Casa Rosario'],
        complianceNote: 'High-probability prospect PROFILE (segment) — not a fabricated individual.',
        status: 'new',
        createdAt: '2026-06-03T00:00:00.000Z',
        updatedAt: '2026-06-03T00:00:00.000Z',
        ...overrides,
    };
}
describe('buildProspectActionPlan', () => {
    it('returns all six fields grounded in the prospect', () => {
        const plan = buildProspectActionPlan(makeProspect());
        expect(plan.prospectId).toBe('prospect-1');
        expect(plan.whyThisProspect).toContain('Casa Rosario');
        expect(plan.bestOutreachAngle.length).toBeGreaterThan(10);
        expect(plan.likelyObjections.length).toBeGreaterThanOrEqual(2);
        expect(plan.recommendedNextStep).toBe('Approach a syndicator to co-raise on this position; agree on carry/fee split.');
        expect(plan.confidenceScore).toBe(90);
    });
    it('flags securities compliance review for investor outreach', () => {
        const plan = buildProspectActionPlan(makeProspect({ type: 'investor' }));
        expect(plan.complianceWarning).toContain('COMPLIANCE REVIEW REQUIRED');
        expect(plan.complianceWarning.toLowerCase()).toContain('securities');
    });
    it('flags Fair Housing for buyers', () => {
        const plan = buildProspectActionPlan(makeProspect({ type: 'buyer' }));
        expect(plan.complianceWarning).toContain('Fair Housing');
    });
});
describe('classifyResearchChannel', () => {
    it('classifies SEC/registry channels as investor_portal', () => {
        expect(classifyResearchChannel('SEC Form D (Reg D 506) filers')).toBe('investor_portal');
        expect(classifyResearchChannel('NMLS-registered private lenders')).toBe('investor_portal');
    });
    it('classifies networks/communities as referral_network', () => {
        expect(classifyResearchChannel('syndication communities')).toBe('referral_network');
        expect(classifyResearchChannel('relocation/concierge networks')).toBe('referral_network');
    });
    it('falls back to public_website', () => {
        expect(classifyResearchChannel('Top South Florida luxury brokerages')).toBe('public_website');
    });
});
describe('buildProspectResearch', () => {
    it('splits the publicSource into labelled channels and never verifies a contact', () => {
        const research = buildProspectResearch(makeProspect());
        expect(research.channels.length).toBe(3);
        expect(research.channels.every((c) => c.verified === false)).toBe(true);
        expect(research.contactStatus).toBe('CONTACT_NOT_VERIFIED');
    });
    it('returns CONTACT_NOT_VERIFIED with an honest note when no channel exists', () => {
        const research = buildProspectResearch(makeProspect({ publicSource: '' }));
        expect(research.channels.length).toBe(0);
        expect(research.contactStatus).toBe('CONTACT_NOT_VERIFIED');
        expect(research.note).toContain('CONTACT_NOT_VERIFIED');
    });
});
describe('outreachTypeForProspect', () => {
    it('maps prospect types to outreach types', () => {
        expect(outreachTypeForProspect('investor')).toBe('investor_intro');
        expect(outreachTypeForProspect('buyer')).toBe('buyer_intro');
        expect(outreachTypeForProspect('developer')).toBe('meeting_request');
        expect(outreachTypeForProspect('partner')).toBe('investor_intro');
    });
});
describe('buildProspectOutreachDraft', () => {
    it('produces a subject, body, attachment placeholder and compliance disclaimer without inventing a recipient', () => {
        const draft = buildProspectOutreachDraft(makeProspect());
        expect(draft.subject.length).toBeGreaterThan(0);
        expect(draft.emailBody).toContain('IVX Holdings');
        expect(draft.emailBody).not.toContain('[NAME]');
        expect(draft.attachmentPlaceholder).toContain('Casa Rosario');
        expect(draft.complianceDisclaimer.toLowerCase()).toContain('not an offer');
        expect(draft.outreachType).toBe('investor_intro');
    });
    it('omits a cold one-liner for developers (email-led)', () => {
        const draft = buildProspectOutreachDraft(makeProspect({ type: 'developer' }));
        expect(draft.shortMessage).toBe('');
    });
});
