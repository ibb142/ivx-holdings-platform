import { useEffect, useRef, useCallback, useState } from 'react';
import { useScreenActivity } from '@/hooks/useScreenActivity';
import { Platform, AppState, AppStateStatus } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { syncToLandingPage } from '@/lib/landing-sync';
import { resetSupabaseCheck } from '@/lib/jv-storage';
import { invalidateCanonicalCache } from '@/lib/canonical-deals';
import { runPublicationIntegrityCheck, processWriteQueue, walReplayUncommitted } from '@/lib/jv-persistence';

export type RealtimeStatus = 'live' | 'polling' | 'offline';

const JV_QUERY_KEY_PREFIX = 'jv-deals';
const PUBLISHED_QUERY_KEY = 'published-jv-deals';
const AGREEMENTS_QUERY_KEY = 'jv-agreements';
const BROADCAST_CHANNEL_NAME = 'jv-deals-cross-tab';

let _landingSyncTimeout: ReturnType<typeof setTimeout> | null = null;
let _lastLandingSyncTimestamp = 0;
const LANDING_SYNC_DEBOUNCE = 1000;

function triggerLandingSync(immediate: boolean = false) {
  const now = Date.now();
  if (now - _lastLandingSyncTimestamp < LANDING_SYNC_DEBOUNCE) {
    console.log('[JV-Realtime] Landing sync debounced, skipping');
    return;
  }
  if (_landingSyncTimeout) clearTimeout(_landingSyncTimeout);
  const delay = immediate ? 100 : 500;
  _landingSyncTimeout = setTimeout(async () => {
    _lastLandingSyncTimestamp = Date.now();
    try {
      const result = await syncToLandingPage();
      console.log('[JV-Realtime] Landing sync complete:', result.syncedDeals, 'deals synced, success:', result.success);
    } catch (err) {
      console.log('[JV-Realtime] Landing sync failed:', (err as Error)?.message);
    }
  }, delay);
}

let _broadcastChannel: globalThis.BroadcastChannel | null = null;
let _broadcastListenerCount = 0;
let _tableVerified = false;
let _tableVerifyTimestamp = 0;
const TABLE_VERIFY_TTL = 60000;



async function verifyTableExists(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    console.log('[JV-Realtime] Supabase not configured — skipping table verify');
    return false;
  }
  const now = Date.now();
  if (_tableVerified && (now - _tableVerifyTimestamp) < TABLE_VERIFY_TTL) return true;
  try {
    const { error } = await supabase.from('jv_deals').select('id').limit(1);
    if (error) {
      const msg = (error.message || '').toLowerCase();
      if (msg.includes('could not find the table') || msg.includes('schema cache') || msg.includes('not_configured')) {
        console.log('[JV-Realtime] jv_deals table NOT found — run supabase-full-setup.sql');
        _tableVerified = false;
        _tableVerifyTimestamp = now;
        return false;
      }
    }
    _tableVerified = true;
    _tableVerifyTimestamp = now;
    console.log('[JV-Realtime] jv_deals table verified in Supabase');
    return true;
  } catch (e) {
    console.log('[JV-Realtime] Table verify failed:', (e as Error)?.message);
    _tableVerifyTimestamp = now;
    return false;
  }
}

export function resetTableVerification(): void {
  _tableVerified = false;
  _tableVerifyTimestamp = 0;
}

function getBroadcastChannel(): globalThis.BroadcastChannel | null {
  if (Platform.OS !== 'web') return null;
  try {
    if (!_broadcastChannel || _broadcastChannel.onmessage === undefined) {
      _broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
      _broadcastListenerCount = 0;
      console.log('[JV-CrossTab] BroadcastChannel created for cross-tab sync');
    }
    return _broadcastChannel;
  } catch (e) {
    console.log('[JV-CrossTab] BroadcastChannel not supported:', (e as Error)?.message);
    return null;
  }
}

function notifyCrossTabs(action: string) {
  const bc = getBroadcastChannel();
  if (bc) {
    try {
      bc.postMessage({ type: 'jv-invalidate', action, timestamp: Date.now() });
      console.log(`[JV-CrossTab] Broadcast sent: ${action}`);
    } catch (e) {
      console.log('[JV-CrossTab] Broadcast send failed:', (e as Error)?.message);
      _broadcastChannel = null;
    }
  }
}

export function invalidateAllJVQueries(queryClient: ReturnType<typeof useQueryClient>, broadcastToOtherTabs: boolean = true) {
  console.log('[JV-Realtime] Invalidating JV query keys + forcing refetch');
  invalidateCanonicalCache();

  const allKeys = [
    ['jvAgreements.list'],
    [JV_QUERY_KEY_PREFIX],
    [PUBLISHED_QUERY_KEY],
    [AGREEMENTS_QUERY_KEY],
    ['jv-deals', 'published-list'],
    ['jv-deal'],
    ['properties'],
    ['properties', 'home'],
    ['properties', 'market'],
    ['entity-images'],
  ];

  for (const key of allKeys) {
    void queryClient.invalidateQueries({ queryKey: key, refetchType: 'all' });
  }

  void queryClient.invalidateQueries({
    predicate: (query) => {
      const key = query.queryKey;
      if (!Array.isArray(key)) return false;
      const first = String(key[0] ?? '');
      return first.includes('jv') || first.includes('published-jv') || first.includes('propert');
    },
    refetchType: 'all',
  });

  setTimeout(() => {
    invalidateCanonicalCache();
    void queryClient.refetchQueries({ queryKey: [PUBLISHED_QUERY_KEY], type: 'all' });
    void queryClient.refetchQueries({ queryKey: [JV_QUERY_KEY_PREFIX], type: 'all' });
    void queryClient.refetchQueries({ queryKey: ['jv-deals', 'published-list'], type: 'all' });
    void queryClient.refetchQueries({ queryKey: ['properties', 'home'], type: 'all' });
    void queryClient.refetchQueries({ queryKey: ['jvAgreements.list'], type: 'all' });
    console.log('[JV-Realtime] Forced refetch triggered for all JV queries after canonical cache reset');
  }, 100);

  triggerLandingSync();

  if (broadcastToOtherTabs) {
    notifyCrossTabs('invalidateAll');
  }
}

export function useJVRealtime(channelName: string = 'jv-deals-sync', enableFallbackPolling: boolean = true): { status: RealtimeStatus; lastEventAt: number } {
  const screenActive = useScreenActivity();
  const queryClient = useQueryClient();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const auditChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const broadcastAuditRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const fallbackIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const retryCountRef = useRef<number>(0);
  const realtimeConnectedRef = useRef<boolean>(false);
  const auditConnectedRef = useRef<boolean>(false);
  const destroyedRef = useRef<boolean>(false);
  const tableCheckDoneRef = useRef<boolean>(false);
  const maxRetries = 15;
  const [status, setStatus] = useState<RealtimeStatus>('offline');
  const [lastEventAt, setLastEventAt] = useState<number>(0);
  const FALLBACK_POLL_INTERVAL = 60000;
  const CONNECTED_POLL_INTERVAL = 120000;
  const _pollSyncRef = useRef<number>(0);

  useEffect(() => {
    destroyedRef.current = !screenActive;
    if (!screenActive) return;
    tableCheckDoneRef.current = false;

    async function connectChannel() {
      if (destroyedRef.current) return;

      if (!isSupabaseConfigured()) {
        console.log(`[JV-Realtime:${channelName}] Supabase not configured — using polling only, no realtime connection attempted`);
        setStatus('polling');
        resetFallbackPolling(FALLBACK_POLL_INTERVAL);
        return;
      }

      if (!tableCheckDoneRef.current) {
        const exists = await verifyTableExists();
        tableCheckDoneRef.current = true;
        if (!exists) {
          console.log(`[JV-Realtime:${channelName}] Table not found — fallback polling + re-check in 20s`);
          resetFallbackPolling(FALLBACK_POLL_INTERVAL);
          setTimeout(() => {
            if (!destroyedRef.current) {
              tableCheckDoneRef.current = false;
              void connectChannel();
            }
          }, 20000);
          return;
        }
      }

      try {
        if (channelRef.current) {
          try { void supabase.removeChannel(channelRef.current); } catch {}
          channelRef.current = null;
        }

        const channel = supabase
          .channel(channelName)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'jv_deals' }, (payload) => {
            const newRecord = payload.new as Record<string, unknown> | undefined;
            const oldRecord = payload.old as Record<string, unknown> | undefined;
            console.log(`[JV-Realtime:${channelName}] Change detected:`, payload.eventType, '| new:', newRecord?.id, '| old:', oldRecord?.id);
            retryCountRef.current = 0;
            setLastEventAt(Date.now());
            resetSupabaseCheck();
            invalidateAllJVQueries(queryClient);

            if (newRecord?.published === true || oldRecord?.published === true) {
              console.log(`[JV-Realtime:${channelName}] Published deal changed — triggering IMMEDIATE landing sync`);
              triggerLandingSync(true);
            }
          })
          .subscribe((subscriptionStatus) => {
            if (destroyedRef.current) return;
            console.log(`[JV-Realtime:${channelName}] Status:`, subscriptionStatus);
            if (subscriptionStatus === 'SUBSCRIBED') {
              realtimeConnectedRef.current = true;
              retryCountRef.current = 0;
              setStatus('live');
              console.log(`[JV-Realtime:${channelName}] Realtime connected — live events active`);
              resetFallbackPolling(CONNECTED_POLL_INTERVAL);
            } else if (subscriptionStatus === 'CHANNEL_ERROR' || subscriptionStatus === 'TIMED_OUT') {
              realtimeConnectedRef.current = false;
              setStatus('polling');
              console.log(`[JV-Realtime:${channelName}] Realtime failed (${subscriptionStatus}), retry ${retryCountRef.current}/${maxRetries}`);
              resetFallbackPolling(FALLBACK_POLL_INTERVAL);
              if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                const delay = Math.min(2000 * Math.pow(1.3, retryCountRef.current), 5000);
                console.log(`[JV-Realtime:${channelName}] Will retry realtime in ${Math.round(delay)}ms`);
                setTimeout(() => { if (!destroyedRef.current) void connectChannel(); }, delay);
              } else {
                console.log(`[JV-Realtime:${channelName}] Max retries reached — relying on fallback polling only`);
              }
            } else if (subscriptionStatus === 'CLOSED') {
              realtimeConnectedRef.current = false;
              setStatus('polling');
              console.log(`[JV-Realtime:${channelName}] Channel closed — restarting fallback polling`);
              resetFallbackPolling(FALLBACK_POLL_INTERVAL);
              if (retryCountRef.current < maxRetries) {
                retryCountRef.current++;
                setTimeout(() => { if (!destroyedRef.current) void connectChannel(); }, 5000);
              }
            }
          });

        channelRef.current = channel;

        connectAuditChannel();
      } catch (e) {
        console.log(`[JV-Realtime:${channelName}] Setup failed:`, (e as Error)?.message);
        resetFallbackPolling(FALLBACK_POLL_INTERVAL);
      }
    }

    function connectAuditChannel() {
      if (destroyedRef.current || !isSupabaseConfigured()) return;

      try {
        if (auditChannelRef.current) {
          try { void supabase.removeChannel(auditChannelRef.current); } catch {}
          auditChannelRef.current = null;
        }

        const auditChannel = supabase
          .channel('realtime-audit-listener')
          .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'realtime_audit' }, (payload) => {
            const row = payload.new as Record<string, unknown> | undefined;
            const auditTable = typeof row?.event_table === 'string' ? row.event_table : 'unknown';
            const auditType = typeof row?.event_type === 'string' ? row.event_type : 'unknown';
            console.log(`[JV-Audit] Audit row detected (postgres_changes): table=${auditTable} type=${auditType}`);
            handleAuditEvent(row);
          })
          .subscribe((auditStatus) => {
            if (destroyedRef.current) return;
            console.log(`[JV-Audit] postgres_changes audit channel status: ${auditStatus}`);
            if (auditStatus === 'SUBSCRIBED') {
              auditConnectedRef.current = true;
              console.log('[JV-Audit] postgres_changes audit channel connected');
            } else if (auditStatus === 'CHANNEL_ERROR' || auditStatus === 'TIMED_OUT') {
              auditConnectedRef.current = false;
              console.log(`[JV-Audit] postgres_changes audit channel failed (${auditStatus})`);
            } else if (auditStatus === 'CLOSED') {
              auditConnectedRef.current = false;
            }
          });

        auditChannelRef.current = auditChannel;
      } catch (e) {
        console.log('[JV-Audit] postgres_changes audit channel setup failed:', (e as Error)?.message);
      }

      try {
        if (broadcastAuditRef.current) {
          try { void supabase.removeChannel(broadcastAuditRef.current); } catch {}
          broadcastAuditRef.current = null;
        }

        const broadcastAudit = supabase
          .channel('realtime_audit:public', {
            config: { broadcast: { self: true }, private: true },
          })
          .on('broadcast', { event: 'INSERT' }, (payload) => {
            const row = (payload?.payload ?? payload) as Record<string, unknown> | undefined;
            const auditTable = typeof row?.event_table === 'string' ? row.event_table : 'unknown';
            const auditType = typeof row?.event_type === 'string' ? row.event_type : 'unknown';
            console.log(`[JV-Audit] Broadcast audit event: table=${auditTable} type=${auditType}`);
            handleAuditEvent(row);
          })
          .subscribe((bcastStatus) => {
            if (destroyedRef.current) return;
            console.log(`[JV-Audit] Broadcast audit channel status: ${bcastStatus}`);
            if (bcastStatus === 'SUBSCRIBED') {
              console.log('[JV-Audit] Broadcast audit channel connected — listening on realtime_audit:public');
            } else if (bcastStatus === 'CHANNEL_ERROR' || bcastStatus === 'TIMED_OUT') {
              console.log(`[JV-Audit] Broadcast audit channel failed (${bcastStatus})`);
            }
          });

        broadcastAuditRef.current = broadcastAudit;
      } catch (e) {
        console.log('[JV-Audit] Broadcast audit channel setup failed:', (e as Error)?.message);
      }
    }

    function handleAuditEvent(row: Record<string, unknown> | undefined) {
      if (!row) return;
      setLastEventAt(Date.now());

      if (row?.event_table === 'jv_deals') {
        console.log('[JV-Audit] jv_deals change via audit — invalidating queries');
        resetSupabaseCheck();
        invalidateAllJVQueries(queryClient);

        const dealPayload = row?.payload as Record<string, unknown> | undefined;
        if (dealPayload?.published === true) {
          console.log('[JV-Audit] Published deal changed via audit — triggering landing sync');
          triggerLandingSync();
        }
      }
    }

    function resetFallbackPolling(interval: number) {
      if (destroyedRef.current) return;
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      if (!enableFallbackPolling) return;
      fallbackIntervalRef.current = setInterval(() => {
        if (!destroyedRef.current) {
          _pollSyncRef.current++;
          if (_pollSyncRef.current % 2 === 0) {
            console.log(`[JV-Realtime:${channelName}] Poll tick #${_pollSyncRef.current} — soft invalidate (active queries only)`);
            void queryClient.invalidateQueries({ queryKey: [PUBLISHED_QUERY_KEY], refetchType: 'active' });
          }
          if (_pollSyncRef.current % 10 === 0) {
            console.log(`[JV-Realtime:${channelName}] Periodic landing sync (every 10th poll)`);
            triggerLandingSync();
          }
        }
      }, interval);
    }

    void connectChannel();

    if (enableFallbackPolling) {
      resetFallbackPolling(FALLBACK_POLL_INTERVAL);
    }

    const bc = getBroadcastChannel();
    const crossTabHandler = (event: MessageEvent) => {
      if (destroyedRef.current) return;
      if (event.data?.type === 'jv-invalidate') {
        console.log(`[JV-CrossTab:${channelName}] Received cross-tab invalidation: ${event.data.action}`);
        invalidateAllJVQueries(queryClient, false);
      }
    };
    if (bc) {
      bc.addEventListener('message', crossTabHandler);
      _broadcastListenerCount++;
      console.log(`[JV-CrossTab:${channelName}] Listening for cross-tab messages (listeners: ${_broadcastListenerCount})`);
    }

    let appStateSubscription: ReturnType<typeof AppState.addEventListener> | null = null;
    let visibilityHandler: (() => void) | null = null;

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      visibilityHandler = () => {
        if (!document.hidden && !destroyedRef.current) {
          console.log(`[JV-Realtime:${channelName}] Tab visible — force refetch + reconnect`);
          void queryClient.invalidateQueries({ queryKey: [PUBLISHED_QUERY_KEY], refetchType: 'active' });
          void queryClient.invalidateQueries({ queryKey: [JV_QUERY_KEY_PREFIX], refetchType: 'active' });
          if (!realtimeConnectedRef.current && retryCountRef.current < maxRetries) {
            retryCountRef.current = 0;
            tableCheckDoneRef.current = false;
            void connectChannel();
          }
        }
      };
      document.addEventListener('visibilitychange', visibilityHandler);
    } else {
      appStateSubscription = AppState.addEventListener('change', (state: AppStateStatus) => {
        if (state === 'active' && !destroyedRef.current) {
          console.log(`[JV-Realtime:${channelName}] App foregrounded — force refetch + reconnect`);
          invalidateAllJVQueries(queryClient, false);
          retryCountRef.current = 0;
          tableCheckDoneRef.current = false;
          if (!realtimeConnectedRef.current) {
            console.log(`[JV-Realtime:${channelName}] Realtime not connected — reconnecting channel`);
            void connectChannel();
          } else {
            console.log(`[JV-Realtime:${channelName}] Realtime still connected — force refetch only`);
            setTimeout(() => {
              if (!destroyedRef.current) {
                void queryClient.invalidateQueries({ queryKey: [PUBLISHED_QUERY_KEY], refetchType: 'active' });
              }
            }, 500);
          }
        }
      });
    }

    return () => {
      destroyedRef.current = true;
      if (bc) {
        bc.removeEventListener('message', crossTabHandler);
        _broadcastListenerCount--;
        if (_broadcastListenerCount <= 0) {
          try { bc.close(); } catch {}
          _broadcastChannel = null;
          _broadcastListenerCount = 0;
        }
      }
      if (channelRef.current) {
        void supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (auditChannelRef.current) {
        void supabase.removeChannel(auditChannelRef.current);
        auditChannelRef.current = null;
      }
      if (broadcastAuditRef.current) {
        void supabase.removeChannel(broadcastAuditRef.current);
        broadcastAuditRef.current = null;
      }
      if (fallbackIntervalRef.current) {
        clearInterval(fallbackIntervalRef.current);
        fallbackIntervalRef.current = null;
      }
      if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler);
      }
      if (appStateSubscription) {
        appStateSubscription.remove();
      }
    };
  }, [queryClient, channelName, enableFallbackPolling, screenActive]);

  return { status, lastEventAt };
}

export function useForceJVRefresh() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    console.log('[JV-Realtime] FORCE REFRESH — invalidating + refetching all JV queries (local cache PRESERVED)');
    resetTableVerification();
    resetSupabaseCheck();
    invalidateAllJVQueries(queryClient);
  }, [queryClient]);
}

export function usePublicationWatchdog(enabled: boolean = true): { lastCheck: number; isRunning: boolean } {
  const [lastCheck, setLastCheck] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const queryClient = useQueryClient();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const runningRef = useRef<boolean>(false);

  const runCheck = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setIsRunning(true);
    try {
      const walResult = await walReplayUncommitted();
      if (walResult.replayed > 0) {
        console.log('[Watchdog] WAL replayed', walResult.replayed, 'entries');
      }

      const queueResult = await processWriteQueue();
      if (queueResult.processed > 0) {
        console.log('[Watchdog] Write queue processed', queueResult.processed, 'items');
      }

      const report = await runPublicationIntegrityCheck();
      setLastCheck(Date.now());

      if (report.restored > 0 || report.missing > 0) {
        console.log('[Watchdog] Integrity issues found — restored:', report.restored, '| missing:', report.missing, '— invalidating queries');
        invalidateAllJVQueries(queryClient, true);
      }
    } catch (err) {
      console.log('[Watchdog] Check failed:', (err as Error)?.message);
    } finally {
      runningRef.current = false;
      setIsRunning(false);
    }
  }, [queryClient]);

  useEffect(() => {
    if (!enabled) return;

    const initialDelay = setTimeout(() => {
      void runCheck();
    }, 3000);

    intervalRef.current = setInterval(() => {
      void runCheck();
    }, 90_000);

    return () => {
      clearTimeout(initialDelay);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, runCheck]);

  return { lastCheck, isRunning };
}
