import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Measure the same authenticated production read used by the mission screen.
// Persist only roster counts, timestamps and source identity, never credentials.
const env = process.env;
const api = (env.EXPO_PUBLIC_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/$/, '');
assert(env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  && env.OWNER_EMAIL && env.OWNER_PASSWORD_EFFECTIVE, 'Owner credential binding required');
const login = await fetch(`${env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '')}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD_EFFECTIVE }),
  signal: AbortSignal.timeout(30_000),
});
assert.equal(login.status, 200, 'Real owner login failed');
const session = await login.json();
assert(session.access_token, 'Owner access token missing');
const startedAt = Date.now();
const response = await fetch(`${api}/api/ivx/live-work/agents?enterpriseDashboard=1&range=24h`, {
  headers: { Authorization: `Bearer ${session.access_token}` },
  signal: AbortSignal.timeout(40_000),
});
assert.equal(response.status, 200, 'Authenticated mission ledger unavailable');
const { ok, dashboard } = await response.json();
const elapsedMs = Date.now() - startedAt;
assert.equal(ok, true);
assert.equal(dashboard?.agents?.length, 112, 'Mission roster must contain all 112 agents');
const numbers = new Set(dashboard.agents.map(agent => agent.agentNumber));
assert.equal(numbers.size, 112);
assert([...numbers].every(n => Number.isInteger(n) && n >= 1 && n <= 112));
assert.equal(dashboard.enterprise112?.ledgerOk, true, 'Durable ledger read failed');
if (env.IVX_REQUIRE_MATCHING_BACKEND !== 'false') {
  assert.equal(dashboard.backendCommitSha, env.EXPO_PUBLIC_SOURCE_COMMIT_SHA);
}
const proof = {
  certificate: 'IVX-MISSION-DURABLE-READ', passed: true,
  sourceSha: env.EXPO_PUBLIC_SOURCE_COMMIT_SHA, backendSha: dashboard.backendCommitSha,
  elapsedMs, generatedAt: dashboard.generatedAt, rosterCount: numbers.size,
  durableLedgerOk: true, authenticatedOwner: true, verifiedAt: new Date().toISOString(),
};
await mkdir('qa/evidence/dashboard-chat', { recursive: true });
await writeFile('qa/evidence/dashboard-chat/mission-ledger-read.json', JSON.stringify(proof, null, 2));
console.log(JSON.stringify(proof, null, 2));
