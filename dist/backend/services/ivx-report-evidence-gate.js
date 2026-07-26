/**
 * IVX Report Evidence Gate — BLOCK 62 (fake-report / hallucinated-deliverable prevention).
 *
 * BLOCK 33 added `scanForFakeDeliverableClaims` to the evidence gate and PHASE 2
 * built the real deliverable pipeline (`conversationHasRealDeliverable`). But the
 * gate was wired ONLY into the owner-gated `/api/ivx/owner-ai` self_developer
 * route. The in-app chat — the regular Chat tab AND the IVX Owner AI chat (which
 * falls back to `/public/chat` on owner-session 401, BLOCK 13/30) — answers
 * through `/public/chat`, which had NO gate. So report claims like
 * "10,000 Buyers Report is ready" with placeholder links `[Buyers Report](#)`
 * flowed through completely ungated.
 *
 * This module is the Report Evidence Gate the owner asked for: before any answer
 * can present a report as complete, it must clear a structured proof gate
 * (reportExists / urlExists / urlStatus===200 / rowCount>0 / generatedAt /
 * sourceQuery), OR a real, download-verified deliverable must exist for the
 * conversation. Otherwise the answer is rewritten to an honest REPORT NOT READY
 * message — no placeholder links, no "report is ready", no "please hold" loops.
 *
 * Pure + deterministic (no I/O) so it is fully unit-testable. The async caller
 * supplies `hasRealDeliverable` (from `conversationHasRealDeliverable`) and/or a
 * `reportEvidence` proof object.
 */
import { scanForFakeDeliverableClaims } from './ivx-evidence-gate';
export const IVX_REPORT_EVIDENCE_GATE_MARKER = 'ivx-report-evidence-gate-2026-06-02';
/** HTTP statuses that count as a real, retrievable download. */
const RETRIEVABLE_HTTP_STATUSES = new Set([200, 206]);
/**
 * Whether the structured report proof clears every required field.
 * Pure — deterministic.
 */
export function passesReportEvidenceGate(evidence) {
    return reportEvidenceMissingFields(evidence).length === 0;
}
/**
 * The exact proof fields missing from a report-evidence object.
 * Returns every required field when the evidence is absent.
 */
export function reportEvidenceMissingFields(evidence) {
    const missing = [];
    if (!evidence) {
        return ['report file / record', 'retrievable URL', 'URL status 200', 'row count', 'generation timestamp', 'source query'];
    }
    if (!evidence.reportExists)
        missing.push('report file / record');
    if (!evidence.urlExists)
        missing.push('retrievable URL');
    if (evidence.urlStatus === null || !RETRIEVABLE_HTTP_STATUSES.has(evidence.urlStatus)) {
        missing.push('URL status 200');
    }
    if (evidence.rowCount === null || evidence.rowCount <= 0)
        missing.push('row count');
    if (!evidence.generatedAt || evidence.generatedAt.trim().length === 0)
        missing.push('generation timestamp');
    if (!evidence.sourceQuery || evidence.sourceQuery.trim().length === 0)
        missing.push('source query');
    return missing;
}
/**
 * The honest message IVX returns when a report claim can't be proven.
 * Matches the owner's required REPORT NOT READY UI: Missing list + Next action.
 * Never contains a link.
 */
export function buildReportNotReadyMessage(missing) {
    const missingList = (missing.length > 0
        ? missing
        : ['report file / record', 'retrievable URL', 'URL status 200', 'row count', 'generation timestamp', 'source query'])
        .map((item) => `- ${item}`)
        .join('\n');
    return [
        'REPORT NOT READY',
        '',
        'Report not generated yet. No valid link exists. I will not present a report as complete without a real, retrievable file.',
        '',
        'Missing:',
        missingList,
        '',
        'Next action:',
        '- Generate / export the report now (real artifact pipeline)',
        '- Retry the export if a job already started',
        '- Open the report job to check its status',
        '- Tell me the exact data source if one is missing',
        '',
        'I will share a download link only after the file exists and its URL returns HTTP 200.',
    ].join('\n');
}
/**
 * Apply the Report Evidence Gate to a model answer.
 *
 * The report-completion claim is allowed only when a real, download-verified
 * deliverable exists for the conversation OR the structured report proof clears
 * every required field. Otherwise any fake-completion claim / placeholder link
 * is blocked and the answer is rewritten to the honest REPORT NOT READY message.
 *
 * Pure — deterministic, no I/O.
 */
export function applyReportEvidenceGate(input) {
    const hasRealDeliverable = input.hasRealDeliverable ?? false;
    const structuredProofPasses = passesReportEvidenceGate(input.reportEvidence ?? null);
    const gatePass = hasRealDeliverable || structuredProofPasses;
    const violations = scanForFakeDeliverableClaims(input.answer, gatePass).map((v) => v.rule);
    if (violations.length === 0) {
        return { answer: input.answer, gated: false, passed: true, violations, missing: [] };
    }
    // A claim slipped through that can't be proven (placeholder link, or a
    // "report is ready" / deferred-delivery claim with no real artifact).
    const missing = hasRealDeliverable
        ? ['valid (non-placeholder) download URL']
        : reportEvidenceMissingFields(input.reportEvidence ?? null);
    return {
        answer: buildReportNotReadyMessage(missing),
        gated: true,
        passed: false,
        violations,
        missing,
    };
}
