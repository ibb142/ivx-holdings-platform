import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, FlatList, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { AlertTriangle, ArrowLeft, Clock3, Crosshair, Radio, RefreshCw } from 'lucide-react-native';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';
import { currentLiveFleet, fetchLiveFleet, type LiveFleetAgent, type LiveFleetPayload, type LiveFleetStatus } from '@/shared/ivx/live-fleet-dashboard';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');
const URL = `${API_BASE}/api/ivx/live-work/agents?enterpriseDashboard=1&view=live`;
const POLL_MS = 10_000;
const RADAR_SIZE = 270;
const RADAR_CENTER = RADAR_SIZE / 2;
const RADAR_RADIUS = 112;

function tone(status: LiveFleetStatus) {
  if (status === 'RUNNING') return '#38BDF8';
  if (status === 'ASSIGNED') return '#F59E0B';
  if (status === 'IDLE') return '#22C55E';
  return '#64748B';
}
function fmt(value: string | null | undefined) {
  if (!value) return 'Sin observación';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Hora no disponible' : date.toLocaleString();
}

export default function LandingWorkersLiveScreen() {
  const router = useRouter();
  const [payload, setPayload] = useState<LiveFleetPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now);
  const mounted = useRef(false);
  const inFlight = useRef<AbortController | null>(null);

  const load = useCallback(async (silent = false) => {
    // A slow poll or token refresh owns the request slot until it settles.
    if (inFlight.current) return;
    const controller = new AbortController();
    inFlight.current = controller;
    if (!silent) setLoading(true);
    try {
      const next = await fetchLiveFleet({ url: URL, getToken: getIVXAccessToken, signal: controller.signal });
      if (mounted.current && inFlight.current === controller) {
        setPayload(next); setError(null); setNow(Date.now());
      }
    } catch (failure) {
      if (mounted.current && !controller.signal.aborted && inFlight.current === controller) {
        setError(failure instanceof Error ? failure.message : 'Telemetría no disponible.');
      }
    } finally {
      if (inFlight.current === controller) {
        inFlight.current = null;
        if (mounted.current) { setLoading(false); setRefreshing(false); }
      }
    }
  }, []);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    setNow(Date.now());
    void load();
    const poll = setInterval(() => void load(true), POLL_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      mounted.current = false;
      clearInterval(poll); clearInterval(clock);
      inFlight.current?.abort(); inFlight.current = null;
    };
  }, [load]));

  const current = currentLiveFleet(payload, error, now);
  const agents = current?.agents ?? [];
  const counts = current?.fleetSignals.counts;
  const working = counts?.running ?? null;
  const heartbeat = counts?.heartbeat ?? null;
  const assigned = counts?.assigned ?? null;
  const productive = counts?.productive ?? null;
  const state = current ? (working ? 'FLOTA ACTIVA' : heartbeat ? 'FLOTA EN ESPERA' : 'SIN HEARTBEATS')
    : loading && !error ? 'CONECTANDO' : error ? 'SIN TELEMETRÍA' : 'DATOS ANTIGUOS';
  const stateColor = !current ? '#F59E0B' : working ? '#22C55E' : '#94A3B8';
  const refresh = () => { setRefreshing(true); void load(true); };
  const evidenceWindowMinutes = current ? current.fleetSignals.evidenceWindowMs / 60_000 : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconBtn} accessibilityLabel="Volver" onPress={() => router.back()}><ArrowLeft size={20} color="#E2E8F0" /></TouchableOpacity>
        <View style={styles.headerCopy}>
          <Text style={styles.title}>IVX MISSION CONTROL</Text>
          <Text style={styles.subtitle}>112 IA · actividad observada · actualización cada 10 s</Text>
        </View>
        <TouchableOpacity style={styles.iconBtn} accessibilityLabel="Actualizar flota" onPress={refresh}><RefreshCw size={18} color="#FBBF24" /></TouchableOpacity>
      </View>
      <FlatList
        testID="fleet_virtualized_container"
        data={agents}
        keyExtractor={agent => agent.agentId}
        renderItem={({ item }) => <AgentCard agent={item} />}
        initialNumToRender={8}
        maxToRenderPerBatch={8}
        windowSize={5}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#FBBF24" />}
        ListHeaderComponent={<>
        {!current ? <View style={styles.alert} accessibilityRole="alert" testID="fleet-telemetry-status">
          <AlertTriangle size={18} color="#F59E0B" />
          <Text style={styles.error}>{error || (loading ? 'Conectando con la flota…' : 'La última observación venció. Esperando datos actuales.')}</Text>
        </View> : null}
        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <Radio size={20} color={stateColor} />
            <Text style={styles.heroTitle}>RADAR DE OPERACIONES</Text>
            <Text testID="fleet-live-state" style={[styles.liveState, { color: stateColor }]}>{state}</Text>
          </View>
          <RadarBoard agents={agents} active={Boolean(current && working)} />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.missionStrip}>
            <StatusChip label="TRABAJANDO" value={working ?? '—'} color="#38BDF8" />
            <StatusChip label="CON HEARTBEAT" value={heartbeat ?? '—'} color="#22C55E" />
            <StatusChip label="CON ASIGNACIÓN" value={assigned ?? '—'} color="#F59E0B" />
            <StatusChip label="CON EVIDENCIA" value={productive ?? '—'} color="#A78BFA" />
          </ScrollView>
          <View style={styles.metrics}>
            <Metric label="IA configuradas" value={current ? `${current.registryCount}/112` : '—/112'} color="#94A3B8" />
            <Metric label="Trabajo activo" value={working ?? '—'} color="#38BDF8" />
            <Metric label="Heartbeat reciente" value={heartbeat ?? '—'} color="#22C55E" />
          </View>
          <View style={styles.proofLine}><Clock3 size={15} color="#94A3B8" /><Text style={styles.proofText}>Última observación: {fmt(payload?.dashboard.generatedAt)}</Text></View>
          <Text style={styles.sectionSub}>Un heartbeat indica presencia. El trabajo activo requiere una tarea con lease y heartbeat vigentes.</Text>
          <Text style={styles.sectionSub}>Evidencia: {productive ?? '—'} IA en la ventana de {evidenceWindowMinutes ?? '—'} minutos. Los resultados históricos se consultan por separado.</Text>
          <TouchableOpacity onPress={() => router.push('/ivx/autonomous-ops')}><Text style={styles.sectionTitle}>Ver historial y resultados</Text></TouchableOpacity>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>TAREAS EN EJECUCIÓN</Text>
          {!current ? <Text style={styles.message}>Actividad actual no disponible.</Text>
            : working === 0 ? <Text style={styles.message}>Esta observación no registra tareas con ejecución vigente.</Text>
            : agents.filter(agent => agent.signals.running).map(agent => (
              <View key={`activity-${agent.agentId}`} style={styles.alertRow}>
                <View style={[styles.dot, { backgroundColor: tone(agent.status) }]} />
                <View style={styles.alertCopy}><Text style={styles.alertName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text><Text style={styles.alertTask}>{agent.currentTask}</Text><Text style={styles.alertTask}>Heartbeat: {fmt(agent.lastActivityTime)}</Text></View>
              </View>
            ))}
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>IA-001 → IA-112</Text>
          <Text style={styles.sectionSub}>RUNNING: ejecutando · ASSIGNED: tiene trabajo asignado · IDLE: disponible · UNKNOWN: sin presencia reciente.</Text>
        </View>
        </>}
      />
    </SafeAreaView>
  );
}

function RadarBoard({ agents, active }: { agents: LiveFleetAgent[]; active: boolean }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) { spin.setValue(0); return; }
    const animation = Animated.loop(Animated.timing(spin, { toValue: 1, duration: 6500, useNativeDriver: true }));
    animation.start();
    return () => animation.stop();
  }, [spin, active]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return <View style={styles.radarWrap}>
    <View style={styles.radar}>
      <View style={[styles.ring, styles.ringOuter]} /><View style={[styles.ring, styles.ringMid]} /><View style={[styles.ring, styles.ringInner]} />
      <View style={styles.crossH} /><View style={styles.crossV} />
      {active ? <Animated.View style={[styles.sweep, { transform: [{ rotate }] }]}><View style={styles.sweepBeam} /></Animated.View> : null}
      <View style={styles.centerTarget}><Crosshair size={18} color="#FBBF24" /></View>
      {agents.map(agent => {
        const index = agent.agentNumber - 1, angle = index / 112 * Math.PI * 2 - Math.PI / 2;
        const radius = RADAR_RADIUS - (index % 4) * 18;
        return <View key={agent.agentId} style={[styles.radarDot, { left: RADAR_CENTER + Math.cos(angle) * radius - 3, top: RADAR_CENTER + Math.sin(angle) * radius - 3, backgroundColor: tone(agent.status) }]} />;
      })}
    </View>
    <View style={styles.radarLegend}><Text style={styles.radarLegendTitle}>ESTADO OBSERVADO</Text><Text style={styles.radarLegendText}>Cada punto representa una IA. La posición es visual, no geográfica.</Text></View>
  </View>;
}
function StatusChip({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <View style={[styles.statusChip, { borderColor: color }]}><Text style={[styles.statusChipValue, { color }]}>{value}</Text><Text style={styles.statusChipLabel}>{label}</Text></View>;
}
function Metric({ label, value, color }: { label: string; value: string | number; color: string }) {
  return <View style={styles.metric}><Text style={[styles.metricValue, { color }]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}
function AgentCard({ agent }: { agent: LiveFleetAgent }) {
  return <View style={styles.card} testID={`fleet-agent-${agent.agentNumber}`}>
    <View style={styles.cardHead}><View style={[styles.dot, { backgroundColor: tone(agent.status) }]} /><View style={styles.identity}><Text style={styles.agentName}>IA-{String(agent.agentNumber).padStart(3, '0')} · {agent.name}</Text><Text style={styles.meta}>{agent.department}</Text></View><Text style={[styles.status, { color: tone(agent.status) }]}>{agent.status}</Text></View>
    <Row label="RESPONSABILIDAD" value={agent.primaryResponsibility} />
    <Row label="TAREA OBSERVADA" value={agent.currentTask || 'Sin tarea con lease vigente'} />
    <Row label="HEARTBEAT" value={fmt(agent.lastActivityTime)} />
    <Row label="FUENTE DE EVIDENCIA" value={agent.lastSourceReference || 'Sin evidencia en esta ventana'} />
    <Row label="EVIDENCIA SHA" value={agent.lastEvidenceSha || '—'} />
  </View>;
}
function Row({ label, value }: { label: string; value: string }) {
  return <View style={styles.row}><Text style={styles.rowLabel}>{label}</Text><Text style={styles.rowValue} numberOfLines={4}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  safe:{flex:1,backgroundColor:'#020617'}, header:{flexDirection:'row',alignItems:'center',paddingHorizontal:14,paddingVertical:12,borderBottomWidth:1,borderBottomColor:'#1E293B',backgroundColor:'#020617'}, iconBtn:{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:10,backgroundColor:'#0F172A',borderWidth:1,borderColor:'#1E293B'}, headerCopy:{flex:1,paddingHorizontal:10}, title:{color:'#F8FAFC',fontWeight:'900',fontSize:17,letterSpacing:1}, subtitle:{color:'#94A3B8',fontSize:10,marginTop:2}, content:{padding:14,paddingBottom:40}, hero:{backgroundColor:'#07111F',borderWidth:1,borderColor:'#1E3A5F',borderRadius:18,padding:16,marginBottom:14}, heroTop:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}, heroTitle:{color:'#E2E8F0',fontWeight:'900',fontSize:13,flex:1,letterSpacing:.7}, liveState:{fontWeight:'900',fontSize:11}, radarWrap:{alignItems:'center',marginVertical:6}, radar:{width:RADAR_SIZE,height:RADAR_SIZE,borderRadius:RADAR_SIZE/2,backgroundColor:'#020B13',borderWidth:1,borderColor:'#164E63',overflow:'hidden',position:'relative'}, ring:{position:'absolute',borderWidth:1,borderColor:'rgba(56,189,248,0.28)',borderRadius:999}, ringOuter:{width:236,height:236,left:17,top:17}, ringMid:{width:170,height:170,left:50,top:50}, ringInner:{width:96,height:96,left:87,top:87}, crossH:{position:'absolute',height:1,width:RADAR_SIZE,top:RADAR_CENTER,backgroundColor:'rgba(56,189,248,0.20)'}, crossV:{position:'absolute',width:1,height:RADAR_SIZE,left:RADAR_CENTER,backgroundColor:'rgba(56,189,248,0.20)'}, sweep:{position:'absolute',left:RADAR_CENTER-1,top:RADAR_CENTER-RADAR_RADIUS,width:2,height:RADAR_RADIUS,transformOrigin:'bottom'}, sweepBeam:{flex:1,width:2,backgroundColor:'#22C55E',opacity:.7,shadowColor:'#22C55E',shadowOpacity:.8,shadowRadius:8}, centerTarget:{position:'absolute',left:RADAR_CENTER-14,top:RADAR_CENTER-14,width:28,height:28,borderRadius:14,alignItems:'center',justifyContent:'center',backgroundColor:'#0F172A',borderWidth:1,borderColor:'#FBBF24'}, radarDot:{position:'absolute',width:7,height:7,borderRadius:4,borderWidth:1,borderColor:'#020617'}, radarLegend:{alignItems:'center',marginTop:8}, radarLegendTitle:{color:'#38BDF8',fontSize:10,fontWeight:'900',letterSpacing:1}, radarLegendText:{color:'#64748B',fontSize:9,textAlign:'center',marginTop:2}, missionStrip:{gap:8,paddingVertical:10}, statusChip:{minWidth:86,borderWidth:1,borderRadius:10,paddingVertical:7,paddingHorizontal:9,backgroundColor:'#020617'}, statusChipValue:{fontWeight:'900',fontSize:16}, statusChipLabel:{color:'#64748B',fontSize:8,fontWeight:'800',marginTop:1}, metrics:{flexDirection:'row',flexWrap:'wrap',gap:8,marginTop:2}, metric:{width:'30%',minWidth:96,backgroundColor:'#020617',borderRadius:10,padding:10,borderWidth:1,borderColor:'#132238'}, metricValue:{fontSize:20,fontWeight:'900'}, metricLabel:{color:'#64748B',fontSize:10,marginTop:2}, proofMeter:{marginTop:14}, proofMeterHeader:{flexDirection:'row',justifyContent:'space-between',marginBottom:6}, proofMeterLabel:{color:'#64748B',fontSize:9,fontWeight:'900'}, proofMeterValue:{color:'#FBBF24',fontSize:10,fontWeight:'900'}, proofTrack:{height:8,borderRadius:5,backgroundColor:'#020617',overflow:'hidden',borderWidth:1,borderColor:'#1E293B'}, proofFill:{height:'100%',backgroundColor:'#22C55E'}, proofLine:{flexDirection:'row',alignItems:'center',gap:7,marginTop:10}, proofText:{color:'#CBD5E1',fontSize:10,flex:1}, message:{color:'#CBD5E1',padding:16,textAlign:'center'}, alert:{flexDirection:'row',gap:8,backgroundColor:'#2B1116',borderColor:'#7F1D1D',borderWidth:1,borderRadius:12,padding:12,marginBottom:12}, error:{color:'#FCA5A5',flex:1}, section:{marginTop:8}, sectionTitle:{color:'#FBBF24',fontSize:14,fontWeight:'900',letterSpacing:.7}, sectionSub:{color:'#64748B',fontSize:10,marginTop:3,marginBottom:10}, clearPanel:{flexDirection:'row',alignItems:'center',gap:8,padding:12,borderRadius:12,backgroundColor:'#071A13',borderWidth:1,borderColor:'#14532D'}, clearText:{color:'#86EFAC',fontSize:11,flex:1}, alertRow:{flexDirection:'row',alignItems:'center',gap:8,padding:11,borderRadius:11,backgroundColor:'#0F172A',borderWidth:1,borderColor:'#2B3446',marginBottom:7}, alertCopy:{flex:1}, alertName:{color:'#E2E8F0',fontSize:11,fontWeight:'900'}, alertTask:{color:'#94A3B8',fontSize:9,marginTop:2}, alertCode:{fontSize:16,fontWeight:'900'}, card:{backgroundColor:'#0F172A',borderColor:'#1E293B',borderWidth:1,borderRadius:14,padding:13,marginBottom:10}, cardHead:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:10}, dot:{width:9,height:9,borderRadius:5}, identity:{flex:1}, agentName:{color:'#F8FAFC',fontSize:12,fontWeight:'800'}, meta:{color:'#64748B',fontSize:9,marginTop:2}, status:{fontSize:9,fontWeight:'900'}, row:{marginTop:7}, rowLabel:{color:'#64748B',fontSize:8,fontWeight:'900'}, rowValue:{color:'#CBD5E1',fontSize:10,marginTop:2}, counterRow:{flexDirection:'row',flexWrap:'wrap',gap:6,marginTop:10}, mini:{backgroundColor:'#020617',borderRadius:8,paddingHorizontal:8,paddingVertical:6,minWidth:58,alignItems:'center'}, miniValue:{color:'#E2E8F0',fontWeight:'900',fontSize:12}, miniLabel:{color:'#64748B',fontSize:8}, truth:{flexDirection:'row',alignItems:'center',gap:5,marginTop:10}, truthText:{color:'#64748B',fontSize:9},
});
