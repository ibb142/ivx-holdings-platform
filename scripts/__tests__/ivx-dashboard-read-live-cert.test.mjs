import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'node:test';

const script = fileURLToPath(new URL('../ivx-dashboard-read-live-cert.mjs', import.meta.url));
const sha = 'a'.repeat(40);
const privateValue = 'fixture-private-owner-token';
function dashboard() {
  return { ok: true, dashboard: {
    generatedAt: new Date().toISOString(), backendCommitSha: sha,
    agents: Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1 })),
    enterprise112: { ledgerOk: true },
    fleetSignals: { status: 'AVAILABLE', measuredAt: new Date().toISOString(),
      maxAgeMs: 15_000, commitSha: sha,
      counts: { heartbeat: 0, assigned: 1, running: 0, productive: 0 },
      agents: Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1,
        heartbeatFresh: false, assignedTasks: i === 0 ? 1 : 0, running: false, productive: false, evidence: null })),
    },
  } };
}

// Only fixture traffic reaches this local server; none of these cases is live certification.
for (const scenario of ['fresh', 'stale', 'wrong_commit', 'unknown', 'inconsistent_counts', 'invalid_json', 'connection_closed']) {
  test(`mission certificate ${scenario} and private failure diagnostics`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'ivx-mission-contract-'));
    const server = createServer((req, res) => {
      if (req.url.startsWith('/auth/v1/token')) {
        res.end(JSON.stringify({ access_token: privateValue }));
        return;
      }
      if (req.headers.authorization !== `Bearer ${privateValue}`) { res.writeHead(401).end(); return; }
      if (scenario === 'connection_closed') { req.socket.destroy(); return; }
      if (scenario === 'invalid_json') { res.end(`private response: ${privateValue}`); return; }
      const body = dashboard();
      const signals = body.dashboard.fleetSignals;
      if (scenario === 'stale') signals.measuredAt = new Date(Date.now() - 60_000).toISOString();
      if (scenario === 'wrong_commit') signals.commitSha = 'b'.repeat(40);
      if (scenario === 'unknown') signals.status = 'UNKNOWN';
      if (scenario === 'inconsistent_counts') signals.counts.running = 112;
      res.end(JSON.stringify(body));
    });
    try {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      const base = `http://127.0.0.1:${server.address().port}`;
      const result = await promisify(execFile)(process.execPath, [script], { cwd, env: {
        ...process.env, EXPO_PUBLIC_API_BASE_URL: base, EXPO_PUBLIC_SUPABASE_URL: base,
        EXPO_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon', OWNER_EMAIL: 'owner@example.test',
        OWNER_PASSWORD_EFFECTIVE: privateValue, EXPO_PUBLIC_SOURCE_COMMIT_SHA: sha,
        IVX_REQUIRE_MATCHING_BACKEND: 'true',
      } }).then(value => ({ ...value, code: 0 }), error => error);
      const raw = await readFile(join(cwd, 'qa/evidence/dashboard-chat/mission-ledger-read.json'), 'utf8');
      const proof = JSON.parse(raw);
      assert.equal(result.code, scenario === 'fresh' ? 0 : 1);
      assert.equal(proof.passed, scenario === 'fresh');
      assert.equal(proof.authenticatedOwner, true);
      assert.equal(proof.stage, scenario === 'fresh' ? 'verified' : ['invalid_json', 'connection_closed'].includes(scenario) ? 'mission_read' : 'mission_contract');
      assert.equal(proof.httpStatus, scenario === 'connection_closed' ? null : 200);
      assert.equal(typeof proof.elapsedMs, 'number');
      assert.equal(`${raw}${result.stdout}${result.stderr}`.includes(privateValue), false);
      if (scenario === 'fresh') assert.deepEqual(proof.fleetCounts, { heartbeat: 0, assigned: 1, running: 0, productive: 0 });
      if (scenario === 'invalid_json') assert.equal(proof.error, 'SyntaxError');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
