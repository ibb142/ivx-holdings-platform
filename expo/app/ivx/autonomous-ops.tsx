import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack, useRouter } from 'expo-router';
import { Activity, Bot, CheckCircle2, Clock3, Database, RefreshCw, Search, ShieldCheck, XCircle, Zap } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import ErrorBoundary from '@/components/ErrorBoundary';
import {
  getAutonomousOpsDashboard,
  type AgentStatus,
  type AutonomousOpsDashboard,
  type DateRange,
  type UnifiedAgent,
} from '@/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

const POLL_MS = 1000;
const HEARTBEAT_LIVE_MS = 5000;
const HEARTBEAT_WARM_MS = 15000;
const HEARTBEAT_STALE_MS = 60000;

const RANGES: Array<{ key: DateRange; label: string }> = [
  { key: '24h', label: '24 Hours' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

const STATUS_COLOR: Record<AgentStatus, string> = {
  ACTIVE: Colors.success,
  IDLE: Colors.textTertiary,
  RUNNING: Colors.info,
  TESTING: Colors.info,
  DEPLOYING: Colors.info,
  VERIFYING: Colors.info,
  RETRYING: Colors.warning,
  BLOCKED: Colors.warning,
  OWNER_ACTION_REQUIRED: Colors.warning,
  FAILED: Colors.error,
  COMPLETED: Colors.success,
};

type HeartbeatState = 'LIVE' | 'WARM' | 'STALE' | 'OFFLINE';

function heartbeatAgeMs(iso: string | null | undefined, nowMs: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, nowMs - t);
}

function heartbeatState(iso: string | null | undefined, nowMs: number): HeartbeatState {
  const age = heartbeatAgeMs(iso, nowMs);
  if (age === null || age > HEARTBEAT_STALE_MS) return 'OFFLINE';
  if (age <= HEARTBEAT_LIVE_MS) return 'LIVE';
  if (age <= HEARTBEAT_WARM_MS) return 'WARM';
  return 'STALE';
}

function heartbeatLabel(iso: string | null | undefined, nowMs: number): string {
  const age = heartbeatAgeMs(iso, nowMs);
  if (age === null) return 'no heartbeat';
  if (age < 1000) return '<1s';
  const seconds = Math.floor(age / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

function heartbeatColor(state: HeartbeatState): string {
  if (state === 'LIVE') return Colors.success;
  if (state === 'WARM') return Colors.info;
  if (state === 'STALE') return Colors.warning;
  return Colors.error;
}

function when(iso: string | null): string {
  if (!iso) return 'No recorded activity';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function duration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 1000) return `${ms} ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${seconds % 60}s`;
}
function shorten(value: string | null | undefined, max = 68): string {
  if (!value) return '—';
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

function Kpi({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <View style={styles.kpi}>
      <Text style={[styles.kpiValue, accent ? { color: accent } : null]}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function AgentRadarCell({ agent, nowMs }: { agent: UnifiedAgent; nowMs: number }) {
  const heartbeat = heartbeatState(agent.lastActivityTime, nowMs);
  const color = heartbeatColor(heartbeat);
  const working = agent.status === 'RUNNING' || agent.status === 'TESTING' || agent.status === 'DEPLOYING' || agent.status === 'VERIFYING' || agent.status === 'RETRYING';
  return (
    <View style={[styles.radarCell, { borderColor: color }]} testID={`agent-radar-${agent.agentNumber}`}>
      <View style={styles.radarTop}>
        <Text style={styles.radarNumber}>{agent.agentNumber}</Text>
        <View style={[styles.radarDot, { backgroundColor: color }]} />
      </View>
      <Text numberOfLines={1} style={styles.radarName}>{agent.name}</Text>
      <Text numberOfLines={1} style={[styles.radarState, { color }]}>{heartbeat} · {heartbeatLabel(agent.lastActivityTime, nowMs)}</Text>
      <Text numberOfLines={2} style={styles.radarTask}>{working ? agent.currentTask ?? agent.status : agent.status}</Text>
    </View>
  );
}

function AgentCard({ agent, nowMs }: { agent: UnifiedAgent; nowMs: number }) {
  const statusColor = STATUS_COLOR[agent.status] ?? Colors.textTertiary;
  const heartbeat = heartbeatState(agent.lastActivityTime, nowMs);
  const hbColor = heartbeatColor(heartbeat);
  return (
    <View style={styles.agentCard} testID={`enterprise-agent-${agent.agentNumber}`}>
      <View style={styles.agentTop}>
        <View style={styles.numberBadge}><Text style={styles.numberText}>{agent.agentNumber}</Text></View>
        <View style={styles.agentIdentity}>
          <Text style={styles.agentName}>{agent.name}</Text>
          <Text style={styles.agentDept}>{agent.department}</Text>
        </View>
        <View style={[styles.statusPill, { borderColor: statusColor }]}>
          <View style={[styles.dot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{agent.status}</Text>
        </View>
      </View>

      <View style={styles.heartbeatRow}>
        <View style={[styles.heartbeatDot, { backgroundColor: hbColor }]} />
        <Text style={[styles.heartbeatText, { color: hbColor }]}>{heartbeat}</Text>
        <Text style={styles.heartbeatAge}>heartbeat {heartbeatLabel(agent.lastActivityTime, nowMs)} ago</Text>
      </View>

      <Text style={styles.role}>{agent.primaryResponsibility}</Text>
      <View style={styles.currentBox}>
        <Activity size={14} color={Colors.info} />
        <View style={styles.flex}>
          <Text style={styles.currentLabel}>{agent.status === 'RUNNING' ? 'CURRENT WORK' : 'LAST WORK'}</Text>
          <Text style={styles.currentTask}>{agent.currentTask ?? 'No durable execution recorded in this window.'}</Text>
        </View>
      </View>

      <View style={styles.metricRow}>
        <Kpi label="Started" value={agent.tasksStartedToday} />
        <Kpi label="Done" value={agent.tasksCompletedToday} accent={Colors.success} />
        <Kpi label="Failed" value={agent.tasksFailedToday} accent={agent.tasksFailedToday ? Colors.error : undefined} />
        <Kpi label="Blocked" value={agent.tasksBlockedToday} accent={agent.tasksBlockedToday ? Colors.warning : undefined} />
      </View>

      <View style={styles.evidenceBox}>
        <Text style={styles.evidenceLine}>Last activity: {when(agent.lastActivityTime)}</Text>
        <Text style={styles.evidenceLine}>Execution time: {duration(agent.totalExecutionTimeMs)} · Success: {agent.successRate === null ? '—' : `${agent.successRate}%`}</Text>
        <Text style={styles.evidenceLine}>Health: {agent.health ?? 'unknown'} · Availability: {agent.availability ?? 'unknown'}</Text>
        <Text style={styles.evidenceLine}>Tool: {agent.lastToolUsed ?? '—'}</Text>
        <Text style={styles.evidenceLine}>Source: {shorten(agent.lastSourceReference)}</Text>
        <Text style={styles.evidenceLine}>Evidence SHA: {shorten(agent.lastEvidenceSha, 40)}</Text>
        <Text style={styles.evidenceLine}>Trace: {shorten(agent.traceId, 48)}</Text>
      </View>
    </View>
  );
}

function EnterpriseAutonomousDashboard() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [range, setRange] = useState<DateRange>('24h');
  const [search, setSearch] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const query = useQuery<AutonomousOpsDashboard>({
    queryKey: ['enterprise-autonomous-dashboard-112', range],
    queryFn: () => getAutonomousOpsDashboard({ range }),
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: true,
  });
  const data = query.data;

  const agents = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = data?.agents ?? [];
    if (!q) return rows;
    return rows.filter((a) => String(a.agentNumber) === q || a.agentId.toLowerCase().includes(q) || a.name.toLowerCase().includes(q) || a.department.toLowerCase().includes(q));
  }, [data?.agents, search]);

  const heartbeatCounts = useMemo(() => {
    const result: Record<HeartbeatState, number> = { LIVE: 0, WARM: 0, STALE: 0, OFFLINE: 0 };
    for (const agent of data?.agents ?? []) result[heartbeatState(agent.lastActivityTime, nowMs)] += 1;
    return result;
  }, [data?.agents, nowMs]);

  const running = data?.agents.filter((a) => a.status === 'RUNNING').length ?? 0;
  const failed = data?.agents.filter((a) => a.status === 'FAILED').length ?? 0;
  const blocked = data?.agents.filter((a) => a.status === 'BLOCKED' || a.status === 'OWNER_ACTION_REQUIRED').length ?? 0;
  const rolling = data?.rolling24h;
  const enterprise = data?.enterprise112;

  return (
    <>
      <Stack.Screen options={{ title: '112 IA Live Radar', headerShown: true }} />
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}
        refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={Colors.primary} />}
      >
        <View style={styles.hero}>
          <View style={styles.heroTitleRow}>
            <Bot size={22} color={Colors.primary} />
            <View style={styles.flex}>
              <Text style={styles.title}>IVX Live AI Operations Radar · 112</Text>
              <Text style={styles.subtitle}>Real agent heartbeat + durable execution telemetry · refreshes every 1 second · no simulated activity</Text>
            </View>
            <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>1s LIVE</Text></View>
          </View>

          {enterprise ? (
            <View style={styles.ledgerBanner}>
              {enterprise.ledgerOk ? <ShieldCheck size={16} color={Colors.success} /> : <XCircle size={16} color={Colors.error} />}
              <Text style={styles.ledgerText}>
                Registry {enterprise.registryCount}/112 · Durable states {enterprise.durableStateCount}/112 · Executions stored {enterprise.durableExecutionCount} · {enterprise.storeMode}
              </Text>
            </View>
          ) : null}

          <View style={styles.heroMetrics}>
            <Kpi label="Agents" value={data?.agents.length ?? '—'} />
            <Kpi label="Running" value={running} accent={Colors.info} />
            <Kpi label="Heartbeat LIVE" value={heartbeatCounts.LIVE} accent={Colors.success} />
            <Kpi label="Warm" value={heartbeatCounts.WARM} accent={Colors.info} />
            <Kpi label="Stale" value={heartbeatCounts.STALE} accent={heartbeatCounts.STALE ? Colors.warning : undefined} />
            <Kpi label="Offline" value={heartbeatCounts.OFFLINE} accent={heartbeatCounts.OFFLINE ? Colors.error : undefined} />
          </View>
        </View>

        <Pressable
          style={styles.ledgerTile}
          testID="open-112-production-ledger"
          accessibilityRole="button"
          accessibilityLabel="Open 112 IA Real Production Ledger"
          onPress={() => router.push('/ivx/agent-ledger')}
        >
          <Database size={20} color={Colors.primary} />
          <View style={styles.ledgerTileText}>
            <Text style={styles.ledgerTileTitle}>112 IA Real Production Ledger</Text>
            <Text style={styles.ledgerTileSubtitle}>IA-by-IA work, productive time, status and proof evidence</Text>
          </View>
        </Pressable>

        <View style={styles.radarPanel}>
          <View style={styles.sectionTitleRow}>
            <Activity size={18} color={Colors.primary} />
            <Text style={styles.sectionTitle}>112 IA Radar</Text>
          </View>
          <Text style={styles.smallText}>LIVE ≤5s · WARM ≤15s · STALE ≤60s · OFFLINE &gt;60s/no heartbeat. Every marker is derived from a real backend heartbeat or durable execution record.</Text>
          <View style={styles.radarGrid}>
            {(data?.agents ?? []).map((agent) => <AgentRadarCell key={`radar-${agent.agentId}`} agent={agent} nowMs={nowMs} />)}
          </View>
        </View>

        <View style={styles.rangeRow}>
          {RANGES.map((item) => (
            <Pressable key={item.key} onPress={() => setRange(item.key)} style={[styles.rangeButton, range === item.key && styles.rangeButtonActive]}>
              <Text style={[styles.rangeText, range === item.key && styles.rangeTextActive]}>{item.label}</Text>
            </Pressable>
          ))}
        </View>

        {rolling ? (
          <View style={styles.summaryCard}>
            <View style={styles.sectionTitleRow}><Clock3 size={17} color={Colors.primary} /><Text style={styles.sectionTitle}>Execution ledger — {data?.dateRange.label}</Text></View>
            <View style={styles.metricRow}>
              <Kpi label="Started" value={rolling.tasksStarted} />
              <Kpi label="Completed" value={rolling.tasksCompleted} accent={Colors.success} />
              <Kpi label="Running" value={rolling.tasksRunning} accent={Colors.info} />
              <Kpi label="Failed" value={rolling.tasksFailed} accent={rolling.tasksFailed ? Colors.error : undefined} />
            </View>
            <Text style={styles.smallText}>Proof-bearing executions: {rolling.proofEntries} · Owner actions required: {rolling.ownerActionsRequired}</Text>
          </View>
        ) : null}

        <View style={styles.searchBox}>
          <Search size={17} color={Colors.textSecondary} />
          <TextInput value={search} onChangeText={setSearch} placeholder="Search IA number, name, ID or department" placeholderTextColor={Colors.textTertiary} style={styles.searchInput} autoCapitalize="none" />
          <Pressable onPress={() => void query.refetch()}><RefreshCw size={17} color={Colors.primary} /></Pressable>
        </View>

        {query.isError ? (
          <View style={styles.errorCard}><XCircle size={18} color={Colors.error} /><Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Dashboard request failed.'}</Text></View>
        ) : null}

        <View style={styles.sectionTitleRow}>
          <Bot size={18} color={Colors.primary} />
          <Text style={styles.sectionTitle}>112 IA Fleet ({agents.length} shown)</Text>
        </View>
        {agents.map((agent) => <AgentCard key={agent.agentId} agent={agent} nowMs={nowMs} />)}

        <View style={styles.sectionTitleRow}>
          <Zap size={18} color={Colors.primary} />
          <Text style={styles.sectionTitle}>Recent durable executions</Text>
        </View>
        {(data?.activityItems ?? []).slice(0, 100).map((item) => (
          <View key={`${item.traceId}-${item.itemNumber}`} style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <Text style={styles.activityAgent}>{item.agent}</Text>
              <Text style={[styles.activityStatus, { color: STATUS_COLOR[item.status] ?? Colors.textSecondary }]}>{item.status}</Text>
            </View>
            <Text style={styles.activityTask}>{item.task}</Text>
            <Text style={styles.smallText}>{item.actionExecuted}</Text>
            <Text style={styles.smallText}>Started: {when(item.startTime)} · Duration: {duration(item.durationMs)}</Text>
            <View style={styles.proofRow}><Database size={12} color={Colors.textSecondary} /><Text style={styles.proofText}>{shorten(item.evidence, 120)}</Text></View>
            {item.error ? <Text style={styles.errorInline}>{item.error}</Text> : null}
          </View>
        ))}

        <View style={styles.footerProof}>
          <CheckCircle2 size={14} color={Colors.success} />
          <Text style={styles.footerText}>{data?.disclaimer ?? 'Loading durable proof ledger…'}</Text>
        </View>
      </ScrollView>
    </>
  );
}

export default function AutonomousOpsScreen() {
  return <ErrorBoundary><EnterpriseAutonomousDashboard /></ErrorBoundary>;
}

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.background},content:{padding:14,gap:12},flex:{flex:1},
  hero:{backgroundColor:Colors.surface,borderRadius:18,padding:16,borderWidth:1,borderColor:Colors.border,gap:14},
  heroTitleRow:{flexDirection:'row',alignItems:'center',gap:10},title:{fontSize:18,fontWeight:'800',color:Colors.text},subtitle:{fontSize:12,color:Colors.textSecondary,marginTop:3,lineHeight:17},
  livePill:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderColor:Colors.success,borderRadius:999,paddingHorizontal:8,paddingVertical:5},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:Colors.success},liveText:{fontSize:10,fontWeight:'800',color:Colors.success},
  ledgerBanner:{flexDirection:'row',alignItems:'center',gap:8,padding:10,borderRadius:12,backgroundColor:Colors.background},ledgerText:{flex:1,fontSize:12,color:Colors.textSecondary,lineHeight:17},
  heroMetrics:{flexDirection:'row',flexWrap:'wrap',gap:8},kpi:{minWidth:72,flexGrow:1,backgroundColor:Colors.background,borderRadius:10,padding:9},kpiValue:{fontSize:18,fontWeight:'800',color:Colors.text},kpiLabel:{fontSize:10,color:Colors.textSecondary,marginTop:2},
  ledgerTile:{flexDirection:'row',alignItems:'center',gap:11,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.primary,borderRadius:15,padding:14},ledgerTileText:{flex:1,gap:2},ledgerTileTitle:{fontSize:14,fontWeight:'800',color:Colors.primary},ledgerTileSubtitle:{fontSize:11,color:Colors.textSecondary,lineHeight:15},
  radarPanel:{backgroundColor:Colors.surface,borderRadius:15,padding:12,borderWidth:1,borderColor:Colors.border,gap:10},radarGrid:{flexDirection:'row',flexWrap:'wrap',gap:6},radarCell:{width:'23.5%',minWidth:72,borderWidth:1,borderRadius:10,padding:7,backgroundColor:Colors.background,gap:3},radarTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:4},radarNumber:{fontSize:11,fontWeight:'900',color:Colors.text},radarDot:{width:7,height:7,borderRadius:4},radarName:{fontSize:9.5,fontWeight:'700',color:Colors.text},radarState:{fontSize:8.5,fontWeight:'800'},radarTask:{fontSize:8.5,color:Colors.textSecondary,lineHeight:11},
  rangeRow:{flexDirection:'row',gap:7,flexWrap:'wrap'},rangeButton:{paddingHorizontal:12,paddingVertical:8,borderRadius:999,borderWidth:1,borderColor:Colors.border,backgroundColor:Colors.surface},rangeButtonActive:{borderColor:Colors.primary},rangeText:{fontSize:12,color:Colors.textSecondary},rangeTextActive:{color:Colors.primary,fontWeight:'700'},
  summaryCard:{backgroundColor:Colors.surface,borderRadius:15,padding:14,borderWidth:1,borderColor:Colors.border,gap:10},sectionTitleRow:{flexDirection:'row',alignItems:'center',gap:7,marginTop:3},sectionTitle:{fontSize:15,fontWeight:'800',color:Colors.text},metricRow:{flexDirection:'row',flexWrap:'wrap',gap:7},smallText:{fontSize:11,color:Colors.textSecondary,lineHeight:16},
  searchBox:{flexDirection:'row',alignItems:'center',gap:9,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:13,paddingHorizontal:12},searchInput:{flex:1,color:Colors.text,paddingVertical:11,fontSize:13},
  agentCard:{backgroundColor:Colors.surface,borderRadius:15,padding:14,borderWidth:1,borderColor:Colors.border,gap:10},agentTop:{flexDirection:'row',alignItems:'center',gap:9},numberBadge:{width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:Colors.background},numberText:{fontSize:12,fontWeight:'800',color:Colors.primary},agentIdentity:{flex:1},agentName:{fontSize:14,fontWeight:'800',color:Colors.text},agentDept:{fontSize:11,color:Colors.textSecondary,marginTop:2},statusPill:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderRadius:999,paddingHorizontal:8,paddingVertical:5},dot:{width:6,height:6,borderRadius:3},statusText:{fontSize:9,fontWeight:'800'},role:{fontSize:12,color:Colors.textSecondary,lineHeight:17},
  heartbeatRow:{flexDirection:'row',alignItems:'center',gap:6},heartbeatDot:{width:8,height:8,borderRadius:4},heartbeatText:{fontSize:10,fontWeight:'900'},heartbeatAge:{fontSize:10,color:Colors.textSecondary},
  currentBox:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:10,borderRadius:11,backgroundColor:Colors.background},currentLabel:{fontSize:9,fontWeight:'800',color:Colors.info,marginBottom:3},currentTask:{fontSize:12,color:Colors.text,lineHeight:17},evidenceBox:{gap:3},evidenceLine:{fontSize:10.5,color:Colors.textSecondary,lineHeight:15},
  activityCard:{backgroundColor:Colors.surface,borderRadius:13,padding:12,borderWidth:1,borderColor:Colors.border,gap:5},activityHeader:{flexDirection:'row',justifyContent:'space-between',gap:8},activityAgent:{flex:1,fontSize:12,fontWeight:'800',color:Colors.text},activityStatus:{fontSize:10,fontWeight:'800'},activityTask:{fontSize:12,color:Colors.text,lineHeight:17},proofRow:{flexDirection:'row',alignItems:'flex-start',gap:6},proofText:{flex:1,fontSize:10,color:Colors.textSecondary,lineHeight:15},errorInline:{fontSize:10,color:Colors.error,lineHeight:15},
  errorCard:{flexDirection:'row',gap:8,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.error,borderRadius:12,padding:12},errorText:{flex:1,fontSize:11,color:Colors.error,lineHeight:16},footerProof:{flexDirection:'row',alignItems:'flex-start',gap:7,padding:12},footerText:{flex:1,fontSize:10,color:Colors.textSecondary,lineHeight:15},
});