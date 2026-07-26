/**
 * Tests for the BLOCK 62 Report Evidence Gate — fake-report / hallucinated
 * deliverable prevention on the `/public/chat` answer path.
 */
import { describe, expect, it } from 'bun:test';
import { applyReportEvidenceGate, passesReportEvidenceGate, reportEvidenceMissingFields, buildReportNotReadyMessage, } from './ivx-report-evidence-gate';
function fullProof() {
    return {
        reportExists: true,
        urlExists: true,
        urlStatus: 200,
        rowCount: 10000,
        generatedAt: '2026-06-02T10:00:00.000Z',
        sourceQuery: 'select * from jv_deals',
    };
}
describe('passesReportEvidenceGate', () => {
    it('passes only when every proof field is satisfied', () => {
        expect(passesReportEvidenceGate(fullProof())).toBe(true);
    });
    it('fails when the report record is missing', () => {
        expect(passesReportEvidenceGate({ ...fullProof(), reportExists: false })).toBe(false);
    });
    it('fails when the URL status is not 200/206', () => {
        expect(passesReportEvidenceGate({ ...fullProof(), urlStatus: 404 })).toBe(false);
        expect(passesReportEvidenceGate({ ...fullProof(), urlStatus: null })).toBe(false);
    });
    it('fails when row count is missing or zero', () => {
        expect(passesReportEvidenceGate({ ...fullProof(), rowCount: 0 })).toBe(false);
        expect(passesReportEvidenceGate({ ...fullProof(), rowCount: null })).toBe(false);
    });
    it('fails when generatedAt or sourceQuery is missing', () => {
        expect(passesReportEvidenceGate({ ...fullProof(), generatedAt: null })).toBe(false);
        expect(passesReportEvidenceGate({ ...fullProof(), sourceQuery: '   ' })).toBe(false);
    });
    it('reports every required field as missing when evidence is absent', () => {
        expect(reportEvidenceMissingFields(null)).toEqual([
            'report file / record',
            'retrievable URL',
            'URL status 200',
            'row count',
            'generation timestamp',
            'source query',
        ]);
    });
});
describe('applyReportEvidenceGate', () => {
    it('report missing → honest NOT READY (no real deliverable, no proof)', () => {
        const result = applyReportEvidenceGate({
            answer: 'Your 10,000 Buyers Report is ready.',
            hasRealDeliverable: false,
        });
        expect(result.gated).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.answer).toContain('REPORT NOT READY');
        expect(result.answer).not.toContain('](#)');
    });
    it('placeholder "#" link → blocked even alongside other text', () => {
        const result = applyReportEvidenceGate({
            answer: 'Here are the links: [Buyers Report](#) [JV Deals Report](#)',
            hasRealDeliverable: false,
        });
        expect(result.gated).toBe(true);
        expect(result.violations).toContain('NO_PLACEHOLDER_LINK');
        expect(result.answer).toContain('REPORT NOT READY');
    });
    it('report exists but no URL → NOT READY', () => {
        const result = applyReportEvidenceGate({
            answer: 'The 1,000 JV Deals Report is ready.',
            hasRealDeliverable: false,
            reportEvidence: { ...fullProof(), urlExists: false, urlStatus: null },
        });
        expect(result.gated).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.missing).toContain('retrievable URL');
    });
    it('row count missing → NOT READY', () => {
        const result = applyReportEvidenceGate({
            answer: 'The Buyers Report is finalized and ready to download.',
            hasRealDeliverable: false,
            reportEvidence: { ...fullProof(), rowCount: null },
        });
        expect(result.gated).toBe(true);
        expect(result.missing).toContain('row count');
    });
    it('report exists with valid proof → READY (claim allowed, not rewritten)', () => {
        const answer = 'The 10,000 Buyers Report has been generated with 10,000 rows.';
        const result = applyReportEvidenceGate({
            answer,
            hasRealDeliverable: false,
            reportEvidence: fullProof(),
        });
        expect(result.gated).toBe(false);
        expect(result.passed).toBe(true);
        expect(result.answer).toBe(answer);
    });
    it('real download-verified deliverable bypasses the structured proof check', () => {
        const answer = 'Your report is ready.';
        const result = applyReportEvidenceGate({ answer, hasRealDeliverable: true });
        expect(result.gated).toBe(false);
        expect(result.answer).toBe(answer);
    });
    it('placeholder link is blocked even when a real deliverable exists (a real link is never #)', () => {
        const result = applyReportEvidenceGate({
            answer: 'Your report is ready: [Download](#)',
            hasRealDeliverable: true,
        });
        expect(result.gated).toBe(true);
        expect(result.violations).toContain('NO_PLACEHOLDER_LINK');
    });
    it('normal conversational answer is never gated', () => {
        const answer = 'IVX helps you manage real-estate joint ventures. Ask me anything.';
        const result = applyReportEvidenceGate({ answer, hasRealDeliverable: false });
        expect(result.gated).toBe(false);
        expect(result.passed).toBe(true);
        expect(result.answer).toBe(answer);
    });
    it('the NOT READY message never contains a link', () => {
        const msg = buildReportNotReadyMessage(['retrievable URL']);
        expect(msg).toContain('REPORT NOT READY');
        expect(msg).not.toMatch(/\]\(/);
        expect(msg).not.toContain('http');
    });
});
