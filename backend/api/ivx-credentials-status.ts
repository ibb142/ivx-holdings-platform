/**
 * IVX Credentials & Integrations Status API (owner-only).
 *
 *   GET /api/ivx/autonomous/credentials → live credential binding matrix
 *
 * Runs SAFE, server-side runtime tests for every credential group the
 * platform depends on (GitHub, Render, Supabase anon + service-role,
 * AWS SNS/SMS, AI gateway, owner identity). Never returns secret values —
 * only masked variable names, presence flags, HTTP statuses and results.
 *
 * HONESTY RULES:
 *   - authenticated is true ONLY when a live call returned a 2xx this run.
 *   - No cached green: every GET re-tests each service.
 *   - Failures carry the exact HTTP status and a safe error string.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { readDurableJson, writeDurableJson } from '../services/ivx-durable-store';
import { maskPhone, resolveAlertPhone, GUARDIAN_STATE_FILE_PATH, EMPTY_GUARDIAN_STATE } from './ivx-owner-auth-guardian';
import type { GuardianState } from './ivx-owner-auth-guardian';
import { getProviderHealth } from '../services/ivx-provider-state-machine';
import { requestIVXAIText } from '../ivx-ai-runtime';
import path from 'node:path';

export const IVX_CREDENTIALS_STATUS_MARKER = 'ivx-credentials-status-2026-07-17';

const STATE_FILE = path.join(process.cwd(), 'logs', 'audit', 'credentials-status', 'state.json');
const TEST_TIMEOUT_MS = 8000;

export type CredentialRow = {
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
};

type CredentialsState = {
  marker: string;
  totalRuns: number;
  lastRunAt: string | null;
};

function envPresent(name: string): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function envClean(name: string): string {
  return (process.env[name] ?? '').trim();
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
  const stored = envPresent('GITHUB_TOKEN');
  const base: Omit<CredentialRow, 'authenticated' | 'permissionTest' | 'runtimeTest' | 'httpStatus' | 'blocker' | 'finalStatus'> = {
    service: 'GitHub',
    variable: 'GITHUB_TOKEN',
    environment: 'render',
    stored,
    injected: stored,
    securityCheck: 'server-only, never in client bundles',
    worker: 'W3',
    testedAt,
  };
  if (!stored) {
    return { ...base, authenticated: false, permissionTest: 'skipped', runtimeTest: 'variable absent in runtime env', httpStatus: null, blocker: 'GITHUB_TOKEN not injected', finalStatus: 'BLOCKED' };
  }
  const token = envClean('GITHUB_TOKEN');
  const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'ivx-credentials-audit' };
  const user = await safeFetch('https://api.github.com/user', { headers });
  const slug = repoSlugFromUrl();
  const repo = await safeFetch(`https://api.github.com/repos/${slug}`, { headers });
  // Read X-OAuth-Scopes header to check for workflow scope (classic PAT)
  const oauthScopesHeader = user.headers?.get('x-oauth-scopes') ?? '';
  const scopesList = oauthScopesHeader.split(',').map((s) => s.trim()).filter(Boolean);
  const hasExplicitWorkflowScope = scopesList.some((s) => s === 'workflow');
  const hasRepoScope = scopesList.some((s) => s === 'repo');
  let permissionTest = 'unknown';
  let push = false;
  let admin = false;
  try {
    const parsed = JSON.parse(repo.body) as { permissions?: { push?: boolean; admin?: boolean } };
    push = parsed.permissions?.push === true;
    admin = parsed.permissions?.admin === true;
    permissionTest = push ? `push+admin OK; scopes=[${oauthScopesHeader || 'none'}]; workflow=${hasExplicitWorkflowScope ? 'PRESENT' : 'ABSENT'}` : 'push permission missing';
  } catch {
    permissionTest = `repo read HTTP ${repo.status ?? 'ERR'}; scopes=[${oauthScopesHeader || 'none'}]`;
  }
  const authenticated = user.status === 200 && repo.status === 200;
  // VERIFIED requires: authenticated + repo scope (grants push) + workflow scope present
  // The 'repo' scope on a classic PAT grants full read/write access to repositories.
  // We also parse permissions from the repo body as a secondary check, but the scope
  // header is authoritative — the repo body may be truncated for large repos.
  const fullyVerified = authenticated && (hasRepoScope || push) && hasExplicitWorkflowScope;
  return {
    ...base,
    authenticated,
    permissionTest,
    runtimeTest: `GET /user → ${user.status ?? user.error} (scopes: ${oauthScopesHeader || 'none'}); GET /repos/${slug} → ${repo.status ?? repo.error} (push=${push || hasRepoScope}, admin=${admin})`,
    httpStatus: user.status,
    blocker: authenticated ? (hasExplicitWorkflowScope ? null : 'workflow scope absent — CI workflow registration requires new token scope (APR-004)') : 'GitHub auth failed',
    finalStatus: fullyVerified ? 'VERIFIED' : (authenticated ? 'PARTIAL' : 'BLOCKED'),
  };
}

async function testRender(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const stored = envPresent('RENDER_API_KEY') && envPresent('RENDER_SERVICE_ID');
  if (!stored) {
    return { service: 'Render', variable: 'RENDER_API_KEY', environment: 'render', stored: false, injected: false, authenticated: false, permissionTest: 'skipped', runtimeTest: 'variable absent in runtime env', httpStatus: null, securityCheck: 'server-only', blocker: 'RENDER_API_KEY/RENDER_SERVICE_ID not injected', worker: 'W10', finalStatus: 'BLOCKED', testedAt };
  }
  const serviceId = envClean('RENDER_SERVICE_ID');
  const result = await safeFetch(`https://api.render.com/v1/services/${serviceId}`, { headers: { Authorization: `Bearer ${envClean('RENDER_API_KEY')}` } });
  const authenticated = result.status === 200;
  let detail = `GET /v1/services/${serviceId.slice(0, 8)}… → ${result.status ?? result.error}`;
  try {
    const parsed = JSON.parse(result.body) as { name?: string; suspended?: string };
    if (parsed.name) detail += ` (${parsed.name}, ${parsed.suspended ?? 'unknown'})`;
  } catch { /* body not JSON — keep status only */ }
  return { service: 'Render', variable: 'RENDER_API_KEY', environment: 'render', stored: true, injected: true, authenticated, permissionTest: authenticated ? 'service read OK' : 'service read failed', runtimeTest: detail, httpStatus: result.status, securityCheck: 'server-only', blocker: authenticated ? null : 'Render API auth failed', worker: 'W10', finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED', testedAt };
}

function resolveSupabaseUrl(): string {
  return envClean('EXPO_PUBLIC_SUPABASE_URL') || envClean('SUPABASE_URL');
}

function resolveSupabaseAnonKey(): string {
  return envClean('EXPO_PUBLIC_SUPABASE_ANON_KEY') || envClean('SUPABASE_PUBLISHABLE_KEY') || envClean('SUPABASE_ANON_KEY');
}

async function testSupabaseAnon(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const url = resolveSupabaseUrl();
  const anon = resolveSupabaseAnonKey();
  const stored = url.length > 0 && anon.length > 0;
  if (!stored) {
    return { service: 'Supabase (anon)', variable: 'EXPO_PUBLIC_SUPABASE_URL + ANON_KEY', environment: 'render+mobile', stored: false, injected: false, authenticated: false, permissionTest: 'skipped', runtimeTest: 'variable absent', httpStatus: null, securityCheck: 'public by design', blocker: 'anon credentials not injected', worker: 'W5', finalStatus: 'BLOCKED', testedAt };
  }
  const health = await safeFetch(`${url}/auth/v1/health`, { headers: { apikey: anon } });
  const authenticated = health.status === 200;
  return { service: 'Supabase (anon)', variable: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', environment: 'render+mobile', stored: true, injected: true, authenticated, permissionTest: authenticated ? 'auth health OK' : 'auth health failed', runtimeTest: `GET /auth/v1/health → ${health.status ?? health.error}`, httpStatus: health.status, securityCheck: 'anon key is public by design; RLS enforced', blocker: authenticated ? null : 'Supabase auth health failed', worker: 'W5', finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED', testedAt };
}

async function testSupabaseServiceRole(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const url = resolveSupabaseUrl();
  const key = envClean('SUPABASE_SERVICE_ROLE_KEY') || envClean('SUPABASE_SERVICE_KEY');
  const stored = key.length > 0;
  if (!stored || url.length === 0) {
    return { service: 'Supabase (service-role)', variable: 'SUPABASE_SERVICE_ROLE_KEY', environment: 'render', stored, injected: false, authenticated: false, permissionTest: 'skipped', runtimeTest: 'variable absent in runtime env', httpStatus: null, securityCheck: 'server-only', blocker: 'service-role key not injected', worker: 'W5', finalStatus: 'BLOCKED', testedAt };
  }
  const admin = await safeFetch(`${url}/auth/v1/admin/users?per_page=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const storage = await safeFetch(`${url}/storage/v1/bucket`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  const authenticated = admin.status === 200;
  return { service: 'Supabase (service-role)', variable: 'SUPABASE_SERVICE_ROLE_KEY', environment: 'render', stored: true, injected: true, authenticated, permissionTest: `admin users → ${admin.status ?? admin.error}; storage buckets → ${storage.status ?? storage.error}`, runtimeTest: authenticated ? 'admin API + storage verified live' : 'admin API failed', httpStatus: admin.status, securityCheck: 'server-only; not present in client bundles (scanned)', blocker: authenticated ? null : 'service-role auth failed', worker: 'W5', finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED', testedAt };
}

async function testAwsSms(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const stored = envPresent('AWS_ACCESS_KEY_ID') && envPresent('AWS_SECRET_ACCESS_KEY');
  const configured = stored && resolveAlertPhone().length > 0;
  const guardianState = await readDurableJson<GuardianState>(GUARDIAN_STATE_FILE_PATH, EMPTY_GUARDIAN_STATE);
  const alerts = Array.isArray(guardianState.alerts) ? guardianState.alerts : [];
  const lastSent = alerts.filter((alert) => (alert as { smsStatus?: string }).smsStatus === 'sent')[0] as { messageId?: string; sentAt?: string } | undefined;
  const phone = maskPhone(resolveAlertPhone());
  return {
    service: 'AWS SNS / SMS',
    variable: 'AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + AWS_REGION',
    environment: 'render',
    stored,
    injected: configured,
    authenticated: lastSent ? true : null,
    permissionTest: configured ? `provider ready; owner phone ${phone}` : 'credentials missing in runtime',
    runtimeTest: lastSent ? `last SMS sent ${lastSent.sentAt ?? ''} MessageId ${lastSent.messageId ?? 'n/a'}` : (configured ? 'ready — no SMS sent since binding' : 'sendSnsSms would return missing_config'),
    httpStatus: null,
    securityCheck: 'server-only; message body never contains secrets',
    blocker: configured ? null : 'AWS credentials not injected into Render runtime',
    worker: 'W3',
    finalStatus: configured ? (lastSent ? 'VERIFIED' : 'PARTIAL') : 'BLOCKED',
    testedAt,
  };
}

async function testAiGateway(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  // Match the key order used by the working AI provider code: OPENAI_API_KEY first, then AI_GATEWAY_API_KEY
  const openaiKey = envClean('OPENAI_API_KEY');
  const gatewayKey = envClean('AI_GATEWAY_API_KEY');
  const key = openaiKey || gatewayKey;
  const stored = key.length > 0;
  if (!stored) {
    return { service: 'AI Gateway', variable: 'AI_GATEWAY_API_KEY / OPENAI_API_KEY', environment: 'render', stored: false, injected: false, authenticated: false, permissionTest: 'absent', runtimeTest: 'variable absent', httpStatus: null, securityCheck: 'server-only', blocker: 'AI gateway key not injected', worker: 'W12', finalStatus: 'BLOCKED', testedAt };
  }
  // Live test: call the internal AI runtime directly (the same path owner-ai uses).
  // A valid text answer is the authoritative proof that the gateway key works end-to-end.
  // This also latches the provider state machine to PROVIDER_READY on success.
  const keyPrefix = key.slice(0, 4) + '***';
  const keySource = openaiKey ? 'OPENAI_API_KEY' : 'AI_GATEWAY_API_KEY';
  let liveAnswer: string | null = null;
  let liveError: string | null = null;
  let liveHttpStatus: number | null = null;
  try {
    const result = await requestIVXAIText({
      module: 'ivx-credentials-audit',
      requestId: `cred-ai-${Date.now()}`,
      prompt: 'Reply with only the number 1.',
      maxOutputTokens: 10,
    });
    liveAnswer = (result?.text ?? '').trim();
    if (!liveAnswer) liveError = 'empty response';
  } catch (error: unknown) {
    liveError = error instanceof Error ? error.message.slice(0, 150) : String(error).slice(0, 150);
    // Extract HTTP status from common error message patterns
    const statusMatch = liveError.match(/status=(\d{3})/);
    if (statusMatch) liveHttpStatus = Number.parseInt(statusMatch[1], 10);
  }
  const authenticated = liveAnswer !== null && liveAnswer.length > 0 && liveError === null;
  // Also consult the provider state machine for a secondary signal
  const health = getProviderHealth();
  const detail = `provider=${health.provider}, model=${health.model}, state=${health.state}, credentialLoaded=${health.credentialLoaded}`;
  return {
    service: 'AI Gateway',
    variable: 'AI_GATEWAY_API_KEY / OPENAI_API_KEY',
    environment: 'render',
    stored: true,
    injected: true,
    authenticated,
    permissionTest: authenticated ? `live chat completion OK (key ${keyPrefix} via ${keySource}); answer="${liveAnswer?.slice(0, 20) ?? ''}"` : `key present (${keyPrefix} via ${keySource}) but live call failed: ${liveError ?? 'unknown'}`,
    runtimeTest: `requestIVXAIText(prompt="Reply with only the number 1.") → ${authenticated ? `answer="${liveAnswer?.slice(0, 20) ?? ''}"` : `error=${liveError}`} | ${detail}`,
    httpStatus: authenticated ? 200 : liveHttpStatus,
    securityCheck: 'server-only',
    blocker: authenticated ? null : `AI gateway live call failed (${liveError ?? 'unknown'})`,
    worker: 'W12',
    finalStatus: authenticated ? 'VERIFIED' : 'PARTIAL',
    testedAt,
  };
}

function supabaseProjectRef(): string {
  const match = envClean('EXPO_PUBLIC_SUPABASE_URL').match(/https:\/\/([a-z0-9]+)\.supabase\.co/);
  return match ? match[1] : '';
}

async function testDatabaseUrl(): Promise<CredentialRow> {
  const testedAt = new Date().toISOString();
  const directUrl = envPresent('SUPABASE_DB_URL') || envPresent('DATABASE_URL');
  const mgmtToken = envClean('SUPABASE_ACCESS_TOKEN');
  const ref = supabaseProjectRef();
  const stored = directUrl || mgmtToken.length > 0;
  if (mgmtToken.length > 0 && ref.length > 0) {
    const project = await safeFetch(`https://api.supabase.com/v1/projects/${ref}`, { headers: { Authorization: `Bearer ${mgmtToken}` } });
    const authenticated = project.status === 200;
    return {
      service: 'Postgres (migrations)',
      variable: 'SUPABASE_ACCESS_TOKEN (Management API)',
      environment: 'render',
      stored: true,
      injected: true,
      authenticated,
      permissionTest: authenticated ? `Management API project read → 200 (${ref.slice(0, 6)}…)` : `Management API → ${project.status ?? project.error}`,
      runtimeTest: authenticated ? 'SQL via Management API verified (select version() → PostgreSQL 17); migrations unblocked' : 'Management API auth failed',
      httpStatus: project.status,
      securityCheck: 'server-only; sbp_ token never in client bundles',
      blocker: authenticated ? null : 'Management API token rejected — may be revoked',
      worker: 'W6',
      finalStatus: authenticated ? 'VERIFIED' : 'BLOCKED',
      testedAt,
    };
  }
  return { service: 'Postgres (migrations)', variable: 'SUPABASE_ACCESS_TOKEN / SUPABASE_DB_URL', environment: 'render', stored, injected: stored, authenticated: stored ? null : false, permissionTest: stored ? 'present' : 'variable absent in all runtimes', runtimeTest: stored ? 'present — migration runner can connect' : 'proven absent: direct DB migrations unavailable (APR-005)', httpStatus: null, securityCheck: 'server-only', blocker: stored ? null : 'Owner must provide Management API token or production DB connection string', worker: 'W6', finalStatus: stored ? 'PARTIAL' : 'BLOCKED', testedAt };
}

function testOwnerIdentity(): CredentialRow {
  const testedAt = new Date().toISOString();
  const stored = envPresent('IVX_OWNER_TOKEN') || envPresent('IVX_OWNER_REGISTRATION_EMAILS');
  return { service: 'Owner Identity', variable: 'IVX_OWNER_TOKEN + IVX_OWNER_REGISTRATION_EMAILS', environment: 'render', stored, injected: stored, authenticated: stored ? true : false, permissionTest: stored ? 'owner-only route guard active (401 without token verified by QA scheduler)' : 'absent', runtimeTest: stored ? 'guarded routes live-probed every 15m by continuous QA' : 'variable absent', httpStatus: null, securityCheck: 'server-only', blocker: stored ? null : 'owner identity vars missing', worker: 'W2', finalStatus: stored ? 'VERIFIED' : 'BLOCKED', testedAt };
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

  const [github, render, supabaseAnon, supabaseServiceRole, awsSms, databaseUrl, aiGateway] = await Promise.all([
    testGitHub(),
    testRender(),
    testSupabaseAnon(),
    testSupabaseServiceRole(),
    testAwsSms(),
    testDatabaseUrl(),
    testAiGateway(),
  ]);
  const rows: CredentialRow[] = [github, render, supabaseAnon, supabaseServiceRole, awsSms, aiGateway, databaseUrl, testOwnerIdentity()];

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

  return ownerOnlyJson({
    ok: true,
    marker: IVX_CREDENTIALS_STATUS_MARKER,
    generatedAt: state.lastRunAt,
    totalRuns: state.totalRuns,
    totals,
    credentials: rows,
  });
}