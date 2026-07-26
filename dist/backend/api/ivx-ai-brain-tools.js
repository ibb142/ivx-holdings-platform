import { executeIVXAIBrainTool, listIVXAIBrainTools } from '../services/ivx-ai-brain-tool-executor';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function nowIso() {
    return new Date().toISOString();
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function isLocalDevToolsEnabled() {
    const runtime = readTrimmed(process.env.NODE_ENV).toLowerCase();
    const explicit = readTrimmed(process.env.IVX_LOCAL_DEV_TOOLS).toLowerCase();
    return runtime !== 'production' && explicit !== '0' && explicit !== 'false' && explicit !== 'off';
}
function readBearerToken(request) {
    const authorizationHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    if (!authorizationHeader) {
        return null;
    }
    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer') {
        return null;
    }
    return readTrimmed(token) || null;
}
function getLocalDevAuthenticatedUserId(request) {
    if (!isLocalDevToolsEnabled() || readBearerToken(request) !== 'dev-open-access-token') {
        return null;
    }
    return '00000000-0000-4000-8000-000000000001';
}
export function OPTIONS() {
    return ownerOnlyOptions();
}
export async function handleIVXAIBrainToolsListRequest(request) {
    try {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
            return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
        }
        const localDevUserId = getLocalDevAuthenticatedUserId(request);
        const authenticatedUserId = localDevUserId ?? (await assertIVXOwnerOnly(request)).userId;
        return ownerOnlyJson({
            ok: true,
            ownerOnly: true,
            readOnly: true,
            mode: localDevUserId ? 'local_dev_open_access' : 'owner_session',
            tools: listIVXAIBrainTools(),
            authenticatedUserId,
            timestamp: nowIso(),
        });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX AI Brain tools list failed.';
        console.log('[IVXAIBrainTools] List failed:', { message });
        return ownerOnlyJson({ error: message, ownerOnly: true, readOnly: true, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 500);
    }
}
export async function handleIVXAIBrainToolExecuteRequest(request) {
    try {
        if (request.method !== 'POST') {
            return ownerOnlyJson({ error: 'Method not allowed.' }, 405);
        }
        const localDevUserId = getLocalDevAuthenticatedUserId(request);
        const authenticatedUserId = localDevUserId ?? (await assertIVXOwnerOnly(request)).userId;
        const body = await request.json().catch(() => ({}));
        const result = await executeIVXAIBrainTool(body);
        console.log('[IVXAIBrainTools] Tool executed:', {
            userId: authenticatedUserId,
            mode: localDevUserId ? 'local_dev_open_access' : 'owner_session',
            tool: result.tool,
            ok: result.ok,
            missingEnvNames: result.missingEnvNames,
        });
        return ownerOnlyJson({
            ...result,
            authenticatedUserId,
            mode: localDevUserId ? 'local_dev_open_access' : 'owner_session',
        }, result.ok ? 200 : 400);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX AI Brain tool execution failed.';
        console.log('[IVXAIBrainTools] Execute failed:', { message });
        return ownerOnlyJson({ error: message, ownerOnly: true, readOnly: true, timestamp: nowIso() }, message.toLowerCase().includes('auth') || message.toLowerCase().includes('owner') ? 401 : 400);
    }
}
