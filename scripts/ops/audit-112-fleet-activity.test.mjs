import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFleetAudit, runFleetAudit } from './audit-112-fleet-activity.mjs';
const now = Date.parse('2026-09-13T19:00:00Z');
const iso = offset => new Date(now + offset).toISOString();
const fixture = () => ({ observedAt: iso(0), agents: Array.from({ length: 112 }, (_, i) => ({ agentId: `ivx_holdings_${i + 1}`, agentNumber: i + 1, registryStatus: 'active', heartbeatAt: iso(-3_600_020) })), tasks: [] });
test('an hour-old heartbeat is not live just because its seconds component is small', () => {
  const raw = fixture(); raw.agents[0].heartbeatAt = iso(-40_000); raw.agents[1].heartbeatAt = iso(1000);
  const report = buildFleetAudit(raw); assert.equal(report.registryHeartbeatsFresh, 1); assert.equal(report.agents[2].heartbeatAgeMs, 3_600_020); assert.equal(report.runningWithFreshLeaseHeartbeat, 0); assert.equal(report.certified, false);
});
test('only the actual holder of a nonexpired RUNNING lease with recent heartbeat counts', () => {
  const raw = fixture(); raw.tasks = [
    { taskId: 'task', state: 'RUNNING', leaseHolder: 'agent:ivx_holdings_10', expiresAt: iso(1000), heartbeatAt: iso(-10_000), title: 'Real inspection' },
    { taskId: 'stale', state: 'RUNNING', leaseHolder: 'agent:ivx_holdings_11', expiresAt: iso(1000), heartbeatAt: iso(-61_000) },
    { taskId: 'expired', state: 'RUNNING', leaseHolder: 'agent:ivx_holdings_12', expiresAt: iso(-1), heartbeatAt: iso(-1000) },
  ]; const report = buildFleetAudit(raw);
  assert.equal(report.runningWithFreshLeaseHeartbeat, 1); assert.equal(report.agents[9].currentTasks[0].title, 'Real inspection'); assert.equal(report.verifiedProductiveAgents, null); assert.equal(report.measuredProductiveHours, null);
});
test('missing/duplicate registry or truncated task observation is unavailable, never 0/112', () => {
  for (const mutate of [s => s.agents.pop(), s => s.agents[1] = s.agents[0], s => s.tasks = Array(1001).fill({})]) {
    const raw = fixture(); mutate(raw); assert.throws(() => buildFleetAudit(raw), /INCOMPLETE/);
  }
});
test('connection is closed and a query failure rejects the read-only audit', async () => {
  const calls = [];
  await assert.rejects(runFleetAudit({ connectionString: 'postgres://example', createClient: async config => {
    assert.equal(config.statement_timeout, 5000);
    return { connect: async () => {}, query: async sql => { calls.push(sql); if (sql !== 'BEGIN READ ONLY') throw Error('timeout'); }, end: async () => { calls.push('closed'); } };
  } }), /timeout/);
  assert.equal(calls[0], 'BEGIN READ ONLY'); assert.equal(calls.at(-1), 'closed');
});
