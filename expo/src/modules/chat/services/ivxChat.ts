import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { supabase } from '@/lib/supabase';
import { IVX_CHAT_UPLOAD_BUCKET } from '@/shared/ivx';
import type {
  ChatConversation,
  ChatFileType,
  ChatMessage,
  ChatParticipant,
  ChatRoomStatus,
  DeliveryMode,
  InboxItem,
  MessageSubscription,
  SendMessageInput,
  UploadableFile,
} from '../types/chat';
import {
  getChatConversationBootstrap,
  getChatConversationDisplayId,
  getChatConversationSubtitle,
  getChatConversationTitle,
  isUuidConversationId,
  resolveChatConversationId,
} from './chatRooms';
import { getChatUploadBucketName } from './chatUploadConfig';

type ErrorLike = {
  code?: string;
  message?: string;
};

type MessageRow = Record<string, unknown>;

type ConversationRow = Record<string, unknown>;

type SnapshotRow = {
  id?: string;
  data?: Record<string, unknown> | null;
  created_at?: string | null;
};

type RoomShell = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
};

type ResolvedAttachment = {
  fileUrl: string;
  fileStorageBucket: string | null;
  fileStoragePath: string | null;
  fileType: ChatFileType;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
};

type MessageDraft = {
  text: string | null;
  fileUrl: string | null;
  fileStorageBucket: string | null;
  fileStoragePath: string | null;
  fileType: ChatFileType | null;
  fileName: string | null;
  fileMime: string | null;
  fileSize: number | null;
  clientMessageId: string | null;
};

const CHAT_LOCAL_PREFIX = 'ivx_chat_room:';
const CHAT_FALLBACK_PREFIX = 'chat_message:';
const CHAT_POLL_INTERVAL_MS = 5000;
const CHAT_LOCAL_MAX_MESSAGES = 250;
const CHAT_SEND_TIMEOUT_MS = 15000;
const CHAT_ROOM_STATUS_CACHE_TTL_MS = 15000;

type RealtimeChannelLike = {
  unsubscribe?: () => Promise<unknown> | unknown;
  name?: string;
};

type RoomMessageSubscriptionRecord = {
  key: string;
  listeners: Set<(message: ChatMessage) => void>;
  statusListeners: Set<(status: ChatRoomStatus) => void>;
  status: ChatRoomStatus;
  dispose: () => void;
};

type InboxSubscriptionRecord = {
  key: string;
  listeners: Set<(items: InboxItem[]) => void>;
  statusListeners: Set<(status: ChatRoomStatus) => void>;
  status: ChatRoomStatus;
  dispose: () => void;
};

let cachedRoomStatus: ChatRoomStatus | null = null;
let cachedRoomStatusTimestamp = 0;
const activeRoomMessageSubscriptions = new Map<string, RoomMessageSubscriptionRecord>();
const activeInboxSubscriptions = new Map<string, InboxSubscriptionRecord>();
const activeRealtimeChannelTeardowns = new Set<string>();

function createIdempotentChannelCleanup(
  channel: RealtimeChannelLike,
  options: {
    label: string;
    stopPolling: () => void;
    onClosed?: () => void;
  },
): () => void {
  let closed = false;

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    options.stopPolling();
    options.onClosed?.();
    const teardownKey = `${options.label}:${channel.name ?? 'unnamed-channel'}`;
    console.log(`[IVXChat] Closing realtime subscription: ${options.label}`);

    if (activeRealtimeChannelTeardowns.has(teardownKey)) {
      console.log(`[IVXChat] Realtime teardown already in progress: ${teardownKey}`);
      return;
    }

    activeRealtimeChannelTeardowns.add(teardownKey);

    setTimeout(() => {
      void (async () => {
        try {
          await supabase.removeChannel(channel as never);
          console.log(`[IVXChat] Realtime channel removed safely: ${teardownKey}`);
        } catch (unsubscribeError) {
          console.log(`[IVXChat] Realtime teardown note (${options.label}):`, (unsubscribeError as Error)?.message ?? 'Unknown error');
        } finally {
          activeRealtimeChannelTeardowns.delete(teardownKey);
        }
      })();
    }, 0);
  };
}

function createLocalIdempotentCleanup(options: { label: string; stopPolling: () => void; onClosed?: () => void }): () => void {
  let closed = false;

  return () => {
    if (closed) {
      return;
    }

    closed = true;
    options.stopPolling();
    options.onClosed?.();
    console.log(`[IVXChat] Closing local polling subscription: ${options.label}`);
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      console.log(`[IVXChat] ${label} timed out after ${ms}ms`);
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

function cacheRoomStatus(status: ChatRoomStatus): ChatRoomStatus {
  cachedRoomStatus = status;
  cachedRoomStatusTimestamp = Date.now();
  return status;
}

async function getCachedOrDetectRoomStatus(): Promise<ChatRoomStatus> {
  const now = Date.now();
  if (cachedRoomStatus && (now - cachedRoomStatusTimestamp) < CHAT_ROOM_STATUS_CACHE_TTL_MS) {
    console.log('[IVXChat] Using cached room status:', cachedRoomStatus.storageMode, 'age:', now - cachedRoomStatusTimestamp, 'ms');
    return cachedRoomStatus;
  }

  console.log('[IVXChat] Room status cache expired or empty, detecting...');
  const status = await withTimeout(detectRoomStatus(), 8000, 'detectRoomStatus');
  return cacheRoomStatus(status);
}

export function invalidateRoomStatusCache(): void {
  cachedRoomStatus = null;
  cachedRoomStatusTimestamp = 0;
  console.log('[IVXChat] Room status cache invalidated');
}

export const IVX_CHAT_CONFIG = {
  friendlyOwnerRoomSlug: 'ivx-owner-room',
  tables: {
    conversations: 'conversations',
    messages: 'messages',
    participants: 'conversation_participants',
    altConversations: 'chat_rooms',
    altMessages: 'room_messages',
    altParticipants: 'room_participants',
    snapshots: 'realtime_snapshots',
  },
  storage: {
    alternateBucket: 'shared-chat-uploads',
  },
  limits: {
    maxFileSizeBytes: 50 * 1024 * 1024,
  },
  allowedMimePrefixes: [
    'image/',
    'video/',
    'application/pdf',
    'text/',
    'application/zip',
    'application/json',
    'application/msword',
    'application/vnd.openxmlformats-officedocument',
  ],
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function safeTrim(value: string | null | undefined): string {
  return (value ?? '').trim();
}

function safeLower(value: string | null | undefined): string {
  return safeTrim(value).toLowerCase();
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return items.length > 0 ? items : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function randomUuid(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const randomValue = Math.floor(Math.random() * 16);
    const value = character === 'x' ? randomValue : (randomValue & 0x3) | 0x8;
    return value.toString(16);
  });
}

function textPreview(text?: string | null, max = 80): string {
  const trimmed = safeTrim(text);
  if (!trimmed) {
    return '';
  }

  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

function normalizeChatFileType(value: string | null | undefined): ChatFileType | null {
  if (value === 'image' || value === 'video' || value === 'pdf' || value === 'file') {
    return value;
  }

  return null;
}

function chatFileTypeFromMime(value: string | null | undefined): ChatFileType {
  const lower = safeLower(value);
  if (lower.startsWith('image/')) {
    return 'image';
  }

  if (lower.startsWith('video/')) {
    return 'video';
  }

  if (lower === 'application/pdf') {
    return 'pdf';
  }

  return 'file';
}

function chatFileTypeFromUrl(value: string | null | undefined): ChatFileType | null {
  const lower = safeLower(value);
  if (!lower) {
    return null;
  }

  if (/\.(png|jpg|jpeg|gif|webp|bmp|heic|heif|svg)(\?|#|$)/i.test(lower)) {
    return 'image';
  }

  if (/\.(mp4|mov|m4v|avi|webm|mkv)(\?|#|$)/i.test(lower)) {
    return 'video';
  }

  if (/\.pdf(\?|#|$)/i.test(lower)) {
    return 'pdf';
  }

  return 'file';
}

function resolveFileType(fileType?: string | null, fileMime?: string | null, fileUrl?: string | null): ChatFileType | null {
  const normalized = normalizeChatFileType(fileType);
  if (normalized) {
    return normalized;
  }

  const mime = safeTrim(fileMime);
  if (mime) {
    return chatFileTypeFromMime(mime);
  }

  return chatFileTypeFromUrl(fileUrl);
}

function isAllowedMime(mime?: string | null): boolean {
  const lower = safeLower(mime);
  if (!lower) {
    return true;
  }

  return IVX_CHAT_CONFIG.allowedMimePrefixes.some((prefix) => lower.startsWith(prefix.toLowerCase()));
}

function getPrimaryBucketName(): string {
  const configuredBucketName = safeTrim(getChatUploadBucketName());
  return configuredBucketName || IVX_CHAT_UPLOAD_BUCKET;
}

function getLocalStorageKey(conversationId: string): string {
  return `${CHAT_LOCAL_PREFIX}${conversationId}`;
}

function getFallbackSnapshotType(conversationId: string): string {
  return `${CHAT_FALLBACK_PREFIX}${conversationId}`;
}

function createRoomStatus(
  storageMode: ChatRoomStatus['storageMode'],
  visibility: ChatRoomStatus['visibility'],
  deliveryMethod: DeliveryMode,
  warning?: string,
): ChatRoomStatus {
  return {
    storageMode,
    visibility,
    deliveryMethod,
    warning,
  };
}

function getPrimaryStatus(deliveryMethod: DeliveryMode = 'primary_realtime'): ChatRoomStatus {
  return createRoomStatus('primary_supabase_tables', 'shared', deliveryMethod);
}

function getAlternateStatus(): ChatRoomStatus {
  return createRoomStatus(
    'alternate_room_schema',
    'shared',
    'alternate_shared',
    'Primary room path is unavailable. Using the alternate shared room schema.',
  );
}

function getSnapshotStatus(): ChatRoomStatus {
  return createRoomStatus(
    'snapshot_storage',
    'shared',
    'snapshot_fallback',
    'Shared room writes are reduced. Using the snapshot fallback path.',
  );
}

function getLocalStatus(): ChatRoomStatus {
  return createRoomStatus(
    'local_device_only',
    'local_only',
    'local_only',
    'Messages are only stored on this device and are not shared.',
  );
}

function ensureActorId(value: string | null | undefined): string {
  const trimmed = safeTrim(value);
  return trimmed || randomUuid();
}

function makeRoomShell(requestedKey?: string | null, status?: ChatRoomStatus): RoomShell {
  const requestedValue = safeTrim(requestedKey) || IVX_CHAT_CONFIG.friendlyOwnerRoomSlug;
  const canonicalId = safeTrim(resolveChatConversationId(requestedValue)) || requestedValue;
  const slug = safeTrim(getChatConversationDisplayId(requestedValue)) || requestedValue || canonicalId;
  const bootstrap = getChatConversationBootstrap(requestedValue) ?? getChatConversationBootstrap(canonicalId);
  const title = getChatConversationTitle(requestedValue, bootstrap?.title) ?? getChatConversationTitle(canonicalId, bootstrap?.title) ?? slug;
  const subtitle = getChatConversationSubtitle(requestedValue, bootstrap?.subtitle)
    ?? getChatConversationSubtitle(canonicalId, bootstrap?.subtitle)
    ?? (status?.storageMode === 'local_device_only' ? 'Local IVX room' : 'Shared IVX room');

  return {
    id: canonicalId || randomUuid(),
    slug: slug || canonicalId || IVX_CHAT_CONFIG.friendlyOwnerRoomSlug,
    title,
    subtitle,
  };
}

function mapConversationRow(row: ConversationRow | null | undefined, shell: RoomShell, unreadCount = 0): ChatConversation {
  return {
    id: readString(row?.id) ?? shell.id,
    slug: readString(row?.slug) ?? shell.slug,
    title: readString(row?.title) ?? shell.title,
    subtitle: readString(row?.subtitle) ?? shell.subtitle,
    lastMessageText: readString(row?.last_message_text),
    lastMessageAt: readString(row?.last_message_at),
    unreadCount,
  };
}

function normalizeMessageText(value: string | null | undefined): string {
  return safeTrim(value).toLowerCase();
}

function buildMessageSignature(row: MessageRow | null | undefined, fallbackConversationId: string): string {
  const conversationId = readString(row?.conversation_id) ?? readString(row?.room_id) ?? fallbackConversationId;
  const senderId = readString(row?.sender_id)
    ?? readString(row?.sender_actor_id)
    ?? readString(row?.actor_id)
    ?? readString(row?.user_id)
    ?? '';
  const text = normalizeMessageText(readString(row?.text) ?? readString(row?.body));
  const fileUrl = readString(row?.file_url) ?? readString(row?.attachment_url) ?? '';
  const createdAt = readString(row?.created_at) ?? '';
  return [conversationId, senderId, text, fileUrl, createdAt].join('::');
}

async function findPrimaryConversationBySlug(shell: RoomShell): Promise<ConversationRow | null> {
  if (!shell.slug) {
    return null;
  }

  const { data, error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.conversations)
    .select('*')
    .eq('slug', shell.slug)
    .limit(2);

  if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
    throw error;
  }

  const rows = ((data ?? []) as ConversationRow[]);
  if (rows.length > 1) {
    console.log('[IVXChat] Duplicate primary conversations detected for slug:', shell.slug, 'count:', rows.length);
    throw new Error(`Duplicate owner room conversations detected for slug ${shell.slug}. Run the owner-room dedupe migration.`);
  }

  return rows[0] ?? null;
}

async function findAlternateConversationBySlug(shell: RoomShell): Promise<ConversationRow | null> {
  if (!shell.slug) {
    return null;
  }

  const { data, error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altConversations)
    .select('*')
    .eq('slug', shell.slug)
    .limit(2);

  if (error && !isSchemaMissingError(error) && !isColumnMissingError(error)) {
    throw error;
  }

  const rows = ((data ?? []) as ConversationRow[]);
  if (rows.length > 1) {
    console.log('[IVXChat] Duplicate alternate conversations detected for slug:', shell.slug, 'count:', rows.length);
    throw new Error(`Duplicate owner room rooms detected for slug ${shell.slug}. Run the owner-room dedupe migration.`);
  }

  return rows[0] ?? null;
}

function mapPrimaryParticipantRow(row: Record<string, unknown>): ChatParticipant {
  return {
    conversationId: readString(row.conversation_id) ?? '',
    userId: readString(row.user_id) ?? readString(row.actor_id) ?? '',
    unreadCount: readNumber(row.unread_count) ?? 0,
    lastReadAt: readString(row.last_read_at),
    displayName: readString(row.display_name),
    avatarUrl: readString(row.avatar_url),
  };
}

function mapMessageRow(
  row: MessageRow | null | undefined,
  fallbackConversationId: string,
  deliveryMode: DeliveryMode,
  draft?: MessageDraft,
): ChatMessage {
  const fileUrl = readString(row?.file_url) ?? readString(row?.attachment_url) ?? draft?.fileUrl;
  const fileStorageBucket = readString(row?.file_storage_bucket) ?? readString(row?.attachment_bucket) ?? draft?.fileStorageBucket;
  const fileStoragePath = readString(row?.file_storage_path) ?? readString(row?.attachment_path) ?? draft?.fileStoragePath;
  const fileMime = readString(row?.file_mime) ?? readString(row?.attachment_mime) ?? draft?.fileMime;
  const fileType = resolveFileType(readString(row?.file_type) ?? draft?.fileType, fileMime, fileUrl);

  return {
    id: readString(row?.id) ?? `${deliveryMode}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    conversationId: readString(row?.conversation_id) ?? readString(row?.room_id) ?? fallbackConversationId,
    senderId: readString(row?.sender_id)
      ?? readString(row?.sender_actor_id)
      ?? readString(row?.actor_id)
      ?? readString(row?.user_id)
      ?? '',
    senderLabel: readString(row?.sender_label) ?? readString(row?.display_name),
    text: readString(row?.text) ?? readString(row?.body) ?? draft?.text,
    fileUrl,
    fileStorageBucket,
    fileStoragePath,
    fileType,
    fileName: readString(row?.file_name) ?? readString(row?.attachment_name) ?? draft?.fileName,
    fileMime,
    fileSize: readNumber(row?.file_size) ?? readNumber(row?.attachment_size) ?? draft?.fileSize,
    createdAt: readString(row?.created_at) ?? nowIso(),
    updatedAt: readString(row?.updated_at),
    readBy: readStringArray(row?.read_by),
    localOnly: deliveryMode === 'local_only',
    deliveryMode,
  };
}

function sortMessages(left: ChatMessage, right: ChatMessage): number {
  return new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
}

function isSchemaMissingError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === 'pgrst204'
    || code === 'pgrst205'
    || code === '42p01'
    || message.includes('schema cache')
    || message.includes('could not find the table')
    || message.includes('does not exist')
    || (message.includes('relation') && message.includes('does not exist'));
}

function isColumnMissingError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === '42703' || (message.includes('column') && message.includes('does not exist'));
}

function isPermissionError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === '42501'
    || code === '401'
    || code === '403'
    || message.includes('row-level security')
    || message.includes('permission denied')
    || message.includes('not authorized')
    || message.includes('unauthorized')
    || message.includes('violates row-level security');
}

function isAuthSessionError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === '401'
    || message.includes('auth session missing')
    || message.includes('not_authenticated')
    || message.includes('anonymous')
    || message.includes('invalid jwt')
    || (message.includes('session') && message.includes('missing'));
}

function isConnectivityError(error: ErrorLike | null | undefined): boolean {
  const message = safeLower(error?.message);

  return message.includes('network request failed')
    || message.includes('failed to fetch')
    || message.includes('fetch failed')
    || message.includes('timeout')
    || message.includes('abort');
}

function isForeignKeyError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === '23503'
    || (message.includes('foreign key') && message.includes('conversation'))
    || (message.includes('foreign key') && message.includes('room'));
}

function isInvalidUuidSyntaxError(error: ErrorLike | null | undefined): boolean {
  const code = safeLower(error?.code);
  const message = safeLower(error?.message);

  return code === '22p02' || message.includes('invalid input syntax for type uuid');
}

function isStorageBucketError(error: ErrorLike | null | undefined): boolean {
  const message = safeLower(error?.message);
  return message.includes('bucket') && (message.includes('not found') || message.includes('does not exist'));
}

function shouldTrySharedFallback(error: ErrorLike | null | undefined): boolean {
  return isSchemaMissingError(error)
    || isColumnMissingError(error)
    || isPermissionError(error)
    || isForeignKeyError(error)
    || isInvalidUuidSyntaxError(error)
    || isStorageBucketError(error);
}

function shouldUseLocalFallback(error: ErrorLike | null | undefined): boolean {
  return isAuthSessionError(error) || isConnectivityError(error);
}

function compactPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter((entry) => entry[1] !== undefined));
}

function uniquePayloads(payloads: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  return payloads.filter((payload) => {
    const compact = compactPayload(payload);
    const key = JSON.stringify(compact);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  }).map(compactPayload);
}

async function canQueryTable(table: string, selectField: string): Promise<boolean> {
  try {
    const { error } = await supabase.from(table).select(selectField).limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function canUsePrimarySchema(): Promise<boolean> {
  const hasConversations = await canQueryTable(IVX_CHAT_CONFIG.tables.conversations, 'id');
  const hasMessages = await canQueryTable(IVX_CHAT_CONFIG.tables.messages, 'id');
  return hasConversations && hasMessages;
}

async function canUseAlternateSchema(): Promise<boolean> {
  const hasRooms = await canQueryTable(IVX_CHAT_CONFIG.tables.altConversations, 'id');
  const hasMessages = await canQueryTable(IVX_CHAT_CONFIG.tables.altMessages, 'id');
  return hasRooms && hasMessages;
}

async function canUseAlternateParticipants(): Promise<boolean> {
  return canQueryTable(IVX_CHAT_CONFIG.tables.altParticipants, 'id');
}

async function canUseSnapshotStorage(): Promise<boolean> {
  return canQueryTable(IVX_CHAT_CONFIG.tables.snapshots, 'id');
}

async function getSharedFallbackStatus(): Promise<ChatRoomStatus> {
  if (await canUseAlternateSchema()) {
    return getAlternateStatus();
  }

  if (await canUseSnapshotStorage()) {
    return getSnapshotStatus();
  }

  return getLocalStatus();
}

async function getSnapshotOrLocalStatus(): Promise<ChatRoomStatus> {
  if (await canUseSnapshotStorage()) {
    return getSnapshotStatus();
  }

  return getLocalStatus();
}

async function readLocalMessages(conversationId: string): Promise<ChatMessage[]> {
  try {
    const raw = await AsyncStorage.getItem(getLocalStorageKey(conversationId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is ChatMessage => isRecord(item) && typeof item.id === 'string').sort(sortMessages);
  } catch (error) {
    console.log('[IVXChat] Local message read failed:', (error as Error)?.message ?? 'Unknown error');
    return [];
  }
}

async function writeLocalMessages(conversationId: string, messages: ChatMessage[]): Promise<void> {
  const trimmedMessages = [...messages].sort(sortMessages).slice(-CHAT_LOCAL_MAX_MESSAGES);
  await AsyncStorage.setItem(getLocalStorageKey(conversationId), JSON.stringify(trimmedMessages));
}

async function appendLocalMessage(conversationId: string, message: ChatMessage): Promise<void> {
  const existing = await readLocalMessages(conversationId);
  await writeLocalMessages(conversationId, [...existing, message]);
}

function buildSnapshotPayload(message: ChatMessage): Record<string, unknown> {
  return {
    conversationId: message.conversationId,
    senderId: message.senderId,
    senderLabel: message.senderLabel ?? null,
    text: message.text ?? null,
    fileUrl: message.fileUrl ?? null,
    fileStorageBucket: message.fileStorageBucket ?? null,
    fileStoragePath: message.fileStoragePath ?? null,
    fileType: message.fileType ?? null,
    fileName: message.fileName ?? null,
    fileMime: message.fileMime ?? null,
    fileSize: message.fileSize ?? null,
    readBy: message.readBy ?? null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt ?? null,
  };
}

async function saveSnapshotMessage(conversationId: string, message: ChatMessage): Promise<void> {
  const { error } = await supabase.from(IVX_CHAT_CONFIG.tables.snapshots).insert({
    snapshot_type: getFallbackSnapshotType(conversationId),
    data: buildSnapshotPayload(message),
    active_visitors: 0,
  });

  if (error) {
    throw error;
  }
}

function getDraftFromInput(input: SendMessageInput): MessageDraft {
  const text = safeTrim(input.text) || null;
  const fileUrl = safeTrim(input.fileUrl) || null;
  const fileStorageBucket = safeTrim(input.fileStorageBucket) || null;
  const fileStoragePath = safeTrim(input.fileStoragePath) || null;
  const fileType = resolveFileType(input.fileType ?? null, input.fileMime ?? null, fileUrl);
  const fileName = safeTrim(input.fileName) || null;
  const fileMime = safeTrim(input.fileMime) || null;
  const fileSize = typeof input.fileSize === 'number' ? input.fileSize : null;

  return {
    text,
    fileUrl,
    fileStorageBucket,
    fileStoragePath,
    fileType,
    fileName,
    fileMime,
    fileSize,
    clientMessageId: safeTrim(input.clientMessageId) || null,
  };
}

function createMessagePreview(draft: MessageDraft): string {
  if (draft.text) {
    return textPreview(draft.text);
  }

  if (draft.fileType === 'image') {
    return '[Image]';
  }

  if (draft.fileType === 'video') {
    return '[Video]';
  }

  if (draft.fileType === 'pdf') {
    return '[PDF]';
  }

  if (draft.fileType === 'file') {
    return `[File]${draft.fileName ? ` ${draft.fileName}` : ''}`;
  }

  return 'Attachment';
}

function createFallbackMessage(
  conversation: ChatConversation,
  senderId: string,
  senderLabel: string | null | undefined,
  draft: MessageDraft,
  deliveryMode: DeliveryMode,
): ChatMessage {
  return {
    id: randomUuid(),
    conversationId: conversation.id,
    senderId,
    senderLabel: senderLabel ?? null,
    text: draft.text,
    fileUrl: draft.fileUrl,
    fileStorageBucket: draft.fileStorageBucket,
    fileStoragePath: draft.fileStoragePath,
    fileType: draft.fileType,
    fileName: draft.fileName,
    fileMime: draft.fileMime,
    fileSize: draft.fileSize,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    readBy: [senderId],
    localOnly: deliveryMode === 'local_only',
    deliveryMode,
  };
}

async function readArrayBufferFromUpload(upload: UploadableFile): Promise<{ body: ArrayBuffer; mime: string | null; size: number | null }> {
  if (upload.file && typeof upload.file.arrayBuffer === 'function') {
    const body = await upload.file.arrayBuffer();
    const mime = safeTrim(upload.type) || safeTrim(upload.file.type) || null;
    const size = typeof upload.size === 'number'
      ? upload.size
      : typeof upload.file.size === 'number'
        ? upload.file.size
        : body.byteLength;

    return {
      body,
      mime,
      size,
    };
  }

  if (upload.uri) {
    const response = await fetch(upload.uri);
    if (!response.ok) {
      throw new Error('Could not read the selected attachment.');
    }

    const body = await response.arrayBuffer();
    const headerMime = response.headers.get('content-type');
    const mime = safeTrim(upload.type) || safeTrim(headerMime) || null;
    const size = typeof upload.size === 'number' ? upload.size : body.byteLength;

    return {
      body,
      mime,
      size,
    };
  }

  throw new Error('No attachment payload was provided.');
}

function sanitizeFileName(value: string | null | undefined): string {
  const trimmed = safeTrim(value);
  if (!trimmed) {
    return `upload-${Date.now()}`;
  }

  return trimmed.replace(/[^a-zA-Z0-9._-]/g, '-');
}

function createLocalPreviewUrl(upload: UploadableFile): string | null {
  if (upload.uri) {
    return upload.uri;
  }

  const urlFactory = (globalThis as { URL?: { createObjectURL?: (value: unknown) => string } }).URL?.createObjectURL;
  if (upload.file && typeof urlFactory === 'function') {
    try {
      return urlFactory(upload.file);
    } catch {
      return null;
    }
  }

  return null;
}

async function uploadToBucket(bucket: string, conversationId: string, upload: UploadableFile): Promise<ResolvedAttachment> {
  const { body, mime, size } = await readArrayBufferFromUpload(upload);
  if (size && size > IVX_CHAT_CONFIG.limits.maxFileSizeBytes) {
    throw new Error('File exceeds the maximum upload size.');
  }

  if (!isAllowedMime(mime)) {
    throw new Error('That attachment type is not allowed in this room.');
  }

  const safeName = sanitizeFileName(upload.name);
  const uploadPath = `rooms/${conversationId}/${Date.now()}-${safeName}`;
  const { error } = await supabase.storage.from(bucket).upload(uploadPath, body, {
    cacheControl: '3600',
    upsert: false,
    contentType: mime ?? undefined,
  });

  if (error) {
    throw error;
  }

  const { data } = supabase.storage.from(bucket).getPublicUrl(uploadPath);
  const publicUrl = safeTrim(data.publicUrl);
  if (!publicUrl) {
    throw new Error('Upload completed but no public URL was returned.');
  }

  const fileType = resolveFileType(null, mime, publicUrl) ?? 'file';

  return {
    fileUrl: publicUrl,
    fileStorageBucket: bucket,
    fileStoragePath: uploadPath,
    fileType,
    fileName: safeName,
    fileMime: mime,
    fileSize: size,
  };
}

function mergeDraftWithAttachment(draft: MessageDraft, attachment: ResolvedAttachment): MessageDraft {
  return {
    text: draft.text,
    fileUrl: attachment.fileUrl,
    fileStorageBucket: attachment.fileStorageBucket,
    fileStoragePath: attachment.fileStoragePath,
    fileType: attachment.fileType,
    fileName: attachment.fileName,
    fileMime: attachment.fileMime,
    fileSize: attachment.fileSize,
    clientMessageId: draft.clientMessageId,
  };
}

async function resolvePrimaryConversation(shell: RoomShell): Promise<ChatConversation> {
  if (!isUuidConversationId(shell.id)) {
    throw new Error('Primary IVX rooms require a UUID-backed conversation id.');
  }

  const { data: existing, error: existingError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.conversations)
    .select('*')
    .eq('id', shell.id)
    .maybeSingle();

  if (existingError && !isSchemaMissingError(existingError) && !isColumnMissingError(existingError)) {
    throw existingError;
  }

  if (existing) {
    return mapConversationRow(existing as ConversationRow, shell);
  }

  const existingBySlug = await findPrimaryConversationBySlug(shell);
  if (existingBySlug) {
    return mapConversationRow(existingBySlug, shell);
  }

  const payloads = uniquePayloads([
    {
      id: shell.id,
      slug: shell.slug,
      title: shell.title,
      subtitle: shell.subtitle,
      last_message_text: null,
      last_message_at: null,
    },
    {
      id: shell.id,
      title: shell.title,
      subtitle: shell.subtitle,
      last_message_text: null,
      last_message_at: null,
    },
    {
      id: shell.id,
      title: shell.title,
      subtitle: shell.subtitle,
    },
  ]);

  let lastError: ErrorLike | null = null;

  for (const payload of payloads) {
    const { error } = await supabase.from(IVX_CHAT_CONFIG.tables.conversations).upsert(payload, { onConflict: 'id' });
    if (!error) {
      const { data } = await supabase
        .from(IVX_CHAT_CONFIG.tables.conversations)
        .select('*')
        .eq('id', shell.id)
        .maybeSingle();

      return mapConversationRow((data ?? payload) as ConversationRow, shell);
    }

    lastError = error;
    if (isColumnMissingError(error) || isSchemaMissingError(error)) {
      continue;
    }

    throw error;
  }

  if (lastError) {
    throw lastError;
  }

  return mapConversationRow(null, shell);
}

async function resolveAlternateConversation(shell: RoomShell): Promise<ChatConversation> {
  const { data: existingById, error: byIdError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altConversations)
    .select('*')
    .eq('id', shell.id)
    .maybeSingle();

  if (byIdError && !isSchemaMissingError(byIdError) && !isColumnMissingError(byIdError)) {
    throw byIdError;
  }

  if (existingById) {
    return mapConversationRow(existingById as ConversationRow, shell);
  }

  const existingBySlug = await findAlternateConversationBySlug(shell);
  if (existingBySlug) {
    return mapConversationRow(existingBySlug, shell);
  }

  const payloads = uniquePayloads([
    {
      id: shell.id,
      slug: shell.slug,
      title: shell.title,
      subtitle: shell.subtitle,
    },
    {
      id: shell.id,
      slug: shell.slug,
    },
    {
      id: shell.id,
      title: shell.title,
      subtitle: shell.subtitle,
    },
    {
      id: shell.id,
    },
  ]);

  let lastError: ErrorLike | null = null;

  for (const payload of payloads) {
    const { error } = await supabase.from(IVX_CHAT_CONFIG.tables.altConversations).upsert(payload, { onConflict: 'id' });
    if (!error) {
      const { data } = await supabase
        .from(IVX_CHAT_CONFIG.tables.altConversations)
        .select('*')
        .eq('id', shell.id)
        .maybeSingle();

      return mapConversationRow((data ?? payload) as ConversationRow, shell);
    }

    lastError = error;
    if (isColumnMissingError(error) || isSchemaMissingError(error)) {
      continue;
    }

    throw error;
  }

  if (lastError) {
    throw lastError;
  }

  return mapConversationRow(null, shell);
}

async function bootstrapRoomForStatus(requestedKey: string, status: ChatRoomStatus): Promise<{ conversation: ChatConversation; status: ChatRoomStatus }> {
  const shell = makeRoomShell(requestedKey, status);

  if (status.storageMode === 'primary_supabase_tables') {
    try {
      const conversation = await resolvePrimaryConversation(shell);
      return { conversation, status };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError)) {
        const nextStatus = await getSharedFallbackStatus();
        if (nextStatus.storageMode !== status.storageMode) {
          return bootstrapRoomForStatus(requestedKey, nextStatus);
        }
      }

      if (shouldUseLocalFallback(nextError)) {
        return bootstrapRoomForStatus(requestedKey, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  if (status.storageMode === 'alternate_room_schema') {
    try {
      const conversation = await resolveAlternateConversation(shell);
      return { conversation, status };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError) || shouldUseLocalFallback(nextError)) {
        return bootstrapRoomForStatus(requestedKey, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  return {
    conversation: {
      id: shell.id,
      slug: shell.slug,
      title: shell.title,
      subtitle: shell.subtitle,
      lastMessageText: null,
      lastMessageAt: null,
      unreadCount: 0,
    },
    status,
  };
}

export async function detectRoomStatus(): Promise<ChatRoomStatus> {
  console.log('[detectRoomStatus] Starting Supabase table probe');

  if (await canUsePrimarySchema()) {
    const status = getPrimaryStatus();
    console.log('[detectRoomStatus] Result: primary_supabase_tables reachable, delivery:', status.deliveryMethod);
    return status;
  }

  if (await canUseAlternateSchema()) {
    const status = getAlternateStatus();
    console.log('[detectRoomStatus] Result: alternate_room_schema reachable, delivery:', status.deliveryMethod);
    return status;
  }

  if (await canUseSnapshotStorage()) {
    const status = getSnapshotStatus();
    console.log('[detectRoomStatus] Result: snapshot_storage reachable, delivery:', status.deliveryMethod);
    return status;
  }

  const status = getLocalStatus();
  console.log('[detectRoomStatus] Result: no shared tables reachable, falling back to local_device_only');
  return status;
}

export async function bootstrapRoomByFriendlySlug(requestedKey: string = IVX_CHAT_CONFIG.friendlyOwnerRoomSlug): Promise<{
  conversation: ChatConversation;
  status: ChatRoomStatus;
}> {
  return bootstrapRoomForStatus(requestedKey, await getCachedOrDetectRoomStatus());
}

async function ensurePrimaryParticipant(conversationId: string, actorId: string): Promise<void> {
  const payloads = uniquePayloads([
    {
      conversation_id: conversationId,
      user_id: actorId,
      unread_count: 0,
      last_read_at: nowIso(),
    },
    {
      conversation_id: conversationId,
      user_id: actorId,
    },
  ]);

  for (const payload of payloads) {
    const { error } = await supabase.from(IVX_CHAT_CONFIG.tables.participants).upsert(payload, {
      onConflict: 'conversation_id,user_id',
    });

    if (!error) {
      return;
    }

    if (isColumnMissingError(error) || isSchemaMissingError(error)) {
      continue;
    }

    throw error;
  }
}

async function ensureAlternateParticipant(conversationId: string, actorId: string): Promise<void> {
  if (!(await canUseAlternateParticipants())) {
    return;
  }

  const payloads = uniquePayloads([
    {
      room_id: conversationId,
      user_id: actorId,
      unread_count: 0,
      last_read_at: nowIso(),
    },
    {
      room_id: conversationId,
      actor_id: actorId,
      unread_count: 0,
      last_read_at: nowIso(),
    },
    {
      room_id: conversationId,
      user_id: actorId,
    },
    {
      room_id: conversationId,
      actor_id: actorId,
    },
  ]);

  for (const payload of payloads) {
    const { error } = await supabase.from(IVX_CHAT_CONFIG.tables.altParticipants).upsert(payload, {
      onConflict: 'room_id,user_id',
    });

    if (!error) {
      return;
    }

    if (isColumnMissingError(error) || isSchemaMissingError(error)) {
      continue;
    }

    const actorPayloadError = await supabase.from(IVX_CHAT_CONFIG.tables.altParticipants).upsert(payload, {
      onConflict: 'room_id,actor_id',
    });

    if (!actorPayloadError.error) {
      return;
    }

    if (isColumnMissingError(actorPayloadError.error) || isSchemaMissingError(actorPayloadError.error)) {
      continue;
    }

    throw actorPayloadError.error;
  }
}

export async function ensureParticipant(
  conversationId: string,
  actor: { actorId: string; displayName?: string | null; avatarUrl?: string | null },
): Promise<void> {
  const status = await detectRoomStatus();
  const actorId = ensureActorId(actor.actorId);

  if (status.storageMode === 'primary_supabase_tables') {
    await ensurePrimaryParticipant(conversationId, actorId);
    return;
  }

  if (status.storageMode === 'alternate_room_schema') {
    await ensureAlternateParticipant(conversationId, actorId);
  }
}

const RECENT_TAIL_LIMIT = 50;

async function loadPrimaryMessages(conversationId: string, beforeCreatedAt?: string | null): Promise<ChatMessage[]> {
  let query = supabase
    .from(IVX_CHAT_CONFIG.tables.messages)
    .select('*')
    .eq('conversation_id', conversationId);

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(RECENT_TAIL_LIMIT);

  if (error) {
    throw error;
  }

  // Server returns newest→oldest; reverse so display is oldest→newest (latest at bottom).
  return ((data ?? []) as MessageRow[])
    .map((row) => mapMessageRow(row, conversationId, 'primary_realtime'))
    .reverse()
    .sort(sortMessages);
}

async function loadAlternateMessages(conversationId: string, beforeCreatedAt?: string | null): Promise<ChatMessage[]> {
  let query = supabase
    .from(IVX_CHAT_CONFIG.tables.altMessages)
    .select('*')
    .eq('room_id', conversationId);

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(RECENT_TAIL_LIMIT);

  if (error) {
    throw error;
  }

  return ((data ?? []) as MessageRow[])
    .map((row) => mapMessageRow(row, conversationId, 'alternate_shared'))
    .reverse()
    .sort(sortMessages);
}

async function loadSnapshotMessages(conversationId: string, beforeCreatedAt?: string | null): Promise<ChatMessage[]> {
  let query = supabase
    .from(IVX_CHAT_CONFIG.tables.snapshots)
    .select('id,data,created_at')
    .eq('snapshot_type', getFallbackSnapshotType(conversationId));

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt);
  }

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(RECENT_TAIL_LIMIT);

  if (error) {
    throw error;
  }

  return ((data ?? []) as SnapshotRow[]).map((row) => {
    const payload = isRecord(row.data) ? row.data : {};
    return {
      id: readString(row.id) ?? randomUuid(),
      conversationId: readString(payload.conversationId) ?? conversationId,
      senderId: readString(payload.senderId) ?? '',
      senderLabel: readString(payload.senderLabel),
      text: readString(payload.text),
      fileUrl: readString(payload.fileUrl),
      fileType: resolveFileType(readString(payload.fileType), readString(payload.fileMime), readString(payload.fileUrl)),
      fileName: readString(payload.fileName),
      fileMime: readString(payload.fileMime),
      fileSize: readNumber(payload.fileSize),
      createdAt: readString(payload.createdAt) ?? readString(row.created_at) ?? nowIso(),
      updatedAt: readString(payload.updatedAt),
      readBy: readStringArray(payload.readBy),
      localOnly: false,
      deliveryMode: 'snapshot_fallback',
    } satisfies ChatMessage;
  }).reverse().sort(sortMessages);
}

async function loadRoomMessagesForStatus(
  requestedKey: string,
  status: ChatRoomStatus,
  beforeCreatedAt?: string | null,
): Promise<{
  conversation: ChatConversation;
  status: ChatRoomStatus;
  messages: ChatMessage[];
}> {
  const { conversation } = await bootstrapRoomForStatus(requestedKey, status);

  if (status.storageMode === 'primary_supabase_tables') {
    try {
      const messages = await loadPrimaryMessages(conversation.id, beforeCreatedAt);
      return {
        conversation,
        status,
        messages,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError)) {
        return loadRoomMessagesForStatus(requestedKey, await getSharedFallbackStatus());
      }

      if (shouldUseLocalFallback(nextError)) {
        return loadRoomMessagesForStatus(requestedKey, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  if (status.storageMode === 'alternate_room_schema') {
    try {
      const messages = await loadAlternateMessages(conversation.id, beforeCreatedAt);
      return {
        conversation,
        status,
        messages,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError) || shouldUseLocalFallback(nextError)) {
        return loadRoomMessagesForStatus(requestedKey, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  if (status.storageMode === 'snapshot_storage') {
    try {
      const messages = await loadSnapshotMessages(conversation.id, beforeCreatedAt);
      return {
        conversation,
        status,
        messages,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldUseLocalFallback(nextError) || shouldTrySharedFallback(nextError)) {
        return loadRoomMessagesForStatus(requestedKey, getLocalStatus());
      }

      throw error;
    }
  }

  return {
    conversation,
    status,
    messages: await readLocalMessages(conversation.id),
  };
}

export async function loadRoomMessages(
  requestedKey: string = IVX_CHAT_CONFIG.friendlyOwnerRoomSlug,
  beforeCreatedAt?: string | null,
): Promise<{
  conversation: ChatConversation;
  status: ChatRoomStatus;
  messages: ChatMessage[];
}> {
  return loadRoomMessagesForStatus(requestedKey, await getCachedOrDetectRoomStatus(), beforeCreatedAt);
}

async function updatePrimaryConversationSummary(conversationId: string, preview: string): Promise<void> {
  const { error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.conversations)
    .update({
      last_message_text: preview,
      last_message_at: nowIso(),
    })
    .eq('id', conversationId);

  if (error && !isColumnMissingError(error) && !isSchemaMissingError(error)) {
    console.log('[IVXChat] Primary summary update note:', error.message);
  }
}

async function updateAlternateConversationSummary(conversationId: string, preview: string): Promise<void> {
  const { error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altConversations)
    .update({
      last_message_text: preview,
      last_message_at: nowIso(),
    })
    .eq('id', conversationId);

  if (error && !isColumnMissingError(error) && !isSchemaMissingError(error)) {
    console.log('[IVXChat] Alternate summary update note:', error.message);
  }
}

async function incrementPrimaryUnread(conversationId: string, senderId: string): Promise<void> {
  const { data, error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.participants)
    .select('conversation_id,user_id,unread_count,last_read_at')
    .eq('conversation_id', conversationId);

  if (error || !data) {
    if (error) {
      console.log('[IVXChat] Primary unread sync note:', error.message);
    }
    return;
  }

  await Promise.all(((data ?? []) as Record<string, unknown>[]).map(async (row) => {
    const participant = mapPrimaryParticipantRow(row);
    if (!participant.userId || participant.userId === senderId) {
      return;
    }

    const nextUnread = (participant.unreadCount ?? 0) + 1;
    const { error: updateError } = await supabase
      .from(IVX_CHAT_CONFIG.tables.participants)
      .update({
        unread_count: nextUnread,
      })
      .eq('conversation_id', conversationId)
      .eq('user_id', participant.userId);

    if (updateError && !isColumnMissingError(updateError) && !isSchemaMissingError(updateError)) {
      console.log('[IVXChat] Primary unread update note:', updateError.message);
    }
  }));
}

async function incrementAlternateUnread(conversationId: string, senderId: string): Promise<void> {
  if (!(await canUseAlternateParticipants())) {
    return;
  }

  const { data, error } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altParticipants)
    .select('*')
    .eq('room_id', conversationId);

  if (error || !data) {
    if (error) {
      console.log('[IVXChat] Alternate unread sync note:', error.message);
    }
    return;
  }

  await Promise.all(((data ?? []) as Record<string, unknown>[]).map(async (row) => {
    const participantId = readString(row.user_id) ?? readString(row.actor_id) ?? '';
    if (!participantId || participantId === senderId) {
      return;
    }

    const unreadCount = readNumber(row.unread_count) ?? 0;
    const nextUnread = unreadCount + 1;

    const updatePayload = compactPayload({
      unread_count: nextUnread,
    });

    const userResult = await supabase
      .from(IVX_CHAT_CONFIG.tables.altParticipants)
      .update(updatePayload)
      .eq('room_id', conversationId)
      .eq('user_id', participantId);

    if (!userResult.error) {
      return;
    }

    const actorResult = await supabase
      .from(IVX_CHAT_CONFIG.tables.altParticipants)
      .update(updatePayload)
      .eq('room_id', conversationId)
      .eq('actor_id', participantId);

    if (actorResult.error && !isColumnMissingError(actorResult.error) && !isSchemaMissingError(actorResult.error)) {
      console.log('[IVXChat] Alternate unread update note:', actorResult.error.message);
    }
  }));
}

function buildPrimaryMessagePayloads(conversationId: string, senderId: string, draft: MessageDraft): Record<string, unknown>[] {
  const fullAttachmentPayload = {
    file_url: draft.fileUrl,
    file_storage_bucket: draft.fileStorageBucket,
    file_storage_path: draft.fileStoragePath,
    file_type: draft.fileType,
    file_name: draft.fileName ?? draft.clientMessageId,
    file_mime: draft.fileMime,
    file_size: draft.fileSize,
    client_message_id: draft.clientMessageId,
  };
  const attachmentPayload = {
    file_url: draft.fileUrl,
    file_type: draft.fileType,
    file_name: draft.fileName ?? draft.clientMessageId,
    file_mime: draft.fileMime,
    file_size: draft.fileSize,
  };
  const legacyAttachmentPayload = {
    file_url: draft.fileUrl,
    file_type: draft.fileType,
    file_name: draft.clientMessageId ?? draft.fileName,
  };

  return uniquePayloads([
    {
      id: randomUuid(),
      conversation_id: conversationId,
      sender_id: senderId,
      sender_label: null,
      text: draft.text,
      body: draft.text,
      ...fullAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      id: randomUuid(),
      conversation_id: conversationId,
      sender_id: senderId,
      text: draft.text,
      body: draft.text,
      ...attachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      id: randomUuid(),
      conversation_id: conversationId,
      sender_id: senderId,
      text: draft.text,
      body: draft.text,
      ...legacyAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      conversation_id: conversationId,
      sender_id: senderId,
      text: draft.text,
      ...legacyAttachmentPayload,
      read_by: [senderId],
    },
  ]);
}

function buildAlternateMessagePayloads(conversationId: string, senderId: string, draft: MessageDraft): Record<string, unknown>[] {
  const fullAttachmentPayload = {
    file_url: draft.fileUrl,
    file_storage_bucket: draft.fileStorageBucket,
    file_storage_path: draft.fileStoragePath,
    file_type: draft.fileType,
    file_name: draft.fileName ?? draft.clientMessageId,
    file_mime: draft.fileMime,
    file_size: draft.fileSize,
    client_message_id: draft.clientMessageId,
  };
  const legacyAttachmentPayload = {
    file_url: draft.fileUrl,
    file_type: draft.fileType,
    file_name: draft.clientMessageId ?? draft.fileName,
  };

  return uniquePayloads([
    {
      id: randomUuid(),
      room_id: conversationId,
      sender_id: senderId,
      body: draft.text,
      ...fullAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      id: randomUuid(),
      room_id: conversationId,
      user_id: senderId,
      body: draft.text,
      ...fullAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      id: randomUuid(),
      room_id: conversationId,
      sender_id: senderId,
      body: draft.text,
      ...legacyAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      id: randomUuid(),
      room_id: conversationId,
      user_id: senderId,
      body: draft.text,
      ...legacyAttachmentPayload,
      read_by: [senderId],
      created_at: nowIso(),
    },
    {
      room_id: conversationId,
      sender_id: senderId,
      text: draft.text,
      ...legacyAttachmentPayload,
      created_at: nowIso(),
    },
    {
      room_id: conversationId,
      user_id: senderId,
      text: draft.text,
      ...legacyAttachmentPayload,
      created_at: nowIso(),
    },
    {
      room_id: conversationId,
      body: draft.text,
      ...legacyAttachmentPayload,
    },
  ]);
}

async function insertMessageWithPayloads(
  table: string,
  payloads: Record<string, unknown>[],
  existingMessageLookup?: () => Promise<MessageRow | null>,
): Promise<MessageRow> {
  let lastError: ErrorLike | null = null;

  for (const payload of payloads) {
    const { data, error } = await supabase.from(table).insert(payload).select('*').single();
    if (!error && data) {
      return data as MessageRow;
    }

    lastError = error;
    if (error && (isColumnMissingError(error) || isSchemaMissingError(error) || isInvalidUuidSyntaxError(error))) {
      continue;
    }

    if (error) {
      throw error;
    }
  }

  if (lastError) {
    const duplicateMessage = await existingMessageLookup?.();
    if (duplicateMessage) {
      console.log('[IVXChat] Reusing existing message after duplicate insert attempt:', {
        table,
        messageId: readString(duplicateMessage.id) ?? 'unknown',
      });
      return duplicateMessage;
    }
    throw lastError;
  }

  throw new Error('Message insert failed.');
}

async function buildDraftForPrimary(conversationId: string, input: SendMessageInput): Promise<MessageDraft> {
  const baseDraft = getDraftFromInput(input);
  if (!input.upload) {
    return baseDraft;
  }

  const attachment = await uploadToBucket(getPrimaryBucketName(), conversationId, input.upload);
  return mergeDraftWithAttachment(baseDraft, attachment);
}

async function buildDraftForAlternate(conversationId: string, input: SendMessageInput): Promise<MessageDraft> {
  const baseDraft = getDraftFromInput(input);
  if (!input.upload) {
    return baseDraft;
  }

  const attachment = await uploadToBucket(IVX_CHAT_CONFIG.storage.alternateBucket, conversationId, input.upload);
  return mergeDraftWithAttachment(baseDraft, attachment);
}

function buildFallbackDraft(input: SendMessageInput): MessageDraft {
  const baseDraft = getDraftFromInput(input);
  if (!input.upload) {
    return baseDraft;
  }

  const previewUrl = createLocalPreviewUrl(input.upload);
  return {
    text: baseDraft.text,
    fileUrl: previewUrl,
    fileStorageBucket: baseDraft.fileStorageBucket,
    fileStoragePath: baseDraft.fileStoragePath,
    fileType: baseDraft.fileType ?? resolveFileType(null, input.upload.type ?? null, previewUrl) ?? 'file',
    fileName: baseDraft.fileName || sanitizeFileName(input.upload.name),
    fileMime: baseDraft.fileMime || safeTrim(input.upload.type) || null,
    fileSize: baseDraft.fileSize ?? input.upload.size ?? null,
    clientMessageId: baseDraft.clientMessageId,
  };
}

async function sendMessageForStatus(
  input: SendMessageInput,
  status: ChatRoomStatus,
): Promise<{ message: ChatMessage; status: ChatRoomStatus }> {
  const actorId = ensureActorId(input.senderId);
  const { conversation } = await bootstrapRoomForStatus(input.conversationId, status);

  if (status.storageMode === 'primary_supabase_tables') {
    try {
      await ensurePrimaryParticipant(conversation.id, actorId);
      const draft = await buildDraftForPrimary(conversation.id, input);
      const row = await insertMessageWithPayloads(
        IVX_CHAT_CONFIG.tables.messages,
        buildPrimaryMessagePayloads(conversation.id, actorId, draft),
        async () => {
          const { data, error } = await supabase
            .from(IVX_CHAT_CONFIG.tables.messages)
            .select('*')
            .eq('conversation_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(10);

          if (error) {
            console.log('[IVXChat] Primary duplicate lookup note:', error.message);
            return null;
          }

          const match = ((data ?? []) as MessageRow[]).find((rowCandidate) => {
            return buildMessageSignature(rowCandidate, conversation.id) === buildMessageSignature(buildPrimaryMessagePayloads(conversation.id, actorId, draft)[0] ?? null, conversation.id)
              || (draft.clientMessageId && readString(rowCandidate.client_message_id) === draft.clientMessageId)
              || (draft.clientMessageId && readString(rowCandidate.file_name) === draft.clientMessageId);
          });

          return match ?? null;
        },
      );
      await updatePrimaryConversationSummary(conversation.id, createMessagePreview(draft));
      await incrementPrimaryUnread(conversation.id, actorId);

      return {
        message: mapMessageRow(row, conversation.id, 'primary_realtime', draft),
        status,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError)) {
        return sendMessageForStatus(input, await getSharedFallbackStatus());
      }

      if (shouldUseLocalFallback(nextError)) {
        return sendMessageForStatus(input, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  if (status.storageMode === 'alternate_room_schema') {
    try {
      await ensureAlternateParticipant(conversation.id, actorId).catch((participantError) => {
        console.log('[IVXChat] Alternate participant note:', (participantError as Error)?.message ?? 'Unknown error');
      });
      const draft = await buildDraftForAlternate(conversation.id, input);
      const row = await insertMessageWithPayloads(
        IVX_CHAT_CONFIG.tables.altMessages,
        buildAlternateMessagePayloads(conversation.id, actorId, draft),
        async () => {
          const { data, error } = await supabase
            .from(IVX_CHAT_CONFIG.tables.altMessages)
            .select('*')
            .eq('room_id', conversation.id)
            .order('created_at', { ascending: false })
            .limit(10);

          if (error) {
            console.log('[IVXChat] Alternate duplicate lookup note:', error.message);
            return null;
          }

          const match = ((data ?? []) as MessageRow[]).find((rowCandidate) => {
            return buildMessageSignature(rowCandidate, conversation.id) === buildMessageSignature(buildAlternateMessagePayloads(conversation.id, actorId, draft)[0] ?? null, conversation.id)
              || (draft.clientMessageId && readString(rowCandidate.client_message_id) === draft.clientMessageId)
              || (draft.clientMessageId && readString(rowCandidate.file_name) === draft.clientMessageId);
          });

          return match ?? null;
        },
      );
      await updateAlternateConversationSummary(conversation.id, createMessagePreview(draft));
      await incrementAlternateUnread(conversation.id, actorId);

      return {
        message: mapMessageRow(row, conversation.id, 'alternate_shared', draft),
        status,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError) || shouldUseLocalFallback(nextError)) {
        return sendMessageForStatus(input, await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  const draft = buildFallbackDraft(input);
  const message = createFallbackMessage(conversation, actorId, input.senderLabel, draft, status.deliveryMethod);

  if (status.storageMode === 'snapshot_storage') {
    try {
      await saveSnapshotMessage(conversation.id, message);
      return {
        message: {
          ...message,
          localOnly: false,
          deliveryMode: 'snapshot_fallback',
        },
        status,
      };
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldUseLocalFallback(nextError) || shouldTrySharedFallback(nextError)) {
        return sendMessageForStatus(input, getLocalStatus());
      }

      throw error;
    }
  }

  await appendLocalMessage(conversation.id, message);
  return {
    message,
    status,
  };
}

export async function sendTextMessage(input: SendMessageInput): Promise<{ message: ChatMessage; status: ChatRoomStatus }> {
  const trimmedText = safeTrim(input.text);
  if (!trimmedText) {
    throw new Error('Please enter a message before sending.');
  }

  const sendPayload = {
    ...input,
    text: trimmedText,
    upload: undefined,
    fileUrl: undefined,
    fileType: undefined,
    fileName: undefined,
    fileMime: undefined,
    fileSize: undefined,
  };

  let status: ChatRoomStatus;
  try {
    status = await getCachedOrDetectRoomStatus();
  } catch (detectError) {
    console.log('[IVXChat] sendTextMessage: room detection failed, using local fallback:', (detectError as Error)?.message);
    status = getLocalStatus();
  }

  return withTimeout(
    sendMessageForStatus(sendPayload, status),
    CHAT_SEND_TIMEOUT_MS,
    'sendTextMessage',
  );
}

export async function sendAttachmentMessage(input: SendMessageInput): Promise<{ message: ChatMessage; status: ChatRoomStatus }> {
  const hasUpload = !!input.upload;
  const hasLinkedFile = !!safeTrim(input.fileUrl);
  if (!hasUpload && !hasLinkedFile) {
    throw new Error('Please choose an attachment before sending.');
  }

  let status: ChatRoomStatus;
  try {
    status = await getCachedOrDetectRoomStatus();
  } catch (detectError) {
    console.log('[IVXChat] sendAttachmentMessage: room detection failed, using local fallback:', (detectError as Error)?.message);
    status = getLocalStatus();
  }

  return withTimeout(
    sendMessageForStatus(input, status),
    CHAT_SEND_TIMEOUT_MS,
    'sendAttachmentMessage',
  );
}

export async function subscribeToRoomMessages(
  conversationKey: string,
  onMessage: (message: ChatMessage) => void,
  onStatus?: (status: ChatRoomStatus) => void,
): Promise<MessageSubscription> {
  const loaded = await loadRoomMessages(conversationKey);
  const subscriptionKey = loaded.conversation.id;
  const existingSubscription = activeRoomMessageSubscriptions.get(subscriptionKey);

  if (existingSubscription) {
    existingSubscription.listeners.add(onMessage);
    if (onStatus) {
      existingSubscription.statusListeners.add(onStatus);
      onStatus(existingSubscription.status);
    }

    let closed = false;
    return {
      unsubscribe: () => {
        if (closed) {
          return;
        }

        closed = true;
        existingSubscription.listeners.delete(onMessage);
        if (onStatus) {
          existingSubscription.statusListeners.delete(onStatus);
        }

        if (existingSubscription.listeners.size === 0 && existingSubscription.statusListeners.size === 0) {
          existingSubscription.dispose();
          activeRoomMessageSubscriptions.delete(subscriptionKey);
        }
      },
    };
  }

  const seenIds = new Set<string>(loaded.messages.map((message) => message.id));
  const requestedKey = loaded.conversation.slug ?? conversationKey;
  let disposed = false;
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  const messageListeners = new Set<(message: ChatMessage) => void>([onMessage]);
  const statusListeners = new Set<(status: ChatRoomStatus) => void>();
  if (onStatus) {
    statusListeners.add(onStatus);
  }

  const emitStatus = (status: ChatRoomStatus): void => {
    const subscriptionRecord = activeRoomMessageSubscriptions.get(subscriptionKey);
    if (subscriptionRecord) {
      subscriptionRecord.status = status;
    }
    cacheRoomStatus(status);
    statusListeners.forEach((listener) => {
      listener(status);
    });
  };

  const emitMessage = (message: ChatMessage): void => {
    messageListeners.forEach((listener) => {
      listener(message);
    });
  };

  const stopPolling = (): void => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  const markDisposed = (): void => {
    disposed = true;
  };

  const pollForMessages = async (statusOverride?: ChatRoomStatus): Promise<void> => {
    if (disposed) {
      return;
    }

    try {
      const nextLoaded = await loadRoomMessages(requestedKey);
      const nextStatus = statusOverride ?? nextLoaded.status;
      emitStatus(nextStatus);
      nextLoaded.messages.forEach((message) => {
        if (!message.id || seenIds.has(message.id)) {
          return;
        }

        seenIds.add(message.id);
        emitMessage(message);
      });
    } catch (error) {
      console.log('[IVXChat] Room polling error:', (error as Error)?.message ?? 'Unknown error');
    }
  };

  emitStatus(loaded.status);

  let cleanup: () => void;

  if (loaded.status.storageMode === 'primary_supabase_tables') {
    const channel = supabase
      .channel(`ivx-room:${loaded.conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.messages,
          filter: `conversation_id=eq.${loaded.conversation.id}`,
        },
        (payload) => {
          const nextMessage = mapMessageRow(payload.new as MessageRow, loaded.conversation.id, 'primary_realtime');
          if (!nextMessage.id || seenIds.has(nextMessage.id) || disposed) {
            return;
          }

          seenIds.add(nextMessage.id);
          emitStatus(getPrimaryStatus('primary_realtime'));
          emitMessage(nextMessage);
        },
      )
      .subscribe((status) => {
        const normalizedStatus = String(status ?? '');
        console.log('[IVXChat] Primary room channel status:', normalizedStatus);

        if (disposed) {
          return;
        }

        if (normalizedStatus === 'SUBSCRIBED') {
          stopPolling();
          emitStatus(getPrimaryStatus('primary_realtime'));
          return;
        }

        if (normalizedStatus === 'CHANNEL_ERROR' || normalizedStatus === 'TIMED_OUT' || normalizedStatus === 'CLOSED') {
          emitStatus(getPrimaryStatus('primary_polling'));
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              void pollForMessages(getPrimaryStatus('primary_polling'));
            }, CHAT_POLL_INTERVAL_MS);
          }
        }
      });

    cleanup = createIdempotentChannelCleanup(channel, {
      label: `room:${loaded.conversation.id}:primary`,
      stopPolling,
      onClosed: markDisposed,
    });

    void pollForMessages(getPrimaryStatus('primary_polling'));
  } else if (loaded.status.storageMode === 'alternate_room_schema') {
    const channel = supabase
      .channel(`ivx-alt-room:${loaded.conversation.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.altMessages,
          filter: `room_id=eq.${loaded.conversation.id}`,
        },
        (payload) => {
          const nextMessage = mapMessageRow(payload.new as MessageRow, loaded.conversation.id, 'alternate_shared');
          if (!nextMessage.id || seenIds.has(nextMessage.id) || disposed) {
            return;
          }

          seenIds.add(nextMessage.id);
          emitStatus(getAlternateStatus());
          emitMessage(nextMessage);
        },
      )
      .subscribe((status) => {
        const normalizedStatus = String(status ?? '');
        console.log('[IVXChat] Alternate room channel status:', normalizedStatus);
        if (disposed) {
          return;
        }

        if (normalizedStatus === 'SUBSCRIBED') {
          stopPolling();
          emitStatus(getAlternateStatus());
          return;
        }

        if (normalizedStatus === 'CHANNEL_ERROR' || normalizedStatus === 'TIMED_OUT' || normalizedStatus === 'CLOSED') {
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              void pollForMessages(getAlternateStatus());
            }, CHAT_POLL_INTERVAL_MS);
          }
        }
      });

    cleanup = createIdempotentChannelCleanup(channel, {
      label: `room:${loaded.conversation.id}:alternate`,
      stopPolling,
      onClosed: markDisposed,
    });

    void pollForMessages(getAlternateStatus());
  } else {
    pollingInterval = setInterval(() => {
      void pollForMessages(loaded.status);
    }, CHAT_POLL_INTERVAL_MS);
    void pollForMessages(loaded.status);
    cleanup = createLocalIdempotentCleanup({
      label: `room:${loaded.conversation.id}:local`,
      stopPolling,
      onClosed: markDisposed,
    });
  }

  const subscriptionRecord: RoomMessageSubscriptionRecord = {
    key: subscriptionKey,
    listeners: messageListeners,
    statusListeners,
    status: loaded.status,
    dispose: cleanup,
  };
  activeRoomMessageSubscriptions.set(subscriptionKey, subscriptionRecord);

  let closed = false;
  return {
    unsubscribe: () => {
      if (closed) {
        return;
      }

      closed = true;
      messageListeners.delete(onMessage);
      if (onStatus) {
        statusListeners.delete(onStatus);
      }

      if (messageListeners.size === 0 && statusListeners.size === 0) {
        cleanup();
        activeRoomMessageSubscriptions.delete(subscriptionKey);
      }
    },
  };
}

export async function markConversationAsRead(conversationKey: string, actorId: string): Promise<void> {
  const cleanActorId = ensureActorId(actorId);
  const loaded = await bootstrapRoomByFriendlySlug(conversationKey);

  if (loaded.status.storageMode === 'primary_supabase_tables') {
    const { error } = await supabase
      .from(IVX_CHAT_CONFIG.tables.participants)
      .update({
        unread_count: 0,
        last_read_at: nowIso(),
      })
      .eq('conversation_id', loaded.conversation.id)
      .eq('user_id', cleanActorId);

    if (error && !isColumnMissingError(error) && !isSchemaMissingError(error)) {
      console.log('[IVXChat] markConversationAsRead note:', error.message);
    }
    return;
  }

  if (loaded.status.storageMode === 'alternate_room_schema' && (await canUseAlternateParticipants())) {
    const userResult = await supabase
      .from(IVX_CHAT_CONFIG.tables.altParticipants)
      .update({
        unread_count: 0,
        last_read_at: nowIso(),
      })
      .eq('room_id', loaded.conversation.id)
      .eq('user_id', cleanActorId);

    if (!userResult.error) {
      return;
    }

    const actorResult = await supabase
      .from(IVX_CHAT_CONFIG.tables.altParticipants)
      .update({
        unread_count: 0,
        last_read_at: nowIso(),
      })
      .eq('room_id', loaded.conversation.id)
      .eq('actor_id', cleanActorId);

    if (actorResult.error && !isColumnMissingError(actorResult.error) && !isSchemaMissingError(actorResult.error)) {
      console.log('[IVXChat] Alternate markConversationAsRead note:', actorResult.error.message);
    }
  }
}

function sortInboxItems(left: InboxItem, right: InboxItem): number {
  return new Date(right.lastMessageAt ?? 0).getTime() - new Date(left.lastMessageAt ?? 0).getTime();
}

function mapInboxItem(conversation: ChatConversation, unreadCount: number): InboxItem {
  return {
    conversationId: conversation.id,
    slug: conversation.slug ?? conversation.id,
    title: conversation.title,
    subtitle: conversation.subtitle,
    lastMessageText: conversation.lastMessageText,
    lastMessageAt: conversation.lastMessageAt,
    unreadCount,
  };
}

async function buildDefaultInbox(status: ChatRoomStatus): Promise<{ items: InboxItem[]; status: ChatRoomStatus }> {
  const boot = await bootstrapRoomForStatus(IVX_CHAT_CONFIG.friendlyOwnerRoomSlug, status);
  return {
    items: [
      {
        conversationId: boot.conversation.id,
        slug: boot.conversation.slug ?? IVX_CHAT_CONFIG.friendlyOwnerRoomSlug,
        title: boot.conversation.title,
        subtitle: boot.conversation.subtitle,
        lastMessageText: boot.conversation.lastMessageText,
        lastMessageAt: boot.conversation.lastMessageAt,
        unreadCount: boot.conversation.unreadCount ?? 0,
      },
    ],
    status,
  };
}

async function loadPrimaryInbox(actorId: string): Promise<{ items: InboxItem[]; status: ChatRoomStatus }> {
  const { data: participantRows, error: participantError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.participants)
    .select('conversation_id,user_id,unread_count,last_read_at')
    .eq('user_id', actorId);

  if (participantError) {
    throw participantError;
  }

  const participants = ((participantRows ?? []) as Record<string, unknown>[])
    .map(mapPrimaryParticipantRow)
    .filter((participant) => participant.conversationId.length > 0);

  const unreadMap = new Map<string, number>();
  participants.forEach((participant) => {
    unreadMap.set(participant.conversationId, participant.unreadCount ?? 0);
  });

  const conversationIds = participants.map((participant) => participant.conversationId);
  if (conversationIds.length === 0) {
    return buildDefaultInbox(getPrimaryStatus());
  }

  const { data: conversationRows, error: conversationError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.conversations)
    .select('*')
    .in('id', conversationIds)
    .order('last_message_at', { ascending: false });

  if (conversationError) {
    throw conversationError;
  }

  const shellMap = new Map<string, RoomShell>();
  conversationIds.forEach((conversationId) => {
    shellMap.set(conversationId, makeRoomShell(conversationId, getPrimaryStatus()));
  });

  const conversations = ((conversationRows ?? []) as ConversationRow[]).map((row) => {
    const id = readString(row.id) ?? '';
    const shell = shellMap.get(id) ?? makeRoomShell(id, getPrimaryStatus());
    return mapConversationRow(row, shell, unreadMap.get(id) ?? 0);
  });

  const missingConversations = conversationIds
    .filter((conversationId) => !conversations.some((conversation) => conversation.id === conversationId))
    .map((conversationId) => mapConversationRow(null, shellMap.get(conversationId) ?? makeRoomShell(conversationId, getPrimaryStatus()), unreadMap.get(conversationId) ?? 0));

  return {
    items: [...conversations, ...missingConversations].map((conversation) => mapInboxItem(conversation, unreadMap.get(conversation.id) ?? 0)).sort(sortInboxItems),
    status: getPrimaryStatus(),
  };
}

async function loadAlternateInbox(actorId: string): Promise<{ items: InboxItem[]; status: ChatRoomStatus }> {
  if (!(await canUseAlternateParticipants())) {
    return buildDefaultInbox(getAlternateStatus());
  }

  const { data: participantRows, error: participantError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altParticipants)
    .select('*')
    .or(`user_id.eq.${actorId},actor_id.eq.${actorId}`);

  if (participantError) {
    throw participantError;
  }

  const roomIds = ((participantRows ?? []) as Record<string, unknown>[])
    .map((row) => readString(row.room_id))
    .filter((value): value is string => !!value);

  const unreadMap = new Map<string, number>();
  ((participantRows ?? []) as Record<string, unknown>[]).forEach((row) => {
    const roomId = readString(row.room_id);
    if (!roomId) {
      return;
    }

    unreadMap.set(roomId, readNumber(row.unread_count) ?? 0);
  });

  if (roomIds.length === 0) {
    return buildDefaultInbox(getAlternateStatus());
  }

  const { data: rooms, error: roomError } = await supabase
    .from(IVX_CHAT_CONFIG.tables.altConversations)
    .select('*')
    .in('id', roomIds)
    .order('last_message_at', { ascending: false });

  if (roomError) {
    throw roomError;
  }

  const items = ((rooms ?? []) as ConversationRow[]).map((room) => {
    const roomId = readString(room.id) ?? randomUuid();
    const conversation = mapConversationRow(room, makeRoomShell(roomId, getAlternateStatus()), unreadMap.get(roomId) ?? 0);
    return mapInboxItem(conversation, unreadMap.get(roomId) ?? 0);
  });

  return {
    items: items.sort(sortInboxItems),
    status: getAlternateStatus(),
  };
}

export async function loadInbox(actorId: string): Promise<{ items: InboxItem[]; status: ChatRoomStatus }> {
  const cleanActorId = ensureActorId(actorId);
  const status = await getCachedOrDetectRoomStatus();

  if (status.storageMode === 'primary_supabase_tables') {
    try {
      return await loadPrimaryInbox(cleanActorId);
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError)) {
        if (await canUseAlternateSchema()) {
          try {
            return await loadAlternateInbox(cleanActorId);
          } catch (alternateError) {
            console.log('[IVXChat] Alternate inbox fallback note:', (alternateError as Error)?.message ?? 'Unknown error');
          }
        }

        return buildDefaultInbox(await getSnapshotOrLocalStatus());
      }

      if (shouldUseLocalFallback(nextError)) {
        return buildDefaultInbox(await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  if (status.storageMode === 'alternate_room_schema') {
    try {
      return await loadAlternateInbox(cleanActorId);
    } catch (error) {
      const nextError = error as ErrorLike;
      if (shouldTrySharedFallback(nextError) || shouldUseLocalFallback(nextError)) {
        return buildDefaultInbox(await getSnapshotOrLocalStatus());
      }

      throw error;
    }
  }

  return buildDefaultInbox(status);
}

export async function subscribeInbox(
  actorId: string,
  onInboxUpdate: (items: InboxItem[]) => void,
  onStatus?: (status: ChatRoomStatus) => void,
): Promise<MessageSubscription> {
  const cleanActorId = ensureActorId(actorId);
  const existingSubscription = activeInboxSubscriptions.get(cleanActorId);

  if (existingSubscription) {
    existingSubscription.listeners.add(onInboxUpdate);
    if (onStatus) {
      existingSubscription.statusListeners.add(onStatus);
    }

    const initial = await loadInbox(cleanActorId);
    onInboxUpdate(initial.items);
    onStatus?.(existingSubscription.status);

    let closed = false;
    return {
      unsubscribe: () => {
        if (closed) {
          return;
        }

        closed = true;
        existingSubscription.listeners.delete(onInboxUpdate);
        if (onStatus) {
          existingSubscription.statusListeners.delete(onStatus);
        }

        if (existingSubscription.listeners.size === 0 && existingSubscription.statusListeners.size === 0) {
          existingSubscription.dispose();
          activeInboxSubscriptions.delete(cleanActorId);
        }
      },
    };
  }

  const initial = await loadInbox(cleanActorId);
  let disposed = false;
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  const inboxListeners = new Set<(items: InboxItem[]) => void>([onInboxUpdate]);
  const statusListeners = new Set<(status: ChatRoomStatus) => void>();
  if (onStatus) {
    statusListeners.add(onStatus);
  }

  const emitInbox = (items: InboxItem[]): void => {
    inboxListeners.forEach((listener) => {
      listener(items);
    });
  };

  const emitStatus = (status: ChatRoomStatus): void => {
    const subscriptionRecord = activeInboxSubscriptions.get(cleanActorId);
    if (subscriptionRecord) {
      subscriptionRecord.status = status;
    }
    cacheRoomStatus(status);
    statusListeners.forEach((listener) => {
      listener(status);
    });
  };

  emitInbox(initial.items);
  emitStatus(initial.status);

  const stopPolling = (): void => {
    if (pollingInterval) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  };

  const markDisposed = (): void => {
    disposed = true;
  };

  const refreshInbox = async (): Promise<void> => {
    if (disposed) {
      return;
    }

    try {
      const next = await loadInbox(cleanActorId);
      emitInbox(next.items);
      emitStatus(next.status);
    } catch (error) {
      console.log('[IVXChat] Inbox refresh note:', (error as Error)?.message ?? 'Unknown error');
    }
  };

  let cleanup: () => void;

  if (initial.status.storageMode === 'primary_supabase_tables') {
    const channel = supabase
      .channel(`ivx-inbox:${cleanActorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.participants,
          filter: `user_id=eq.${cleanActorId}`,
        },
        () => {
          void refreshInbox();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.conversations,
        },
        () => {
          void refreshInbox();
        },
      )
      .subscribe((status) => {
        const normalizedStatus = String(status ?? '');
        console.log('[IVXChat] Inbox channel status:', normalizedStatus);
        if (disposed) {
          return;
        }

        if (normalizedStatus === 'SUBSCRIBED') {
          stopPolling();
          return;
        }

        if (normalizedStatus === 'CHANNEL_ERROR' || normalizedStatus === 'TIMED_OUT' || normalizedStatus === 'CLOSED') {
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              void refreshInbox();
            }, CHAT_POLL_INTERVAL_MS);
          }
        }
      });

    cleanup = createIdempotentChannelCleanup(channel, {
      label: `inbox:${cleanActorId}:primary`,
      stopPolling,
      onClosed: markDisposed,
    });
  } else if (initial.status.storageMode === 'alternate_room_schema' && (await canUseAlternateParticipants())) {
    const channel = supabase
      .channel(`ivx-alt-inbox:${cleanActorId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.altParticipants,
        },
        () => {
          void refreshInbox();
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: IVX_CHAT_CONFIG.tables.altConversations,
        },
        () => {
          void refreshInbox();
        },
      )
      .subscribe((status) => {
        const normalizedStatus = String(status ?? '');
        console.log('[IVXChat] Alternate inbox channel status:', normalizedStatus);
        if (disposed) {
          return;
        }

        if (normalizedStatus === 'SUBSCRIBED') {
          stopPolling();
          return;
        }

        if (normalizedStatus === 'CHANNEL_ERROR' || normalizedStatus === 'TIMED_OUT' || normalizedStatus === 'CLOSED') {
          if (!pollingInterval) {
            pollingInterval = setInterval(() => {
              void refreshInbox();
            }, CHAT_POLL_INTERVAL_MS);
          }
        }
      });

    cleanup = createIdempotentChannelCleanup(channel, {
      label: `inbox:${cleanActorId}:alternate`,
      stopPolling,
      onClosed: markDisposed,
    });
  } else {
    pollingInterval = setInterval(() => {
      void refreshInbox();
    }, CHAT_POLL_INTERVAL_MS);
    cleanup = createLocalIdempotentCleanup({
      label: `inbox:${cleanActorId}:local`,
      stopPolling,
      onClosed: markDisposed,
    });
  }

  const subscriptionRecord: InboxSubscriptionRecord = {
    key: cleanActorId,
    listeners: inboxListeners,
    statusListeners,
    status: initial.status,
    dispose: cleanup,
  };
  activeInboxSubscriptions.set(cleanActorId, subscriptionRecord);

  let closed = false;
  return {
    unsubscribe: () => {
      if (closed) {
        return;
      }

      closed = true;
      inboxListeners.delete(onInboxUpdate);
      if (onStatus) {
        statusListeners.delete(onStatus);
      }

      if (inboxListeners.size === 0 && statusListeners.size === 0) {
        cleanup();
        activeInboxSubscriptions.delete(cleanActorId);
      }
    },
  };
}

export function isOwnMessage(message: ChatMessage, actorId: string): boolean {
  return message.senderId === actorId;
}

export function shouldRenderInlineImage(message: ChatMessage): boolean {
  return message.fileType === 'image' && !!message.fileUrl;
}

export function shouldRenderTapToOpenAttachment(message: ChatMessage): boolean {
  return !!message.fileUrl && message.fileType !== 'image';
}

export async function openAttachment(url?: string | null): Promise<void> {
  const targetUrl = safeTrim(url);
  if (!targetUrl) {
    throw new Error('No attachment URL is available for this message.');
  }

  const globalOpener = (globalThis as { open?: (url: string, target?: string, features?: string) => unknown }).open;
  if (typeof globalOpener === 'function') {
    globalOpener(targetUrl, '_blank', 'noopener,noreferrer');
    return;
  }

  const canOpen = await Linking.canOpenURL(targetUrl);
  if (!canOpen) {
    throw new Error('This attachment cannot be opened on this device.');
  }

  await Linking.openURL(targetUrl);
}

export function getRoomStatusCardData(status: ChatRoomStatus): ChatRoomStatus {
  return status;
}

export async function getOrCreateStableActorId(storageKey = 'ivx-chat-actor-id'): Promise<string> {
  const existing = await AsyncStorage.getItem(storageKey);
  if (safeTrim(existing)) {
    return safeTrim(existing);
  }

  const nextId = randomUuid();
  await AsyncStorage.setItem(storageKey, nextId);
  return nextId;
}
