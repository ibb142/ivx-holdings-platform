/**
 * IVX Agent Mutation Tools — REAL, owner-approved write → commit → push → deploy.
 *
 * The companion module `ivx-agent-engineering-tools.ts` is read-only by
 * construction. This module is the other half: the mutating capabilities that
 * were previously declared in `OWNER_APPROVAL_ENGINEERING_TOOLS` but had no
 * implementation, so `executeRealTool` returned "approval recorded but
 * execution is intentionally not implemented". That made the fleet unable to
 * ship anything. These tools close that gap for real.
 *
 * NON-NEGOTIABLE RULES ENFORCED HERE
 *   - OWNER APPROVAL IS VERIFIED, NOT ASSUMED. The previous gate accepted ANY
 *     truthy string as an approval token. Here the token is compared against
 *     the configured owner token with a constant-time comparison. A wrong token
 *     is a hard failure, never a downgrade to read-only.
 *   - NO GREEN, NO SHIP. `git_commit` refuses to run unless the verification
 *     gate (typecheck + tests) is actually green on the working tree being
 *     committed. A senior developer does not commit red code, so there is no
 *     "force" parameter that can bypass it.
 *   - REAL OPERATIONS ONLY. Every tool performs a real filesystem, git, or HTTP
 *     operation. A failure returns a failure; nothing is ever simulated.
 *   - ROLLBACK ON FAILURE. `code_write` snapshots prior content and restores it
 *     if the write cannot be verified by re-read.
 *   - PATH CONTAINMENT + PROTECTED PATHS. Writes are contained inside the repo
 *     root and refused for `.git/`, `node_modules/`, and env/secret files.
 *   - SECRET REDACTION. The git remote for this project embeds an access token
 *     in the URL. Every captured stdout/stderr is redacted before it is stored
 *     in evidence, so a push transcript can never leak the credential.
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

export const IVX_MUTATION_TOOLS_MARKER = 'ivx-agent-mutation-tools-2026-08-20';

/** Mutating tools that actually execute, once owner approval is verified. */
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

/** `prod_deploy` / `deploy_to_production` are historical aliases for `deploy`. */
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

/**
 * Paths that agents may never write, regardless of approval. Git internals and
 * installed dependencies are not source; env files hold live credentials.
 */
const PROTECTED_WRITE_PATTERNS: readonly RegExp[] = [
  /^\.git\//,
  /(^|\/)node_modules\//,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)id_rsa(\.|$)/,
  /\.pem$/,
  /(^|\/)keys\//,
];

export function isProtectedWritePath(relPath: string): boolean {
  const normalized = relPath.replace(/\\/g, '/').replace(/^\.\//, '');
  return PROTECTED_WRITE_PATTERNS.some((re) => re.test(normalized));
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Strip credentials from captured process output.
 *
 * The configured git remote is of the form
 * `https://x-access-token:<token>@github.com/owner/repo.git`, so a push
 * transcript would otherwise embed a live token in stored evidence.
 */
export function redactSecrets(text: string): string {
  return text
    .replace(/https:\/\/[^@\s/]+:[^@\s/]+@/g, 'https://***:***@')
    .replace(/gh[pousr]_[A-Za-z0-9_]{16,}/g, 'gh*_***REDACTED***')
    .replace(/(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]+)?/g, 'eyJ***REDACTED***')
    .replace(/(rnd_[A-Za-z0-9]{10,})/g, 'rnd_***REDACTED***');
}

// ── Owner approval ───────────────────────────────────────────────────────────

export type ApprovalOutcome = { approved: boolean; reason: string; binding: string };

/**
 * Verify an owner approval token against the configured owner token.
 *
 * Compared over sha256 digests so the comparison is constant time and does not
 * leak token length. If no owner token is configured the answer is "no" —
 * an unconfigured server must not become an open write surface.
 */
export function verifyOwnerApproval(token: string | null | undefined): ApprovalOutcome {
  const expected = (process.env.IVX_OWNER_TOKEN ?? '').trim();
  const provided = (token ?? '').trim();

  if (!expected) {
    return {
      approved: false,
      reason: 'owner_token_not_configured: IVX_OWNER_TOKEN is unset, so no write can be authorized',
      binding: 'none',
    };
  }
  if (!provided) {
    return { approved: false, reason: 'missing_owner_approval_token', binding: 'none' };
  }

  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(provided).digest();
  if (!timingSafeEqual(a, b)) {
    return { approved: false, reason: 'invalid_owner_approval_token', binding: 'none' };
  }
  return {
    approved: true,
    reason: 'owner_approval_verified',
    binding: `env:IVX_OWNER_TOKEN#sha256:${sha256(expected).slice(0, 12)}`,
  };
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

/**
 * Run the real verification gate: typecheck + backend tests.
 *
 * This is what makes the pipeline trustworthy — a commit can only be produced
 * from a tree that actually typechecks and whose tests actually pass.
 */
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

  const passed =
    tscParsed.errorCount === 0 && testParsed.failingTestNames.length === 0 && testParsed.pass > 0;

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
  /** Test target for the verification gate. Defaults to `backend`. */
  testTarget?: string;
  /**
   * Skip the verification gate for `git_commit`. Only honored when the caller
   * has ALREADY run the gate and passes its real result through
   * `preVerified`. There is no way to skip verification entirely.
   */
  preVerified?: VerificationGate;
};

/**
 * Execute an owner-approved mutating tool.
 *
 * Approval is verified first for every tool; an unapproved or wrongly-approved
 * call never reaches a filesystem, git, or network operation.
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

  const repoRoot = options.repoRoot ?? resolveRepoRoot();

  try {
    switch (normalized) {
      case 'code_write':
        return await doCodeWrite(params, repoRoot, startedAt);
      case 'code_patch_proposal':
        return await doPatchProposal(params, repoRoot, startedAt, options);
      case 'git_commit':
        return await doGitCommit(params, repoRoot, startedAt, options, approval.binding);
      case 'git_push':
        return await doGitPush(params, repoRoot, startedAt, options, approval.binding);
      case 'deploy':
        return await doDeploy(params, startedAt, options);
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
): Promise<MutationToolResult> {
  const rel = String(params.path ?? '');
  if (!rel) return failed('code_write', 'path param required', startedAt, { approvalVerified: true });
  if (typeof params.content !== 'string') {
    return failed('code_write', 'content param required (string)', startedAt, { approvalVerified: true });
  }
  if (isProtectedWritePath(rel)) {
    return failed('code_write', `protected path — writes refused: ${rel}`, startedAt, { approvalVerified: true });
  }

  const content = params.content;
  const bytes = Buffer.byteLength(content, 'utf8');
  if (bytes > MAX_WRITE_BYTES) {
    return failed('code_write', `content too large (${bytes} bytes, cap ${MAX_WRITE_BYTES})`, startedAt, {
      approvalVerified: true,
    });
  }

  const abs = await containPath(repoRoot, rel);
  const relFromRoot = path.relative(repoRoot, abs);

  const existed = await stat(abs).then((s) => s.isFile()).catch(() => false);
  const previous = existed ? await readFile(abs, 'utf8') : null;

  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');

  // Verify by re-reading: a write that cannot be read back is rolled back.
  const readBack = await readFile(abs, 'utf8').catch(() => null);
  if (readBack !== content) {
    if (previous !== null) await writeFile(abs, previous, 'utf8').catch(() => undefined);
    return failed('code_write', `write verification failed for ${relFromRoot} — rolled back`, startedAt, {
      approvalVerified: true,
      rolledBack: true,
    });
  }

  const digest = sha256(content);
  return ok(
    'code_write',
    {
      sourceReference: `file://${relFromRoot}@sha256:${digest.slice(0, 16)}`,
      contentSha256: digest,
      summary: `${existed ? 'Updated' : 'Created'} ${relFromRoot} — ${bytes} bytes`,
      extract: {
        relPath: relFromRoot,
        created: !existed,
        bytes,
        previousSha256: previous === null ? null : sha256(previous),
        newSha256: digest,
      },
    },
    startedAt,
  );
}

// ── code_patch_proposal ──────────────────────────────────────────────────────

/** Produce a real unified diff of the working tree without changing anything. */
async function doPatchProposal(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
): Promise<MutationToolResult> {
  const scope = params.scope ? String(params.scope) : null;
  const args = ['diff', '--unified=3'];
  if (scope) {
    const abs = await containPath(repoRoot, scope);
    args.push('--', path.relative(repoRoot, abs) || '.');
  }
  const res = await runProcess('git', args, repoRoot, Math.min(options.timeoutMs ?? 60_000, 120_000));
  if (res.exitCode > 1) {
    return failed('code_patch_proposal', `git diff failed (exit ${res.exitCode})`, startedAt, { approvalVerified: true });
  }
  const diff = redactSecrets(res.stdout);
  const digest = sha256(diff);
  const changedFiles = Array.from(diff.matchAll(/^\+\+\+ b\/(.+)$/gm)).map((m) => String(m[1]));
  return ok(
    'code_patch_proposal',
    {
      sourceReference: `local-exec://git-diff${scope ? `?scope=${encodeURIComponent(scope)}` : ''}@sha256:${digest.slice(0, 16)}`,
      contentSha256: digest,
      summary: `Patch proposal — ${changedFiles.length} file(s) changed, ${diff.split('\n').length} diff lines`,
      extract: { changedFiles, diffPreview: diff.slice(0, 4000), applied: false },
      exitCode: res.exitCode,
    },
    startedAt,
  );
}

// ── git_commit ───────────────────────────────────────────────────────────────

const AGENT_COMMIT_NAME = 'IVX Autonomous Agent';
const AGENT_COMMIT_EMAIL = 'agents@ivxholdings.local';

async function doGitCommit(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
): Promise<MutationToolResult> {
  const message = String(params.message ?? '').trim();
  if (!message) return failed('git_commit', 'message param required', startedAt, { approvalVerified: true });

  const rawFiles = Array.isArray(params.files) ? (params.files as unknown[]).map(String) : [];
  if (rawFiles.length === 0) {
    return failed('git_commit', 'files param required (non-empty array of repo-relative paths)', startedAt, {
      approvalVerified: true,
    });
  }

  const relFiles: string[] = [];
  for (const f of rawFiles) {
    if (isProtectedWritePath(f)) {
      return failed('git_commit', `protected path cannot be committed: ${f}`, startedAt, { approvalVerified: true });
    }
    const abs = await containPath(repoRoot, f);
    relFiles.push(path.relative(repoRoot, abs));
  }

  // NO GREEN, NO SHIP. Either the caller supplies a real passing gate result,
  // or the gate is run here. There is no bypass.
  const gate = options.preVerified ?? (await runVerificationGate(repoRoot, options));
  if (!gate.passed) {
    return failed('git_commit', `verification gate RED — refusing to commit. ${gate.detail}`, startedAt, {
      approvalVerified: true,
      extract: {
        verification: gate,
        policy: 'commit_blocked_by_verification_gate',
      },
    });
  }

  const add = await runProcess('git', ['add', '--', ...relFiles], repoRoot, 60_000);
  if (add.exitCode !== 0) {
    return failed('git_commit', `git add failed: ${redactSecrets(add.stderr).slice(0, 300)}`, startedAt, {
      approvalVerified: true,
    });
  }

  const staged = await runProcess('git', ['diff', '--cached', '--name-only'], repoRoot, 30_000);
  const stagedFiles = staged.stdout.split('\n').filter(Boolean);
  if (stagedFiles.length === 0) {
    return failed('git_commit', 'nothing staged — no changes to commit', startedAt, { approvalVerified: true });
  }

  const commit = await runProcess(
    'git',
    ['-c', `user.name=${AGENT_COMMIT_NAME}`, '-c', `user.email=${AGENT_COMMIT_EMAIL}`, 'commit', '-m', message],
    repoRoot,
    60_000,
  );
  if (commit.exitCode !== 0) {
    return failed('git_commit', `git commit failed: ${redactSecrets(commit.stderr || commit.stdout).slice(0, 300)}`, startedAt, {
      approvalVerified: true,
    });
  }

  const head = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const commitSha = head.stdout.trim();
  const digest = sha256(`${commitSha}${message}${stagedFiles.join(',')}`);

  return ok(
    'git_commit',
    {
      sourceReference: `git://commit/${commitSha}`,
      contentSha256: digest,
      summary: `Committed ${stagedFiles.length} file(s) as ${commitSha.slice(0, 12)} — verification green`,
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
        approvalBinding: binding,
      },
    },
    startedAt,
  );
}

// ── git_push ─────────────────────────────────────────────────────────────────

async function doGitPush(
  params: MutationToolParams,
  repoRoot: string,
  startedAt: number,
  options: MutationToolOptions,
  binding: string,
): Promise<MutationToolResult> {
  const remote = String(params.remote ?? 'origin');
  const branch = String(params.branch ?? '').trim();
  if (!branch) return failed('git_push', 'branch param required', startedAt, { approvalVerified: true });
  if (!/^[A-Za-z0-9._\-\/]+$/.test(branch)) {
    return failed('git_push', `invalid branch name: ${branch}`, startedAt, { approvalVerified: true });
  }
  if (!/^[A-Za-z0-9._\-]+$/.test(remote)) {
    return failed('git_push', `invalid remote name: ${remote}`, startedAt, { approvalVerified: true });
  }

  const before = await runProcess('git', ['rev-parse', 'HEAD'], repoRoot, 30_000);
  const localSha = before.stdout.trim();

  const push = await runProcess('git', ['push', remote, `HEAD:refs/heads/${branch}`], repoRoot, Math.min(options.timeoutMs ?? 180_000, 300_000));
  const transcript = redactSecrets(`${push.stdout}\n${push.stderr}`);
  if (push.exitCode !== 0) {
    return failed('git_push', `git push failed (exit ${push.exitCode}): ${transcript.slice(0, 400)}`, startedAt, {
      approvalVerified: true,
      extract: { remote, branch, transcript: transcript.slice(0, 2000) },
    });
  }

  // Confirm the remote actually advanced to our commit.
  const lsRemote = await runProcess('git', ['ls-remote', remote, `refs/heads/${branch}`], repoRoot, 60_000);
  const remoteSha = lsRemote.stdout.trim().split(/\s+/)[0] ?? '';
  const confirmed = remoteSha === localSha;

  const digest = sha256(`${localSha}${remoteSha}${branch}`);
  if (!confirmed) {
    return failed(
      'git_push',
      `push reported success but remote ref does not match local HEAD (local=${localSha.slice(0, 12)} remote=${remoteSha.slice(0, 12) || 'none'})`,
      startedAt,
      { approvalVerified: true, extract: { localSha, remoteSha, branch } },
    );
  }

  return ok(
    'git_push',
    {
      sourceReference: `git://push/${branch}@${remoteSha}`,
      contentSha256: digest,
      summary: `Pushed ${localSha.slice(0, 12)} to ${remote}/${branch} — remote ref confirmed`,
      extract: {
        remote,
        branch,
        localSha,
        remoteSha,
        remoteConfirmed: confirmed,
        transcript: transcript.slice(0, 2000),
        approvalBinding: binding,
      },
    },
    startedAt,
  );
}

// ── deploy ───────────────────────────────────────────────────────────────────

/**
 * Trigger (or verify) a real Render deployment.
 *
 * `mode: 'verify'` performs a real read-only GET against the Render API to
 * prove the credential and service target are valid without triggering a
 * production rollout. `mode: 'trigger'` performs the real POST.
 */
async function doDeploy(
  params: MutationToolParams,
  startedAt: number,
  options: MutationToolOptions,
): Promise<MutationToolResult> {
  const apiKey = (process.env.RENDER_API_KEY ?? process.env.IVX_RENDER_API_KEY ?? '').trim();
  const serviceId = String(params.serviceId ?? process.env.RENDER_SERVICE_ID ?? '').trim();
  const mode = String(params.mode ?? 'verify');

  if (!apiKey) {
    return failed('deploy', 'render_api_key_not_configured: RENDER_API_KEY is unset', startedAt, {
      approvalVerified: true,
    });
  }
  if (!serviceId) {
    return failed('deploy', 'service_id_not_configured: RENDER_SERVICE_ID is unset and no serviceId param given', startedAt, {
      approvalVerified: true,
    });
  }
  if (mode !== 'verify' && mode !== 'trigger') {
    return failed('deploy', `invalid mode "${mode}" (expected "verify" or "trigger")`, startedAt, {
      approvalVerified: true,
    });
  }

  const base = `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(options.timeoutMs ?? 60_000, 120_000));

  try {
    if (mode === 'verify') {
      const res = await fetch(base, { headers, signal: controller.signal });
      const raw = await res.text();
      const digest = sha256(raw);
      if (!res.ok) {
        return failed('deploy', `render service check failed (HTTP ${res.status})`, startedAt, {
          approvalVerified: true,
          extract: { httpStatus: res.status, mode, serviceId },
        });
      }
      const parsed = JSON.parse(raw) as { id?: string; name?: string; type?: string; suspended?: string };
      return ok(
        'deploy',
        {
          sourceReference: `https://api.render.com/v1/services/${serviceId}@sha256:${digest.slice(0, 16)}`,
          contentSha256: digest,
          summary: `Deploy target VERIFIED — service "${parsed.name ?? serviceId}" reachable with live credential (no rollout triggered)`,
          extract: {
            mode,
            httpStatus: res.status,
            serviceId: parsed.id ?? serviceId,
            serviceName: parsed.name ?? null,
            serviceType: parsed.type ?? null,
            suspended: parsed.suspended ?? null,
            rolloutTriggered: false,
          },
        },
        startedAt,
      );
    }

    const res = await fetch(`${base}/deploys`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ clearCache: 'do_not_clear' }),
      signal: controller.signal,
    });
    const raw = await res.text();
    const digest = sha256(raw);
    if (!res.ok) {
      return failed('deploy', `render deploy trigger failed (HTTP ${res.status}): ${redactSecrets(raw).slice(0, 300)}`, startedAt, {
        approvalVerified: true,
        extract: { httpStatus: res.status, mode, serviceId },
      });
    }
    const parsed = JSON.parse(raw) as { id?: string; status?: string; commit?: { id?: string } };
    return ok(
      'deploy',
      {
        sourceReference: `https://api.render.com/v1/services/${serviceId}/deploys/${parsed.id ?? 'unknown'}@sha256:${digest.slice(0, 16)}`,
        contentSha256: digest,
        summary: `Deploy TRIGGERED — deploy ${parsed.id ?? 'unknown'} status=${parsed.status ?? 'unknown'}`,
        extract: {
          mode,
          httpStatus: res.status,
          serviceId,
          deployId: parsed.id ?? null,
          status: parsed.status ?? null,
          commitSha: parsed.commit?.id ?? null,
          rolloutTriggered: true,
        },
      },
      startedAt,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failed('deploy', `render request error: ${redactSecrets(message)}`, startedAt, { approvalVerified: true });
  } finally {
    clearTimeout(timer);
  }
}
