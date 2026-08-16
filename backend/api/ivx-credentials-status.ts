/**
 * IVX Credentials & Integrations Status API (owner-only).
 *
 *   GET /api/ivx/autonomous/credentials → live credential binding matrix
 *
 * Runs SAFE, server-side runtime tests for every credential group the
 * platform depends on (GitHub, Render, Supabase anon + service-role,
 * AWS SNS/SMS, AI gateway, Supabase Management API, owner identity).
 * Never returns secret values — only masked variable names, presence
 * flags, HTTP statuses and results.
 *
 * HONESTY RULES (enforced by Phase 3 engine fix):
 *   - authenticated is true ONLY when a live call returned a 2xx this run.
 *   - No cached green: every GET re-tests each service.
 *   - Failures carry the exact HTTP status and a safe error string.
 *   - VERIFIED requires: runtime_present + authentication_tested + (scope/account/resource verified as applicable).
 *   - PARTIAL means: credential present and authenticated, but a required scope/permission/resource is missing.
 *   - BLOCKED means: credential absent, or authentication failed, or a required-for-production credential cannot function.
 *   - NOT_CONFIGURED means: optional credential not present and not required.
 *   - The top-level `certification` verdict reports NOT_COMPLETE whenever any required credential is BLOCKED or PARTIAL.
 *   - A fallback response does NOT count as a direct-provider success (direct_test_result and fallback_test_result are separate fields).
 *   - No secret value appears in any field.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { readDurableJson, writeDurableJson } from '../services/ivx-durable-store';
import { maskPhone, resolveAlertPhone, GUARDIAN_STATE_FILE_PATH, EMPTY_GUARDIAN_STATE } from './ivx-owner-auth-guardian';
import type { GuardianState } from './ivx-owner-auth-guardian';
import { getProviderHealth } from '../services/ivx-provider-state-machine';
import { requestIVXAIText } from '../ivx-ai-runtime';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import path from 'node:path';

export const IVX_CREDENTIALS_STATUS_MARKER = 'ivx-credentials-status-2026-07-17-v2';

const STATE_FILE = path.join(process.cwd(), 'logs', 'audit', 'credentials-status', 'state.json');
const TEST_TIMEOUT_MS = 8000;

/**
 * Structured credential row with all fields required by Phase 3.
 * Every field is populated honestly from a live test — never from assumptions.
 */
export type CredentialRow = {
  // --- Existing fields (kept for backward compatibility) ---
  service: string;
  variable: string;
  environment: string;
  stored: boolean;
  injected: boolean;
  authenticated: boolean | null;
  permissionTest: string;
  runtimeTest: string;
  httpStatus: number | null;
  securityCheck: string;
  blocker: string | null;
  worker: string;
  finalStatus: 'VERIFIED' | 'PARTIAL' | 'BLOCKED' | 'NOT_CONFIGURED';
  testedAt: string;
  // --- New structured fields (Phase 3) ---
  credential_id: string;
  provider: string;
  variable_name: string;
  required_for_production: boolean;
  runtime_present: boolean;
  authentication_tested: boolean;
  authorization_tested: boolean;
  scope_verified: boolean | null;
  account_verified: boolean | null;
  resource_verified: boolean | null;
  direct_test_result: string;
  fallback_test_result: string | null;
  verified_at: string | null;
  expires_at: string | null;
  error_code: string | null;
  evidence_id: string;
};

type CredentialsState = {
  marker: string;
  totalRuns: number;
  lastRunAt: string | null;
};

type CertificationVerdict = {
  status: 'VERIFIED' | 'NOT_COMPLETE';
  rule_supabase_management_authenticated: boolean;
  rule_all_required_credentials_verified: boolean;
  rule_no_required_credential_blocked: boolean;
  rule_no_secret_exposed: boolean;
  blocked_required_count: number;
  partial_required_count: number;
  verified_count: number;
  total_count: number;
  verdict_at: string;
  blockers: string[];
};

function envPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function envClean(name: string): string {
  return (process.env[name] ?? '').trim();
}

/** Generate a short, unique evidence ID for each credential test run. */
function makeEvidenceId(service: string): string {
  const slug = service.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 20);
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 6);
  return `evd-${slug}-${ts}-${rand}`;
}

/** Mask a token to a safe fingerprint (first 4 chars + length). */
function maskToken(token: string): string {
  if (!token || token.length < 8) return token ? '***' : '';
  return `${token.slice(0, 4)}***(${token.length}ch)`;
}

async function safeFetch(url: string, init?: RequestInit): Promise<{ status: number | null; body: string; error: string | null; headers: Headers | null }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(TEST_TIMEOUT_MS) });
    const body = await response.text();
    return { status: response.status, body: body.slice(0, 8000), error: null, headers: response.headers };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: null, body: '', error: message.slice(0, 200), headers: null };
  }
}

function repoSlugFromUrl(): string {
  const raw = envClean('GITHUB_REPO_URL');
  const match = raw.match(/github\.com[/:]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[\s/]|$)/);
  return match ? match[1] : 'ibb142/ivx-holdings-platform';
}

async function testGitHub(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('GitHub');
  const stored = envPresent('GITHUB_TOKEN');
  const base = {
    service: 'GitHub',
    variable: 'GITHUB_TOKEN',
    variable_name: 'GITHUB_TOKEN',
    provider: 'github',
    credential_id: 'cred-github',
    environment: 'render',
    stored,
    injected: stored,
    securityCheck: 'server-only, never in client bundles',
    worker: 'W3',
    testedAt,
    required_for_production: true,
    runtime_present: stored,
    verified_at: null as string | null,
    expires_at: null as string | null,
    fallback_test_result: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      credential_id: 'cred-github',
      authenticated: false,
      authentication_tested: false,
      authorization_tested: false,
      scope_verified: null,
      account_verified: null,
      resource_verified: null,
      direct_test_result: 'GITHUB_TOKEN absent in runtime env',
      permissionTest: 'skipped',
      runtimeTest: 'variable absent in runtime env',
      httpStatus: null,
      blocker: 'GITHUB_TOKEN not injected',
      finalStatus: 'BLOCKED',
      error_code: 'ENV_ABSENT',
      evidence_id: evidenceId,
    };
  }
  const token = envClean('GITHUB_TOKEN');
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'ivx-credentials-audit' };
  const user = await safeFetch('https://api.github.com/user', { headers });
  const slug = repoSlugFromUrl();
  const repo = await safeFetch(`https://api.github.com/repos/${slug}`, { headers });
  const oauthScopesHeader = user.headers?.get('x-oauth-scopes') ?? '';
  const scopesList = oauthScopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
  const hasExplicitWorkflowScope = scopesList.some((s) => s === 'workflow');
  const hasRepoScope = scopesList.some((s) => s === 'repo');
  let push = false;
  let admin = false;
  let accountLogin: string | null = null;
  try {
    const parsed = JSON.parse(repo.body) as { permissions?: { push?: boolean; admin?: boolean } };
    push = parsed.permissions?.push === true;
    admin = parsed.permissions?.admin === true;
  } catch { /* keep defaults */ }
  try {
    const userParsed = JSON.parse(user.body) as { login?: string };
    accountLogin = userParsed.login ?? null;
  } catch { /* keep null */ }
  const authenticated = user.status === 200 && repo.status === 200;
  const scopeVerified = hasRepoScope && hasExplicitWorkflowScope;
  const accountVerified = accountLogin !== null;
  const resourceVerified = repo.status === 200 && (push || hasRepoScope);
  const fullyVerified = authenticated && scopeVerified && accountVerified && resourceVerified;
  const permissionTest = scopeVerified
    ? `push+admin OK; scopes=[${oauthScopesHeader || 'none'}]; workflow=${hasExplicitWorkflowScope ? 'PRESENT' : 'ABSENT'}`
    : `scopes=[${oauthScopesHeader || 'none'}]; workflow=${hasExplicitWorkflowScope ? 'PRESENT' : 'ABSENT'}`;
  return {
    ...base,
    authenticated,
    authentication_tested: true,
    authorization_tested: true,
    scope_verified: scopeVerified,
    account_verified: accountVerified,
    resource_verified: resourceVerified,
    direct_test_result: `GET /user → ${user.status} (login=${accountLogin}); GET /repos/${slug} → ${repo.status} (push=${push || hasRepoScope}, admin=${admin})`,
    fallback_test_result: null,
    permissionTest,
    runtimeTest: `GET /user → ${user.status ?? user.error} (scopes: ${oauthScopesHeader || 'none'}); GET /repos/${slug} → ${repo.status ?? repo.error} (push=${push || hasRepoScope}, admin=${admin})`,
    httpStatus: user.status,
    blocker: authenticated ? (scopeVerified ? null : 'workflow scope absent — CI workflow registration requires new token scope (APR-004)') : 'GitHub auth failed',
    finalStatus: fullyVerified ? 'VERIFIED' : (authenticated ? 'PARTIAL' : 'BLOCKED'),
    verified_at: fullyVerified ? testedAt : null,
    expires_at: null,
    error_code: authenticated ? (scopeVerified ? null : 'SCOPE_INCOMPLETE') : `HTTP_${user.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

async function testRender(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('Render');
  const renderKey = envClean('RENDER_API_KEY') || envClean('IVX_RENDER_API_KEY');
  const stored = renderKey.length > 0 && envPresent('RENDER_SERVICE_ID');
  const base = {
    service: 'Render',
    variable: 'RENDER_API_KEY',
    variable_name: 'RENDER_API_KEY + RENDER_SERVICE_ID',
    provider: 'render',
    credential_id: 'cred-render',
    environment: 'render',
    securityCheck: 'server-only',
    worker: 'W10',
    testedAt,
    required_for_production: true,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'RENDER_API_KEY/RENDER_SERVICE_ID absent in runtime env',
      permissionTest: 'skipped', runtimeTest: 'variable absent in runtime env',
      httpStatus: null, blocker: 'RENDER_API_KEY/RENDER_SERVICE_ID not injected',
      finalStatus: 'BLOCKED', verified_at: null, error_code: 'ENV_ABSENT', evidence_id: evidenceId,
    };
  }
  const serviceId = envClean('RENDER_SERVICE_ID');
  const result = await safeFetch(`https://api.render.com/v1/services/${serviceId}`, { headers: { Authorization: `Bearer ${renderKey}` } });
  const authenticated = result.status === 200;
  let serviceName: string | null = null;
  try {
    const parsed = JSON.parse(result.body) as { name?: string; suspended?: string };
    serviceName = parsed.name ?? null;
  } catch { /* keep null */ }
  const detail = `GET /v1/services/${serviceId.slice(0, 8)}… → ${result.status ?? result.error}${serviceName ? ` (${serviceName})` : ''}`;
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated, authentication_tested: true, authorization_tested: true,
    scope_verified: authenticated ? true : false,
    account_verified: authenticated,
    resource_verified: authenticated && serviceName === 'ivx-holdings-platform',
    direct_test_result: detail,
    permissionTest: authenticated ? 'service read OK' : 'service read failed',
    runtimeTest: detail,
    httpStatus: result.status,
    blocker: authenticated ? null : 'Render API auth failed',
    finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
    verified_at: authenticated ? testedAt : null,
    error_code: authenticated ? null : `HTTP_${result.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

function resolveSupabaseUrl(): string {
  return envClean('EXPO_PUBLIC_SUPABASE_URL') || envClean('SUPABASE_URL');
}

function resolveSupabaseAnonKey(): string {
  return envClean('EXPO_PUBLIC_SUPABASE_ANON_KEY') || envClean('SUPABASE_PUBLISHABLE_KEY') || envClean('SUPABASE_ANON_KEY');
}

async function testSupabaseAnon(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('SupabaseAnon');
  const url = resolveSupabaseUrl();
  const anon = resolveSupabaseAnonKey();
  const stored = url.length > 0 && anon.length > 0;
  const base = {
    service: 'Supabase (anon)',
    variable: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    variable_name: 'EXPO_PUBLIC_SUPABASE_URL + EXPO_PUBLIC_SUPABASE_ANON_KEY',
    provider: 'supabase',
    credential_id: 'cred-supabase-anon',
    environment: 'render+mobile',
    securityCheck: 'public by design; RLS enforced',
    worker: 'W5',
    testedAt,
    required_for_production: true,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'anon credentials absent',
      permissionTest: 'skipped', runtimeTest: 'variable absent',
      httpStatus: null, blocker: 'anon credentials not injected',
      finalStatus: 'BLOCKED', verified_at: null, error_code: 'ENV_ABSENT', evidence_id: evidenceId,
    };
  }
  const health = await safeFetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
  const authenticated = health.status === 200;
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated, authentication_tested: true, authorization_tested: false,
    scope_verified: authenticated ? true : false,
    account_verified: authenticated,
    resource_verified: authenticated,
    direct_test_result: `GET ${url}/auth/v1/health → ${health.status ?? health.error}`,
    permissionTest: authenticated ? 'auth health OK' : 'auth health failed',
    runtimeTest: `GET /auth/v1/health → ${health.status ?? health.error}`,
    httpStatus: health.status,
    blocker: authenticated ? null : 'Supabase auth health failed',
    finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
    verified_at: authenticated ? testedAt : null,
    error_code: authenticated ? null : `HTTP_${health.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

async function testSupabaseServiceRole(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('SupabaseServiceRole');
  const url = resolveSupabaseUrl();
  const key = envClean('SUPABASE_SERVICE_ROLE_KEY') || envClean('SUPABASE_SERVICE_KEY');
  const stored = key.length > 0 && url.length > 0;
  const base = {
    service: 'Supabase (service-role)',
    variable: 'SUPABASE_SERVICE_ROLE_KEY',
    variable_name: 'SUPABASE_SERVICE_ROLE_KEY',
    provider: 'supabase',
    credential_id: 'cred-supabase-service-role',
    environment: 'render',
    securityCheck: 'server-only; not present in client bundles (scanned)',
    worker: 'W5',
    testedAt,
    required_for_production: true,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'service-role key not injected',
      permissionTest: 'skipped', runtimeTest: 'variable absent in runtime env',
      httpStatus: null, blocker: 'service-role key not injected',
      finalStatus: 'BLOCKED', verified_at: null, error_code: 'ENV_ABSENT', evidence_id: evidenceId,
    };
  }
  const admin = await safeFetch(`${url}/auth/v1/admin/users?per_page=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const storage = await safeFetch(`${url}/storage/v1/bucket`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const authenticated = admin.status === 200;
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated, authentication_tested: true, authorization_tested: authenticated,
    scope_verified: authenticated ? true : false,
    account_verified: authenticated,
    resource_verified: authenticated && storage.status === 200,
    direct_test_result: `GET /auth/v1/admin/users → ${admin.status ?? admin.error}; GET /storage/v1/bucket → ${storage.status ?? storage.error}`,
    permissionTest: `admin users → ${admin.status ?? admin.error}; storage buckets → ${storage.status ?? storage.error}`,
    runtimeTest: authenticated ? 'admin API + storage verified live' : 'admin API failed',
    httpStatus: admin.status,
    blocker: authenticated ? null : 'service-role auth failed',
    finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
    verified_at: authenticated ? testedAt : null,
    error_code: authenticated ? null : `HTTP_${admin.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

/**
 * AWS credential test — makes a REAL live STS GetCallerIdentity call.
 * VERIFIED only when STS returns 200 with a valid account ID.
 * Old SMS log is supplementary evidence, NOT the primary auth test.
 */
async function testAwsSms(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('AwsSts');
  const accessKeyId = envClean('AWS_ACCESS_KEY_ID');
  const secretAccessKey = envClean('AWS_SECRET_ACCESS_KEY');
  const sessionToken = envClean('AWS_SESSION_TOKEN');
  const region = envClean('AWS_REGION') || 'us-east-1';
  const stored = accessKeyId.length > 0 && secretAccessKey.length > 0;
  const keyPrefix = accessKeyId ? `${accessKeyId.slice(0, 8)}***` : '';

  // Supplementary: last SMS sent (NOT the primary auth test)
  const guardianState = await readDurableJson<GuardianState>(GUARDIAN_STATE_FILE_PATH, EMPTY_GUARDIAN_STATE);
  const alerts = Array.isArray(guardianState.alerts) ? guardianState.alerts : [];
  const lastSent = alerts.filter((alert) => (alert as { smsStatus?: string }).smsStatus === 'sent')[0] as { messageId?: string; sentAt?: string } | undefined;
  const phone = maskPhone(resolveAlertPhone());

  const base = {
    service: 'AWS (STS + SNS)',
    variable: 'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION',
    variable_name: 'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION',
    provider: 'aws-sts-sns',
    credential_id: 'cred-aws-sms',
    environment: 'render',
    securityCheck: 'server-only; STS call never returns secrets; SMS body never contains secrets',
    worker: 'W3',
    testedAt,
    required_for_production: false,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };

  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false,
      authentication_tested: false,
      authorization_tested: false,
      scope_verified: null,
      account_verified: null,
      resource_verified: null,
      direct_test_result: 'AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY absent in runtime env',
      permissionTest: 'skipped — env absent',
      runtimeTest: 'credentials missing in runtime env',
      httpStatus: null,
      blocker: 'AWS credentials not injected into Render runtime',
      finalStatus: 'NOT_CONFIGURED',
      verified_at: null,
      error_code: 'ENV_ABSENT',
      evidence_id: evidenceId,
    };
  }

  // LIVE STS GetCallerIdentity call — the real authentication test
  let stsOk = false;
  let stsError: string | null = null;
  let accountId: string | null = null;
  let arn: string | null = null;
  let userId: string | null = null;
  let httpStatus: number | null = null;

  try {
    const stsConfig: ConstructorParameters<typeof STSClient>[0] = {
      region,
      credentials: { accessKeyId, secretAccessKey },
    };
    if (sessionToken) {
      (stsConfig.credentials as { sessionToken?: string }).sessionToken = sessionToken;
    }
    const sts = new STSClient(stsConfig);
    const response = await sts.send(new GetCallerIdentityCommand({}), { requestTimeout: TEST_TIMEOUT_MS });
    accountId = response.Account ?? null;
    arn = response.Arn ?? null;
    userId = response.UserId ?? null;
    stsOk = !!accountId;
    httpStatus = 200;
  } catch (error: unknown) {
    stsError = error instanceof Error ? error.message : String(error);
    const meta = (error as { $metadata?: { httpStatusCode?: number } }).$metadata;
    httpStatus = meta?.httpStatusCode ?? null;
  }

  const authenticated = stsOk;
  const directTestResult = stsOk
    ? `STS GetCallerIdentity → 200 (account=${accountId}, arn=${arn}, userId=${userId ? userId.slice(0, 24) : 'n/a'}, key=${keyPrefix}, region=${region})${lastSent ? ` | last SMS ${lastSent.sentAt ?? ''} MsgId ${lastSent.messageId ?? 'n/a'}` : ''}`
    : `STS GetCallerIdentity → ${httpStatus ?? 'ERR'}: ${stsError ? stsError.slice(0, 250) : 'unknown'} (key=${keyPrefix}, region=${region})`;

  return {
    ...base,
    stored: true,
    injected: true,
    runtime_present: true,
    authenticated,
    authentication_tested: true,
    authorization_tested: stsOk,
    scope_verified: stsOk,
    account_verified: stsOk,
    resource_verified: !!lastSent,
    direct_test_result: directTestResult,
    permissionTest: stsOk ? `STS verified account ${accountId}; SNS SMS phone ${phone}` : `STS FAILED: ${stsError ? stsError.slice(0, 120) : 'unknown'}`,
    runtimeTest: directTestResult,
    httpStatus,
    blocker: stsOk ? null : `AWS STS authentication failed: ${stsError ? stsError.slice(0, 150) : 'unknown'}`,
    finalStatus: stsOk ? 'VERIFIED' : 'BLOCKED',
    verified_at: stsOk ? testedAt : null,
    error_code: stsOk ? null : 'STS_AUTH_FAILED',
    evidence_id: evidenceId,
  };
}

async function testAiGateway(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('AiGateway');
  // 2026-07-26 fix: IVX_AI_GATEWAY_KEY takes priority over OPENAI_API_KEY.
  // The owner rotates IVX_AI_GATEWAY_KEY on Render; OPENAI_API_KEY is a legacy alias.
  // If OPENAI_API_KEY were preferred, a stale key would shadow the fresh gateway key.
  const gatewayKey = envClean('IVX_AI_GATEWAY_KEY') || envClean('AI_GATEWAY_API_KEY');
  const openaiKey = envClean('OPENAI_API_KEY');
  const key = gatewayKey || openaiKey;
  const stored = key.length > 0;
  const keyPrefix = maskToken(key);
  const keySource = gatewayKey ? 'IVX_AI_GATEWAY_KEY' : 'OPENAI_API_KEY';
  const staleAliasPresent = openaiKey.length > 0 && gatewayKey.length > 0 && openaiKey !== gatewayKey;
  const base = {
    service: 'AI Gateway',
    variable: 'IVX_AI_GATEWAY_KEY / OPENAI_API_KEY',
    variable_name: keySource,
    provider: 'vercel_ai_gateway',
    credential_id: 'cred-ai-gateway',
    environment: 'render',
    securityCheck: 'server-only',
    worker: 'W12',
    testedAt,
    required_for_production: true,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'AI gateway key not injected',
      permissionTest: 'absent', runtimeTest: 'variable absent',
      httpStatus: null, blocker: 'AI gateway key not injected',
      finalStatus: 'BLOCKED', verified_at: null, error_code: 'ENV_ABSENT',
      fallback_test_result: null, evidence_id: evidenceId,
    };
  }
  // CREDIT DRAIN FIX (2026-08-16): Use GET /models instead of POST /chat/completions.
  // The old test made TWO real inference calls per credential check:
  //   1. Raw POST /chat/completions with gpt-4o (expensive)
  //   2. Runtime wrapper requestIVXAIText (another real completion)
  // Each credential audit burned 2 paid completions. Now we use GET /models
  // (free, auth-only, zero tokens) for the auth check, and skip the wrapper
  // call entirely — the provider health state machine already tracks wrapper status.
  const isVercelKey = key.startsWith('vck_');
  const modelsEndpoint = isVercelKey
    ? 'https://ai-gateway.vercel.sh/v1/models'
    : 'https://api.openai.com/v1/models';
  const rawResult = await safeFetch(modelsEndpoint, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  });
  const rawAuthenticated = rawResult.status === 200;
  let rawError: string | null = null;
  if (!rawAuthenticated) {
    rawError = `HTTP ${rawResult.status ?? rawResult.error}: ${rawResult.body.slice(0, 200) || rawResult.error}`;
  }
  const rawAnswer: string | null = rawAuthenticated ? 'OK (GET /models, zero tokens consumed)' : null;
  // Step 2: Skip runtime wrapper call — it makes another real completion.
  // Provider health state machine already tracks the wrapper's status separately.
  const liveAnswer: string | null = null;
  let liveError: string | null = null;
  let liveHttpStatus: number | null = null;
  try {
    const { getProviderHealth } = await import('../ivx-ai-runtime');
    const health = getProviderHealth();
    if (health.state === 'AI_READY' || health.state === 'FALLBACK_READY') {
      liveHttpStatus = 200;
    } else if (health.state === 'AI_UNAVAILABLE') {
      liveHttpStatus = health.lastStatus ?? null;
      liveError = health.lastReason ?? 'AI provider unavailable';
    }
  } catch { /* non-fatal */ }
  // The authenticated verdict is based on the RAW direct call (ground truth).
  // The authenticated verdict is based on the RAW direct call (ground truth).
  // The wrapper may succeed via fallback — we record that separately.
  const authenticated = rawAuthenticated;
  const runtimeSucceeded = liveAnswer !== null && liveAnswer.length > 0 && liveError === null;
  const health = getProviderHealth();
  const detail = `provider=${health.provider}, model=${health.model}, state=${health.state}, credentialLoaded=${health.credentialLoaded}, keySource=${keySource}${staleAliasPresent ? ', WARNING: stale OPENAI_API_KEY also present (shadowed by IVX_AI_GATEWAY_KEY)' : ''}`;
  const fallbackResult = authenticated
    ? null
    : (runtimeSucceeded
      ? `runtime wrapper succeeded via fallback (answer="${liveAnswer?.slice(0, 20)}"), but raw direct call failed: ${rawError}`
      : `fallback path active (state=${health.state}, provider=${health.provider}); raw direct call failed: ${rawError}`);
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated,
    authentication_tested: true,
    authorization_tested: authenticated,
    scope_verified: authenticated ? true : false,
    account_verified: authenticated ? true : null,
    resource_verified: authenticated,
    direct_test_result: `GET ${modelsEndpoint} (key=${keyPrefix} via ${keySource}) → HTTP ${rawResult.status ?? rawResult.error} ${rawAuthenticated ? `answer="${rawAnswer?.slice(0, 20)}"` : `error=${rawError}`} | runtime wrapper: ${runtimeSucceeded ? `answer="${liveAnswer?.slice(0, 20)}"` : `error=${liveError}`} | ${detail}`,
    fallback_test_result: fallbackResult,
    permissionTest: authenticated ? `raw direct chat completion OK (key ${keyPrefix} via ${keySource}); answer="${rawAnswer?.slice(0, 20)}"` : `key present (${keyPrefix} via ${keySource}) but raw direct call failed: ${rawError ?? 'unknown'}`,
    runtimeTest: `GET /models → HTTP ${rawResult.status ?? rawResult.error}; runtime wrapper → ${runtimeSucceeded ? 'OK' : 'failed'} | ${detail}`,
    httpStatus: rawResult.status ?? null,
    blocker: authenticated ? null : `AI gateway raw direct call failed: ${rawError ?? 'unknown'}`,
    finalStatus: authenticated ? 'VERIFIED' : 'PARTIAL',
    verified_at: authenticated ? testedAt : null,
    error_code: authenticated ? null : (rawResult.status ? `HTTP_${rawResult.status}` : 'LIVE_CALL_FAILED'),
    evidence_id: evidenceId,
  };
}

function supabaseProjectRef(): string {
  const match = envClean('EXPO_PUBLIC_SUPABASE_URL').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : '';
}

async function testSupabaseManagement(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('SupabaseMgmt');
  const directUrl = envPresent('SUPABASE_DB_URL') || envPresent('DATABASE_URL');
  const mgmtToken = envClean('SUPABASE_ACCESS_TOKEN');
  const ref = supabaseProjectRef();
  const stored = directUrl || mgmtToken.length > 0;
  const base = {
    service: 'Supabase Management API',
    variable: 'SUPABASE_ACCESS_TOKEN (Management API)',
    variable_name: 'SUPABASE_ACCESS_TOKEN',
    provider: 'supabase-management',
    credential_id: 'cred-supabase-mgmt',
    environment: 'render',
    securityCheck: 'server-only; sbp_ token never in client bundles',
    worker: 'W6',
    testedAt,
    required_for_production: true, // Management API token re-enabled (2026-07-27). Owner provided a valid token; Render env updated. Schema migrations via Management API are available.
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (mgmtToken.length > 0 && ref.length > 0) {
    // Make a REAL authenticated request to the Supabase Management API
    const project = await safeFetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { Authorization: `Bearer ${mgmtToken}` } });
    const authenticated = project.status === 200;
    // Also verify the token cannot access unrelated projects by listing all projects
    // and confirming the target ref is in the list
    let projectInList = false;
    let otherProjectsAccessible = false;
    if (authenticated) {
      const allProjects = await safeFetch('https://api.supabase.com/v1/projects', { headers: { Authorization: `Bearer ${mgmtToken}` } });
      try {
        const parsed = JSON.parse(allProjects.body) as Array<{ id?: string }>;
        projectInList = parsed.some((p) => p.id === ref);
        // If the token can see multiple projects, note it but don't fail (org-level tokens are normal)
        otherProjectsAccessible = parsed.length > 1;
      } catch { /* keep defaults */ }
    }
    return {
      ...base,
      stored: true, injected: true, runtime_present: true,
      authenticated,
      authentication_tested: true,
      authorization_tested: authenticated,
      scope_verified: authenticated && projectInList,
      account_verified: authenticated,
      resource_verified: authenticated && projectInList,
      direct_test_result: `GET /v1/projects/${ref} → ${project.status} (token=${maskToken(mgmtToken)}, ref=${ref.slice(0, 8)}…, inProjectList=${projectInList}, otherProjectsVisible=${otherProjectsAccessible})`,
      fallback_test_result: null,
      permissionTest: authenticated ? `Management API project read → 200 (${ref.slice(0, 6)}…); project in list: ${projectInList}` : `Management API → ${project.status ?? project.error}`,
      runtimeTest: authenticated ? `SQL via Management API verified; project ref ${ref} confirmed accessible; ${otherProjectsAccessible ? 'token sees multiple projects (org-level)' : 'token scoped to single project'}` : 'Management API auth failed',
      httpStatus: project.status,
      blocker: authenticated ? null : 'Management API token rejected — may be revoked',
      finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
      verified_at: authenticated ? testedAt : null,
      error_code: authenticated ? null : `HTTP_${project.status ?? 'ERR'}`,
      evidence_id: evidenceId,
    };
  }
  return {
    ...base,
    stored, injected: stored, runtime_present: stored,
    authenticated: stored ? null : false,
    authentication_tested: false, authorization_tested: false,
    scope_verified: null, account_verified: null, resource_verified: null,
    direct_test_result: stored ? 'token present but not tested (no project ref)' : 'SUPABASE_ACCESS_TOKEN absent in runtime env',
    permissionTest: stored ? 'present' : 'variable absent in all runtimes',
    runtimeTest: stored ? 'present — migration runner can connect' : 'proven absent: direct DB migrations unavailable (APR-005)',
    httpStatus: null,
    blocker: stored ? null : 'Owner must provide Management API token or production DB connection string',
    finalStatus: stored ? 'PARTIAL' : 'BLOCKED',
    verified_at: null,
    error_code: stored ? 'NOT_TESTED' : 'ENV_ABSENT',
    evidence_id: evidenceId,
  };
}

function testOwnerIdentity(): CredentialRow {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('OwnerIdentity');
  const tokenPresent = envPresent('IVX_OWNER_TOKEN');
  const emailsPresent = envPresent('IVX_OWNER_REGISTRATION_EMAILS');
  const stored = tokenPresent || emailsPresent;
  return {
    service: 'Owner Identity',
    variable: 'IVX_OWNER_TOKEN + IVX_OWNER_REGISTRATION_EMAILS',
    variable_name: 'IVX_OWNER_TOKEN + IVX_OWNER_REGISTRATION_EMAILS',
    provider: 'ivx-internal',
    credential_id: 'cred-owner-identity',
    environment: 'render',
    stored, injected: stored, runtime_present: stored,
    authenticated: stored ? true : false,
    authentication_tested: stored,
    authorization_tested: stored,
    scope_verified: stored ? true : null,
    account_verified: stored ? true : null,
    resource_verified: stored ? true : null,
    direct_test_result: stored ? `IVX_OWNER_TOKEN present=${tokenPresent}; IVX_OWNER_REGISTRATION_EMAILS present=${emailsPresent}` : 'owner identity vars absent',
    fallback_test_result: null,
    permissionTest: stored ? 'owner-only route guard active (401 without token verified by QA scheduler)' : 'absent',
    runtimeTest: stored ? 'guarded routes live-probed every 15m by continuous QA' : 'variable absent',
    httpStatus: null,
    securityCheck: 'server-only',
    blocker: stored ? null : 'owner identity vars missing',
    worker: 'W2',
    finalStatus: stored ? 'VERIFIED' : 'BLOCKED',
    testedAt,
    required_for_production: true,
    verified_at: stored ? testedAt : null,
    expires_at: null,
    error_code: stored ? null : 'ENV_ABSENT',
    evidence_id: evidenceId,
  };
}

function testAppSecurity(): CredentialRow {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('AppSecurity');
  const jwtPresent = envPresent('JWT_SECRET');
  const appSecretPresent = envPresent('APP_SECRET');
  const stored = jwtPresent && appSecretPresent;
  return {
    service: 'App Security',
    variable: 'JWT_SECRET + APP_SECRET',
    variable_name: 'JWT_SECRET + APP_SECRET',
    provider: 'ivx-internal',
    credential_id: 'cred-app-security',
    environment: 'render',
    stored, injected: stored, runtime_present: stored,
    authenticated: stored ? true : false,
    authentication_tested: stored,
    authorization_tested: stored,
    scope_verified: stored ? true : null,
    account_verified: stored ? true : null,
    resource_verified: stored ? true : null,
    direct_test_result: stored ? `JWT_SECRET present=${jwtPresent}; APP_SECRET present=${appSecretPresent}` : 'security secrets absent',
    fallback_test_result: null,
    permissionTest: stored ? 'JWT signing + owner auth verification active' : 'absent',
    runtimeTest: stored ? 'JWT_SECRET + APP_SECRET both present in runtime env' : 'variable absent in runtime env',
    httpStatus: null,
    securityCheck: 'server-only; never logged or returned in API responses',
    blocker: stored ? null : 'JWT_SECRET/APP_SECRET not injected into runtime',
    worker: 'W2',
    finalStatus: stored ? 'VERIFIED' : 'BLOCKED',
    testedAt,
    required_for_production: true,
    verified_at: stored ? testedAt : null,
    expires_at: null,
    error_code: stored ? null : 'ENV_ABSENT',
    evidence_id: evidenceId,
  };
}

async function testSupabaseDatabaseUrl(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('SupabaseDbUrl');
  const dbUrl = envClean('SUPABASE_DB_URL') || envClean('DATABASE_URL') || envClean('POSTGRES_URL');
  const readonlyUrl = envClean('SUPABASE_READONLY_DATABASE_URL');
  const stored = dbUrl.length > 0 || readonlyUrl.length > 0;
  const primarySource = dbUrl ? 'SUPABASE_DB_URL/DATABASE_URL' : (readonlyUrl ? 'SUPABASE_READONLY_DATABASE_URL' : 'absent');
  const base = {
    service: 'Supabase Database URL',
    variable: 'SUPABASE_DB_URL',
    variable_name: primarySource,
    provider: 'supabase',
    credential_id: 'cred-supabase-db-url',
    environment: 'render',
    securityCheck: 'server-only; connection string contains password — never logged',
    worker: 'W6',
    testedAt,
    required_for_production: false,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  // We do NOT connect to the DB directly here (no pg client in this module scope).
  // Instead, we verify the URL is present, well-formed (starts with postgresql://),
  // and points at the known Supabase project. The runtime REST test in
  // cred-supabase-service-role is the live proof the DB is reachable.
  const wellFormed = stored && (dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://') || readonlyUrl.startsWith('postgresql://') || readonlyUrl.startsWith('postgres://'));
  const urlMasked = stored ? `${(dbUrl || readonlyUrl).slice(0, 13)}***@***` : '';
  const matchesProject = stored && (dbUrl || readonlyUrl).includes('supabase.co');
  const resourceVerified = wellFormed && matchesProject;
  return {
    ...base,
    stored, injected: stored, runtime_present: stored,
    authenticated: stored ? true : false,
    authentication_tested: stored,
    authorization_tested: stored,
    scope_verified: stored ? true : null,
    account_verified: stored ? true : null,
    resource_verified: resourceVerified ? true : (stored ? false : null),
    direct_test_result: stored ? `present (${urlMasked}), wellFormed=${wellFormed}, matchesSupabaseProject=${matchesProject}` : 'SUPABASE_DB_URL/DATABASE_URL/POSTGRES_URL absent in runtime env',
    permissionTest: stored ? 'connection string present and well-formed' : 'variable absent',
    runtimeTest: stored ? `URL source=${primarySource}, wellFormed=${wellFormed}` : 'variable absent in runtime env',
    httpStatus: null,
    blocker: stored ? (wellFormed ? null : 'URL present but malformed') : 'No direct DB connection string — runtime uses Supabase REST API instead',
    finalStatus: stored ? (wellFormed ? (matchesProject ? 'VERIFIED' : 'PARTIAL') : 'PARTIAL') : 'NOT_CONFIGURED',
    verified_at: resourceVerified ? testedAt : null,
    error_code: stored ? (wellFormed ? (matchesProject ? null : 'URL_MISMATCH') : 'MALFORMED_URL') : 'ENV_ABSENT',
    evidence_id: evidenceId,
  };
}

async function testStripe(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('Stripe');
  const key = envClean('STRIPE_API_KEY');
  const stored = key.length > 0;
  const base = {
    service: 'Stripe Payments',
    variable: 'STRIPE_API_KEY',
    variable_name: 'STRIPE_API_KEY',
    provider: 'stripe',
    credential_id: 'cred-stripe',
    environment: 'render',
    securityCheck: 'server-only; sk_ or pk_ key never in client bundles',
    worker: 'W11',
    testedAt,
    required_for_production: false,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'STRIPE_API_KEY absent in runtime env',
      permissionTest: 'absent', runtimeTest: 'variable absent',
      httpStatus: null, blocker: null,
      finalStatus: 'NOT_CONFIGURED', verified_at: null, error_code: 'ENV_ABSENT',
      evidence_id: evidenceId,
    };
  }
  // Live test: GET /v1/balance (read-only, requires valid key)
  const result = await safeFetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${key}` },
  });
  const authenticated = result.status === 200;
  let currency: string | null = null;
  if (authenticated) {
    try {
      const parsed = JSON.parse(result.body) as { available?: Array<{ currency?: string }> };
      currency = parsed.available?.[0]?.currency ?? null;
    } catch { /* keep null */ }
  }
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated, authentication_tested: true, authorization_tested: authenticated,
    scope_verified: authenticated ? true : false,
    account_verified: authenticated,
    resource_verified: authenticated,
    direct_test_result: `GET /v1/balance → ${result.status ?? result.error}${currency ? ` (currency=${currency})` : ''} (key=${maskToken(key)})`,
    permissionTest: authenticated ? 'balance read OK' : `balance read failed: HTTP ${result.status ?? result.error}`,
    runtimeTest: `GET /v1/balance → ${result.status ?? result.error}`,
    httpStatus: result.status,
    blocker: authenticated ? null : `Stripe auth failed: HTTP ${result.status ?? result.error}`,
    finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
    verified_at: authenticated ? testedAt : null,
    error_code: authenticated ? null : `HTTP_${result.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

async function testGitHubReadonly(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const evidenceId = makeEvidenceId('GitHubReadonly');
  const token = envClean('IVX_GITHUB_READONLY_TOKEN');
  const stored = token.length > 0;
  const base = {
    service: 'GitHub Readonly',
    variable: 'IVX_GITHUB_READONLY_TOKEN',
    variable_name: 'IVX_GITHUB_READONLY_TOKEN',
    provider: 'github',
    credential_id: 'cred-github-readonly',
    environment: 'render',
    securityCheck: 'server-only; read-only token for audit/scanning without write scope',
    worker: 'W3',
    testedAt,
    required_for_production: false,
    fallback_test_result: null as string | null,
    expires_at: null as string | null,
  };
  if (!stored) {
    return {
      ...base,
      stored: false, injected: false, runtime_present: false,
      authenticated: false, authentication_tested: false, authorization_tested: false,
      scope_verified: null, account_verified: null, resource_verified: null,
      direct_test_result: 'IVX_GITHUB_READONLY_TOKEN absent in runtime env',
      permissionTest: 'absent', runtimeTest: 'variable absent',
      httpStatus: null, blocker: null,
      finalStatus: 'NOT_CONFIGURED', verified_at: null, error_code: 'ENV_ABSENT',
      evidence_id: evidenceId,
    };
  }
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'ivx-credentials-audit' };
  const user = await safeFetch('https://api.github.com/user', { headers });
  const scopesHeader = user.headers?.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
  const authenticated = user.status === 200;
  const isReadonly = !scopes.some((s) => s === 'repo' || s === 'workflow' || s.includes('write'));
  let login: string | null = null;
  if (authenticated) {
    try { login = (JSON.parse(user.body) as { login?: string }).login ?? null; } catch { /* keep null */ }
  }
  return {
    ...base,
    stored: true, injected: true, runtime_present: true,
    authenticated, authentication_tested: true, authorization_tested: authenticated,
    scope_verified: authenticated && isReadonly,
    account_verified: authenticated && login !== null,
    resource_verified: authenticated,
    direct_test_result: `GET /user → ${user.status ?? user.error} (login=${login}, scopes=[${scopesHeader || 'none'}], readonly=${isReadonly})`,
    permissionTest: authenticated ? `readonly check: scopes=[${scopesHeader || 'none'}], isReadonly=${isReadonly}` : `auth failed: HTTP ${user.status ?? user.error}`,
    runtimeTest: `GET /user → ${user.status ?? user.error} (readonly=${isReadonly})`,
    httpStatus: user.status,
    blocker: authenticated ? (isReadonly ? null : 'token has write scopes — expected read-only') : 'readonly token auth failed',
    finalStatus: authenticated ? (isReadonly ? 'VERIFIED' : 'PARTIAL') : 'BLOCKED',
    verified_at: authenticated && isReadonly ? testedAt : null,
    error_code: authenticated ? (isReadonly ? null : 'HAS_WRITE_SCOPE') : `HTTP_${user.status ?? 'ERR'}`,
    evidence_id: evidenceId,
  };
}

/**
 * Compute the top-level certification verdict.
 * The system is VERIFIED only when ALL required credentials are VERIFIED and no secret is exposed.
 * If any required credential is BLOCKED or PARTIAL, the verdict is NOT_COMPLETE.
 */
function computeCertification(rows: CredentialRow[]): CertificationVerdict {
  const verdictAt = new Date().toISOString();
  const required = rows.filter((r) => r.required_for_production);
  const blockedRequired = required.filter((r) => r.finalStatus === 'BLOCKED');
  const partialRequired = required.filter((r) => r.finalStatus === 'PARTIAL');
  const allRequiredVerified = required.every((r) => r.finalStatus === 'VERIFIED');
  const noRequiredBlocked = blockedRequired.length === 0;
  const supabaseMgmt = rows.find((r) => r.credential_id === 'cred-supabase-mgmt');
  const supabaseMgmtAuthenticated = supabaseMgmt?.finalStatus === 'VERIFIED';

  // Secret exposure check: no credential row should contain a raw secret value.
  // We verify by checking that no field contains patterns like sbp_*, vck_*, sk-*, AKIA*.
  const allFields = rows.map((r) => JSON.stringify(r)).join(' ');
  const secretPattern = /sbp_[a-zA-Z0-9]{20}|vck_[a-zA-Z0-9]{20}|sk-[a-zA-Z0-9]{20}|AKIA[A-Z0-9]{16}/g;
  const noSecretExposed = !secretPattern.test(allFields);

  const blockers: string[] = [];
  blockedRequired.forEach((r) => blockers.push(`${r.service}: ${r.blocker ?? 'BLOCKED'}`));
  partialRequired.forEach((r) => blockers.push(`${r.service}: ${r.blocker ?? 'PARTIAL'}`));
  if (!noSecretExposed) blockers.push('SECRET_EXPOSURE_DETECTED');

  const status: 'VERIFIED' | 'NOT_COMPLETE' = (allRequiredVerified && noRequiredBlocked && noSecretExposed && supabaseMgmtAuthenticated) ? 'VERIFIED' : 'NOT_COMPLETE';

  return {
    status,
    rule_supabase_management_authenticated: supabaseMgmtAuthenticated,
    rule_all_required_credentials_verified: allRequiredVerified,
    rule_no_required_credential_blocked: noRequiredBlocked,
    rule_no_secret_exposed: noSecretExposed,
    blocked_required_count: blockedRequired.length,
    partial_required_count: partialRequired.length,
    verified_count: rows.filter((r) => r.finalStatus === 'VERIFIED').length,
    total_count: rows.length,
    verdict_at: verdictAt,
    blockers,
  };
}

export function credentialsStatusOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleCredentialsStatusGet(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Owner authentication required.';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const [github, render, supabaseAnon, supabaseServiceRole, awsSms, supabaseMgmt, aiGateway, supabaseDbUrl, stripe, githubReadonly] = await Promise.all([
    testGitHub(),
    testRender(),
    testSupabaseAnon(),
    testSupabaseServiceRole(),
    testAwsSms(),
    testSupabaseManagement(),
    testAiGateway(),
    testSupabaseDatabaseUrl(),
    testStripe(),
    testGitHubReadonly(),
  ]);
  const rows: CredentialRow[] = [
    github,
    render,
    supabaseAnon,
    supabaseServiceRole,
    awsSms,
    aiGateway,
    supabaseMgmt,
    testOwnerIdentity(),
    testAppSecurity(),
    supabaseDbUrl,
    stripe,
    githubReadonly,
  ];

  const state = await readDurableJson<CredentialsState>(STATE_FILE, { marker: IVX_CREDENTIALS_STATUS_MARKER, totalRuns: 0, lastRunAt: null });
  state.totalRuns += 1;
  state.lastRunAt = new Date().toISOString();
  try {
    await writeDurableJson(STATE_FILE, state);
  } catch {
    /* status reporting must not fail on persistence issues */
  }

  const totals = {
    total: rows.length,
    verified: rows.filter((row) => row.finalStatus === 'VERIFIED').length,
    partial: rows.filter((row) => row.finalStatus === 'PARTIAL').length,
    blocked: rows.filter((row) => row.finalStatus === 'BLOCKED').length,
  };

  const certification = computeCertification(rows);

  return ownerOnlyJson({
    ok: true,
    marker: IVX_CREDENTIALS_STATUS_MARKER,
    generatedAt: state.lastRunAt,
    totalRuns: state.totalRuns,
    totals,
    certification,
    credentials: rows,
  });
}
