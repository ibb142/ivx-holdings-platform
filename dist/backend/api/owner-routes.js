import { IVX_CHAT_UPLOAD_BUCKET, IVX_OWNER_AI_BUCKET } from '../../expo/shared/ivx';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
const LIVE_COMMIT_SHA = (process.env.RENDER_GIT_COMMIT?.trim() ||
    process.env.GIT_COMMIT?.trim() ||
    process.env.SOURCE_VERSION?.trim() ||
    'unknown');
import { ensureOwnerConversation, handleIVXOwnerAIRequest, insertMessage, loadInboxState, loadRecentMessages, markInboxRead, resolveOwnerTables, safeEnsureInboxState, searchMessages, } from './ivx-owner-ai';
const DEPLOYMENT_MARKER = 'ivx-owner-routes-2026-04-24t0000z';
const IVX_SERVICE_UNAVAILABLE_MESSAGE = 'Service temporarily unavailable. Please try again.';
function nowIso() {
    return new Date().toISOString();
}
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function resolveUploadBucket(value) {
    const requestedBucket = readTrimmed(value);
    if (requestedBucket === IVX_OWNER_AI_BUCKET) {
        return IVX_OWNER_AI_BUCKET;
    }
    return IVX_CHAT_UPLOAD_BUCKET;
}
async function getOwnerRoomContext(client) {
    const tables = await resolveOwnerTables(client);
    const conversation = await ensureOwnerConversation(client, tables);
    return {
        tables,
        conversation,
    };
}
function getErrorStatus(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('missing bearer token') || message.includes('invalid or expired')) {
        return 401;
    }
    if (message.includes('privileged ivx access is required')) {
        return 403;
    }
    if (message.includes('is missing')
        || message.includes('not configured')
        || message.includes('does not exist')
        || message.includes('schema cache')
        || message.includes('invalid schema')) {
        return 503;
    }
    return 500;
}
function errorPayload(error) {
    const message = error instanceof Error ? error.message : 'Unknown owner route error.';
    return {
        error: message,
        detail: message,
        deploymentMarker: DEPLOYMENT_MARKER,
    };
}
export async function handleRoomsGet(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        return ownerOnlyJson({
            rooms: [conversation],
            ownerUserId: ctx.userId,
            ownerEmail: ctx.email,
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleRoomsPost(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        return ownerOnlyJson({
            room: conversation,
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleMessagesGet(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limitRaw = Number(url.searchParams.get('limit') ?? '100');
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 100;
        const conversationIdParam = readTrimmed(url.searchParams.get('conversationId'));
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        const conversationId = conversationIdParam || conversation.id;
        const rows = await loadRecentMessages(ctx.client, tables, conversationId);
        const messages = rows.slice(-limit).map((row) => ({
            id: row.id,
            conversationId: row.conversation_id,
            senderUserId: null,
            senderRole: row.sender_role,
            senderLabel: row.sender_label ?? null,
            body: row.body ?? null,
            attachmentUrl: null,
            attachmentName: null,
            attachmentMime: null,
            attachmentSize: null,
            attachmentKind: 'text',
            createdAt: row.created_at,
            updatedAt: row.created_at,
        }));
        return ownerOnlyJson({
            conversationId,
            messages,
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleMessagesPost(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const text = readTrimmed(body.body ?? body.text ?? body.message);
        const senderRole = body.senderRole === 'assistant' || body.senderRole === 'system' ? body.senderRole : 'owner';
        const senderLabel = readTrimmed(body.senderLabel) || ctx.email || 'IVX Owner';
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        const conversationId = readTrimmed(body.conversationId) || conversation.id;
        const attachmentUrl = readTrimmed(body.attachmentUrl) || null;
        const attachmentName = readTrimmed(body.attachmentName) || null;
        const attachmentMime = readTrimmed(body.attachmentMime) || null;
        const attachmentSize = typeof body.attachmentSize === 'number' ? body.attachmentSize : null;
        const attachmentKind = readTrimmed(body.attachmentKind) || 'text';
        if (!text && !attachmentUrl) {
            return ownerOnlyJson({ error: 'Message body or attachment is required.' }, 400);
        }
        const persistedBody = text || attachmentName || 'Attachment';
        const row = await insertMessage(ctx.client, tables, {
            conversationId,
            senderRole,
            senderUserId: senderRole === 'owner' ? ctx.userId : null,
            senderLabel,
            body: persistedBody,
        });
        return ownerOnlyJson({
            message: {
                id: row.id,
                conversationId: row.conversation_id,
                senderRole: row.sender_role,
                senderLabel: row.sender_label,
                body: text || row.body,
                attachmentUrl,
                attachmentName,
                attachmentMime,
                attachmentSize,
                attachmentKind,
                createdAt: row.created_at,
                updatedAt: row.created_at,
            },
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleMessagesSearch(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const query = readTrimmed(url.searchParams.get('q') ?? url.searchParams.get('query') ?? url.searchParams.get('search'));
        const limitRaw = Number(url.searchParams.get('limit') ?? '50');
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
        const conversationIdParam = readTrimmed(url.searchParams.get('conversationId'));
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        const conversationId = conversationIdParam || conversation.id;
        if (!query) {
            return ownerOnlyJson({ error: 'A search query (q) is required.' }, 400);
        }
        const rows = await searchMessages(ctx.client, tables, query, { limit, conversationId });
        const matches = rows.map((row) => ({
            id: row.id,
            conversationId: row.conversation_id,
            senderRole: row.sender_role,
            senderLabel: row.sender_label ?? null,
            body: row.body ?? null,
            createdAt: row.created_at,
            updatedAt: row.created_at,
        }));
        return ownerOnlyJson({
            query,
            conversationId,
            matchCount: matches.length,
            matches,
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleUploadPost(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const fileName = readTrimmed(body.fileName) || `owner-upload-${Date.now()}`;
        const mimeType = readTrimmed(body.mimeType) || null;
        const { conversation } = await getOwnerRoomContext(ctx.client);
        const conversationId = readTrimmed(body.conversationId) || conversation.id;
        const bucket = resolveUploadBucket(body.bucket);
        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-');
        const storagePath = bucket === IVX_CHAT_UPLOAD_BUCKET
            ? `owner-chat/${ctx.userId}/${conversationId}/${Date.now()}-${safeName}`
            : `owner-room/${conversationId}/${Date.now()}-${safeName}`;
        const signed = await ctx.client.storage.from(bucket).createSignedUploadUrl(storagePath);
        if (signed.error || !signed.data) {
            throw new Error(signed.error?.message ?? 'Failed to create signed upload URL.');
        }
        const publicUrl = bucket === IVX_CHAT_UPLOAD_BUCKET
            ? ctx.client.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl
            : null;
        const readUrl = publicUrl
            ? { data: { signedUrl: publicUrl }, error: null }
            : await ctx.client.storage.from(bucket).createSignedUrl(storagePath, 60 * 60);
        return ownerOnlyJson({
            bucket,
            path: storagePath,
            signedUploadUrl: signed.data.signedUrl,
            token: signed.data.token,
            readUrl: readUrl.data?.signedUrl ?? null,
            publicUrl,
            mimeType,
            fileName: safeName,
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleInboxSync(request) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const action = readTrimmed(body.action).toLowerCase();
        const markReadRequested = action === 'mark_read' || action === 'read' || body.markRead === true;
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        await safeEnsureInboxState(ctx.client, tables, conversation.id, ctx.userId);
        const inboxState = markReadRequested
            ? await markInboxRead(ctx.client, tables, conversation.id, ctx.userId)
            : await loadInboxState(ctx.client, tables, conversation.id, ctx.userId);
        return ownerOnlyJson({
            inbox: [{
                    conversationId: conversation.id,
                    slug: conversation.slug,
                    title: conversation.title,
                    subtitle: conversation.subtitle,
                    unreadCount: inboxState?.unread_count ?? 0,
                    lastReadAt: inboxState?.last_read_at ?? null,
                    lastMessageText: conversation.lastMessageText,
                    lastMessageAt: conversation.lastMessageAt,
                }],
            action: markReadRequested ? 'mark_read' : 'sync',
            storage: {
                schema: tables.schema,
                dbSchema: tables.dbSchema,
                messageConversationField: tables.messageConversationField,
            },
            syncedAt: nowIso(),
            deploymentMarker: DEPLOYMENT_MARKER,
        });
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export async function handleDiagnosticsGet(request) {
    const envAudit = {
        hasSupabaseUrl: readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).length > 0,
        hasAnonKey: readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY).length > 0,
        hasServiceRoleKey: readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY).length > 0,
        hasIVXAIGatewayUrl: readTrimmed(process.env.EXPO_PUBLIC_IVX_AI_GATEWAY_URL).length > 0 || readTrimmed(process.env.IVX_AI_GATEWAY_URL).length > 0,
        hasApiBaseUrl: readTrimmed(process.env.EXPO_PUBLIC_API_BASE_URL).length > 0,
    };
    const routesAvailable = [
        'GET /health',
        'POST /chat',
        'GET /messages',
        'POST /messages',
        'GET /messages/search',
        'POST /upload',
        'GET /rooms',
        'POST /rooms',
        'POST /inbox/sync',
        'GET /diagnostics',
        'POST /fallback/reply',
        'POST /api/ivx/owner-ai',
    ];
    let ownerAuth = { authenticated: false };
    let supabaseReachable = false;
    let supabaseTablesHealthy = false;
    let supabaseDetail = null;
    let storageAudit = null;
    try {
        const ctx = await assertIVXOwnerOnly(request);
        ownerAuth = {
            authenticated: true,
            userId: ctx.userId,
            email: ctx.email,
            role: ctx.role,
            guardMode: ctx.guardMode,
        };
        const { tables, conversation } = await getOwnerRoomContext(ctx.client);
        supabaseReachable = true;
        supabaseTablesHealthy = Boolean(conversation.id);
        supabaseDetail = `schema=${tables.schema}; dbSchema=${tables.dbSchema}; messagesField=${tables.messageConversationField}`;
        storageAudit = {
            schema: tables.schema,
            dbSchema: tables.dbSchema,
            conversationsTable: tables.conversations,
            messagesTable: tables.messages,
            inboxStateTable: tables.inboxState,
            aiRequestsTable: tables.aiRequests,
            messageConversationField: tables.messageConversationField,
        };
    }
    catch (error) {
        ownerAuth = {
            authenticated: false,
            reason: error instanceof Error ? error.message : 'Owner guard failed.',
        };
        supabaseDetail = error instanceof Error ? error.message : 'Supabase probe failed.';
    }
    return ownerOnlyJson({
        ok: true,
        service: 'ivx-owner-ai-backend',
        deploymentMarker: DEPLOYMENT_MARKER,
        commit: LIVE_COMMIT_SHA,
        commitShort: LIVE_COMMIT_SHA === 'unknown' ? 'unknown' : LIVE_COMMIT_SHA.slice(0, 8),
        timestamp: nowIso(),
        env: envAudit,
        routesAvailable,
        ownerAuth,
        supabase: {
            reachable: supabaseReachable,
            tablesHealthy: supabaseTablesHealthy,
            detail: supabaseDetail,
            storageAudit,
        },
    });
}
export async function handleChatPost(request) {
    return await handleIVXOwnerAIRequest(request);
}
export async function handleFallbackReply(request) {
    try {
        await request.json().catch(() => ({}));
        console.log('[IVXOwnerRoutes] fallback/reply rejected. Owner AI requires primary owner-session path.');
        return ownerOnlyJson({
            error: IVX_SERVICE_UNAVAILABLE_MESSAGE,
            status: 'unavailable',
            source: 'remote_api',
            deploymentMarker: DEPLOYMENT_MARKER,
        }, 503);
    }
    catch (error) {
        return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
    }
}
export function ownerRoutesOptions() {
    return ownerOnlyOptions();
}
