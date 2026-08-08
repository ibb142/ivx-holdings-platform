import { AppState, type AppStateStatus } from 'react-native';
import type { ChatRoomStatus, DeliveryMode, StorageMode } from '../types/chat';
import { detectRoomStatus, invalidateRoomStatusCache } from './roomDetection';

export type RoomSyncPhase =
  | 'initializing'
  | 'detecting'
  | 'shared_live'
  | 'shared_polling'
  | 'shared_alternate'
  | 'shared_snapshot'
  | 'local_fallback'
  | 'error';

type RoomStateListener = (state: RoomStateSnapshot) => void;

export type RoomStateSnapshot = {
  phase: RoomSyncPhase;
  status: ChatRoomStatus | null;
  lastDetectionMs: number;
  flipCount: number;
  correlationId: string;
};

const DETECTION_COOLDOWN_MS = 6_000;
const RECONNECT_DELAY_MS = 5_000;
const FLIP_GUARD_MS = 3_000;
const MAX_FLIP_COUNT_BEFORE_LOCK = 3;

let currentSnapshot: RoomStateSnapshot = {
  phase: 'initializing',
  status: null,
  lastDetectionMs: 0,
  flipCount: 0,
  correlationId: generateCorrelationId(),
};

let listeners = new Set<RoomStateListener>();
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let lastBackgroundTime = 0;
let initialized = false;
let detecting = false;
let lockedPhase: RoomSyncPhase | null = null;

function generateCorrelationId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID().slice(0, 8);
  }
  return Math.random().toString(36).slice(2, 10);
}

function phaseFromStatus(status: ChatRoomStatus): RoomSyncPhase {
  switch (status.storageMode) {
    case 'primary_supabase_tables':
      return status.deliveryMethod === 'primary_polling' ? 'shared_polling' : 'shared_live';
    case 'alternate_room_schema':
      return 'shared_alternate';
    case 'snapshot_storage':
      return 'shared_snapshot';
    case 'local_device_only':
      return 'local_fallback';
    default:
      return 'local_fallback';
  }
}

function isSharedPhase(phase: RoomSyncPhase): boolean {
  return phase === 'shared_live' || phase === 'shared_polling' || phase === 'shared_alternate' || phase === 'shared_snapshot';
}

function setSnapshot(next: RoomStateSnapshot): void {
  const prev = currentSnapshot;
  currentSnapshot = next;

  for (const listener of listeners) {
    try {
      listener(currentSnapshot);
    } catch (err) {
      console.log('[RoomStateManager] Listener error:', err instanceof Error ? err.message : 'unknown');
    }
  }
}

function shouldSuppressFlip(prevPhase: RoomSyncPhase, nextPhase: RoomSyncPhase): boolean {
  if (prevPhase === nextPhase) return true;

  if (lockedPhase && lockedPhase !== nextPhase) {
    return true;
  }

  const now = Date.now();
  const timeSinceLastDetection = now - currentSnapshot.lastDetectionMs;

  if (timeSinceLastDetection < FLIP_GUARD_MS && currentSnapshot.flipCount >= MAX_FLIP_COUNT_BEFORE_LOCK) {
    lockedPhase = prevPhase;
    setTimeout(() => {
      lockedPhase = null;
    }, DETECTION_COOLDOWN_MS * 2);
    return true;
  }

  if (isSharedPhase(prevPhase) && !isSharedPhase(nextPhase) && timeSinceLastDetection < FLIP_GUARD_MS) {
    return true;
  }

  return false;
}

async function runDetection(): Promise<void> {
  if (detecting) {
    return;
  }

  const now = Date.now();
  if (now - currentSnapshot.lastDetectionMs < DETECTION_COOLDOWN_MS && currentSnapshot.status) {
    return;
  }

  detecting = true;
  const cid = generateCorrelationId();

  try {
    invalidateRoomStatusCache();
    const status = await detectRoomStatus();
    const nextPhase = phaseFromStatus(status);
    const prevPhase = currentSnapshot.phase;

    if (shouldSuppressFlip(prevPhase, nextPhase)) {
      detecting = false;
      return;
    }

    const isDowngrade = isSharedPhase(prevPhase) && !isSharedPhase(nextPhase);
    const flipCount = prevPhase !== nextPhase
      ? currentSnapshot.flipCount + 1
      : currentSnapshot.flipCount;

    if (isDowngrade && flipCount <= 1) {
      detecting = false;
      scheduleReconnect(2000);
      return;
    }

    setSnapshot({
      phase: nextPhase,
      status,
      lastDetectionMs: Date.now(),
      flipCount,
      correlationId: cid,
    });

    if (!isSharedPhase(nextPhase)) {
      scheduleReconnect();
    } else {
      clearReconnect();
    }
  } catch (error) {
    if (currentSnapshot.status && isSharedPhase(currentSnapshot.phase)) {
      // keep current shared phase despite detection failure
    } else {
      setSnapshot({
        phase: 'error',
        status: currentSnapshot.status,
        lastDetectionMs: Date.now(),
        flipCount: currentSnapshot.flipCount,
        correlationId: cid,
      });
    }

    scheduleReconnect();
  } finally {
    detecting = false;
  }
}

function scheduleReconnect(delayMs: number = RECONNECT_DELAY_MS): void {
  if (reconnectTimer) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    void runDetection();
  }, delayMs);
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'background' || nextState === 'inactive') {
    lastBackgroundTime = Date.now();
    return;
  }

  if (nextState === 'active') {
    const elapsed = lastBackgroundTime ? Date.now() - lastBackgroundTime : 0;
    lastBackgroundTime = 0;

    if (elapsed < 5000 && isSharedPhase(currentSnapshot.phase)) {
      return;
    }

    if (elapsed < 2000) {
      return;
    }

    clearReconnect();
    void runDetection();
  }
}

export function initRoomStateManager(): void {
  if (initialized) return;
  initialized = true;

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
  void runDetection();
}

export function destroyRoomStateManager(): void {
  initialized = false;
  detecting = false;
  lockedPhase = null;
  clearReconnect();

  if (appStateSubscription) {
    appStateSubscription.remove();
    appStateSubscription = null;
  }

  listeners.clear();

  currentSnapshot = {
    phase: 'initializing',
    status: null,
    lastDetectionMs: 0,
    flipCount: 0,
    correlationId: generateCorrelationId(),
  };

  console.log('[RoomStateManager] Destroyed');
}

export function getRoomStateSnapshot(): RoomStateSnapshot {
  return currentSnapshot;
}

export function subscribeToRoomState(listener: RoomStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestRoomRedetection(): void {
  console.log('[RoomStateManager] Manual re-detection requested');
  lockedPhase = null;
  clearReconnect();

  currentSnapshot = {
    ...currentSnapshot,
    flipCount: 0,
    lastDetectionMs: 0,
  };

  void runDetection();
}

export function getAuthorativeRoomStatus(): ChatRoomStatus {
  if (currentSnapshot.status) {
    return currentSnapshot.status;
  }

  return {
    storageMode: 'local_device_only' as StorageMode,
    visibility: 'local_only',
    deliveryMethod: 'local_only' as DeliveryMode,
    warning: 'Room status not yet determined.',
  };
}

export function isRoomShared(): boolean {
  return isSharedPhase(currentSnapshot.phase);
}

export function getRoomPhase(): RoomSyncPhase {
  return currentSnapshot.phase;
}

export function generateSendCorrelationId(): string {
  return `send-${generateCorrelationId()}-${Date.now()}`;
}
