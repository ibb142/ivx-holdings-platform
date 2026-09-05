/**
 * Canonical Supabase realtime hook.
 *
 * Important invariant: every mounted hook instance and every reconnect attempt
 * gets a unique Supabase topic. Reusing a subscribed topic can make Supabase
 * throw: "cannot add `postgres_changes` callbacks ... after `subscribe()`".
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { RealtimeChannel, RealtimePostgresChangesPayload } from '@supabase/supabase-js';

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
let _realtimeInstanceSequence = 0;

function nextRealtimeInstanceId(): string {
  _realtimeInstanceSequence += 1;
  return `i${_realtimeInstanceSequence}`;
}

export function buildRealtimeRuntimeChannelName(
  baseName: string,
  instanceId: string,
  generation: number,
): string {
  return `${baseName}-${instanceId}-g${generation}`;
}

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

function throttledInvalidate(queryClient: QueryClient, keys: string[][]): void {
  const now = Date.now();
  for (const key of keys) {
    const signature = JSON.stringify(key);
    const previous = _lastInvalidation.get(signature) ?? 0;
    if (now - previous < INVALIDATION_THROTTLE_MS) continue;
    _lastInvalidation.set(signature, now);
    void queryClient.invalidateQueries({ queryKey: key });
  }
}

function applyDefaultDelta(
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
      const index = items.findIndex((item) => String(item?.id) === recordId);

      if (event === 'INSERT') {
        if (index >= 0) {
          const next = [...items];
          next[index] = record;
          return { ...cached, items: next };
        }
        return { ...cached, items: [record, ...items] };
      }
      if (event === 'UPDATE') {
        if (index < 0) return cached;
        const next = [...items];
        next[index] = record;
        return { ...cached, items: next };
      }
      if (event === 'DELETE') {
        if (index < 0) return cached;
        return { ...cached, items: items.filter((_, i) => i !== index) };
      }
      return cached;
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
  const pausedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const generationRef = useRef(0);
  const instanceIdRef = useRef<string>(nextRealtimeInstanceId());
  const configsRef = useRef(configs);
  configsRef.current = configs;

  const [state, setState] = useState<RealtimeChannelState>({
    status: 'idle',
    reconnectAttempt: 0,
    lastEventAt: null,
    lastError: null,
  });

  const autoReconnect = options?.autoReconnect ?? true;
  const pauseOnBackground = options?.pauseOnBackground ?? true;
  const applyDeltas = options?.applyDeltas ?? true;
  const configSignature = buildRealtimeConfigSignature(configs);

  const cleanupChannels = useCallback(() => {
    const current = channelsRef.current;
    channelsRef.current = [];
    for (const channel of current) {
      try {
        // Do not await here. New subscriptions use a different generation topic,
        // so async unsubscribe cannot race with the next `.on(...).subscribe()`.
        void supabase.removeChannel(channel);
      } catch {}
    }
  }, []);

  const setupChannels = useCallback(() => {
    cleanupChannels();

    if (!isSupabaseConfigured()) {
      setState((previous) => ({ ...previous, status: 'not_configured' }));
      return;
    }

    const activeConfigs = configsRef.current;
    if (activeConfigs.length === 0) return;

    generationRef.current += 1;
    const generation = generationRef.current;
    const nextStatus: RealtimeStatus = reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting';
    setState((previous) => ({ ...previous, status: nextStatus }));

    for (const initialConfig of activeConfigs) {
      const runtimeChannelName = buildRealtimeRuntimeChannelName(
        initialConfig.channelName,
        instanceIdRef.current,
        generation,
      );

      const channel = supabase
        .channel(runtimeChannelName)
        .on(
          'postgres_changes' as any,
          {
            event: initialConfig.event ?? '*',
            schema: initialConfig.schema ?? 'public',
            table: initialConfig.table,
            ...(initialConfig.filter ? { filter: initialConfig.filter } : {}),
          },
          (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            if (!activeRef.current || pausedRef.current) return;

            const currentConfig = configsRef.current.find(
              (candidate) => candidate.channelName === initialConfig.channelName,
            ) ?? initialConfig;
            const eventType = (payload.eventType as RealtimeEvent) || '*';
            const record = (payload.new ?? payload.old) as Record<string, unknown> | undefined;

            setState((previous) => ({ ...previous, lastEventAt: Date.now(), lastError: null }));

            if (currentConfig.queryKeys?.length) {
              throttledInvalidate(queryClient, currentConfig.queryKeys);
              if (applyDeltas && record) {
                for (const key of currentConfig.queryKeys) {
                  applyDefaultDelta(queryClient, key, eventType, record);
                }
              }
            }

            if (currentConfig.onDelta && record) {
              try {
                currentConfig.onDelta(queryClient, eventType, record);
              } catch (error) {
                console.log('[useRealtimeChannel] onDelta error:', (error as Error)?.message);
              }
            }

            if (currentConfig.onPayload) {
              try {
                currentConfig.onPayload(payload);
              } catch (error) {
                console.log('[useRealtimeChannel] onPayload error:', (error as Error)?.message);
              }
            }
          },
        )
        .subscribe((status: string) => {
          if (!activeRef.current || generation !== generationRef.current) return;

          if (status === 'SUBSCRIBED') {
            reconnectAttemptRef.current = 0;
            setState((previous) => ({ ...previous, status: 'connected', reconnectAttempt: 0, lastError: null }));
            return;
          }

          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            setState((previous) => ({ ...previous, status: 'error', lastError: status }));
            if (autoReconnect && reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS) {
              const attempt = reconnectAttemptRef.current;
              reconnectAttemptRef.current = attempt + 1;
              const backoff = Math.min(BASE_BACKOFF_MS * Math.pow(2, attempt), MAX_BACKOFF_MS);
              if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
              reconnectTimerRef.current = setTimeout(() => {
                if (activeRef.current && !pausedRef.current) setupChannels();
              }, backoff);
              setState((previous) => ({
                ...previous,
                status: 'reconnecting',
                reconnectAttempt: reconnectAttemptRef.current,
              }));
            }
            return;
          }

          if (status === 'CLOSED') {
            setState((previous) => ({ ...previous, status: 'disconnected' }));
          }
        });

      channelsRef.current.push(channel);
    }
  }, [applyDeltas, autoReconnect, cleanupChannels, queryClient]);

  useEffect(() => {
    activeRef.current = true;
    pausedRef.current = false;
    setupChannels();

    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        pausedRef.current = false;
        if (pauseOnBackground && channelsRef.current.length === 0) setupChannels();
        return;
      }

      if (pauseOnBackground && (nextState === 'background' || nextState === 'inactive')) {
        pausedRef.current = true;
        cleanupChannels();
        setState((previous) => ({ ...previous, status: 'disconnected' }));
      }
    };

    const subscription = AppState.addEventListener('change', handleAppState);
    return () => {
      activeRef.current = false;
      subscription.remove();
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
      event: options?.event ?? '*',
      filter: options?.filter,
      queryKeys,
      onPayload: options?.onPayload,
      onDelta: options?.onDelta,
    },
  ]);
}

export default useRealtimeChannel;
