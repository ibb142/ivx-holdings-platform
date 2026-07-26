/**
 * BLOCK 4 — IVX Gmail OAuth Draft Provider tests.
 *
 * Covers the pure draft gate (the four owner test cases), the env-derived connection
 * status (not-connected when no OAuth credential), and the connect refusal when no
 * credential is configured. Durable-write paths use the live store but assert only the
 * deterministic gate/status outcomes so the suite stays runtime-light.
 */
import { describe, expect, it } from 'bun:test';
import { connectGmail, createGmailDraft, evaluateGmailDraftGate, getGmailProviderStatus, IVX_GMAIL_PROVIDER_MARKER, } from './ivx-gmail-provider';
describe('Gmail draft gate (BLOCK 4 — the four owner test cases)', () => {
    it('Case 1 — Gmail not connected → GMAIL_PROVIDER_NOT_CONNECTED (first gate)', () => {
        const r = evaluateGmailDraftGate({ contactVerified: true, ownerApproved: true }, false);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.blocker).toBe('GMAIL_PROVIDER_NOT_CONNECTED');
    });
    it('Case 2 — connected but unverified contact → CONTACT_NOT_VERIFIED', () => {
        const r = evaluateGmailDraftGate({ contactVerified: false, ownerApproved: true }, true);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.blocker).toBe('CONTACT_NOT_VERIFIED');
    });
    it('Case 3 — connected + verified but no approval → OWNER_APPROVAL_REQUIRED', () => {
        const r = evaluateGmailDraftGate({ contactVerified: true, ownerApproved: false }, true);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.blocker).toBe('OWNER_APPROVAL_REQUIRED');
    });
    it('Case 4 — connected + verified + approved → gate passes', () => {
        const r = evaluateGmailDraftGate({ contactVerified: true, ownerApproved: true }, true);
        expect(r.ok).toBe(true);
    });
    it('gate order — connection is checked before verification before approval', () => {
        // All three would-be blockers present: connection wins.
        const r = evaluateGmailDraftGate({ contactVerified: false, ownerApproved: false }, false);
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.blocker).toBe('GMAIL_PROVIDER_NOT_CONNECTED');
    });
});
describe('Gmail provider status (env-derived, honest)', () => {
    it('reports not_connected with the exact missing env when no OAuth credential is set', async () => {
        const status = await getGmailProviderStatus();
        expect(status.marker).toBe(IVX_GMAIL_PROVIDER_MARKER);
        // The sandbox has no GMAIL_OAUTH_TOKEN/GMAIL_REFRESH_TOKEN configured.
        expect(status.backedByCredentials).toBe(false);
        expect(status.connected).toBe(false);
        expect(status.state).toBe('not_connected');
        expect(status.missingEnv).toContain('GMAIL_OAUTH_TOKEN');
    });
});
describe('connectGmail without a credential', () => {
    it('refuses to connect and returns GMAIL_OAUTH_NOT_CONFIGURED', async () => {
        const result = await connectGmail();
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.error).toBe('GMAIL_OAUTH_NOT_CONFIGURED');
    });
});
describe('createGmailDraft live gate (no connection in sandbox)', () => {
    it('blocks at the connection gate even with verified+approved input', async () => {
        const result = await createGmailDraft({
            type: 'investor_intro',
            recipientName: 'Prospect',
            contactVerified: true,
            ownerApproved: true,
        });
        expect(result.ok).toBe(false);
        if (!result.ok)
            expect(result.blocker).toBe('GMAIL_PROVIDER_NOT_CONNECTED');
    });
});
