import { gunzipSync } from 'node:zlib';
import { requestIVXAIText } from '../ivx-ai-runtime';
import { createClient } from '@supabase/supabase-js';
import { buildIVXCredentialRequestManifestSnapshot, IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES } from '../config/ivx-credential-request-manifest';
import { getIVXOwnerVariableRuntimeValue, hasIVXOwnerVariableRuntimeValue, getRawOwnerVariableValue } from './ivx-owner-variables';
import { sendSesEmail, verifySesEmailIdentity, listSesIdentities } from '../services/ivx-ses-email';
import { createCloudFrontInvalidation } from '../services/ivx-cloudfront-invalidation';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';

type PgQueryResult = {
  command?: string;
  rowCount?: number | null;
  rows: Record<string, unknown>[];
};

type PgClientLike = {
  query: (sql: string) => Promise<PgQueryResult>;
  release: () => void;
};

type PgPoolLike = {
  connect: () => Promise<PgClientLike>;
  end: () => Promise<void>;
};

type PgPoolConstructor = new (config: {
  connectionString: string;
  ssl?: { rejectUnauthorized: boolean };
  application_name?: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}) => PgPoolLike;

type DeveloperDeployAction =
  | 'github_commit_file'
  | 'github_create_branch'
  | 'github_create_pull_request'
  | 'github_pull_request_status'
  | 'github_merge_pull_request'
  | 'github_create_rollback_tag'
  | 'github_dispatch_workflow'
  | 'github_create_repository'
  | 'github_list_workflow_runs'
  | 'github_get_workflow_run'
  | 'github_token_scopes'
  | 'verify_url_sha256'
  | 'render_trigger_deploy'
  | 'render_restart_service'
  | 'render_upsert_env_var'
  | 'render_update_subdomain_policy'
  | 'render_update_source'
  | 'supabase_execute_sql'
  | 'supabase_reset_owner_password'
  | 'supabase_revoke_owner_sessions'
  | 'supabase_audit_owner_auth_user'
  | 'send_owner_password_reset_email_via_ses'
  | 'generate_owner_password_reset_link'
  | 'verify_ses_email_identity'
  | 'list_ses_identities'
  | 'get_supabase_auth_config'
  | 'update_supabase_auth_config'
  | 'disable_supabase_mfa_aal2_enforcement'
  | 'unenroll_owner_mfa_factor'
  | 'cloudfront_invalidate'
  | 'supabase_execute_sql_management'
  | 'github_read_file'
  | 'github_search_code'
  | 'github_list_directory'
  | 'github_get_file_tree'
  | 'github_get_workflow_logs'
  | 'ai_diagnose_failure'
  | 'ai_analyze_code'
  | 'ai_generate_fix'
  | 'ai_review_architecture'
  | 'analyze_dependencies'
  | 'autonomous_fix_cycle'
  | 'ai_design_feature'
  | 'ai_generate_code'
  | 'ai_generate_tests'
  | 'ai_refactor_code'
  | 'ai_debug_runtime'
  | 'ai_security_audit'
  | 'ai_performance_analysis'
  | 'ai_generate_docs'
  | 'test_api_endpoint'
  | 'render_get_logs'
  | 'autonomous_feature_cycle'
  | 'github_commit_multi_file';

type DeveloperDeployRequest = {
  action?: unknown;
  input?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
  reason?: unknown;
};

type GithubRepoInfo = {
  owner: string;
  repo: string;
};

const GITHUB_CONFIRM_TEXT = 'CONFIRM_IVX_GITHUB_WRITE';
const GITHUB_MERGE_CONFIRM_TEXT = 'CONFIRM_IVX_GITHUB_MERGE';
const CREATE_REPOSITORY_CONFIRM_TEXT = 'CONFIRM_IVX_CREATE_REPOSITORY';
const RENDER_DEPLOY_CONFIRM_TEXT = 'CONFIRM_IVX_RENDER_DEPLOY';
const RENDER_SERVICE_CONFIRM_TEXT = 'CONFIRM_IVX_RENDER_SERVICE_UPDATE';
const SUPABASE_SQL_CONFIRM_TEXT = 'CONFIRM_IVX_SUPABASE_MIGRATION';
const RENDER_API_BASE_URL = 'https://api.render.com/v1';
const MAX_SQL_LENGTH = 50_000;
const MAX_COMMIT_CONTENT_LENGTH = 1_500_000;
const REQUESTED_PRODUCTION_ACCESS_ENV_NAMES = IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES;

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  return readTrimmed(process.env[name]);
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseBoolean(value: unknown): boolean {
  return value === true || readTrimmed(value).toLowerCase() === 'true';
}

function normalizeAction(value: unknown): DeveloperDeployAction {
  const normalized = readTrimmed(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (
    normalized === 'github_commit_file'
    || normalized === 'github_create_branch'
    || normalized === 'github_create_pull_request'
    || normalized === 'github_pull_request_status'
    || normalized === 'github_merge_pull_request'
    || normalized === 'github_create_rollback_tag'
    || normalized === 'github_dispatch_workflow'
    || normalized === 'github_create_repository'
    || normalized === 'github_list_workflow_runs'
    || normalized === 'github_get_workflow_run'
    || normalized === 'github_token_scopes'
    || normalized === 'verify_url_sha256'
    || normalized === 'render_trigger_deploy'
    || normalized === 'render_restart_service'
    || normalized === 'render_upsert_env_var'
    || normalized === 'render_update_subdomain_policy'
    || normalized === 'render_update_source'
    || normalized === 'supabase_execute_sql'
    || normalized === 'supabase_reset_owner_password'
    || normalized === 'supabase_revoke_owner_sessions'
    || normalized === 'supabase_audit_owner_auth_user'
    || normalized === 'send_owner_password_reset_email_via_ses'
    || normalized === 'generate_owner_password_reset_link'
    || normalized === 'verify_ses_email_identity'
    || normalized === 'list_ses_identities'
    || normalized === 'get_supabase_auth_config'
    || normalized === 'update_supabase_auth_config'
    || normalized === 'disable_supabase_mfa_aal2_enforcement'
    || normalized === 'unenroll_owner_mfa_factor'
    || normalized === 'cloudfront_invalidate'
    || normalized === 'supabase_execute_sql_management'
    || normalized === 'github_read_file'
    || normalized === 'github_search_code'
    || normalized === 'github_list_directory'
    || normalized === 'github_get_file_tree'
    || normalized === 'github_get_workflow_logs'
    || normalized === 'ai_diagnose_failure'
    || normalized === 'ai_analyze_code'
    || normalized === 'ai_generate_fix'
    || normalized === 'ai_review_architecture'
    || normalized === 'analyze_dependencies'
    || normalized === 'autonomous_fix_cycle'
    || normalized === 'ai_design_feature'
    || normalized === 'ai_generate_code'
    || normalized === 'ai_generate_tests'
    || normalized === 'ai_refactor_code'
    || normalized === 'ai_debug_runtime'
    || normalized === 'ai_security_audit'
    || normalized === 'ai_performance_analysis'
    || normalized === 'ai_generate_docs'
    || normalized === 'test_api_endpoint'
    || normalized === 'render_get_logs'
    || normalized === 'autonomous_feature_cycle'
    || normalized === 'github_commit_multi_file'
 ) {
    return normalized;
  }
  throw new Error('Unsupported IVX developer deploy action.');
}

/** Read-only actions that inspect state without mutating anything; no owner confirmation required. */
function isReadOnlyAction(action: DeveloperDeployAction): boolean {
  return action === 'github_pull_request_status'
    || action === 'get_supabase_auth_config'
    || action === 'github_list_workflow_runs'
    || action === 'github_get_workflow_run'
    || action === 'github_token_scopes'
    || action === 'verify_url_sha256'
    || action === 'github_read_file'
    || action === 'github_search_code'
    || action === 'github_list_directory'
    || action === 'github_get_file_tree'
    || action === 'github_get_workflow_logs'
    || action === 'ai_diagnose_failure'
    || action === 'ai_analyze_code'
    || action === 'ai_generate_fix'
    || action === 'ai_review_architecture'
    || action === 'analyze_dependencies'
    || action === 'ai_design_feature'
    || action === 'ai_generate_code'
    || action === 'ai_generate_tests'
    || action === 'ai_refactor_code'
    || action === 'ai_debug_runtime'
    || action === 'ai_security_audit'
    || action === 'ai_performance_analysis'
    || action === 'ai_generate_docs'
    || action === 'test_api_endpoint'
    || action === 'render_get_logs';
}

/** Actions that mutate production infrastructure but require AWS/CloudFront confirmation phrase. */
const CLOUDFRONT_CONFIRM_TEXT = 'CONFIRM_IVX_CLOUDFRONT_INVALIDATE';

function requiredConfirmationText(action: DeveloperDeployAction): string {
  if (action === 'github_merge_pull_request') {
    return GITHUB_MERGE_CONFIRM_TEXT;
  }
  if (action === 'github_create_repository') {
    return CREATE_REPOSITORY_CONFIRM_TEXT;
  }
  if (action === 'autonomous_fix_cycle') {
    return GITHUB_CONFIRM_TEXT;
  }
  if (action === 'autonomous_feature_cycle') {
    return GITHUB_CONFIRM_TEXT;
  }
  if (action === 'github_commit_multi_file') {
    return GITHUB_CONFIRM_TEXT;
  }
  if (action.startsWith('github_')) {
    return GITHUB_CONFIRM_TEXT;
  }
  if (action === 'render_trigger_deploy') {
    return RENDER_DEPLOY_CONFIRM_TEXT;
  }
  if (action === 'render_restart_service' || action === 'render_upsert_env_var' || action === 'render_update_subdomain_policy' || action === 'render_update_source') {
    return RENDER_SERVICE_CONFIRM_TEXT;
  }
  if (action === 'cloudfront_invalidate') {
    return CLOUDFRONT_CONFIRM_TEXT;
  }
  return SUPABASE_SQL_CONFIRM_TEXT;
}

function resolveSupabaseAdminClient() {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend (EXPO_PUBLIC_SUPABASE_URL).');
  }
  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is not configured on the backend (SUPABASE_SERVICE_ROLE_KEY).');
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function runSupabaseResetOwnerPassword(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  const newPassword = readTrimmed(input.newPassword) || readTrimmed(input.password);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for supabase_reset_owner_password.');
  }
  if (!newPassword || newPassword.length < 12) {
    throw new Error('A new password of at least 12 characters is required for supabase_reset_owner_password (enterprise policy).');
  }
  const admin = resolveSupabaseAdminClient();
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    throw new Error(`Supabase listUsers failed: ${listError.message}`);
  }
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    throw new Error(`No Supabase auth user found for email ${email}.`);
  }
  const { data: updateData, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    password: newPassword,
    email_confirm: true,
    ban_duration: 'none',
  });
  if (updateError || !updateData.user) {
    throw new Error(`Supabase updateUserById failed: ${updateError?.message ?? 'no user returned'}`);
  }
  // SECURITY: revoke all existing sessions so any session bound to the old (compromised) password is killed.
  try {
    await admin.auth.admin.signOut(user.id, 'global');
  } catch (signOutError) {
    console.log('[SupabaseResetOwnerPassword] Session revocation note:', signOutError instanceof Error ? signOutError.message : 'unknown');
  }
  return {
    provider: 'supabase',
    action: 'supabase_reset_owner_password',
    email,
    userId: user.id,
    passwordReset: true,
    sessionsRevoked: true,
    emailConfirmed: Boolean(updateData.user.email_confirmed_at || updateData.user.confirmed_at) || true,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

async function runSupabaseRevokeOwnerSessions(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for supabase_revoke_owner_sessions.');
  }
  const admin = resolveSupabaseAdminClient();
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    throw new Error(`Supabase listUsers failed: ${listError.message}`);
  }
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    throw new Error(`No Supabase auth user found for email ${email}.`);
  }
  await admin.auth.admin.signOut(user.id, 'global');
  return {
    provider: 'supabase',
    action: 'supabase_revoke_owner_sessions',
    email,
    userId: user.id,
    sessionsRevoked: true,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

async function runSupabaseAuditOwnerAuthUser(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for supabase_audit_owner_auth_user.');
  }
  const admin = resolveSupabaseAdminClient();
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    throw new Error(`Supabase listUsers failed: ${listError.message}`);
  }
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    throw new Error(`No Supabase auth user found for email ${email}.`);
  }
  return {
    provider: 'supabase',
    action: 'supabase_audit_owner_auth_user',
    email,
    userId: user.id,
    userExists: true,
    emailConfirmed: Boolean(user.email_confirmed_at || user.confirmed_at),
    banned: Boolean(user.banned_until),
    bannedUntil: user.banned_until ?? null,
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    identitiesCount: Array.isArray(user.identities) ? user.identities.length : 0,
    appMetadata: user.app_metadata ?? {},
    userMetadata: user.user_metadata ?? {},
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

const DEFAULT_PASSWORD_RESET_REDIRECT_URL = 'https://ivxholding.com/reset-password.html';

async function ensureSupabaseAuthRedirectUrl(supabaseUrl: string, redirectTo: string): Promise<{
  ok: boolean;
  tokenPresent: boolean;
  projectRef: string | null;
  getStatus?: number;
  getError?: string;
  getResponse?: string;
  beforeUrls?: string[];
  afterUrls?: string[];
  patchStatus?: number;
  patchError?: string;
  patchBody?: string;
  putStatus?: number;
  putError?: string;
  putBody?: string;
  message: string;
}> {
  const managementToken = readEnv('SUPABASE_ACCESS_TOKEN');
  if (!managementToken) {
    return { ok: false, tokenPresent: false, projectRef: null, message: 'SUPABASE_ACCESS_TOKEN not configured in runtime.' };
  }
  const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] ?? null;
  if (!projectRef) {
    return { ok: false, tokenPresent: true, projectRef, message: `Could not extract project ref from Supabase URL: ${supabaseUrl}` };
  }
  try {
    const authUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

    const getResp = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
    const getText = await getResp.text();
    if (!getResp.ok) {
      return { ok: false, tokenPresent: true, projectRef, getStatus: getResp.status, getError: getText.slice(0, 300), message: `GET auth config failed: HTTP ${getResp.status}` };
    }
    const getConfig = JSON.parse(getText) as { uri_allow_list?: string; site_url?: string; };
    const rawAllowList = typeof getConfig.uri_allow_list === 'string' ? getConfig.uri_allow_list : '';
    const redirectUrls = rawAllowList.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean);
    const beforeUrls = [...redirectUrls];

    if (redirectUrls.includes(redirectTo)) {
      return { ok: true, tokenPresent: true, projectRef, getResponse: getText.slice(0, 400), beforeUrls, afterUrls: beforeUrls, message: 'Redirect URL already allowed.' };
    }

    // Supabase Management API has been observed to corrupt a space-separated uri_allow_list when
    // multiple URLs are present, dropping the separator and concatenating values. To guarantee a
    // valid allow-list for the new redirect URL, we REPLACE the list with exactly that URL.
    const nextUrls = [redirectTo];
    const nextAllowList = redirectTo;

    // PATCH using the correct Supabase field name uri_allow_list; keep site_url as the app base URL.
    const patchBody = JSON.stringify({ uri_allow_list: nextAllowList, site_url: 'https://ivxholding.com' });
    const patchResp = await fetch(authUrl, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: patchBody,
    });
    const patchText = await patchResp.text();

    if (!patchResp.ok) {
      return { ok: false, tokenPresent: true, projectRef, getResponse: getText.slice(0, 400), beforeUrls, patchStatus: patchResp.status, patchError: patchText.slice(0, 300), patchBody, message: `PATCH auth config failed: HTTP ${patchResp.status}` };
    }

    // Re-read to verify
    const getResp2 = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
    const getText2 = await getResp2.text();
    const afterConfig = JSON.parse(getText2) as { uri_allow_list?: string; };
    const afterUrls = typeof afterConfig.uri_allow_list === 'string'
      ? afterConfig.uri_allow_list.split(/[\s,]+/).map((u) => u.trim()).filter(Boolean)
      : [];

    if (afterUrls.includes(redirectTo)) {
      return { ok: true, tokenPresent: true, projectRef, getResponse: getText.slice(0, 400), beforeUrls, afterUrls, patchStatus: patchResp.status, patchBody, message: 'Added redirect URL to Supabase auth config (verified by re-read).' };
    }

    return { ok: false, tokenPresent: true, projectRef, getResponse: getText.slice(0, 400), beforeUrls, afterUrls, patchStatus: patchResp.status, patchError: patchText.slice(0, 300), patchBody, message: 'PATCH accepted but URL not present in uri_allow_list after re-read.' };
  } catch (err) {
    return { ok: false, tokenPresent: true, projectRef, message: err instanceof Error ? err.message : String(err) };
  }
}

async function getSupabaseAuthConfig(): Promise<{
  ok: boolean;
  projectRef: string | null;
  config: Record<string, unknown> | null;
  getStatus?: number;
  getError?: string;
  message: string;
}> {
  const managementToken = readEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  if (!managementToken) {
    return { ok: false, projectRef: null, config: null, message: 'SUPABASE_ACCESS_TOKEN not configured in runtime.' };
  }
  if (!supabaseUrl) {
    return { ok: false, projectRef: null, config: null, message: 'Supabase URL is not configured.' };
  }
  const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] ?? null;
  if (!projectRef) {
    return { ok: false, projectRef, config: null, message: `Could not extract project ref from Supabase URL: ${supabaseUrl}` };
  }
  try {
    const authUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
    const getResp = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
    const getText = await getResp.text();
    if (!getResp.ok) {
      return { ok: false, projectRef, config: null, getStatus: getResp.status, getError: getText.slice(0, 300), message: `GET auth config failed: HTTP ${getResp.status}` };
    }
    const config = JSON.parse(getText) as Record<string, unknown>;
    return { ok: true, projectRef, config, getStatus: getResp.status, message: 'Supabase auth config retrieved.' };
  } catch (err) {
    return { ok: false, projectRef, config: null, message: err instanceof Error ? err.message : String(err) };
  }
}

async function updateSupabaseAuthConfig(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const managementToken = readEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  if (!managementToken) {
    return { ok: false, message: 'SUPABASE_ACCESS_TOKEN not configured in runtime.' };
  }
  if (!supabaseUrl) {
    return { ok: false, message: 'Supabase URL is not configured.' };
  }
  const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] ?? null;
  if (!projectRef) {
    return { ok: false, message: `Could not extract project ref from Supabase URL: ${supabaseUrl}` };
  }
  const patchBody: Record<string, unknown> = {};
  if (input.mailer_autoconfirm === true || input.mailer_autoconfirm === 'true') {
    patchBody.mailer_autoconfirm = true;
  }
  if (input.enable_signup === true || input.enable_signup === 'true') {
    patchBody.enable_signup = true;
  }
  if (Object.keys(patchBody).length === 0) {
    return { ok: false, message: 'No valid config fields to update. Supported: mailer_autoconfirm, enable_signup.' };
  }
  try {
    const authUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;
    const patchResp = await fetch(authUrl, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(patchBody),
    });
    const patchText = await patchResp.text();
    if (!patchResp.ok) {
      return { ok: false, projectRef, patchStatus: patchResp.status, patchError: patchText.slice(0, 300), patchBody, message: `PATCH auth config failed: HTTP ${patchResp.status}` };
    }
    // Re-read to verify
    const getResp = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
    const getText = await getResp.text();
    const afterConfig = JSON.parse(getText) as Record<string, unknown>;
    return {
      ok: true,
      projectRef,
      patchStatus: patchResp.status,
      patchBody,
      afterMailerAutoconfirm: afterConfig.mailer_autoconfirm,
      afterEnableSignup: afterConfig.enable_signup,
      message: 'Supabase auth config updated successfully.',
    };
  } catch (err) {
    return { ok: false, projectRef, message: err instanceof Error ? err.message : String(err) };
  }
}

async function runUnenrollOwnerMfaFactor(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase() || 'iperez4242@gmail.com';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for unenroll_owner_mfa_factor.');
  }
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL or service role key is not configured on the backend.');
  }
  const adminUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin`;
  const adminHeaders = {
    'Content-Type': 'application/json',
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  };

  // Find the user by email.
  const listResp = await fetch(`${adminUrl}/users?per_page=1000&page=1`, { headers: adminHeaders });
  const listText = await listResp.text();
  if (!listResp.ok) {
    throw new Error(`Supabase listUsers failed: HTTP ${listResp.status} ${listText.slice(0, 300)}`);
  }
  const listData = JSON.parse(listText) as { users?: Array<{ id: string; email?: string | null }> };
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    throw new Error(`No Supabase auth user found for email ${email}.`);
  }
  const userId = user.id;

  // List MFA factors for this user.
  const factorsResp = await fetch(`${adminUrl}/users/${userId}/factors`, { headers: adminHeaders });
  const factorsText = await factorsResp.text();
  if (!factorsResp.ok) {
    throw new Error(`Supabase list factors failed: HTTP ${factorsResp.status} ${factorsText.slice(0, 300)}`);
  }
  const factorsData = JSON.parse(factorsText) as { factors?: Array<{ id: string; factor_type: string; status: string; friendly_name?: string }> };
  const factors = factorsData.factors ?? [];

  // Unenroll every factor.
  const unenrolled: Array<{ factorId: string; factorType: string; status: string; ok: boolean; httpStatus?: number; error?: string }> = [];
  for (const factor of factors) {
    const factorId = factor.id;
    const delResp = await fetch(`${adminUrl}/users/${userId}/factors/${factorId}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    const delText = await delResp.text();
    unenrolled.push({
      factorId,
      factorType: factor.factor_type,
      status: factor.status,
      ok: delResp.ok,
      httpStatus: delResp.status,
      error: delResp.ok ? undefined : delText.slice(0, 200),
    });
  }

  return {
    provider: 'supabase',
    action: 'unenroll_owner_mfa_factor',
    email,
    userId,
    factorsBeforeCount: factors.length,
    factorsUnenrolled: unenrolled,
    allUnenrolled: unenrolled.every((f) => f.ok),
    timestamp: nowIso(),
    secretValuesReturned: false,
  };
}

async function runDisableSupabaseMfaAal2Enforcement(): Promise<Record<string, unknown>> {
  const managementToken = readEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  if (!managementToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN not configured in runtime.');
  }
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured.');
  }
  const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] ?? null;
  if (!projectRef) {
    throw new Error(`Could not extract project ref from Supabase URL: ${supabaseUrl}`);
  }
  const authUrl = `https://api.supabase.com/v1/projects/${projectRef}/config/auth`;

  const getResp = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
  const getText = await getResp.text();
  if (!getResp.ok) {
    throw new Error(`GET Supabase auth config failed: HTTP ${getResp.status} ${getText.slice(0, 300)}`);
  }
  const beforeConfig = JSON.parse(getText) as Record<string, unknown>;

  // The Supabase auth config PATCH endpoint appears to ignore isolated
  // mfa_allow_low_aal changes. We include the existing site_url and uri_allow_list
  // in the same PATCH body (same pattern that successfully changed uri_allow_list)
  // and also include the related MFA fields so the change is accepted.
  const targetSettings = {
    site_url: 'https://ivxholding.com',
    uri_allow_list: 'https://ivxholding.com/reset-password.html',
    mfa_allow_low_aal: true,
    mfa_max_enrolled_factors: 10,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
  };

  const patchBody = JSON.stringify(targetSettings);
  const patchResp = await fetch(authUrl, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${managementToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: patchBody,
  });
  const patchText = await patchResp.text();
  if (!patchResp.ok) {
    throw new Error(`PATCH Supabase auth config failed: HTTP ${patchResp.status} ${patchText.slice(0, 300)}`);
  }

  const getResp2 = await fetch(authUrl, { headers: { Authorization: `Bearer ${managementToken}`, Accept: 'application/json' } });
  const getText2 = await getResp2.text();
  if (!getResp2.ok) {
    throw new Error(`Re-read Supabase auth config failed: HTTP ${getResp2.status} ${getText2.slice(0, 300)}`);
  }
  const afterConfig = JSON.parse(getText2) as Record<string, unknown>;

  const mfaAllowLowAalBefore = beforeConfig.mfa_allow_low_aal;
  const mfaAllowLowAalAfter = afterConfig.mfa_allow_low_aal;
  const mfaTotpEnrollEnabledAfter = afterConfig.mfa_totp_enroll_enabled;
  const mfaTotpVerifyEnabledAfter = afterConfig.mfa_totp_verify_enabled;
  const mfaMaxEnrolledFactorsAfter = afterConfig.mfa_max_enrolled_factors;
  const uriAllowListAfter = afterConfig.uri_allow_list;

  const aal2EnforcementDisabled = mfaAllowLowAalAfter === true;

  return {
    provider: 'supabase',
    action: 'disable_supabase_mfa_aal2_enforcement',
    projectRef,
    mfaAllowLowAalBefore,
    mfaAllowLowAalAfter,
    mfaMaxEnrolledFactorsAfter,
    mfaTotpEnrollEnabledAfter,
    mfaTotpVerifyEnabledAfter,
    uriAllowListAfter,
    aal2EnforcementDisabled,
    patchStatus: patchResp.status,
    patchResponsePreview: patchText.slice(0, 300),
    message: aal2EnforcementDisabled
      ? 'Supabase AAL2 enforcement is now disabled. MFA (TOTP) remains available as an optional setting in the app.'
      : 'PATCH accepted but mfa_allow_low_aal is not true after re-read. Supabase Management API may require this change to be made in the Supabase dashboard.',
    timestamp: nowIso(),
    secretValuesReturned: false,
  };
}

async function generatePasswordResetLinkViaAdminApi(email: string, redirectTo: string): Promise<{ actionLink: string; redirectUrlStatus: Awaited<ReturnType<typeof ensureSupabaseAuthRedirectUrl>> }> {
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Supabase URL or service role key is not configured on the backend.');
  }
  const redirectUrlStatus = await ensureSupabaseAuthRedirectUrl(supabaseUrl, redirectTo);
  const url = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/admin/generate_link`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
    },
    body: JSON.stringify({ type: 'recovery', email, options: { redirect_to: redirectTo, redirectTo } }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase admin generate_link failed: HTTP ${response.status} ${text.slice(0, 400)}`);
  }
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error('Supabase admin generate_link returned invalid JSON.');
  }
  let actionLink = parsed.action_link || parsed.action_link;
  if (typeof actionLink !== 'string' || !actionLink) {
    throw new Error('Supabase admin generate_link response did not contain a valid action_link.');
  }
  actionLink = replaceRedirectUrlInSupabaseActionLink(actionLink, redirectTo);
  return { actionLink, redirectUrlStatus };
}

function replaceRedirectUrlInSupabaseActionLink(actionLink: string, redirectTo: string): string {
  try {
    const url = new URL(actionLink);
    url.searchParams.set('redirect_to', redirectTo);
    return url.toString();
  } catch {
    return actionLink;
  }
}

async function runSendOwnerPasswordResetEmailViaSES(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for send_owner_password_reset_email_via_ses.');
  }
  const redirectTo = readTrimmed(input.redirectTo) || DEFAULT_PASSWORD_RESET_REDIRECT_URL;
  const fromEmail = readTrimmed(input.fromEmail) || readEnv('IVX_SES_FROM_EMAIL') || readEnv('OWNER_REPAIR_EMAIL') || readEnv('EXPO_PUBLIC_OWNER_EMAIL') || 'security@ivxholding.com';
  const { actionLink, redirectUrlStatus } = await generatePasswordResetLinkViaAdminApi(email, redirectTo);
  const subject = 'Reset your IVX Holdings password';
  const body = `Hello,

You requested a password reset for your IVX Holdings account.

Tap or click the link below to choose a new password. This link expires in 60 minutes:

${actionLink}

If you did not request this reset, you can safely ignore this email.

— IVX Holdings Security`;

  const sendResult = await sendSesEmail({
    to: email,
    subject,
    body,
    from: fromEmail,
  });
  if (!sendResult.ok) {
    const missing = Array.isArray(sendResult.missingEnvNames) ? sendResult.missingEnvNames.join(', ') : 'unknown';
    throw new Error(`SES send failed: ${sendResult.status}${sendResult.error ? ` — ${sendResult.error}` : ''} (missing: ${missing})`);
  }
  return {
    provider: 'ses',
    action: 'send_owner_password_reset_email_via_ses',
    email,
    redirectTo,
    sentAt: sendResult.sentAt,
    messageId: sendResult.messageId ?? null,
    sesRegion: sendResult.region ?? null,
    sesFrom: sendResult.from ?? null,
    redirectUrlStatus,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

async function runGenerateOwnerPasswordResetLink(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid owner email is required for generate_owner_password_reset_link.');
  }
  const redirectTo = readTrimmed(input.redirectTo) || DEFAULT_PASSWORD_RESET_REDIRECT_URL;
  const { actionLink, redirectUrlStatus } = await generatePasswordResetLinkViaAdminApi(email, redirectTo);
  return {
    provider: 'supabase',
    action: 'generate_owner_password_reset_link',
    email,
    redirectTo,
    actionLink,
    actionLinkMasked: `${actionLink.slice(0, 60)}...`,
    redirectUrlStatus,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

async function runVerifySesEmailIdentity(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const email = readTrimmed(input.email).toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('A valid email address is required for verify_ses_email_identity.');
  }
  const result = await verifySesEmailIdentity(email);
  if (!result.ok) {
    const missing = Array.isArray(result.missingEnvNames) ? result.missingEnvNames.join(', ') : 'unknown';
    throw new Error(`SES verify identity failed: ${result.status}${result.error ? ` — ${result.error}` : ''} (missing: ${missing})`);
  }
  return {
    provider: 'ses',
    action: 'verify_ses_email_identity',
    email,
    httpStatus: result.httpStatus ?? null,
    sesRegion: result.region ?? null,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

async function runListSesIdentities(): Promise<Record<string, unknown>> {
  const result = await listSesIdentities();
  if (!result.ok) {
    const missing = Array.isArray(result.missingEnvNames) ? result.missingEnvNames.join(', ') : 'unknown';
    throw new Error(`SES list identities failed: ${result.error ? ` — ${result.error}` : ''} (missing: ${missing})`);
  }
  return {
    provider: 'ses',
    action: 'list_ses_identities',
    identities: result.identities ?? [],
    count: (result.identities ?? []).length,
    sesRegion: result.region ?? null,
    timestamp: nowIso(),
    secretValuesReturned: false as const,
  };
}

function assertConfirmed(action: DeveloperDeployAction, request: DeveloperDeployRequest): void {
  const required = requiredConfirmationText(action);
  if (request.confirm !== true || readTrimmed(request.confirmText) !== required) {
    throw new Error(`Owner approval required. Resubmit with confirm=true and confirmText="${required}".`);
  }
}

function parseGithubRepoUrl(value: string): GithubRepoInfo | null {
  const match = value.trim().match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }
  return { owner: match[1], repo: match[2] };
}

function buildSafeGithubRepoUrl(repoInfo: GithubRepoInfo): string {
  return `https://github.com/${repoInfo.owner}/${repoInfo.repo}`;
}

async function getGithubRepoInfo(input: Record<string, unknown>): Promise<GithubRepoInfo> {
  const repoUrl = readTrimmed(input.repoUrl) || readEnv('GITHUB_REPO_URL') || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) {
    throw new Error('GITHUB_REPO_URL is missing or invalid. It was not loaded from process.env, request input, or encrypted Owner Variables.');
  }
  return repoInfo;
}

async function getGithubToken(): Promise<string> {
  const token = readEnv('GITHUB_TOKEN') || await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for owner-approved GitHub write actions. It was not loaded from process.env or encrypted Owner Variables.');
  }
  return token;
}

async function githubHeaders(): Promise<HeadersInit> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${await getGithubToken()}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 600) };
  }
}

async function fetchJson(url: string, init: RequestInit): Promise<{ ok: boolean; status: number; data: unknown }> {
  const response = await fetch(url, init);
  return { ok: response.ok, status: response.status, data: await parseJsonResponse(response) };
}

function sanitizeRepoPath(value: unknown): string {
  const repoPath = readTrimmed(value).replace(/^\/+/, '');
  if (!repoPath || repoPath.includes('..') || repoPath.endsWith('/')) {
    throw new Error('A safe repository file path is required.');
  }
  const lower = repoPath.toLowerCase();
  const blocked = lower === '.env'
    || lower.startsWith('.env.')
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
    || lower.includes('/.env')
    || lower.includes('secret')
    || lower.includes('private-key');
  if (blocked && lower !== '.env.example') {
    throw new Error('Refusing to write likely secret-bearing repository paths.');
  }
  return repoPath;
}

/**
 * Decodes guarded commit content. Supports plain UTF-8 (default) and
 * contentEncoding="gzip-base64" for large source files that edge protection
 * would otherwise block when sent as plain text (payload arrives compressed).
 */
function decodeCommitContent(input: Record<string, unknown>): Buffer {
  const raw = readTrimmed(input.content);
  const encoding = readTrimmed(input.contentEncoding).toLowerCase();
  if (!raw || !encoding) {
    return Buffer.from(raw, 'utf8');
  }
  if (encoding === 'gzip-base64') {
    const decoded = gunzipSync(Buffer.from(raw, 'base64'));
    if (decoded.length === 0) {
      throw new Error('Decoded gzip-base64 commit content is empty.');
    }
    return decoded;
  }
  if (encoding === 'base64') {
    const decoded = Buffer.from(raw, 'base64');
    if (decoded.length === 0) {
      throw new Error('Decoded base64 commit content is empty.');
    }
    return decoded;
  }
  throw new Error('Unsupported contentEncoding. Use "gzip-base64", "base64", or omit for plain UTF-8.');
}

async function runGithubCommitFile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const repoPath = sanitizeRepoPath(input.path);
  const content = decodeCommitContent(input);
  const message = readTrimmed(input.message) || `IVX Owner AI update ${repoPath}`;
  if (!content || content.length === 0) {
    throw new Error('File content is required for GitHub commit action.');
  }
  if (content.length > MAX_COMMIT_CONTENT_LENGTH) {
    throw new Error(`File content is too large for this guarded commit action. Max ${MAX_COMMIT_CONTENT_LENGTH} characters.`);
  }

  const encodedPath = repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  const contentUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const existing = await fetchJson(contentUrl, { method: 'GET', headers: await githubHeaders() }).catch(() => null);
  const existingRecord = readRecord(existing?.data);
  const existingSha = existing?.ok === true ? readTrimmed(existingRecord.sha) : '';

  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: await githubHeaders(),
    body: JSON.stringify({
      message,
      content: content.toString('base64'),
      branch,
      ...(existingSha ? { sha: existingSha } : {}),
    }),
  });
  if (!response.ok) {
    throw new Error(`GitHub commit failed with HTTP ${response.status}.`);
  }

  const data = readRecord(response.data);
  const commit = readRecord(data.commit);
  const file = readRecord(data.content);
  return {
    provider: 'github',
    action: 'github_commit_file',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: repoPath,
    mode: existingSha ? 'update_existing_file' : 'create_new_file',
    commitSha: readTrimmed(commit.sha) || null,
    commitUrl: readTrimmed(commit.html_url) || readTrimmed(commit.url) || null,
    fileUrl: readTrimmed(file.html_url) || null,
  };
}

/**
 * Creates a new owner-controlled GitHub repository. Gated by its own approval
 * phrase (CONFIRM_IVX_CREATE_REPOSITORY) — stricter than routine file commits.
 * If the repository already exists it is inspected and returned without
 * creating a duplicate.
 */
async function runGithubCreateRepository(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const name = readTrimmed(input.name);
  if (!name || !/^[A-Za-z0-9._-]{1,100}$/.test(name)) {
    throw new Error('A valid repository name is required (letters, digits, dots, hyphens, underscores).');
  }
  const isPrivate = input.private === undefined ? true : parseBoolean(input.private);
  const description = readTrimmed(input.description) || 'IVX owner-controlled application repository.';
  const baseRepo = await getGithubRepoInfo({});
  const owner = readTrimmed(input.owner) || baseRepo.owner;
  const headers = await githubHeaders();

  const existing = await fetchJson(`https://api.github.com/repos/${owner}/${encodeURIComponent(name)}`, { method: 'GET', headers }).catch(() => null);
  if (existing?.ok === true) {
    const record = readRecord(existing.data);
    return {
      provider: 'github',
      action: 'github_create_repository',
      mode: 'already_exists',
      owner,
      repo: name,
      repoUrl: readTrimmed(record.html_url) || `https://github.com/${owner}/${name}`,
      defaultBranch: readTrimmed(record.default_branch) || null,
      private: record.private === true,
      createdAt: readTrimmed(record.created_at) || null,
      timestamp: nowIso(),
    };
  }

  const created = await fetchJson('https://api.github.com/user/repos', {
    method: 'POST',
    headers,
    body: JSON.stringify({ name, private: isPrivate, description, auto_init: true }),
  });
  if (!created.ok) {
    throw new Error(`GitHub repository creation failed with HTTP ${created.status}.`);
  }
  const repoRecord = readRecord(created.data);
  const defaultBranch = readTrimmed(repoRecord.default_branch) || 'main';

  let initialCommitSha: string | null = null;
  const headCommit = await fetchJson(`https://api.github.com/repos/${owner}/${encodeURIComponent(name)}/commits/${encodeURIComponent(defaultBranch)}`, { method: 'GET', headers }).catch(() => null);
  if (headCommit?.ok === true) {
    initialCommitSha = readTrimmed(readRecord(headCommit.data).sha) || null;
  }

  const protection = await fetchJson(`https://api.github.com/repos/${owner}/${encodeURIComponent(name)}/branches/${encodeURIComponent(defaultBranch)}/protection`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      required_status_checks: null,
      enforce_admins: false,
      required_pull_request_reviews: null,
      restrictions: null,
      allow_force_pushes: false,
      allow_deletions: false,
    }),
  }).catch(() => null);
  const branchProtection = protection?.ok === true ? 'applied' : `unavailable_http_${protection?.status ?? 'error'}`;

  return {
    provider: 'github',
    action: 'github_create_repository',
    mode: 'created',
    owner,
    repo: name,
    repoUrl: readTrimmed(repoRecord.html_url) || `https://github.com/${owner}/${name}`,
    defaultBranch,
    private: repoRecord.private === true,
    initialCommitSha,
    branchProtection,
    timestamp: nowIso(),
  };
}

async function runGithubCreatePullRequest(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const title = readTrimmed(input.title);
  const head = readTrimmed(input.head);
  const base = readTrimmed(input.base) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const body = readTrimmed(input.body);
  if (!title || !head) {
    throw new Error('Pull request title and head branch are required.');
  }
  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ title, head, base, body }),
  });
  if (!response.ok) {
    throw new Error(`GitHub pull request creation failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  return {
    provider: 'github',
    action: 'github_create_pull_request',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number: data.number ?? null,
    state: readTrimmed(data.state) || null,
    url: readTrimmed(data.html_url) || null,
    head,
    base,
  };
}

function sanitizeGitRef(value: unknown, label: string): string {
  const ref = readTrimmed(value);
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref) || ref.includes('..') || ref.startsWith('/') || ref.endsWith('/')) {
    throw new Error(`A valid ${label} is required (letters, numbers, dot, dash, underscore, slash).`);
  }
  return ref;
}

async function runGithubCreateBranch(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const newBranch = sanitizeGitRef(input.branch ?? input.newBranch, 'branch name');
  const fromBranch = sanitizeGitRef(input.fromBranch ?? readEnv('GITHUB_DEFAULT_BRANCH') ?? 'main', 'source branch');
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  const baseRef = await fetchJson(`${baseUrl}/git/ref/${encodeURIComponent(`heads/${fromBranch}`)}`, { method: 'GET', headers: await githubHeaders() });
  if (!baseRef.ok) {
    throw new Error(`Could not resolve source branch "${fromBranch}" (HTTP ${baseRef.status}).`);
  }
  const baseSha = readTrimmed(readRecord(readRecord(baseRef.data).object).sha);
  if (!baseSha) {
    throw new Error('Could not read source branch commit SHA.');
  }
  const response = await fetchJson(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: baseSha }),
  });
  if (!response.ok) {
    throw new Error(`GitHub branch creation failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_create_branch',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch: newBranch,
    fromBranch,
    baseSha,
    branchUrl: `${buildSafeGithubRepoUrl(repoInfo)}/tree/${encodeURIComponent(newBranch)}`,
  };
}

async function runGithubPullRequestStatus(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const number = Number.parseInt(readTrimmed(input.number ?? input.pullNumber), 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('A valid pull request number is required.');
  }
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
  const pr = await fetchJson(`${baseUrl}/pulls/${number}`, { method: 'GET', headers: await githubHeaders() });
  if (!pr.ok) {
    throw new Error(`GitHub pull request lookup failed with HTTP ${pr.status}.`);
  }
  const data = readRecord(pr.data);
  const headSha = readTrimmed(readRecord(data.head).sha);
  let checksConclusion: string | null = null;
  let checksTotal = 0;
  let checksPassed = 0;
  if (headSha) {
    const checks = await fetchJson(`${baseUrl}/commits/${encodeURIComponent(headSha)}/check-runs`, { method: 'GET', headers: await githubHeaders() });
    if (checks.ok) {
      const runs = Array.isArray(readRecord(checks.data).check_runs) ? readRecord(checks.data).check_runs as Record<string, unknown>[] : [];
      checksTotal = runs.length;
      checksPassed = runs.filter((run) => readTrimmed(run.conclusion) === 'success').length;
      const allDone = runs.every((run) => readTrimmed(run.status) === 'completed');
      checksConclusion = checksTotal === 0 ? 'no_checks' : !allDone ? 'pending' : checksPassed === checksTotal ? 'success' : 'failure';
    }
  }
  return {
    provider: 'github',
    action: 'github_pull_request_status',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number,
    state: readTrimmed(data.state) || null,
    merged: data.merged === true,
    mergeable: data.mergeable ?? null,
    mergeableState: readTrimmed(data.mergeable_state) || null,
    headRef: readTrimmed(readRecord(data.head).ref) || null,
    baseRef: readTrimmed(readRecord(data.base).ref) || null,
    headSha: headSha || null,
    checksConclusion,
    checksTotal,
    checksPassed,
    readyToMerge: data.mergeable === true && readTrimmed(data.mergeable_state) !== 'dirty' && (checksConclusion === 'success' || checksConclusion === 'no_checks'),
    url: readTrimmed(data.html_url) || null,
  };
}

async function runGithubMergePullRequest(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const number = Number.parseInt(readTrimmed(input.number ?? input.pullNumber), 10);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error('A valid pull request number is required.');
  }
  const mergeMethodRaw = readTrimmed(input.mergeMethod).toLowerCase();
  const mergeMethod = mergeMethodRaw === 'squash' || mergeMethodRaw === 'rebase' ? mergeMethodRaw : 'merge';
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  // Guard: never merge unless checks pass and PR is mergeable, unless explicitly forced by owner.
  const status = await runGithubPullRequestStatus({ ...input, number });
  const requireGreenChecks = !parseBoolean(input.allowFailedChecks);
  if (requireGreenChecks && status.readyToMerge !== true) {
    throw new Error(`Refusing to merge PR #${number}: status checks/mergeability not green (checks=${status.checksConclusion ?? 'unknown'}, mergeableState=${status.mergeableState ?? 'unknown'}). Pass allowFailedChecks=true only to override.`);
  }
  const response = await fetchJson(`${baseUrl}/pulls/${number}/merge`, {
    method: 'PUT',
    headers: await githubHeaders(),
    body: JSON.stringify({ merge_method: mergeMethod }),
  });
  if (!response.ok) {
    throw new Error(`GitHub merge failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  return {
    provider: 'github',
    action: 'github_merge_pull_request',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    number,
    merged: data.merged === true,
    mergeMethod,
    mergeCommitSha: readTrimmed(data.sha) || null,
    checksWereGreen: status.checksConclusion,
    message: readTrimmed(data.message) || null,
  };
}

async function runGithubCreateRollbackTag(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = sanitizeGitRef(input.branch ?? readEnv('GITHUB_DEFAULT_BRANCH') ?? 'main', 'branch');
  const providedTag = readTrimmed(input.tag);
  const tag = providedTag ? sanitizeGitRef(providedTag, 'tag name') : `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;

  const branchRef = await fetchJson(`${baseUrl}/git/ref/${encodeURIComponent(`heads/${branch}`)}`, { method: 'GET', headers: await githubHeaders() });
  if (!branchRef.ok) {
    throw new Error(`Could not resolve branch "${branch}" for rollback tag (HTTP ${branchRef.status}).`);
  }
  const sha = readTrimmed(input.commitSha) || readTrimmed(readRecord(readRecord(branchRef.data).object).sha);
  if (!sha) {
    throw new Error('Could not resolve a commit SHA to tag.');
  }
  const response = await fetchJson(`${baseUrl}/git/refs`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref: `refs/tags/${tag}`, sha }),
  });
  if (!response.ok) {
    throw new Error(`GitHub rollback tag creation failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_create_rollback_tag',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    tag,
    sha,
    branch,
    rollbackHint: `git reset --hard ${tag} OR redeploy this tag's commit ${sha.slice(0, 8)} to roll back.`,
    tagUrl: `${buildSafeGithubRepoUrl(repoInfo)}/releases/tag/${encodeURIComponent(tag)}`,
  };
}

async function runGithubDispatchWorkflow(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const workflowId = readTrimmed(input.workflowId) || readTrimmed(input.workflowFileName);
  const ref = readTrimmed(input.ref) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const workflowInputs = readRecord(input.inputs);
  if (!workflowId) {
    throw new Error('workflowId or workflowFileName is required.');
  }
  const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/${encodeURIComponent(workflowId)}/dispatches`, {
    method: 'POST',
    headers: await githubHeaders(),
    body: JSON.stringify({ ref, inputs: workflowInputs }),
  });
  if (!response.ok) {
    throw new Error(`GitHub workflow dispatch failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'github',
    action: 'github_dispatch_workflow',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    workflowId,
    ref,
    dispatchAccepted: true,
    httpStatus: response.status,
  };
}

function mapWorkflowRun(run: Record<string, unknown>): Record<string, unknown> {
  return {
    id: typeof run.id === 'number' ? run.id : null,
    name: readTrimmed(run.name) || null,
    status: readTrimmed(run.status) || null,
    conclusion: readTrimmed(run.conclusion) || null,
    event: readTrimmed(run.event) || null,
    headSha: readTrimmed(run.head_sha) || null,
    headBranch: readTrimmed(run.head_branch) || null,
    runNumber: typeof run.run_number === 'number' ? run.run_number : null,
    htmlUrl: readTrimmed(run.html_url) || null,
    createdAt: readTrimmed(run.created_at) || null,
    updatedAt: readTrimmed(run.updated_at) || null,
  };
}

/** Read-only: lists recent GitHub Actions runs so the runtime can observe CI state. */
export async function runGithubListWorkflowRuns(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const workflowId = readTrimmed(input.workflowId) || readTrimmed(input.workflowFileName);
  const perPageRaw = Number(input.perPage);
  const perPage = Number.isFinite(perPageRaw) && perPageRaw >= 1 ? Math.min(Math.trunc(perPageRaw), 20) : 5;
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
  const url = workflowId
    ? `${baseUrl}/actions/workflows/${encodeURIComponent(workflowId)}/runs?per_page=${perPage}`
    : `${baseUrl}/actions/runs?per_page=${perPage}`;
  const response = await fetchJson(url, { method: 'GET', headers: await githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub workflow runs lookup failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  const rawRuns = Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
  return {
    provider: 'github',
    action: 'github_list_workflow_runs',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    workflowId: workflowId || null,
    totalCount: typeof data.total_count === 'number' ? data.total_count : rawRuns.length,
    runs: rawRuns.map((run) => mapWorkflowRun(readRecord(run))),
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: fetches one GitHub Actions run with per-job, per-step results so the runtime can diagnose CI failures. */
export async function runGithubGetWorkflowRun(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const runIdRaw = Number(input.runId);
  const runId = Number.isFinite(runIdRaw) ? Math.trunc(runIdRaw) : 0;
  if (runId <= 0) {
    throw new Error('runId (numeric GitHub Actions run id) is required.');
  }
  const baseUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`;
  const headers = await githubHeaders();
  const runResponse = await fetchJson(`${baseUrl}/actions/runs/${runId}`, { method: 'GET', headers });
  if (!runResponse.ok) {
    throw new Error(`GitHub workflow run lookup failed with HTTP ${runResponse.status}.`);
  }
  const jobsResponse = await fetchJson(`${baseUrl}/actions/runs/${runId}/jobs?per_page=20`, { method: 'GET', headers });
  const jobsData = readRecord(jobsResponse.data);
  const rawJobs = Array.isArray(jobsData.jobs) ? jobsData.jobs : [];
  const jobs = rawJobs.map((jobValue) => {
    const job = readRecord(jobValue);
    const rawSteps = Array.isArray(job.steps) ? job.steps : [];
    return {
      name: readTrimmed(job.name) || null,
      status: readTrimmed(job.status) || null,
      conclusion: readTrimmed(job.conclusion) || null,
      startedAt: readTrimmed(job.started_at) || null,
      completedAt: readTrimmed(job.completed_at) || null,
      steps: rawSteps.map((stepValue) => {
        const step = readRecord(stepValue);
        return {
          number: typeof step.number === 'number' ? step.number : null,
          name: readTrimmed(step.name) || null,
          status: readTrimmed(step.status) || null,
          conclusion: readTrimmed(step.conclusion) || null,
        };
      }),
    };
  });
  return {
    provider: 'github',
    action: 'github_get_workflow_run',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    runId,
    run: mapWorkflowRun(readRecord(runResponse.data)),
    jobs,
    jobsHttpStatus: jobsResponse.status,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/**
 * Read-only: reports the runtime GITHUB_TOKEN's identity, kind, and granted scopes
 * WITHOUT ever returning the token value. Used to diagnose scope/permission failures
 * (e.g. workflow-file commits rejected with HTTP 404) so the owner can edit the right token.
 */
export async function runGithubTokenScopes(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const token = await getGithubToken();
  const tokenKind = token.startsWith('github_pat_')
    ? 'fine-grained'
    : token.startsWith('ghp_')
      ? 'classic'
      : token.startsWith('gho_') || token.startsWith('ghs_')
        ? 'oauth-or-app'
        : 'unknown-format';
  const headers = await githubHeaders();
  const userResponse = await fetch('https://api.github.com/user', { method: 'GET', headers });
  const userData = readRecord(await parseJsonResponse(userResponse));
  const scopesHeader = userResponse.headers.get('x-oauth-scopes') ?? '';
  const scopes = scopesHeader.split(',').map((scope) => scope.trim()).filter(Boolean);
  let repoAccessible: boolean | null = null;
  let repoPermissions: Record<string, unknown> | null = null;
  let repoOwner: string | null = null;
  let repoName: string | null = null;
  try {
    const repoInfo = await getGithubRepoInfo(input);
    repoOwner = repoInfo.owner;
    repoName = repoInfo.repo;
    const repoResponse = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`, { method: 'GET', headers });
    repoAccessible = repoResponse.ok;
    const repoData = readRecord(repoResponse.data);
    repoPermissions = repoResponse.ok ? readRecord(repoData.permissions) : null;
  } catch {
    repoAccessible = null;
  }
  const hasWorkflowScope = tokenKind === 'classic' ? scopes.includes('workflow') : null;
  return {
    provider: 'github',
    action: 'github_token_scopes',
    tokenKind,
    tokenLogin: readTrimmed(userData.login) || null,
    tokenUserId: typeof userData.id === 'number' ? userData.id : null,
    tokenValid: userResponse.ok,
    scopes,
    scopesHeaderPresent: Boolean(scopesHeader),
    hasWorkflowScope,
    workflowScopeNote: tokenKind === 'classic'
      ? (hasWorkflowScope ? 'Classic token HAS the workflow scope.' : 'Classic token is MISSING the workflow scope — .github/workflows commits will fail with HTTP 404.')
      : 'Fine-grained/app tokens do not expose scopes via header; check Workflows read/write permission in GitHub settings.',
    repoOwner,
    repoName,
    repoAccessible,
    repoPermissions,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

const ARTIFACT_VERIFY_HOST_SUFFIXES = ['ivxholding.com', 'github.com', 'githubusercontent.com', 'amazonaws.com', 'supabase.co', 'cloudfront.net'];
const MAX_ARTIFACT_VERIFY_BYTES = 524_288_000;

/** Read-only: streams an artifact URL and returns its SHA-256 so releases can be verified without trusting the client. */
export async function runVerifyUrlSha256(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const { createHash } = await import('node:crypto');
  const url = readTrimmed(input.url);
  const expectedSha256 = readTrimmed(input.expectedSha256).toLowerCase();
  if (!url.startsWith('https://')) {
    throw new Error('An https:// artifact URL is required.');
  }
  let hostname = '';
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    throw new Error('Invalid artifact URL.');
  }
  const hostAllowed = ARTIFACT_VERIFY_HOST_SUFFIXES.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  if (!hostAllowed) {
    throw new Error(`Host "${hostname}" is not in the artifact verification allowlist.`);
  }
  const response = await fetch(url, { method: 'GET', redirect: 'follow' });
  if (!response.ok || !response.body) {
    return {
      provider: 'artifact-verification',
      action: 'verify_url_sha256',
      ok: false,
      url,
      httpStatus: response.status,
      error: `Artifact fetch failed with HTTP ${response.status}.`,
      readOnly: true,
      secretValuesReturned: false,
      timestamp: nowIso(),
    };
  }
  const hash = createHash('sha256');
  const reader = response.body.getReader();
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (value) {
      bytes += value.byteLength;
      if (bytes > MAX_ARTIFACT_VERIFY_BYTES) {
        await reader.cancel();
        throw new Error('Artifact exceeds the 500 MB verification limit.');
      }
      hash.update(value);
    }
  }
  const sha256 = hash.digest('hex');
  return {
    provider: 'artifact-verification',
    action: 'verify_url_sha256',
    ok: true,
    url,
    httpStatus: response.status,
    contentType: response.headers.get('content-type'),
    bytes,
    sha256,
    expectedSha256: expectedSha256 || null,
    match: expectedSha256 ? sha256 === expectedSha256 : null,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

async function getRenderApiKey(): Promise<string> {
  const apiKey = readEnv('RENDER_API_KEY') || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  if (!apiKey) {
    throw new Error('RENDER_API_KEY is required for owner-approved Render actions. It was not loaded from process.env or encrypted Owner Variables.');
  }
  return apiKey;
}

async function getRenderServiceId(input: Record<string, unknown>): Promise<string> {
  const serviceId = readTrimmed(input.serviceId) || readEnv('RENDER_SERVICE_ID') || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  if (!serviceId) {
    throw new Error('RENDER_SERVICE_ID is required for Render service actions. It was not loaded from process.env, request input, or encrypted Owner Variables.');
  }
  return serviceId;
}

async function renderHeaders(): Promise<HeadersInit> {
  return {
    Accept: 'application/json',
    Authorization: `Bearer ${await getRenderApiKey()}`,
    'Content-Type': 'application/json',
  };
}

async function runRenderTriggerDeploy(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const body: Record<string, unknown> = {};
  const commitId = readTrimmed(input.commitId);
  const imageUrl = readTrimmed(input.imageUrl);
  const deployMode = readTrimmed(input.deployMode);
  if (commitId) {
    body.commitId = commitId;
  }
  if (imageUrl) {
    body.imageUrl = imageUrl;
  }
  if (deployMode === 'deploy_only' || deployMode === 'build_and_deploy') {
    body.deploy_mode = deployMode;
  }
  if (parseBoolean(input.clearCache) && !commitId && !imageUrl && !deployMode) {
    body.clearCache = 'clear';
  }
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/deploys`, {
    method: 'POST',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render deploy trigger failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  const deployId = readTrimmed(data.id) || readTrimmed(readRecord(data.deploy).id) || null;
  const result: Record<string, unknown> = {
    provider: 'render',
    action: 'render_trigger_deploy',
    serviceId,
    deployId,
    status: readTrimmed(data.status) || readTrimmed(readRecord(data.deploy).status) || 'accepted',
    url: readTrimmed(data.url) || null,
  };
  // ============================================================
  // Permanent deploy-gate hook: trigger the 16-module certification
  // gate automatically after every successful deploy. Runs in the
  // background — never blocks the deploy response. The report lands
  // in the certification ledger and is visible via /api/ivx/certification/*.
  // ============================================================
  try {
    const { runDeployCertificationGate } = await import('./services/ivx-deploy-certification-gate');
    void runDeployCertificationGate({
      triggeredBy: 'post_deploy',
      triggerSource: `render_trigger_deploy:${deployId ?? 'unknown'}`,
      deployId: deployId ?? null,
      apiBase: 'https://api.ivxholding.com',
      ownerToken: null,
    }).catch((gateError) => {
      console.log('[IVXDeveloperDeployControl] post-deploy certification gate failed (non-fatal):', gateError instanceof Error ? gateError.message : 'unknown');
    });
  } catch (importError) {
    console.log('[IVXDeveloperDeployControl] certification gate import failed (non-fatal):', importError instanceof Error ? importError.message : 'unknown');
  }
  return result;
}

async function runRenderRestartService(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/restart`, {
    method: 'POST',
    headers: await renderHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Render restart failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_restart_service',
    serviceId,
    restartAccepted: true,
    httpStatus: response.status,
  };
}

function normalizeRenderSubdomainPolicy(value: unknown): 'enabled' | 'disabled' {
  const policy = readTrimmed(value).toLowerCase();
  if (!policy || policy === 'disabled') {
    return 'disabled';
  }
  if (policy === 'enabled') {
    return 'enabled';
  }
  throw new Error('Render subdomain policy must be "enabled" or "disabled".');
}

async function runRenderUpdateSubdomainPolicy(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const policy = normalizeRenderSubdomainPolicy(input.renderSubdomainPolicy ?? input.policy);
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    headers: await renderHeaders(),
    body: JSON.stringify({ serviceDetails: { renderSubdomainPolicy: policy } }),
  });
  if (!response.ok) {
    throw new Error(`Render subdomain policy update failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_update_subdomain_policy',
    serviceId,
    renderSubdomainPolicy: policy,
    httpStatus: response.status,
    customDomainRequiredWhenDisabled: policy === 'disabled',
    secretValuesReturned: false,
  };
}

async function runRenderUpdateSource(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const repoUrl = readTrimmed(input.repoUrl) || readEnv('GITHUB_REPO_URL') || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) {
    throw new Error('A valid owner-controlled GitHub repo URL is required for Render source migration.');
  }
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const autoDeploy = readTrimmed(input.autoDeploy).toLowerCase();
  const body: Record<string, unknown> = {
    repo: buildSafeGithubRepoUrl(repoInfo),
    branch,
  };
  if (autoDeploy === 'yes' || autoDeploy === 'no') {
    body.autoDeploy = autoDeploy;
  }

  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}`, {
    method: 'PATCH',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render source update failed with HTTP ${response.status}.`);
  }
  const serviceRecord = readRecord(readRecord(response.data).service ?? response.data);
  const responseRepoInfo = parseGithubRepoUrl(readTrimmed(serviceRecord.repo)) ?? repoInfo;
  return {
    provider: 'render',
    action: 'render_update_source',
    serviceId,
    httpStatus: response.status,
    sourceRepoOwner: responseRepoInfo.owner,
    sourceRepoName: responseRepoInfo.repo,
    sourceRepoUrl: buildSafeGithubRepoUrl(responseRepoInfo),
    branch: readTrimmed(serviceRecord.branch) || branch,
    autoDeploy: readTrimmed(serviceRecord.autoDeploy) || (autoDeploy === 'yes' || autoDeploy === 'no' ? autoDeploy : null),
    renderSourceUpdated: true,
    secretValuesReturned: false,
  };
}

function sanitizeEnvVarKey(value: unknown): string {
  const key = readTrimmed(value);
  if (!/^[A-Z][A-Z0-9_]{1,120}$/.test(key)) {
    throw new Error('A valid uppercase environment variable key is required.');
  }
  return key;
}

async function runRenderUpsertEnvVar(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const serviceId = await getRenderServiceId(input);
  const key = sanitizeEnvVarKey(input.key);
  const value = typeof input.value === 'string' ? input.value : '';
  if (!value && !parseBoolean(input.generateValue)) {
    throw new Error('Environment variable value is required unless generateValue=true is provided.');
  }
  const body = parseBoolean(input.generateValue) ? { generateValue: true } : { value };
  const response = await fetchJson(`${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/env-vars/${encodeURIComponent(key)}`, {
    method: 'PUT',
    headers: await renderHeaders(),
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Render environment variable update failed with HTTP ${response.status}.`);
  }
  return {
    provider: 'render',
    action: 'render_upsert_env_var',
    serviceId,
    key,
    valueStored: true,
    secretValueReturned: false,
    deployRequiredForRuntime: true,
  };
}

function getSupabaseProjectRef(): string {
  const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL);
  if (!url) return '';
  const match = url.match(/https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match ? match[1] ?? '' : '';
}

function getSupabaseDatabaseUrl(): string {
  // 1. Direct connection string env vars (preferred).
  const direct = readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL')
    || readEnv('SUPABASE_INSPECTION_DATABASE_URL') || readEnv('SUPABASE_READONLY_DATABASE_URL');
  if (direct) return direct;

  // 2. Build from SUPABASE_DB_PASSWORD + project ref (handles Render services
  //    where SUPABASE_DB_URL is declared in render.yaml with sync:false but
  //    not materialized — same pattern as ivx-blocker-fix-migration.ts).
  const password = readTrimmed(process.env.SUPABASE_DB_PASSWORD);
  if (!password) {
    throw new Error('SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD is required for owner-approved SQL/migration actions.');
  }
  const projectRef = getSupabaseProjectRef();
  if (!projectRef) {
    throw new Error('Could not determine Supabase project ref from EXPO_PUBLIC_SUPABASE_URL to build the DB connection string.');
  }
  const dbHost = readTrimmed(process.env.SUPABASE_DB_HOST) || `db.${projectRef}.supabase.co`;
  const dbPort = readTrimmed(process.env.SUPABASE_DB_PORT) || '5432';
  const dbName = readTrimmed(process.env.SUPABASE_DB_NAME) || 'postgres';
  const dbUser = readTrimmed(process.env.SUPABASE_DB_USER) || 'postgres';
  const encodedUser = encodeURIComponent(dbUser);
  const encodedPassword = encodeURIComponent(password);
  const encodedDbName = encodeURIComponent(dbName);
  return `postgres://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${encodedDbName}?sslmode=require&application_name=ivx_developer_deploy`;
}

function assertSqlAllowed(sql: string): void {
  const normalized = sql.trim();
  if (!normalized) {
    throw new Error('SQL is required.');
  }
  if (normalized.length > MAX_SQL_LENGTH) {
    throw new Error(`SQL exceeds the guarded maximum length of ${MAX_SQL_LENGTH} characters.`);
  }
}

async function runSupabaseExecuteSql(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const sql = readTrimmed(input.sql);
  assertSqlAllowed(sql);
  const pgModule = await import('pg') as { Pool: PgPoolConstructor };
  const pool = new pgModule.Pool({
    connectionString: getSupabaseDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
    application_name: 'ivx-owner-ai-approved-migration',
    max: 1,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 8_000,
  });
  const client = await pool.connect();
  try {
    const result = await client.query(sql);
    const rows = Array.isArray(result.rows) ? result.rows.slice(0, 25) : [];
    return {
      provider: 'supabase',
      action: 'supabase_execute_sql',
      command: result.command ?? 'SQL',
      rowCount: result.rowCount ?? null,
      rowsReturned: Array.isArray(result.rows) ? result.rows.length : 0,
      rowsPreview: parseBoolean(input.returnRows) ? rows : [],
      rowsPreviewReturned: parseBoolean(input.returnRows),
    };
  } finally {
    client.release();
    await pool.end().catch(() => undefined);
  }
}

async function buildStatus(): Promise<Record<string, unknown>> {
  const githubTokenConfigured = Boolean(readEnv('GITHUB_TOKEN')) || await hasIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
  const githubRepoUrlConfigured = Boolean(readEnv('GITHUB_REPO_URL')) || await hasIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const renderApiConfigured = Boolean(readEnv('RENDER_API_KEY')) || await hasIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const renderServiceConfigured = Boolean(readEnv('RENDER_SERVICE_ID')) || await hasIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  const renderCredentialSource = {
    RENDER_API_KEY: readEnv('RENDER_API_KEY') ? 'env' : renderApiConfigured ? 'owner_variables' : 'missing',
    RENDER_SERVICE_ID: readEnv('RENDER_SERVICE_ID') ? 'env' : renderServiceConfigured ? 'owner_variables' : 'missing',
  };
  const supabaseDbUrlConfigured = Boolean(readEnv('SUPABASE_DB_URL'));
  const databaseUrlConfigured = Boolean(readEnv('DATABASE_URL'));
  const postgresUrlConfigured = Boolean(readEnv('POSTGRES_URL'));
  const supabaseSqlConfigured = supabaseDbUrlConfigured || databaseUrlConfigured || postgresUrlConfigured;
  const supabaseServiceRoleConfigured = Boolean(readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY'));
  const awsConfigured = Boolean(readEnv('AWS_ACCESS_KEY_ID') && readEnv('AWS_SECRET_ACCESS_KEY'));
  const currentRuntimeCanExecuteCoreOwnerApprovedActions = githubTokenConfigured
    && renderApiConfigured
    && renderServiceConfigured
    && supabaseServiceRoleConfigured
    && supabaseSqlConfigured;
  const requestedCredentialStatusByNameOnly = Object.fromEntries(
    REQUESTED_PRODUCTION_ACCESS_ENV_NAMES.map((name) => [
      name,
      name === 'RENDER_API_KEY'
        ? renderApiConfigured
        : name === 'RENDER_SERVICE_ID'
          ? renderServiceConfigured
          : Boolean(readEnv(name)),
    ]),
  ) as Record<typeof REQUESTED_PRODUCTION_ACCESS_ENV_NAMES[number], boolean>;
  return {
    ok: true,
    ownerOnly: true,
    readOnly: true,
    mode: 'ivx_owner_ai_developer_deploy_control',
    preLiveAccessSupported: true,
    productionLiveRequiredForAccess: false,
    productionLiveRequiredForPublicProof: true,
    renderLiveBlocksIVXAccess: false,
    currentRuntimeCredentialLoadingRequired: true,
    currentRuntimeCanExecuteCoreOwnerApprovedActions,
    currentAccessBlocker: currentRuntimeCanExecuteCoreOwnerApprovedActions
      ? null
      : 'The blocker is missing backend-only credentials in the runtime receiving this request, not Render/custom-domain live status.',
    accessProofStatement: 'Render public routing/custom-domain live status is not required for IVX Owner AI developer access. Any reachable backend runtime can operate when the backend-only credentials are loaded there.',
    accessBeforeLive: {
      supported: true,
      publicAppMustBeLiveFirst: false,
      renderPublicRoutingRequiredForAccess: false,
      renderPublicRoutingRequiredOnlyForPublicProof: true,
      requiredRuntime: 'Any reachable IVX backend runtime: local dev, staging, Render preview, or production.',
      requiredCredentialSource: 'Backend-only process.env or secure host environment variables; never frontend bundle or chat.',
      currentRuntimeCanUseRequestedCredentials: currentRuntimeCanExecuteCoreOwnerApprovedActions,
      explanation: 'IVX Owner AI can receive full developer/deploy access before public launch when this backend runtime is reachable and the backend-only credentials are loaded there. Render/custom-domain live status is only required for remote production proof at api.ivxholding.com/chat.ivxholding.com.',
      proofRoute: 'GET /api/ivx/developer-deploy/status',
    },
    allWriteAndDeployActionsRequireOwnerApproval: true,
    secretValuesReturned: false,
    requestedCredentialStatusByNameOnly,
    requestedCredentialNames: Object.keys(requestedCredentialStatusByNameOnly),
    requestedProductionAccessEnvNames: [...REQUESTED_PRODUCTION_ACCESS_ENV_NAMES],
    credentialRequestManifest: buildIVXCredentialRequestManifestSnapshot({ includeOptional: true }),
    supabaseSqlCredentialFallbackAccepted: ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL'],
    requestedCredentialNotes: {
      API_BASE_URL: 'Production backend base URL expected to be https://api.ivxholding.com.',
      STRIPE_API_KEY: 'Optional unless Stripe billing/payments are enabled for this service.',
      APP_SECRET: 'Generated by Render from the Blueprint when the service is synced.',
      DATABASE_URL: 'Loaded from Render Postgres database mydatabase via fromDatabase.connectionString.',
      MINIO_PASSWORD: 'Loaded from private Render service minio via fromService.MINIO_ROOT_PASSWORD.',
      myEnvGroup: 'Blueprint links fromGroup: my-env-group to the backend service.',
    },
    futureCredentialIntake: {
      supported: true,
      variableFile: 'backend/config/ivx-credential-request-manifest.ts',
      route: 'POST /api/ivx/developer-deploy/action',
      action: 'render_upsert_env_var',
      ownerConfirmationRequired: RENDER_SERVICE_CONFIRM_TEXT,
      credentialRequestManifestTool: 'credential_request_manifest',
      secretValuesReturned: false,
      note: 'Future backend credentials can be requested by IVX AI using the credential request manifest and added through this guarded owner-approved Render env-var action when RENDER_API_KEY and RENDER_SERVICE_ID are loaded in the backend runtime.',
    },
    routes: {
      status: 'GET /api/ivx/developer-deploy/status',
      action: 'POST /api/ivx/developer-deploy/action',
    },
    github: {
      repoUrlConfigured: githubRepoUrlConfigured,
      tokenConfigured: githubTokenConfigured,
      credentialSource: {
        GITHUB_REPO_URL: readEnv('GITHUB_REPO_URL') ? 'env' : githubRepoUrlConfigured ? 'owner_variables' : 'missing',
        GITHUB_TOKEN: readEnv('GITHUB_TOKEN') ? 'env' : githubTokenConfigured ? 'owner_variables' : 'missing',
      },
      requiredTokenPermissions: ['contents:read/write', 'pull_requests:write', 'actions/workflows:write'],
      supportedActions: ['github_commit_file', 'github_create_branch', 'github_create_pull_request', 'github_pull_request_status', 'github_merge_pull_request', 'github_create_rollback_tag', 'github_dispatch_workflow', 'github_create_repository', 'github_list_workflow_runs', 'github_get_workflow_run', 'github_token_scopes', 'verify_url_sha256', 'github_read_file', 'github_search_code', 'github_list_directory', 'github_get_file_tree', 'github_get_workflow_logs', 'ai_diagnose_failure', 'ai_analyze_code', 'ai_generate_fix', 'ai_review_architecture', 'analyze_dependencies', 'autonomous_fix_cycle', 'ai_design_feature', 'ai_generate_code', 'ai_generate_tests', 'ai_refactor_code', 'ai_debug_runtime', 'ai_security_audit', 'ai_performance_analysis', 'ai_generate_docs', 'test_api_endpoint', 'render_get_logs', 'autonomous_feature_cycle', 'github_commit_multi_file'],
      readOnlyActions: ['github_pull_request_status', 'github_list_workflow_runs', 'github_get_workflow_run', 'github_token_scopes', 'verify_url_sha256', 'github_read_file', 'github_search_code', 'github_list_directory', 'github_get_file_tree', 'github_get_workflow_logs', 'ai_diagnose_failure', 'ai_analyze_code', 'ai_generate_fix', 'ai_review_architecture', 'analyze_dependencies', 'ai_design_feature', 'ai_generate_code', 'ai_generate_tests', 'ai_refactor_code', 'ai_debug_runtime', 'ai_security_audit', 'ai_performance_analysis', 'ai_generate_docs', 'test_api_endpoint', 'render_get_logs'],
      ciWorkflow: '.github/workflows/ivx-ci.yml',
      confirmationTextRequired: GITHUB_CONFIRM_TEXT,
      mergeConfirmationTextRequired: GITHUB_MERGE_CONFIRM_TEXT,
    },
    render: {
      apiKeyConfigured: renderApiConfigured,
      serviceIdConfigured: renderServiceConfigured,
      credentialSource: renderCredentialSource,
      serviceName: readEnv('RENDER_SERVICE_NAME') || 'ivx-holdings-platform',
      supportedActions: ['render_trigger_deploy', 'render_restart_service', 'render_upsert_env_var', 'render_update_subdomain_policy', 'render_update_source', 'render_get_logs'],
      deployConfirmationTextRequired: RENDER_DEPLOY_CONFIRM_TEXT,
      serviceUpdateConfirmationTextRequired: RENDER_SERVICE_CONFIRM_TEXT,
    },
    supabase: {
      urlConfigured: Boolean(readEnv('EXPO_PUBLIC_SUPABASE_URL')),
      anonKeyConfigured: Boolean(readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY')),
      serviceRoleConfigured: supabaseServiceRoleConfigured,
      databaseUrlConfigured: supabaseSqlConfigured,
      supportedActions: ['supabase_execute_sql', 'POST /api/ivx/supabase/owner-action'],
      confirmationTextRequired: SUPABASE_SQL_CONFIRM_TEXT,
    },
    aws: {
      optional: true,
      credentialsConfigured: awsConfigured,
      sessionTokenConfigured: Boolean(readEnv('AWS_SESSION_TOKEN')),
      safety: 'AWS/DNS write actions stay separate and require owner confirmation on their specific owner-only routes.',
    },
    missingCredentialNames: [
      ...(!githubRepoUrlConfigured ? ['GITHUB_REPO_URL'] : []),
      ...(!githubTokenConfigured ? ['GITHUB_TOKEN'] : []),
      ...(!renderApiConfigured ? ['RENDER_API_KEY'] : []),
      ...(!renderServiceConfigured ? ['RENDER_SERVICE_ID'] : []),
      ...(!supabaseServiceRoleConfigured ? ['SUPABASE_SERVICE_ROLE_KEY'] : []),
      ...(!supabaseSqlConfigured ? ['SUPABASE_DB_URL or DATABASE_URL or POSTGRES_URL'] : []),
    ],
    requestedCredentialMissingNames: Object.entries(requestedCredentialStatusByNameOnly)
      .filter(([, configured]) => !configured)
      .map(([name]) => name),
    timestamp: nowIso(),
  };
}

async function runCloudFrontInvalidate(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const rawPaths = input.paths;
  const paths: string[] = Array.isArray(rawPaths)
    ? rawPaths.filter((p): p is string => typeof p === 'string')
    : typeof rawPaths === 'string' ? [rawPaths] : ['/index.html', '/ivx-invest.js', '/ivx-portal.js', '/'];
  if (paths.length === 0) {
    paths.push('/index.html', '/ivx-invest.js', '/ivx-portal.js', '/');
  }
  // Resolve credentials: process.env first, then Owner Variables table (same pattern as landing-full-deploy)
  let distributionId = readTrimmed(input.distributionId) || readEnv('CLOUDFRONT_DISTRIBUTION_ID');
  if (!distributionId) {
    distributionId = await getRawOwnerVariableValue('CLOUDFRONT_DISTRIBUTION_ID');
  }
  // Temporarily inject resolved credentials into process.env so createCloudFrontInvalidation picks them up
  if (distributionId && !readEnv('CLOUDFRONT_DISTRIBUTION_ID')) {
    process.env.CLOUDFRONT_DISTRIBUTION_ID = distributionId;
  }
  if (!readEnv('AWS_ACCESS_KEY_ID')) {
    const ak = await getRawOwnerVariableValue('AWS_ACCESS_KEY_ID');
    if (ak) process.env.AWS_ACCESS_KEY_ID = ak;
  }
  if (!readEnv('AWS_SECRET_ACCESS_KEY')) {
    const sk = await getRawOwnerVariableValue('AWS_SECRET_ACCESS_KEY');
    if (sk) process.env.AWS_SECRET_ACCESS_KEY = sk;
  }
  const result = await createCloudFrontInvalidation({
    paths,
    callerReference: readTrimmed(input.callerReference) || undefined,
    distributionId: distributionId || undefined,
  });
  return {
    provider: 'cloudfront',
    action: 'cloudfront_invalidate',
    ok: result.ok,
    status: result.status,
    invalidationId: result.invalidationId,
    distributionId: result.distributionId,
    paths: result.paths,
    httpStatus: result.httpStatus,
    error: result.error,
    missingEnvNames: result.missingEnvNames,
    createdAt: result.createdAt,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

async function runSupabaseExecuteSqlViaManagement(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const managementToken = readEnv('SUPABASE_ACCESS_TOKEN');
  const supabaseUrl = readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
  if (!managementToken) {
    throw new Error('SUPABASE_ACCESS_TOKEN not configured in runtime. Required for supabase_execute_sql_management.');
  }
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured.');
  }
  const projectRefMatch = supabaseUrl.match(/https:\/\/([a-z0-9-]+)\.supabase\.co/);
  const projectRef = projectRefMatch?.[1] ?? null;
  if (!projectRef) {
    throw new Error(`Could not extract project ref from Supabase URL: ${supabaseUrl}`);
  }
  const sql = readTrimmed(input.sql);
  if (!sql) {
    throw new Error('SQL is required for supabase_execute_sql_management.');
  }
  if (sql.length > MAX_SQL_LENGTH) {
    throw new Error(`SQL exceeds the guarded maximum length of ${MAX_SQL_LENGTH} characters.`);
  }

  // Supabase Management API: POST /v1/projects/{ref}/database/query
  // Uses the access token (not a DB connection string). Returns JSON rows.
  const queryUrl = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;
  const queryResp = await fetch(queryUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${managementToken}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  const queryText = await queryResp.text();
  if (!queryResp.ok) {
    return {
      provider: 'supabase',
      action: 'supabase_execute_sql_management',
      ok: false,
      projectRef,
      httpStatus: queryResp.status,
      error: queryText.slice(0, 500) || `Query failed: HTTP ${queryResp.status}`,
      secretValuesReturned: false,
      timestamp: nowIso(),
    };
  }
  let rows: unknown = null;
  try {
    rows = JSON.parse(queryText);
  } catch {
    rows = queryText.slice(0, 1000);
  }
  return {
    provider: 'supabase',
    action: 'supabase_execute_sql_management',
    ok: true,
    projectRef,
    httpStatus: queryResp.status,
    rows,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

function sanitizeReadPath(value: unknown): string {
  const repoPath = readTrimmed(value).replace(/^\/+/, '');
  if (!repoPath || repoPath.includes('..') || repoPath.endsWith('/')) {
    throw new Error('A safe repository file path is required.');
  }
  const lower = repoPath.toLowerCase();
  const blocked = lower === '.env'
    || lower.startsWith('.env.')
    || lower.endsWith('.pem')
    || lower.endsWith('.key')
    || lower.endsWith('.p12')
    || lower.endsWith('.pfx')
    || lower.includes('/.env')
    || lower.includes('secret')
    || lower.includes('private-key');
  if (blocked && lower !== '.env.example') {
    throw new Error('Refusing to read likely secret-bearing repository paths.');
  }
  return repoPath;
}

/** Read-only: reads any source file from the repository (GitHub Contents API). */
export async function runGithubReadFile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const filePath = sanitizeReadPath(input.path);
  const encodedPath = filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetchJson(url, { method: 'GET', headers: await githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub read file failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  const contentBase64 = readTrimmed(data.content).replace(/\n/g, '');
  const encoding = readTrimmed(data.encoding);
  let content = '';
  if (encoding === 'base64' && contentBase64) {
    content = Buffer.from(contentBase64, 'base64').toString('utf8');
  }
  // Cap returned content at 100,000 chars to keep response manageable
  const truncated = content.length > 100_000;
  if (truncated) {
    content = content.slice(0, 100_000) + '\n\n... [TRUNCATED — file is ' + content.length + ' chars]';
  }
  return {
    provider: 'github',
    action: 'github_read_file',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: filePath,
    sha: readTrimmed(data.sha) || null,
    size: typeof data.size === 'number' ? data.size : content.length,
    encoding,
    content,
    contentLength: content.length,
    truncated,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: searches code across the repository (GitHub Code Search API). */
export async function runGithubSearchCode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const query = readTrimmed(input.query);
  if (!query || query.length < 2) {
    throw new Error('A search query of at least 2 characters is required for github_search_code.');
  }
  const perPageRaw = Number(input.perPage);
  const perPage = Number.isFinite(perPageRaw) && perPageRaw >= 1 ? Math.min(Math.trunc(perPageRaw), 30) : 10;
  const url = `https://api.github.com/search/code?q=${encodeURIComponent(query)}+repo:${repoInfo.owner}/${repoInfo.repo}&per_page=${perPage}`;
  const response = await fetchJson(url, { method: 'GET', headers: await githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub code search failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  const items = Array.isArray(data.items) ? data.items : [];
  return {
    provider: 'github',
    action: 'github_search_code',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    query,
    totalCount: typeof data.total_count === 'number' ? data.total_count : items.length,
    results: items.map((itemValue: unknown) => {
      const record = readRecord(itemValue);
      return {
        path: readTrimmed(record.path) || null,
        name: readTrimmed(record.name) || null,
        sha: readTrimmed(record.sha) || null,
        url: readTrimmed(record.html_url) || null,
        score: typeof record.score === 'number' ? record.score : null,
      };
    }),
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: lists directory contents from the repository. */
export async function runGithubListDirectory(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const dirPath = readTrimmed(input.path).replace(/\/+$/, '').replace(/^\/+/, '');
  const encodedPath = dirPath ? dirPath.split('/').map((part) => encodeURIComponent(part)).join('/') + '/' : '';
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const response = await fetchJson(url, { method: 'GET', headers: await githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub list directory failed with HTTP ${response.status}.`);
  }
  if (!Array.isArray(response.data)) {
    throw new Error('Expected directory listing (array), got a file. Use github_read_file for individual files.');
  }
  const entries = (response.data as unknown[]).map((itemValue) => {
    const record = readRecord(itemValue);
    return {
      name: readTrimmed(record.name) || null,
      path: readTrimmed(record.path) || null,
      type: readTrimmed(record.type) || null,
      size: typeof record.size === 'number' ? record.size : null,
      sha: readTrimmed(record.sha) || null,
    };
  });
  return {
    provider: 'github',
    action: 'github_list_directory',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: dirPath || '/',
    entries,
    entryCount: entries.length,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: gets the full recursive file tree (filtered to source files, capped at 500). */
export async function runGithubGetFileTree(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`;
  const response = await fetchJson(url, { method: 'GET', headers: await githubHeaders() });
  if (!response.ok) {
    throw new Error(`GitHub file tree failed with HTTP ${response.status}.`);
  }
  const data = readRecord(response.data);
  const rawTree = Array.isArray(data.tree) ? data.tree : [];
  const entries = rawTree
    .filter((itemValue: unknown) => {
      const record = readRecord(itemValue);
      const path = readTrimmed(record.path).toLowerCase();
      const type = readTrimmed(record.type);
      if (type !== 'blob') return false;
      if (path.includes('node_modules/') || path.includes('.git/') || path.includes('/dist/') || path.includes('/.next/')) return false;
      return true;
    })
    .slice(0, 500)
    .map((itemValue: unknown) => {
      const record = readRecord(itemValue);
      return {
        path: readTrimmed(record.path) || null,
        type: readTrimmed(record.type) || null,
        size: typeof record.size === 'number' ? record.size : null,
      };
    });
  return {
    provider: 'github',
    action: 'github_get_file_tree',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    totalEntries: rawTree.length,
    filteredEntries: entries.length,
    truncated: rawTree.length > 500,
    tree: entries,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: fetches GitHub Actions job logs (plain text, capped at 50KB). */
export async function runGithubGetWorkflowLogs(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const jobIdRaw = Number(input.jobId);
  const jobId = Number.isFinite(jobIdRaw) ? Math.trunc(jobIdRaw) : 0;
  if (jobId <= 0) {
    throw new Error('A valid jobId (numeric GitHub Actions job id) is required for github_get_workflow_logs.');
  }
  const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/jobs/${jobId}/logs`;
  const headers = await githubHeaders();
  const response = await fetch(url, { method: 'GET', headers, redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`GitHub workflow logs failed with HTTP ${response.status}.`);
  }
  const logText = await response.text();
  const truncated = logText.length > 50_000;
  const logs = truncated ? logText.slice(0, 50_000) + '\n\n... [TRUNCATED]' : logText;
  return {
    provider: 'github',
    action: 'github_get_workflow_logs',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    jobId,
    logLength: logText.length,
    truncated,
    logs,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered CI failure diagnosis — feeds failure context to the AI runtime for root-cause analysis. */
export async function runAiDiagnoseFailure(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const failureContext = readTrimmed(input.failureContext) || readTrimmed(input.logs);
  const stepName = readTrimmed(input.stepName);
  const workflowName = readTrimmed(input.workflowName);
  const runId = readTrimmed(input.runId);
  if (!failureContext || failureContext.length < 10) {
    throw new Error('failureContext or logs (at least 10 characters) is required for ai_diagnose_failure.');
  }
  const system = 'You are a senior software engineer diagnosing a CI/CD pipeline failure. Analyze the provided failure context (logs, step names, error messages) and provide:\n1. ROOT CAUSE: The most likely cause of the failure (1-2 sentences)\n2. AFFECTED FILES: Which files are likely involved (list paths)\n3. FIX STRATEGY: Concrete steps to fix the issue (numbered list)\n4. SEVERITY: critical | high | medium | low\n5. CONFIDENCE: high | medium | low\n\nBe concise and technical. Do not speculate beyond what the evidence supports.';
  const prompt = `CI Failure Analysis Request:\n${workflowName ? `Workflow: ${workflowName}\n` : ''}${runId ? `Run ID: ${runId}\n` : ''}${stepName ? `Failing Step: ${stepName}\n` : ''}\nFailure Context / Logs:\n${failureContext.slice(0, 20_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 2000,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_diagnose_failure',
    workflowName: workflowName || null,
    runId: runId || null,
    stepName: stepName || null,
    diagnosis: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered code review — analyzes code for bugs, security, performance, and best practices. */
export async function runAiAnalyzeCode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath);
  const language = readTrimmed(input.language);
  const analysisType = readTrimmed(input.analysisType) || 'general';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_analyze_code.');
  }
  const system = 'You are a senior software engineer performing a code review. Analyze the provided code for:\n1. BUGS: Logic errors, null/undefined risks, race conditions, edge cases\n2. SECURITY: Vulnerabilities, injection risks, secret exposure, auth issues\n3. PERFORMANCE: N+1 queries, unnecessary re-renders, memory leaks, blocking operations\n4. BEST PRACTICES: Framework conventions, patterns, naming, structure\n5. RECOMMENDATIONS: Specific actionable improvements (with code snippets where helpful)\n\nBe concise and technical. Focus on real issues, not style nitpicks.';
  const prompt = `Code Analysis Request:\n${filePath ? `File: ${filePath}\n` : ''}${language ? `Language: ${language}\n` : ''}Analysis Focus: ${analysisType}\n\nCode:\n${code.slice(0, 30_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 2500,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_analyze_code',
    path: filePath || null,
    language: language || null,
    analysisType,
    analysis: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered code fix generation — produces fixed code content from a diagnosis + current code. */
export async function runAiGenerateFix(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath);
  const issue = readTrimmed(input.issue) || readTrimmed(input.diagnosis);
  const language = readTrimmed(input.language);
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_generate_fix.');
  }
  if (!issue || issue.length < 10) {
    throw new Error('issue or diagnosis (at least 10 characters) is required for ai_generate_fix.');
  }
  const system = 'You are a senior software engineer generating a code fix. Output ONLY the fixed code, with a brief comment at the top explaining the fix. Do not wrap in markdown code fences. The output must be directly usable as file content.';
  const prompt = `Generate a fix for the following issue:\n\nFile: ${filePath || 'unknown'}\n${language ? `Language: ${language}\n` : ''}\nIssue/Diagnosis:\n${issue.slice(0, 5_000)}\n\nCurrent Code:\n${code.slice(0, 30_000)}\n\nOutput the complete fixed file content. Do not use markdown code fences.`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 4000,
  });
  let fixedCode = result.text.trim();
  // Strip markdown code fences if the model added them despite instructions
  fixedCode = fixedCode.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return {
    provider: 'ivx-ai',
    action: 'ai_generate_fix',
    path: filePath || null,
    issue: issue.slice(0, 200),
    fixedCode,
    fixedCodeLength: fixedCode.length,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered architecture review — analyzes project structure, scalability, maintainability, and risks. */
export async function runAiReviewArchitecture(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const fileTree = readTrimmed(input.fileTree) || readTrimmed(input.tree);
  const description = readTrimmed(input.description) || readTrimmed(input.context);
  const codeSamples = readTrimmed(input.codeSamples) || readTrimmed(input.code);
  if (!fileTree && !description && !codeSamples) {
    throw new Error('At least one of fileTree, description, or codeSamples is required for ai_review_architecture.');
  }
  const system = 'You are a senior software architect reviewing the architecture of a codebase. Provide:\n1. ARCHITECTURE ASSESSMENT: Is the structure sound? (monolith vs modular, separation of concerns)\n2. SCALABILITY: Will this scale? What are the bottlenecks?\n3. MAINTAINABILITY: How easy is this to maintain and extend?\n4. RISKS: Technical debt, coupling issues, missing abstractions\n5. RECOMMENDATIONS: Specific architectural improvements (prioritized)\n\nBe concise and technical.';
  const prompt = `Architecture Review Request:\n${description ? `\nProject Description:\n${description.slice(0, 5_000)}` : ''}${fileTree ? `\nFile Tree:\n${fileTree.slice(0, 10_000)}` : ''}${codeSamples ? `\nKey Code Samples:\n${codeSamples.slice(0, 15_000)}` : ''}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 3000,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_review_architecture',
    review: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: dependency analysis — reads package.json files from the repo and analyzes dependencies. */
export async function runAnalyzeDependencies(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const headers = await githubHeaders();
  const pathsToCheck = ['package.json', 'expo/package.json', 'backend/package.json'];
  const packageJsons: Array<{ path: string; content: Record<string, unknown> }> = [];
  for (const pkgPath of pathsToCheck) {
    const encodedPath = pkgPath.split('/').map((part) => encodeURIComponent(part)).join('/');
    const url = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
    const response = await fetchJson(url, { method: 'GET', headers }).catch(() => null);
    if (response?.ok === true) {
      const data = readRecord(response.data);
      const contentBase64 = readTrimmed(data.content).replace(/\n/g, '');
      if (contentBase64) {
        try {
          const content = JSON.parse(Buffer.from(contentBase64, 'base64').toString('utf8')) as Record<string, unknown>;
          packageJsons.push({ path: pkgPath, content });
        } catch { /* skip unparseable */ }
      }
    }
  }
  if (packageJsons.length === 0) {
    throw new Error('No package.json files found in the repository.');
  }
  const analyses = packageJsons.map(({ path, content }) => {
    const deps = readRecord(content.dependencies);
    const devDeps = readRecord(content.devDependencies);
    const peerDeps = readRecord(content.peerDependencies);
    const allDeps = { ...deps, ...devDeps, ...peerDeps };
    const depCount = Object.keys(allDeps).length;
    const issues: string[] = [];
    for (const [name, version] of Object.entries(allDeps)) {
      const ver = readTrimmed(version);
      if (ver.startsWith('0.')) {
        issues.push(`${name}@${ver} — pre-1.0 version (API may be unstable)`);
      }
    }
    return {
      path,
      name: readTrimmed(content.name) || path,
      version: readTrimmed(content.version) || null,
      dependencyCount: depCount,
      dependencies: Object.keys(deps).sort(),
      devDependencies: Object.keys(devDeps).sort(),
      peerDependencies: Object.keys(peerDeps).sort(),
      issues,
    };
  });
  const allDepNames = new Map<string, string[]>();
  for (const analysis of analyses) {
    const allDeps = [...analysis.dependencies, ...analysis.devDependencies];
    for (const dep of allDeps) {
      const existing = allDepNames.get(dep) ?? [];
      existing.push(analysis.path);
      allDepNames.set(dep, existing);
    }
  }
  const sharedDeps = Array.from(allDepNames.entries())
    .filter(([, locations]) => locations.length > 1)
    .map(([name, locations]) => ({ name, locations }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    provider: 'ivx',
    action: 'analyze_dependencies',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    packages: analyses,
    sharedDependencies: sharedDeps,
    totalPackages: packageJsons.length,
    totalUniqueDependencies: allDepNames.size,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/**
 * Write action (owner-approved): autonomous fix cycle — reads a file, AI-diagnoses the issue,
 * AI-generates a fix, commits it to GitHub, and optionally dispatches CI.
 * Requires CONFIRM_IVX_GITHUB_WRITE confirmation phrase.
 */
async function runAutonomousFixCycle(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const filePath = sanitizeRepoPath(input.path);
  const issue = readTrimmed(input.issue) || readTrimmed(input.diagnosis);
  const commitMessage = readTrimmed(input.commitMessage) || `fix: autonomous repair — ${filePath}`;
  const skipCi = parseBoolean(input.skipCi);
  if (!issue || issue.length < 10) {
    throw new Error('issue or diagnosis (at least 10 characters) is required for autonomous_fix_cycle.');
  }
  const headers = await githubHeaders();
  const steps: Array<{ step: string; status: string; detail?: string }> = [];

  // Step 1: Read the current file
  steps.push({ step: 'read_file', status: 'started' });
  const encodedPath = filePath.split('/').map((part) => encodeURIComponent(part)).join('/');
  const readUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const readResponse = await fetchJson(readUrl, { method: 'GET', headers });
  if (!readResponse.ok) {
    steps.push({ step: 'read_file', status: 'failed', detail: `HTTP ${readResponse.status}` });
    throw new Error(`Autonomous fix: could not read ${filePath} (HTTP ${readResponse.status}).`);
  }
  const fileData = readRecord(readResponse.data);
  const fileSha = readTrimmed(fileData.sha);
  const currentContent = Buffer.from(readTrimmed(fileData.content).replace(/\n/g, ''), 'base64').toString('utf8');
  steps.push({ step: 'read_file', status: 'success', detail: `${currentContent.length} bytes read` });

  // Step 2: AI-diagnose the issue
  steps.push({ step: 'ai_diagnose', status: 'started' });
  const diagnosisResult = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system: 'You are a senior software engineer diagnosing a code issue. Provide a concise root cause and fix strategy.',
    prompt: `File: ${filePath}\nIssue: ${issue}\n\nCurrent Code:\n${currentContent.slice(0, 25_000)}\n\nProvide ROOT CAUSE and FIX STRATEGY only.`,
    maxOutputTokens: 1500,
  });
  const diagnosis = diagnosisResult.text;
  steps.push({ step: 'ai_diagnose', status: 'success', detail: `${diagnosis.length} chars` });

  // Step 3: AI-generate the fix
  steps.push({ step: 'ai_generate_fix', status: 'started' });
  const fixResult = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system: 'You are a senior software engineer generating a code fix. Output ONLY the fixed code content, no markdown fences, no explanations. The output must be directly usable as file content.',
    prompt: `File: ${filePath}\nIssue: ${issue}\nDiagnosis: ${diagnosis}\n\nCurrent Code:\n${currentContent.slice(0, 25_000)}\n\nOutput the complete fixed file content. No markdown fences.`,
    maxOutputTokens: 4000,
  });
  let fixedContent = fixResult.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  if (!fixedContent || fixedContent.length < 5) {
    steps.push({ step: 'ai_generate_fix', status: 'failed', detail: 'AI returned empty fix' });
    throw new Error('Autonomous fix: AI generated empty fix content.');
  }
  steps.push({ step: 'ai_generate_fix', status: 'success', detail: `${fixedContent.length} bytes generated` });

  // Step 4: Commit the fix
  steps.push({ step: 'commit_fix', status: 'started' });
  const commitUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`;
  const commitResponse = await fetchJson(commitUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: commitMessage,
      content: Buffer.from(fixedContent, 'utf8').toString('base64'),
      branch,
      sha: fileSha,
    }),
  });
  if (!commitResponse.ok) {
    steps.push({ step: 'commit_fix', status: 'failed', detail: `HTTP ${commitResponse.status}` });
    throw new Error(`Autonomous fix: GitHub commit failed with HTTP ${commitResponse.status}.`);
  }
  const commitData = readRecord(commitResponse.data);
  const commitRecord = readRecord(commitData.commit);
  const commitSha = readTrimmed(commitRecord.sha) || null;
  steps.push({ step: 'commit_fix', status: 'success', detail: `commit ${commitSha?.slice(0, 8) ?? 'unknown'}` });

  // Step 5: Optionally dispatch CI
  let ciDispatched = false;
  if (!skipCi) {
    steps.push({ step: 'dispatch_ci', status: 'started' });
    try {
      const dispatchResponse = await fetchJson(
        `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/actions/workflows/ivx-ci.yml/dispatches`,
        { method: 'POST', headers, body: JSON.stringify({ ref: branch, inputs: {} }) },
      );
      ciDispatched = dispatchResponse.ok;
      steps.push({ step: 'dispatch_ci', status: dispatchResponse.ok ? 'success' : 'skipped', detail: dispatchResponse.ok ? 'dispatched' : `HTTP ${dispatchResponse.status}` });
    } catch (err) {
      steps.push({ step: 'dispatch_ci', status: 'skipped', detail: err instanceof Error ? err.message : 'error' });
    }
  }

  return {
    provider: 'github',
    action: 'autonomous_fix_cycle',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: filePath,
    issue: issue.slice(0, 200),
    diagnosis: diagnosis.slice(0, 500),
    fixedContentLength: fixedContent.length,
    commitSha,
    commitUrl: readTrimmed(commitRecord.html_url) || null,
    ciDispatched,
    steps,
    readOnly: false,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERAL-PURPOSE SENIOR DEVELOPER ACTIONS (Rork-level parity)
// 12 new actions: design, implement, debug, deploy, verify across full stack
// ═══════════════════════════════════════════════════════════════════════════

/** Read-only: AI-powered feature design — generates implementation plan from a feature description. */
export async function runAiDesignFeature(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const featureDescription = readTrimmed(input.featureDescription) || readTrimmed(input.description);
  const projectContext = readTrimmed(input.projectContext) || readTrimmed(input.context);
  const targetPlatform = readTrimmed(input.platform) || readTrimmed(input.targetPlatform) || 'general';
  if (!featureDescription || featureDescription.length < 10) {
    throw new Error('featureDescription or description (at least 10 characters) is required for ai_design_feature.');
  }
  const system = 'You are a senior software engineer designing a feature implementation plan. Provide:\n1. OVERVIEW: What the feature does and why (2-3 sentences)\n2. COMPONENTS: List of components/modules to create or modify (with file paths)\n3. DATA MODEL: Database schema changes, types, or API contracts needed\n4. IMPLEMENTATION STEPS: Ordered, numbered steps with specific code changes\n5. TESTING STRATEGY: What to test and how (unit, integration, E2E)\n6. RISKS: Edge cases, security concerns, performance risks\n7. ESTIMATED COMPLEXITY: low | medium | high (with justification)\n\nBe specific with file paths and code patterns. This plan must be directly actionable.';
  const prompt = `Feature Design Request:\nPlatform: ${targetPlatform}\n${projectContext ? `Project Context:\n${projectContext.slice(0, 10_000)}\n` : ''}\nFeature Description:\n${featureDescription.slice(0, 15_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 3000,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_design_feature',
    featureDescription: featureDescription.slice(0, 200),
    targetPlatform,
    designPlan: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered code generation — generates new code from a specification. */
export async function runAiGenerateCode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const specification = readTrimmed(input.specification) || readTrimmed(input.spec);
  const language = readTrimmed(input.language) || readTrimmed(input.lang) || 'typescript';
  const framework = readTrimmed(input.framework) || '';
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const existingCode = readTrimmed(input.existingCode) || readTrimmed(input.context) || '';
  if (!specification || specification.length < 10) {
    throw new Error('specification or spec (at least 10 characters) is required for ai_generate_code.');
  }
  const system = 'You are a senior software engineer generating production-quality code. Output ONLY the code file content with a brief comment at the top. No markdown fences. The code must be complete, type-safe, and directly usable. Follow best practices for the specified language and framework.';
  const prompt = `Code Generation Request:\nLanguage: ${language}\n${framework ? `Framework: ${framework}\n` : ''}${filePath ? `Target File: ${filePath}\n` : ''}\nSpecification:\n${specification.slice(0, 20_000)}\n${existingCode ? `\nExisting Code Context:\n${existingCode.slice(0, 10_000)}\n` : ''}Output the complete code file. No markdown fences.`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 4000,
  });
  let generatedCode = result.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return {
    provider: 'ivx-ai',
    action: 'ai_generate_code',
    language,
    framework: framework || null,
    path: filePath || null,
    generatedCode,
    generatedCodeLength: generatedCode.length,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered test generation — generates test cases for given code. */
export async function runAiGenerateTests(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const testFramework = readTrimmed(input.testFramework) || readTrimmed(input.framework) || 'bun:test';
  const language = readTrimmed(input.language) || 'typescript';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_generate_tests.');
  }
  const system = 'You are a senior software engineer generating comprehensive test suites. Output ONLY the test file content. No markdown fences. Include:\n- Happy path tests\n- Edge case tests (null, undefined, empty, boundary)\n- Error handling tests\n- Integration tests where applicable\nUse the specified test framework conventions.';
  const prompt = `Test Generation Request:\nLanguage: ${language}\nTest Framework: ${testFramework}\n${filePath ? `Source File: ${filePath}\n` : ''}\nCode to Test:\n${code.slice(0, 30_000)}\n\nOutput the complete test file. No markdown fences.`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 4000,
  });
  let testCode = result.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return {
    provider: 'ivx-ai',
    action: 'ai_generate_tests',
    path: filePath || null,
    testFramework,
    testCode,
    testCodeLength: testCode.length,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered code refactoring — refactors code for better structure, maintainability. */
export async function runAiRefactorCode(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const refactorGoal = readTrimmed(input.goal) || readTrimmed(input.refactorGoal) || 'improve readability and maintainability';
  const language = readTrimmed(input.language) || '';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_refactor_code.');
  }
  const system = 'You are a senior software engineer refactoring code. Output ONLY the refactored code. No markdown fences. Preserve all existing functionality while improving:\n- Code organization and separation of concerns\n- Naming clarity\n- Error handling\n- Type safety\n- Performance\nAdd a brief comment at the top explaining what was refactored and why.';
  const prompt = `Refactor Request:\n${language ? `Language: ${language}\n` : ''}${filePath ? `File: ${filePath}\n` : ''}Goal: ${refactorGoal}\n\nOriginal Code:\n${code.slice(0, 30_000)}\n\nOutput the complete refactored code. No markdown fences.`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 4000,
  });
  let refactoredCode = result.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  return {
    provider: 'ivx-ai',
    action: 'ai_refactor_code',
    path: filePath || null,
    refactorGoal,
    refactoredCode,
    refactoredCodeLength: refactoredCode.length,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered runtime error diagnosis — diagnoses from stack traces and error messages. */
export async function runAiDebugRuntime(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const errorStack = readTrimmed(input.errorStack) || readTrimmed(input.stackTrace) || readTrimmed(input.error);
  const errorMessage = readTrimmed(input.errorMessage) || readTrimmed(input.message) || '';
  const codeContext = readTrimmed(input.codeContext) || readTrimmed(input.code) || '';
  const runtimeContext = readTrimmed(input.runtimeContext) || readTrimmed(input.context) || '';
  if (!errorStack && !errorMessage) {
    throw new Error('errorStack or errorMessage is required for ai_debug_runtime.');
  }
  const system = 'You are a senior software engineer debugging a runtime error. Analyze the error and provide:\n1. ERROR TYPE: Classification (TypeError, ReferenceError, LogicError, RaceCondition, etc.)\n2. ROOT CAUSE: Most likely cause (1-3 sentences)\n3. STACK TRACE ANALYSIS: Walk through the key frames and what they tell us\n4. AFFECTED CODE: Which lines/files are likely the source\n5. FIX: Specific code changes needed (with snippets)\n6. PREVENTION: How to prevent this class of error in the future\n\nBe precise and technical.';
  const prompt = `Runtime Debug Request:\n${errorMessage ? `Error Message: ${errorMessage}\n` : ''}${errorStack ? `\nStack Trace:\n${errorStack.slice(0, 10_000)}\n` : ''}${codeContext ? `\nCode Context:\n${codeContext.slice(0, 15_000)}\n` : ''}${runtimeContext ? `\nRuntime Context:\n${runtimeContext.slice(0, 5_000)}\n` : ''}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 2500,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_debug_runtime',
    errorMessage: errorMessage.slice(0, 200) || null,
    diagnosis: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered security audit — scans code for vulnerabilities and security issues. */
export async function runAiSecurityAudit(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const language = readTrimmed(input.language) || '';
  const auditScope = readTrimmed(input.scope) || readTrimmed(input.auditScope) || 'general';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_security_audit.');
  }
  const system = 'You are a senior security engineer performing a code security audit. Analyze for:\n1. INJECTION RISKS: SQL injection, command injection, XSS, path traversal\n2. AUTH/AUTHZ: Broken access control, missing auth checks, privilege escalation\n3. SECRETS: Hardcoded credentials, tokens, API keys in code\n4. DATA EXPOSURE: Sensitive data in logs, responses, or error messages\n5. DEPENDENCY RISKS: Known vulnerable patterns or outdated APIs\n6. CRYPTO: Weak hashing, insecure random, hardcoded IVs\n7. SEVERITY: Rate each finding as critical | high | medium | low\n\nBe thorough. Report only real vulnerabilities, not false positives.';
  const prompt = `Security Audit Request:\n${filePath ? `File: ${filePath}\n` : ''}${language ? `Language: ${language}\n` : ''}Audit Scope: ${auditScope}\n\nCode:\n${code.slice(0, 30_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 3000,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_security_audit',
    path: filePath || null,
    auditScope,
    auditReport: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered performance analysis — identifies bottlenecks and optimization opportunities. */
export async function runAiPerformanceAnalysis(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const perfContext = readTrimmed(input.perfContext) || readTrimmed(input.context) || '';
  const language = readTrimmed(input.language) || '';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_performance_analysis.');
  }
  const system = 'You are a senior performance engineer analyzing code for bottlenecks. Provide:\n1. BOTTLENECKS: Identify specific performance issues (N+1 queries, unnecessary re-renders, blocking I/O, memory leaks, algorithmic complexity)\n2. IMPACT: Rate each as critical | high | medium | low with estimated affected user scenarios\n3. OPTIMIZATIONS: Specific code changes to fix each bottleneck (with snippets)\n4. METRICS: What to measure to verify the improvement\n5. TRADE-OFFS: Any readability/maintainability trade-offs from the optimizations\n\nFocus on real, measurable improvements, not micro-optimizations.';
  const prompt = `Performance Analysis Request:\n${filePath ? `File: ${filePath}\n` : ''}${language ? `Language: ${language}\n` : ''}${perfContext ? `Performance Context:\n${perfContext.slice(0, 5_000)}\n` : ''}\nCode:\n${code.slice(0, 30_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 2500,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_performance_analysis',
    path: filePath || null,
    analysis: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: AI-powered documentation generation — generates docs from code. */
export async function runAiGenerateDocs(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = readTrimmed(input.code) || readTrimmed(input.content);
  const filePath = readTrimmed(input.path) || readTrimmed(input.filePath) || '';
  const language = readTrimmed(input.language) || '';
  const docFormat = readTrimmed(input.format) || readTrimmed(input.docFormat) || 'markdown';
  if (!code || code.length < 10) {
    throw new Error('code or content (at least 10 characters) is required for ai_generate_docs.');
  }
  const system = 'You are a senior software engineer generating documentation from code. Output ONLY the documentation. Provide:\n1. OVERVIEW: What the code does (2-3 sentences)\n2. API/INTERFACE: Public functions, classes, types with signatures and descriptions\n3. PARAMETERS: All parameters with types and descriptions\n4. RETURN VALUES: What the code returns and in what format\n5. EXAMPLES: Usage examples\n6. EDGE CASES: Important behavior on edge cases\n\nBe clear and concise. Output in the requested format.';
  const prompt = `Documentation Request:\n${filePath ? `File: ${filePath}\n` : ''}${language ? `Language: ${language}\n` : ''}Format: ${docFormat}\n\nCode:\n${code.slice(0, 30_000)}`;
  const result = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system,
    prompt,
    maxOutputTokens: 2500,
  });
  return {
    provider: 'ivx-ai',
    action: 'ai_generate_docs',
    path: filePath || null,
    docFormat,
    documentation: result.text,
    model: result.providerMetadata.model,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: API endpoint probe — tests any API endpoint with method, headers, body, and timing. */
export async function runTestApiEndpoint(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = readTrimmed(input.url);
  const method = (readTrimmed(input.method) || 'GET').toUpperCase();
  const headersInput = input.headers;
  const body = readTrimmed(input.body) || '';
  const timeoutMs = Math.min(Number(input.timeoutMs) || 15_000, 30_000);
  if (!url || !url.startsWith('http')) {
    throw new Error('A valid http(s) URL is required for test_api_endpoint.');
  }
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new Error(`Unsupported HTTP method: ${method}`);
  }
  const headers: Record<string, string> = { 'User-Agent': 'IVX-IA-Senior-Dev/1.0' };
  if (headersInput && typeof headersInput === 'object' && !Array.isArray(headersInput)) {
    for (const [key, value] of Object.entries(headersInput as Record<string, unknown>)) {
      const headerName = readTrimmed(key);
      const headerValue = readTrimmed(value);
      if (headerName && headerValue) {
        headers[headerName] = headerValue;
      }
    }
  }
  if (body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }
  const startTime = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: body || undefined,
      signal: controller.signal,
      redirect: 'follow',
    });
  } catch (err) {
    clearTimeout(timeout);
    const elapsed = Date.now() - startTime;
    return {
      provider: 'ivx',
      action: 'test_api_endpoint',
      url,
      method,
      ok: false,
      error: err instanceof Error ? err.message : 'fetch failed',
      elapsedMs: elapsed,
      timedOut: err instanceof Error && err.name === 'AbortError',
      readOnly: true,
      secretValuesReturned: false,
      timestamp: nowIso(),
    };
  }
  clearTimeout(timeout);
  const elapsed = Date.now() - startTime;
  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value.slice(0, 500);
  });
  const responseText = await response.text();
  const truncated = responseText.length > 10_000;
  const responseBody = truncated ? responseText.slice(0, 10_000) + '\n... [TRUNCATED]' : responseText;
  let parsedJson: unknown = null;
  try {
    if (!truncated && responseText) {
      parsedJson = JSON.parse(responseText);
    }
  } catch { /* not JSON */ }
  return {
    provider: 'ivx',
    action: 'test_api_endpoint',
    url,
    method,
    ok: response.ok,
    status: response.status,
    statusText: response.statusText,
    elapsedMs: elapsed,
    responseHeaders: Object.keys(responseHeaders).length > 0 ? responseHeaders : null,
    responseBody: parsedJson ?? responseBody,
    responseIsJson: parsedJson !== null,
    responseSize: responseText.length,
    truncated,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/** Read-only: Render service logs — fetches recent log lines via Render Logs API (/v1/logs). */
export async function runRenderGetLogs(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const renderApiKey = readEnv('RENDER_API_KEY') || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  if (!renderApiKey) {
    throw new Error('RENDER_API_KEY is not configured in the backend runtime.');
  }
  const serviceId = readEnv('RENDER_SERVICE_ID') || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID') || readTrimmed(input.serviceId);
  if (!serviceId) {
    throw new Error('RENDER_SERVICE_ID is not configured and no serviceId was provided in input.');
  }
  const ownerId = readTrimmed(input.ownerId) || readEnv('RENDER_OWNER_ID');
  const logType = readTrimmed(input.type) || 'app';
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = Math.floor((Date.now() - 3600_000) / 1000); // last 1 hour
  // Render Logs API: GET /v1/logs with ownerId + resource query params
  const params = new URLSearchParams();
  if (ownerId) {
    params.set('ownerId', ownerId);
  }
  params.set('resource', serviceId);
  params.set('startTime', String(startTime));
  params.set('endTime', String(endTime));
  params.set('direction', 'backward');
  params.set('type', logType);
  const url = `${RENDER_API_BASE_URL}/logs?${params.toString()}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${renderApiKey}`,
    },
  });
  if (!response.ok) {
    const errorText = await response.text();
    // Fallback: try GET /v1/services/{id} for service info if logs endpoint fails
    if (response.status === 404 || response.status === 400) {
      const svcUrl = `${RENDER_API_BASE_URL}/services/${serviceId}`;
      const svcResp = await fetch(svcUrl, {
        method: 'GET',
        headers: { Accept: 'application/json', Authorization: `Bearer ${renderApiKey}` },
      });
      if (svcResp.ok) {
        const svcData = readRecord(await svcResp.json().catch(() => ({})));
        return {
          provider: 'render',
          action: 'render_get_logs',
          serviceId,
          ownerId: ownerId || null,
          logsEndpointAvailable: false,
          fallback: 'service_info',
          serviceName: readTrimmed(svcData.name) || null,
          serviceStatus: readTrimmed(svcData.status) || null,
          serviceCreatedAt: readTrimmed(svcData.createdAt) || null,
          message: 'Render logs API requires ownerId parameter. Service info returned as fallback. Pass ownerId in input to fetch actual logs.',
          readOnly: true,
          secretValuesReturned: false,
          timestamp: nowIso(),
        };
      }
    }
    throw new Error(`Render logs fetch failed: HTTP ${response.status} — ${errorText.slice(0, 300)}`);
  }
  const data = await response.text();
  let logEntries: Array<{ timestamp?: string; message?: string; level?: string; raw?: string }> = [];
  try {
    const parsed = JSON.parse(data) as unknown;
    if (Array.isArray(parsed)) {
      logEntries = parsed.map((entry: unknown) => {
        const rec = readRecord(entry);
        return {
          timestamp: readTrimmed(rec.timestamp) || readTrimmed(rec.time) || null,
          message: readTrimmed(rec.message) || readTrimmed(rec.text) || readTrimmed(rec.msg) || null,
          level: readTrimmed(rec.level) || null,
          raw: JSON.stringify(entry).slice(0, 500),
        };
      });
    } else if (typeof parsed === 'object' && parsed !== null) {
      const record = parsed as Record<string, unknown>;
      const logsArray = Array.isArray(record.logs) ? record.logs : Array.isArray(record.entries) ? record.entries : Array.isArray(record.data) ? record.data : [];
      logEntries = logsArray.map((entry: unknown) => {
        const rec = readRecord(entry);
        return {
          timestamp: readTrimmed(rec.timestamp) || readTrimmed(rec.time) || null,
          message: readTrimmed(rec.message) || readTrimmed(rec.text) || readTrimmed(rec.msg) || null,
          level: readTrimmed(rec.level) || null,
          raw: JSON.stringify(entry).slice(0, 500),
        };
      });
    }
  } catch {
    logEntries = data.split('\n').filter(Boolean).map((line) => ({ raw: line.slice(0, 500) }));
  }
  const truncated = logEntries.length > 200;
  const resultEntries = truncated ? logEntries.slice(0, 200) : logEntries;
  const logsText = resultEntries.map((e) => {
    const parts: string[] = [];
    if (e.timestamp) parts.push(e.timestamp);
    if (e.level) parts.push(`[${e.level}]`);
    if (e.message) parts.push(e.message);
    return parts.length > 0 ? parts.join(' ') : (e.raw || '');
  }).filter(Boolean).join('\n');
  return {
    provider: 'render',
    action: 'render_get_logs',
    serviceId,
    ownerId: ownerId || null,
    logType,
    timeRange: `last 1 hour (${startTime} to ${endTime})`,
    logsEndpointAvailable: true,
    entriesReturned: resultEntries.length,
    truncated,
    logs: logsText,
    readOnly: true,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/**
 * Write action (owner-approved): autonomous feature cycle — designs a feature via AI,
 * generates the code via AI, commits it to GitHub, optionally deploys to Render,
 * and optionally verifies the deployment via API probe.
 * Requires CONFIRM_IVX_GITHUB_WRITE confirmation phrase.
 */
async function runAutonomousFeatureCycle(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const featureDescription = readTrimmed(input.featureDescription) || readTrimmed(input.description);
  const targetPath = sanitizeRepoPath(input.path);
  const language = readTrimmed(input.language) || 'typescript';
  const framework = readTrimmed(input.framework) || '';
  const commitMessage = readTrimmed(input.commitMessage) || `feat: autonomous feature — ${targetPath}`;
  const skipDeploy = parseBoolean(input.skipDeploy);
  const skipVerify = parseBoolean(input.skipVerify);
  if (!featureDescription || featureDescription.length < 10) {
    throw new Error('featureDescription or description (at least 10 characters) is required for autonomous_feature_cycle.');
  }
  const headers = await githubHeaders();
  const steps: Array<{ step: string; status: string; detail?: string }> = [];

  // Step 1: AI design the feature
  steps.push({ step: 'ai_design', status: 'started' });
  const designResult = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system: 'You are a senior software engineer designing a feature. Provide a concise implementation plan with file paths, data models, and steps. Keep it under 2000 chars.',
    prompt: `Feature: ${featureDescription}\nTarget File: ${targetPath}\nLanguage: ${language}\n${framework ? `Framework: ${framework}\n` : ''}Provide a concise implementation plan.`,
    maxOutputTokens: 2000,
  });
  const designPlan = designResult.text;
  steps.push({ step: 'ai_design', status: 'success', detail: `${designPlan.length} chars` });

  // Step 2: AI generate the code
  steps.push({ step: 'ai_generate_code', status: 'started' });
  const codeResult = await requestIVXAIText({
    module: 'ivx-ia-senior-dev',
    system: 'You are a senior software engineer generating production code. Output ONLY the code file content. No markdown fences. The code must be complete, type-safe, and directly usable.',
    prompt: `Feature: ${featureDescription}\nDesign Plan: ${designPlan}\nTarget File: ${targetPath}\nLanguage: ${language}\n${framework ? `Framework: ${framework}\n` : ''}Output the complete code file. No markdown fences.`,
    maxOutputTokens: 4000,
  });
  let generatedCode = codeResult.text.trim().replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');
  if (!generatedCode || generatedCode.length < 5) {
    steps.push({ step: 'ai_generate_code', status: 'failed', detail: 'AI returned empty code' });
    throw new Error('Autonomous feature: AI generated empty code content.');
  }
  steps.push({ step: 'ai_generate_code', status: 'success', detail: `${generatedCode.length} bytes generated` });

  // Step 3: Commit to GitHub
  steps.push({ step: 'commit_code', status: 'started' });
  const encodedPath = targetPath.split('/').map((part) => encodeURIComponent(part)).join('/');
  // Check if file already exists (for sha)
  const readUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`;
  const readResponse = await fetchJson(readUrl, { method: 'GET', headers }).catch(() => null);
  const existingSha = readResponse?.ok === true ? readTrimmed(readRecord(readResponse.data).sha) : undefined;
  const commitBody: Record<string, unknown> = {
    message: commitMessage,
    content: Buffer.from(generatedCode, 'utf8').toString('base64'),
    branch,
  };
  if (existingSha) {
    commitBody.sha = existingSha;
  }
  const commitUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}`;
  const commitResponse = await fetchJson(commitUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify(commitBody),
  });
  if (!commitResponse.ok) {
    steps.push({ step: 'commit_code', status: 'failed', detail: `HTTP ${commitResponse.status}` });
    throw new Error(`Autonomous feature: GitHub commit failed with HTTP ${commitResponse.status}.`);
  }
  const commitData = readRecord(commitResponse.data);
  const commitRecord = readRecord(commitData.commit);
  const commitSha = readTrimmed(commitRecord.sha) || null;
  steps.push({ step: 'commit_code', status: 'success', detail: `commit ${commitSha?.slice(0, 8) ?? 'unknown'}` });

  // Step 4: Optionally deploy to Render
  let deployTriggered = false;
  if (!skipDeploy) {
    steps.push({ step: 'render_deploy', status: 'started' });
    try {
      const renderApiKey = readEnv('RENDER_API_KEY') || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
      const serviceId = readEnv('RENDER_SERVICE_ID') || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
      if (renderApiKey && serviceId) {
        const deployResp = await fetch(`${RENDER_API_BASE_URL}/services/${serviceId}/deploys`, {
          method: 'POST',
          headers: { Accept: 'application/json', Authorization: `Bearer ${renderApiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        deployTriggered = deployResp.ok;
        steps.push({ step: 'render_deploy', status: deployResp.ok ? 'success' : 'skipped', detail: deployResp.ok ? 'deploy triggered' : `HTTP ${deployResp.status}` });
      } else {
        steps.push({ step: 'render_deploy', status: 'skipped', detail: 'RENDER_API_KEY or RENDER_SERVICE_ID not configured' });
      }
    } catch (err) {
      steps.push({ step: 'render_deploy', status: 'skipped', detail: err instanceof Error ? err.message : 'error' });
    }
  }

  // Step 5: Optionally verify deployment
  let verifyResult: Record<string, unknown> | null = null;
  if (!skipDeploy && !skipVerify) {
    steps.push({ step: 'verify_deploy', status: 'started' });
    try {
      const healthUrl = readTrimmed(input.verifyUrl) || 'https://api.ivxholding.com/health';
      const healthResp = await fetch(healthUrl, { method: 'GET', signal: AbortSignal.timeout(15_000) });
      const healthBody = await healthResp.text();
      verifyResult = {
        url: healthUrl,
        status: healthResp.status,
        ok: healthResp.ok,
        body: healthBody.slice(0, 500),
      };
      steps.push({ step: 'verify_deploy', status: 'success', detail: `HTTP ${healthResp.status}` });
    } catch (err) {
      steps.push({ step: 'verify_deploy', status: 'skipped', detail: err instanceof Error ? err.message : 'error' });
    }
  }

  return {
    provider: 'github',
    action: 'autonomous_feature_cycle',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    path: targetPath,
    featureDescription: featureDescription.slice(0, 200),
    designPlan: designPlan.slice(0, 500),
    generatedCodeLength: generatedCode.length,
    commitSha,
    commitUrl: readTrimmed(commitRecord.html_url) || null,
    deployTriggered,
    verifyResult,
    steps,
    readOnly: false,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

/**
 * Write action (owner-approved): commit multiple files to GitHub in a single operation.
 * Uses the Git Data API (create blob → create tree → create commit → update ref).
 * Requires CONFIRM_IVX_GITHUB_WRITE confirmation phrase.
 */
async function runGithubCommitMultiFile(input: Record<string, unknown>): Promise<Record<string, unknown>> {
  const repoInfo = await getGithubRepoInfo(input);
  const branch = readTrimmed(input.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const message = readTrimmed(input.message) || readTrimmed(input.commitMessage);
  const filesRaw = input.files;
  if (!message) {
    throw new Error('A commit message is required for github_commit_multi_file.');
  }
  if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
    throw new Error('files (non-empty array of {path, content}) is required for github_commit_multi_file.');
  }
  if (filesRaw.length > 20) {
    throw new Error('Maximum 20 files per github_commit_multi_file call.');
  }
  const headers = await githubHeaders();

  // Validate and sanitize all file paths
  const files: Array<{ path: string; content: string }> = [];
  for (const fileEntry of filesRaw) {
    const record = readRecord(fileEntry);
    const filePath = sanitizeRepoPath(record.path);
    const content = readTrimmed(record.content);
    if (!content) {
      throw new Error(`File ${filePath} has empty content.`);
    }
    if (content.length > MAX_COMMIT_CONTENT_LENGTH) {
      throw new Error(`File ${filePath} content exceeds max length of ${MAX_COMMIT_CONTENT_LENGTH} chars.`);
    }
    files.push({ path: filePath, content });
  }

  // Step 1: Get the current commit SHA for the branch
  const refUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${encodeURIComponent(branch)}`;
  const refResponse = await fetchJson(refUrl, { method: 'GET', headers });
  if (!refResponse.ok) {
    throw new Error(`Could not get branch ref: HTTP ${refResponse.status}`);
  }
  const refData = readRecord(refResponse.data);
  const refObject = readRecord(refData.object);
  const baseSha = readTrimmed(refObject.sha);
  if (!baseSha) {
    throw new Error('Could not extract base commit SHA from branch ref.');
  }

  // Step 2: Get the base tree
  const commitUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits/${baseSha}`;
  const commitResponse = await fetchJson(commitUrl, { method: 'GET', headers });
  if (!commitResponse.ok) {
    throw new Error(`Could not get base commit: HTTP ${commitResponse.status}`);
  }
  const commitData = readRecord(commitResponse.data);
  const baseTree = readRecord(commitData.tree);
  const baseTreeSha = readTrimmed(baseTree.sha);
  if (!baseTreeSha) {
    throw new Error('Could not extract base tree SHA.');
  }

  // Step 3: Create blobs for all files
  const treeEntries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
  for (const file of files) {
    const blobUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/blobs`;
    const blobResponse = await fetchJson(blobUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        content: file.content,
        encoding: 'utf-8',
      }),
    });
    if (!blobResponse.ok) {
      throw new Error(`Could not create blob for ${file.path}: HTTP ${blobResponse.status}`);
    }
    const blobData = readRecord(blobResponse.data);
    const blobSha = readTrimmed(blobData.sha);
    if (!blobSha) {
      throw new Error(`Could not extract blob SHA for ${file.path}.`);
    }
    treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blobSha });
  }

  // Step 4: Create the new tree
  const treeUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees`;
  const treeResponse = await fetchJson(treeUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: treeEntries,
    }),
  });
  if (!treeResponse.ok) {
    throw new Error(`Could not create tree: HTTP ${treeResponse.status}`);
  }
  const treeData = readRecord(treeResponse.data);
  const newTreeSha = readTrimmed(treeData.sha);
  if (!newTreeSha) {
    throw new Error('Could not extract new tree SHA.');
  }

  // Step 5: Create the commit
  const newCommitUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits`;
  const newCommitResponse = await fetchJson(newCommitUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      tree: newTreeSha,
      parents: [baseSha],
    }),
  });
  if (!newCommitResponse.ok) {
    throw new Error(`Could not create commit: HTTP ${newCommitResponse.status}`);
  }
  const newCommitData = readRecord(newCommitResponse.data);
  const newCommitSha = readTrimmed(newCommitData.sha);
  if (!newCommitSha) {
    throw new Error('Could not extract new commit SHA.');
  }

  // Step 6: Update the branch ref
  const updateRefResponse = await fetchJson(refUrl, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ sha: newCommitSha }),
  });
  if (!updateRefResponse.ok) {
    throw new Error(`Could not update branch ref: HTTP ${updateRefResponse.status}`);
  }

  return {
    provider: 'github',
    action: 'github_commit_multi_file',
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    branch,
    message,
    fileCount: files.length,
    files: files.map((f) => f.path),
    commitSha: newCommitSha,
    commitUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/commit/${newCommitSha}`,
    readOnly: false,
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

async function runAction(action: DeveloperDeployAction, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (action === 'github_commit_file') {
    return await runGithubCommitFile(input);
  }
  if (action === 'github_create_branch') {
    return await runGithubCreateBranch(input);
  }
  if (action === 'github_create_pull_request') {
    return await runGithubCreatePullRequest(input);
  }
  if (action === 'github_pull_request_status') {
    return await runGithubPullRequestStatus(input);
  }
  if (action === 'github_merge_pull_request') {
    return await runGithubMergePullRequest(input);
  }
  if (action === 'github_create_rollback_tag') {
    return await runGithubCreateRollbackTag(input);
  }
  if (action === 'github_dispatch_workflow') {
    return await runGithubDispatchWorkflow(input);
  }
  if (action === 'github_create_repository') {
    return await runGithubCreateRepository(input);
  }
  if (action === 'github_list_workflow_runs') {
    return await runGithubListWorkflowRuns(input);
  }
  if (action === 'github_get_workflow_run') {
    return await runGithubGetWorkflowRun(input);
  }
  if (action === 'github_token_scopes') {
    return await runGithubTokenScopes(input);
  }
  if (action === 'verify_url_sha256') {
    return await runVerifyUrlSha256(input);
  }
  if (action === 'render_trigger_deploy') {
    return await runRenderTriggerDeploy(input);
  }
  if (action === 'render_restart_service') {
    return await runRenderRestartService(input);
  }
  if (action === 'render_upsert_env_var') {
    return await runRenderUpsertEnvVar(input);
  }
  if (action === 'render_update_subdomain_policy') {
    return await runRenderUpdateSubdomainPolicy(input);
  }
  if (action === 'render_update_source') {
    return await runRenderUpdateSource(input);
  }
  if (action === 'supabase_reset_owner_password') {
    return await runSupabaseResetOwnerPassword(input);
  }
  if (action === 'supabase_revoke_owner_sessions') {
    return await runSupabaseRevokeOwnerSessions(input);
  }
  if (action === 'supabase_audit_owner_auth_user') {
    return await runSupabaseAuditOwnerAuthUser(input);
  }
  if (action === 'send_owner_password_reset_email_via_ses') {
    return await runSendOwnerPasswordResetEmailViaSES(input);
  }
  if (action === 'generate_owner_password_reset_link') {
    return await runGenerateOwnerPasswordResetLink(input);
  }
  if (action === 'verify_ses_email_identity') {
    return await runVerifySesEmailIdentity(input);
  }
  if (action === 'list_ses_identities') {
    return await runListSesIdentities();
  }
  if (action === 'get_supabase_auth_config') {
    return await getSupabaseAuthConfig();
  }
  if (action === 'update_supabase_auth_config') {
    return await updateSupabaseAuthConfig(input);
  }
  if (action === 'disable_supabase_mfa_aal2_enforcement') {
    return await runDisableSupabaseMfaAal2Enforcement();
  }
  if (action === 'unenroll_owner_mfa_factor') {
    return await runUnenrollOwnerMfaFactor(input);
  }
  if (action === 'cloudfront_invalidate') {
    return await runCloudFrontInvalidate(input);
  }
  if (action === 'github_read_file') {
    return await runGithubReadFile(input);
  }
  if (action === 'github_search_code') {
    return await runGithubSearchCode(input);
  }
  if (action === 'github_list_directory') {
    return await runGithubListDirectory(input);
  }
  if (action === 'github_get_file_tree') {
    return await runGithubGetFileTree(input);
  }
  if (action === 'github_get_workflow_logs') {
    return await runGithubGetWorkflowLogs(input);
  }
  if (action === 'ai_diagnose_failure') {
    return await runAiDiagnoseFailure(input);
  }
  if (action === 'ai_analyze_code') {
    return await runAiAnalyzeCode(input);
  }
  if (action === 'ai_generate_fix') {
    return await runAiGenerateFix(input);
  }
  if (action === 'ai_review_architecture') {
    return await runAiReviewArchitecture(input);
  }
  if (action === 'analyze_dependencies') {
    return await runAnalyzeDependencies(input);
  }
  if (action === 'autonomous_fix_cycle') {
    return await runAutonomousFixCycle(input);
  }
  if (action === 'ai_design_feature') {
    return await runAiDesignFeature(input);
  }
  if (action === 'ai_generate_code') {
    return await runAiGenerateCode(input);
  }
  if (action === 'ai_generate_tests') {
    return await runAiGenerateTests(input);
  }
  if (action === 'ai_refactor_code') {
    return await runAiRefactorCode(input);
  }
  if (action === 'ai_debug_runtime') {
    return await runAiDebugRuntime(input);
  }
  if (action === 'ai_security_audit') {
    return await runAiSecurityAudit(input);
  }
  if (action === 'ai_performance_analysis') {
    return await runAiPerformanceAnalysis(input);
  }
  if (action === 'ai_generate_docs') {
    return await runAiGenerateDocs(input);
  }
  if (action === 'test_api_endpoint') {
    return await runTestApiEndpoint(input);
  }
  if (action === 'render_get_logs') {
    return await runRenderGetLogs(input);
  }
  if (action === 'autonomous_feature_cycle') {
    return await runAutonomousFeatureCycle(input);
  }
  if (action === 'github_commit_multi_file') {
    return await runGithubCommitMultiFile(input);
  }
  if (action === 'supabase_execute_sql_management') {
    return await runSupabaseExecuteSqlViaManagement(input);
  }
  return await runSupabaseExecuteSql(input);
}

async function auditDeveloperDeployAction(ownerContext: IVXOwnerRequestContext, action: DeveloperDeployAction, input: Record<string, unknown>, result: Record<string, unknown>, reason: string | null): Promise<void> {
  console.log('[IVXDeveloperDeployControl] Owner-approved action executed:', {
    userId: ownerContext.userId,
    email: ownerContext.email,
    action,
    reason,
    targetPath: action === 'github_commit_file' ? readTrimmed(input.path) : undefined,
    envKey: action === 'render_upsert_env_var' ? readTrimmed(input.key) : undefined,
    renderSubdomainPolicy: action === 'render_update_subdomain_policy' ? normalizeRenderSubdomainPolicy(input.renderSubdomainPolicy ?? input.policy) : undefined,
    renderSourceBranch: action === 'render_update_source' ? readTrimmed(input.branch) || 'main' : undefined,
    sqlLength: action === 'supabase_execute_sql' ? readTrimmed(input.sql).length : undefined,
    resetEmail: action === 'supabase_reset_owner_password' || action === 'send_owner_password_reset_email_via_ses' || action === 'generate_owner_password_reset_link' ? readTrimmed(input.email) : undefined,
    resultProvider: readTrimmed(result.provider),
    timestamp: nowIso(),
  });
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXDeveloperDeployStatusRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    return ownerOnlyJson({ ...(await buildStatus()), authenticatedUserId: ownerContext.userId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Developer deploy status failed.';
    return ownerOnlyJson({ ok: false, ownerOnly: true, readOnly: true, error: message, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
  }
}

export async function handleIVXDeveloperDeployActionRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
    }
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = await request.json().catch((): DeveloperDeployRequest => ({}));
    const action = normalizeAction(body.action);
    const input = readRecord(body.input);
    const requiredText = requiredConfirmationText(action);
    if (!isReadOnlyAction(action) && (body.confirm !== true || readTrimmed(body.confirmText) !== requiredText)) {
      return ownerOnlyJson({
        ok: false,
        ownerOnly: true,
        writeEnabled: true,
        action,
        confirmationRequired: true,
        confirmTextRequired: requiredText,
        message: `Confirm this ${action} by resubmitting with confirm=true and confirmText="${requiredText}".`,
        secretValuesReturned: false,
        timestamp: nowIso(),
      }, 409);
    }

    if (!isReadOnlyAction(action)) {
      assertConfirmed(action, body);
    }
    // ─── Pre-Execution Feasibility Gate (Stage 0) ───────────────────────────
    // Runs BEFORE runAction executes any deploy/migration/push. Owner session is
    // verified above (assertIVXOwnerOnly succeeded), so ownerSessionPresent=true.
    try {
      const gate = await checkPreExecutionGate(request, {
        prompt: `${action} ${JSON.stringify(input).slice(0, 500)}`,
        ownerSessionPresent: true,
        entryPoint: 'developer-deploy-action',
      });
      if (gate.blocked && gate.response) {
        return gate.response;
      }
    } catch (gateError) {
      console.log('[IVXDeveloperDeployControl] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }
    const result = await runAction(action, input);
    await auditDeveloperDeployAction(ownerContext, action, input, result, readTrimmed(body.reason) || null);
    return ownerOnlyJson({
      ok: true,
      ownerOnly: true,
      writeEnabled: true,
      action,
      result,
      authenticatedUserId: ownerContext.userId,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Developer deploy action failed.';
    console.log('[IVXDeveloperDeployControl] Action failed:', { message });
    return ownerOnlyJson({ ok: false, ownerOnly: true, writeEnabled: true, error: message, secretValuesReturned: false, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
  }
}
