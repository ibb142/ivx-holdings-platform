import { describe, expect, it } from 'bun:test';
import { EVIDENCE_LABEL, EVIDENCE_CLASSIFICATION, buildEvidenceMetadata, evaluateEvidenceGate, scanForProhibitions, scanForFakeDeliverableClaims, extractClaims, applyEvidenceLabelToAnswer, separateStreams, gateDeveloperModeReport, classifyTechnicalResponse, isTechnicalResponse, CLAIM_CATEGORY, } from './ivx-evidence-gate';
// ---------------------------------------------------------------------------
// Output labels (requirement 3)
// ---------------------------------------------------------------------------
describe('Output labels', () => {
    it('all internal labels are distinct', () => {
        const labels = new Set(Object.values(EVIDENCE_LABEL));
        expect(labels.size).toBe(5);
    });
    it('NOT_EXECUTED is defined', () => {
        expect(EVIDENCE_LABEL.NOT_EXECUTED).toBe('NOT EXECUTED');
    });
    it('UNVERIFIED is defined', () => {
        expect(EVIDENCE_LABEL.UNVERIFIED).toBe('UNVERIFIED');
    });
    it('SIMULATED is defined', () => {
        expect(EVIDENCE_LABEL.SIMULATED).toBe('SIMULATED');
    });
    it('EXECUTED is defined', () => {
        expect(EVIDENCE_LABEL.EXECUTED).toBe('EXECUTED');
    });
});
// ---------------------------------------------------------------------------
// Owner-facing classification (TASK 2 — every technical response classified)
// ---------------------------------------------------------------------------
describe('classifyTechnicalResponse', () => {
    it('maps an evidence-backed result to VERIFIED', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix and deployed it.',
            toolWasExecuted: true,
            evidenceMetadata: buildEvidenceMetadata({ toolName: 't', requestId: 'r', rawOutputRef: 'o' }),
            repoAccessVerified: true,
        });
        expect(classifyTechnicalResponse(result)).toBe(EVIDENCE_CLASSIFICATION.VERIFIED);
    });
    it('maps a no-tool result with claims to NOT EXECUTED', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix.',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(classifyTechnicalResponse(result)).toBe(EVIDENCE_CLASSIFICATION.NOT_EXECUTED);
    });
    it('maps a tool-ran-without-metadata result to UNVERIFIED', () => {
        const result = evaluateEvidenceGate({
            answer: 'I deployed it.',
            toolWasExecuted: true,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(classifyTechnicalResponse(result)).toBe(EVIDENCE_CLASSIFICATION.UNVERIFIED);
    });
    it('produces exactly the four owner-facing labels', () => {
        const labels = new Set(Object.values(EVIDENCE_CLASSIFICATION));
        expect(labels.size).toBe(4);
        expect(labels.has('VERIFIED')).toBe(true);
        expect(labels.has('UNVERIFIED')).toBe(true);
        expect(labels.has('NOT EXECUTED')).toBe(true);
        expect(labels.has('SIMULATED')).toBe(true);
    });
});
describe('isTechnicalResponse', () => {
    it('is false for plain chat', () => {
        expect(isTechnicalResponse('Hi, how can I help?')).toBe(false);
    });
    it('is true when the answer makes a technical claim', () => {
        expect(isTechnicalResponse('I committed the fix and deployed it.')).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// Evidence metadata builder (requirement 2)
// ---------------------------------------------------------------------------
describe('buildEvidenceMetadata', () => {
    it('returns metadata with all required fields', () => {
        const meta = buildEvidenceMetadata({
            toolName: 'ivx_self_developer_runtime',
            requestId: 'req-001',
            rawOutputRef: 'logs/audit/job-001.json',
        });
        expect(meta.toolName).toBe('ivx_self_developer_runtime');
        expect(meta.requestId).toBe('req-001');
        expect(meta.rawOutputRef).toBe('logs/audit/job-001.json');
        expect(meta.label).toBe(EVIDENCE_LABEL.EXECUTED);
        expect(new Date(meta.timestamp).getTime()).toBeGreaterThan(0);
    });
    it('accepts a custom label', () => {
        const meta = buildEvidenceMetadata({
            toolName: 'test_runner',
            requestId: 'req-002',
            rawOutputRef: 'logs/audit/test.json',
            label: EVIDENCE_LABEL.NOT_EXECUTED,
        });
        expect(meta.label).toBe(EVIDENCE_LABEL.NOT_EXECUTED);
    });
});
// ---------------------------------------------------------------------------
// Prohibition scanner (requirement 4)
// ---------------------------------------------------------------------------
describe('scanForProhibitions', () => {
    it('returns empty array when answer has no violations', () => {
        const violations = scanForProhibitions('Hello, how can I help you today?', true);
        expect(violations).toEqual([]);
    });
    it('flags commit claims when evidence is absent', () => {
        const violations = scanForProhibitions('I committed the fix to main.', false);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations[0].rule).toBe('NO_SIMULATED_DATA_AS_REAL');
        expect(violations[0].snippet).toBe('committed');
    });
    it('flags deploy claims when evidence is absent', () => {
        const violations = scanForProhibitions('The code has been deployed to production.', false);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations.some((v) => v.rule === 'NO_SIMULATED_DATA_AS_REAL' && v.snippet === 'deployed')).toBe(true);
    });
    it('flags code-change claims when evidence is absent', () => {
        const violations = scanForProhibitions('I changed the file backend/services/foo.ts.', false);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations.some((v) => v.rule === 'NO_SIMULATED_DATA_AS_REAL')).toBe(true);
    });
    it('flags database-mutation claims when evidence is absent', () => {
        const violations = scanForProhibitions('I inserted a row into the investors table.', false);
        expect(violations.length).toBeGreaterThan(0);
        expect(violations.some((v) => v.rule === 'NO_SIMULATED_DATA_AS_REAL')).toBe(true);
    });
    it('does NOT flag the same claims when evidence IS available', () => {
        const violations = scanForProhibitions('I committed the fix to main and deployed to production.', true);
        expect(violations).toEqual([]);
    });
    it('flags a UUID presented as a Git SHA', () => {
        const violations = scanForProhibitions('Commit: 550e8400-e29b-41d4-a716-446655440000 on main.', false);
        expect(violations.some((v) => v.rule === 'NO_UUID_AS_GIT_SHA')).toBe(true);
    });
    it('does NOT flag a real hex string near commit language when evidence is present', () => {
        const violations = scanForProhibitions('Commit: abcdef1 on main.', true);
        // With evidence, this passes – the prohibition checker sees evidenceAvailable=true
        expect(violations.filter((v) => v.rule === 'NO_FAKE_GIT_SHA')).toEqual([]);
    });
    it('flags a hex SHA near commit language when evidence is absent', () => {
        const violations = scanForProhibitions('I committed 1a2b3c4d5e6f to main.', false);
        // Should have at least the commit claim
        expect(violations.some((v) => v.rule === 'NO_SIMULATED_DATA_AS_REAL' || v.rule === 'NO_FAKE_GIT_SHA')).toBe(true);
    });
    it('flags provider deploy claims without confirmation', () => {
        const violations = scanForProhibitions('Render deploy has been triggered.', false);
        expect(violations.some((v) => v.rule === 'NO_DEPLOY_WITHOUT_PROVIDER_CONFIRMATION')).toBe(true);
    });
    it('does not flag provider reference without deploy claim', () => {
        const violations = scanForProhibitions('IVX uses Render for hosting.', false);
        expect(violations.filter((v) => v.rule === 'NO_DEPLOY_WITHOUT_PROVIDER_CONFIRMATION')).toEqual([]);
    });
});
// ---------------------------------------------------------------------------
// Fake-deliverable scanner (no report-file/link/storage tool exists)
// ---------------------------------------------------------------------------
describe('scanForFakeDeliverableClaims', () => {
    it('blocks a placeholder "#" link even when a real deliverable is claimed', () => {
        const violations = scanForFakeDeliverableClaims('[Access Buyer and JV Report](#)', true);
        expect(violations.some((v) => v.rule === 'NO_PLACEHOLDER_LINK')).toBe(true);
    });
    it('blocks an empty-href markdown link', () => {
        const violations = scanForFakeDeliverableClaims('[Download report]()', false);
        expect(violations.some((v) => v.rule === 'NO_PLACEHOLDER_LINK')).toBe(true);
    });
    it('blocks an example.com placeholder href', () => {
        const violations = scanForFakeDeliverableClaims('Here is your file: [report](https://example.com/report.pdf)', false);
        expect(violations.some((v) => v.rule === 'NO_PLACEHOLDER_LINK')).toBe(true);
    });
    it('blocks a "report is ready" claim when no real deliverable exists', () => {
        const violations = scanForFakeDeliverableClaims('The Buyer and JV report is ready for you.', false);
        expect(violations.some((v) => v.rule === 'NO_DELIVERABLE_WITHOUT_REAL_FILE')).toBe(true);
    });
    it('blocks a deferred-delivery promise ("I will deliver the report shortly")', () => {
        const violations = scanForFakeDeliverableClaims('I will deliver the report shortly.', false);
        expect(violations.some((v) => v.rule === 'NO_UNFULFILLED_DELIVERY_PROMISE')).toBe(true);
    });
    it('blocks an open-ended time promise near deliverable language ("30 more minutes")', () => {
        const violations = scanForFakeDeliverableClaims('The report needs 30 more minutes to finish.', false);
        expect(violations.some((v) => v.rule === 'NO_TIME_PROMISE')).toBe(true);
    });
    it('does NOT block deliverable-ready language when a real deliverable exists', () => {
        const violations = scanForFakeDeliverableClaims('The report is ready.', true);
        expect(violations.filter((v) => v.rule === 'NO_DELIVERABLE_WITHOUT_REAL_FILE')).toEqual([]);
    });
    it('does NOT block plain conversational text', () => {
        const violations = scanForFakeDeliverableClaims('Hello, how can I help today?', false);
        expect(violations).toEqual([]);
    });
    it('does NOT flag a bare time word with no deliverable context', () => {
        const violations = scanForFakeDeliverableClaims('I will reply shortly.', false);
        expect(violations.filter((v) => v.rule === 'NO_TIME_PROMISE')).toEqual([]);
    });
});
describe('evaluateEvidenceGate — fake-deliverable integration', () => {
    it('fails the gate on a placeholder report link (the reported symptom)', () => {
        const result = evaluateEvidenceGate({
            answer: 'Your report is ready: [Access Buyer and JV Report](#)',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.passed).toBe(false);
        expect(result.violations.some((v) => v.rule === 'NO_PLACEHOLDER_LINK')).toBe(true);
    });
    it('fails the gate on a "30 more minutes" promise', () => {
        const result = evaluateEvidenceGate({
            answer: 'I need 30 more minutes to finish the report.',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.passed).toBe(false);
        expect(result.violations.some((v) => v.rule === 'NO_TIME_PROMISE' || v.rule === 'NO_UNFULFILLED_DELIVERY_PROMISE')).toBe(true);
    });
    it('passes a real deliverable link when hasRealDeliverable is true', () => {
        const result = evaluateEvidenceGate({
            answer: 'Report saved here: [report](https://storage.ivxholding.com/r/abc.pdf)',
            toolWasExecuted: true,
            evidenceMetadata: buildEvidenceMetadata({ toolName: 't', requestId: 'r', rawOutputRef: 'o' }),
            repoAccessVerified: true,
            hasRealDeliverable: true,
        });
        expect(result.violations.filter((v) => v.rule.startsWith('NO_'))).toEqual([]);
    });
});
// ---------------------------------------------------------------------------
// Claim extraction (requirement 1)
// ---------------------------------------------------------------------------
describe('extractClaims', () => {
    it('returns empty for a plain answer', () => {
        expect(extractClaims('Hello world')).toEqual([]);
    });
    it('extracts code-change claims', () => {
        const claims = extractClaims('I modified a file in the backend.');
        expect(claims.some((c) => c.category === CLAIM_CATEGORY.CODE_CHANGE)).toBe(true);
    });
    it('extracts commit claims', () => {
        const claims = extractClaims('I committed the fix to main.');
        expect(claims.some((c) => c.category === CLAIM_CATEGORY.GIT_COMMIT)).toBe(true);
    });
    it('extracts deploy claims', () => {
        const claims = extractClaims('The fix is deployed and live now.');
        expect(claims.some((c) => c.category === CLAIM_CATEGORY.DEPLOYMENT)).toBe(true);
    });
    it('extracts database mutation claims', () => {
        const claims = extractClaims('I inserted a new record.');
        expect(claims.some((c) => c.category === CLAIM_CATEGORY.DATABASE_MUTATION)).toBe(true);
    });
    it('extracts test result claims (pass format)', () => {
        const claims = extractClaims('All 5 tests pass. Test suite green.');
        expect(claims.some((c) => c.category === CLAIM_CATEGORY.TEST_RESULT)).toBe(true);
    });
    it('extracts multiple claim types', () => {
        const claims = extractClaims('I changed the file, committed it, and deployed it. Tests passed. Database updated.');
        const categories = claims.map((c) => c.category);
        expect(categories).toContain(CLAIM_CATEGORY.CODE_CHANGE);
        expect(categories).toContain(CLAIM_CATEGORY.GIT_COMMIT);
    });
});
// ---------------------------------------------------------------------------
// Evidence gate evaluation (requirement 1)
// ---------------------------------------------------------------------------
describe('evaluateEvidenceGate', () => {
    const sampleMeta = buildEvidenceMetadata({
        toolName: 'ivx_self_developer_runtime',
        requestId: 'req-001',
        rawOutputRef: 'logs/audit/job-001.json',
    });
    it('passes when no claims are present (even without evidence)', () => {
        const result = evaluateEvidenceGate({
            answer: 'Hello, how can I help?',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.passed).toBe(true);
        expect(result.overallLabel).toBe(EVIDENCE_LABEL.NOT_EXECUTED);
        expect(result.claims).toEqual([]);
    });
    it('fails when claims exist but no tool was executed', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix and deployed it.',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.passed).toBe(false);
        expect(result.claims.length).toBeGreaterThan(0);
        expect(result.claims.every((c) => c.label === EVIDENCE_LABEL.NOT_EXECUTED)).toBe(true);
    });
    it('labels claims as UNVERIFIED when tool ran but no metadata', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix and deployed it.',
            toolWasExecuted: true,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.overallLabel).toBe(EVIDENCE_LABEL.UNVERIFIED);
    });
    it('passes when tool was executed with evidence metadata', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix and deployed it.',
            toolWasExecuted: true,
            evidenceMetadata: sampleMeta,
            repoAccessVerified: true,
        });
        expect(result.passed).toBe(true);
        expect(result.overallLabel).toBe(EVIDENCE_LABEL.EXECUTED);
        expect(result.claims.every((c) => c.label === EVIDENCE_LABEL.EXECUTED)).toBe(true);
    });
    it('includes prohibition violations in the result', () => {
        const result = evaluateEvidenceGate({
            answer: 'Commit: 550e8400-e29b-41d4-a716-446655440000 on main.',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.violations.some((v) => v.rule === 'NO_UUID_AS_GIT_SHA')).toBe(true);
        expect(result.passed).toBe(false);
    });
    it('computes overallLabel as NOT_EXECUTED when any claim lacks evidence', () => {
        const result = evaluateEvidenceGate({
            answer: 'I committed the fix.',
            toolWasExecuted: false,
            evidenceMetadata: null,
            repoAccessVerified: false,
        });
        expect(result.overallLabel).toBe(EVIDENCE_LABEL.NOT_EXECUTED);
    });
    it('produces a summary string', () => {
        const result = evaluateEvidenceGate({
            answer: 'Pushed to Render.',
            toolWasExecuted: true,
            evidenceMetadata: sampleMeta,
            repoAccessVerified: true,
        });
        expect(result.summary).toContain('Evidence gate');
        expect(result.summary).toContain('PASSED');
    });
});
// ---------------------------------------------------------------------------
// Answer label injection (requirement 3)
// ---------------------------------------------------------------------------
describe('applyEvidenceLabelToAnswer', () => {
    it('returns answer unchanged when EXECUTED but no claims', () => {
        const answer = 'Committed and deployed successfully.';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: true,
            claims: [],
            violations: [],
            overallLabel: EVIDENCE_LABEL.EXECUTED,
            summary: '',
        });
        expect(result).toBe(answer);
    });
    it('prepends VERIFIED badge when EXECUTED with evidence-backed claims', () => {
        const answer = 'Committed and deployed successfully.';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: true,
            claims: [{ category: CLAIM_CATEGORY.GIT_COMMIT, claimedText: 'committed', evidencePresent: true, metadata: null, label: EVIDENCE_LABEL.EXECUTED, reason: '' }],
            violations: [],
            overallLabel: EVIDENCE_LABEL.EXECUTED,
            summary: '',
        });
        expect(result).toContain('✅ VERIFIED');
        expect(result).toContain(answer);
    });
    it('prepends NOT EXECUTED warning when claims lack evidence', () => {
        const answer = 'I committed the fix.';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: false,
            claims: [{ category: CLAIM_CATEGORY.GIT_COMMIT, claimedText: 'committed', evidencePresent: false, metadata: null, label: EVIDENCE_LABEL.NOT_EXECUTED, reason: '' }],
            violations: [],
            overallLabel: EVIDENCE_LABEL.NOT_EXECUTED,
            summary: '',
        });
        expect(result).toContain('⚠️ NOT EXECUTED');
        expect(result).toContain(answer);
    });
    it('prepends UNVERIFIED warning when evidence unavailable', () => {
        const answer = 'Deploy complete.';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: false,
            claims: [{ category: CLAIM_CATEGORY.DEPLOYMENT, claimedText: 'Deploy', evidencePresent: false, metadata: null, label: EVIDENCE_LABEL.UNVERIFIED, reason: '' }],
            violations: [],
            overallLabel: EVIDENCE_LABEL.UNVERIFIED,
            summary: '',
        });
        expect(result).toContain('⚠️ UNVERIFIED');
    });
    it('prepends SIMULATED warning when data is generated', () => {
        const answer = 'Here is the simulated result.';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: false,
            claims: [],
            violations: [],
            overallLabel: EVIDENCE_LABEL.SIMULATED,
            summary: '',
        });
        expect(result).toContain('⚠️ SIMULATED');
    });
    it('returns answer unchanged when NOT_EXECUTED but no claims', () => {
        const answer = 'Hello there!';
        const result = applyEvidenceLabelToAnswer(answer, {
            passed: true,
            claims: [],
            violations: [],
            overallLabel: EVIDENCE_LABEL.NOT_EXECUTED,
            summary: '',
        });
        expect(result).toBe(answer);
    });
});
// ---------------------------------------------------------------------------
// Stream separation (requirement 5)
// ---------------------------------------------------------------------------
describe('separateStreams', () => {
    it('userVisible stream carries the answer + label', () => {
        const { userVisible } = separateStreams('Deployed successfully.', { passed: true, claims: [], violations: [], overallLabel: EVIDENCE_LABEL.EXECUTED, summary: '' }, 'req-001', null);
        expect(userVisible.stream).toBe('user_chat');
        expect(userVisible.answer).toBe('Deployed successfully.');
        expect(userVisible.evidenceLabel).toBe(EVIDENCE_LABEL.EXECUTED);
    });
    it('internal streams include task_log, watchdog when violations, and audit_report', () => {
        const { internal } = separateStreams('Committed: 550e8400 on main.', {
            passed: false,
            claims: [],
            violations: [{ rule: 'NO_UUID_AS_GIT_SHA', snippet: '550e8400', reason: 'UUID as SHA' }],
            overallLabel: EVIDENCE_LABEL.NOT_EXECUTED,
            summary: 'FAILED',
        }, 'req-002', { result: 'test' });
        const streams = internal.map((s) => s.stream);
        expect(streams).toContain('task_log');
        expect(streams).toContain('watchdog');
        expect(streams).toContain('tool_output');
        expect(streams).toContain('audit_report');
    });
    it('watchdog is NOT included when there are no violations', () => {
        const { internal } = separateStreams('Hello.', { passed: true, claims: [], violations: [], overallLabel: EVIDENCE_LABEL.EXECUTED, summary: '' }, 'req-003', null);
        expect(internal.some((s) => s.stream === 'watchdog')).toBe(false);
    });
    it('tool_output is NOT included when null', () => {
        const { internal } = separateStreams('Hello.', { passed: true, claims: [], violations: [], overallLabel: EVIDENCE_LABEL.EXECUTED, summary: '' }, 'req-004', null);
        expect(internal.some((s) => s.stream === 'tool_output')).toBe(false);
    });
    it('all internal streams have requestId and timestamp', () => {
        const { internal } = separateStreams('Test.', { passed: true, claims: [], violations: [], overallLabel: EVIDENCE_LABEL.EXECUTED, summary: '' }, 'req-005', null);
        for (const stream of internal) {
            expect(stream.requestId).toBe('req-005');
            expect(new Date(stream.timestamp).getTime()).toBeGreaterThan(0);
        }
    });
});
// ---------------------------------------------------------------------------
// Developer mode gate (requirement 6)
// ---------------------------------------------------------------------------
describe('gateDeveloperModeReport', () => {
    const sampleMeta = buildEvidenceMetadata({
        toolName: 'ivx_self_developer_runtime',
        requestId: 'req-001',
        rawOutputRef: 'logs/audit/job.json',
    });
    it('allows when not a developer-mode request', () => {
        const result = gateDeveloperModeReport({ answer: '', toolWasExecuted: false, evidenceMetadata: null, repoAccessVerified: false }, false);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('');
    });
    it('denies when repo access not verified', () => {
        const result = gateDeveloperModeReport({ answer: '', toolWasExecuted: true, evidenceMetadata: sampleMeta, repoAccessVerified: false }, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('repository access');
    });
    it('denies when no tool was executed', () => {
        const result = gateDeveloperModeReport({ answer: '', toolWasExecuted: false, evidenceMetadata: sampleMeta, repoAccessVerified: true }, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('no tool was executed');
    });
    it('denies when evidence metadata is absent', () => {
        const result = gateDeveloperModeReport({ answer: '', toolWasExecuted: true, evidenceMetadata: null, repoAccessVerified: true }, true);
        expect(result.allowed).toBe(false);
        expect(result.reason).toContain('evidence metadata');
    });
    it('allows when all three conditions are met', () => {
        const result = gateDeveloperModeReport({ answer: '', toolWasExecuted: true, evidenceMetadata: sampleMeta, repoAccessVerified: true }, true);
        expect(result.allowed).toBe(true);
        expect(result.reason).toBe('');
        expect(result.gateResult).not.toBeNull();
    });
});
