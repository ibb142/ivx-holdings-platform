import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getAutonomousOpsDashboard, type UnifiedAgent } from '@/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

const ONLINE_MS = 2 * 60 * 1000;
const RECENT_MS = 15 * 60 * 1000;

function ageMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(iso);
  return Number.isFinite(n) ? Math.max(0, Date.now() - n) : null;
}

function presence(agent: UnifiedAgent): 'ONLINE' | 'RECENT' | 'OFFLINE' | 'UNKNOWN' {
  if (agent.status === 'RUNNING') return 'ONLINE';
  const age = ageMs(agent.lastActivityTime);
  if (age === null) return 'UNKNOWN';
  if (age <= ONLINE_MS) return 'ONLINE';
  if (age <= RECENT_MS) return 'RECENT';
  return 'OFFLINE';
}

function lastSeen(iso: string | null | undefined): string {
  const age = ageMs(iso);
  if (age === null) return 'No heartbeat evidence';
  const sec = Math.floor(age / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}

export default function AgentGpsScreen() {
  const q = useQuery({
    queryKey: ['ivx-agent-gps-112'],
    queryFn: () => getAutonomousOpsDashboard({ range: '24h' }),
    refetchInterval: 10000,
  });
  const agents = q.data?.agents ?? [];
  const counts = useMemo(() => {
    const c = { ONLINE: 0, RECENT: 0, OFFLINE: 0, UNKNOWN: 0 };
    for (const a of agents) c[presence(a)]++;
    return c;
  }, [agents]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'IA GPS • 112' }} />
      <Text style={styles.title}>IA GPS • Real-time Operations</Text>
      <Text style={styles.subtitle}>Operational GPS = heartbeat + logical system location + current/last task. It is not physical device GPS.</Text>
      <View style={styles.summary}>
        <Text style={styles.metric}>ONLINE {counts.ONLINE}</Text>
        <Text style={styles.metric}>RECENT {counts.RECENT}</Text>
        <Text style={styles.metric}>OFFLINE {counts.OFFLINE}</Text>
        <Text style={styles.metric}>UNKNOWN {counts.UNKNOWN}</Text>
      </View>
      <Text style={styles.meta}>Registry {q.data?.enterprise112?.registryCount ?? agents.length}/112 • Durable states {q.data?.enterprise112?.durableStateCount ?? 0} • refresh 10s</Text>
      {q.isError ? <Text style={styles.error}>Live ledger error: {String(q.error)}</Text> : null}
      {agents.map((a) => {
        const p = presence(a);
        return (
          <View key={a.agentId} style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.name}>IA-{String(a.agentNumber).padStart(3, '0')} • {a.name}</Text>
              <Text style={styles.presence}>{p}</Text>
            </View>
            <Text style={styles.line}>Logical location: {a.department} • {a.availability ?? a.status}</Text>
            <Text style={styles.line}>Heartbeat: {lastSeen(a.lastActivityTime)}{a.lastActivityTime ? ` • ${a.lastActivityTime}` : ''}</Text>
            <Text style={styles.line}>Work: {a.currentTask ?? 'No active task evidence'}</Text>
            <Text style={styles.line}>Tool: {a.lastToolUsed ?? '—'}</Text>
            <Text style={styles.line}>Source: {a.lastSourceReference ?? '—'}</Text>
            <Text style={styles.line}>Evidence: {a.lastEvidenceSha ? a.lastEvidenceSha.slice(0, 20) : '—'}</Text>
            <Text style={styles.line}>24h: started {a.tasksStartedToday} • done {a.tasksCompletedToday} • failed {a.tasksFailedToday} • blocked {a.tasksBlockedToday}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#08111f' },
  content: { padding: 16, paddingBottom: 48 },
  title: { color: '#fff', fontSize: 24, fontWeight: '800', marginBottom: 6 },
  subtitle: { color: '#a8b3c7', fontSize: 13, lineHeight: 18, marginBottom: 12 },
  summary: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  metric: { color: '#fff', fontWeight: '700', backgroundColor: '#13233b', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 8 },
  meta: { color: '#8fa3bf', marginBottom: 14 },
  error: { color: '#ff8b8b', marginBottom: 12 },
  card: { backgroundColor: '#0f1c2f', borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: '#223654' },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  name: { color: '#fff', fontWeight: '800', flex: 1 },
  presence: { color: '#7ee7a8', fontWeight: '900' },
  line: { color: '#c3cee0', fontSize: 12, lineHeight: 18 },
});
