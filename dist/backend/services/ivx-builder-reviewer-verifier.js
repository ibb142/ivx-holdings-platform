/**
 * IVX Builder/Reviewer/Verifier Separation — Phase 8
 *
 * For code tasks: BUILDER inspects/plans/patches/tests.
 * REVIEWER reviews code quality/security/architecture/backward compatibility.
 * TESTER runs tests/TypeScript/lint/integration.
 * VERIFIER verifies commit/deployment/runtime/endpoint/behavior.
 *
 * No agent may approve its own work as final proof.
 */
export const UNCERTAINTY_RULES = {
    VERIFIED: 'Live evidence confirms the claim (HTTP 200, SHA match, DB row exists)',
    SUPPORTED: 'Code or test evidence supports the claim, but live verification not performed',
    INFERRED: 'Reasoning suggests the claim is true, but no direct evidence exists',
    UNKNOWN: 'No information available to assess the claim',
    BLOCKED: 'A dependency or permission prevents verification',
    NOT_TESTED: 'The test was not run (e.g., requires physical device, SMTP, or external service)',
    FAILED: 'Evidence contradicts the claim (HTTP error, SHA mismatch, test failure)',
};
export function labelUncertainty(input) {
    if (input.hasLiveEvidence && input.testPassed)
        return 'VERIFIED';
    if (input.hasTestEvidence && input.testPassed)
        return 'SUPPORTED';
    if (input.hasCodeEvidence)
        return 'INFERRED';
    if (input.isBlocked)
        return 'BLOCKED';
    if (!input.wasTested)
        return 'NOT_TESTED';
    if (input.wasTested && !input.testPassed)
        return 'FAILED';
    return 'UNKNOWN';
}
// ─── Builder ──────────────────────────────────────────────────────
export function createBuilderResult(input) {
    return {
        phase: input.phase,
        filesInspected: input.filesInspected || [],
        filesChanged: input.filesChanged || [],
        patchesApplied: input.patchesApplied || [],
        testsAdded: input.testsAdded || [],
        status: input.status,
        detail: input.detail,
    };
}
// ─── Reviewer ─────────────────────────────────────────────────────
export function createReviewResult(input) {
    return {
        dimension: input.dimension,
        approved: input.approved,
        findings: input.findings,
        severity: input.severity || (input.approved ? 'info' : 'warning'),
        status: input.approved ? 'approved' : 'changes_requested',
    };
}
/**
 * Reviewer cannot approve builder's work if the reviewer IS the builder.
 * This is enforced by the orchestrator using different specialist roles.
 */
export function isReviewIndependent(builderRole, reviewerRole) {
    return builderRole !== reviewerRole;
}
// ─── Tester ───────────────────────────────────────────────────────
export function createTestResult(input) {
    return {
        check: input.check,
        passed: input.passed,
        output: input.output,
        duration: input.duration,
        status: input.passed ? 'passed' : 'failed',
    };
}
// ─── Verifier ─────────────────────────────────────────────────────
export function createVerificationResult(input) {
    const uncertainty = labelUncertainty({
        hasLiveEvidence: input.verified && input.check === 'live_endpoint',
        hasCodeEvidence: input.check === 'commit' && input.verified,
        hasTestEvidence: input.verified,
        isBlocked: input.isBlocked,
        wasTested: input.wasTested,
        testPassed: input.verified,
    });
    return {
        check: input.check,
        verified: input.verified,
        evidence: input.evidence,
        uncertainty,
        status: input.verified ? 'verified' : (input.isBlocked ? 'not_tested' : 'not_verified'),
    };
}
/**
 * The verifier is the ONLY role that can recommend VERIFIED status.
 * No builder, reviewer, or tester can do this.
 */
export function canDeclareVerified(role) {
    return role === 'proof_verifier';
}
/**
 * A full verification requires ALL checks to pass.
 */
export function aggregateVerification(results) {
    const allChecks = ['commit', 'deployment', 'runtime_sha', 'live_endpoint'];
    const missingChecks = allChecks.filter((check) => !results.some((r) => r.check === check));
    const allVerified = results.every((r) => r.verified);
    const anyFailed = results.some((r) => r.status === 'failed');
    const anyNotTested = results.some((r) => r.status === 'not_tested');
    let uncertainty = 'UNKNOWN';
    if (allVerified && missingChecks.length === 0) {
        uncertainty = 'VERIFIED';
    }
    else if (anyFailed) {
        uncertainty = 'FAILED';
    }
    else if (anyNotTested) {
        uncertainty = 'NOT_TESTED';
    }
    else if (results.some((r) => r.verified)) {
        uncertainty = 'SUPPORTED';
    }
    return {
        overall: allVerified && missingChecks.length === 0 ? 'VERIFIED' : (anyFailed ? 'NOT_VERIFIED' : 'PARTIAL'),
        uncertainty,
        missingChecks,
    };
}
export const IVX_BRV_SEPARATOR_MARKER = 'ivx-builder-reviewer-verifier-2026-07-23-v1';
