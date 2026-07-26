/**
 * IVX Structured Execution Record
 *
 * Stores the complete execution trail for every task. The IVX response
 * is generated from this record — never from fabricated narratives.
 *
 * The execution engine writes to this record as it performs each step.
 * The response engine reads it to produce the owner-facing message.
 */
export const IVX_EXECUTION_RECORD_MARKER = 'ivx-execution-record-2026-07-22';
export const EXECUTION_RECORD_REQUIRED_FIELDS = [
    'task_id', 'parent_task_id', 'task_type', 'user_request', 'acceptance_criteria',
    'status', 'analysis', 'reproduction_steps', 'root_cause', 'implementation_plan',
    'files_inspected', 'files_changed', 'commands', 'tests', 'qa_results',
    'commit_sha', 'deployment_id', 'production_checks', 'evidence', 'blockers',
    'remaining_work', 'started_at', 'completed_at', 'verified_at',
];
/**
 * Create a new execution record for a task.
 */
export function createExecutionRecord(input) {
    return {
        task_id: input.task_id,
        parent_task_id: input.parent_task_id ?? null,
        task_type: input.task_type,
        user_request: input.user_request,
        acceptance_criteria: input.acceptance_criteria ?? [],
        status: 'RECEIVED',
        analysis: null,
        reproduction_steps: [],
        root_cause: null,
        implementation_plan: [],
        files_inspected: [],
        files_changed: [],
        commands: [],
        tests: [],
        qa_results: [],
        commit_sha: null,
        deployment_id: null,
        production_checks: [],
        evidence: [],
        blockers: [],
        remaining_work: [],
        started_at: Date.now(),
        completed_at: null,
        verified_at: null,
    };
}
/**
 * Update a field in the execution record immutably.
 */
export function updateExecutionRecord(record, updates) {
    return { ...record, ...updates };
}
/**
 * Add a command to the execution record.
 */
export function addCommand(record, command, exitCode, outputSummary) {
    return {
        ...record,
        commands: [
            ...record.commands,
            { command, exit_code: exitCode, output_summary: outputSummary },
        ],
    };
}
/**
 * Add a test result to the execution record.
 */
export function addTestResult(record, name, passed, durationMs) {
    return {
        ...record,
        tests: [...record.tests, { name, passed, duration_ms: durationMs }],
    };
}
/**
 * Add a QA result to the execution record.
 */
export function addQAResult(record, platform, scenario, passed, evidence) {
    return {
        ...record,
        qa_results: [
            ...record.qa_results,
            { platform, scenario, passed, evidence },
        ],
    };
}
/**
 * Add evidence to the execution record.
 */
export function addEvidence(record, type, value) {
    return {
        ...record,
        evidence: [
            ...record.evidence,
            { type, value, timestamp: Date.now() },
        ],
    };
}
/**
 * Add a blocker to the execution record.
 */
export function addBlocker(record, description, attemptedCommand) {
    return {
        ...record,
        blockers: [
            ...record.blockers,
            { description, attempted_command: attemptedCommand },
        ],
    };
}
/**
 * Mark the record as completed.
 */
export function completeRecord(record, status) {
    return {
        ...record,
        status,
        completed_at: Date.now(),
    };
}
/**
 * Mark the record as verified.
 */
export function verifyRecord(record) {
    return {
        ...record,
        status: 'VERIFIED',
        verified_at: Date.now(),
        completed_at: record.completed_at ?? Date.now(),
    };
}
/**
 * Serialize the execution record to a JSON-safe object.
 */
export function serializeExecutionRecord(record) {
    return JSON.stringify(record, null, 2);
}
// --- Compatibility aliases (object-parameter style used by tests) ---
export function appendCommand(record, input) {
    return addCommand(record, input.command, input.exitCode, input.outputPreview);
}
export function appendTestResult(record, input) {
    return addTestResult(record, input.name, input.passed, input.durationMs);
}
export function appendQAResult(record, input) {
    return addQAResult(record, input.platform, input.name ?? input.scenario ?? 'unnamed', input.passed, input.evidence);
}
export function appendEvidence(record, input) {
    return addEvidence(record, input.kind, input.value);
}
export function completeExecutionRecord(record, status, verified) {
    const r = completeRecord(record, status);
    return verified ? { ...r, verified_at: Date.now() } : r;
}
export function validateExecutionRecord(record) {
    const missingFields = [];
    const inconsistencies = [];
    const recordAny = record;
    for (const field of EXECUTION_RECORD_REQUIRED_FIELDS) {
        if (!(field in recordAny))
            missingFields.push(field);
    }
    if (record.status === 'VERIFIED' && (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE')) {
        if (record.files_changed.length === 0)
            inconsistencies.push('no files changed for a verified development task');
        if (!record.evidence.some((e) => (e.kind ?? e.type) === 'feature'))
            inconsistencies.push('feature-verification evidence missing');
    }
    if (record.status === 'DEPLOYED' && !record.deployment_id) {
        inconsistencies.push('deployment_id is missing for DEPLOYED status');
    }
    return { ok: missingFields.length === 0 && inconsistencies.length === 0, missingFields, inconsistencies };
}
