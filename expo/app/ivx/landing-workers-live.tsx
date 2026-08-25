import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Activity, AlertTriangle, ArrowLeft, CheckCircle2, Clock3, Crosshair, Radio, RefreshCw, ShieldCheck, Wrench } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const URL = `${API_BASE}/api/ivx/live-work/agents?enterpriseDashboard=1&range=24h`;
const POLL_MS = 5_000;
const RADAR_SIZE = 270;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 112;

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
  if (['RUNNING','TESTING','DEPLOYING','VERIFYING','RETRYING'].includes(status)) return '#38BDF8';
  if (status === 'COMPLETED') return '#22C55E';
  if (status === 'BLOCKED' || status === 'OWNER_ACTION_REQUIRED') return '#F59E0B';
  if (status === 'FAILED') return '#EF4444';
  return '#64748B';
}

function fmt(value: string | null | undefined) {
  if (!value) return 'NO ACTIVITY YET';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : d.toLocaleString();
}

function pct(value: number, total = 100) {
  return total <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((value / total) * 100)));
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
  const testing = agents.filter(a => a.status === 'TESTING').length;
  const deploying = agents.filter(a => a.status === 'DEPLOYING').length;
  const verifying = agents.filter(a => a.status === 'VERIFYING').length;
  const completed = agents.filter(a => a.status === 'COMPLETED').length;
  const blocked = agents.filter(a => a.status === 'BLOCKED' || a.status === 'OWNER_ACTION_REQUIRED').length;
  const failed = agents.filter(a => a.status === 'FAILED').length;
  const withProof = agents.filter(a => Boolean(a.lastSourceReference && a.lastEvidenceSha)).length;
  const exact100 = agents.length === 100;
  const alerts = agents.filter(a => a.status === 'BLOCKED' || a.status === 'OWNER_ACTION_REQUIRED' || a.status === 'FAILED').slice(0, 8);

  return (
    <SafeAreaView style={styles.safe} edges={['top','bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>IVX MISSION CONTROL</Text>
          <Text style={styles.subtitle}>100-agent landing fleet · real runtime telemetry · 5s sweep</Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} onPress={() => { setRefreshing(true); void load(true); }}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(true); }} tintColor="#FBBF24" />}>
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Radio size={20} color={working > 0 ? '#22C55E' : '#94A3B8'} />
            <Text style={styles.heroTitle}>LIVE OPERATIONS RADAR</Text>
            <Text style={[styles.liveState, { color: working > 0 ? '#22C55E' : '#94A3B8' }]}>{working > 0 ? 'FLEET ACTIVE' : 'FLEET STANDBY'}</Text>
          </View>

          <RadarBoard agents={agents} />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.missionStrip}>
            <StatusChip label="WORKING" value={working} color="#38BDF8" />
            <StatusChip label="TESTING" value={testing} color="#60A5FA" />
            <StatusChip label="DEPLOYING" value={deploying} color="#A78BFA" />
            <StatusChip label="VERIFYING" value={verifying} color="#22D3EE" />
            <StatusChip label="COMPLETED" value={completed} color="#22C55E" />
            <StatusChip label="BLOCKED" value={blocked} color="#F59E0B" />
            <StatusChip label="FAILED" value={failed} color="#EF4444" />
          </ScrollView>

          <View style={styles.metrics}>
            <Metric label="Workers" value={`${agents.length}/100`} color={exact100 ? '#22C55E' : '#EF4444'} />
            <Metric label="Live Work" value={working} color="#38BDF8" />
            <Metric label="Completed" value={completed} color="#22C55E" />
            <Metric label="Alerts" value={blocked + failed} color={blocked + failed > 0 ? '#F59E0B' : '#22C55E'} />
            <Metric label="Proof" value={`${withProof}/100`} color={withProof === 100 ? '#22C55E' : '#FBBF24'} />
            <Metric label="Coverage" value={`${pct(withProof)}%`} color="#FBBF24" />
          </View>

          <View style={styles.proofMeter}>
            <View style={styles.proofMeterHeader}><Text style={styles.proofMeterLabel}>EVIDENCE COVERAGE</Text><Text style={styles.proofMeterValue}>{withProof}/100</Text></View>
            <View style={styles.proofTrack}><View style={[styles.proofFill,{width:`${pct(withProof)}%`}]} /></View>
          </View>

          <View style={styles.proofLine}><ShieldCheck size={15} color={exact100 ? '#22C55E' : '#EF4444'} /><Text style={styles.proofText}>Fleet invariant: {exact100 ? 'IA-013..IA-112 = EXACTLY 100' : `FAIL — ${agents.length} workers loaded`}</Text></View>
          <View style={styles.proofLine}><CheckCircle2 size={15} color={withProof > 0 ? '#22C55E' : '#94A3B8'} /><Text style={styles.proofText}>Source of truth: durable agent execution ledger. No simulated telemetry.</Text></View>
          <View style={styles.proofLine}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Last sweep: {fmt(payload?.dashboard?.generatedAt)}</Text></View>
        </View>

        {loading && !payload ? <Text style={styles.message}>Connecting to production worker ledger…</Text> : null}
        {error ? <View style={styles.alert}><AlertTriangle size={18} color="#EF4444" /><Text style={styles.error}>{error}</Text></View> : null}

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>MISSION ALERT CENTER</Text>
          <Text style={styles.sectionSub}>Blocked, failed and owner-action-required workers rise here automatically.</Text>
          {alerts.length === 0 ? (
            <View style={styles.clearPanel}><CheckCircle2 size={18} color="#22C55E" /><Text style={styles.clearText}>No active fleet alerts in the current ledger snapshot.</Text></View>
          ) : alerts.map(agent => (
            <View key={`alert-${agent.agentId}`} style={styles.alertRow}>
              <View style={[styles.dot,{backgroundColor:tone(agent.status)}]} />
              <View style={styles.alertCopy}><Text style={styles.alertName}>IA-{String(agent.agentNumber).padStart(3,'0')} · {agent.status}</Text><Text style={styles.alertTask} numberOfLines={2}>{agent.currentTask || agent.primaryResponsibility}</Text></View>
              <Text style={[styles.alertCode,{color:tone(agent.status)}]}>{agent.tasksFailedToday + agent.tasksBlockedToday}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>IA-013 → IA-112 LIVE WORK MAP</Text>
          <Text style={styles.sectionSub}>Operational radar visualization only — not physical GPS. Each card below is tied to real runtime evidence.</Text>
          {agents.map(agent => <AgentCard key={agent.agentId} agent={agent} />)}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RadarBoard({ agents }: { agents: Agent[] }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 6500, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0,1], outputRange: ['0deg','360deg'] });

  return (
    <View style={styles.radarWrap}>
      <View style={styles.radar}>
        <View style={[styles.ring,styles.ringOuter]} />
        <View style={[styles.ring,styles.ringMid]} />
        <View style={[styles.ring,styles.ringInner]} />
        <View style={styles.crossH} />
        <View style={styles.crossV} />
        <Animated.View style={[styles.sweep,{transform:[{rotate}]}]}><View style={styles.sweepBeam} /></Animated.View>
        <View style={styles.centerTarget}><Crosshair size={18} color="#FBBF24" /></View>
        {agents.map((agent,index) => {
          const angle = (index / Math.max(agents.length,1)) * Math.PI * 2 - Math.PI / 2;
          const lane = index % 4;
          const radius = RADAR_RADIUS - lane * 18;
          const x = RADAR_CENTER + Math.cos(angle) * radius - 3;
          const y = RADAR_CENTER + Math.sin(angle) * radius - 3;
          return <View key={`radar-${agent.agentId}`} style={[styles.radarDot,{left:x,top:y,backgroundColor:tone(agent.status)}]} />;
        })}
      </View>
      <View style={styles.radarLegend}>
        <Text style={styles.radarLegendTitle}>OPERATIONAL PICTURE</Text>
        <Text style={styles.radarLegendText}>Each point = one IA worker. Position is visual allocation, not geography.</Text>
      </View>
    </View>
  );
}

function StatusChip({ label, value, color }: { label: string; value: number; color: string }) {
  return <View style={[styles.statusChip,{borderColor:color}]}><Text style={[styles.statusChipValue,{color}]}>{value}</Text><Text style={styles.statusChipLabel}>{label}</Text></View>;
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
      <Row label="MISSION" value={agent.currentTask || agent.primaryResponsibility || 'No task recorded yet.'} />
      <Row label="TOOL" value={agent.lastToolUsed || 'No tool evidence yet.'} />
      <Row label="SOURCE" value={agent.lastSourceReference || 'No source reference yet.'} />
      <Row label="EVIDENCE SHA" value={agent.lastEvidenceSha || 'No evidence SHA yet.'} />
      <Row label="LAST ACTIVITY" value={fmt(agent.lastActivityTime)} />
      <View style={styles.counterRow}>
        <Mini label="Started" value={agent.tasksStartedToday} />
        <Mini label="Done" value={agent.tasksCompletedToday} />
        <Mini label="Failed" value={agent.tasksFailedToday} />
        <Mini label="Blocked" value={agent.tasksBlockedToday} />
        <Mini label="Success" value={agent.successRate == null ? '—' : `${agent.successRate}%`} />
      </View>
      <View style={styles.truth}><Wrench size={13} color="#94A3B8" /><Text style={styles.truthText}>Runtime/durable ledger sourced. No UI-generated completion claim.</Text></View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) { return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue} numberOfLines={4}>{value}</Text></View>; }
function Mini({ label, value }: { label: string; value: string | number }) { return <View style={styles.mini}><Text style={styles.miniValue}>{value}</Text><Text style={styles.miniLabel}>{label}</Text></View>; }

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#020617'}, header:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#1E293B',backgroundColor:'#020617'}, iconBtn:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#0F172A',borderWidth:1,borderColor:'#1E293B'}, headerCopy:{flex:1,paddingHorizontal:10}, title:{color:'#F8FAFC',fontWeight:'900',fontSize:17,letterSpacing:1}, subtitle:{color:'#94A3B8',fontSize:10,marginTop:2}, content:{padding:14,paddingBottom:40}, hero:{backgroundColor:'#07111F',borderWidth:1,borderColor:'#1E3A5F',borderRadius:18,padding:16,marginBottom:14}, heroTop:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}, heroTitle:{color:'#E2E8F0',fontWeight:'900',fontSize:13,flex:1,letterSpacing:.7}, liveState:{fontWeight:'900',fontSize:11}, radarWrap:{alignItems:'center',marginVertical:6}, radar:{width:RADAR_SIZE,height:RADAR_SIZE,borderRadius:RADAR_SIZE/2,backgroundColor:'#020B13',borderWidth:1,borderColor:'#164E63',overflow:'hidden',position:'relative'}, ring:{position:'absolute',borderWidth:1,borderColor:'rgba(56,189,248,0.28)',borderRadius:999}, ringOuter:{width:236,height:236,left:17,top:17}, ringMid:{width:170,height:170,left:50,top:50}, ringInner:{width:96,height:96,left:87,top:87}, crossH:{position:'absolute',height:1,width:RADAR_SIZE,top:RADAR_CENTER,backgroundColor:'rgba(56,189,248,0.20)'}, crossV:{position:'absolute',width:1,height:RADAR_SIZE,left:RADAR_CENTER,backgroundColor:'rgba(56,189,248,0.20)'}, sweep:{position:'absolute',left:RADAR_CENTER-1,top:RADAR_CENTER-RADAR_RADIUS,width:2,height:RADAR_RADIUS,transformOrigin:'bottom'}, sweepBeam:{flex:1,width:2,backgroundColor:'#22C55E',opacity:.7,shadowColor:'#22C55E',shadowOpacity:.8,shadowRadius:8}, centerTarget:{position:'absolute',left:RADAR_CENTER-14,top:RADAR_CENTER-14,width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#0F172A',borderWidth:1,borderColor:'#FBBF24'}, radarDot:{position:'absolute',width:7,height:7,borderRadius:4,borderWidth:1,borderColor:'#020617'}, radarLegend:{alignItems:'center',marginTop:8}, radarLegendTitle:{color:'#38BDF8',fontSize:10,fontWeight:'900',letterSpacing:1}, radarLegendText:{color:'#64748B',fontSize:9,textAlign:'center',marginTop:2}, missionStrip:{gap:8,paddingVertical:10}, statusChip:{minWidth:86,borderWidth:1,borderRadius:10,paddingVertical:7,paddingHorizontal:9,backgroundColor:'#020617'}, statusChipValue:{fontWeight:'900',fontSize:16}, statusChipLabel:{color:'#64748B',fontSize:8,fontWeight:'800',marginTop:1}, metrics:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:2}, metric:{width:'30%',minWidth:96,backgroundColor:'#020617',borderRadius:10,padding:10,borderWidth:1,borderColor:'#132238'}, metricValue:{fontSize:20,fontWeight:'900'}, metricLabel:{color:'#64748B',fontSize:10,marginTop:2}, proofMeter:{marginTop:14}, proofMeterHeader:{flexDirection:'row',justifyContent:'space-between',marginBottom:6}, proofMeterLabel:{color:'#64748B',fontSize:9,fontWeight:'900'}, proofMeterValue:{color:'#FBBF24',fontSize:10,fontWeight:'900'}, proofTrack:{height:8,borderRadius:5,backgroundColor:'#020617',overflow:'hidden',borderWidth:1,borderColor:'#1E293B'}, proofFill:{height:'100%',backgroundColor:'#22C55E'}, proofLine:{flexDirection:'row',alignItems:'center',gap:7,marginTop:10}, proofText:{color:'#CBD5E1',fontSize:10,flex:1}, message:{color:'#CBD5E1',padding:16,textAlign:'center'}, alert:{flexDirection:'row',gap:8,backgroundColor:'#2B1116',borderColor:'#7F1D1D',borderWidth:1,borderRadius:12,padding:12,marginBottom:12}, error:{color:'#FCA5A5',flex:1}, section:{marginTop:8}, sectionTitle:{color:'#FBBF24',fontSize:14,fontWeight:'900',letterSpacing:.7}, sectionSub:{color:'#64748B',fontSize:10,marginTop:3,marginBottom:10}, clearPanel:{flexDirection:'row',alignItems:'center',gap:8,padding:12,borderRadius:12,backgroundColor:'#071A13',borderWidth:1,borderColor:'#14532D'}, clearText:{color:'#86EFAC',fontSize:11,flex:1}, alertRow:{flexDirection:'row',alignItems:'center',gap:8,padding:11,borderRadius:11,backgroundColor:'#0F172A',borderWidth:1,borderColor:'#2B3446',marginBottom:7}, alertCopy:{flex:1}, alertName:{color:'#E2E8F0',fontSize:11,fontWeight:'900'}, alertTask:{color:'#94A3B8',fontSize:9,marginTop:2}, alertCode:{fontSize:16,fontWeight:'900'}, card:{backgroundColor:'#0F172A',borderColor:'#1E293B',borderWidth:1,borderRadius:14,padding:13,marginBottom:10}, cardHead:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}, dot:{width:9,height:9,borderRadius:5}, identity:{flex:1}, agentName:{color:'#F8FAFC',fontSize:12,fontWeight:'800'}, meta:{color:'#64748B',fontSize:9,marginTop:2}, status:{fontSize:9,fontWeight:'900'}, row:{marginTop:7}, rowLabel:{color:'#64748B',fontSize:8,fontWeight:'900'}, rowValue:{color:'#CBD5E1',fontSize:10,marginTop:2}, counterRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:10}, mini:{backgroundColor:'#020617',borderRadius:8,paddingHorizontal:8,paddingVertical:6,minWidth:58,alignItems:'center'}, miniValue:{color:'#E2E8F0',fontWeight:'900',fontSize:12}, miniLabel:{color:'#64748B',fontSize:8}, truth:{flexDirection:'row',alignItems:'center',gap:5,marginTop:10}, truthText:{color:'#64748B',fontSize:9},
});
