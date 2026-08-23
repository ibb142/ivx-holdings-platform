/**
 * IVX Autonomous Mutation Tools — low-risk write/commit/push capability for the
 * 112-agent fleet.
 *
 * Owner policy:
 * - LOW-RISK application changes may be written, verified, committed, and pushed
 *   to non-protected branches without a human approval token.
 * - HIGH-RISK changes (auth/permissions, security, secrets, payments/financial,
 *   database migrations/RLS, infrastructure/CI, autonomous policy, protected
 *   branches, and production deploys) remain owner-gated.
 * - No green, no commit. No force push. No production deploy in this module.
 * - Filesystem writes are real, contained, re-read verified, and rollback on
 *   verification failure.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  containPath,
  resolveRepoRoot,
  runProcess,
  type EngineeringToolResult,
} from './ivx-agent-engineering-tools';
import {
  isProtectedWritePath,
  redactSecrets,
  runVerificationGate,
  type VerificationGate,
} from './ivx-agent-mutation-tools';

export const IVX_AUTONOMOUS_MUTATION_TOOLS_MARKER =
  'ivx-agent-autonomous-mutation-tools-2026-08-23';

export type AutonomousMutationToolId =
  | 'code_write'
  | 'code_patch_proposal'
  | 'git_commit'
  | 'git_push';

export const AUTONOMOUS_MUTATION_TOOL_IDS: readonly AutonomousMutationToolId[] = [
  'code_write',
  'code_patch_proposal',
  'git_commit',
  'git_push',
] as const;

export type MutationRisk = 'low' | 'high';

export type MutationRiskDecision = {
  autonomous: boolean;
  risk: MutationRisk;
  reason: string;
  sensitivePaths: string[];
};

const MAX_WRITE_BYTES = 512 * 1024;
const AGENT_COMMIT_NAME = 'IVX Autonomous Agent';
const AGENT_COMMIT_EMAIL = 'agents@ivxholdings.local';

/**
 * These paths can change identity, money, authorization, infrastructure, or the
 * autonomy safety policy itself. They always require explicit owner approval.
 */
const OWNER_GATED_CODE_PATTERNS: readonly RegExp[] = [
  /^\.github\/workflows\//i,
  /(^|\/)(?:supabase\/)?migrations?(\/|$)/i,
  /(^|\/)(?:rls|policies|permissions?)(\/|[-_.])/i,
  /(^|\/)(?:auth|authentication|authorization)(\/|[-_.])/i,
  /(^|\/)(?:security|secrets?)(\/|[-_.])/i,
  /(^|\/)(?:payment|payments|billing|stripe|wire|wallet|ledger|bank|escrow|payout)(\/|[-_.])/i,
  /(^|\/)(?:infra|infrastructure|terraform|cloudfront|aws|vercel|render)(\/|[-_.])/i,
  /(^|\/)Dockerfile$/i,
  /^server\.ts$/i,
  /^backend\/api\/owner-only\.ts$/i,
  /^backend\/services\/ivx-internal-deploy-auth\.ts$/i,
  /^backend\/services\/ivx-agent-(?:autonomous-)?mutation-tools(?:\.test)?\.ts$/i,
  /^backend\/services\/ivx-agent-real-tools(?:-base)?\.ts$/i,
  /^backend\/services\/ivx-agent-contracts\.ts$/i,
];

const PROTECTED_BRANCH_PATTERNS: readonly RegExp[] = [
  /^(?:main|master|production|prod)$/i,
  /^release(?:\/|$)/i,
  /^hotfix\/production(?:\/|$)/i,
];

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

function normalizePath(relPath: string): string {
  return relPath.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function isOwnerGatedCodePath(relPath: string): boolean {
  const normalized = normalizePath(relPath);
  if (isProtectedWritePath(normalized)) return true;
  return OWNER_GATED_CODE_PATTERNS.some((re) => re.test(normalized));
}

export function isProtectedAutonomousBranch(branch: string): boolean {
  const normalized = branch.trim();
  return PROTECTED_BRANCH_PATTERNS.some((re) => re.test(normalized));
}

export function isAutonomousMutationTool(toolId: string): toolId is AutonomousMutationToolId {
  return (AUTONOMOUS_MUTATION_TOOL_IDS as readonly string[]).includes(toolId);
}

/**
 * Decide whether a mutation may execute autonomously or must fall through to
 * the existing owner-approved mutation pipeline.
 */
export function classifyMutationRisk(
  toolId: string,
  params: Record<string, unknown>,
): MutationRiskDecision {
  if (toolId === 'code_patch_proposal') {
    return {
      autonomous: true,
      risk: 'low',
      reason: 'read_only_patch_proposal',
      sensitivePaths: [],
    };
  }

  if (toolId === 'code_write') {
    const rel = String(params.path ?? '').trim();
    if (!rel) {
      return { autonomous: false, risk: 'high', reason: 'missing_path', sensitivePaths: [] };
    }
    const sensitive = isOwnerGatedCodePath(rel) ? [normalizePath(rel)] : [];
    return sensitive.length > 0
      ? { autonomous: false, risk: 'high', reason: 'owner_gated_code_path', sensitivePaths: sensitive }
      : { autonomous: true, risk: 'low', reason: 'low_risk_application_code', sensitivePaths: [] };
  }

  if (toolId === 'git_commit') {
    const files = Array.isArray(params.files) ? params.files.map(String) : [];
    if (files.length === 0) {
      return { autonomous: false, risk: 'high', reason: 'missing_commit_files', sensitivePaths: [] };
    }
    const sensitive = files.map(normalizePath).filter(isOwnerGatedCodePath);
    return sensitive.length > 0
      ? { autonomous: false, risk: 'high', reason: 'commit_contains_owner_gated_path', sensitivePaths: sensitive }
      : { autonomous: true, risk: 'low', reason: 'verified_low_risk_commit', sensitivePaths: [] };
  }

  if (toolId === 'git_push') {
    const branch = String(params.branch ?? '').trim();
    if (!branch || isProtectedAutonomousBranch(branch)) {
      return {
        autonomous: false,
        risk: 'high',
        reason: !branch ? 'missing_branch' : 'protected_branch_requires_owner',
        sensitivePaths: [],
      };
    }
    return { autonomous: true, risk: 'low', reason: 'non_protected_branch_push', sensitivePaths: [] };
  }

  // Deploy aliases and unknown mutations are intentionally owner-gated.
  return {
    autonomous: false,
    risk: 'high',
    reason: 'mutation_requires_owner_approval',
    sensitivePaths: [],
  };
}

export function isAutonomousWriteRuntimeEnabled(): boolean {
  return (
    process.env.IVX_AGENT_AUTONOMOUS_WRITES_ENABLED === 'true' ||
    process.env.IVX_SENIOR_DEV_WORKER_ENABLED === 'true'
  );
}

export type AutonomousMutationToolResult = EngineeringToolResult & {
  authorizationMode: 'autonomous_low_risk';
  riskDecision: MutationRiskDecision;
  rolledBack: boolean;
  blockedByOwnerGate: boolean;
};

function ok(
  toolId: string,
  fields: {
    sourceReference: string;
    contentSha256: string;
    summary: string;
    extract: Record<string, unknown>;
    exitCode?: number;
  },
  startedAt: number,
  riskDecision: MutationRiskDecision,
): AutonomousMutationToolResult {
  return {
    ok: true,
    toolId,
    sourceReference: fields.sourceReference,
    contentSha256: fields.contentSha256,
    summary: fields.summary,
    extract: {
      ...fields.extract,
      authorizationMode: 'autonomous_low_risk',
      riskDecision,
    },
    exitCode: fields.exitCode ?? 0,
    durationMs: Date.now() - startedAt,
    error: null,
    authorizationMode: 'autonomous_low_risk',
    riskDecision,
    rolledBack: false,
    blockedByOwnerGate: false,
  };
}

function failed(
  toolId: string,
  error: string,
  startedAt: number,
  riskDecision: MutationRiskDecision,
  opts: {
    rolledBack?: boolean;
    blockedByOwnerGate?: boolean;
    extract?: Record<string, unknown>;
  } = {},
): AutonomousMutationToolResult {
  return {
    ok: false,
    toolId,
    sourceReference: '',
    contentSha256: '',
    summary: '',
    extract: {
      ...(opts.extract ?? {}),
      authorizationMode: 'autonomous_low_risk',
      riskDecision,
    },
    exitCode: -1,
    durationMs: Date.now() - startedAt,
    error,
    authorizationMode: 'autonomous_low_risk',
    riskDecision,
    rolledBack: opts.rolledBack ?? false,
    blockedByOwnerGate: opts.blockedByOwnerGate ?? false,
  };
}

export type AutonomousMutationOptions = {
  repoRoot?: string;
  timeoutMs?: number;
  testTarget?: string;
  preVerified?: VerificationGate;
};

/**
 * Execute only LOW-RISK mutations. A high-risk request is refused here so the
 * caller can route it to the existing explicit-owner gate.
 */
export async function executeAutonomousMutationTool(
  toolId: string,
  params: Record<string, unknown>,
  options: AutonomousMutationOptions = {},
): Promise<AutonomousMutationToolResult> {
  const startedAt = Date.now();
  const decision = classifyMutationRisk(toolId, params);
  if (!decision.autonomous || !isAutonomousMutationTool(toolId)) {
    return failed(
      toolId,
      `owner approval required — ${decision.reason}`,
      startedAt,
      decision,
      { blockedByOwnerGate: true },
    );
  }

  // Patch proposals are read-only and may run anywhere. Actual mutations only
  // execute in an explicitly enabled IVX autonomous/senior-developer runtime.
  if (toolId !== 'code_patch_proposal' && !isAutonomousWriteRuntimeEnabled()) {
    return failed(
      toolId,
      'autonomous write runtime disabled — set IVX_AGENT_AUTONOMOUS_WRITES_ENABLED=true or run inside IVX_SENIOR_DEV_WORKER_ENABLED=true',
      startedAt,
      decision,
    );
  }

  const repoRoot = options.repoRoot ?? resolveRepoRoot();

  try {
    switch (toolId) {
      case 'code_write':
        return await doCodeWrite(params, repoRoot, startedAt, decision);
      case 'code_patch_proposal':
        return await doPatchProposal(params, repoRoot, startedAt, decision, options);
      case 'git_commit':
        return await doGitCommit(params, repoRoot, startedAt, decision, options);
      case 'git_push':
        return await doGitPush(params, repoRoot, startedAt, decision, options);
    }
  } catch (error) {
    return failed(
      toolId,
      redactSecrets(error instanceof Error ? error.message : String(error)),
      startedAt,
      decision,
    );
  }
}

async function doCodeWrite(
  params: Record<string, unknown>,
  repoRoot: string,
  startedAt: number,
  decision: MutationRiskDecision,
): Promise<AutonomousMutationToolResult> {
  const rel = String(params.path ?? '').trim();
  if (!rel) return failed('code_write', 'path param required', startedAt, decision);
  if (typeof params.content !== 'string') {
    return failed('code_write', 'content param required (string)', startedAt, decision);
  }
  if (isProtectedWritePath(rel) || isOwnerGatedCodePath(rel)) {
    return failed(
      'code_write',
      `owner approval required for protected/high-risk path: ${rel}`,
      startedAt,
      { autonomous: false, risk: 'high', reason: 'owner_gated_code_path', sensitivePaths: [normalizePath(rel)] },
      { blockedByOwnerGate: true },
    );
  }

  const content = params.content;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    return failed('code_write', `content too large (${bytes} bytes, cap ${MAX_WRITE_BYTES})`, startedAt, decision);
  }

  const abs = await containPath(repoRoot, rel);
  const relFromRoot = path.relative(repoRoot, abs);
  const existed = await stat(abs).then((s) => s.isFile()).catch(() => false);
  const previous = existed ? await readFile(abs, 'utf8') : null;

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  const readBack = await readFile(abs, 'utf8').catch(() => null);
  if (readBack !== content) {
    if (previous !== null) await writeFile(abs, previous, 'utf8').catch(() => undefined);
    return failed('code_write', `write verification failed for ${relFromRoot} — rolled back`, startedAt, decision, {
      rolledBack: true,
    });
  }

  const digest = sha256(content);
  return ok(
    'code_write',
    {
      sourceReference: `file://${relFromRoot}@sha256:${digest.slice(0, 16)}`,
      contentSha256: digest,
      summary: `${existed ? 'Updated' : 'Created'} ${relFromRoot} autonomously — ${bytes} bytes`,
      extract: {
        relPath: relFromRoot,
        created: !existed,
        bytes,
        previousSha256: previous === null ? null : sha256(previous),
        newSha256: digest,
      },
    },
    startedAt,
    decision,
  );
}

async function doPatchProposal(
  params: Record<string, unknown>,
  repoRoot: string,
  startedAt: number,
  decision: MutationRiskDecision,
  options: AutonomousMutationOptions,
): Promise<AutonomousMutationToolResult> {
  const scope = params.scope ? String(params.scope) : null;
  const args = ['diff', '--unified=3'];
  if (scope) {
    const abs = await containPath(repoRoot, scope);
    args.push('--', path.relative(repoRoot, abs) || '.');
  }
  const res = await runProcess('git', args, repoRoot, Math.min(options.timeoutMs ?? 60_000, 120_000));
  if (res.exitCode > 1) {
    return failed('code_patch_proposal', `git diff failed (exit ${res.exitCode})`, startedAt, decision);
  }
  const diff = redactSecrets(res.stdout);
  const digest = sha256(diff);
  const changedFiles = Array.from(diff.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((m) => String(m[1]));
  return ok(
    'code_patch_proposal',
    {
      sourceReference: `local-exec://git-diff${scope ? `?scope=${encodeURIComponent(scope)}` : ''}@sha256:${digest.slice(0, 16)}`,
      contentSha256: digest,
      summary: `Autonomous patch proposal — ${changedFiles.length} file(s) changed`,
      extract: { changedFiles, diffPreview: diff.slice(0, 4000), applied: false },
      exitCode: res.exitCode,
    },
    startedAt,
    decision,
  );
}

async function doGitCommit(
  params: Record<string, unknown>,
  repoRoot: string,
  startedAt: number,
  decision: MutationRiskDecision,
  options: AutonomousMutationOptions,
): Promise<AutonomousMutationToolResult> {
  const message = String(params.message ?? '').trim();
  if (!message) return failed('git_commit', 'message param required', startedAt, decision);

  const rawFiles = Array.isArray(params.files) ? params.files.map(String) : [];
  if (rawFiles.length === 0) return failed('git_commit', 'files param required', startedAt, decision);

  const relFiles: string[] = [];
  for (const file of rawFiles) {
    if (isProtectedWritePath(file) || isOwnerGatedCodePath(file)) {
      return failed(
        'git_commit',
        `owner approval required for commit path: ${file}`,
        startedAt,
        { autonomous: false, risk: 'high', reason: 'commit_contains_owner_gated_path', sensitivePaths: [normalizePath(file)] },
        { blockedByOwnerGate: true },
      );
    }
    const abs = await containPath(repoRoot, file);
    relFiles.push(path.relative(repoRoot, abs));
  }

  const gate = options.preVerified ?? await runVerificationGate(repoRoot, {
    testTarget: options.testTarget ?? String(params.testTarget ?? 'backend'),
    timeoutMs: options.timeoutMs,
  });
  if (!gate.passed) {
    return failed('git_commit', `verification gate RED — refusing autonomous commit. ${gate.detail}`, startedAt, decision, {
      extract: { verification: gate, policy: 'commit_blocked_by_verification_gate' },
    });
  }

  const add = await runProcess('git', ['add', '--', ...relFiles], repoRoot, 60_000);
  if (add.exitCode !== 0) {
    return failed('git_commit', `git add failed: ${redactSecrets(add.stderr).slice(0, 300)}`, startedAt, decision);
  }

  const staged = await runProcess('git', ['diff', '--cached', '--name-only'], repoRoot, 30_000);
  const stagedFiles = staged.stdout.split('\n').filter(Boolean);
  if (stagedFiles.length === 0) {
    return failed('git_commit', 'nothing staged — no changes to commit', startedAt, decision);
  }
  const unexpected = stagedFiles.filter((file) => !relFiles.includes(file));
  if (unexpected.length > 0) {
    await runProcess('git', ['reset'], repoRoot, 30_000);
    return failed(
      'git_commit',
      `unexpected staged files detected — refusing commit: ${unexpected.join(', ')}`,
      startedAt,
      decision,
    );
  }

  const commit = await runProcess(
    'git',
    ['-c', `user.name=${AGENT_COMMIT_NAME}`, '-c', `user.email=${AGENT_COMMIT_EMAIL}`, 'commit', '-m', message],
    repoRoot,
    60_000,
  );
  if (commit.exitCode !== 0) {
    return failed('git_commit', `git commit failed: ${redactSecrets(commit.stderr || commit.stdout).slice(0, 300)}`, startedAt, decision);
  }

  const head = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const commitSha = head.stdout.trim();
  const digest = sha256(`${commitSha}${message}${stagedFiles.join(',')}`);
  return ok(
    'git_commit',
    {
      sourceReference: `git://commit/${commitSha}`,
      contentSha256: digest,
      summary: `Autonomous commit ${commitSha.slice(0, 12)} — verification green`,
      extract: {
        commitSha,
        message,
        committedFiles: stagedFiles,
        verification: {
          passed: gate.passed,
          typecheckErrors: gate.typecheckErrors,
          testsPass: gate.testsPass,
          evidenceSha256: gate.evidenceSha256,
        },
      },
    },
    startedAt,
    decision,
  );
}

async function doGitPush(
  params: Record<string, unknown>,
  repoRoot: string,
  startedAt: number,
  decision: MutationRiskDecision,
  options: AutonomousMutationOptions,
): Promise<AutonomousMutationToolResult> {
  const remote = String(params.remote ?? 'origin').trim();
  const branch = String(params.branch ?? '').trim();
  if (!branch) return failed('git_push', 'branch param required', startedAt, decision);
  if (!/^[A-Za-z0-9._\-/]+$/.test(branch)) {
    return failed('git_push', `invalid branch name: ${branch}`, startedAt, decision);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(remote)) {
    return failed('git_push', `invalid remote name: ${remote}`, startedAt, decision);
  }
  if (isProtectedAutonomousBranch(branch)) {
    return failed(
      'git_push',
      `owner approval required for protected branch: ${branch}`,
      startedAt,
      { autonomous: false, risk: 'high', reason: 'protected_branch_requires_owner', sensitivePaths: [] },
      { blockedByOwnerGate: true },
    );
  }

  const local = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const localSha = local.stdout.trim();
  const push = await runProcess(
    'git',
    ['push', remote, `HEAD:refs/heads/${branch}`],
    repoRoot,
    Math.min(options.timeoutMs ?? 180_000, 300_000),
  );
  const transcript = redactSecrets(`${push.stdout}\n${push.stderr}`);
  if (push.exitCode !== 0) {
    return failed('git_push', `git push failed (exit ${push.exitCode}): ${transcript.slice(0, 400)}`, startedAt, decision, {
      extract: { remote, branch, transcript: transcript.slice(0, 2000) },
    });
  }

  const lsRemote = await runProcess('git', ['ls-remote', remote, `refs/heads/${branch}`], repoRoot, 60_000);
  const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0] ?? '';
  if (!localSha || remoteSha !== localSha) {
    return failed(
      'git_push',
      `push did not verify remote ref (local=${localSha.slice(0, 12)} remote=${remoteSha.slice(0, 12) || 'none'})`,
      startedAt,
      decision,
      { extract: { remote, branch, localSha, remoteSha } },
    );
  }

  const digest = sha256(`${localSha}${remoteSha}${branch}`);
  return ok(
    'git_push',
    {
      sourceReference: `git://push/${branch}@${remoteSha}`,
      contentSha256: digest,
      summary: `Autonomously pushed ${localSha.slice(0, 12)} to ${remote}/${branch} — remote ref confirmed`,
      extract: {
        remote,
        branch,
        localSha,
        remoteSha,
        remoteConfirmed: true,
        transcript: transcript.slice(0, 2000),
      },
    },
    startedAt,
    decision,
  );
}
