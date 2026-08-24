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
 * - Semantic config stability so inline query-key arrays/callbacks cannot create
 *   an effect -> setState -> render -> resubscribe loop.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type {
  RealtimeChannel,
  RealtimePostgresChangesPayload,
} from '@supabase/supabase-js';

export type RealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE' | '*';

export interface RealtimeChannelConfig {
  channelName: string;
  table: string;
  schema?: string;
  event?: RealtimeEvent;
  filter?: string;
  queryKeys?: string[][];
  onDelta?: (
    queryClient: QueryClient,
    event: RealtimeEvent,
    record: Record<string, unknown>,
  ) => void;
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

const INVALIDATION_THROTTLE_MS = 2_000;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;

const _lastInvalidation = new Map<string, number>();

/**
 * Only subscription topology belongs in the resubscribe identity.
 * Callback object identity is intentionally excluded: event handlers read the
 * latest config from configsRef. This means callers can safely pass inline
 * arrays/functions without re-running the subscription effect on every render.
 */
export function buildRealtimeConfigSignature(configs: RealtimeChannelConfig[]): string {
  return JSON.stringify(
    configs.map((config) => ({
      channelName: config.channelName,
      table: config.table,
      schema: config.schema ?? 'public',
      event: config.event ?? '*',
      filter: config.filter ?? '',
      queryKeys: config.queryKeys ?? [],
    })),
  );
}

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

export function useRealtimeChannel(
  configs: RealtimeChannelConfig[],
  options?: {
    autoReconnect?: boolean;
    pauseOnBackground?: boolean;
    applyDeltas?: boolean;
  },
): RealtimeChannelState {
  const queryClient = useQueryClient();
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const activeRef = useRef(true);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isPausedRef = useRef(false);
  const configsRef = useRef(configs);
  configsRef.current = configs;

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

  // Recomputed cheaply each render, but primitive equality keeps effects stable
  // when callers recreate equivalent arrays/objects.
  const configSignature = buildRealtimeConfigSignature(configs);

  const cleanupChannels = useCallback(() => {
    for (const ch of channelsRef.current) {
      try {
        void supabase.removeChannel(ch);
      } catch {}
    }
    channelsRef.current = [];
  }, []);

  const setupChannels = useCallback(() => {
    cleanupChannels();

    if (!isSupabaseConfigured()) {
      setState((prev) => prev.status === 'not_configured'
        ? prev
        : { ...prev, status: 'not_configured' });
      return;
    }

    const activeConfigs = configsRef.current;
    if (activeConfigs.length === 0) return;

    const nextStatus: RealtimeStatus = reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting';
    setState((prev) => prev.status === nextStatus ? prev : { ...prev, status: nextStatus });

    for (const initialConfig of activeConfigs) {
      const channel = supabase
        .channel(initialConfig.channelName)
        .on(
          'postgres_changes' as any,
          {
            event: initialConfig.event || '*',
            schema: initialConfig.schema || 'public',
            table: initialConfig.table,
            ...(initialConfig.filter ? { filter: initialConfig.filter } : {}),
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (!activeRef.current || isPausedRef.current) return;

            // Read the latest callback/query-key references without forcing a
            // resubscribe just because the caller rendered again.
            const config = configsRef.current.find(
              (candidate) => candidate.channelName === initialConfig.channelName,
            ) ?? initialConfig;

            const eventType = (payload.eventType as RealtimeEvent) || '*';
            const record = (payload.new ?? payload.old) as Record<string, unknown> | undefined;

            setState((prev) => ({
              ...prev,
              lastEventAt: Date.now(),
              lastError: null,
            }));

            if (config.queryKeys && config.queryKeys.length > 0) {
              throttledInvalidate(queryClient, config.queryKeys);
            }

            if (applyDeltas && record && config.queryKeys) {
              for (const key of config.queryKeys) {
                defaultDeltaApplier(queryClient, key, eventType, record);
              }
            }

            if (config.onDelta && record) {
              try {
                config.onDelta(queryClient, eventType, record);
              } catch (err) {
                console.log('[useRealtimeChannel] onDelta error:', (err as Error)?.message);
              }
            }

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
            setState((prev) => (
              prev.status === 'connected' && prev.reconnectAttempt === 0 && prev.lastError === null
                ? prev
                : { ...prev, status: 'connected', reconnectAttempt: 0, lastError: null }
            ));
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setState((prev) => ({ ...prev, status: 'error', lastError: status }));

            if (autoReconnect && activeRef.current && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
              const attempt = reconnectAttemptRef.current;
              const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
              reconnectAttemptRef.current = attempt + 1;

              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = setTimeout(() => {
                if (activeRef.current && !isPausedRef.current) setupChannels();
              }, backoff);

              setState((prev) => ({
                ...prev,
                status: 'reconnecting',
                reconnectAttempt: reconnectAttemptRef.current,
              }));
            }
            return;
          }

          if (status === 'CLOSED') {
            setState((prev) => prev.status === 'disconnected'
              ? prev
              : { ...prev, status: 'disconnected' });
          }
        });

      channelsRef.current.push(channel);
    }
  }, [configSignature, queryClient, cleanupChannels, autoReconnect, applyDeltas]);

  useEffect(() => {
    activeRef.current = true;
    isPausedRef.current = false;
    setupChannels();

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        if (pauseOnBackground) {
          isPausedRef.current = false;
          if (channelsRef.current.length === 0) setupChannels();
        }
        return;
      }

      if (nextState === 'background' || nextState === 'inactive') {
        if (pauseOnBackground) {
          isPausedRef.current = true;
          cleanupChannels();
          setState((prev) => prev.status === 'disconnected'
            ? prev
            : { ...prev, status: 'disconnected' });
        }
      }
    };

    const appStateSub = AppState.addEventListener('change', handleAppState);

    return () => {
      activeRef.current = false;
      appStateSub.remove();
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      cleanupChannels();
    };
  }, [configSignature, setupChannels, cleanupChannels, pauseOnBackground]);

  return state;
}

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
  return useRealtimeChannel([
    {
      channelName: `rt-${table}`,
      table,
      event: options?.event || '*',
      filter: options?.filter,
      queryKeys,
      onPayload: options?.onPayload,
      onDelta: options?.onDelta,
    },
  ]);
}

export default useRealtimeChannel;
