/**
 * IVX Completion Validator
 *
 * Prevents false completion claims by comparing user-requested outcomes
 * against actual execution evidence.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */
export const IVX_COMPLETION_VALIDATOR_MARKER = 'ivx-completion-validator-2026-07-22';
// --- Task classifier ---
export function classifyTaskType(prompt) {
    const lower = prompt.toLowerCase();
    const requestsImplementation = /\b(fix|repair|resolve|patch|change|update|add|create|build|implement)\b/.test(lower);
    const requestsFix = /\b(fix|repair|resolve|patch)\b/.test(lower);
    if (lower.includes('redeploy') || (lower.includes('deploy') && !requestsImplementation))
        return 'DEPLOYMENT';
    if (lower.includes('audit') || lower.includes('inspect') || lower.includes('report only') || lower.includes('explain'))
        return 'INVESTIGATION';
    if (requestsImplementation) {
        if (lower.includes('chat') || lower.includes('scroll') || lower.includes('keyboard') || lower.includes('loading') || lower.includes('ui'))
            return 'UI_FIX';
        if (requestsFix)
            return 'CODE_FIX';
        if (lower.includes('add') || lower.includes('create') || lower.includes('build') || lower.includes('implement'))
            return 'FEATURE';
        return 'CODE_FIX';
    }
    if (lower.includes('qa') || lower.includes('verify') || lower.includes('test the'))
        return 'QA_ONLY';
    if (lower.includes('chat') || lower.includes('scroll') || lower.includes('keyboard') || lower.includes('loading') || lower.includes('ui'))
        return 'UI_FIX';
    return 'CODE_FIX';
}
// --- Verdict rendering helpers ---
export function renderValidatorVerdict(verdict) {
    return verdict;
}
export function renderValidatorReason(verdict, reasons) {
    if (verdict === 'DEPLOYED_ONLY') {
        return `A redeploy occurred but the fix was NOT implemented. Reasons: ${reasons.join('; ')}.`;
    }
    if (verdict === 'NOT_COMPLETED') {
        return `The task was NOT completed. Reasons: ${reasons.join('; ')}.`;
    }
    if (verdict === 'PARTIAL') {
        return `The task is partially complete. Reasons: ${reasons.join('; ')}.`;
    }
    return `Verdict: ${verdict}. Reasons: ${reasons.join('; ')}.`;
}
// --- Main validator ---
/**
 * Validate whether a task can honestly claim completion.
 * Accepts IVXCompletionEvidence (the shape used by the answer-format module and tests).
 */
export function validateCompletion(input) {
    const reasons = [];
    const remainingWork = [];
    const isCodeTask = input.taskType === 'CODE_FIX' ||
        input.taskType === 'FEATURE' ||
        input.taskType === 'UI_FIX';
    // Check previous VERIFIED claim without feature verification
    if (input.previousVerdict === 'VERIFIED' && input.featureVerificationOk === false) {
        reasons.push('Previous VERIFIED claim lacked feature verification — cannot re-verify without it.');
        remainingWork.push('Perform feature verification on the requested behavior.');
    }
    if (isCodeTask) {
        // Code task with no files changed
        if (input.filesChanged.length === 0) {
            if (input.deployId) {
                reasons.push('Development task requested but no code changed — this is a redeploy, not a fix.');
                remainingWork.push('Make the requested code change before deploying.');
                return { verdict: 'DEPLOYED_ONLY', ok: false, state: 'DEPLOYED', reasons, remainingWork };
            }
            return {
                verdict: 'NOT_COMPLETED', ok: false, state: 'NO_CHANGE_REQUIRED',
                reasons: ['No code was changed and no deployment occurred.'],
                remainingWork: ['Perform the requested development work.'],
            };
        }
        // Code task with files changed but tests not run
        if (!input.testsRun) {
            return {
                verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
                reasons: ['Tests were not run for a code task.'],
                remainingWork: ['Run the test suite.'],
            };
        }
        // Code task with files changed but tests failed
        if (!input.testsPassed) {
            return {
                verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
                reasons: ['Tests failed for a code task.'],
                remainingWork: ['Fix the failing tests.'],
            };
        }
        // Code task with files changed but not deployed
        if (!input.deployId) {
            return {
                verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
                reasons: ['Code was changed but not deployed.'],
                remainingWork: ['Deploy the change.'],
            };
        }
        // Code task with files + tests pass + deployed + health ok → VERIFIED
        if (input.testsPassed && input.deployId && input.productionHealthOk) {
            if (reasons.length > 0) {
                return { verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED', reasons, remainingWork };
            }
            return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
        }
        // Code task with files + tests pass + deployed but health not checked
        return {
            verdict: 'PARTIAL', ok: false, state: 'PARTIAL',
            reasons: ['Code changed and deployed but production health not confirmed.'],
            remainingWork: ['Verify production health.'],
        };
    }
    // Non-code tasks
    if (input.taskType === 'DEPLOYMENT') {
        if (input.deployId && input.productionHealthOk) {
            return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
        }
        return {
            verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
            reasons: ['Deployment task not completed.'],
            remainingWork: ['Deploy and verify health.'],
        };
    }
    if (input.taskType === 'INVESTIGATION') {
        return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
    }
    if (input.taskType === 'QA_ONLY') {
        if (input.testsRun && input.testsPassed) {
            return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
        }
        return {
            verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
            reasons: ['QA tests not run or not passing.'],
            remainingWork: ['Run the QA tests.'],
        };
    }
    // Default for config/infrastructure or unknown
    if (input.filesChanged.length > 0 && input.deployId && input.productionHealthOk) {
        return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
    }
    return {
        verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
        reasons: ['Task not completed.'],
        remainingWork: ['Perform the requested work.'],
    };
}
/**
 * Build the "STATUS: NOT COMPLETED" message when validation fails.
 */
export function buildNotCompletedMessage(result) {
    const lines = [];
    lines.push(`STATUS: NOT COMPLETED`);
    lines.push('');
    lines.push('REASONS:');
    for (const reason of result.reasons) {
        lines.push(` - ${reason}`);
    }
    lines.push('');
    lines.push('REMAINING WORK:');
    for (const work of result.remainingWork) {
        lines.push(` - ${work}`);
    }
    return lines.join('\n');
}
