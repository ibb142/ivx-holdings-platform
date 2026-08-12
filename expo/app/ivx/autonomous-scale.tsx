import React, { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { Stack } from 'expo-router';
import {
  Activity,
  CheckCircle2,
  CircleX,
  Clock,
  GitCommit,
  Play,
  Rocket,
  ShieldCheck,
  TrendingUp} from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';

type ScaleResult = 'VERIFIED' | 'FAILED' | 'BLOCKED_FOR_APPROVAL' | 'never';

type ScaleDashboard = {
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  currentJob: string | null;
  lastResult: ScaleResult;
  runCount: number;
  failureCount: number;
  improvementsCompleted: number;
  githubSha: string | null;
  renderDeployId: string | null;
  productionStatus: 'healthy' | 'degraded' | 'unknown';
  productionHttpStatus: number | null;
  lastImprovement: { category: string; title: string } | null;
  recentFailures: { runId: string; at: string; evidence: string }[];
  recentImprovements: { runId: string; at: string; category: string; title: string; result: ScaleResult }[];
};

const QUERY_KEY = ['ivx', 'autonomous-scale', 'dashboard'] as const;

function resolveBaseUrl(): string {
  const candidates = [
    process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL,
    process.env.EXPO_PUBLIC_IVX_API_BASE_URL,
    process.env.EXPO_PUBLIC_API_BASE_URL,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim().replace(/\/+$/, '');
    }
  }
  return '';
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getIVXAccessToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function fetchDashboard(): Promise<ScaleDashboard | null> {
  const base = resolveBaseUrl();
  if (!base) return null;
  const res = await fetch(`${base}/api/ivx/autonomous-scale/dashboard`, { headers: await authHeaders() });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; dashboard?: ScaleDashboard; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json.dashboard ?? null;
}

async function runNow(): Promise<void> {
  const base = resolveBaseUrl();
  if (!base) throw new Error('API base URL is not configured.');
  const res = await fetch(`${base}/api/ivx/autonomous-scale/run`, {
    method: 'POST',
    headers: await authHeaders(),
    body: JSON.stringify({})});
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || json.ok === false) throw new Error(json.error ?? `HTTP ${res.status}`);
}

function formatTime(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleString();
  } catch {
    return value;
  }
}

function resultColor(result: ScaleResult): string {
  if (result === 'VERIFIED') return Colors.success;
  if (result === 'FAILED') return Colors.error ?? '#FF4D4D';
  if (result === 'BLOCKED_FOR_APPROVAL') return Colors.warning ?? '#f59e0b';
  return Colors.muted ?? '#94a3b8';
}

function StatCard({ icon, label, value, tone }: { icon: React.ReactNode; label: string; value: string; tone?: string }) {
  return (
    <View style={styles.statCard}>
      <View style={styles.statIcon}>{icon}</View>
      <Text style={[styles.statValue, tone ? { color: tone } : null]} numberOfLines={1}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function AutonomousScaleScreen() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch, isRefetching } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchDashboard,
    refetchInterval: 30_000});

  const runMutation = useMutation({
    mutationFn: runNow,
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }});

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const statusTone =
    data?.productionStatus === 'healthy'
      ? Colors.success
      : data?.productionStatus === 'degraded'
        ? (Colors.error ?? '#FF4D4D')
        : (Colors.muted ?? '#94a3b8');

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: 'Autonomous Scale Mode' }} />
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={Colors.text} />}
      >
        <View style={styles.heroCard}>
          <View style={styles.heroRow}>
            <Activity size={20} color={Colors.success} />
            <Text style={styles.heroTitle}>Daily Self-Improvement Loop</Text>
          </View>
          <Text style={styles.heroSubtitle}>
            Runs server-side every day — no phone required. Inspect → find improvement → code → test → deploy → verify → report.
          </Text>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, { backgroundColor: data?.enabled ? Colors.success : (Colors.muted ?? '#94a3b8') }]}>
              <Text style={styles.badgeText}>{data?.enabled ? 'ACTIVE' : 'DISABLED'}</Text>
            </View>
            <View style={[styles.badge, { backgroundColor: statusTone }]}>
              <Text style={styles.badgeText}>PROD {String(data?.productionStatus ?? 'unknown').toUpperCase()}</Text>
            </View>
          </View>
        </View>

        {isLoading ? (
          <View style={styles.center}><ShimmerIndicator color={Colors.text} /></View>
        ) : isError ? (
          <View style={styles.errorCard}>
            <CircleX size={18} color={Colors.error ?? '#FF4D4D'} />
            <Text style={styles.errorText}>{error instanceof Error ? error.message : 'Failed to load dashboard.'}</Text>
          </View>
        ) : !data ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>API base URL is not configured.</Text>
          </View>
        ) : (
          <>
            <View style={styles.statGrid}>
              <StatCard icon={<Clock size={16} color={Colors.info ?? '#38bdf8'} />} label="Last run" value={formatTime(data.lastRunAt)} />
              <StatCard icon={<Clock size={16} color={Colors.info ?? '#38bdf8'} />} label="Next run" value={formatTime(data.nextRunAt)} />
              <StatCard icon={<CheckCircle2 size={16} color={resultColor(data.lastResult)} />} label="Last result" value={data.lastResult} tone={resultColor(data.lastResult)} />
              <StatCard icon={<TrendingUp size={16} color={Colors.success} />} label="Improvements" value={String(data.improvementsCompleted)} tone={Colors.success} />
              <StatCard icon={<Activity size={16} color={Colors.text} />} label="Total runs" value={String(data.runCount)} />
              <StatCard icon={<CircleX size={16} color={Colors.error ?? '#FF4D4D'} />} label="Failures" value={String(data.failureCount)} tone={data.failureCount > 0 ? (Colors.error ?? '#FF4D4D') : Colors.text} />
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Current job</Text>
              <Text style={styles.cardBody}>{data.currentJob ?? 'Idle — waiting for next scheduled run.'}</Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Production proof</Text>
              <View style={styles.proofRow}>
                <GitCommit size={15} color={Colors.muted ?? '#94a3b8'} />
                <Text style={styles.proofLabel}>GitHub SHA</Text>
                <Text style={styles.proofValue} numberOfLines={1}>{data.githubSha ?? '—'}</Text>
              </View>
              <View style={styles.proofRow}>
                <Rocket size={15} color={Colors.muted ?? '#94a3b8'} />
                <Text style={styles.proofLabel}>Render deploy</Text>
                <Text style={styles.proofValue} numberOfLines={1}>{data.renderDeployId ?? '—'}</Text>
              </View>
              <View style={styles.proofRow}>
                <ShieldCheck size={15} color={statusTone} />
                <Text style={styles.proofLabel}>Health HTTP</Text>
                <Text style={styles.proofValue} numberOfLines={1}>{data.productionHttpStatus ?? '—'}</Text>
              </View>
            </View>

            {data.lastImprovement ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Latest improvement</Text>
                <Text style={styles.tag}>{data.lastImprovement.category}</Text>
                <Text style={styles.cardBody}>{data.lastImprovement.title}</Text>
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Recent runs</Text>
              {data.recentImprovements.length === 0 ? (
                <Text style={styles.cardBody}>No runs yet. Trigger one below to capture the first proof.</Text>
              ) : (
                data.recentImprovements.map((r) => (
                  <View key={r.runId} style={styles.runRow}>
                    <View style={[styles.dot, { backgroundColor: resultColor(r.result) }]} />
                    <View style={styles.runBody}>
                      <Text style={styles.runTitle} numberOfLines={1}>{r.title}</Text>
                      <Text style={styles.runMeta}>{r.category} · {formatTime(r.at)}</Text>
                    </View>
                    <Text style={[styles.runResult, { color: resultColor(r.result) }]}>{r.result}</Text>
                  </View>
                ))
              )}
            </View>

            {data.recentFailures.length > 0 ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Recent failures</Text>
                {data.recentFailures.map((f) => (
                  <View key={f.runId} style={styles.failRow}>
                    <Text style={styles.failTime}>{formatTime(f.at)}</Text>
                    <Text style={styles.failEvidence}>{f.evidence}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </>
        )}

        <Pressable
          style={({ pressed }) => [styles.runButton, pressed ? styles.runButtonPressed : null]}
          onPress={() => runMutation.mutate()}
          disabled={runMutation.isPending}
        >
          {runMutation.isPending ? (
            <ShimmerIndicator color="#fff" />
          ) : (
            <>
              <Play size={18} color="#fff" />
              <Text style={styles.runButtonText}>Run a daily cycle now</Text>
            </>
          )}
        </Pressable>
        {runMutation.isError ? (
          <Text style={styles.errorText}>{runMutation.error instanceof Error ? runMutation.error.message : 'Run failed.'}</Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

export default function AutonomousScaleScreenWithBoundary() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  return (
    <ErrorBoundary>
      <AutonomousScaleScreen />
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  center: { paddingVertical: 40, alignItems: 'center' },
  heroCard: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 10},
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroTitle: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  heroSubtitle: { color: Colors.muted ?? '#94a3b8', fontSize: 13, lineHeight: 19 },
  badgeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' as const },
  statGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: {
    width: '31%',
    flexGrow: 1,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 4},
  statIcon: { marginBottom: 2 },
  statValue: { color: Colors.text, fontSize: 14, fontWeight: '800' as const },
  statLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  card: {
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.border ?? '#1f2937',
    gap: 8},
  cardTitle: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  cardBody: { color: Colors.muted ?? '#94a3b8', fontSize: 13, lineHeight: 19 },
  tag: {
    alignSelf: 'flex-start',
    color: Colors.info ?? '#38bdf8',
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase'},
  proofRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  proofLabel: { color: Colors.muted ?? '#94a3b8', fontSize: 13, width: 100 },
  proofValue: { color: Colors.text, fontSize: 13, fontWeight: '600' as const, flex: 1 },
  runRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: Colors.border ?? '#1f2937' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  runBody: { flex: 1 },
  runTitle: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  runMeta: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  runResult: { fontSize: 11, fontWeight: '800' as const },
  failRow: { paddingVertical: 6, gap: 2 },
  failTime: { color: Colors.muted ?? '#94a3b8', fontSize: 11 },
  failEvidence: { color: Colors.error ?? '#FF4D4D', fontSize: 12 },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.card ?? '#111827',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.error ?? '#FF4D4D'},
  errorText: { color: Colors.error ?? '#FF4D4D', fontSize: 13, flex: 1 },
  runButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.success,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 4},
  runButtonPressed: { opacity: 0.85 },
  runButtonText: { color: '#fff', fontSize: 15, fontWeight: '800' as const }});
