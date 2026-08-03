import { requestLocalIVXBrain } from '@/src/modules/ivx-owner-ai/services/localIVXBrainService';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  IVX_OWNER_AI_PROFILE,
  IVX_OWNER_AI_ROOM_ID,
  IVX_OWNER_AI_ROOM_SLUG} from '@/constants/ivx-owner-ai';
import { buildOwnerTrustPromptBlock } from '@/src/modules/ivx-owner-ai/services/ownerTrust';
import {
  IVX_OWNER_AI_TABLES,
  resolveIVXAuthenticatedRequest,
  type IVXAuthenticatedRequestContext,
  type IVXOwnerAICapabilityId,
  type IVXOwnerAICapabilityProof,
  type IVXOwnerAIHealthProbeResponse,
  type IVXOwnerAIRoomStatus,
  type IVXOwnerAIResponse} from '@/shared/ivx';

type IVXOwnerAIRequestBody = {
  requestId?: string;
  conversationId?: string;
  message?: string;
  senderLabel?: string | null;
  mode?: string;
  persistUserMessage?: boolean;
  persistAssistantMessage?: boolean;
  devTestModeActive?: boolean;
};

type ConversationResult = {
  id: string;
  title: string;
  subtitle: string | null;
};

class DuplicateOwnerRoomError extends Error {
  constructor(readonly duplicateIds: string[], readonly selectedId: string) {
    super(`Duplicate owner room conversations detected. Canonical=${selectedId}. Duplicates=${duplicateIds.join(',')}`);
    this.name = 'DuplicateOwnerRoomError';
  }
}

type OwnerCapabilityProbeOutput = {
  success: boolean;
  executable?: boolean;
  functionName: string;
  proof: Record<string, unknown>;
  error?: string;
};

const OWNER_CAPABILITY_IDS: readonly IVXOwnerAICapabilityId[] = [
  'ai_chat',
  'knowledge_answers',
  'owner_commands',
  'code_aware_support',
  'file_upload',
  'inbox_sync',
  'backend_access',
  'supabase_inspection',
  'supabase_tables',
  'supabase_schema',
  'supabase_columns',
  'supabase_rls',
] as const;

type ConversationLookupRow = {
  id: string | null;
  title: string | null;
  subtitle: string | null;
  slug?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
};

type RecentMessageRow = {
  id: string;
  conversation_id: string | null;
  room_id?: string | null;
  sender_id: string | null;
  sender_user_id: string | null;
  user_id?: string | null;
  sender_label: string | null;
  text: string | null;
  body: string | null;
  created_at: string | null;
};

function getMessageConversationField(tables: ResolvedApiTables): 'conversation_id' | 'room_id' {
  return tables.schema === 'generic' ? 'room_id' : 'conversation_id';
}

function buildGenericMessagePayload(input: {
  conversationId: string;
  senderId: string;
  senderLabel: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
  messageId?: string;
}): Record<string, unknown>[] {
  const payloads: Record<string, unknown>[] = [
    {
      room_id: input.conversationId,
      sender_id: input.senderId,
      sender_label: input.senderLabel,
      text: input.text,
      body: input.text,
      created_at: input.createdAt,
      updated_at: input.updatedAt},
    {
      room_id: input.conversationId,
      user_id: input.senderId,
      sender_label: input.senderLabel,
      text: input.text,
      body: input.text,
      created_at: input.createdAt,
      updated_at: input.updatedAt},
    {
      room_id: input.conversationId,
      sender_id: input.senderId,
      body: input.text,
      created_at: input.createdAt},
    {
      room_id: input.conversationId,
      user_id: input.senderId,
      body: input.text,
      created_at: input.createdAt},
  ];

  if (input.messageId) {
    return payloads.map((payload) => ({ id: input.messageId, ...payload }));
  }

  return payloads;
}

async function insertGenericMessage(
  scopedClient: ScopedQueryClient,
  tableName: string,
  input: {
    messageId?: string;
    conversationId: string;
    senderId: string;
    senderLabel: string | null;
    text: string;
  },
): Promise<string | null> {
  const createdAt = nowIso();
  const updatedAt = nowIso();
  const payloads = buildGenericMessagePayload({
    ...input,
    createdAt,
    updatedAt});

  let lastError: { message?: string } | null = null;

  for (const payload of payloads) {
    const { error } = await scopedClient.from(tableName).insert(payload);
    if (!error) {
      console.log('[IVXOwnerAI-API] Generic message inserted with payload keys:', Object.keys(payload));
      return (payload.id as string | undefined) ?? input.messageId ?? null;
    }

    console.log('[IVXOwnerAI-API] Generic message insert attempt failed:', {
      message: error.message,
      keys: Object.keys(payload)});
    lastError = error;

    if (error.message?.includes('column') && error.message?.includes('does not exist')) {
      continue;
    }

    if (error.message?.includes('foreign key')) {
      return null;
    }
  }

  if (lastError) {
    throw new Error(lastError.message ?? 'Generic message insert failed.');
  }

  return input.messageId ?? null;
}

type AuthResult = IVXAuthenticatedRequestContext;

type ApiDbSchema = 'public' | 'generic';

type ResolvedApiTables = {
  schema: 'ivx' | 'generic' | 'none';
  dbSchema: ApiDbSchema;
  conversations: string;
  messages: string;
  inboxState: string | null;
  aiRequests: string | null;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS'} as const;

let cachedApiTables: ResolvedApiTables | null = null;
const DEPLOYMENT_MARKER = 'ivx-owner-ai-2026-04-11t2215z';

type ScopedQueryClient = Pick<SupabaseClient, 'from'>;
type SchemaAwareSupabaseClient = SupabaseClient & {
  schema: (schema: ApiDbSchema) => ScopedQueryClient;
};

function getScopedQueryClient(client: SupabaseClient, dbSchema: ApiDbSchema): ScopedQueryClient {
  if (dbSchema === 'public') {
    return client;
  }

  return (client as SchemaAwareSupabaseClient).schema(dbSchema);
}

function jsonResponse(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: JSON_HEADERS });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function nowIso(): string {
  return new Date().toISOString();
}

function createRequestId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }
  const seed = `${Date.now().toString(16).padStart(12, '0')}${Math.random().toString(16).slice(2).padEnd(20, '0')}`.slice(0, 32);
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

function normalizeRequestId(value: unknown): string {
  const trimmed = readTrimmed(value);
  return trimmed || createRequestId();
}

async function verifyAuth(request: Request): Promise<AuthResult> {
  return await resolveIVXAuthenticatedRequest(request, '[IVXOwnerAI-API]');
}

async function resolveApiTables(client: SupabaseClient): Promise<ResolvedApiTables> {
  if (cachedApiTables) {
    return cachedApiTables;
  }

  const { error: ivxErr } = await client.from(IVX_OWNER_AI_TABLES.conversations).select('id').limit(1);
  if (!ivxErr) {
    console.log('[IVXOwnerAI-API] Using ivx tables');
    cachedApiTables = {
      schema: 'ivx',
      dbSchema: 'public',
      conversations: IVX_OWNER_AI_TABLES.conversations,
      messages: IVX_OWNER_AI_TABLES.messages,
      inboxState: IVX_OWNER_AI_TABLES.inboxState,
      aiRequests: IVX_OWNER_AI_TABLES.aiRequests};
    return cachedApiTables;
  }

  const genericSchemaClient = getScopedQueryClient(client, 'generic');
  const { error: genSchemaErr } = await genericSchemaClient.from('conversations').select('id').limit(1);
  if (!genSchemaErr) {
    console.log('[IVXOwnerAI-API] Using generic schema tables (generic.conversations/messages)');
    cachedApiTables = {
      schema: 'generic',
      dbSchema: 'generic',
      conversations: 'conversations',
      messages: 'messages',
      inboxState: 'conversation_participants',
      aiRequests: null};
    return cachedApiTables;
  }

  const { error: genPublicErr } = await client.from('conversations').select('id').limit(1);
  if (!genPublicErr) {
    console.log('[IVXOwnerAI-API] Using generic public fallback tables (public.conversations/messages)');
    cachedApiTables = {
      schema: 'generic',
      dbSchema: 'public',
      conversations: 'conversations',
      messages: 'messages',
      inboxState: 'conversation_participants',
      aiRequests: null};
    return cachedApiTables;
  }

  console.log('[IVXOwnerAI-API] No shared chat tables found, using local AI fallback mode');
  cachedApiTables = {
    schema: 'none',
    dbSchema: 'public',
    conversations: IVX_OWNER_AI_TABLES.conversations,
    messages: IVX_OWNER_AI_TABLES.messages,
    inboxState: null,
    aiRequests: null};
  return cachedApiTables;
}

function buildRoomStatus(tables: ResolvedApiTables): IVXOwnerAIRoomStatus {
  if (tables.schema === 'ivx') {
    return {
      storageMode: 'primary_supabase_tables',
      visibility: 'shared',
      deliveryMethod: 'primary_realtime'};
  }

  if (tables.schema === 'generic') {
    return {
      storageMode: 'alternate_room_schema',
      visibility: 'shared',
      deliveryMethod: 'alternate_shared'};
  }

  return {
    storageMode: 'local_device_only',
    visibility: 'local_only',
    deliveryMethod: 'local_only',
    warning: 'No shared IVX chat tables are available yet. AI replies can still run, but room sync stays local until the chat schema is provisioned.'};
}

function sortConversationLookupRows(rows: ConversationLookupRow[]): ConversationLookupRow[] {
  return [...rows].sort((left, right) => {
    if (left.id === IVX_OWNER_AI_ROOM_ID) {
      return -1;
    }
    if (right.id === IVX_OWNER_AI_ROOM_ID) {
      return 1;
    }

    const leftUpdatedAt = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightUpdatedAt = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightUpdatedAt - leftUpdatedAt;
  });
}

async function findExistingConversation(client: SupabaseClient, tables: ResolvedApiTables): Promise<ConversationResult | null> {
  if (tables.schema === 'none') {
    return {
      id: IVX_OWNER_AI_ROOM_ID,
      title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle};
  }

  const scopedClient = getScopedQueryClient(client, tables.dbSchema);
  const candidateRows: ConversationLookupRow[] = [];
  const lookupAttempts: Array<{ field: 'id' | 'slug' | 'title'; value: string }> = [
    { field: 'id', value: IVX_OWNER_AI_ROOM_ID },
    { field: 'slug', value: IVX_OWNER_AI_ROOM_SLUG },
    { field: 'title', value: IVX_OWNER_AI_PROFILE.sharedRoom.title },
  ];

  for (const lookup of lookupAttempts) {
    const { data, error } = await scopedClient
      .from(tables.conversations)
      .select('id, title, subtitle, slug, updated_at, created_at')
      .eq(lookup.field, lookup.value)
      .limit(5);

    if (error) {
      console.log('[IVXOwnerAI-API] Conversation lookup warning:', {
        schema: tables.schema,
        dbSchema: tables.dbSchema,
        field: lookup.field,
        value: lookup.value,
        message: error.message});
      continue;
    }

    candidateRows.push(...((data ?? []) as ConversationLookupRow[]));
  }

  if (candidateRows.length === 0) {
    return null;
  }

  const dedupedRows = Array.from(new Map(candidateRows.map((row) => [
    `${readTrimmed(row.id)}:${readTrimmed(row.slug)}:${readTrimmed(row.title)}`,
    row,
  ])).values());
  const [selectedRow, ...duplicateRows] = sortConversationLookupRows(dedupedRows);
  if (duplicateRows.length > 0) {
    const duplicateIds = duplicateRows
      .map((row) => readTrimmed(row.id))
      .filter((value) => value.length > 0);
    const selectedId = readTrimmed(selectedRow.id) || IVX_OWNER_AI_ROOM_ID;
    console.log('[IVXOwnerAI-API] Duplicate owner conversations detected:', {
      schema: tables.schema,
      dbSchema: tables.dbSchema,
      selectedId,
      duplicateIds});
    throw new DuplicateOwnerRoomError(duplicateIds, selectedId);
  }

  return {
    id: readTrimmed(selectedRow.id) || IVX_OWNER_AI_ROOM_ID,
    title: readTrimmed(selectedRow.title) || IVX_OWNER_AI_PROFILE.sharedRoom.title,
    subtitle: readTrimmed(selectedRow.subtitle) || null};
}

async function ensureConversation(client: SupabaseClient, tables: ResolvedApiTables): Promise<ConversationResult> {
  const existingConversation = await findExistingConversation(client, tables);
  if (existingConversation) {
    return existingConversation;
  }

  const scopedClient = getScopedQueryClient(client, tables.dbSchema);
  console.log('[IVXOwnerAI-API] Owner conversation not found in', tables.conversations, 'schema:', tables.dbSchema, 'creating...');

  const basePayload: Record<string, unknown> = {
    id: IVX_OWNER_AI_ROOM_ID,
    title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
    subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle,
    last_message_text: null,
    last_message_at: null};

  const primaryPayload: Record<string, unknown> = {
    ...basePayload,
    slug: IVX_OWNER_AI_ROOM_SLUG};

  if (tables.schema === 'ivx') {
    primaryPayload.created_at = nowIso();
    primaryPayload.updated_at = nowIso();
  }

  const { error: insertError } = await scopedClient
    .from(tables.conversations)
    .upsert(primaryPayload, { onConflict: 'id' });

  if (!insertError) {
    console.log('[IVXOwnerAI-API] Conversation created/upserted successfully in', tables.conversations, 'schema:', tables.dbSchema);
    return {
      id: IVX_OWNER_AI_ROOM_ID,
      title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
      subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle};
  }

  console.log('[IVXOwnerAI-API] Conversation upsert failed:', insertError.message);

  const recoveredConversation = await findExistingConversation(client, tables);
  if (recoveredConversation) {
    console.log('[IVXOwnerAI-API] Conversation recovered after upsert failure:', recoveredConversation.id);
    return recoveredConversation;
  }

  if (insertError.message?.includes('column') && insertError.message?.includes('does not exist')) {
    const { error: simpleErr } = await scopedClient
      .from(tables.conversations)
      .upsert({
        id: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle}, { onConflict: 'id' });

    if (!simpleErr) {
      console.log('[IVXOwnerAI-API] Conversation created with minimal payload');
      return {
        id: IVX_OWNER_AI_ROOM_ID,
        title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
        subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle};
    }
  }

  console.log('[IVXOwnerAI-API] All upsert attempts failed, using fallback conversation');
  return {
    id: IVX_OWNER_AI_ROOM_ID,
    title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
    subtitle: IVX_OWNER_AI_PROFILE.sharedRoom.subtitle};
}

async function loadRecentMessages(client: SupabaseClient, tables: ResolvedApiTables, conversationId: string): Promise<RecentMessageRow[]> {
  if (tables.schema === 'none') {
    return [];
  }

  const scopedClient = getScopedQueryClient(client, tables.dbSchema);
  const conversationField = getMessageConversationField(tables);
  const { data, error } = await scopedClient
    .from(tables.messages)
    .select('*')
    .eq(conversationField, conversationId)
    .order('created_at', { ascending: false })
    .limit(12);

  console.log('[IVXOwnerAI-API] Recent messages lookup:', {
    schema: tables.schema,
    dbSchema: tables.dbSchema,
    table: tables.messages,
    conversationField,
    conversationId,
    rowCount: Array.isArray(data) ? data.length : 0,
    error: error?.message ?? null});

  if (error) {
    return [];
  }

  return [...((data ?? []) as RecentMessageRow[])].reverse();
}

async function insertMessage(client: SupabaseClient, tables: ResolvedApiTables, input: {
  messageId?: string;
  conversationId: string;
  senderId: string;
  senderLabel: string | null;
  text: string;
  senderRole?: string;
}): Promise<string | null> {
  if (tables.schema === 'none') {
    console.log('[IVXOwnerAI-API] Shared chat tables unavailable, skipping message persistence for local AI fallback mode');
    return null;
  }

  const scopedClient = getScopedQueryClient(client, tables.dbSchema);

  if (tables.schema === 'generic') {
    return insertGenericMessage(scopedClient, tables.messages, input);
  }

  const payload: Record<string, unknown> = {
    conversation_id: input.conversationId,
    created_at: nowIso(),
    updated_at: nowIso()};

  if (input.messageId) {
    payload.id = input.messageId;
  }

  payload.sender_user_id = input.senderId;
  payload.sender_role = input.senderRole ?? 'owner';
  payload.sender_label = input.senderLabel;
  payload.body = input.text;
  payload.attachment_kind = 'text';

  const { error } = await scopedClient.from(tables.messages).insert(payload);
  if (!error) {
    const insertedId = ((payload.id as string | undefined) ?? null);
    console.log('[IVXOwnerAI-API] Message inserted successfully into', tables.messages, 'messageId:', insertedId ?? 'generated');
    return insertedId;
  }

  console.log('[IVXOwnerAI-API] Message insert failed:', error.message);

  if (error.message?.includes('column') && error.message?.includes('does not exist')) {
    const fallbackPayload: Record<string, unknown> = {
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      sender_label: input.senderLabel,
      text: input.text};
    const { error: fallbackErr } = await scopedClient.from(tables.messages).insert(fallbackPayload);
    if (!fallbackErr) {
      console.log('[IVXOwnerAI-API] Message inserted with fallback payload');
      return input.messageId ?? null;
    }
    console.log('[IVXOwnerAI-API] Fallback insert also failed:', fallbackErr.message);
  }

  if (error.message?.includes('foreign key')) {
    console.log('[IVXOwnerAI-API] Foreign key error - conversation may not exist in DB yet');
    return null;
  }

  throw new Error(error.message);
}

async function updateConversationSummary(client: SupabaseClient, tables: ResolvedApiTables, conversationId: string, preview: string): Promise<void> {
  if (tables.schema === 'none') {
    return;
  }

  const scopedClient = getScopedQueryClient(client, tables.dbSchema);
  const trimmedPreview = preview.length <= 120 ? preview : `${preview.slice(0, 117)}...`;
  const { error } = await scopedClient.from(tables.conversations).update({
    last_message_text: trimmedPreview,
    last_message_at: nowIso()}).eq('id', conversationId);

  if (error) {
    console.log('[IVXOwnerAI-API] Conversation summary update non-blocking error:', error.message);
  }
}

async function ensureInboxState(client: SupabaseClient, tables: ResolvedApiTables, conversationId: string, userId: string): Promise<void> {
  if (tables.schema !== 'ivx' || !tables.inboxState) {
    return;
  }

  const { error } = await client.from(tables.inboxState).upsert({
    conversation_id: conversationId,
    user_id: userId,
    unread_count: 0,
    last_read_at: nowIso(),
    updated_at: nowIso()}, {
    onConflict: 'conversation_id,user_id'});

  if (error) {
    console.log('[IVXOwnerAI-API] Inbox state upsert non-blocking error:', error.message);
  }
}

async function findExistingAIRequest(client: SupabaseClient, tables: ResolvedApiTables, requestId: string): Promise<{
  id: string;
  conversation_id: string;
  response_text: string | null;
  status: string | null;
  model: string | null;
} | null> {
  if (tables.schema !== 'ivx' || !tables.aiRequests) {
    return null;
  }

  const { data, error } = await client
    .from(tables.aiRequests)
    .select('id, conversation_id, response_text, status, model')
    .eq('id', requestId)
    .maybeSingle();

  if (error) {
    console.log('[IVXOwnerAI-API] Existing AI request lookup failed:', error.message);
    return null;
  }

  return (data as {
    id: string;
    conversation_id: string;
    response_text: string | null;
    status: string | null;
    model: string | null;
  } | null) ?? null;
}

async function logAIRequest(client: SupabaseClient, tables: ResolvedApiTables, input: {
  requestId: string;
  conversationId: string;
  userId: string;
  prompt: string;
  responseText: string;
  status: 'completed' | 'failed';
  model: string;
}): Promise<void> {
  if (tables.schema !== 'ivx' || !tables.aiRequests) {
    return;
  }

  const { error } = await client.from(tables.aiRequests).upsert({
    id: input.requestId,
    conversation_id: input.conversationId,
    user_id: input.userId,
    prompt: input.prompt,
    response_text: input.responseText,
    status: input.status,
    model: input.model,
    created_at: nowIso(),
    updated_at: nowIso()}, {
    onConflict: 'id'});

  if (error) {
    console.log('[IVXOwnerAI-API] AI request insert non-blocking error:', error.message);
  }
}

function buildPrompt(input: {
  prompt: string;
  email: string | null;
  conversation: ConversationResult;
  recentMessages: RecentMessageRow[];
  mode: string;
  devTestModeActive: boolean;
}): string {
  const transcript = input.recentMessages.map((m) => {
    const label = m.sender_label ?? m.sender_user_id ?? m.sender_id ?? m.user_id ?? 'unknown';
    const text = m.body ?? m.text ?? '';
    return `${label}: ${text}`;
  }).join('\n');
  const trustPolicy = buildOwnerTrustPromptBlock({
    messageText: input.prompt,
    ownerRoomAuthenticated: input.conversation.id === IVX_OWNER_AI_ROOM_ID || input.conversation.title === IVX_OWNER_AI_PROFILE.sharedRoom.title,
    backendAdminVerified: true,
    fallbackModeActive: false,
    devTestModeActive: input.devTestModeActive});
  const coreInstruction = input.devTestModeActive
    ? 'Execute owner commands directly. Respond with concise status updates only. Do not provide checklists, deployment guidance, instructional templates, or post-confirmation coaching unless the owner explicitly asks.'
    : 'Respond with concise owner-first guidance for IVX operations, chat, inbox, uploads, knowledge base, and owner commands.';

  return [
    `You are ${IVX_OWNER_AI_PROFILE.name}.`,
    coreInstruction,
    trustPolicy,
    `Mode: ${input.mode}`,
    `Conversation: ${input.conversation.title}`,
    `User email: ${input.email ?? 'unknown'}`,
    transcript.length > 0 ? `Recent messages:\n${transcript}` : 'Recent messages: none',
    `User request: ${input.prompt}`,
  ].join('\n\n');
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: JSON_HEADERS });
}

export function HEAD(): Response {
  return new Response(null, {
    status: 200,
    headers: {
      ...JSON_HEADERS,
      'Content-Length': '0'}});
}

export function GET(): Response {
  return jsonResponse({
    ok: true,
    route: '/api/ivx/owner-ai',
    status: 'ready',
    deploymentMarker: DEPLOYMENT_MARKER,
    methods: ['GET', 'HEAD', 'POST', 'OPTIONS'],
    probeInstructions: {
      type: 'authenticated_post',
      message: 'health_probe'},
    timestamp: nowIso()});
}

function isHealthProbe(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  return normalized === 'health_probe' || normalized === 'ping' || normalized === 'health_check';
}

function normalizeCapabilityProof(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { responsePayload: value ?? null };
}

function buildCapabilityProbeResult(input: OwnerCapabilityProbeOutput): IVXOwnerAICapabilityProof {
  const executable = input.executable ?? true;
  const success = executable && input.success === true;
  return {
    success,
    executable,
    functionName: input.functionName,
    checkedAt: nowIso(),
    proof: normalizeCapabilityProof(input.proof),
    error: success ? undefined : input.error};
}

function buildLocalHealthCapabilityChecks(local: ReturnType<typeof requestLocalIVXBrain>): {
  capabilities: Record<IVXOwnerAICapabilityId, boolean>;
  capabilityProofs: Record<IVXOwnerAICapabilityId, IVXOwnerAICapabilityProof>;
} {
  const checks: Record<IVXOwnerAICapabilityId, OwnerCapabilityProbeOutput> = {
    ai_chat: {
      functionName: 'requestLocalIVXBrain',
      success: local.answer.trim().length > 0,
      proof: { responsePayload: local }},
    knowledge_answers: {
      functionName: 'requestLocalIVXBrain',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No executable knowledge-base lookup is exposed in this local route.' } },
      error: 'Knowledge answers are not executable in this local API route.'},
    owner_commands: {
      functionName: 'local_owner_command_dispatcher',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No executable owner-command dispatcher is exposed in this local route.' } },
      error: 'Owner commands are not executable in this local API route.'},
    code_aware_support: {
      functionName: 'local_code_aware_support',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No code-aware runtime function is exposed in this local route.' } },
      error: 'Code-aware support is not executable in this local API route.'},
    file_upload: {
      functionName: 'local_file_upload_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No storage upload function is executed by this local health route.' } },
      error: 'File upload is not executable in this local API route.'},
    inbox_sync: {
      functionName: 'local_inbox_sync_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { storageMode: 'local_device_only', reason: 'No shared inbox sync function is executed by this local route.' } },
      error: 'Inbox sync is not executable in this local API route.'},
    backend_access: {
      functionName: 'local_backend_access_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'Owner backend guard is not executed by this local route.' } },
      error: 'Backend access is not executable in this local API route.'},
    supabase_inspection: {
      functionName: 'local_supabase_inspection_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No Supabase inspection function is executed by this local route.' } },
      error: 'Supabase inspection is not executable in this local API route.'},
    supabase_tables: {
      functionName: 'local_supabase_tables_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No Supabase tables inspection function is executed by this local route.' } },
      error: 'Supabase table inspection is not executable in this local API route.'},
    supabase_schema: {
      functionName: 'local_supabase_schema_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No Supabase schema inspection function is executed by this local route.' } },
      error: 'Supabase schema inspection is not executable in this local API route.'},
    supabase_columns: {
      functionName: 'local_supabase_columns_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No Supabase columns inspection function is executed by this local route.' } },
      error: 'Supabase column inspection is not executable in this local API route.'},
    supabase_rls: {
      functionName: 'local_supabase_rls_probe',
      success: false,
      executable: false,
      proof: { responsePayload: { source: 'local_app_brain', reason: 'No Supabase RLS inspection function is executed by this local route.' } },
      error: 'Supabase RLS inspection is not executable in this local API route.'}};

  const capabilityProofs = {} as Record<IVXOwnerAICapabilityId, IVXOwnerAICapabilityProof>;
  const capabilities = {} as Record<IVXOwnerAICapabilityId, boolean>;

  for (const capability of OWNER_CAPABILITY_IDS) {
    capabilityProofs[capability] = buildCapabilityProbeResult(checks[capability]);
    capabilities[capability] = capabilityProofs[capability].success;
  }

  return { capabilities, capabilityProofs };
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json() as IVXOwnerAIRequestBody;
    const requestId = normalizeRequestId(body.requestId);
    const prompt = readTrimmed(body.message);
    const mode = body.mode === 'command' ? 'command' : 'chat';
    const senderLabel = readTrimmed(body.senderLabel) || null;
    const persistUserMessage = body.persistUserMessage === true;
    const persistAssistantMessage = body.persistAssistantMessage === true;
    const model = 'ivx-local-app-brain-v1';

    if (!prompt) {
      return jsonResponse({ error: 'Message is required.' }, 400);
    }

    const healthProbe = isHealthProbe(prompt);
    console.log('[IVXOwnerAI-API] Local Expo owner-ai route received request:', {
      requestId,
      promptLength: prompt.length,
      mode,
      isProbe: healthProbe,
      persistUserMessage,
      persistAssistantMessage,
      marker: DEPLOYMENT_MARKER,
      localTemplateChatDisabled: true});

    if (healthProbe) {
      const local = requestLocalIVXBrain({
        message: prompt,
        senderLabel,
        requestId,
        conversationId: readTrimmed(body.conversationId) || IVX_OWNER_AI_ROOM_ID});
      const capabilityChecks = buildLocalHealthCapabilityChecks(local);
      capabilityChecks.capabilities.ai_chat = false;
      capabilityChecks.capabilityProofs.ai_chat = {
        success: false,
        executable: false,
        functionName: 'local_expo_owner_ai_route_guard',
        checkedAt: nowIso(),
        proof: {
          responsePayload: {
            route: '/api/ivx/owner-ai',
            localTemplateChatDisabled: true,
            reason: 'This Expo API route is only a health probe placeholder. Owner chat must use the backend IVX AI proxy.'}},
        error: 'Local Expo owner-ai route does not execute GPT chat.'};
      const probePayload: IVXOwnerAIHealthProbeResponse = {
        requestId,
        conversationId: IVX_OWNER_AI_ROOM_ID,
        answer: 'Local Expo owner-ai route is reachable, but GPT chat is disabled here. Use the IVX backend owner-ai proxy for live replies.',
        model,
        status: 'ok',
        source: 'local_app_brain',
        probe: true,
        resolvedSchema: 'none',
        roomStatus: {
          storageMode: 'local_device_only',
          visibility: 'local_only',
          deliveryMethod: 'local_only'},
        capabilities: capabilityChecks.capabilities,
        capabilityProofs: capabilityChecks.capabilityProofs};

      return jsonResponse({ ...probePayload, deploymentMarker: DEPLOYMENT_MARKER } as unknown as Record<string, unknown>);
    }

    return jsonResponse({
      error: 'Local Expo owner-ai route is not the live IVX AI backend.',
      detail: 'Canned local template replies are disabled. Configure the app to use the backend IVX Owner AI proxy for real GPT responses.',
      requestId,
      conversationId: readTrimmed(body.conversationId) || IVX_OWNER_AI_ROOM_ID,
      model,
      source: 'local_app_brain',
      fallbackUsed: false,
      deploymentMarker: DEPLOYMENT_MARKER}, 503);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to process the IVX Owner AI request.';
    const normalizedMessage = message.toLowerCase();
    const status = error instanceof DuplicateOwnerRoomError
      ? 409
      : normalizedMessage.includes('missing bearer token') || normalizedMessage.includes('invalid or expired supabase session') || normalizedMessage.includes('authorization') || normalizedMessage.includes('invalid session')
        ? 401
        : normalizedMessage.includes('privileged ivx access is required') || normalizedMessage.includes('ivx role guard failed')
          ? 403
          : normalizedMessage.includes('configured')
            ? 503
            : 500;

    console.log('[IVXOwnerAI-API] Request failed:', {
      message,
      status,
      marker: DEPLOYMENT_MARKER});
    return jsonResponse({ error: message }, status);
  }
}
