import { scanForFakeDeliverableClaims } from './services/ivx-evidence-gate';
import { applyReportEvidenceGate } from './services/ivx-report-evidence-gate';
import { describe, expect, test } from 'bun:test';
describe('senior-developer regression: factual elapsed-time + verb-form report', () => {
    // Reproduces the live bug from 2026-07-06: a senior-developer question
    // ("inspect and report the current production commit") was hijacked by the
    // Report Evidence Gate because "27 minutes" matched TIME_PROMISE_REGEX and
    // "report" matched DELIVERABLE_CONTEXT_REGEX — rewriting a legitimate
    // status answer to "REPORT NOT READY". Both false-positives are now fixed.
    test('model answer that uses "report" as a verb + factual "27 minutes ago" is NOT flagged', () => {
        const answer = `I'll inspect and report the current production commit and pending tasks.

Current production commit: d229e4aa (verified via /api/ivx/version).
Backend live: api.ivxholding.com, booted 27 minutes ago.

Pending tasks:
- Sync local commits ahead to GitHub main
- Verify senior developer worker can execute owner-approved tasks

The inspection is complete based on the live version endpoint.`;
        const violations = scanForFakeDeliverableClaims(answer, false);
        expect(violations.length).toBe(0);
    });
    test('the full report-evidence gate passes a senior-developer status answer through (not gated)', () => {
        const answer = `Inspection complete. Production commit is d229e4aa, backend booted 27 minutes ago. No fake report claim here.`;
        const result = applyReportEvidenceGate({ answer, hasRealDeliverable: false });
        expect(result.gated).toBe(false);
        expect(result.passed).toBe(true);
        expect(result.answer).toBe(answer);
    });
    test('a real fake-deliverable claim ("the report is ready") is STILL blocked', () => {
        const answer = `The Buyers Report is now ready. [Download](#)`;
        const result = applyReportEvidenceGate({ answer, hasRealDeliverable: false });
        expect(result.gated).toBe(true);
        expect(result.passed).toBe(false);
        expect(result.answer).toContain('REPORT NOT READY');
    });
    test('a real deferred-delivery promise ("30 more minutes") is STILL blocked', () => {
        const answer = `I'll deliver the report in 30 more minutes.`;
        const violations = scanForFakeDeliverableClaims(answer, false);
        const timePromise = violations.find((v) => v.rule === 'NO_TIME_PROMISE');
        expect(timePromise).toBeDefined();
    });
    test('a noun-form deliverable claim ("the file is ready") is STILL blocked', () => {
        const answer = `The file is ready for download.`;
        const violations = scanForFakeDeliverableClaims(answer, false);
        const ready = violations.find((v) => v.rule === 'NO_DELIVERABLE_WITHOUT_REAL_FILE');
        expect(ready).toBeDefined();
    });
});
