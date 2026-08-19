import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { Activity, Bot, CheckCircle2, CircleAlert, RefreshCw, Search, ShieldCheck, Target, XCircle } from 'lucide-react-native';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import ErrorBoundary from '@/components/ErrorBoundary';
import { getAutonomousOpsDashboard, type AgentStatus, type AutonomousOpsDashboard, type UnifiedAgent } from '@/src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

const POLL_MS = 10000;
const PROGRAM_ID = 'IVX-LANDING-10OF10-2026-08-19';
const GAP_TITLES = [
  'Release integrity single source of truth','Exact deployment proof','Android download consistency','Stripe runtime binding and test-mode E2E','Capability-driven payment UX','Owner login to Home black-screen certification','Registration to investment identity continuity','Authenticated wire end-to-end flow','Git source truthfulness equals production','Verified deal financial claims and disclosures',
  'Information architecture simplification','Hero clarity and conversion','CTA hierarchy','Progressive onboarding','Persistent user state','Loading timeout retry empty offline states','Error taxonomy and recovery UX','WCAG 2.2 AA accessibility','Route-based modal architecture','Mobile thumb-first navigation','Frontend performance budgets','Media and reels loading quality','Core Web Vitals hard gate','Product conversion analytics','Frontend error observability','CloudFront and origin security headers','Central session refresh and expiry handling','Verified structured-data SEO','Deal-specific social previews','Deal discovery search filter sort','Institutional-quality deal detail pages','Trust leadership provenance and SLA','Unified design system','Reduce homepage copy density','Unified vector icon system','Localization truth and RTL readiness','Account-aware support continuity','Native and web contract parity','Premium app install journey','Cross-device QA matrix',
] as const;

const STATUS_COLOR: Record<AgentStatus, string> = {
  ACTIVE: Colors.success, IDLE: Colors.textTertiary, RUNNING: Colors.info, TESTING: Colors.info, DEPLOYING: Colors.info, VERIFYING: Colors.info,
  RETRYING: Colors.warning, BLOCKED: Colors.warning, OWNER_ACTION_REQUIRED: Colors.warning, FAILED: Colors.error, COMPLETED: Colors.success,
};

function gapForAgent(agentNumber: number) { return ((agentNumber - 1) % 40) + 1; }
function isProgramTrace(traceId: string | null | undefined) { return Boolean(traceId?.startsWith('landing10-')); }
function shortened(v: string | null | undefined, max = 54) { if (!v) return '—'; return v.length > max ? `${v.slice(0, max)}…` : v; }

function WorkerCard({ agent }: { agent: UnifiedAgent }) {
  const gap = gapForAgent(agent.agentNumber);
  const programRun = isProgramTrace(agent.traceId);
  const color = STATUS_COLOR[agent.status] ?? Colors.textSecondary;
  return (
    <View style={styles.workerCard} testID={`landing10-worker-${agent.agentNumber}`}>
      <View style={styles.row}>
        <View style={styles.number}><Text style={styles.numberText}>{agent.agentNumber}</Text></View>
        <View style={styles.flex}>
          <Text style={styles.workerName}>{agent.name}</Text>
          <Text style={styles.dept}>{agent.department}</Text>
        </View>
        <View style={[styles.status, { borderColor: color }]}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={[styles.statusText, { color }]}>{agent.status}</Text></View>
      </View>
      <View style={styles.assignment}>
        <Target size={14} color={Colors.primary} />
        <View style={styles.flex}>
          <Text style={styles.assignmentLabel}>ASSIGNED GAP #{gap}</Text>
          <Text style={styles.assignmentText}>{GAP_TITLES[gap - 1]}</Text>
        </View>
      </View>
      <Text style={styles.small}>Program run: {programRun ? 'YES — durable program task recorded' : 'Awaiting/previous fleet evidence'}</Text>
      <Text style={styles.small}>Current/last work: {agent.currentTask ?? 'No execution recorded'}</Text>
      <Text style={styles.small}>Trace: {shortened(agent.traceId)}</Text>
      <Text style={styles.small}>Tool: {agent.lastToolUsed ?? '—'}</Text>
      <Text style={styles.small}>Source: {shortened(agent.lastSourceReference)}</Text>
      <Text style={styles.small}>Evidence SHA: {shortened(agent.lastEvidenceSha, 38)}</Text>
    </View>
  );
}

function Landing10Dashboard() {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const query = useQuery<AutonomousOpsDashboard>({
    queryKey: ['landing-10of10-autonomous-112'],
    queryFn: () => getAutonomousOpsDashboard({ range: '24h' }),
    refetchInterval: POLL_MS,
  });
  const data = query.data;
  const agents = data?.agents ?? [];
  const programAgents = agents.filter((a) => isProgramTrace(a.traceId));
  const running = agents.filter((a) => a.status === 'RUNNING').length;
  const failed = agents.filter((a) => a.status === 'FAILED').length;
  const blocked = agents.filter((a) => a.status === 'BLOCKED' || a.status === 'OWNER_ACTION_REQUIRED').length;
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) => {
      const gap = gapForAgent(a.agentNumber);
      return String(a.agentNumber) === q || a.name.toLowerCase().includes(q) || a.department.toLowerCase().includes(q) || String(gap) === q || GAP_TITLES[gap - 1].toLowerCase().includes(q);
    });
  }, [agents, search]);

  return (
    <>
      <Stack.Screen options={{ title: 'Landing 10/10 • 112 IA', headerShown: true }} />
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={() => void query.refetch()} tintColor={Colors.primary} />}>
        <View style={styles.hero}>
          <View style={styles.row}>
            <Bot size={24} color={Colors.primary} />
            <View style={styles.flex}><Text style={styles.title}>Landing 10/10 Autonomous Program</Text><Text style={styles.subtitle}>{PROGRAM_ID} · real durable fleet evidence · refresh every 10 seconds</Text></View>
            <View style={styles.live}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>
          </View>
          <View style={styles.notice}><ShieldCheck size={16} color={Colors.success} /><Text style={styles.noticeText}>112 assignments are deterministic across 40 gaps. “PASS” is shown only from real runtime evidence; assignment alone is not completion.</Text></View>
          <View style={styles.metrics}>
            <View style={styles.metric}><Text style={styles.metricValue}>{agents.length || '—'}</Text><Text style={styles.metricLabel}>Registry</Text></View>
            <View style={styles.metric}><Text style={styles.metricValue}>{programAgents.length}</Text><Text style={styles.metricLabel}>Program traces</Text></View>
            <View style={styles.metric}><Text style={[styles.metricValue, { color: Colors.info }]}>{running}</Text><Text style={styles.metricLabel}>Running</Text></View>
            <View style={styles.metric}><Text style={[styles.metricValue, failed ? { color: Colors.error } : null]}>{failed}</Text><Text style={styles.metricLabel}>Failed</Text></View>
            <View style={styles.metric}><Text style={[styles.metricValue, blocked ? { color: Colors.warning } : null]}>{blocked}</Text><Text style={styles.metricLabel}>Blocked</Text></View>
          </View>
          <Text style={styles.small}>Backend SHA: {data?.backendCommitSha ?? 'unavailable'} · Commit match: {data?.commitMatch ? 'YES' : 'NO/UNKNOWN'} · Durable executions: {data?.enterprise112?.durableExecutionCount ?? '—'}</Text>
        </View>

        <View style={styles.search}><Search size={17} color={Colors.textSecondary} /><TextInput value={search} onChangeText={setSearch} placeholder="Agent, department, gap # or gap title" placeholderTextColor={Colors.textTertiary} style={styles.searchInput} /><Pressable onPress={() => void query.refetch()}><RefreshCw size={17} color={Colors.primary} /></Pressable></View>

        {query.isError ? <View style={styles.error}><XCircle size={18} color={Colors.error} /><Text style={styles.errorText}>{query.error instanceof Error ? query.error.message : 'Live dashboard request failed'}</Text></View> : null}

        <View style={styles.sectionRow}><Activity size={18} color={Colors.primary} /><Text style={styles.sectionTitle}>112 IA assignments ({shown.length} shown)</Text></View>
        {shown.map((agent) => <WorkerCard key={agent.agentId} agent={agent} />)}

        <View style={styles.sectionRow}><CheckCircle2 size={18} color={Colors.success} /><Text style={styles.sectionTitle}>Program truth gate</Text></View>
        <View style={styles.truth}><CircleAlert size={16} color={Colors.warning} /><Text style={styles.truthText}>This dashboard reports real agent executions and evidence. It does not claim that a gap is fixed merely because an agent audited it. Final 10/10 still requires the exact-SHA product gates: auth, registration, payments, wire, Android Home, accessibility, performance, health and version parity.</Text></View>
      </ScrollView>
    </>
  );
}

export default function Landing10of10Screen() { return <ErrorBoundary><Landing10Dashboard /></ErrorBoundary>; }

const styles = StyleSheet.create({
  screen:{flex:1,backgroundColor:Colors.background},content:{padding:14,gap:12},flex:{flex:1},row:{flexDirection:'row',alignItems:'center',gap:9},
  hero:{backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:18,padding:16,gap:12},title:{fontSize:18,fontWeight:'800',color:Colors.text},subtitle:{fontSize:11,color:Colors.textSecondary,marginTop:3,lineHeight:16},
  live:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderColor:Colors.success,borderRadius:999,paddingHorizontal:8,paddingVertical:5},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:Colors.success},liveText:{fontSize:10,fontWeight:'800',color:Colors.success},
  notice:{flexDirection:'row',alignItems:'flex-start',gap:8,backgroundColor:Colors.background,borderRadius:12,padding:10},noticeText:{flex:1,fontSize:11,color:Colors.textSecondary,lineHeight:16},metrics:{flexDirection:'row',flexWrap:'wrap',gap:7},metric:{minWidth:66,flexGrow:1,backgroundColor:Colors.background,borderRadius:10,padding:9},metricValue:{fontSize:18,fontWeight:'800',color:Colors.text},metricLabel:{fontSize:9,color:Colors.textSecondary,marginTop:2},
  search:{flexDirection:'row',alignItems:'center',gap:8,backgroundColor:Colors.surface,borderWidth:1,borderColor:Colors.border,borderRadius:13,paddingHorizontal:12},searchInput:{flex:1,color:Colors.text,paddingVertical:11,fontSize:13},sectionRow:{flexDirection:'row',alignItems:'center',gap:7,marginTop:3},sectionTitle:{fontSize:15,fontWeight:'800',color:Colors.text},
  workerCard:{backgroundColor:Colors.surface,borderRadius:15,padding:14,borderWidth:1,borderColor:Colors.border,gap:8},number:{width:34,height:34,borderRadius:10,alignItems:'center',justifyContent:'center',backgroundColor:Colors.background},numberText:{fontSize:12,fontWeight:'800',color:Colors.primary},workerName:{fontSize:14,fontWeight:'800',color:Colors.text},dept:{fontSize:10,color:Colors.textSecondary,marginTop:2},status:{flexDirection:'row',alignItems:'center',gap:5,borderWidth:1,borderRadius:999,paddingHorizontal:8,paddingVertical:5},dot:{width:6,height:6,borderRadius:3},statusText:{fontSize:9,fontWeight:'800'},
  assignment:{flexDirection:'row',alignItems:'flex-start',gap:8,backgroundColor:Colors.background,borderRadius:11,padding:10},assignmentLabel:{fontSize:9,fontWeight:'800',color:Colors.primary},assignmentText:{fontSize:12,color:Colors.text,lineHeight:17,marginTop:2},small:{fontSize:10,color:Colors.textSecondary,lineHeight:15},
  error:{flexDirection:'row',alignItems:'center',gap:8,padding:12,backgroundColor:Colors.surface,borderRadius:12,borderWidth:1,borderColor:Colors.error},errorText:{flex:1,color:Colors.error,fontSize:12},truth:{flexDirection:'row',alignItems:'flex-start',gap:8,padding:12,backgroundColor:Colors.surface,borderRadius:12,borderWidth:1,borderColor:Colors.border},truthText:{flex:1,fontSize:11,color:Colors.textSecondary,lineHeight:17},
});
