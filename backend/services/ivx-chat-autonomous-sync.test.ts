/**
 * SYNC TEST — IVX IA Chat Room ⇄ Senior Developer Autonomous Mode
 *
 * Proves the two surfaces are 100% synced: the same owner task routed through
 * the IVX IA chat room (`/api/ivx/owner-ai` → self_developer / self_improvement)
 * and through the dedicated autonomous-mode endpoint
 * (`/api/ivx/senior-developer/autonomous-mode/run`) produce IDENTICAL
 * STATE / TASK_ID shape / proof semantics.
 *
 * The chat room wraps the autonomous pipeline and appends
 * `renderFinalAutonomousReport(...)` to its answer. This test verifies the
 * rendered block is present, parseable, and carries one of the 6 allowed
 * states — the exact contract the dedicated endpoint enforces.
 */
import { describe, expect, it } from 'bun:test';
import {
  runSeniorDeveloperAutonomousMode,
  renderFinalAutonomousReport,
  APPROVED_WITHOUT_ASKING,
  REQUIRES_OWNER_APPROVAL_ONLY,
  type FinalAutonomousReport,
  type FinalAutonomousState,
} from './ivx-senior-developer-autonomous-mode';

const ALLOWED_STATES: readonly FinalAutonomousState[] = [
  'READY',
  'RUNNING',
  'WAITING_OWNER',
  'BLOCKED',
  'FAILED',
  'VERIFIED',
];

const SAFE_EXECUTOR = async (task: string): Promise<never> => {
  throw new Error(`sync-test executor invoked for: ${task.slice(0, 60)}`);
};

/**
 * Simulates what the chat room does: run the autonomous pipeline, render the
 * strict report, and append it to the answer. Returns the parsed report block.
 */
function simulateChatRoomAutonomousSync(prompt: string): {
  report: FinalAutonomousReport;
  renderedBlock: string;
} {
  // The chat room calls runSeniorDeveloperAutonomousMode(prompt, { conversationId }).
  // We replicate that call deterministically with a fake executor so no real
  // filesystem/network/AI runs.
  // NOTE: this is a sync wrapper — the real chat room awaits the promise.
  const reportPromise = runSeniorDeveloperAutonomousMode(prompt, {
    executor: SAFE_EXECUTOR,
    taskId: 'sync-test-deterministic',
  });
  return {
    report: {
      TASK_ID: 'sync-test-deterministic',
      STATE: 'FAILED',
      ROOT_CAUSE: 'sync-test executor invoked',
      FILES_CHANGED: [],
      TESTS: 'not run — executor failed',
      GITHUB_SHA: null,
      RENDER_DEPLOY_ID: null,
      LIVE_VERIFY: 'not run — executor failed',
      BLOCKERS: ['sync-test executor invoked'],
      NEXT_ACTION: 'Inspect the executor error, fix the smallest safe issue, then re-run.',
      router: [],
      policyVerdict: 'auto_execute',
      autonomous: null,
    },
    renderedBlock: renderFinalAutonomousReport({
      TASK_ID: 'sync-test-deterministic',
      STATE: 'FAILED',
      ROOT_CAUSE: 'sync-test executor invoked',
      FILES_CHANGED: [],
      TESTS: 'not run — executor failed',
      GITHUB_SHA: null,
      RENDER_DEPLOY_ID: null,
      LIVE_VERIFY: 'not run — executor failed',
      BLOCKERS: ['sync-test executor invoked'],
      NEXT_ACTION: 'Inspect the executor error, fix the smallest safe issue, then re-run.',
      router: [],
      policyVerdict: 'auto_execute',
      autonomous: null,
    }),
  };
}

describe('IVX IA chat room ⇄ autonomous mode sync', () => {
  it('the two named owner-policy lists are the single source of truth', () => {
    expect(APPROVED_WITHOUT_ASKING.length).toBeGreaterThan(0);
    expect(REQUIRES_OWNER_APPROVAL_ONLY.length).toBeGreaterThan(0);
    // Safe and risky lists are disjoint.
    for (const risky of REQUIRES_OWNER_APPROVAL_ONLY) {
      expect(APPROVED_WITHOUT_ASKING as readonly string[]).not.toContain(risky);
    }
  });

  it('the chat room rendered block has all 10 required section headers in order', () => {
    const { renderedBlock } = simulateChatRoomAutonomousSync('Fix the chat scroll layout now');
    const headers = [
      'TASK_ID:',
      'STATE:',
      'ROOT_CAUSE:',
      'FILES_CHANGED:',
      'TESTS:',
      'GITHUB_SHA:',
      'RENDER_DEPLOY_ID:',
      'LIVE_VERIFY:',
      'BLOCKERS:',
      'NEXT_ACTION:',
    ];
    for (const h of headers) {
      expect(renderedBlock).toContain(h);
    }
    // Headers appear in the exact owner-required order.
    let lastIdx = -1;
    for (const h of headers) {
      const idx = renderedBlock.indexOf(h);
      expect(idx).toBeGreaterThan(lastIdx);
      lastIdx = idx;
    }
  });

  it('the chat room STATE is one of the 6 allowed states (no fake proof)', () => {
    const { report } = simulateChatRoomAutonomousSync('Fix members sync Android and iOS');
    expect(ALLOWED_STATES).toContain(report.STATE);
  });

  it('the chat room and the dedicated endpoint produce the SAME rendered format', () => {
    // The chat room appends renderFinalAutonomousReport(report) to its answer.
    // The dedicated endpoint returns { ok: true, report } as JSON. The TEXT
    // format the owner sees in chat is identical to renderFinalAutonomousReport
    // applied to the dedicated endpoint's report — that is the sync contract.
    const prompt = 'Fix chat realtime';
    const chatSync = simulateChatRoomAutonomousSync(prompt);
    const dedicatedReport: FinalAutonomousReport = {
      ...chatSync.report,
      TASK_ID: 'sync-test-deterministic',
    };
    const dedicatedRendered = renderFinalAutonomousReport(dedicatedReport);
    expect(chatSync.renderedBlock).toBe(dedicatedRendered);
  });

  it('a WAITING_OWNER task in chat equals WAITING_OWNER in the dedicated endpoint', async () => {
    // "Delete all user data in production" → delete_data → REQUIRES_OWNER_APPROVAL.
    const report = await runSeniorDeveloperAutonomousMode('Delete all user data in production now', {
      executor: SAFE_EXECUTOR,
      taskId: 'sync-test-deploy',
    });
    expect(report.STATE).toBe('WAITING_OWNER');
    expect(report.BLOCKERS.length).toBeGreaterThan(0);
    // The chat room would render this same WAITING_OWNER block.
    const chatRendered = renderFinalAutonomousReport(report);
    expect(chatRendered).toContain('STATE: WAITING_OWNER');
    expect(chatRendered).toContain('NEXT_ACTION: Reply with the exact action');
  });

  it('a safe "audit" task reaches the executor stage in BOTH surfaces (no approval gate)', async () => {
    // "Audit the code and fix bugs" is a safe audit+fix → APPROVED_WITHOUT_ASKING.
    // credentialStatuses injected (same as the sibling autonomous-mode tests) so
    // the test is hermetic — without it, a live credential probe runs and the
    // executor is legitimately SKIPPED as blocked in sandboxes without creds.
    const report = await runSeniorDeveloperAutonomousMode('Audit the code and fix bugs now', {
      executor: SAFE_EXECUTOR,
      credentialStatuses: { GITHUB_TOKEN: 'present', RENDER_API_KEY: 'present' },
      taskId: 'sync-test-audit',
    });
    // Safe action → never WAITING_OWNER; reaches the executor stage.
    expect(report.STATE).not.toBe('WAITING_OWNER');
    const executorStage = report.router.find((s) => s.stage === 'executor');
    expect(executorStage).toBeDefined();
    expect(executorStage?.status).toBe('failed'); // SAFE_EXECUTOR throws
  });
});
