import { describe, expect, test } from 'bun:test';
import {
  buildBlockedDeveloperExecutionAnswer,
  enforceDeveloperExecutionAnswer,
  hasDeploymentProof,
  hasFileDiffProof,
  hasRawCommandOutput,
  validateDeveloperExecutionAnswer,
} from './ivx-developer-execution-guard';

/** A real, fully-proven developer-execution answer (changed file + raw output + commit). */
const PROVEN_ANSWER = [
  'TASK ID:\njob_1',
  'STATUS:\nDEPLOYED',
  'FILES CHANGED:\nbackend/hono.ts',
  'COMMANDS:\n- $ bun test backend/hono.test.ts -> exit 0 (PASS)\n- $ bun run typecheck -> exit 0 (PASS)\n- $ git commit/push -> exit 0 (committed abc1234)\n- $ render deploy -> exit 0 (live dep_1)',
  'TESTS:\n$ bun test backend/hono.test.ts\n12 pass\n0 fail\nexit code: 0 -> PASS',
  'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | add /health guard\ngit status --short:\n M backend/hono.ts\ncommit: abc1234 (main)\nproduction /health: healthy; changed route: live\ndeploy: dep_1 (live)\njob: job_1',
].join('\n\n');

/** A narrative-only answer (the kind the owner keeps rejecting). */
const NARRATIVE_ANSWER = [
  'I reviewed the codebase and prepared an execution plan.',
  'I initialized the development phase and will begin schema planning.',
  'The task is complete and verified, deployed to production. Awaiting approval for the next phase.',
].join('\n');

describe('hasRawCommandOutput', () => {
  test('true only when a $ command line and an exit code are present', () => {
    expect(hasRawCommandOutput(PROVEN_ANSWER)).toBe(true);
    expect(hasRawCommandOutput('I reviewed and prepared everything.')).toBe(false);
    expect(hasRawCommandOutput('$ bun test (no exit shown)')).toBe(false);
  });
});

describe('hasFileDiffProof', () => {
  test('true with a real diff stat, false on NO CODE CHANGED', () => {
    expect(hasFileDiffProof(PROVEN_ANSWER)).toBe(true);
    expect(hasFileDiffProof('FILES CHANGED:\nNO CODE CHANGED — no development was completed.')).toBe(false);
  });
});

describe('hasDeploymentProof', () => {
  test('requires a commit sha or a live endpoint line', () => {
    expect(hasDeploymentProof(PROVEN_ANSWER)).toBe(true);
    expect(hasDeploymentProof('STATUS:\nDEPLOYED\nDEPLOYED PROOF: trust me')).toBe(false);
  });
});

describe('validateDeveloperExecutionAnswer — narrative is blocked', () => {
  test('narrative-only development response fails validation', () => {
    const result = validateDeveloperExecutionAnswer(NARRATIVE_ANSWER);
    expect(result.ok).toBe(false);
    expect(result.hasAllSections).toBe(false);
    // It violates on missing sections AND banned narrative phrases.
    expect(result.violations.some((v) => v.includes('missing required sections'))).toBe(true);
    expect(result.violations.some((v) => v.includes('narrative phrase'))).toBe(true);
  });

  test('a fully proven answer passes validation', () => {
    const result = validateDeveloperExecutionAnswer(PROVEN_ANSWER);
    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

describe('claim enforcement — no proof, no claim', () => {
  test('development task cannot claim done without a real file diff', () => {
    const answer = [
      'TASK ID:\njob_2',
      'STATUS:\nBLOCKED',
      'FILES CHANGED:\nNO CODE CHANGED — no development was completed.',
      'COMMANDS:\nNONE — no commands were executed.',
      'TESTS:\nNOT VERIFIED — tests were not run.',
      'DEPLOYED PROOF:\nTask complete and done. job: job_2',
    ].join('\n\n');
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('without a real file diff'))).toBe(true);
  });

  test('verification cannot be claimed without raw command output', () => {
    const answer = [
      'TASK ID:\njob_3',
      'STATUS:\nLOCAL ONLY',
      'FILES CHANGED:\nbackend/hono.ts',
      'COMMANDS:\nNONE — no commands were executed.',
      'TESTS:\nAll checks passed and verified.',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | edit\ngit status --short:\n M backend/hono.ts\njob: job_3',
    ].join('\n\n');
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('without raw command output'))).toBe(true);
  });

  test('deployment cannot be claimed without live endpoint proof', () => {
    const answer = [
      'TASK ID:\njob_4',
      'STATUS:\nDEPLOYED',
      'FILES CHANGED:\nbackend/hono.ts',
      'COMMANDS:\n- $ bun test -> exit 0 (PASS)',
      'TESTS:\n$ bun test\n1 pass\nexit code: 0 -> PASS',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | edit\ngit status --short:\n M backend/hono.ts\njob: job_4',
    ].join('\n\n');
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes('without live endpoint'))).toBe(true);
  });

  test('answer with goal word "complete" in quoted text is allowed when structured proof is present', () => {
    const answer = [
      'TASK ID:\njob_5',
      'STATUS:\nDEPLOYED',
      'FILES CHANGED:\nbackend/hono.ts',
      'COMMANDS:\n- $ bun test -> exit 0 (PASS)',
      'TESTS:\n$ bun test\n1 pass\nexit code: 0 -> PASS',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | edit\ncommit: abc1234\nproduction /health: healthy\njob: job_5',
    ].join('\n\n');
    const result = validateDeveloperExecutionAnswer(answer);
    expect(result.ok).toBe(true);
  });
});

describe('enforceDeveloperExecutionAnswer', () => {
  test('passes a proven answer through unchanged', () => {
    const { answer, enforced } = enforceDeveloperExecutionAnswer(PROVEN_ANSWER);
    expect(enforced).toBe(false);
    expect(answer).toBe(PROVEN_ANSWER);
  });

  test('replaces a narrative answer with a BLOCKED strict-format answer', () => {
    const { answer, enforced, result } = enforceDeveloperExecutionAnswer(NARRATIVE_ANSWER);
    expect(enforced).toBe(true);
    expect(result.ok).toBe(false);
    // The replacement is itself in strict 6-section format and reports BLOCKED.
    expect(answer).toContain('STATUS:\nBLOCKED');
    expect(answer).toContain('NO CODE CHANGED — no development was completed.');
    // And the replacement passes the guard (it makes no unproven claims).
    expect(validateDeveloperExecutionAnswer(answer).ok).toBe(true);
  });
});

describe('buildBlockedDeveloperExecutionAnswer', () => {
  test('lists the violations in the DEPLOYED PROOF section', () => {
    const answer = buildBlockedDeveloperExecutionAnswer(['claims "verified" without raw command output']);
    expect(answer).toContain('failed developer-execution enforcement');
    expect(answer).toContain('claims "verified" without raw command output');
  });
});
