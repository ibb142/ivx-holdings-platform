import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAgentRamp } from './ivx-agent-concurrency-ramp.mjs';

const sha = 'a'.repeat(40);
function fixture({ baseline = 8, failAgent, uncertain = false } = {}) {
  const posts = [], activeByPhase = [], inFlight = new Set();
  let peak = 0;
  const fetcher = async (url, options) => {
    const path = new URL(url).pathname;
    const json = body => ({ status: 200, json: async () => body });
    if (path === '/version') return json({ commit: sha });
    if (path === '/health/ready') return json({ ready: true });
    if (path.endsWith('/fleet-slo')) return json({ ok: true, commit_sha: sha, durable: true,
      measured_at: new Date().toISOString(), leased_agents: baseline, running_agents: baseline, productive_agents: baseline });
    if (path === '/api/ivx/agents') return json({ ok: true, totalAgents: 112,
      agents: Array.from({ length: 112 }, (_, i) => ({ agentId: `agent-${i + 1}`, agentNumber: i + 1 })) });
    if (path.endsWith('/contract')) return json({ contract: { allowedTaskTypes: ['audit'] } });
    const body = JSON.parse(options.body), number = Number(path.split('/').at(-2).split('-')[1]);
    posts.push({ number, body }); inFlight.add(number); peak = Math.max(peak, inFlight.size);
    activeByPhase.push(inFlight.size);
    await new Promise(resolve => setTimeout(resolve, 1));
    inFlight.delete(number);
    if (number === failAgent) {
      if (uncertain) throw new Error('potentially sensitive transport detail');
      return { status: 429 };
    }
    return json({ ok: true, runRecord: { finalStatus: 'completed', simulated: false,
      realToolUsed: true, verifiedOutput: true, sourceReference: 'repo/source.ts', toolResultId: `tool-${number}` } });
  };
  return { fetcher, posts, inFlight, get peak() { return peak; }, activeByPhase };
}
const config = { base: 'https://api.ivxholding.com', sha, key: 'test-only-secret', runId: 'test-1' };

test('8/12/16 phases cover each agent once, await in-flight work and keep leases distinct', async () => {
  const f = fixture(), result = await runAgentRamp({ ...config, fetcher: f.fetcher });
  assert.equal(result.ok, true);
  assert.deepEqual(result.phases.map(p => [p.concurrency, p.results.length]), [[8,24],[12,36],[16,52]]);
  assert.equal(new Set(f.posts.map(p => p.number)).size, 112);
  assert.equal(f.peak, 16); assert.equal(f.inFlight.size, 0);
  assert.equal(result.fleetContinuityCertified, false);
  assert.ok(f.posts.every(p => p.body.payload.__workflow === 'IVX 112 Live AI Worker Certificate'));
  assert.ok(!JSON.stringify(result).includes(config.key));
});

test('a deficient lease baseline prevents every production POST', async () => {
  const f = fixture({ baseline: 5 }), result = await runAgentRamp({ ...config, fetcher: f.fetcher });
  assert.equal(result.ok, false); assert.equal(f.posts.length, 0);
  assert.match(result.error, /BASELINE_BELOW_8/);
});

for (const uncertain of [false, true]) test(`phase failure stops admission and never replays a POST (uncertain=${uncertain})`, async () => {
  const f = fixture({ failAgent: 1, uncertain }), result = await runAgentRamp({ ...config, fetcher: f.fetcher });
  assert.equal(result.ok, false); assert.equal(result.phases.length, 1);
  assert.ok(f.posts.length <= 8); assert.equal(new Set(f.posts.map(p => p.number)).size, f.posts.length);
  assert.equal(f.inFlight.size, 0);
  assert.ok(!JSON.stringify(result).includes('potentially sensitive'));
});
