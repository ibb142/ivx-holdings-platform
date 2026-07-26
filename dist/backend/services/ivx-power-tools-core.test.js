/**
 * BLOCK 98 — IVX Power Tools Core tests (lead capture + scoring + pipeline, deal packet, dashboard + Gmail-first gate).
 * Pure-logic coverage (no durable I/O) so the suite is deterministic and runtime-light.
 */
import { describe, expect, it } from 'bun:test';
import { scoreLeadBehavior, validateCaptureLead, followUpDateInDays, LEAD_PIPELINE_STAGES, } from './ivx-lead-capture-store';
import { PACKET_ITEM_TEMPLATES, computePacketReadiness, } from './ivx-deal-packet-store';
import { prepareOutreachDraft } from './ivx-power-tools-dashboard';
function signals(overrides) {
    return {
        browsed: false,
        returned: false,
        viewedDeal: false,
        clickedCta: false,
        submittedForm: false,
        requestedPacket: false,
        bookedCall: false,
        contactVerified: false,
        ...overrides,
    };
}
describe('lead behavior scoring (BLOCK 98 rules)', () => {
    it('browsed only is cold', () => {
        const r = scoreLeadBehavior(signals({ browsed: true }));
        expect(r.temperature).toBe('cold');
        expect(r.leadScore).toBeGreaterThan(0);
    });
    it('clicked CTA / returned / viewed deal is warm', () => {
        expect(scoreLeadBehavior(signals({ browsed: true, clickedCta: true })).temperature).toBe('warm');
        expect(scoreLeadBehavior(signals({ returned: true })).temperature).toBe('warm');
        expect(scoreLeadBehavior(signals({ viewedDeal: true })).temperature).toBe('warm');
    });
    it('submitted form / requested packet / booked call is hot', () => {
        expect(scoreLeadBehavior(signals({ submittedForm: true })).temperature).toBe('hot');
        expect(scoreLeadBehavior(signals({ requestedPacket: true })).temperature).toBe('hot');
        expect(scoreLeadBehavior(signals({ bookedCall: true })).temperature).toBe('hot');
    });
    it('verified contact + clear intent is qualified', () => {
        const r = scoreLeadBehavior(signals({ submittedForm: true, contactVerified: true }));
        expect(r.temperature).toBe('qualified');
    });
    it('verified contact WITHOUT a hot signal is not qualified', () => {
        const r = scoreLeadBehavior(signals({ browsed: true, contactVerified: true }));
        expect(r.temperature).not.toBe('qualified');
    });
    it('score is monotonic — more signals never lowers the score', () => {
        const base = scoreLeadBehavior(signals({ browsed: true })).leadScore;
        const more = scoreLeadBehavior(signals({ browsed: true, viewedDeal: true, submittedForm: true })).leadScore;
        expect(more).toBeGreaterThan(base);
        expect(more).toBeLessThanOrEqual(100);
    });
});
describe('lead capture validation (no fabrication)', () => {
    it('requires a name', () => {
        expect(validateCaptureLead({ name: '', email: 'a@b.com', consent: true }).ok).toBe(false);
    });
    it('requires a real contact (email or phone)', () => {
        expect(validateCaptureLead({ name: 'Jane', consent: true }).ok).toBe(false);
        expect(validateCaptureLead({ name: 'Jane', phone: '555', consent: true }).ok).toBe(true);
    });
    it('requires consent for a lead_form submission', () => {
        expect(validateCaptureLead({ name: 'Jane', email: 'a@b.com', source: 'lead_form' }).ok).toBe(false);
        expect(validateCaptureLead({ name: 'Jane', email: 'a@b.com', source: 'lead_form', consent: true }).ok).toBe(true);
    });
    it('does not require consent for an owner_entered record', () => {
        expect(validateCaptureLead({ name: 'Jane', email: 'a@b.com', source: 'owner_entered' }).ok).toBe(true);
    });
});
describe('pipeline + follow-up helpers', () => {
    it('exposes the full new_lead → lost stage set', () => {
        expect(LEAD_PIPELINE_STAGES[0]).toBe('new_lead');
        expect(LEAD_PIPELINE_STAGES).toContain('soft_commitment');
        expect(LEAD_PIPELINE_STAGES[LEAD_PIPELINE_STAGES.length - 1]).toBe('lost');
    });
    it('computes a future follow-up date', () => {
        const due = Date.parse(followUpDateInDays(3));
        expect(due).toBeGreaterThan(Date.now());
    });
});
describe('deal packet readiness', () => {
    function freshItems() {
        return PACKET_ITEM_TEMPLATES.map((t) => ({
            key: t.key, label: t.label, required: t.required,
            status: 'pending', reference: '', updatedAt: '',
        }));
    }
    it('starts at 0 readiness, not complete', () => {
        const r = computePacketReadiness(freshItems());
        expect(r.readiness).toBe(0);
        expect(r.complete).toBe(false);
    });
    it('rises as items become ready and completes when all required are resolved', () => {
        const items = freshItems();
        items[0].status = 'ready';
        const partial = computePacketReadiness(items);
        expect(partial.readiness).toBeGreaterThan(0);
        expect(partial.complete).toBe(false);
        for (const it of items)
            it.status = 'ready';
        const full = computePacketReadiness(items);
        expect(full.readiness).toBe(100);
        expect(full.complete).toBe(true);
    });
    it('not_applicable counts toward completeness but not the ready numerator', () => {
        const items = freshItems();
        for (const it of items)
            it.status = 'ready';
        items[0].status = 'not_applicable';
        const r = computePacketReadiness(items);
        expect(r.complete).toBe(true);
        expect(r.readiness).toBeLessThan(100);
    });
});
describe('Gmail-first outreach draft gate', () => {
    const emptyEnv = {};
    it('drafts but blocks send when no provider configured', () => {
        // detectConfiguredEmailProvider reads process.env; in this sandbox no provider is set.
        const draft = prepareOutreachDraft({ type: 'investor_intro', recipientName: 'Pat', contactVerified: true });
        expect(draft.subject.length).toBeGreaterThan(0);
        expect(draft.body.length).toBeGreaterThan(0);
        expect(draft.requiresOwnerApproval).toBe(true);
        // With no provider in the sandbox env, the gate must block on provider, never send.
        expect(draft.blocker).toBe('EMAIL_PROVIDER_NOT_CONFIGURED');
        expect(draft.canSendAfterApproval).toBe(false);
        expect(draft.sendPath).toBe('draft_only');
    });
    it('always carries a compliance note and never auto-sends', () => {
        const draft = prepareOutreachDraft({ type: 'email_campaign', recipientCompany: 'Acme Capital' });
        expect(draft.complianceNote.toLowerCase()).toContain('guaranteed returns');
        expect(draft.requiresOwnerApproval).toBe(true);
    });
    void emptyEnv;
});
