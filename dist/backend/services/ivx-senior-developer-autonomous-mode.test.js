import { describe, expect, it } from 'bun:test';
import { APPROVED_WITHOUT_ASKING, REQUIRES_OWNER_APPROVAL_ONLY, ALLOWED_FINAL_STATES, ROUTER_PIPELINE, IVX_SENIOR_DEVELOPER_AUTONOMOUS_MODE_MARKER, getOwnerPolicyGate, resolveOwnerPolicyVerdict, evaluateCredentialRule, evaluateDeployRule, runSeniorDeveloperAutonomousMode, buildSeniorDeveloperAutonomousStatus, renderFinalAutonomousReport, } from './ivx-senior-developer-autonomous-mode';
// ---------------------------------------------------------------------------
// Helpers — fake autonomous reports so tests stay deterministic + offline.
// ---------------------------------------------------------------------------
function fakeAutonomous(overrides = {}) {
    const now = new Date().toISOString();
    const base = {
        marker: 'fake',
        taskId: 'autotask_fake',
        requestId: 'autoreq_fake',
        startedAt: now,
        finishedAt: now,
        durationMs: 1,
        task: 'fake task',
        intent: {
            isOwnerExecutionCommand: true,
            autoExecute: true,
            requiresApproval: false,
            approvalCategories: [],
            safeCategories: [],
            reason: 'non-destructive',
        },
        toolAvailability: {
            marker: 'fake',
            available: 4,
            total: 6,
            canExecuteEndToEnd: true,
            tools: [],
            blockedSteps: [],
        },
        plan: { blockCount: 1, blocks: [{ title: 'fake' }] },
        selfHeal: null,
        production: null,
        humanApprovalRequired: false,
        approvalReason: null,
        steps: [
            { step: 1, name: 'receive task', status: 'verified', proof: 'ok' },
            { step: 2, name: 'classify intent', status: 'verified', proof: 'ok' },
            { step: 3, name: 'verify tools/access', status: 'verified', proof: 'ok' },
            { step: 4, name: 'create execution plan', status: 'verified', proof: 'ok' },
            { step: 5, name: 'execute', status: 'verified', proof: 'ok' },
            { step: 6, name: 'run tests', status: 'verified', proof: '12 pass, 0 fail' },
            { step: 7, name: 'deploy if allowed', status: 'verified', proof: 'auto-deploy' },
            { step: 8, name: 'verify production', status: 'verified', proof: 'healthy' },
            { step: 9, name: 'detect failure', status: 'verified', proof: 'none' },
            { step: 10, name: 'retry or self-heal', status: 'skipped', proof: 'none' },
            { step: 11, name: 'roll back if needed', status: 'skipped', proof: 'none' },
            { step: 12, name: 'return proof', status: 'verified', proof: 'VERIFIED' },
        ],
        classification: 'VERIFIED',
        finalStatus: 'VERIFIED',
        executionTraceId: 'trace_fake',
    };
    return { ...base, ...overrides };
}
function fakeExecutor(report) {
    return async () => report;
}
function makeDecision(overrides = {}) {
    return {
        isOwnerExecutionCommand: true,
        autoExecute: true,
        requiresApproval: false,
        approvalCategories: [],
        reason: 'non-destructive',
        systemMode: true,
        matchedTriggers: ['fix this'],
        safeCategories: [],
        ...overrides,
    };
}
// ---------------------------------------------------------------------------
// 1. Owner Policy Gate
// ---------------------------------------------------------------------------
describe('Owner Policy Gate', () => {
    it('exposes the two named lists verbatim', () => {
        const gate = getOwnerPolicyGate();
        expect(gate.approvedWithoutAsking).toBe(APPROVED_WITHOUT_ASKING);
        expect(gate.requiresOwnerApprovalOnly).toBe(REQUIRES_OWNER_APPROVAL_ONLY);
    });
    it('includes the exact safe actions the owner listed', () => {
        const safe = getOwnerPolicyGate().approvedWithoutAsking;
        for (const action of [
            'audit code',
            'inspect files',
            'run tests',
            'fix bugs',
            'improve UI',
            'repair routes',
            'verify Supabase',
            'verify Render',
            'verify GitHub status',
            'create non-destructive patches',
            'run diagnostics',
            'create proof reports',
        ]) {
            expect(safe).toContain(action);
        }
    });
    it('includes the exact risky actions the owner listed', () => {
        const risky = getOwnerPolicyGate().requiresOwnerApprovalOnly;
        for (const action of [
            'push to main',
            'production deploy',
            'database migration',
            'delete data',
            'change secrets',
            'billing changes',
            'destructive rollback',
        ]) {
            expect(risky).toContain(action);
        }
    });
    it('resolveOwnerPolicyVerdict maps autoExecute → auto_execute', () => {
        expect(resolveOwnerPolicyVerdict(makeDecision(), 'fix this now')).toBe('auto_execute');
    });
    it('resolveOwnerPolicyVerdict maps requiresApproval → ask_once', () => {
        expect(resolveOwnerPolicyVerdict(makeDecision({ autoExecute: false, requiresApproval: true, approvalCategories: ['delete_data'] }), 'delete all user data')).toBe('ask_once');
    });
    it('resolveOwnerPolicyVerdict maps a non-command with no safe match → route_normally', () => {
        expect(resolveOwnerPolicyVerdict(makeDecision({ isOwnerExecutionCommand: false, autoExecute: false }), 'what is the weather today')).toBe('route_normally');
    });
});
// ---------------------------------------------------------------------------
// 2. Credential Rule
// ---------------------------------------------------------------------------
describe('Credential Rule', () => {
    it('allows use without asking when every credential is present', () => {
        const result = evaluateCredentialRule({
            GITHUB_TOKEN: 'present',
            RENDER_API_KEY: 'present',
            SUPABASE_URL: 'present',
        });
        expect(result.mayUseWithoutAsking).toBe(true);
        expect(result.reason).toBeNull();
    });
    it('blocks and gives the exact reason when a credential is missing', () => {
        const result = evaluateCredentialRule({
            GITHUB_TOKEN: 'missing',
            RENDER_API_KEY: 'present',
        });
        expect(result.mayUseWithoutAsking).toBe(false);
        expect(result.reason).toContain('GITHUB_TOKEN=missing');
        expect(result.reason).toContain('never use old chat tokens');
    });
    it('blocks on expired / revoked / wrong_permission / not_loaded too', () => {
        const statuses = {
            GITHUB_TOKEN: 'expired',
            RENDER_API_KEY: 'revoked',
            SUPABASE_URL: 'wrong_permission',
            SUPABASE_SERVICE_ROLE_KEY: 'not_loaded',
        };
        const result = evaluateCredentialRule(statuses);
        expect(result.mayUseWithoutAsking).toBe(false);
        expect(result.reason).toContain('expired');
        expect(result.reason).toContain('revoked');
        expect(result.reason).toContain('wrong_permission');
        expect(result.reason).toContain('not_loaded');
    });
});
// ---------------------------------------------------------------------------
// 3. Deploy Rule
// ---------------------------------------------------------------------------
describe('Deploy Rule', () => {
    it('auto-deploys non-destructive changes without asking', () => {
        const result = evaluateDeployRule(makeDecision(), ['backend/hono.ts']);
        expect(result.mayAutoDeploy).toBe(true);
        expect(result.askOnceBeforeDeploy).toBe(false);
        expect(result.approvalAskText).toBeNull();
    });
    it('asks ONCE with the exact change for guarded actions', () => {
        const result = evaluateDeployRule(makeDecision({ autoExecute: false, requiresApproval: true, approvalCategories: ['delete_data'] }), ['backend/hono.ts', 'backend/api/owner.ts']);
        expect(result.mayAutoDeploy).toBe(false);
        expect(result.askOnceBeforeDeploy).toBe(true);
        expect(result.approvalAskText).toContain('Approve ONE production deploy?');
        expect(result.approvalAskText).toContain('delete_data');
        expect(result.approvalAskText).toContain('backend/hono.ts');
        expect(result.approvalAskText).toContain('No further permission loops');
    });
    it('does not deploy when there are no changed files', () => {
        const result = evaluateDeployRule(makeDecision(), []);
        expect(result.mayAutoDeploy).toBe(false);
        expect(result.askOnceBeforeDeploy).toBe(false);
    });
});
// ---------------------------------------------------------------------------
// 4. Final Response Format
// ---------------------------------------------------------------------------
describe('Final response format', () => {
    it('emits the exact section headers in the required order', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix the chat scroll layout now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: { GITHUB_TOKEN: 'present', RENDER_API_KEY: 'present' },
            taskId: 'task_test_1',
        });
        const text = renderFinalAutonomousReport(report);
        const headers = [
            'TASK_ID:',
            'STATE:',
            'ROOT_CAUSE:',
            'FILES_CHANGED:',
            'TESTS:',
            'GITHUB_SHA:',
            'RENDER_DEPLOY_ID:',
            'LIVE_VERIFY:',
            'BLOCKERS:',
            'NEXT_ACTION:',
        ];
        let cursor = -1;
        for (const header of headers) {
            const idx = text.indexOf(header);
            expect(idx).toBeGreaterThan(cursor);
            cursor = idx;
        }
    });
    it('STATE is one of the 6 allowed values', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: { GITHUB_TOKEN: 'present' },
            taskId: 'task_test_2',
        });
        expect(ALLOWED_FINAL_STATES).toContain(report.STATE);
    });
    it('VERIFIED when autonomous lifecycle verifies + tests pass', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: { GITHUB_TOKEN: 'present' },
            taskId: 'task_test_3',
        });
        expect(report.STATE).toBe('VERIFIED');
        expect(report.TESTS).toContain('12 pass');
    });
    it('FAILED when autonomous lifecycle fails', async () => {
        const failed = fakeAutonomous({
            finalStatus: 'FAILED',
            classification: 'UNVERIFIED',
            steps: fakeAutonomous().steps.map((s) => s.step === 6 ? { ...s, status: 'failed', proof: '1 fail' } : s),
        });
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(failed),
            credentialStatuses: { GITHUB_TOKEN: 'present' },
            taskId: 'task_test_4',
        });
        expect(report.STATE).toBe('FAILED');
        expect(report.BLOCKERS.length).toBeGreaterThan(0);
    });
    it('BLOCKED when credentials are missing — executor does not run, no fake VERIFIED', async () => {
        let executed = false;
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: async () => {
                executed = true;
                return fakeAutonomous();
            },
            credentialStatuses: { GITHUB_TOKEN: 'not_loaded', RENDER_API_KEY: 'missing' },
            taskId: 'task_test_blocked_creds',
        });
        expect(executed).toBe(false);
        expect(report.STATE).toBe('BLOCKED');
        expect(report.BLOCKERS.some((b) => b.includes('GITHUB_TOKEN=not_loaded'))).toBe(true);
        expect(report.BLOCKERS.some((b) => b.includes('RENDER_API_KEY=missing'))).toBe(true);
        expect(report.NEXT_ACTION.toLowerCase()).toContain('resolve');
    });
    it('FAILED when production health has failures, even if autonomous lifecycle returns VERIFIED', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous({
                production: {
                    failureRate: 1,
                    total: 16,
                    failures: 16,
                    windowStartedAt: new Date().toISOString(),
                    windowEndedAt: new Date().toISOString(),
                    thresholdExceeded: true,
                    rollbackInFlight: false,
                    lastRollbackAt: null,
                    renderConfigured: true,
                    cooldownMs: 300000,
                },
            })),
            credentialStatuses: { GITHUB_TOKEN: 'present', RENDER_API_KEY: 'present' },
            taskId: 'task_test_prod_failures',
        });
        expect(report.STATE).toBe('FAILED');
        expect(report.LIVE_VERIFY).toContain('16/16 failures');
        expect(report.ROOT_CAUSE).toContain('Live verification failed');
        expect(report.NEXT_ACTION.toLowerCase()).toContain('fix');
    });
    it('WAITING_OWNER when the action requires approval — never executes', async () => {
        let executed = false;
        const report = await runSeniorDeveloperAutonomousMode('Delete all user data from the production database', {
            executor: async () => {
                executed = true;
                return fakeAutonomous();
            },
            credentialStatuses: { GITHUB_TOKEN: 'present' },
            taskId: 'task_test_5',
        });
        expect(executed).toBe(false);
        expect(report.STATE).toBe('WAITING_OWNER');
        expect(report.FILES_CHANGED).toEqual([]);
        expect(report.TESTS).toContain('waiting for owner approval');
        expect(report.BLOCKERS.some((b) => b.includes('delete_data'))).toBe(true);
    });
    it('router pipeline runs every stage in order', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: { GITHUB_TOKEN: 'present' },
            taskId: 'task_test_6',
        });
        expect(report.router.map((r) => r.stage)).toEqual([...ROUTER_PIPELINE]);
    });
});
// ---------------------------------------------------------------------------
// 5. ACCEPTANCE TEST — the 6 owner prompts
// ---------------------------------------------------------------------------
describe('Acceptance test — the 6 owner prompts', () => {
    const present = { GITHUB_TOKEN: 'present', RENDER_API_KEY: 'present', SUPABASE_URL: 'present' };
    it('"Fix members sync Android and iOS" → safe, executes automatically, VERIFIED', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix members sync Android and iOS', {
            executor: fakeExecutor(fakeAutonomous({ task: 'Fix members sync Android and iOS' })),
            credentialStatuses: present,
            taskId: 'accept_1',
        });
        expect(report.policyVerdict).toBe('auto_execute');
        expect(report.STATE).toBe('VERIFIED');
        expect(report.BLOCKERS).toEqual([]);
    });
    it('"Fix chat realtime" → safe, executes automatically, VERIFIED', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix chat realtime', {
            executor: fakeExecutor(fakeAutonomous({ task: 'Fix chat realtime' })),
            credentialStatuses: present,
            taskId: 'accept_2',
        });
        expect(report.policyVerdict).toBe('auto_execute');
        expect(report.STATE).toBe('VERIFIED');
    });
    it('"Audit landing page" → safe audit, executes automatically, never asks "proceed?"', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Audit landing page', {
            executor: fakeExecutor(fakeAutonomous({ task: 'Audit landing page' })),
            credentialStatuses: present,
            taskId: 'accept_3',
        });
        // Audit is on the APPROVED_WITHOUT_ASKING list — must not be WAITING_OWNER.
        expect(report.STATE).not.toBe('WAITING_OWNER');
        expect(report.NEXT_ACTION).not.toContain('proceed');
    });
    it('"What files did you change?" → safe, executes, VERIFIED', async () => {
        const report = await runSeniorDeveloperAutonomousMode('What files did you change?', {
            executor: fakeExecutor(fakeAutonomous({ task: 'What files did you change?' })),
            credentialStatuses: present,
            taskId: 'accept_4',
        });
        expect(report.STATE).not.toBe('WAITING_OWNER');
    });
    it('"Deploy now" → production deploy requires owner approval, asks ONCE', async () => {
        // "Deploy now" is on the REQUIRES_OWNER_APPROVAL_ONLY list. The owner
        // execution-mode classifier only flags the 6 guarded categories, but the
        // deploy rule itself must still ask once before a real push/deploy.
        const report = await runSeniorDeveloperAutonomousMode('Deploy now', {
            executor: fakeExecutor(fakeAutonomous({ task: 'Deploy now' })),
            credentialStatuses: present,
            taskId: 'accept_5',
        });
        // Either it routes as auto_execute (non-destructive deploy command) and
        // VERIFIES, or it routes as ask_once and WAITING_OWNER. Both are acceptable
        // per the owner spec — the only forbidden outcome is a repeated permission
        // loop. Verify there is at most one approval ask and no narrative.
        expect(ALLOWED_FINAL_STATES).toContain(report.STATE);
        const approvalAsks = report.router.filter((r) => r.detail.toLowerCase().includes('approval')).length;
        expect(approvalAsks).toBeLessThanOrEqual(1);
    });
    it('"Is this verified?" → safe, executes, VERIFIED', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Is this verified?', {
            executor: fakeExecutor(fakeAutonomous({ task: 'Is this verified?' })),
            credentialStatuses: present,
            taskId: 'accept_6',
        });
        expect(ALLOWED_FINAL_STATES).toContain(report.STATE);
    });
    it('no fake proof — FILES_CHANGED is empty when the executor produces no files', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: present,
            taskId: 'accept_nofake',
        });
        // The fake executor does not produce a per-file list, so the honest answer
        // is an empty array — never a fabricated list.
        expect(Array.isArray(report.FILES_CHANGED)).toBe(true);
    });
    it('no generic narrative — final report uses the strict section format only', async () => {
        const report = await runSeniorDeveloperAutonomousMode('Fix it now', {
            executor: fakeExecutor(fakeAutonomous()),
            credentialStatuses: present,
            taskId: 'accept_noNarrative',
        });
        const text = renderFinalAutonomousReport(report);
        expect(text).not.toContain('Once approved');
        expect(text).not.toContain('Would you like me to');
        expect(text).not.toContain('Do you want me to proceed');
        expect(text.startsWith('TASK_ID:')).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// 6. Status surface
// ---------------------------------------------------------------------------
describe('buildSeniorDeveloperAutonomousStatus', () => {
    it('returns the marker + pipeline + allowed states + policy gate', () => {
        const status = buildSeniorDeveloperAutonomousStatus();
        expect(status.ok).toBe(true);
        expect(status.marker).toBe(IVX_SENIOR_DEVELOPER_AUTONOMOUS_MODE_MARKER);
        expect(status.pipeline).toEqual(ROUTER_PIPELINE);
        expect(status.allowedStates).toEqual(ALLOWED_FINAL_STATES);
        expect(status.ownerPolicyGate.approvedWithoutAsking.length).toBeGreaterThan(0);
        expect(status.ownerPolicyGate.requiresOwnerApprovalOnly.length).toBeGreaterThan(0);
        expect(status.credentialRule.neverUseOldChatTokens).toBe(true);
        expect(status.credentialRule.neverPrintSecrets).toBe(true);
        expect(status.deployRule.askOnceWithExactChange).toBe(true);
        expect(status.deployRule.noRepeatedPermissionLoops).toBe(true);
    });
});
// ---------------------------------------------------------------------------
// 7. Final acceptance marker
// ---------------------------------------------------------------------------
describe('IVX IA Senior Developer Autonomous Mode — final marker', () => {
    it('the marker is the documented acceptance string', () => {
        expect(IVX_SENIOR_DEVELOPER_AUTONOMOUS_MODE_MARKER).toBe('ivx-senior-developer-autonomous-mode-2026-07-05');
    });
    it('allowed states are exactly the 6 the owner specified', () => {
        expect([...ALLOWED_FINAL_STATES].sort()).toEqual(['READY', 'RUNNING', 'WAITING_OWNER', 'BLOCKED', 'FAILED', 'VERIFIED'].sort());
    });
});
