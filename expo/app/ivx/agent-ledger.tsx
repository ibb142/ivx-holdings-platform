import React, { useCallback } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { getIVXAccessToken, IVX_CANONICAL_API_BASE_URL } from '@/lib/ivx-supabase-client';

type Totals={totalAgents:number;active:number;idle:number;blocked:number;coding:number;testing:number;waitingCi:number;deploying:number;complete:number;commits24h:number;prs24h:number;merges24h:number;deploys24h:number;agentHours24h:number;idleHours24h:number;idleWithSafeBacklog:number};
type Timer={running:boolean;workStartedAt:string|null;workEndedAt:string|null;currentTaskElapsedHours:number;windowStartAt:string;windowEndAt:string;productiveMs24h:number;productiveHours24h:number;idleMs24h:number;idleHours24h:number;measuredAt:string};
type Agent={agentNumber:number;agentId:string;agentName:string;role:string|null;task:string|null;workstream:string;githubRunId:number|null;prNumber:number|null;commitSha:string|null;deployId:string|null;status:string;blocker:string|null;filesChanged:string[];lastCompletedTask:string|null;productiveMs24h:number;idleMs24h:number;qualityState:string;evidenceState:string;timer:Timer};
type AutonomousTimer={id:string;name:string;status:string;running:boolean;workStartedAt:string|null;workEndedAt:string|null;windowStartAt:string;windowEndAt:string;productiveMs24h:number;productiveHours24h:number;idleMs24h:number;idleHours24h:number;coveragePercent24h:number;activeManagedExecutions:number;measuredAt:string;evidencePolicy:string};
type Resp={ok:boolean;marker:string;generatedAt:string;rowCount:number;systemRowCount:number;timerMeasuredAt:string;timerWindow:{startAt:string;endAt:string;durationHours:number};totals:Totals;autonomous:AutonomousTimer;agents:Agent[];policy:string;timerPolicy:string};

const hrs=(ms:number)=>(ms/3600000).toFixed(2);
const sha=(v:string|null)=>v?v.slice(0,8):'—';
const when=(v:string|null)=>v?new Date(v).toLocaleString():'—';

async function fetchLedger():Promise<Resp>{
  const token=await getIVXAccessToken();
  if(!token)throw new Error('Owner session required.');
  const r=await fetch(`${IVX_CANONICAL_API_BASE_URL}/api/ivx/autonomous/agent-ledger`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const b=await r.json().catch(()=>({})) as Partial<Resp>&{error?:string};
  if(!r.ok||b.ok!==true)throw new Error(b.error||`Ledger HTTP ${r.status}`);
  if(b.rowCount!==112||!Array.isArray(b.agents)||b.agents.length!==112)throw new Error('Ledger integrity failure: expected exactly 112 IA rows.');
  if(!b.autonomous)throw new Error('Ledger integrity failure: Autonomous timer missing.');
  return b as Resp;
}

export default function AgentLedgerScreen(){
  const q=useQuery({queryKey:['ivx','agent-ledger','live'],queryFn:fetchLedger,refetchInterval:5000});
  const refresh=useCallback(()=>{void q.refetch()},[q]);
  const d=q.data;
  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={refresh} tintColor={Colors.text}/> }>
    <Text style={s.title}>Autonomous + 112 IA — Real-Time Work Clock</Text>
    <Text style={s.sub}>Rolling 24-hour audit from real dispatcher / worker / workflow evidence. Refreshes every 5 seconds. No synthetic hours.</Text>
    {q.isError?<View style={s.error}><Text style={s.errorText}>{q.error instanceof Error?q.error.message:'Failed to load ledger.'}</Text></View>:null}
    {d?<>
      <View style={s.summary} testID="autonomous-24h-timer">
        <View style={s.row}><Text style={s.agent}>AUTONOMOUS · Manager</Text><Text style={s.status}>{d.autonomous.status}</Text></View>
        <Text style={s.line}>Start {when(d.autonomous.workStartedAt)} · End {d.autonomous.running?'RUNNING':when(d.autonomous.workEndedAt)}</Text>
        <Text style={s.line}>24h productive {d.autonomous.productiveHours24h.toFixed(2)}h · idle {d.autonomous.idleHours24h.toFixed(2)}h · coverage {d.autonomous.coveragePercent24h.toFixed(2)}%</Text>
        <Text style={s.line}>Active managed executions {d.autonomous.activeManagedExecutions}</Text>
        <Text style={s.small}>Window {when(d.timerWindow.startAt)} → {when(d.timerWindow.endAt)}</Text>
      </View>
      <View style={s.summary}>
        <Text style={s.line}>Agents {d.totals.totalAgents} · Active {d.totals.active} · Idle {d.totals.idle} · Blocked {d.totals.blocked}</Text>
        <Text style={s.line}>Coding {d.totals.coding} · Testing {d.totals.testing} · CI {d.totals.waitingCi} · Deploying {d.totals.deploying}</Text>
        <Text style={s.line}>24h productive {d.totals.agentHours24h.toFixed(2)} IA-hours · Idle {d.totals.idleHours24h.toFixed(2)} IA-hours</Text>
        <Text style={s.line}>Commits {d.totals.commits24h} · PRs {d.totals.prs24h} · Merges {d.totals.merges24h} · Deploys {d.totals.deploys24h}</Text>
        <Text style={s.small}>Measured {new Date(d.timerMeasuredAt).toLocaleString()} · {d.marker}</Text>
      </View>
      {d.agents.map(a=><View key={a.agentNumber} style={s.card} testID={`real-ledger-ia-${a.agentNumber}`}>
        <View style={s.row}><Text style={s.agent}>IA-{String(a.agentNumber).padStart(3,'0')} · {a.agentName}</Text><Text style={s.status}>{a.status}</Text></View>
        <Text style={s.small}>{a.role||'role n/a'} · {a.workstream}</Text>
        <Text style={s.task}>Task: {a.task||a.lastCompletedTask||'No measured task'}</Text>
        <Text style={s.line}>Start {when(a.timer.workStartedAt)} · End {a.timer.running?'RUNNING':when(a.timer.workEndedAt)}</Text>
        <Text style={s.line}>Current task {a.timer.currentTaskElapsedHours.toFixed(2)}h · 24h total {a.timer.productiveHours24h.toFixed(2)}h · idle {a.timer.idleHours24h.toFixed(2)}h</Text>
        <Text style={s.small}>Evidence {a.evidenceState} · QA {a.qualityState} · window {when(a.timer.windowStartAt)} → {when(a.timer.windowEndAt)}</Text>
        <Text style={s.small}>Commit {sha(a.commitSha)} · PR {a.prNumber??'—'} · Run {a.githubRunId??'—'} · Deploy {a.deployId??'—'}</Text>
        {a.filesChanged?.length?<Text style={s.small}>Files: {a.filesChanged.slice(0,4).join(', ')}{a.filesChanged.length>4?' …':''}</Text>:null}
        {a.blocker?<Text style={s.blocker}>Blocker: {a.blocker}</Text>:null}
      </View>)}
      <Text style={s.small}>{d.timerPolicy}</Text><Text style={s.small}>{d.policy}</Text>
    </>:<Text style={s.loading}>Loading real production evidence…</Text>}
  </ScrollView>;
}

const s=StyleSheet.create({page:{flex:1,backgroundColor:Colors.background},content:{padding:16,paddingBottom:60},title:{color:Colors.text,fontSize:24,fontWeight:'800'},sub:{color:Colors.muted??'#94a3b8',marginTop:6,marginBottom:14},summary:{backgroundColor:'#15151F',borderColor:'#2A2A38',borderWidth:1,borderRadius:14,padding:14,marginBottom:14},line:{color:Colors.text,fontSize:13,marginTop:5},small:{color:Colors.muted??'#94a3b8',fontSize:12,marginTop:4},card:{backgroundColor:'#11131A',borderColor:'#262A36',borderWidth:1,borderRadius:12,padding:12,marginBottom:10},row:{flexDirection:'row',justifyContent:'space-between',gap:8},agent:{color:Colors.text,fontWeight:'800',fontSize:15,flex:1},status:{color:Colors.primary,fontWeight:'800',fontSize:12},task:{color:Colors.text,fontSize:13,marginTop:7},blocker:{color:Colors.error??'#FF4D4D',fontSize:12,marginTop:6,fontWeight:'700'},loading:{color:Colors.text,paddingVertical:30,textAlign:'center'},error:{backgroundColor:'#351616',padding:12,borderRadius:10,marginBottom:12},errorText:{color:Colors.error??'#FF4D4D',fontWeight:'700'}});