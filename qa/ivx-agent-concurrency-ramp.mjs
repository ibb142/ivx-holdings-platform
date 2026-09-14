import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export async function runAgentRamp({ base, sha, key, runId, maxConcurrency = 16,
  fetcher = fetch, now = Date.now, report = {} }) {
  assert.equal(base, 'https://api.ivxholding.com', 'Unexpected production origin');
  assert.match(sha, /^[a-f0-9]{40}$/);
  assert.ok(key && /^[A-Za-z0-9_-]{1,80}$/.test(runId), 'Credential and unique run ID required');
  assert.ok([8, 12, 16].includes(maxConcurrency), 'Concurrency must be 8, 12 or 16');
  const deadline = now() + 10 * 60_000;
  Object.assign(report, { ok: false, sha, runId, startedAt: new Date(now()).toISOString(),
    concurrencyKind: 'agent_runtime_requests', fleetContinuityCertified: false, phases: [] });

  async function json(path, body) {
    assert.ok(now() < deadline, 'RUN_DEADLINE');
    let response;
    try {
      response = await fetcher(base + path, {
        method: body ? 'POST' : 'GET', redirect: 'error',
        signal: AbortSignal.timeout(Math.min(30_000, deadline - now())),
        headers: { 'Content-Type': 'application/json',
          ...(path.startsWith('/api/ivx/autonomous/') ? { 'X-IVX-System-Key': key } : {}),
          ...(body ? { 'X-IVX-Owner-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw new Error(body ? 'POST_TRANSPORT_UNCERTAIN_NO_REPLAY' : 'READ_TRANSPORT_FAILED'); }
    assert.equal(response.status, 200, `HTTP_${response.status}`);
    try { return await response.json(); } catch { throw new Error('INVALID_JSON_RESPONSE'); }
  }

  async function observe() {
    const version = await json('/version');
    assert.equal(version.commit, sha, 'DEPLOYMENT_CHANGED');
    const ready = await json('/health/ready');
    assert.equal(ready.ready, true, 'SERVICE_NOT_READY');
    const sample = await json('/api/ivx/autonomous/fleet-slo');
    assert.equal(sample.ok, true, 'TELEMETRY_UNAVAILABLE');
    assert.equal(sample.commit_sha, sha, 'TELEMETRY_SHA_MISMATCH');
    assert.equal(sample.durable, true, 'TELEMETRY_NOT_DURABLE');
    const age = now() - Date.parse(sample.measured_at);
    assert.ok(Number.isFinite(age) && age >= -5_000 && age <= 60_000, 'STALE_TELEMETRY');
    for (const name of ['leased_agents', 'running_agents', 'productive_agents']) {
      assert.ok(Number.isInteger(sample[name]) && sample[name] >= 0 && sample[name] <= 112, 'INVALID_FLEET_COUNT');
    }
    const observation = { measuredAt: sample.measured_at, leasedAgents: sample.leased_agents,
      runningAgents: sample.running_agents, productiveAgents: sample.productive_agents };
    report.latestFleetObservation = observation;
    // A known lease deficit is a stop condition, not a reason to add pressure.
    assert.ok(sample.leased_agents >= 8 && sample.running_agents >= 8, 'BASELINE_BELOW_8_LEASED_RUNNING_AGENTS');
    return observation;
  }

  try {
    report.baseline = await observe();
    const registry = await json('/api/ivx/agents');
    assert.equal(registry.ok, true);
    assert.equal(registry.totalAgents, 112);
    assert.equal(registry.agents?.length, 112);
    assert.equal(new Set(registry.agents.map(agent => agent.agentId)).size, 112);
    assert.equal(new Set(registry.agents.map(agent => agent.agentNumber)).size, 112);
    for (const agent of registry.agents) {
      assert.ok(typeof agent.agentId === 'string' && /^[A-Za-z0-9_-]+$/.test(agent.agentId));
      assert.ok(Number.isInteger(agent.agentNumber) && agent.agentNumber >= 1 && agent.agentNumber <= 112);
    }
    const agents = [...registry.agents].sort((a, b) => a.agentNumber - b.agentNumber);
    const levels = [8, 12, 16].filter(value => value <= maxConcurrency);
    let offset = 0;
    for (const [index, concurrency] of levels.entries()) {
      const phase = { concurrency, startedAt: new Date(now()).toISOString(), ok: false,
        before: await observe(), results: [] };
      report.phases.push(phase);
      const batch = agents.slice(offset, index === levels.length - 1 ? undefined : offset + concurrency * 3);
      offset += batch.length;
      let cursor = 0, stopped = false;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (!stopped && cursor < batch.length) {
          const agent = batch[cursor++], started = now();
          try {
            const contract = await json(`/api/ivx/agents/${agent.agentId}/contract`);
            const taskType = contract.contract?.allowedTaskTypes?.find(type => ['audit', 'analysis', 'research'].includes(type));
            assert.ok(taskType, 'NO_READ_ONLY_TASK');
            if (stopped) break;
            const taskId = `ramp-${runId}-${agent.agentNumber}`;
            const result = await json(`/api/ivx/agents/${agent.agentId}/run`, {
              taskType, payload: { __taskId: taskId,
                // Retain the existing Landing-focus guard for generic checks.
                __workflow: 'IVX 112 Live AI Worker Certificate',
                sourceSha: sha, readOnlyCertification: true, realExecutionOnly: true, simulatedSuccessAllowed: false },
            });
            const record = result.runRecord;
            assert.ok(result.ok === true && record?.finalStatus === 'completed'
              && record.simulated === false && record.fakeSuccess !== true
              && record.verifiedOutput === true && record.realToolUsed === true
              && typeof record.sourceReference === 'string' && record.sourceReference.length > 0
              && typeof record.toolResultId === 'string' && record.toolResultId.length > 0, 'UNVERIFIED_EXECUTION');
            phase.results.push({ agentNumber: agent.agentNumber, taskId, ok: true,
              durationMs: now() - started, toolResultId: record.toolResultId });
          } catch (error) {
            stopped = true;
            phase.results.push({ agentNumber: agent.agentNumber, ok: false,
              // Only local classification codes are retained; no response bodies or secrets.
              error: error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.message,
              durationMs: now() - started });
          }
        }
      }));
      assert.ok(!stopped && phase.results.length === batch.length, 'PHASE_FAILED_NO_ESCALATION');
      phase.after = await observe();
      phase.finishedAt = new Date(now()).toISOString();
      phase.ok = true;
    }
    report.ok = true;
  } catch (error) {
    report.error = error instanceof assert.AssertionError ? error.message.split('\n')[0] : error.message;
  } finally { report.finishedAt = new Date(now()).toISOString(); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.equal(process.env.IVX_ALLOW_AGENT_LOAD_TEST, 'true', 'Live load test must be explicitly selected');
  const result = await runAgentRamp({ base: 'https://api.ivxholding.com', sha: process.env.IVX_TARGET_SHA,
    key: process.env.IVX_SYSTEM_KEY, runId: process.env.GITHUB_RUN_ID,
    maxConcurrency: Number(process.env.IVX_RAMP_MAX_CONCURRENCY ?? 16) });
  await mkdir('qa/evidence', { recursive: true });
  await writeFile('qa/evidence/agent-concurrency-ramp.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, sha: result.sha, phases: result.phases.map(p => ({ concurrency: p.concurrency, ok: p.ok, results: p.results.length })), error: result.error,
    fleetContinuityCertified: false }));
  if (!result.ok) process.exitCode = 1;
}
