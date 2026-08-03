/**
 * IVX Advanced Execution Mode
 *
 * Owner-only panel that visibly proves the IVX Senior Developer AI is
 * actually working: live file activity, tool stream, reasoning timeline,
 * patch/test/evidence cards, watchdog timeline, thinking workflow, and a
 * repo-wide activity console.
 *
 * Data source: `GET /api/ivx/senior-dev/execution-stream` (unified
 * snapshot of the in-memory execution ring + repair jobs + open
 * incidents). Polls every 3s with `sinceSeq` long-poll style.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from '@tanstack/react-query';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

// Module-level singleton guard — prevents duplicate mounts across fast-refresh,
// nested routes, or accidental double mounts. Only the first mount renders;
// duplicates render null + log once.
let ADV_EXEC_INSTANCE_COUNT = 0;
const POLL_INTERVAL_MS = 3_000;
const POLL_STALE_MS = 1_500;

type EventCategory =
  | 'file_activity'
  | 'tool_call'
  | 'reasoning'
  | 'patch_event'
  | 'test_event'
  | 'watchdog_event'
  | 'thinking'
  | 'repo_activity'
  | 'evidence_card';

type ExecutionEvent = {
  seq: number;
  at: string;
  category: EventCategory;
  label: string;
  fileLine?: string;
  symbol?: string;
  status?: 'pending' | 'running' | 'pass' | 'fail' | 'info' | 'blocked';
  confidence?: number;
  progressPct?: number;
  durationMs?: number;
  meta?: Record<string, string | number | boolean | null>;
};

type RepairJobRow = {
  id: string;
  incidentId: string;
  stage: string;
  classification: 'low' | 'medium' | 'high' | null;
  stepsTail: { stage: string; ok: boolean; at: string; note: string }[];
  proposalArtifactPath: string | null;
  error: string | null;
  updatedAt: string;
};

type OpenIncidentRow = { id: string; severity: string; status: string; checkpoint: string; fileLine: string | null; createdAt: string };

type ExecutionSnapshot = {
  ok: boolean;
  generatedAt: string;
  latestSeq: number;
  events: ExecutionEvent[];
  currentTask: { label: string; subtask?: string; progressPct?: number; status?: string; confidence?: number; at: string } | null;
  counts: Record<EventCategory, number>;
  repairJobs: RepairJobRow[];
  openIncidents: OpenIncidentRow[];
};

type TabId = 'live' | 'files' | 'tools' | 'patches' | 'tests' | 'evidence' | 'watchdog' | 'repo' | 'thinking';

const TABS: { id: TabId; label: string }[] = [
  { id: 'live', label: 'Live' },
  { id: 'files', label: 'Files' },
  { id: 'tools', label: 'Tools' },
  { id: 'patches', label: 'Patches' },
  { id: 'tests', label: 'Tests' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'watchdog', label: 'Watchdog' },
  { id: 'repo', label: 'Repo' },
  { id: 'thinking', label: 'Thinking' },
];

function getBaseUrl(): string {
  const base = process.env.EXPO_PUBLIC_IVX_API_BASE_URL ?? process.env.EXPO_PUBLIC_API_BASE_URL ?? '';
  return base.replace(/\/+$/, '');
}

async function fetchSnapshot(): Promise<ExecutionSnapshot | null> {
  const base = getBaseUrl();
  if (!base) return null;
  const token = await getIVXAccessToken().catch(() => null);
  if (!token) return null;
  const response = await fetch(`${base}/api/ivx/senior-dev/execution-stream?limit=160`, {
    method: 'GET',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }});
  if (!response.ok) return null;
  return (await response.json().catch(() => null)) as ExecutionSnapshot | null;
}

export function IVXAdvancedExecutionMode(): React.ReactElement | null {
  const [activeTab, setActiveTab] = useState<TabId>('live');
  const [isPrimary, setIsPrimary] = useState<boolean>(false);
  const [appActive, setAppActive] = useState<boolean>(
    (AppState.currentState ?? 'active') === 'active',
  );
  const mountedRef = useRef<boolean>(true);

  // Singleton enforcement — runs once per mount.
  useEffect(() => {
    mountedRef.current = true;
    ADV_EXEC_INSTANCE_COUNT += 1;
    const primary = ADV_EXEC_INSTANCE_COUNT === 1;
    setIsPrimary(primary);
    if (!primary) {
      console.log('[IVX_ADV_EXEC] DUPLICATE_MOUNT_SUPPRESSED', { totalInstances: ADV_EXEC_INSTANCE_COUNT });
    }
    return () => {
      mountedRef.current = false;
      ADV_EXEC_INSTANCE_COUNT = Math.max(0, ADV_EXEC_INSTANCE_COUNT - 1);
    };
  }, []);

  // AppState-aware polling — pause when backgrounded/inactive, resume on foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (!mountedRef.current) return;
      setAppActive(next === 'active');
    });
    return () => {
      sub.remove();
    };
  }, []);

  const pollingEnabled = isPrimary && appActive;
  const query = useQuery<ExecutionSnapshot | null>({
    queryKey: ['ivx-senior-dev', 'execution-stream'],
    queryFn: fetchSnapshot,
    refetchInterval: pollingEnabled ? POLL_INTERVAL_MS : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: pollingEnabled,
    refetchOnReconnect: pollingEnabled,
    staleTime: POLL_STALE_MS,
    enabled: isPrimary});

  const onRefresh = useCallback(() => {
    void query.refetch();
  }, [query]);

  const data = query.data ?? null;
  const events = useMemo(() => (data?.events ?? []).slice().reverse(), [data?.events]);

  // Render nothing for duplicate mounts AFTER all hooks (stable hook order).
  if (!isPrimary) return null;

  if (query.isLoading && !data) {
    return (
      <View style={styles.loading} testID="ivx-advanced-exec-loading">
        <ShimmerIndicator color="#1f6feb" />
        <Text style={styles.muted}>Connecting to execution stream…</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="ivx-advanced-exec-mode">
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Advanced Execution Mode</Text>
          <Text style={styles.muted}>{data ? `seq #${data.latestSeq} · updated ${formatTime(data.generatedAt)}` : 'No data yet'}</Text>
        </View>
        <Pressable onPress={onRefresh} style={styles.refreshBtn} testID="ivx-advanced-exec-refresh">
          <Text style={styles.refreshLabel}>Refresh</Text>
        </Pressable>
      </View>

      <CurrentTaskBanner task={data?.currentTask ?? null} />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow} style={styles.tabsScroll}>
        {TABS.map((t) => {
          const count = t.id === 'live' ? events.length
            : t.id === 'files' ? (data?.counts.file_activity ?? 0)
            : t.id === 'tools' ? (data?.counts.tool_call ?? 0) + (data?.counts.file_activity ?? 0) + (data?.counts.repo_activity ?? 0)
            : t.id === 'patches' ? (data?.counts.patch_event ?? 0)
            : t.id === 'tests' ? (data?.counts.test_event ?? 0)
            : t.id === 'evidence' ? (data?.counts.evidence_card ?? 0)
            : t.id === 'watchdog' ? (data?.openIncidents.length ?? 0)
            : t.id === 'repo' ? (data?.counts.repo_activity ?? 0)
            : (data?.counts.thinking ?? 0) + (data?.counts.reasoning ?? 0);
          const isActive = activeTab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setActiveTab(t.id)}
              style={[styles.tabBtn, isActive ? styles.tabBtnActive : null]}
              testID={`ivx-advanced-exec-tab-${t.id}`}
            >
              <Text style={[styles.tabLabel, isActive ? styles.tabLabelActive : null]}>{t.label}</Text>
              <View style={[styles.tabBadge, isActive ? styles.tabBadgeActive : null]}>
                <Text style={[styles.tabBadgeText, isActive ? styles.tabBadgeTextActive : null]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
        {activeTab === 'live' ? <LiveFeed events={events} /> : null}
        {activeTab === 'files' ? <CategoryFeed events={events.filter((e) => e.category === 'file_activity')} emptyLabel="No file reads yet." /> : null}
        {activeTab === 'tools' ? <CategoryFeed events={events.filter((e) => e.category === 'tool_call' || e.category === 'file_activity' || e.category === 'repo_activity' || e.category === 'test_event' || e.category === 'patch_event')} emptyLabel="No tool calls yet." /> : null}
        {activeTab === 'patches' ? <PatchFeed events={events.filter((e) => e.category === 'patch_event')} jobs={data?.repairJobs ?? []} /> : null}
        {activeTab === 'tests' ? <CategoryFeed events={events.filter((e) => e.category === 'test_event')} emptyLabel="No test runs yet." /> : null}
        {activeTab === 'evidence' ? <EvidenceFeed events={events.filter((e) => e.category === 'evidence_card' || (e.fileLine && (e.category === 'file_activity' || e.category === 'patch_event')))} /> : null}
        {activeTab === 'watchdog' ? <WatchdogTimeline incidents={data?.openIncidents ?? []} jobs={data?.repairJobs ?? []} /> : null}
        {activeTab === 'repo' ? <CategoryFeed events={events.filter((e) => e.category === 'repo_activity')} emptyLabel="No repo-wide ops yet." /> : null}
        {activeTab === 'thinking' ? <CategoryFeed events={events.filter((e) => e.category === 'thinking' || e.category === 'reasoning')} emptyLabel="No reasoning steps yet." /> : null}
      </ScrollView>
    </View>
  );
}

function CurrentTaskBanner({ task }: { task: ExecutionSnapshot['currentTask'] }): React.ReactElement {
  if (!task) {
    return (
      <View style={styles.taskBanner} testID="ivx-advanced-exec-current-task-empty">
        <Text style={styles.taskLabel}>Idle</Text>
        <Text style={styles.muted}>Waiting for the next senior-dev work item.</Text>
      </View>
    );
  }
  const pct = typeof task.progressPct === 'number' ? task.progressPct : null;
  return (
    <View style={styles.taskBanner} testID="ivx-advanced-exec-current-task">
      <View style={styles.taskHeaderRow}>
        <Text style={styles.taskLabel} numberOfLines={2}>{task.label}</Text>
        <StatusPill status={task.status as ExecutionEvent['status']} />
      </View>
      {task.subtask ? <Text style={styles.muted} numberOfLines={2}>{task.subtask}</Text> : null}
      {pct !== null ? (
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      ) : null}
      <View style={styles.taskMetaRow}>
        {typeof task.confidence === 'number' ? <Text style={styles.muted}>confidence {Math.round(task.confidence * 100)}%</Text> : null}
        <Text style={styles.muted}>{formatTime(task.at)}</Text>
      </View>
    </View>
  );
}

function LiveFeed({ events }: { events: ExecutionEvent[] }): React.ReactElement {
  if (events.length === 0) return <Text style={styles.muted}>No execution events yet — fire a senior-dev tool to populate the stream.</Text>;
  return (
    <View>
      {events.map((e) => (
        <EventCard key={`${e.seq}`} event={e} />
      ))}
    </View>
  );
}

function CategoryFeed({ events, emptyLabel }: { events: ExecutionEvent[]; emptyLabel: string }): React.ReactElement {
  if (events.length === 0) return <Text style={styles.muted}>{emptyLabel}</Text>;
  return <View>{events.map((e) => <EventCard key={`${e.seq}`} event={e} />)}</View>;
}

function PatchFeed({ events, jobs }: { events: ExecutionEvent[]; jobs: RepairJobRow[] }): React.ReactElement {
  return (
    <View>
      <Text style={styles.sectionHeader}>Patch events</Text>
      {events.length === 0 ? <Text style={styles.muted}>No patch events yet.</Text> : events.map((e) => <EventCard key={`${e.seq}`} event={e} />)}
      <Text style={[styles.sectionHeader, { marginTop: 14 }]}>Repair jobs</Text>
      {jobs.length === 0 ? <Text style={styles.muted}>No repair jobs in this session.</Text> : jobs.map((job) => (
        <View key={job.id} style={styles.card} testID={`ivx-advanced-exec-repair-${job.id}`}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>{job.id} · {job.stage}</Text>
            <Text style={styles.muted}>{job.classification ?? 'unclassified'}</Text>
          </View>
          <Text style={styles.muted}>incident {job.incidentId} · {formatTime(job.updatedAt)}</Text>
          {job.stepsTail.slice().reverse().map((s, i) => (
            <Text key={`${job.id}-${i}`} style={styles.row}>• <Text style={statusColorFor(s.ok ? 'pass' : 'fail')}>{s.stage}</Text>  <Text style={styles.muted}>{s.note}</Text></Text>
          ))}
          {job.proposalArtifactPath ? <Text style={styles.muted}>proposal: {job.proposalArtifactPath}</Text> : null}
          {job.error ? <Text style={styles.errorText}>error: {job.error}</Text> : null}
        </View>
      ))}
    </View>
  );
}

function EvidenceFeed({ events }: { events: ExecutionEvent[] }): React.ReactElement {
  if (events.length === 0) return <Text style={styles.muted}>No evidence cards yet — ask a question that triggers proof mode.</Text>;
  return (
    <View>
      {events.map((e) => (
        <View key={`${e.seq}`} style={styles.evidenceCard} testID={`ivx-advanced-exec-evidence-${e.seq}`}>
          <Text style={styles.cardTitle} numberOfLines={2}>{e.label}</Text>
          {e.fileLine ? <Text style={styles.evidenceRow}>file: <Text style={styles.code}>{e.fileLine}</Text></Text> : null}
          {e.symbol ? <Text style={styles.evidenceRow}>symbol: <Text style={styles.code}>{e.symbol}</Text></Text> : null}
          {e.meta?.source ? <Text style={styles.evidenceRow}>source: {String(e.meta.source)}</Text> : null}
          {e.meta?.verifiedBy ? <Text style={styles.evidenceRow}>verified by: {String(e.meta.verifiedBy)}</Text> : null}
          <Text style={styles.muted}>{formatTime(e.at)}</Text>
        </View>
      ))}
    </View>
  );
}

function WatchdogTimeline({ incidents, jobs }: { incidents: OpenIncidentRow[]; jobs: RepairJobRow[] }): React.ReactElement {
  return (
    <View>
      <Text style={styles.sectionHeader}>Open incidents</Text>
      {incidents.length === 0 ? <Text style={styles.muted}>No open incidents.</Text> : incidents.map((i) => (
        <View key={i.id} style={styles.card} testID={`ivx-advanced-exec-incident-${i.id}`}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle} numberOfLines={1}>[{i.severity}] {i.checkpoint}</Text>
            <StatusPill status={i.status === 'open' ? 'fail' : 'pending'} />
          </View>
          {i.fileLine ? <Text style={styles.evidenceRow}>at <Text style={styles.code}>{i.fileLine}</Text></Text> : null}
          <Text style={styles.muted}>{i.id} · {formatTime(i.createdAt)}</Text>
        </View>
      ))}
      <Text style={[styles.sectionHeader, { marginTop: 14 }]}>Repair checkpoints</Text>
      {jobs.length === 0 ? <Text style={styles.muted}>No active repair pipeline.</Text> : jobs.map((job) => (
        <View key={`wd-${job.id}`} style={styles.card}>
          <Text style={styles.cardTitle} numberOfLines={1}>{job.id} · {job.stage}</Text>
          {job.stepsTail.map((s, i) => (
            <Text key={`wd-${job.id}-${i}`} style={styles.row}>{s.ok ? '✓' : '×'} <Text style={statusColorFor(s.ok ? 'pass' : 'fail')}>{s.stage}</Text>  <Text style={styles.muted}>{formatTime(s.at)}</Text></Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function EventCard({ event }: { event: ExecutionEvent }): React.ReactElement {
  return (
    <View style={styles.eventRow} testID={`ivx-advanced-exec-event-${event.seq}`}>
      <View style={styles.eventBullet}>
        <Text style={[styles.eventBulletText, statusColorFor(event.status)]}>{categoryGlyph(event.category)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.eventHeaderRow}>
          <Text style={styles.eventLabel} numberOfLines={2}>{event.label}</Text>
          <StatusPill status={event.status} />
        </View>
        {event.fileLine ? <Text style={styles.evidenceRow}><Text style={styles.code}>{event.fileLine}</Text>{event.symbol ? ` · ${event.symbol}` : ''}</Text> : event.symbol ? <Text style={styles.evidenceRow}>{event.symbol}</Text> : null}
        <View style={styles.eventMetaRow}>
          <Text style={styles.muted}>{categoryLabel(event.category)}</Text>
          {typeof event.durationMs === 'number' ? <Text style={styles.muted}>{event.durationMs}ms</Text> : null}
          {typeof event.progressPct === 'number' ? <Text style={styles.muted}>{event.progressPct}%</Text> : null}
          <Text style={styles.muted}>{formatTime(event.at)}</Text>
        </View>
      </View>
    </View>
  );
}

function StatusPill({ status }: { status?: ExecutionEvent['status'] | string }): React.ReactElement | null {
  if (!status) return null;
  const tone = status === 'pass' ? styles.pillPass : status === 'fail' ? styles.pillFail : status === 'running' ? styles.pillRunning : status === 'blocked' ? styles.pillBlocked : styles.pillInfo;
  return (
    <View style={[styles.pill, tone]}>
      <Text style={styles.pillText}>{status}</Text>
    </View>
  );
}

function categoryGlyph(c: EventCategory): string {
  switch (c) {
    case 'file_activity': return '◧';
    case 'tool_call': return '⚙';
    case 'reasoning': return '◇';
    case 'patch_event': return '✚';
    case 'test_event': return '✓';
    case 'watchdog_event': return '◉';
    case 'thinking': return '∿';
    case 'repo_activity': return '∷';
    case 'evidence_card': return '☑';
    default: return '·';
  }
}

function categoryLabel(c: EventCategory): string {
  return c.replace(/_/g, ' ');
}

function statusColorFor(status?: ExecutionEvent['status']) {
  if (status === 'pass') return styles.statusPass;
  if (status === 'fail') return styles.statusFail;
  if (status === 'running') return styles.statusRunning;
  if (status === 'blocked') return styles.statusBlocked;
  return styles.statusInfo;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${hh}:${mm}:${ss}`;
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0d12' },
  loading: { padding: 24, alignItems: 'center' as const, gap: 8 },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 },
  title: { color: '#f5f7fa', fontSize: 16, fontWeight: '700' as const },
  muted: { color: '#7a8499', fontSize: 11 },
  refreshBtn: { backgroundColor: '#1f6feb', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  refreshLabel: { color: '#fff', fontWeight: '600' as const, fontSize: 12 },
  taskBanner: { marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: 12, backgroundColor: '#141823', borderWidth: 1, borderColor: '#1f2535', gap: 6 },
  taskHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  taskLabel: { color: '#f5f7fa', fontSize: 14, fontWeight: '600' as const, flex: 1 },
  taskMetaRow: { flexDirection: 'row' as const, gap: 12 },
  progressTrack: { height: 4, backgroundColor: '#1f2535', borderRadius: 999, overflow: 'hidden' as const },
  progressFill: { height: 4, backgroundColor: '#1f6feb' },
  tabsScroll: { flexGrow: 0, maxHeight: 44 },
  tabsRow: { paddingHorizontal: 12, gap: 6, alignItems: 'center' as const, paddingVertical: 6 },
  tabBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#1f2535', flexDirection: 'row' as const, alignItems: 'center' as const, gap: 6 },
  tabBtnActive: { backgroundColor: '#1f6feb', borderColor: '#1f6feb' },
  tabLabel: { color: '#a4adc2', fontSize: 12, fontWeight: '600' as const },
  tabLabelActive: { color: '#fff' },
  tabBadge: { backgroundColor: '#1f2535', borderRadius: 999, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' as const },
  tabBadgeActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  tabBadgeText: { color: '#a4adc2', fontSize: 10, fontWeight: '600' as const },
  tabBadgeTextActive: { color: '#fff' },
  body: { flex: 1 },
  bodyContent: { padding: 16, gap: 6, paddingBottom: 80 },
  sectionHeader: { color: '#f5f7fa', fontSize: 13, fontWeight: '700' as const, marginBottom: 6 },
  eventRow: { flexDirection: 'row' as const, gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#161a26' },
  eventBullet: { width: 22, alignItems: 'center' as const, paddingTop: 2 },
  eventBulletText: { fontSize: 14, fontWeight: '700' as const },
  eventHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  eventLabel: { color: '#e6e9f2', fontSize: 13, fontWeight: '600' as const, flex: 1 },
  eventMetaRow: { flexDirection: 'row' as const, gap: 10, marginTop: 4, flexWrap: 'wrap' as const },
  evidenceRow: { color: '#cdd3e0', fontSize: 11, marginTop: 2 },
  code: { fontFamily: 'Menlo', color: '#9ecbff' },
  row: { color: '#cdd3e0', fontSize: 12, paddingVertical: 1 },
  card: { padding: 10, borderRadius: 10, backgroundColor: '#141823', borderWidth: 1, borderColor: '#1f2535', marginBottom: 8, gap: 4 },
  cardHeaderRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8 },
  cardTitle: { color: '#f5f7fa', fontSize: 13, fontWeight: '600' as const, flex: 1 },
  evidenceCard: { padding: 12, borderRadius: 10, backgroundColor: '#0f1622', borderWidth: 1, borderColor: '#1c3057', marginBottom: 8, gap: 4 },
  errorText: { color: '#ff7a90', fontSize: 12 },
  pill: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  pillText: { color: '#fff', fontSize: 10, fontWeight: '700' as const, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  pillPass: { backgroundColor: '#1a7f3a' },
  pillFail: { backgroundColor: '#a8323e' },
  pillRunning: { backgroundColor: '#1f6feb' },
  pillInfo: { backgroundColor: '#3b4257' },
  pillBlocked: { backgroundColor: '#9a7a00' },
  statusPass: { color: '#5cd17a' },
  statusFail: { color: '#ff7a90' },
  statusRunning: { color: '#7fb6ff' },
  statusBlocked: { color: '#f0c060' },
  statusInfo: { color: '#a4adc2' }});

export default IVXAdvancedExecutionMode;
