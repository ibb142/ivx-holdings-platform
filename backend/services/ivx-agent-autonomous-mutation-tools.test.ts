import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  classifyMutationRisk,
  executeMutationTool,
  isOwnerGatedCodePath,
  isProtectedAutonomousBranch,
  verifyOwnerApproval,
  type VerificationGate,
} from './ivx-agent-mutation-tools';
import { executeRealTool } from './ivx-agent-real-tools';
import { resolveRepoRoot } from './ivx-agent-engineering-tools';

const OWNER_TOKEN = 'test-owner-token-live-integration';
const SYSTEM_TOKEN = 'test-system-token-live-integration';
let oldOwner: string | undefined;
let oldSystem: string | undefined;

function sh(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, timeout: 30_000 }, (err) => err ? reject(err) : resolve());
  });
}

async function makeRepo(): Promise<{ repo: string; cleanup: () => Promise<void> }> {
  const repo = await mkdtemp(path.join(tmpdir(), 'ivx-live-mutation-'));
  await mkdir(path.join(repo, 'expo/components'), { recursive: true });
  await sh('git', ['init'], repo);
  await sh('git', ['config', 'user.email', 'test@ivx.local'], repo);
  await sh('git', ['config', 'user.name', 'IVX Test'], repo);
  await sh('git', ['config', 'commit.gpgsign', 'false'], repo);
  await writeFile(path.join(repo, 'seed.txt'), 'seed\n', 'utf8');
  await sh('git', ['add', '.'], repo);
  await sh('git', ['commit', '-m', 'seed'], repo);
  return { repo, cleanup: () => rm(repo, { recursive: true, force: true }) };
}

const GREEN: VerificationGate = {
  passed: true,
  typecheckErrors: 0,
  testsPass: 42,
  failingTestNames: [],
  detail: 'verification GREEN',
  evidenceSha256: 'a'.repeat(64),
};

beforeEach(() => {
  oldOwner = process.env.IVX_OWNER_TOKEN;
  oldSystem = process.env.IVX_AI_SYSTEM_SECRET;
  process.env.IVX_OWNER_TOKEN = OWNER_TOKEN;
  process.env.IVX_AI_SYSTEM_SECRET = SYSTEM_TOKEN;
});

afterEach(() => {
  if (oldOwner === undefined) delete process.env.IVX_OWNER_TOKEN;
  else process.env.IVX_OWNER_TOKEN = oldOwner;
  if (oldSystem === undefined) delete process.env.IVX_AI_SYSTEM_SECRET;
  else process.env.IVX_AI_SYSTEM_SECRET = oldSystem;
});

describe('IVX 112 live autonomous mutation integration', () => {
  it('recognizes the IVX system credential without treating it as owner mode', () => {
    const result = verifyOwnerApproval(SYSTEM_TOKEN);
    expect(result.approved).toBe(true);
    expect(result.mode).toBe('autonomous_system');
    expect(result.reason).toContain('low_risk_only');
  });

  it('allows a real low-risk application write with the system credential', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      const result = await executeMutationTool(
        'code_write',
        { path: 'expo/components/HomeCard.tsx', content: 'export const HomeCard = () => null;\n' },
        { repoRoot: repo, ownerApprovalToken: SYSTEM_TOKEN },
      );
      expect(result.ok).toBe(true);
      expect(result.extract.authorizationMode).toBe('autonomous_system');
      expect(await readFile(path.join(repo, 'expo/components/HomeCard.tsx'), 'utf8')).toContain('HomeCard');
    } finally {
      await cleanup();
    }
  });

  it('routes a real low-risk write through executeRealTool, the dispatcher used by agent runs', async () => {
    const repoRoot = resolveRepoRoot();
    const rel = `qa/evidence/autonomous/.tmp-dispatch-write-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`;
    const abs = path.join(repoRoot, rel);
    try {
      const result = await executeRealTool(
        'ivx_holdings_112',
        112,
        'code_write',
        { path: rel, content: 'dispatcher mutation path verified\n' },
        { ownerApprovalToken: SYSTEM_TOKEN, timeoutMs: 20_000 },
      );
      expect(result.ok).toBe(true);
      expect(result.blocked).toBe(false);
      expect(result.extract.authorizationMode).toBe('autonomous_system');
      expect(result.sourceReference).toContain(rel);
      expect(await readFile(abs, 'utf8')).toBe('dispatcher mutation path verified\n');
    } finally {
      await rm(abs, { force: true });
    }
  });

  it('exposes the safe mutation dispatcher path to all 112 agent identities', async () => {
    const agentNumbers = Array.from({ length: 112 }, (_, i) => i + 1);
    const failures: Array<{ agentNumber: number; error: string | null }> = [];

    for (let offset = 0; offset < agentNumbers.length; offset += 16) {
      const batch = agentNumbers.slice(offset, offset + 16);
      const results = await Promise.all(batch.map(async (agentNumber) => ({
        agentNumber,
        result: await executeRealTool(
          `ivx_holdings_${agentNumber}`,
          agentNumber,
          'code_patch_proposal',
          { scope: 'backend/services/ivx-agent-mutation-tools.ts' },
          { ownerApprovalToken: SYSTEM_TOKEN, timeoutMs: 20_000 },
        ),
      })));
      for (const { agentNumber, result } of results) {
        if (!result.ok || result.blocked || result.extract.authorizationMode !== 'autonomous_system') {
          failures.push({ agentNumber, error: result.error });
        }
      }
    }

    expect(failures).toEqual([]);
  }, 120_000);

  it('allows a verified autonomous commit for low-risk files', async () => {
    const { repo, cleanup } = await makeRepo();
    try {
      await writeFile(path.join(repo, 'expo/components/HomeCard.tsx'), 'export const x = 1;\n', 'utf8');
      const result = await executeMutationTool(
        'git_commit',
        { message: 'fix: safe home card', files: ['expo/components/HomeCard.tsx'] },
        { repoRoot: repo, ownerApprovalToken: SYSTEM_TOKEN, preVerified: GREEN },
      );
      expect(result.ok).toBe(true);
      expect(result.extract.authorizationMode).toBe('autonomous_system');
      expect(String(result.extract.commitSha)).toMatch(/^[0-9a-f]{40}$/);
    } finally {
      await cleanup();
    }
  });

  it('keeps auth, payments, migrations, CI, infrastructure and autonomy controls owner-gated', async () => {
    const paths = [
      'backend/auth/session.ts',
      'backend/services/payments.ts',
      'supabase/migrations/20260823_change_rls.sql',
      '.github/workflows/deploy.yml',
      'backend/security/permissions.ts',
      'infra/terraform/main.tf',
      'backend/services/ivx-agent-real-tools.ts',
      'backend/services/ivx-agent-runtime.ts',
      'package.json',
    ];
    for (const file of paths) {
      expect(isOwnerGatedCodePath(file)).toBe(true);
      expect(classifyMutationRisk('code_write', { path: file, content: 'x' }).autonomous).toBe(false);
    }

    const { repo, cleanup } = await makeRepo();
    try {
      const blocked = await executeMutationTool(
        'code_write',
        { path: 'backend/auth/session.ts', content: 'x' },
        { repoRoot: repo, ownerApprovalToken: SYSTEM_TOKEN },
      );
      expect(blocked.ok).toBe(false);
      expect(blocked.error).toContain('owner approval required');
    } finally {
      await cleanup();
    }
  });

  it('keeps high-risk dispatcher writes blocked for all agents even with the system credential', async () => {
    const blocked = await executeRealTool(
      'ivx_holdings_1',
      1,
      'code_write',
      { path: 'backend/auth/session.ts', content: 'x' },
      { ownerApprovalToken: SYSTEM_TOKEN, timeoutMs: 20_000 },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('owner approval required');
  });

  it('never allows the system credential to deploy production', async () => {
    const blocked = await executeMutationTool(
      'deploy',
      { mode: 'trigger' },
      { ownerApprovalToken: SYSTEM_TOKEN },
    );
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('production_deploy_requires_owner');
  });

  it('allows work branches but blocks main/production/release pushes', () => {
    expect(isProtectedAutonomousBranch('main')).toBe(true);
    expect(isProtectedAutonomousBranch('production')).toBe(true);
    expect(isProtectedAutonomousBranch('release/v1.2.3')).toBe(true);
    expect(isProtectedAutonomousBranch('autonomous/fix-home-black-screen')).toBe(false);
    expect(classifyMutationRisk('git_push', { branch: 'autonomous/fix-home-black-screen' }).autonomous).toBe(true);
    expect(classifyMutationRisk('git_push', { branch: 'main' }).autonomous).toBe(false);
  });
});
