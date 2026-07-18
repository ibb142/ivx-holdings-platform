import { describe, expect, it, beforeEach } from 'bun:test';
import {
  runPreExecutionFeasibilityGate,
  classifyTaskIntent,
  requiredCapabilitiesFor,
  formatFeasibilityGateBlock,
  describeFeasibilityGateRun,
  ownerActionFor,
  recordBlocker,
  getBlockerMemory,
  clearBlockerMemory,
  snapshotBlockerMemory,
  isRepeatedBlocker,
  maskCredential,
  resolveGithubRepoIdentity,
  IVX_AUTHORIZED_GITHUB_REPO,
  IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
  BLOCKER_REPEAT_THRESHOLD,
  type BlockerCode,
  type CredentialProbeMap,
  type CredentialProbeResult,
  type FeasibilityGateResult,
} from './ivx-pre-execution-feasibility-gate';

// ─── Test helpers ────────────────────────────────────────────────────

function envWith(overrides: Record<string, string>): Record<string, string | undefined> {
  return { ...process.env, ...overrides };
}

function probeThatRejects(httpStatus: number, detail: string): (value: string) => Promise<CredentialProbeResult> {
  return async () => ({ ok: false, httpStatus, detail });
}

function probeThatAccepts(httpStatus = 200, detail = 'authenticated'): (value: string) => Promise<CredentialProbeResult> {
  return async () => ({ ok: true, httpStatus, detail });
}

const FULL_ENV = {
  IVX_GITHUB_TOKEN: 'ghp_abcdef1234567890abcdef1234567890abcd',
  GITHUB_REPO: 'ibb142/rork-global-real-estate-invest',
  IVX_RENDER_API_KEY: 'rnd_abcdef1234567890abcdef',
  IVX_RENDER_SERVICE_ID: 'srv-d7t9ivreo5us73ftose0',
  IVX_SUPABASE_URL: 'https://example.supabase.co',
  IVX_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.examplekey',
  IVX_OWNER_TOKEN: 'owner-token-1234567890abcdef',
};

const ALL_ACCEPT_PROBES: CredentialProbeMap = {
  IVX_GITHUB_TOKEN: probeThatAccepts(),
  IVX_RENDER_API_KEY: probeThatAccepts(),
  IVX_RENDER_SERVICE_ID: probeThatAccepts(),
  IVX_SUPABASE_URL: probeThatAccepts(),
  IVX_SUPABASE_SERVICE_ROLE_KEY: probeThatAccepts(),
  IVX_OWNER_TOKEN: probeThatAccepts(),
};

const TASK_ID = 'test-task-001';

beforeEach(() => {
  clearBlockerMemory();
});

// ─── Tests ───────────────────────────────────────────────────────────

describe('IVX Pre-Execution Feasibility Gate', () => {
  describe('marker + shape', () => {
    it('exposes a stable marker for audit', () => {
      expect(IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER).toMatch(/^ivx-pre-execution-feasibility-gate-2026-07-05/);
    });

    it('BLOCKED result carries the exact required fields', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: FULL_ENV,
        skipLiveProbes: true,
      });
      if (result.state !== 'BLOCKED') throw new Error('expected BLOCKED');
      expect(result.state).toBe('BLOCKED');
      expect(result.taskId).toBe(TASK_ID);
      expect(result.blockerCode).toBeDefined();
      expect(result.exactBlocker).toBeTruthy();
      expect(result.failedCapability).toBeDefined();
      expect(result.nextOwnerAction).toBeTruthy();
      expect(result.marker).toBe(IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER);
    });

    it('READY result carries capabilities + marker', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'inspect current status',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: FULL_ENV,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('READY');
      if (result.state === 'READY') {
        expect(result.marker).toBe(IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER);
        expect(Array.isArray(result.capabilities)).toBe(true);
      }
    });
  });

  describe('classifyTaskIntent + requiredCapabilitiesFor', () => {
    it('classifies "deploy now" as full_deploy_cycle', () => {
      expect(classifyTaskIntent('deploy now')).toBe('full_deploy_cycle');
      expect(requiredCapabilitiesFor('full_deploy_cycle')).toContain('push_github');
      expect(requiredCapabilitiesFor('full_deploy_cycle')).toContain('trigger_render_deploy');
      expect(requiredCapabilitiesFor('full_deploy_cycle')).toContain('verify_live_endpoint');
    });

    it('classifies "push this commit" as push_github', () => {
      expect(classifyTaskIntent('push this commit to github')).toBe('push_github');
    });

    it('classifies "run Supabase migration" as migrate_database', () => {
      expect(classifyTaskIntent('run Supabase migration now')).toBe('migrate_database');
    });

    it('classifies "is this verified?" as verify_live_endpoint', () => {
      expect(classifyTaskIntent('is this verified?')).toBe('verify_live_endpoint');
    });

    it('classifies "fix owner login" as verify_owner_session', () => {
      expect(classifyTaskIntent('fix owner login')).toBe('verify_owner_session');
    });

    it('classifies conversational prompts as conversational (no capabilities)', () => {
      expect(classifyTaskIntent('What is Casa Rosario?')).toBe('conversational');
      expect(requiredCapabilitiesFor('conversational')).toEqual([]);
    });

    it('read-only inspection requires only read_files', () => {
      expect(classifyTaskIntent('inspect current IVX AI chat behavior')).toBe('read_only_inspection');
      expect(requiredCapabilitiesFor('read_only_inspection')).toEqual(['read_files']);
    });
  });

  describe('GitHub token missing', () => {
    it('blocks push_github when GITHUB_TOKEN absent', async () => {
      const env = envWith({ ...FULL_ENV, IVX_GITHUB_TOKEN: '', GITHUB_TOKEN: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('GITHUB_TOKEN_MISSING');
      // push_github requires [verify_owner_session, commit, push_github] — the
      // commit capability also needs the GitHub token, so it fails first. Both
      // are GitHub-token blockers; the gate reports the first failing capability.
      expect(['commit', 'push_github']).toContain(result.failedCapability);
      expect(result.requiredVariable).toBe('IVX_GITHUB_TOKEN');
      expect(result.nextOwnerAction).toMatch(/GITHUB_TOKEN/i);
    });

    it('does not print the secret value (only masked prefix + length)', async () => {
      const env = envWith({ ...FULL_ENV });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('READY');
      const snapshot = describeFeasibilityGateRun(result);
      const json = JSON.stringify(snapshot);
      // The full token must never appear in the audit snapshot.
      expect(json).not.toContain(FULL_ENV.IVX_GITHUB_TOKEN);
      expect(snapshot.secretValuesReturned).toBe(false);
    });
  });

  describe('GitHub token revoked (HTTP 401)', () => {
    it('blocks with GITHUB_TOKEN_REVOKED when probe returns 401', async () => {
      const probes: CredentialProbeMap = {
        ...ALL_ACCEPT_PROBES,
        IVX_GITHUB_TOKEN: probeThatRejects(401, 'token invalid or expired'),
      };
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes,
        env: envWith(FULL_ENV),
        skipLiveProbes: false,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('GITHUB_TOKEN_REVOKED');
      expect(result.httpStatus).toBe(401);
      expect(result.exactBlocker).toMatch(/401|invalid|expired/i);
    });
  });

  describe('Render key missing', () => {
    it('blocks trigger_render_deploy when RENDER_API_KEY absent', async () => {
      const env = envWith({ ...FULL_ENV, IVX_RENDER_API_KEY: '', RENDER_API_KEY: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'trigger Render deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('RENDER_KEY_MISSING');
      expect(result.failedCapability).toBe('trigger_render_deploy');
    });
  });

  describe('Render service ID wrong', () => {
    it('blocks when RENDER_SERVICE_ID is missing', async () => {
      const env = envWith({ ...FULL_ENV, IVX_RENDER_SERVICE_ID: '', RENDER_SERVICE_ID: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'trigger Render deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('RENDER_SERVICE_ID_INVALID');
    });

    it('blocks when RENDER_SERVICE_ID shape is too short', async () => {
      const probes: CredentialProbeMap = {
        ...ALL_ACCEPT_PROBES,
        IVX_RENDER_SERVICE_ID: async () => ({ ok: false, httpStatus: null, detail: 'service id too short (shape check)' }),
      };
      const env = envWith({ ...FULL_ENV, IVX_RENDER_SERVICE_ID: 'short', RENDER_SERVICE_ID: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'trigger Render deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes,
        env,
        skipLiveProbes: false,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('RENDER_SERVICE_ID_INVALID');
    });
  });

  describe('Supabase anon key mismatch', () => {
    it('blocks with SUPABASE_ANON_KEY_MISMATCH when service role key returns 401', async () => {
      const probes: CredentialProbeMap = {
        ...ALL_ACCEPT_PROBES,
        IVX_SUPABASE_SERVICE_ROLE_KEY: probeThatRejects(401, 'key invalid'),
      };
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'run Supabase migration now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes,
        env: envWith(FULL_ENV),
        skipLiveProbes: false,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('SUPABASE_ANON_KEY_MISMATCH');
    });
  });

  describe('Supabase service role missing', () => {
    it('blocks migrate_database when SUPABASE_SERVICE_ROLE_KEY absent', async () => {
      const env = envWith({ ...FULL_ENV, IVX_SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'run Supabase migration now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('SUPABASE_SERVICE_ROLE_MISSING');
    });
  });

  describe('Owner session missing', () => {
    it('blocks deploy now when ownerSessionPresent is false', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('OWNER_SESSION_MISSING');
      expect(result.failedCapability).toBe('verify_owner_session');
      expect(result.nextOwnerAction).toMatch(/owner login/i);
    });

    it('blocks "fix owner login" when no session', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'fix owner login',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('OWNER_SESSION_MISSING');
    });
  });

  describe('No write permission / tool not available', () => {
    it('write_files is always available in-process (no NO_WRITE_PERMISSION here)', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'patch the code',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      // patch_code requires verify_owner_session, write_files, run_tests — all pass.
      expect(result.state).toBe('READY');
    });
  });

  describe('All checks pass', () => {
    it('returns READY for full deploy cycle with all creds + session', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: false,
      });
      expect(result.state).toBe('READY');
      if (result.state === 'READY') {
        expect(result.capabilities.length).toBeGreaterThan(0);
        expect(result.capabilities.every((c) => c.ok)).toBe(true);
      }
    });

    it('returns READY for conversational prompts (no capabilities)', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'What is Casa Rosario?',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith({}),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('READY');
      if (result.state === 'READY') {
        expect(result.capabilities).toEqual([]);
      }
    });
  });

  describe('Repeated blocker stops loop', () => {
    it('records blocker memory and triggers REPEATED_BLOCKER after threshold', () => {
      const code: BlockerCode = 'GITHUB_TOKEN_REVOKED';
      expect(isRepeatedBlocker(code)).toBe(false);
      recordBlocker(code, 401, 'replace the token');
      expect(isRepeatedBlocker(code)).toBe(false);
      recordBlocker(code, 401, 'replace the token');
      expect(isRepeatedBlocker(code)).toBe(true);
      const mem = getBlockerMemory(code);
      expect(mem).not.toBeNull();
      if (mem) {
        expect(mem.occurrenceCount).toBe(2);
        expect(mem.lastHttpStatus).toBe(401);
      }
    });

    it('gate returns REPEATED_BLOCKER when a blocker is already repeated in memory', async () => {
      // Pre-populate blocker memory to the threshold.
      recordBlocker('GITHUB_TOKEN_REVOKED', 401, 'replace the token');
      recordBlocker('GITHUB_TOKEN_REVOKED', 401, 'replace the token');
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('REPEATED_BLOCKER');
      expect(result.repeatedBlocker).toBe(true);
      expect(result.exactBlocker).toMatch(/recurred|refuses to loop/i);
    });

    it('clearBlockerMemory resets the spin guard', () => {
      recordBlocker('GITHUB_TOKEN_REVOKED', 401, 'replace');
      recordBlocker('GITHUB_TOKEN_REVOKED', 401, 'replace');
      expect(isRepeatedBlocker('GITHUB_TOKEN_REVOKED')).toBe(true);
      clearBlockerMemory('GITHUB_TOKEN_REVOKED');
      expect(isRepeatedBlocker('GITHUB_TOKEN_REVOKED')).toBe(false);
      expect(snapshotBlockerMemory()).toEqual([]);
    });

    it('BLOCKER_REPEAT_THRESHOLD is 2', () => {
      expect(BLOCKER_REPEAT_THRESHOLD).toBe(2);
    });
  });

  describe('No fake VERIFIED without evidence', () => {
    it('the gate never returns a VERIFIED state — only READY or BLOCKED', async () => {
      const results: FeasibilityGateResult[] = [];
      results.push(await runPreExecutionFeasibilityGate({
        prompt: 'deploy now', taskId: TASK_ID, ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES, env: envWith(FULL_ENV), skipLiveProbes: false,
      }));
      results.push(await runPreExecutionFeasibilityGate({
        prompt: 'deploy now', taskId: TASK_ID, ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES, env: envWith(FULL_ENV), skipLiveProbes: true,
      }));
      results.push(await runPreExecutionFeasibilityGate({
        prompt: 'hello', taskId: TASK_ID, ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES, env: envWith({}), skipLiveProbes: true,
      }));
      for (const r of results) {
        expect(r.state === 'READY' || r.state === 'BLOCKED').toBe(true);
        // The feasibility gate deliberately does not emit VERIFIED — that is
        // reserved for the Developer Proof Ledger. This enforces rule #6.
        expect((r as { state: string }).state).not.toBe('VERIFIED');
      }
    });

    it('formatFeasibilityGateBlock only emits STATE: READY or STATE: BLOCKED', async () => {
      const ready = await runPreExecutionFeasibilityGate({
        prompt: 'inspect status', taskId: TASK_ID, ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES, env: envWith(FULL_ENV), skipLiveProbes: true,
      });
      const blocked = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now', taskId: TASK_ID, ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES, env: envWith(FULL_ENV), skipLiveProbes: true,
      });
      const readyBlock = formatFeasibilityGateBlock(ready);
      const blockedBlock = formatFeasibilityGateBlock(blocked);
      expect(readyBlock).toContain('STATE: READY');
      expect(readyBlock).not.toContain('VERIFIED');
      expect(blockedBlock).toContain('STATE: BLOCKED');
      expect(blockedBlock).toContain('BLOCKER_CODE:');
      expect(blockedBlock).toContain('NEXT_OWNER_ACTION:');
    });
  });

  describe('Secret safety', () => {
    it('maskCredential returns prefix + ellipsis, never the full value', () => {
      const masked = maskCredential('ghp_TESTFAKETOKEN0000000000000000000000AA');
      expect(masked).not.toBeNull();
      expect(masked).toMatch(/…$/);
      expect(masked!.length).toBeLessThan(10);
      expect(masked).not.toContain('TESTFAKETOKEN');
    });

    it('maskCredential returns null for empty input', () => {
      expect(maskCredential('')).toBeNull();
    });

    it('describeFeasibilityGateRun never includes the full secret', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      const snap = describeFeasibilityGateRun(result);
      const json = JSON.stringify(snap);
      expect(json).not.toContain(FULL_ENV.IVX_GITHUB_TOKEN);
      expect(json).not.toContain(FULL_ENV.IVX_SUPABASE_SERVICE_ROLE_KEY);
      expect(snap.secretValuesReturned).toBe(false);
    });
  });

  describe('ownerActionFor — every blocker has a concrete owner action', () => {
    const codes: BlockerCode[] = [
      'GITHUB_TOKEN_MISSING',
      'GITHUB_TOKEN_REVOKED',
      'GITHUB_REPO_INVALID',
      'GITHUB_REPO_UNAUTHORIZED',
      'RENDER_KEY_MISSING',
      'RENDER_SERVICE_ID_INVALID',
      'SUPABASE_ANON_KEY_MISMATCH',
      'SUPABASE_SERVICE_ROLE_MISSING',
      'SUPABASE_SERVICE_ROLE_INVALID',
      'OWNER_SESSION_MISSING',
      'TOOL_NOT_AVAILABLE',
      'NO_WRITE_PERMISSION',
      'REPEATED_BLOCKER',
    ];
    for (const code of codes) {
      it(`${code} has a non-empty owner action`, () => {
        const action = ownerActionFor(code);
        expect(action.length).toBeGreaterThan(10);
        expect(action).toMatch(/[a-z]/i); // contains letters
      });
    }
  });

  describe('GitHub repository identity resolution (canonical variables)', () => {
    const AUTHORIZED = 'ibb142/rork-global-real-estate-invest';

    it('resolves from GITHUB_REPO ("owner/repo")', () => {
      const id = resolveGithubRepoIdentity({ GITHUB_REPO: AUTHORIZED });
      expect(id.slug).toBe(AUTHORIZED);
      expect(id.sourceVar).toBe('GITHUB_REPO');
      expect(id.authorized).toBe(true);
    });

    it('resolves from GITHUB_REPOSITORY', () => {
      const id = resolveGithubRepoIdentity({ GITHUB_REPOSITORY: AUTHORIZED });
      expect(id.slug).toBe(AUTHORIZED);
      expect(id.sourceVar).toBe('GITHUB_REPOSITORY');
      expect(id.authorized).toBe(true);
    });

    it('combines GITHUB_OWNER with a bare GITHUB_REPO name', () => {
      const id = resolveGithubRepoIdentity({ GITHUB_OWNER: 'ibb142', GITHUB_REPO: 'rork-global-real-estate-invest' });
      expect(id.slug).toBe(AUTHORIZED);
      expect(id.sourceVar).toBe('GITHUB_OWNER+GITHUB_REPO');
      expect(id.authorized).toBe(true);
    });

    it('derives from GITHUB_REPO_URL (with and without .git)', () => {
      const a = resolveGithubRepoIdentity({ GITHUB_REPO_URL: `https://github.com/${AUTHORIZED}.git` });
      expect(a.slug).toBe(AUTHORIZED);
      expect(a.sourceVar).toBe('GITHUB_REPO_URL');
      expect(a.authorized).toBe(true);
      const b = resolveGithubRepoIdentity({ GITHUB_REPO_URL: `https://github.com/${AUTHORIZED}` });
      expect(b.slug).toBe(AUTHORIZED);
    });

    it('returns empty identity when nothing is set', () => {
      const id = resolveGithubRepoIdentity({});
      expect(id.slug).toBe('');
      expect(id.sourceVar).toBeNull();
      expect(id.authorized).toBe(false);
      expect(id.authorizedRepo).toBe(IVX_AUTHORIZED_GITHUB_REPO);
    });

    it('marks a foreign repository as unauthorized', () => {
      const id = resolveGithubRepoIdentity({ GITHUB_REPO: 'someone-else/obsolete-vercel-clone' });
      expect(id.slug).toBe('someone-else/obsolete-vercel-clone');
      expect(id.authorized).toBe(false);
    });

    it('honors IVX_AUTHORIZED_GITHUB_REPO override', () => {
      const id = resolveGithubRepoIdentity({ GITHUB_REPO: 'org/other', IVX_AUTHORIZED_GITHUB_REPO: 'org/other' });
      expect(id.authorized).toBe(true);
    });

    it('blocks push_github with GITHUB_REPO_UNAUTHORIZED for a foreign repo', async () => {
      const env = { ...FULL_ENV, GITHUB_REPO: 'someone-else/obsolete-vercel-clone' };
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('GITHUB_REPO_UNAUTHORIZED');
      expect(result.exactBlocker).toContain('someone-else/obsolete-vercel-clone');
      expect(result.exactBlocker).toContain(IVX_AUTHORIZED_GITHUB_REPO);
    });

    it('passes push_github when the resolved repo is the authorized production repo (via URL)', async () => {
      const env = { ...FULL_ENV, GITHUB_REPO: '', GITHUB_REPO_URL: `https://github.com/${AUTHORIZED}.git` };
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'push this commit to github',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('READY');
    });
  });

  describe('Live acceptance test prompts (spec section 8)', () => {
    it('"Deploy now" with owner session + all creds → READY', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: false,
      });
      expect(result.state).toBe('READY');
    });

    it('"Deploy now" without owner session → BLOCKED OWNER_SESSION_MISSING', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('OWNER_SESSION_MISSING');
    });

    it('"Fix owner login" without session → BLOCKED OWNER_SESSION_MISSING', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Fix owner login',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('OWNER_SESSION_MISSING');
    });

    it('"Push this commit" without GitHub token → BLOCKED GITHUB_TOKEN_MISSING', async () => {
      const env = envWith({ ...FULL_ENV, IVX_GITHUB_TOKEN: '', GITHUB_TOKEN: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Push this commit',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('GITHUB_TOKEN_MISSING');
    });

    it('"Run Supabase migration" without service role key → BLOCKED', async () => {
      const env = envWith({ ...FULL_ENV, IVX_SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '' });
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Run Supabase migration',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env,
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      if (result.state !== 'BLOCKED') return;
      expect(result.blockerCode).toBe('SUPABASE_SERVICE_ROLE_MISSING');
    });

    it('"Is this verified?" → READY (verify_live_endpoint needs no credential)', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'Is this verified?',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith({}),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('READY');
    });
  });

  describe('Never fake execution — the gate does not emit fake files/commits/deploys', () => {
    it('a BLOCKED result never claims files_changed, commit_sha, or deploy_id', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: false,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: true,
      });
      expect(result.state).toBe('BLOCKED');
      const json = JSON.stringify(result);
      expect(json).not.toMatch(/files_changed/i);
      expect(json).not.toMatch(/commit_sha/i);
      expect(json).not.toMatch(/render_deploy_id/i);
      expect(json).not.toMatch(/deployed_commit/i);
    });

    it('a READY result does not claim a deploy happened — only that capabilities are verified', async () => {
      const result = await runPreExecutionFeasibilityGate({
        prompt: 'deploy now',
        taskId: TASK_ID,
        ownerSessionPresent: true,
        probes: ALL_ACCEPT_PROBES,
        env: envWith(FULL_ENV),
        skipLiveProbes: false,
      });
      expect(result.state).toBe('READY');
      const json = JSON.stringify(result);
      // READY means "capabilities verified, execution may proceed" — NOT that
      // anything was deployed or committed.
      expect(json).not.toMatch(/"deployed":\s*true/i);
      expect(json).not.toMatch(/deployed_commit/i);
    });
  });
});
