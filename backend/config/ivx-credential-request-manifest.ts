export type IVXCredentialIntegration =
  | 'core'
  | 'ai_gateway'
  | 'github'
  | 'render'
  | 'supabase'
  | 'aws'
  | 'storage'
  | 'billing'
  | 'frontend_public';

export type IVXCredentialAccessLevel =
  | 'public_config'
  | 'backend_secret'
  | 'backend_write_capable_owner_approved'
  | 'render_blueprint_binding'
  | 'service_identifier';

export type IVXCredentialManifestEntry = {
  name: string;
  integration: IVXCredentialIntegration;
  accessLevel: IVXCredentialAccessLevel;
  secret: boolean;
  frontendAllowed: boolean;
  renderTarget: 'backend' | 'frontend' | 'backend_and_frontend' | 'render_resource';
  requiredFor: string;
  requiredForFullDeveloperBrain: boolean;
  requiredForProductionProof: boolean;
  requiredForMinimumRuntime: boolean;
  optional: boolean;
  blueprintManaged: boolean;
  futureCredentialRequestSupported: boolean;
  fallbackNames?: readonly string[];
  placeholder: string;
  description: string;
};

export type IVXCredentialRequestField = {
  name: string;
  description: string;
  placeholder: string;
  isPublic: boolean;
  secret: boolean;
  renderTarget: IVXCredentialManifestEntry['renderTarget'];
};

export type IVXCredentialRequestManifestSnapshot = {
  ok: true;
  variableFile: string;
  version: string;
  secretValuesReturned: false;
  secureCredentialIntakeEnabled: true;
  ownerApprovalRequiredForWrites: true;
  requestedCredentialNames: string[];
  requestedCredentialPresentByNameOnly: Record<string, boolean>;
  requestedCredentialMissingNames: string[];
  minimumRuntimeCredentialNames: string[];
  fullDeveloperBrainCredentialNames: string[];
  productionProofCredentialNames: string[];
  futureCredentialRequestFields: IVXCredentialRequestField[];
  requestTechnique: {
    sameSafeTechniqueAsRorkCredentialRequests: true;
    ownerChatCanAskForMissingCredentials: true;
    neverAskForPlaintextSecretsInChat: true;
    secretValuesMustBeEnteredOnlyInSecureHostEnvironment: true;
    futureCredentialRoute: string;
    futureCredentialAction: string;
    ownerConfirmationRequired: string;
    allowedFutureEnvNamePattern: string;
    renderUpsertInputShape: Record<string, unknown>;
  };
  manifest: IVXCredentialManifestEntry[];
  timestamp: string;
};

export const IVX_CREDENTIAL_REQUEST_MANIFEST_VERSION = 'ivx-secure-env-request-manifest-2026-05-05' as const;
export const IVX_CREDENTIAL_REQUEST_SOURCE_FILE = 'backend/config/ivx-credential-request-manifest.ts' as const;

export const IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES = [
  'API_BASE_URL',
  'GITHUB_REPO_URL',
  'GITHUB_TOKEN',
  'RENDER_API_KEY',
  'RENDER_SERVICE_ID',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_DB_URL',
  'SUPABASE_DB_PASSWORD',
  'DATABASE_URL',
  'POSTGRES_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_REGION',
  'S3_BUCKET_NAME',
  'MINIO_PASSWORD',
  'CLOUDFRONT_DISTRIBUTION_ID',
  'IVX_AI_GATEWAY_KEY',
  'STRIPE_API_KEY',
  'APP_SECRET',
] as const;

export type IVXRequestedProductionAccessEnvName = typeof IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES[number];

export const IVX_CREDENTIAL_REQUEST_MANIFEST: readonly IVXCredentialManifestEntry[] = [
  {
    name: 'API_BASE_URL',
    integration: 'core',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Production backend self-reference and owner tool status links.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: true,
    placeholder: 'https://api.ivxholding.com',
    description: 'Production backend base URL used by IVX Owner AI and backend proof tools.',
  },
  {
    name: 'GITHUB_REPO_URL',
    integration: 'github',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Repository targeting for GitHub status, commits, pull requests, and workflow dispatches.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'https://github.com/owner/repo',
    description: 'GitHub repository URL for IVX code/deploy checks.',
  },
  {
    name: 'GITHUB_TOKEN',
    integration: 'github',
    accessLevel: 'backend_write_capable_owner_approved',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Owner-approved GitHub commits, pull requests, and workflow dispatches.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'github_pat_...',
    description: 'Backend-only fine-grained GitHub token. Required permissions: contents read/write, pull requests write, actions/workflows write.',
  },
  {
    name: 'RENDER_API_KEY',
    integration: 'render',
    accessLevel: 'backend_write_capable_owner_approved',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Owner-approved Render deploy triggers, restarts, service checks, and future env-var updates.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'rnd_...',
    description: 'Backend-only Render API key for IVX Owner AI deployment control.',
  },
  {
    name: 'RENDER_SERVICE_ID',
    integration: 'render',
    accessLevel: 'service_identifier',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Target Render backend service binding for deploy/restart/env-var actions.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'srv-...',
    description: 'Render service ID for the IVX backend service that Owner AI may manage.',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    integration: 'supabase',
    accessLevel: 'backend_write_capable_owner_approved',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Backend-only owner-approved Supabase admin/row actions.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'eyJ...',
    description: 'Supabase service-role key. Never expose to the frontend.',
  },
  {
    name: 'SUPABASE_DB_URL',
    integration: 'supabase',
    accessLevel: 'backend_write_capable_owner_approved',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Owner-approved Supabase SQL/schema migrations.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    fallbackNames: ['DATABASE_URL', 'POSTGRES_URL'],
    placeholder: 'postgresql://...',
    description: 'Supabase Postgres connection string; DATABASE_URL or POSTGRES_URL can be accepted fallback names.',
  },
  {
    name: 'SUPABASE_DB_PASSWORD',
    integration: 'supabase',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Supabase direct database connection setup when URL derivation is needed.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'Supabase database password',
    description: 'Supabase database password stored only in backend secure environment variables.',
  },
  {
    name: 'DATABASE_URL',
    integration: 'render',
    accessLevel: 'render_blueprint_binding',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'render_resource',
    requiredFor: 'Render Postgres connection string fallback for SQL tooling.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: false,
    placeholder: 'Render fromDatabase connectionString',
    description: 'Generated/bound by Render Blueprint from the mydatabase Postgres resource.',
  },
  {
    name: 'POSTGRES_URL',
    integration: 'supabase',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Generic Postgres fallback for owner-approved SQL tooling.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: true,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'postgresql://...',
    description: 'Optional Postgres URL fallback when SUPABASE_DB_URL or DATABASE_URL are not used.',
  },
  {
    name: 'AWS_ACCESS_KEY_ID',
    integration: 'aws',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'AWS identity/inventory/status checks and owner-approved AWS operations routed separately.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'AKIA...',
    description: 'Backend-only AWS access key ID. Prefer least-privilege/read-only permissions for checks.',
  },
  {
    name: 'AWS_SECRET_ACCESS_KEY',
    integration: 'aws',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'AWS identity/inventory/status checks and owner-approved AWS operations routed separately.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'AWS secret access key',
    description: 'Backend-only AWS secret access key. Never expose to frontend or chat.',
  },
  {
    name: 'AWS_REGION',
    integration: 'aws',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Regional AWS checks.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'us-east-1',
    description: 'AWS region for IVX AWS checks and resources.',
  },
  {
    name: 'S3_BUCKET_NAME',
    integration: 'storage',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'S3 storage readiness checks.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: true,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'ivx-bucket-name',
    description: 'S3 bucket name used for IVX storage checks.',
  },
  {
    name: 'MINIO_PASSWORD',
    integration: 'storage',
    accessLevel: 'render_blueprint_binding',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'render_resource',
    requiredFor: 'Private Render MinIO service binding.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: true,
    blueprintManaged: true,
    futureCredentialRequestSupported: false,
    placeholder: 'Render fromService MINIO_ROOT_PASSWORD',
    description: 'Injected from the private Render MinIO service by Blueprint.',
  },
  {
    name: 'CLOUDFRONT_DISTRIBUTION_ID',
    integration: 'aws',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'CloudFront readiness checks.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: true,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'E1234567890ABC',
    description: 'CloudFront distribution ID for IVX CDN checks.',
  },
  {
    name: 'IVX_AI_GATEWAY_KEY',
    integration: 'ai_gateway',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'IVX Owner AI model requests through the backend runtime.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'Vercel AI Gateway API key',
    description: 'Backend-only AI Gateway key used by IVX Owner AI.',
  },
  {
    name: 'STRIPE_API_KEY',
    integration: 'billing',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Stripe billing/payment integration if enabled.',
    requiredForFullDeveloperBrain: false,
    requiredForProductionProof: false,
    requiredForMinimumRuntime: false,
    optional: true,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'sk_live_...',
    description: 'Optional backend-only Stripe secret key, required only when Stripe billing is enabled.',
  },
  {
    name: 'APP_SECRET',
    integration: 'core',
    accessLevel: 'render_blueprint_binding',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'render_resource',
    requiredFor: 'Backend app secret generated by Render.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: false,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: false,
    placeholder: 'Render generateValue',
    description: 'Generated by Render Blueprint; no manual secret value should be committed.',
  },
  {
    name: 'JWT_SECRET',
    integration: 'core',
    accessLevel: 'backend_secret',
    secret: true,
    frontendAllowed: false,
    renderTarget: 'backend',
    requiredFor: 'Backend session/signing secret where applicable.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'long random string',
    description: 'Backend-only JWT/session signing secret.',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    integration: 'frontend_public',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: true,
    renderTarget: 'backend_and_frontend',
    requiredFor: 'Supabase project URL for app auth/data and backend readiness checks.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'https://PROJECT.supabase.co',
    description: 'Client-safe Supabase project URL.',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    integration: 'frontend_public',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: true,
    renderTarget: 'backend_and_frontend',
    requiredFor: 'Supabase anon/RLS-limited client and readiness checks.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: false,
    futureCredentialRequestSupported: true,
    placeholder: 'eyJ...',
    description: 'Client-safe Supabase anon key. This is public but still should be managed through environment variables.',
  },
  {
    name: 'EXPO_PUBLIC_API_BASE_URL',
    integration: 'frontend_public',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: true,
    renderTarget: 'backend_and_frontend',
    requiredFor: 'Frontend/backend public API routing.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: true,
    placeholder: 'https://api.ivxholding.com',
    description: 'Client-safe IVX API base URL.',
  },
  {
    name: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
    integration: 'frontend_public',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: true,
    renderTarget: 'backend_and_frontend',
    requiredFor: 'Owner AI frontend-to-backend API routing.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: true,
    placeholder: 'https://api.ivxholding.com',
    description: 'Client-safe Owner AI backend base URL.',
  },
  {
    name: 'EXPO_PUBLIC_APP_URL',
    integration: 'frontend_public',
    accessLevel: 'public_config',
    secret: false,
    frontendAllowed: true,
    renderTarget: 'backend_and_frontend',
    requiredFor: 'Public chat/app URL references.',
    requiredForFullDeveloperBrain: true,
    requiredForProductionProof: true,
    requiredForMinimumRuntime: true,
    optional: false,
    blueprintManaged: true,
    futureCredentialRequestSupported: true,
    placeholder: 'https://chat.ivxholding.com',
    description: 'Client-safe public app URL.',
  },
] as const;

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmedEnv(name: string): string {
  return typeof process.env[name] === 'string' ? process.env[name]?.trim() ?? '' : '';
}

function toRequestField(entry: IVXCredentialManifestEntry): IVXCredentialRequestField {
  return {
    name: entry.name,
    description: entry.description,
    placeholder: entry.placeholder,
    isPublic: entry.frontendAllowed || entry.name.startsWith('EXPO_PUBLIC_') || entry.name.startsWith('VITE_'),
    secret: entry.secret,
    renderTarget: entry.renderTarget,
  };
}

/** Returns credential presence by name only; values are never returned. */
export function getIVXCredentialPresenceByNameOnly(envNames: readonly string[] = IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES): Record<string, boolean> {
  return Object.fromEntries(envNames.map((name) => [name, Boolean(readTrimmedEnv(name))]));
}

/** Returns missing credential names only; values are never returned. */
export function getIVXCredentialMissingNames(envNames: readonly string[] = IVX_REQUESTED_PRODUCTION_ACCESS_ENV_NAMES): string[] {
  return envNames.filter((name) => !readTrimmedEnv(name));
}

/** Builds the Owner AI variable/request manifest used to request current and future env vars safely. */
export function buildIVXCredentialRequestManifestSnapshot(input: { includeOptional?: boolean } = {}): IVXCredentialRequestManifestSnapshot {
  const manifest = IVX_CREDENTIAL_REQUEST_MANIFEST.filter((entry) => input.includeOptional === true || !entry.optional);
  const requestedCredentialNames = [...new Set(manifest.map((entry) => entry.name))];
  return {
    ok: true,
    variableFile: IVX_CREDENTIAL_REQUEST_SOURCE_FILE,
    version: IVX_CREDENTIAL_REQUEST_MANIFEST_VERSION,
    secretValuesReturned: false,
    secureCredentialIntakeEnabled: true,
    ownerApprovalRequiredForWrites: true,
    requestedCredentialNames,
    requestedCredentialPresentByNameOnly: getIVXCredentialPresenceByNameOnly(requestedCredentialNames),
    requestedCredentialMissingNames: getIVXCredentialMissingNames(requestedCredentialNames),
    minimumRuntimeCredentialNames: manifest.filter((entry) => entry.requiredForMinimumRuntime).map((entry) => entry.name),
    fullDeveloperBrainCredentialNames: manifest.filter((entry) => entry.requiredForFullDeveloperBrain).map((entry) => entry.name),
    productionProofCredentialNames: manifest.filter((entry) => entry.requiredForProductionProof).map((entry) => entry.name),
    futureCredentialRequestFields: manifest.filter((entry) => entry.futureCredentialRequestSupported).map(toRequestField),
    requestTechnique: {
      sameSafeTechniqueAsRorkCredentialRequests: true,
      ownerChatCanAskForMissingCredentials: true,
      neverAskForPlaintextSecretsInChat: true,
      secretValuesMustBeEnteredOnlyInSecureHostEnvironment: true,
      futureCredentialRoute: 'POST /api/ivx/developer-deploy/action',
      futureCredentialAction: 'render_upsert_env_var',
      ownerConfirmationRequired: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE',
      allowedFutureEnvNamePattern: '^[A-Z][A-Z0-9_]{1,120}$',
      renderUpsertInputShape: {
        action: 'render_upsert_env_var',
        input: {
          key: 'NEW_BACKEND_ENV_NAME',
          value: '[secure value entered only in Render/backend env storage]',
          generateValue: false,
        },
        confirm: true,
        confirmText: 'CONFIRM_IVX_RENDER_SERVICE_UPDATE',
        reason: 'Owner-approved future credential intake for IVX AI tools.',
      },
    },
    manifest: manifest.map((entry) => ({ ...entry })),
    timestamp: nowIso(),
  };
}
