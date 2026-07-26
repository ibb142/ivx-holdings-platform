/**
 * Owner-only Render deploy diagnostic.
 *
 * Runs inside the backend and reads Render credentials from process.env or the
 * encrypted Owner Variables runtime bridge. Secrets are never returned.
 */
import { auditIVXRenderRuntimeAccess } from '../services/ivx-senior-developer-runtime';
import { getIVXOwnerVariableRuntimeValue, inspectIVXOwnerVariableRuntimeReadiness } from './ivx-owner-variables';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const RENDER_API_BASE = 'https://api.render.com/v1';
export function OPTIONS() {
    return ownerOnlyOptions();
}
function maskSecret(value) {
    if (!value)
        return 'missing';
    if (value.length <= 8)
        return '***';
    return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}
async function readRenderRuntimeCredentials() {
    const apiKey = (process.env.RENDER_API_KEY ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
    const serviceId = (process.env.RENDER_SERVICE_ID ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
    return { apiKey, serviceId };
}
function normalizeDeploy(raw) {
    const entry = (raw && typeof raw === 'object' && 'deploy' in raw)
        ? raw.deploy
        : raw || {};
    const commitObj = (entry.commit && typeof entry.commit === 'object')
        ? entry.commit
        : null;
    return {
        id: typeof entry.id === 'string' ? entry.id : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        trigger: typeof entry.trigger === 'string' ? entry.trigger : undefined,
        finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : null,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
        commit: commitObj,
        commitSha: commitObj && typeof commitObj.id === 'string' ? commitObj.id : null,
        commitMessage: commitObj && typeof commitObj.message === 'string' ? commitObj.message : null,
        commitCreatedAt: commitObj && typeof commitObj.createdAt === 'string' ? commitObj.createdAt : null,
        branch: typeof entry.branch === 'string' ? entry.branch : null,
        image: (entry.image && typeof entry.image === 'object') ? entry.image : null,
        failureReason: typeof entry.failureReason === 'string' ? entry.failureReason : null,
    };
}
async function callRender(path, apiKey) {
    try {
        const response = await fetch(`${RENDER_API_BASE}${path}`, {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                Accept: 'application/json',
            },
        });
        const text = await response.text();
        let parsed = null;
        if (text) {
            try {
                parsed = JSON.parse(text);
            }
            catch {
                parsed = { raw: text.slice(0, 4000) };
            }
        }
        return { ok: response.ok, status: response.status, body: parsed };
    }
    catch (err) {
        return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
    }
}
export async function handleIVXRenderDiagnosticRequest(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'unauthorized';
        return ownerOnlyJson({ ok: false, error: message }, 401);
    }
    const { apiKey, serviceId } = await readRenderRuntimeCredentials();
    const [apiKeyReadiness, serviceIdReadiness, renderAudit] = await Promise.all([
        inspectIVXOwnerVariableRuntimeReadiness('RENDER_API_KEY'),
        inspectIVXOwnerVariableRuntimeReadiness('RENDER_SERVICE_ID'),
        auditIVXRenderRuntimeAccess(),
    ]);
    const credentialReport = {
        renderApiKey: {
            present: apiKeyReadiness.present,
            length: apiKeyReadiness.length,
            source: apiKeyReadiness.source,
            processEnvPresent: apiKeyReadiness.processEnvPresent,
            ownerVariablesStorePresent: apiKeyReadiness.ownerVariablesStorePresent,
            maskedEnvOnly: maskSecret(process.env.RENDER_API_KEY),
        },
        renderServiceId: {
            present: serviceIdReadiness.present,
            length: serviceIdReadiness.length,
            source: serviceIdReadiness.source,
            processEnvPresent: serviceIdReadiness.processEnvPresent,
            ownerVariablesStorePresent: serviceIdReadiness.ownerVariablesStorePresent,
            value: serviceId ? `${serviceId.slice(0, 4)}…${serviceId.slice(-4)}` : 'missing',
        },
    };
    if (!apiKey || !serviceId) {
        return ownerOnlyJson({
            ok: false,
            error: 'missing_render_credentials',
            credentials: credentialReport,
            renderAudit,
            hint: 'RENDER_API_KEY and RENDER_SERVICE_ID must be readable from process.env or the encrypted Owner Variables runtime bridge.',
            runtime: { node: process.version, platform: process.platform, timestamp: new Date().toISOString() },
        }, 500);
    }
    const url = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 1), 20);
    const [servicePath, deploysPath] = [
        `/services/${encodeURIComponent(serviceId)}`,
        `/services/${encodeURIComponent(serviceId)}/deploys?limit=${limit}`,
    ];
    const [serviceResult, deploysResult] = await Promise.all([
        callRender(servicePath, apiKey),
        callRender(deploysPath, apiKey),
    ]);
    const deploysArray = Array.isArray(deploysResult.body) ? deploysResult.body : [];
    const deploys = deploysArray.map(normalizeDeploy);
    const latest = deploys[0];
    let latestEvents = null;
    if (latest?.id) {
        const eventsResult = await callRender(`/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(latest.id)}/events?limit=20`, apiKey);
        latestEvents = eventsResult.ok ? eventsResult.body : { error: `events_http_${eventsResult.status}` };
    }
    const serviceInfo = (serviceResult.ok && serviceResult.body && typeof serviceResult.body === 'object')
        ? serviceResult.body
        : null;
    return ownerOnlyJson({
        ok: deploysResult.ok,
        credentials: credentialReport,
        renderAudit,
        service: serviceInfo ? {
            id: serviceInfo.id,
            name: serviceInfo.name,
            type: serviceInfo.type,
            branch: serviceInfo.branch ?? null,
            repo: serviceInfo.repo ?? null,
            autoDeploy: serviceInfo.autoDeploy ?? null,
            suspended: serviceInfo.suspended ?? null,
            serviceDetails: serviceInfo.serviceDetails ?? null,
        } : { error: `service_http_${serviceResult.status}`, body: serviceResult.body },
        latestDeploy: latest ? {
            id: latest.id,
            status: latest.status,
            trigger: latest.trigger,
            commitSha: latest.commitSha,
            commitMessage: latest.commitMessage,
            commitCreatedAt: latest.commitCreatedAt,
            finishedAt: latest.finishedAt,
            createdAt: latest.createdAt,
            updatedAt: latest.updatedAt,
            failureReason: latest.failureReason,
            image: latest.image,
        } : null,
        recentDeploys: deploys.map((d) => ({
            id: d.id,
            status: d.status,
            trigger: d.trigger,
            commitSha: d.commitSha,
            commitMessage: d.commitMessage,
            finishedAt: d.finishedAt,
            createdAt: d.createdAt,
            failureReason: d.failureReason,
        })),
        latestDeployEvents: latestEvents,
        deploysHttpStatus: deploysResult.status,
        runtime: {
            node: process.version,
            platform: process.platform,
            timestamp: new Date().toISOString(),
            deploymentMarker: process.env.DEPLOYMENT_MARKER ?? null,
        },
    });
}
