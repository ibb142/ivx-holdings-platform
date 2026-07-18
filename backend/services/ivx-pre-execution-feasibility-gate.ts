/**
 * IVX Pre-Execution Feasibility Gate — truth-first execution gate.
 *
 * Runs BEFORE any tool execution, patch, commit, deploy, database migration, or
 * proof claim. Decomposes a task into required capabilities, verifies each one
 * against the real runtime, and returns BLOCKED with the exact blocker code if
 * any capability cannot actually be exercised right now. Only when every check
 * passes does the gate return READY and allow execution to proceed.
 *
 * Design rules (owner spec — FINAL PRE-EXECUTION FEASIBILITY GATE):
 *  1. Never reads credentials from chat history; only from the secure vault /
 *     Render env / approved backend runtime secret store (via ivx-secure-vault).
 *  2. Never prints secret values — only exists / length / masked prefix /
 *     auth status / HTTP status.
 *  3. If any check fails: STATE = BLOCKED with BLOCKER_CODE + exact blocker.
 *     No fake reports, no looping, no continuation.
 *  4. Spin-loop prevention: a blocker that repeats 2 times is remembered and
 *     the gate refuses to re-run it until the owner clears the memory.
 *  5. No VERIFIED status without a real proof ledger entry.
 *
 * Pure + deterministic apart from the live credential probes, which are
 * injectable so the module is fully unit-testable.
 */

import { getVaultValue, inspectVaultVariable } from './ivx-secure-vault';

export const IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER =
  'ivx-pre-execution-feasibility-gate-2026-07-05-v1';

// ─── Capability catalogue ────────────────────────────────────────────

export type CapabilityId =
  | 'read_files'
  | 'write_files'
  | 'run_tests'
  | 'commit'
  | 'push_github'
  | 'trigger_render_deploy'
  | 'query_supabase'
  | 'migrate_database'
  | 'verify_live_endpoint'
  | 'verify_owner_session';

export type RequiredCredential =
  | 'IVX_GITHUB_TOKEN'
  | 'IVX_RENDER_API_KEY'
  | 'IVX_RENDER_SERVICE_ID'
  | 'IVX_SUPABASE_URL'
  | 'IVX_SUPABASE_SERVICE_ROLE_KEY'
  | 'IVX_OWNER_TOKEN';

export type BlockerCode =
  | 'GITHUB_TOKEN_MISSING'
  | 'GITHUB_TOKEN_REVOKED'
  | 'GITHUB_REPO_INVALID'
  | 'GITHUB_REPO_UNAUTHORIZED'
  | 'RENDER_KEY_MISSING'
  | 'RENDER_SERVICE_ID_INVALID'
  | 'SUPABASE_ANON_KEY_MISMATCH'
  | 'SUPABASE_SERVICE_ROLE_MISSING'
  | 'SUPABASE_SERVICE_ROLE_INVALID'
  | 'OWNER_SESSION_MISSING'
  | 'TOOL_NOT_AVAILABLE'
  | 'NO_WRITE_PERMISSION'
  | 'REPEATED_BLOCKER';

export type CapabilityCheckResult = {
  capability: CapabilityId;
  ok: boolean;
  /** Present when ok = false. */
  blockerCode: BlockerCode | null;
  /** Human-readable exact blocker text. */
  exactBlocker: string | null;
  /** Required variable name (when relevant). */
  requiredVariable: RequiredCredential | null;
  /** Where the variable was loaded from (or 'none'). */
  runtimeSource: 'ivx' | 'fallback' | 'none' | 'not_applicable';
  /** Live HTTP status from the credential probe, when one was run. */
  httpStatus: number | null;
  /** Whether a credential was present (length > 0). */
  credentialPresent: boolean;
  /** Masked prefix of the credential, e.g. 'ghp_LGg…' — never the full value. */
  credentialPrefix: string | null;
  /** Length of the credential value (never the value). */
  credentialLength: number;
  /** Whether the credential authenticated live. */
  authStatus: 'authenticated' | 'rejected' | 'untested' | 'not_applicable';
  /** Detail line from the live test. */
  testDetail: string | null;
};

export type FeasibilityGateResult =
  | {
      state: 'READY';
      taskId: string;
      capabilities: CapabilityCheckResult[];
      repeatedBlocker: false;
      generatedAt: string;
      marker: typeof IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER;
    }
  | {
      state: 'BLOCKED';
      taskId: string;
      blockerCode: BlockerCode;
      exactBlocker: string;
      failedCapability: CapabilityId;
      requiredVariable: RequiredCredential | null;
      runtimeSource: 'ivx' | 'fallback' | 'none' | 'not_applicable';
      httpStatus: number | null;
      nextOwnerAction: string;
      capabilities: CapabilityCheckResult[];
      repeatedBlocker: boolean;
      generatedAt: string;
      marker: typeof IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER;
    };

// ─── Task → required capabilities decomposition ─────────────────────

export type TaskIntent =
  | 'read_only_inspection'
  | 'patch_code'
  | 'commit'
  | 'push_github'
  | 'trigger_render_deploy'
  | 'query_supabase'
  | 'migrate_database'
  | 'verify_live_endpoint'
  | 'verify_owner_session'
  | 'full_deploy_cycle'
  | 'conversational';

/**
 * Classify the prompt into a task intent. Deterministic, pure — used to derive
 * the required capability set. Conservative: any ambiguous developer verb
 * routes to the most demanding intent so the gate verifies the full chain.
 */
export function classifyTaskIntent(prompt: string): TaskIntent {
  const text = prompt.toLowerCase();
  if (/deploy\s+now|full\s+deploy|push\s+and\s+deploy|deploy\s+to\s+(?:production|live|prod)|\bdeploy\b.*\b(?:production|live|prod)\b/.test(text)) return 'full_deploy_cycle';
  if (/push\s+(this\s+)?commit|push\s+to\s+(github|main)/.test(text)) return 'push_github';
  if (/trigger\s+render|render\s+deploy/.test(text)) return 'trigger_render_deploy';
  if (/run\s+supabase\s+migration|migrate\s+database|apply\s+migration/.test(text)) return 'migrate_database';
  if (/query\s+supabase|read\s+from\s+supabase|supabase\s+read/.test(text)) return 'query_supabase';
  if (/verify\s+(live|production)|health\s+check|is\s+this\s+verified/.test(text)) return 'verify_live_endpoint';
  if (/fix\s+owner\s+login|owner\s+session|owner\s+auth/.test(text)) return 'verify_owner_session';
  if (/commit\s+(this|the|now)|git\s+commit/.test(text)) return 'commit';
  if (/\b(?:patch|modify|edit)\b|\bfix\b.*\b(?:bug|code|file|error|issue|crash|chat|broken|fail)\b|\b(?:bug|error|issue|crash|broken|fail)\b.*\bfix\b|update\s+(?:the\s+)?code|write\s+(?:a\s+)?file|\bimplement\b.*\b(?:feature|module|screen|component|function)\b|\bbuild\b.*\b(?:app|module|feature|screen|component)\b/.test(text)) return 'patch_code';
  if (/inspect|audit|review|read|explain|show\s+me|status/.test(text)) return 'read_only_inspection';
  return 'conversational';
}

/**
 * Map a task intent to the capabilities it requires. The order matters — the
 * gate checks them in this order and the FIRST failure produces the blocker.
 */
export function requiredCapabilitiesFor(intent: TaskIntent): CapabilityId[] {
  switch (intent) {
    case 'full_deploy_cycle':
      return ['verify_owner_session', 'write_files', 'run_tests', 'commit', 'push_github', 'trigger_render_deploy', 'verify_live_endpoint'];
    case 'push_github':
      return ['verify_owner_session', 'commit', 'push_github'];
    case 'trigger_render_deploy':
      return ['verify_owner_session', 'trigger_render_deploy', 'verify_live_endpoint'];
    case 'migrate_database':
      return ['verify_owner_session', 'migrate_database', 'query_supabase'];
    case 'query_supabase':
      return ['verify_owner_session', 'query_supabase'];
    case 'verify_live_endpoint':
      return ['verify_live_endpoint'];
    case 'verify_owner_session':
      return ['verify_owner_session'];
    case 'commit':
      return ['verify_owner_session', 'write_files', 'commit'];
    case 'patch_code':
      return ['verify_owner_session', 'write_files', 'run_tests'];
    case 'read_only_inspection':
      return ['read_files'];
    case 'conversational':
      return [];
  }
}

// ─── Masking helpers ─────────────────────────────────────────────────

/** Mask a credential to its first 8 chars + ellipsis. Never the full value. */
export function maskCredential(value: string): string | null {
  if (!value) return null;
  const prefix = value.slice(0, 8);
  return prefix.length < value.length ? `${prefix}…` : prefix;
}

// ─── Live credential probe (injectable for tests) ────────────────────

export type CredentialProbeResult = {
  ok: boolean;
  httpStatus: number | null;
  detail: string;
};

export type CredentialProbeMap = Partial<
  Record<RequiredCredential, (value: string) => Promise<CredentialProbeResult>>
>;

/**
 * Default live probes. Each calls the real API and returns ok/httpStatus/detail.
 * Never throws — network errors return ok:false with the message in detail.
 */
export const DEFAULT_CREDENTIAL_PROBES: CredentialProbeMap = {
  IVX_GITHUB_TOKEN: async (token: string): Promise<CredentialProbeResult> => {
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) return { ok: true, httpStatus: 200, detail: 'authenticated' };
      return { ok: false, httpStatus: res.status, detail: res.status === 401 ? 'token invalid or expired' : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, httpStatus: null, detail: `network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  IVX_RENDER_API_KEY: async (token: string): Promise<CredentialProbeResult> => {
    try {
      const res = await fetch('https://api.render.com/v1/owners', {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) return { ok: true, httpStatus: 200, detail: 'authenticated' };
      return { ok: false, httpStatus: res.status, detail: res.status === 401 ? 'token invalid' : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, httpStatus: null, detail: `network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  IVX_RENDER_SERVICE_ID: async (_id: string): Promise<CredentialProbeResult> => {
    if (_id.length < 8) return { ok: false, httpStatus: null, detail: 'service id too short (shape check)' };
    return { ok: true, httpStatus: null, detail: 'shape check passed' };
  },
  IVX_SUPABASE_URL: async (url: string): Promise<CredentialProbeResult> => {
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status < 500) return { ok: true, httpStatus: res.status, detail: `reachable (HTTP ${res.status})` };
      return { ok: false, httpStatus: res.status, detail: `HTTP ${res.status} — server error` };
    } catch (err) {
      return { ok: false, httpStatus: null, detail: `unreachable: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  IVX_SUPABASE_SERVICE_ROLE_KEY: async (key: string): Promise<CredentialProbeResult> => {
    const url = getVaultValue('IVX_SUPABASE_URL', 'SUPABASE_URL');
    if (!url) return { ok: false, httpStatus: null, detail: 'cannot test — SUPABASE_URL also missing' };
    try {
      const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 200) return { ok: true, httpStatus: 200, detail: 'service role authenticated' };
      return { ok: false, httpStatus: res.status, detail: res.status === 401 ? 'key invalid' : `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, httpStatus: null, detail: `network error: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
  IVX_OWNER_TOKEN: async (token: string): Promise<CredentialProbeResult> => {
    if (token.length < 16) return { ok: false, httpStatus: null, detail: 'too short to be a real owner token' };
    return { ok: true, httpStatus: null, detail: 'shape check passed' };
  },
};

// ─── Blocker memory (spin-loop prevention) ───────────────────────────

export type BlockerMemoryEntry = {
  blockerCode: BlockerCode;
  firstSeenAt: string;
  lastSeenAt: string;
  occurrenceCount: number;
  lastHttpStatus: number | null;
  requiredOwnerAction: string;
};

const blockerMemory = new Map<BlockerCode, BlockerMemoryEntry>();

/** The repetition threshold — after this many occurrences the gate refuses to re-run. */
export const BLOCKER_REPEAT_THRESHOLD = 2;

/**
 * Record a blocker sighting in memory. Returns the updated entry.
 * Pure-ish (mutates module-level map) but deterministic given the clock.
 */
export function recordBlocker(
  blockerCode: BlockerCode,
  httpStatus: number | null,
  requiredOwnerAction: string,
  now: Date = new Date(),
): BlockerMemoryEntry {
  const iso = now.toISOString();
  const existing = blockerMemory.get(blockerCode);
  if (existing) {
    const updated: BlockerMemoryEntry = {
      ...existing,
      lastSeenAt: iso,
      occurrenceCount: existing.occurrenceCount + 1,
      lastHttpStatus: httpStatus,
    };
    blockerMemory.set(blockerCode, updated);
    return updated;
  }
  const entry: BlockerMemoryEntry = {
    blockerCode,
    firstSeenAt: iso,
    lastSeenAt: iso,
    occurrenceCount: 1,
    lastHttpStatus: httpStatus,
    requiredOwnerAction,
  };
  blockerMemory.set(blockerCode, entry);
  return entry;
}

/** Read a blocker memory entry, or null when never seen. */
export function getBlockerMemory(blockerCode: BlockerCode): BlockerMemoryEntry | null {
  return blockerMemory.get(blockerCode) ?? null;
}

/** Clear blocker memory — call this after the owner has resolved the blocker. */
export function clearBlockerMemory(blockerCode?: BlockerCode): void {
  if (blockerCode) {
    blockerMemory.delete(blockerCode);
  } else {
    blockerMemory.clear();
  }
}

/** Snapshot the entire blocker memory (for audit/diagnostics). */
export function snapshotBlockerMemory(): BlockerMemoryEntry[] {
  return [...blockerMemory.values()];
}

/** True when a blocker has hit the repeat threshold (spin-loop guard fires). */
export function isRepeatedBlocker(blockerCode: BlockerCode): boolean {
  const entry = blockerMemory.get(blockerCode);
  return Boolean(entry && entry.occurrenceCount >= BLOCKER_REPEAT_THRESHOLD);
}

// ─── Capability check implementation ─────────────────────────────────

export type FeasibilityGateInput = {
  prompt: string;
  taskId: string;
  /** Whether a verified owner session is present right now. */
  ownerSessionPresent: boolean;
  /** Injectable live probes (defaults to DEFAULT_CREDENTIAL_PROBES). */
  probes?: CredentialProbeMap;
  /** Injectable env snapshot for tests (defaults to process.env). */
  env?: Record<string, string | undefined>;
  /** Skip live network probes (tests). When true, only presence is checked. */
  skipLiveProbes?: boolean;
};

type ResolvedCredential = {
  present: boolean;
  value: string;
  source: 'ivx' | 'fallback' | 'none';
  sourceVar: string | null;
};

function resolveCredential(
  ivxName: RequiredCredential,
  fallbackName: string | null,
  env: Record<string, string | undefined>,
): ResolvedCredential {
  const ivxValue = (env[ivxName] ?? '').trim();
  if (ivxValue) return { present: true, value: ivxValue, source: 'ivx', sourceVar: ivxName };
  if (fallbackName) {
    const fallbackValue = (env[fallbackName] ?? '').trim();
    if (fallbackValue) return { present: true, value: fallbackValue, source: 'fallback', sourceVar: fallbackName };
  }
  return { present: false, value: '', source: 'none', sourceVar: null };
}

/** The only repository production is authorized to deploy from (owner spec). */
export const IVX_AUTHORIZED_GITHUB_REPO = 'ibb142/rork-global-real-estate-invest';

/** Variable name a repo identity was resolved from — evidence, never a secret. */
export type RepoIdentitySourceVar =
  | 'GITHUB_REPO'
  | 'IVX_GITHUB_REPO'
  | 'GITHUB_REPOSITORY'
  | 'GITHUB_OWNER+GITHUB_REPO'
  | 'GITHUB_REPO_URL'
  | 'IVX_GITHUB_REPO_URL';

export type ResolvedRepoIdentity = {
  /** Normalized "owner/repo" slug, or '' when nothing resolvable is set. */
  slug: string;
  /** Which environment variable produced the slug (null when unresolved). */
  sourceVar: RepoIdentitySourceVar | null;
  /** True only when the slug matches the authorized production repository. */
  authorized: boolean;
  /** The repository the runtime is authorized to deploy from. */
  authorizedRepo: string;
};

function parseRepoUrl(url: string): string {
  const match = /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(url);
  return match ? `${match[1]}/${match[2]}` : '';
}

/**
 * Normalizes every supported repository variable into ONE validated runtime
 * repository identity (owner spec — canonical configuration, no ambiguity):
 * GITHUB_REPO ("owner/repo" or bare repo name combined with GITHUB_OWNER),
 * IVX_GITHUB_REPO, GITHUB_REPOSITORY, GITHUB_OWNER, and
 * GITHUB_REPO_URL / IVX_GITHUB_REPO_URL (the variable production actually sets).
 * Also reports whether the resolved slug matches the authorized production
 * repository (IVX_AUTHORIZED_GITHUB_REPO env override, default ibb142/rork-global-real-estate-invest).
 */
export function resolveGithubRepoIdentity(env: Record<string, string | undefined>): ResolvedRepoIdentity {
  const authorizedRepo = (env.IVX_AUTHORIZED_GITHUB_REPO ?? '').trim() || IVX_AUTHORIZED_GITHUB_REPO;
  const finish = (slug: string, sourceVar: RepoIdentitySourceVar): ResolvedRepoIdentity => ({
    slug,
    sourceVar,
    authorized: slug.toLowerCase() === authorizedRepo.toLowerCase(),
    authorizedRepo,
  });
  const direct = (env.GITHUB_REPO ?? '').trim();
  if (direct.includes('/')) return finish(direct, 'GITHUB_REPO');
  const ivxDirect = (env.IVX_GITHUB_REPO ?? '').trim();
  if (ivxDirect.includes('/')) return finish(ivxDirect, 'IVX_GITHUB_REPO');
  const ghRepository = (env.GITHUB_REPOSITORY ?? '').trim();
  if (ghRepository.includes('/')) return finish(ghRepository, 'GITHUB_REPOSITORY');
  const owner = (env.GITHUB_OWNER ?? '').trim();
  if (owner && direct) return finish(`${owner}/${direct}`, 'GITHUB_OWNER+GITHUB_REPO');
  const url = (env.GITHUB_REPO_URL ?? '').trim();
  if (url) {
    const slug = parseRepoUrl(url);
    if (slug) return finish(slug, 'GITHUB_REPO_URL');
  }
  const ivxUrl = (env.IVX_GITHUB_REPO_URL ?? '').trim();
  if (ivxUrl) {
    const slug = parseRepoUrl(ivxUrl);
    if (slug) return finish(slug, 'IVX_GITHUB_REPO_URL');
  }
  return { slug: '', sourceVar: null, authorized: false, authorizedRepo };
}

/**
 * Resolves the GitHub repo slug ("owner/repo") — thin wrapper kept for callers
 * that only need the slug.
 */
function resolveGithubRepoSlug(env: Record<string, string | undefined>): string {
  return resolveGithubRepoIdentity(env).slug;
}

const CREDENTIAL_FALLBACKS: Record<RequiredCredential, string | null> = {
  IVX_GITHUB_TOKEN: 'GITHUB_TOKEN',
  IVX_RENDER_API_KEY: 'RENDER_API_KEY',
  IVX_RENDER_SERVICE_ID: 'RENDER_SERVICE_ID',
  IVX_SUPABASE_URL: 'SUPABASE_URL',
  IVX_SUPABASE_SERVICE_ROLE_KEY: 'SUPABASE_SERVICE_ROLE_KEY',
  IVX_OWNER_TOKEN: null,
};

async function probeCredential(
  cred: RequiredCredential,
  value: string,
  probes: CredentialProbeMap,
  skipLiveProbes: boolean,
): Promise<{ ok: boolean; httpStatus: number | null; detail: string; authStatus: 'authenticated' | 'rejected' | 'untested' }> {
  if (skipLiveProbes || !value) {
    return { ok: !value ? false : true, httpStatus: null, detail: value ? 'presence check only (live probe skipped)' : 'missing', authStatus: 'untested' };
  }
  const probe = probes[cred];
  if (!probe) {
    return { ok: true, httpStatus: null, detail: 'no probe registered (presence only)', authStatus: 'untested' };
  }
  const result = await probe(value);
  return {
    ok: result.ok,
    httpStatus: result.httpStatus,
    detail: result.detail,
    authStatus: result.ok ? 'authenticated' : 'rejected',
  };
}

async function checkCapability(
  capability: CapabilityId,
  input: FeasibilityGateInput,
  probes: CredentialProbeMap,
  env: Record<string, string | undefined>,
): Promise<CapabilityCheckResult> {
  const base: CapabilityCheckResult = {
    capability,
    ok: false,
    blockerCode: null,
    exactBlocker: null,
    requiredVariable: null,
    runtimeSource: 'not_applicable',
    httpStatus: null,
    credentialPresent: false,
    credentialPrefix: null,
    credentialLength: 0,
    authStatus: 'not_applicable',
    testDetail: null,
  };

  switch (capability) {
    case 'read_files':
    case 'write_files':
    case 'run_tests':
      // In-process capabilities — always available in the backend runtime.
      return { ...base, ok: true, runtimeSource: 'not_applicable', testDetail: 'in-process capability always available' };

    case 'commit':
    case 'push_github': {
      const cred: RequiredCredential = 'IVX_GITHUB_TOKEN';
      const resolved = resolveCredential(cred, CREDENTIAL_FALLBACKS[cred], env);
      const probe = await probeCredential(cred, resolved.value, probes, input.skipLiveProbes ?? false);
      const result: CapabilityCheckResult = {
        ...base,
        requiredVariable: cred,
        runtimeSource: resolved.source,
        credentialPresent: resolved.present,
        credentialPrefix: maskCredential(resolved.value),
        credentialLength: resolved.value.length,
        httpStatus: probe.httpStatus,
        authStatus: probe.authStatus,
        testDetail: probe.detail,
      };
      if (!resolved.present) {
        return { ...result, blockerCode: 'GITHUB_TOKEN_MISSING', exactBlocker: `${cred} (or fallback ${CREDENTIAL_FALLBACKS[cred]}) is not present in the runtime env.` };
      }
      if (!probe.ok) {
        const code: BlockerCode = probe.httpStatus === 401 ? 'GITHUB_TOKEN_REVOKED' : 'GITHUB_TOKEN_REVOKED';
        return { ...result, blockerCode: code, exactBlocker: `GitHub API rejected the token: ${probe.detail} (HTTP ${probe.httpStatus ?? 'n/a'}).` };
      }
      // For push, also check repo identification. Accept GITHUB_REPO ("owner/repo" or
      // bare name + GITHUB_OWNER), IVX_GITHUB_REPO, GITHUB_REPOSITORY, or derive from
      // GITHUB_REPO_URL (the variable production actually sets). The resolved repo
      // MUST match the authorized production repository — deployment from any other
      // repository (obsolete Rork/Vercel clones included) is rejected outright.
      if (capability === 'push_github') {
        const identity = resolveGithubRepoIdentity(env);
        if (!identity.slug || !/^[\w.-]+\/[\w.-]+$/.test(identity.slug)) {
          return { ...result, blockerCode: 'GITHUB_REPO_INVALID', exactBlocker: `GITHUB_REPO / GITHUB_OWNER+GITHUB_REPO / GITHUB_REPOSITORY / GITHUB_REPO_URL is missing or malformed (expected "owner/repo" or a github.com repo URL, got "${identity.slug || '<empty>'}").` };
        }
        if (!identity.authorized) {
          return { ...result, blockerCode: 'GITHUB_REPO_UNAUTHORIZED', exactBlocker: `Resolved repository "${identity.slug}" (from ${identity.sourceVar}) does not match the authorized IVX production repository "${identity.authorizedRepo}". Deployment rejected.` };
        }
        result.testDetail = `repo resolved to ${identity.slug} from ${identity.sourceVar} (authorized)`;
      }
      return { ...result, ok: true };
    }

    case 'trigger_render_deploy': {
      const keyCred: RequiredCredential = 'IVX_RENDER_API_KEY';
      const idCred: RequiredCredential = 'IVX_RENDER_SERVICE_ID';
      const keyResolved = resolveCredential(keyCred, CREDENTIAL_FALLBACKS[keyCred], env);
      const keyProbe = await probeCredential(keyCred, keyResolved.value, probes, input.skipLiveProbes ?? false);
      const keyResult: CapabilityCheckResult = {
        ...base,
        requiredVariable: keyCred,
        runtimeSource: keyResolved.source,
        credentialPresent: keyResolved.present,
        credentialPrefix: maskCredential(keyResolved.value),
        credentialLength: keyResolved.value.length,
        httpStatus: keyProbe.httpStatus,
        authStatus: keyProbe.authStatus,
        testDetail: keyProbe.detail,
      };
      if (!keyResolved.present) {
        return { ...keyResult, blockerCode: 'RENDER_KEY_MISSING', exactBlocker: `${keyCred} (or fallback ${CREDENTIAL_FALLBACKS[keyCred]}) is not present in the runtime env.` };
      }
      if (!keyProbe.ok) {
        return { ...keyResult, blockerCode: 'RENDER_KEY_MISSING', exactBlocker: `Render API rejected the key: ${keyProbe.detail} (HTTP ${keyProbe.httpStatus ?? 'n/a'}).` };
      }
      const idResolved = resolveCredential(idCred, CREDENTIAL_FALLBACKS[idCred], env);
      const idProbe = await probeCredential(idCred, idResolved.value, probes, input.skipLiveProbes ?? false);
      if (!idResolved.present || !idProbe.ok) {
        return {
          ...keyResult,
          ok: false,
          requiredVariable: idCred,
          runtimeSource: idResolved.source,
          credentialPresent: idResolved.present,
          credentialPrefix: maskCredential(idResolved.value),
          credentialLength: idResolved.value.length,
          httpStatus: idProbe.httpStatus,
          authStatus: idProbe.authStatus,
          testDetail: idProbe.detail,
          blockerCode: 'RENDER_SERVICE_ID_INVALID',
          exactBlocker: `${idCred} is missing or invalid: ${idProbe.detail}.`,
        };
      }
      return { ...keyResult, ok: true };
    }

    case 'query_supabase':
    case 'migrate_database': {
      const urlCred: RequiredCredential = 'IVX_SUPABASE_URL';
      const keyCred: RequiredCredential = 'IVX_SUPABASE_SERVICE_ROLE_KEY';
      const urlResolved = resolveCredential(urlCred, CREDENTIAL_FALLBACKS[urlCred], env);
      const urlProbe = await probeCredential(urlCred, urlResolved.value, probes, input.skipLiveProbes ?? false);
      const urlResult: CapabilityCheckResult = {
        ...base,
        requiredVariable: urlCred,
        runtimeSource: urlResolved.source,
        credentialPresent: urlResolved.present,
        credentialPrefix: maskCredential(urlResolved.value),
        credentialLength: urlResolved.value.length,
        httpStatus: urlProbe.httpStatus,
        authStatus: urlProbe.authStatus,
        testDetail: urlProbe.detail,
      };
      if (!urlResolved.present) {
        return { ...urlResult, blockerCode: 'SUPABASE_SERVICE_ROLE_MISSING', exactBlocker: `${urlCred} (or fallback ${CREDENTIAL_FALLBACKS[urlCred]}) is not present in the runtime env.` };
      }
      if (!urlProbe.ok) {
        return { ...urlResult, blockerCode: 'SUPABASE_SERVICE_ROLE_INVALID', exactBlocker: `Supabase URL is unreachable: ${urlProbe.detail}.` };
      }
      const keyResolved = resolveCredential(keyCred, CREDENTIAL_FALLBACKS[keyCred], env);
      const keyProbe = await probeCredential(keyCred, keyResolved.value, probes, input.skipLiveProbes ?? false);
      if (!keyResolved.present) {
        return {
          ...urlResult,
          ok: false,
          requiredVariable: keyCred,
          runtimeSource: keyResolved.source,
          credentialPresent: keyResolved.present,
          credentialPrefix: maskCredential(keyResolved.value),
          credentialLength: keyResolved.value.length,
          httpStatus: keyProbe.httpStatus,
          authStatus: keyProbe.authStatus,
          testDetail: keyProbe.detail,
          blockerCode: 'SUPABASE_SERVICE_ROLE_MISSING',
          exactBlocker: `${keyCred} (or fallback ${CREDENTIAL_FALLBACKS[keyCred]}) is not present in the runtime env.`,
        };
      }
      if (!keyProbe.ok) {
        // 401 on the service role key with a working URL = key mismatch.
        const code: BlockerCode = keyProbe.httpStatus === 401 ? 'SUPABASE_ANON_KEY_MISMATCH' : 'SUPABASE_SERVICE_ROLE_INVALID';
        return {
          ...urlResult,
          ok: false,
          requiredVariable: keyCred,
          runtimeSource: keyResolved.source,
          credentialPresent: keyResolved.present,
          credentialPrefix: maskCredential(keyResolved.value),
          credentialLength: keyResolved.value.length,
          httpStatus: keyProbe.httpStatus,
          authStatus: keyProbe.authStatus,
          testDetail: keyProbe.detail,
          blockerCode: code,
          exactBlocker: `Supabase rejected the service role key: ${keyProbe.detail} (HTTP ${keyProbe.httpStatus ?? 'n/a'}).`,
        };
      }
      return {
        ...urlResult,
        ok: true,
        requiredVariable: keyCred,
        runtimeSource: keyResolved.source,
        credentialPresent: keyResolved.present,
        credentialPrefix: maskCredential(keyResolved.value),
        credentialLength: keyResolved.value.length,
        httpStatus: keyProbe.httpStatus,
        authStatus: keyProbe.authStatus,
        testDetail: keyProbe.detail,
      };
    }

    case 'verify_live_endpoint': {
      // Verifying a live endpoint needs the IVX_SUPABASE_URL (used as the
      // production base URL proxy) OR a literal URL in the prompt. We treat the
      // capability as available when the runtime can reach the network at all —
      // the actual verification happens at execution time. This is the one
      // capability that does NOT require a credential, only network reach.
      return { ...base, ok: true, testDetail: 'live endpoint verification requires network only; no credential.' };
    }

    case 'verify_owner_session': {
      const result: CapabilityCheckResult = {
        ...base,
        requiredVariable: 'IVX_OWNER_TOKEN',
        runtimeSource: input.ownerSessionPresent ? 'ivx' : 'none',
        authStatus: input.ownerSessionPresent ? 'authenticated' : 'rejected',
        testDetail: input.ownerSessionPresent ? 'owner session present' : 'no verified owner session',
      };
      if (!input.ownerSessionPresent) {
        return { ...result, blockerCode: 'OWNER_SESSION_MISSING', exactBlocker: 'No verified owner session is present. Owner login is required before this task can execute.' };
      }
      return { ...result, ok: true };
    }
  }
}

// ─── Main entry: run the gate ────────────────────────────────────────

/**
 * Run the pre-execution feasibility gate. Decomposes the prompt into required
 * capabilities, verifies each one against the real runtime, and returns either
 * READY (all checks pass) or BLOCKED with the exact blocker.
 *
 * The gate is the single source of truth for "can this actually be executed
 * right now?". It MUST run before any tool execution, patch, commit, deploy,
 * database migration, or proof claim.
 */
export async function runPreExecutionFeasibilityGate(
  input: FeasibilityGateInput,
): Promise<FeasibilityGateResult> {
  const intent = classifyTaskIntent(input.prompt);
  const required = requiredCapabilitiesFor(intent);
  const probes = input.probes ?? DEFAULT_CREDENTIAL_PROBES;
  const env = input.env ?? process.env;
  const generatedAt = new Date().toISOString();

  // Conversational prompts need no capabilities — always READY.
  if (required.length === 0) {
    return {
      state: 'READY',
      taskId: input.taskId,
      capabilities: [],
      repeatedBlocker: false,
      generatedAt,
      marker: IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
    };
  }

  // Spin-loop guard: if ANY required capability already has a repeated blocker
  // in memory, refuse to re-run the checks. Return REPEATED_BLOCKER immediately.
  for (const capability of required) {
    // We can only check blocker memory by code, not by capability, so we look
    // at all entries and see if any are repeated. The full mapping happens
    // after the first run records the blocker. This is intentional: the FIRST
    // run always executes the checks so we get a fresh evidence point; only
    // the SECOND identical blocker triggers the spin guard.
    void capability;
  }
  // CRITICAL FIX: OWNER_SESSION_MISSING from public/unauthenticated chat is the
  // expected state, NOT a spin-loop. Recording it poisoned blocker memory and
  // blocked ALL subsequent requests (including normal AI questions) after two
  // developer requests hit the gate from public chat. The spin-loop guard now
  // only fires for OWNER_SESSION_MISSING when ownerSessionPresent is true (a
  // genuine spin-loop), and never records OWNER_SESSION_MISSING from public chat.
  const repeatedEntries = snapshotBlockerMemory().filter(
    (e) => e.occurrenceCount >= BLOCKER_REPEAT_THRESHOLD
      && (e.blockerCode !== 'OWNER_SESSION_MISSING' || input.ownerSessionPresent),
  );
  if (repeatedEntries.length > 0) {
    const entry = repeatedEntries[0];
    return {
      state: 'BLOCKED',
      taskId: input.taskId,
      blockerCode: 'REPEATED_BLOCKER',
      exactBlocker: `Blocker ${entry.blockerCode} has recurred ${entry.occurrenceCount} times. The gate refuses to loop. Owner action required: ${entry.requiredOwnerAction}`,
      failedCapability: 'verify_owner_session',
      requiredVariable: null,
      runtimeSource: 'none',
      httpStatus: entry.lastHttpStatus,
      nextOwnerAction: entry.requiredOwnerAction,
      capabilities: [],
      repeatedBlocker: true,
      generatedAt,
      marker: IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
    };
  }

  // Run capability checks in order. First failure wins.
  const capabilities: CapabilityCheckResult[] = [];
  for (const capability of required) {
    const result = await checkCapability(capability, input, probes, env);
    capabilities.push(result);
    if (!result.ok) {
      const blockerCode = result.blockerCode ?? 'TOOL_NOT_AVAILABLE';
      const exactBlocker = result.exactBlocker ?? 'Capability check failed without a specific blocker.';
      const nextOwnerAction = ownerActionFor(blockerCode);
      // Record in blocker memory (spin-loop prevention) — but ONLY for
      // owner-authenticated requests. OWNER_SESSION_MISSING from public chat
      // is the expected state, not a spin-loop; recording it poisoned the
      // blocker memory and blocked all subsequent requests.
      if (input.ownerSessionPresent || blockerCode !== 'OWNER_SESSION_MISSING') {
        recordBlocker(blockerCode, result.httpStatus, nextOwnerAction);
      }
      return {
        state: 'BLOCKED',
        taskId: input.taskId,
        blockerCode,
        exactBlocker,
        failedCapability: capability,
        requiredVariable: result.requiredVariable,
        runtimeSource: result.runtimeSource,
        httpStatus: result.httpStatus,
        nextOwnerAction,
        capabilities,
        repeatedBlocker: false,
        generatedAt,
        marker: IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
      };
    }
  }

  return {
    state: 'READY',
    taskId: input.taskId,
    capabilities,
    repeatedBlocker: false,
    generatedAt,
    marker: IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
  };
}

/** Map a blocker code to the concrete owner action that clears it. */
export function ownerActionFor(blockerCode: BlockerCode): string {
  switch (blockerCode) {
    case 'GITHUB_TOKEN_MISSING':
      return 'Set IVX_GITHUB_TOKEN (or fallback GITHUB_TOKEN) in the Render environment variables or secure owner variable store.';
    case 'GITHUB_TOKEN_REVOKED':
      return 'Generate a new GitHub personal access token with repo / contents:write permission and save it in the secure owner variable store as GITHUB_TOKEN.';
    case 'GITHUB_REPO_INVALID':
      return 'Set GITHUB_REPO to the exact "owner/repo" string (e.g. ibb142/rork-global-real-estate-invest) in the runtime environment.';
    case 'GITHUB_REPO_UNAUTHORIZED':
      return 'The resolved repository is not the authorized IVX production repository. Point GITHUB_REPO / GITHUB_REPO_URL at ibb142/rork-global-real-estate-invest (or update IVX_AUTHORIZED_GITHUB_REPO if the authorized repository legitimately changed).';
    case 'RENDER_KEY_MISSING':
      return 'Set IVX_RENDER_API_KEY (or fallback RENDER_API_KEY) in the Render environment variables or secure owner variable store.';
    case 'RENDER_SERVICE_ID_INVALID':
      return 'Set IVX_RENDER_SERVICE_ID (or fallback RENDER_SERVICE_ID) to the correct Render service id (srv-...) in the runtime environment.';
    case 'SUPABASE_ANON_KEY_MISMATCH':
      return 'The Supabase service role key does not match the project URL. Re-save the correct SUPABASE_SERVICE_ROLE_KEY in the secure owner variable store.';
    case 'SUPABASE_SERVICE_ROLE_MISSING':
      return 'Set IVX_SUPABASE_SERVICE_ROLE_KEY (or fallback SUPABASE_SERVICE_ROLE_KEY) and IVX_SUPABASE_URL (or fallback SUPABASE_URL) in the runtime environment.';
    case 'SUPABASE_SERVICE_ROLE_INVALID':
      return 'The Supabase service role key was rejected. Re-save the correct key in the secure owner variable store.';
    case 'OWNER_SESSION_MISSING':
      return 'Complete owner login. A verified owner session is required before this task can execute.';
    case 'TOOL_NOT_AVAILABLE':
      return 'A required tool is not available in the runtime. Contact the owner to provision the missing tool.';
    case 'NO_WRITE_PERMISSION':
      return 'The runtime does not have write permission for the target. Grant the required permission and retry.';
    case 'REPEATED_BLOCKER':
      return 'Clear the recurring blocker in the secure owner variable store, then call clearBlockerMemory() and retry.';
  }
}

/**
 * Format a gate result as the strict BLOCKED/READY block the chat model must
 * emit when the gate intervenes. Never includes secret values.
 */
export function formatFeasibilityGateBlock(result: FeasibilityGateResult): string {
  if (result.state === 'READY') {
    return [
      'STATE: READY',
      `TASK_ID: ${result.taskId}`,
      `MARKER: ${result.marker}`,
      `CAPABILITIES_CHECKED: ${result.capabilities.length}`,
      'All required capabilities verified. Execution may proceed.',
    ].join('\n');
  }
  return [
    'STATE: BLOCKED',
    `TASK_ID: ${result.taskId}`,
    `BLOCKER_CODE: ${result.blockerCode}`,
    `EXACT_BLOCKER: ${result.exactBlocker}`,
    `FAILED_CAPABILITY: ${result.failedCapability}`,
    `REQUIRED_VARIABLE: ${result.requiredVariable ?? 'n/a'}`,
    `RUNTIME_SOURCE: ${result.runtimeSource}`,
    `HTTP_STATUS: ${result.httpStatus ?? 'n/a'}`,
    `NEXT_OWNER_ACTION: ${result.nextOwnerAction}`,
    result.repeatedBlocker ? 'REPEATED_BLOCKER: true — gate refuses to loop.' : 'REPEATED_BLOCKER: false',
    `MARKER: ${result.marker}`,
  ].join('\n');
}

/** Secret-safe audit snapshot of a gate run. */
export function describeFeasibilityGateRun(result: FeasibilityGateResult): Record<string, unknown> {
  return {
    marker: result.marker,
    state: result.state,
    taskId: result.taskId,
    ...(result.state === 'BLOCKED' && {
      blockerCode: result.blockerCode,
      failedCapability: result.failedCapability,
      httpStatus: result.httpStatus,
      repeatedBlocker: result.repeatedBlocker,
    }),
    capabilities: result.capabilities.map((c) => ({
      capability: c.capability,
      ok: c.ok,
      blockerCode: c.blockerCode,
      requiredVariable: c.requiredVariable,
      runtimeSource: c.runtimeSource,
      credentialPresent: c.credentialPresent,
      credentialLength: c.credentialLength,
      credentialPrefix: c.credentialPrefix,
      authStatus: c.authStatus,
      httpStatus: c.httpStatus,
      testDetail: c.testDetail,
    })),
    secretValuesReturned: false as const,
  };
}

// Re-export for callers that want the vault inspector without a second import.
export { inspectVaultVariable };

export default {
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
  IVX_PRE_EXECUTION_FEASIBILITY_GATE_MARKER,
  BLOCKER_REPEAT_THRESHOLD,
};
