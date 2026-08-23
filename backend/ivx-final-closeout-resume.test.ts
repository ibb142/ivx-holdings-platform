import { describe, expect, it } from 'bun:test';
import {
  extractRenderApiKey,
  extractRenderServiceId,
  isPlausibleRenderApiKey,
  isPlausibleRenderServiceId,
} from './services/ivx-render-credentials';
import {
  resumeIVXAutonomousCoderFromCiWait,
  IVX_AUTONOMOUS_CODER_MARKER,
  type IVXCiCheckEvidence,
} from './services/ivx-autonomous-coder';

describe('IVX Render credentials — label-tolerant extraction (final closeout 2026-08-23)', () => {
  it('extracts the real rnd_ key from a label-prefixed env value', () => {
    expect(extractRenderApiKey('Render  key rnd_1H0XCquMZQTRyA9b2c3d4e5f6')).toBe('rnd_1H0XCquMZQTRyA9b2c3d4e5f6');
    expect(extractRenderApiKey('Render key rnd_abc123XYZ ')).toBe('rnd_abc123XYZ');
  });

  it('passes through a bare key unchanged', () => {
    expect(extractRenderApiKey('rnd_1H0XCquMZQTRyA9b2c3d4e5f6')).toBe('rnd_1H0XCquMZQTRyA9b2c3d4e5f6');
  });

  it('returns empty for values with no real key (never sends garbage to api.render.com)', () => {
    expect(extractRenderApiKey('Render key  render ssh, render ssh srv-a')).toBe('');
    expect(extractRenderApiKey('')).toBe('');
    expect(extractRenderApiKey(undefined)).toBe('');
    expect(extractRenderApiKey(null)).toBe('');
  });

  it('extracts the real srv- service id from a value full of operational notes', () => {
    expect(extractRenderServiceId('Render key  render ssh, render ssh srv-a notes srv-d7t9ivreo5us73ftose0 extra text')).toBe('srv-d7t9ivreo5us73ftose0');
    expect(extractRenderServiceId('srv-d9i15fg4n6ts73bn00j0')).toBe('srv-d9i15fg4n6ts73bn00j0');
    expect(extractRenderServiceId('no service here')).toBe('');
    expect(extractRenderServiceId(undefined)).toBe('');
  });

  it('plausibility checks accept real-shaped credentials only', () => {
    expect(isPlausibleRenderApiKey('rnd_1H0XCquMZQTRyA9b2c3d4e5f6')).toBe(true);
    expect(isPlausibleRenderApiKey('garbage')).toBe(false);
    expect(isPlausibleRenderServiceId('srv-d7t9ivreo5us73ftose0')).toBe(true);
    expect(isPlausibleRenderServiceId('notes only')).toBe(false);
  });
});

/** Green required-check evidence fixture (all matched, completed, success). */
function greenChecks(): IVXCiCheckEvidence[] {
  return ['qa-suite', 'TypeScript typecheck', 'Lint', 'scan-secrets', 'Playwright E2E', 'Maestro E2E', 'Guard']
    .map((context) => ({ context, checkRunName: context, status: 'completed', conclusion: 'success', detailsUrl: null, matched: true }));
}

/** Red required-check evidence fixture (one definitive failure). */
function redChecks(): IVXCiCheckEvidence[] {
  const checks = greenChecks();
  checks[0] = { ...checks[0], conclusion: 'failure' };
  return checks;
}

const RESUME_BASE = {
  taskId: 'ivx-worker-resume-test-1',
  goal: 'Final closeout restart-resume test job',
  ownerId: 'owner-test',
  commitSha: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  prNumber: 999,
  prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/999',
  branch: 'ivx-autonomous-ivx-worker-resume-test-1',
  testsPassed: true,
  typecheckPassed: true,
} as const;

describe('IVX Autonomous Coder — restart / CI-wait resume (final closeout 2026-08-23)', () => {
  it('PR open + all checks green → merges and COMPLETES with the original taskId', async () => {
    const mergeCalls: number[] = [];
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async () => greenChecks(),
      mergeFn: async (prNumber) => {
        mergeCalls.push(prNumber);
        return { merged: true, mergeCommitSha: 'merge-sha-resume-1' };
      },
    });
    expect(mergeCalls).toEqual([999]);
    expect(proof.marker).toBe(IVX_AUTONOMOUS_CODER_MARKER);
    expect(proof.taskId).toBe('ivx-worker-resume-test-1');
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.resumedFromRestart).toBe(true);
    expect(proof.prMerged).toBe(true);
    expect(proof.prMergeCommitSha).toBe('merge-sha-resume-1');
    expect(proof.ciChecksGreen).toBe(true);
    expect(proof.testsPassed).toBe(true);
    expect(proof.typecheckPassed).toBe(true);
  });

  it('PR open + red required checks → BLOCKED, never COMPLETED, merge NOT attempted', async () => {
    let mergeAttempted = false;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async () => redChecks(),
      mergeFn: async () => {
        mergeAttempted = true;
        return { merged: true, mergeCommitSha: 'should-not-happen' };
      },
    });
    expect(mergeAttempted).toBe(false);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.prMerged).toBe(false);
    expect(proof.error).toContain('Required CI checks FAILED');
    expect(proof.error).toContain('qa-suite=completed/failure');
  });

  it('PR already merged before resume → reconciles the merge SHA and COMPLETES without re-merging', async () => {
    let mergeAttempted = false;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'closed', merged: true, mergeCommitSha: 'reconciled-merge-sha' }),
      mergeFn: async () => {
        mergeAttempted = true;
        return { merged: true, mergeCommitSha: null };
      },
    });
    expect(mergeAttempted).toBe(false);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.prMergeCommitSha).toBe('reconciled-merge-sha');
    expect(proof.resumedFromRestart).toBe(true);
  });

  it('PR merged but GitHub returns no merge SHA → BLOCKED, never COMPLETED', async () => {
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'closed', merged: true, mergeCommitSha: null }),
      requiredChecksFn: async () => greenChecks(),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.error).toContain('no merge commit SHA');
  });

  it('PR closed unmerged → BLOCKED with honest reason', async () => {
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'closed', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async () => greenChecks(),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.error).toContain('CLOSED without merging');
  });

  it('PR state query failure → FAILED with the resume error, never a silent COMPLETED', async () => {
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => { throw new Error('GitHub PR fetch failed: 502'); },
    });
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.error).toContain('Restart resume failed');
  });

  it('merge attempted but not confirmed → BLOCKED, never COMPLETED', async () => {
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async () => greenChecks(),
      mergeFn: async () => ({ merged: true, mergeCommitSha: null }),
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.error).toContain('NOT confirmed');
  });
});
