import assert from 'node:assert/strict';
import { decideRetry, isTransientFailure, retryAfterMs } from '../backend/services/ivx-retry-policy';

const PATH = '/api/ivx/autonomous/fleet-slo';
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
type Config = { base: string; sha: string; key: string; fetcher?: typeof fetch };

function validateConfig(config: Config) {
  assert(['https://api.ivxholding.com', 'https://ivx-holdings-platform.onrender.com'].includes(config.base), 'Unexpected production origin');
  assert(/^[a-f0-9]{40}$/i.test(config.sha), 'Expected production SHA is required');
  assert(config.key.trim(), 'Fleet SLO system credential is required');
}

// Read-only probes share the production retry policy; authentication failures
// and invalid telemetry fail immediately. Never log a credential or response body.
async function get(config: Config, path: string, authenticated: boolean) {
  const startedAtMs = Date.now();
  let retriesUsed = 0;
  for (;;) {
    let status = 0;
    let after = 0;
    let failure: unknown;
    try {
      const response = await (config.fetcher ?? fetch)(config.base + path, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: authenticated ? { 'X-IVX-System-Key': config.key } : {},
      });
      status = response.status;
      after = retryAfterMs(response.headers.get('retry-after'));
      const body = await response.text();
      if (!isTransientFailure(null, status)) return { response, body };
      failure = new Error(`Production probe HTTP ${status}`);
    } catch (error) { failure = error; }
    const decision = decideRetry({ retriesUsed, maxRetries: 6, startedAtMs, nowMs: Date.now(), maxElapsedMs: 30_000, retryAfterMs: after });
    if (!isTransientFailure(failure, status) || !decision.retry) throw new Error(`Production probe failed: ${path}, HTTP ${status || 'unavailable'}`);
    retriesUsed = decision.nextRetry;
    await sleep(decision.delayMs);
  }
}

function count(value: unknown, max = 112): asserts value is number {
  assert(typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max, 'Invalid fleet count');
}

function fresh(timestamp: unknown) {
  assert(typeof timestamp === 'string', 'Missing telemetry timestamp');
  const age = Date.now() - Date.parse(timestamp);
  assert(Number.isFinite(age) && age >= -5_000 && age <= 60_000, 'Fleet telemetry is stale');
}

export async function verifyFleetSloLive(config: Config) {
  validateConfig(config);
  const denied = await get(config, PATH, false);
  assert.equal(denied.response.status, 401, 'Unauthenticated telemetry must be denied');
  const json = await get(config, PATH, true);
  assert.equal(json.response.status, 200, 'Authenticated telemetry unavailable');
  const sample = JSON.parse(json.body);
  assert.equal(sample.ok, true);
  assert.equal(sample.marker, 'ivx-fleet-slo-2026-09-08-v1');
  assert.equal(sample.retry_policy, 'ivx-fleet-retry-policy-2026-09-08-v1');
  assert.equal(sample.commit_sha, config.sha, 'Fleet sample belongs to another deployment');
  assert.equal(sample.durable, true, 'Sample must be persisted');
  assert.equal(sample.target_agents, 112);
  fresh(sample.measured_at);
  for (const field of ['productive_agents', 'running_agents', 'leased_agents', 'heartbeat_agents']) count(sample[field]);
  count(sample.retry_waiting_tasks, Number.MAX_SAFE_INTEGER);
  assert.equal(sample.productive_deficit, 112 - sample.productive_agents);
  assert.equal(sample.productivity_ratio, sample.productive_agents / 112);
  assert.equal(sample.status, sample.productive_agents === 112 ? 'MET' : 'BREACH');

  const prometheus = await get(config, PATH + '?format=prometheus', true);
  assert.equal(prometheus.response.status, 200);
  assert(prometheus.response.headers.get('content-type')?.startsWith('text/plain'));
  const gauges = Object.fromEntries(prometheus.body.split('\n').filter((line) => line.startsWith('ivx_fleet_')).map((line) => {
    const [name, value] = line.trim().split(/\s+/);
    return [name.slice('ivx_fleet_'.length), Number(value)];
  }));
  assert.equal(gauges.telemetry_available, 1);
  assert.equal(gauges.target_agents, 112);
  for (const field of ['productive_agents', 'running_agents', 'leased_agents', 'heartbeat_agents']) count(gauges[field]);
  count(gauges.retry_waiting_tasks, Number.MAX_SAFE_INTEGER);
  assert.equal(gauges.productive_deficit, 112 - gauges.productive_agents);
  assert.equal(gauges.productivity_ratio, gauges.productive_agents / 112);
  assert.equal(gauges.slo_met, gauges.productive_agents === 112 ? 1 : 0);
  assert(Number.isFinite(gauges.sample_timestamp_seconds));
  fresh(new Date(gauges.sample_timestamp_seconds * 1_000).toISOString());
  return { verification: 'PASS', sha: config.sha, measured_at: sample.measured_at, productive_agents: sample.productive_agents, target_agents: 112, slo_status: sample.status, durable: true, unauthenticated_http: 401, authenticated_json_http: 200, prometheus_http: 200 };
}

if (import.meta.main) {
  const config = { base: (process.env.API_BASE ?? '').replace(/\/$/, ''), sha: process.env.GITHUB_SHA ?? '', key: process.env.IVX_SYSTEM_KEY ?? '' };
  console.log(JSON.stringify(await verifyFleetSloLive(config)));
  const boots = new Map<string, string>();
  const requiredInstances = Number(process.env.IVX_EXPECTED_API_INSTANCES ?? 2);
  assert([1, 2].includes(requiredInstances));
  for (let index = 0; index <= 20; index++) {
    if (index) await sleep(15_000);
    // Health must pass on its first attempt; retries would hide a restart.
    const started = Date.now();
    const response = await fetch(config.base + '/health', { redirect: 'error', signal: AbortSignal.timeout(5_000), headers: { Connection: 'close' } });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.scope, 'liveness');
    assert.equal(health.commit, config.sha);
    assert.equal(typeof health.bootTime, 'string');
    assert(Number.isFinite(Date.parse(health.bootTime)));
    const instance = health.instanceId ?? 'legacy-single-instance';
    assert.equal(typeof instance, 'string');
    if (boots.has(instance)) assert.equal(health.bootTime, boots.get(instance), 'Instance boot time changed during verification');
    else boots.set(instance, health.bootTime);
    assert(boots.size <= requiredInstances, 'Unexpected process replacement during stability verification');
    console.log(JSON.stringify({ stability_sample: index, instanceId: instance, bootTime: health.bootTime, health_ms: Date.now() - started, sha: health.commit }));
  }
  console.log(JSON.stringify(await verifyFleetSloLive(config)));
  assert.equal(boots.size, requiredInstances, 'Load balancer did not serve every expected replica');
  console.log(`fleet_slo_contract=PASS health_stability_seconds=300 stable_api_instances=${boots.size}`);
  // BREACH is reported explicitly: a working alerting contract does not imply
  // that the fleet has met its productivity objective.
}
