/**
 * IVX Senior Developer Narrative Engine (RESPONSE ENGINE)
 *
 * Owner mandate 2026-07-20 Phases 7 + 10: a SEPARATE response engine that reads
 * the structured execution record and produces an owner-readable response.
 *
 * The response engine MUST NOT invent actions that are absent from the
 * execution record. It reads the record and explains the result clearly,
 * separating facts from assumptions and reporting failures honestly.
 *
 * The 7-section format (owner-mandated):
 *   1. DIRECT ANSWER
 *   2. WHAT WAS WRONG
 *   3. WHAT I CHANGED
 *   4. WHY THIS FIX WORKS
 *   5. TESTS PERFORMED
 *   6. PRODUCTION PROOF
 *   7. WHAT IS STILL NOT VERIFIED
 *
 * Forbidden vague language (unless every required acceptance test has
 * supporting evidence): "Everything is working", "Fully complete",
 * "Enterprise-ready", "Verified end to end".
 */

import type { IVXExecutionRecord } from './ivx-execution-record';
import type { IVXValidationVerdict } from './ivx-completion-validator';

export const IVX_NARRATIVE_ENGINE_MARKER = 'ivx-narrative-engine-2026-07-20';

const FORBIDDEN_VAGUE_PHRASES = [
  'everything is working',
  'fully complete',
  'enterprise-ready',
  'verified end to end',
  '100% working',
  'all good',
];

export type IVXNarrativeInput = {
  record: IVXExecutionRecord;
  verdict: IVXValidationVerdict;
  verdictReason: string;
};

export type IVXNarrativeOutput = {
  text: string;
  sections: string[];
  forbiddenPhrasesDetected: string[];
  inventedActionsDetected: string[];
};

function directAnswer(record: IVXExecutionRecord, verdict: IVXValidationVerdict): string {
  switch (verdict) {
    case 'VERIFIED':
      if (record.task_type === 'INVESTIGATION' || record.task_type === 'QA_ONLY') {
        return 'The requested investigation/QA is complete and verified with evidence.';
      }
      return 'The requested problem is fixed and verified with evidence.';
    case 'DEPLOYED_ONLY':
      return 'The requested fix/feature was NOT implemented. A redeploy occurred but no code changed.';
    case 'NOT_COMPLETED':
      return 'The requested work is NOT completed. See remaining work below.';
    case 'NO_CHANGE_REQUIRED':
      return 'No code change was required and none was made.';
    case 'BLOCKED':
      return 'The work is blocked. See blockers below.';
    case 'FAILED':
      return 'The work failed. See details below.';
    default:
      return 'The work is not yet verified.';
  }
}

function whatWasWrong(record: IVXExecutionRecord): string {
  if (record.root_cause) {
    return record.root_cause;
  }
  if (record.analysis) {
    return record.analysis;
  }
  if (record.blockers.length > 0) {
    return `Blocked before root cause was identified: ${record.blockers.join('; ')}`;
  }
  return 'Root cause was not identified — the task did not reach the ROOT_CAUSE_IDENTIFIED state.';
}

function whatIChanged(record: IVXExecutionRecord): string {
  if (record.files_changed.length === 0) {
    return 'No files were changed. No code diff was produced.';
  }
  const lines = record.files_changed.map((f) => `  - ${f}`);
  return `Files changed (${record.files_changed.length}):\n${lines.join('\n')}`;
}

function whyThisFixWorks(record: IVXExecutionRecord): string {
  if (record.files_changed.length === 0) {
    if (record.task_type === 'INVESTIGATION') {
      return 'Investigation tasks do not require a code change; the root cause above is the deliverable.';
    }
    if (record.task_type === 'QA_ONLY') {
      return 'QA tasks do not require a code change; the test results below are the deliverable.';
    }
    return 'No fix was applied — there is no technical relationship between a root cause and an implementation because no implementation exists.';
  }
  if (!record.root_cause) {
    return 'Files were changed but the root cause was not recorded — the relationship cannot be stated with confidence.';
  }
  return `The changes above address the root cause: ${record.root_cause}`;
}

function testsPerformed(record: IVXExecutionRecord): string {
  if (record.tests.length === 0) {
    return 'No tests were run.';
  }
  const lines = record.tests.map((t) => {
    const counts = t.passedCount !== null && t.failedCount !== null ? ` (${t.passedCount} pass / ${t.failedCount} fail)` : '';
    return `  - ${t.name}: ${t.passed ? 'PASS' : 'FAIL'}${counts} — ${t.command}`;
  });
  return `Tests run (${record.tests.length}):\n${lines.join('\n')}`;
}

function productionProof(record: IVXExecutionRecord): string {
  const parts: string[] = [];
  if (record.commit_sha) {
    parts.push(`Commit: ${record.commit_sha}`);
  } else {
    parts.push('Commit: none (no code was committed)');
  }
  if (record.deployment_id) {
    parts.push(`Deployment: ${record.deployment_id}`);
  } else {
    parts.push('Deployment: none (no deployment occurred)');
  }
  const health = record.production_checks.find((c) => c.name.includes('health'));
  if (health) {
    parts.push(`Health: ${health.ok ? 'OK' : 'FAIL'} (${health.httpStatus ?? 'n/a'}) — ${health.url}`);
  } else {
    parts.push('Health: not checked');
  }
  const feature = record.evidence.filter((e) => e.kind === 'feature');
  if (feature.length > 0) {
    parts.push(`Feature verification: ${feature.map((e) => `${e.label}=${e.verified ? 'VERIFIED' : 'NOT VERIFIED'}`).join(', ')}`);
  } else {
    parts.push('Feature verification: not performed');
  }
  return parts.join('\n');
}

function whatIsStillNotVerified(record: IVXExecutionRecord, verdict: IVXValidationVerdict): string {
  const items: string[] = [];
  if (verdict !== 'VERIFIED') {
    items.push(`Overall status is ${verdict} — the requested outcome is not verified.`);
  }
  if (record.files_changed.length === 0 && (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE' || record.task_type === 'UI_FIX')) {
    items.push('No code changed — the requested fix/feature was not implemented.');
  }
  if (!record.evidence.some((e) => e.kind === 'feature' && e.verified)) {
    items.push('No feature-verification evidence was produced.');
  }
  const platforms = record.qa_results.map((q) => q.platform);
  for (const p of ['android', 'ios', 'web'] as const) {
    if (!platforms.includes(p)) {
      items.push(`${p} device QA was not performed.`);
    }
  }
  for (const w of record.remaining_work) {
    items.push(w);
  }
  for (const b of record.blockers) {
    items.push(`Blocker: ${b}`);
  }
  if (items.length === 0) {
    return 'All required acceptance tests have supporting evidence.';
  }
  return items.join('\n');
}

/**
 * Check for forbidden vague phrases in the generated text.
 */
export function detectForbiddenVaguePhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return FORBIDDEN_VAGUE_PHRASES.filter((p) => lower.includes(p));
}

/**
 * Check for invented actions — claims in the text that are not backed by the
 * execution record. The response engine must not invent actions.
 */
export function detectInventedActions(text: string, record: IVXExecutionRecord): string[] {
  const invented: string[] = [];
  // If the text mentions a file that's not in files_changed or files_inspected, it's invented.
  // Match file paths with extensions. Put longer extensions first so
  // `chat.tsx` is not captured as `chat.ts` (regex alternation is order-dependent).
  const fileMentions = text.match(/(?:backend|expo|ios|android)\/[A-Za-z0-9_./-]+\.(?:tsx|ts|swift|kt|json|gradle|js|mjs)/g) ?? [];
  const knownFiles = new Set([...record.files_changed, ...record.files_inspected]);
  for (const f of fileMentions) {
    if (!knownFiles.has(f)) {
      // Also check if the captured path is a prefix of a known file (e.g. the
      // regex captured `chat.ts` but the record has `chat.tsx`). This avoids a
      // false invented-action when the extension alternation truncated.
      const isPrefixOfKnown = [...knownFiles].some((k) => k.startsWith(f));
      if (!isPrefixOfKnown) {
        invented.push(`Mentions file not in record: ${f}`);
      }
    }
  }
  // If the text claims VERIFIED but the record status is not VERIFIED, it's invented.
  if (/\bVERIFIED\b/i.test(text) && record.status !== 'VERIFIED') {
    invented.push('Claims VERIFIED but record status is not VERIFIED.');
  }
  // If the text claims "fixed" but files_changed is empty for a dev task, it's invented.
  if (/\bfixed\b/i.test(text) && record.files_changed.length === 0 && (record.task_type === 'CODE_FIX' || record.task_type === 'FEATURE' || record.task_type === 'UI_FIX')) {
    invented.push('Claims "fixed" but no files were changed for a development task.');
  }
  return invented;
}

/**
 * Build the 7-section narrative from the execution record + verdict.
 * This is the RESPONSE ENGINE — it reads the record and explains it.
 */
export function buildSeniorDeveloperNarrative(input: IVXNarrativeInput): IVXNarrativeOutput {
  const { record, verdict, verdictReason } = input;
  const sections = [
    `DIRECT ANSWER\n${directAnswer(record, verdict)}`,
    `WHAT WAS WRONG\n${whatWasWrong(record)}`,
    `WHAT I CHANGED\n${whatIChanged(record)}`,
    `WHY THIS FIX WORKS\n${whyThisFixWorks(record)}`,
    `TESTS PERFORMED\n${testsPerformed(record)}`,
    `PRODUCTION PROOF\n${productionProof(record)}`,
    `WHAT IS STILL NOT VERIFIED\n${whatIsStillNotVerified(record, verdict)}`,
  ];
  const text = sections.join('\n\n---\n\n');
  const forbiddenPhrasesDetected = detectForbiddenVaguePhrases(text);
  const inventedActionsDetected = detectInventedActions(text, record);
  return { text, sections, forbiddenPhrasesDetected, inventedActionsDetected };
}
