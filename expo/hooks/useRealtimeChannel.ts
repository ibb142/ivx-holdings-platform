/**
 * useRealtimeChannel — Canonical Supabase realtime hook with auto-reconnect.
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - AppState-aware (subscribes on foreground, unsubscribes on background)
 * - Throttled query cache invalidation (no refetch storms)
 * - Delta cache updates (apply INSERT/UPDATE/DELETE directly to cache)
 * - Status surface for debugging
 * - Duplicate channel prevention
 * - Proper cleanup on unmount
 *
 * Usage:
 * ```tsx
 * useRealtimeChannel({
 *   channelName: 'projects-feed',
 *   table: 'properties',
 *   event: '*',
 *   filter: 'status=eq.active',
 *   queryKeys: [['projects']],
 *   onPayload: (payload) => console.log('Realtime event:', payload),
 * });
 * ```
 */
import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

// ─── Types ───────────────────────────────────────────────────────────

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeChannelConfig {
  /** Unique channel name (prevents duplicates). */
  channelName: string;
  /** Supabase table to watch. */
  table: string;
  /** Database schema (default: 'public'). */
  schema?: string;
  /** Event type (default: '*'). */
  event?: RealtimeEvent;
  /** Optional filter (e.g. 'user_id=eq.123'). */
  filter?: string;
  /** React Query keys to invalidate on changes. */
  queryKeys?: string[][];
  /** Optional delta callback — apply changes directly to cache. */
  onDelta?: (
    queryClient: QueryClient,
    event: RealtimeEvent,
    record: Record<string, unknown>,
  ) => void;
  /** Optional raw payload callback. */
  onPayload?: (
    payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  ) => void;
}

export type RealtimeStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting'
  | 'error'
  | 'not_configured';

export interface RealtimeChannelState {
  status: RealtimeStatus;
  reconnectAttempt: number;
  lastEventAt: number | null;
  lastError: string | null;
}

// ─── Constants ───────────────────────────────────────────────────────

const INVALIDATION_THROTTLE_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

// ─── Throttled invalidation ──────────────────────────────────────────

const _lastInvalidation = new Map<string, number>();

function throttledInvalidate(
  queryClient: QueryClient,
  keys: string[][],
  throttleMs: number = INVALIDATION_THROTTLE_MS,
): void {
  const now = Date.now();
  for (const key of keys) {
    const keyStr = JSON.stringify(key);
    const last = _lastInvalidation.get(keyStr) ?? 0;
    if (now - last < throttleMs) continue;
    _lastInvalidation.set(keyStr, now);
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

// ─── Default delta applier ───────────────────────────────────────────

function defaultDeltaApplier(
  queryClient: QueryClient,
  queryKeyPrefix: string[],
  event: RealtimeEvent,
  record: Record<string, unknown>,
): void {
  const recordId = String(record.id ?? '');
  if (!recordId) return;

  queryClient.setQueriesData<{ items: unknown[]; hasMore: boolean }>(
    { queryKey: queryKeyPrefix },
    (cached) => {
      if (!cached || !Array.isArray(cached.items)) return cached;
      const items = cached.items as Array<Record<string, unknown> & { id?: string }>;
      const existingIndex = items.findIndex((item) => String(item?.id) === recordId);

      switch (event) {
        case 'INSERT': {
          if (existingIndex >= 0) {
            const updated = [...items];
            updated[existingIndex] = record as any;
            return { ...cached, items: updated };
          }
          return { ...cached, items: [record as any, ...items] };
        }
        case 'UPDATE': {
          if (existingIndex >= 0) {
            const updated = [...items];
            updated[existingIndex] = record as any;
            return { ...cached, items: updated };
          }
          return cached;
        }
        case 'DELETE': {
          if (existingIndex >= 0) {
            return { ...cached, items: items.filter((_, i) => i !== existingIndex) };
          }
          return cached;
        }
        default:
          return cached;
      }
    },
  );
}

// ─── Hook ────────────────────────────────────────────────────────────

export function useRealtimeChannel(
  configs: RealtimeChannelConfig[],
  options?: {
    /** Whether to auto-reconnect (default: true). */
    autoReconnect?: boolean;
    /** Whether to pause on background (default: true). */
    pauseOnBackground?: boolean;
    /** Whether to apply delta updates to cache (default: true if onDelta or queryKeys present). */
    applyDeltas?: boolean;
  },
): RealtimeChannelState {
  const queryClient = useQueryClient();
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const activeRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);

  const [state, setState] = useState<RealtimeChannelState>({
    status: 'idle',
    reconnectAttempt: 0,
    lastEventAt: null,
    lastError: null,
  });

  const {
    autoReconnect = true,
    pauseOnBackground = true,
    applyDeltas = true,
  } = options ?? {};

  // Stable channel key for cleanup
  const channelKey = useMemo(
    () => configs.map((c) => c.channelName).join(','),
    [configs],
  );

  // ─── Cleanup channels ─────────────────────────────────────────────
  const cleanupChannels = useCallback(() => {
    for (const ch of channelsRef.current) {
      try {
        void supabase.removeChannel(ch);
      } catch {}
    }
    channelsRef.current = [];
  }, []);

  // ─── Setup channels ───────────────────────────────────────────────
  const setupChannels = useCallback(() => {
    cleanupChannels();

    if (!isSupabaseConfigured()) {
      setState((prev) => ({ ...prev, status: 'not_configured' }));
      return;
    }

    if (configs.length === 0) return;

    setState((prev) => ({
      ...prev,
      status: reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting',
    }));

    for (const config of configs) {
      const channel = supabase
        .channel(config.channelName)
        .on(
          'postgres_changes' as any,
          {
            event: config.event || '*',
            schema: config.schema || 'public',
            table: config.table,
            ...(config.filter ? { filter: config.filter } : {}),
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (!activeRef.current || isPausedRef.current) return;

            const eventType = (payload.eventType as RealtimeEvent) || '*';
            const record = (payload.new ?? payload.old) as Record<string, unknown> | undefined;

            // Update state
            setState((prev) => ({
              ...prev,
              lastEventAt: Date.now(),
              lastError: null,
            }));

            // Throttled cache invalidation
            if (config.queryKeys && config.queryKeys.length > 0) {
              throttledInvalidate(queryClient, config.queryKeys);
            }

            // Delta cache update
            if (applyDeltas && record && config.queryKeys) {
              for (const key of config.queryKeys) {
                defaultDeltaApplier(queryClient, key, eventType, record);
              }
            }

            // Custom delta handler
            if (config.onDelta && record) {
              try {
                config.onDelta(queryClient, eventType, record);
              } catch (err) {
                console.log('[useRealtimeChannel] onDelta error:', (err as Error)?.message);
              }
            }

            // Raw payload callback
            if (config.onPayload) {
              try {
                config.onPayload(payload);
              } catch (err) {
                console.log('[useRealtimeChannel] onPayload error:', (err as Error)?.message);
              }
            }
          },
        )
        .subscribe((status: string) => {
          if (status === 'SUBSCRIBED') {
            reconnectAttemptRef.current = 0;
            setState((prev) => ({
              ...prev,
              status: 'connected',
              reconnectAttempt: 0,
              lastError: null,
            }));
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setState((prev) => ({
              ...prev,
              status: 'error',
              lastError: status,
            }));

            // Auto-reconnect with exponential backoff
            if (autoReconnect && activeRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
              const attempt = reconnectAttemptRef.current;
              const backoff = Math.min(
                BASE_BACKOFF_MS * Math.pow(2, attempt),
                MAX_BACKOFF_MS,
              );
              reconnectAttemptRef.current = attempt + 1;

              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = setTimeout(() => {
                if (activeRef.current && !isPausedRef.current) {
                  setupChannels();
                }
              }, backoff);

              setState((prev) => ({
                ...prev,
                status: 'reconnecting',
                reconnectAttempt: reconnectAttemptRef.current,
              }));
            }
          } else if (status === 'CLOSED') {
            setState((prev) => ({ ...prev, status: 'disconnected' }));
          }
        });

      channelsRef.current.push(channel);
    }
  }, [configs, queryClient, cleanupChannels, autoReconnect, applyDeltas]);

  // ─── Setup on mount / config change ───────────────────────────────
  useEffect(() => {
    activeRef.current = true;
    isPausedRef.current = false;
    setupChannels();

    // AppState handling
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        if (pauseOnBackground) {
          isPausedRef.current = false;
          // Resubscribe if we were paused
          if (channelsRef.current.length === 0) {
            setupChannels();
          }
        }
      } else if (nextState === 'background' || nextState === 'inactive') {
        if (pauseOnBackground) {
          isPausedRef.current = true;
          cleanupChannels();
          setState((prev) => ({ ...prev, status: 'disconnected' }));
        }
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      activeRef.current = false;
      appStateSub.remove();
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      cleanupChannels();
    };
  }, [channelKey, setupChannels, cleanupChannels, pauseOnBackground]);

  return state;
}

// ─── Convenience hook for single table ───────────────────────────────

export function useRealtimeTable(
  table: string,
  queryKeys: string[][],
  options?: {
    event?: RealtimeEvent;
    filter?: string;
    onPayload?: (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    ) => void;
    onDelta?: (
      queryClient: QueryClient,
      event: RealtimeEvent,
      record: Record<string, unknown>,
    ) => void;
  },
): RealtimeChannelState {
  const configs = useMemo<RealtimeChannelConfig[]>(
    () => [
      {
        channelName: `rt-${table}`,
        table,
        event: options?.event || '*',
        filter: options?.filter,
        queryKeys,
        onPayload: options?.onPayload,
        onDelta: options?.onDelta,
      },
    ],
    [table, options?.event, options?.filter, queryKeys, options?.onPayload, options?.onDelta],
  );

  return useRealtimeChannel(configs);
}

export default useRealtimeChannel;
