import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only production configuration and observed capacity. Never export envs,
// credentials, request prompts, or private model responses.
const api = 'https://api.ivxholding.com';
const sha = process.env.IVX_TARGET_SHA || process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/);
assert(process.env.IVX_SYSTEM_KEY, 'Protected fleet observer credential required');
assert(process.env.RENDER_API_KEY, 'Protected Render credential required');
async function get(origin, path, token, system = false) {
  const response = await fetch(origin + path, { redirect:'error', signal:AbortSignal.timeout(20_000),
    headers:{...(system ? {'X-IVX-System-Key':token} : {Authorization:`Bearer ${token}`}), Accept:'application/json'} });
  assert.equal(response.status, 200, `Read-only capacity probe HTTP ${response.status} at ${path.split('?')[0]}`);
  return response.json();
}
const services = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];
const config = [];
let gatewayKey;
let vercelToken = process.env.VERCEL_TOKEN || process.env.VERCEL_API_TOKEN || process.env.IVX_VERCEL_TOKEN;
const output = 'qa/evidence/phase3';
await mkdir(output,{recursive:true});
const result={sourceSha:sha,observedAt:new Date().toISOString(),config,
  credits:{state:'UNOBSERVED'},budgets:{state:'UNOBSERVED'},samples:[],
  observerAuth:'protected_system_key', ownerBrowserProofRequiredSeparately:true,
  providerMaximumConcurrency:null,maximumNotInferredFromLogicalIdentities:true,
  noModelCallsCreated:true,secretValuesReturned:false,continuity24x7Certified:false};
async function checkpoint() {
  result.observedAt=new Date().toISOString();
  await writeFile(`${output}/capacity.json`,JSON.stringify(result,null,2));
}
for (const serviceId of services) {
  const detail = await get('https://api.render.com/v1', `/services/${serviceId}`, process.env.RENDER_API_KEY);
  assert.equal(detail.repo, 'https://github.com/ibb142/ivx-holdings-platform');
  const variables = [];
  let cursor = '';
  for (let page = 0; page < 5; page++) {
    const rows = await get('https://api.render.com/v1', `/services/${serviceId}/env-vars?limit=100${cursor?'&cursor='+encodeURIComponent(cursor):''}`, process.env.RENDER_API_KEY);
    assert(Array.isArray(rows));
    variables.push(...rows.map(row => row.envVar));
    if (rows.length < 100) break;
    cursor = rows.at(-1).cursor;
    assert(cursor, 'Configuration pagination cursor missing');
    assert(page < 4, 'Configuration read exceeded its bounded pagination');
  }
  const values = Object.fromEntries(variables.map(row => [row.key, row.value]));
  vercelToken ||= ['VERCEL_TOKEN','VERCEL_API_TOKEN','IVX_VERCEL_TOKEN'].map(key=>values[key]).find(Boolean);
  const gatewayAliases = ['IVX_AI_GATEWAY_KEY','AI_GATEWAY_API_KEY','IVX_VERCEL_GATEWAY_API_KEY','OPENAI_API_KEY'];
  gatewayKey ||= gatewayAliases.map(key => values[key]).find(value => value?.startsWith('vck_'));
  // Only numeric operational controls are eligible for output.
  const numericControls = Object.fromEntries(Object.entries(values).filter(([key,value]) =>
    /^IVX_[A-Z_]*(?:POOL_MAX|MAX_CONCURRENCY|TOKEN_CAP|BUDGET_USD|COST_LIMIT_USD|MAX_COST_USD)$/.test(key)
    && /^\d+(?:\.\d+)?$/.test(value)).map(([key,value])=>[key,Number(value)]));
  config.push({serviceId, configuredInstances:detail.serviceDetails?.numInstances, plan:detail.serviceDetails?.plan,
    numericControls, monetaryBudgetExplicitlyConfigured:Object.keys(numericControls).some(key=>key.endsWith('_USD'))});
  await checkpoint();
}
let credits = {state:'UNOBSERVED', reason:'No directly bound gateway credential'};
if (gatewayKey) {
  const data = await get('https://ai-gateway.vercel.sh/v1', '/credits', gatewayKey);
  assert(Number.isFinite(Number(data.balance)) && Number.isFinite(Number(data.total_used)));
  credits = {state:'OBSERVED', balanceUsd:Number(data.balance), lifetimeUsedUsd:Number(data.total_used),
    observedAt:new Date().toISOString(), balanceIsNotAuthorizedBudget:true};
}
result.credits=credits;
await checkpoint();
// These are the read-only endpoints used by Vercel's official CLI. The team
// was resolved from the connected account. Budget reads never change a cap.
if (vercelToken) {
  const team='team_fEfCJAenMBXVSGiX6LeoA3Ji';
  try {
    const data=await get('https://api.vercel.com',`/ai-gateway/budgets/list?teamId=${team}`,vercelToken);
    assert(Array.isArray(data.budgets));
    result.budgets={state:'OBSERVED',teamId:team,observedAt:new Date().toISOString(),
      limits:data.budgets.map(({scopeType,limitAmount,currentSpend,refreshPeriod,active,archived,includeByokInQuota,source})=>
        ({scopeType,limitAmount,currentSpend,refreshPeriod,active,archived,includeByokInQuota,source})),
      capSemantics:'Provider soft cap checked at request admission; in-flight requests can exceed it',
      serviceKeyCoverage:'Requires reconciliation of the active key; project-only budgets do not cover key-authenticated requests'};
  } catch (error) {
    result.budgets={state:'UNOBSERVED',reason:error instanceof Error?error.message:'Budget observation failed'};
  }
} else result.budgets={state:'UNOBSERVED',reason:'No protected Vercel management token bound'};
await checkpoint();
const samples = [];
for (let index=0; index<2; index++) {
  if(index) await new Promise(resolve=>setTimeout(resolve,20_000));
  const health = await fetch(api+'/health',{signal:AbortSignal.timeout(10_000)}).then(r=>r.json());
  assert.equal(health.commit,sha);
  const runtime = await get(api,'/api/ivx/owner-ai/runtime',process.env.IVX_SYSTEM_KEY,true);
  assert.equal(runtime.ok,true);
  samples.push({observedAt:new Date().toISOString(),healthInstanceId:health.instanceId,
    runtimeInstanceId:null,instanceCorrelation:'Separate load-balanced requests; health cannot identify the runtime replica',queue:runtime.queue,
    calls:runtime.telemetry.recent.map(({id,createdAt,module,model,endpoint,completionTokens,totalTokens,latencyMs,retryCount,status,httpStatus,queueWaitMs})=>
      ({id,createdAt,module,model,endpoint,completionTokens,totalTokens,latencyMs,retryCount,status,httpStatus,queueWaitMs}))});
  result.samples=samples;
  await checkpoint();
}
console.log(JSON.stringify(result));
