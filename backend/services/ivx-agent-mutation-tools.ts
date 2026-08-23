/**
 * IVX Agent Mutation Tools — REAL write -> verify -> commit -> push -> deploy.
 *
 * Authorization modes:
 * - owner: explicit owner token; may execute owner-gated operations.
 * - autonomous_system: IVX system secret; may execute ONLY low-risk source
 *   changes, verified commits, and non-protected branch pushes. It can never
 *   deploy production or change high-risk auth/security/payment/infra/policy
 *   surfaces.
 *
 * NON-NEGOTIABLE RULES
 * - No green, no commit.
 * - No force push.
 * - Production deploy remains owner-only.
 * - Protected/high-risk paths remain owner-only.
 * - Writes are contained, re-read verified, and secret output is redacted.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import {
  containPath,
  resolveRepoRoot,
  runProcess,
  parseBunTestOutput,
  parseTscOutput,
  type EngineeringToolResult,
} from './ivx-agent-engineering-tools';
import { extractRenderApiKey, extractRenderServiceId } from './ivx-render-credentials';

export const IVX_MUTATION_TOOLS_MARKER = 'ivx-agent-mutation-tools-2026-08-23-autonomous-safe';

export type MutationToolId =
  | 'code_write'
  | 'code_patch_proposal'
  | 'git_commit'
  | 'git_push'
  | 'deploy';

export const MUTATION_TOOL_IDS: readonly MutationToolId[] = [
  'code_write',
  'code_patch_proposal',
  'git_commit',
  'git_push',
  'deploy',
] as const;

const TOOL_ALIASES: Readonly<Record<string, MutationToolId>> = {
  prod_deploy: 'deploy',
  deploy_to_production: 'deploy',
};

export function normalizeMutationToolId(toolId: string): MutationToolId | null {
  if ((MUTATION_TOOL_IDS as readonly string[]).includes(toolId)) return toolId as MutationToolId;
  return TOOL_ALIASES[toolId] ?? null;
}

export function isMutationTool(toolId: string): boolean {
  return normalizeMutationToolId(toolId) !== null;
}

const MAX_WRITE_BYTES = 512 * 1024;

const PROTECTED_WRITE_PATTERNS: readonly RegExp[] = [
  /^\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)id_rsa(\.|$)/,
  /\.pem$/,
  /(^|\/)keys\//,
];

/** High-risk surfaces that ALWAYS require an explicit owner token. */
const OWNER_GATED_CODE_PATTERNS: readonly RegExp[] = [
  /^\.github\/workflows\//i,
  /(^|\/)(?:supabase\/)?migrations?(\/|$)/i,
  /(^|\/)(?:rls|policies|permissions?)(\/|[-_.])/i,
  /(^|\/)(?:auth|authentication|authorization)(\/|[-_.])/i,
  /(^|\/)(?:security|secrets?)(\/|[-_.])/i,
  /(^|\/)(?:payment|payments|billing|stripe|wire|wallet|ledger|bank|escrow|payout)(\/|[-_.])/i,
  /(^|\/)(?:infra|infrastructure|terraform|cloudfront|aws|vercel|render)(\/|[-_.])/i,
  /(^|\/)package\.json$/i,
  /(^|\/)(?:bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/i,
  /(^|\/)(?:eas\.json|app\.config\.[cm]?[jt]s|metro\.config\.[cm]?js)$/i,
  /(^|\/)Dockerfile$/i,
  /^server\.ts$/i,
  /^backend\/api\/owner-only\.ts$/i,
  /^backend\/api\/ivx-agent-/i,
  /^backend\/services\/ivx-agent-/i,
  /^backend\/services\/ivx-autonomous-/i,
  /^backend\/services\/ivx-senior-/i,
  /^backend\/services\/ivx-internal-deploy-auth\.ts$/i,
];

const PROTECTED_BRANCH_PATTERNS: readonly RegExp[] = [
  /^(?:main|master|production|prod)$/i,
  /^release(?:\/|$)/i,
  /^hotfix\/production(?:\/|$)/i,
];

export function isProtectedWritePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return PROTECTED_WRITE_PATTERNS.some((re) => re.test(normalized));
}

export function isOwnerGatedCodePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return isProtectedWritePath(normalized) || OWNER_GATED_CODE_PATTERNS.some((re) => re.test(normalized));
}

export function isProtectedAutonomousBranch(branch: string): boolean {
  return PROTECTED_BRANCH_PATTERNS.some((re) => re.test(branch.trim()));
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function redactSecrets(text: string): string {
  return text
    .replace(/https:\/\/[^@\s/]+:[^@\s/]+@/g, 'https://***:***@')
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,}/g, 'gh*_***REDACTED***')
    .replace(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g, 'eyJ***REDACTED***')
    .replace(/(rnd_[A-Za-z0-9]{10,})/g, 'rnd_***REDACTED***');
}

// ── Authorization ────────────────────────────────────────────────────────────

export type ApprovalMode = 'owner' | 'autonomous_system' | 'none';
export type ApprovalOutcome = {
  approved: boolean;
  reason: string;
  binding: string;
  mode: ApprovalMode;
};

function tokenMatches(expected: string, provided: string): boolean {
  if (!expected || !provided) return false;
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  return timingSafeEqual(a, b);
}

/**
 * Verify either the explicit owner token or the autonomous system credential.
 * A system credential is NOT equivalent to owner approval: executeMutationTool
 * applies a second risk gate and only permits low-risk mutations.
 */
export function verifyOwnerApproval(token: string | null | undefined): ApprovalOutcome {
  const owner = (process.env.IVX_OWNER_TOKEN ?? '').trim();
  const provided = (token ?? '').trim();
  const systemCandidates = [
    (process.env.IVX_AI_SYSTEM_SECRET ?? '').trim(),
    (process.env.IVX_SYSTEM_SECRET ?? '').trim(),
  ].filter(Boolean);

  if (tokenMatches(owner, provided)) {
    return {
      approved: true,
      reason: 'owner_approval_verified',
      binding: `env:IVX_OWNER_TOKEN#sha256:${sha256(owner).slice(0, 12)}`,
      mode: 'owner',
    };
  }

  for (const system of systemCandidates) {
    if (tokenMatches(system, provided)) {
      return {
        approved: true,
        reason: 'autonomous_system_credential_verified_low_risk_only',
        binding: `env:IVX_SYSTEM_SECRET#sha256:${sha256(system).slice(0, 12)}`,
        mode: 'autonomous_system',
      };
    }
  }

  if (!owner) {
    return {
      approved: false,
      reason: 'owner_token_not_configured: IVX_OWNER_TOKEN is unset, so owner-gated writes cannot be authorized',
      binding: 'none',
      mode: 'none',
    };
  }
  if (!provided) {
    return { approved: false, reason: 'missing_owner_approval_token', binding: 'none', mode: 'none' };
  }
  return { approved: false, reason: 'invalid_owner_approval_token', binding: 'none', mode: 'none' };
}

export type MutationRiskDecision = {
  autonomous: boolean;
  risk: 'low' | 'high';
  reason: string;
  sensitivePaths: string[];
};

export function classifyMutationRisk(toolId: string, params: Record<string, unknown>): MutationRiskDecision {
  const normalized = normalizeMutationToolId(toolId);
  if (!normalized) return { autonomous: false, risk: 'high', reason: 'unknown_mutation_tool', sensitivePaths: [] };

  if (normalized === 'code_patch_proposal') {
    return { autonomous: true, risk: 'low', reason: 'read_only_patch_proposal', sensitivePaths: [] };
  }

  if (normalized === 'deploy') {
    return { autonomous: false, risk: 'high', reason: 'production_deploy_requires_owner', sensitivePaths: [] };
  }

  if (normalized === 'code_write') {
    const rel = String(params.path ?? '').trim();
    if (!rel) return { autonomous: false, risk: 'high', reason: 'missing_path', sensitivePaths: [] };
    const sensitive = isOwnerGatedCodePath(rel) ? [rel] : [];
    return sensitive.length > 0
      ? { autonomous: false, risk: 'high', reason: 'owner_gated_code_path', sensitivePaths: sensitive }
      : { autonomous: true, risk: 'low', reason: 'low_risk_application_code', sensitivePaths: [] };
  }

  if (normalized === 'git_commit') {
    const files = Array.isArray(params.files) ? params.files.map(String) : [];
    if (files.length === 0) return { autonomous: false, risk: 'high', reason: 'missing_commit_files', sensitivePaths: [] };
    const sensitive = files.filter(isOwnerGatedCodePath);
    return sensitive.length > 0
      ? { autonomous: false, risk: 'high', reason: 'commit_contains_owner_gated_path', sensitivePaths: sensitive }
      : { autonomous: true, risk: 'low', reason: 'verified_low_risk_commit', sensitivePaths: [] };
  }

  if (normalized === 'git_push') {
    const branch = String(params.branch ?? '').trim();
    if (!branch) return { autonomous: false, risk: 'high', reason: 'missing_branch', sensitivePaths: [] };
    if (isProtectedAutonomousBranch(branch)) {
      return { autonomous: false, risk: 'high', reason: 'protected_branch_requires_owner', sensitivePaths: [] };
    }
    return { autonomous: true, risk: 'low', reason: 'non_protected_branch_push', sensitivePaths: [] };
  }

  return { autonomous: false, risk: 'high', reason: 'owner_approval_required', sensitivePaths: [] };
}

// ── Verification gate ────────────────────────────────────────────────────────

export type VerificationGate = {
  passed: boolean;
  typecheckErrors: number;
  testsPass: number;
  failingTestNames: string[];
  detail: string;
  evidenceSha256: string;
};

export async function runVerificationGate(
  repoRoot: string,
  options: { testTarget?: string; timeoutMs?: number } = {},
): Promise<VerificationGate> {
  const testTarget = options.testTarget ?? 'backend';
  const timeoutMs = options.timeoutMs ?? 900_000;

  const tsc = await runProcess('bunx', ['tsc', '--noEmit'], repoRoot, Math.min(timeoutMs, 600_000));
  const tscParsed = parseTscOutput(`${tsc.stdout}\n${tsc.stderr}`);
  const tests = await runProcess('bun', ['test', testTarget], repoRoot, timeoutMs);
  const testOut = `${tests.stdout}\n${tests.stderr}`;
  const testParsed = parseBunTestOutput(testOut);
  const passed = tscParsed.errorCount === 0 && testParsed.failingTestNames.length === 0 && testParsed.pass > 0;

  return {
    passed,
    typecheckErrors: tscParsed.errorCount,
    testsPass: testParsed.pass,
    failingTestNames: testParsed.failingTestNames.slice(0, 20),
    detail: passed
      ? `verification GREEN — 0 type errors, ${testParsed.pass} tests passing, 0 failing`
      : `verification RED — ${tscParsed.errorCount} type error(s), ${testParsed.failingTestNames.length} failing test name(s)`,
    evidenceSha256: sha256(redactSecrets(`${tsc.stdout}${testOut}`)),
  };
}

// ── Result helpers ───────────────────────────────────────────────────────────

export type MutationToolResult = EngineeringToolResult & {
  approvalVerified: boolean;
  rolledBack: boolean;
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
): MutationToolResult {
  return {
    ok: true,
    toolId,
    sourceReference: fields.sourceReference,
    contentSha256: fields.contentSha256,
    summary: fields.summary,
    extract: fields.extract,
    exitCode: fields.exitCode ?? 0,
    durationMs: Date.now() - startedAt,
    error: null,
    approvalVerified: true,
    rolledBack: false,
  };
}

function failed(
  toolId: string,
  error: string,
  startedAt: number,
  opts: { approvalVerified?: boolean; rolledBack?: boolean; extract?: Record<string, unknown> } = {},
): MutationToolResult {
  return {
    ok: false,
    toolId,
    sourceReference: '',
    contentSha256: '',
    summary: '',
    extract: opts.extract ?? {},
    exitCode: -1,
    durationMs: Date.now() - startedAt,
    error,
    approvalVerified: opts.approvalVerified ?? false,
    rolledBack: opts.rolledBack ?? false,
  };
}

export type MutationToolParams = Record<string, unknown>;
export type MutationToolOptions = {
  repoRoot?: string;
  ownerApprovalToken?: string | null;
  timeoutMs?: number;
  testTarget?: string;
  preVerified?: VerificationGate;
};

/**
 * Execute a mutation. Explicit owner credentials retain the existing owner-gated
 * capability. Autonomous system credentials are constrained to LOW-RISK actions.
 */
export async function executeMutationTool(
  toolId: string,
  params: MutationToolParams,
  options: MutationToolOptions = {},
): Promise<MutationToolResult> {
  const startedAt = Date.now();
  const normalized = normalizeMutationToolId(toolId);
  if (!normalized) return failed(toolId, `not a mutation tool: ${toolId}`, startedAt);

  const approval = verifyOwnerApproval(options.ownerApprovalToken);
  if (!approval.approved) {
    return failed(normalized, `owner approval required — ${approval.reason}`, startedAt);
  }

  const risk = classifyMutationRisk(normalized, params);
  if (approval.mode === 'autonomous_system' && !risk.autonomous) {
    return failed(
      normalized,
      `owner approval required — autonomous system blocked from ${risk.reason}`,
      startedAt,
      {
        approvalVerified: true,
        extract: {
          authorizationMode: approval.mode,
          approvalBinding: approval.binding,
          riskDecision: risk,
          ownerGate: true,
        },
      },
    );
  }

  const repoRoot = options.repoRoot ?? resolveRepoRoot();

  if (approval.mode === 'autonomous_system' && normalized === 'git_push') {
    const branch = String(params.branch ?? '').trim();
    if (isProtectedAutonomousBranch(branch)) {
      return failed(normalized, `owner approval required for protected branch: ${branch}`, startedAt, {
        approvalVerified: true,
        extract: { authorizationMode: approval.mode, ownerGate: true },
      });
    }

    let diff = await runProcess('git', ['diff', '--name-only', 'origin/main...HEAD'], repoRoot, 30_000);
    if (diff.exitCode !== 0) diff = await runProcess('git', ['diff', '--name-only', 'main...HEAD'], repoRoot, 30_000);
    if (diff.exitCode !== 0) {
      return failed(normalized, 'cannot prove autonomous push is low-risk because main delta could not be resolved', startedAt, {
        approvalVerified: true,
        extract: { authorizationMode: approval.mode, ownerGate: true },
      });
    }
    const changedFiles = diff.stdout.split('\n').map((v) => v.trim()).filter(Boolean);
    const sensitive = changedFiles.filter(isOwnerGatedCodePath);
    if (sensitive.length > 0) {
      return failed(normalized, `owner approval required — push contains high-risk files: ${sensitive.join(', ')}`, startedAt, {
        approvalVerified: true,
        extract: {
          authorizationMode: approval.mode,
          approvalBinding: approval.binding,
          changedFiles,
          sensitivePaths: sensitive,
          ownerGate: true,
        },
      });
    }
  }

  try {
    switch (normalized) {
      case 'code_write':
        return await doCodeWrite(params, repoRoot, startedAt, approval.binding, approval.mode, risk);
      case 'code_patch_proposal':
        return await doPatchProposal(params, repoRoot, startedAt, options, approval.binding, approval.mode, risk);
      case 'git_commit':
        return await doGitCommit(params, repoRoot, startedAt, options, approval.binding, approval.mode, risk);
      case 'git_push':
        return await doGitPush(params, repoRoot, startedAt, options, approval.binding, approval.mode, risk);
      case 'deploy':
        return await doDeploy(params, startedAt, options, approval.binding, approval.mode, risk);
      default:
        return failed(normalized, `unhandled mutation tool: ${normalized}`, startedAt, { approvalVerified: true });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed(normalized, redactSecrets(message), startedAt, { approvalVerified: true });
  }
}

// ── code_write ───────────────────────────────────────────────────────────────

async function doCodeWrite(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  binding: string,
  mode: ApprovalMode,
  risk: MutationRiskDecision,
): Promise<MutationToolResult> {
  const rel = String(params.path ?? '');
  if (!rel) return failed('code_write', 'path param required', startedAt, { approvalVerified: true });
  if (typeof params.content !== 'string') return failed('code_write', 'content param required (string)', startedAt, { approvalVerified: true });
  if (isProtectedWritePath(rel)) return failed('code_write', `protected path — writes refused: ${rel}`, startedAt, { approvalVerified: true });
  if (mode === 'autonomous_system' && isOwnerGatedCodePath(rel)) {
    return failed('code_write', `owner approval required for high-risk path: ${rel}`, startedAt, {
      approvalVerified: true,
      extract: { authorizationMode: mode, ownerGate: true, riskDecision: risk },
    });
  }

  const content = params.content;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    return failed('code_write', `content too large (${bytes} bytes, cap ${MAX_WRITE_BYTES})`, startedAt, { approvalVerified: true });
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
    return failed('code_write', `write verification failed for ${relFromRoot} — rolled back`, startedAt, {
      approvalVerified: true,
      rolledBack: true,
    });
  }

  const digest = sha256(content);
  return ok('code_write', {
    sourceReference: `file://${relFromRoot}@sha256:${digest.slice(0, 16)}`,
    contentSha256: digest,
    summary: `${existed ? 'Updated' : 'Created'} ${relFromRoot} — ${bytes} bytes (${mode})`,
    extract: {
      relPath: relFromRoot,
      created: !existed,
      bytes,
      previousSha256: previous === null ? null : sha256(previous),
      newSha256: digest,
      authorizationMode: mode,
      approvalBinding: binding,
      riskDecision: risk,
    },
  }, startedAt);
}

async function doPatchProposal(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
  mode: ApprovalMode,
  risk: MutationRiskDecision,
): Promise<MutationToolResult> {
  const scope = params.scope ? String(params.scope) : null;
  const args = ['diff', '--unified=3'];
  if (scope) {
    const abs = await containPath(repoRoot, scope);
    args.push('--', path.relative(repoRoot, abs) || '.');
  }
  const res = await runProcess('git', args, repoRoot, Math.min(options.timeoutMs ?? 60_000, 120_000));
  if (res.exitCode > 1) return failed('code_patch_proposal', `git diff failed (exit ${res.exitCode})`, startedAt, { approvalVerified: true });
  const diff = redactSecrets(res.stdout);
  const digest = sha256(diff);
  const changedFiles = Array.from(diff.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((m) => String(m[1]));
  return ok('code_patch_proposal', {
    sourceReference: `local-exec://git-diff${scope ? `?scope=${encodeURIComponent(scope)}` : ''}@sha256:${digest.slice(0, 16)}`,
    contentSha256: digest,
    summary: `Patch proposal — ${changedFiles.length} file(s) changed, ${diff.split('\n').length} diff lines`,
    extract: { changedFiles, diffPreview: diff.slice(0, 4000), applied: false, authorizationMode: mode, approvalBinding: binding, riskDecision: risk },
    exitCode: res.exitCode,
  }, startedAt);
}

const AGENT_COMMIT_NAME = 'IVX Autonomous Agent';
const AGENT_COMMIT_EMAIL = 'agents@ivxholdings.local';

async function doGitCommit(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
  mode: ApprovalMode,
  risk: MutationRiskDecision,
): Promise<MutationToolResult> {
  const message = String(params.message ?? '').trim();
  if (!message) return failed('git_commit', 'message param required', startedAt, { approvalVerified: true });

  const rawFiles = Array.isArray(params.files) ? (params.files as unknown[]).map(String) : [];
  if (rawFiles.length === 0) return failed('git_commit', 'files param required (non-empty array of repo-relative paths)', startedAt, { approvalVerified: true });

  const relFiles: string[] = [];
  for (const f of rawFiles) {
    if (isProtectedWritePath(f)) return failed('git_commit', `protected path cannot be committed: ${f}`, startedAt, { approvalVerified: true });
    if (mode === 'autonomous_system' && isOwnerGatedCodePath(f)) {
      return failed('git_commit', `owner approval required for high-risk commit path: ${f}`, startedAt, {
        approvalVerified: true,
        extract: { authorizationMode: mode, ownerGate: true, riskDecision: risk },
      });
    }
    const abs = await containPath(repoRoot, f);
    relFiles.push(path.relative(repoRoot, abs));
  }

  const gate = options.preVerified ?? (await runVerificationGate(repoRoot, options));
  if (!gate.passed) {
    return failed('git_commit', `verification gate RED — refusing to commit. ${gate.detail}`, startedAt, {
      approvalVerified: true,
      extract: { verification: gate, policy: 'commit_blocked_by_verification_gate', authorizationMode: mode },
    });
  }

  const add = await runProcess('git', ['add', '--', ...relFiles], repoRoot, 60_000);
  if (add.exitCode !== 0) return failed('git_commit', `git add failed: ${redactSecrets(add.stderr).slice(0, 300)}`, startedAt, { approvalVerified: true });

  const staged = await runProcess('git', ['diff', '--cached', '--name-only'], repoRoot, 30_000);
  const stagedFiles = staged.stdout.split('\n').filter(Boolean);
  if (stagedFiles.length === 0) return failed('git_commit', 'nothing staged — no changes to commit', startedAt, { approvalVerified: true });

  if (mode === 'autonomous_system') {
    const unexpected = stagedFiles.filter((f) => !relFiles.includes(f));
    const sensitive = stagedFiles.filter(isOwnerGatedCodePath);
    if (unexpected.length > 0 || sensitive.length > 0) {
      await runProcess('git', ['reset'], repoRoot, 30_000);
      return failed('git_commit', `autonomous commit safety gate blocked staged files: ${[...unexpected, ...sensitive].join(', ')}`, startedAt, {
        approvalVerified: true,
        extract: { authorizationMode: mode, unexpected, sensitive, ownerGate: sensitive.length > 0 },
      });
    }
  }

  const commit = await runProcess('git', ['-c', `user.name=${AGENT_COMMIT_NAME}`, '-c', `user.email=${AGENT_COMMIT_EMAIL}`, 'commit', '-m', message], repoRoot, 60_000);
  if (commit.exitCode !== 0) return failed('git_commit', `git commit failed: ${redactSecrets(commit.stderr || commit.stdout).slice(0, 300)}`, startedAt, { approvalVerified: true });

  const head = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const commitSha = head.stdout.trim();
  const digest = sha256(`${commitSha}${message}${stagedFiles.join(',')}`);
  return ok('git_commit', {
    sourceReference: `git://commit/${commitSha}`,
    contentSha256: digest,
    summary: `Committed ${stagedFiles.length} file(s) as ${commitSha.slice(0, 12)} — verification green (${mode})`,
    extract: { commitSha, message, committedFiles: stagedFiles, verification: { passed: gate.passed, typecheckErrors: gate.typecheckErrors, testsPass: gate.testsPass, evidenceSha256: gate.evidenceSha256 }, authorizationMode: mode, approvalBinding: binding, riskDecision: risk },
  }, startedAt);
}

async function doGitPush(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
  mode: ApprovalMode,
  risk: MutationRiskDecision,
): Promise<MutationToolResult> {
  const remote = String(params.remote ?? 'origin');
  const branch = String(params.branch ?? '').trim();
  if (!branch) return failed('git_push', 'branch param required', startedAt, { approvalVerified: true });
  if (!/^[A-Za-z0-9._\-\/]+$/.test(branch)) return failed('git_push', `invalid branch name: ${branch}`, startedAt, { approvalVerified: true });
  if (!/^[A-Za-z0-9._\-]+$/.test(remote)) return failed('git_push', `invalid remote name: ${remote}`, startedAt, { approvalVerified: true });
  if (mode === 'autonomous_system' && isProtectedAutonomousBranch(branch)) return failed('git_push', `owner approval required for protected branch: ${branch}`, startedAt, { approvalVerified: true });

  const before = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const localSha = before.stdout.trim();
  const push = await runProcess('git', ['push', remote, `HEAD:refs/heads/${branch}`], repoRoot, Math.min(options.timeoutMs ?? 180_000, 300_000));
  const transcript = redactSecrets(`${push.stdout}\n${push.stderr}`);
  if (push.exitCode !== 0) return failed('git_push', `git push failed (exit ${push.exitCode}): ${transcript.slice(0, 400)}`, startedAt, { approvalVerified: true, extract: { remote, branch, transcript: transcript.slice(0, 2000), authorizationMode: mode } });

  const lsRemote = await runProcess('git', ['ls-remote', remote, `refs/heads/${branch}`], repoRoot, 60_000);
  const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0] ?? '';
  const confirmed = remoteSha === localSha;
  const digest = sha256(`${localSha}${remoteSha}${branch}`);
  if (!confirmed) return failed('git_push', `push reported success but remote ref does not match local HEAD (local=${localSha.slice(0, 12)} remote=${remoteSha.slice(0, 12) || 'none'})`, startedAt, { approvalVerified: true, extract: { localSha, remoteSha, branch, authorizationMode: mode } });

  return ok('git_push', {
    sourceReference: `git://push/${branch}@${remoteSha}`,
    contentSha256: digest,
    summary: `Pushed ${localSha.slice(0, 12)} to ${remote}/${branch} — remote ref confirmed (${mode})`,
    extract: { remote, branch, localSha, remoteSha, remoteConfirmed: confirmed, transcript: transcript.slice(0, 2000), authorizationMode: mode, approvalBinding: binding, riskDecision: risk },
  }, startedAt);
}

async function doDeploy(
  params: MutationToolParams,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
  mode: ApprovalMode,
  risk: MutationRiskDecision,
): Promise<MutationToolResult> {
  const apiKey = extractRenderApiKey(process.env.RENDER_API_KEY ?? process.env.IVX_RENDER_API_KEY);
  const serviceId = extractRenderServiceId(String(params.serviceId ?? process.env.RENDER_SERVICE_ID ?? ''));
  const deployMode = String(params.mode ?? 'verify');

  if (!apiKey) return failed('deploy', 'render_api_key_not_configured: RENDER_API_KEY is unset', startedAt, { approvalVerified: true });
  if (!serviceId) return failed('deploy', 'service_id_not_configured: RENDER_SERVICE_ID is unset and no serviceId param given', startedAt, { approvalVerified: true });
  if (deployMode !== 'verify' && deployMode !== 'trigger') return failed('deploy', `invalid mode "${deployMode}" (expected "verify" or "trigger")`, startedAt, { approvalVerified: true });

  const base = `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`;
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'Content-Type': 'application/json' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 60_000, 120_000));

  try {
    if (deployMode === 'verify') {
      const res = await fetch(base, { headers, signal: controller.signal });
      const raw = await res.text();
      const digest = sha256(raw);
      if (!res.ok) return failed('deploy', `render service check failed (HTTP ${res.status})`, startedAt, { approvalVerified: true, extract: { httpStatus: res.status, mode: deployMode, serviceId } });
      const parsed = JSON.parse(raw) as { id?: string; name?: string; type?: string; suspended?: string };
      return ok('deploy', {
        sourceReference: `https://api.render.com/v1/services/${serviceId}@sha256:${digest.slice(0, 16)}`,
        contentSha256: digest,
        summary: `Deploy target VERIFIED — service "${parsed.name ?? serviceId}" reachable with live credential (no rollout triggered)`,
        extract: { mode: deployMode, httpStatus: res.status, serviceId: parsed.id ?? serviceId, serviceName: parsed.name ?? null, serviceType: parsed.type ?? null, suspended: parsed.suspended ?? null, rolloutTriggered: false, authorizationMode: mode, approvalBinding: binding, riskDecision: risk },
      }, startedAt);
    }

    const res = await fetch(`${base}/deploys`, { method: 'POST', headers, body: JSON.stringify({ clearCache: 'do_not_clear' }), signal: controller.signal });
    const raw = await res.text();
    const digest = sha256(raw);
    if (!res.ok) return failed('deploy', `render deploy trigger failed (HTTP ${res.status}): ${redactSecrets(raw).slice(0, 300)}`, startedAt, { approvalVerified: true, extract: { httpStatus: res.status, mode: deployMode, serviceId } });
    const parsed = JSON.parse(raw) as { id?: string; status?: string; commit?: { id?: string } };
    return ok('deploy', {
      sourceReference: `https://api.render.com/v1/services/${serviceId}/deploys/${parsed.id ?? 'unknown'}@sha256:${digest.slice(0, 16)}`,
      contentSha256: digest,
      summary: `Deploy TRIGGERED — deploy ${parsed.id ?? 'unknown'} status=${parsed.status ?? 'unknown'}`,
      extract: { mode: deployMode, httpStatus: res.status, serviceId, deployId: parsed.id ?? null, status: parsed.status ?? null, commitSha: parsed.commit?.id ?? null, rolloutTriggered: true, authorizationMode: mode, approvalBinding: binding, riskDecision: risk },
    }, startedAt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed('deploy', `render request error: ${redactSecrets(message)}`, startedAt, { approvalVerified: true });
  } finally {
    clearTimeout(timer);
  }
}
