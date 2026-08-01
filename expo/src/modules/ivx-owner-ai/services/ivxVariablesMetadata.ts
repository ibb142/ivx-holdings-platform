/**
 * IVX IA Variables — safe metadata registry.
 *
 * This file is the single source of truth for OWNER-FACING variable metadata
 * surfaced in IVX IA Variables. It never holds secret values. Only safe
 * metadata fields are stored here so the screen can sync status across
 * Rork context, Render runtime, Supabase, AWS, AI gateway, and storage
 * providers without ever exposing or logging a secret.
 *
 * Fields:
 *  - name: env var name as it appears in Render / Supabase / etc.
 *  - category: high-level grouping for the UI
 *  - sourceLocation: where the canonical value lives (where the owner edits it)
 *  - provider: provider category the credential belongs to
 *  - secret: true if the value must NEVER be displayed (only masked)
 *  - isPublic: true for EXPO_PUBLIC_* / VITE_* (inlined to client)
 *  - required: true if production needs this credential right now
 *  - devOnly: true if this is only used in dev / preview builds
 *  - rollbackOnly: true if kept around for rollback to the previous deploy
 *  - safeToRemove: true if scheduled for cleanup once IVX backend takes over
 *  - featureUnlocked: human label describing what this credential enables
 *  - actionRequired: short message for owner action, null if nothing to do
 *  - ownerActionNeeded: true if the owner must explicitly do something
 *  - description: short copy shown under the variable name
 */
export type IVXTrackedVariableCategory =
  | 'Supabase'
  | 'Auth & Identity'
  | 'GitHub'
  | 'Render / Deploy'
  | 'AWS / Storage'
  | 'AI Gateway'
  | 'Rork Runtime'
  | 'Security';

export type IVXTrackedVariableSource =
  | 'Render service env (ivx-holdings-platform)'
  | 'Rork project env (public)'
  | 'Rork project env (private)'
  | 'Supabase project settings'
  | 'Owner-managed (Render)'
  | 'Owner-managed (Rork)';

export type IVXTrackedVariableProvider =
  | 'github'
  | 'render'
  | 'supabase'
  | 'aws'
  | 'ai'
  | 'security'
  | 'storage'
  | 'rork';

export type IVXTrackedVariableMetadata = {
  name: string;
  category: IVXTrackedVariableCategory;
  sourceLocation: IVXTrackedVariableSource;
  provider: IVXTrackedVariableProvider;
  secret: boolean;
  isPublic: boolean;
  required: boolean;
  devOnly: boolean;
  rollbackOnly: boolean;
  safeToRemove: boolean;
  featureUnlocked: string;
  actionRequired: string | null;
  ownerActionNeeded: boolean;
  description: string;
};

const meta = (m: IVXTrackedVariableMetadata): IVXTrackedVariableMetadata => m;

export const IVX_TRACKED_VARIABLE_METADATA: IVXTrackedVariableMetadata[] = [
  // --- Supabase ---
  meta({
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    category: 'Supabase',
    sourceLocation: 'Rork project env (public)',
    provider: 'supabase',
    secret: false,
    isPublic: true,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Supabase client connection from the mobile app',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Public Supabase project URL inlined into the Expo bundle.',
  }),
  meta({
    name: 'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    category: 'Supabase',
    sourceLocation: 'Rork project env (public)',
    provider: 'supabase',
    secret: true,
    isPublic: true,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Owner + user authentication and RLS reads',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Public anon key used by the mobile client to talk to Supabase.',
  }),
  meta({
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    category: 'Supabase',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'supabase',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Owner-only backend writes (variables, repair, audit, deploys)',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Server-side Supabase service role key. Never sent to the phone.',
  }),
  meta({
    name: 'SUPABASE_DB_URL',
    category: 'Supabase',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'supabase',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Direct Postgres access for migrations / admin scripts',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Postgres connection string for Supabase. Backend-only.',
  }),
  meta({
    name: 'DATABASE_URL',
    category: 'Supabase',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'supabase',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Postgres connection used by backend runtime + tools',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Primary Postgres URL used by Render runtime. Backend-only.',
  }),

  // --- Auth & Identity ---
  meta({
    name: 'EXPO_PUBLIC_OWNER_EMAIL',
    category: 'Auth & Identity',
    sourceLocation: 'Rork project env (public)',
    provider: 'security',
    secret: false,
    isPublic: true,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Owner-only routing + owner login allowlist on the client',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Email address recognized by the app as the platform owner.',
  }),
  meta({
    name: 'IVX_OWNER_REGISTRATION_EMAILS',
    category: 'Auth & Identity',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'security',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Backend allowlist for owner registration + repair',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Comma-separated owner emails authorized by the backend.',
  }),

  // --- GitHub ---
  meta({
    name: 'GITHUB_TOKEN',
    category: 'GitHub',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'github',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Backend GitHub sync, code push proof, repo audits',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'GitHub PAT used by the backend to read/push the repo.',
  }),
  meta({
    name: 'GITHUB_REPO_URL',
    category: 'GitHub',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'github',
    secret: false,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Pinned target repo for backend GitHub operations',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Canonical GitHub repository URL the backend targets.',
  }),

  // --- Render / Deploy ---
  meta({
    name: 'RENDER_API_KEY',
    category: 'Render / Deploy',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'render',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Owner-triggered Render deploys + deploy history',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Render API key used by the backend to trigger deploys.',
  }),
  meta({
    name: 'RENDER_SERVICE_ID',
    category: 'Render / Deploy',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'render',
    secret: false,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Pinned target service for Deploy backend now action',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Render service id for ivx-holdings-platform.',
  }),

  // --- AWS / Storage ---
  meta({
    name: 'AWS_ACCESS_KEY_ID',
    category: 'AWS / Storage',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'aws',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'S3 + CloudFront + SES/SNS write operations from backend',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'AWS access key id used by the backend runtime.',
  }),
  meta({
    name: 'AWS_SECRET_ACCESS_KEY',
    category: 'AWS / Storage',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'aws',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'AWS-authenticated requests from backend runtime',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'AWS secret access key paired with AWS_ACCESS_KEY_ID.',
  }),
  meta({
    name: 'AWS_REGION',
    category: 'AWS / Storage',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'aws',
    secret: false,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Region pinning for AWS SDK clients',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Default AWS region used by S3/CloudFront/SES clients.',
  }),
  meta({
    name: 'S3_BUCKET_NAME',
    category: 'AWS / Storage',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'storage',
    secret: false,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Landing site asset uploads + CloudFront origin',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Primary S3 bucket for landing assets and uploads.',
  }),
  meta({
    name: 'CLOUDFRONT_DISTRIBUTION_ID',
    category: 'AWS / Storage',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'storage',
    secret: false,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'CloudFront invalidations after landing publish',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'CloudFront distribution id used for cache invalidations.',
  }),

  // --- AI Gateway ---
  meta({
    name: 'IVX_AI_GATEWAY_KEY',
    category: 'AI Gateway',
    sourceLocation: 'Render service env (ivx-holdings-platform)',
    provider: 'ai',
    secret: true,
    isPublic: false,
    required: true,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'IVX-owned AI proxy auth (chat, vision, outreach)',
    actionRequired: null,
    ownerActionNeeded: false,
    description: 'Server-side API key for the IVX AI gateway.',
  }),
  meta({
    name: 'EXPO_PUBLIC_IVX_AI_GATEWAY_URL',
    category: 'AI Gateway',
    sourceLocation: 'Rork project env (public)',
    provider: 'ai',
    secret: false,
    isPublic: true,
    required: false,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Client points AI traffic to the IVX-owned gateway',
    actionRequired: 'Set this in Rork public env to fully cut over from Rork AI hosts.',
    ownerActionNeeded: true,
    description: 'Public URL the client uses to reach the IVX AI gateway.',
  }),
  meta({
    name: 'EXPO_PUBLIC_IVX_CLIENT_DIRECT_GATEWAY',
    category: 'AI Gateway',
    sourceLocation: 'Rork project env (public)',
    provider: 'ai',
    secret: false,
    isPublic: true,
    required: false,
    devOnly: false,
    rollbackOnly: false,
    safeToRemove: false,
    featureUnlocked: 'Direct-client routing flag for IVX AI gateway',
    actionRequired: 'Set to "true" once IVX gateway is verified for direct client use.',
    ownerActionNeeded: true,
    description: 'Toggle to bypass legacy Rork relays once IVX gateway is live.',
  }),

  // --- Rork Runtime (REMOVED 2026-07-12) ---
  // All legacy external-platform env vars have been permanently removed from the
  // app. The client AI runtime routes through api.ivxholding.com only.
  // No app code reads any Rork env var at runtime.
];

export const IVX_TRACKED_VARIABLE_NAMES: string[] = IVX_TRACKED_VARIABLE_METADATA.map((entry) => entry.name);

export function getTrackedVariableMetadata(name: string): IVXTrackedVariableMetadata | null {
  return IVX_TRACKED_VARIABLE_METADATA.find((entry) => entry.name === name) ?? null;
}

/**
 * Detect whether a public env variable is present in the running client bundle.
 * Safe: only checks `process.env` key presence and length, never returns or
 * logs the value. Private (non-public) variables always return false here —
 * they must be verified by the backend status endpoint.
 */
export function detectPublicVariablePresence(name: string): boolean {
  if (!name.startsWith('EXPO_PUBLIC_') && !name.startsWith('VITE_')) {
    return false;
  }
  try {
    const value = (process.env as Record<string, string | undefined>)[name];
    return typeof value === 'string' && value.trim().length > 0;
  } catch {
    return false;
  }
}
