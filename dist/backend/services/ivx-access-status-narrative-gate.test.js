import { describe, expect, it } from 'bun:test';
import { applyAccessStatusNarrativeGate, buildAccessStatusBlockedMessage, findFabricatedAccessStatusMarkers, isAccessStatusPrompt, IVX_ACCESS_STATUS_NARRATIVE_GATE_MARKER, } from './ivx-access-status-narrative-gate';
describe('ivx-access-status-narrative-gate', () => {
    it('exports a stable marker', () => {
        expect(IVX_ACCESS_STATUS_NARRATIVE_GATE_MARKER).toContain('ivx-access-status-narrative-gate');
    });
    it('detects access-status prompts', () => {
        expect(isAccessStatusPrompt('Run an end-to-end audit access status for IVX')).toBe(true);
        expect(isAccessStatusPrompt('Do you have access to GitHub and Render?')).toBe(true);
        expect(isAccessStatusPrompt('What access do you have?')).toBe(true);
        expect(isAccessStatusPrompt('Show me credential status')).toBe(true);
        expect(isAccessStatusPrompt('Hello, how are you?')).toBe(false);
    });
    it('detects the exact false narrative from the owner screenshot', () => {
        const falseAnswer = [
            "Here's the end-to-end audit access status for IVX:",
            '',
            '1. **Supabase:** Yes, I have access to inspect database schemas, tables, and RLS policies.',
            '2. **Amazon (AWS):** Yes, I have access for general inspections, but specific credentials are required for deeper insights.',
            '3. **GitHub:** No, I currently do not have direct access to GitHub repositories.',
            '4. **Render:** No, I do not have direct access to Render deployment logs or settings.',
            '5. **Vercel:** Yes, there\'s access through the Vercel AI Gateway endpoint configuration.',
            '',
            'For GitHub and Render, additional credentials would be needed to complete a full audit.',
        ].join('\n');
        const markers = findFabricatedAccessStatusMarkers(falseAnswer);
        expect(markers.length).toBeGreaterThan(0);
        expect(markers).toContain('fabricated GitHub no-access claim');
        expect(markers).toContain('fabricated Render no-access claim');
        expect(markers).toContain('fabricated access-status audit');
    });
    it('replaces a false access-status answer with the strict blocked message', () => {
        const falseAnswer = "GitHub: No, I currently do not have direct access to GitHub repositories.\nRender: No, I do not have direct access to Render deployment logs or settings.";
        const result = applyAccessStatusNarrativeGate({
            message: 'end-to-end audit access status',
            answer: falseAnswer,
        });
        expect(result.gated).toBe(true);
        expect(result.routed).toBe(true);
        expect(result.markers.length).toBeGreaterThan(0);
        expect(result.answer).toBe(buildAccessStatusBlockedMessage());
        expect(result.answer).toContain('ACCESS-STATUS AUDIT BLOCKED');
        expect(result.answer).toContain('live end-to-end audit');
    });
    it('passes through normal conversation when no access-status narrative is present', () => {
        const normalAnswer = 'The Jacksonville deal has a 9.5% projected ROI over 18 months.';
        const result = applyAccessStatusNarrativeGate({
            message: 'What is the ROI on the Jacksonville deal?',
            answer: normalAnswer,
        });
        expect(result.gated).toBe(false);
        expect(result.routed).toBe(false);
        expect(result.markers).toEqual([]);
        expect(result.answer).toBe(normalAnswer);
    });
    it('does not gate honest "I cannot access" statements outside the fabricated checklist pattern', () => {
        const honestAnswer = 'I cannot access your AWS console without the owner signing in.';
        const result = applyAccessStatusNarrativeGate({
            message: 'Can you delete my S3 bucket?',
            answer: honestAnswer,
        });
        expect(result.gated).toBe(false);
        expect(result.answer).toBe(honestAnswer);
    });
});
