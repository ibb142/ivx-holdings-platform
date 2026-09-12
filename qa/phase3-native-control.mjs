import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { sharedBinding, SERVICES } from './phase3-provider-live-guards.mjs';

// Protected, read-only diagnosis of management access. Never logs tokens,
// Render environment values, full API responses, key suffixes or user emails.
const TEAM = 'team_fEfCJAenMBXVSGiX6LeoA3Ji';
const ALIASES = ['VERCEL_TOKEN', 'VERCEL_ACCESS_TOKEN', 'VERCEL_API_TOKEN', 'IVX_VERCEL_TOKEN'];
const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;
const proof = { scope: 'native_vercel_management_read_only', startedAt: new Date().toISOString(),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  teamId: TEAM, nativeControlsChanged: false, providerCalls: 0, secretValuesReturned: false,
  item11_4Closed: false, item11_5Closed: false, phase3Closed: false, endpoints: [] };

async function request(url, token, body, extraHeaders = {}) {
  const response = await fetch(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
    signal: AbortSignal.timeout(30000), headers: { Accept: 'application/json', Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; assert(size <= 3000000, 'RESPONSE_TOO_LARGE'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
  return { status: response.status, data };
}

async function management(path, token) {
  const value = await request('https://api.vercel.com' + path, token);
  proof.endpoints.push({ path, httpStatus: value.status,
    errorCode: safeCode(value.data?.error?.code ?? value.data?.code), observedAt: new Date().toISOString() });
  return value;
}

function summarizeBudget(budget) {
  return Object.fromEntries(['quotaEntityId','scopeType','scopeId','limitAmount','currentSpend',
    'currentByokSpend','includeByokInQuota','refreshPeriod','active','archived','source','createdAt','updatedAt']
    .filter(key => budget[key] !== undefined).map(key => [key, budget[key]]));
}

try {
  assert.equal(process.env.IVX_NATIVE_REVIEW, 'phase3-native-20260912', 'REVIEW_BINDING_REQUIRED');
  const values = [];
  for (const service of SERVICES) {
    assert(process.env.RENDER_API_KEY, 'RENDER_CREDENTIAL_REQUIRED');
    const env = {}; let cursor = '';
    for (let page = 0; page < 5; page++) {
      const result = await request('https://api.render.com/v1/services/' + service + '/env-vars?limit=100'
        + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), process.env.RENDER_API_KEY);
      assert.equal(result.status, 200, 'RENDER_BINDING_READ_FAILED');
      assert(Array.isArray(result.data), 'INVALID_RENDER_BINDING');
      for (const { envVar } of result.data) env[envVar.key] = envVar.value;
      if (result.data.length < 100) break;
      cursor = result.data.at(-1).cursor; assert(cursor && page < 4, 'ENV_PAGINATION_LIMIT');
    }
    values.push(env);
  }
  const binding = sharedBinding(values);
  proof.sharedGatewayAndDatabaseVerified = true;
  const candidates = [process.env, ...values].flatMap((env, index) => ALIASES
    .filter(name => typeof env[name] === 'string' && env[name].trim())
    .map(name => ({ source: index === 0 ? 'github_actions' : SERVICES[index - 1], name, value: env[name].trim() })));
  proof.availableBindings = candidates.map(({ source, name }) => ({ source, name }));
  assert(candidates.length, 'MANAGEMENT_CREDENTIAL_MISSING');
  const selected = candidates.find(candidate => candidate.value.startsWith('vcp_')) ?? candidates[0];
  proof.selectedBinding = { source: selected.source, name: selected.name };
  const token = selected.value;
  proof.managementCredentialIsGatewayKey = token.startsWith('vck_');
  proof.databaseDiagnostics={};
  if(process.env.SUPABASE_ACCESS_TOKEN) {
    try {
      const pool=await request('https://api.supabase.com/v1/projects/kvclcdjmjghndxsngfzb/config/database/pgbouncer',
        process.env.SUPABASE_ACCESS_TOKEN);
      proof.databaseDiagnostics.poolConfigStatus=pool.status;
      proof.databaseDiagnostics.poolConfig=(Array.isArray(pool.data)?pool.data:[pool.data]).map(row=>
        Object.fromEntries(['database_type','pool_mode','default_pool_size','max_client_conn','server_idle_timeout']
          .filter(k=>['number','string','boolean'].includes(typeof row?.[k])).map(k=>[k,row[k]])));
    } catch { proof.databaseDiagnostics.poolConfigError='READ_UNCONFIRMED'; }
  }
  try {
    const policy=await request(binding.databaseUrl+'/rest/v1/rpc/ivx_ai_budget_status',
      binding.serviceKey,{}, {apikey:binding.serviceKey});
    proof.databaseDiagnostics.sharedPolicyHttpStatus=policy.status;
    assert.equal(policy.status,200,'POLICY_READ_FAILED');
    proof.sharedPolicy=policy.data;
  } catch { proof.databaseDiagnostics.sharedPolicyError='READ_UNCONFIRMED'; }
  const user = await management('/v2/user', token);
  proof.managementAuthenticated = user.status === 200 && typeof user.data?.user?.id === 'string';
  const teams = await management('/v2/teams?limit=100', token);
  proof.targetTeamListed = teams.status === 200 && teams.data?.teams?.some(team => team.id === TEAM) === true;
  const team = await management('/v2/teams/' + TEAM, token);
  proof.targetTeamAccessible = team.status === 200 && team.data?.id === TEAM;
  const keys = await management('/v1/api-keys?purpose=ai-gateway&teamId=' + TEAM, token);
  if (keys.status === 200 && Array.isArray(keys.data?.apiKeys)) {
    const rows = keys.data.apiKeys;
    const matching = rows.filter(key => typeof key.partialKey === 'string' && key.partialKey.length >= 6
      && binding.gatewayKey.endsWith(key.partialKey) && key.teamId === TEAM && key.purpose === 'ai-gateway');
    proof.activeServiceKeyMatches = matching.length;
    proof.gatewayKeys = rows.map(key => ({ id: key.id, teamId: key.teamId, purpose: key.purpose,
      expiresAt: key.expiresAt, leaked: Boolean(key.leakedAt),
      matchesServiceKey: matching.includes(key), quota: key.quota ? summarizeBudget(key.quota) : null }));
  }
  const budgets = await management('/ai-gateway/budgets/list?teamId=' + TEAM, token);
  proof.nativeBudget = budgets.status === 200 && Array.isArray(budgets.data?.budgets)
    ? { state: 'OBSERVED', budgets: budgets.data.budgets.map(summarizeBudget) }
    : { state: 'UNOBSERVED', httpStatus: budgets.status, errorCode: safeCode(budgets.data?.error?.code) };
  const defaults = await management('/ai-gateway/budgets/defaults/list?teamId=' + TEAM, token);
  if (defaults.status === 200 && Array.isArray(defaults.data?.defaults))
    proof.nativeDefaults = defaults.data.defaults.map(summarizeBudget);
  proof.readyForNativeControl = proof.managementAuthenticated && proof.targetTeamAccessible
    && proof.nativeBudget.state === 'OBSERVED';
  proof.diagnosticCompleted = true;
  if(!proof.sharedPolicy) {
    proof.readyForNativeControl=false;
    throw new Error('SHARED_POLICY_UNAVAILABLE');
  }
} catch (error) { proof.error = safeCode(error?.message?.split('\n')[0]) ?? 'DIAGNOSTIC_FAILED'; process.exitCode = 1; }
finally {
  proof.completedAt = new Date().toISOString();
  await mkdir('qa/evidence/phase3-native', { recursive: true });
  await writeFile('qa/evidence/phase3-native/management.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify({ type: 'native-management-result', ...proof }));
}
