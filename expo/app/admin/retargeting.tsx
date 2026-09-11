import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowLeft, RefreshCw } from 'lucide-react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { useAuth } from '@/lib/auth-context';
import { supabase } from '@/lib/supabase';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { useScreenActivity } from '@/hooks/useScreenActivity';
import { readLiveTelemetry } from '@/lib/live-telemetry-request';
import { parseRetargetingRecords, retargetingValue, type RetargetingRecord } from '@/lib/retargeting-records';

type Field = readonly [key: string, label: string];
type RecordSource = {
  label: string;
  table: string;
  order: string;
  title: string;
  fields: readonly Field[];
};

const SOURCES: readonly RecordSource[] = [
  { label: 'Campaigns', table: 'retargeting_dashboard', order: 'recorded_at', title: 'campaign_id',
    fields: [['impressions', 'Impressions'], ['clicks', 'Clicks'], ['conversions', 'Conversions'], ['spend', 'Spend'], ['recorded_at', 'Recorded']] },
  { label: 'Audiences', table: 'audience_segments', order: 'created_at', title: 'name',
    fields: [['description', 'Description'], ['user_count', 'Users'], ['status', 'Status'], ['updated_at', 'Updated']] },
  { label: 'Pixels', table: 'ad_pixels', order: 'created_at', title: 'platform',
    fields: [['pixel_id', 'Pixel ID'], ['status', 'Status'], ['created_at', 'Created']] },
  { label: 'SEO', table: 'search_discovery', order: 'created_at', title: 'query',
    fields: [['results_count', 'Search results'], ['clicked_item', 'Clicked item'], ['created_at', 'Recorded']] },
  { label: 'Triggers', table: 're_engagement_triggers', order: 'created_at', title: 'trigger_type',
    fields: [['channel', 'Channel'], ['status', 'Status'], ['sent_at', 'Sent'], ['created_at', 'Created']] },
  { label: 'UTM', table: 'utm_analytics', order: 'recorded_at', title: 'utm_source',
    fields: [['utm_medium', 'Medium'], ['utm_campaign', 'Campaign'], ['visitor_count', 'Visitors'], ['conversion_count', 'Conversions'], ['recorded_at', 'Recorded']] },
];
const SCORING: RecordSource = {
  label: 'Engagement scoring', table: 'engagement_scoring', order: 'calculated_at', title: 'tier',
  fields: [['score', 'Score'], ['calculated_at', 'Calculated']],
};

async function fetchRecords(source: RecordSource, signal: AbortSignal): Promise<RetargetingRecord[]> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (signal.aborted) abort();
  signal.addEventListener('abort', abort, { once: true });
  try {
    return await readLiveTelemetry(async requestSignal => {
      const { data, error } = await supabase.from(source.table).select('*')
        .order(source.order, { ascending: false }).limit(50).abortSignal(requestSignal);
      if (error) throw error;
      return parseRetargetingRecords(data);
    }, controller);
  } finally {
    signal.removeEventListener('abort', abort);
  }
}

function Records({ source, rows }: { source: RecordSource; rows: RetargetingRecord[] }) {
  if (rows.length === 0) return <Text style={styles.message}>No records yet.</Text>;
  return <>
    <Text style={styles.caption}>Latest {rows.length} records · up to 50 shown</Text>
    {rows.map((row, index) => <View key={typeof row.id === 'string' ? row.id : index} style={styles.card}>
      <Text style={styles.cardTitle}>{retargetingValue(row[source.title])}</Text>
      {source.fields.map(([key, label]) => <View key={key} style={styles.field}>
        <Text style={styles.fieldLabel}>{label}</Text>
        <Text style={styles.fieldValue} selectable>{retargetingValue(row[key])}</Text>
      </View>)}
    </View>)}
  </>;
}

export default function RetargetingDashboard() {
  const router = useRouter();
  const { isAuthenticated } = useAuth();
  const screenActive = useScreenActivity();
  const [tab, setTab] = useState(0);
  const source = SOURCES[tab];
  const enabled = isAuthenticated && screenActive;
  const records = useQuery({
    queryKey: ['retargeting-rows', source.table],
    queryFn: ({ signal }) => fetchRecords(source, signal),
    enabled,
    staleTime: 30_000,
    retry: 1,
  });
  const scoring = useQuery({
    queryKey: ['retargeting-rows', SCORING.table],
    queryFn: ({ signal }) => fetchRecords(SCORING, signal),
    enabled: enabled && tab === 1,
    staleTime: 30_000,
    retry: 1,
  });
  useRealtimeTable(source.table, [['retargeting-rows', source.table]]);
  const refresh = () => {
    void records.refetch();
    if (tab === 1) void scoring.refetch();
  };
  const refreshing = records.isRefetching || (tab === 1 && scoring.isRefetching);

  return <SafeAreaView style={styles.root} edges={['top']}>
    <View style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.button} accessibilityLabel="Back">
        <ArrowLeft size={22} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.title}>Retargeting</Text>
      <TouchableOpacity onPress={refresh} style={styles.button} accessibilityLabel="Refresh records">
        <RefreshCw size={20} color={Colors.primary} />
      </TouchableOpacity>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={styles.tabRow}>
      {SOURCES.map((item, index) => <TouchableOpacity key={item.table} onPress={() => setTab(index)}
        style={[styles.tab, tab === index && styles.selectedTab]} accessibilityRole="tab" accessibilityState={{ selected: tab === index }}>
        <Text style={[styles.tabText, tab === index && styles.selectedText]}>{item.label}</Text>
      </TouchableOpacity>)}
    </ScrollView>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={Colors.primary} />}>
      {records.isPending ? <View style={styles.loading}><ShimmerIndicator /><Text style={styles.message}>Loading records…</Text></View>
        : records.isError ? <View style={styles.card}><Text style={styles.message}>Could not load records.</Text>
          <TouchableOpacity onPress={refresh} style={styles.retry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity></View>
          : <Records source={source} rows={records.data} />}
      {tab === 1 && <View>
        <Text style={styles.sectionTitle}>Engagement scoring</Text>
        {scoring.isPending ? <Text style={styles.message}>Loading scores…</Text>
          : scoring.isError ? <Text style={styles.message}>Could not load scores. Pull down to retry.</Text>
            : <Records source={SCORING} rows={scoring.data} />}
      </View>}
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 12, borderBottomWidth: 1, borderBottomColor: Colors.border },
  button: { padding: 10, borderRadius: 12, backgroundColor: Colors.surface },
  title: { flex: 1, fontSize: 20, fontWeight: '800', color: Colors.text },
  tabs: { flexGrow: 0, maxHeight: 60 },
  tabRow: { padding: 12, gap: 8 },
  tab: { borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: Colors.surface },
  selectedTab: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '700' },
  selectedText: { color: '#000' },
  content: { padding: 16, paddingBottom: 80, gap: 12 },
  caption: { color: Colors.textTertiary, fontSize: 12, marginBottom: 8 },
  card: { backgroundColor: Colors.surface, borderColor: Colors.border, borderWidth: 1, borderRadius: 16, padding: 16, marginBottom: 12 },
  cardTitle: { color: Colors.primary, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  field: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 6 },
  fieldLabel: { flex: 1, color: Colors.textTertiary, fontSize: 12 },
  fieldValue: { flex: 2, color: Colors.text, textAlign: 'right', fontSize: 12 },
  message: { color: Colors.textSecondary, textAlign: 'center', paddingVertical: 16 },
  loading: { alignItems: 'center', padding: 24 },
  retry: { alignSelf: 'center', padding: 12 },
  retryText: { color: Colors.primary, fontWeight: '700' },
  sectionTitle: { color: Colors.text, fontSize: 18, fontWeight: '700', marginVertical: 16 },
});
