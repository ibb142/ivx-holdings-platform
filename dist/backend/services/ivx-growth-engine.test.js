import { describe, expect, it } from 'bun:test';
import { classifyOwnerGate, computeIdeaRank, draftJVDeal, draftModuleSpec, draftOutreachMessage, draftTokenization, generateIdeas, getGrowthEngineCapabilities, ownerApprovalRequiredActions, } from './ivx-growth-engine';
describe('OWNER_CONTROL_GATES (classifyOwnerGate)', () => {
    it('does NOT gate read/derive/draft actions', () => {
        for (const action of ['generate_idea', 'rank_ideas', 'discover_leads', 'draft_jv_deal', 'draft_tokenization', 'draft_app_module', 'draft_outreach']) {
            const decision = classifyOwnerGate(action);
            expect(decision.requiresOwnerApproval).toBe(false);
            expect(decision.categories).toHaveLength(0);
        }
    });
    it('gates money, contracts, securities, deployment, and outbound comms', () => {
        expect(classifyOwnerGate('send_outreach').categories).toContain('outbound_communication');
        expect(classifyOwnerGate('execute_securities_offering').categories).toContain('securities');
        expect(classifyOwnerGate('sign_contract').categories).toContain('contract');
        expect(classifyOwnerGate('move_funds').categories).toContain('money');
        expect(classifyOwnerGate('deploy_module').categories).toContain('deployment');
        for (const action of ['send_outreach', 'execute_securities_offering', 'sign_contract', 'move_funds', 'deploy_module']) {
            expect(classifyOwnerGate(action).requiresOwnerApproval).toBe(true);
        }
    });
    it('lists exactly the hard-gated actions', () => {
        const expected = ['deploy_module', 'execute_securities_offering', 'move_funds', 'send_outreach', 'sign_contract'];
        expect(ownerApprovalRequiredActions().sort()).toEqual(expected.sort());
    });
});
describe('IDEA_ENGINE', () => {
    it('rewards market/fit/feasibility and penalises capital requirement', () => {
        const lean = { marketSize: 90, feasibility: 90, capitalRequirement: 10, strategicFit: 90 };
        const heavy = { marketSize: 90, feasibility: 90, capitalRequirement: 95, strategicFit: 90 };
        expect(computeIdeaRank(lean)).toBeGreaterThan(computeIdeaRank(heavy));
    });
    it('generates ranked, explainable ideas across categories (descending rank)', async () => {
        const ideas = await generateIdeas({ focus: 'logistics warehouses', persist: false });
        expect(ideas.length).toBeGreaterThan(0);
        for (let i = 1; i < ideas.length; i += 1) {
            expect(ideas[i - 1].rank).toBeGreaterThanOrEqual(ideas[i].rank);
        }
        expect(ideas[0].rankReasons.length).toBeGreaterThan(0);
        expect(ideas[0].focus).toBe('logistics warehouses');
    });
    it('is deterministic for the same focus + category', async () => {
        const a = await generateIdeas({ focus: 'data centers', categories: ['real_estate'], persist: false });
        const b = await generateIdeas({ focus: 'data centers', categories: ['real_estate'], persist: false });
        expect(a[0].scores).toEqual(b[0].scores);
        expect(a[0].rank).toBe(b[0].rank);
    });
    it('honours the category filter and limit', async () => {
        const ideas = await generateIdeas({ focus: 'x', categories: ['ai', 'jv'], limit: 1, persist: false });
        expect(ideas).toHaveLength(1);
        expect(['ai', 'jv']).toContain(ideas[0].category);
    });
});
describe('JV_DEAL_ENGINE', () => {
    it('drafts a JV with partner map, balanced equity, risk notes, and a contract gate', async () => {
        const deal = await draftJVDeal({ title: 'Sunbelt multifamily JV', partnerName: 'Acme Developers', ivxEquityPct: 65 });
        expect(deal.economics.ivxEquityPct).toBe(65);
        expect(deal.economics.partnerEquityPct).toBe(35);
        expect(deal.partners).toHaveLength(2);
        expect(deal.riskNotes.length).toBeGreaterThan(0);
        expect(deal.ownerApprovalRequired).toBe(true);
        expect(deal.ownerGate.categories).toContain('contract');
    });
});
describe('TOKENIZATION_ENGINE', () => {
    it('drafts a waterfall + terms and NEVER executes a securities offering', async () => {
        const concept = await draftTokenization({ assetName: 'Tower A', raiseTargetUsd: 5_000_000, pricePerTokenUsd: 50 });
        expect(concept.totalTokens).toBe(100_000);
        expect(concept.waterfall.length).toBeGreaterThanOrEqual(4);
        expect(concept.legalReviewFlags.length).toBeGreaterThan(0);
        expect(concept.securitiesOfferingExecuted).toBe(false);
        expect(concept.ownerGate.categories).toContain('securities');
    });
});
describe('APP_AND_MODULE_CREATOR', () => {
    it('drafts a build spec with routes/files and a deployment gate', async () => {
        const spec = await draftModuleSpec('Investor Relations Portal');
        expect(spec.moduleName).toBe('investor-relations-portal');
        expect(spec.proposedRoutes.length).toBeGreaterThan(0);
        expect(spec.proposedFiles.length).toBeGreaterThan(0);
        expect(spec.ownerGate.categories).toContain('deployment');
    });
});
describe('OUTREACH_PREP', () => {
    it('drafts a message that is staged, never sent, behind an outbound-comms gate', async () => {
        const draft = await draftOutreachMessage({ audience: 'investor', recipientName: 'Jordan', context: 'industrial real estate' });
        expect(draft.sent).toBe(false);
        expect(draft.subject).toContain('IVX Holdings');
        expect(draft.body).toContain('Jordan');
        expect(draft.ownerGate.categories).toContain('outbound_communication');
    });
});
describe('capability report', () => {
    it('reports all eight modules and the hard-gated actions', () => {
        const caps = getGrowthEngineCapabilities();
        expect(caps.modules.ideaEngine).toBe(true);
        expect(caps.modules.investorBuyerDiscovery).toBe(true);
        expect(caps.modules.jvDealEngine).toBe(true);
        expect(caps.modules.tokenizationEngine).toBe(true);
        expect(caps.modules.autonomousSearch).toBe(true);
        expect(caps.modules.appAndModuleCreator).toBe(true);
        expect(caps.modules.outreachPrep).toBe(true);
        expect(caps.modules.ownerControlGates).toBe(true);
        expect(caps.ownerApprovalRequiredFor.length).toBe(5);
        expect(Array.isArray(caps.remainingRuntimeDependencies)).toBe(true);
    });
});
