import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Wrench } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const URL = `${API_BASE}/api/ivx/live-work/agents?enterpriseDashboard=1&range=24h`;
const POLL_MS = 5_000;

type AgentStatus = 'ACTIVE' | 'IDLE' | 'RUNNING' | 'TESTING' | 'DEPLOYING' | 'VERIFYING' | 'RETRYING' | 'BLOCKED' | 'OWNER_ACTION_REQUIRED' | 'FAILED' | 'COMPLETED';
type Agent = {
  agentNumber: number;
  agentId: string;
  name: string;
  department: string;
  primaryResponsibility: string;
  status: AgentStatus;
  currentTask: string | null;
  tasksStartedToday: number;
  tasksCompletedToday: number;
  tasksFailedToday: number;
  tasksBlockedToday: number;
  lastActivityTime: string | null;
  successRate: number | null;
  lastToolUsed?: string | null;
  lastSourceReference?: string | null;
  lastEvidenceSha?: string | null;
  health?: string;
  availability?: string;
};

type DashboardPayload = {
  ok: boolean;
  dashboard?: {
    marker?: string;
    generatedAt?: string;
    agents?: Agent[];
    rolling24h?: {
      tasksStarted: number;
      tasksCompleted: number;
      tasksFailed: number;
      tasksRunning: number;
      proofEntries: number;
      ownerActionsRequired: number;
    };
  };
  error?: string;
};

function tone(status: AgentStatus) {
  if (['RUNNING','TESTING','DEPLOYING','VERIFYING'].includes(status)) return '#38BDF8';
  if (status === 'COMPLETED') return '#22C55E';
  if (status === 'BLOCKED' || status === 'OWNER_ACTION_REQUIRED') return '#F59E0B';
  if (status === 'FAILED') return '#EF4444';
  return '#94A3B8';
}

function fmt(value: string | null | undefined) {
  if (!value) return 'NO ACTIVITY YET';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

export default function LandingWorkersLiveScreen() {
  const router = useRouter();
  const [payload, setPayload] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const token = await getIVXAccessToken();
      if (!token) throw new Error('Owner session required.');
      const res = await fetch(URL, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json() as DashboardPayload;
      if (!res.ok || !json.ok || !json.dashboard) throw new Error(json.error || `Dashboard HTTP ${res.status}`);
      setPayload(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load 100-worker telemetry.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    poll.current = setInterval(() => void load(true), POLL_MS);
    return () => { if (poll.current) clearInterval(poll.current); };
  }, [load]);

  const agents = useMemo(() => (payload?.dashboard?.agents || []).filter(a => a.agentNumber >= 13 && a.agentNumber <= 112), [payload]);
  const working = agents.filter(a => ['RUNNING','TESTING','DEPLOYING','VERIFYING','RETRYING'].includes(a.status)).length;
  const completed = agents.filter(a => a.status === 'COMPLETED').length;
  const blocked = agents.filter(a => a.status === 'BLOCKED' || a.status === 'OWNER_ACTION_REQUIRED').length;
  const failed = agents.filter(a => a.status === 'FAILED').length;
  const withProof = agents.filter(a => Boolean(a.lastSourceReference && a.lastEvidenceSha)).length;
  const exact100 = agents.length === 100;

  return (
    <SafeAreaView style={styles.safe} edges={['top','bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>IVX Landing · 100 Worker Live Board</Text>
          <Text style={styles.subtitle}>IA-013 → IA-112 · durable runtime ledger · refresh every 5s</Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Activity size={22} color={working > 0 ? '#22C55E' : '#94A3B8'} />
            <Text style={styles.heroTitle}>REAL WORKFORCE TELEMETRY</Text>
            <Text style={[styles.liveState, { color: working > 0 ? '#22C55E' : '#94A3B8' }]}>{working > 0 ? 'WORKING' : 'IDLE / WAITING'}</Text>
          </View>
          <View style={styles.metrics}>
            <Metric label="Workers" value={`${agents.length}/100`} color={exact100 ? '#22C55E' : '#EF4444'} />
            <Metric label="Working" value={working} color="#38BDF8" />
            <Metric label="Completed" value={completed} color="#22C55E" />
            <Metric label="Blocked" value={blocked} color="#F59E0B" />
            <Metric label="Failed" value={failed} color="#EF4444" />
            <Metric label="Proof" value={`${withProof}/100`} color={withProof === 100 ? '#22C55E' : '#FBBF24'} />
          </View>
          <View style={styles.proofLine}><ShieldCheck size={15} color={exact100 ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Fleet invariant: {exact100 ? 'IA-013..IA-112 = EXACTLY 100' : `FAIL — ${agents.length} workers loaded`}</Text></View>
          <View style={styles.proofLine}><CheckCircle2 size={15} color={withProof > 0 ? '#22C55E' : '#94A3B8'} /><Text style={styles.proofText}>Evidence comes from durable agent execution rows; simulated UI counters are not used.</Text></View>
          <View style={styles.proofLine}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Snapshot: {fmt(payload?.dashboard?.generatedAt)}</Text></View>
        </View>

        {loading && !payload ? <Text style={styles.message}>Connecting to production worker ledger…</Text> : null}
        {error ? <View style={styles.alert}><AlertTriangle size={18} color="#EF4444" /><Text style={styles.error}>{error}</Text></View> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>IA-013 → IA-112 LIVE</Text>
          <Text style={styles.sectionSub}>Each card shows actual runtime status, current/last task, tool, source evidence, counters and last activity.</Text>
          {agents.map(agent => <AgentCard key={agent.agentId} agent={agent} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue,{color}]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

function AgentCard({ agent }: { agent: Agent }) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHead}>
        <View style={[styles.dot,{backgroundColor:tone(agent.status)}]} />
        <View style={styles.identity}><Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3,'0')} · {agent.name}</Text><Text style={styles.meta}>{agent.department} · {agent.health || 'unknown'} · {agent.availability || 'unknown'}</Text></View>
        <Text style={[styles.status,{color:tone(agent.status)}]}>{agent.status}</Text>
      </View>
      <Row label="TASK" value={agent.currentTask || agent.primaryResponsibility || 'No task recorded yet.'} />
      <Row label="TOOL" value={agent.lastToolUsed || 'No tool evidence yet.'} />
      <Row label="SOURCE" value={agent.lastSourceReference || 'No source reference yet.'} />
      <Row label="EVIDENCE" value={agent.lastEvidenceSha || 'No evidence SHA yet.'} />
      <Row label="LAST ACTIVITY" value={fmt(agent.lastActivityTime)} />
      <View style={styles.counterRow}>
        <Mini label="Started" value={agent.tasksStartedToday} />
        <Mini label="Done" value={agent.tasksCompletedToday} />
        <Mini label="Failed" value={agent.tasksFailedToday} />
        <Mini label="Blocked" value={agent.tasksBlockedToday} />
        <Mini label="Success" value={agent.successRate == null ? '—' : `${agent.successRate}%`} />
      </View>
      <View style={styles.truth}><Wrench size={13} color="#94A3B8" /><Text style={styles.truthText}>This row is derived from the real runtime/durable execution ledger.</Text></View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) { return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue} numberOfLines={4}>{value}</Text></View>; }
function Mini({ label, value }: { label: string; value: string | number }) { return <View style={styles.mini}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#020617'}, header:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#1E293B'}, iconBtn:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#0F172A'}, headerCopy:{flex:1,paddingHorizontal:10}, title:{color:'#F8FAFC',fontWeight:'800',fontSize:17}, subtitle:{color:'#94A3B8',fontSize:11,marginTop:2}, content:{padding:14,paddingBottom:36}, hero:{backgroundColor:'#0F172A',borderWidth:1,borderColor:'#1E293B',borderRadius:16,padding:16,marginBottom:14}, heroTop:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:14}, heroTitle:{color:'#E2E8F0',fontWeight:'800',fontSize:13,flex:1}, liveState:{fontWeight:'900',fontSize:12}, metrics:{flexDirection:'row',flexWrap:'wrap',gap:8}, metric:{width:'30%',minWidth:96,backgroundColor:'#020617',borderRadius:10,padding:10}, metricValue:{fontSize:20,fontWeight:'900'}, metricLabel:{color:'#64748B',fontSize:10,marginTop:2}, proofLine:{flexDirection:'row',alignItems:'center',gap:7,marginTop:11}, proofText:{color:'#CBD5E1',fontSize:11,flex:1}, message:{color:'#CBD5E1',padding:16,textAlign:'center'}, alert:{flexDirection:'row',gap:8,backgroundColor:'#2B1116',borderColor:'#7F1D1D',borderWidth:1,borderRadius:12,padding:12,marginBottom:12}, error:{color:'#FCA5A5',flex:1}, section:{marginTop:4}, sectionTitle:{color:'#FBBF24',fontSize:15,fontWeight:'900'}, sectionSub:{color:'#64748B',fontSize:11,marginTop:3,marginBottom:10}, card:{backgroundColor:'#0F172A',borderColor:'#1E293B',borderWidth:1,borderRadius:14,padding:13,marginBottom:10}, cardHead:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}, dot:{width:9,height:9,borderRadius:5}, identity:{flex:1}, agentName:{color:'#F8FAFC',fontSize:13,fontWeight:'800'}, meta:{color:'#64748B',fontSize:10,marginTop:2}, status:{fontSize:10,fontWeight:'900'}, row:{marginTop:7}, rowLabel:{color:'#64748B',fontSize:9,fontWeight:'800'}, rowValue:{color:'#CBD5E1',fontSize:11,marginTop:2}, counterRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:10}, mini:{backgroundColor:'#020617',borderRadius:8,paddingHorizontal:8,paddingVertical:6,minWidth:58,alignItems:'center'}, miniValue:{color:'#E2E8F0',fontWeight:'900',fontSize:12}, miniLabel:{color:'#64748B',fontSize:8}, truth:{flexDirection:'row',alignItems:'center',gap:5,marginTop:10}, truthText:{color:'#64748B',fontSize:9},
});
