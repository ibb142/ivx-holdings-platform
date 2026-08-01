/**
 * IVX Credential Readiness service (BLOCKER 2).
 *
 * A single, owner-safe view of which credentials/secrets IVX has — and exactly
 * what degrades when one is missing — so IVX is as independent from manual owner
 * credentials as safely possible, with an honest fallback for every gap.
 *
 * Provides:
 *   - credential presence checker (env-var NAME presence only)
 *   - missing-credential diagnostics (exact var + what it unlocks + how to set it)
 *   - owner-approval gate (guarded actions require ownerApproved + required creds)
 *   - deployment-token verification (shape check that rejects placeholder text)
 *   - safe fallback for every missing credential
 *   - a clear status roll-up showing which credentials are configured
 *
 * HARD HONESTY RULE: this NEVER returns a secret value. It reports presence,
 * a non-reversible shape verdict (configured / verified / placeholder), and the
 * exact env-var NAME. No value, no prefix, no masked value is ever emitted.
 */

export const IVX_CREDENTIAL_READINESS_MARKER = 'ivx-credential-readiness-2026-06-07';

export type CredentialCategory = 'ai' | 'database' | 'storage' | 'deploy' | 'vcs' | 'auth';
export type CredentialImportance = 'required' | 'recommended' | 'optional';

export type CredentialSpec = {
  /** Env-var NAME only — never the value. */
  name: string;
  category: CredentialCategory;
  importance: CredentialImportance;
  purpose: string;
  /** Capabilities this credential unlocks. */
  enables: string[];
  /** Safe, honest behavior when this credential is absent. */
  fallbackWhenMissing: string;
  /** True for deploy/auth tokens that should pass a shape verification. */
  verifyShape?: boolean;
};

export type CredentialStatus = {
  name: string;
  category: CredentialCategory;
  importance: CredentialImportance;
  purpose: string;
  enables: string[];
  configured: boolean;
  /** Only meaningful for shape-verified tokens; null otherwise. */
  verified: boolean | null;
  /** Honest reason a configured token failed shape verification (placeholder text, too short). */
  verificationNote: string | null;
  fallback: string | null;
  /** Exact, actionable missing-credential diagnostic, or null when configured. */
  diagnostic: string | null;
};

export type DeploymentReadiness = {
  ownerTokenConfigured: boolean;
  ownerTokenVerified: boolean;
  renderApiConfigured: boolean;
  githubPushConfigured: boolean;
  /** A deploy path exists if GitHub push OR Render API is available. */
  deployPathAvailable: boolean;
  /** Direct deploy/rollback control needs the Render API token verified. */
  directDeployControl: boolean;
  blocker: string | null;
  safeFallback: string;
};

export type CredentialReadinessReport = {
  marker: string;
  generatedAt: string;
  total: number;
  configured: number;
  missing: number;
  required: { total: number; configured: number; missing: number };
  byCategory: Record<CredentialCategory, { total: number; configured: number }>;
  credentials: CredentialStatus[];
  deployment: DeploymentReadiness;
  /** full = all required present + a verified deploy path; degraded = core present, deploy gap; blocked = required core missing. */
  autonomyLevel: 'full' | 'degraded' | 'blocked';
  missingDiagnostics: string[];
  /** Always false — proof we never emit secret values. */
  secretValuesReturned: false;
};

type EnvSnapshot = Record<string, string | undefined>;

const PLACEHOLDER_FRAGMENTS = [
  'placeholder',
  'your-',
  'your_',
  'changeme',
  'change-me',
  'change_me',
  'example',
  'paste',
  'instruction',
  'todo',
  'tbd',
  'xxxx',
  '<',
  '>',
];

const CREDENTIAL_SPECS: CredentialSpec[] = [
  {
    name: 'IVX_AI_GATEWAY_KEY',
    category: 'ai',
    importance: 'required',
    purpose: 'AI reasoning gateway for Owner AI, public chat, planning, and synthesis.',
    enables: ['Owner AI', 'Public AI', 'autonomous planning', 'deal intelligence'],
    fallbackWhenMissing: 'Falls back to deterministic intent routing + stored answers; generative reasoning is unavailable.',
  },
  {
    name: 'EXPO_PUBLIC_SUPABASE_URL',
    category: 'database',
    importance: 'required',
    purpose: 'Supabase project endpoint for data reads/writes and storage.',
    enables: ['CRM', 'jv_deals', 'deliverable storage', 'auth'],
    fallbackWhenMissing: 'Durable filesystem stores keep working; remote persistence + storage are unavailable.',
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    category: 'database',
    importance: 'required',
    purpose: 'Service-role access for server-side Supabase reads/writes and storage uploads.',
    enables: ['authoritative jv_deals read', 'owner DB actions', 'deliverable uploads'],
    fallbackWhenMissing: 'Read/write to Supabase + real downloadable deliverables are blocked; filesystem audit stores remain.',
    verifyShape: true,
  },
  {
    name: 'IVX_OWNER_REGISTRATION_EMAILS',
    category: 'auth',
    importance: 'required',
    purpose: 'Owner allowlist that promotes an authenticated session to owner privileges.',
    enables: ['owner-gated routes', 'approval gates'],
    fallbackWhenMissing: 'Owner promotion rejects all sessions; owner-gated routes return 401/403 (safe-closed).',
  },
  {
    name: 'IVX_OWNER_TOKEN',
    category: 'auth',
    importance: 'recommended',
    purpose: 'Owner service token accepted for owner-gated routes without a Supabase session.',
    enables: ['owner service automation', 'CI owner calls'],
    fallbackWhenMissing: 'Falls back to Supabase owner-session auth; service-token automation is unavailable.',
    verifyShape: true,
  },
  {
    name: 'GITHUB_TOKEN',
    category: 'vcs',
    importance: 'recommended',
    purpose: 'GitHub write access for branch → commit → PR → merge → rollback-tag.',
    enables: ['code application', 'push-to-main deploy trigger', 'rollback tag'],
    fallbackWhenMissing: 'Code application + push are blocked; proposals are produced but not committed.',
    verifyShape: true,
  },
  {
    name: 'GITHUB_REPO_URL',
    category: 'vcs',
    importance: 'recommended',
    purpose: 'Target repository the GitHub write lifecycle and Render watch.',
    enables: ['push-to-main deploy', 'PR lifecycle'],
    fallbackWhenMissing: 'GitHub write target is unknown; the commit/push lifecycle cannot run.',
  },
  {
    name: 'RENDER_API_KEY',
    category: 'deploy',
    importance: 'optional',
    purpose: 'Render API control for direct deploy + one-call rollback.',
    enables: ['direct deploy', 'one-call rollback', 'service env management'],
    fallbackWhenMissing: 'Push-to-main still auto-deploys via Render watch; direct deploy/rollback control is unavailable.',
    verifyShape: true,
  },
  {
    name: 'RENDER_SERVICE_ID',
    category: 'deploy',
    importance: 'optional',
    purpose: 'Render service identifier the API control targets.',
    enables: ['direct deploy', 'one-call rollback'],
    fallbackWhenMissing: 'Direct Render API control is unavailable; auto-deploy on push still works.',
  },
];

function present(env: EnvSnapshot, name: string): boolean {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Non-reversible shape verification for a token. Returns true when the value is
 * present, long enough, and contains no placeholder/instruction text. NEVER
 * returns or logs the value itself.
 */
function verifyTokenShape(env: EnvSnapshot, name: string): { verified: boolean; note: string | null } {
  const raw = env[name];
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { verified: false, note: 'not configured' };
  }
  const value = raw.trim();
  if (value.length < 16) {
    return { verified: false, note: 'configured but too short to be a real token (likely a placeholder)' };
  }
  const lowered = value.toLowerCase();
  if (PLACEHOLDER_FRAGMENTS.some((fragment) => lowered.includes(fragment))) {
    return { verified: false, note: 'configured but contains placeholder/instruction text, not a real token' };
  }
  return { verified: true, note: null };
}

function diagnosticFor(spec: CredentialSpec): string {
  const tag = spec.importance === 'required' ? 'REQUIRED' : spec.importance === 'recommended' ? 'RECOMMENDED' : 'OPTIONAL';
  return `[${tag}] ${spec.name} is not configured — unlocks: ${spec.enables.join(', ')}. Fallback: ${spec.fallbackWhenMissing}`;
}

/** Build the full credential readiness report from an env snapshot (never emits values). */
export function buildCredentialReadiness(env: EnvSnapshot = process.env): CredentialReadinessReport {
  const credentials: CredentialStatus[] = CREDENTIAL_SPECS.map((spec) => {
    const configured = present(env, spec.name);
    let verified: boolean | null = null;
    let verificationNote: string | null = null;
    if (spec.verifyShape) {
      const shape = verifyTokenShape(env, spec.name);
      verified = shape.verified;
      verificationNote = shape.note;
    }
    return {
      name: spec.name,
      category: spec.category,
      importance: spec.importance,
      purpose: spec.purpose,
      enables: spec.enables,
      configured,
      verified,
      verificationNote: configured ? verificationNote : null,
      fallback: configured ? null : spec.fallbackWhenMissing,
      diagnostic: configured ? null : diagnosticFor(spec),
    };
  });

  const configuredCount = credentials.filter((c) => c.configured).length;
  const requiredSpecs = credentials.filter((c) => c.importance === 'required');
  const requiredConfigured = requiredSpecs.filter((c) => c.configured).length;

  const byCategory = credentials.reduce<Record<CredentialCategory, { total: number; configured: number }>>(
    (acc, c) => {
      const bucket = acc[c.category] ?? { total: 0, configured: 0 };
      bucket.total += 1;
      if (c.configured) bucket.configured += 1;
      acc[c.category] = bucket;
      return acc;
    },
    { ai: { total: 0, configured: 0 }, database: { total: 0, configured: 0 }, storage: { total: 0, configured: 0 }, deploy: { total: 0, configured: 0 }, vcs: { total: 0, configured: 0 }, auth: { total: 0, configured: 0 } },
  );

  const deployment = buildDeploymentReadiness(env);

  const requiredAllPresent = requiredConfigured === requiredSpecs.length;
  const autonomyLevel: CredentialReadinessReport['autonomyLevel'] = !requiredAllPresent
    ? 'blocked'
    : deployment.deployPathAvailable
      ? 'full'
      : 'degraded';

  return {
    marker: IVX_CREDENTIAL_READINESS_MARKER,
    generatedAt: new Date().toISOString(),
    total: credentials.length,
    configured: configuredCount,
    missing: credentials.length - configuredCount,
    required: { total: requiredSpecs.length, configured: requiredConfigured, missing: requiredSpecs.length - requiredConfigured },
    byCategory,
    credentials,
    deployment,
    autonomyLevel,
    missingDiagnostics: credentials.filter((c) => !c.configured).map((c) => c.diagnostic ?? `${c.name} is not configured.`),
    secretValuesReturned: false,
  };
}

/** Deployment-token verification + safe fallback (never emits values). */
export function buildDeploymentReadiness(env: EnvSnapshot = process.env): DeploymentReadiness {
  const ownerTokenConfigured = present(env, 'IVX_OWNER_TOKEN');
  const ownerTokenVerified = ownerTokenConfigured && verifyTokenShape(env, 'IVX_OWNER_TOKEN').verified;
  const renderApiConfigured = present(env, 'RENDER_API_KEY') && present(env, 'RENDER_SERVICE_ID');
  const renderApiVerified = renderApiConfigured && verifyTokenShape(env, 'RENDER_API_KEY').verified;
  const githubPushConfigured = present(env, 'GITHUB_TOKEN') && present(env, 'GITHUB_REPO_URL');
  const deployPathAvailable = githubPushConfigured || renderApiConfigured;
  const directDeployControl = renderApiVerified;

  let blocker: string | null = null;
  if (!deployPathAvailable) {
    blocker = 'No deploy path: set GITHUB_TOKEN + GITHUB_REPO_URL (push-to-main auto-deploy) or RENDER_API_KEY + RENDER_SERVICE_ID (direct deploy).';
  } else if (!directDeployControl) {
    blocker = renderApiConfigured
      ? 'RENDER_API_KEY is configured but failed shape verification (placeholder/short) — direct deploy/rollback control is unavailable.'
      : 'Direct deploy/rollback control needs a verified RENDER_API_KEY + RENDER_SERVICE_ID; push-to-main auto-deploy still works.';
  }

  return {
    ownerTokenConfigured,
    ownerTokenVerified,
    renderApiConfigured,
    githubPushConfigured,
    deployPathAvailable,
    directDeployControl,
    blocker,
    safeFallback: deployPathAvailable
      ? 'Deploys via push-to-main → Render auto-deploy; direct API control used only when a verified Render token is present.'
      : 'No automated deploy path; IVX produces validated proposals for the owner to apply manually.',
  };
}

export type OwnerApprovalGateResult = {
  action: string;
  guarded: boolean;
  approved: boolean;
  ownerApprovalRequired: boolean;
  requiredCredentials: string[];
  missingCredentials: string[];
  blocker: string | null;
  reason: string;
};

/** The six guarded action categories and the credentials they need. */
const GUARDED_ACTIONS: Record<string, { requiredCredentials: string[]; label: string }> = {
  deploy_production: { requiredCredentials: ['GITHUB_TOKEN', 'GITHUB_REPO_URL'], label: 'deploy to production' },
  rollback_production: { requiredCredentials: ['RENDER_API_KEY', 'RENDER_SERVICE_ID'], label: 'roll back production' },
  modify_production_schema: { requiredCredentials: ['SUPABASE_SERVICE_ROLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL'], label: 'modify production database schema' },
  rotate_credentials: { requiredCredentials: [], label: 'change/rotate credentials' },
  external_publish: { requiredCredentials: ['GITHUB_TOKEN'], label: 'publish externally' },
  delete_data: { requiredCredentials: ['SUPABASE_SERVICE_ROLE_KEY'], label: 'delete production data' },
};

/**
 * Evaluate the owner-approval gate for a guarded action. A guarded action is
 * approved only when ownerApproved is true AND every required credential is
 * present. Unknown (ungated) actions are not guarded and pass through.
 */
export function evaluateOwnerApprovalGate(
  action: string,
  ownerApproved: boolean,
  env: EnvSnapshot = process.env,
): OwnerApprovalGateResult {
  const key = action.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const guard = GUARDED_ACTIONS[key];
  if (!guard) {
    return {
      action,
      guarded: false,
      approved: true,
      ownerApprovalRequired: false,
      requiredCredentials: [],
      missingCredentials: [],
      blocker: null,
      reason: `"${action}" is not a guarded action — no owner approval required.`,
    };
  }

  const missingCredentials = guard.requiredCredentials.filter((name) => !present(env, name));

  if (!ownerApproved) {
    return {
      action,
      guarded: true,
      approved: false,
      ownerApprovalRequired: true,
      requiredCredentials: guard.requiredCredentials,
      missingCredentials,
      blocker: `Owner approval required to ${guard.label}.`,
      reason: `"${action}" is guarded; set ownerApproved=true to authorize.`,
    };
  }

  if (missingCredentials.length > 0) {
    return {
      action,
      guarded: true,
      approved: false,
      ownerApprovalRequired: true,
      requiredCredentials: guard.requiredCredentials,
      missingCredentials,
      blocker: `Owner approved, but missing credential(s): ${missingCredentials.join(', ')}.`,
      reason: `"${action}" cannot proceed until the required credentials are configured.`,
    };
  }

  return {
    action,
    guarded: true,
    approved: true,
    ownerApprovalRequired: true,
    requiredCredentials: guard.requiredCredentials,
    missingCredentials: [],
    blocker: null,
    reason: `"${action}" is owner-approved and all required credentials are present.`,
  };
}

/** List the guarded action keys (for the status endpoint). */
export function listGuardedActions(): string[] {
  return Object.keys(GUARDED_ACTIONS);
}
