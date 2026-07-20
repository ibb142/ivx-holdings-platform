import { describe, expect, it } from 'bun:test';
import {
  buildRuntimeVariablesReport,
  buildRuntimeVariablesAudit,
  isPublicClientVar,
  maskSecret,
  parseGithubRepoPath,
  RUNTIME_VARIABLE_SPECS,
  saveVariableValue,
  verifyAllVariables,
  verifyVariable,
} from './ivx-runtime-variables';

type EnvSnapshot = Record<string, string | undefined>;

function fakeFetch(routes: Record<string, { status: number; body?: string }>) {
  return async (input: string): Promise<Response> => {
    const match = Object.keys(routes).find((key) => input.includes(key));
    const route = match ? routes[match] : { status: 404, body: 'not-found' };
    return new Response(route.body ?? '', { status: route.status });
  };
}

describe('maskSecret', () => {
  it('never returns the raw value and fully masks short values', () => {
    expect(maskSecret('abc')).toBe('***');
    expect(maskSecret('123456')).toBe('******');
  });

  it('shows only first 3 + last 2 for longer values', () => {
    const masked = maskSecret('ghp_abcdefghijklmnop');
    expect(masked.startsWith('ghp')).toBe(true);
    expect(masked.endsWith('op')).toBe(true);
    expect(masked).not.toContain('abcdefghij');
  });
});

describe('isPublicClientVar', () => {
  it('flags EXPO_PUBLIC / VITE / RORK_PUBLIC vars', () => {
    expect(isPublicClientVar('EXPO_PUBLIC_SUPABASE_URL')).toBe(true);
    expect(isPublicClientVar('VITE_FOO')).toBe(true);
    expect(isPublicClientVar('GITHUB_TOKEN')).toBe(false);
  });
});

describe('parseGithubRepoPath', () => {
  it('parses owner/repo from various URL forms', () => {
    expect(parseGithubRepoPath('https://github.com/acme/ivx.git')).toBe('acme/ivx');
    expect(parseGithubRepoPath('git@github.com:acme/ivx.git')).toBe('acme/ivx');
    expect(parseGithubRepoPath('acme/ivx')).toBe('acme/ivx');
    expect(parseGithubRepoPath('')).toBeNull();
  });
});

describe('buildRuntimeVariablesReport', () => {
  it('classifies present, not-injected, and missing correctly with masked values and no raw secrets', () => {
    const env: EnvSnapshot = {
      GITHUB_TOKEN: 'ghp_secretsecretsecret',
      // GITHUB_REPO_URL absent but known in Rork → PRESENT_IN_RORK_NOT_INJECTED
      // OPENAI_API_KEY absent and not known in Rork → MISSING_FROM_RORK
    };
    const report = buildRuntimeVariablesReport(env, 'test-runtime');
    expect(report.total).toBe(RUNTIME_VARIABLE_SPECS.length);

    const githubToken = report.variables.find((v) => v.name === 'GITHUB_TOKEN');
    expect(githubToken?.status).toBe('PRESENT_IN_RUNTIME');
    expect(githubToken?.present).toBe(true);
    expect(githubToken?.masked).not.toContain('secretsecret');

    const repoUrl = report.variables.find((v) => v.name === 'GITHUB_REPO_URL');
    expect(repoUrl?.status).toBe('PRESENT_IN_RORK_NOT_INJECTED');

    const openai = report.variables.find((v) => v.name === 'OPENAI_API_KEY');
    expect(openai?.status).toBe('MISSING_FROM_RORK');
  });

  it('resolves a variable from an alias', () => {
    const env: EnvSnapshot = { EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co' };
    const report = buildRuntimeVariablesReport(env);
    const supabaseUrl = report.variables.find((v) => v.name === 'SUPABASE_URL');
    expect(supabaseUrl?.present).toBe(true);
    expect(supabaseUrl?.resolvedFrom).toBe('EXPO_PUBLIC_SUPABASE_URL');
  });
});

describe('verifyVariable', () => {
  it('returns VERIFIED on a 200 GitHub probe', async () => {
    const env: EnvSnapshot = { GITHUB_TOKEN: 'ghp_x', GITHUB_REPO_URL: 'acme/ivx' };
    const result = await verifyVariable('GITHUB_TOKEN', env, fakeFetch({ 'api.github.com/repos/acme/ivx': { status: 200, body: '{}' } }));
    expect(result.status).toBe('VERIFIED');
    expect(result.ok).toBe(true);
  });

  it('returns PRESENT_BUT_UNAUTHORIZED on a 401 Render probe', async () => {
    const env: EnvSnapshot = { RENDER_API_KEY: 'bad', RENDER_SERVICE_ID: 'srv-1' };
    const result = await verifyVariable('RENDER_API_KEY', env, fakeFetch({ 'api.render.com/v1/services/srv-1': { status: 401 } }));
    expect(result.status).toBe('PRESENT_BUT_UNAUTHORIZED');
    expect(result.ok).toBe(false);
  });

  it('marks Supabase anon key VERIFIED when a real table read returns 200', async () => {
    const env: EnvSnapshot = {
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    };
    const result = await verifyVariable('EXPO_PUBLIC_SUPABASE_ANON_KEY', env, fakeFetch({ 'abc.supabase.co/rest/v1/jv_deals?select=id&limit=1': { status: 200, body: '[]' } }));
    expect(result.status).toBe('VERIFIED');
    expect(result.ok).toBe(true);
    expect(result.detail).toContain('jv_deals');
  });

  it('marks Supabase anon key PRESENT_BUT_UNAUTHORIZED when the table read returns 401', async () => {
    const env: EnvSnapshot = {
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    };
    const result = await verifyVariable('EXPO_PUBLIC_SUPABASE_ANON_KEY', env, fakeFetch({ 'abc.supabase.co/rest/v1/jv_deals?select=id&limit=1': { status: 401 } }));
    expect(result.status).toBe('PRESENT_BUT_UNAUTHORIZED');
    expect(result.ok).toBe(false);
  });

  it('marks Supabase anon key PRESENT_BUT_UNAUTHORIZED when RLS denies the table read (403)', async () => {
    const env: EnvSnapshot = {
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    };
    const result = await verifyVariable('EXPO_PUBLIC_SUPABASE_ANON_KEY', env, fakeFetch({ 'abc.supabase.co/rest/v1/jv_deals?select=id&limit=1': { status: 403 } }));
    expect(result.status).toBe('PRESENT_BUT_UNAUTHORIZED');
    expect(result.ok).toBe(false);
  });

  it('reports not-injected honestly when absent but known in Rork', async () => {
    const result = await verifyVariable('GITHUB_TOKEN', {}, fakeFetch({}));
    expect(result.status).toBe('PRESENT_IN_RORK_NOT_INJECTED');
    expect(result.ok).toBe(false);
  });
});

describe('buildRuntimeVariablesAudit', () => {
  it('reports cross-scope presence and exact action per variable without raw secrets', () => {
    const env: EnvSnapshot = { GITHUB_TOKEN: 'ghp_secretsecretsecret', RENDER: 'true' };
    const audit = buildRuntimeVariablesAudit(env, 'render-production-runtime');
    expect(audit.total).toBe(RUNTIME_VARIABLE_SPECS.length);
    expect(audit.onRenderRuntime).toBe(true);

    const githubToken = audit.variables.find((v) => v.name === 'GITHUB_TOKEN');
    expect(githubToken?.existsInBackendRuntime).toBe(true);
    expect(githubToken?.existsInRenderRuntime).toBe(true);
    expect(githubToken?.masked).not.toContain('secretsecret');
    expect(githubToken?.actionRequired).toContain('None');

    const repoUrl = audit.variables.find((v) => v.name === 'GITHUB_REPO_URL');
    expect(repoUrl?.existsInBackendRuntime).toBe(false);
    expect(repoUrl?.existsInRork).toBe(true);
    expect(repoUrl?.actionRequired).toContain('NOT injected');
  });
});

describe('saveVariableValue', () => {
  it('rejects an empty value without calling Render', async () => {
    const env: EnvSnapshot = { RENDER_API_KEY: 'k', RENDER_SERVICE_ID: 'srv-1' };
    const result = await saveVariableValue('GITHUB_TOKEN', '   ', env, fakeFetch({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('non-empty value');
  });

  it('requires Render credentials to save', async () => {
    const result = await saveVariableValue('GITHUB_TOKEN', 'ghp_new', {}, fakeFetch({}));
    expect(result.ok).toBe(false);
    expect(result.detail).toContain('RENDER_API_KEY');
  });

  it('writes to the Render env and returns a masked receipt (never the raw value) on success', async () => {
    const env: EnvSnapshot = { RENDER_API_KEY: 'k', RENDER_SERVICE_ID: 'srv-1' };
    const result = await saveVariableValue(
      'GITHUB_TOKEN',
      'ghp_brandnewsecretvalue',
      env,
      fakeFetch({ 'api.render.com/v1/services/srv-1/env-vars/GITHUB_TOKEN': { status: 200, body: '{}' } }),
    );
    expect(result.ok).toBe(true);
    expect(result.masked).not.toContain('brandnewsecret');
    expect(result.detail).toContain('redeploy');
  });
});

describe('verifyAllVariables', () => {
  it('folds probe results into the report only for present variables', async () => {
    const env: EnvSnapshot = {
      EXPO_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co',
      EXPO_PUBLIC_SUPABASE_ANON_KEY: 'anon',
    };
    const report = await verifyAllVariables(env, fakeFetch({ 'abc.supabase.co/rest/v1/jv_deals?select=id&limit=1': { status: 200, body: '[]' } }));
    const anon = report.variables.find((v) => v.name === 'EXPO_PUBLIC_SUPABASE_ANON_KEY');
    expect(anon?.status).toBe('VERIFIED');
    expect(anon?.lastVerifiedAt).not.toBeNull();

    const missing = report.variables.find((v) => v.name === 'OPENAI_API_KEY');
    expect(missing?.status).toBe('MISSING_FROM_RORK');
    expect(missing?.lastVerifiedAt).toBeNull();
  });
});
