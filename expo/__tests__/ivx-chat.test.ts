import { beforeEach, describe, expect, mock, test } from 'bun:test';
import { IVX_OWNER_ROOM_ID } from '../src/modules/chat/services/chatRooms';

type MockError = {
  code?: string;
  message?: string;
};

type MockRow = Record<string, unknown>;

type MockUpload = {
  bucket: string;
  path: string;
  body: unknown;
  contentType?: string;
};

type MockState = {
  capabilities: {
    primary: boolean;
    alternate: boolean;
    snapshot: boolean;
    altParticipants: boolean;
  };
  primaryConversations: Map<string, MockRow>;
  alternateConversationsById: Map<string, MockRow>;
  alternateConversationsBySlug: Map<string, MockRow>;
  primaryParticipants: Map<string, MockRow>;
  alternateParticipants: Map<string, MockRow>;
  primaryMessages: MockRow[];
  alternateMessages: MockRow[];
  snapshots: MockRow[];
  uploads: MockUpload[];
  removedChannels: string[];
  errors: {
    primaryInsert: MockError | null;
    alternateInsert: MockError | null;
    snapshotInsert: MockError | null;
  };
  order: string[];
};

const asyncStorageState = new Map<string, string>();

function createState(): MockState {
  return {
    capabilities: {
      primary: true,
      alternate: true,
      snapshot: true,
      altParticipants: true,
    },
    primaryConversations: new Map<string, MockRow>(),
    alternateConversationsById: new Map<string, MockRow>(),
    alternateConversationsBySlug: new Map<string, MockRow>(),
    primaryParticipants: new Map<string, MockRow>(),
    alternateParticipants: new Map<string, MockRow>(),
    primaryMessages: [],
    alternateMessages: [],
    snapshots: [],
    uploads: [],
    removedChannels: [],
    errors: {
      primaryInsert: null,
      alternateInsert: null,
      snapshotInsert: null,
    },
    order: [],
  };
}

let currentState: MockState = createState();

function createError(message: string, code?: string): MockError {
  return { message, code };
}

function readFilter(filters: Array<{ field: string; value: unknown }>, field: string): unknown {
  return filters.find((filter) => filter.field === field)?.value;
}

function resolveCapability(table: string): boolean {
  if (table === 'conversations' || table === 'messages') {
    return currentState.capabilities.primary;
  }

  if (table === 'chat_rooms' || table === 'room_messages') {
    return currentState.capabilities.alternate;
  }

  if (table === 'room_participants') {
    return currentState.capabilities.altParticipants;
  }

  if (table === 'realtime_snapshots') {
    return currentState.capabilities.snapshot;
  }

  return true;
}

function makeCapabilityResult(table: string): { data: MockRow[] | null; error: MockError | null } {
  if (resolveCapability(table)) {
    return { data: [], error: null };
  }

  return {
    data: null,
    error: createError(`relation ${table} does not exist`, '42P01'),
  };
}

function participantKey(conversationId: unknown, userId: unknown): string {
  return `${String(conversationId ?? '')}:${String(userId ?? '')}`;
}

function executeSelect(table: string, filters: Array<{ field: string; value: unknown }>): { data: MockRow[] | null; error: MockError | null } {
  if (filters.length === 0) {
    return makeCapabilityResult(table);
  }

  if (table === 'conversations') {
    const id = readFilter(filters, 'id');
    const row = typeof id === 'string' ? currentState.primaryConversations.get(id) ?? null : null;
    return { data: row ? [row] : [], error: null };
  }

  if (table === 'chat_rooms') {
    const id = readFilter(filters, 'id');
    if (typeof id === 'string') {
      const row = currentState.alternateConversationsById.get(id) ?? null;
      return { data: row ? [row] : [], error: null };
    }

    const slug = readFilter(filters, 'slug');
    if (typeof slug === 'string') {
      const row = currentState.alternateConversationsBySlug.get(slug) ?? null;
      return { data: row ? [row] : [], error: null };
    }

    return { data: [], error: null };
  }

  if (table === 'conversation_participants') {
    const conversationId = readFilter(filters, 'conversation_id');
    const userId = readFilter(filters, 'user_id');
    const rows = [...currentState.primaryParticipants.values()].filter((row) => {
      const matchesConversation = conversationId === undefined || row.conversation_id === conversationId;
      const matchesUser = userId === undefined || row.user_id === userId;
      return matchesConversation && matchesUser;
    });
    return { data: rows, error: null };
  }

  if (table === 'room_participants') {
    const roomId = readFilter(filters, 'room_id');
    const userId = readFilter(filters, 'user_id');
    const actorId = readFilter(filters, 'actor_id');
    const rows = [...currentState.alternateParticipants.values()].filter((row) => {
      const matchesRoom = roomId === undefined || row.room_id === roomId;
      const matchesUser = userId === undefined || row.user_id === userId;
      const matchesActor = actorId === undefined || row.actor_id === actorId;
      return matchesRoom && matchesUser && matchesActor;
    });
    return { data: rows, error: null };
  }

  if (table === 'messages') {
    const conversationId = readFilter(filters, 'conversation_id');
    const rows = currentState.primaryMessages.filter((row) => row.conversation_id === conversationId);
    return { data: rows, error: null };
  }

  if (table === 'room_messages') {
    const roomId = readFilter(filters, 'room_id');
    const rows = currentState.alternateMessages.filter((row) => row.room_id === roomId);
    return { data: rows, error: null };
  }

  if (table === 'realtime_snapshots') {
    const snapshotType = readFilter(filters, 'snapshot_type');
    const rows = currentState.snapshots.filter((row) => row.snapshot_type === snapshotType);
    return { data: rows, error: null };
  }

  return { data: [], error: null };
}

function executeInsert(table: string, payload: MockRow): { data: MockRow | null; error: MockError | null } {
  if (table === 'messages') {
    currentState.order.push('primary-insert');
    if (currentState.errors.primaryInsert) {
      return { data: null, error: currentState.errors.primaryInsert };
    }

    currentState.primaryMessages.push(payload);
    return { data: payload, error: null };
  }

  if (table === 'room_messages') {
    currentState.order.push('alternate-insert');
    if (currentState.errors.alternateInsert) {
      return { data: null, error: currentState.errors.alternateInsert };
    }

    currentState.alternateMessages.push(payload);
    return { data: payload, error: null };
  }

  if (table === 'realtime_snapshots') {
    currentState.order.push('snapshot-insert');
    if (currentState.errors.snapshotInsert) {
      return { data: null, error: currentState.errors.snapshotInsert };
    }

    currentState.snapshots.push(payload);
    return { data: payload, error: null };
  }

  return { data: payload, error: null };
}

function executeUpsert(table: string, payload: MockRow): { data: null; error: MockError | null } {
  if (table === 'conversations') {
    currentState.order.push('primary-upsert');
    const id = String(payload.id ?? '');
    currentState.primaryConversations.set(id, {
      ...currentState.primaryConversations.get(id),
      ...payload,
    });
    return { data: null, error: null };
  }

  if (table === 'chat_rooms') {
    currentState.order.push('alternate-upsert');
    const id = String(payload.id ?? '');
    const nextRow = {
      ...currentState.alternateConversationsById.get(id),
      ...payload,
    };
    currentState.alternateConversationsById.set(id, nextRow);
    const slug = typeof nextRow.slug === 'string' ? nextRow.slug : '';
    if (slug) {
      currentState.alternateConversationsBySlug.set(slug, nextRow);
    }
    return { data: null, error: null };
  }

  if (table === 'conversation_participants') {
    currentState.order.push('primary-participant-upsert');
    const key = participantKey(payload.conversation_id, payload.user_id);
    currentState.primaryParticipants.set(key, {
      ...currentState.primaryParticipants.get(key),
      ...payload,
    });
    return { data: null, error: null };
  }

  if (table === 'room_participants') {
    currentState.order.push('alternate-participant-upsert');
    const key = participantKey(payload.room_id, payload.user_id ?? payload.actor_id);
    currentState.alternateParticipants.set(key, {
      ...currentState.alternateParticipants.get(key),
      ...payload,
    });
    return { data: null, error: null };
  }

  return { data: null, error: null };
}

function executeUpdate(table: string, filters: Array<{ field: string; value: unknown }>, payload: MockRow): { data: null; error: MockError | null } {
  if (table === 'conversations') {
    const id = readFilter(filters, 'id');
    if (typeof id === 'string') {
      const existing = currentState.primaryConversations.get(id) ?? { id };
      currentState.primaryConversations.set(id, {
        ...existing,
        ...payload,
      });
    }
    return { data: null, error: null };
  }

  if (table === 'chat_rooms') {
    const id = readFilter(filters, 'id');
    if (typeof id === 'string') {
      const existing = currentState.alternateConversationsById.get(id) ?? { id };
      const nextRow = {
        ...existing,
        ...payload,
      };
      currentState.alternateConversationsById.set(id, nextRow);
      const slug = typeof nextRow.slug === 'string' ? nextRow.slug : '';
      if (slug) {
        currentState.alternateConversationsBySlug.set(slug, nextRow);
      }
    }
    return { data: null, error: null };
  }

  if (table === 'conversation_participants') {
    const conversationId = readFilter(filters, 'conversation_id');
    const userId = readFilter(filters, 'user_id');
    if (conversationId !== undefined && userId !== undefined) {
      const key = participantKey(conversationId, userId);
      const existing = currentState.primaryParticipants.get(key) ?? {
        conversation_id: conversationId,
        user_id: userId,
        unread_count: 0,
      };
      currentState.primaryParticipants.set(key, {
        ...existing,
        ...payload,
      });
    }
    return { data: null, error: null };
  }

  if (table === 'room_participants') {
    const roomId = readFilter(filters, 'room_id');
    const userId = readFilter(filters, 'user_id') ?? readFilter(filters, 'actor_id');
    if (roomId !== undefined && userId !== undefined) {
      const key = participantKey(roomId, userId);
      const existing = currentState.alternateParticipants.get(key) ?? {
        room_id: roomId,
        user_id: userId,
        unread_count: 0,
      };
      currentState.alternateParticipants.set(key, {
        ...existing,
        ...payload,
      });
    }
    return { data: null, error: null };
  }

  return { data: null, error: null };
}

class QueryBuilder {
  private action: 'select' | 'insert' | 'update' = 'select';
  private payload: MockRow | null = null;
  private filters: Array<{ field: string; value: unknown }> = [];

  constructor(private readonly table: string) {}

  select(_fields: string): QueryBuilder {
    return this;
  }

  eq(field: string, value: unknown): QueryBuilder {
    this.filters.push({ field, value });
    return this;
  }

  order(_field: string, _options?: { ascending?: boolean }): QueryBuilder {
    return this;
  }

  limit(_count: number): Promise<{ data: MockRow[] | null; error: MockError | null }> {
    return Promise.resolve(this.executeSelect());
  }

  insert(payload: MockRow): QueryBuilder {
    this.action = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload: MockRow): QueryBuilder {
    this.action = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload: MockRow, _options?: { onConflict?: string }): Promise<{ data: null; error: MockError | null }> {
    return Promise.resolve(executeUpsert(this.table, payload));
  }

  maybeSingle(): Promise<{ data: MockRow | null; error: MockError | null }> {
    const result = this.executeSelect();
    return Promise.resolve({
      data: result.data?.[0] ?? null,
      error: result.error,
    });
  }

  single(): Promise<{ data: MockRow | null; error: MockError | null }> {
    if (this.action === 'insert' && this.payload) {
      return Promise.resolve(executeInsert(this.table, this.payload));
    }

    const result = this.executeSelect();
    return Promise.resolve({
      data: result.data?.[0] ?? null,
      error: result.error,
    });
  }

  then<TResult1 = { data: MockRow[] | MockRow | null; error: MockError | null }, TResult2 = never>(
    onfulfilled?: ((value: { data: MockRow[] | MockRow | null; error: MockError | null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled ?? undefined, onrejected ?? undefined);
  }

  private executeSelect(): { data: MockRow[] | null; error: MockError | null } {
    return executeSelect(this.table, this.filters);
  }

  private execute(): Promise<{ data: MockRow[] | MockRow | null; error: MockError | null }> {
    if (this.action === 'insert' && this.payload) {
      return Promise.resolve(executeInsert(this.table, this.payload));
    }

    if (this.action === 'update' && this.payload) {
      const result = executeUpdate(this.table, this.filters, this.payload);
      return Promise.resolve(result);
    }

    return Promise.resolve(this.executeSelect());
  }
}

const mockSupabase = {
  from(table: string) {
    return new QueryBuilder(table);
  },
  storage: {
    from(bucket: string) {
      return {
        upload: async (path: string, body: unknown, options?: { cacheControl?: string; upsert?: boolean; contentType?: string }) => {
          currentState.uploads.push({
            bucket,
            path,
            body,
            contentType: options?.contentType,
          });
          return { data: null, error: null };
        },
        getPublicUrl: (_path: string) => ({ data: { publicUrl: 'https://example.com/mock-file' } }),
      };
    },
  },
  channel(name: string) {
    return {
      name,
      on() {
        return this;
      },
      subscribe(_callback?: (status: string) => void) {
        return this;
      },
    };
  },
  removeChannel(channel: unknown) {
    const channelName = typeof channel === 'object' && channel && 'name' in channel
      ? String((channel as { name?: unknown }).name ?? '')
      : '';
    currentState.removedChannels.push(channelName);
    return Promise.resolve('ok');
  },
};

// Override the global supabase mock from test-preload.ts. The preload
// registers a Proxy-based mock.module('@/lib/supabase') that delegates to
// globalThis.__IVX_TEST_SUPABASE__. Setting it here ensures ivxChat.ts uses
// our mockSupabase object without needing to win Bun's first-come-first-served
// mock.module race.
(globalThis as Record<string, unknown>).__IVX_TEST_SUPABASE__ = mockSupabase;

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => asyncStorageState.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorageState.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorageState.delete(key);
    },
  },
}));

mock.module('react-native', () => ({
  Platform: { OS: 'ios', Version: '17.0', select: (obj: Record<string, unknown>) => obj.ios ?? obj.default },
  TurboModuleRegistry: { get: () => ({}) },
  NativeModules: {},
  NativeEventEmitter: class { addListener() { return { remove: () => {} }; } removeAllListeners() {} },
  StyleSheet: { create: (s: Record<string, unknown>) => s, flatten: (s: Record<string, unknown>) => s },
  Linking: {
    canOpenURL: async () => true,
    openURL: async () => {},
  },
  AppState: {
    addEventListener: () => ({ remove: () => {} }),
    currentState: 'active',
  },
  // Process-global mock: keep component stubs so other suites can import them.
  Text: Object.assign(function Text() { return null; }, { displayName: 'Text' }),
  TextInput: Object.assign(function TextInput() { return null; }, { displayName: 'TextInput' }),
  View: Object.assign(function View() { return null; }, { displayName: 'View' }),
}));

const ivxChat = await import('../src/modules/chat/services/ivxChat');

beforeEach(() => {
  currentState = createState();
  asyncStorageState.clear();
  // Invalidate room status cache between tests — cachedRoomStatus is a
  // module-level variable that persists across tests in the same file.
  ivxChat.invalidateRoomStatusCache();
});

describe('ivx chat bootstrap and fallback flow', () => {
  test('bootstrapRoomByFriendlySlug reuses the same UUID-backed room without duplicate creation', async () => {
    currentState.capabilities.primary = true;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    const first = await ivxChat.bootstrapRoomByFriendlySlug('ivx-owner-room');
    const second = await ivxChat.bootstrapRoomByFriendlySlug('ivx-owner-room');

    expect(first.conversation.id).toBe(IVX_OWNER_ROOM_ID);
    expect(second.conversation.id).toBe(IVX_OWNER_ROOM_ID);
    expect(first.conversation.slug).toBe('ivx-owner-room');
    expect(second.conversation.slug).toBe('ivx-owner-room');
    expect(currentState.order.filter((entry) => entry === 'primary-upsert')).toHaveLength(1);
    expect(currentState.primaryConversations.size).toBe(1);
  });

  test('detectRoomStatus steps down through primary, alternate, snapshot, and local modes', async () => {
    currentState.capabilities = {
      primary: true,
      alternate: true,
      snapshot: true,
      altParticipants: true,
    };
    expect((await ivxChat.detectRoomStatus()).storageMode).toBe('primary_supabase_tables');

    currentState.capabilities.primary = false;
    expect((await ivxChat.detectRoomStatus()).storageMode).toBe('alternate_room_schema');

    currentState.capabilities.alternate = false;
    currentState.capabilities.altParticipants = false;
    expect((await ivxChat.detectRoomStatus()).storageMode).toBe('snapshot_storage');

    currentState.capabilities.snapshot = false;
    expect((await ivxChat.detectRoomStatus()).storageMode).toBe('local_device_only');
  });

  test('sendTextMessage falls through primary to alternate to snapshot to local when each higher path fails', async () => {
    currentState.capabilities = {
      primary: true,
      alternate: true,
      snapshot: true,
      altParticipants: true,
    };
    currentState.errors.primaryInsert = createError('row-level security policy violation', '42501');
    currentState.errors.alternateInsert = createError('room_messages permission denied', '42501');
    currentState.errors.snapshotInsert = createError('Auth session missing', '401');

    const result = await ivxChat.sendTextMessage({
      conversationId: 'ivx-owner-room',
      senderId: 'preview-user',
      text: 'Hello from fallback test',
    });

    expect(result.status.storageMode).toBe('local_device_only');
    expect(result.status.deliveryMethod).toBe('local_only');
    expect(result.message.localOnly).toBe(true);
    expect(currentState.order.indexOf('primary-insert')).toBeGreaterThan(-1);
    expect(currentState.order.indexOf('alternate-insert')).toBeGreaterThan(currentState.order.indexOf('primary-insert'));
    expect(currentState.order.indexOf('snapshot-insert')).toBeGreaterThan(currentState.order.indexOf('alternate-insert'));

    const savedLocalMessages = JSON.parse(asyncStorageState.get(`ivx_chat_room:${IVX_OWNER_ROOM_ID}`) ?? '[]') as Array<{ text?: string }>;
    expect(savedLocalMessages).toHaveLength(1);
    expect(savedLocalMessages[0]?.text).toBe('Hello from fallback test');
  });

  test('subscribeToRoomMessages removes the realtime channel on unsubscribe', async () => {
    currentState.capabilities.primary = true;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    const subscription = await ivxChat.subscribeToRoomMessages('ivx-owner-room', () => {});
    subscription.unsubscribe();
    await new Promise((r) => setTimeout(r, 50));

    expect(currentState.removedChannels).toHaveLength(1);
    expect(currentState.removedChannels[0]?.includes(IVX_OWNER_ROOM_ID)).toBe(true);
  });

  test('markConversationAsRead resets unread count for the current primary participant', async () => {
    currentState.capabilities.primary = true;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    await ivxChat.bootstrapRoomByFriendlySlug('ivx-owner-room');
    currentState.primaryParticipants.set(`${IVX_OWNER_ROOM_ID}:reader-1`, {
      conversation_id: IVX_OWNER_ROOM_ID,
      user_id: 'reader-1',
      unread_count: 4,
      last_read_at: null,
    });

    await ivxChat.markConversationAsRead('ivx-owner-room', 'reader-1');

    const participant = currentState.primaryParticipants.get(`${IVX_OWNER_ROOM_ID}:reader-1`);
    expect(participant?.unread_count).toBe(0);
    expect(typeof participant?.last_read_at).toBe('string');
  });

  test('local-only status exposes the device-only warning used by the room status card', async () => {
    currentState.capabilities.primary = false;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    const status = await ivxChat.detectRoomStatus();
    const card = ivxChat.getRoomStatusCardData(status);

    expect(status.storageMode).toBe('local_device_only');
    expect(status.warning).toBe('Messages are only stored on this device and are not shared.');
    expect(card.warning).toBe('Messages are only stored on this device and are not shared.');
  });

  test('sendAttachmentMessage uploads successfully from a web file payload', async () => {
    currentState.capabilities.primary = true;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    const result = await ivxChat.sendAttachmentMessage({
      conversationId: 'ivx-owner-room',
      senderId: 'preview-user',
      upload: {
        name: 'deck.pdf',
        type: 'application/pdf',
        size: 4,
        file: {
          name: 'deck.pdf',
          type: 'application/pdf',
          size: 4,
          arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
        },
      },
    });

    expect(result.status.storageMode).toBe('primary_supabase_tables');
    expect(result.message.fileUrl).toBe('https://example.com/mock-file');
    expect(result.message.fileType).toBe('pdf');
    expect(currentState.uploads).toHaveLength(1);
    expect(currentState.uploads[0]?.bucket).toBe('ivx-chat-uploads');
    expect(currentState.uploads[0]?.contentType).toBe('application/pdf');
    expect(currentState.uploads[0]?.body instanceof ArrayBuffer).toBe(true);
  });

  test('sendAttachmentMessage uploads successfully from a mobile uri payload', async () => {
    currentState.capabilities.primary = true;
    currentState.capabilities.alternate = false;
    currentState.capabilities.snapshot = false;
    currentState.capabilities.altParticipants = false;

    const originalFetch = globalThis.fetch;
    let requestedUri = '';

    globalThis.fetch = (async (input: string | URL | Request) => {
      requestedUri = String(input);
      return new Response(new Uint8Array([7, 8, 9]), {
        status: 200,
        headers: {
          'content-type': 'image/png',
        },
      });
    }) as typeof fetch;

    try {
      const result = await ivxChat.sendAttachmentMessage({
        conversationId: 'ivx-owner-room',
        senderId: 'preview-user',
        upload: {
          uri: 'file://mock-image.png',
          name: 'mock-image.png',
          type: 'image/png',
          size: 3,
        },
      });

      expect(requestedUri).toBe('file://mock-image.png');
      expect(result.status.storageMode).toBe('primary_supabase_tables');
      expect(result.message.fileUrl).toBe('https://example.com/mock-file');
      expect(result.message.fileType).toBe('image');
      expect(currentState.uploads).toHaveLength(1);
      expect(currentState.uploads[0]?.contentType).toBe('image/png');
      expect(currentState.uploads[0]?.body instanceof ArrayBuffer).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
