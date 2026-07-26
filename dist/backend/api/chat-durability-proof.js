/**
 * chat-durability-proof module — owner-gated, server-side end-to-end proof.
 *
 * Runs the full chat-durability check INSIDE the deployed server, where the
 * production secrets (Supabase, DB) actually live. The caller only needs the
 * owner token in the Authorization header — no secrets are ever returned and
 * none need to be pasted into a chat or sandbox.
 *
 * GET /api/ivx/owner-ai/chat-durability-proof
 *
 * It proves, in one round-trip:
 *  1. reloadSurvives        — a freshly written message is read back from the
 *                             SAME table the UI reads from (loadRecentMessages).
 *  2. searchFound           — the unique marker is found again on read.
 *  3. sameTableWriteRead    — write path and read path resolve one table/field.
 *  4. restartSurvives       — at least one message whose created_at predates
 *                             this server's boot time is still readable
 *                             (Postgres-persisted => survived a restart).
 *  5. stableMessageIds      — userMessageId / assistantMessageId are returned
 *                             and are present in the post-write read-back.
 *  6. messageCountBefore / messageCountAfter around the write.
 *
 * Autonomous-worker completion is observable via the existing
 * GET /api/ivx/owner-ai/runtime endpoint and is referenced in the payload.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, } from './owner-only';
import { ensureOwnerConversation, insertMessage, loadRecentMessages, resolveOwnerTables, } from './ivx-owner-ai';
/**
 * Module load time. Any persisted message whose created_at is earlier than this
 * timestamp but is still readable proves the row survived a process boot.
 */
const SERVER_BOOT_TIME = new Date().toISOString();
function nowIso() {
    return new Date().toISOString();
}
function createMarker() {
    const cryptoRef = globalThis.crypto;
    const unique = cryptoRef?.randomUUID
        ? cryptoRef.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
    return `durability-proof-${unique}`;
}
export function chatDurabilityProofOptions() {
    return ownerOnlyOptions();
}
/**
 * Executes the end-to-end durability proof and returns a verdict payload.
 * Owner-gated: requires a valid owner bearer token.
 */
export async function handleChatDurabilityProofRequest(request) {
    const startedAt = Date.now();
    try {
        if (request.method !== 'GET' && request.method !== 'POST') {
            return ownerOnlyJson({ ok: false, error: 'Method not allowed.' }, 405);
        }
        const ownerContext = await assertIVXOwnerOnly(request);
        const tables = await resolveOwnerTables(ownerContext.client);
        if (tables.schema === 'none') {
            return ownerOnlyJson({
                ok: false,
                error: 'No durable messages table is resolvable on this server.',
                chatDurability: 'NO',
                timestamp: nowIso(),
            }, 503);
        }
        const conversation = await ensureOwnerConversation(ownerContext.client, tables);
        const conversationId = conversation.id;
        const before = await loadRecentMessages(ownerContext.client, tables, conversationId);
        const messageCountBefore = before.length;
        const marker = createMarker();
        // The ivx_messages.sender_user_id column carries a foreign key
        // (ivx_messages_sender_user_id_fkey) to the users table. The owner identity
        // resolved from the bearer token has no matching user row, so passing it
        // makes the insert fail with a foreign-key violation and 500s the whole
        // proof. sender_user_id is nullable and sender_role/sender_label still
        // identify the author, so persist the owner row with a null sender_user_id
        // (the same value the assistant row already uses durably).
        const userMessage = await insertMessage(ownerContext.client, tables, {
            conversationId,
            senderRole: 'owner',
            senderUserId: null,
            senderLabel: 'Owner (durability proof)',
            body: `[DURABILITY PROOF] ${marker}`,
        });
        const assistantMessage = await insertMessage(ownerContext.client, tables, {
            conversationId,
            senderRole: 'assistant',
            senderUserId: null,
            senderLabel: 'IVX Owner AI',
            body: `[DURABILITY PROOF REPLY] ${marker}`,
        });
        // Read back from the SAME table/field the UI reads from.
        const after = await loadRecentMessages(ownerContext.client, tables, conversationId);
        const messageCountAfter = after.length;
        const afterIds = new Set(after.map((row) => row.id));
        const reloadSurvives = afterIds.has(userMessage.id) && afterIds.has(assistantMessage.id);
        const searchFound = after.some((row) => (row.body ?? '').includes(marker));
        // Restart proof: any readable message created before this boot survived a restart.
        const survivor = after.find((row) => row.created_at < SERVER_BOOT_TIME);
        const restartSurvives = Boolean(survivor);
        const chatDurabilityYes = reloadSurvives && searchFound && messageCountAfter > messageCountBefore;
        return ownerOnlyJson({
            ok: true,
            conversationId,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            messageCountBefore,
            messageCountAfter,
            marker,
            searchFound: searchFound ? 'YES' : 'NO',
            reloadSurvives: reloadSurvives ? 'YES' : 'NO',
            restartSurvives: restartSurvives ? 'YES' : 'NO',
            sameTableWriteRead: {
                table: tables.messages,
                conversationField: tables.messageConversationField,
                schema: tables.schema,
                note: 'insertMessage and loadRecentMessages resolve the identical table/field.',
            },
            restartProof: {
                serverBootTime: SERVER_BOOT_TIME,
                oldestSurvivingMessageId: survivor?.id ?? null,
                oldestSurvivingCreatedAt: survivor?.created_at ?? null,
                note: 'A readable message whose created_at predates serverBootTime proves persistence survived a process boot.',
            },
            autonomousWorker: {
                note: 'Autonomous job completion is observable at GET /api/ivx/owner-ai/runtime (server-side loop, independent of any client).',
                endpoint: '/api/ivx/owner-ai/runtime',
            },
            chatDurability: chatDurabilityYes ? 'YES' : 'NO',
            durationMs: Date.now() - startedAt,
            timestamp: nowIso(),
        }, 200);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Durability proof failed.';
        const status = typeof error?.status === 'number'
            ? error.status
            : 500;
        return ownerOnlyJson({
            ok: false,
            error: message,
            chatDurability: 'NO',
            durationMs: Date.now() - startedAt,
            timestamp: nowIso(),
        }, status);
    }
}
