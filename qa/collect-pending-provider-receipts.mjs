import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { readBudgetJson, validateUncertainReceipt } from './phase3-budget-reconciliation.mjs';

const DATABASE = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const GATEWAY = 'https://ai-gateway.vercel.sh';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const GENERATION = /^gen_[0-9A-HJKMNP-TV-Z]{26}$/;
const CURSOR_KEY = 'finance/provider-receipt-collector/cursor.json';
const MAX_ROWS = 50;

// A stable 160-bit prefix of SHA-256 binds approval to these exact source bytes,
// including the workflow. It is a content revision, NOT a Git commit SHA. The
// actual checked-out Git SHA and Actions invocation are recorded separately.
export async function collectorRevision(read = readFile) {
  const hash = createHash('sha256');
  for (const relative of ['./collect-pending-provider-receipts.mjs','./phase3-budget-reconciliation.mjs',
    '../.github/workflows/ivx-pending-provider-receipt-collection.yml']) {
    const bytes = await read(new URL(relative,import.meta.url));
    hash.update(relative + '\0' + bytes.length + '\0').update(bytes);
  }
  return hash.digest('hex').slice(0,40);
}
function errorCode(error) {
  const code = String(error?.code ?? error?.message ?? 'RECEIPT_COLLECTION_FAILED');
  return /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : 'RECEIPT_COLLECTION_FAILED';
}
function check(ok,code) { if(!ok) throw new Error(code); }
function urlFor(table,params) {
  const url = new URL('/rest/v1/'+table,DATABASE);
  for(const [key,value] of params)url.searchParams.append(key,String(value));
  return url.href;
}

export async function collectPendingReceipts({ serviceKey,gatewayKey,sourceRevision,gitSha,invocationId },
  { fetcher=fetch,now=Date.now,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms)) }={}) {
  check(serviceKey && gatewayKey?.startsWith('vck_') && /^[a-f0-9]{40}$/.test(sourceRevision||'')
    && /^[a-f0-9]{40}$/.test(gitSha||'') && /^[0-9]{1,20}-[0-9]{1,5}$/.test(invocationId||''),
  'COLLECTOR_BINDING_UNAVAILABLE');
  const headers={apikey:serviceKey,Authorization:'Bearer '+serviceKey};
  const deps={fetcher,now,wait:pause,deadline:now()+240000};
  const read = async url => {
    for(let attempt=0;;attempt++) {
      try { return (await readBudgetJson(url,headers,deps)).value; }
      catch(error) {
        if(attempt>=2 || !['READ_TRANSPORT_UNAVAILABLE','READ_BODY_UNAVAILABLE','READ_HTTP_500','READ_HTTP_502',
          'READ_HTTP_503','READ_HTTP_504'].includes(errorCode(error)) || now()+1000>=deps.deadline) throw error;
        await pause(250*(attempt+1));
      }
    }
  };
  const write = async(path,body,returnJson=false,appendOnly=false)=>{
    check(now()<deps.deadline,'OBSERVATION_DEADLINE');
    const response=await fetcher(DATABASE+'/rest/v1/'+path,{method:'POST',redirect:'error',
      signal:AbortSignal.timeout(Math.max(1,Math.min(returnJson?12000:5000,deps.deadline-now()))),
      headers:{...headers,'Content-Type':'application/json',Prefer: returnJson?'return=representation':
        (appendOnly?'resolution=ignore-duplicates,return=minimal':'resolution=merge-duplicates,return=minimal')},
      body:JSON.stringify(body)});
    if(!response.ok){await response.body?.cancel();throw new Error('DATABASE_WRITE_HTTP_'+response.status);}
    if(!returnJson){await response.body?.cancel();return;}
    // The RPC has a bounded batch and response shape; do not export its body.
    const text=await response.text();check(text.length<64000,'RPC_RESPONSE_TOO_LARGE');
    try{return JSON.parse(text);}catch{throw new Error('RPC_RESPONSE_INVALID');}
  };
  const sources=await read(urlFor('ivx_ai_receipt_sources',[
    ['select','source_sha'],['source_sha','eq.'+sourceRevision],['enabled','eq.true'],['limit',1]]));
  check(Array.isArray(sources)&&sources.length===1&&sources[0].source_sha===sourceRevision,'COLLECTOR_SOURCE_UNAPPROVED');
  const cursorRows=await read(urlFor('ivx_durable_documents',[['select','value'],['doc_key','eq.'+CURSOR_KEY],['limit',1]]));
  check(Array.isArray(cursorRows)&&cursorRows.length<=1,'CURSOR_RESPONSE_INVALID');
  const cursor=cursorRows[0]?.value;
  const cutoff=new Date(now()-15*60000).toISOString();
  const validCursor=cursor?.sourceRevision===sourceRevision && UUID.test(cursor.reservationId||'')
    && typeof cursor.createdAt==='string' && Number.isFinite(Date.parse(cursor.createdAt));
  const selectRows=async(useCursor)=>read(urlFor('ivx_ai_budget_reservations',[
    ['select','reservation_id,model,day,status,reserved_nano,settled_upper_nano,generation_id,created_at,completed_at'],
    ['status','eq.uncertain'],['settled_upper_nano','is.null'],['generation_id','not.is.null'],
    ['completed_at','not.is.null'],['created_at','lt.'+cutoff],['order','created_at.asc,reservation_id.asc'],['limit',MAX_ROWS+1],
    ...(useCursor?[['or',`(created_at.gt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},reservation_id.gt.${cursor.reservationId}))`]]:[])]));
  let selected=await selectRows(validCursor);
  check(Array.isArray(selected)&&selected.length<=MAX_ROWS+1,'LEDGER_SELECTION_INVALID');
  if(selected.length===0&&validCursor)selected=await selectRows(false);
  check(Array.isArray(selected)&&selected.length<=MAX_ROWS+1,'LEDGER_SELECTION_INVALID');
  const report={sourceRevision,gitSha,invocationId,startedAt:new Date(now()).toISOString(),cutoff,
    selected:Math.min(selected.length,MAX_ROWS),selectionTruncated:selected.length>MAX_ROWS,uploaded:0,
    alreadyPresent:0,unavailable:0,providerLookups:0,settled:0,rejected:0,records:[],settlements:[],
    modelCallsCreated:0,fullReconciliationCertified:false};
  const rows=selected.slice(0,MAX_ROWS),seen=new Set();
  for(const row of rows) {
    check(UUID.test(row.reservation_id||'')&&!seen.has(row.reservation_id)&&GENERATION.test(row.generation_id||''),
      'LEDGER_IDENTITY_INVALID');seen.add(row.reservation_id);
    check(row.status==='uncertain'&&row.settled_upper_nano===null&&/^\d{4}-\d{2}-\d{2}$/.test(row.day||'')
      && Number.isFinite(Date.parse(row.created_at))&&Date.parse(row.created_at)<Date.parse(cutoff),
    'LEDGER_ELIGIBILITY_CHANGED');
  }
  let bindings=[];
  if(rows.length) {
    const ids=[...new Set(rows.map(row=>row.generation_id))];
    bindings=await read(urlFor('ivx_ai_budget_reservations',[['select','reservation_id,generation_id'],
      ['generation_id','in.('+ids.join(',')+')'],['limit',1000]]));
    check(Array.isArray(bindings)&&bindings.length<1000,'GENERATION_BINDING_TRUNCATED');
  }
  for(const row of rows) {
    try {
      const identities=bindings.filter(other=>other.generation_id===row.generation_id);
      check(identities.length===1&&identities[0].reservation_id===row.reservation_id,'GENERATION_BINDING_AMBIGUOUS');
      const prefix=`finance/provider-receipts/${row.day}/${row.reservation_id}/`;
      const existing=await read(urlFor('ivx_durable_documents',[['select','doc_key'],['doc_key','gte.'+prefix],
        ['doc_key','lt.'+prefix+'~'],['value->>sourceSha','eq.'+sourceRevision],['limit',1]]));
      check(Array.isArray(existing)&&existing.length<=1,'RECEIPT_DOCUMENT_RESPONSE_INVALID');
      if(existing.length){report.alreadyPresent++;report.records.push({reservationId:row.reservation_id,state:'DOCUMENT_PRESENT'});continue;}
      report.providerLookups++;
      const payload=(await readBudgetJson(GATEWAY+'/v1/generation?id='+encodeURIComponent(row.generation_id),
        {Authorization:'Bearer '+gatewayKey},deps,true)).value;
      const receipt=validateUncertainReceipt(row,payload,new Date(now()).toISOString());
      const value={...receipt,sourceSha:sourceRevision,source:GATEWAY+'/v1/generation',
        providerReceiptSha256:createHash('sha256').update(JSON.stringify(receipt)).digest('hex')};
      const docKey=prefix+value.providerReceiptSha256+'.json';
      await write('ivx_durable_documents?on_conflict=doc_key',{doc_key:docKey,value,updated_at:new Date(now()).toISOString()},false,true);
      report.uploaded++;report.records.push({reservationId:row.reservation_id,state:'UPLOADED',docKey});
    } catch(error) {
      const reason=errorCode(error);report.unavailable++;
      report.records.push({reservationId:row.reservation_id,state:'UNAVAILABLE',reason});
      if(['READ_HTTP_401','READ_HTTP_403','OBSERVATION_DEADLINE'].includes(reason))break;
    }
  }
  // The SQL consumer performs the only accounting transitions. Cron remains a
  // fallback if this invocation stops after writing evidence.
  if(report.uploaded+report.alreadyPresent>0) {
    for(let attempt=0;attempt<2;attempt++) {
      const result=await write('rpc/fn_autonomous_finance_depuration',{},true);
      check(result&&Number.isInteger(result.settled)&&result.settled>=0&&result.settled<=25,'SETTLEMENT_RESPONSE_INVALID');
      report.settled+=result.settled;report.rejected+=result.rejected??0;report.settlements.push(result);
      if(result.settled<25||(result.rejected??0)>0)break;
    }
  }
  if(rows.length) {
    const last=rows[rows.length-1];
    await write('ivx_durable_documents?on_conflict=doc_key',{doc_key:CURSOR_KEY,
      value:{sourceRevision,createdAt:last.created_at,reservationId:last.reservation_id},updated_at:new Date(now()).toISOString()});
  }
  report.finishedAt=new Date(now()).toISOString();
  await write('ivx_durable_documents?on_conflict=doc_key',{doc_key:'finance/provider-receipt-collections/'+invocationId+'.json',
    value:report,updated_at:report.finishedAt});
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const report=await collectPendingReceipts({serviceKey:process.env.SUPABASE_SERVICE_ROLE_KEY,
      gatewayKey:process.env.IVX_AI_GATEWAY_KEY||process.env.AI_GATEWAY_API_KEY,
      sourceRevision:await collectorRevision(),gitSha:process.env.GITHUB_SHA,
      invocationId:process.env.GITHUB_RUN_ID+'-'+process.env.GITHUB_RUN_ATTEMPT});
    console.log(JSON.stringify({sourceRevision:report.sourceRevision,selected:report.selected,uploaded:report.uploaded,
      alreadyPresent:report.alreadyPresent,unavailable:report.unavailable,settled:report.settled,rejected:report.rejected,
      modelCallsCreated:0,fullReconciliationCertified:false,
      reasons:[...new Set(report.records.filter(r=>r.reason).map(r=>r.reason))]}));
    if(report.unavailable||report.rejected)process.exitCode=1;
  } catch(error){console.error(errorCode(error));process.exitCode=1;}
}
