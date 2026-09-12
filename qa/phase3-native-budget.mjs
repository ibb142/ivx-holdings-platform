import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sharedBinding, SERVICES } from './phase3-provider-live-guards.mjs';

export const TEAM = 'team_fEfCJAenMBXVSGiX6LeoA3Ji';
export const AUTHORIZATION = 'owner-chat-2026-09-11-Pon-USD200-diarios-global-fleet';
export const AUTHORIZED_BUDGET = Object.freeze({
  scopeType: 'team', limitAmount: 200, refreshPeriod: 'daily', includeByokInQuota: true,
});
export const safeCode = value => typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,100}$/.test(value) ? value : null;

export async function requestJson(url, token, { method = 'GET', body, headers = {}, timeout = 15000 } = {}) {
  const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(timeout),
    headers: { Accept: 'application/json', Authorization: 'Bearer ' + token,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength; assert(size <= 3000000, 'RESPONSE_TOO_LARGE'); chunks.push(value); } }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { data = null; }
  return { status: response.status, data, retryAfter: response.headers.get('retry-after') };
}

export async function management(context, path, options = {}) {
  assert(path.startsWith('/') && !path.includes('://'), 'INVALID_MANAGEMENT_PATH');
  const separator = path.includes('?') ? '&' : '?';
  const result = await requestJson('https://api.vercel.com' + path + separator + 'teamId=' + TEAM,
    context.managementToken, options);
  context.proof.endpoints.push({ method: options.method ?? 'GET', path, status: result.status,
    errorCode: safeCode(result.data?.error?.code), at: new Date().toISOString() });
  assert(result.status >= 200 && result.status < 300, 'NATIVE_HTTP_' + result.status);
  return result.data;
}

export function budgetSummary(budget) {
  return Object.fromEntries(['quotaEntityId','scopeType','scopeId','limitAmount','currentSpend',
    'currentByokSpend','includeByokInQuota','refreshPeriod','active','archived','source','createdAt','updatedAt']
    .filter(key => budget[key] !== undefined).map(key => [key, budget[key]]));
}

export async function prepareContext(proof) {
  assert.equal(process.env.IVX_NATIVE_REVIEW, 'phase3-native-20260912', 'REVIEW_BINDING_REQUIRED');
  assert(Date.now() < Date.parse('2026-09-13T00:00:00Z'), 'REVIEW_WINDOW_EXPIRED');
  assert(process.env.RENDER_API_KEY, 'RENDER_CREDENTIAL_REQUIRED');
  const values = [];
  for (const service of SERVICES) {
    const env = {}; let cursor = '';
    for (let page = 0; page < 5; page++) {
      const result = await requestJson('https://api.render.com/v1/services/' + service + '/env-vars?limit=100'
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
  const token = String(process.env.VERCEL_TOKEN || '').trim();
  assert(token && !token.startsWith('vck_'), 'MANAGEMENT_ACCESS_TOKEN_REQUIRED');
  const context = { ...binding, managementToken: token, proof };
  proof.sharedBindingVerified = true;
  const team = await management(context, '/v2/teams/' + TEAM);
  assert.equal(team.id, TEAM, 'TEAM_MISMATCH');
  const policy = await requestJson(binding.databaseUrl + '/rest/v1/rpc/ivx_ai_budget_status',
    binding.serviceKey, { method: 'POST', body: {}, headers: { apikey: binding.serviceKey } });
  assert.equal(policy.status, 200, 'POLICY_READ_FAILED');
  assert.equal(policy.data.enabled, true, 'SHARED_BUDGET_DISABLED');
  assert.equal(policy.data.dailyLimitNano, '200000000000', 'SHARED_BUDGET_CHANGED');
  assert.equal(Number(policy.data.policyRevision), 2, 'SHARED_REVISION_CHANGED');
  assert.equal(policy.data.maxConcurrent, 2, 'SHARED_CONCURRENCY_CHANGED');
  assert.equal(policy.data.authorizationRef, AUTHORIZATION, 'AUTHORIZATION_CHANGED');
  proof.sharedPolicy = policy.data;
  return context;
}

export async function readNativeState(context) {
  const { apiKeys } = await management(context, '/v1/api-keys?purpose=ai-gateway');
  assert(Array.isArray(apiKeys), 'INVALID_KEY_LIST');
  const matching = apiKeys.filter(key => typeof key.partialKey === 'string' && key.partialKey.length >= 6
    && context.gatewayKey.endsWith(key.partialKey) && key.teamId === TEAM && key.purpose === 'ai-gateway');
  assert.equal(matching.length, 1, 'AMBIGUOUS_SERVICE_KEY');
  const key = matching[0];
  assert(!key.metadata?.bypassAll, 'SERVICE_KEY_BYPASSES_CONTROLS');
  assert(!key.leakedAt, 'SERVICE_KEY_FLAGGED_LEAKED');
  assert(!key.expiresAt || key.expiresAt > Date.now(), 'SERVICE_KEY_EXPIRED');
  const { budgets } = await management(context, '/ai-gateway/budgets/list');
  assert(Array.isArray(budgets), 'INVALID_BUDGET_LIST');
  const teamBudgets = budgets.filter(b => b.scopeType === 'team' && b.scopeId === TEAM && !b.archived);
  assert(teamBudgets.length <= 1, 'AMBIGUOUS_TEAM_BUDGET');
  return { key, budgets, teamBudget: teamBudgets[0] ?? null };
}

function otherLimits(state) {
  return state.budgets.filter(b => b.scopeType !== 'team').map(b => ({
    id: b.quotaEntityId, limit: b.limitAmount, period: b.refreshPeriod, active: b.active,
    archived: b.archived, byok: b.includeByokInQuota,
  })).sort((a,b) => a.id.localeCompare(b.id));
}

export function checkNativeBudget(budget) {
  assert(budget && budget.scopeType === 'team' && budget.scopeId === TEAM, 'NATIVE_TEAM_BUDGET_MISSING');
  assert.equal(budget.limitAmount, 200, 'NATIVE_LIMIT_MISMATCH');
  assert.equal(budget.refreshPeriod, 'daily', 'NATIVE_PERIOD_MISMATCH');
  assert.equal(budget.includeByokInQuota, true, 'NATIVE_BYOK_NOT_INCLUDED');
  assert.equal(budget.active, true, 'NATIVE_BUDGET_NOT_ACTIVE');
  assert.equal(budget.archived, false, 'NATIVE_BUDGET_ARCHIVED');
}

export async function emitProof(proof, name) {
  proof.completedAt = new Date().toISOString();
  await mkdir('qa/evidence/phase3-native', { recursive: true });
  await writeFile('qa/evidence/phase3-native/' + name + '.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}

async function main() {
  const mode = process.argv[2];
  const proof = { type: 'native-budget-result', mode, startedAt: new Date().toISOString(),
    sourceSha: execFileSync('git', ['rev-parse','HEAD'], { encoding:'utf8' }).trim(),
    runId: process.env.GITHUB_RUN_ID, job: process.env.GITHUB_JOB, teamId: TEAM, endpoints: [],
    authorizationRef: AUTHORIZATION, providerCalls: 0, nativeMutation: false, secretValuesReturned: false,
    item11_4ConfigurationVerified: false, item11_5Closed: false, phase3Closed: false };
  try {
    assert(['apply','verify'].includes(mode), 'INVALID_MODE');
    const context = await prepareContext(proof);
    const before = await readNativeState(context);
    proof.before = { teamBudget: before.teamBudget ? budgetSummary(before.teamBudget) : null,
      serviceKeyId: before.key.id, serviceKeyQuota: before.key.quota ? budgetSummary(before.key.quota) : null,
      serviceKeyBypassesControls: false };
    if (mode === 'apply') {
      assert.equal(process.env.IVX_NATIVE_BUDGET_APPLY, 'owner-200-usd-daily-20260912', 'WRITE_AUTHORIZATION_REQUIRED');
      let alreadyCorrect = false;
      try { checkNativeBudget(before.teamBudget); alreadyCorrect = true; } catch {}
      if (!alreadyCorrect) {
        proof.nativeMutationAttempted = true;
        await management(context, '/ai-gateway/budgets', { method: 'PUT', body: AUTHORIZED_BUDGET });
        proof.nativeMutation = true;
      }
    }
    const after = await readNativeState(context);
    checkNativeBudget(after.teamBudget);
    assert.equal(after.key.id, before.key.id, 'SERVICE_KEY_CHANGED');
    assert.deepEqual(otherLimits(after), otherLimits(before), 'OTHER_BUDGET_SETTINGS_CHANGED');
    proof.after = { teamBudget: budgetSummary(after.teamBudget), serviceKeyId: after.key.id,
      serviceKeyQuota: after.key.quota ? budgetSummary(after.key.quota) : null };
    proof.item11_4ConfigurationVerified = true;
    proof.otherBudgetSettingsPreserved = true;
    proof.productionInferenceKeyPreserved = true;
  } catch(error) { proof.error = safeCode(error?.message?.split('\n')[0]) ?? 'NATIVE_VERIFICATION_FAILED'; process.exitCode = 1; }
  finally { await emitProof(proof, 'budget-' + (['apply','verify'].includes(mode) ? mode : 'error')); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
