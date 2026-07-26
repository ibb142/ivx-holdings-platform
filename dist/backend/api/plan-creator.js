import { createClient } from '@supabase/supabase-js';
import { getIVXAIEndpoint, requestIVXAIText, resolveIVXAIModel } from '../ivx-ai-runtime';
import { extractIVXRoleCandidate, isPrivilegedIVXRole, resolveIVXRoleContext, } from '../../expo/shared/ivx';
const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_MODEL = 'gpt-4o';
const DEPLOYMENT_MARKER = 'p1-plan-creator-2026-04-25t0000z';
const WORKSPACE_PROJECT_ID = (process.env.EXPO_PUBLIC_PROJECT_ID ?? '').trim();
const WORKSPACE_TEAM_ID = (process.env.EXPO_PUBLIC_TEAM_ID ?? '').trim();
function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: JSON_HEADERS,
    });
}
function readTrimmedString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function nowIso() {
    return new Date().toISOString();
}
function createRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `plan-creator-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}
function decodeBase64Url(value) {
    try {
        const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
        const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
        return Buffer.from(`${normalized}${padding}`, 'base64').toString('utf8');
    }
    catch {
        return null;
    }
}
function extractJwtRole(token) {
    const payloadJson = decodeBase64Url(token.split('.')[1] ?? '');
    if (!payloadJson) {
        return null;
    }
    try {
        const payload = JSON.parse(payloadJson);
        return readTrimmedString(payload.role);
    }
    catch {
        return null;
    }
}
function getErrorMessage(error) {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    if (typeof error === 'string' && error.trim().length > 0) {
        return error.trim();
    }
    return 'Unknown error';
}
function isSchemaMissingError(error) {
    const code = (error?.code ?? '').toUpperCase();
    const message = (error?.message ?? '').toLowerCase();
    return code === 'PGRST204'
        || code === 'PGRST205'
        || code === '42P01'
        || message.includes('schema cache')
        || message.includes('could not find the table')
        || (message.includes('relation') && message.includes('does not exist'));
}
function isColumnMissingError(error) {
    const code = (error?.code ?? '').toUpperCase();
    const message = (error?.message ?? '').toLowerCase();
    return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}
function extractBearerToken(request) {
    const authorizationHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
    if (!authorizationHeader) {
        return null;
    }
    const [scheme, token] = authorizationHeader.split(' ');
    if (scheme?.toLowerCase() !== 'bearer') {
        return null;
    }
    return readTrimmedString(token);
}
function createSupabaseServerClient(accessToken) {
    const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
    const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    const anonKey = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '').trim();
    const serviceRoleClaim = extractJwtRole(serviceRoleKey);
    const hasRealServiceRole = serviceRoleKey && serviceRoleKey !== anonKey && (serviceRoleClaim === 'service_role' || serviceRoleClaim === 'supabase_admin');
    const effectiveKey = hasRealServiceRole ? serviceRoleKey : anonKey;
    if (!supabaseUrl || !effectiveKey) {
        throw new Error('Supabase server environment variables are missing.');
    }
    if (serviceRoleKey && serviceRoleClaim && serviceRoleClaim !== 'service_role' && serviceRoleClaim !== 'supabase_admin' && serviceRoleKey !== anonKey) {
        throw new Error(`SUPABASE_SERVICE_ROLE_KEY has invalid role claim: ${serviceRoleClaim}.`);
    }
    return createClient(supabaseUrl, effectiveKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
        global: !hasRealServiceRole && accessToken
            ? {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                },
            }
            : undefined,
    });
}
async function verifyUser(client, request) {
    const token = extractBearerToken(request);
    if (!token) {
        throw new Error('Missing bearer token.');
    }
    console.log('[P1PlanCreator] Verifying bearer token');
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
        console.log('[P1PlanCreator] Auth verification failed:', error?.message ?? 'No user returned');
        throw new Error('Unauthorized request.');
    }
    return data.user;
}
async function loadUserContext(client, user) {
    const { data, error } = await client
        .from('profiles')
        .select('id,email,full_name,role,avatar_url,created_at')
        .eq('id', user.id)
        .maybeSingle();
    if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
        console.log('[P1PlanCreator] Profile lookup warning:', error.message);
    }
    const roleContext = resolveIVXRoleContext([
        extractIVXRoleCandidate(data),
        extractIVXRoleCandidate(user.app_metadata),
        extractIVXRoleCandidate(user.user_metadata),
    ]);
    return {
        id: user.id,
        email: readTrimmedString(user.email),
        role: roleContext.rawRole,
        normalizedRole: roleContext.normalizedRole,
    };
}
function getGatewayEndpoint(model) {
    return getIVXAIEndpoint(model);
}
function buildPlanPrompt(input) {
    return [
        'Create an implementation-ready internal development plan for IVX.',
        `Goal: ${input.goal}`,
        `Constraints: ${input.constraints ?? 'Use the current internal development baseline only.'}`,
        `Audience: ${input.audience ?? 'IVX owner and development team'}`,
        `Timeline: ${input.timeline ?? 'Immediate internal readiness'}`,
        `Workspace project id: ${input.projectId}`,
        `Workspace team id: ${WORKSPACE_TEAM_ID || 'unavailable'}`,
        `Authenticated user id: ${input.user.id}`,
        `Authenticated user role: ${input.user.role ?? 'unknown'}`,
        'Return a concise plan with title, summary, phases, risks, and owner next step.',
    ].join('\n\n');
}
function buildSystemPrompt() {
    return [
        'You are the P1 IVX plan-creator module.',
        'Use the same verified internal runtime baseline as P0: owner_session, remote_api, ChatGPT through Vercel AI Gateway, and Supabase prompt-run persistence.',
        'Do not use local-only mock plans or placeholder roadmaps.',
        'Be specific, implementation-oriented, and honest about blockers.',
        'Format the response with headings: TITLE, SUMMARY, PHASES, RISKS, OWNER NEXT STEP.',
    ].join('\n\n');
}
function buildGeneratedPlanSummary(answer) {
    const normalized = answer.replace(/\s+/g, ' ').trim();
    return normalized ? `Plan generated: ${normalized.slice(0, 420)}` : 'Plan generated';
}
function extractSection(answer, heading) {
    const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`${escapedHeading}\\s*:?\\s*([\\s\\S]*?)(?=\\n\\s*(TITLE|SUMMARY|PHASES|RISKS|OWNER NEXT STEP)\\s*:?|$)`, 'i');
    const match = answer.match(pattern);
    return readTrimmedString(match?.[1]);
}
function splitListSection(section) {
    if (!section) {
        return [];
    }
    return section
        .split(/\n+/)
        .map((line) => line.replace(/^[-*\d.)\s]+/, '').trim())
        .filter((line) => line.length > 0)
        .slice(0, 8);
}
function buildPlanArtifact(answer) {
    const title = extractSection(answer, 'TITLE') ?? answer.split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'IVX implementation plan';
    const summary = extractSection(answer, 'SUMMARY') ?? buildGeneratedPlanSummary(answer);
    const phases = splitListSection(extractSection(answer, 'PHASES'));
    const risks = splitListSection(extractSection(answer, 'RISKS'));
    const ownerNextStep = extractSection(answer, 'OWNER NEXT STEP') ?? 'Review and approve the next implementation pass.';
    return {
        title: title.slice(0, 180),
        summary: summary.slice(0, 900),
        phases,
        risks,
        ownerNextStep: ownerNextStep.slice(0, 500),
        generatedAt: nowIso(),
    };
}
async function generatePlan(input) {
    const model = resolveIVXAIModel(input.model);
    const endpoint = getGatewayEndpoint(model);
    const prompt = buildPlanPrompt(input);
    console.log('[P1PlanCreator] Calling IVX AI runtime:', {
        model,
        endpoint,
        promptLength: prompt.length,
    });
    const result = await requestIVXAIText({
        module: 'p1-plan-creator',
        requestId: input.projectId,
        model,
        system: buildSystemPrompt(),
        prompt,
    });
    return {
        answer: result.text,
        generatedPlanSummary: buildGeneratedPlanSummary(result.text),
        planArtifact: buildPlanArtifact(result.text),
        usage: result.usage,
        providerMetadata: result.providerMetadata,
    };
}
async function reloadPlanRun(client, table, requestId, rowId) {
    if (table === 'plan_creator_runs') {
        const { data, error } = await client.from(table).select('id,request_id').eq('request_id', requestId).limit(1);
        return !error && Array.isArray(data) && data.length > 0;
    }
    if (!rowId) {
        return false;
    }
    const { data, error } = await client.from(table).select('id,action,metadata').eq('id', rowId).limit(1);
    return !error && Array.isArray(data) && data.length > 0;
}
async function persistPlanRun(params) {
    const persistedAt = nowIso();
    const runId = createRequestId();
    const snapshot = {
        requestId: params.requestId,
        module: 'p1-plan-creator',
        userId: params.user.id,
        userEmail: params.user.email,
        userRole: params.user.role,
        projectId: params.projectId,
        teamId: WORKSPACE_TEAM_ID || null,
        goal: params.goal,
        constraints: params.constraints,
        audience: params.audience,
        timeline: params.timeline,
        answer: params.answer,
        generatedPlanSummary: params.generatedPlanSummary,
        planArtifact: params.planArtifact,
        providerMetadata: params.providerMetadata,
        usage: params.usage,
        deploymentMarker: DEPLOYMENT_MARKER,
        createdAt: persistedAt,
    };
    const dedicatedPayload = {
        id: runId,
        request_id: params.requestId,
        project_id: params.projectId,
        user_id: params.user.id,
        goal: params.goal,
        constraints: params.constraints,
        audience: params.audience,
        timeline: params.timeline,
        response_text: params.answer,
        generated_plan_summary: params.generatedPlanSummary,
        plan_artifact: params.planArtifact,
        provider_source: params.providerMetadata.source,
        provider_name: params.providerMetadata.provider,
        provider_model: params.providerMetadata.model,
        provider_endpoint: params.providerMetadata.endpoint,
        provider_metadata: params.providerMetadata,
        usage: params.usage,
        status: 'completed',
        created_at: persistedAt,
        updated_at: persistedAt,
    };
    const dedicatedResult = await params.client.from('plan_creator_runs').insert(dedicatedPayload).select('id').maybeSingle();
    if (!dedicatedResult.error) {
        return {
            saved: true,
            reloaded: await reloadPlanRun(params.client, 'plan_creator_runs', params.requestId),
            table: 'plan_creator_runs',
            id: readTrimmedString(dedicatedResult.data?.id) ?? runId,
            persistedAt,
            warning: null,
        };
    }
    if (!isSchemaMissingError(dedicatedResult.error) && !isColumnMissingError(dedicatedResult.error)) {
        console.log('[P1PlanCreator] Dedicated plan run persistence warning:', dedicatedResult.error.message);
    }
    const auditResult = await params.client.from('audit_trail').insert({
        action: 'p1_plan_creator_run',
        metadata: snapshot,
    }).select('id').maybeSingle();
    if (!auditResult.error) {
        const auditId = readTrimmedString(auditResult.data?.id);
        return {
            saved: true,
            reloaded: await reloadPlanRun(params.client, 'audit_trail', params.requestId, auditId),
            table: 'audit_trail',
            id: auditId,
            persistedAt,
            warning: dedicatedResult.error.message,
        };
    }
    return {
        saved: false,
        reloaded: false,
        table: null,
        id: null,
        persistedAt,
        warning: auditResult.error.message || dedicatedResult.error.message,
    };
}
export function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: JSON_HEADERS,
    });
}
export async function POST(request) {
    try {
        const body = await request.json();
        const goal = readTrimmedString(body.goal) ?? readTrimmedString(body.prompt);
        const constraints = readTrimmedString(body.constraints);
        const audience = readTrimmedString(body.audience);
        const timeline = readTrimmedString(body.timeline);
        const projectId = readTrimmedString(body.projectId) ?? (WORKSPACE_PROJECT_ID || 'workspace');
        const model = readTrimmedString(body.model) ?? DEFAULT_MODEL;
        const requestId = readTrimmedString(body.requestId) ?? createRequestId();
        if (!goal) {
            return jsonResponse({ error: 'Plan goal is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
        }
        console.log('[P1PlanCreator] Incoming request:', {
            requestId,
            projectId,
            model,
            goalLength: goal.length,
        });
        const accessToken = extractBearerToken(request);
        const client = createSupabaseServerClient(accessToken);
        const verifiedUser = await verifyUser(client, request);
        const userContext = await loadUserContext(client, verifiedUser);
        if (!isPrivilegedIVXRole(userContext.normalizedRole)) {
            return jsonResponse({ error: 'Privileged IVX access is required.', deploymentMarker: DEPLOYMENT_MARKER }, 403);
        }
        const planResult = await generatePlan({
            goal,
            constraints,
            audience,
            timeline,
            projectId,
            user: userContext,
            model,
        });
        const planRun = await persistPlanRun({
            client,
            requestId,
            user: userContext,
            projectId,
            goal,
            constraints,
            audience,
            timeline,
            answer: planResult.answer,
            generatedPlanSummary: planResult.generatedPlanSummary,
            planArtifact: planResult.planArtifact,
            providerMetadata: planResult.providerMetadata,
            usage: planResult.usage,
        });
        return jsonResponse({
            ok: true,
            requestId,
            goal,
            answer: planResult.answer,
            text: planResult.answer,
            generatedPlanSummary: planResult.generatedPlanSummary,
            planArtifact: planResult.planArtifact,
            planRun,
            provider: planResult.providerMetadata.provider,
            source: planResult.providerMetadata.source,
            model: planResult.providerMetadata.model,
            providerMetadata: planResult.providerMetadata,
            usage: planResult.usage,
            saved: planRun.saved,
            deploymentMarker: DEPLOYMENT_MARKER,
            context: {
                projectId,
                teamId: WORKSPACE_TEAM_ID || null,
                userRole: userContext.role,
                normalizedUserRole: userContext.normalizedRole,
            },
        });
    }
    catch (error) {
        const message = getErrorMessage(error);
        const status = message === 'Missing bearer token.' || message === 'Unauthorized request.'
            ? 401
            : message === 'Privileged IVX access is required.'
                ? 403
                : message === 'Supabase server environment variables are missing.'
                    || message.startsWith('SUPABASE_SERVICE_ROLE_KEY has invalid role claim:')
                    || message.includes('is not configured')
                    ? 503
                    : 500;
        console.log('[P1PlanCreator] Request failed:', {
            message,
            status,
            marker: DEPLOYMENT_MARKER,
        });
        return jsonResponse({ error: message, deploymentMarker: DEPLOYMENT_MARKER }, status);
    }
}
