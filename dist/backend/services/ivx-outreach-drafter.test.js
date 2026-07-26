import { describe, expect, it } from 'bun:test';
import { buildOutreachDraft, OUTREACH_TYPES } from './ivx-outreach-drafter';
describe('buildOutreachDraft', () => {
    it('produces a subject + body for every outreach type', () => {
        for (const type of OUTREACH_TYPES) {
            const draft = buildOutreachDraft({ type, recipientName: 'Jane', relatedDeal: 'Casa Rosario', senderName: 'Daniel' });
            expect(draft.subject.length).toBeGreaterThan(0);
            expect(draft.body.length).toBeGreaterThan(0);
            expect(draft.subject).toContain('Casa Rosario');
        }
    });
    it('uses the recipient name in the greeting when supplied', () => {
        const draft = buildOutreachDraft({ type: 'follow_up', recipientName: 'Maria' });
        expect(draft.body.startsWith('Hi Maria,')).toBe(true);
    });
    it('falls back to a neutral greeting when no recipient name', () => {
        const draft = buildOutreachDraft({ type: 'follow_up' });
        expect(draft.body.startsWith('Hello,')).toBe(true);
    });
    it('never injects placeholder tokens for missing fields', () => {
        const draft = buildOutreachDraft({ type: 'email_campaign' });
        expect(draft.subject).not.toContain('[');
        expect(draft.body).not.toContain('[');
        expect(draft.body).not.toContain('undefined');
    });
    it('uses a generic deal phrase when no deal is attached', () => {
        const draft = buildOutreachDraft({ type: 'investor_intro', recipientName: 'Sam' });
        expect(draft.body).toContain('a current South Florida opportunity');
    });
    it('appends the owner-supplied context note', () => {
        const draft = buildOutreachDraft({ type: 'deal_update', contextNote: 'Construction is 60% complete.' });
        expect(draft.body).toContain('Construction is 60% complete.');
    });
    it('uses the sender sign-off when supplied, IVX Holdings otherwise', () => {
        expect(buildOutreachDraft({ type: 'meeting_request', senderName: 'Daniel' }).body).toContain('Daniel');
        expect(buildOutreachDraft({ type: 'meeting_request' }).body).toContain('IVX Holdings');
    });
});
