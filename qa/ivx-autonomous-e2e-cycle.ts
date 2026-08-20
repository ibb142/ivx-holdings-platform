/**
 * IVX Autonomous end-to-end cycle proof.
 *
 * Drives the REAL owner-approved pipeline through every stage and records only
 * what actually happened:
 *
 *   blocked (no token) → blocked (wrong token) → code_write → code_patch_proposal
 *   → verification gate (real tsc + real bun test) → git_commit → git_push
 *   → remote ref confirmation → deploy target check
 *
 * The cycle runs against a throwaway repository with a real bare git remote, so
 * the commit and push are genuine git operations with verifiable SHAs — nothing
 * is mocked, and no step can report success without its artifact.
 *
 * Run: bun run qa/ivx-autonomous-e2e-cycle.ts
 */
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import {
  executeMutationTool,
  runVerificationGate,
  verifyOwnerApproval,
  type MutationToolResult,
} from '../backend/services/ivx-agent-mutation-tools';
import { executeRealTool } from '../backend/services/ivx-agent-real-tools';
import { resolveRepoRoot } from '../backend/services/ivx-agent-engineering-tools';

const OWNER_TOKEN = `e2e-owner-${Date.now().toString(36)}`;

function sh(cmd: string, args: string[], cwd: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 120_000 }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number }) | null;
      resolve({ code: typeof e?.code === 'number' ? e.code : e ? 1 : 0, out: `${stdout}${stderr}` });
    });
  });
}

type Step = {
  step: string;
  expectation: string;
  passed: boolean;
  detail: string;
  evidence: Record<string, unknown>;
};

const steps: Step[] = [];

function record(step: string, expectation: string, passed: boolean, detail: string, evidence: Record<string, unknown>): void {
  steps.push({ step, expectation, passed, detail, evidence });
  console.log(`[${passed ? 'PASS' : 'FAIL'}] ${step} — ${detail}`);
}

function evidenceOf(res: MutationToolResult): Record<string, unknown> {
  return {
    ok: res.ok,
    sourceReference: res.sourceReference,
    contentSha256: res.contentSha256,
    approvalVerified: res.approvalVerified,
    error: res.error,
    extract: res.extract,
  };
}

async function main(): Promise<void> {
  const startedAt = new Date().toISOString();
  const repoRoot = resolveRepoRoot();
  const headSha = (await sh('git', ['rev-parse', 'HEAD'], repoRoot)).out.trim();

  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'ivx-e2e-')));
  const work = path.join(base, 'work');
  const remote = path.join(base, 'remote.git');

  process.env.IVX_OWNER_TOKEN = OWNER_TOKEN;

  try {
    // ── Set up a real repo with a real remote and a real verifiable project ──
    await mkdir(path.join(work, 'src'), { recursive: true });
    await sh('git', ['init', '--bare', remote], base);
    await sh('git', ['init'], work);
    await sh('git', ['config', 'user.email', 'e2e@ivx.local'], work);
    await sh('git', ['config', 'user.name', 'IVX E2E'], work);
    await writeFile(
      path.join(work, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, types: [] }, include: ['src'] }),
      'utf8',
    );
    await writeFile(
      path.join(work, 'sample.test.ts'),
      `import { test, expect } from 'bun:test';\ntest('project invariant holds', () => { expect(1 + 1).toBe(2); });\n`,
      'utf8',
    );
    await writeFile(path.join(work, 'src/index.ts'), 'export const version: string = "1.0.0";\n', 'utf8');
    await sh('git', ['add', '.'], work);
    await sh('git', ['commit', '-m', 'seed'], work);
    await sh('git', ['remote', 'add', 'origin', remote], work);

    // ── 1. Unapproved write must be blocked ──────────────────────────────────
    const noToken = await executeRealTool('agent-001', 1, 'code_write', { path: 'src/x.ts', content: 'x' });
    record(
      '1_blocked_without_approval',
      'a mutating tool with no owner token is blocked',
      noToken.ok === false && noToken.blocked === true,
      noToken.error ?? 'no error',
      { ok: noToken.ok, blocked: noToken.blocked, error: noToken.error },
    );

    // ── 2. Wrong token must be blocked (presence is not authorization) ───────
    const wrongToken = await executeRealTool('agent-001', 1, 'code_write', { path: 'src/x.ts', content: 'x' }, {
      ownerApprovalToken: 'truthy-but-wrong',
    });
    record(
      '2_blocked_with_wrong_token',
      'a truthy but incorrect owner token is rejected',
      wrongToken.ok === false && String(wrongToken.error).includes('invalid_owner_approval_token'),
      wrongToken.error ?? 'no error',
      { ok: wrongToken.ok, blocked: wrongToken.blocked, error: wrongToken.error },
    );

    // ── 3. Approval verification ─────────────────────────────────────────────
    const approval = verifyOwnerApproval(OWNER_TOKEN);
    record('3_owner_approval_verified', 'the configured owner token verifies', approval.approved, approval.reason, {
      binding: approval.binding,
    });

    // ── 4. Real code_write ───────────────────────────────────────────────────
    const write = await executeMutationTool(
      'code_write',
      {
        path: 'src/feature.ts',
        content: 'export const feature: string = "autonomous-cycle";\nexport const enabled: boolean = true;\n',
      },
      { repoRoot: work, ownerApprovalToken: OWNER_TOKEN },
    );
    record('4_code_write', 'a real file is written and re-read to confirm', write.ok, write.ok ? write.summary : String(write.error), evidenceOf(write));

    // ── 5. Patch proposal (real git diff, nothing applied) ───────────────────
    await sh('git', ['add', '-N', 'src/feature.ts'], work);
    const patch = await executeMutationTool('code_patch_proposal', {}, { repoRoot: work, ownerApprovalToken: OWNER_TOKEN });
    record(
      '5_code_patch_proposal',
      'a real unified diff is produced without applying anything',
      patch.ok && patch.extract.applied === false,
      patch.ok ? patch.summary : String(patch.error),
      evidenceOf(patch),
    );

    // ── 6. Red gate must block the commit ────────────────────────────────────
    await writeFile(path.join(work, 'src/broken.ts'), 'export const broken: number = "not a number";\n', 'utf8');
    const redCommit = await executeMutationTool(
      'git_commit',
      { message: 'chore: should be refused', files: ['src/feature.ts', 'src/broken.ts'] },
      { repoRoot: work, ownerApprovalToken: OWNER_TOKEN, testTarget: 'sample.test.ts', timeoutMs: 180_000 },
    );
    const logAfterRed = await sh('git', ['log', '--oneline'], work);
    record(
      '6_red_gate_blocks_commit',
      'a tree that does not typecheck cannot be committed',
      redCommit.ok === false && !logAfterRed.out.includes('should be refused'),
      redCommit.error ?? 'no error',
      { error: redCommit.error, extract: redCommit.extract, gitLog: logAfterRed.out.trim().split('\n') },
    );

    // ── 7. Green gate ────────────────────────────────────────────────────────
    await rm(path.join(work, 'src/broken.ts'), { force: true });
    const gate = await runVerificationGate(work, { testTarget: 'sample.test.ts', timeoutMs: 180_000 });
    record('7_verification_gate_green', 'typecheck and tests both pass on the tree to be committed', gate.passed, gate.detail, {
      typecheckErrors: gate.typecheckErrors,
      testsPass: gate.testsPass,
      failingTestNames: gate.failingTestNames,
      evidenceSha256: gate.evidenceSha256,
    });

    // ── 8. Real commit, gated by the real green result ───────────────────────
    const commit = await executeMutationTool(
      'git_commit',
      { message: 'feat: autonomous agent cycle proof', files: ['src/feature.ts'] },
      { repoRoot: work, ownerApprovalToken: OWNER_TOKEN, preVerified: gate },
    );
    record('8_git_commit', 'a real commit SHA is produced', commit.ok, commit.ok ? commit.summary : String(commit.error), evidenceOf(commit));

    // ── 9. Real push + independent remote confirmation ───────────────────────
    const push = await executeMutationTool(
      'git_push',
      { remote: 'origin', branch: 'ivx/autonomous-cycle' },
      { repoRoot: work, ownerApprovalToken: OWNER_TOKEN },
    );
    const lsRemote = await sh('git', ['ls-remote', remote, 'refs/heads/ivx/autonomous-cycle'], work);
    const remoteHasCommit = commit.ok && lsRemote.out.includes(String(commit.extract.commitSha));
    record(
      '9_git_push_confirmed',
      'the remote ref really advanced to the new commit',
      push.ok && remoteHasCommit,
      push.ok ? push.summary : String(push.error),
      { ...evidenceOf(push), independentLsRemote: lsRemote.out.trim() },
    );

    // ── 10. Secret redaction in stored evidence ──────────────────────────────
    const serialized = JSON.stringify(steps);
    const leaks = [/gh[pousr]_[A-Za-z0-9_]{16,}/, /https:\/\/[^@\s/]+:[^@\s/]+@/];
    const leaked = leaks.filter((re) => re.test(serialized));
    record(
      '10_no_credential_leak_in_evidence',
      'no credential appears anywhere in the recorded evidence',
      leaked.length === 0,
      leaked.length === 0 ? 'evidence is clean' : `${leaked.length} credential pattern(s) found`,
      { patternsChecked: leaks.length },
    );

    // ── 11. Deploy target check (real HTTP when configured) ──────────────────
    const deploy = await executeMutationTool('deploy', { mode: 'verify' }, { ownerApprovalToken: OWNER_TOKEN });
    const deployConfigured = !String(deploy.error ?? '').includes('not_configured');
    record(
      '11_deploy_target_check',
      'the deploy tool reaches a real Render API result, or reports honestly that no credential is configured',
      deploy.ok || !deployConfigured,
      deploy.ok ? deploy.summary : String(deploy.error),
      { ...evidenceOf(deploy), credentialConfiguredInThisEnvironment: deployConfigured },
    );

    // ── Summary ──────────────────────────────────────────────────────────────
    const passedCount = steps.filter((s) => s.passed).length;
    const allPassed = passedCount === steps.length;
    const summary = {
      cycleId: `ivx-autonomous-e2e-${startedAt}`,
      startedAt,
      finishedAt: new Date().toISOString(),
      repoSha: headSha,
      pipeline: 'code_write → code_patch_proposal → verification_gate → git_commit → git_push → deploy_check',
      totalSteps: steps.length,
      passedSteps: passedCount,
      allPassed,
      commitSha: commit.ok ? commit.extract.commitSha : null,
      pushedBranch: push.ok ? push.extract.branch : null,
      remoteConfirmed: push.ok ? push.extract.remoteConfirmed : false,
      deployCredentialConfigured: deployConfigured,
      note:
        'Executed against a throwaway repository with a real bare git remote. The commit and push are real git operations with verifiable SHAs. The deploy step performs a real Render API call only when RENDER_API_KEY/RENDER_SERVICE_ID are present in the environment.',
      steps,
    };

    const outDir = path.join(repoRoot, 'qa/evidence/autonomous');
    await mkdir(outDir, { recursive: true });
    const outFile = path.join(outDir, `ivx-autonomous-e2e-cycle-${startedAt.replace(/[:.]/g, '-')}.json`);
    await writeFile(outFile, JSON.stringify(summary, null, 2), 'utf8');

    console.log('');
    console.log(`[cycle] ${passedCount}/${steps.length} steps passed`);
    console.log(`[cycle] commit=${String(summary.commitSha ?? 'none')}`);
    console.log(`[cycle] evidence=${path.relative(repoRoot, outFile)}`);
    if (!allPassed) process.exitCode = 1;
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

void main();
