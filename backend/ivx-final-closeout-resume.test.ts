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
  for (const checkpoint of ['original', 'invalid', 'future'] as const) {
    it(`uses ${checkpoint} CI checkpoint time without resetting or bypassing the grace period`, async () => {
      let merges = 0;
      const ciWaitStartedAt = checkpoint === 'original' ? new Date(Date.now() - 11 * 60_000).toISOString()
        : checkpoint === 'future' ? new Date(Date.now() + 60_000).toISOString() : 'invalid';
      const missing = { context: 'path-filtered invariant', checkRunName: null,
        status: 'not_reported', conclusion: null, detailsUrl: null, matched: false };
      const proof = await resumeIVXAutonomousCoderFromCiWait({
        ...RESUME_BASE, ciWaitStartedAt, ciWaitTimeoutMs: 0,
        prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
        requiredChecksFn: async () => [...greenChecks(), missing],
        mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'same-head-merge' }; },
      });
      expect(merges).toBe(checkpoint === 'original' ? 1 : 0);
      expect(proof.finalStatus).toBe(checkpoint === 'original' ? 'COMPLETED' : 'BLOCKED');
      expect(proof.ciCheckEvidence?.at(-1)?.status).toBe(checkpoint === 'original' ? 'not_applicable' : 'not_reported');
      expect(proof.taskId).toBe(RESUME_BASE.taskId);
      expect(proof.commitSha).toBe(RESUME_BASE.commitSha);
    });
  }
  for (const state of ['in_progress', 'failure'] as const) {
    it(`an old checkpoint cannot approve a ${state} check`, async () => {
      let merges = 0;
      const checks = greenChecks();
      checks[0] = { ...checks[0], status: state === 'in_progress' ? state : 'completed',
        conclusion: state === 'failure' ? state : null };
      const proof = await resumeIVXAutonomousCoderFromCiWait({
        ...RESUME_BASE, ciWaitStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
        ciWaitTimeoutMs: 0,
        prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
        requiredChecksFn: async () => checks,
        mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'forbidden' }; },
      });
      expect(merges).toBe(0);
      expect(proof.finalStatus).toBe('BLOCKED');
      expect(proof.ciChecksGreen).toBe(false);
    });
  }
  it('retains the video defect boundary after restart even with green CI', async () => {
    for (const filesChanged of [[], ['backend/services/ivx-deal-matching-engine.ts']]) {
      let merges = 0;
      const persisted = JSON.parse(JSON.stringify({ ...RESUME_BASE,
        taskId: `landing-remediation:${'a'.repeat(40)}:deals.videos-present`, filesChanged }));
      const proof = await resumeIVXAutonomousCoderFromCiWait({
        ...persisted,
        prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
        requiredChecksFn: async () => greenChecks(),
        mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'forbidden' }; },
      });
      expect(merges).toBe(0);
      expect(proof.prMerged).toBe(false);
      expect(proof.error).toContain('REPAIR_DEFECT_SCOPE_VIOLATION');
      expect(proof.taskId).toBe(persisted.taskId);
    }
  });

  for (const refusal of ['Worker lease lost', 'EMERGENCY_STOP_ACTIVE', 'EMERGENCY_STOP_UNAVAILABLE']) {
  it(`${refusal} prevents a resumed merge even when all required checks are green`, async () => {
    let mergeAttempted = false;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...RESUME_BASE,
      prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async () => greenChecks(),
      beforeMerge: async () => { throw new Error(refusal); },
      mergeFn: async () => { mergeAttempted = true; return { merged: true, mergeCommitSha: 'forbidden' }; },
    });
    expect(mergeAttempted).toBe(false);
    expect(proof.prMerged).toBe(false);
    expect(proof.finalStatus).toBe('FAILED');
  });
  }
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
      requiredChecksFn: async () => greenChecks(),
      mergeFn: async () => {
        mergeAttempted = true;
        return { merged: true, mergeCommitSha: null };
      },
    });
    expect(mergeAttempted).toBe(false);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.prMergeCommitSha).toBe('reconciled-merge-sha');
    expect(proof.ciChecksGreen).toBe(true);
    expect(proof.ciCheckEvidence).toEqual(greenChecks());
    expect(proof.iterations).toEqual([]);
    expect(proof.commandsRun).toEqual([]);
    expect(proof.resumedFromRestart).toBe(true);
  });

  for (const scenario of ['red', 'missing', 'unavailable'] as const) {
    it(`already merged PR with ${scenario} CI cannot certify the saved job`, async () => {
      let writes = 0;
      const proof = await resumeIVXAutonomousCoderFromCiWait({
        ...RESUME_BASE,
        prStateFn: async () => ({ state: 'closed', merged: true, mergeCommitSha: 'reconciled-merge-sha' }),
        requiredChecksFn: async () => {
          if (scenario === 'unavailable') throw new Error('GitHub check lookup unavailable');
          return scenario === 'red' ? redChecks() : [];
        },
        ciWaitTimeoutMs: 1, ciPollIntervalMs: 0, ciNaGraceMs: 0, sleepFn: async () => {},
        mergeFn: async () => { writes++; throw new Error('Already merged work must not be merged again'); },
      });
      expect(writes).toBe(0);
      expect(proof.finalStatus).not.toBe('COMPLETED');
      expect(proof.ciChecksGreen).not.toBe(true);
      expect(proof.commitSha).toBe(RESUME_BASE.commitSha);
      expect(proof.prMerged).toBe(true);
      expect(proof.prMergeCommitSha).toBe('reconciled-merge-sha');
      expect(proof.llmCallCount).toBe(0);
      expect(proof.deployRequested).toBe(false);
      expect(proof.productionVerified).toBe(false);
    });
  }

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
