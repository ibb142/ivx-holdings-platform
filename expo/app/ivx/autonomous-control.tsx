import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { Play, Pause, Square, RotateCcw, ShieldCheck, ShieldAlert, RefreshCw } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

type TruthStatus = 'WORKING' | 'IDLE' | 'BLOCKED' | 'STALE' | 'UNKNOWN';
type TruthRow = {
  agentId: string;
  agentNumber: number;
  status: TruthStatus;
  activeTaskId: string | null;
  workerJobId: string | null;
  heartbeatFresh: boolean;
  heartbeatAgeMs: number | null;
};
type TruthSnapshot = {
  ok: boolean;
  generatedAt: string;
  certification: {
    continuousRuntimeCertified: boolean;
    requiredAgents: number;
    workingAgents: number;
    freshHeartbeatAgents: number;
    reason: string;
  };
  autonomous: {
    working: boolean;
    schedulerEnabled: boolean;
    dispatcherPaused: boolean;
    emergencyStop: boolean;
    runningJobs: number;
    queuedJobs: number;
    completedJobs: number;
    failedJobs: number;
    blockedJobs: number;
    maxConcurrency: number;
  };
  agents: {
    counts: {
      total: number;
      working: number;
      idle: number;
      blocked: number;
      stale: number;
      unknown: number;
      freshHeartbeat: number;
    };
    rows: TruthRow[];
  };
};

type ControlAction = 'start_all' | 'pause_all' | 'resume_all' | 'stop_all';

async function ownerRequest(path: string, init?: RequestInit): Promise<any> {
  const token = await getIVXAccessToken();
  if (!token) throw new Error('Owner session required.');
  const response = await fetch(`${getDirectApiBaseUrl()}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Cache-Control': 'no-store',
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) throw new Error(body?.error || `HTTP ${response.status}`);
  return body;
}

function Metric({ label, value, danger }: { label: string; value: number | string; danger?: boolean }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, danger ? styles.dangerText : null]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

export default function AutonomousControlScreen() {
  const [snapshot, setSnapshot] = useState<TruthSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<ControlAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await ownerRequest('/api/ivx/autonomous/truth');
      setSnapshot(data as TruthSnapshot);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to read Autonomous runtime.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [load]);

  const run = useCallback(async (action: ControlAction) => {
    setActing(action);
    try {
      const result = await ownerRequest('/api/ivx/autonomous/control', {
        method: 'POST',
        body: JSON.stringify({ action }),
      });
      if (result?.snapshot) setSnapshot(result.snapshot as TruthSnapshot);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : `Unable to ${action}.`);
    } finally {
      setActing(null);
    }
  }, []);

  const counts = snapshot?.agents.counts;
  const certified = snapshot?.certification.continuousRuntimeCertified === true;

  return (
    <>
      <Stack.Screen options={{ title: 'Autonomous Control · 112 IA' }} />
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.heroTitle}>
            {certified ? <ShieldCheck size={24} color={Colors.success} /> : <ShieldAlert size={24} color={Colors.warning} />}
            <View style={styles.flex}>
              <Text style={styles.title}>Owner Control · Autonomous + 112 IA</Text>
              <Text style={styles.subtitle}>One control point. Runtime truth refreshes every 2 seconds. GitHub activity cannot fake WORKING.</Text>
            </View>
            <Pressable onPress={() => void load()} style={styles.iconButton}><RefreshCw size={19} color={Colors.primary} /></Pressable>
          </View>
          <Text style={[styles.certText, certified ? styles.goodText : styles.dangerText]}>
            {certified ? '112/112 CONTINUOUS RUNTIME CERTIFIED' : 'FAIL-CLOSED · NOT 112/112 CERTIFIED'}
          </Text>
          <Text style={styles.reason}>{snapshot?.certification.reason ?? 'Waiting for runtime truth…'}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable disabled={Boolean(acting)} onPress={() => void run('start_all')} style={[styles.controlButton, styles.startButton]} testID="autonomous-start-all">
            <Play size={20} color="#fff" /><Text style={styles.controlText}>START ALL 112</Text>
          </Pressable>
          <Pressable disabled={Boolean(acting)} onPress={() => void run('pause_all')} style={styles.controlButton} testID="autonomous-pause-all">
            <Pause size={20} color="#fff" /><Text style={styles.controlText}>PAUSE ALL</Text>
          </Pressable>
          <Pressable disabled={Boolean(acting)} onPress={() => void run('resume_all')} style={styles.controlButton} testID="autonomous-resume-all">
            <RotateCcw size={20} color="#fff" /><Text style={styles.controlText}>RESUME ALL</Text>
          </Pressable>
          <Pressable disabled={Boolean(acting)} onPress={() => void run('stop_all')} style={[styles.controlButton, styles.stopButton]} testID="autonomous-stop-all">
            <Square size={20} color="#fff" /><Text style={styles.controlText}>STOP ALL</Text>
          </Pressable>
        </View>

        {acting ? <View style={styles.message}><ActivityIndicator color={Colors.primary} /><Text style={styles.messageText}>Executing {acting} and verifying real runtime…</Text></View> : null}
        {loading ? <View style={styles.message}><ActivityIndicator color={Colors.primary} /><Text style={styles.messageText}>Reading 112-agent runtime truth…</Text></View> : null}
        {error ? <View style={styles.errorBox}><Text style={styles.errorText}>{error}</Text></View> : null}

        <View style={styles.metrics}>
          <Metric label="Working" value={counts?.working ?? '—'} />
          <Metric label="Fresh heartbeat" value={counts?.freshHeartbeat ?? '—'} />
          <Metric label="Idle" value={counts?.idle ?? '—'} danger={Boolean(counts?.idle)} />
          <Metric label="Stale" value={counts?.stale ?? '—'} danger={Boolean(counts?.stale)} />
          <Metric label="Blocked" value={counts?.blocked ?? '—'} danger={Boolean(counts?.blocked)} />
          <Metric label="Unknown" value={counts?.unknown ?? '—'} danger={Boolean(counts?.unknown)} />
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.sectionTitle}>Autonomous Brain</Text>
          <Text style={styles.statusLine}>Scheduler: {snapshot?.autonomous.schedulerEnabled ? 'ON' : 'OFF'}</Text>
          <Text style={styles.statusLine}>Autonomous: {snapshot?.autonomous.working ? 'WORKING' : 'NOT WORKING'}</Text>
          <Text style={styles.statusLine}>Dispatcher paused: {snapshot?.autonomous.dispatcherPaused ? 'YES' : 'NO'}</Text>
          <Text style={styles.statusLine}>Emergency stop: {snapshot?.autonomous.emergencyStop ? 'YES' : 'NO'}</Text>
          <Text style={styles.statusLine}>Running jobs: {snapshot?.autonomous.runningJobs ?? '—'} · Queued: {snapshot?.autonomous.queuedJobs ?? '—'} · Max concurrency: {snapshot?.autonomous.maxConcurrency ?? '—'}</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.sectionTitle}>112 IA Truth</Text>
          {(snapshot?.agents.rows ?? []).map((agent) => (
            <View key={agent.agentId} style={styles.agentRow}>
              <Text style={styles.agentId}>IA-{String(agent.agentNumber).padStart(3, '0')}</Text>
              <Text style={[styles.agentStatus, agent.status === 'WORKING' ? styles.goodText : styles.dangerText]}>{agent.status}</Text>
              <Text style={styles.agentTask} numberOfLines={1}>{agent.activeTaskId ?? agent.workerJobId ?? 'no active task'}</Text>
              <Text style={styles.agentHeartbeat}>{agent.heartbeatAgeMs == null ? 'no heartbeat' : `${Math.round(agent.heartbeatAgeMs / 1000)}s`}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 48, gap: 14 },
  hero: { backgroundColor: Colors.card, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: Colors.border },
  heroTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  flex: { flex: 1 },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' },
  subtitle: { color: Colors.textSecondary, fontSize: 12, marginTop: 4 },
  iconButton: { padding: 8 },
  certText: { marginTop: 14, fontSize: 15, fontWeight: '900' },
  reason: { color: Colors.textSecondary, fontSize: 12, marginTop: 5 },
  controls: { gap: 10 },
  controlButton: { minHeight: 52, borderRadius: 14, backgroundColor: Colors.info, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  startButton: { backgroundColor: Colors.success },
  stopButton: { backgroundColor: Colors.error },
  controlText: { color: '#fff', fontSize: 15, fontWeight: '900' },
  message: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 12, borderRadius: 12, backgroundColor: Colors.card },
  messageText: { color: Colors.textSecondary, fontSize: 12 },
  errorBox: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: Colors.error, backgroundColor: Colors.card },
  errorText: { color: Colors.error, fontSize: 12, fontWeight: '700' },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '31%', minWidth: 95, padding: 12, borderRadius: 12, backgroundColor: Colors.card, borderWidth: 1, borderColor: Colors.border },
  metricValue: { color: Colors.text, fontSize: 21, fontWeight: '900' },
  metricLabel: { color: Colors.textSecondary, fontSize: 11, marginTop: 2 },
  statusCard: { backgroundColor: Colors.card, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.border },
  sectionTitle: { color: Colors.text, fontWeight: '800', fontSize: 15, marginBottom: 8 },
  statusLine: { color: Colors.textSecondary, fontSize: 12, marginBottom: 4 },
  goodText: { color: Colors.success },
  dangerText: { color: Colors.error },
  agentRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.border },
  agentId: { width: 56, color: Colors.text, fontSize: 11, fontWeight: '800' },
  agentStatus: { width: 62, fontSize: 10, fontWeight: '900' },
  agentTask: { flex: 1, color: Colors.textSecondary, fontSize: 10 },
  agentHeartbeat: { width: 58, textAlign: 'right', color: Colors.textTertiary, fontSize: 10 },
});
