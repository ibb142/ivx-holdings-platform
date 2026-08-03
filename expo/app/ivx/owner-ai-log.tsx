import React, { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, StyleSheet, Text, View, type ListRenderItem } from "react-native";
import { Activity, AlertCircle, CheckCircle2, Clock, Database, Radio, Server, Zap } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  listOwnerAIDiagnosticEntries,
  type OwnerAIDiagnosticsEntry} from '@/src/modules/ivx-owner-ai/services/ivxOwnerAIDiagnosticsLogService';

const ICON_SIZE = 14 as const;

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function formatLatency(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function statusColor(entry: OwnerAIDiagnosticsEntry): string {
  if (entry.error || entry.frontendError) return Colors.danger ?? '#FF4D4D';
  if (entry.frontendRenderedAt && entry.providerLatencyMs != null) return '#10b981';
  if (entry.providerLatencyMs != null) return '#4A90D9';
  return Colors.subtitle ?? '#94a3b8';
}

type EntryRowProps = { entry: OwnerAIDiagnosticsEntry };

const EntryRow = React.memo<EntryRowProps>(({ entry }) => {
  const dot = statusColor(entry);
  return (
    <View style={styles.entry} testID={`owner-ai-log-entry-${entry.requestId}`}>
      <View style={styles.entryHeaderRow}>
        <View style={[styles.dot, { backgroundColor: dot }]} />
        <Text style={styles.entryRequestId} numberOfLines={1} ellipsizeMode="middle">{entry.requestId}</Text>
        <Text style={styles.entryTime}>{formatTimestamp(entry.createdAt)}</Text>
      </View>

      <View style={styles.row}>
        <Activity size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>Planner</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {entry.plannerRoute ?? '—'}{entry.plannerIntent ? ` · ${entry.plannerIntent}` : ''}{entry.plannerUseTools ? ' · tools' : ''}
        </Text>
      </View>

      <View style={styles.row}>
        <Server size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>Source</Text>
        <Text style={styles.rowValue} numberOfLines={1}>
          {entry.source ?? '—'}{entry.provider ? ` · ${entry.provider}` : ''}{entry.model ? ` · ${entry.model}` : ''}
        </Text>
      </View>

      <View style={styles.row}>
        <Zap size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>Provider latency</Text>
        <Text style={styles.rowValue}>{formatLatency(entry.providerLatencyMs)}</Text>
      </View>

      <View style={styles.row}>
        <Database size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>DB insert</Text>
        <Text style={styles.rowValue}>
          {entry.assistantPersisted == null ? '—' : entry.assistantPersisted ? 'ok' : 'failed'}
          {entry.assistantMessageId ? ` · ${entry.assistantMessageId.slice(0, 12)}…` : ''}
        </Text>
      </View>

      <View style={styles.row}>
        <Radio size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>Frontend</Text>
        <Text style={styles.rowValue} numberOfLines={2}>
          send={entry.frontendRequestStartedAt ? 'ok' : '—'} · resp={entry.frontendResponseReceivedAt ? 'ok' : '—'} · render={entry.frontendRenderedAt ? 'ok' : '—'} · realtime={entry.frontendRealtimeDeliveredAt ? 'ok' : '—'} · typing_cleared={entry.frontendTypingClearedAt ? 'ok' : '—'}
        </Text>
      </View>

      {(entry.error || entry.frontendError) ? (
        <View style={styles.row}>
          <AlertCircle size={ICON_SIZE} color={Colors.danger ?? '#FF4D4D'} />
          <Text style={styles.rowLabel}>Error</Text>
          <Text style={[styles.rowValue, styles.errorValue]} numberOfLines={3}>
            {entry.error ?? entry.frontendError}
          </Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <Clock size={ICON_SIZE} color={Colors.subtitle} />
        <Text style={styles.rowLabel}>Conversation</Text>
        <Text style={styles.rowValue} numberOfLines={1}>{entry.conversationId ?? '—'}</Text>
      </View>

      {entry.stages.length > 0 ? (
        <View style={styles.stagesBlock}>
          {entry.stages.slice(-6).map((stage, idx) => (
            <Text key={`${entry.requestId}-stage-${idx}`} style={styles.stageLine} numberOfLines={1}>
              <CheckCircle2 size={10} color={Colors.subtitle} />  {stage.stage} · {formatTimestamp(stage.at)}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
});
EntryRow.displayName = 'OwnerAILogEntryRow';

const KEY_EXTRACTOR = (entry: OwnerAIDiagnosticsEntry): string => entry.requestId;
const renderItem: ListRenderItem<OwnerAIDiagnosticsEntry> = ({ item }) => <EntryRow entry={item} />;

export default function OwnerAILogScreen() {
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const query = useQuery({
    queryKey: ['ivx', 'owner-ai', 'diagnostics-log'],
    queryFn: async () => listOwnerAIDiagnosticEntries({ limit: 50 }),
    refetchInterval: 5000,
    refetchOnWindowFocus: true});

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await query.refetch();
    } finally {
      setRefreshing(false);
    }
  }, [query]);

  const entries = useMemo<OwnerAIDiagnosticsEntry[]>(() => query.data?.entries ?? [], [query.data]);
  const errorMessage = query.data?.error ?? (query.error instanceof Error ? query.error.message : null);

  return (
    <ErrorBoundary>
      <View style={styles.root}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Owner AI Diagnostics Log</Text>
          <Text style={styles.headerSubtitle}>
            Last {entries.length} owner messages. Stages: planner → provider → DB → frontend render → realtime. Owner-only, no message bodies, no secrets.
          </Text>
        </View>
        {query.isLoading && entries.length === 0 ? (
          <View style={styles.center}><ShimmerIndicator color={Colors.tint ?? '#4A90D9'} /></View>
        ) : null}
        {errorMessage ? (
          <View style={styles.errorBanner}>
            <AlertCircle size={14} color={Colors.danger ?? '#FF4D4D'} />
            <Text style={styles.errorBannerText} numberOfLines={3}>{errorMessage}</Text>
          </View>
        ) : null}
        <FlatList
          data={entries}
          keyExtractor={KEY_EXTRACTOR}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.tint ?? '#4A90D9'} />}
          ListEmptyComponent={
            query.isLoading ? null : (
              <View style={styles.center}>
                <Text style={styles.emptyText}>No owner AI requests have been recorded yet.</Text>
              </View>
            )
          }
        />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8, gap: 4 },
  headerTitle: { color: Colors.text, fontSize: 18, fontWeight: '700' },
  headerSubtitle: { color: Colors.subtitle, fontSize: 12, lineHeight: 16 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 10 },
  entry: {
    backgroundColor: Colors.card ?? '#0f172a',
    borderRadius: 12,
    padding: 12,
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.border ?? 'rgba(148, 163, 184, 0.16)'},
  entryHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  entryRequestId: { color: Colors.text, fontFamily: 'Menlo', fontSize: 11, flex: 1 },
  entryTime: { color: Colors.subtitle, fontSize: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  rowLabel: { color: Colors.subtitle, fontSize: 11, width: 110 },
  rowValue: { color: Colors.text, fontSize: 11, flex: 1, lineHeight: 16 },
  errorValue: { color: Colors.danger ?? '#FF4D4D' },
  stagesBlock: { marginTop: 4, paddingTop: 6, borderTopWidth: 1, borderTopColor: 'rgba(148, 163, 184, 0.08)', gap: 2 },
  stageLine: { color: Colors.subtitle, fontSize: 10 },
  center: { alignItems: 'center', justifyContent: 'center', padding: 24 },
  emptyText: { color: Colors.subtitle, fontSize: 13, textAlign: 'center' },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 6, padding: 10, borderRadius: 10, backgroundColor: 'rgba(239, 68, 68, 0.12)' },
  errorBannerText: { color: Colors.danger ?? '#FF4D4D', fontSize: 12, flex: 1 }});
