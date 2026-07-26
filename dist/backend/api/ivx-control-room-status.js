import { inspectSupabaseRls, inspectSupabaseTables } from './ivx-supabase-inspection';
import { resolveOwnerTables } from './ivx-owner-ai';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { executeIVXAIBrainTool, listIVXAIBrainTools } from '../services/ivx-ai-brain-tool-executor';
const REQUIRED_ENV_NAMES = [
    'JWT_SECRET',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'AI_GATEWAY_API_KEY',
    'GITHUB_REPO_URL',
    'EXPO_PUBLIC_API_BASE_URL',
    'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
    'EXPO_PUBLIC_APP_URL',
];
function nowIso() {
    return new Date().toISOString();
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readEnv(name) {
    return readTrimmed(process.env[name]);
}
function missingEnv(names) {
    return names.filter((name) => !readEnv(name));
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function safeError(error) {
    return error instanceof Error ? error.message : String(error);
}
async function capture(callback) {
    try {
        return { ok: true, value: await callback() };
    }
    catch (error) {
        return { ok: false, error: safeError(error) };
    }
}
async function runBrainTool(tool, input = {}) {
    return await executeIVXAIBrainTool({ tool, input });
}
function toolStatus(result, verifiedDetail) {
    if (result.missingEnvNames.length > 0) {
        return 'missing_access';
    }
    return result.ok ? (verifiedDetail ? 'verified' : 'connected') : 'not_verified';
}
function buildItem(id, label, status, detail, missingCredentialNames = []) {
    return {
        id,
        label,
        status,
        detail,
        ...(missingCredentialNames.length > 0 ? { missingCredentialNames } : {}),
    };
}
async function probeStorage() {
    const missing = missingEnv(['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    if (missing.length > 0) {
        return { ok: false, detail: 'Supabase storage admin read is optional and not connected with minimum read-only credentials.', missing: [] };
    }
    const url = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
    const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    const response = await fetch(`${url}/storage/v1/bucket`, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });
    if (!response.ok) {
        return { ok: false, detail: `Storage bucket check returned status ${response.status}.`, missing: [] };
    }
    const payload = await response.json().catch(() => []);
    const bucketCount = Array.isArray(payload) ? payload.length : 0;
    return { ok: true, detail: `${bucketCount} storage bucket(s) readable through the owner backend.`, missing: [] };
}
async function probeAuth() {
    const missing = missingEnv(['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']);
    if (missing.length > 0) {
        return { ok: false, detail: 'Supabase auth admin read is optional and not connected with minimum read-only credentials.', missing: [] };
    }
    const url = readEnv('EXPO_PUBLIC_SUPABASE_URL').replace(/\/+$/, '');
    const serviceKey = readEnv('SUPABASE_SERVICE_ROLE_KEY');
    const response = await fetch(`${url}/auth/v1/admin/users?per_page=1`, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
        },
    });
    if (!response.ok) {
        return { ok: false, detail: `Auth admin check returned status ${response.status}.`, missing: [] };
    }
    return { ok: true, detail: 'Owner backend can reach Supabase auth admin read path.', missing: [] };
}
function extractEnvMissing(result) {
    const output = record(result.output);
    const missing = output.missing;
    return Array.isArray(missing) ? missing.map((item) => readTrimmed(item)).filter(Boolean) : result.missingEnvNames;
}
function statusFromDnsTls(result) {
    if (!result.ok) {
        return { status: 'not_verified', detail: result.error ?? 'DNS/TLS check did not complete.' };
    }
    const output = record(result.output);
    const dns = record(output.dns);
    const tls = record(output.tls);
    const resolvable = dns.resolvable === true;
    const authorized = tls.authorized === true;
    const domain = readTrimmed(output.domain) || 'api.ivxholding.com';
    if (resolvable && authorized) {
        return { status: 'verified', detail: `${domain} resolves and TLS is authorized.` };
    }
    return {
        status: resolvable ? 'not_verified' : 'not_connected',
        detail: `${domain}: DNS ${resolvable ? 'resolves' : 'not connected'}; TLS ${authorized ? 'authorized' : readTrimmed(tls.authorizationError) || readTrimmed(tls.error) || 'not verified'}.`,
    };
}
async function buildControlRoomItems(ownerContext) {
    const [tablesResult, rlsResult, storageResult, authResult, envResult, minimumAccessResult, developerDeployResult, githubResult, apiDnsTlsResult, chatDnsTlsResult, deploymentResult, awsResult, iamResult, projectRegistryResult, surfaceHealthResult, codeRepoResult, ownerReadinessResult] = await Promise.all([
        capture(async () => await inspectSupabaseTables('public', null, 200)),
        capture(async () => await inspectSupabaseRls('public', null, 200)),
        capture(probeStorage),
        capture(probeAuth),
        runBrainTool('environment_checklist'),
        runBrainTool('minimum_access_plan'),
        runBrainTool('developer_deploy_control_status'),
        runBrainTool('github_repo_status'),
        runBrainTool('dns_tls_check', { domain: 'api.ivxholding.com' }),
        runBrainTool('dns_tls_check', { domain: 'chat.ivxholding.com' }),
        runBrainTool('deployment_health_check'),
        runBrainTool('aws_identity_check'),
        runBrainTool('iam_readiness_check'),
        runBrainTool('project_registry'),
        runBrainTool('project_surface_health'),
        runBrainTool('code_repo_control_status'),
        runBrainTool('owner_control_readiness_report'),
    ]);
    const ownerTables = await capture(async () => await resolveOwnerTables(ownerContext.client));
    const items = [];
    const projectRegistryOutput = record(projectRegistryResult.output);
    const surfaceHealthOutput = record(surfaceHealthResult.output);
    const codeRepoOutput = record(codeRepoResult.output);
    const ownerReadinessOutput = record(ownerReadinessResult.output);
    const minimumAccessOutput = record(minimumAccessResult.output);
    const developerDeployOutput = record(developerDeployResult.output);
    items.push(buildItem('multi-app-registry', 'Multi-app/project control structure', projectRegistryResult.ok ? 'available' : 'not_verified', projectRegistryResult.ok ? `Registry contains ${String(projectRegistryOutput.projectCount ?? 'not verified')} owner-controlled surface(s).` : projectRegistryResult.error ?? 'Project registry not verified.', projectRegistryResult.missingEnvNames));
    items.push(buildItem('landing-app-surface-health', 'Landing page/app/future-app health', surfaceHealthResult.ok && readTrimmed(surfaceHealthOutput.status) === 'verified' ? 'verified' : surfaceHealthResult.missingEnvNames.length > 0 ? 'missing_access' : 'not_verified', surfaceHealthResult.ok ? `Surface health status: ${readTrimmed(surfaceHealthOutput.status) || 'not verified'}.` : surfaceHealthResult.error ?? 'Surface health not verified.', surfaceHealthResult.missingEnvNames));
    items.push(buildItem('code-repo-control', 'Code/repo control readiness', codeRepoResult.ok && readTrimmed(codeRepoOutput.status) === 'verified' ? 'verified' : codeRepoResult.missingEnvNames.length > 0 ? 'missing_access' : 'not_verified', codeRepoResult.ok ? `Repo control status: ${readTrimmed(codeRepoOutput.status) || 'not verified'}; branch ${readTrimmed(codeRepoOutput.branch) || 'not verified'}.` : codeRepoResult.error ?? 'Code/repo control not verified.', codeRepoResult.missingEnvNames));
    items.push(buildItem('developer-deploy-control', 'Owner AI developer/deploy control', developerDeployResult.ok && readTrimmed(developerDeployOutput.status) === 'verified' ? 'verified' : developerDeployResult.missingEnvNames.length > 0 ? 'missing_access' : 'not_verified', developerDeployResult.ok ? `Owner-approved deploy control: ${readTrimmed(developerDeployOutput.status) || 'not verified'}; route /api/ivx/developer-deploy/action.` : developerDeployResult.error ?? 'Developer/deploy control not verified.', developerDeployResult.missingEnvNames));
    const requestedCredentialNames = Array.isArray(developerDeployOutput.requestedCredentialNames)
        ? developerDeployOutput.requestedCredentialNames.map((item) => readTrimmed(item)).filter(Boolean)
        : [];
    const requestedCredentialMissingNames = Array.isArray(developerDeployOutput.requestedCredentialMissingNames)
        ? developerDeployOutput.requestedCredentialMissingNames.map((item) => readTrimmed(item)).filter(Boolean)
        : developerDeployResult.missingEnvNames;
    items.push(buildItem('production-credential-handoff', 'Production credential handoff', requestedCredentialMissingNames.length === 0 ? 'verified' : 'missing_access', requestedCredentialMissingNames.length === 0
        ? `${requestedCredentialNames.length} requested backend runtime name(s) are present. Secret values are never returned.`
        : `${requestedCredentialMissingNames.length}/${requestedCredentialNames.length || requestedCredentialMissingNames.length} requested backend runtime name(s) are missing.`, requestedCredentialMissingNames));
    const supabaseRuntimeMissing = missingEnv(['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_ANON_KEY']);
    items.push(buildItem('supabase-status', 'Supabase status', supabaseRuntimeMissing.length === 0 && (tablesResult.ok || rlsResult.ok) ? 'verified' : supabaseRuntimeMissing.length > 0 ? 'missing_access' : 'not_verified', tablesResult.ok || rlsResult.ok ? 'Supabase catalog checks reached the configured project.' : 'Supabase catalog checks are not verified.', supabaseRuntimeMissing));
    items.push(buildItem('supabase-tables', 'Supabase tables', tablesResult.ok ? 'verified' : 'not_verified', tablesResult.ok ? `${tablesResult.value.length} table/relation row(s) visible to backend inspection.` : tablesResult.error));
    const authProbe = authResult.ok ? authResult.value : { ok: false, detail: authResult.error, missing: [] };
    items.push(buildItem('supabase-auth', 'Supabase auth', authProbe.ok ? 'verified' : authProbe.missing.length > 0 ? 'missing_access' : 'not_verified', authProbe.detail, authProbe.missing));
    const storageProbe = storageResult.ok ? storageResult.value : { ok: false, detail: storageResult.error, missing: [] };
    items.push(buildItem('supabase-storage', 'Supabase storage', storageProbe.ok ? 'verified' : storageProbe.missing.length > 0 ? 'missing_access' : 'not_verified', storageProbe.detail, storageProbe.missing));
    items.push(buildItem('supabase-rls', 'Supabase RLS policies', rlsResult.ok ? 'verified' : 'not_verified', rlsResult.ok ? `${rlsResult.value.tables.length} RLS table row(s) inspected.` : rlsResult.error));
    const resolvedTables = ownerTables.ok ? ownerTables.value : null;
    const ownerTablesDetail = ownerTables.ok
        ? `Owner room schema: ${ownerTables.value.schema}; messages table: ${ownerTables.value.messages}.`
        : ownerTables.error;
    items.push(buildItem('message-persistence', 'Message persistence status', resolvedTables && resolvedTables.schema !== 'none' ? 'verified' : 'not_verified', ownerTablesDetail));
    items.push(buildItem('ai-response-persistence', 'AI response persistence status', resolvedTables?.aiRequests ? 'verified' : resolvedTables && resolvedTables.schema !== 'none' ? 'available' : 'not_verified', resolvedTables?.aiRequests ? `AI request log table: ${resolvedTables.aiRequests}.` : 'AI replies can be saved as messages; AI request log table is not verified.'));
    items.push(buildItem('backend-health', 'Backend API health', 'verified', 'This owner-only control-room route is running and authenticated.'));
    const apiDns = statusFromDnsTls(apiDnsTlsResult);
    const chatDns = statusFromDnsTls(chatDnsTlsResult);
    items.push(buildItem('dns-tls', 'DNS/TLS status', apiDns.status === 'verified' && chatDns.status === 'verified' ? 'verified' : 'not_verified', `${apiDns.detail} ${chatDns.detail}`));
    const githubOutput = record(githubResult.output);
    const githubMissing = githubResult.missingEnvNames;
    items.push(buildItem('github-repo', 'GitHub repo status', toolStatus(githubResult, 'repo'), githubResult.ok ? `Repo connected: ${readTrimmed(githubOutput.owner)}/${readTrimmed(githubOutput.repo)}.` : githubResult.error ?? 'GitHub repo not verified.', githubMissing));
    items.push(buildItem('github-branch', 'Current branch', githubResult.ok ? 'verified' : githubMissing.length > 0 ? 'missing_access' : 'not_verified', githubResult.ok ? readTrimmed(githubOutput.defaultBranch) || 'not verified' : githubResult.error ?? 'not verified', githubMissing));
    items.push(buildItem('github-uncommitted', 'Uncommitted files', 'not_verified', 'Not verified from the deployed backend. GitHub API sees pushed repository state, not the live working tree.'));
    const deploymentOutput = record(deploymentResult.output);
    items.push(buildItem('deployment-status', 'Deployment status', deploymentResult.ok && deploymentOutput.ok === true ? 'verified' : 'not_verified', deploymentResult.ok ? `Health check status: ${String(deploymentOutput.status ?? 'not verified')}.` : deploymentResult.error ?? 'Deployment health not verified.'));
    items.push(buildItem('aws-iam', 'AWS/IAM status', awsResult.ok && iamResult.ok ? 'verified' : awsResult.missingEnvNames.length > 0 || iamResult.missingEnvNames.length > 0 ? 'missing_access' : 'not_verified', awsResult.ok ? 'AWS identity resolved; IAM readiness checked.' : awsResult.error ?? 'AWS/IAM not verified.', Array.from(new Set([...awsResult.missingEnvNames, ...iamResult.missingEnvNames]))));
    const envMissing = extractEnvMissing(envResult).filter((name) => REQUIRED_ENV_NAMES.includes(name));
    const minimumAccessMissing = Array.isArray(minimumAccessOutput.missingMinimumRuntimeEnvNames) ? minimumAccessOutput.missingMinimumRuntimeEnvNames.map((item) => readTrimmed(item)).filter(Boolean) : [];
    items.push(buildItem('minimum-access-plan', 'Least-privilege access plan', minimumAccessResult.ok ? 'available' : 'not_verified', minimumAccessResult.ok ? 'Read-only verification is the default; write actions require owner approval and backend-only credentials.' : minimumAccessResult.error ?? 'Minimum access plan not available.', minimumAccessResult.missingEnvNames));
    items.push(buildItem('env-checklist', 'Environment variable checklist', envMissing.length === 0 ? 'verified' : 'missing_access', envMissing.length === 0 ? 'Minimum runtime names are present.' : `${envMissing.length} minimum runtime name(s) missing.`, envMissing));
    items.push(buildItem('missing-secrets', 'Missing minimum access checklist', minimumAccessMissing.length === 0 ? 'verified' : 'missing_access', minimumAccessMissing.length === 0 ? 'No missing minimum runtime names detected by the runtime checklist.' : minimumAccessMissing.join(', '), minimumAccessMissing));
    items.push(buildItem('logs-summary', 'Logs viewer/status summary', 'available', 'Server request logs are emitted by backend routes. External hosted log viewer is not connected here.'));
    items.push(buildItem('verification-tests', 'Run verification tests', 'available', 'Refreshing this dashboard runs read-only backend, Supabase, DNS/TLS, GitHub, AWS, and config checks.'));
    items.push(buildItem('owner-control-readiness', 'Owner-control readiness report', ownerReadinessResult.ok && readTrimmed(ownerReadinessOutput.status) === 'verified' ? 'verified' : 'not_verified', ownerReadinessResult.ok ? `Code readiness after this pass: ${String(ownerReadinessOutput.completionPercentageAfterThisPass ?? 'not verified')}%. Live runtime completion: ${String(ownerReadinessOutput.liveRuntimeCompletionPercentage ?? 'not verified')}.` : ownerReadinessResult.error ?? 'Owner-control readiness not verified.', ownerReadinessResult.missingEnvNames));
    items.push(buildItem('fix-queue', 'Fix queue / pending blockers', items.some((item) => item.status === 'not_verified' || item.status === 'not_connected' || item.status === 'missing_access') ? 'blocked' : 'verified', 'Generated from any not connected, not verified, or missing access rows above.'));
    items.push(buildItem('export-setup', 'Export setup instructions', 'available', 'Use README_IVX_DEPLOYMENT.md, ENVIRONMENT_VARIABLES.md, IVX_AI_BRAIN_TOOLS.md, IVX_OWNER_CONTROL_READINESS.md, and IVX_MINIMUM_ACCESS_PLAN.md to operate IVX independently.'));
    return items;
}
export function OPTIONS() {
    return ownerOnlyOptions();
}
export async function handleIVXControlRoomStatusRequest(request) {
    try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
        }
        const ownerContext = await assertIVXOwnerOnly(request);
        const items = await buildControlRoomItems(ownerContext);
        const missingCredentialNames = Array.from(new Set(items.flatMap((item) => item.missingCredentialNames ?? []))).sort();
        return ownerOnlyJson({
            ok: true,
            ownerOnly: true,
            readOnly: true,
            generatedAt: nowIso(),
            authenticatedUserId: ownerContext.userId,
            statusItems: items,
            missingCredentialNames,
            tools: listIVXAIBrainTools(),
        });
    }
    catch (error) {
        const message = safeError(error);
        console.log('[IVXControlRoomStatus] Request failed:', { message });
        return ownerOnlyJson({
            ok: false,
            ownerOnly: true,
            readOnly: true,
            generatedAt: nowIso(),
            error: message,
            statusItems: [buildItem('control-room', 'Owner/developer control room', 'not_connected', message)],
        }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
    }
}
