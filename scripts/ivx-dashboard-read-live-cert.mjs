import assert, { AssertionError } from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Exercise the same authenticated read as Mission Control. Failure evidence is
// restricted to protocol metadata and counts; credentials and raw bodies stay private.
const env = process.env;
const api = (env.EXPO_PUBLIC_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/$/, '');
const proof = {
  certificate: 'IVX-MISSION-DURABLE-READ', passed: false, stage: 'configuration',
  sourceSha: env.EXPO_PUBLIC_SOURCE_COMMIT_SHA ?? null,
};
try {
  assert(env.EXPO_PUBLIC_SUPABASE_URL && env.EXPO_PUBLIC_SUPABASE_ANON_KEY
    && env.OWNER_EMAIL && env.OWNER_PASSWORD_EFFECTIVE, 'Owner credential binding required');
  proof.stage = 'owner_login';
  const login = await fetch(env.EXPO_PUBLIC_SUPABASE_URL.replace(/\/$/, '') + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: { apikey: env.EXPO_PUBLIC_SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: env.OWNER_EMAIL, password: env.OWNER_PASSWORD_EFFECTIVE }),
    signal: AbortSignal.timeout(30_000),
  });
  proof.httpStatus = login.status;
  assert.equal(login.status, 200, 'Real owner login failed');
  const session = await login.json();
  assert(session.access_token, 'Owner access token missing');
  proof.authenticatedOwner = true;
  proof.stage = 'mission_read';
  const startedAt = Date.now();
  const response = await fetch(api + '/api/ivx/live-work/agents?enterpriseDashboard=1&range=24h', {
    headers: { Authorization: 'Bearer ' + session.access_token },
    signal: AbortSignal.timeout(40_000),
  });
  proof.httpStatus = response.status;
  assert.equal(response.status, 200, 'Authenticated mission ledger unavailable');
  const body = await response.json();
  const { ok, dashboard } = body;
  proof.elapsedMs = Date.now() - startedAt;
  proof.responseTruncated = body.responseTruncated === true;
  proof.backendSha = dashboard?.backendCommitSha ?? null;
  proof.rosterCount = Array.isArray(dashboard?.agents) ? dashboard.agents.length : 0;
  proof.durableLedgerOk = dashboard?.enterprise112?.ledgerOk === true;
  proof.fleetStatus = dashboard?.fleetSignals?.status ?? null;
  proof.stage = 'mission_contract';
  assert.equal(ok, true, 'Mission response lost its dashboard contract');
  assert.equal(proof.responseTruncated, false, 'Mission response exceeded the transport limit');
  assert.equal(proof.rosterCount, 112, 'Mission roster must contain all 112 agents');
  const numbers = new Set(dashboard.agents.map(agent => agent.agentNumber));
  assert.equal(numbers.size, 112);
  assert([...numbers].every(n => Number.isInteger(n) && n >= 1 && n <= 112));
  assert.equal(proof.durableLedgerOk, true, 'Durable ledger read failed');
  const signals = dashboard.fleetSignals;
  assert.equal(signals?.status, 'AVAILABLE', 'Shared fleet observation is unavailable');
  assert.equal(signals.agents?.length, 112, 'Fleet observation must include all 112 agents');
  const signalNumbers = new Set(signals.agents.map(agent => agent.agentNumber));
  assert.equal(signalNumbers.size, 112);
  assert([...signalNumbers].every(n => Number.isInteger(n) && n >= 1 && n <= 112));
  const measuredAge = Date.now() - Date.parse(signals.measuredAt);
  assert(Number.isFinite(measuredAge) && measuredAge >= -1000
    && measuredAge <= Math.min(signals.maxAgeMs, 15_000), 'Fleet observation is stale');
  assert.equal(signals.commitSha, dashboard.backendCommitSha, 'Fleet observation belongs to another backend version');
  const counts = {
    heartbeat: signals.agents.filter(agent => agent.heartbeatFresh).length,
    assigned: signals.agents.filter(agent => agent.assignedTasks > 0).length,
    running: signals.agents.filter(agent => agent.running).length,
    productive: signals.agents.filter(agent => agent.productive && agent.evidence?.commitSha === signals.commitSha).length,
  };
  assert.deepEqual(signals.counts, counts, 'Fleet counts disagree with agent evidence');
  if (env.IVX_REQUIRE_MATCHING_BACKEND !== 'false') {
    assert.equal(dashboard.backendCommitSha, env.EXPO_PUBLIC_SOURCE_COMMIT_SHA);
  }
  Object.assign(proof, {
    passed: true, stage: 'verified', generatedAt: dashboard.generatedAt,
    fleetMeasuredAt: signals.measuredAt, fleetCounts: counts,
  });
} catch (error) {
  // JSON parser and network exceptions may quote a response body or URL.
  // Only assertion summaries and exception names belong in public QA artifacts.
  proof.error = error instanceof AssertionError ? error.message.split('\n')[0]
    : error instanceof Error ? error.name : 'UnknownError';
  throw new Error(`Mission certificate failed at ${proof.stage}: ${proof.error}`);
} finally {
  proof.verifiedAt = new Date().toISOString();
  await mkdir('qa/evidence/dashboard-chat', { recursive: true });
  await writeFile('qa/evidence/dashboard-chat/mission-ledger-read.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof, null, 2));
}
