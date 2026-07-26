/**
 * IVX Owner Operations Layer (owner-only, non-developer).
 *
 * The owner is NOT a developer. This layer lets IVX complete owner operations
 * through tools + plain-English guidance instead of terminal commands. It is a
 * read-only composition layer over engines already shipped — the tool/credential
 * availability checker (BLOCK 35), the Rork-independence engine (BLOCK 43/47),
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
 *   4. Rork-removal preflight   — verifies the connections the cutover needs and
 *                                 returns BLOCKED_MISSING_OWNER_CONNECTION (naming
 *                                 the exact missing connection) when not ready.
 *   5. Evidence report          — normalizes any operation result into the four
 *                                 owner-facing statuses with operation/trace ids.
 *
 * Everything is presence-only for secrets; values are never read, returned, or
 * logged. Pure helpers take an env snapshot so they are fully unit-testable.
 */
import { checkToolAvailability } from './ivx-tool-availability';
export const IVX_OWNER_OPERATIONS_MARKER = 'ivx-owner-operations-2026-06-06';
function present(env, name) {
    const value = env[name];
    return typeof value === 'string' && value.trim().length > 0;
}
function missingOf(env, names) {
    return names.filter((name) => !present(env, name));
}
function anyPresent(env, names) {
    return names.some((name) => present(env, name));
}
function nowIso() {
    return new Date().toISOString();
}
const CONNECTION_SPECS = [
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
        requiredSecrets: ['AI_GATEWAY_API_KEY'],
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
function specStatus(spec, env) {
    if (spec.alwaysConfigured)
        return { status: 'configured', missing: [] };
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
export function buildOwnerConnectionVault(env = process.env) {
    const connections = CONNECTION_SPECS.map((spec) => {
        const { status, missing } = specStatus(spec, env);
        const detail = status === 'configured'
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
function findSpec(id) {
    return CONNECTION_SPECS.find((s) => s.id === id);
}
const PROBE_TIMEOUT_MS = 9000;
async function probe(fetchImpl, url, init) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        return { httpStatus: response.status, error: null };
    }
    catch (error) {
        return { httpStatus: null, error: error instanceof Error ? error.message : 'network error' };
    }
    finally {
        clearTimeout(timeout);
    }
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
/**
 * Run a REAL live connection test for a single connection. Never returns the
 * secret value. Always resolves (never throws) — failures become honest status.
 */
export async function testOwnerConnection(connection, env = process.env, fetchImpl = fetch) {
    const spec = findSpec(connection);
    const base = {
        marker: IVX_OWNER_OPERATIONS_MARKER,
        connection,
        checkedAt: nowIso(),
        secretValuesReturned: false,
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
function resolveProbe(base, spec, httpStatus, error, authRejectCodes) {
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
export function buildOwnerActionCatalog() {
    const actions = [
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
            id: 'remove_rork',
            label: 'Remove Rork management',
            whatHappens: 'IVX verifies your GitHub + Render connections, then runs the prepared cutover that removes the Rork build dependency on your own repository.',
            riskLevel: 'high',
            requiresApproval: true,
            approvalCategory: 'production_deploy',
            rollbackPath: 'The cutover is committed as one change you can revert in GitHub; your live site keeps running throughout.',
            backingRoute: 'GET /api/ivx/owner-operations/rork-removal/preflight',
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
const CONNECTION_LABELS = {
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
 * Build the Rork-removal preflight. The cutover needs GitHub + Render. When a
 * required connection is missing it returns BLOCKED_MISSING_OWNER_CONNECTION
 * naming the exact missing connection — never a generic failure.
 */
export function buildRorkRemovalPreflight(vault) {
    const required = ['github', 'render'];
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
function randomSuffix() {
    return Math.random().toString(36).slice(2, 10);
}
/**
 * Normalize any operation result into the owner-facing evidence report with a
 * stable operation id + trace id. Pure + deterministic apart from id generation.
 */
export function buildOperationEvidenceReport(input) {
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
function buildHeadline(vault, rork) {
    if (vault.allConfigured) {
        return 'All owner connections are configured. IVX can run every owner operation; tap "Test all systems" to confirm each is live.';
    }
    const missing = vault.missingConnections.map((id) => CONNECTION_LABELS[id]).join(', ');
    const rorkNote = rork.ready ? '' : ' Rork removal is blocked until GitHub + Render are connected.';
    return `${vault.summary.connectedOrConfigured} of ${vault.summary.total} connections are configured. Add the missing connection(s) to unlock every operation: ${missing}.${rorkNote}`;
}
/**
 * Build the full owner-operations dashboard from an env snapshot. Read-only,
 * presence-only; never returns a secret value. Tool availability is included so
 * the senior-developer surface can reuse the same signals.
 */
export function buildOwnerOperationsDashboard(env = process.env) {
    const vault = buildOwnerConnectionVault(env);
    const actions = buildOwnerActionCatalog();
    const rorkRemoval = buildRorkRemovalPreflight(vault);
    const toolAvailability = checkToolAvailability(env);
    return {
        marker: IVX_OWNER_OPERATIONS_MARKER,
        generatedAt: nowIso(),
        vault,
        actions,
        rorkRemoval,
        headline: buildHeadline(vault, rorkRemoval),
        toolAvailability,
        secretValuesReturned: false,
    };
}
