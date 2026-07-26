import { createClient } from '@supabase/supabase-js';
import { getIVXAIEndpoint, requestIVXAIText, resolveIVXAIModel } from '../ivx-ai-runtime';
import { IVX_OWNER_AI_PROFILE, IVX_OWNER_AI_ROOM_ID, IVX_OWNER_AI_ROOM_SLUG } from '../../expo/constants/ivx-owner-ai';
import { extractIVXRoleCandidate, isPrivilegedIVXRole, resolveIVXRoleContext, } from '../../expo/shared/ivx';
const JSON_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const DEFAULT_MODEL = 'gpt-4o';
const DEFAULT_ROOM_KEY = 'ivx-owner-room';
const WORKSPACE_PROJECT_ID = (process.env.EXPO_PUBLIC_PROJECT_ID ?? '').trim();
const WORKSPACE_TEAM_ID = (process.env.EXPO_PUBLIC_TEAM_ID ?? '').trim();
const WORKSPACE_LABEL = 'IVX Workspace Assistant';
const ASSISTANT_SENDER_ID = `assistant:${WORKSPACE_PROJECT_ID || 'workspace'}`;
const DEPLOYMENT_MARKER = 'p0-ai-assistant-2026-04-25t0000z';
const KNOWN_ROOM_ALIASES = new Set([
    IVX_OWNER_AI_ROOM_ID,
    IVX_OWNER_AI_ROOM_SLUG,
    'ivx-owner-room',
    'owner-room',
    'ivx_owner_room',
]);
function normalizeRoomKey(value) {
    return (value ?? '').trim().toLowerCase();
}
function isKnownOwnerRoom(value) {
    const normalized = normalizeRoomKey(value);
    return normalized.length > 0 && KNOWN_ROOM_ALIASES.has(normalized);
}
function resolveChatConversationId(value) {
    const trimmedValue = value?.trim() ?? '';
    if (!trimmedValue) {
        return '';
    }
    return isKnownOwnerRoom(trimmedValue) ? IVX_OWNER_AI_ROOM_ID : trimmedValue;
}
function getChatConversationDisplayId(value) {
    const trimmedValue = value?.trim() ?? '';
    if (!trimmedValue) {
        return '';
    }
    return isKnownOwnerRoom(trimmedValue) ? IVX_OWNER_AI_ROOM_SLUG : trimmedValue;
}
function getChatConversationTitle(value, fallbackTitle) {
    const trimmedFallback = fallbackTitle?.trim();
    if (trimmedFallback) {
        return trimmedFallback;
    }
    return isKnownOwnerRoom(value) ? IVX_OWNER_AI_PROFILE.sharedRoom.title : null;
}
function getChatConversationSubtitle(value, fallbackSubtitle) {
    const trimmedFallback = fallbackSubtitle?.trim();
    if (trimmedFallback) {
        return trimmedFallback;
    }
    return isKnownOwnerRoom(value) ? IVX_OWNER_AI_PROFILE.sharedRoom.subtitle : null;
}
function getChatConversationBootstrap(value) {
    if (!isKnownOwnerRoom(value)) {
        return null;
    }
    return {
        conversationId: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
    };
}
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
    return `ai-assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
function toBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
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
function normalizeFlow(value) {
    const normalized = readTrimmedString(value)?.toLowerCase().replace(/_/g, '-') ?? 'generate';
    if (normalized === 'replace') {
        return 'replace';
    }
    if (normalized === 'new-project' || normalized === 'newproject') {
        return 'new-project';
    }
    return 'generate';
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
function createSupabaseAdminClient(accessToken) {
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
async function verifyUser(client, request) {
    const token = extractBearerToken(request);
    if (!token) {
        throw new Error('Missing bearer token.');
    }
    console.log('[P0AIAssistant] Verifying bearer token');
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) {
        console.log('[P0AIAssistant] Auth verification failed:', error?.message ?? 'No user returned');
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
        console.log('[P0AIAssistant] Profile lookup warning:', error.message);
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
async function upsertKnownConversation(client, requestedKey, userId) {
    const bootstrap = getChatConversationBootstrap(requestedKey);
    if (!bootstrap) {
        return;
    }
    const basePayload = {
        id: bootstrap.conversationId,
        title: bootstrap.title,
        subtitle: bootstrap.subtitle,
    };
    let { error } = await client.from('conversations').upsert(basePayload, { onConflict: 'id' });
    if (error && (error.message ?? '').toLowerCase().includes('slug')) {
        ({ error } = await client.from('conversations').upsert({
            ...basePayload,
            slug: getChatConversationDisplayId(requestedKey) || requestedKey,
        }, { onConflict: 'id' }));
    }
    if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
        console.log('[P0AIAssistant] Conversation bootstrap warning:', error.message);
    }
    const participantResult = await client.from('conversation_participants').upsert({
        conversation_id: bootstrap.conversationId,
        user_id: userId,
        unread_count: 0,
        last_read_at: nowIso(),
    }, { onConflict: 'conversation_id,user_id' });
    if (participantResult.error && !isSchemaMissingError(participantResult.error) && !isColumnMissingError(participantResult.error)) {
        console.log('[P0AIAssistant] Participant bootstrap warning:', participantResult.error.message);
    }
}
async function findPrimaryConversation(client, requestedKey) {
    const normalizedKey = resolveChatConversationId(requestedKey);
    const candidateKeys = Array.from(new Set([
        normalizedKey,
        requestedKey,
        getChatConversationDisplayId(requestedKey),
    ].filter((value) => !!readTrimmedString(value))));
    for (const key of candidateKeys) {
        const idResult = await client
            .from('conversations')
            .select('id,slug,title,subtitle,last_message_text,last_message_at')
            .eq('id', key)
            .maybeSingle();
        if (idResult.data) {
            return idResult.data;
        }
        if (idResult.error && !isSchemaMissingError(idResult.error) && !isColumnMissingError(idResult.error)) {
            console.log('[P0AIAssistant] Conversation id lookup warning:', idResult.error.message);
        }
        const slugResult = await client
            .from('conversations')
            .select('id,slug,title,subtitle,last_message_text,last_message_at')
            .eq('slug', key)
            .maybeSingle();
        if (slugResult.data) {
            return slugResult.data;
        }
        if (slugResult.error && !isSchemaMissingError(slugResult.error) && !isColumnMissingError(slugResult.error)) {
            console.log('[P0AIAssistant] Conversation slug lookup warning:', slugResult.error.message);
        }
    }
    return null;
}
async function loadPrimaryMessages(client, conversationId) {
    const { data, error } = await client
        .from('messages')
        .select('id,conversation_id,sender_id,text,body,created_at')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(12);
    if (error) {
        if (isSchemaMissingError(error) || isColumnMissingError(error)) {
            return [];
        }
        throw new Error(error.message || 'Failed to load conversation messages.');
    }
    return (data ?? [])
        .map((message) => ({
        senderId: message.sender_id,
        text: readTrimmedString(message.text) ?? readTrimmedString(message.body) ?? '',
        createdAt: message.created_at,
    }))
        .filter((message) => message.text.length > 0)
        .reverse();
}
async function resolveConversationContext(client, requestedRoomKey, userId) {
    const normalizedKey = resolveChatConversationId(requestedRoomKey) || resolveChatConversationId(DEFAULT_ROOM_KEY);
    await upsertKnownConversation(client, normalizedKey, userId);
    const primaryConversation = await findPrimaryConversation(client, normalizedKey);
    const bootstrap = getChatConversationBootstrap(normalizedKey);
    const conversationId = primaryConversation?.id ?? bootstrap?.conversationId ?? normalizedKey;
    const title = readTrimmedString(primaryConversation?.title)
        ?? getChatConversationTitle(normalizedKey, 'Workspace Assistant')
        ?? 'Workspace Assistant';
    const subtitle = readTrimmedString(primaryConversation?.subtitle)
        ?? getChatConversationSubtitle(normalizedKey, 'Private AI workspace room');
    return {
        conversationId,
        storageId: conversationId,
        title,
        subtitle,
        recentMessages: await loadPrimaryMessages(client, conversationId),
    };
}
async function loadProjectContext(client, requestedProjectId) {
    const workspaceProjectId = WORKSPACE_PROJECT_ID || 'workspace';
    const effectiveProjectId = requestedProjectId ?? workspaceProjectId;
    let selectedDeal = null;
    if (requestedProjectId && requestedProjectId !== workspaceProjectId) {
        const { data, error } = await client
            .from('jv_deals')
            .select('id,title,project_name,type,description,total_investment,expected_roi,min_investment,status,published,property_address,city,state,zip_code,country,property_type,photos,created_at')
            .eq('id', requestedProjectId)
            .maybeSingle();
        if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
            console.log('[P0AIAssistant] Selected deal lookup warning:', error.message);
        }
        selectedDeal = data ?? null;
    }
    const { data: featuredData, error: featuredError } = await client
        .from('jv_deals')
        .select('id,title,slug,price,min_investment,expected_roi,deal_type,status,published,description,location,created_at')
        .limit(3);
    if (featuredError && !isSchemaMissingError(featuredError) && !isColumnMissingError(featuredError)) {
        console.log('[P0AIAssistant] Featured deals lookup warning:', featuredError.message);
    }
    return {
        projectId: effectiveProjectId,
        teamId: WORKSPACE_TEAM_ID || null,
        workspaceLabel: WORKSPACE_LABEL,
        selectedDeal,
        featuredDeals: (featuredData ?? []).slice(0, 3),
    };
}
function isAssistantSender(senderId, currentUserId) {
    const normalizedSenderId = senderId.trim().toLowerCase();
    return normalizedSenderId !== currentUserId.trim().toLowerCase()
        && (normalizedSenderId === ASSISTANT_SENDER_ID.toLowerCase()
            || normalizedSenderId === 'assistant'
            || normalizedSenderId.includes('assistant')
            || normalizedSenderId.includes('ai'));
}
function readDealTitle(deal) {
    return readTrimmedString(deal.title) ?? readTrimmedString(deal.projectName) ?? readTrimmedString(deal.project_name) ?? deal.id;
}
function readDealAddress(deal) {
    return readTrimmedString(deal.propertyAddress) ?? readTrimmedString(deal.property_address) ?? 'Address unavailable';
}
function readDealRoi(deal) {
    const roi = typeof deal.expectedROI === 'number' ? deal.expectedROI : typeof deal.expected_roi === 'number' ? deal.expected_roi : null;
    return roi === null ? 'ROI unavailable' : `${roi}%`;
}
function summarizeDeals(deals) {
    if (deals.length === 0) {
        return 'No featured deals were loaded for this workspace.';
    }
    return deals.map((deal) => `${readDealTitle(deal)} | ${readDealAddress(deal)} | expected ROI: ${readDealRoi(deal)}`).join('\n');
}
function buildFlowInstruction(flow) {
    if (flow === 'replace') {
        return 'Flow: replace. Rewrite or replace the requested content directly. Return the replacement content first, then a concise summary of what changed.';
    }
    if (flow === 'new-project') {
        return 'Flow: new-project. Create a concise new project plan with a title, assumptions, first steps, and risks. Return a useful generated summary.';
    }
    return 'Flow: generate. Generate the requested content directly and include a concise generated summary.';
}
function buildSystemPrompt(context) {
    const instructions = [
        'You are the P0 in-app AI assistant for IVX internal development.',
        'Use the same verified internal runtime baseline: owner_session, remote_api, ChatGPT via Vercel AI Gateway, and Supabase persistence.',
        'Do not use local-only mock content. If context is missing, say what is missing.',
        'Be concise, factual, and action-oriented.',
        buildFlowInstruction(context.flow),
        `Workspace project id: ${context.project.projectId}`,
        `Workspace team id: ${context.project.teamId ?? 'unavailable'}`,
        `Room title: ${context.conversation.title}`,
        `Room subtitle: ${context.conversation.subtitle ?? 'unavailable'}`,
        `Authenticated user id: ${context.user.id}`,
        `Authenticated user role: ${context.user.role ?? 'unknown'}`,
        `Authenticated user email: ${context.user.email ?? 'unknown'}`,
        `Featured deals:\n${summarizeDeals(context.project.featuredDeals)}`,
    ];
    if (context.project.selectedDeal) {
        instructions.push(`Selected deal context: ${readDealTitle(context.project.selectedDeal)} | ${readDealAddress(context.project.selectedDeal)} | ${readDealRoi(context.project.selectedDeal)}`);
    }
    if (context.systemPrompt) {
        instructions.push(`Additional system prompt: ${context.systemPrompt}`);
    }
    return instructions.join('\n\n');
}
function buildMessages(context) {
    const history = context.conversation.recentMessages
        .map((message) => {
        const role = isAssistantSender(message.senderId, context.userId) ? 'assistant' : 'user';
        return {
            role,
            content: role === 'user' && message.senderId !== context.userId
                ? `[Participant ${message.senderId}] ${message.text}`
                : message.text,
        };
    })
        .filter((message) => message.content.trim().length > 0);
    return [
        ...history,
        { role: 'user', content: context.userMessage },
    ];
}
function getGatewayEndpoint(model) {
    return getIVXAIEndpoint(model);
}
function buildGeneratedSummary(answer, flow) {
    const normalized = answer.replace(/\s+/g, ' ').trim();
    const prefix = flow === 'replace' ? 'Replacement generated' : flow === 'new-project' ? 'New project summary generated' : 'Content generated';
    if (!normalized) {
        return prefix;
    }
    return `${prefix}: ${normalized.slice(0, 360)}`;
}
async function callAssistantModel(params) {
    const model = resolveIVXAIModel(params.model);
    const endpoint = getGatewayEndpoint(model);
    console.log('[P0AIAssistant] Calling IVX AI runtime:', {
        requestId: params.requestId,
        model,
        endpoint,
        messageCount: params.messages.length,
        flow: params.flow,
    });
    const result = await requestIVXAIText({
        module: 'p0-ai-assistant',
        requestId: params.requestId,
        model,
        system: params.system,
        messages: params.messages,
    });
    return {
        provider: 'chatgpt',
        source: 'remote_api',
        responseId: null,
        answer: result.text,
        generatedSummary: buildGeneratedSummary(result.text, params.flow),
        usage: result.usage,
        metadata: result.providerMetadata,
    };
}
async function insertPrimaryMessage(client, conversationId, senderId, text, readBy) {
    const basePayload = {
        conversation_id: conversationId,
        sender_id: senderId,
        text,
        body: text,
        read_by: readBy,
    };
    let { error } = await client.from('messages').insert(basePayload);
    if (error && isColumnMissingError(error)) {
        ({ error } = await client.from('messages').insert({
            conversation_id: conversationId,
            sender_id: senderId,
            text,
            read_by: readBy,
        }));
    }
    if (error) {
        if (isSchemaMissingError(error)) {
            return false;
        }
        throw new Error(error.message || 'Failed to save assistant message.');
    }
    return true;
}
async function persistConversationUpdate(client, conversationId, assistantText) {
    const { error } = await client.from('conversations').update({
        last_message_text: assistantText,
        last_message_at: nowIso(),
    }).eq('id', conversationId);
    if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
        console.log('[P0AIAssistant] Conversation update warning:', error.message);
    }
}
async function persistConversationMessages(params) {
    const persistedAt = nowIso();
    let userMessageSaved = false;
    let assistantMessageSaved = false;
    let warning = null;
    try {
        if (params.saveUserMessage) {
            userMessageSaved = await insertPrimaryMessage(params.client, params.conversation.conversationId, params.userId, params.userMessage, [params.userId]);
        }
        assistantMessageSaved = await insertPrimaryMessage(params.client, params.conversation.conversationId, ASSISTANT_SENDER_ID, params.assistantText, [params.userId]);
        await persistConversationUpdate(params.client, params.conversation.conversationId, params.assistantText);
    }
    catch (error) {
        warning = getErrorMessage(error);
        console.log('[P0AIAssistant] Message persistence warning:', warning);
    }
    return {
        saved: assistantMessageSaved && (!params.saveUserMessage || userMessageSaved),
        userMessageSaved,
        assistantMessageSaved,
        persistedAt,
        warning,
    };
}
async function reloadPromptRun(client, table, requestId, rowId) {
    if (table === 'ai_assistant_prompt_runs') {
        const { data, error } = await client.from(table).select('id,request_id').eq('request_id', requestId).limit(1);
        return !error && Array.isArray(data) && data.length > 0;
    }
    if (!rowId) {
        return false;
    }
    const { data, error } = await client.from(table).select('id,action,metadata').eq('id', rowId).limit(1);
    return !error && Array.isArray(data) && data.length > 0;
}
async function persistPromptRun(params) {
    const persistedAt = nowIso();
    const promptRunId = createRequestId();
    const baseSnapshot = {
        requestId: params.requestId,
        flow: params.flow,
        userId: params.user.id,
        userEmail: params.user.email,
        userRole: params.user.role,
        projectId: params.project.projectId,
        teamId: params.project.teamId,
        conversationId: params.conversation.conversationId,
        prompt: params.prompt,
        generatedSummary: params.generation.generatedSummary,
        answer: params.generation.answer,
        providerMetadata: params.generation.metadata,
        usage: params.generation.usage,
        deploymentMarker: DEPLOYMENT_MARKER,
        createdAt: persistedAt,
    };
    const dedicatedPayload = {
        id: promptRunId,
        request_id: params.requestId,
        flow: params.flow,
        user_id: params.user.id,
        project_id: params.project.projectId,
        team_id: params.project.teamId,
        conversation_id: params.conversation.conversationId,
        prompt: params.prompt,
        system_prompt: params.systemPrompt,
        response_text: params.generation.answer,
        generated_summary: params.generation.generatedSummary,
        provider_source: params.generation.metadata.source,
        provider_name: params.generation.metadata.provider,
        provider_model: params.generation.metadata.model,
        provider_endpoint: params.generation.metadata.endpoint,
        provider_metadata: params.generation.metadata,
        usage: params.generation.usage,
        status: 'completed',
        created_at: persistedAt,
        updated_at: persistedAt,
    };
    const dedicatedResult = await params.client.from('ai_assistant_prompt_runs').insert(dedicatedPayload).select('id').maybeSingle();
    if (!dedicatedResult.error) {
        return {
            saved: true,
            reloaded: await reloadPromptRun(params.client, 'ai_assistant_prompt_runs', params.requestId),
            table: 'ai_assistant_prompt_runs',
            id: readTrimmedString(dedicatedResult.data?.id) ?? promptRunId,
            persistedAt,
            warning: null,
        };
    }
    if (!isSchemaMissingError(dedicatedResult.error) && !isColumnMissingError(dedicatedResult.error)) {
        console.log('[P0AIAssistant] Dedicated prompt run persistence warning:', dedicatedResult.error.message);
    }
    const auditPayload = {
        action: 'p0_ai_assistant_prompt_run',
        metadata: baseSnapshot,
    };
    const auditResult = await params.client.from('audit_trail').insert(auditPayload).select('id').maybeSingle();
    if (!auditResult.error) {
        const auditId = readTrimmedString(auditResult.data?.id);
        return {
            saved: true,
            reloaded: await reloadPromptRun(params.client, 'audit_trail', params.requestId, auditId),
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
        const userMessage = readTrimmedString(body.message) ?? readTrimmedString(body.prompt);
        const requestedRoomKey = readTrimmedString(body.conversationId)
            ?? readTrimmedString(body.roomId)
            ?? readTrimmedString(body.roomSlug)
            ?? DEFAULT_ROOM_KEY;
        const requestedProjectId = readTrimmedString(body.projectId);
        const requestedModel = readTrimmedString(body.model) ?? DEFAULT_MODEL;
        const systemPrompt = readTrimmedString(body.systemPrompt);
        const saveUserMessage = toBoolean(body.saveUserMessage, true);
        const requestId = readTrimmedString(body.requestId) ?? createRequestId();
        const flow = normalizeFlow(body.flow);
        if (!userMessage) {
            return jsonResponse({ error: 'Message is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
        }
        console.log('[P0AIAssistant] Incoming request:', {
            requestId,
            flow,
            roomKey: requestedRoomKey,
            requestedProjectId: requestedProjectId ?? (WORKSPACE_PROJECT_ID || null),
            model: requestedModel,
            saveUserMessage,
        });
        const accessToken = extractBearerToken(request);
        const supabaseAdmin = createSupabaseAdminClient(accessToken);
        const verifiedUser = await verifyUser(supabaseAdmin, request);
        const userContext = await loadUserContext(supabaseAdmin, verifiedUser);
        if (!isPrivilegedIVXRole(userContext.normalizedRole)) {
            return jsonResponse({ error: 'Privileged IVX access is required.', deploymentMarker: DEPLOYMENT_MARKER }, 403);
        }
        const conversationContext = await resolveConversationContext(supabaseAdmin, requestedRoomKey, verifiedUser.id);
        const projectContext = await loadProjectContext(supabaseAdmin, requestedProjectId);
        const instructions = buildSystemPrompt({
            user: userContext,
            conversation: conversationContext,
            project: projectContext,
            systemPrompt,
            flow,
        });
        const messages = buildMessages({
            conversation: conversationContext,
            userId: verifiedUser.id,
            userMessage,
        });
        const generation = await callAssistantModel({
            requestId,
            model: requestedModel,
            system: instructions,
            messages,
            flow,
        });
        const conversationPersistence = await persistConversationMessages({
            client: supabaseAdmin,
            conversation: conversationContext,
            userId: verifiedUser.id,
            userMessage,
            assistantText: generation.answer,
            saveUserMessage,
        });
        const promptRunPersistence = await persistPromptRun({
            client: supabaseAdmin,
            requestId,
            flow,
            user: userContext,
            conversation: conversationContext,
            project: projectContext,
            prompt: userMessage,
            systemPrompt: instructions,
            generation,
        });
        return jsonResponse({
            ok: true,
            requestId,
            flow,
            answer: generation.answer,
            text: generation.answer,
            generatedSummary: generation.generatedSummary,
            responseId: generation.responseId,
            conversationId: conversationContext.conversationId,
            roomTitle: conversationContext.title,
            roomSubtitle: conversationContext.subtitle,
            projectId: projectContext.projectId,
            saved: conversationPersistence.saved && promptRunPersistence.saved,
            persistence: conversationPersistence,
            promptRun: promptRunPersistence,
            provider: generation.provider,
            source: generation.source,
            model: generation.metadata.model,
            providerMetadata: generation.metadata,
            usage: generation.usage,
            deploymentMarker: DEPLOYMENT_MARKER,
            context: {
                recentMessageCount: conversationContext.recentMessages.length,
                featuredDealCount: projectContext.featuredDeals.length,
                selectedDealId: projectContext.selectedDeal?.id ?? null,
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
        console.log('[P0AIAssistant] Request failed:', {
            message,
            status,
            marker: DEPLOYMENT_MARKER,
        });
        return jsonResponse({ error: message, deploymentMarker: DEPLOYMENT_MARKER }, status);
    }
}
