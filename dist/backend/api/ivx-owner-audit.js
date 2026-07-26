/**
 * IVX Owner Audit — server-side, owner-protected forensic audit of the last
 * IVX IA conversations, read straight from the durable production tables.
 *
 * Route (registered in backend/hono.ts):
 *   GET /api/ivx/owner-audit/recent-conversations  → last N conversations (owner)
 *
 * For each conversation it reports, grounded in the live Supabase rows:
 *   - conversationId
 *   - createdAt
 *   - lastMessageAt
 *   - userMessageCount        (sender_role = owner)
 *   - assistantMessageCount   (sender_role = assistant)
 *   - failedMessageCount      (ivx_ai_requests with status = failed)
 *   - routeUsed               (models seen in ivx_ai_requests, else owner-ai)
 *   - errorStatus             (derived from request statuses / missing replies)
 *   - watchdogTraceId         (newest execution-trace id for the conversation)
 *   - persistenceStatus       (supabase_postgres_durable | not_configured)
 *   - searchVisibility        (visible | empty — whether bodies are searchable)
 *
 * Uses the production server credentials carried by the owner-authenticated
 * request context (service-role Supabase client) — never sandbox creds.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { resolveOwnerTables, loadRecentMessages, } from './ivx-owner-ai';
import { getTracesByConversationId } from '../services/ivx-execution-trace-store';
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;
const MAX_MESSAGES_PER_CONVERSATION = 2000;
const MAX_REQUESTS_PER_CONVERSATION = 500;
function errorMessage(error) {
    return error instanceof Error ? error.message : 'Unexpected error.';
}
function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readNullableString(value) {
    const trimmed = readString(value);
    return trimmed.length > 0 ? trimmed : null;
}
/** Public schema is queried directly; non-public schemas use `.schema()`. */
function scopeClient(client, tables) {
    if (tables.dbSchema === 'public') {
        return client;
    }
    const schemaAware = client;
    return typeof schemaAware.schema === 'function' ? schemaAware.schema(tables.dbSchema) : client;
}
function classifyConversationStatus(input) {
    const notes = [];
    if (input.failedMessageCount > 0) {
        notes.push(`${input.failedMessageCount} failed AI request(s)`);
    }
    if (input.userMessageCount > 0 && input.assistantMessageCount === 0) {
        notes.push('owner messages have no assistant reply persisted');
    }
    else if (input.assistantMessageCount < input.userMessageCount) {
        notes.push('fewer assistant replies than owner messages');
    }
    if (input.userMessageCount === 0 && input.assistantMessageCount === 0) {
        notes.push('no persisted messages');
    }
    const errorStatus = notes.length === 0 ? 'ok' : 'attention';
    return { errorStatus, notes };
}
async function auditOneConversation(client, scoped, tables, conversation) {
    const conversationId = readString(conversation.id);
    let userMessageCount = 0;
    let assistantMessageCount = 0;
    let hasVisibleBody = false;
    let readerRowCount = 0;
    let readerError = null;
    // Read messages through the EXACT same proven runtime reader the chat UI and
    // /room-status use (loadRecentMessages). The previous bespoke query in this
    // audit reported 0 even when the conversation had a full durable transcript —
    // reusing the battle-tested reader eliminates that parallel-implementation
    // drift so the audit always reflects what the owner actually sees.
    try {
        const messages = await loadRecentMessages(client, tables, conversationId);
        readerRowCount = messages.length;
        for (const message of messages) {
            const role = readString(message.sender_role).toLowerCase();
            if (role === 'assistant') {
                assistantMessageCount += 1;
            }
            else if (role !== 'system') {
                userMessageCount += 1;
            }
            if (!hasVisibleBody && readNullableString(message.body)) {
                hasVisibleBody = true;
            }
        }
    }
    catch (error) {
        readerError = errorMessage(error);
        console.log('[IVXOwnerAudit] Message read failed', { conversationId, error: readerError });
    }
    let failedMessageCount = 0;
    const models = new Set();
    let requestStatuses = [];
    if (tables.aiRequests) {
        try {
            const requestResult = await scoped
                .from(tables.aiRequests)
                .select('status, model')
                .eq('conversation_id', conversationId)
                .order('created_at', { ascending: false })
                .limit(MAX_REQUESTS_PER_CONVERSATION);
            const rows = (requestResult.data ?? []);
            requestStatuses = rows.map((row) => readString(row.status).toLowerCase()).filter(Boolean);
            failedMessageCount = requestStatuses.filter((status) => status === 'failed').length;
            for (const row of rows) {
                const model = readNullableString(row.model);
                if (model)
                    models.add(model);
            }
        }
        catch (error) {
            console.log('[IVXOwnerAudit] AI request audit failed', { conversationId, error: errorMessage(error) });
        }
    }
    let watchdogTraceId = null;
    try {
        const traces = await getTracesByConversationId(conversationId);
        watchdogTraceId = traces.length > 0 ? traces[0].id : null;
    }
    catch (error) {
        console.log('[IVXOwnerAudit] Trace lookup failed', { conversationId, error: errorMessage(error) });
    }
    const routeUsed = models.size > 0
        ? `POST /api/ivx/owner-ai (${Array.from(models).join(', ')})`
        : 'POST /api/ivx/owner-ai';
    const { errorStatus, notes } = classifyConversationStatus({
        userMessageCount,
        assistantMessageCount,
        failedMessageCount,
    });
    return {
        conversationId,
        slug: readNullableString(conversation.slug),
        title: readNullableString(conversation.title),
        createdAt: readNullableString(conversation.created_at),
        lastMessageAt: readNullableString(conversation.last_message_at) ?? readNullableString(conversation.updated_at),
        userMessageCount,
        assistantMessageCount,
        failedMessageCount,
        routeUsed,
        errorStatus,
        watchdogTraceId,
        persistenceStatus: 'supabase_postgres_durable',
        searchVisibility: hasVisibleBody ? 'visible' : 'empty',
        notes,
        readDiagnostics: {
            reader: 'runtime_loadRecentMessages',
            conversationField: tables.messageConversationField,
            dbSchema: tables.dbSchema,
            readerRowCount,
            readerError,
        },
    };
}
/** GET /api/ivx/owner-audit/recent-conversations — audit the last N conversations. */
export async function handleIVXOwnerAuditRecentConversationsRequest(request) {
    let ownerContext;
    try {
        ownerContext = await assertIVXOwnerOnly(request);
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: errorMessage(error) }, 401);
    }
    try {
        const url = new URL(request.url);
        const requestedLimit = Number.parseInt(url.searchParams.get('limit') ?? '', 10);
        const limit = Number.isFinite(requestedLimit) && requestedLimit > 0
            ? Math.min(requestedLimit, MAX_LIMIT)
            : DEFAULT_LIMIT;
        const client = ownerContext.client;
        const tables = await resolveOwnerTables(client);
        if (tables.schema === 'none') {
            return ownerOnlyJson({
                ok: true,
                audited: false,
                rootCauseFound: true,
                persistenceStatus: 'not_configured',
                brokenTable: tables.conversations,
                rootCause: 'IVX owner-room durable tables (ivx_conversations / ivx_messages) are not reachable with the active backend credentials, so conversations cannot be audited or persisted.',
                limit,
                conversations: [],
            });
        }
        const scoped = scopeClient(client, tables);
        const conversationResult = await scoped
            .from(tables.conversations)
            .select('id,slug,title,updated_at,created_at')
            .order('updated_at', { ascending: false })
            .limit(limit);
        if (conversationResult.error) {
            return ownerOnlyJson({
                ok: false,
                audited: false,
                rootCauseFound: true,
                brokenTable: tables.conversations,
                error: conversationResult.error.message,
            }, 500);
        }
        const conversationRows = (conversationResult.data ?? []);
        const conversations = [];
        for (const row of conversationRows) {
            conversations.push(await auditOneConversation(client, scoped, tables, row));
        }
        const totals = conversations.reduce((acc, entry) => {
            acc.userMessages += entry.userMessageCount;
            acc.assistantMessages += entry.assistantMessageCount;
            acc.failedMessages += entry.failedMessageCount;
            if (entry.errorStatus !== 'ok')
                acc.conversationsWithIssues += 1;
            return acc;
        }, { userMessages: 0, assistantMessages: 0, failedMessages: 0, conversationsWithIssues: 0 });
        const rootCauseFound = totals.conversationsWithIssues > 0;
        const rootCause = rootCauseFound
            ? 'One or more conversations have failed AI requests or missing assistant replies (see per-conversation notes); message persistence itself is durable in Supabase Postgres.'
            : null;
        return ownerOnlyJson({
            ok: true,
            audited: true,
            rootCauseFound,
            rootCause,
            persistenceStatus: 'supabase_postgres_durable',
            schema: tables.schema,
            tables: {
                conversations: tables.conversations,
                messages: tables.messages,
                aiRequests: tables.aiRequests,
            },
            limit,
            count: conversations.length,
            totals,
            conversations,
            generatedAt: new Date().toISOString(),
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, audited: false, error: errorMessage(error) }, 500);
    }
}
export function handleIVXOwnerAuditOptions() {
    return ownerOnlyOptions();
}
