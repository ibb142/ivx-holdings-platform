/**
 * IVX IA Senior Developer — Final Autonomous Mode
 *
 * The single entry point that makes IVX IA behave like a real senior developer
 * 24/7: it executes safe engineering work end-to-end WITHOUT asking "proceed?"
 * on every step, and asks for owner approval ONLY for genuinely risky actions.
 *
 * This module composes the proven primitives that already exist:
 *   - ivx-owner-execution-mode  → classify intent + 6 safety gates
 *   - ivx-autonomous-mode       → the 12-step self-heal lifecycle
 *   - ivx-tool-availability      → live credential/tool check
 *   - ivx-senior-developer-answer-format → strict evidence format
 *
 * What is NEW here (and required by the owner's policy):
 *   1. OwnerPolicyGate — the two named lists (APPROVED_WITHOUT_ASKING /
 *      REQUIRES_OWNER_APPROVAL_ONLY) as an explicit, queryable contract.
 *   2. SeniorDeveloperRouter — Owner Chat → Router → Pre-Execution Gate →
 *      Executor → Tests → Proof Ledger → Final Evidence. Never generic AI chat.
 *   3. FinalAutonomousReport — the exact owner-required response format:
 *        TASK_ID / STATE / ROOT_CAUSE / FILES_CHANGED / TESTS / GITHUB_SHA /
 *        RENDER_DEPLOY_ID / LIVE_VERIFY / BLOCKERS / NEXT_ACTION
 *      with the 6 allowed states:
 *        READY · RUNNING · WAITING_OWNER · BLOCKED · FAILED · VERIFIED
 *   4. CredentialRule — never ask for credentials unless a live check proves
 *      they are missing / expired / revoked / wrong-permission / not loaded.
 *      Never use old chat tokens. Never print secrets.
 *   5. DeployRule — prepare commit; if push/deploy is risky, ask ONCE with the
 *      exact change; after approval, push/deploy and verify /health + /version.
 *      No repeated permission loops.
 *
 * Runtime-free and deterministic (no network / filesystem / AI gateway) so it
 * is fully unit-testable. The heavy execution is INJECTABLE via `executor`.
 */
import { classifyOwnerExecutionCommand, listOwnerApprovalGates, listOwnerSafeCategories, } from './ivx-owner-execution-mode';
import { runAutonomousMode, } from './ivx-autonomous-mode';
import { checkToolAvailability } from './ivx-tool-availability';
// ─────────────────────────────────────────────────────────────────────────────
// 1. OWNER POLICY GATE — the two named lists
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Standing owner approval for SAFE engineering actions. IVX IA executes these
 * end-to-end WITHOUT asking "proceed?" first. This is the source of truth —
 * every other gate reads from this list.
 */
export const APPROVED_WITHOUT_ASKING = [
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
];
/**
 * Actions that REQUIRES owner approval — and only owner approval. IVX IA asks
 * ONCE with the exact change, then executes. No repeated permission loops.
 */
export const REQUIRES_OWNER_APPROVAL_ONLY = [
    'push to main',
    'production deploy',
    'database migration',
    'delete data',
    'change secrets',
    'billing changes',
    'destructive rollback',
];
/** The fixed, queryable owner policy gate. Exposed for status/proof endpoints. */
export function getOwnerPolicyGate() {
    return {
        approvedWithoutAsking: APPROVED_WITHOUT_ASKING,
        requiresOwnerApprovalOnly: REQUIRES_OWNER_APPROVAL_ONLY,
    };
}
/**
 * Policy-level matcher for the APPROVED_WITHOUT_ASKING list. The owner's
 * policy says: if the task is safe, IVX IA executes — no "proceed?" prompt.
 * This catches safe imperatives ("fix members sync", "audit landing page",
 * "verify Supabase", "run tests", "inspect files") that the lower-level
 * execution-trigger regex may miss because it expects "fix it/this/that/now".
 * Returns the matched safe action, or null when no safe action matches.
 */
export function matchApprovedWithoutAsking(task) {
    const normalized = task.trim().toLowerCase().replace(/\s+/g, ' ');
    if (!normalized)
        return null;
    // Ordered most-specific first so "verify Supabase" wins over a bare "verify".
    const matchers = [
        { action: 'verify Supabase', pattern: /\b(supabase)\b.{0,40}\b(verify|check|inspect|status|health|connection|connect)\b|\b(verify|check|inspect|status|health)\b.{0,40}\b(supabase)\b/ },
        { action: 'verify Render', pattern: /\b(render)\b.{0,40}\b(verify|check|inspect|status|health|deploy)\b|\b(verify|check|inspect|status|health)\b.{0,40}\b(render)\b/ },
        { action: 'verify GitHub status', pattern: /\b(github)\b.{0,40}\b(verify|check|inspect|status|state|sync|push|repo)\b|\b(verify|check|inspect|status|state|sync)\b.{0,40}\b(github)\b/ },
        { action: 'audit code', pattern: /\b(audit|review)\b.{0,30}\b(code|source|files?|repo|module|component|implementation)\b/ },
        { action: 'inspect files', pattern: /\b(inspect|read|open|view|look at|examine)\b.{0,30}\b(files?|code|source|paths?)\b/ },
        { action: 'run tests', pattern: /\b(run|execute|trigger)\b.{0,20}\b(tests?|test\s+suite|specs?|unit\s+tests?|integration\s+tests?)\b/ },
        { action: 'fix bugs', pattern: /\b(fix|repair|patch|resolve|debug)\b.{0,40}\b(bugs?|issues?|errors?|problems?|crash|broken|failing|fail|sync|realtime|real-time|chat|members?|loading|scroll|layout|api|route|endpoint|auth|login)\b/ },
        { action: 'improve UI', pattern: /\b(improve|refine|polish|enhance|update|fix)\b.{0,30}\b(ui|interface|button|screen|component|view|modal|sheet|layout|spacing|color|colour|theme|style|styling)\b/ },
        { action: 'repair routes', pattern: /\b(repair|fix|restore|rebuild)\b.{0,30}\b(routes?|navigation|links?|endpoints?|paths?)\b/ },
        { action: 'create non-destructive patches', pattern: /\b(create|make|prepare|generate|write)\b.{0,30}\b(non[-\s]?destructive\s+patches?|safe\s+patches?|patches?|fix)\b/ },
        { action: 'run diagnostics', pattern: /\b(run|start|execute|trigger)\b.{0,20}\b(diagnostics?|diagnostic\s+(?:check|scan|report)|health\s+check|smoke\s+test)\b/ },
        { action: 'create proof reports', pattern: /\b(create|generate|write|produce|build)\b.{0,30}\b(proof\s+reports?|evidence\s+reports?|audit\s+reports?|proof\s+ledger)\b/ },
    ];
    for (const { action, pattern } of matchers) {
        if (pattern.test(normalized))
            return action;
    }
    return null;
}
export function resolveOwnerPolicyVerdict(decision, task) {
    if (decision.requiresApproval)
        return 'ask_once';
    if (decision.autoExecute)
        return 'auto_execute';
    // The lower-level classifier may not flag a safe imperative as an execution
    // command (it expects "fix it/this/that/now"). The owner's policy is explicit:
    // safe actions on the APPROVED_WITHOUT_ASKING list execute automatically.
    const safeMatch = matchApprovedWithoutAsking(task);
    if (safeMatch)
        return 'auto_execute';
    if (decision.isOwnerExecutionCommand)
        return 'auto_execute';
    return 'route_normally';
}
export const ALLOWED_FINAL_STATES = [
    'READY',
    'RUNNING',
    'WAITING_OWNER',
    'BLOCKED',
    'FAILED',
    'VERIFIED',
];
export const ROUTER_PIPELINE = [
    'owner_chat',
    'senior_developer_router',
    'pre_execution_gate',
    'executor',
    'tests',
    'proof_ledger',
    'final_evidence',
];
/**
 * CredentialRule: never ask for credentials unless a live check proves they are
 * missing / expired / revoked / wrong-permission / not-loaded. The caller MUST
 * supply the live statuses (read from process.env + live backend verification);
 * this function never reads them itself so it stays deterministic + testable.
 */
export function evaluateCredentialRule(liveStatuses) {
    const entries = Object.entries(liveStatuses);
    const blocking = entries.filter(([, status]) => status !== 'present');
    if (blocking.length === 0) {
        return {
            mayUseWithoutAsking: true,
            statuses: liveStatuses,
            reason: null,
        };
    }
    const reasons = blocking.map(([name, status]) => `${name}=${status}`);
    return {
        mayUseWithoutAsking: false,
        statuses: liveStatuses,
        reason: `Live check proved credential issue(s): ${reasons.join(', ')}. Ask the owner once, never use old chat tokens.`,
    };
}
/**
 * DeployRule: if a code change affects production, prepare the commit. If the
 * push/deploy is risky (an owner-approval-only category), ask ONCE with the
 * exact change; after approval, push/deploy and verify /health + /version.
 * No repeated permission loops.
 */
export function evaluateDeployRule(decision, changedFiles) {
    const hasCodeChange = changedFiles.length > 0;
    if (!hasCodeChange) {
        return { mayAutoDeploy: false, askOnceBeforeDeploy: false, approvalAskText: null };
    }
    if (decision.requiresApproval) {
        const categories = decision.approvalCategories.join(', ') || 'a guarded production action';
        const fileList = changedFiles.slice(0, 8).join(', ');
        return {
            mayAutoDeploy: false,
            askOnceBeforeDeploy: true,
            approvalAskText: `Approve ONE production deploy?\nCategories: ${categories}\nFiles: ${fileList}\n` +
                `After approval I will push to main → trigger Render deploy → verify /health and /version. No further permission loops.`,
        };
    }
    // Non-destructive change — ships via push-to-main auto-deploy (render.yaml
    // autoDeployTrigger: commit). The autonomous-mode step 7 verifies this path.
    return {
        mayAutoDeploy: true,
        askOnceBeforeDeploy: false,
        approvalAskText: null,
    };
}
/**
 * Render the report as the exact owner-facing text block. Section headers in
 * the required order; nothing else. No narrative prose.
 */
export function renderFinalAutonomousReport(report) {
    const lines = [
        `TASK_ID: ${report.TASK_ID}`,
        `STATE: ${report.STATE}`,
        `ROOT_CAUSE: ${report.ROOT_CAUSE}`,
        `FILES_CHANGED: ${report.FILES_CHANGED.length > 0 ? report.FILES_CHANGED.join(', ') : 'none'}`,
        `TESTS: ${report.TESTS}`,
        `GITHUB_SHA: ${report.GITHUB_SHA ?? 'none'}`,
        `RENDER_DEPLOY_ID: ${report.RENDER_DEPLOY_ID ?? 'none'}`,
        `LIVE_VERIFY: ${report.LIVE_VERIFY}`,
        `BLOCKERS: ${report.BLOCKERS.length > 0 ? report.BLOCKERS.join('; ') : 'none'}`,
        `NEXT_ACTION: ${report.NEXT_ACTION}`,
    ];
    return lines.join('\n');
}
// ─────────────────────────────────────────────────────────────────────────────
// 6. THE ROUTER — runs the full pipeline and emits the final report
// ─────────────────────────────────────────────────────────────────────────────
function genTaskId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `ivx-senior-dev_${crypto.randomUUID()}`;
    }
    return `ivx-senior-dev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
    return new Date().toISOString();
}
/**
 * The single pipeline: Owner Chat → Senior Developer Router → Pre-Execution
 * Gate → Executor → Tests → Proof Ledger → Final Evidence. Never throws —
 * failures surface as a FAILED state with the exact blocker.
 */
export async function runSeniorDeveloperAutonomousMode(task, options = {}) {
    const taskId = options.taskId ?? genTaskId();
    const router = [];
    const blockers = [];
    const exactTask = typeof task === 'string' ? task : String(task ?? '');
    // Stage 1: owner_chat
    router.push({
        stage: 'owner_chat',
        status: exactTask.trim().length > 0 ? 'passed' : 'failed',
        detail: exactTask.trim().length > 0
            ? `Owner task received (${exactTask.length} chars), copied exactly.`
            : 'Empty task — nothing to route.',
    });
    // Stage 2: senior_developer_router (classify intent + policy verdict)
    const decision = classifyOwnerExecutionCommand(exactTask);
    const safeMatch = matchApprovedWithoutAsking(exactTask);
    const policyVerdict = resolveOwnerPolicyVerdict(decision, exactTask);
    router.push({
        stage: 'senior_developer_router',
        status: 'passed',
        detail: `policyVerdict=${policyVerdict}; autoExecute=${decision.autoExecute}; requiresApproval=${decision.requiresApproval}${decision.approvalCategories.length > 0 ? `; categories=${decision.approvalCategories.join(',')}` : ''}${safeMatch ? `; safeAction=${safeMatch}` : ''}; reason=${decision.reason}`,
    });
    // Stage 3: pre_execution_gate (credential + tool + policy check)
    const toolAvailability = checkToolAvailability();
    const credentialStatuses = options.credentialStatuses ?? deriveCredentialStatuses(toolAvailability);
    const credentialRule = evaluateCredentialRule(credentialStatuses);
    let gateHeld = false;
    if (policyVerdict === 'ask_once') {
        gateHeld = true;
        blockers.push(`Owner approval required (ask ONCE): ${decision.approvalCategories.join(', ')}. ${decision.reason}`);
    }
    if (!credentialRule.mayUseWithoutAsking && credentialRule.reason) {
        blockers.push(credentialRule.reason);
    }
    router.push({
        stage: 'pre_execution_gate',
        status: gateHeld ? 'held' : 'passed',
        detail: gateHeld
            ? `Held for one-time owner approval. Credential rule: ${credentialRule.mayUseWithoutAsking ? 'ok' : 'blocked'}.`
            : `Gate passed. Tools ${toolAvailability.available}/${toolAvailability.total}. Credential rule ok.`,
    });
    // WAITING_OWNER path: risky action — ask ONCE, never execute yet.
    if (gateHeld) {
        router.push({ stage: 'executor', status: 'skipped', detail: 'Held — waiting for one-time owner approval.' });
        router.push({ stage: 'tests', status: 'skipped', detail: 'Held — no execution.' });
        router.push({ stage: 'proof_ledger', status: 'passed', detail: `Ledger entry recorded; taskId=${taskId}.` });
        router.push({ stage: 'final_evidence', status: 'passed', detail: 'WAITING_OWNER returned.' });
        return {
            TASK_ID: taskId,
            STATE: 'WAITING_OWNER',
            ROOT_CAUSE: `Guarded action requires owner confirmation: ${decision.approvalCategories.join(', ')}.`,
            FILES_CHANGED: [],
            TESTS: 'not run — waiting for owner approval',
            GITHUB_SHA: null,
            RENDER_DEPLOY_ID: null,
            LIVE_VERIFY: 'not run — waiting for owner approval',
            BLOCKERS: blockers,
            NEXT_ACTION: 'Reply with the exact action + confirmation text. After approval I push/deploy/verify with no further prompts.',
            router,
            policyVerdict,
            autonomous: null,
        };
    }
    // BLOCKED path: credential or tool blockers proved by live check — never run
    // the executor or claim verification. The credential rule already proved the
    // exact issue; returning BLOCKED prevents the fake "STATE: VERIFIED" narrative.
    if (blockers.length > 0) {
        router.push({ stage: 'executor', status: 'skipped', detail: `Blocked — ${blockers[0] ?? 'credential/tool gate failed'}.` });
        router.push({ stage: 'tests', status: 'skipped', detail: 'Blocked — no execution.' });
        router.push({ stage: 'proof_ledger', status: 'passed', detail: `Ledger entry recorded; taskId=${taskId}.` });
        router.push({ stage: 'final_evidence', status: 'passed', detail: 'BLOCKED returned.' });
        return {
            TASK_ID: taskId,
            STATE: 'BLOCKED',
            ROOT_CAUSE: blockers[0] ?? 'Credential or tool gate failed live check.',
            FILES_CHANGED: [],
            TESTS: 'not run — blocked before execution',
            GITHUB_SHA: null,
            RENDER_DEPLOY_ID: null,
            LIVE_VERIFY: 'not run — blocked before execution',
            BLOCKERS: blockers,
            NEXT_ACTION: 'Resolve the listed blocker (credential / tool / missing input), then re-run the same task.',
            router,
            policyVerdict,
            autonomous: null,
        };
    }
    // Stage 4: executor — run the autonomous lifecycle.
    let autonomous = null;
    try {
        const runner = options.executor ?? runAutonomousMode;
        autonomous = await runner(exactTask, options);
        router.push({
            stage: 'executor',
            status: 'passed',
            detail: `Autonomous lifecycle finished: finalStatus=${autonomous.finalStatus}; classification=${autonomous.classification}.`,
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        blockers.push(`Executor threw: ${message}`);
        router.push({ stage: 'executor', status: 'failed', detail: `Executor threw: ${message}` });
        router.push({ stage: 'tests', status: 'skipped', detail: 'Executor failed.' });
        router.push({ stage: 'proof_ledger', status: 'passed', detail: `Ledger entry recorded; taskId=${taskId}.` });
        router.push({ stage: 'final_evidence', status: 'passed', detail: 'FAILED returned.' });
        return {
            TASK_ID: taskId,
            STATE: 'FAILED',
            ROOT_CAUSE: `Executor threw: ${message}`,
            FILES_CHANGED: [],
            TESTS: 'not run — executor failed',
            GITHUB_SHA: null,
            RENDER_DEPLOY_ID: null,
            LIVE_VERIFY: 'not run — executor failed',
            BLOCKERS: blockers,
            NEXT_ACTION: 'Inspect the executor error, fix the smallest safe issue, then re-run.',
            router,
            policyVerdict,
            autonomous: null,
        };
    }
    // Stage 5: tests — read the autonomous report's test stage.
    const testStep = autonomous.steps.find((s) => s.step === 6);
    const testsOk = testStep?.status === 'verified';
    router.push({
        stage: 'tests',
        status: testsOk ? 'passed' : testStep?.status === 'skipped' ? 'skipped' : 'failed',
        detail: testStep?.proof ?? 'No test stage produced.',
    });
    if (!testsOk && testStep?.status !== 'skipped') {
        blockers.push(`Tests failed: ${testStep?.proof ?? 'unknown'}`);
    }
    // Stage 6: proof_ledger — the autonomous report already recorded the trace.
    router.push({
        stage: 'proof_ledger',
        status: 'passed',
        detail: `Trace id=${autonomous.executionTraceId ?? 'n/a'}; classification=${autonomous.classification}.`,
    });
    // Stage 7: final_evidence — derive the final state + proof fields.
    const changedFiles = extractChangedFiles(autonomous);
    const githubSha = extractGithubSha(autonomous);
    const renderDeployId = extractRenderDeployId(autonomous);
    const liveVerify = autonomous.production
        ? `health=${autonomous.production.failures}/${autonomous.production.total} failures; thresholdExceeded=${autonomous.production.thresholdExceeded}`
        : 'not run';
    const finalState = deriveFinalState(autonomous, testsOk, blockers);
    router.push({
        stage: 'final_evidence',
        status: 'passed',
        detail: `STATE=${finalState}; filesChanged=${changedFiles.length}; githubSha=${githubSha ?? 'none'}; renderDeployId=${renderDeployId ?? 'none'}.`,
    });
    return {
        TASK_ID: taskId,
        STATE: finalState,
        ROOT_CAUSE: deriveRootCause(autonomous, blockers),
        FILES_CHANGED: changedFiles,
        TESTS: testStep?.proof ?? 'no test stage produced',
        GITHUB_SHA: githubSha,
        RENDER_DEPLOY_ID: renderDeployId,
        LIVE_VERIFY: liveVerify,
        BLOCKERS: blockers,
        NEXT_ACTION: deriveNextAction(finalState, autonomous),
        router,
        policyVerdict,
        autonomous,
    };
}
function deriveCredentialStatuses(report) {
    const statuses = {};
    for (const tool of report.tools) {
        if (tool.available) {
            statuses[tool.tool] = 'present';
        }
        else if (tool.missingEnv && tool.missingEnv.length > 0) {
            // A tool can be unavailable for reasons other than credentials (e.g.
            // test_runner is always available). Only flag credential-backed tools.
            const isCredentialTool = /^(github_write|render_deploy|supabase_actions|ai_gateway)$/i.test(tool.tool);
            if (isCredentialTool) {
                statuses[tool.tool] = 'not_loaded';
            }
        }
    }
    return statuses;
}
function extractChangedFiles(report) {
    const selfHeal = report.selfHeal;
    if (!selfHeal)
        return [];
    // The autonomous report does not carry a per-file change list directly; the
    // senior-developer worker's proof ledger does. Here we surface what the
    // lifecycle can prove: the plan block titles (root-cause level), and rely on
    // the worker ledger for the authoritative file list. Returning an empty array
    // is honest when no concrete file list is available.
    return [];
}
function extractGithubSha(report) {
    const op = report.selfHeal;
    if (!op)
        return null;
    // The autonomous report's production field carries no commit sha. The worker
    // ledger is the source of truth. Be honest — return null here.
    return null;
}
function extractRenderDeployId(report) {
    if (!report.production)
        return null;
    // Production health does not carry a deploy id. Honest null.
    return null;
}
function deriveFinalState(report, testsOk, blockers) {
    if (report.humanApprovalRequired)
        return 'WAITING_OWNER';
    // Pre-execution blockers (credential missing, tool unavailable, approval
    // gate) are handled before the executor ever runs; if any reach this point
    // it means the executor was allowed to run and the blockers are post-execution
    // test-failure evidence, not a state override.
    const productionFailed = report.production !== null
        && (report.production.failures > 0 || report.production.thresholdExceeded);
    // VERIFIED only when the autonomous lifecycle, tests, and production health
    // all agree. Production health failures override an optimistic VERIFIED.
    if (report.finalStatus === 'VERIFIED' && testsOk && !productionFailed)
        return 'VERIFIED';
    if (report.finalStatus === 'FAILED' || !testsOk || productionFailed)
        return 'FAILED';
    // RUNNING is reserved for in-flight jobs; the synchronous router returns
    // READY when the work is queued but not yet verified, VERIFIED when proven.
    return 'READY';
}
function deriveRootCause(report, blockers) {
    if (report.humanApprovalRequired && report.approvalReason)
        return report.approvalReason;
    const production = report.production;
    const productionFailed = production !== null
        && (production.failures > 0 || production.thresholdExceeded);
    if (productionFailed) {
        return `Live verification failed: health=${production.failures}/${production.total} failures; thresholdExceeded=${production.thresholdExceeded}.`;
    }
    const failedStep = report.steps.find((s) => s.status === 'failed');
    if (failedStep)
        return `${failedStep.name}: ${failedStep.proof}`;
    if (blockers.length > 0)
        return blockers[0] ?? 'Unknown blocker.';
    if (report.finalStatus === 'VERIFIED')
        return 'All stages verified end-to-end.';
    return 'No root cause surfaced — investigate the autonomous report.';
}
function deriveNextAction(state, report) {
    switch (state) {
        case 'VERIFIED':
            return 'No action needed — task verified live. Owner may close the task.';
        case 'WAITING_OWNER':
            return 'Reply with the exact action + confirmation text. After approval I execute with no further prompts.';
        case 'BLOCKED':
            return 'Resolve the listed blocker (credential / tool / missing input), then re-run the same task.';
        case 'FAILED':
            return 'Inspect the failed stage in the autonomous report, fix the smallest safe issue, re-run.';
        case 'RUNNING':
            return 'Wait for the executor to finish, then re-query for the final report.';
        case 'READY':
        default:
            return 'Work queued — poll the proof ledger for the final verification.';
    }
}
export const IVX_SENIOR_DEVELOPER_AUTONOMOUS_MODE_MARKER = 'ivx-senior-developer-autonomous-mode-2026-07-05';
export function buildSeniorDeveloperAutonomousStatus() {
    return {
        ok: true,
        marker: IVX_SENIOR_DEVELOPER_AUTONOMOUS_MODE_MARKER,
        pipeline: ROUTER_PIPELINE,
        allowedStates: ALLOWED_FINAL_STATES,
        ownerPolicyGate: getOwnerPolicyGate(),
        approvalGates: listOwnerApprovalGates(),
        safeCategories: listOwnerSafeCategories(),
        credentialRule: {
            neverAskUnlessLiveCheckProves: ['missing', 'expired', 'revoked', 'wrong_permission', 'not_loaded'],
            neverUseOldChatTokens: true,
            neverPrintSecrets: true,
        },
        deployRule: {
            askOnceWithExactChange: true,
            verifyHealthAndVersion: true,
            noRepeatedPermissionLoops: true,
        },
        timestamp: nowIso(),
    };
}
