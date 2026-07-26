/**
 * IVX Narrative Engine
 *
 * Reads the structured execution record and produces an owner-readable
 * response. The narrative engine MUST NOT invent actions that are absent
 * from the execution record.
 *
 * The response format follows the owner's mandated 7-section structure:
 *   DIRECT ANSWER
 *   WHAT WAS WRONG
 *   WHAT I CHANGED
 *   WHY THIS FIX WORKS
 *   TESTS PERFORMED
 *   PRODUCTION PROOF
 *   WHAT IS STILL NOT VERIFIED
 */
export const IVX_NARRATIVE_ENGINE_MARKER = 'ivx-narrative-engine-2026-07-22';
/**
 * Generate a narrative from the execution record.
 * The narrative is derived from actual evidence, not generic templates.
 */
export function generateNarrative(record, validationResult) {
    const directAnswer = generateDirectAnswer(record, validationResult);
    const whatWasWrong = generateWhatWasWrong(record);
    const whatIChanged = generateWhatIChanged(record);
    const whyThisFixWorks = generateWhyThisFixWorks(record);
    const testsPerformed = generateTestsPerformed(record);
    const productionProof = generateProductionProof(record);
    const whatIsStillNotVerified = generateWhatIsStillNotVerified(record, validationResult);
    const text = [
        'DIRECT ANSWER',
        directAnswer,
        '',
        'WHAT WAS WRONG',
        whatWasWrong,
        '',
        'WHAT I CHANGED',
        whatIChanged,
        '',
        'WHY THIS FIX WORKS',
        whyThisFixWorks,
        '',
        'TESTS PERFORMED',
        testsPerformed,
        '',
        'PRODUCTION PROOF',
        productionProof,
        '',
        'WHAT IS STILL NOT VERIFIED',
        whatIsStillNotVerified,
    ].join('\n');
    return {
        text,
        sections: {
            directAnswer,
            whatWasWrong,
            whatIChanged,
            whyThisFixWorks,
            testsPerformed,
            productionProof,
            whatIsStillNotVerified,
        },
    };
}
function generateDirectAnswer(record, validation) {
    if (validation.verdict === 'VERIFIED') {
        return `The requested problem is fixed and verified in production.`;
    }
    if (validation.verdict === 'PARTIAL') {
        return `The requested problem is partially fixed. Code changed and deployed, but not all acceptance tests have passed.`;
    }
    if (validation.verdict === 'DEPLOYED_ONLY') {
        return `A deployment occurred, but the requested problem was not fixed — no code changed.`;
    }
    if (validation.verdict === 'HEALTH_ONLY') {
        return `Infrastructure health passed, but the requested feature was not verified.`;
    }
    if (validation.verdict === 'BLOCKED') {
        return `The task is blocked. ${record.blockers.map((b) => b.description).join('; ')}`;
    }
    if (validation.verdict === 'FAILED') {
        return `The requested problem was not fixed.`;
    }
    if (validation.verdict === 'NO_CHANGE_REQUIRED') {
        return `No code change was required for this task.`;
    }
    return `The requested problem is NOT COMPLETED. ${validation.reasons.join('; ')}`;
}
function generateWhatWasWrong(record) {
    if (record.root_cause) {
        return record.root_cause;
    }
    if (record.reproduction_steps.length > 0) {
        return `Reproduction steps: ${record.reproduction_steps.join('; ')}`;
    }
    if (record.analysis) {
        return record.analysis;
    }
    return `Root cause was not identified — investigation did not complete.`;
}
function generateWhatIChanged(record) {
    if (record.files_changed.length === 0) {
        return `No files were changed.`;
    }
    const lines = [];
    for (const file of record.files_changed) {
        lines.push(` - ${file}`);
    }
    if (record.commands.length > 0) {
        lines.push('');
        lines.push('Commands executed:');
        for (const cmd of record.commands) {
            const exit = cmd.exit_code !== null ? ` (exit ${cmd.exit_code})` : '';
            lines.push(` - ${cmd.command}${exit}`);
        }
    }
    return lines.join('\n');
}
function generateWhyThisFixWorks(record) {
    if (record.files_changed.length === 0) {
        return `No fix was applied — the root cause was not addressed in code.`;
    }
    if (record.root_cause && record.implementation_plan.length > 0) {
        return `Root cause: ${record.root_cause}\nImplementation: ${record.implementation_plan.join('; ')}`;
    }
    return `The fix addresses the root cause by modifying ${record.files_changed.length} file(s).`;
}
function generateTestsPerformed(record) {
    if (record.tests.length === 0) {
        return `No tests were run.`;
    }
    const lines = [];
    for (const test of record.tests) {
        const duration = test.duration_ms !== null ? ` (${test.duration_ms}ms)` : '';
        lines.push(` - ${test.name}: ${test.passed ? 'PASS' : 'FAIL'}${duration}`);
    }
    const passed = record.tests.filter((t) => t.passed).length;
    const failed = record.tests.filter((t) => !t.passed).length;
    lines.push('');
    lines.push(`Summary: ${passed} passed, ${failed} failed`);
    return lines.join('\n');
}
function generateProductionProof(record) {
    const lines = [];
    if (record.commit_sha) {
        lines.push(`Commit: ${record.commit_sha}`);
    }
    else {
        lines.push(`Commit: NONE`);
    }
    if (record.deployment_id) {
        lines.push(`Deployment: ${record.deployment_id}`);
    }
    else {
        lines.push(`Deployment: NONE`);
    }
    if (record.production_checks.length > 0) {
        lines.push('');
        lines.push('Production checks:');
        for (const check of record.production_checks) {
            lines.push(` - ${check.check}: ${check.result}`);
        }
    }
    return lines.join('\n');
}
function generateWhatIsStillNotVerified(record, validation) {
    const items = [];
    if (validation.remainingWork.length > 0) {
        items.push(...validation.remainingWork);
    }
    if (record.blockers.length > 0) {
        for (const blocker of record.blockers) {
            items.push(`BLOCKED: ${blocker.description}`);
        }
    }
    if (record.qa_results.length === 0 && record.files_changed.length > 0) {
        items.push('Device or browser QA was not performed.');
    }
    if (record.verified_at === null) {
        items.push('The task has not reached VERIFIED status.');
    }
    if (items.length === 0) {
        return `All acceptance criteria have been verified.`;
    }
    return items.map((item) => ` - ${item}`).join('\n');
}
