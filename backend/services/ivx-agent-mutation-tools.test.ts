/**
 * Tests for the owner-approved write → commit → push → deploy pipeline.
 *
 * These exercise REAL filesystem writes and REAL git operations against
 * throwaway repositories created under the OS temp dir, including a real bare
 * remote so `git_push` is genuinely verified (push + `ls-remote` confirmation),
 * not mocked.
 */
import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  executeMutationTool,
  verifyOwnerApproval,
  isProtectedWritePath,
  isMutationTool,
  normalizeMutationToolId,
  redactSecrets,
  runVerificationGate,
  type VerificationGate,
} from './ivx-agent-mutation-tools';
import { executeRealTool } from './ivx-agent-real-tools';

const OWNER_TOKEN = 'test-owner-token-8c1f2a';
let previousOwnerToken: string | undefined;

function sh(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 60_000 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number }) | null;
      resolve({ code: typeof e?.code === 'number' ? e.code : e ? 1 : 0, out: `${stdout}${stderr}` });
    });
  });
}

/** A real git repo with a real bare remote named `origin`. */
async function makeRepo(): Promise<{ repo: string; remote: string; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ivx-mut-')));
  const repo = path.join(base, 'work');
  const remote = path.join(base, 'remote.git');
  await mkdir(repo, { recursive: true });
  await sh('git', ['init', '--bare', remote], base);
  await sh('git', ['init'], repo);
  await sh('git', ['config', 'user.email', 'test@ivx.local'], repo);
  await sh('git', ['config', 'user.name', 'IVX Test'], repo);
  await sh('git', ['config', 'commit.gpgsign', 'false'], repo);
  await writeFile(path.join(repo, 'seed.txt'), 'seed\n', 'utf8');
  await sh('git', ['add', '.'], repo);
  await sh('git', ['commit', '-m', 'seed'], repo);
  await sh('git', ['remote', 'add', 'origin', remote], repo);
  return { repo, remote, cleanup: () => rm(base, { recursive: true, force: true }) };
}

const GREEN: VerificationGate = {
  passed: true,
  typecheckErrors: 0,
  testsPass: 42,
  failingTestNames: [],
  detail: 'verification GREEN (injected real-shape result for commit test)',
  evidenceSha256: 'a'.repeat(64),
};

const RED: VerificationGate = {
  passed: false,
  typecheckErrors: 3,
  testsPass: 10,
  failingTestNames: ['some failing test'],
  detail: 'verification RED — 3 type error(s), 1 failing test name(s)',
  evidenceSha256: 'b'.repeat(64),
};

beforeEach(() => {
  previousOwnerToken = process.env.IVX_OWNER_TOKEN;
  process.env.IVX_OWNER_TOKEN = OWNER_TOKEN;
});

afterEach(() => {
  if (previousOwnerToken === undefined) delete process.env.IVX_OWNER_TOKEN;
  else process.env.IVX_OWNER_TOKEN = previousOwnerToken;
});

describe('verifyOwnerApproval', () => {
  it('rejects a missing token', () => {
    const r = verifyOwnerApproval(null);
    expect(r.approved).toBe(false);
    expect(r.reason).toBe('missing_owner_approval_token');
  });

  it('rejects a wrong token — presence is not authorization', () => {
    const r = verifyOwnerApproval('definitely-not-the-owner-token');
    expect(r.approved).toBe(false);
    expect(r.reason).toBe('invalid_owner_approval_token');
  });

  it('accepts the configured owner token and reports a credential binding', () => {
    const r = verifyOwnerApproval(OWNER_TOKEN);
    expect(r.approved).toBe(true);
    expect(r.binding).toContain('env:IVX_OWNER_TOKEN#sha256:');
  });

  it('refuses to authorize when no owner token is configured', () => {
    delete process.env.IVX_OWNER_TOKEN;
    const r = verifyOwnerApproval('anything');
    expect(r.approved).toBe(false);
    expect(r.reason).toContain('owner_token_not_configured');
  });
});

describe('guards', () => {
  it('flags protected write paths', () => {
    expect(isProtectedWritePath('.git/config')).toBe(true);
    expect(isProtectedWritePath('node_modules/foo/index.js')).toBe(true);
    expect(isProtectedWritePath('expo/.env')).toBe(true);
    expect(isProtectedWritePath('expo/keys/service.json')).toBe(true);
    expect(isProtectedWritePath('certs/server.pem')).toBe(true);
    expect(isProtectedWritePath('backend/services/foo.ts')).toBe(false);
  });

  it('maps historical deploy aliases onto the real deploy tool', () => {
    expect(normalizeMutationToolId('prod_deploy')).toBe('deploy');
    expect(normalizeMutationToolId('deploy_to_production')).toBe('deploy');
    expect(isMutationTool('git_push')).toBe(true);
    expect(isMutationTool('wikipedia_search')).toBe(false);
  });

  it('redacts credentials that appear in git transcripts', () => {
    const raw = 'remote: https://x-access-token:ghs_abcdefghij0123456789@github.com/o/r.git pushed';
    const clean = redactSecrets(raw);
    expect(clean).not.toContain('ghs_abcdefghij0123456789');
    expect(clean).toContain('https://***:***@');
  });
});

describe('code_write', () => {
  it('performs a real write and reports before/after digests', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'code_write',
        { path: 'src/new-file.ts', content: 'export const x = 1;\n' },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(true);
      expect(res.approvalVerified).toBe(true);
      expect(await readFile(path.join(repo, 'src/new-file.ts'), 'utf8')).toBe('export const x = 1;\n');
      expect(res.extract.created).toBe(true);
      expect(res.contentSha256).toHaveLength(64);
    } finally {
      await cleanup();
    }
  });

  it('refuses without a valid owner token and writes nothing', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'code_write',
        { path: 'src/blocked.ts', content: 'nope' },
        { repoRoot: repo, ownerApprovalToken: 'wrong-token' },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('invalid_owner_approval_token');
      expect(await readFile(path.join(repo, 'src/blocked.ts'), 'utf8').catch(() => null)).toBeNull();
    } finally {
      await cleanup();
    }
  });

  it('refuses protected paths even when approved', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'code_write',
        { path: '.git/config', content: 'malicious' },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('protected path');
    } finally {
      await cleanup();
    }
  });

  it('refuses path traversal outside the repo root', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'code_write',
        { path: '../escaped.ts', content: 'x' },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('escapes repository root');
    } finally {
      await cleanup();
    }
  });

  it('enforces the size cap', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'code_write',
        { path: 'big.txt', content: 'x'.repeat(600 * 1024) },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('content too large');
    } finally {
      await cleanup();
    }
  });
});

describe('git_commit — no green, no ship', () => {
  it('REFUSES to commit when the verification gate is red', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      await writeFile(path.join(repo, 'change.txt'), 'changed\n', 'utf8');
      const res = await executeMutationTool(
        'git_commit',
        { message: 'should not land', files: ['change.txt'] },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN, preVerified: RED },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('verification gate RED');
      expect(res.extract.policy).toBe('commit_blocked_by_verification_gate');

      const log = await sh('git', ['log', '--oneline'], repo);
      expect(log.out).not.toContain('should not land');
    } finally {
      await cleanup();
    }
  });

  it('creates a real commit when the gate is green', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      await writeFile(path.join(repo, 'change.txt'), 'changed\n', 'utf8');
      const res = await executeMutationTool(
        'git_commit',
        { message: 'feat: real agent commit', files: ['change.txt'] },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN, preVerified: GREEN },
      );
      expect(res.ok).toBe(true);
      expect(String(res.extract.commitSha)).toMatch(/^[0-9a-f]{40}$/);
      expect(res.extract.committedFiles).toEqual(['change.txt']);

      const log = await sh('git', ['log', '--oneline'], repo);
      expect(log.out).toContain('feat: real agent commit');
    } finally {
      await cleanup();
    }
  });

  it('fails cleanly when there is nothing staged', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'git_commit',
        { message: 'empty', files: ['seed.txt'] },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN, preVerified: GREEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('nothing staged');
    } finally {
      await cleanup();
    }
  });

  it('refuses to commit a protected path', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'git_commit',
        { message: 'x', files: ['.env'] },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN, preVerified: GREEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('protected path');
    } finally {
      await cleanup();
    }
  });
});

describe('git_push', () => {
  it('pushes for real and confirms the remote ref matches local HEAD', async () => {
    const { repo, remote, cleanup } = await makeRepo();
    try {
      await writeFile(path.join(repo, 'change.txt'), 'changed\n', 'utf8');
      const commit = await executeMutationTool(
        'git_commit',
        { message: 'feat: push me', files: ['change.txt'] },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN, preVerified: GREEN },
      );
      expect(commit.ok).toBe(true);

      const res = await executeMutationTool(
        'git_push',
        { remote: 'origin', branch: 'agent-e2e' },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(true);
      expect(res.extract.remoteConfirmed).toBe(true);
      expect(res.extract.remoteSha).toBe(res.extract.localSha);

      // The bare remote really has the branch.
      const ls = await sh('git', ['ls-remote', remote, 'refs/heads/agent-e2e'], repo);
      expect(ls.out.trim()).toContain(String(res.extract.localSha));
    } finally {
      await cleanup();
    }
  });

  it('rejects an invalid branch name before touching the network', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const res = await executeMutationTool(
        'git_push',
        { remote: 'origin', branch: 'bad branch; rm -rf /' },
        { repoRoot: repo, ownerApprovalToken: OWNER_TOKEN },
      );
      expect(res.ok).toBe(false);
      expect(res.error).toContain('invalid branch name');
    } finally {
      await cleanup();
    }
  });
});

/**
 * Build a throwaway project whose typecheck scope is `src/` only, so the
 * typecheck result and the test result are independent signals. (Typechecking
 * the test file itself would need bun's ambient types, which a bare temp dir
 * cannot resolve — that would make every fixture red for the wrong reason.)
 */
async function makeGateProject(testBody: string): Promise<{ base: string; cleanup: () => Promise<void> }> {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ivx-gate-')));
  await mkdir(path.join(base, 'src'), { recursive: true });
  await writeFile(
    path.join(base, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [] },
      include: ['src'],
    }),
    'utf8',
  );
  await writeFile(path.join(base, 'src/index.ts'), 'export const answer: number = 42;\n', 'utf8');
  await writeFile(path.join(base, 'sample.test.ts'), testBody, 'utf8');
  return { base, cleanup: () => rm(base, { recursive: true, force: true }) };
}

describe('runVerificationGate', () => {
  it('reports RED when tests fail, even though the typecheck is clean', async () => {
    const { base, cleanup } = await makeGateProject(
      `import { test, expect } from 'bun:test';\ntest('failing on purpose', () => { expect(1).toBe(2); });\n`,
    );
    try {
      const gate = await runVerificationGate(base, { testTarget: 'sample.test.ts', timeoutMs: 120_000 });
      expect(gate.typecheckErrors).toBe(0);
      expect(gate.failingTestNames.length).toBeGreaterThan(0);
      expect(gate.passed).toBe(false);
    } finally {
      await cleanup();
    }
  }, 180_000);

  it('reports RED when the typecheck fails, even though tests pass', async () => {
    const { base, cleanup } = await makeGateProject(
      `import { test, expect } from 'bun:test';\ntest('passing', () => { expect(1).toBe(1); });\n`,
    );
    try {
      await writeFile(path.join(base, 'src/index.ts'), 'export const answer: number = "not a number";\n', 'utf8');
      const gate = await runVerificationGate(base, { testTarget: 'sample.test.ts', timeoutMs: 120_000 });
      expect(gate.typecheckErrors).toBeGreaterThan(0);
      expect(gate.failingTestNames).toEqual([]);
      expect(gate.passed).toBe(false);
    } finally {
      await cleanup();
    }
  }, 180_000);

  it('reports GREEN only when both the typecheck and the tests pass', async () => {
    const { base, cleanup } = await makeGateProject(
      `import { test, expect } from 'bun:test';\ntest('passing', () => { expect(1).toBe(1); });\n`,
    );
    try {
      const gate = await runVerificationGate(base, { testTarget: 'sample.test.ts', timeoutMs: 120_000 });
      expect(gate.typecheckErrors).toBe(0);
      expect(gate.failingTestNames).toEqual([]);
      expect(gate.testsPass).toBeGreaterThan(0);
      expect(gate.passed).toBe(true);
    } finally {
      await cleanup();
    }
  }, 180_000);
});

describe('deploy', () => {
  it('fails clearly when no Render credential is configured', async () => {
    const prevKey = process.env.RENDER_API_KEY;
    const prevAlt = process.env.IVX_RENDER_API_KEY;
    delete process.env.RENDER_API_KEY;
    delete process.env.IVX_RENDER_API_KEY;
    try {
      const res = await executeMutationTool('deploy', { mode: 'verify' }, { ownerApprovalToken: OWNER_TOKEN });
      expect(res.ok).toBe(false);
      expect(res.error).toContain('render_api_key_not_configured');
    } finally {
      if (prevKey !== undefined) process.env.RENDER_API_KEY = prevKey;
      if (prevAlt !== undefined) process.env.IVX_RENDER_API_KEY = prevAlt;
    }
  });

  it('rejects an unknown mode', async () => {
    const res = await executeMutationTool(
      'deploy',
      { mode: 'nuke', serviceId: 'srv-test' },
      { ownerApprovalToken: OWNER_TOKEN },
    );
    expect(res.ok).toBe(false);
    // Either missing credential or invalid mode is a refusal; never a rollout.
    expect(res.extract.rolloutTriggered).toBeUndefined();
  });
});

describe('executeRealTool approval gate integration', () => {
  it('blocks a mutating tool with no approval token', async () => {
    const res = await executeRealTool('agent-001', 1, 'code_write', { path: 'x.ts', content: 'y' });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error).toContain('missing_owner_approval_token');
  });

  it('blocks a mutating tool with a wrong approval token — truthy is not enough', async () => {
    const res = await executeRealTool('agent-001', 1, 'code_write', { path: 'x.ts', content: 'y' }, {
      ownerApprovalToken: 'not-the-owner-token',
    });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error).toContain('invalid_owner_approval_token');
  });

  it('keeps external_outreach blocked by policy even with a valid owner token', async () => {
    const res = await executeRealTool('agent-002', 2, 'external_outreach', {}, {
      ownerApprovalToken: OWNER_TOKEN,
    });
    expect(res.ok).toBe(false);
    expect(res.blocked).toBe(true);
    expect(res.error).toContain('outreach compliance policy');
  });

  it('reaches the real implementation once the owner token is valid', async () => {
    const res = await executeRealTool('agent-001', 1, 'code_write', { path: '.git/config', content: 'x' }, {
      ownerApprovalToken: OWNER_TOKEN,
    });
    // Approval passed, so the failure is the protected-path guard, not the gate.
    expect(res.ok).toBe(false);
    expect(res.error).toContain('protected path');
  });
});
