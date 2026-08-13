/**
 * IVX Environment Variable Validator
 *
 * Validates security-critical environment variables at startup.
 * Logs sanitized warnings (variable names only, never values).
 * Does not crash for optional integrations.
 *
 * Canonical variable names:
 *   - IVX_AI_GATEWAY_KEY (not AI_GATEWAY_API_KEY, not OPENAI_API_KEY)
 *   - STRIPE_SECRET_KEY (STRIPE_API_KEY is a temporary server-side alias)
 *   - SUPABASE_SERVICE_ROLE_KEY (never exposed to clients)
 */

type EnvVarClassification = 'required' | 'optional' | 'deprecated' | 'client-public';

interface EnvVarDefinition {
  name: string;
  classification: EnvVarClassification;
  description: string;
}

const ENV_VARS: EnvVarDefinition[] = [
  // Required security-critical (server-runtime) — app cannot function safely without these
  { name: 'SUPABASE_SERVICE_ROLE_KEY', classification: 'required', description: 'Supabase service role key for server-side DB operations' },
  { name: 'JWT_SECRET', classification: 'required', description: 'JWT signing secret for auth tokens' },
  { name: 'APP_SECRET', classification: 'required', description: 'Application-level secret for signing' },

  // Optional integrations (server-runtime) — features disabled but app stays up
  { name: 'IVX_AI_GATEWAY_KEY', classification: 'optional', description: 'AI gateway key for chat/AI features (Vercel AI Gateway)' },
  { name: 'STRIPE_API_KEY', classification: 'optional', description: 'Stripe API key for payments (alias for STRIPE_SECRET_KEY)' },
  { name: 'STRIPE_SECRET_KEY', classification: 'optional', description: 'Stripe secret key for payments' },
  { name: 'RENDER_API_KEY', classification: 'optional', description: 'Render API key for deployment management' },
  { name: 'RENDER_SERVICE_ID', classification: 'optional', description: 'Render service ID for deployment targeting' },
  { name: 'AWS_ACCESS_KEY_ID', classification: 'optional', description: 'AWS access key for S3/CDN operations' },
  { name: 'AWS_SECRET_ACCESS_KEY', classification: 'optional', description: 'AWS secret key for S3/CDN operations' },
  { name: 'AWS_REGION', classification: 'optional', description: 'AWS region for S3/CDN operations' },
  { name: 'S3_BUCKET_NAME', classification: 'optional', description: 'S3 bucket name for file storage' },
  { name: 'CLOUDFRONT_DISTRIBUTION_ID', classification: 'optional', description: 'CloudFront distribution ID for CDN' },
  { name: 'GITHUB_TOKEN', classification: 'optional', description: 'GitHub token for repo operations (only if backend uses GitHub API)' },
  { name: 'GITHUB_REPO_URL', classification: 'optional', description: 'GitHub repository URL (only if backend uses GitHub API)' },

  // Client-public (safe to expose in client bundles — no secrets)
  { name: 'EXPO_PUBLIC_SUPABASE_URL', classification: 'client-public', description: 'Supabase project URL (public)' },
  { name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', classification: 'client-public', description: 'Supabase anon key (public, safe for client)' },
  { name: 'EXPO_PUBLIC_API_BASE_URL', classification: 'client-public', description: 'API base URL (public)' },

  // Deprecated aliases — should be migrated to canonical names
  { name: 'AI_GATEWAY_API_KEY', classification: 'deprecated', description: 'Deprecated; use IVX_AI_GATEWAY_KEY' },
  { name: 'OPENAI_API_KEY', classification: 'deprecated', description: 'Deprecated; use IVX_AI_GATEWAY_KEY' },
];

export interface EnvValidationResult {
  required: string[];
  optional: string[];
  deprecated: string[];
  warnings: string[];
}

/**
 * Validate environment variables. Returns categorized lists of missing/deprecated vars.
 * Never reads or returns secret values — only checks presence and logs variable names.
 */
export function validateEnvironment(): EnvValidationResult {
  const missing: string[] = [];
  const optional: string[] = [];
  const deprecated: string[] = [];
  const warnings: string[] = [];

  for (const def of ENV_VARS) {
    const value = process.env[def.name]?.trim();
    const isPresent = Boolean(value);

    if (def.classification === 'required' && !isPresent) {
      missing.push(def.name);
      warnings.push(`Required env var ${def.name} is not set: ${def.description}`);
    }

    if (def.classification === 'optional' && !isPresent) {
      optional.push(def.name);
    }

    if (def.classification === 'deprecated' && isPresent) {
      deprecated.push(def.name);
      warnings.push(`Deprecated env var ${def.name} is set; migrate to canonical name`);
    }
  }

  return { required: missing, optional, deprecated, warnings };
}

/**
 * Log environment validation at startup. Sanitized — variable names only, never values.
 * Does not throw or crash the app for missing optional integrations.
 */
export function logEnvironmentValidation(): void {
  const result = validateEnvironment();

  if (result.warnings.length === 0) {
    console.log('[IVXEnv] All required environment variables are configured.');
    return;
  }

  console.log('[IVXEnv] Environment validation:');
  for (const warning of result.warnings) {
    console.log(`[IVXEnv] WARNING: ${warning}`);
  }

  if (result.required.length > 0) {
    console.error(
      `[IVXEnv] CRITICAL: ${result.required.length} required environment variables are missing: ${result.required.join(', ')}`
    );
  }

  if (result.optional.length > 0) {
    console.log(
      `[IVXEnv] INFO: ${result.optional.length} optional integrations not configured: ${result.optional.join(', ')}`
    );
  }

  if (result.deprecated.length > 0) {
    console.log(
      `[IVXEnv] INFO: ${result.deprecated.length} deprecated env vars still in use: ${result.deprecated.join(', ')}`
    );
  }
}
