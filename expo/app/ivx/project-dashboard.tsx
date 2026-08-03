import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Stack } from 'expo-router';
import { Activity, AlertTriangle, CheckCircle2, Clock3, LayoutDashboard, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FeatureAreaStatus = 'live' | 'in_progress' | 'planned';

type FeatureArea = {
  id: string;
  name: string;
  status: FeatureAreaStatus;
  openItems: number;
  completedItems: number;
};

type DashboardMetrics = {
  totalFeatureAreas: number;
  liveFeatureAreas: number;
  inProgressFeatureAreas: number;
  plannedFeatureAreas: number;
  openItems: number;
  completedItems: number;
  completionPercent: number;
};

type DashboardPayload = {
  ok?: boolean;
  feature?: string;
  generatedAt?: string;
  window?: string;
  view?: string;
  metrics?: DashboardMetrics;
  featureAreas?: FeatureArea[];
};

type LoadState = {
  loading: boolean;
  error: string | null;
  httpStatus: number | null;
  payload: DashboardPayload | null;
  fetchedAt: string | null;
};

function resolveApiBaseUrl(): string {
  const base =
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL ??
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    'https://api.ivxholding.com';
  return base.replace(/\/+$/, '');
}

const DASHBOARD_ENDPOINT = `${resolveApiBaseUrl()}/api/ivx/project-dashboard`;

const INITIAL_STATE: LoadState = {
  loading: false,
  error: null,
  httpStatus: null,
  payload: null,
  fetchedAt: null};

const STATUS_META: Record<FeatureAreaStatus, { label: string; color: string }> = {
  live: { label: 'Live', color: '#00C48C' },
  in_progress: { label: 'In progress', color: '#FFB000' },
  planned: { label: 'Planned', color: '#7DD3FC' }};

export default function IVXProjectDashboardRoute() {
  const [state, setState] = useState<LoadState>(INITIAL_STATE);

  const runFetch = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch(`${DASHBOARD_ENDPOINT}?view=full&window=all`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' }});
      const text = await response.text();
      let payload: DashboardPayload | null = null;
      try {
        payload = text ? (JSON.parse(text) as DashboardPayload) : null;
      } catch {
        payload = null;
      }
      setState({
        loading: false,
        error: response.ok ? null : `HTTP ${response.status}`,
        httpStatus: response.status,
        payload,
        fetchedAt: new Date().toISOString()});
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : 'Request failed',
        httpStatus: null,
        payload: null,
        fetchedAt: new Date().toISOString()});
    }
  }, []);

  useEffect(() => {
    void runFetch();
  }, [runFetch]);

  const metrics = state.payload?.metrics ?? null;
  const featureAreas = useMemo<FeatureArea[]>(() => state.payload?.featureAreas ?? [], [state.payload]);

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'AI Project Dashboard' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.headerRow}>
          <LayoutDashboard color={Colors.tint} size={26} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>AI Project Dashboard</Text>
            <Text style={styles.subtitle}>
              Live engineering health pulled from the backend aggregator. No secrets are returned.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          accessibilityRole="button"
          testID="project-dashboard-refetch"
          style={styles.primaryButton}
          onPress={runFetch}
          disabled={state.loading}
        >
          {state.loading ? <ShimmerIndicator color="#0B0B0B" /> : <RefreshCw color="#0B0B0B" size={18} />}
          <Text style={styles.primaryButtonText}>{state.loading ? 'Refreshing…' : 'Refresh dashboard'}</Text>
        </TouchableOpacity>

        {state.error ? (
          <View style={[styles.card, styles.errorCard]}>
            <View style={styles.rowGap}>
              <AlertTriangle color="#FF6B6B" size={18} />
              <Text style={styles.errorText}>{state.error}</Text>
            </View>
          </View>
        ) : null}

        {metrics ? (
          <>
            <View style={styles.metricGrid}>
              <MetricTile label="Completion" value={`${metrics.completionPercent}%`} accent={Colors.tint} />
              <MetricTile label="Feature areas" value={String(metrics.totalFeatureAreas)} accent="#7DD3FC" />
              <MetricTile label="Open items" value={String(metrics.openItems)} accent="#FFB000" />
              <MetricTile label="Completed" value={String(metrics.completedItems)} accent="#00C48C" />
            </View>

            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(Math.max(metrics.completionPercent, 0), 100)}%` }]} />
            </View>

            <View style={styles.statusRow}>
              <StatusPill icon={<CheckCircle2 color="#00C48C" size={14} />} label={`${metrics.liveFeatureAreas} live`} />
              <StatusPill icon={<Clock3 color="#FFB000" size={14} />} label={`${metrics.inProgressFeatureAreas} in progress`} />
              <StatusPill icon={<Activity color="#7DD3FC" size={14} />} label={`${metrics.plannedFeatureAreas} planned`} />
            </View>
          </>
        ) : null}

        {featureAreas.map((area) => (
          <View key={area.id} style={styles.card} testID={`feature-area-${area.id}`}>
            <View style={styles.cardHeaderRow}>
              <Text style={styles.cardTitle}>{area.name}</Text>
              <View style={[styles.badge, { borderColor: STATUS_META[area.status].color }]}>
                <Text style={[styles.badgeText, { color: STATUS_META[area.status].color }]}>
                  {STATUS_META[area.status].label}
                </Text>
              </View>
            </View>
            <Text style={styles.cardMeta}>
              {area.completedItems} completed · {area.openItems} open
            </Text>
          </View>
        ))}

        {state.fetchedAt ? (
          <Text style={styles.footnote}>
            Fetched {state.fetchedAt} · HTTP {state.httpStatus ?? '—'} · {DASHBOARD_ENDPOINT}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

function MetricTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <View style={styles.metricTile}>
      <Text style={[styles.metricValue, { color: accent }]}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <View style={styles.pill}>
      {icon}
      <Text style={styles.pillText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  scroll: { padding: 16, gap: 12, paddingBottom: 48 },
  headerRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  title: { color: Colors.text, fontSize: 20, fontWeight: '700' as const },
  subtitle: { color: '#9A9A9A', fontSize: 12, marginTop: 2, lineHeight: 18 },
  primaryButton: {
    backgroundColor: Colors.tint,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8},
  primaryButtonText: { color: '#0B0B0B', fontWeight: '700' as const, fontSize: 15 },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricTile: {
    flexGrow: 1,
    flexBasis: '45%',
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#222222'},
  metricValue: { fontSize: 26, fontWeight: '800' as const },
  metricLabel: { color: '#9A9A9A', fontSize: 12, marginTop: 4 },
  progressTrack: { height: 10, borderRadius: 999, backgroundColor: '#222222', overflow: 'hidden' },
  progressFill: { height: 10, borderRadius: 999, backgroundColor: Colors.tint },
  statusRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#141414',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: '#222222'},
  pillText: { color: '#E6E6E6', fontSize: 12 },
  card: {
    backgroundColor: '#141414',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#222222',
    gap: 6},
  cardHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const, flex: 1 },
  cardMeta: { color: '#9A9A9A', fontSize: 12 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, fontWeight: '700' as const },
  errorCard: { borderColor: '#7F1D1D' },
  errorText: { color: '#FF6B6B', flex: 1 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  footnote: { color: '#6B6B6B', fontSize: 11, fontFamily: 'Courier', marginTop: 8, lineHeight: 16 }});
