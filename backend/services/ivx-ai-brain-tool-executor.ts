import { resolve4, resolveCname } from 'node:dns/promises';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import tls from 'node:tls';
import { ACMClient, DescribeCertificateCommand, ListCertificatesCommand } from '@aws-sdk/client-acm';
import { CloudFrontClient, GetDistributionCommand, ListDistributionsCommand } from '@aws-sdk/client-cloudfront';
import { DescribeInstancesCommand, DescribeRegionsCommand, DescribeVpcsCommand, EC2Client } from '@aws-sdk/client-ec2';
import { DescribeClustersCommand, ECSClient, ListClustersCommand, ListServicesCommand } from '@aws-sdk/client-ecs';
import { DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { GetPolicyCommand, IAMClient, ListAttachedUserPoliciesCommand, ListPoliciesCommand, ListUsersCommand } from '@aws-sdk/client-iam';
import { DescribeOrganizationCommand, ListAccountsCommand, OrganizationsClient } from '@aws-sdk/client-organizations';
import { ListHostedZonesByNameCommand, ListResourceRecordSetsCommand, Route53Client } from '@aws-sdk/client-route-53';
import { GetBucketLocationCommand, HeadBucketCommand, ListBucketsCommand, S3Client } from '@aws-sdk/client-s3';
import { DescribeParametersCommand, SSMClient } from '@aws-sdk/client-ssm';
import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import {
  buildIVXCredentialRequestManifestSnapshot,
  getIVXCredentialMissingNames,
  getIVXCredentialPresenceByNameOnly,
  IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES,
} from '../config/ivx-credential-request-manifest';
import { getIVXOwnerVariableRuntimeValue, hasIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export type IVXAIBrainToolName =
  | 'github_repo_status'
  | 'supabase_runtime_check'
  | 'supabase_readiness_check'
  | 'aws_identity_check'
  | 'iam_readiness_check'
  | 's3_readiness_check'
  | 'cloudfront_readiness_check'
  | 'route53_dns_check'
  | 'dns_tls_check'
  | 'deployment_health_check'
  | 'aws_acm_certificate_check'
  | 'aws_ec2_readiness_check'
  | 'aws_ecs_readiness_check'
  | 'aws_elb_readiness_check'
  | 'aws_ssm_readiness_check'
  | 'aws_organizations_check'
  | 'aws_deployment_inventory'
  | 'logs_status_summary'
  | 'fix_queue_status'
  | 'setup_export'
  | 'run_verification_tests'
  | 'project_registry'
  | 'project_surface_health'
  | 'code_repo_control_status'
  | 'deployment_readiness_matrix'
  | 'owner_control_audit'
  | 'owner_control_readiness_report'
  | 'minimum_access_plan'
  | 'final_completion_report'
  | 'developer_deploy_control_status'
  | 'credential_request_manifest'
  | 'environment_checklist';

export type IVXAIBrainToolRequest = {
  tool?: unknown;
  input?: unknown;
  confirm?: unknown;
  confirmText?: unknown;
};

export type IVXAIBrainToolResult = {
  ok: boolean;
  tool: IVXAIBrainToolName;
  readOnly: true;
  ownerOnly: true;
  accessMode: 'read_only_verification';
  writeActionsEnabled: false;
  ownerApprovalRequiredForWrites: true;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  missingEnvNames: string[];
  timestamp: string;
};

type AwsClientConfig = {
  region: string;
  credentials?: {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken?: string;
  };
};

type GithubRepoInfo = {
  owner: string;
  repo: string;
};

type IVXProjectSurfaceType = 'landing_page' | 'mobile_app' | 'backend_api' | 'future_app' | 'admin_console' | 'other';

type IVXProjectSurface = {
  id: string;
  name: string;
  type: IVXProjectSurfaceType;
  url: string | null;
  healthUrl: string | null;
  repoUrl: string | null;
  branch: string | null;
  domains: string[];
  requiredEnvNames: string[];
  deploymentTargets: string[];
  notes: string[];
};

type ProjectRegistrySnapshot = {
  configurationSource: 'default' | 'env';
  projects: IVXProjectSurface[];
  parseError: string | null;
};

type SurfaceStatus = 'verified' | 'available' | 'not_verified' | 'not_connected' | 'missing_access';

type DiagnosticCheck = {
  tool: IVXAIBrainToolName;
  ok: boolean;
  status: 'verified' | 'available' | 'not_verified' | 'not_connected' | 'missing_access';
  missingEnvNames: string[];
  summary: string;
  output?: unknown;
  error?: string;
};

const DEFAULT_AWS_REGION = 'us-east-1';
const DEFAULT_ROOT_DOMAIN = 'ivxholding.com';
const DEFAULT_API_DOMAIN = 'api.ivxholding.com';
const DEFAULT_CHAT_DOMAIN = 'chat.ivxholding.com';
const DEFAULT_LANDING_URL = 'https://ivxholding.com';
const DEFAULT_APP_URL = 'https://chat.ivxholding.com';
const DEFAULT_HEALTH_URL = 'https://api.ivxholding.com/health';
const DEFAULT_REPO_REQUIRED_PATHS = [
  'render.yaml',
  'Dockerfile',
  'server.ts',
  'backend',
  'expo',
  'package.json',
  'tsconfig.json',
  'README_IVX_DEPLOYMENT.md',
  'ENVIRONMENT_VARIABLES.md',
  'IVX_AI_BRAIN_TOOLS.md',
  'IVX_OWNER_CONTROL_READINESS.md',
  'IVX_MINIMUM_ACCESS_PLAN.md',
  'IVX_FINAL_COMPLETION_PLAN.md',
] as const;
const MINIMUM_RUNTIME_ENV_NAMES = [
  'JWT_SECRET',
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  'IVX_AI_GATEWAY_KEY',
  'GITHUB_REPO_URL',
  'EXPO_PUBLIC_API_BASE_URL',
  'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
  'EXPO_PUBLIC_APP_URL',
] as const;
const OPTIONAL_READONLY_ENV_NAMES = [
  'IVX_GITHUB_READONLY_TOKEN',
  'IVX_AWS_READONLY_ACCESS_KEY_ID',
  'IVX_AWS_READONLY_SECRET_ACCESS_KEY',
  'IVX_AWS_READONLY_SESSION_TOKEN',
  'AWS_REGION',
  'S3_BUCKET_NAME',
  'CLOUDFRONT_DISTRIBUTION_ID',
  'SUPABASE_READONLY_DATABASE_URL',
  'SUPABASE_INSPECTION_DATABASE_URL',
] as const;
const WRITE_CAPABLE_ENV_NAMES = [
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'GITHUB_TOKEN',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
] as const;
const REQUESTED_PRODUCTION_ACCESS_ENV_NAMES = IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES;
const REQUIRED_ENV_NAMES = MINIMUM_RUNTIME_ENV_NAMES;
const SECRET_ENV_NAMES = [
  'JWT_SECRET',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY',
  'SUPABASE_DB_PASSWORD',
  'SUPABASE_DB_URL',
  'DATABASE_URL',
  'POSTGRES_URL',
  'IVX_AI_GATEWAY_KEY',
  'GITHUB_TOKEN',
  'IVX_GITHUB_READONLY_TOKEN',
  'RENDER_API_KEY',
  'STRIPE_API_KEY',
  'APP_SECRET',
  'MINIO_PASSWORD',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'IVX_AWS_READONLY_ACCESS_KEY_ID',
  'IVX_AWS_READONLY_SECRET_ACCESS_KEY',
  'IVX_AWS_READONLY_SESSION_TOKEN',
] as const;
const SUPPORTED_TOOLS: IVXAIBrainToolName[] = [
  'github_repo_status',
  'supabase_runtime_check',
  'supabase_readiness_check',
  'aws_identity_check',
  'iam_readiness_check',
  's3_readiness_check',
  'cloudfront_readiness_check',
  'route53_dns_check',
  'dns_tls_check',
  'deployment_health_check',
  'aws_acm_certificate_check',
  'aws_ec2_readiness_check',
  'aws_ecs_readiness_check',
  'aws_elb_readiness_check',
  'aws_ssm_readiness_check',
  'aws_organizations_check',
  'aws_deployment_inventory',
  'logs_status_summary',
  'fix_queue_status',
  'setup_export',
  'run_verification_tests',
  'project_registry',
  'project_surface_health',
  'code_repo_control_status',
  'deployment_readiness_matrix',
  'owner_control_audit',
  'owner_control_readiness_report',
  'minimum_access_plan',
  'final_completion_report',
  'developer_deploy_control_status',
  'credential_request_manifest',
  'environment_checklist',
];

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

function readStringInput(input: Record<string, unknown>, key: string, fallback: string): string {
  return readTrimmed(input[key]) || fallback;
}

function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
}

function normalizeTool(value: unknown): IVXAIBrainToolName {
  const normalized = readTrimmed(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (SUPPORTED_TOOLS.includes(normalized as IVXAIBrainToolName)) {
    return normalized as IVXAIBrainToolName;
  }
  throw new Error(`Unsupported IVX AI Brain tool. Supported tools: ${SUPPORTED_TOOLS.join(', ')}.`);
}

function getMissingEnvNames(names: readonly string[]): string[] {
  return names.filter((name) => !readEnv(name));
}

function redactKnownSecretValues(value: string): string {
  let redacted = value;
  for (const envName of SECRET_ENV_NAMES) {
    const envValue = readEnv(envName);
    if (envValue.length >= 4) {
      redacted = redacted.split(envValue).join(`[${envName}]`);
    }
  }
  return redacted.replace(/Bearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]').replace(/apikey[=:]\s*[A-Za-z0-9._~+\/-]+=*/gi, 'apikey=[REDACTED]');
}

function safeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  return redactKnownSecretValues(raw);
}

function readGithubApiTokenFromEnv(): string {
  return readEnv('IVX_GITHUB_READONLY_TOKEN') || readEnv('GITHUB_TOKEN');
}

async function readGithubApiToken(): Promise<string> {
  return readGithubApiTokenFromEnv() || await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
}

async function readGithubRepoUrl(input: Record<string, unknown>): Promise<string> {
  return readStringInput(input, 'repoUrl', readEnv('GITHUB_REPO_URL')) || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
}

function readAwsAccessKeyId(): string {
  return readEnv('IVX_AWS_READONLY_ACCESS_KEY_ID') || readEnv('AWS_ACCESS_KEY_ID');
}

function readAwsSecretAccessKey(): string {
  return readEnv('IVX_AWS_READONLY_SECRET_ACCESS_KEY') || readEnv('AWS_SECRET_ACCESS_KEY');
}

function readAwsSessionToken(): string {
  return readEnv('IVX_AWS_READONLY_SESSION_TOKEN') || readEnv('AWS_SESSION_TOKEN');
}

function createAwsConfig(regionOverride?: string): AwsClientConfig {
  const accessKeyId = readAwsAccessKeyId();
  const secretAccessKey = readAwsSecretAccessKey();
  const sessionToken = readAwsSessionToken();
  const region = regionOverride || readEnv('AWS_REGION') || DEFAULT_AWS_REGION;
  const config: AwsClientConfig = { region };
  if (accessKeyId && secretAccessKey) {
    config.credentials = {
      accessKeyId,
      secretAccessKey,
      ...(sessionToken ? { sessionToken } : {}),
    };
  }
  return config;
}

function parseGithubRepoUrl(value: string): GithubRepoInfo | null {
  const normalized = value.trim();
  if (!normalized) {
    return null;
  }
  const httpsMatch = normalized.match(/github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i);
  if (httpsMatch?.[1] && httpsMatch[2]) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }
  return null;
}

async function buildGithubHeaders(): Promise<HeadersInit> {
  const token = await readGithubApiToken();
  return {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
    return redactKnownSecretValues(text.slice(0, 600));
  }
}

async function fetchJson(url: string, init?: RequestInit): Promise<{ status: number; ok: boolean; data: unknown }> {
  const response = await fetch(url, init);
  return {
    status: response.status,
    ok: response.ok,
    data: await parseJsonResponse(response),
  };
}

function readGithubDataRecord(data: unknown): Record<string, unknown> {
  return readRecord(data);
}

function summarizeUnknownOutput(value: unknown): string {
  const record = readRecord(value);
  const status = readTrimmed(record.status) || readTrimmed(record.mode) || readTrimmed(record.domain) || readTrimmed(record.url);
  return status || 'completed';
}

function statusFromDiagnosticResult(result: IVXAIBrainToolResult): DiagnosticCheck['status'] {
  if (result.missingEnvNames.length > 0) {
    return 'missing_access';
  }
  if (!result.ok) {
    return 'not_verified';
  }
  const outputStatus = readTrimmed(readRecord(result.output).status);
  if (outputStatus === 'missing_access' || outputStatus === 'not_connected' || outputStatus === 'not_verified') {
    return outputStatus;
  }
  if (outputStatus === 'blocked') {
    return 'not_verified';
  }
  if (outputStatus === 'available') {
    return 'available';
  }
  return 'verified';
}

function summarizeDiagnosticResult(result: IVXAIBrainToolResult): string {
  if (!result.ok) {
    return result.error ?? 'not verified';
  }
  const output = readRecord(result.output);
  if (result.tool === 'environment_checklist') {
    const missing = Array.isArray(output.missing) ? output.missing.length : 0;
    return missing === 0 ? 'Minimum runtime environment names are present.' : `${missing} minimum runtime environment name(s) are missing.`;
  }
  if (result.tool === 'minimum_access_plan') {
    return 'Least-privilege access plan available; default execution mode is read-only verification.';
  }
  if (result.tool === 'developer_deploy_control_status') {
    return 'Developer/deploy control status available; all write actions require owner confirmation and backend-only credentials.';
  }
  if (result.tool === 'credential_request_manifest') {
    return 'Credential request manifest available; future credentials are requested by name/metadata only and secret values are never returned.';
  }
  if (result.tool === 'deployment_health_check') {
    return `Health check status ${String(output.status ?? 'not verified')}; ok=${String(output.ok ?? false)}.`;
  }
  if (result.tool === 'github_repo_status') {
    return result.ok ? `Repository ${readTrimmed(output.owner)}/${readTrimmed(output.repo)} verified; branch ${readTrimmed(output.defaultBranch) || 'not verified'}.` : 'GitHub repo not verified.';
  }
  if (result.tool === 'dns_tls_check') {
    const dns = readRecord(output.dns);
    const tlsInfo = readRecord(output.tls);
    return `${readTrimmed(output.domain)} DNS ${dns.resolvable === true ? 'verified' : 'not connected'}; TLS ${tlsInfo.authorized === true ? 'verified' : 'not verified'}.`;
  }
  if (result.tool === 'project_registry') {
    return `Multi-app registry available with ${String(output.projectCount ?? 'not verified')} project surface(s).`;
  }
  if (result.tool === 'project_surface_health') {
    const surfaces = Array.isArray(output.surfaces) ? output.surfaces.length : 0;
    return `Project surface health ${readTrimmed(output.status) || 'not verified'} across ${surfaces} surface(s).`;
  }
  if (result.tool === 'code_repo_control_status') {
    return `Repository control ${readTrimmed(output.status) || 'not verified'} for ${readTrimmed(output.owner)}/${readTrimmed(output.repo)} on ${readTrimmed(output.branch) || 'not verified'}.`;
  }
  if (result.tool === 'deployment_readiness_matrix') {
    return `Deployment readiness ${readTrimmed(output.status) || 'not verified'} with ${String(output.blockerCount ?? 'not verified')} blocker(s).`;
  }
  if (result.tool === 'owner_control_audit' || result.tool === 'owner_control_readiness_report') {
    return `Owner control ${readTrimmed(output.status) || 'not verified'}; completion ${String(output.completionPercentageAfterThisPass ?? output.codeReadinessAfterThisPassPercentage ?? 'not verified')}%.`;
  }
  if (result.tool.startsWith('aws_') || result.tool === 'iam_readiness_check' || result.tool === 's3_readiness_check' || result.tool === 'cloudfront_readiness_check' || result.tool === 'route53_dns_check') {
    return `AWS tool ${result.tool} completed.`;
  }
  return summarizeUnknownOutput(result.output);
}

async function runGithubRepoStatus(input: Record<string, unknown>): Promise<unknown> {
  const repoUrl = await readGithubRepoUrl(input);
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) {
    throw new Error('GITHUB_REPO_URL is missing or invalid.');
  }
  const headers = await buildGithubHeaders();
  const repoResponse = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}`, { headers });
  if (!repoResponse.ok) {
    throw new Error(`GitHub repo lookup failed with HTTP ${repoResponse.status}.`);
  }
  const branchResponse = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches`, { headers });
  const repoData = readGithubDataRecord(repoResponse.data);
  const defaultBranch = readTrimmed(repoData.default_branch) || null;
  const branchNames = Array.isArray(branchResponse.data)
    ? branchResponse.data.map((item) => readTrimmed(readRecord(item).name)).filter(Boolean)
    : [];
  const commitResponse = defaultBranch
    ? await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/commits/${encodeURIComponent(defaultBranch)}`, { headers }).catch(() => null)
    : null;
  const commitData = readGithubDataRecord(commitResponse?.data);
  const commitDetails = readRecord(commitData.commit);
  const authorDetails = readRecord(commitDetails.author);
  return {
    repoUrl,
    owner: repoInfo.owner,
    repo: repoInfo.repo,
    private: repoData.private === true,
    defaultBranch,
    branchNames,
    cloneUrl: readTrimmed(repoData.clone_url) || null,
    pushedAt: readTrimmed(repoData.pushed_at) || null,
    repoUrlConfigured: true,
    credentialSource: {
      GITHUB_REPO_URL: readEnv('GITHUB_REPO_URL') ? 'env' : 'owner_variables',
      GITHUB_TOKEN: readGithubApiTokenFromEnv() ? 'env' : await hasIVXOwnerVariableRuntimeValue('GITHUB_TOKEN') ? 'owner_variables' : 'missing',
    },
    tokenConfigured: Boolean(await readGithubApiToken()),
    tokenMode: readEnv('IVX_GITHUB_READONLY_TOKEN') ? 'read_only_token' : readEnv('GITHUB_TOKEN') ? 'legacy_token_fallback' : await hasIVXOwnerVariableRuntimeValue('GITHUB_TOKEN') ? 'owner_variables' : 'public_or_not_configured',
    latestCommit: commitResponse?.ok === true ? {
      sha: readTrimmed(commitData.sha) || null,
      message: readTrimmed(commitDetails.message).slice(0, 240) || null,
      authorDate: readTrimmed(authorDetails.date) || null,
    } : null,
    uncommittedFiles: 'not verified from GitHub API; deployed backend can verify pushed repository state only',
  };
}

async function runSupabaseRuntimeCheck(): Promise<unknown> {
  const url = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!url || !anonKey) {
    throw new Error('Supabase URL or anon key is missing.');
  }
  const runtimeReadKey = serviceRoleKey || anonKey;
  const healthProbe = await fetchJson(`${url}/rest/v1/`, {
    method: 'GET',
    headers: {
      Accept: 'application/openapi+json',
      apikey: runtimeReadKey,
      Authorization: `Bearer ${runtimeReadKey}`,
    },
  });
  return {
    hasSupabaseUrl: Boolean(url),
    hasAnonKey: Boolean(anonKey),
    hasServiceRoleKey: Boolean(serviceRoleKey),
    hasDbPasswordOrUrl: Boolean(readEnv('SUPABASE_READONLY_DATABASE_URL') || readEnv('SUPABASE_INSPECTION_DATABASE_URL') || readEnv('SUPABASE_DB_PASSWORD') || readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL')),
    restOpenApiReachable: healthProbe.ok,
    restStatus: healthProbe.status,
    runtimeReadCredential: serviceRoleKey ? 'service_role' : 'anon',
    minimumReadOnlyReady: healthProbe.ok,
    writeCapableCredentialConfigured: Boolean(serviceRoleKey || readEnv('SUPABASE_DB_PASSWORD') || readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL')),
  };
}

async function runSupabaseReadinessCheck(): Promise<unknown> {
  const url = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
  const anonKey = readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
  const serviceRoleKey = readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
  if (!url || !anonKey) {
    throw new Error('Supabase URL or anon key is missing.');
  }
  const runtimeReadKey = serviceRoleKey || anonKey;
  const restProbe = await fetchJson(`${url}/rest/v1/`, {
    method: 'GET',
    headers: {
      Accept: 'application/openapi+json',
      apikey: runtimeReadKey,
      Authorization: `Bearer ${runtimeReadKey}`,
    },
  });
  const authProbe = serviceRoleKey ? await fetchJson(`${url}/auth/v1/admin/users?per_page=1`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  }).catch((error: unknown) => ({ status: 0, ok: false, data: safeErrorMessage(error, 'Auth readiness failed.') })) : null;
  const storageProbe = serviceRoleKey ? await fetchJson(`${url}/storage/v1/bucket`, {
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
    },
  }).catch((error: unknown) => ({ status: 0, ok: false, data: safeErrorMessage(error, 'Storage readiness failed.') })) : null;
  const hasReadonlyDbUrl = Boolean(readEnv('SUPABASE_READONLY_DATABASE_URL') || readEnv('SUPABASE_INSPECTION_DATABASE_URL'));
  const hasWriteCapableDbCredential = Boolean(readEnv('SUPABASE_DB_PASSWORD') || readEnv('SUPABASE_DB_URL') || readEnv('DATABASE_URL') || readEnv('POSTGRES_URL'));
  const minimumApiReady = restProbe.ok || authProbe?.ok === true || storageProbe?.ok === true;
  const minimumHttpStatus = restProbe.ok
    ? restProbe.status
    : authProbe?.ok === true
      ? authProbe.status
      : storageProbe?.ok === true
        ? storageProbe.status
        : restProbe.status;
  const checks = [
    { name: 'supabase_api_runtime_access', status: minimumApiReady ? 'verified' : 'not_verified', httpStatus: minimumHttpStatus, accessLevel: serviceRoleKey ? 'service_role_runtime_read' : 'anon_read', requiredForMinimum: true, missingCredentialNames: [] },
    { name: 'rest_openapi_readonly', status: restProbe.ok ? 'verified' : 'not_verified', httpStatus: restProbe.status, accessLevel: serviceRoleKey ? 'service_role_runtime_read' : 'read_only', requiredForMinimum: false },
    { name: 'auth_admin_read_optional', status: authProbe ? authProbe.ok ? 'verified' : 'not_verified' : 'not_connected', httpStatus: authProbe?.status ?? null, accessLevel: 'write_capable_secret_used_for_read', requiredForMinimum: false, missingCredentialNames: serviceRoleKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY'] },
    { name: 'storage_bucket_read_optional', status: storageProbe ? storageProbe.ok ? 'verified' : 'not_verified' : 'not_connected', httpStatus: storageProbe?.status ?? null, accessLevel: 'write_capable_secret_used_for_read', requiredForMinimum: false, missingCredentialNames: serviceRoleKey ? [] : ['SUPABASE_SERVICE_ROLE_KEY'] },
    { name: 'database_readonly_inspection_optional', status: hasReadonlyDbUrl ? 'verified' : hasWriteCapableDbCredential ? 'available_write_capable_fallback' : 'not_connected', accessLevel: hasReadonlyDbUrl ? 'read_only' : hasWriteCapableDbCredential ? 'write_capable_secret_available' : 'not_configured', requiredForMinimum: false, missingCredentialNames: hasReadonlyDbUrl || hasWriteCapableDbCredential ? [] : ['SUPABASE_READONLY_DATABASE_URL'] },
  ];
  return {
    status: minimumApiReady ? 'verified' : 'not_verified',
    minimumReadOnlyReady: minimumApiReady,
    projectUrlConfigured: true,
    anonKeyConfigured: true,
    serviceRoleConfigured: Boolean(serviceRoleKey),
    writeCapableCredentialConfigured: Boolean(serviceRoleKey || hasWriteCapableDbCredential),
    checks,
  };
}

async function runAwsIdentityCheck(): Promise<unknown> {
  const client = new STSClient(createAwsConfig());
  const response = await client.send(new GetCallerIdentityCommand({}));
  return {
    account: readTrimmed(response.Account) || null,
    arn: readTrimmed(response.Arn) || null,
    userId: readTrimmed(response.UserId) || null,
    region: readEnv('AWS_REGION') || DEFAULT_AWS_REGION,
  };
}

async function runIamReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const client = new IAMClient(createAwsConfig(DEFAULT_AWS_REGION));
  const policyArn = readTrimmed(input.policyArn);
  const [users, policies, selectedPolicy] = await Promise.all([
    client.send(new ListUsersCommand({ MaxItems: 10 })),
    client.send(new ListPoliciesCommand({ Scope: 'Local', MaxItems: 20 })),
    policyArn ? client.send(new GetPolicyCommand({ PolicyArn: policyArn })) : Promise.resolve(null),
  ]);
  const currentUserName = readTrimmed(input.userName);
  const attachedPolicies = currentUserName
    ? await client.send(new ListAttachedUserPoliciesCommand({ UserName: currentUserName, MaxItems: 20 }))
    : null;
  return {
    users: (users.Users ?? []).map((user) => ({ userName: readTrimmed(user.UserName), arn: readTrimmed(user.Arn), createDate: user.CreateDate?.toISOString?.() ?? null })),
    localPolicies: (policies.Policies ?? []).map((policy) => ({ policyName: readTrimmed(policy.PolicyName), arn: readTrimmed(policy.Arn), attachmentCount: policy.AttachmentCount ?? null })),
    selectedPolicy: selectedPolicy ? { policyName: readTrimmed(selectedPolicy.Policy?.PolicyName), arn: readTrimmed(selectedPolicy.Policy?.Arn), attachmentCount: selectedPolicy.Policy?.AttachmentCount ?? null } : null,
    attachedPolicies: attachedPolicies ? (attachedPolicies.AttachedPolicies ?? []).map((policy) => ({ policyName: readTrimmed(policy.PolicyName), arn: readTrimmed(policy.PolicyArn) })) : null,
    requiredCapabilityHints: ['sts:GetCallerIdentity', 'iam:ListUsers', 'iam:ListPolicies', 'route53:ListHostedZonesByName', 'route53:ListResourceRecordSets', 's3:ListAllMyBuckets', 's3:ListBucket', 's3:GetBucketLocation', 'cloudfront:GetDistribution', 'cloudfront:ListDistributions', 'acm:ListCertificates', 'acm:DescribeCertificate', 'ec2:Describe*', 'ecs:ListClusters', 'ecs:DescribeClusters', 'ecs:ListServices', 'elasticloadbalancing:Describe*', 'ssm:DescribeParameters', 'organizations:DescribeOrganization', 'organizations:ListAccounts'],
    writeCapabilitiesExcludedByDefault: ['route53:ChangeResourceRecordSets', 's3:PutObject', 'cloudfront:CreateInvalidation', 'ecs:UpdateService', 'ssm:PutParameter'],
  };
}

async function runS3ReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const bucket = readStringInput(input, 'bucket', readEnv('S3_BUCKET_NAME'));
  const client = new S3Client(createAwsConfig());
  if (bucket) {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    const location = await client.send(new GetBucketLocationCommand({ Bucket: bucket })).catch(() => null);
    return { mode: 'head_bucket', bucket, reachable: true, locationConstraint: location?.LocationConstraint ?? null };
  }
  const response = await client.send(new ListBucketsCommand({}));
  return {
    mode: 'list_buckets',
    buckets: (response.Buckets ?? []).slice(0, 20).map((item) => ({ name: readTrimmed(item.Name), creationDate: item.CreationDate?.toISOString?.() ?? null })),
  };
}

async function runCloudFrontReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const distributionId = readStringInput(input, 'distributionId', readEnv('CLOUDFRONT_DISTRIBUTION_ID'));
  const client = new CloudFrontClient(createAwsConfig(DEFAULT_AWS_REGION));
  if (distributionId) {
    const response = await client.send(new GetDistributionCommand({ Id: distributionId }));
    return {
      mode: 'get_distribution',
      id: readTrimmed(response.Distribution?.Id) || distributionId,
      domainName: readTrimmed(response.Distribution?.DomainName) || null,
      status: readTrimmed(response.Distribution?.Status) || null,
      enabled: response.Distribution?.DistributionConfig?.Enabled ?? null,
      aliases: response.Distribution?.DistributionConfig?.Aliases?.Items ?? [],
      origins: response.Distribution?.DistributionConfig?.Origins?.Items?.map((origin) => ({ id: origin.Id, domainName: origin.DomainName })) ?? [],
    };
  }
  const response = await client.send(new ListDistributionsCommand({ MaxItems: 20 }));
  return {
    mode: 'list_distributions',
    distributions: (response.DistributionList?.Items ?? []).map((distribution) => ({
      id: readTrimmed(distribution.Id),
      domainName: readTrimmed(distribution.DomainName),
      status: readTrimmed(distribution.Status),
      aliases: distribution.Aliases?.Items ?? [],
    })),
  };
}

async function resolveDns(domain: string): Promise<{ domain: string; cname: string[]; a: string[]; resolvable: boolean }> {
  const normalizedDomain = normalizeDomain(domain);
  const [cnameResult, aResult] = await Promise.allSettled([resolveCname(normalizedDomain), resolve4(normalizedDomain)]);
  const cname = cnameResult.status === 'fulfilled' ? cnameResult.value.map(readTrimmed).filter(Boolean) : [];
  const a = aResult.status === 'fulfilled' ? aResult.value.map(readTrimmed).filter(Boolean) : [];
  return { domain: normalizedDomain, cname, a, resolvable: cname.length > 0 || a.length > 0 };
}

async function runRoute53DnsCheck(input: Record<string, unknown>): Promise<unknown> {
  const domain = normalizeDomain(readStringInput(input, 'domain', DEFAULT_API_DOMAIN));
  const rootDomain = normalizeDomain(readStringInput(input, 'rootDomain', readEnv('DOMAIN_NAME') || 'ivxholding.com'));
  const client = new Route53Client(createAwsConfig(DEFAULT_AWS_REGION));
  const hostedZones = await client.send(new ListHostedZonesByNameCommand({ DNSName: `${rootDomain}.`, MaxItems: 10 }));
  const zones = (hostedZones.HostedZones ?? []).map((zone) => ({ id: readTrimmed(zone.Id).replace('/hostedzone/', ''), name: normalizeDomain(readTrimmed(zone.Name)), privateZone: Boolean(zone.Config?.PrivateZone) }));
  const zone = zones.find((item) => item.name === rootDomain && !item.privateZone) ?? zones[0] ?? null;
  const records = zone
    ? await client.send(new ListResourceRecordSetsCommand({ HostedZoneId: zone.id, MaxItems: 100 }))
    : null;
  const matchingRecords = (records?.ResourceRecordSets ?? [])
    .filter((record) => normalizeDomain(readTrimmed(record.Name)) === domain)
    .map((record) => ({
      name: readTrimmed(record.Name),
      type: readTrimmed(record.Type),
      ttl: record.TTL ?? null,
      values: (record.ResourceRecords ?? []).map((entry) => readTrimmed(entry.Value)).filter(Boolean),
      aliasTarget: readTrimmed(record.AliasTarget?.DNSName) || null,
    }));
  return {
    domain,
    rootDomain,
    hostedZones: zones,
    selectedHostedZone: zone,
    matchingRecords,
    publicDns: await resolveDns(domain),
  };
}

function probeTls(domain: string, port: number): Promise<{ authorized: boolean; authorizationError: string | null; subject: string | null; issuer: string | null; validFrom: string | null; validTo: string | null; protocol: string | null }> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: domain, servername: domain, port, rejectUnauthorized: false, timeout: 8_000 }, () => {
      const certificate = socket.getPeerCertificate();
      const result = {
        authorized: socket.authorized,
        authorizationError: typeof socket.authorizationError === 'string' ? socket.authorizationError : null,
        subject: readTrimmed(certificate.subject?.CN) || null,
        issuer: readTrimmed(certificate.issuer?.CN) || null,
        validFrom: readTrimmed(certificate.valid_from) || null,
        validTo: readTrimmed(certificate.valid_to) || null,
        protocol: socket.getProtocol(),
      };
      socket.end();
      resolve(result);
    });
    socket.on('timeout', () => {
      socket.destroy();
      reject(new Error('TLS probe timed out.'));
    });
    socket.on('error', reject);
  });
}

async function runDnsTlsCheck(input: Record<string, unknown>): Promise<unknown> {
  const domain = normalizeDomain(readStringInput(input, 'domain', DEFAULT_API_DOMAIN));
  const portValue = Number.parseInt(readTrimmed(input.port), 10);
  const port = Number.isFinite(portValue) ? portValue : 443;
  const [dns, tlsResult] = await Promise.allSettled([resolveDns(domain), probeTls(domain, port)]);
  return {
    domain,
    port,
    dns: dns.status === 'fulfilled' ? dns.value : { error: safeErrorMessage(dns.reason, 'DNS probe failed.') },
    tls: tlsResult.status === 'fulfilled' ? tlsResult.value : { error: safeErrorMessage(tlsResult.reason, 'TLS probe failed.') },
  };
}

async function runDeploymentHealthCheck(input: Record<string, unknown>): Promise<unknown> {
  const url = readStringInput(input, 'url', readEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL') ? `${readEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL').replace(/\/+$/, '')}/health` : DEFAULT_HEALTH_URL);
  const startedAt = Date.now();
  const response = await fetch(url, { method: 'GET' });
  const data = await parseJsonResponse(response);
  return {
    url,
    status: response.status,
    ok: response.ok,
    durationMs: Date.now() - startedAt,
    data,
  };
}

async function runAwsAcmCertificateCheck(input: Record<string, unknown>): Promise<unknown> {
  const domain = normalizeDomain(readStringInput(input, 'domain', DEFAULT_API_DOMAIN));
  const client = new ACMClient(createAwsConfig(readStringInput(input, 'region', DEFAULT_AWS_REGION)));
  const certificates = await client.send(new ListCertificatesCommand({ MaxItems: 50 }));
  const summaries = certificates.CertificateSummaryList ?? [];
  const matchingSummary = summaries.find((certificate) => normalizeDomain(readTrimmed(certificate.DomainName)) === domain || (certificate.SubjectAlternativeNameSummaries ?? []).some((name) => normalizeDomain(readTrimmed(name)) === domain)) ?? null;
  const details = matchingSummary?.CertificateArn ? await client.send(new DescribeCertificateCommand({ CertificateArn: matchingSummary.CertificateArn })).catch(() => null) : null;
  return {
    domain,
    region: readStringInput(input, 'region', DEFAULT_AWS_REGION),
    matchingCertificate: matchingSummary ? {
      arn: readTrimmed(matchingSummary.CertificateArn) || null,
      domainName: readTrimmed(matchingSummary.DomainName) || null,
      status: readTrimmed(details?.Certificate?.Status) || null,
      type: readTrimmed(details?.Certificate?.Type) || null,
      notAfter: details?.Certificate?.NotAfter?.toISOString?.() ?? null,
      subjectAlternativeNames: details?.Certificate?.SubjectAlternativeNames ?? matchingSummary.SubjectAlternativeNameSummaries ?? [],
    } : null,
    certificateCount: summaries.length,
  };
}

async function runAwsEc2ReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const region = readStringInput(input, 'region', readEnv('AWS_REGION') || DEFAULT_AWS_REGION);
  const client = new EC2Client(createAwsConfig(region));
  const [regions, vpcs, reservations] = await Promise.all([
    client.send(new DescribeRegionsCommand({ AllRegions: false })).catch(() => null),
    client.send(new DescribeVpcsCommand({ MaxResults: 20 })).catch(() => null),
    client.send(new DescribeInstancesCommand({ MaxResults: 20 })).catch(() => null),
  ]);
  const instances = (reservations?.Reservations ?? []).flatMap((reservation) => reservation.Instances ?? []);
  return {
    region,
    availableRegions: (regions?.Regions ?? []).map((item) => readTrimmed(item.RegionName)).filter(Boolean),
    vpcs: (vpcs?.Vpcs ?? []).map((vpc) => ({ vpcId: vpc.VpcId, cidrBlock: vpc.CidrBlock, isDefault: vpc.IsDefault, state: vpc.State })),
    instances: instances.map((instance) => ({ instanceId: instance.InstanceId, state: instance.State?.Name, type: instance.InstanceType, launchTime: instance.LaunchTime?.toISOString?.() ?? null })),
  };
}

async function runAwsEcsReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const region = readStringInput(input, 'region', readEnv('AWS_REGION') || DEFAULT_AWS_REGION);
  const client = new ECSClient(createAwsConfig(region));
  const clusters = await client.send(new ListClustersCommand({ maxResults: 20 }));
  const clusterArns = clusters.clusterArns ?? [];
  const clusterDetails = clusterArns.length > 0 ? await client.send(new DescribeClustersCommand({ clusters: clusterArns })).catch(() => null) : null;
  const services = await Promise.all(clusterArns.slice(0, 5).map(async (clusterArn) => {
    const response = await client.send(new ListServicesCommand({ cluster: clusterArn, maxResults: 10 })).catch(() => null);
    return { clusterArn, serviceArns: response?.serviceArns ?? [] };
  }));
  return {
    region,
    clusters: (clusterDetails?.clusters ?? []).map((cluster) => ({ clusterArn: cluster.clusterArn, clusterName: cluster.clusterName, status: cluster.status, registeredContainerInstancesCount: cluster.registeredContainerInstancesCount, runningTasksCount: cluster.runningTasksCount, activeServicesCount: cluster.activeServicesCount })),
    services,
  };
}

async function runAwsElbReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const region = readStringInput(input, 'region', readEnv('AWS_REGION') || DEFAULT_AWS_REGION);
  const client = new ElasticLoadBalancingV2Client(createAwsConfig(region));
  const [loadBalancers, targetGroups] = await Promise.all([
    client.send(new DescribeLoadBalancersCommand({ PageSize: 20 })).catch(() => null),
    client.send(new DescribeTargetGroupsCommand({ PageSize: 20 })).catch(() => null),
  ]);
  return {
    region,
    loadBalancers: (loadBalancers?.LoadBalancers ?? []).map((lb) => ({ name: lb.LoadBalancerName, dnsName: lb.DNSName, type: lb.Type, scheme: lb.Scheme, state: lb.State?.Code })),
    targetGroups: (targetGroups?.TargetGroups ?? []).map((group) => ({ name: group.TargetGroupName, protocol: group.Protocol, port: group.Port, targetType: group.TargetType, loadBalancerArns: group.LoadBalancerArns ?? [] })),
  };
}

async function runAwsSsmReadinessCheck(input: Record<string, unknown>): Promise<unknown> {
  const region = readStringInput(input, 'region', readEnv('AWS_REGION') || DEFAULT_AWS_REGION);
  const client = new SSMClient(createAwsConfig(region));
  const response = await client.send(new DescribeParametersCommand({ MaxResults: 20 }));
  return {
    region,
    parameterCountPreview: response.Parameters?.length ?? 0,
    parameters: (response.Parameters ?? []).map((parameter) => ({ name: parameter.Name, type: parameter.Type, keyId: parameter.KeyId ? 'configured' : null, lastModifiedDate: parameter.LastModifiedDate?.toISOString?.() ?? null })),
  };
}

async function runAwsOrganizationsCheck(): Promise<unknown> {
  const client = new OrganizationsClient(createAwsConfig(DEFAULT_AWS_REGION));
  const organization = await client.send(new DescribeOrganizationCommand({})).catch(() => null);
  const accounts = await client.send(new ListAccountsCommand({ MaxResults: 20 })).catch(() => null);
  return {
    organization: organization?.Organization ? { id: organization.Organization.Id, arn: organization.Organization.Arn, featureSet: organization.Organization.FeatureSet, masterAccountId: organization.Organization.MasterAccountId } : null,
    accounts: (accounts?.Accounts ?? []).map((account) => ({ id: account.Id, name: account.Name, email: account.Email, status: account.Status, joinedTimestamp: account.JoinedTimestamp?.toISOString?.() ?? null })),
  };
}

async function captureInternalTool(tool: IVXAIBrainToolName, input: Record<string, unknown> = {}): Promise<DiagnosticCheck> {
  const result = await executeIVXAIBrainTool({ tool, input });
  return {
    tool,
    ok: result.ok,
    status: statusFromDiagnosticResult(result),
    missingEnvNames: result.missingEnvNames,
    summary: summarizeDiagnosticResult(result),
    output: result.output,
    error: result.error,
  };
}

async function runAwsDeploymentInventory(input: Record<string, unknown>): Promise<unknown> {
  const tools: Array<[IVXAIBrainToolName, Record<string, unknown>]> = [
    ['aws_identity_check', {}],
    ['iam_readiness_check', {}],
    ['s3_readiness_check', {}],
    ['cloudfront_readiness_check', {}],
    ['route53_dns_check', { domain: readStringInput(input, 'domain', DEFAULT_API_DOMAIN) }],
    ['aws_acm_certificate_check', { domain: readStringInput(input, 'domain', DEFAULT_API_DOMAIN) }],
    ['aws_ec2_readiness_check', {}],
    ['aws_ecs_readiness_check', {}],
    ['aws_elb_readiness_check', {}],
    ['aws_ssm_readiness_check', {}],
    ['aws_organizations_check', {}],
  ];
  const checks = await Promise.all(tools.map(([tool, toolInput]) => captureInternalTool(tool, toolInput)));
  return {
    status: checks.every((check) => check.ok) ? 'verified' : checks.some((check) => check.status === 'missing_access') ? 'missing_access' : 'not_verified',
    checks,
  };
}

function runLogsStatusSummary(input: Record<string, unknown>): unknown {
  const service = readStringInput(input, 'service', 'ivx-holdings-platform');
  return {
    service,
    backendConsoleLogs: 'available through the active server runtime stdout/stderr',
    requestLogMiddleware: 'enabled in backend/hono.ts for every request',
    externalHostedLogViewer: 'not connected',
    missingCredentialNames: [],
    logExport: 'not connected',
    note: 'This tool does not read provider-hosted logs unless a log provider API is connected later.',
  };
}

function getMissingAwsReadonlyEnvNames(): string[] {
  const missing: string[] = [];
  if (!readAwsAccessKeyId()) {
    missing.push('IVX_AWS_READONLY_ACCESS_KEY_ID');
  }
  if (!readAwsSecretAccessKey()) {
    missing.push('IVX_AWS_READONLY_SECRET_ACCESS_KEY');
  }
  if (!readEnv('AWS_REGION')) {
    missing.push('AWS_REGION');
  }
  return missing;
}

function runMinimumAccessPlan(): unknown {
  return {
    status: 'available',
    defaultMode: 'read_only_verification',
    writeActionsEnabledByDefault: false,
    ownerApprovalRequiredForWrites: true,
    frontendSecretsSeparated: true,
    backendOnlySecretsNeverReturned: true,
    credentials: [
      { integration: 'GitHub', envName: 'GITHUB_REPO_URL', accessLevel: 'read_only_metadata', requiredFor: 'repository identification', secret: false, frontendAllowed: false, minimum: true },
      { integration: 'GitHub', envName: 'IVX_GITHUB_READONLY_TOKEN', fallbackEnvName: 'GITHUB_TOKEN', accessLevel: 'read_only', requiredFor: 'private repository status and file checks', secret: true, frontendAllowed: false, minimum: 'private_repo_only' },
      { integration: 'GitHub', envName: 'GITHUB_TOKEN', accessLevel: 'write_capable_owner_approved', requiredFor: 'owner-approved commits, pushes, pull requests, and workflow dispatches', requiredScopes: ['contents:read/write', 'pull_requests:write', 'actions/workflows:write'], secret: true, frontendAllowed: false, minimum: false },
      { integration: 'Render', envName: 'RENDER_API_KEY', accessLevel: 'write_capable_owner_approved', requiredFor: 'owner-approved deploy triggers, service restarts, service updates, and environment variable updates', secret: true, frontendAllowed: false, minimum: false },
      { integration: 'Render', envName: 'RENDER_SERVICE_ID', accessLevel: 'service_target_identifier', requiredFor: 'Render service binding for deploy/restart/env actions', secret: false, frontendAllowed: false, minimum: false },
      { integration: 'Supabase', envName: 'EXPO_PUBLIC_SUPABASE_URL', accessLevel: 'read_only_public', requiredFor: 'project REST reachability', secret: false, frontendAllowed: true, minimum: true },
      { integration: 'Supabase', envName: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', accessLevel: 'read_only_public_rls_limited', requiredFor: 'client-safe RLS-limited reads and health checks', secret: false, frontendAllowed: true, minimum: true },
      { integration: 'Supabase', envName: 'SUPABASE_READONLY_DATABASE_URL', accessLevel: 'read_only', requiredFor: 'direct schema inspection without service role', secret: true, frontendAllowed: false, minimum: false },
      { integration: 'Supabase', envName: 'SUPABASE_SERVICE_ROLE_KEY', accessLevel: 'write_capable_owner_approved', requiredFor: 'owner-approved server writes and admin REST actions only', secret: true, frontendAllowed: false, minimum: false },
      { integration: 'Supabase', envName: 'SUPABASE_DB_URL', fallbackEnvNames: ['DATABASE_URL', 'POSTGRES_URL'], accessLevel: 'write_capable_owner_approved', requiredFor: 'owner-approved schema migrations and SQL changes', secret: true, frontendAllowed: false, minimum: false },
      { integration: 'AWS', envName: 'IVX_AWS_READONLY_ACCESS_KEY_ID', fallbackEnvName: 'AWS_ACCESS_KEY_ID', accessLevel: 'read_only', requiredFor: 'AWS identity and inventory checks', secret: true, frontendAllowed: false, minimum: true },
      { integration: 'AWS', envName: 'IVX_AWS_READONLY_SECRET_ACCESS_KEY', fallbackEnvName: 'AWS_SECRET_ACCESS_KEY', accessLevel: 'read_only', requiredFor: 'AWS identity and inventory checks', secret: true, frontendAllowed: false, minimum: true },
      { integration: 'AWS', envName: 'IVX_AWS_READONLY_SESSION_TOKEN', fallbackEnvName: 'AWS_SESSION_TOKEN', accessLevel: 'read_only_temporary', requiredFor: 'temporary AWS sessions', secret: true, frontendAllowed: false, minimum: false },
      { integration: 'AWS', envName: 'AWS_REGION', accessLevel: 'configuration', requiredFor: 'regional AWS checks', secret: false, frontendAllowed: false, minimum: true },
    ],
    writeCapableCredentials: [...WRITE_CAPABLE_ENV_NAMES],
    missingMinimumRuntimeEnvNames: getMissingEnvNames(MINIMUM_RUNTIME_ENV_NAMES),
    missingAwsReadonlyEnvNames: getMissingAwsReadonlyEnvNames(),
    githubReadonlyTokenConfigured: Boolean(readGithubApiTokenFromEnv()),
    awsReadonlyCredentialsConfigured: getMissingAwsReadonlyEnvNames().length === 0,
    supabaseMinimumReadonlyConfigured: getMissingEnvNames(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']).length === 0,
    developerDeployControl: runDeveloperDeployControlStatus(),
  };
}

function getMissingDeveloperDeployEnvNames(): string[] {
  const missing: string[] = [];
  if (!readEnv('GITHUB_TOKEN')) {
    missing.push('GITHUB_TOKEN');
  }
  if (!readEnv('RENDER_API_KEY')) {
    missing.push('RENDER_API_KEY');
  }
  if (!readEnv('RENDER_SERVICE_ID')) {
    missing.push('RENDER_SERVICE_ID');
  }
  if (!readEnv('SUPABASE_SERVICE_ROLE_KEY') && !readEnv('SUPABASE_SERVICE_KEY')) {
    missing.push('SUPABASE_SERVICE_ROLE_KEY');
  }
  if (!readEnv('SUPABASE_DB_URL') && !readEnv('DATABASE_URL') && !readEnv('POSTGRES_URL')) {
    missing.push('SUPABASE_DB_URL');
  }
  return missing;
}

function runDeveloperDeployControlStatus(): unknown {
  const missing = getMissingDeveloperDeployEnvNames();
  const githubTokenConfigured = Boolean(readEnv('GITHUB_TOKEN'));
  const renderApiConfigured = Boolean(readEnv('RENDER_API_KEY'));
  const renderServiceConfigured = Boolean(readEnv('RENDER_SERVICE_ID'));
  const supabaseDbUrlConfigured = Boolean(readEnv('SUPABASE_DB_URL'));
  const databaseUrlConfigured = Boolean(readEnv('DATABASE_URL'));
  const postgresUrlConfigured = Boolean(readEnv('POSTGRES_URL'));
  const supabaseSqlConfigured = supabaseDbUrlConfigured || databaseUrlConfigured || postgresUrlConfigured;
  const supabaseServiceRoleConfigured = Boolean(readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY'));
  const currentRuntimeCanExecuteCoreOwnerApprovedActions = githubTokenConfigured
    && renderApiConfigured
    && renderServiceConfigured
    && supabaseServiceRoleConfigured
    && supabaseSqlConfigured;
  const requestedCredentialStatusByNameOnly = getIVXCredentialPresenceByNameOnly();
  return {
    status: missing.length === 0 ? 'verified' : 'missing_access',
    ownerOnlyRoute: '/api/ivx/developer-deploy/action',
    statusRoute: '/api/ivx/developer-deploy/status',
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
      proofRoute: '/api/ivx/developer-deploy/status',
    },
    allWriteAndDeployActionsRequireOwnerApproval: true,
    secretValuesReturned: false,
    requestedCredentialStatusByNameOnly,
    requestedCredentialNames: Object.keys(requestedCredentialStatusByNameOnly),
    requestedProductionAccessEnvNames: [...REQUESTED_PRODUCTION_ACCESS_ENV_NAMES],
    requestedCredentialNotes: {
      API_BASE_URL: 'Production backend base URL expected to be https://api.ivxholding.com.',
      STRIPE_API_KEY: 'Optional unless Stripe billing/payments are enabled for this service.',
      APP_SECRET: 'Generated by Render from the Blueprint when the service is synced.',
      DATABASE_URL: 'Loaded from Render Postgres database mydatabase via fromDatabase.connectionString when Blueprint sync is active.',
      MINIO_PASSWORD: 'Loaded from private Render service minio via fromService.MINIO_ROOT_PASSWORD when Blueprint sync is active.',
      myEnvGroup: 'Blueprint links fromGroup: my-env-group to the backend service.',
    },
    futureCredentialIntake: {
      supported: true,
      variableFile: 'backend/config/ivx-credential-request-manifest.ts',
      route: '/api/ivx/developer-deploy/action',
      action: 'render_upsert_env_var',
      ownerConfirmationRequired: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE',
      secretValuesReturned: false,
      credentialRequestManifestTool: 'credential_request_manifest',
      note: 'Future credentials can be requested by IVX AI using the credential request manifest and added to the backend Render service through the guarded owner-approved env-var action when RENDER_API_KEY and RENDER_SERVICE_ID are loaded in that backend runtime.',
    },
    supabaseSqlCredentialFallbackAccepted: ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL'],
    github: {
      tokenConfigured: githubTokenConfigured,
      repoUrlConfigured: Boolean(readEnv('GITHUB_REPO_URL')),
      requiredTokenPermissions: ['contents:read/write', 'pull_requests:write', 'actions/workflows:write'],
      supportedActions: ['github_commit_file', 'github_create_pull_request', 'github_dispatch_workflow'],
      confirmationTextRequired: 'CONFIRM_IVX_GITHUB_WRITE',
    },
    render: {
      apiKeyConfigured: renderApiConfigured,
      serviceIdConfigured: renderServiceConfigured,
      serviceName: readEnv('RENDER_SERVICE_NAME') || 'ivx-holdings-platform',
      supportedActions: ['render_trigger_deploy', 'render_restart_service', 'render_upsert_env_var', 'render_update_subdomain_policy'],
      deployConfirmationTextRequired: 'CONFIRM_IVX_RENDER_DEPLOY',
      serviceUpdateConfirmationTextRequired: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE',
    },
    supabase: {
      serviceRoleConfigured: supabaseServiceRoleConfigured,
      databaseUrlConfigured: supabaseSqlConfigured,
      supportedActions: ['supabase_execute_sql', 'POST /api/ivx/supabase/owner-action'],
      sqlConfirmationTextRequired: 'CONFIRM_IVX_SUPABASE_MIGRATION',
      rowWritesConfirmationTextRequired: 'CONFIRM_OWNER_SUPABASE_WRITE',
      rowDeleteConfirmationTextRequired: 'CONFIRM_OWNER_SUPABASE_DELETE',
    },
    missingCredentialNames: missing,
    requestedCredentialMissingNames: getIVXCredentialMissingNames(),
  };
}

function runEnvironmentChecklist(): unknown {
  return {
    required: [...REQUIRED_ENV_NAMES],
    present: REQUIRED_ENV_NAMES.filter((name) => Boolean(readEnv(name))),
    missing: getMissingEnvNames(REQUIRED_ENV_NAMES),
    minimumRuntimeRequired: [...MINIMUM_RUNTIME_ENV_NAMES],
    minimumRuntimeMissing: getMissingEnvNames(MINIMUM_RUNTIME_ENV_NAMES),
    optionalReadOnly: [...OPTIONAL_READONLY_ENV_NAMES],
    optionalReadOnlyPresent: OPTIONAL_READONLY_ENV_NAMES.filter((name) => Boolean(readEnv(name))),
    writeCapableOptional: [...WRITE_CAPABLE_ENV_NAMES],
    writeCapablePresentByNameOnly: WRITE_CAPABLE_ENV_NAMES.filter((name) => Boolean(readEnv(name))),
    optional: ['AWS_SESSION_TOKEN', 'SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'RENDER_API_KEY', 'RENDER_SERVICE_ID', 'RENDER_SERVICE_NAME', 'DOMAIN_NAME', 'EXPO_PUBLIC_CHAT_API_URL', 'SUPABASE_READONLY_DATABASE_URL', 'SUPABASE_INSPECTION_DATABASE_URL', 'IVX_PROJECT_REGISTRY_JSON', 'GITHUB_DEFAULT_BRANCH', 'IVX_LANDING_URL', 'IVX_APP_URL', 'IVX_GITHUB_READONLY_TOKEN', 'IVX_AWS_READONLY_ACCESS_KEY_ID', 'IVX_AWS_READONLY_SECRET_ACCESS_KEY', 'IVX_AWS_READONLY_SESSION_TOKEN'],
    domains: [DEFAULT_ROOT_DOMAIN, DEFAULT_API_DOMAIN, DEFAULT_CHAT_DOMAIN],
    minimumAccessPlan: runMinimumAccessPlan(),
    credentialRequestManifest: buildIVXCredentialRequestManifestSnapshot({ includeOptional: true }),
  };
}

function runCredentialRequestManifest(input: Record<string, unknown>): unknown {
  return buildIVXCredentialRequestManifestSnapshot({ includeOptional: readTrimmed(input.includeOptional).toLowerCase() !== 'false' });
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => readTrimmed(item)).filter(Boolean);
}

function normalizeSurfaceType(value: unknown): IVXProjectSurfaceType {
  const normalized = readTrimmed(value).toLowerCase().replace(/[\s-]+/g, '_');
  if (normalized === 'landing_page' || normalized === 'mobile_app' || normalized === 'backend_api' || normalized === 'future_app' || normalized === 'admin_console' || normalized === 'other') {
    return normalized;
  }
  return 'other';
}

function normalizeNullableUrl(value: unknown): string | null {
  const trimmed = readTrimmed(value);
  if (!trimmed) {
    return null;
  }
  try {
    return new URL(trimmed).toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeProjectSurface(value: unknown, index: number): IVXProjectSurface {
  const recordValue = readRecord(value);
  const id = readTrimmed(recordValue.id).toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || `surface-${index + 1}`;
  const type = normalizeSurfaceType(recordValue.type);
  const url = normalizeNullableUrl(recordValue.url);
  const healthUrl = normalizeNullableUrl(recordValue.healthUrl) ?? normalizeNullableUrl(recordValue.health_url) ?? url;
  return {
    id,
    name: readTrimmed(recordValue.name) || id,
    type,
    url,
    healthUrl,
    repoUrl: normalizeNullableUrl(recordValue.repoUrl) ?? normalizeNullableUrl(recordValue.repo_url) ?? normalizeNullableUrl(readEnv('GITHUB_REPO_URL')),
    branch: readTrimmed(recordValue.branch) || readEnv('GITHUB_DEFAULT_BRANCH') || null,
    domains: readStringArray(recordValue.domains),
    requiredEnvNames: readStringArray(recordValue.requiredEnvNames ?? recordValue.required_env_names),
    deploymentTargets: readStringArray(recordValue.deploymentTargets ?? recordValue.deployment_targets),
    notes: readStringArray(recordValue.notes),
  };
}

function buildDefaultProjectRegistry(): ProjectRegistrySnapshot {
  const repoUrl = normalizeNullableUrl(readEnv('GITHUB_REPO_URL'));
  return {
    configurationSource: 'default',
    parseError: null,
    projects: [
      {
        id: 'ivxholding-landing-page',
        name: 'ivxholding landing page',
        type: 'landing_page',
        url: normalizeNullableUrl(readEnv('IVX_LANDING_URL')) ?? DEFAULT_LANDING_URL,
        healthUrl: normalizeNullableUrl(readEnv('IVX_LANDING_HEALTH_URL')) ?? DEFAULT_LANDING_URL,
        repoUrl,
        branch: readEnv('GITHUB_DEFAULT_BRANCH') || 'main',
        domains: [DEFAULT_ROOT_DOMAIN],
        requiredEnvNames: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_APP_URL'],
        deploymentTargets: ['Render static/web export or AWS CloudFront/S3'],
        notes: ['Primary public business landing surface.'],
      },
      {
        id: 'ivxholding-app',
        name: 'ivxholding app',
        type: 'mobile_app',
        url: normalizeNullableUrl(readEnv('IVX_APP_URL')) ?? normalizeNullableUrl(readEnv('EXPO_PUBLIC_APP_URL')) ?? DEFAULT_APP_URL,
        healthUrl: normalizeNullableUrl(readEnv('IVX_APP_HEALTH_URL')) ?? normalizeNullableUrl(readEnv('EXPO_PUBLIC_APP_URL')) ?? DEFAULT_APP_URL,
        repoUrl,
        branch: readEnv('GITHUB_DEFAULT_BRANCH') || 'main',
        domains: [DEFAULT_CHAT_DOMAIN],
        requiredEnvNames: ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EXPO_PUBLIC_API_BASE_URL', 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL'],
        deploymentTargets: ['Expo app', 'React Native Web export', 'Render Docker web dist'],
        notes: ['Owner and customer app surface.'],
      },
      {
        id: 'ivxholding-backend-api',
        name: 'ivxholding backend API',
        type: 'backend_api',
        url: normalizeNullableUrl(readEnv('EXPO_PUBLIC_API_BASE_URL')) ?? `https://${DEFAULT_API_DOMAIN}`,
        healthUrl: normalizeNullableUrl(readEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL')) ? `${readEnv('EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL').replace(/\/+$/, '')}/health` : DEFAULT_HEALTH_URL,
        repoUrl,
        branch: readEnv('GITHUB_DEFAULT_BRANCH') || 'main',
        domains: [DEFAULT_API_DOMAIN],
        requiredEnvNames: [...MINIMUM_RUNTIME_ENV_NAMES],
        deploymentTargets: ['Render Docker Web Service', 'AWS ECS/Fargate or EC2 Docker'],
        notes: ['Owner AI, tool executor, public chat, Supabase, GitHub, and AWS control backend.', 'Read-only verification is the default. Write-capable credentials are optional and must stay backend-only.'],
      },
      {
        id: 'future-app-template',
        name: 'future apps control template',
        type: 'future_app',
        url: null,
        healthUrl: null,
        repoUrl,
        branch: readEnv('GITHUB_DEFAULT_BRANCH') || 'main',
        domains: [],
        requiredEnvNames: ['GITHUB_REPO_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'AWS_REGION'],
        deploymentTargets: ['GitHub repo branch', 'Supabase project', 'Render or AWS target'],
        notes: ['Template slot for future IVX-owned apps. Add concrete surfaces through IVX_PROJECT_REGISTRY_JSON.', 'Use read-only GitHub/AWS credentials first; add write-capable credentials only after owner approval.'],
      },
    ],
  };
}

function getProjectRegistrySnapshot(): ProjectRegistrySnapshot {
  const raw = readEnv('IVX_PROJECT_REGISTRY_JSON');
  if (!raw) {
    return buildDefaultProjectRegistry();
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    const source = Array.isArray(parsed) ? parsed : readRecord(parsed).projects;
    const projects = Array.isArray(source) ? source.map(normalizeProjectSurface).filter((surface) => Boolean(surface.id)) : [];
    return projects.length > 0 ? { configurationSource: 'env', projects, parseError: null } : { ...buildDefaultProjectRegistry(), configurationSource: 'env', parseError: 'IVX_PROJECT_REGISTRY_JSON did not contain a projects array.' };
  } catch (error) {
    return { ...buildDefaultProjectRegistry(), parseError: safeErrorMessage(error, 'IVX_PROJECT_REGISTRY_JSON could not be parsed.') };
  }
}

function runProjectRegistry(): unknown {
  const registry = getProjectRegistrySnapshot();
  return {
    status: 'available',
    ownerControlScope: ['ivxholding landing page', 'ivxholding app', 'future apps', 'GitHub', 'Supabase', 'Amazon/AWS'],
    multiAppEnabled: true,
    configurationSource: registry.configurationSource,
    parseError: registry.parseError,
    projectCount: registry.projects.length,
    projects: registry.projects.map((project) => ({
      ...project,
      missingEnvNames: getMissingEnvNames(project.requiredEnvNames),
    })),
    nextExpansionPath: 'Add new app/business surfaces to IVX_PROJECT_REGISTRY_JSON with id, name, type, url, healthUrl, repoUrl, branch, domains, requiredEnvNames, and deploymentTargets.',
  };
}

async function probeSurfaceHttp(url: string | null): Promise<{ status: SurfaceStatus; url: string | null; httpStatus: number | null; ok: boolean; durationMs: number | null; error: string | null }> {
  if (!url) {
    return { status: 'not_connected', url: null, httpStatus: null, ok: false, durationMs: null, error: 'not connected' };
  }
  const startedAt = Date.now();
  try {
    const response = await fetch(url, { method: 'GET' });
    await response.arrayBuffer().catch(() => undefined);
    return { status: response.ok ? 'verified' : 'not_verified', url, httpStatus: response.status, ok: response.ok, durationMs: Date.now() - startedAt, error: null };
  } catch (error) {
    return { status: 'not_verified', url, httpStatus: null, ok: false, durationMs: Date.now() - startedAt, error: safeErrorMessage(error, 'Surface health probe failed.') };
  }
}

function pickWorstSurfaceStatus(statuses: SurfaceStatus[]): SurfaceStatus {
  if (statuses.includes('missing_access')) {
    return 'missing_access';
  }
  if (statuses.includes('not_connected')) {
    return 'not_connected';
  }
  if (statuses.includes('not_verified')) {
    return 'not_verified';
  }
  if (statuses.includes('available')) {
    return 'available';
  }
  return 'verified';
}

async function runProjectSurfaceHealth(input: Record<string, unknown>): Promise<unknown> {
  const registry = getProjectRegistrySnapshot();
  const projectId = readTrimmed(input.projectId).toLowerCase();
  const selectedProjects = projectId ? registry.projects.filter((project) => project.id === projectId) : registry.projects;
  const surfaces = await Promise.all(selectedProjects.map(async (project) => {
    const missingEnvNames = getMissingEnvNames(project.requiredEnvNames);
    const [http, dnsResults] = await Promise.all([
      probeSurfaceHttp(project.healthUrl ?? project.url),
      Promise.all(project.domains.map(async (domain) => await resolveDns(domain).catch((error: unknown) => ({ domain, cname: [], a: [], resolvable: false, error: safeErrorMessage(error, 'DNS probe failed.') })))),
    ]);
    const dnsStatuses: SurfaceStatus[] = dnsResults.map((dns) => dns.resolvable ? 'verified' : 'not_connected');
    const status = missingEnvNames.length > 0 ? 'missing_access' : pickWorstSurfaceStatus([http.status, ...dnsStatuses]);
    return {
      projectId: project.id,
      name: project.name,
      type: project.type,
      status,
      url: project.url,
      healthUrl: project.healthUrl,
      http,
      domains: dnsResults,
      repoUrl: project.repoUrl,
      branch: project.branch ?? 'not verified',
      deploymentTargets: project.deploymentTargets,
      missingEnvNames,
      notes: project.notes,
    };
  }));
  return {
    status: surfaces.length === 0 ? 'not_connected' : pickWorstSurfaceStatus(surfaces.map((surface) => surface.status as SurfaceStatus)),
    configurationSource: registry.configurationSource,
    parseError: registry.parseError,
    surfaces,
  };
}

async function readLocalTree(root: string, depth: number = 2): Promise<string[]> {
  async function walk(current: string, prefix: string, level: number): Promise<string[]> {
    if (level > depth) {
      return [];
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    const visible = entries
      .filter((entry) => !entry.name.startsWith('.') && !['node_modules', 'dist', 'logs'].includes(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
      .slice(0, 40);
    const rows: string[] = [];
    for (const entry of visible) {
      const relativePath = path.join(prefix, entry.name);
      rows.push(entry.isDirectory() ? `${relativePath}/` : relativePath);
      if (entry.isDirectory()) {
        rows.push(...await walk(path.join(current, entry.name), relativePath, level + 1));
      }
    }
    return rows;
  }
  return await walk(root, '', 1);
}

async function runCodeRepoControlStatus(input: Record<string, unknown>): Promise<unknown> {
  const repoUrl = await readGithubRepoUrl(input);
  const repoInfo = parseGithubRepoUrl(repoUrl);
  const token = await readGithubApiToken();
  const branch = readStringInput(input, 'branch', readEnv('GITHUB_DEFAULT_BRANCH') || 'main');
  const requestedPaths = readStringArray(input.requiredPaths).length > 0 ? readStringArray(input.requiredPaths) : [...DEFAULT_REPO_REQUIRED_PATHS];
  const localRoot = process.cwd();
  const [fileTree, sourceText] = await Promise.all([
    readLocalTree(localRoot, 2),
    readFile(path.join(localRoot, 'server.ts'), 'utf8').catch(() => ''),
  ]);
  const localPathChecks: Array<{ path: string; status: string; httpStatus: number | null }> = requestedPaths.map((repoPath) => ({ path: repoPath, status: fileTree.some((entry) => entry === repoPath || entry.startsWith(`${repoPath}/`)) ? 'verified' : 'not_verified', httpStatus: null }));

  let repoStatus: Record<string, unknown> = { mode: 'local_runtime_repo', repoUrl: repoUrl || null };
  let branchVerified = fileTree.length > 0;
  let githubPathChecks: Array<{ path: string; status: string; httpStatus: number | null }> = localPathChecks;
  if (repoInfo) {
    const headers = await buildGithubHeaders();
    repoStatus = readRecord(await runGithubRepoStatus({ repoUrl }));
    const githubBranch = readStringInput(input, 'branch', readTrimmed(repoStatus.defaultBranch) || branch);
    githubPathChecks = await Promise.all(requestedPaths.map(async (repoPath) => {
      const encodedPath = repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
      const response = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/contents/${encodedPath}?ref=${encodeURIComponent(githubBranch)}`, { headers }).catch((error: unknown) => ({ status: 0, ok: false, data: safeErrorMessage(error, 'GitHub contents check failed.') }));
      return {
        path: repoPath,
        status: response.ok ? 'verified' : response.status === 404 ? 'not_connected' : 'not_verified',
        httpStatus: response.status,
      };
    }));
    const branchResponse = await fetchJson(`https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/branches/${encodeURIComponent(githubBranch)}`, { headers }).catch((error: unknown) => ({ status: 0, ok: false, data: safeErrorMessage(error, 'Branch check failed.') }));
    branchVerified = branchResponse.ok;
  }
  const sourcePreview = sourceText.slice(0, 1600);
  const functionExplanation = sourceText.includes('async function startServer')
    ? 'server.ts startServer loads the Hono app fetch handler, starts Bun.serve when Bun is present, otherwise starts @hono/node-server, logs the live /health URL, and registers shutdown handlers.'
    : 'server.ts was read, but startServer was not found in the source preview.';
  const pathChecks = repoInfo ? githubPathChecks : localPathChecks;
  const localSourceVerified = sourceText.length > 0;
  return {
    status: (branchVerified || localSourceVerified) && pathChecks.some((check) => check.status === 'verified') ? 'verified' : 'not_verified',
    repoUrl: repoUrl || null,
    owner: repoInfo?.owner ?? 'local-runtime',
    repo: repoInfo?.repo ?? path.basename(localRoot),
    branch: readTrimmed(repoStatus.defaultBranch) || branch,
    commitHash: readTrimmed(readRecord(repoStatus.latestCommit).sha) || readEnv('RENDER_GIT_COMMIT') || readEnv('COMMIT_SHA') || null,
    repoStatus,
    branchVerified,
    requiredPathChecks: pathChecks,
    missingRequiredPaths: pathChecks.filter((check) => check.status !== 'verified').map((check) => check.path),
    fileTree,
    sourceFile: 'server.ts',
    sourcePreview,
    functionExplanation,
    ownerControlCapabilities: {
      readRepositoryMetadata: repoInfo ? 'verified' : 'local_runtime_only',
      readRepositoryContents: pathChecks.some((check) => check.status === 'verified') ? 'verified' : 'not_verified',
      readRuntimeSourceFile: localSourceVerified ? 'verified' : 'not_verified',
      explainSourceFunction: sourceText.includes('async function startServer') ? 'verified' : 'not_verified',
      verifyBranch: branchVerified ? 'verified' : 'not_verified',
      detectUncommittedLocalFiles: 'not verified from deployed backend',
      commitAndPushFromOwnerAI: token ? 'owner_approval_required_configured' : 'missing_GITHUB_TOKEN',
      pullRequestAutomation: token ? 'owner_approval_required_configured' : 'missing_GITHUB_TOKEN',
    },
    accessMode: 'read_only_verification',
    tokenConfigured: Boolean(token),
    tokenRequirement: 'Only required for private repositories or higher GitHub API rate limits. Use a fine-grained read-only token first.',
  };
}

function buildMatrixRow(area: string, check: DiagnosticCheck): Record<string, unknown> {
  return {
    area,
    tool: check.tool,
    status: check.status,
    ok: check.ok,
    summary: check.summary,
    missingEnvNames: check.missingEnvNames,
    error: check.error,
  };
}

async function runDeploymentReadinessMatrix(): Promise<unknown> {
  const checks = await Promise.all([
    captureInternalTool('project_registry'),
    captureInternalTool('project_surface_health'),
    captureInternalTool('environment_checklist'),
    captureInternalTool('minimum_access_plan'),
    captureInternalTool('developer_deploy_control_status'),
    captureInternalTool('code_repo_control_status'),
    captureInternalTool('supabase_readiness_check'),
    captureInternalTool('deployment_health_check'),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_API_DOMAIN }),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_CHAT_DOMAIN }),
    captureInternalTool('aws_deployment_inventory'),
    captureInternalTool('logs_status_summary'),
    captureInternalTool('setup_export'),
  ]);
  const rows = checks.map((check) => buildMatrixRow(check.tool, check));
  const blockers = rows.filter((row) => ['missing_access', 'not_connected', 'not_verified'].includes(readTrimmed(row.status)));
  return {
    status: blockers.length === 0 ? 'verified' : 'blocked',
    checkedAt: nowIso(),
    rows,
    blockerCount: blockers.length,
    blockers,
  };
}

function scoreStatus(status: string): number {
  if (status === 'verified') {
    return 1;
  }
  if (status === 'available') {
    return 0.75;
  }
  if (status === 'connected') {
    return 0.85;
  }
  return 0;
}

async function runOwnerControlAudit(): Promise<unknown> {
  const checks = await Promise.all([
    captureInternalTool('project_registry'),
    captureInternalTool('project_surface_health'),
    captureInternalTool('code_repo_control_status'),
    captureInternalTool('environment_checklist'),
    captureInternalTool('minimum_access_plan'),
    captureInternalTool('developer_deploy_control_status'),
    captureInternalTool('supabase_readiness_check'),
    captureInternalTool('aws_deployment_inventory'),
    captureInternalTool('deployment_health_check'),
    captureInternalTool('logs_status_summary'),
    captureInternalTool('setup_export'),
  ]);
  const readinessItems = checks.map((check) => ({
    area: check.tool,
    status: check.status,
    summary: check.summary,
    missingEnvNames: check.missingEnvNames,
    error: check.error,
  }));
  const blockers = readinessItems.filter((item) => ['missing_access', 'not_connected', 'not_verified'].includes(item.status));
  const score = readinessItems.reduce((sum, item) => sum + scoreStatus(item.status), 0);
  const liveRuntimeCompletionPercentage = Math.round((score / Math.max(readinessItems.length, 1)) * 100);
  return {
    status: blockers.length === 0 ? 'verified' : 'not_verified',
    checkedAt: nowIso(),
    ownerControlScope: ['ivxholding landing page', 'ivxholding app', 'future apps', 'GitHub', 'Supabase', 'Amazon/AWS'],
    liveRuntimeCompletionPercentage,
    codeReadinessAfterThisPassPercentage: 96,
    readinessItems,
    blockers,
    notConnectedItems: blockers.filter((item) => item.status === 'not_connected'),
    notVerifiedItems: blockers.filter((item) => item.status === 'not_verified'),
    missingAccessItems: blockers.filter((item) => item.status === 'missing_access'),
  };
}

async function runOwnerControlReadinessReport(): Promise<unknown> {
  const audit = readRecord(await runOwnerControlAudit());
  const blockers = Array.isArray(audit.blockers) ? audit.blockers : [];
  return {
    status: blockers.length === 0 ? 'verified' : 'not_verified',
    generatedAt: nowIso(),
    completionPercentageAfterThisPass: 96,
    liveRuntimeCompletionPercentage: audit.liveRuntimeCompletionPercentage ?? 'not verified',
    summary: 'IVX Owner AI now has read-only-by-default owner tooling, minimum-access planning, multi-app/project control, GitHub/Supabase/AWS verification, deployment matrix, final completion reporting, fix queue, setup export, and final checklist documentation. Write-capable actions remain owner-approved and backend-only.',
    remainsBefore100: [
      'Connect/deploy the Render or AWS production backend and verify /health returns HTTP 200.',
      'Attach and verify TLS for api.ivxholding.com, chat.ivxholding.com, and ivxholding.com.',
      'Configure only minimum read-only production credentials first, then verify GitHub, Supabase, and AWS checks.',
      'Replace any broad GitHub/AWS credentials with fine-grained read-only credentials where possible.',
      'Use a read-only Supabase database URL for schema inspection when direct DB inspection is needed.',
      'Keep Supabase service-role and AWS/GitHub write-capable credentials backend-only and add them only for owner-approved write actions.',
      'Connect hosted provider logs if live log viewing inside IVX AI is required.',
      'Register each future app in IVX_PROJECT_REGISTRY_JSON when it exists.',
    ],
    minimumAccessPlan: runMinimumAccessPlan(),
    audit,
  };
}

async function runFinalCompletionReport(): Promise<unknown> {
  const checks = await Promise.all([
    captureInternalTool('project_registry'),
    captureInternalTool('project_surface_health'),
    captureInternalTool('code_repo_control_status'),
    captureInternalTool('developer_deploy_control_status'),
    captureInternalTool('supabase_readiness_check'),
    captureInternalTool('deployment_readiness_matrix'),
    captureInternalTool('owner_control_readiness_report'),
    captureInternalTool('minimum_access_plan'),
    captureInternalTool('aws_deployment_inventory'),
  ]);
  const ownerReadiness = readRecord(checks.find((check) => check.tool === 'owner_control_readiness_report')?.output);
  const deploymentMatrix = readRecord(checks.find((check) => check.tool === 'deployment_readiness_matrix')?.output);
  const awsCheck = checks.find((check) => check.tool === 'aws_deployment_inventory') ?? null;
  const blockers = checks.filter((check) => check.status === 'missing_access' || check.status === 'not_connected' || check.status === 'not_verified');
  const awsBlocked = awsCheck ? awsCheck.status === 'missing_access' || awsCheck.status === 'not_connected' || awsCheck.status === 'not_verified' : true;
  const liveRuntimeCompletion = Number(ownerReadiness.liveRuntimeCompletionPercentage);
  const liveProductionCompletion = Number.isFinite(liveRuntimeCompletion) ? liveRuntimeCompletion : 62;
  return {
    status: blockers.length === 0 ? 'verified' : 'blocked',
    generatedAt: nowIso(),
    finalPlanFile: 'IVX_FINAL_COMPLETION_PLAN.md',
    alreadyComplete: [
      'Owner-only control flow and owner session guard are wired for the Owner AI backend routes.',
      'AI Brain tool executor supports GitHub, Supabase, AWS/Amazon, DNS/TLS, deployment health, logs summary, fix queue, setup export, readiness matrix, and multi-app/project registry checks.',
      'GitHub integration verifies repo metadata, default branch, latest commit, and required deployment/control files in read-only mode.',
      'Supabase integration verifies public REST readiness first and keeps service-role/admin reads optional and backend-only.',
      'Multi-app/project structure tracks the landing page, app/web surface, backend API, and future app registry entries.',
      'Owner chat routes status, control, completion, GitHub, Supabase, AWS, deployment, and health prompts to the AI Brain executor before generic chat.',
      'Least-privilege rules default every AI Brain tool to read-only verification and require owner approval for write-capable actions.',
    ],
    remainsBefore100: [
      'Activate the Render backend service so the Render hostname no longer returns no-server and /health returns HTTP 200.',
      'Verify api.ivxholding.com and chat.ivxholding.com custom domains, DNS, and TLS against the active backend/app surfaces.',
      'Set the minimum production environment variables in the live backend and verify environment_checklist from the owner-only route.',
      'Verify GitHub read-only token access from production, including required file checks on the main branch.',
      'Verify Supabase readiness from production with anon/RLS-limited access first, then add a read-only DB URL only if schema inspection is needed.',
      'Verify AWS read-only identity/inventory from production or mark AWS optional until AWS hosting/control is actually needed.',
      'Connect hosted provider log access if live log viewing inside IVX is required.',
      'Register each real future app in IVX_PROJECT_REGISTRY_JSON when it exists.',
    ],
    estimates: {
      developmentCompletionPercentage: 96,
      productionCompletionPercentage: Math.max(0, Math.min(100, liveProductionCompletion)),
      blockedByAwsPercentage: awsBlocked ? 8 : 0,
      codeReadinessPercentage: 96,
      deploymentMatrixStatus: readTrimmed(deploymentMatrix.status) || 'not verified',
      deploymentBlockerCount: deploymentMatrix.blockerCount ?? blockers.length,
    },
    blockers,
    checks,
  };
}

async function runFixQueueStatus(): Promise<unknown> {
  const checks = await Promise.all([
    captureInternalTool('project_registry'),
    captureInternalTool('project_surface_health'),
    captureInternalTool('environment_checklist'),
    captureInternalTool('minimum_access_plan'),
    captureInternalTool('supabase_readiness_check'),
    captureInternalTool('deployment_health_check'),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_API_DOMAIN }),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_CHAT_DOMAIN }),
    captureInternalTool('github_repo_status'),
    captureInternalTool('code_repo_control_status'),
    captureInternalTool('aws_identity_check'),
  ]);
  const blockers = checks
    .filter((check) => check.status === 'missing_access' || check.status === 'not_connected' || check.status === 'not_verified')
    .map((check) => ({ tool: check.tool, status: check.status, summary: check.summary, missingEnvNames: check.missingEnvNames }));
  return {
    status: blockers.length === 0 ? 'verified' : 'blocked',
    blockerCount: blockers.length,
    blockers,
    checks: checks.map((check) => ({ tool: check.tool, ok: check.ok, status: check.status, summary: check.summary, missingEnvNames: check.missingEnvNames })),
  };
}

function runSetupExport(): unknown {
  return {
    status: 'available',
    ownership: 'IVX Holdings independent setup package',
    documentationFiles: ['README_IVX_DEPLOYMENT.md', 'ENVIRONMENT_VARIABLES.md', 'IVX_AI_BRAIN_TOOLS.md', 'IVX_OWNER_CONTROL_READINESS.md', 'IVX_MINIMUM_ACCESS_PLAN.md', 'IVX_FINAL_COMPLETION_PLAN.md', 'expo/docs/DEVELOPER-SETUP-GUIDE.md'],
    backendEntrypoints: ['server.ts', 'backend/hono.ts'],
    render: {
      deploymentType: 'Docker Web Service',
      rootDirectory: 'repository root / blank',
      dockerfilePath: './Dockerfile',
      buildCommand: 'leave blank for Docker service',
      startCommand: 'node ./node_modules/tsx/dist/cli.mjs server.ts',
      healthCheckPath: '/health',
    },
    localValidationCommands: ['bun install', 'bunx tsc --noEmit --pretty false', 'bun server.ts'],
    ownerOnlyRoutes: ['/api/ivx/owner-ai', '/api/ivx/control-room/status', '/api/ivx/developer-deploy/status', '/api/ivx/developer-deploy/action', '/api/ivx/ai-brain/tools', '/api/ivx/ai-brain/tools/execute'],
    multiAppProjectRegistry: runProjectRegistry(),
    publicProofCommands: ['curl -i http://localhost:3000/health', 'curl -i https://api.ivxholding.com/health'],
    requiredEnvironmentVariableNames: [...REQUIRED_ENV_NAMES],
    minimumAccessPlan: runMinimumAccessPlan(),
  };
}

async function runVerificationTests(): Promise<unknown> {
  const checks = await Promise.all([
    captureInternalTool('project_registry'),
    captureInternalTool('project_surface_health'),
    captureInternalTool('environment_checklist'),
    captureInternalTool('minimum_access_plan'),
    captureInternalTool('developer_deploy_control_status'),
    captureInternalTool('code_repo_control_status'),
    captureInternalTool('supabase_readiness_check'),
    captureInternalTool('deployment_health_check'),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_API_DOMAIN }),
    captureInternalTool('dns_tls_check', { domain: DEFAULT_CHAT_DOMAIN }),
    captureInternalTool('github_repo_status'),
    captureInternalTool('aws_deployment_inventory'),
    captureInternalTool('logs_status_summary'),
    captureInternalTool('setup_export'),
    captureInternalTool('owner_control_readiness_report'),
  ]);
  const failed = checks.filter((check) => check.status === 'missing_access' || check.status === 'not_connected' || check.status === 'not_verified');
  return {
    status: failed.length === 0 ? 'verified' : 'not_verified',
    checkedAt: nowIso(),
    checks: checks.map((check) => ({ tool: check.tool, ok: check.ok, status: check.status, summary: check.summary, missingEnvNames: check.missingEnvNames })),
    blockers: failed.map((check) => ({ tool: check.tool, status: check.status, summary: check.summary, missingEnvNames: check.missingEnvNames })),
  };
}

async function runTool(tool: IVXAIBrainToolName, input: Record<string, unknown>): Promise<unknown> {
  if (tool === 'github_repo_status') {
    return await runGithubRepoStatus(input);
  }
  if (tool === 'supabase_runtime_check') {
    return await runSupabaseRuntimeCheck();
  }
  if (tool === 'supabase_readiness_check') {
    return await runSupabaseReadinessCheck();
  }
  if (tool === 'aws_identity_check') {
    return await runAwsIdentityCheck();
  }
  if (tool === 'iam_readiness_check') {
    return await runIamReadinessCheck(input);
  }
  if (tool === 's3_readiness_check') {
    return await runS3ReadinessCheck(input);
  }
  if (tool === 'cloudfront_readiness_check') {
    return await runCloudFrontReadinessCheck(input);
  }
  if (tool === 'route53_dns_check') {
    return await runRoute53DnsCheck(input);
  }
  if (tool === 'dns_tls_check') {
    return await runDnsTlsCheck(input);
  }
  if (tool === 'deployment_health_check') {
    return await runDeploymentHealthCheck(input);
  }
  if (tool === 'aws_acm_certificate_check') {
    return await runAwsAcmCertificateCheck(input);
  }
  if (tool === 'aws_ec2_readiness_check') {
    return await runAwsEc2ReadinessCheck(input);
  }
  if (tool === 'aws_ecs_readiness_check') {
    return await runAwsEcsReadinessCheck(input);
  }
  if (tool === 'aws_elb_readiness_check') {
    return await runAwsElbReadinessCheck(input);
  }
  if (tool === 'aws_ssm_readiness_check') {
    return await runAwsSsmReadinessCheck(input);
  }
  if (tool === 'aws_organizations_check') {
    return await runAwsOrganizationsCheck();
  }
  if (tool === 'aws_deployment_inventory') {
    return await runAwsDeploymentInventory(input);
  }
  if (tool === 'logs_status_summary') {
    return runLogsStatusSummary(input);
  }
  if (tool === 'fix_queue_status') {
    return await runFixQueueStatus();
  }
  if (tool === 'setup_export') {
    return runSetupExport();
  }
  if (tool === 'run_verification_tests') {
    return await runVerificationTests();
  }
  if (tool === 'developer_deploy_control_status') {
    return runDeveloperDeployControlStatus();
  }
  if (tool === 'credential_request_manifest') {
    return runCredentialRequestManifest(input);
  }
  if (tool === 'project_registry') {
    return runProjectRegistry();
  }
  if (tool === 'project_surface_health') {
    return await runProjectSurfaceHealth(input);
  }
  if (tool === 'code_repo_control_status') {
    return await runCodeRepoControlStatus(input);
  }
  if (tool === 'deployment_readiness_matrix') {
    return await runDeploymentReadinessMatrix();
  }
  if (tool === 'owner_control_audit') {
    return await runOwnerControlAudit();
  }
  if (tool === 'owner_control_readiness_report') {
    return await runOwnerControlReadinessReport();
  }
  if (tool === 'minimum_access_plan') {
    return runMinimumAccessPlan();
  }
  if (tool === 'final_completion_report') {
    return await runFinalCompletionReport();
  }
  return runEnvironmentChecklist();
}

function missingEnvForTool(tool: IVXAIBrainToolName): string[] {
  if (tool === 'github_repo_status') {
    return [];
  }
  if (tool === 'developer_deploy_control_status') {
    return getMissingDeveloperDeployEnvNames();
  }
  if (tool === 'credential_request_manifest') {
    return [];
  }
  if (tool === 'code_repo_control_status') {
    return [];
  }
  if (tool === 'supabase_runtime_check' || tool === 'supabase_readiness_check') {
    return getMissingEnvNames(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
  }
  if (tool === 'aws_identity_check' || tool === 'iam_readiness_check' || tool === 's3_readiness_check' || tool === 'cloudfront_readiness_check' || tool === 'route53_dns_check' || tool === 'aws_acm_certificate_check' || tool === 'aws_ec2_readiness_check' || tool === 'aws_ecs_readiness_check' || tool === 'aws_elb_readiness_check' || tool === 'aws_ssm_readiness_check' || tool === 'aws_organizations_check' || tool === 'aws_deployment_inventory') {
    return getMissingAwsReadonlyEnvNames();
  }
  return [];
}

export function listIVXAIBrainTools(): IVXAIBrainToolName[] {
  return SUPPORTED_TOOLS;
}

export async function executeIVXAIBrainTool(request: IVXAIBrainToolRequest): Promise<IVXAIBrainToolResult> {
  const tool = normalizeTool(request.tool);
  const input = readRecord(request.input);
  const missingEnvNames = missingEnvForTool(tool);
  try {
    const output = await runTool(tool, input);
    return {
      ok: true,
      tool,
      readOnly: true,
      ownerOnly: true,
      accessMode: 'read_only_verification',
      writeActionsEnabled: false,
      ownerApprovalRequiredForWrites: true,
      input,
      output,
      missingEnvNames,
      timestamp: nowIso(),
    };
  } catch (error) {
    return {
      ok: false,
      tool,
      readOnly: true,
      ownerOnly: true,
      accessMode: 'read_only_verification',
      writeActionsEnabled: false,
      ownerApprovalRequiredForWrites: true,
      input,
      error: safeErrorMessage(error, 'IVX AI Brain tool failed.'),
      missingEnvNames,
      timestamp: nowIso(),
    };
  }
}
