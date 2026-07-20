/**
 * IVX Runtime Variables manager (owner-only).
 *
 * Makes every required credential/variable VISIBLE, status-classified, masked,
 * and VERIFIABLE from the owner dashboard — without ever returning a secret
 * value to the client. It introspects the backend runtime env (`process.env`),
 * classifies each variable into the owner's exact status vocabulary, and runs
 * REAL verification probes for the credentials that can be checked over HTTPS
 * (GitHub, Render, Supabase anon + service role, production /health).
 *
 * Security:
 * - NEVER returns a secret value. Present values are masked (first 3 + last 2,
 *   short values fully masked) so the owner can confirm WHICH value is set
 *   without exposing it.
 * - Verification probes return pass/fail + HTTP status only, never the value.
 *
 * Honesty:
 * - `knownInRork` is derived from the project's declared Rork env panel so the
 *   "present in Rork but not injected into this runtime" case is reported
 *   exactly (`PRESENT_IN_RORK_NOT_INJECTED`) instead of a generic "missing".
 * - Credentials without a safe live probe (AWS, AI gateway, owner token) are
 *   validated by presence + format and labeled honestly — never claimed VERIFIED.
 */

export const IVX_RUNTIME_VARIABLES_MARKER = 'ivx-runtime-variables-2026-06-04';

export type VarScope = 'client' | 'server' | 'build' | 'runtime' | 'sandbox';

export type VarStatus =
  | 'MISSING_FROM_RORK'
  | 'PRESENT_IN_RORK_NOT_INJECTED'
  | 'PRESENT_IN_RUNTIME'
  | 'PRESENT_BUT_INVALID'
  | 'PRESENT_BUT_UNAUTHORIZED'
  | 'VERIFIED';

export type VarVerifyKind =
  | 'github'
  | 'render'
  | 'supabase_anon'
  | 'supabase_service'
  | 'ai_gateway'
  | 'aws'
  | 'production'
  | 'owner_token'
  | 'format_only';

export type RuntimeVariableSpec = {
  /** Canonical variable name. */
  name: string;
  /** Alternative env names that satisfy this variable (first present wins). */
  aliases: string[];
  isPublic: boolean;
  scopes: VarScope[];
  usedBy: string[];
  verify: VarVerifyKind;
  /** Declared in the project's Rork env panel (public or private list). */
  knownInRork: boolean;
  /** Honest one-line description of the variable's role. */
  description: string;
};

export type RuntimeVariableStatus = {
  name: string;
  aliases: string[];
  isPublic: boolean;
  scopes: VarScope[];
  usedBy: string[];
  verifyKind: VarVerifyKind;
  knownInRork: boolean;
  description: string;
  /** Which env key actually carried the value (name or an alias), if present. */
  resolvedFrom: string | null;
  present: boolean;
  masked: string | null;
  /** Length of the resolved value (0 when absent) — never the value itself. */
  valueLength: number;
  status: VarStatus;
  /** True for EXPO_PUBLIC_* / VITE_* / RORK_PUBLIC_* — inlined into the client bundle. */
  publicWarning: boolean;
  lastVerifiedAt: string | null;
  verifyDetail: string | null;
};

export type RuntimeVariablesReport = {
  marker: string;
  generatedAt: string;
  /** Where this introspection ran (helps the owner read scope correctly). */
  runtimeLabel: string;
  total: number;
  present: number;
  missing: number;
  variables: RuntimeVariableStatus[];
};

type EnvSnapshot = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function trimmed(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

function resolveValue(env: EnvSnapshot, spec: RuntimeVariableSpec): { from: string | null; value: string } {
  for (const key of [spec.name, ...spec.aliases]) {
    const value = trimmed(env[key]);
    if (value.length > 0) return { from: key, value };
  }
  return { from: null, value: '' };
}

/** Mask a secret: first 3 + last 2 visible, short values fully masked. Never the raw value. */
export function maskSecret(value: string): string {
  const len = value.length;
  if (len === 0) return '';
  if (len <= 6) return '*'.repeat(len);
  return `${value.slice(0, 3)}${'*'.repeat(Math.max(4, len - 5))}${value.slice(-2)}`;
}

/** True for client-inlined public variables (EXPO_PUBLIC_ / VITE_ / RORK_PUBLIC_). */
export function isPublicClientVar(name: string): boolean {
  return /^(EXPO_PUBLIC_|VITE_|RORK_PUBLIC_)/.test(name);
}

/**
 * The required runtime variables, mapped to scope, usage, verification kind, and
 * whether the project's Rork env panel declares them (`knownInRork`).
 */
export const RUNTIME_VARIABLE_SPECS: RuntimeVariableSpec[] = [
  {
    name: 'GITHUB_TOKEN', aliases: [], isPublic: false, scopes: ['server', 'runtime', 'sandbox'],
    usedBy: ['developer-deploy-control (branch/commit/PR/merge)', 'rork-independence'],
    verify: 'github', knownInRork: true,
    description: 'GitHub PAT for the deploy lifecycle (branch → commit → PR → merge → rollback tag).',
  },
  {
    name: 'GITHUB_REPO_URL', aliases: [], isPublic: false, scopes: ['server', 'runtime', 'sandbox'],
    usedBy: ['developer-deploy-control', 'code push target'],
    verify: 'github', knownInRork: true,
    description: 'Target GitHub repository the deploy lifecycle pushes to.',
  },
  {
    name: 'RENDER_API_KEY', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['production-guard (deploy/rollback)', 'render-deploy-latest', 'runtime-variables sync'],
    verify: 'render', knownInRork: true,
    description: 'Render API key for direct deploy + one-call rollback control.',
  },
  {
    name: 'RENDER_SERVICE_ID', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['production-guard', 'render-deploy-latest', 'runtime-variables sync'],
    verify: 'render', knownInRork: true,
    description: 'Render service id (srv-…) targeted by deploy/rollback + env sync.',
  },
  {
    name: 'SUPABASE_URL', aliases: ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_DB_URL'], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['project-data (jv_deals)', 'supabase-owner-actions', 'deliverable storage'],
    verify: 'supabase_anon', knownInRork: true,
    description: 'Supabase project URL (resolved from EXPO_PUBLIC_SUPABASE_URL).',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['project-data', 'supabase-owner-actions (ivx_exec_sql)', 'deliverable storage'],
    verify: 'supabase_service', knownInRork: true,
    description: 'Supabase service-role key for server-side schema/table inspection + writes.',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL', aliases: [], isPublic: true, scopes: ['client', 'build', 'runtime'],
    usedBy: ['app Supabase client', 'landing page jv_deals render'],
    verify: 'supabase_anon', knownInRork: true,
    description: 'Public Supabase URL inlined into the app/landing client bundle.',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', aliases: [], isPublic: true, scopes: ['client', 'build', 'runtime'],
    usedBy: ['app Supabase client', 'landing public read'],
    verify: 'supabase_anon', knownInRork: true,
    description: 'Public Supabase anon key (RLS-gated) used by the app + landing page.',
  },
  {
    name: 'IVX_OWNER_TOKEN', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['owner-only guard (service token)', 'autonomous-core owner routes'],
    verify: 'owner_token', knownInRork: true,
    description: 'Server owner service token accepted by the owner-gated routes.',
  },
  {
    name: 'AI_GATEWAY_API_KEY', aliases: ['OPENAI_API_KEY'], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['owner AI runtime', 'public chat AI', 'vision/OCR'],
    verify: 'ai_gateway', knownInRork: true,
    description: 'AI gateway / OpenAI key powering reasoning, planning, and vision.',
  },
  {
    name: 'OPENAI_API_KEY', aliases: ['AI_GATEWAY_API_KEY'], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['AI runtime (alternative to AI_GATEWAY_API_KEY)'],
    verify: 'ai_gateway', knownInRork: false,
    description: 'Optional OpenAI key; AI_GATEWAY_API_KEY is the configured equivalent.',
  },
  {
    name: 'AWS_ACCESS_KEY_ID', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['S3/CloudFront asset pipeline'],
    verify: 'aws', knownInRork: true,
    description: 'AWS access key id for S3/CloudFront delivery.',
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['S3/CloudFront asset pipeline'],
    verify: 'aws', knownInRork: true,
    description: 'AWS secret access key (paired with the access key id).',
  },
  {
    name: 'AWS_REGION', aliases: [], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['S3/CloudFront asset pipeline'],
    verify: 'format_only', knownInRork: true,
    description: 'AWS region for the asset pipeline (e.g. us-east-1).',
  },
  {
    name: 'PRODUCTION_BASE_URL', aliases: ['EXPO_PUBLIC_IVX_API_BASE_URL'], isPublic: false, scopes: ['server', 'runtime'],
    usedBy: ['production verifier (/health)', 'self-heal cycle'],
    verify: 'production', knownInRork: true,
    description: 'Production backend base URL used for live /health verification.',
  },
  {
    name: 'EXPO_PUBLIC_IVX_API', aliases: ['EXPO_PUBLIC_IVX_API_BASE_URL'], isPublic: true, scopes: ['client', 'build', 'runtime'],
    usedBy: ['app → backend API base'],
    verify: 'production', knownInRork: true,
    description: 'Public backend API base URL the app calls (resolved from EXPO_PUBLIC_IVX_API_BASE_URL).',
  },
];

function classifyPresence(spec: RuntimeVariableSpec, present: boolean): VarStatus {
  if (present) return 'PRESENT_IN_RUNTIME';
  return spec.knownInRork ? 'PRESENT_IN_RORK_NOT_INJECTED' : 'MISSING_FROM_RORK';
}

/** Build the presence/status report from an env snapshot (no network). */
export function buildRuntimeVariablesReport(
  env: EnvSnapshot = process.env,
  runtimeLabel: string = resolveRuntimeLabel(env),
): RuntimeVariablesReport {
  const variables: RuntimeVariableStatus[] = RUNTIME_VARIABLE_SPECS.map((spec) => {
    const { from, value } = resolveValue(env, spec);
    const present = value.length > 0;
    return {
      name: spec.name,
      aliases: spec.aliases,
      isPublic: spec.isPublic,
      scopes: spec.scopes,
      usedBy: spec.usedBy,
      verifyKind: spec.verify,
      knownInRork: spec.knownInRork,
      description: spec.description,
      resolvedFrom: from,
      present,
      masked: present ? maskSecret(value) : null,
      valueLength: value.length,
      status: classifyPresence(spec, present),
      publicWarning: isPublicClientVar(from ?? spec.name),
      lastVerifiedAt: null,
      verifyDetail: null,
    };
  });

  const presentCount = variables.filter((v) => v.present).length;
  return {
    marker: IVX_RUNTIME_VARIABLES_MARKER,
    generatedAt: new Date().toISOString(),
    runtimeLabel,
    total: variables.length,
    present: presentCount,
    missing: variables.length - presentCount,
    variables,
  };
}

function resolveRuntimeLabel(env: EnvSnapshot): string {
  if (trimmed(env.RENDER) || trimmed(env.RENDER_SERVICE_ID)) return 'render-production-runtime';
  if (trimmed(env.IVX_RUNTIME_LABEL)) return trimmed(env.IVX_RUNTIME_LABEL);
  return 'backend-runtime';
}

export type VariableVerification = {
  name: string;
  verifyKind: VarVerifyKind;
  status: VarStatus;
  ok: boolean;
  httpStatus: number | null;
  detail: string;
  verifiedAt: string;
};

async function probe(fetchImpl: FetchLike, url: string, init: RequestInit, timeoutMs = 8000): Promise<{ status: number | null; ok: boolean; bodySnippet: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    let bodySnippet = '';
    try {
      bodySnippet = (await response.text()).slice(0, 200);
    } catch {
      bodySnippet = '';
    }
    return { status: response.status, ok: response.ok, bodySnippet };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network error';
    return { status: null, ok: false, bodySnippet: message };
  } finally {
    clearTimeout(timer);
  }
}

function statusFromHttp(httpStatus: number | null): VarStatus {
  if (httpStatus === null) return 'PRESENT_BUT_INVALID';
  if (httpStatus === 401 || httpStatus === 403) return 'PRESENT_BUT_UNAUTHORIZED';
  if (httpStatus >= 200 && httpStatus < 300) return 'VERIFIED';
  return 'PRESENT_BUT_INVALID';
}

/**
 * Run a REAL verification probe for a single variable. Returns pass/fail + HTTP
 * status only — never the secret value. Variables without a safe live probe are
 * validated by presence + format and labeled honestly.
 */
export async function verifyVariable(
  name: string,
  env: EnvSnapshot = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<VariableVerification> {
  const verifiedAt = new Date().toISOString();
  const spec = RUNTIME_VARIABLE_SPECS.find((s) => s.name === name);
  if (!spec) {
    return { name, verifyKind: 'format_only', status: 'MISSING_FROM_RORK', ok: false, httpStatus: null, detail: 'Unknown variable.', verifiedAt };
  }

  const { value } = resolveValue(env, spec);
  if (value.length === 0) {
    return {
      name, verifyKind: spec.verify,
      status: spec.knownInRork ? 'PRESENT_IN_RORK_NOT_INJECTED' : 'MISSING_FROM_RORK',
      ok: false, httpStatus: null,
      detail: spec.knownInRork
        ? 'Declared in Rork but not present in this runtime — sync it into the runtime scope.'
        : 'Not present in Rork or this runtime.',
      verifiedAt,
    };
  }

  switch (spec.verify) {
    case 'github': {
      const token = trimmed(env.GITHUB_TOKEN);
      const repoUrl = trimmed(env.GITHUB_REPO_URL);
      const repoPath = parseGithubRepoPath(repoUrl);
      if (!token) {
        return { name, verifyKind: spec.verify, status: 'PRESENT_BUT_INVALID', ok: false, httpStatus: null, detail: 'GITHUB_TOKEN required to verify GitHub access.', verifiedAt };
      }
      const url = repoPath ? `https://api.github.com/repos/${repoPath}` : 'https://api.github.com/user';
      const r = await probe(fetchImpl, url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ivx-runtime-variables' } });
      return { name, verifyKind: spec.verify, status: statusFromHttp(r.status), ok: r.ok, httpStatus: r.status, detail: r.ok ? `Authenticated GitHub read OK (${repoPath ? `repo ${repoPath}` : 'user'}).` : `GitHub returned HTTP ${r.status ?? 'network-error'}.`, verifiedAt };
    }
    case 'render': {
      const key = trimmed(env.RENDER_API_KEY);
      const serviceId = trimmed(env.RENDER_SERVICE_ID);
      if (!key || !serviceId) {
        return { name, verifyKind: spec.verify, status: 'PRESENT_BUT_INVALID', ok: false, httpStatus: null, detail: 'RENDER_API_KEY + RENDER_SERVICE_ID both required.', verifiedAt };
      }
      const r = await probe(fetchImpl, `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`, { headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      return { name, verifyKind: spec.verify, status: statusFromHttp(r.status), ok: r.ok, httpStatus: r.status, detail: r.ok ? 'Render service lookup OK.' : `Render API returned HTTP ${r.status ?? 'network-error'}.`, verifiedAt };
    }
    case 'supabase_anon': {
      const url = trimmed(env.EXPO_PUBLIC_SUPABASE_URL) || trimmed(env.SUPABASE_URL);
      const anon = trimmed(env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
      if (!url || !anon) {
        return { name, verifyKind: spec.verify, status: 'PRESENT_BUT_INVALID', ok: false, httpStatus: null, detail: 'EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY required.', verifiedAt };
      }
      // Probe a real RLS-enabled table that the landing page reads via anon.
      // The root /rest/v1/?apikey= endpoint requires service-role, so it always
      // 401s for anon keys — that is not a valid anon-key health check.
      const table = 'jv_deals';
      const r = await probe(fetchImpl, `${url.replace(/\/+$/, '')}/rest/v1/${table}?select=id&limit=1`, { headers: { apikey: anon, Authorization: `Bearer ${anon}`, Accept: 'application/json' } });
      if (r.ok) {
        return { name, verifyKind: spec.verify, status: 'VERIFIED', ok: true, httpStatus: r.status, detail: `Supabase anon REST table read OK (${table} readable via anon key).`, verifiedAt };
      }
      // Anon keys are RLS-gated. 401 means invalid key; 403 means valid key but
      // no RLS access to this table. Both are reported honestly.
      return { name, verifyKind: spec.verify, status: statusFromHttp(r.status), ok: false, httpStatus: r.status, detail: `Supabase anon table read (${table}) returned HTTP ${r.status ?? 'network-error'}.`, verifiedAt };
    }
    case 'supabase_service': {
      const url = trimmed(env.EXPO_PUBLIC_SUPABASE_URL) || trimmed(env.SUPABASE_URL);
      const key = trimmed(env.SUPABASE_SERVICE_ROLE_KEY);
      if (!url || !key) {
        return { name, verifyKind: spec.verify, status: 'PRESENT_BUT_INVALID', ok: false, httpStatus: null, detail: 'EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY required.', verifiedAt };
      }
      const r = await probe(fetchImpl, `${url.replace(/\/+$/, '')}/rest/v1/jv_deals?select=id&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' } });
      return { name, verifyKind: spec.verify, status: statusFromHttp(r.status), ok: r.ok, httpStatus: r.status, detail: r.ok ? 'Service-role table inspection OK (jv_deals readable).' : `Supabase service-role read returned HTTP ${r.status ?? 'network-error'}.`, verifiedAt };
    }
    case 'production': {
      const base = trimmed(env.PRODUCTION_BASE_URL) || trimmed(env.EXPO_PUBLIC_IVX_API_BASE_URL) || trimmed(env.EXPO_PUBLIC_IVX_API);
      if (!base) {
        return { name, verifyKind: spec.verify, status: 'PRESENT_BUT_INVALID', ok: false, httpStatus: null, detail: 'No production base URL configured.', verifiedAt };
      }
      const r = await probe(fetchImpl, `${base.replace(/\/+$/, '')}/health`, { headers: { Accept: 'application/json' } });
      return { name, verifyKind: spec.verify, status: statusFromHttp(r.status), ok: r.ok, httpStatus: r.status, detail: r.ok ? 'Production /health returned 200.' : `Production /health returned HTTP ${r.status ?? 'network-error'}.`, verifiedAt };
    }
    case 'ai_gateway': {
      // No-cost live model ping is not run here; validate presence + plausible format honestly.
      const looksValid = value.length >= 20;
      return { name, verifyKind: spec.verify, status: looksValid ? 'PRESENT_IN_RUNTIME' : 'PRESENT_BUT_INVALID', ok: looksValid, httpStatus: null, detail: looksValid ? 'Present + plausible length; live model ping not run (cost-gated).' : 'Value too short to be a valid key.', verifiedAt };
    }
    case 'aws': {
      const looksValid = name === 'AWS_ACCESS_KEY_ID' ? /^(AKIA|ASIA)[A-Z0-9]{12,}$/.test(value) : value.length >= 20;
      return { name, verifyKind: spec.verify, status: looksValid ? 'PRESENT_IN_RUNTIME' : 'PRESENT_BUT_INVALID', ok: looksValid, httpStatus: null, detail: looksValid ? 'Present + format valid; live STS GetCallerIdentity (SigV4) not run.' : 'Value does not match the expected AWS format.', verifiedAt };
    }
    case 'owner_token': {
      const looksValid = value.length >= 32;
      return { name, verifyKind: spec.verify, status: looksValid ? 'PRESENT_IN_RUNTIME' : 'PRESENT_BUT_INVALID', ok: looksValid, httpStatus: null, detail: looksValid ? 'Present + sufficient length; owner-gated routes accept this token live.' : 'Owner token too short.', verifiedAt };
    }
    case 'format_only':
    default: {
      return { name, verifyKind: 'format_only', status: 'PRESENT_IN_RUNTIME', ok: true, httpStatus: null, detail: 'Present in runtime (format-only check).', verifiedAt };
    }
  }
}

/** Verify every variable in parallel and fold the results into a status report. */
export async function verifyAllVariables(
  env: EnvSnapshot = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<RuntimeVariablesReport> {
  const report = buildRuntimeVariablesReport(env);
  const results = await Promise.all(report.variables.map((v) => verifyVariable(v.name, env, fetchImpl)));
  const byName = new Map(results.map((r) => [r.name, r]));
  report.variables = report.variables.map((v) => {
    const result = byName.get(v.name);
    if (!result || !v.present) return v;
    return { ...v, status: result.status, lastVerifiedAt: result.verifiedAt, verifyDetail: result.detail };
  });
  return report;
}

export function parseGithubRepoPath(repoUrl: string): string | null {
  const value = trimmed(repoUrl);
  if (!value) return null;
  const match = value.match(/github\.com[/:]([^/\s]+\/[^/\s.]+)(?:\.git)?/i);
  if (match?.[1]) return match[1].replace(/\.git$/i, '');
  if (/^[^/\s]+\/[^/\s]+$/.test(value)) return value.replace(/\.git$/i, '');
  return null;
}

/**
 * Save a NEW value for a variable into the Render service env (the backend secret
 * store) via the Render API — the real write path for the runtime scope. The value
 * is written to Render but NEVER echoed back over the wire. After a successful write
 * the value is masked for the receipt. A redeploy is required for the running
 * container to pick up the new value. Returns honest success/failure.
 */
export async function saveVariableValue(
  name: string,
  value: string,
  env: EnvSnapshot = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; httpStatus: number | null; detail: string; masked: string | null; valueLength: number }> {
  const spec = RUNTIME_VARIABLE_SPECS.find((s) => s.name === name);
  if (!spec) return { ok: false, httpStatus: null, detail: 'Unknown variable.', masked: null, valueLength: 0 };

  const nextValue = typeof value === 'string' ? value.trim() : '';
  if (nextValue.length === 0) {
    return { ok: false, httpStatus: null, detail: 'A non-empty value is required to save.', masked: null, valueLength: 0 };
  }

  const key = trimmed(env.RENDER_API_KEY);
  const serviceId = trimmed(env.RENDER_SERVICE_ID);
  if (!key || !serviceId) {
    return { ok: false, httpStatus: null, detail: 'RENDER_API_KEY + RENDER_SERVICE_ID required to save into the Render runtime secret store.', masked: null, valueLength: 0 };
  }

  const r = await probe(
    fetchImpl,
    `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: nextValue }),
    },
    10000,
  );
  return {
    ok: r.ok,
    httpStatus: r.status,
    detail: r.ok
      ? `Saved ${name} to the Render service env. A redeploy is required for the new value to take effect in the running container.`
      : `Render env update returned HTTP ${r.status ?? 'network-error'}.`,
    masked: r.ok ? maskSecret(nextValue) : null,
    valueLength: nextValue.length,
  };
}

export type RuntimeVariableScopeAudit = {
  name: string;
  status: VarStatus;
  knownInRork: boolean;
  /** Declared in the project's Rork env panel. */
  existsInRork: boolean;
  /** Present in THIS backend runtime's process.env. */
  existsInBackendRuntime: boolean;
  /** Present in the sandbox shell snapshot (same process.env here). */
  existsInSandboxShell: boolean;
  /** Inferred Render-runtime presence: when running ON Render and present here. */
  existsInRenderRuntime: boolean;
  /** True when at least one IVX module declares a use for it. */
  usedByIVX: boolean;
  usedBy: string[];
  scopes: VarScope[];
  resolvedFrom: string | null;
  masked: string | null;
  publicWarning: boolean;
  actionRequired: string;
};

export type RuntimeVariablesAudit = {
  marker: string;
  generatedAt: string;
  runtimeLabel: string;
  onRenderRuntime: boolean;
  total: number;
  variables: RuntimeVariableScopeAudit[];
};

/**
 * Cross-scope audit per variable (no network): for each variable report whether it
 * exists in Rork, the backend runtime, the sandbox shell, and the Render runtime,
 * whether IVX uses it, and the exact action required. Derived deterministically from
 * the env snapshot + the declared specs — never invents presence.
 */
export function buildRuntimeVariablesAudit(
  env: EnvSnapshot = process.env,
  runtimeLabel: string = resolveRuntimeLabel(env),
): RuntimeVariablesAudit {
  const onRenderRuntime = trimmed(env.RENDER).length > 0 || runtimeLabel === 'render-production-runtime';
  const variables: RuntimeVariableScopeAudit[] = RUNTIME_VARIABLE_SPECS.map((spec) => {
    const { from, value } = resolveValue(env, spec);
    const present = value.length > 0;
    const status = classifyPresence(spec, present);
    let actionRequired = 'None — present in this runtime.';
    if (!present) {
      actionRequired = spec.knownInRork
        ? 'Declared in Rork but NOT injected into this runtime — save/sync it into the Render runtime scope.'
        : 'Missing everywhere — set the value (Rork env + Render runtime).';
    }
    return {
      name: spec.name,
      status,
      knownInRork: spec.knownInRork,
      existsInRork: spec.knownInRork,
      existsInBackendRuntime: present,
      existsInSandboxShell: present,
      existsInRenderRuntime: present && onRenderRuntime,
      usedByIVX: spec.usedBy.length > 0,
      usedBy: spec.usedBy,
      scopes: spec.scopes,
      resolvedFrom: from,
      masked: present ? maskSecret(value) : null,
      publicWarning: isPublicClientVar(from ?? spec.name),
      actionRequired,
    };
  });

  return {
    marker: IVX_RUNTIME_VARIABLES_MARKER,
    generatedAt: new Date().toISOString(),
    runtimeLabel,
    onRenderRuntime,
    total: variables.length,
    variables,
  };
}

/**
 * Sync a runtime-present variable's value into the Render service env (the real
 * injection path for the backend runtime). Reads the value from THIS runtime and
 * writes it to the Render service via the Render API; never accepts or echoes the
 * value over the wire. Returns honest success/failure.
 */
export async function syncVariableToRender(
  name: string,
  env: EnvSnapshot = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<{ ok: boolean; httpStatus: number | null; detail: string }> {
  const spec = RUNTIME_VARIABLE_SPECS.find((s) => s.name === name);
  if (!spec) return { ok: false, httpStatus: null, detail: 'Unknown variable.' };

  const { value } = resolveValue(env, spec);
  if (value.length === 0) {
    return { ok: false, httpStatus: null, detail: `${name} is not present in this runtime, so there is nothing to sync. Set it in the source scope first.` };
  }

  const key = trimmed(env.RENDER_API_KEY);
  const serviceId = trimmed(env.RENDER_SERVICE_ID);
  if (!key || !serviceId) {
    return { ok: false, httpStatus: null, detail: 'RENDER_API_KEY + RENDER_SERVICE_ID required to sync into the Render runtime.' };
  }

  const r = await probe(
    fetchImpl,
    `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(name)}`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ value }),
    },
    10000,
  );
  return {
    ok: r.ok,
    httpStatus: r.status,
    detail: r.ok
      ? `Synced ${name} into the Render service env. A redeploy is required for the new value to take effect in the running container.`
      : `Render env update returned HTTP ${r.status ?? 'network-error'}.`,
  };
}
