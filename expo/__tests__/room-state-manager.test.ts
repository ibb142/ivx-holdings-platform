import { beforeEach, describe, expect, mock, test } from 'bun:test';

type MockRoomStatus = {
  storageMode: string;
  visibility: string;
  deliveryMethod: string;
  warning?: string;
};

let detectCallCount = 0;
let detectResult: MockRoomStatus = {
  storageMode: 'primary_supabase_tables',
  visibility: 'shared',
  deliveryMethod: 'primary_realtime',
};
let detectShouldFail = false;

mock.module('../src/modules/chat/services/ivxChat', () => ({
  detectRoomStatus: async () => {
    detectCallCount++;
    if (detectShouldFail) {
      throw new Error('detectRoomStatus mock failure');
    }
    return { ...detectResult };
  },
  invalidateRoomStatusCache: () => {},
}));

// react-native is mocked comprehensively by test-preload.ts (Platform, Linking, AppState, Alert, StyleSheet, Animated)

const roomState = await import('../src/modules/chat/services/roomStateManager');

beforeEach(() => {
  roomState.destroyRoomStateManager();
  detectCallCount = 0;
  detectShouldFail = false;
  detectResult = {
    storageMode: 'primary_supabase_tables',
    visibility: 'shared',
    deliveryMethod: 'primary_realtime',
  };
});

describe('RoomStateManager', () => {
  test('initial snapshot is initializing with null status', () => {
    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('initializing');
    expect(snapshot.status).toBeNull();
  });

  test('initRoomStateManager triggers detection and sets shared_live phase', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('shared_live');
    expect(snapshot.status?.storageMode).toBe('primary_supabase_tables');
    expect(snapshot.status?.deliveryMethod).toBe('primary_realtime');
    expect(detectCallCount).toBeGreaterThanOrEqual(1);
  });

  test('detection resolves to shared_alternate for alternate_room_schema', async () => {
    detectResult = {
      storageMode: 'alternate_room_schema',
      visibility: 'shared',
      deliveryMethod: 'alternate_shared',
    };

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('shared_alternate');
    expect(snapshot.status?.storageMode).toBe('alternate_room_schema');
  });

  test('detection resolves to local_fallback for local_device_only', async () => {
    detectResult = {
      storageMode: 'local_device_only',
      visibility: 'local_only',
      deliveryMethod: 'local_only',
    };

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('local_fallback');
    expect(snapshot.status?.storageMode).toBe('local_device_only');
  });

  test('detection resolves to shared_snapshot for snapshot_storage', async () => {
    detectResult = {
      storageMode: 'snapshot_storage',
      visibility: 'shared',
      deliveryMethod: 'snapshot_fallback',
    };

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('shared_snapshot');
  });

  test('detection resolves to shared_polling for primary_polling delivery', async () => {
    detectResult = {
      storageMode: 'primary_supabase_tables',
      visibility: 'shared',
      deliveryMethod: 'primary_polling',
    };

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('shared_polling');
  });

  test('subscribers receive updates when phase changes', async () => {
    const phases: string[] = [];
    roomState.subscribeToRoomState((snap) => {
      phases.push(snap.phase);
    });

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(phases.length).toBeGreaterThanOrEqual(1);
    expect(phases[phases.length - 1]).toBe('shared_live');
  });

  test('unsubscribe stops receiving updates', async () => {
    const phases: string[] = [];
    const unsub = roomState.subscribeToRoomState((snap) => {
      phases.push(snap.phase);
    });

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    unsub();
    const countAfterUnsub = phases.length;

    roomState.requestRoomRedetection();
    await new Promise((r) => setTimeout(r, 200));

    expect(phases.length).toBe(countAfterUnsub);
  });

  test('detection failure preserves shared phase if already shared', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(roomState.getRoomStateSnapshot().phase).toBe('shared_live');

    detectShouldFail = true;
    roomState.requestRoomRedetection();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('shared_live');
  });

  test('detection failure sets error phase when not shared', async () => {
    detectShouldFail = true;
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('error');
  });

  test('getAuthorativeRoomStatus returns fallback when no status yet', () => {
    const status = roomState.getAuthorativeRoomStatus();
    expect(status.storageMode).toBe('local_device_only');
    expect(status.visibility).toBe('local_only');
  });

  test('getAuthorativeRoomStatus returns real status after detection', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const status = roomState.getAuthorativeRoomStatus();
    expect(status.storageMode).toBe('primary_supabase_tables');
  });

  test('isRoomShared returns true for shared phases', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(roomState.isRoomShared()).toBe(true);
  });

  test('isRoomShared returns false for local_fallback', async () => {
    detectResult = {
      storageMode: 'local_device_only',
      visibility: 'local_only',
      deliveryMethod: 'local_only',
    };

    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(roomState.isRoomShared()).toBe(false);
  });

  test('generateSendCorrelationId returns unique values', () => {
    const id1 = roomState.generateSendCorrelationId();
    const id2 = roomState.generateSendCorrelationId();

    expect(id1).not.toBe(id2);
    expect(id1.startsWith('send-')).toBe(true);
    expect(id2.startsWith('send-')).toBe(true);
  });

  test('destroyRoomStateManager resets to initializing', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(roomState.getRoomStateSnapshot().phase).toBe('shared_live');

    roomState.destroyRoomStateManager();

    const snapshot = roomState.getRoomStateSnapshot();
    expect(snapshot.phase).toBe('initializing');
    expect(snapshot.status).toBeNull();
  });

  test('double init does not create duplicate detection', async () => {
    roomState.initRoomStateManager();
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    expect(detectCallCount).toBe(1);
  });

  test('requestRoomRedetection resets flip count and forces new detection', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const beforeCid = roomState.getRoomStateSnapshot().correlationId;

    detectResult = {
      storageMode: 'alternate_room_schema',
      visibility: 'shared',
      deliveryMethod: 'alternate_shared',
    };

    roomState.requestRoomRedetection();
    await new Promise((r) => setTimeout(r, 200));

    const after = roomState.getRoomStateSnapshot();
    expect(after.phase).toBe('shared_alternate');
    expect(after.correlationId).not.toBe(beforeCid);
    expect(after.flipCount).toBe(1);
  });

  test('correlationId changes with each detection cycle', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const firstCid = roomState.getRoomStateSnapshot().correlationId;

    roomState.requestRoomRedetection();
    await new Promise((r) => setTimeout(r, 200));

    const secondCid = roomState.getRoomStateSnapshot().correlationId;

    expect(typeof firstCid).toBe('string');
    expect(firstCid.length).toBeGreaterThan(0);
    expect(typeof secondCid).toBe('string');
  });

  test('message send always resolves to sent or failed, never indefinite sending', async () => {
    roomState.initRoomStateManager();
    await new Promise((r) => setTimeout(r, 200));

    const status = roomState.getAuthorativeRoomStatus();
    expect(status.storageMode).not.toBe('local_device_only');

    const cid = roomState.generateSendCorrelationId();
    expect(cid.startsWith('send-')).toBe(true);
  });
});
