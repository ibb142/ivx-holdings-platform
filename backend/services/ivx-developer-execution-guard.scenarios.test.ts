/**
 * PHASE 2 — Prove the developer-execution guard is active in the IVX IA user
 * experience.
 *
 * These are not abstract unit tests. Each scenario reproduces the EXACT production
 * pipeline a real owner command flows through:
 *
 *   User command
 *     -> IVX IA (planner routes to self_developer)
 *     -> Execution layer (senior-developer runtime renders an answer)
 *     -> Guard (enforceDeveloperExecutionAnswer — the SAME function called in
 *        backend/api/ivx-owner-ai.ts at the self_developer and image-then-developer
 *        routes)
 *     -> Final response delivered to the owner
 *
 * The guard imported here is the identical export used in production
 * (`backend/api/ivx-owner-ai.ts` line 85 imports it from this module), so passing
 * these tests proves narrative-only / unproven answers are blocked in the real
 * production code paths — not in a parallel copy.
 *
 * Each scenario prints: the raw request, the raw IVX IA candidate response, which
 * guard rule triggered, and the final delivered response.
 */
import { describe, expect, test } from 'bun:test';
import {
  enforceDeveloperExecutionAnswer,
  validateDeveloperExecutionAnswer,
  DEVELOPER_EXECUTION_GUARD_MARKER,
} from './ivx-developer-execution-guard';

/**
 * Simulates the final stage of the production pipeline: a candidate answer (what
 * the model/runtime produced) is passed through the SAME guard the server calls
 * before the answer is delivered to the owner. Returns everything needed for proof.
 */
function runPipeline(rawRequest: string, candidateResponse: string): {
  rawRequest: string;
  candidateResponse: string;
  finalResponse: string;
  guardTriggered: boolean;
  violations: string[];
} {
  const validation = validateDeveloperExecutionAnswer(candidateResponse);
  const enforced = enforceDeveloperExecutionAnswer(candidateResponse);
  // Print the full pipeline trace so the raw proof is visible in the test output.
  console.log(
    [
      '',
      '──────────────────────────────────────────────',
      `RAW REQUEST:\n${rawRequest}`,
      '',
      `RAW IVX IA RESPONSE (candidate from execution layer):\n${candidateResponse}`,
      '',
      `GUARD TRIGGERED: ${enforced.enforced ? 'YES' : 'NO'}`,
      `VIOLATIONS:\n${validation.violations.map((v) => ` - ${v}`).join('\n') || ' (none)'}`,
      '',
      `FINAL RESPONSE DELIVERED TO OWNER:\n${enforced.answer}`,
      '──────────────────────────────────────────────',
    ].join('\n'),
  );
  return {
    rawRequest,
    candidateResponse,
    finalResponse: enforced.answer,
    guardTriggered: enforced.enforced,
    violations: validation.violations,
  };
}

describe('PHASE 2 — guard is active in the production pipeline', () => {
  // TEST 1 — "Build a new settings page." The runtime leaks a narrative-only
  // answer. The guard must block it (no strict sections, banned phrases).
  test('TEST 1: "Build a new settings page." — narrative-only output is blocked', () => {
    const rawRequest = 'Build a new settings page.';
    const candidate = [
      'I reviewed the codebase and prepared a plan to build the new settings page.',
      'I initialized the development phase and will begin schema planning.',
      'Once approved I am ready to start implementing the settings screen.',
    ].join('\n');

    const r = runPipeline(rawRequest, candidate);

    expect(r.guardTriggered).toBe(true);
    // It is narrative: missing the strict sections AND uses banned phrases.
    expect(r.violations.some((v) => v.includes('missing required sections'))).toBe(true);
    expect(r.violations.some((v) => v.includes('narrative phrase without proof'))).toBe(true);
    // The owner receives a BLOCKED strict-format answer, never the narrative.
    expect(r.finalResponse).toContain('STATUS:\nBLOCKED');
    expect(r.finalResponse).toContain(DEVELOPER_EXECUTION_GUARD_MARKER);
    expect(r.finalResponse).not.toContain('I reviewed');
  });

  // TEST 2 — "Verify authentication." The runtime claims verification but ran no
  // commands. The guard must block the "verified" claim (no raw command output).
  test('TEST 2: "Verify authentication." — cannot claim verification without test output', () => {
    const rawRequest = 'Verify authentication.';
    const candidate = [
      'TASK ID:\njob_auth',
      'STATUS:\nLOCAL ONLY',
      'FILES CHANGED:\n- backend/api/ivx-auth.ts',
      'COMMANDS:\nNONE — no commands were executed.',
      'TESTS:\nAll authentication checks passed and verified.',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/api/ivx-auth.ts | edit\ngit status --short:\n M backend/api/ivx-auth.ts\njob: job_auth',
    ].join('\n\n');

    const r = runPipeline(rawRequest, candidate);

    expect(r.guardTriggered).toBe(true);
    expect(r.violations.some((v) => v.includes('without raw command output'))).toBe(true);
    expect(r.finalResponse).toContain('STATUS:\nBLOCKED');
    expect(r.finalResponse).toContain('NOT VERIFIED — tests were not run.');
  });

  // TEST 3 — "Deploy the changes." The runtime claims DEPLOYED but shows no live
  // commit/endpoint proof. The guard must block the deployment claim.
  test('TEST 3: "Deploy the changes." — cannot claim deployment without live commit proof', () => {
    const rawRequest = 'Deploy the changes.';
    const candidate = [
      'TASK ID:\njob_deploy',
      'STATUS:\nDEPLOYED',
      'FILES CHANGED:\n- backend/hono.ts',
      'COMMANDS:\n- $ bun test -> exit 0 (PASS)',
      'TESTS:\n$ bun test\n3 pass\n0 fail\nexit code: 0 -> PASS',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | edit\ngit status --short:\n M backend/hono.ts\njob: job_deploy',
    ].join('\n\n');

    const r = runPipeline(rawRequest, candidate);

    expect(r.guardTriggered).toBe(true);
    expect(r.violations.some((v) => v.includes('without live endpoint'))).toBe(true);
    expect(r.finalResponse).toContain('STATUS:\nBLOCKED');
  });

  // TEST 4 — "Implement a feature but do not modify files." No files changed, but
  // the runtime still claims the task is done. The guard must block "done" and the
  // final answer must say NO CODE CHANGED.
  test('TEST 4: "Implement a feature but do not modify files." — returns NO CODE CHANGED', () => {
    const rawRequest = 'Implement a feature but do not modify files.';
    const candidate = [
      'TASK ID:\njob_feature',
      'STATUS:\nBLOCKED',
      'FILES CHANGED:\nNO CODE CHANGED — no development was completed.',
      'COMMANDS:\nNONE — no commands were executed.',
      'TESTS:\nNOT VERIFIED — tests were not run.',
      'DEPLOYED PROOF:\nThe feature is complete and done. job: job_feature',
    ].join('\n\n');

    const r = runPipeline(rawRequest, candidate);

    expect(r.guardTriggered).toBe(true);
    expect(r.violations.some((v) => v.includes('without a real file diff'))).toBe(true);
    // The delivered answer explicitly states NO CODE CHANGED.
    expect(r.finalResponse).toContain('NO CODE CHANGED — no development was completed.');
    expect(r.finalResponse).toContain('STATUS:\nBLOCKED');
    expect(r.finalResponse).not.toMatch(/\bcomplete and done\b/);
  });
});

describe('PHASE 2 — pipeline integrity (User -> IVX IA -> Execution -> Guard -> Final)', () => {
  // The guard must be idempotent: a fully-proven answer flows through UNCHANGED so
  // real developer work is never falsely blocked.
  test('a fully proven answer passes through the guard unchanged', () => {
    const provenAnswer = [
      'TASK ID:\njob_ok',
      'STATUS:\nDEPLOYED',
      'FILES CHANGED:\n- backend/hono.ts',
      'COMMANDS:\n- $ bun test backend/hono.test.ts -> exit 0 (PASS)\n- $ tsc --noEmit -> exit 0 (PASS)',
      'TESTS:\n$ bun test backend/hono.test.ts\n9 pass\n0 fail\nexit code: 0 -> PASS',
      'DEPLOYED PROOF:\ngit diff --stat (applied patch):\n backend/hono.ts | add settings route\ngit status --short:\n M backend/hono.ts\ncommit: abc1234 (main)\nproduction /health: healthy; changed route: live\njob: job_ok',
    ].join('\n\n');

    const enforced = enforceDeveloperExecutionAnswer(provenAnswer);
    expect(enforced.enforced).toBe(false);
    expect(enforced.answer).toBe(provenAnswer);
  });

  // The BLOCKED replacement the owner sees must itself survive a second pass
  // (idempotency) so the guard never loops or double-blocks its own output.
  test('the BLOCKED replacement is itself guard-compliant (idempotent)', () => {
    const narrative = 'I reviewed and prepared the work. The task is complete and verified, deployed to production.';
    const first = enforceDeveloperExecutionAnswer(narrative);
    expect(first.enforced).toBe(true);
    const second = enforceDeveloperExecutionAnswer(first.answer);
    expect(second.enforced).toBe(false);
    expect(second.answer).toBe(first.answer);
  });
});
