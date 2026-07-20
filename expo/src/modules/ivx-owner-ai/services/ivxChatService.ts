import AsyncStorage from '@react-native-async-storage/async-storage';
import { IVX_OWNER_AI_PROFILE, IVX_OWNER_AI_ROOM_ID, IVX_OWNER_AI_ROOM_SLUG } from '@/constants/ivx-owner-ai';
import { getIVXOwnerAuthContext, getIVXSupabaseClient } from '@/lib/ivx-supabase-client';
import {
  IVX_OWNER_AI_BUCKET,
  type IVXAttachmentKind,
  type IVXConversation,
  type IVXMessage,
  type IVXUploadInput,
} from '@/shared/ivx';
import { ivxFileUploadService } from './ivxFileUploadService';
import {
  resolveIVXTables,
  mapGenericMessageRow,
  buildMessageInsertPayload,
  buildInboxUpsertPayload,
  getScopedSupabaseClient,
  getRealtimeSchema,
  type ResolvedTables,
} from './ivxTableResolver';
import { isIVXLocalFirstChatEnabled } from './ivxLocalFirstRuntime';
import { mergeOwnerMessages, capOwnerMessages } from './ivxChatMessageMerge';

type IVXConversationRow = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  created_at: string;
  updated_at: string;
  last_message_text: string | null;
  last_message_at: string | null;
};

const IVX_OWNER_FILE_URL_TTL_SECONDS = 60 * 60;
const IVX_LOCAL_MESSAGES_STORAGE_KEY = 'ivx_owner_ai_local_messages';
/**
 * CONVERSATION-ID FIX (2026-06-10): the single durable key for the canonical
 * owner conversation id. After every owner-ai response the client adopts
 * `aiResult.conversationId` and writes it here. Bootstrap (restore) and every
 * save path then key off this exact id, so the id used to SAVE always equals
 * the id used to RESTORE — closing the divergence where messages were written
 * under one id (slug / local-generated room id) but read back under another.
 */
const IVX_CANONICAL_CONVERSATION_ID_KEY = 'ivx_owner_ai_canonical_conversation_id';

/** In-memory mirror of the persisted canonical id for synchronous reads. */
let canonicalConversationIdCache: string | null = null;

/**
 * Read the durably-adopted canonical owner conversation id. Returns null when
 * none has been adopted yet (first ever launch, before any AI response).
 */
async function getCanonicalConversationId(): Promise<string | null> {
  if (canonicalConversationIdCache) {
    return canonicalConversationIdCache;
  }
  try {
    const stored = await AsyncStorage.getItem(IVX_CANONICAL_CONVERSATION_ID_KEY);
    const trimmed = trimOrNull(stored);
    canonicalConversationIdCache = trimmed;
    return trimmed;
  } catch (error) {
    console.log('[IVXChatService] Failed to read canonical conversation id:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

function getCanonicalConversationIdSync(): string | null {
  return canonicalConversationIdCache;
}

/**
 * Adopt and durably persist the backend-returned conversation id as canonical.
 * Idempotent: a no-op when the id is empty or already current.
 */
async function setCanonicalConversationId(conversationId: string | null | undefined): Promise<void> {
  const trimmed = trimOrNull(conversationId);
  if (!trimmed || trimmed === canonicalConversationIdCache) {
    return;
  }
  canonicalConversationIdCache = trimmed;
  try {
    await AsyncStorage.setItem(IVX_CANONICAL_CONVERSATION_ID_KEY, trimmed);
    console.log('[IVXChatService] Canonical conversation id adopted:', trimmed);
  } catch (error) {
    console.log('[IVXChatService] Failed to persist canonical conversation id:', error instanceof Error ? error.message : 'unknown');
  }
}
/**
 * Hard cap on the durable local shadow of the owner conversation. The shadow is
 * a complete mirror of the rendered thread so the chat survives reload / route
 * change / logout / mobile reload and any transient remote-read failure. Capped
 * so it can never grow without bound.
 */
const IVX_LOCAL_MESSAGES_MIRROR_CAP = 400;
const OWNER_REALTIME_POLL_INTERVAL_MS = 5_000;
const OWNER_REALTIME_FALLBACK_DELAY_MS = 6_000;
const activeOwnerRealtimeTeardowns = new Set<string>();
const activeOwnerRealtimeSubscriptions = new Set<string>();
const ownerLocalMessageListeners = new Set<(message: IVXMessage) => void>();

export type IVXOwnerRealtimeSubscriptionAudit = {
  activeChannelCount: number;
  activeChannels: string[];
  teardownCount: number;
  localListenerCount: number;
};

export function getOwnerRealtimeSubscriptionAudit(): IVXOwnerRealtimeSubscriptionAudit {
  return {
    activeChannelCount: activeOwnerRealtimeSubscriptions.size,
    activeChannels: Array.from(activeOwnerRealtimeSubscriptions.values()).sort(),
    teardownCount: activeOwnerRealtimeTeardowns.size,
    localListenerCount: ownerLocalMessageListeners.size,
  };
}

export type IVXOwnerSendAudit = {
  transport: 'remote_db_insert' | 'local_fallback' | 'auth_session_failure';
  conversationId: string;
  messageId: string;
  senderRole: 'owner' | 'assistant' | 'system';
  reason: string;
  observedAt: string;
};

export type IVXOwnerReceiveAudit = {
  transport: 'realtime_event' | 'local_listener';
  conversationId: string;
  messageId: string;
  senderRole: 'owner' | 'assistant' | 'system';
  reason: string;
  observedAt: string;
};

let lastOwnerSendAudit: IVXOwnerSendAudit | null = null;
let lastOwnerReceiveAudit: IVXOwnerReceiveAudit | null = null;

function setLastOwnerSendAudit(audit: IVXOwnerSendAudit): void {
  lastOwnerSendAudit = audit;
  console.log('[IVXChatService] Send audit updated:', audit);
}

export function getLastOwnerSendAudit(): IVXOwnerSendAudit | null {
  return lastOwnerSendAudit;
}

function setLastOwnerReceiveAudit(audit: IVXOwnerReceiveAudit): void {
  lastOwnerReceiveAudit = audit;
  console.log('[IVXChatService] Receive audit updated:', audit);
}

export function getLastOwnerReceiveAudit(): IVXOwnerReceiveAudit | null {
  return lastOwnerReceiveAudit;
}

function trackOwnerSendAudit(input: {
  transport: IVXOwnerSendAudit['transport'];
  conversationId: string;
  messageId: string;
  senderRole: IVXOwnerSendAudit['senderRole'];
  reason: string;
}): void {
  setLastOwnerSendAudit({
    transport: input.transport,
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderRole: input.senderRole,
    reason: input.reason,
    observedAt: nowIso(),
  });
}

function resolveLocalAuditTransport(ownerContextAvailable: boolean): IVXOwnerSendAudit['transport'] {
  return ownerContextAvailable ? 'local_fallback' : 'auth_session_failure';
}

function resolveLocalAuditReason(ownerContextAvailable: boolean, detail: string): string {
  return ownerContextAvailable ? detail : `Owner auth/session unavailable. ${detail}`;
}

function trackOwnerReceiveAudit(input: {
  transport: IVXOwnerReceiveAudit['transport'];
  conversationId: string;
  messageId: string;
  senderRole: IVXOwnerReceiveAudit['senderRole'];
  reason: string;
}): void {
  setLastOwnerReceiveAudit({
    transport: input.transport,
    conversationId: input.conversationId,
    messageId: input.messageId,
    senderRole: input.senderRole,
    reason: input.reason,
    observedAt: nowIso(),
  });
}

function nowIso(): string {
  return new Date().toISOString();
}

function createLocalMessageId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }

  return `ivx-local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmedValue = value?.trim() ?? '';
  return trimmedValue.length > 0 ? trimmedValue : null;
}

function getMessagePreview(value: string | null): string | null {
  const trimmedValue = trimOrNull(value);
  if (!trimmedValue) {
    return null;
  }

  if (trimmedValue.length <= 80) {
    return trimmedValue;
  }

  return `${trimmedValue.slice(0, 77)}...`;
}

async function loadLocalMessages(): Promise<IVXMessage[]> {
  try {
    const stored = await AsyncStorage.getItem(IVX_LOCAL_MESSAGES_STORAGE_KEY);
    if (!stored) {
      return [];
    }

    const parsed = JSON.parse(stored) as IVXMessage[];
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed;
  } catch (error) {
    console.log('[IVXChatService] Failed to load local messages:', error instanceof Error ? error.message : 'unknown');
    return [];
  }
}

async function saveLocalMessages(messages: IVXMessage[]): Promise<void> {
  try {
    const bounded = capOwnerMessages(messages, IVX_LOCAL_MESSAGES_MIRROR_CAP);
    await AsyncStorage.setItem(IVX_LOCAL_MESSAGES_STORAGE_KEY, JSON.stringify(bounded));
  } catch (error) {
    console.log('[IVXChatService] Failed to save local messages:', error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * Mirror the authoritative rendered thread (remote + local merged) into the
 * durable local shadow so the conversation survives a reload / route change /
 * logout / mobile reload and any transient remote-read failure. The local
 * shadow is the fallback `listOwnerMessages` returns when the remote read
 * fails — keeping it a complete superset is what prevents "chat disappears".
 */
async function persistOwnerMessageMirror(mergedMessages: IVXMessage[], conversationId: string): Promise<void> {
  try {
    const mirror = capOwnerMessages(mergedMessages, IVX_LOCAL_MESSAGES_MIRROR_CAP);
    await AsyncStorage.setItem(IVX_LOCAL_MESSAGES_STORAGE_KEY, JSON.stringify(mirror));
    console.log('[IVXChatHydration] Local mirror updated', {
      conversationId,
      mirrored: mirror.length,
      cappedFrom: mergedMessages.length,
    });
  } catch (error) {
    console.log('[IVXChatHydration] Local mirror persist failed (conversation still rendered):', error instanceof Error ? error.message : 'unknown');
  }
}

/**
 * Durably add already-rendered owner-chat messages (committed AI replies, sent
 * owner turns) into the local AsyncStorage shadow so they survive a reload even
 * when the remote read on the next load does not return them (conversation-id
 * mismatch or a transient remote-read failure). This is the guarantee that the
 * chat never disappears: the local shadow is always a superset of what the owner
 * has seen, and `mergeOwnerMessages` restores it on every reload.
 *
 * Idempotent: messages already present (by signature or content key) are not
 * duplicated, and the shadow stays bounded.
 */
async function appendOwnerMessagesToLocalMirror(messages: IVXMessage[]): Promise<void> {
  const durable = messages.filter((message) => {
    const body = trimOrNull(message.body);
    return (body !== null && body.length > 0) || !!message.attachmentUrl;
  });
  if (durable.length === 0) {
    return;
  }

  try {
    const existing = await loadLocalMessages();
    // Union existing (authoritative base) with the newly rendered messages,
    // deduped by exact signature + content key, then re-cap and persist.
    const merged = mergeOwnerMessages(existing, durable);
    await saveLocalMessages(merged);
    console.log('[IVXChatHydration] Durable mirror appended', {
      added: durable.length,
      total: merged.length,
    });
  } catch (error) {
    console.log('[IVXChatHydration] Durable mirror append failed (message still rendered):', error instanceof Error ? error.message : 'unknown');
  }
}

function getLocalConversation(): IVXConversation {
  return {
    id: IVX_OWNER_AI_ROOM_ID,
    slug: IVX_OWNER_AI_ROOM_SLUG,
    title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
    subtitle: 'Private IVX workspace. Messages stay on this device.',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    lastMessageText: null,
    lastMessageAt: null,
  };
}

function createLocalMessage(input: {
  conversationId: string;
  senderUserId: string | null;
  senderRole: 'owner' | 'assistant' | 'system';
  senderLabel: string | null;
  body: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
  attachmentKind: IVXAttachmentKind;
}): IVXMessage {
  const timestamp = nowIso();
  return {
    id: createLocalMessageId(),
    conversationId: input.conversationId,
    senderUserId: input.senderUserId,
    senderRole: input.senderRole,
    senderLabel: input.senderLabel,
    body: input.body,
    attachmentUrl: input.attachmentUrl ?? null,
    attachmentName: input.attachmentName ?? null,
    attachmentMime: input.attachmentMime ?? null,
    attachmentSize: input.attachmentSize ?? null,
    attachmentKind: input.attachmentKind,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

async function appendLocalMessage(message: IVXMessage): Promise<void> {
  const currentMessages = await loadLocalMessages();
  await saveLocalMessages([...currentMessages, message]);
}

function emitLocalOwnerMessage(message: IVXMessage, reason: string): void {
  console.log('[IVXChatService] Emitting local owner message:', {
    reason,
    messageId: message.id,
    senderRole: message.senderRole,
    conversationId: message.conversationId,
  });

  ownerLocalMessageListeners.forEach((listener) => {
    try {
      listener(message);
    } catch (error) {
      console.log('[IVXChatService] Local owner message listener failed:', error instanceof Error ? error.message : 'unknown');
    }
  });
}

function createLocalAttachmentMessage(input: {
  conversationId: string;
  senderUserId: string | null;
  senderLabel: string | null;
  body: string | null;
  upload: IVXUploadInput;
}): IVXMessage {
  const attachmentMime = trimOrNull(input.upload.type);
  const attachmentUrl = trimOrNull(input.upload.uri);
  const attachmentName = trimOrNull(input.upload.name) ?? 'Attachment';
  const attachmentSize = typeof input.upload.size === 'number' ? input.upload.size : null;

  return createLocalMessage({
    conversationId: input.conversationId,
    senderUserId: input.senderUserId,
    senderRole: 'owner',
    senderLabel: input.senderLabel,
    body: trimOrNull(input.body),
    attachmentUrl,
    attachmentName,
    attachmentMime,
    attachmentSize,
    attachmentKind: getAttachmentKindFromMime(attachmentMime),
  });
}

function getAttachmentKindFromMime(mimeType: string | null | undefined): IVXAttachmentKind {
  const normalizedMimeType = mimeType?.trim().toLowerCase() ?? '';

  if (!normalizedMimeType) {
    return 'file';
  }

  if (normalizedMimeType.startsWith('image/')) {
    return 'image';
  }

  if (normalizedMimeType.startsWith('video/')) {
    return 'video';
  }

  if (normalizedMimeType === 'application/pdf') {
    return 'pdf';
  }

  return 'file';
}

function mapConversation(row: Record<string, unknown>): IVXConversation {
  const fallbackId = ((row.id ?? IVX_OWNER_AI_ROOM_ID) as string) || IVX_OWNER_AI_ROOM_ID;
  return {
    id: fallbackId,
    slug: ((row.slug ?? fallbackId ?? IVX_OWNER_AI_ROOM_SLUG) as string) || IVX_OWNER_AI_ROOM_SLUG,
    title: (row.title ?? IVX_OWNER_AI_PROFILE.sharedRoom.title) as string,
    subtitle: (row.subtitle ?? IVX_OWNER_AI_PROFILE.sharedRoom.subtitle ?? null) as string | null,
    createdAt: (row.created_at ?? nowIso()) as string,
    updatedAt: (row.updated_at ?? nowIso()) as string,
    lastMessageText: (row.last_message_text ?? null) as string | null,
    lastMessageAt: (row.last_message_at ?? null) as string | null,
  };
}

function getRowsFromSelectResult(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) {
    return data.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object');
  }

  if (data && typeof data === 'object') {
    return [data as Record<string, unknown>];
  }

  return [];
}

function getFirstRowFromSelectResult(data: unknown, context: string): Record<string, unknown> | null {
  const rows = getRowsFromSelectResult(data);

  if (rows.length > 1) {
    console.log(`[IVXChatService] ${context} returned multiple rows; using the first row to avoid singular coercion failure:`, {
      rowCount: rows.length,
    });
  }

  return rows[0] ?? null;
}

function getOwnerConversationLookupAttempts(_tables?: ResolvedTables): Array<{ field: 'id' | 'slug' | 'title'; value: string }> {
  return [
    { field: 'id', value: IVX_OWNER_AI_ROOM_ID },
    { field: 'slug', value: IVX_OWNER_AI_ROOM_SLUG },
    { field: 'title', value: IVX_OWNER_AI_PROFILE.sharedRoom.title },
  ];
}

function buildConversationInsertPayloads(schema: ResolvedTables['schema']): Record<string, unknown>[] {
  if (schema === 'generic') {
    return [
      {
        id: IVX_OWNER_AI_ROOM_ID,
        slug: IVX_OWNER_AI_ROOM_SLUG,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
        last_message_text: null,
        last_message_at: null,
      },
      {
        id: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
        last_message_text: null,
        last_message_at: null,
      },
      {
        id: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
      },
      {
        id: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      },
    ];
  }

  return [
    {
      id: IVX_OWNER_AI_ROOM_ID,
      slug: IVX_OWNER_AI_ROOM_SLUG,
      title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_message_text: null,
      last_message_at: null,
    },
    {
      id: IVX_OWNER_AI_ROOM_ID,
      title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
      created_at: nowIso(),
      updated_at: nowIso(),
      last_message_text: null,
      last_message_at: null,
    },
    {
      id: IVX_OWNER_AI_ROOM_ID,
      title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
    },
  ];
}

function formatInsertPayloadKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).sort();
}

function getConversationTimestampScore(row: Record<string, unknown>): number {
  const updatedAt = typeof row.updated_at === 'string' ? Date.parse(row.updated_at) : Number.NaN;
  if (Number.isFinite(updatedAt)) {
    return updatedAt;
  }

  const createdAt = typeof row.created_at === 'string' ? Date.parse(row.created_at) : Number.NaN;
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }

  return 0;
}

function scoreOwnerConversationRow(row: Record<string, unknown>): number {
  let score = 0;

  if (typeof row.id === 'string' && row.id === IVX_OWNER_AI_ROOM_ID) {
    score += 1000;
  }

  if (typeof row.slug === 'string' && row.slug === IVX_OWNER_AI_ROOM_SLUG) {
    score += 600;
  }

  if (typeof row.title === 'string' && row.title === IVX_OWNER_AI_PROFILE.sharedRoom.title) {
    score += 250;
  }

  return score + getConversationTimestampScore(row) / 1_000_000_000_000;
}

function pickBestOwnerConversationRow(rows: Record<string, unknown>[], context: string): Record<string, unknown> | null {
  if (rows.length === 0) {
    return null;
  }

  const sortedRows = [...rows].sort((left, right) => scoreOwnerConversationRow(right) - scoreOwnerConversationRow(left));
  const selectedRow = sortedRows[0] ?? null;

  if (sortedRows.length > 1) {
    console.log(`[IVXChatService] ${context} found multiple candidate owner conversations; selecting best match:`, {
      candidateCount: sortedRows.length,
      selectedRow: describeConversationRow(selectedRow),
      candidateRows: sortedRows.slice(0, 5).map((row) => describeConversationRow(row)),
    });
  }

  return selectedRow;
}

async function loadRecentOwnerConversationCandidates(
  tables: ResolvedTables,
  context: string,
): Promise<Record<string, unknown>[]> {
  const client = getIVXSupabaseClient();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const primaryOrderField = tables.schema === 'generic' ? 'last_message_at' : 'updated_at';
  let recentResult = await scopedClient
    .from(tables.conversations)
    .select('*')
    .order(primaryOrderField, { ascending: false })
    .limit(10);

  if (recentResult.error && primaryOrderField !== 'last_message_at') {
    console.log(`[IVXChatService] ${context} recent conversation probe retrying with last_message_at order:`, {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      previousError: recentResult.error.message,
    });
    recentResult = await scopedClient
      .from(tables.conversations)
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(10);
  }

  if (recentResult.error) {
    console.log(`[IVXChatService] ${context} recent conversation probe failed:`, {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      message: recentResult.error.message,
    });
    return [];
  }

  const recentRows = getRowsFromSelectResult(recentResult.data).filter((row) => {
    const rowSlug = typeof row.slug === 'string' ? row.slug : null;
    const rowTitle = typeof row.title === 'string' ? row.title : null;
    return rowSlug === IVX_OWNER_AI_ROOM_SLUG || rowTitle === IVX_OWNER_AI_PROFILE.sharedRoom.title;
  });

  console.log(`[IVXChatService] ${context} recent conversation probe result:`, {
    rowCount: recentRows.length,
    sampleRow: describeConversationRow(recentRows[0] ?? null),
  });

  return recentRows;
}

function dedupeConversationRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const dedupedRows: Record<string, unknown>[] = [];

  for (const row of rows) {
    const key = `${typeof row.id === 'string' ? row.id : 'missing-id'}:${typeof row.slug === 'string' ? row.slug : 'missing-slug'}:${typeof row.title === 'string' ? row.title : 'missing-title'}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    dedupedRows.push(row);
  }

  return dedupedRows;
}

async function recoverOwnerConversationRowAfterWriteFailure(
  tables: ResolvedTables,
  context: string,
): Promise<Record<string, unknown> | null> {
  const exactMatches = await findOwnerConversationRow(tables, `${context} exact lookup`, { includeRecentProbe: false });
  if (exactMatches) {
    return exactMatches;
  }

  const recentCandidates = await loadRecentOwnerConversationCandidates(tables, context);
  const recoveredRow = pickBestOwnerConversationRow(recentCandidates, `${context} recent recovery`);

  if (recoveredRow) {
    console.log(`[IVXChatService] ${context} recovered owner conversation from recent candidates:`, {
      resolvedRow: describeConversationRow(recoveredRow),
    });
  }

  return recoveredRow;
}


function describeConversationRow(row: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!row) {
    return null;
  }

  return {
    id: typeof row.id === 'string' ? row.id : null,
    slug: typeof row.slug === 'string' ? row.slug : null,
    title: typeof row.title === 'string' ? row.title : null,
    subtitle: typeof row.subtitle === 'string' ? row.subtitle : null,
    created_at: typeof row.created_at === 'string' ? row.created_at : null,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : null,
    last_message_text: typeof row.last_message_text === 'string' ? row.last_message_text : null,
    last_message_at: typeof row.last_message_at === 'string' ? row.last_message_at : null,
  };
}

async function findOwnerConversationRow(
  tables: ResolvedTables,
  context: string,
  options?: { includeRecentProbe?: boolean },
): Promise<Record<string, unknown> | null> {
  const client = getIVXSupabaseClient();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const lookupAttempts = getOwnerConversationLookupAttempts(tables);
  const candidateRows: Record<string, unknown>[] = [];

  for (const lookup of lookupAttempts) {
    console.log(`[IVXChatService] ${context} lookup select:`, {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      select: '*',
      where: `${lookup.field} = ${lookup.value}`,
      canonicalId: IVX_OWNER_AI_ROOM_ID,
      canonicalSlug: IVX_OWNER_AI_ROOM_SLUG,
    });

    const lookupResult = await scopedClient.from(tables.conversations).select('*').eq(lookup.field, lookup.value).limit(5);

    if (lookupResult.error) {
      console.log(`[IVXChatService] ${context} lookup failed:`, {
        field: lookup.field,
        value: lookup.value,
        message: lookupResult.error.message,
      });
      continue;
    }

    const rows = getRowsFromSelectResult(lookupResult.data);
    console.log(`[IVXChatService] ${context} lookup result:`, {
      field: lookup.field,
      value: lookup.value,
      rowCount: rows.length,
      sampleRow: describeConversationRow(rows[0] ?? null),
    });

    candidateRows.push(...rows);
  }

  if (options?.includeRecentProbe ?? true) {
    candidateRows.push(...(await loadRecentOwnerConversationCandidates(tables, context)));
  }

  const row = pickBestOwnerConversationRow(dedupeConversationRows(candidateRows), context);
  if (row) {
    console.log(`[IVXChatService] ${context} resolved owner conversation:`, {
      resolvedRow: describeConversationRow(row),
    });
    return row;
  }

  console.log(`[IVXChatService] ${context} found no owner conversation row`, {
    schema: tables.schema,
    dbSchema: tables.dbSchema,
    conversationTable: tables.conversations,
    canonicalId: IVX_OWNER_AI_ROOM_ID,
    canonicalSlug: IVX_OWNER_AI_ROOM_SLUG,
    lookupFields: getOwnerConversationLookupAttempts(tables).map((attempt) => attempt.field),
  });
  return null;
}

function isMissingSlugColumn(message: string): boolean {
  const normalizedMessage = (typeof message === 'string' ? message : '').trim().toLowerCase();
  return normalizedMessage.includes('column conversations.slug does not exist')
    || normalizedMessage.includes('column ivx_conversations.slug does not exist')
    || normalizedMessage.includes('could not find the column') && normalizedMessage.includes('slug');
}

function isRemoteUrl(value: string | null | undefined): boolean {
  const trimmedValue = value?.trim() ?? '';
  return /^https?:\/\//i.test(trimmedValue);
}

async function resolveAttachmentUrl(rawAttachmentUrl: string | null): Promise<string | null> {
  const trimmedAttachmentUrl = trimOrNull(rawAttachmentUrl);

  if (!trimmedAttachmentUrl) {
    return null;
  }

  if (isRemoteUrl(trimmedAttachmentUrl)) {
    return trimmedAttachmentUrl;
  }

  const client = getIVXSupabaseClient();
  const signedUrlResult = await client.storage.from(IVX_OWNER_AI_BUCKET).createSignedUrl(trimmedAttachmentUrl, IVX_OWNER_FILE_URL_TTL_SECONDS);

  if (signedUrlResult.error || !signedUrlResult.data?.signedUrl) {
    console.log('[IVXChatService] Failed to sign attachment URL:', signedUrlResult.error?.message ?? 'missing signed url');
    return null;
  }

  return signedUrlResult.data.signedUrl;
}

async function mapMessage(row: Record<string, unknown>): Promise<IVXMessage> {
  const normalized = mapGenericMessageRow(row);
  return {
    id: normalized.id,
    conversationId: normalized.conversation_id,
    senderUserId: normalized.sender_user_id,
    senderRole: normalized.sender_role,
    senderLabel: normalized.sender_label,
    body: normalized.body,
    attachmentUrl: await resolveAttachmentUrl(normalized.attachment_url),
    attachmentName: normalized.attachment_name,
    attachmentMime: normalized.attachment_mime,
    attachmentSize: normalized.attachment_size,
    attachmentKind: (normalized.attachment_kind as IVXAttachmentKind | null) ?? getAttachmentKindFromMime(normalized.attachment_mime),
    createdAt: normalized.created_at,
    updatedAt: normalized.updated_at,
  };
}

async function ensureInboxState(tables: ResolvedTables, conversationId: string, userId: string): Promise<void> {
  const client = getIVXSupabaseClient();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const { payload, onConflict } = buildInboxUpsertPayload(tables.schema, conversationId, userId);

  const upsertResult = await scopedClient.from(tables.inboxState).upsert(payload, {
    onConflict,
  });

  if (upsertResult.error) {
    console.log('[IVXChatService] Failed to ensure inbox state (non-blocking):', upsertResult.error.message);
  }
}

async function updateConversationSummary(tables: ResolvedTables, conversationId: string, messagePreview: string | null): Promise<void> {
  const client = getIVXSupabaseClient();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const updateResult = await scopedClient.from(tables.conversations).update({
    updated_at: nowIso(),
    last_message_text: getMessagePreview(messagePreview),
    last_message_at: nowIso(),
  }).eq('id', conversationId);

  if (updateResult.error) {
    console.log('[IVXChatService] Failed to update summary (non-blocking):', updateResult.error.message);
  }
}

async function insertMessage(tables: ResolvedTables, input: {
  conversationId: string;
  senderUserId: string | null;
  senderRole: string;
  senderLabel: string | null;
  body: string | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentMime?: string | null;
  attachmentSize?: number | null;
  attachmentKind?: string;
}): Promise<IVXMessage> {
  const client = getIVXSupabaseClient();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const insertPayload = buildMessageInsertPayload(tables.schema, input);

  console.log('[IVXChatService] Inserting message into:', tables.messages, 'schema:', tables.schema, 'dbSchema:', tables.dbSchema);
  const insertResult = await scopedClient.from(tables.messages).insert(insertPayload).select('*');

  if (insertResult.error) {
    console.log('[IVXChatService] Failed to insert message:', insertResult.error.message);
    throw new Error(insertResult.error.message);
  }

  const insertedRow = getFirstRowFromSelectResult(insertResult.data, 'Message insert readback');
  if (!insertedRow) {
    throw new Error('Message insert did not return a readable row.');
  }

  return await mapMessage(insertedRow);
}

/**
 * CONVERSATION-ID FIX (2026-06-10): the single restore entry point. It resolves
 * the raw conversation, then — if a canonical id has been adopted from a prior
 * owner-ai response — forces that id onto the returned conversation so RESTORE
 * always keys off the exact id used to SAVE. This is the ONLY conversation-id
 * source the chat screen reads; all alternate keys (slug literals, locally
 * generated room ids) are removed.
 */
async function bootstrapOwnerConversation(): Promise<IVXConversation> {
  const conversation = await bootstrapOwnerConversationRaw();
  const canonicalId = await getCanonicalConversationId();
  if (canonicalId && canonicalId !== conversation.id) {
    console.log('[IVXChatService] Applying adopted canonical conversation id on restore:', {
      rawId: conversation.id,
      canonicalId,
    });
    return { ...conversation, id: canonicalId };
  }
  return conversation;
}

async function bootstrapOwnerConversationRaw(): Promise<IVXConversation> {
  if (isIVXLocalFirstChatEnabled()) {
    console.log('[IVXChatService] Local-first mode active; using local owner conversation');
    return getLocalConversation();
  }

  const client = getIVXSupabaseClient();
  const tables = await resolveIVXTables();

  console.log('[IVXChatService] Bootstrapping conversation using schema:', tables.schema, 'dbSchema:', tables.dbSchema, 'table:', tables.conversations);

  let ownerContext = null as Awaited<ReturnType<typeof getIVXOwnerAuthContext>> | null;
  try {
    ownerContext = await getIVXOwnerAuthContext();
  } catch (error) {
    console.log('[IVXChatService] Owner auth context unavailable, using local owner conversation:', error instanceof Error ? error.message : 'unknown');
    return getLocalConversation();
  }

  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const existingConversation = await findOwnerConversationRow(tables, 'Owner conversation lookup');
  if (existingConversation) {
    await ensureInboxState(tables, (existingConversation.id as string) ?? IVX_OWNER_AI_ROOM_ID, ownerContext.userId);
    return mapConversation(existingConversation);
  }

  const insertPayloads = buildConversationInsertPayloads(tables.schema);
  let insertResult = null as Awaited<ReturnType<typeof client.from>> extends never ? never : { data: unknown; error: { message: string } | null } | null;
  let successfulPayload = null as Record<string, unknown> | null;
  let lastInsertError = null as string | null;

  for (const payload of insertPayloads) {
    console.log('[IVXChatService] Owner conversation insert attempt:', {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      payload,
      payloadKeys: formatInsertPayloadKeys(payload),
    });

    const currentResult = await scopedClient.from(tables.conversations).insert(payload).select('*');
    insertResult = currentResult;

    if (!currentResult.error) {
      successfulPayload = payload;
      break;
    }

    lastInsertError = currentResult.error.message;
    console.log('[IVXChatService] Owner conversation insert attempt failed:', {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      payloadKeys: formatInsertPayloadKeys(payload),
      message: currentResult.error.message,
      missingSlugColumn: isMissingSlugColumn(currentResult.error.message),
    });
  }

  if (!insertResult || insertResult.error) {
    console.log('[IVXChatService] Owner conversation insert returned:', {
      message: lastInsertError ?? insertResult?.error?.message ?? 'unknown insert failure',
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      table: tables.conversations,
      attemptedPayloadKeys: insertPayloads.map((payload) => formatInsertPayloadKeys(payload)),
    });
    const fallbackConversation = await recoverOwnerConversationRowAfterWriteFailure(tables, 'Owner conversation fallback readback');
    if (!fallbackConversation) {
      console.log('[IVXChatService] Owner conversation recovery failed after insert error; using local owner conversation instead:', {
        schema: tables.schema,
        dbSchema: tables.dbSchema,
        table: tables.conversations,
        canonicalId: IVX_OWNER_AI_ROOM_ID,
        canonicalSlug: IVX_OWNER_AI_ROOM_SLUG,
        message: lastInsertError ?? insertResult?.error?.message ?? 'unknown insert failure',
      });
      return getLocalConversation();
    }
    await ensureInboxState(tables, (fallbackConversation.id as string) ?? IVX_OWNER_AI_ROOM_ID, ownerContext.userId);
    return mapConversation(fallbackConversation);
  }

  console.log('[IVXChatService] Owner conversation insert readback:', {
    schema: tables.schema,
    dbSchema: tables.dbSchema,
    table: tables.conversations,
    successfulPayloadKeys: formatInsertPayloadKeys(successfulPayload ?? {}),
    row: describeConversationRow(getFirstRowFromSelectResult(insertResult.data, 'Owner conversation insert readback preview')),
  });

  const insertedConversation = getFirstRowFromSelectResult(insertResult.data, 'Owner conversation insert readback')
    ?? await findOwnerConversationRow(tables, 'Owner conversation insert post-write lookup');
  if (!insertedConversation) {
    throw new Error('Owner conversation insert returned no rows after successful write.');
  }

  await ensureInboxState(tables, (insertedConversation.id as string) ?? IVX_OWNER_AI_ROOM_ID, ownerContext.userId);
  return mapConversation(insertedConversation);
}

export type IVXOwnerMessageSearchResult = {
  message: IVXMessage;
  conversationId: string;
  conversationTitle: string;
  snippet: string;
  matchedAt: string;
  source: 'remote_db' | 'local_cache';
};

function buildSearchSnippet(body: string | null, query: string): string {
  const normalizedBody = (body ?? '').replace(/\s+/g, ' ').trim();
  if (!normalizedBody) {
    return '';
  }

  const idx = normalizedBody.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) {
    return normalizedBody.length > 160 ? `${normalizedBody.slice(0, 157)}...` : normalizedBody;
  }

  const start = Math.max(0, idx - 40);
  const end = Math.min(normalizedBody.length, idx + query.length + 80);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < normalizedBody.length ? '...' : '';
  return `${prefix}${normalizedBody.slice(start, end)}${suffix}`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of values) {
    const normalizedValue = trimOrNull(value);
    if (!normalizedValue || seen.has(normalizedValue)) {
      continue;
    }
    seen.add(normalizedValue);
    output.push(normalizedValue);
  }
  return output;
}

async function loadConversationTitleMap(tables: ResolvedTables, conversationIds: string[], fallbackTitle: string): Promise<Map<string, string>> {
  const titleMap = new Map<string, string>();
  const ids = uniqueStrings(conversationIds).slice(0, 200);
  if (ids.length === 0 || tables.schema === 'none') {
    return titleMap;
  }

  try {
    const client = getIVXSupabaseClient();
    const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
    const result = await scopedClient
      .from(tables.conversations)
      .select('*')
      .in('id', ids);

    if (result.error) {
      console.log('[IVXChatService] Conversation title lookup failed for search:', result.error.message);
      return titleMap;
    }

    for (const row of getRowsFromSelectResult(result.data)) {
      const conversation = mapConversation(row);
      titleMap.set(conversation.id, conversation.title || fallbackTitle);
    }
  } catch (error) {
    console.log('[IVXChatService] Conversation title lookup exception for search:', error instanceof Error ? error.message : 'unknown');
  }

  return titleMap;
}

async function searchOwnerMessages(input: {
  query: string;
  limit?: number;
}): Promise<IVXOwnerMessageSearchResult[]> {
  const trimmed = input.query.trim();
  if (trimmed.length < 2) {
    return [];
  }

  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const conversation = await bootstrapOwnerConversation();
  const fallbackConversationTitle = conversation.title || IVX_OWNER_AI_PROFILE.sharedRoom.title;
  const localMessages = await loadLocalMessages();
  const localLower = trimmed.toLowerCase();
  const localConversationTitleMap = new Map<string, string>([
    [conversation.id, fallbackConversationTitle],
    [IVX_OWNER_AI_ROOM_ID, IVX_OWNER_AI_PROFILE.sharedRoom.title],
  ]);
  const localMatches: IVXOwnerMessageSearchResult[] = localMessages
    .filter((message) => (message.body ?? '').toLowerCase().includes(localLower))
    .map((message) => {
      const conversationId = message.conversationId || conversation.id;
      return {
        message,
        conversationId,
        conversationTitle: localConversationTitleMap.get(conversationId) ?? fallbackConversationTitle,
        snippet: buildSearchSnippet(message.body, trimmed),
        matchedAt: message.createdAt,
        source: 'local_cache' as const,
      };
    });

  if (isIVXLocalFirstChatEnabled()) {
    console.log('[IVXChatService] Local-first search returned', localMatches.length, 'matches');
    return localMatches.slice(0, limit);
  }

  const tables = await resolveIVXTables();
  if (tables.schema === 'none') {
    console.log('[IVXChatService] No IVX tables; returning local-only search:', localMatches.length);
    return localMatches.slice(0, limit);
  }

  try {
    const client = getIVXSupabaseClient();
    const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
    const bodyColumn = 'body';
    const escaped = trimmed.replace(/[%_\\]/g, (m) => `\\${m}`);
    const ilikePattern = `%${escaped}%`;

    console.log('[IVXChatService] Searching all owner conversations', {
      table: tables.messages,
      query: trimmed,
      limit,
      schema: tables.schema,
      dbSchema: tables.dbSchema,
    });

    const result = await scopedClient
      .from(tables.messages)
      .select('*')
      .ilike(bodyColumn, ilikePattern)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (result.error) {
      console.log('[IVXChatService] Server search failed, returning local matches:', result.error.message);
      return localMatches.slice(0, limit);
    }

    const remoteMessages = await Promise.all((result.data ?? []).map((row) => mapMessage(row as Record<string, unknown>)));
    const titleMap = await loadConversationTitleMap(tables, remoteMessages.map((message) => message.conversationId), fallbackConversationTitle);
    const remoteMatches: IVXOwnerMessageSearchResult[] = remoteMessages.map((message) => {
      const conversationId = message.conversationId || conversation.id;
      return {
        message,
        conversationId,
        conversationTitle: titleMap.get(conversationId) ?? fallbackConversationTitle,
        snippet: buildSearchSnippet(message.body, trimmed),
        matchedAt: message.createdAt,
        source: 'remote_db' as const,
      };
    });

    const seen = new Set<string>();
    const merged: IVXOwnerMessageSearchResult[] = [];
    for (const match of [...remoteMatches, ...localMatches]) {
      const dedupeKey = `${match.source}:${match.message.id}:${match.conversationId}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(match);
    }

    merged.sort((a, b) => new Date(b.matchedAt).getTime() - new Date(a.matchedAt).getTime());
    return merged.slice(0, limit);
  } catch (error) {
    console.log('[IVXChatService] Search exception, returning local matches:', error instanceof Error ? error.message : 'unknown');
    return localMatches.slice(0, limit);
  }
}

async function listOwnerMessages(): Promise<IVXMessage[]> {
  const localMessages = await loadLocalMessages();
  if (isIVXLocalFirstChatEnabled()) {
    console.log('[IVXChatService] Local-first mode active; listing local owner messages:', localMessages.length);
    return localMessages;
  }

  const client = getIVXSupabaseClient();
  const tables = await resolveIVXTables();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const conversation = await bootstrapOwnerConversation();
  const messageConversationField = tables.schema === 'generic' ? 'room_id' : 'conversation_id';

  if (tables.schema === 'none') {
    console.log('[IVXChatService] No IVX tables available, listing local owner messages');
    return localMessages;
  }

  // OPEN-ON-LATEST BOUNDED LOAD (2026-07-19): fetch the most recent N messages
  // newest-first from the DB, then reverse in-memory for chronological display.
  // Previously this query had NO LIMIT and ordered ascending, so a months-old
  // conversation with hundreds of turns forced the FlatList to lay out every
  // message before scroll-to-latest could work — the scroll retry gave up
  // after ~1.5s and the owner was left looking at months-old messages. Bounding
  // the initial load to the recent tail makes the latest turn visible in
  // <200ms. Older history remains accessible via the durable local mirror
  // (capped at IVX_LOCAL_MESSAGES_MIRROR_CAP=400) which is merged below.
  const INITIAL_PAGE_LIMIT = 120;
  console.log('[IVXChatService] Listing messages from:', tables.messages, 'conversation:', conversation.id, 'dbSchema:', tables.dbSchema, 'localFallbackCount:', localMessages.length, 'messageConversationField:', messageConversationField, 'initialPageLimit:', INITIAL_PAGE_LIMIT);
  const messageResult = await scopedClient.from(tables.messages).select('*').eq(messageConversationField, conversation.id).order('created_at', { ascending: false }).limit(INITIAL_PAGE_LIMIT);

  if (messageResult.error) {
    console.log('[IVXChatService] Failed to list messages, falling back to local cache:', messageResult.error.message);
    return localMessages;
  }

  // Reverse the newest-first rows back to chronological (oldest→newest) order
  // so the rendered thread reads top-to-bottom and the FlatList's last item is
  // the latest message — which is what scroll-to-latest and initialScrollIndex
  // target.
  const rawRows = (messageResult.data ?? []) as Record<string, unknown>[];
  const chronologicalRows = [...rawRows].reverse();
  let remoteMessages = await Promise.all(chronologicalRows.map((row) => mapMessage(row)));

  // DISAPPEAR-FIX (2026-07-05): when the primary conversation-id query returns
  // empty but the durable local mirror has messages, the canonical conversation
  // id has diverged from the id the messages were saved under. Recover by
  // querying recent messages across ALL conversations (capped) and merging with
  // the local mirror, so the owner never sees an empty room over a saved thread.
  if (remoteMessages.length === 0 && localMessages.length > 0) {
    console.log('[IVXChatService] Primary conversation returned 0 remote messages but local mirror has', localMessages.length, '- attempting cross-conversation recovery');
    try {
      const recoveryResult = await scopedClient.from(tables.messages)
        .select('*')
        .order('created_at', { ascending: true })
        .limit(200);
      if (!recoveryResult.error && recoveryResult.data && recoveryResult.data.length > 0) {
        const recoveredRemote = await Promise.all(recoveryResult.data.map((row) => mapMessage(row as Record<string, unknown>)));
        // Only keep messages whose signature matches one in the local mirror —
        // this is the owner's own thread, recovered from wherever it was saved.
        const localSignatures = new Set(localMessages.map((m) =>
          [String(m.conversationId ?? '').trim().toLowerCase(),
           String(m.senderRole ?? '').trim().toLowerCase(),
           String(m.body ?? '').trim().toLowerCase()].join('::')
        ));
        const matchedRecovered = recoveredRemote.filter((m) => {
          const sig = [String(m.conversationId ?? '').trim().toLowerCase(),
                       String(m.senderRole ?? '').trim().toLowerCase(),
                       String(m.body ?? '').trim().toLowerCase()].join('::');
          return localSignatures.has(sig);
        });
        if (matchedRecovered.length > 0) {
          console.log('[IVXChatService] Cross-conversation recovery matched', matchedRecovered.length, 'of', recoveredRemote.length, 'recent remote messages');
          remoteMessages = matchedRecovered;
        }
      }
    } catch (recoveryError) {
      console.log('[IVXChatService] Cross-conversation recovery failed:', recoveryError instanceof Error ? recoveryError.message : 'unknown');
    }
  }

  const mergedMessages = mergeOwnerMessages(remoteMessages, localMessages);

  // OPEN-ON-LATEST DISPLAY CAP (2026-07-19): the durable local mirror is capped
  // at 400, so mergeOwnerMessages can return up to ~400+ rows. Rendering all of
  // them forces the FlatList to lay out hundreds of old bubbles before the
  // scroll-to-latest retry can anchor on the newest turn — exactly the
  // "opens on months-old messages" bug the owner reported. Keep the newest N
  // (chronological) for display; the full mirror is persisted below so older
  // history survives reloads. N is chosen so the latest turn + recent context
  // fit in ~2 screens and scroll-to-latest completes in <200ms.
  const DISPLAY_WINDOW = 160;
  const displayMessages = mergedMessages.length > DISPLAY_WINDOW
    ? mergedMessages.slice(-DISPLAY_WINDOW)
    : mergedMessages;

  console.log('[IVXChatService] Owner message list resolved:', {
    conversationId: conversation.id,
    remoteCount: remoteMessages.length,
    localFallbackCount: localMessages.length,
    mergedCount: mergedMessages.length,
    displayCount: displayMessages.length,
    displayCapped: mergedMessages.length > DISPLAY_WINDOW,
    persistenceSource: 'remote_read_ok',
  });

  // Keep the durable local shadow a complete superset of the rendered thread so
  // a future reload / transient remote-read failure never loses the conversation.
  await persistOwnerMessageMirror(mergedMessages, conversation.id);

  return displayMessages;
}

/**
 * Phase 4 (areas B, C, E): cursor-based older-messages fetch. Called by the
 * chat screen when the user scrolls to the top of the currently-loaded window.
 * Fetches the next page of messages OLDER than the provided cursor (the
 * oldest currently-loaded message's created_at + id), deduplicates against the
 * current list, and prepends them in stable chronological order. Returns the
 * merged list so the caller can preserve the scroll anchor.
 *
 * The cursor is (createdAt, id) so equal-timestamp messages paginate
 * deterministically (the same stable secondary key used by the merge module).
 */
async function listOlderOwnerMessages(input: {
  cursor: { createdAt: string; id: string };
  currentMessages: IVXMessage[];
  pageSize?: number;
}): Promise<{ messages: IVXMessage[]; addedCount: number; hasMore: boolean }> {
  const pageSize = Math.max(1, Math.min(200, input.pageSize ?? 80));
  const client = getIVXSupabaseClient();
  const tables = await resolveIVXTables();
  const scopedClient = getScopedSupabaseClient(client, tables.dbSchema);
  const conversation = await bootstrapOwnerConversation();
  const messageConversationField = tables.schema === 'generic' ? 'room_id' : 'conversation_id';

  if (tables.schema === 'none') {
    return { messages: input.currentMessages, addedCount: 0, hasMore: false };
  }

  // Fetch messages strictly older than the cursor. lt('created_at') handles the
  // common case; for equal-timestamp messages we rely on the id tiebreak in
  // stableMessageOrder on the client side (Supabase doesn't support compound
  // cursor predicates simply, so we slightly over-fetch and dedup).
  const result = await scopedClient
    .from(tables.messages)
    .select('*')
    .eq(messageConversationField, conversation.id)
    .lt('created_at', input.cursor.createdAt)
    .order('created_at', { ascending: false })
    .limit(pageSize + 1);

  if (result.error) {
    console.log('[IVXChatService] listOlderOwnerMessages query failed:', result.error.message);
    return { messages: input.currentMessages, addedCount: 0, hasMore: false };
  }

  const rows = (result.data ?? []) as Record<string, unknown>[];
  const hasMore = rows.length > pageSize;
  const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
  const chronologicalPage = [...pageRows].reverse();
  const olderMessages = await Promise.all(chronologicalPage.map((row) => mapMessage(row)));

  // Prepend + dedup + stable sort using the Expo-side pagination helpers.
  const { prependOlderMessages } = await import('./ivxChatPagination');
  const merged = prependOlderMessages(input.currentMessages, olderMessages);
  const addedCount = merged.length - input.currentMessages.length;
  return { messages: merged, addedCount: Math.max(0, addedCount), hasMore };
}

async function sendOwnerTextMessage(input: {
  body: string;
  senderLabel?: string | null;
  requireRemote?: boolean;
}): Promise<IVXMessage> {
  const localFirstBody = trimOrNull(input.body);
  if (isIVXLocalFirstChatEnabled()) {
    if (!localFirstBody) {
      throw new Error('Type a message before sending.');
    }

    const conversation = getLocalConversation();
    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: null,
      senderRole: 'owner',
      senderLabel: trimOrNull(input.senderLabel) ?? 'IVX Owner',
      body: localFirstBody,
      attachmentKind: 'text',
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_text_local_first');
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: 'Stored in the local IVX room.',
    });
    console.log('[IVXChatService] Owner text message stored in local-first mode');
    return localMessage;
  }

  let ownerContext = null as Awaited<ReturnType<typeof getIVXOwnerAuthContext>> | null;
  try {
    ownerContext = await getIVXOwnerAuthContext();
  } catch (error) {
    console.log('[IVXChatService] Owner auth unavailable for sendOwnerTextMessage, switching to local mode:', error instanceof Error ? error.message : 'unknown');
  }
  const tables = await resolveIVXTables();
  const conversation = await bootstrapOwnerConversation();
  const body = trimOrNull(input.body);

  if (!body) {
    throw new Error('Type a message before sending.');
  }

  if (!ownerContext || tables.schema === 'none') {
    if (input.requireRemote === true) {
      throw new Error(!ownerContext ? 'Owner session is required to save this message.' : 'Shared room persistence is unavailable.');
    }

    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: ownerContext?.userId ?? null,
      senderRole: 'owner',
      senderLabel: trimOrNull(input.senderLabel) ?? ownerContext?.email ?? 'IVX Owner',
      body,
      attachmentKind: 'text',
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_text_local_mode');
    trackOwnerSendAudit({
      transport: resolveLocalAuditTransport(!!ownerContext),
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: resolveLocalAuditReason(!!ownerContext, tables.schema === 'none'
        ? 'IVX shared tables are unavailable, so the message was persisted locally.'
        : 'Owner text send switched to local persistence.'),
    });
    console.log('[IVXChatService] Owner text message stored locally');
    return localMessage;
  }

  console.log('[IVXChatService] Sending owner text message:', {
    conversationId: conversation.id,
    userId: ownerContext.userId,
    bodyLength: body.length,
    schema: tables.schema,
  });

  try {
    const message = await insertMessage(tables, {
      conversationId: conversation.id,
      senderUserId: ownerContext.userId,
      senderRole: 'owner',
      senderLabel: trimOrNull(input.senderLabel) ?? ownerContext.email,
      body,
      attachmentKind: 'text',
    });

    await updateConversationSummary(tables, conversation.id, body);
    await ensureInboxState(tables, conversation.id, ownerContext.userId);
    trackOwnerSendAudit({
      transport: 'remote_db_insert',
      conversationId: conversation.id,
      messageId: message.id,
      senderRole: 'owner',
      reason: `Inserted into ${tables.messages} using shared IVX room persistence.`,
    });
    return message;
  } catch (error) {
    if (input.requireRemote === true) {
      console.log('[IVXChatService] Remote owner text send failed in required remote mode:', error instanceof Error ? error.message : 'unknown');
      throw error instanceof Error ? error : new Error('Unable to save this message.');
    }

    console.log('[IVXChatService] Remote owner text send failed, storing locally instead:', error instanceof Error ? error.message : 'unknown');
    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: ownerContext.userId,
      senderRole: 'owner',
      senderLabel: trimOrNull(input.senderLabel) ?? ownerContext.email,
      body,
      attachmentKind: 'text',
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_text_remote_fallback');
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: `Remote owner text insert failed and the message was persisted locally instead: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return localMessage;
  }
}

async function sendOwnerSupportMessage(input: {
  body: string;
  senderRole: 'assistant' | 'system';
  senderLabel?: string | null;
  attachmentKind?: IVXAttachmentKind;
  requireRemote?: boolean;
}): Promise<IVXMessage> {
  const localFirstBody = trimOrNull(input.body);
  if (isIVXLocalFirstChatEnabled()) {
    if (!localFirstBody) {
      throw new Error('Support message body is required.');
    }

    const conversation = getLocalConversation();
    const senderLabel = trimOrNull(input.senderLabel)
      ?? (input.senderRole === 'assistant' ? IVX_OWNER_AI_PROFILE.name : 'IVX');
    const attachmentKind = input.attachmentKind ?? (input.senderRole === 'assistant' ? 'text' : 'system');
    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: null,
      senderRole: input.senderRole,
      senderLabel,
      body: localFirstBody,
      attachmentKind,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, `send_owner_support_local_first:${input.senderRole}`);
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: input.senderRole,
      reason: 'Stored in the local IVX room.',
    });
    console.log('[IVXChatService] Support message stored in local-first mode, role:', input.senderRole);
    return localMessage;
  }

  let ownerContext = null as Awaited<ReturnType<typeof getIVXOwnerAuthContext>> | null;
  try {
    ownerContext = await getIVXOwnerAuthContext();
  } catch (error) {
    console.log('[IVXChatService] Owner auth unavailable for sendOwnerSupportMessage, switching to local mode:', error instanceof Error ? error.message : 'unknown');
  }
  const tables = await resolveIVXTables();
  const conversation = await bootstrapOwnerConversation();
  const body = trimOrNull(input.body);

  if (!body) {
    throw new Error('Support message body is required.');
  }

  const senderLabel = trimOrNull(input.senderLabel)
    ?? (input.senderRole === 'assistant' ? IVX_OWNER_AI_PROFILE.name : 'System');
  const attachmentKind = input.attachmentKind ?? (input.senderRole === 'assistant' ? 'text' : 'system');

  if (!ownerContext || tables.schema === 'none') {
    if (input.requireRemote === true) {
      throw new Error(!ownerContext ? 'Owner session is required to save this reply.' : 'Shared room persistence is unavailable.');
    }

    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: null,
      senderRole: input.senderRole,
      senderLabel,
      body,
      attachmentKind,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, `send_owner_support_local_mode:${input.senderRole}`);
    trackOwnerSendAudit({
      transport: resolveLocalAuditTransport(!!ownerContext),
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: input.senderRole,
      reason: resolveLocalAuditReason(!!ownerContext, tables.schema === 'none'
        ? 'IVX shared tables are unavailable, so the support message was persisted locally.'
        : `Support message switched to local persistence for role ${input.senderRole}.`),
    });
    console.log('[IVXChatService] Support message stored locally, role:', input.senderRole);
    return localMessage;
  }

  console.log('[IVXChatService] Sending support message:', {
    conversationId: conversation.id,
    senderRole: input.senderRole,
    schema: tables.schema,
    bodyLength: body.length,
  });

  try {
    const message = await insertMessage(tables, {
      conversationId: conversation.id,
      senderUserId: null,
      senderRole: input.senderRole,
      senderLabel,
      body,
      attachmentKind,
    });

    await updateConversationSummary(tables, conversation.id, body);
    await ensureInboxState(tables, conversation.id, ownerContext.userId);
    trackOwnerSendAudit({
      transport: 'remote_db_insert',
      conversationId: conversation.id,
      messageId: message.id,
      senderRole: input.senderRole,
      reason: `Inserted into ${tables.messages} using shared IVX room persistence.`,
    });
    return message;
  } catch (error) {
    if (input.requireRemote === true) {
      console.log('[IVXChatService] Remote support message send failed in required remote mode:', error instanceof Error ? error.message : 'unknown');
      throw error instanceof Error ? error : new Error('Unable to save this reply.');
    }

    console.log('[IVXChatService] Remote support message send failed, storing locally instead:', error instanceof Error ? error.message : 'unknown');
    const localMessage = createLocalMessage({
      conversationId: conversation.id,
      senderUserId: null,
      senderRole: input.senderRole,
      senderLabel,
      body,
      attachmentKind,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, `send_owner_support_remote_fallback:${input.senderRole}`);
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: input.senderRole,
      reason: `Remote support insert failed and the message was persisted locally instead: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return localMessage;
  }
}

async function sendOwnerAttachmentMessage(input: {
  upload: IVXUploadInput;
  body?: string | null;
  senderLabel?: string | null;
}): Promise<IVXMessage> {
  if (isIVXLocalFirstChatEnabled()) {
    const conversation = getLocalConversation();
    const localMessage = createLocalAttachmentMessage({
      conversationId: conversation.id,
      senderUserId: null,
      senderLabel: trimOrNull(input.senderLabel) ?? 'IVX Owner',
      body: trimOrNull(input.body),
      upload: input.upload,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_attachment_local_first');
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: 'Stored in the local IVX room.',
    });
    console.log('[IVXChatService] Owner attachment stored in local-first mode');
    return localMessage;
  }

  let ownerContext = null as Awaited<ReturnType<typeof getIVXOwnerAuthContext>> | null;
  try {
    ownerContext = await getIVXOwnerAuthContext();
  } catch (error) {
    console.log('[IVXChatService] Owner auth unavailable for sendOwnerAttachmentMessage, switching to local attachment mode:', error instanceof Error ? error.message : 'unknown');
  }

  const tables = await resolveIVXTables();
  const conversation = await bootstrapOwnerConversation();
  const body = trimOrNull(input.body);
  const senderLabel = trimOrNull(input.senderLabel) ?? ownerContext?.email ?? 'IVX Owner';

  if (!ownerContext || tables.schema === 'none') {
    const localMessage = createLocalAttachmentMessage({
      conversationId: conversation.id,
      senderUserId: ownerContext?.userId ?? null,
      senderLabel,
      body,
      upload: input.upload,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_attachment_local_mode');
    trackOwnerSendAudit({
      transport: resolveLocalAuditTransport(!!ownerContext),
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: resolveLocalAuditReason(!!ownerContext, tables.schema === 'none'
        ? 'IVX shared tables are unavailable, so the attachment message was persisted locally.'
        : 'Owner attachment send switched to local persistence.'),
    });
    console.log('[IVXChatService] Owner attachment stored locally');
    return localMessage;
  }

  try {
    const uploadedFile = await ivxFileUploadService.uploadOwnerFile({
      upload: input.upload,
      conversationId: conversation.id,
    });
    const attachmentKind = getAttachmentKindFromMime(uploadedFile.mimeType);

    console.log('[IVXChatService] Sending owner attachment message:', {
      conversationId: conversation.id,
      userId: ownerContext.userId,
      fileName: uploadedFile.fileName,
      mimeType: uploadedFile.mimeType,
      schema: tables.schema,
    });

    const message = await insertMessage(tables, {
      conversationId: conversation.id,
      senderUserId: ownerContext.userId,
      senderRole: 'owner',
      senderLabel,
      body,
      attachmentUrl: uploadedFile.publicUrl,
      attachmentName: uploadedFile.fileName,
      attachmentMime: uploadedFile.mimeType,
      attachmentSize: uploadedFile.size,
      attachmentKind,
    });

    await updateConversationSummary(tables, conversation.id, body ?? uploadedFile.fileName);
    await ensureInboxState(tables, conversation.id, ownerContext.userId);
    trackOwnerSendAudit({
      transport: 'remote_db_insert',
      conversationId: conversation.id,
      messageId: message.id,
      senderRole: 'owner',
      reason: `Attachment inserted into ${tables.messages} using shared IVX room persistence.`,
    });
    return message;
  } catch (error) {
    console.log('[IVXChatService] Remote attachment send failed, storing locally instead:', error instanceof Error ? error.message : 'unknown');
    const localMessage = createLocalAttachmentMessage({
      conversationId: conversation.id,
      senderUserId: ownerContext.userId,
      senderLabel,
      body,
      upload: input.upload,
    });
    await appendLocalMessage(localMessage);
    emitLocalOwnerMessage(localMessage, 'send_owner_attachment_remote_fallback');
    trackOwnerSendAudit({
      transport: 'local_fallback',
      conversationId: conversation.id,
      messageId: localMessage.id,
      senderRole: 'owner',
      reason: `Remote attachment send failed and the message was persisted locally instead: ${error instanceof Error ? error.message : 'unknown error'}`,
    });
    return localMessage;
  }
}

async function subscribeToOwnerMessages(
  onMessage: (message: IVXMessage) => void,
  onStatusChange?: (status: string) => void,
): Promise<() => void> {
  if (isIVXLocalFirstChatEnabled()) {
    const conversation = getLocalConversation();
    let closed = false;
    const seenMessageIds = new Set<string>();
    const localListener = (message: IVXMessage): void => {
      if (closed || message.conversationId !== conversation.id || seenMessageIds.has(message.id)) {
        return;
      }

      seenMessageIds.add(message.id);
      trackOwnerReceiveAudit({
        transport: 'local_listener',
        conversationId: message.conversationId,
        messageId: message.id,
        senderRole: message.senderRole,
        reason: `Local IVX listener delivered ${message.senderRole} message ${message.id}.`,
      });
      console.log('[IVXChatService] Delivering local-first owner message:', {
        messageId: message.id,
        senderRole: message.senderRole,
        conversationId: message.conversationId,
      });
      onMessage(message);
    };

    ownerLocalMessageListeners.add(localListener);
    onStatusChange?.('local_ready');
    return () => {
      closed = true;
      ownerLocalMessageListeners.delete(localListener);
    };
  }

  const client = getIVXSupabaseClient();
  const tables = await resolveIVXTables();
  const conversation = await bootstrapOwnerConversation();
  const seenMessageIds = new Set<string>();
  try {
    const existingMessages = await listOwnerMessages();
    existingMessages.forEach((message) => {
      if (message.id) {
        seenMessageIds.add(message.id);
      }
    });
  } catch (error) {
    console.log('[IVXChatService] Initial realtime de-dupe seed failed:', error instanceof Error ? error.message : 'unknown');
  }
  let closed = false;
  let unsubscribeStarted = false;
  let channelTerminated = false;
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  let realtimeFallbackTimer: ReturnType<typeof setTimeout> | null = null;

  const markClosed = (): void => {
    closed = true;
  };

  const handleIncomingMessage = (message: IVXMessage, source: 'local' | 'realtime'): void => {
    if (closed || !message.id || seenMessageIds.has(message.id)) {
      return;
    }

    seenMessageIds.add(message.id);
    trackOwnerReceiveAudit({
      transport: source === 'realtime' ? 'realtime_event' : 'local_listener',
      conversationId: message.conversationId,
      messageId: message.id,
      senderRole: message.senderRole,
      reason: source === 'realtime'
        ? `Realtime subscription delivered ${message.senderRole} message ${message.id}.`
        : `Local fallback listener delivered ${message.senderRole} message ${message.id}.`,
    });
    console.log('[IVXChatService] Delivering owner message:', {
      source,
      messageId: message.id,
      senderRole: message.senderRole,
      conversationId: message.conversationId,
    });
    onMessage(message);
  };

  const localListener = (message: IVXMessage): void => {
    if (closed || message.conversationId !== conversation.id) {
      return;
    }

    onStatusChange?.('local_fallback');
    handleIncomingMessage(message, 'local');
  };

  const pollForRemoteMessages = async (reason: string): Promise<void> => {
    if (closed) {
      return;
    }

    try {
      const latestMessages = await listOwnerMessages();
      latestMessages.forEach((message) => {
        if (message.conversationId === conversation.id) {
          handleIncomingMessage(message, 'local');
        }
      });
      onStatusChange?.(`polling:${reason}`);
    } catch (error) {
      console.log('[IVXChatService] Owner realtime polling fallback failed:', error instanceof Error ? error.message : 'unknown');
      onStatusChange?.('polling_error');
    }
  };

  const stopPolling = (): void => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  const startPolling = (reason: string): void => {
    if (pollingInterval || closed) {
      return;
    }

    console.log('[IVXChatService] Starting owner-room polling fallback:', reason);
    onStatusChange?.(`polling:${reason}`);
    void pollForRemoteMessages(reason);
    pollingInterval = setInterval(() => {
      void pollForRemoteMessages(reason);
    }, OWNER_REALTIME_POLL_INTERVAL_MS);
  };

  ownerLocalMessageListeners.add(localListener);

  if (tables.schema === 'none') {
    console.log('[IVXChatService] Realtime subscription skipped because shared chat tables are unavailable');
    onStatusChange?.('unavailable');
    return () => {
      if (unsubscribeStarted) {
        return;
      }

      unsubscribeStarted = true;
      markClosed();
      ownerLocalMessageListeners.delete(localListener);
    };
  }

  const realtimeSchema = getRealtimeSchema(tables);
  const channelName = `ivx-owner-room:${conversation.id}`;
  const teardownKey = `${channelName}:${tables.messages}:${realtimeSchema}`;
  const realtimeConversationField = tables.schema === 'generic' ? 'room_id' : 'conversation_id';

  // Block 22R fix: prevent realtime channel duplication on reconnect/remount.
  // If a previous subscription with the same teardownKey is still registered,
  // tear it down on the supabase client AND wait for the in-flight teardown
  // promise to settle before creating a fresh channel. Without this, fast
  // remounts/reconnects produced N parallel channels that each delivered the
  // same INSERT and duplicated assistant messages on the chat surface.
  if (activeOwnerRealtimeSubscriptions.has(teardownKey)) {
    console.log('[IVXChatService] Pre-existing owner realtime channel detected, removing before resubscribe:', teardownKey, 'activeChannelCount:', activeOwnerRealtimeSubscriptions.size);
    try {
      await client.removeChannel(client.channel(channelName) as never);
    } catch (preTeardownError) {
      console.log('[IVXChatService] Pre-resubscribe teardown note:', preTeardownError instanceof Error ? preTeardownError.message : 'unknown');
    }
    activeOwnerRealtimeSubscriptions.delete(teardownKey);
  }

  const channel = client.channel(channelName).on('postgres_changes', {
    event: 'INSERT',
    schema: realtimeSchema,
    table: tables.messages,
    filter: `${realtimeConversationField}=eq.${conversation.id}`,
  }, (payload) => {
    const rawId = typeof (payload.new as { id?: unknown } | null)?.id === 'string'
      ? (payload.new as { id?: string }).id ?? null
      : null;
    if (!rawId) {
      return;
    }

    console.log('[IVXChatService] Incoming realtime message on', tables.messages, 'messageId:', rawId);
    void mapMessage(payload.new as Record<string, unknown>)
      .then((message) => {
        handleIncomingMessage(message, 'realtime');
      })
      .catch((error: unknown) => {
        console.log('[IVXChatService] Failed to hydrate realtime message:', error instanceof Error ? error.message : 'unknown');
      });
  }).subscribe((status) => {
    const normalizedStatus = String(status ?? '').toLowerCase();
    console.log('[IVXChatService] Realtime status:', normalizedStatus);

    if (normalizedStatus === 'subscribed') {
      if (realtimeFallbackTimer) {
        clearTimeout(realtimeFallbackTimer);
        realtimeFallbackTimer = null;
      }
      stopPolling();
      onStatusChange?.(normalizedStatus);
      return;
    }

    if (normalizedStatus === 'closed') {
      channelTerminated = true;
      startPolling('channel_closed');
    }

    if (closed && normalizedStatus !== 'subscribed') {
      return;
    }

    if (normalizedStatus === 'channel_error' || normalizedStatus === 'timed_out') {
      startPolling(normalizedStatus);
    }

    onStatusChange?.(normalizedStatus);
  });

  const unregisterActiveChannel = (): void => {
    if (activeOwnerRealtimeSubscriptions.delete(teardownKey)) {
      console.log('[IVXChatService] Owner realtime channel unregistered:', teardownKey, 'remainingActiveChannels:', activeOwnerRealtimeSubscriptions.size);
    }
  };

  const safeClose = (reason: string): void => {
    if (unsubscribeStarted) {
      return;
    }

    unsubscribeStarted = true;
    markClosed();
    if (realtimeFallbackTimer) {
      clearTimeout(realtimeFallbackTimer);
      realtimeFallbackTimer = null;
    }
    stopPolling();
    ownerLocalMessageListeners.delete(localListener);
    unregisterActiveChannel();
    console.log('[IVXChatService] Closing owner realtime channel:', reason, 'channel:', channelName, 'alreadyTerminated:', channelTerminated);

    if (channelTerminated) {
      return;
    }

    if (activeOwnerRealtimeTeardowns.has(teardownKey)) {
      console.log('[IVXChatService] Owner realtime teardown already in progress:', teardownKey);
      return;
    }

    activeOwnerRealtimeTeardowns.add(teardownKey);
    setTimeout(() => {
      void (async () => {
        try {
          await client.removeChannel(channel as never);
          console.log('[IVXChatService] Owner realtime channel removed safely:', teardownKey);
        } catch (unsubscribeError) {
          console.log('[IVXChatService] Owner realtime teardown note:', unsubscribeError instanceof Error ? unsubscribeError.message : 'unknown');
        } finally {
          activeOwnerRealtimeTeardowns.delete(teardownKey);
        }
      })();
    }, 0);
  };

  activeOwnerRealtimeSubscriptions.add(teardownKey);
  console.log('[IVXChatService] Setting up realtime on:', tables.messages, 'conversation:', conversation.id, 'realtimeSchema:', realtimeSchema, 'conversationField:', realtimeConversationField, 'channel:', channelName, 'activeChannelCount:', activeOwnerRealtimeSubscriptions.size);
  onStatusChange?.('connecting');
  realtimeFallbackTimer = setTimeout(() => {
    if (!closed) {
      startPolling('subscription_timeout');
    }
  }, OWNER_REALTIME_FALLBACK_DELAY_MS);

  return () => {
    safeClose('cleanup');
  };
}

export const ivxChatService = {
  bootstrapOwnerConversation,
  getCanonicalConversationId,
  getCanonicalConversationIdSync,
  setCanonicalConversationId,
  listOwnerMessages,
  listOlderOwnerMessages,
  searchOwnerMessages,
  sendOwnerTextMessage,
  sendOwnerSupportMessage,
  sendOwnerAttachmentMessage,
  subscribeToOwnerMessages,
  getLastOwnerSendAudit,
  getLastOwnerReceiveAudit,
  getOwnerRealtimeSubscriptionAudit,
  appendOwnerMessagesToLocalMirror,
};
