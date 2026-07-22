/**
 * IVX Structured Execution Record
 *
 * Stores the complete execution trail for every task. The IVX response
 * is generated from this record — never from fabricated narratives.
 *
 * The execution engine writes to this record as it performs each step.
 * The response engine reads it to produce the owner-facing message.
 */

export const IVX_EXECUTION_RECORD_MARKER =
  'ivx-execution-record-2026-07-22';

export const EXECUTION_RECORD_REQUIRED_FIELDS = [
  'task_id', 'parent_task_id', 'task_type', 'user_request', 'acceptance_criteria',
  'status', 'analysis', 'reproduction_steps', 'root_cause', 'implementation_plan',
  'files_inspected', 'files_changed', 'commands', 'tests', 'qa_results',
  'commit_sha', 'deployment_id', 'production_checks', 'evidence', 'blockers',
  'remaining_work', 'started_at', 'completed_at', 'verified_at',
] as const;

export type IVXExecutionRecord = {
  /** Unique task identifier. */
  task_id: string;
  /** Parent task ID (for retries or sub-tasks). */
  parent_task_id: string | null;
  /** Classified task type. */
  task_type: string;
  /** The user's original request. */
  user_request: string;
  /** Acceptance criteria the owner defined. */
  acceptance_criteria: string[];
  /** Current task state from the state machine. */
  status: string;
  /** Analysis of the request. */
  analysis: string | null;
  /** Steps taken to reproduce the problem. */
  reproduction_steps: string[];
  /** Root cause identified during investigation. */
  root_cause: string | null;
  /** Implementation plan created. */
  implementation_plan: string[];
  /** Files inspected during investigation. */
  files_inspected: string[];
  /** Files changed during implementation. */
  files_changed: string[];
  /** Commands executed. */
  commands: { command: string; exit_code: number | null; output_summary: string }[];
  /** Tests run and their results. */
  tests: { name: string; passed: boolean; duration_ms: number | null }[];
  /** QA results. */
  qa_results: {
    platform: string;
    scenario: string;
    passed: boolean;
    evidence: string;
  }[];
  /** GitHub commit SHA. */
  commit_sha: string | null;
  /** Render deployment ID. */
  deployment_id: string | null;
  /** Production checks performed. */
  production_checks: {
    check: string;
    result: string;
    timestamp: number;
  }[];
  /** All evidence collected. */
  evidence: { type?: string; kind?: string; value: string; label?: string; timestamp: number | string; verified?: boolean }[];
  /** Blockers encountered. */
  blockers: { description: string; attempted_command: string | null }[];
  /** Remaining work items. */
  remaining_work: string[];
  /** Timestamps. */
  started_at: number;
  completed_at: number | null;
  verified_at: number | null;
};

/**
 * Create a new execution record for a task.
 */
export function createExecutionRecord(input: {
  task_id: string;
  task_type: string;
  user_request: string;
  acceptance_criteria?: string[];
  parent_task_id?: string | null;
}): IVXExecutionRecord {
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
export function updateExecutionRecord(
  record: IVXExecutionRecord,
  updates: Partial<IVXExecutionRecord>,
): IVXExecutionRecord {
  return { ...record, ...updates };
}

/**
 * Add a command to the execution record.
 */
export function addCommand(
  record: IVXExecutionRecord,
  command: string,
  exitCode: number | null,
  outputSummary: string,
): IVXExecutionRecord {
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
export function addTestResult(
  record: IVXExecutionRecord,
  name: string,
  passed: boolean,
  durationMs: number | null,
): IVXExecutionRecord {
  return {
    ...record,
    tests: [...record.tests, { name, passed, duration_ms: durationMs }],
  };
}

/**
 * Add a QA result to the execution record.
 */
export function addQAResult(
  record: IVXExecutionRecord,
  platform: string,
  scenario: string,
  passed: boolean,
  evidence: string,
): IVXExecutionRecord {
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
export function addEvidence(
  record: IVXExecutionRecord,
  type: string,
  value: string,
): IVXExecutionRecord {
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
export function addBlocker(
  record: IVXExecutionRecord,
  description: string,
  attemptedCommand: string | null,
): IVXExecutionRecord {
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
export function completeRecord(
  record: IVXExecutionRecord,
  status: string,
): IVXExecutionRecord {
  return {
    ...record,
    status,
    completed_at: Date.now(),
  };
}

/**
 * Mark the record as verified.
 */
export function verifyRecord(record: IVXExecutionRecord): IVXExecutionRecord {
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
export function serializeExecutionRecord(record: IVXExecutionRecord): string {
  return JSON.stringify(record, null, 2);
}

// --- Compatibility aliases (object-parameter style used by tests) ---

export function appendCommand(
  record: IVXExecutionRecord,
  input: { command: string; exitCode: number | null; outputPreview: string; startedAt?: string; finishedAt?: string },
): IVXExecutionRecord {
  return addCommand(record, input.command, input.exitCode, input.outputPreview);
}

export function appendTestResult(
  record: IVXExecutionRecord,
  input: { name: string; command?: string; passed: boolean; passedCount?: number; failedCount?: number; durationMs: number | null; outputPreview?: string },
): IVXExecutionRecord {
  return addTestResult(record, input.name, input.passed, input.durationMs);
}

export function appendQAResult(
  record: IVXExecutionRecord,
  input: { platform: string; name?: string; scenario?: string; passed: boolean; evidence: string; notes?: string },
): IVXExecutionRecord {
  return addQAResult(record, input.platform, input.name ?? input.scenario ?? 'unnamed', input.passed, input.evidence);
}

export function appendEvidence(
  record: IVXExecutionRecord,
  input: { kind: string; label?: string; value: string; timestamp: string | number; verified?: boolean },
): IVXExecutionRecord {
  return addEvidence(record, input.kind, input.value);
}

export function completeExecutionRecord(
  record: IVXExecutionRecord,
  status: string,
  verified: boolean,
): IVXExecutionRecord {
  const r = completeRecord(record, status);
  return verified ? { ...r, verified_at: Date.now() } : r;
}

export function validateExecutionRecord(record: IVXExecutionRecord): {
  ok: boolean;
  missingFields: string[];
  inconsistencies: string[];
} {
  const missingFields: string[] = [];
  const inconsistencies: string[] = [];
  const recordAny = record as unknown as Record<string, unknown>;
  for (const field of EXECUTION_RECORD_REQUIRED_FIELDS) {
    if (!(field in recordAny)) missingFields.push(field);
  }
  if (record.status === 'VERIFIED' && (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE')) {
    if (record.files_changed.length === 0) inconsistencies.push('no files changed for a verified development task');
    if (!record.evidence.some((e) => (e.kind ?? e.type) === 'feature')) inconsistencies.push('feature-verification evidence missing');
  }
  if (record.status === 'DEPLOYED' && !record.deployment_id) {
    inconsistencies.push('deployment_id is missing for DEPLOYED status');
  }
  return { ok: missingFields.length === 0 && inconsistencies.length === 0, missingFields, inconsistencies };
}
