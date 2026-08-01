/**
 * IVX Owner Operations Layer (owner-only, non-developer).
 *
 * The owner is NOT a developer. This layer lets IVX complete owner operations
 * through tools + plain-English guidance instead of terminal commands. It is a
 * read-only composition layer over engines already shipped — the tool/credential
 * availability checker (BLOCK 35), the independence engine (BLOCK 43/47),
 * the operator handoff manifest, and the live connection probes (Supabase REST,
 * GitHub API, Render API) — plus three new non-developer surfaces:
 *
 *   1. Owner Credential Vault   — per-connection credential STATUS (present/missing),
 *                                 required permissions, plain-English fix steps.
 *                                 NEVER returns or logs a secret value.
 *   2. Connection probes        — a real, live "test connection" per connection.
 *   3. One-click action catalog — each safe owner action with what-it-does, risk,
 *                                 whether owner approval is required, and the
 *                                 rollback path — in plain English.
 *   4. Platform removal preflight   — verifies the connections the cutover needs and
 *                                 returns BLOCKED_MISSING_OWNER_CONNECTION (naming
 *                                 the exact missing connection) when not ready.
 *   5. Evidence report          — normalizes any operation result into the four
 *                                 owner-facing statuses with operation/trace ids.
 *
 * Everything is presence-only for secrets; values are never read, returned, or
 * logged. Pure helpers take an env snapshot so they are fully unit-testable.
 */
import { checkToolAvailability, type ToolAvailabilityReport } from './ivx-tool-availability';

export const IVX_OWNER_OPERATIONS_MARKER = 'ivx-owner-operations-2026-06-06';

type EnvSnapshot = Record<string, string | undefined>;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Owner-facing connection status — connected (probed ok) / configured (secrets present, not probed) / missing / invalid (probe rejected). */
export type ConnectionStatus = 'connected' | 'configured' | 'missing' | 'invalid';

/** Stable connection ids for the wizard cards. */
export type ConnectionId =
  | 'github'
  | 'render'
  | 'supabase'
  | 'aws'
  | 'domain'
  | 'ai_gateway'
  | 'model_3d'
  | 'crm_import';

export type OwnerConnectionCard = {
  id: ConnectionId;
  label: string;
  /** Plain-English description of what this connection powers. */
  purpose: string;
  status: ConnectionStatus;
  /** Env var NAMES this connection needs (presence-checked, never read for value). */
  requiredSecrets: string[];
  /** The subset of requiredSecrets that is missing/empty right now. */
  missingSecrets: string[];
  /** Optional secrets that improve the connection but are not required. */
  optionalSecrets: string[];
  /** Permissions/scopes the owner's token must have, in plain English. */
  requiredPermissions: string[];
  /** Plain-English, no-terminal fix steps the owner can follow. */
  fixInstructions: string[];
  /** Whether IVX can run a live "test connection" probe for this card. */
  testable: boolean;
  detail: string;
};

export type OwnerConnectionVault = {
  marker: string;
  generatedAt: string;
  connections: OwnerConnectionCard[];
  summary: {
    total: number;
    connectedOrConfigured: number;
    missing: number;
  };
  /** Connections whose secrets are missing — the owner's checklist. */
  missingConnections: ConnectionId[];
  /** True only when every connection has its required secrets present. */
  allConfigured: boolean;
  secretValuesReturned: false;
};

export type ConnectionTestResult = {
  marker: string;
  connection: ConnectionId;
  status: ConnectionStatus;
  /** Real HTTP status from the probe when applicable. */
  httpStatus: number | null;
  checkedAt: string;
  detail: string;
  /** Exact missing secret names when status === 'missing'. */
  missingSecrets: string[];
  secretValuesReturned: false;
};

export type OwnerActionRisk = 'safe' | 'low' | 'medium' | 'high';

/** The owner-approval categories that gate high-risk actions. */
export type OwnerApprovalCategory =
  | 'none'
  | 'production_deploy'
  | 'database_migration'
  | 'delete_data'
  | 'rotate_secrets'
  | 'external_outreach'
  | 'paid_api'
  | 'legal_compliance';

export type OneClickAction = {
  id: string;
  label: string;
  /** Plain-English description of exactly what happens when tapped. */
  whatHappens: string;
  riskLevel: OwnerActionRisk;
  requiresApproval: boolean;
  approvalCategory: OwnerApprovalCategory;
  /** Plain-English rollback path if something goes wrong. */
  rollbackPath: string;
  /** The owner-gated backing route the button drives. */
  backingRoute: string;
  /** Connection ids that must be configured before this action can run. */
  requiresConnections: ConnectionId[];
};

export type OwnerActionCatalog = {
  marker: string;
  generatedAt: string;
  actions: OneClickAction[];
};

/** Owner-facing operation status (matches the evidence-gate vocabulary). */
export type OperationStatus = 'VERIFIED' | 'BLOCKED' | 'FAILED' | 'OWNER_APPROVAL_REQUIRED';

export type OperationEvidenceReport = {
  marker: string;
  operationId: string;
  traceId: string;
  action: string;
  generatedAt: string;
  status: OperationStatus;
  filesChanged: string[];
  commitSha: string | null;
  testsRun: string[];
  deployId: string | null;
  healthResult: string | null;
  rollbackTarget: string | null;
  /** Plain-English blocker / owner action when not VERIFIED. */
  blocker: string | null;
  secretValuesReturned: false;
};

export type PlatformRemovalPreflight = {
  marker: string;
  generatedAt: string;
  ready: boolean;
  /** 'VERIFIED' when ready, else 'BLOCKED' with the exact missing connection. */
  status: 'VERIFIED' | 'BLOCKED_MISSING_OWNER_CONNECTION';
  /** The connections the cutover requires + whether each is satisfied. */
  requiredConnections: { connection: ConnectionId; label: string; satisfied: boolean; missing: string | null }[];
  /** Exact missing connections (empty when ready). */
  missingConnections: ConnectionId[];
  /** What the operator will do, in plain English. */
  steps: string[];
  /** Honest note about the in-sandbox constraint (BLOCK 47). */
  note: string;
};

export type OwnerOperationsDashboard = {
  marker: string;
  generatedAt: string;
  vault: OwnerConnectionVault;
  actions: OwnerActionCatalog;
  platformRemoval: PlatformRemovalPreflight;
  /** Plain-English readiness headline for the owner. */
  headline: string;
  secretValuesReturned: false;
};

function present(env: EnvSnapshot, name: string): boolean {
  const value = env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

function missingOf(env: EnvSnapshot, names: string[]): string[] {
  return names.filter((name) => !present(env, name));
}

function anyPresent(env: EnvSnapshot, names: string[]): boolean {
  return names.some((name) => present(env, name));
}

function nowIso(): string {
  return new Date().toISOString();
}

type ConnectionSpec = {
  id: ConnectionId;
  label: string;
  purpose: string;
  requiredSecrets: string[];
  /** When true, the card is satisfied if ANY required secret is present (used for OR-style providers). */
  anyOfRequired?: boolean;
  optionalSecrets: string[];
  requiredPermissions: string[];
  fixInstructions: string[];
  testable: boolean;
  /** Always-available in-process connection (e.g. the CRM store) needs no secrets. */
  alwaysConfigured?: boolean;
};

const CONNECTION_SPECS: ConnectionSpec[] = [
  {
    id: 'github',
    label: 'GitHub',
    purpose: 'Where IVX saves and ships every code change for your app.',
    requiredSecrets: ['GITHUB_TOKEN', 'GITHUB_REPO_URL'],
    optionalSecrets: [],
    requiredPermissions: ['Read & write access to your repository contents', 'Workflow permission (to trigger builds)'],
    fixInstructions: [
      'On GitHub, open Settings → Developer settings → Personal access tokens.',
      'Create a token with repository read/write + workflow permission.',
      'Send the token to IVX through the secure Variables screen (never paste it into chat).',
      'Add your repository web address as the GitHub repo URL.',
    ],
    testable: true,
  },
  {
    id: 'render',
    label: 'Render (hosting)',
    purpose: 'The server that runs IVX in production and handles deploys + rollbacks.',
    requiredSecrets: ['RENDER_API_KEY', 'RENDER_SERVICE_ID'],
    optionalSecrets: [],
    requiredPermissions: ['Permission to read your service and trigger deploys/rollbacks'],
    fixInstructions: [
      'In the Render dashboard, open Account Settings → API Keys and create a key.',
      'Open your IVX service and copy its Service ID (starts with "srv-").',
      'Save both in the secure Variables screen.',
    ],
    testable: true,
  },
  {
    id: 'supabase',
    label: 'Supabase (database)',
    purpose: 'Your database — investors, deals, and all saved records live here.',
    requiredSecrets: ['SUPABASE_SERVICE_ROLE_KEY', 'EXPO_PUBLIC_SUPABASE_URL'],
    optionalSecrets: ['SUPABASE_MANAGEMENT_API_TOKEN'],
    requiredPermissions: ['Service-role key (full database access, server-side only)'],
    fixInstructions: [
      'In Supabase, open Project Settings → API.',
      'Copy the Project URL and the service_role secret key.',
      'Save both in the secure Variables screen — the key is used server-side only.',
    ],
    testable: true,
  },
  {
    id: 'aws',
    label: 'AWS / CloudFront',
    purpose: 'File storage and the content network that serves your landing page assets.',
    requiredSecrets: ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'],
    optionalSecrets: ['S3_BUCKET_NAME', 'CLOUDFRONT_DISTRIBUTION_ID'],
    requiredPermissions: ['Read/write access to your S3 bucket', 'CloudFront invalidation (optional)'],
    fixInstructions: [
      'In the AWS console, open IAM → Users → Security credentials.',
      'Create an access key with S3 read/write permission.',
      'Save the access key id, secret, and region in the secure Variables screen.',
    ],
    testable: false,
  },
  {
    id: 'domain',
    label: 'Domain / Live site',
    purpose: 'Your public website address and its health check.',
    requiredSecrets: ['PRODUCTION_BASE_URL'],
    optionalSecrets: ['CLOUDFRONT_DISTRIBUTION_ID'],
    requiredPermissions: ['A reachable production URL'],
    fixInstructions: [
      'Confirm your live site address (for example https://api.ivxholding.com).',
      'Save it as the production base URL in the secure Variables screen.',
    ],
    testable: true,
  },
  {
    id: 'ai_gateway',
    label: 'AI Gateway',
    purpose: 'Powers IVX reasoning, chat answers, and document analysis.',
    requiredSecrets: ['IVX_AI_GATEWAY_KEY'],
    optionalSecrets: ['OPENAI_API_KEY'],
    requiredPermissions: ['A valid AI gateway / model provider key'],
    fixInstructions: [
      'Get your AI gateway or OpenAI key from the provider dashboard.',
      'Save it in the secure Variables screen.',
    ],
    testable: false,
  },
  {
    id: 'model_3d',
    label: '3D / Media Provider',
    purpose: 'Generates 3D renders and product visuals (optional).',
    requiredSecrets: ['MESHY_API_KEY', 'TRIPO_API_KEY'],
    anyOfRequired: true,
    optionalSecrets: [],
    requiredPermissions: ['A Meshy or Tripo API key (either works)'],
    fixInstructions: [
      'Create an API key at Meshy or Tripo.',
      'Save it in the secure Variables screen — only one provider is needed.',
    ],
    testable: false,
  },
  {
    id: 'crm_import',
    label: 'CRM Import',
    purpose: 'Loads your real investor/buyer contacts into IVX.',
    requiredSecrets: [],
    optionalSecrets: [],
    requiredPermissions: ['No external credentials — runs inside IVX'],
    fixInstructions: [
      'Open the Import screen and paste your investor/buyer list (CSV or Excel export).',
      'IVX maps and de-dupes the rows and shows an exact import receipt.',
    ],
    testable: false,
    alwaysConfigured: true,
  },
];

function specStatus(spec: ConnectionSpec, env: EnvSnapshot): { status: ConnectionStatus; missing: string[] } {
  if (spec.alwaysConfigured) return { status: 'configured', missing: [] };
  if (spec.anyOfRequired) {
    const satisfied = anyPresent(env, spec.requiredSecrets);
    return satisfied
      ? { status: 'configured', missing: [] }
      : { status: 'missing', missing: spec.requiredSecrets };
  }
  const missing = missingOf(env, spec.requiredSecrets);
  return missing.length === 0 ? { status: 'configured', missing: [] } : { status: 'missing', missing };
}

/**
 * Build the owner credential vault from an env snapshot. Presence-only; never
 * returns or logs a secret value.
 */
export function buildOwnerConnectionVault(env: EnvSnapshot = process.env): OwnerConnectionVault {
  const connections: OwnerConnectionCard[] = CONNECTION_SPECS.map((spec) => {
    const { status, missing } = specStatus(spec, env);
    const detail =
      status === 'configured'
        ? `${spec.label} is configured. Tap "Test connection" to confirm it is live.`
        : `${spec.label} is missing ${missing.length} required value(s): ${missing.join(', ')}.`;
    return {
      id: spec.id,
      label: spec.label,
      purpose: spec.purpose,
      status,
      requiredSecrets: spec.requiredSecrets,
      missingSecrets: missing,
      optionalSecrets: spec.optionalSecrets,
      requiredPermissions: spec.requiredPermissions,
      fixInstructions: spec.fixInstructions,
      testable: spec.testable,
      detail,
    };
  });

  const missingConnections = connections.filter((c) => c.status === 'missing').map((c) => c.id);
  const configured = connections.filter((c) => c.status !== 'missing').length;

  return {
    marker: IVX_OWNER_OPERATIONS_MARKER,
    generatedAt: nowIso(),
    connections,
    summary: {
      total: connections.length,
      connectedOrConfigured: configured,
      missing: missingConnections.length,
    },
    missingConnections,
    allConfigured: missingConnections.length === 0,
    secretValuesReturned: false,
  };
}

/** Find a connection spec by id. */
function findSpec(id: ConnectionId): ConnectionSpec | undefined {
  return CONNECTION_SPECS.find((s) => s.id === id);
}

const PROBE_TIMEOUT_MS = 9000;

async function probe(fetchImpl: FetchLike, url: string, init: RequestInit): Promise<{ httpStatus: number | null; error: string | null }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, { ...init, signal: controller.signal });
    return { httpStatus: response.status, error: null };
  } catch (error) {
    return { httpStatus: null, error: error instanceof Error ? error.message : 'network error' };
  } finally {
    clearTimeout(timeout);
  }
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Run a REAL live connection test for a single connection. Never returns the
 * secret value. Always resolves (never throws) — failures become honest status.
 */
export async function testOwnerConnection(
  connection: ConnectionId,
  env: EnvSnapshot = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<ConnectionTestResult> {
  const spec = findSpec(connection);
  const base = {
    marker: IVX_OWNER_OPERATIONS_MARKER,
    connection,
    checkedAt: nowIso(),
    secretValuesReturned: false as const,
  };
  if (!spec) {
    return { ...base, status: 'missing', httpStatus: null, detail: `Unknown connection "${connection}".`, missingSecrets: [] };
  }

  const { status: cfgStatus, missing } = specStatus(spec, env);
  if (cfgStatus === 'missing') {
    return {
      ...base,
      status: 'missing',
      httpStatus: null,
      detail: `${spec.label} is not configured — missing ${missing.join(', ')}.`,
      missingSecrets: missing,
    };
  }

  if (!spec.testable) {
    return {
      ...base,
      status: 'configured',
      httpStatus: null,
      detail: `${spec.label} secrets are present. A live probe is not available for this provider; configuration looks complete.`,
      missingSecrets: [],
    };
  }

  // Live probes per provider.
  if (connection === 'github') {
    const token = readTrimmed(env.GITHUB_TOKEN);
    const { httpStatus, error } = await probe(fetchImpl, 'https://api.github.com/user', {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'ivx-owner-operations' },
    });
    return resolveProbe(base, spec, httpStatus, error, [401, 403]);
  }

  if (connection === 'render') {
    const key = readTrimmed(env.RENDER_API_KEY);
    const serviceId = readTrimmed(env.RENDER_SERVICE_ID);
    const { httpStatus, error } = await probe(fetchImpl, `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    return resolveProbe(base, spec, httpStatus, error, [401, 403]);
  }

  if (connection === 'supabase') {
    const url = readTrimmed(env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const key = readTrimmed(env.SUPABASE_SERVICE_ROLE_KEY);
    const { httpStatus, error } = await probe(fetchImpl, `${url}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: 'application/json' },
    });
    return resolveProbe(base, spec, httpStatus, error, [401, 403]);
  }

  if (connection === 'domain') {
    const url = readTrimmed(env.PRODUCTION_BASE_URL).replace(/\/+$/, '');
    const { httpStatus, error } = await probe(fetchImpl, `${url}/health`, { method: 'GET', headers: { Accept: 'application/json' } });
    // Domain probe: any HTTP response means the site is reachable; only treat network failure as invalid.
    if (error || httpStatus === null) {
      return { ...base, status: 'invalid', httpStatus: null, detail: `Could not reach ${url}/health: ${error ?? 'no response'}.`, missingSecrets: [] };
    }
    return { ...base, status: 'connected', httpStatus, detail: `Live site reachable (HTTP ${httpStatus} from /health).`, missingSecrets: [] };
  }

  return { ...base, status: 'configured', httpStatus: null, detail: `${spec.label} secrets present.`, missingSecrets: [] };
}

function resolveProbe(
  base: { marker: string; connection: ConnectionId; checkedAt: string; secretValuesReturned: false },
  spec: ConnectionSpec,
  httpStatus: number | null,
  error: string | null,
  authRejectCodes: number[],
): ConnectionTestResult {
  if (error || httpStatus === null) {
    return { ...base, status: 'invalid', httpStatus: null, detail: `${spec.label} unreachable: ${error ?? 'no response'}.`, missingSecrets: [] };
  }
  if (authRejectCodes.includes(httpStatus)) {
    return { ...base, status: 'invalid', httpStatus, detail: `${spec.label} rejected the credentials (HTTP ${httpStatus}). Check the token/key and its permissions.`, missingSecrets: [] };
  }
  if (httpStatus >= 200 && httpStatus < 500) {
    return { ...base, status: 'connected', httpStatus, detail: `${spec.label} connected (HTTP ${httpStatus}).`, missingSecrets: [] };
  }
  return { ...base, status: 'invalid', httpStatus, detail: `${spec.label} returned HTTP ${httpStatus}.`, missingSecrets: [] };
}

/**
 * Build the one-click action catalog. Static + deterministic; each action
 * documents what happens, its risk, approval requirement, and rollback path.
 */
export function buildOwnerActionCatalog(): OwnerActionCatalog {
  const actions: OneClickAction[] = [
    {
      id: 'test_all_systems',
      label: 'Test all systems',
      whatHappens: 'IVX checks every connection (GitHub, Render, Supabase, the database, the live site, and the AI gateway) and reports which are healthy.',
      riskLevel: 'safe',
      requiresApproval: false,
      approvalCategory: 'none',
      rollbackPath: 'Nothing changes — this is read-only.',
      backingRoute: 'POST /api/ivx/owner-operations/connections/test',
      requiresConnections: [],
    },
    {
      id: 'verify_production',
      label: 'Verify production',
      whatHappens: 'IVX reads the live site health and recent failure rate to confirm production is healthy.',
      riskLevel: 'safe',
      requiresApproval: false,
      approvalCategory: 'none',
      rollbackPath: 'Nothing changes — this is read-only.',
      backingRoute: 'GET /api/ivx/autonomous-core/dashboard',
      requiresConnections: ['domain'],
    },
    {
      id: 'fix_crash',
      label: 'Fix crash',
      whatHappens: 'IVX finds the highest-priority crash or bug, proposes a safe patch, runs tests, and reports the result. Non-destructive fixes run automatically.',
      riskLevel: 'medium',
      requiresApproval: false,
      approvalCategory: 'none',
      rollbackPath: 'IVX can revert the change with one tap; production stays on the last healthy version if a fix fails its tests.',
      backingRoute: 'POST /api/ivx/autonomous-mode/run',
      requiresConnections: ['github'],
    },
    {
      id: 'deploy_update',
      label: 'Deploy update',
      whatHappens: 'IVX ships the latest verified changes to your live site after all checks pass.',
      riskLevel: 'high',
      requiresApproval: true,
      approvalCategory: 'production_deploy',
      rollbackPath: 'One-tap rollback to the previous healthy deploy; IVX auto-rolls-back if health fails after deploy.',
      backingRoute: 'POST /api/ivx/developer-deploy/action',
      requiresConnections: ['github', 'render'],
    },
    {
      id: 'rollback_last_deploy',
      label: 'Rollback last deploy',
      whatHappens: 'IVX restores your live site to the previous healthy version.',
      riskLevel: 'high',
      requiresApproval: true,
      approvalCategory: 'production_deploy',
      rollbackPath: 'You can re-deploy the newer version again at any time.',
      backingRoute: 'POST /api/ivx/developer-deploy/action',
      requiresConnections: ['render'],
    },
    {
      id: 'remove_platform',
      label: 'Remove external platform management',
      whatHappens: 'IVX verifies your GitHub + Render connections, then runs the prepared cutover that removes the external platform build dependency on your own repository.',
      riskLevel: 'high',
      requiresApproval: true,
      approvalCategory: 'production_deploy',
      rollbackPath: 'The cutover is committed as one change you can revert in GitHub; your live site keeps running throughout.',
      backingRoute: 'GET /api/ivx/owner-operations/removal-preflight',
      requiresConnections: ['github', 'render'],
    },
    {
      id: 'import_contacts',
      label: 'Import contacts',
      whatHappens: 'IVX loads your real investor/buyer list into the CRM and shows an exact receipt (imported / duplicates / invalid).',
      riskLevel: 'low',
      requiresApproval: false,
      approvalCategory: 'none',
      rollbackPath: 'Imported contacts can be deleted individually; duplicates are skipped automatically.',
      backingRoute: 'POST /api/ivx/investors/import',
      requiresConnections: ['crm_import'],
    },
    {
      id: 'generate_proof_report',
      label: 'Generate proof report',
      whatHappens: 'IVX assembles an evidence report for the last operation — files changed, commit, tests, deploy id, health, and rollback target.',
      riskLevel: 'safe',
      requiresApproval: false,
      approvalCategory: 'none',
      rollbackPath: 'Nothing changes — this is read-only.',
      backingRoute: 'GET /api/ivx/execution-trace',
      requiresConnections: [],
    },
  ];

  return { marker: IVX_OWNER_OPERATIONS_MARKER, generatedAt: nowIso(), actions };
}

const CONNECTION_LABELS: Record<ConnectionId, string> = {
  github: 'GitHub',
  render: 'Render (hosting)',
  supabase: 'Supabase (database)',
  aws: 'AWS / CloudFront',
  domain: 'Domain / Live site',
  ai_gateway: 'AI Gateway',
  model_3d: '3D / Media Provider',
  crm_import: 'CRM Import',
};

/**
 * Build the Platform removal preflight. The cutover needs GitHub + Render. When a
 * required connection is missing it returns BLOCKED_MISSING_OWNER_CONNECTION
 * naming the exact missing connection — never a generic failure.
 */
export function buildPlatformRemovalPreflight(vault: OwnerConnectionVault): PlatformRemovalPreflight {
  const required: ConnectionId[] = ['github', 'render'];
  const requiredConnections = required.map((id) => {
    const card = vault.connections.find((c) => c.id === id);
    const satisfied = Boolean(card && card.status !== 'missing');
    return {
      connection: id,
      label: CONNECTION_LABELS[id],
      satisfied,
      missing: satisfied ? null : (card?.missingSecrets.join(', ') || 'required secrets'),
    };
  });

  const missingConnections = requiredConnections.filter((c) => !c.satisfied).map((c) => c.connection);
  const ready = missingConnections.length === 0;

  return {
    marker: IVX_OWNER_OPERATIONS_MARKER,
    generatedAt: nowIso(),
    ready,
    status: ready ? 'VERIFIED' : 'BLOCKED_MISSING_OWNER_CONNECTION',
    requiredConnections,
    missingConnections,
    steps: [
      'Verify the GitHub and Render connections are healthy.',
      'Back up the current repository state (the cutover is one revertible commit).',
      'Run the prepared cutover on your own GitHub/Render checkout: it removes the Rork toolkit, the Rork build wrapper, and the Rork config files in one pass.',
      'Commit + push to your main branch; Render auto-deploys the change.',
      'IVX verifies the live site health and confirms no Rork references remain.',
    ],
    note: 'The cutover is prepared and ready, but it cannot run inside the Rork-managed preview (it would be auto-reverted and could break the live preview). It runs on your own GitHub/Render checkout — IVX guides each step and keeps your live site online throughout.',
  };
}

let operationCounter = 0;

function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Inputs the evidence-report assembler accepts (all optional except action + status). */
export type OperationEvidenceInput = {
  action: string;
  status: OperationStatus;
  filesChanged?: string[];
  commitSha?: string | null;
  testsRun?: string[];
  deployId?: string | null;
  healthResult?: string | null;
  rollbackTarget?: string | null;
  blocker?: string | null;
  traceId?: string | null;
};

/**
 * Normalize any operation result into the owner-facing evidence report with a
 * stable operation id + trace id. Pure + deterministic apart from id generation.
 */
export function buildOperationEvidenceReport(input: OperationEvidenceInput): OperationEvidenceReport {
  operationCounter += 1;
  const operationId = `op_${Date.now().toString(36)}_${operationCounter}_${randomSuffix()}`;
  const traceId = input.traceId && input.traceId.trim() ? input.traceId.trim() : `trace_${randomSuffix()}`;
  return {
    marker: IVX_OWNER_OPERATIONS_MARKER,
    operationId,
    traceId,
    action: input.action,
    generatedAt: nowIso(),
    status: input.status,
    filesChanged: input.filesChanged ?? [],
    commitSha: input.commitSha ?? null,
    testsRun: input.testsRun ?? [],
    deployId: input.deployId ?? null,
    healthResult: input.healthResult ?? null,
    rollbackTarget: input.rollbackTarget ?? null,
    blocker: input.status === 'VERIFIED' ? null : (input.blocker ?? null),
    secretValuesReturned: false,
  };
}

function buildHeadline(vault: OwnerConnectionVault, rork: PlatformRemovalPreflight): string {
  if (vault.allConfigured) {
    return 'All owner connections are configured. IVX can run every owner operation; tap "Test all systems" to confirm each is live.';
  }
  const missing = vault.missingConnections.map((id) => CONNECTION_LABELS[id]).join(', ');
  const rorkNote = rork.ready ? '' : ' Platform removal is blocked until GitHub + Render are connected.';
  return `${vault.summary.connectedOrConfigured} of ${vault.summary.total} connections are configured. Add the missing connection(s) to unlock every operation: ${missing}.${rorkNote}`;
}

/**
 * Build the full owner-operations dashboard from an env snapshot. Read-only,
 * presence-only; never returns a secret value. Tool availability is included so
 * the senior-developer surface can reuse the same signals.
 */
export function buildOwnerOperationsDashboard(
  env: EnvSnapshot = process.env,
): OwnerOperationsDashboard & { toolAvailability: ToolAvailabilityReport } {
  const vault = buildOwnerConnectionVault(env);
  const actions = buildOwnerActionCatalog();
  const platformRemoval = buildPlatformRemovalPreflight(vault);
  const toolAvailability = checkToolAvailability(env);
  return {
    marker: IVX_OWNER_OPERATIONS_MARKER,
    generatedAt: nowIso(),
    vault,
    actions,
    platformRemoval,
    headline: buildHeadline(vault, platformRemoval),
    toolAvailability,
    secretValuesReturned: false,
  };
}
