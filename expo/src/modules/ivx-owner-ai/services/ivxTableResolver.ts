import type { SupabaseClient } from '@supabase/supabase-js';
import { getIVXSupabaseClient } from '@/lib/ivx-supabase-client';
import { IVX_OWNER_AI_TABLES } from '@/shared/ivx';
import { createBoundedSharedRead } from '@/lib/bounded-shared-read';

export type ResolvedDbSchema = 'public' | 'generic';
export type ResolvedTableSchema = 'ivx' | 'generic' | 'none';

export type ResolvedTables = {
  schema: ResolvedTableSchema;
  dbSchema: ResolvedDbSchema;
  conversations: string;
  messages: string;
  inboxState: string;
};

type ScopedSupabaseClient = Pick<SupabaseClient, 'from'>;
type SchemaAwareSupabaseClient = SupabaseClient & {
  schema: (schema: ResolvedDbSchema) => ScopedSupabaseClient;
};

const IVX_TABLES: ResolvedTables = {
  schema: 'ivx',
  dbSchema: 'public',
  conversations: IVX_OWNER_AI_TABLES.conversations,
  messages: IVX_OWNER_AI_TABLES.messages,
  inboxState: IVX_OWNER_AI_TABLES.inboxState,
};

const GENERIC_SCHEMA_TABLES: ResolvedTables = {
  schema: 'generic',
  dbSchema: 'generic',
  conversations: 'conversations',
  messages: 'messages',
  inboxState: 'conversation_participants',
};

const GENERIC_PUBLIC_TABLES: ResolvedTables = {
  schema: 'generic',
  dbSchema: 'public',
  conversations: 'conversations',
  messages: 'messages',
  inboxState: 'conversation_participants',
};

const NONE_TABLES: ResolvedTables = {
  schema: 'none',
  dbSchema: 'public',
  conversations: IVX_OWNER_AI_TABLES.conversations,
  messages: IVX_OWNER_AI_TABLES.messages,
  inboxState: IVX_OWNER_AI_TABLES.inboxState,
};

const GENERIC_ASSISTANT_SENDER_ID = '__ivx_assistant__';
const GENERIC_SYSTEM_SENDER_ID = '__ivx_system__';

function normalizeGenericSenderRole(senderRole: unknown, senderIdRaw: string | null): 'owner' | 'assistant' | 'system' {
  if (senderRole === 'assistant' || senderRole === 'system' || senderRole === 'owner') {
    return senderRole;
  }

  if (senderIdRaw === GENERIC_ASSISTANT_SENDER_ID) {
    return 'assistant';
  }

  if (senderIdRaw === GENERIC_SYSTEM_SENDER_ID) {
    return 'system';
  }

  return 'owner';
}

function resolveGenericSenderId(senderUserId: string | null, senderRole: string): string {
  if (senderRole === 'assistant') {
    return GENERIC_ASSISTANT_SENDER_ID;
  }

  if (senderRole === 'system') {
    return GENERIC_SYSTEM_SENDER_ID;
  }

  return senderUserId ?? 'unknown';
}

export function getScopedSupabaseClient(client: SupabaseClient, dbSchema: ResolvedDbSchema): ScopedSupabaseClient {
  if (dbSchema === 'public') {
    return client;
  }

  return (client as SchemaAwareSupabaseClient).schema(dbSchema);
}

export function getRealtimeSchema(tables: ResolvedTables): ResolvedDbSchema {
  return tables.dbSchema;
}

async function canQueryTable(table: string, field: string, dbSchema: ResolvedDbSchema, signal: AbortSignal): Promise<boolean> {
  try {
    const client = getIVXSupabaseClient();
    const scopedClient = getScopedSupabaseClient(client, dbSchema);
    const { error } = await scopedClient.from(table).select(field).limit(1).abortSignal(signal);
    if (error) {
      console.log(`[IVXTableResolver] Probe failed for ${dbSchema}.${table}:`, error.message);
      return false;
    }
    console.log(`[IVXTableResolver] Probe OK for ${dbSchema}.${table}`);
    return true;
  } catch (err) {
    console.log(`[IVXTableResolver] Probe exception for ${dbSchema}.${table}:`, err instanceof Error ? err.message : 'unknown');
    return false;
  }
}

async function probeIVXTables(signal: AbortSignal): Promise<ResolvedTables> {
  console.log('[IVXTableResolver] Probing for available tables...');
  for (const tables of [IVX_TABLES, GENERIC_SCHEMA_TABLES, GENERIC_PUBLIC_TABLES]) {
    if (signal.aborted) return NONE_TABLES;
    const available = await Promise.all([
      canQueryTable(tables.conversations, 'id', tables.dbSchema, signal),
      canQueryTable(tables.messages, 'id', tables.dbSchema, signal),
    ]);
    if (available.every(Boolean)) return tables;
  }
  return NONE_TABLES;
}

const tableDiscovery = createBoundedSharedRead(probeIVXTables, NONE_TABLES);

export function resolveIVXTables(): Promise<ResolvedTables> {
  return tableDiscovery.get();
}

export function invalidateTableResolverCache(): void {
  tableDiscovery.invalidate();
  console.log('[IVXTableResolver] Cache invalidated');
}

export function getDetectedSchema(): ResolvedTableSchema {
  return tableDiscovery.peek()?.schema ?? 'none';
}

export function mapGenericMessageRow(row: Record<string, unknown>): {
  id: string;
  conversation_id: string;
  sender_user_id: string | null;
  sender_role: 'owner' | 'assistant' | 'system';
  sender_label: string | null;
  body: string | null;
  attachment_url: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  attachment_size: number | null;
  attachment_kind: string | null;
  created_at: string;
  updated_at: string;
} {
  const senderIdRaw = (row.sender_user_id ?? row.sender_id ?? null) as string | null;
  const senderRole = normalizeGenericSenderRole(row.sender_role, senderIdRaw);
  const body = (row.body ?? row.text ?? null) as string | null;
  const attachmentUrl = (row.attachment_url ?? row.file_url ?? null) as string | null;
  const attachmentName = (row.attachment_name ?? row.file_name ?? null) as string | null;
  const attachmentMime = (row.attachment_mime ?? row.file_mime ?? null) as string | null;
  const attachmentSize = (row.attachment_size ?? row.file_size ?? null) as number | null;
  const attachmentKind = (row.attachment_kind ?? null) as string | null;

  return {
    id: row.id as string,
    conversation_id: (row.conversation_id ?? row.room_id) as string,
    sender_user_id: senderIdRaw === GENERIC_ASSISTANT_SENDER_ID || senderIdRaw === GENERIC_SYSTEM_SENDER_ID ? null : senderIdRaw,
    sender_role: senderRole,
    sender_label: (row.sender_label ?? null) as string | null,
    body,
    attachment_url: attachmentUrl,
    attachment_name: attachmentName,
    attachment_mime: attachmentMime,
    attachment_size: attachmentSize,
    attachment_kind: attachmentKind,
    created_at: (row.created_at ?? new Date().toISOString()) as string,
    updated_at: (row.updated_at ?? new Date().toISOString()) as string,
  };
}

export function buildMessageInsertPayload(
  schema: ResolvedTableSchema,
  input: {
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
  },
): Record<string, unknown> {
  const now = new Date().toISOString();

  if (schema === 'generic') {
    return {
      room_id: input.conversationId,
      sender_id: resolveGenericSenderId(input.senderUserId, input.senderRole),
      sender_label: input.senderLabel,
      body: input.body,
      text: input.body,
      file_url: input.attachmentUrl ?? null,
      file_name: input.attachmentName ?? null,
      file_mime: input.attachmentMime ?? null,
      file_size: input.attachmentSize ?? null,
      created_at: now,
      updated_at: now,
    };
  }

  return {
    conversation_id: input.conversationId,
    sender_user_id: input.senderUserId,
    sender_role: input.senderRole,
    sender_label: input.senderLabel,
    body: input.body,
    attachment_url: input.attachmentUrl ?? null,
    attachment_name: input.attachmentName ?? null,
    attachment_mime: input.attachmentMime ?? null,
    attachment_size: input.attachmentSize ?? null,
    attachment_kind: input.attachmentKind ?? 'text',
    created_at: now,
    updated_at: now,
  };
}

export function buildInboxUpsertPayload(
  schema: ResolvedTableSchema,
  conversationId: string,
  userId: string,
): { payload: Record<string, unknown>; onConflict: string } {
  const now = new Date().toISOString();

  if (schema === 'generic') {
    return {
      payload: {
        conversation_id: conversationId,
        user_id: userId,
        unread_count: 0,
        last_read_at: now,
      },
      onConflict: 'conversation_id,user_id',
    };
  }

  return {
    payload: {
      conversation_id: conversationId,
      user_id: userId,
      unread_count: 0,
      last_read_at: now,
      updated_at: now,
    },
    onConflict: 'conversation_id,user_id',
  };
}
