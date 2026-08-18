import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, BadgeCheck, Database, RefreshCw, ShieldCheck, Wrench } from 'lucide-react-native';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const STATUS_URL = `${API_BASE}/api/ivx/agents/real-status`;
const POLL_INTERVAL_MS = 6_000;

type AgentRow = {
  agentId: string;
  agentNumber: number;
  name: string;
  division: string;
  status: 'running' | 'blocked' | 'failed' | 'completed' | 'idle';
  health: string;
  lastRealTool: string | null;
  lastSource: string | null;
  lastEvidenceSha: string | null;
  lastHeartbeat: string | null;
  heartbeatStale: boolean;
  lastDurationMs: number;
  lastError: string | null;
  retryCount: number;
  costUsd: number;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
};

type AlertRowT = {
  id: string;
  alert_type: string;
  agent_id: string | null;
  severity: string;
  detail: string | null;
  created_at: string;
};

type CertificateT = {
  certificate_id: string;
  passed: boolean;
  total_agents: number;
  healthy: number;
  real_execution_verified: number;
  evidence_verified: number;
  persistence_verified: boolean;
  simulated_runs: number;
  commit_sha: string | null;
  runtime_version: string;
  certified_at: string;
} | null;

type ActiveRunT = {
  runId: string;
  status: string;
  processed: number;
  total: number;
  failed: number;
  currentAgent: string | null;
  phase: string;
  note: string;
} | null;

type RealStatus = {
  ok: boolean;
  persistence?: { configured: boolean; tablesReady: boolean; detail: string };
  totalAgents: number;
  running: number;
  blocked: number;
  failed: number;
  completed: number;
  staleHeartbeats: number;
  totalCostUsd: number;
  agents: AgentRow[];
  alerts: AlertRowT[];
  latestCertificate: CertificateT;
  activeRun: ActiveRunT;
};

const STATUS_COLORS: Record<AgentRow['status'], string> = {
  running: '#38bdf8',
  blocked: '#f59e0b',
  failed: '#ef4444',
  completed: '#22c55e',
  idle: '#64748b',
};

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'unknown';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))}s ago`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
  return `${Math.round(ms / 3_600_000)}h ago`;
}

function truncate(value: string | null, max: number): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

export default function RealExecution112Screen() {
  const router = useRouter();
  const [data, setData] = useState<RealStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [filter, setFilter] = useState<'all' | AgentRow['status']>('all');
  const mounted = useRef<boolean>(true);

  const load = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(STATUS_URL, { headers: { Accept: 'application/json' } });
      const json = (await res.json()) as RealStatus;
      if (mounted.current) {
        setData(json);
        setError(null);
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : 'network error');
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load();
    const timer = setInterval(() => { void load(); }, POLL_INTERVAL_MS);
    return () => {
      mounted.current = false;
      clearInterval(timer);
    };
  }, [load]);

  const onRefresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const agents = useMemo<AgentRow[]>(() => {
    const rows = data?.agents ?? [];
    return filter === 'all' ? rows : rows.filter((a) => a.status === filter);
  }, [data, filter]);

  const cert = data?.latestCertificate ?? null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="back-button">
          <ArrowLeft size={20} color="#e2e8f0" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>112 Real Execution</Text>
          <Text style={styles.subtitle}>Live status · real tools · verified evidence</Text>
        </View>
        <TouchableOpacity onPress={() => { void onRefresh(); }} style={styles.backBtn} testID="refresh-button">
          <RefreshCw size={18} color="#e2e8f0" />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { void onRefresh(); }} tintColor="#38bdf8" />}
      >
        {!data && !error && (
          <View style={styles.loadingBox}>
            <ActivityIndicator color="#38bdf8" />
            <Text style={styles.loadingText}>Connecting to production…</Text>
          </View>
        )}
        {error && (
          <View style={[styles.card, styles.errorCard]}>
            <AlertTriangle size={16} color="#ef4444" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {cert && (
          <View style={[styles.card, cert.passed ? styles.certPass : styles.certFail]}>
            <View style={styles.rowBetween}>
              <View style={styles.rowCenter}>
                <BadgeCheck size={18} color={cert.passed ? '#22c55e' : '#ef4444'} />
                <Text style={styles.certTitle}>{cert.passed ? 'CERTIFIED 112/112' : 'CERTIFICATE FAILED'}</Text>
              </View>
              <Text style={styles.certMeta}>{timeAgo(cert.certified_at)}</Text>
            </View>
            <View style={styles.certGrid}>
              <Text style={styles.certStat}>real {cert.real_execution_verified}/112</Text>
              <Text style={styles.certStat}>evidence {cert.evidence_verified}/112</Text>
              <Text style={styles.certStat}>healthy {cert.healthy}/112</Text>
              <Text style={styles.certStat}>simulated {cert.simulated_runs}</Text>
              <Text style={styles.certStat}>persistent {cert.persistence_verified ? 'yes' : 'NO'}</Text>
              <Text style={styles.certStat}>sha {truncate(cert.commit_sha, 10)}</Text>
            </View>
          </View>
        )}

        {data?.activeRun && data.activeRun.status === 'running' && (
          <View style={[styles.card, styles.runCard]}>
            <View style={styles.rowCenter}>
              <Activity size={16} color="#38bdf8" />
              <Text style={styles.runTitle}>Certificate run {data.activeRun.phase}</Text>
            </View>
            <Text style={styles.runNote}>{data.activeRun.processed}/{data.activeRun.total} · {data.activeRun.note}</Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${Math.min(100, Math.round((data.activeRun.processed / Math.max(1, data.activeRun.total)) * 100))}%` }]} />
            </View>
          </View>
        )}

        {data && (
          <View style={styles.kpiRow}>
            {([
              ['completed', data.completed, '#22c55e'],
              ['running', data.running, '#38bdf8'],
              ['failed', data.failed, '#ef4444'],
              ['blocked', data.blocked, '#f59e0b'],
            ] as Array<[AgentRow['status'], number, string]>).map(([key, count, color]) => (
              <TouchableOpacity
                key={key}
                style={[styles.kpi, filter === key && { borderColor: color }]}
                onPress={() => setFilter(filter === key ? 'all' : key)}
                testID={`filter-${key}`}
              >
                <Text style={[styles.kpiValue, { color }]}>{count}</Text>
                <Text style={styles.kpiLabel}>{key}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {data && (
          <View style={styles.metaRow}>
            <View style={styles.rowCenter}>
              <Database size={13} color={data.persistence?.tablesReady ? '#22c55e' : '#ef4444'} />
              <Text style={styles.metaText}>persistence {data.persistence?.tablesReady ? 'ready' : 'OFFLINE'}</Text>
            </View>
            <View style={styles.rowCenter}>
              <ShieldCheck size={13} color={data.staleHeartbeats === 0 ? '#22c55e' : '#f59e0b'} />
              <Text style={styles.metaText}>{data.staleHeartbeats} stale heartbeats</Text>
            </View>
            <Text style={styles.metaText}>cost ${data.totalCostUsd.toFixed(3)}</Text>
          </View>
        )}

        {data && data.alerts.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Alerts</Text>
            {data.alerts.slice(0, 8).map((a) => (
              <View key={a.id} style={styles.alertRow}>
                <AlertTriangle size={13} color={a.severity === 'critical' ? '#ef4444' : '#f59e0b'} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.alertType}>{a.alert_type}{a.agent_id ? ` · ${a.agent_id}` : ''}</Text>
                  <Text style={styles.alertDetail}>{truncate(a.detail, 110)} · {timeAgo(a.created_at)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}

        {data && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Agents ({agents.length}{filter !== 'all' ? ` · ${filter}` : ' / 112'})</Text>
            {agents.map((a) => (
              <View key={a.agentId} style={styles.agentRow}>
                <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[a.status] }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.agentName}>{a.name}</Text>
                    <Text style={[styles.agentStatus, { color: STATUS_COLORS[a.status] }]}>{a.status}</Text>
                  </View>
                  <View style={styles.rowCenter}>
                    <Wrench size={11} color="#64748b" />
                    <Text style={styles.agentMeta}>{a.lastRealTool ?? 'no tool yet'} · {a.lastDurationMs}ms · retries {a.retryCount} · ${a.costUsd.toFixed(3)}</Text>
                  </View>
                  <Text style={styles.agentSource}>{truncate(a.lastSource, 78)}</Text>
                  <Text style={styles.agentEvidence}>
                    evidence {a.lastEvidenceSha ? a.lastEvidenceSha.slice(0, 14) : '—'} · beat {timeAgo(a.lastHeartbeat)}{a.heartbeatStale ? ' ⚠ stale' : ''}
                  </Text>
                  {a.lastError !== null && a.status !== 'completed' && (
                    <Text style={styles.agentError}>{truncate(a.lastError, 90)}</Text>
                  )}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#020617' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  backBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: '#0f172a', alignItems: 'center', justifyContent: 'center' },
  title: { color: '#f8fafc', fontSize: 18, fontWeight: '800' as const },
  subtitle: { color: '#64748b', fontSize: 11, marginTop: 2 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 48, gap: 12 },
  loadingBox: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { color: '#64748b', fontSize: 12 },
  card: { backgroundColor: '#0f172a', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: '#1e293b' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 8, borderColor: '#7f1d1d' },
  errorText: { color: '#fca5a5', fontSize: 12, flex: 1 },
  certPass: { borderColor: '#14532d' },
  certFail: { borderColor: '#7f1d1d' },
  certTitle: { color: '#f8fafc', fontSize: 14, fontWeight: '800' as const, marginLeft: 6 },
  certMeta: { color: '#64748b', fontSize: 11 },
  certGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  certStat: { color: '#94a3b8', fontSize: 11, backgroundColor: '#020617', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  runCard: { borderColor: '#0c4a6e' },
  runTitle: { color: '#e0f2fe', fontSize: 13, fontWeight: '700' as const, marginLeft: 6 },
  runNote: { color: '#64748b', fontSize: 11, marginTop: 6 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: '#1e293b', marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: '#38bdf8' },
  kpiRow: { flexDirection: 'row', gap: 8 },
  kpi: { flex: 1, backgroundColor: '#0f172a', borderRadius: 14, paddingVertical: 10, alignItems: 'center', borderWidth: 1, borderColor: '#1e293b' },
  kpiValue: { fontSize: 18, fontWeight: '800' as const },
  kpiLabel: { color: '#64748b', fontSize: 10, marginTop: 2 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
  metaText: { color: '#94a3b8', fontSize: 11, marginLeft: 4 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  sectionTitle: { color: '#f8fafc', fontSize: 13, fontWeight: '800' as const, marginBottom: 10 },
  alertRow: { flexDirection: 'row', gap: 8, paddingVertical: 6, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e293b', alignItems: 'flex-start' },
  alertType: { color: '#fbbf24', fontSize: 11, fontWeight: '700' as const },
  alertDetail: { color: '#64748b', fontSize: 10, marginTop: 1 },
  agentRow: { flexDirection: 'row', gap: 10, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#1e293b' },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5 },
  agentName: { color: '#e2e8f0', fontSize: 12, fontWeight: '700' as const, flex: 1, marginRight: 8 },
  agentStatus: { fontSize: 10, fontWeight: '800' as const, textTransform: 'uppercase' as const },
  agentMeta: { color: '#64748b', fontSize: 10, marginLeft: 4 },
  agentSource: { color: '#475569', fontSize: 10, marginTop: 2 },
  agentEvidence: { color: '#334155', fontSize: 9, marginTop: 1 },
  agentError: { color: '#f87171', fontSize: 10, marginTop: 2 },
});
