import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { collectTimerEvidence, summarizeTimerEvidence } from '../ivx-per-agent-timer-control.mjs';

const sourceSha = '9'.repeat(40);
const to = '2026-09-13T12:00:00.000Z';
const from = '2026-09-12T12:00:00.000Z';
const token = 'test-only-oidc-token';
function fixture() {
  return {
    sourceSha, from, to, observedAt: to,
    ledger: {
      ok: true, auth: 'oidc', marker: 'ivx-immutable-work-evidence-2026-09-10',
      hours: {
        from, to, historicalEvidenceIncomplete: false,
        agents: Array.from({ length: 112 }, (_, index) => ({
          agent_number: index + 1, observations: 2,
          attempted_seconds: 1200, passing_seconds: 900, nonpassing_seconds: 300,
        })),
      },
    },
    truth: {
      generatedAt: to, degraded: false, degradedDependencies: [],
      autonomous: {
        ownerControlVerified: true, dispatcherPaused: false, emergencyStop: false,
        ownerControl: { paused: false, stopped: false },
        provenQueueBackend: 'postgres_atomic',
      },
      agents: { rows: Array.from({ length: 112 }, (_, index) => ({
        agentNumber: index + 1, status: 'IDLE', actuallyWorking: false,
        paused: false, disabled: false,
      })) },
    },
  };
}
function client(data = fixture(), override = () => undefined) {
  const calls = [];
  return {
    calls,
    fetcher: async (input, options) => {
      const url = new URL(input);
      calls.push({ url, options });
      const alternative = override(url, calls.length);
      if (alternative !== undefined) return alternative;
      const body = url.pathname === '/health' ? { ok: true, commit: sourceSha }
        : url.pathname === '/api/ivx/autonomous/truth' ? data.truth : data.ledger;
      return new Response(JSON.stringify(body), { status: 200 });
    },
  };
}
const collect = fetcher => collectTimerEvidence({ token, sourceSha, fetcher, now: () => Date.parse(to) });

test('observes all 112 agents with four reads; only the ledger receives OIDC', async () => {
  const c = client();
  const report = await collect(c.fetcher);
  assert.equal(c.calls.length, 4);
  assert(c.calls.every(call => call.url.origin === 'https://api.ivxholding.com'
    && call.options.method === 'GET' && call.options.redirect === 'error'
    && call.options.signal instanceof AbortSignal));
  const authenticated = c.calls.filter(call => call.options.headers['X-IVX-GitHub-OIDC']);
  assert.equal(authenticated.length, 1);
  assert.equal(authenticated[0].url.pathname, '/api/ivx/autonomous/agent-ledger');
  assert.equal(authenticated[0].url.searchParams.get('from'), from);
  assert.equal(authenticated[0].url.searchParams.get('to'), to);
  assert.equal(report.agents.length, 112);
  assert.equal(report.agents[0].qaPassingHours24h, 0.25);
  assert.equal(report.agents[0].qaNonpassingSeconds24h, 300);
  assert.equal(report.timerGate, 'PASS');
  assert.equal(report.targetStatus, 'BREACH');
  assert.equal(report.certified, false);
  assert.match(report.scope, /coding and other tool execution time are not measured/);
});

test('an active agent with no QA evidence remains an explicit gap', () => {
  const f = fixture();
  Object.assign(f.ledger.hours.agents[0], {
    observations: 0, attempted_seconds: 0, passing_seconds: 0, nonpassing_seconds: 0,
  });
  f.truth.agents.rows[0].status = 'WORKING';
  f.truth.agents.rows[0].actuallyWorking = true;
  const report = summarizeTimerEvidence(f);
  assert.equal(report.timerGate, 'FAIL');
  assert.equal(report.eligibleAgentsWithoutQaEvidence, 1);
  assert.equal(report.agents[0].actuallyWorking, true);
  assert.equal(report.agents[0].qaTimerState, 'NO_QA_EVIDENCE');
});

test('owner pauses and disabled agents are preserved and excluded from the active timer gate', () => {
  for (const field of ['paused', 'disabled']) {
    const f = fixture();
    Object.assign(f.ledger.hours.agents[0], {
      observations: 0, attempted_seconds: 0, passing_seconds: 0, nonpassing_seconds: 0,
    });
    f.truth.agents.rows[0][field] = true;
    const report = summarizeTimerEvidence(f);
    assert.equal(report.eligibleAgents, 111);
    assert.equal(report.agents[0].eligible, false);
    assert.equal(report.timerGate, 'PASS');
  }
  const f = fixture();
  f.truth.autonomous.ownerControl.paused = true;
  const report = summarizeTimerEvidence(f);
  assert.equal(report.targetStatus, 'HELD');
  assert.equal(report.eligibleAgents, 0);
  assert.equal(report.dispatch.productionMutations, 0);
});

test('partial historical coverage cannot pass a complete rolling-window gate', () => {
  const f = fixture();
  f.ledger.hours.historicalEvidenceIncomplete = true;
  const report = summarizeTimerEvidence(f);
  assert.equal(report.observationStatus, 'INCOMPLETE');
  assert.equal(report.timerGate, 'FAIL');
  assert.equal(report.certified, false);
});

test('rejects malformed coverage, window, durations and unavailable owner controls', () => {
  const cases = [
    f => f.ledger.hours.agents.pop(),
    f => { f.ledger.hours.agents[1].agent_number = 1; },
    f => { f.truth.agents.rows[1].agentNumber = 1; },
    f => { f.ledger.hours.agents[0].passing_seconds = -1; },
    f => { f.ledger.hours.agents[0].attempted_seconds = 90000; },
    f => { f.ledger.hours.agents[0].observations = 1.5; },
    f => { f.ledger.hours.agents[0].nonpassing_seconds = 0; },
    f => { f.ledger.hours.to = '2026-09-13T11:59:59.000Z'; },
    f => { delete f.ledger.hours.historicalEvidenceIncomplete; },
    f => { f.ledger.auth = 'system_key'; },
    f => { f.truth.degraded = true; },
    f => { f.truth.generatedAt = from; },
    f => { f.truth.autonomous.ownerControlVerified = false; },
    f => { delete f.truth.agents.rows[0].paused; },
  ];
  for (const mutate of cases) {
    const f = fixture();
    mutate(f);
    assert.throws(() => summarizeTimerEvidence(f));
  }
});

test('an HTTP outage or invalid JSON is rejected without fabricated zero-hour rows', async () => {
  for (const response of [
    new Response('unavailable', { status: 503 }),
    new Response('not-json', { status: 200 }),
    new Response('', { status: 302 }),
  ]) {
    const c = client(fixture(), url => url.pathname.includes('agent-ledger') ? response : undefined);
    await assert.rejects(collect(c.fetcher), /LEDGER_(HTTP_503|JSON_INVALID|HTTP_302)/);
    assert(c.calls.every(call => call.options.method === 'GET'));
  }
});

test('a deployment mismatch stops the audit before querying durable data', async () => {
  const c = client(fixture(), () => new Response(JSON.stringify({ ok: true, commit: '8'.repeat(40) })));
  await assert.rejects(collect(c.fetcher), /DEPLOYMENT_SHA_MISMATCH/);
  assert.equal(c.calls.length, 1);
});

test('a deployment change during the observation is not accepted', async () => {
  const c = client(fixture(), (url, count) => url.pathname === '/health' && count === 4
    ? new Response(JSON.stringify({ ok: true, commit: '8'.repeat(40) })) : undefined);
  await assert.rejects(collect(c.fetcher), /DEPLOYMENT_SHA_MISMATCH/);
});

test('missing OIDC stops before requests; transport errors do not expose credentials', async () => {
  let calls = 0;
  await assert.rejects(collectTimerEvidence({
    token: '', sourceSha, fetcher: async () => { calls++; },
  }), /OIDC_TOKEN_MISSING/);
  assert.equal(calls, 0);
  await assert.rejects(collect(async () => { throw new Error('credential=' + token); }), error => {
    assert.equal(error.message, 'HEALTH_REQUEST_UNAVAILABLE');
    assert(!error.message.includes(token));
    return true;
  });
});

test('the executable preserves an UNAVAILABLE artifact when authentication is missing', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ivx-timer-test-'));
  try {
    const env = { ...process.env, GITHUB_REPOSITORY: 'ibb142/ivx-holdings-platform',
      GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sourceSha };
    delete env.IVX_GITHUB_OIDC;
    const result = spawnSync(process.execPath, [
      fileURLToPath(new URL('../ivx-per-agent-timer-control.mjs', import.meta.url)),
    ], { cwd: dir, env, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, 1);
    const report = JSON.parse(await readFile(join(dir, 'qa/evidence/per-agent-timers/timers.json'), 'utf8'));
    assert.equal(report.observationStatus, 'UNAVAILABLE');
    assert.equal(report.error, 'OIDC_TOKEN_MISSING');
    assert.equal(report.agents, null);
    assert.equal(report.certified, false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
