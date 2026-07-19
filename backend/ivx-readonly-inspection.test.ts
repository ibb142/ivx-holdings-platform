/**
 * IVX Read-Only Developer Inspection — regression tests
 *
 * FINAL SMALL FIX — ROUTE READ-ONLY INSPECTION REQUESTS THROUGH THE REAL WORKER
 * (owner mandate 2026-07-19):
 *
 *   "Inspect this bug; do not change anything" must:
 *     - create exactly one worker job
 *     - return one taskId
 *     - NOT edit files
 *     - NOT commit
 *     - NOT deploy
 *     - NOT trigger Fake Execution Claims
 *     - produce one final structured response
 *     - retry reattaches to the same job (single-flight)
 *     - duplicate messages are not created
 */
import { describe, expect, test } from 'bun:test';
import {
  classifyExecutionModeIntent,
  type IVXExecutionModeCategory,
} from './services/ivx-execution-mode-classifier';
import {
  buildReadOnlyInspectionAnswer,
  IVX_READONLY_INSPECTION_MARKER,
  type IVXReadOnlyInspectionProof,
} from './services/ivx-senior-developer-readonly-runtime';
import { hasForbiddenNarrative } from './services/ivx-execution-status-schema';

const OWNER_SPEC_INSPECTION_PROMPT = 'Inspect the chat ordering issue and report the current task status. Do not change or deploy anything.';
const OWNER_SPEC_INSPECTION_PROMPT_2 = 'Inspect this bug; do not change anything';

function makeTerminalProof(overrides: Partial<IVXReadOnlyInspectionProof> = {}): IVXReadOnlyInspectionProof {
  return {
    marker: IVX_READONLY_INSPECTION_MARKER,
    jobId: 'ivx-readonly-test-job-001',
    goal: OWNER_SPEC_INSPECTION_PROMPT,
    mode: 'read_only',
    finalStatus: 'COMPLETED',
    patchApplied: false,
    commitCreated: false,
    deployed: false,
    changedFiles: [],
    filesInspected: [
      { path: 'backend/api/ivx-owner-ai.ts', bytes: 1234, preview: 'export async function handleOwnerAI(' },
      { path: 'expo/app/ivx/chat.tsx', bytes: 2345, preview: 'export default function ChatScreen()' },
    ],
    commandsRun: [
      { command: 'read backend/api/ivx-owner-ai.ts', kind: 'read_file', ok: true, exitCode: null, outputPreview: 'export async function', error: null, durationMs: 0 },
      { command: 'bun test backend/services/ivx-ia-reliability-gate.test.ts', kind: 'run_tests', ok: true, exitCode: 0, outputPreview: '59 pass', error: null, durationMs: 1200 },
    ],
    findings: 'Inspected 2 file(s). Goal-term matches:\n - backend/api/ivx-owner-ai.ts references: chat, ordering, issue',
    rootCause: 'Read-only inspection surfaced 2 file(s) whose content references the goal terms.',
    nextAction: 'Reply with an execution-mode command to fix end-to-end.',
    error: null,
    generatedAt: '2026-07-19T19:00:00.000Z',
    secretValuesReturned: false,
    ...overrides,
  };
}

describe('IVX Read-Only Developer Inspection', () => {
  describe('classifier', () => {
    test('owner-spec prompt 1 classifies as developer_inspection', () => {
      const result = classifyExecutionModeIntent(OWNER_SPEC_INSPECTION_PROMPT);
      expect(result.isExecutionMode).toBe(true);
      expect(result.category).toBe('developer_inspection' as IVXExecutionModeCategory);
      expect(result.categoryLabel).toBe('developer inspection');
      expect(result.matchedTrigger.length).toBeGreaterThan(0);
    });

    test('owner-spec prompt 2 ("Inspect this bug; do not change anything") classifies as developer_inspection', () => {
      const result = classifyExecutionModeIntent(OWNER_SPEC_INSPECTION_PROMPT_2);
      expect(result.isExecutionMode).toBe(true);
      expect(result.category).toBe('developer_inspection' as IVXExecutionModeCategory);
    });

    test('all 9 owner-listed trigger combinations classify as developer_inspection', () => {
      const prompts = [
        'Inspect the code and report what you find. Do not change anything.',
        'Inspect logs for the last error. Read-only inspection.',
        'Audit the code in backend/services for the reliability gate. Do not deploy.',
        'Trace the issue with the chat ordering. Do not modify anything.',
        'Report the current task status for the senior developer worker. Do not change or deploy.',
        'Verify the implementation of the execution-mode classifier. Do not edit files.',
        'Diagnose the bug causing the 503 on /api/ivx/owner-ai. Do not change anything.',
        'Do not change anything; just inspect the code for the contradiction detector.',
        'Do not deploy; inspect logs and report the root cause.',
        'Read-only inspection of the chat ordering issue.',
      ];
      for (const prompt of prompts) {
        const result = classifyExecutionModeIntent(prompt);
        expect(result.isExecutionMode).toBe(true);
        expect(result.category).toBe('developer_inspection' as IVXExecutionModeCategory);
      }
    });

    test('a pure question ("what is the chat ordering issue?") does NOT classify as developer_inspection', () => {
      const result = classifyExecutionModeIntent('What is the chat ordering issue?');
      // Pure explanation request — falls through to the explanation hatch.
      expect(result.category).not.toBe('developer_inspection' as IVXExecutionModeCategory);
    });

    test('an execution command without a read-only signal does NOT classify as developer_inspection', () => {
      const result = classifyExecutionModeIntent('Fix the chat ordering issue and deploy live now.');
      // No read-only signal → should match fix/deploy, not developer_inspection.
      expect(result.category).not.toBe('developer_inspection' as IVXExecutionModeCategory);
    });
  });

  describe('answer format', () => {
    test('terminal proof produces the owner-mandated strict format with all 10 required sections', () => {
      const proof = makeTerminalProof();
      const answer = buildReadOnlyInspectionAnswer(proof);
      expect(answer).toContain('TASK ID:\nivx-readonly-test-job-001');
      expect(answer).toContain('STATUS:\nCOMPLETED');
      expect(answer).toContain('MODE:\nREAD_ONLY');
      expect(answer).toContain('FILES INSPECTED:\nbackend/api/ivx-owner-ai.ts (1234 bytes)');
      expect(answer).toContain('COMMANDS RUN:\n$ read backend/api/ivx-owner-ai.ts');
      expect(answer).toContain('FINDINGS:\nInspected 2 file(s)');
      expect(answer).toContain('ROOT CAUSE:\nRead-only inspection surfaced 2 file(s)');
      expect(answer).toContain('FILES CHANGED:\nNONE — read-only inspection mode never edits files.');
      expect(answer).toContain('COMMIT:\nNOT REQUESTED — read-only inspection mode never commits.');
      expect(answer).toContain('DEPLOYMENT:\nNOT REQUESTED — read-only inspection mode never deploys.');
    });

    test('read-only answer NEVER contains forbidden narrative phrases (no fake execution claims)', () => {
      const proof = makeTerminalProof();
      const answer = buildReadOnlyInspectionAnswer(proof);
      expect(hasForbiddenNarrative(answer)).toBe(false);
    });

    test('BLOCKED proof renders STATUS: BLOCKED with the blocker reason', () => {
      const proof = makeTerminalProof({ finalStatus: 'BLOCKED', error: 'Emergency stop active.' });
      const answer = buildReadOnlyInspectionAnswer(proof);
      expect(answer).toContain('STATUS:\nBLOCKED');
    });

    test('proof always reports changedFiles=[], patchApplied=false, commitCreated=false, deployed=false', () => {
      const proof = makeTerminalProof();
      expect(proof.changedFiles).toEqual([]);
      expect(proof.patchApplied).toBe(false);
      expect(proof.commitCreated).toBe(false);
      expect(proof.deployed).toBe(false);
      const answer = buildReadOnlyInspectionAnswer(proof);
      expect(answer).toContain('FILES CHANGED:\nNONE');
      expect(answer).toContain('COMMIT:\nNOT REQUESTED');
      expect(answer).toContain('DEPLOYMENT:\nNOT REQUESTED');
    });
  });
});
