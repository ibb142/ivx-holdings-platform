/**
 * IVX Structured Execution Record
 *
 * Owner mandate 2026-07-20 Phase 11: store a structured execution record for
 * every task with 22 fields. The IVX response must be generated FROM this
 * record — the response engine must not invent actions that are absent from
 * the execution record.
 *
 * This module is runtime-free and does NOT import worker types, to avoid
 * circular dependencies. It defines the canonical record shape + helpers to
 * build and validate it.
 */

export const IVX_EXECUTION_RECORD_MARKER = 'ivx-execution-record-2026-07-20';

import type { IVXTaskState, IVXTaskType } from './ivx-completion-validator';

export type IVXExecutionRecord = {
  task_id: string;
  parent_task_id: string | null;
  task_type: IVXTaskType;
  user_request: string;
  acceptance_criteria: string[];
  status: IVXTaskState;
  analysis: string | null;
  reproduction_steps: string[];
  root_cause: string | null;
  implementation_plan: string | null;
  files_inspected: string[];
  files_changed: string[];
  commands: IVXExecutionCommand[];
  tests: IVXExecutionTestResult[];
  qa_results: IVXExecutionQAResult[];
  commit_sha: string | null;
  deployment_id: string | null;
  production_checks: IVXExecutionProductionCheck[];
  evidence: IVXExecutionEvidenceEntry[];
  blockers: string[];
  remaining_work: string[];
  started_at: string;
  completed_at: string | null;
  verified_at: string | null;
};

export type IVXExecutionCommand = {
  command: string;
  exitCode: number | null;
  outputPreview: string;
  startedAt: string;
  finishedAt: string | null;
};

export type IVXExecutionTestResult = {
  name: string;
  command: string;
  passed: boolean;
  passedCount: number | null;
  failedCount: number | null;
  durationMs: number | null;
  outputPreview: string;
};

export type IVXExecutionQAResult = {
  platform: 'android' | 'ios' | 'web' | 'backend' | 'device';
  name: string;
  passed: boolean | null;
  evidence: string;
  notes: string;
};

export type IVXExecutionProductionCheck = {
  name: string;
  url: string;
  httpStatus: number | null;
  ok: boolean;
  detail: string;
  checkedAt: string;
};

export type IVXExecutionEvidenceEntry = {
  kind: 'commit' | 'deploy' | 'health' | 'feature' | 'test' | 'qa' | 'diff' | 'log' | 'screenshot' | 'config';
  label: string;
  value: string;
  timestamp: string;
  verified: boolean;
};

export const EXECUTION_RECORD_REQUIRED_FIELDS: readonly (keyof IVXExecutionRecord)[] = [
  'task_id',
  'parent_task_id',
  'task_type',
  'user_request',
  'acceptance_criteria',
  'status',
  'analysis',
  'reproduction_steps',
  'root_cause',
  'implementation_plan',
  'files_inspected',
  'files_changed',
  'commands',
  'tests',
  'qa_results',
  'commit_sha',
  'deployment_id',
  'production_checks',
  'evidence',
  'blockers',
  'remaining_work',
  'started_at',
  'completed_at',
  'verified_at',
] as const;

/**
 * Create a fresh execution record for a new task.
 */
export function createExecutionRecord(input: {
  task_id: string;
  parent_task_id?: string | null;
  task_type: IVXTaskType;
  user_request: string;
  acceptance_criteria?: string[];
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
    implementation_plan: null,
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
    started_at: new Date().toISOString(),
    completed_at: null,
    verified_at: null,
  };
}

/**
 * Validate that an execution record has all 22 required fields and that the
 * values are internally consistent. The response engine must call this before
 * generating a response from the record.
 */
export type IVXExecutionRecordValidation = {
  ok: boolean;
  missingFields: string[];
  inconsistencies: string[];
};

export function validateExecutionRecord(record: Partial<IVXExecutionRecord>): IVXExecutionRecordValidation {
  const missingFields: string[] = [];
  for (const field of EXECUTION_RECORD_REQUIRED_FIELDS) {
    if (record[field] === undefined || record[field] === null) {
      // completed_at and verified_at may be null for non-terminal tasks.
      if (field === 'completed_at' || field === 'verified_at') continue;
      // analysis, root_cause, implementation_plan may be null until reached.
      if (field === 'analysis' || field === 'root_cause' || field === 'implementation_plan') continue;
      // parent_task_id may be null.
      if (field === 'parent_task_id') continue;
      // commit_sha, deployment_id may be null until deploy.
      if (field === 'commit_sha' || field === 'deployment_id') continue;
      missingFields.push(field);
    }
  }

  const inconsistencies: string[] = [];
  if (record.status === 'VERIFIED') {
    if (!record.verified_at) {
      inconsistencies.push('VERIFIED status but verified_at is null.');
    }
    if (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE' || record.task_type === 'UI_FIX') {
      if ((record.files_changed ?? []).length === 0 && !record.root_cause?.toLowerCase().includes('external')) {
        inconsistencies.push('VERIFIED for a development task with no files changed and no external cause proven.');
      }
    }
    const hasFeatureEvidence = (record.evidence ?? []).some((e) => e.kind === 'feature' && e.verified);
    if (!hasFeatureEvidence && (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE' || record.task_type === 'UI_FIX')) {
      inconsistencies.push('VERIFIED for a development task with no feature-verification evidence.');
    }
  }
  if (record.status === 'DEPLOYED' && !record.deployment_id) {
    inconsistencies.push('DEPLOYED status but deployment_id is null.');
  }
  if (record.status === 'CODE_CHANGED' && (record.files_changed ?? []).length === 0) {
    inconsistencies.push('CODE_CHANGED status but files_changed is empty.');
  }

  return {
    ok: missingFields.length === 0 && inconsistencies.length === 0,
    missingFields,
    inconsistencies,
  };
}

/**
 * Append a command result to the record (immutable copy).
 */
export function appendCommand(record: IVXExecutionRecord, cmd: IVXExecutionCommand): IVXExecutionRecord {
  return { ...record, commands: [...record.commands, cmd] };
}

/**
 * Append a test result to the record (immutable copy).
 */
export function appendTestResult(record: IVXExecutionRecord, test: IVXExecutionTestResult): IVXExecutionRecord {
  return { ...record, tests: [...record.tests, test] };
}

/**
 * Append a QA result to the record (immutable copy).
 */
export function appendQAResult(record: IVXExecutionRecord, qa: IVXExecutionQAResult): IVXExecutionRecord {
  return { ...record, qa_results: [...record.qa_results, qa] };
}

/**
 * Append an evidence entry to the record (immutable copy).
 */
export function appendEvidence(record: IVXExecutionRecord, entry: IVXExecutionEvidenceEntry): IVXExecutionRecord {
  return { ...record, evidence: [...record.evidence, entry] };
}

/**
 * Mark the record as completed (terminal state reached).
 */
export function completeExecutionRecord(
  record: IVXExecutionRecord,
  status: IVXTaskState,
  verified: boolean,
): IVXExecutionRecord {
  const now = new Date().toISOString();
  return {
    ...record,
    status,
    completed_at: now,
    verified_at: verified ? now : null,
  };
}
