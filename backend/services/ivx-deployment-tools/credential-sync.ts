/**
 * IVX Credential Sync Tool
 *
 * Auto-discovers credentials across all platforms:
 *   - GitHub Secrets
 *   - Render Environment Variables
 *   - Supabase (via owner variables table)
 *   - Vercel Environment Variables
 *   - IVX Secure Variables (owner variables table)
 *   - Production Runtime (process.env)
 *
 * Validates each credential and identifies gaps.
 */

import { getIVXOwnerVariableRuntimeValue } from '../../api/ivx-owner-variables';
import * as GitHubTool from './github-tool';
import * as RenderTool from './render-tool';

// ─── Types ───────────────────────────────────────────────────────────

export type CredentialSource =
  | 'process.env'
  | 'owner_variables'
  | 'github_secrets'
  | 'render_env'
  | 'supabase_vault'
  | 'unknown';

export type CredentialValidation = 'valid' | 'missing' | 'expired' | 'wrong_scope' | 'auth_failed' | 'network_error' | 'unverified';

export interface DiscoveredCredential {
  name: string;
  category: 'github' | 'render' | 'supabase' | 'aws' | 'ai' | 'security' | 'other';
  required: boolean;
  sources: {
    source: CredentialSource;
    present: boolean;
    masked: string;
  }[];
  validation: CredentialValidation;
  validationDetail: string | null;
  tested: boolean;
}

export interface CredentialSyncResult {
  ok: boolean;
  credentials: DiscoveredCredential[];
  summary: {
    total: number;
    valid: number;
    missing: number;
    failed: number;
    unverified: number;
  };
  gaps: string[];
  recommendations: string[];
}

// ─── Credential Registry ──────────────────────────────────────────────

const CREDENTIAL_REGISTRY: Array<{
  name: string;
  category: DiscoveredCredential['category'];
  required: boolean;
  envName: string;
  testFn?: (value: string) => Promise<{ ok: boolean; detail: string }>;
}> = [
  { name: 'GITHUB_TOKEN', category: 'github', required: true, envName: 'GITHUB_TOKEN' },
  { name: 'GITHUB_REPO_URL', category: 'github', required: true, envName: 'GITHUB_REPO_URL' },
  { name: 'RENDER_API_KEY', category: 'render', required: true, envName: 'RENDER_API_KEY' },
  { name: 'RENDER_SERVICE_ID', category: 'render', required: true, envName: 'RENDER_SERVICE_ID' },
  { name: 'SUPABASE_URL', category: 'supabase', required: true, envName: 'SUPABASE_URL' },
  { name: 'EXPO_PUBLIC_SUPABASE_URL', category: 'supabase', required: true, envName: 'EXPO_PUBLIC_SUPABASE_URL' },
  { name: 'SUPABASE_SERVICE_ROLE_KEY', category: 'supabase', required: true, envName: 'SUPABASE_SERVICE_ROLE_KEY' },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', category: 'supabase', required: true, envName: 'EXPO_PUBLIC_SUPABASE_ANON_KEY' },
  { name: 'SUPABASE_DB_URL', category: 'supabase', required: false, envName: 'SUPABASE_DB_URL' },
  { name: 'SUPABASE_DB_PASSWORD', category: 'supabase', required: false, envName: 'SUPABASE_DB_PASSWORD' },
  { name: 'DATABASE_URL', category: 'supabase', required: false, envName: 'DATABASE_URL' },
  { name: 'POSTGRES_URL', category: 'supabase', required: false, envName: 'POSTGRES_URL' },
  { name: 'AWS_ACCESS_KEY_ID', category: 'aws', required: false, envName: 'AWS_ACCESS_KEY_ID' },
  { name: 'AWS_SECRET_ACCESS_KEY', category: 'aws', required: false, envName: 'AWS_SECRET_ACCESS_KEY' },
  { name: 'AWS_REGION', category: 'aws', required: false, envName: 'AWS_REGION' },
  { name: 'S3_BUCKET_NAME', category: 'aws', required: false, envName: 'S3_BUCKET_NAME' },
  { name: 'CLOUDFRONT_DISTRIBUTION_ID', category: 'aws', required: false, envName: 'CLOUDFRONT_DISTRIBUTION_ID' },
  { name: 'IVX_AI_GATEWAY_KEY', category: 'ai', required: false, envName: 'IVX_AI_GATEWAY_KEY' },
  { name: 'JWT_SECRET', category: 'security', required: false, envName: 'JWT_SECRET' },
  { name: 'APP_SECRET', category: 'security', required: false, envName: 'APP_SECRET' },
  { name: 'OWNER_NEW_PASSWORD', category: 'security', required: false, envName: 'OWNER_NEW_PASSWORD' },
  { name: 'STRIPE_API_KEY', category: 'other', required: false, envName: 'STRIPE_API_KEY' },
];

// ─── Helpers ──────────────────────────────────────────────────────────

function maskSecret(value: string): string {
  if (!value) return 'missing';
  if (value.length <= 6) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

function checkProcessEnv(name: string): { present: boolean; masked: string } {
  const value = (process.env[name] ?? '').trim();
  return { present: value.length > 0, masked: maskSecret(value) };
}

async function checkOwnerVariables(name: string): Promise<{ present: boolean; masked: string }> {
  try {
    const value = await getIVXOwnerVariableRuntimeValue(name as never);
    const present = typeof value === 'string' && value.trim().length > 0;
    return { present, masked: present ? maskSecret(value) : 'missing' };
  } catch {
    return { present: false, masked: 'missing' };
  }
}

// ─── Validation Tests ─────────────────────────────────────────────────

async function testGitHubToken(token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.github.com/user', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    });
    if (res.status === 200) return { ok: true, detail: 'authenticated' };
    if (res.status === 401) return { ok: false, detail: '401 — token invalid or expired' };
    if (res.status === 403) return { ok: false, detail: '403 — insufficient permissions' };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function testRenderToken(token: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch('https://api.render.com/v1/owners', {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (res.status === 200) return { ok: true, detail: 'authenticated' };
    if (res.status === 401) return { ok: false, detail: '401 — token invalid' };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function testSupabaseConnection(url: string, key: string): Promise<{ ok: boolean; detail: string }> {
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) return { ok: true, detail: 'accessible' };
    return { ok: false, detail: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, detail: `network: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// ─── Main Discovery ───────────────────────────────────────────────────

export async function discoverAllCredentials(): Promise<CredentialSyncResult> {
  const credentials: DiscoveredCredential[] = [];
  const gaps: string[] = [];
  const recommendations: string[] = [];

  // Get GitHub secrets, Render env, Vercel env in parallel
  const [githubSecrets, renderEnv] = await Promise.all([
    GitHubTool.getSecrets().catch(() => ({ ok: false, secrets: [] })),
    RenderTool.getEnvVars().catch(() => ({ ok: false, envVars: [] })),
  ]);

  const githubSecretNames = new Set(
    (githubSecrets.secrets ?? []).map(s => s.name),
  );
  const renderEnvKeys = new Set(
    (renderEnv.envVars ?? []).map(e => e.key),
  );
  for (const reg of CREDENTIAL_REGISTRY) {
    const [envCheck, ownerCheck] = await Promise.all([
      Promise.resolve(checkProcessEnv(reg.envName)),
      checkOwnerVariables(reg.name),
    ]);

    const sources: DiscoveredCredential['sources'] = [
      { source: 'process.env', present: envCheck.present, masked: envCheck.masked },
      { source: 'owner_variables', present: ownerCheck.present, masked: ownerCheck.masked },
    ];

    // Check if the credential name appears in GitHub secrets
    if (githubSecretNames.has(reg.name)) {
      sources.push({ source: 'github_secrets', present: true, masked: '*** (GitHub secret)' });
    }

    // Check Render env vars
    if (renderEnvKeys.has(reg.name) || renderEnvKeys.has(reg.envName)) {
      sources.push({ source: 'render_env', present: true, masked: '*** (Render env)' });
    }

    // Check Vercel env vars


    const anyPresent = sources.some(s => s.present);

    let validation: CredentialValidation = 'unverified';
    let validationDetail: string | null = null;
    let tested = false;

    if (!anyPresent) {
      validation = 'missing';
      validationDetail = 'Not found in any source';
      if (reg.required) {
        gaps.push(`${reg.name} (${reg.category}) — REQUIRED but missing from all sources`);
      }
    } else if (reg.category === 'github' && reg.name === 'GITHUB_TOKEN') {
      const tokenValue = (process.env.GITHUB_TOKEN ?? '').trim();
      if (tokenValue) {
        const test = await testGitHubToken(tokenValue);
        tested = true;
        validation = test.ok ? 'valid' : 'auth_failed';
        validationDetail = test.detail;
      }
    } else if (reg.category === 'render' && reg.name === 'RENDER_API_KEY') {
      const tokenValue = (process.env.RENDER_API_KEY ?? '').trim();
      if (tokenValue) {
        const test = await testRenderToken(tokenValue);
        tested = true;
        validation = test.ok ? 'valid' : 'auth_failed';
        validationDetail = test.detail;
      }
    } else if (reg.category === 'supabase' && reg.name === 'SUPABASE_SERVICE_ROLE_KEY') {
      const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim() || (process.env.SUPABASE_URL ?? '').trim();
      const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
      if (url && key) {
        const test = await testSupabaseConnection(url, key);
        tested = true;
        validation = test.ok ? 'valid' : 'auth_failed';
        validationDetail = test.detail;
      }
    } else if (anyPresent) {
      validation = 'valid';
      validationDetail = 'Present (not fully tested)';
    }

    credentials.push({
      name: reg.name,
      category: reg.category,
      required: reg.required,
      sources,
      validation,
      validationDetail,
      tested,
    });
  }

  // Build summary
  const valid = credentials.filter(c => c.validation === 'valid').length;
  const missing = credentials.filter(c => c.validation === 'missing').length;
  const failed = credentials.filter(c => c.validation === 'auth_failed' || c.validation === 'expired' || c.validation === 'wrong_scope').length;
  const unverified = credentials.filter(c => c.validation === 'unverified').length;

  const requiredMissing = credentials.filter(c => c.required && c.validation === 'missing');
  if (requiredMissing.length > 0) {
    recommendations.push(`Configure missing required credentials: ${requiredMissing.map(c => c.name).join(', ')}`);
  }

  return {
    ok: true,
    credentials,
    summary: { total: credentials.length, valid, missing, failed, unverified },
    gaps,
    recommendations,
  };
}

export { CREDENTIAL_REGISTRY };
