import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View, Text, StyleSheet, RefreshControl, Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import Colors from '@/constants/colors';
import { getIVXAccessToken, IVX_CANONICAL_API_BASE_URL } from '@/lib/ivx-supabase-client';

type Totals={totalAgents:number;active:number;idle:number;blocked:number;coding:number;testing:number;waitingCi:number;deploying:number;complete:number;commits24h:number;prs24h:number;merges24h:number;deploys24h:number;agentHours24h:number;idleHours24h:number;idleWithSafeBacklog:number};
type Agent={agentNumber:number;agentId:string;agentName:string;role:string|null;task:string|null;workstream:string;githubRunId:number|null;prNumber:number|null;commitSha:string|null;deployId:string|null;status:string;blocker:string|null;filesChanged:string[];lastCompletedTask:string|null;productiveMs24h:number;idleMs24h:number;qualityState:string;evidenceState:string};
type Resp={ok:boolean;marker:string;generatedAt:string;rowCount:number;totals:Totals;agents:Agent[];policy:string};

type Filter='ALL'|'WORKING'|'BLOCKED'|'IDLE'|'UNVERIFIED';
const hrs=(ms:number)=>(ms/3600000).toFixed(2);
const sha=(v:string|null)=>v?v.slice(0,8):'—';
const isWorking=(s:string)=>['ASSIGNED','CODING','TESTING','PR_OPEN','CI','MERGING','DEPLOYING','VERIFYING'].includes(s);
const proofLabel=(a:Agent)=>a.evidenceState==='FULL'?'VERIFIED':a.evidenceState==='PARTIAL'?'PARTIAL':'NO PROOF';
const verifiedHours=(a:Agent)=>a.evidenceState==='FULL'?a.productiveMs24h:0;

async function fetchLedger():Promise<Resp>{
  const token=await getIVXAccessToken();
  if(!token)throw new Error('Owner session required.');
  const r=await fetch(`${IVX_CANONICAL_API_BASE_URL}/api/ivx/autonomous/agent-ledger`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'}});
  const b=await r.json().catch(()=>({})) as Partial<Resp>&{error?:string};
  if(!r.ok||b.ok!==true)throw new Error(b.error||`Ledger HTTP ${r.status}`);
  if(b.rowCount!==112||!Array.isArray(b.agents)||b.agents.length!==112)throw new Error('Ledger integrity failure: expected exactly 112 IA rows.');
  return b as Resp;
}

export default function AgentLedgerScreen(){
  const [filter,setFilter]=useState<Filter>('ALL');
  const q=useQuery({queryKey:['ivx','agent-ledger','live'],queryFn:fetchLedger,refetchInterval:15000});
  const refresh=useCallback(()=>{void q.refetch()},[q]);
  const d=q.data;
  const verifiedTotal=useMemo(()=>d?d.agents.reduce((sum,a)=>sum+verifiedHours(a),0):0,[d]);
  const fullProof=useMemo(()=>d?d.agents.filter(a=>a.evidenceState==='FULL').length:0,[d]);
  const partialProof=useMemo(()=>d?d.agents.filter(a=>a.evidenceState==='PARTIAL').length:0,[d]);
  const noProof=useMemo(()=>d?d.agents.filter(a=>a.evidenceState==='MISSING').length:0,[d]);
  const visible=useMemo(()=>{
    if(!d)return [];
    if(filter==='WORKING')return d.agents.filter(a=>isWorking(a.status));
    if(filter==='BLOCKED')return d.agents.filter(a=>a.status==='BLOCKED');
    if(filter==='IDLE')return d.agents.filter(a=>a.status==='IDLE');
    if(filter==='UNVERIFIED')return d.agents.filter(a=>a.evidenceState!=='FULL');
    return d.agents;
  },[d,filter]);
  const certificateGreen=Boolean(d&&d.rowCount===112&&noProof===0&&d.totals.blocked===0);

  return <ScrollView style={s.page} contentContainerStyle={s.content} refreshControl={<RefreshControl refreshing={q.isFetching} onRefresh={refresh} tintColor={Colors.text}/>}>
    <Text style={s.title}>112 IA — Production Control</Text>
    <Text style={s.sub}>Owner-only. Every agent must be traceable to real execution evidence. Queued/idle time is never counted as verified production.</Text>

    {q.isError?<View style={s.error}><Text style={s.errorText}>{q.error instanceof Error?q.error.message:'Failed to load ledger.'}</Text></View>:null}

    {d?<>
      <View style={[s.cert,certificateGreen?s.certGreen:s.certRed]}>
        <Text style={s.certTitle}>{certificateGreen?'PRODUCTION CERTIFICATE: GREEN':'PRODUCTION CERTIFICATE: NOT GREEN'}</Text>
        <Text style={s.certText}>112 rows required · FULL evidence required · 0 blocked required</Text>
      </View>

      <View style={s.summary}>
        <View style={s.metricRow}><Metric label="Total" value="112"/><Metric label="Working" value={String(d.totals.active)}/><Metric label="Blocked" value={String(d.totals.blocked)}/><Metric label="Idle" value={String(d.totals.idle)}/></View>
        <View style={s.metricRow}><Metric label="Verified 24h" value={`${hrs(verifiedTotal)}h`}/><Metric label="Raw spans" value={`${d.totals.agentHours24h.toFixed(2)}h`}/><Metric label="FULL proof" value={String(fullProof)}/><Metric label="No proof" value={String(noProof)}/></View>
        <Text style={s.line}>Coding {d.totals.coding} · Testing {d.totals.testing} · CI {d.totals.waitingCi} · Deploying {d.totals.deploying}</Text>
        <Text style={s.line}>Commits {d.totals.commits24h} · PRs {d.totals.prs24h} · Merges {d.totals.merges24h} · Deploys {d.totals.deploys24h}</Text>
        <Text style={s.small}>Evidence: FULL {fullProof} · PARTIAL {partialProof} · MISSING {noProof}</Text>
        <Text style={s.small}>Generated {new Date(d.generatedAt).toLocaleString()} · {d.marker}</Text>
      </View>

      <View style={s.filters}>{(['ALL','WORKING','BLOCKED','IDLE','UNVERIFIED'] as Filter[]).map(v=><Pressable key={v} onPress={()=>setFilter(v)} style={[s.filter,filter===v&&s.filterActive]}><Text style={[s.filterText,filter===v&&s.filterTextActive]}>{v}</Text></Pressable>)}</View>
      <Text style={s.section}>Agents {visible.length}/112</Text>

      {visible.map(a=>{
        const verified=a.evidenceState==='FULL';
        const working=isWorking(a.status);
        return <View key={a.agentNumber} style={[s.card,a.status==='BLOCKED'&&s.cardBlocked]} testID={`real-ledger-ia-${a.agentNumber}`}>
          <View style={s.row}><Text style={s.agent}>IA-{String(a.agentNumber).padStart(3,'0')} · {a.agentName}</Text><Text style={[s.status,a.status==='BLOCKED'&&s.bad]}>{a.status}</Text></View>
          <Text style={s.small}>{a.role||'role n/a'} · {a.workstream}</Text>
          <Text style={s.task}>Task: {a.task||a.lastCompletedTask||'No measured task'}</Text>
          <View style={s.proofRow}><Text style={[s.proof,verified?s.good:a.evidenceState==='PARTIAL'?s.warn:s.bad]}>{proofLabel(a)}</Text><Text style={s.small}>QA {a.qualityState}</Text></View>
          <Text style={s.small}>Verified production {verified?hrs(a.productiveMs24h):'0.00'}h · raw measured span {hrs(a.productiveMs24h)}h · idle {hrs(a.idleMs24h)}h</Text>
          <Text style={s.small}>Commit {sha(a.commitSha)} · PR {a.prNumber??'—'} · Run {a.githubRunId??'—'} · Deploy {a.deployId??'—'}</Text>
          {a.filesChanged?.length?<Text style={s.small}>Files: {a.filesChanged.slice(0,4).join(', ')}{a.filesChanged.length>4?' …':''}</Text>:null}
          {working&&a.evidenceState==='MISSING'?<Text style={s.bad}>WORKING WITHOUT PROOF — counts as 0 verified hours</Text>:null}
          {a.blocker?<Text style={s.blocker}>Blocker: {a.blocker}</Text>:null}
        </View>;
      })}
      <Text style={s.policy}>{d.policy}</Text>
      <Text style={s.policy}>Control rule: only FULL evidence contributes to the owner-facing verified-production total. PARTIAL or MISSING evidence remains visible but counts as 0 verified hours in this screen.</Text>
    </>:<Text style={s.loading}>Loading real production evidence…</Text>}
  </ScrollView>;
}

function Metric({label,value}:{label:string;value:string}){return <View style={s.metric}><Text style={s.metricValue}>{value}</Text><Text style={s.metricLabel}>{label}</Text></View>}

const s=StyleSheet.create({
  page:{flex:1,backgroundColor:Colors.background},content:{padding:16,paddingBottom:60},title:{color:Colors.text,fontSize:24,fontWeight:'800'},sub:{color:Colors.muted??'#94a3b8',marginTop:6,marginBottom:14,lineHeight:18},
  cert:{borderWidth:1,borderRadius:14,padding:14,marginBottom:12},certGreen:{borderColor:'#22c55e',backgroundColor:'#10261A'},certRed:{borderColor:'#ef4444',backgroundColor:'#2A1414'},certTitle:{color:Colors.text,fontWeight:'900',fontSize:14},certText:{color:Colors.muted??'#94a3b8',fontSize:11,marginTop:4},
  summary:{backgroundColor:'#15151F',borderColor:'#2A2A38',borderWidth:1,borderRadius:14,padding:14,marginBottom:12},metricRow:{flexDirection:'row',flexWrap:'wrap',gap:8,marginBottom:8},metric:{minWidth:72,flexGrow:1,backgroundColor:'#101018',borderRadius:10,padding:9},metricValue:{color:Colors.text,fontSize:17,fontWeight:'900'},metricLabel:{color:Colors.muted??'#94a3b8',fontSize:10,marginTop:2},line:{color:Colors.text,fontSize:13,marginBottom:5},
  filters:{flexDirection:'row',flexWrap:'wrap',gap:7,marginBottom:12},filter:{borderWidth:1,borderColor:'#343746',borderRadius:999,paddingHorizontal:10,paddingVertical:7},filterActive:{borderColor:Colors.primary,backgroundColor:'#19192A'},filterText:{color:Colors.muted??'#94a3b8',fontSize:10,fontWeight:'700'},filterTextActive:{color:Colors.primary},section:{color:Colors.text,fontWeight:'800',fontSize:15,marginBottom:9},
  small:{color:Colors.muted??'#94a3b8',fontSize:12,marginTop:4},card:{backgroundColor:'#11131A',borderColor:'#262A36',borderWidth:1,borderRadius:12,padding:12,marginBottom:10},cardBlocked:{borderColor:'#ef4444'},row:{flexDirection:'row',justifyContent:'space-between',gap:8},agent:{color:Colors.text,fontWeight:'800',fontSize:15,flex:1},status:{color:Colors.primary,fontWeight:'800',fontSize:12},task:{color:Colors.text,fontSize:13,marginTop:7},proofRow:{flexDirection:'row',alignItems:'center',gap:10,marginTop:7},proof:{fontWeight:'900',fontSize:11},good:{color:'#22c55e'},warn:{color:'#f59e0b'},bad:{color:'#ef4444'},blocker:{color:Colors.error??'#FF4D4D',fontSize:12,marginTop:6,fontWeight:'700'},policy:{color:Colors.muted??'#94a3b8',fontSize:11,lineHeight:16,marginTop:8},loading:{color:Colors.text,paddingVertical:30,textAlign:'center'},error:{backgroundColor:'#351616',padding:12,borderRadius:10,marginBottom:12},errorText:{color:Colors.error??'#FF4D4D',fontWeight:'700'}
});