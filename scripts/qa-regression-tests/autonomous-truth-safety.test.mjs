import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { test } from 'node:test';

// Run the actual production module in a fresh VM per test. Only its external
// dependencies are replaced. No database, provider, worker, or network is used.
// These tests prove local safety behavior, NOT live 112-agent certification.
const sourceUrl = process.env.IVX_SAFETY_SOURCE
  ? new URL(process.env.IVX_SAFETY_SOURCE, `file://${process.cwd()}/`)
  : new URL('../../backend/services/ivx-autonomous-truth-control.ts', import.meta.url);
const source = readFileSync(sourceUrl, 'utf8');
const javascript = stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: sourceUrl.href });
const now = Date.parse('2026-09-07T10:00:00.000Z');
const fresh = new Date(now - 1_000).toISOString();
const control = () => ({ paused: false, stopped: false, pausedAgents: [], stoppedAgents: [] });
const row = (agentNumber, fields = {}) => ({
  agentNumber, agentId: `ivx_holdings_${agentNumber}`, availability: 'available',
  activeTaskId: null, lastHeartbeat: fresh, pauseState: false, disabledState: false,
  health: 'healthy', queueDepth: 0, totalRuns: 0, successfulRuns: 0, failedRuns: 0,
  evidenceCount: 0, ...fields,
});
const plain = value => JSON.parse(JSON.stringify(value));

async function fixture(options = {}) {
  const calls = [], warnings = [];
  const agents = options.agents ?? [row(1), row(2), row(3)];
  let reads = 0;
  const context = createContext({
    process: { env: {} },
    console: { warn: (...args) => warnings.push(args) },
    Date: class extends Date { static now() { return now; } },
    // Advance dependency deadlines quickly in tests; this is not latency proof.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 20)), clearTimeout,
  });
  const recordMutation = name => (...args) => { calls.push([name, ...args]); };
  const modules = {
    './ivx-agent-runtime': {
      getAllExecutionStates: () => agents,
      pauseAgent: recordMutation('pauseAgent'), resumeAgent: recordMutation('resumeAgent'),
      disableAgent: recordMutation('disableAgent'), enableAgent: recordMutation('enableAgent'),
    },
    './ivx-campaign-dispatcher': {
      getCampaignDispatcherSnapshot: () => {
        if (options.snapshotThrows) throw new Error('password=DO_NOT_LEAK');
        if (options.snapshotRejects) return Promise.reject(new Error('token=DO_NOT_LEAK'));
        if (options.snapshotHangs) return new Promise(() => {});
        return {
          paused: options.dispatcherPaused ?? false, emergencyStop: options.emergencyStop ?? false,
          totals: { pendingOwner: 0, awaitingImplement: 0, queued: 12, running: 0, completed: 0, failed: 0, blocked: 0 },
          maxConcurrency: 12,
        };
      },
      listCampaignDispatcherRecords: () => [],
      runCampaignBootRecovery: async () => {
        calls.push(['runCampaignBootRecovery']);
        if (options.preparationFails) throw new Error('password=DO_NOT_LEAK');
        return 0;
      },
      startCampaignDispatcher: recordMutation('startCampaignDispatcher'),
      campaignDispatcherControl: async (action, number) => {
        calls.push(['campaignDispatcherControl', action, number]);
        if (action === 'retry_agent' && options.failedAgents?.includes(number)) throw new Error('token=DO_NOT_LEAK');
        if (action === 'resume_all' && options.resumeFails) throw new Error('secret=DO_NOT_LEAK');
        if (action === 'retry_agent' && options.makeWorking) {
          const agent = agents.find(item => item.agentNumber === number);
          agent.availability = 'busy'; agent.activeTaskId = `task-${number}`; agent.lastHeartbeat = fresh;
        }
        return { action, changed: true, cancelledWorkerJobs: [] };
      },
    },
    './ivx-app-completion-campaign': {
      loadControlState: async () => options.ownerControl ?? control(),
      updateControlState: recordMutation('updateControlState'),
      syncCampaignAssignmentsToDispatcher: async () => calls.push(['syncCampaignAssignmentsToDispatcher']),
    },
    './ivx-github-actions-external-supervisor': { getGitHubActionsExternalSupervisorStatus: () => null },
    './ivx-autonomous-scheduler': {
      getSchedulerState: () => ({ enabled: options.schedulerEnabled ?? true }),
      setSchedulerEnabled: async enabled => calls.push(['setSchedulerEnabled', enabled]),
    },
    './ivx-autonomous-control-policy': {
      activeFleetMutationAuthorityCount: () => 1,
      autonomousQueueBackend: () => 'postgres_atomic', autonomousRepairCapacity: () => 12,
    },
    './ivx-project-vision': {
      evaluateFleetActivationEvidence: () => ({ certified: false, blockers: ['unit-test-not-a-live-certificate'] }),
    },
    './ivx-durable-store': {
      isDurableStoreConfigured: () => options.storeConfigured ?? true,
      readDurableJson: async (key, fallback) => {
        reads += 1;
        assert.equal(key, 'logs/audit/app-completion/campaign-state.json');
        assert.equal(fallback, null);
        if (options.ownerReadThrows) throw new Error('password=DO_NOT_LEAK');
        if (options.ownerReadHangs) return new Promise(() => {});
        return Object.hasOwn(options, 'storedRecord') ? options.storedRecord : { control: options.ownerControl ?? control() };
      },
    },
    'node:crypto': { randomUUID },
  };
  const module = new SourceTextModule(javascript, { context, identifier: sourceUrl.href });
  await module.link(specifier => {
    assert.ok(Object.hasOwn(modules, specifier), `Unexpected dependency: ${specifier}`);
    const values = modules[specifier];
    return new SyntheticModule(Object.keys(values), function () {
      for (const [name, value] of Object.entries(values)) this.setExport(name, value);
    }, { context });
  });
  await module.evaluate();
  return { api: module.namespace, calls, warnings, agents, reads: () => reads };
}

for (const [name, options] of [
  ['unconfigured durable store', { storeConfigured: false }],
  ['unavailable owner state', { ownerReadThrows: true }],
  ['timed-out owner read', { ownerReadHangs: true }],
  ['missing persisted owner record', { storedRecord: null }],
  ['missing control object', { storedRecord: {} }],
  ['partial control object', { storedRecord: { control: { paused: false } } }],
  ['string false flag', { ownerControl: { ...control(), stopped: 'false' } }],
  ['invalid paused-agent list', { ownerControl: { ...control(), pausedAgents: ['1'] } }],
  ['out-of-registry agent number', { ownerControl: { ...control(), stoppedAgents: [113] } }],
]) {
  test(`no mutations with ${name}`, async () => {
    const f = await fixture(options);
    const result = await f.api.enforceAutonomous112RuntimeTruth();
    assert.equal(result.ok, false);
    assert.equal(result.action, 'owner_control_unavailable');
    assert.deepEqual(f.calls, []);
    assert.deepEqual(plain(result.recovered), []);
    assert.match(result.traceId, /^[0-9a-f-]{36}$/);
    assert.ok(!JSON.stringify(f.warnings).includes('DO_NOT_LEAK'));
  });
}

for (const field of ['paused', 'stopped']) {
  test(`respects explicit global owner ${field}`, async () => {
    const f = await fixture({ ownerControl: { ...control(), [field]: true } });
    const result = await f.api.enforceAutonomous112RuntimeTruth();
    assert.equal(result.action, 'explicit_owner_stop_respected');
    assert.deepEqual(f.calls, []);
  });
}

test('respects emergency stop', async () => {
  const f = await fixture({ emergencyStop: true });
  assert.equal((await f.api.enforceAutonomous112RuntimeTruth()).action, 'emergency_stop_respected');
  assert.deepEqual(f.calls, []);
});

for (const option of ['snapshotThrows', 'snapshotRejects', 'snapshotHangs']) {
  test(`dependency ${option} yields degraded truth without recovery or raw errors`, async () => {
    const f = await fixture({ [option]: true });
    const snapshot = await f.api.getAutonomousTruthSnapshot();
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.ok, false);
    assert.equal(snapshot.autonomous.emergencyStop, true);
    assert.equal((await f.api.enforceAutonomous112RuntimeTruth()).action, 'truth_dependencies_unavailable');
    assert.deepEqual(f.calls, []);
    assert.ok(!JSON.stringify(f.warnings).includes('DO_NOT_LEAK'));
  });
}

test('queued work alone is not a working Autonomous manager', async () => {
  const f = await fixture();
  const snapshot = await f.api.getAutonomousTruthSnapshot();
  assert.equal(snapshot.autonomous.queuedJobs, 12);
  assert.equal(snapshot.autonomous.working, false);
  assert.deepEqual(f.calls, []);
});

test('future-dated runtime heartbeat cannot certify a working agent', async () => {
  const f = await fixture({ agents: [row(1, { availability: 'busy', activeTaskId: 'task-1', lastHeartbeat: new Date(now + 60_000).toISOString() })] });
  const snapshot = await f.api.getAutonomousTruthSnapshot();
  assert.equal(snapshot.agents.counts.working, 0);
  assert.equal(snapshot.agents.rows[0].heartbeatFresh, false);
});

test('fresh busy runtime with task remains valid working evidence', async () => {
  const f = await fixture({ agents: [row(1, { availability: 'busy', activeTaskId: 'task-1' })] });
  assert.equal((await f.api.getAutonomousTruthSnapshot()).agents.counts.working, 1);
});

test('per-agent persisted owner holds survive recovery of other agents', async () => {
  const f = await fixture({ ownerControl: { ...control(), pausedAgents: [1], stoppedAgents: [2] } });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.deepEqual(plain(result.retryRequested), [3]);
  assert.ok(!f.calls.some(call => call[0] === 'campaignDispatcherControl' && call[1] === 'resume_all'));
  assert.deepEqual(f.calls.filter(call => call[0] === 'resumeAgent'), [['resumeAgent', 'ivx_holdings_3']]);
});

test('paused dispatcher plus per-agent hold cannot trigger global resume', async () => {
  const f = await fixture({ dispatcherPaused: true, ownerControl: { ...control(), stoppedAgents: [2] } });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.action, 'owner_agent_hold_requires_targeted_recovery');
  assert.deepEqual(f.calls, []);
});

test('runtime-paused agents are not automatically resumed', async () => {
  const f = await fixture({ agents: [row(1, { pauseState: true }), row(2)] });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.deepEqual(plain(result.retryRequested), [2]);
  assert.ok(!f.calls.some(call => call[1] === 'resume_all'));
});

test('failed retry is neither resumed nor reported as recovered', async () => {
  const f = await fixture({ failedAgents: [2], makeWorking: true });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.ok, false);
  assert.equal(result.action, 'recovery_failed');
  assert.deepEqual(plain(result.failedAgents), [2]);
  assert.deepEqual(plain(result.recovered), [1, 3]);
  assert.ok(!f.calls.some(call => call[0] === 'resumeAgent' && call[1] === 'ivx_holdings_2'));
  assert.ok(!JSON.stringify(f.warnings).includes('DO_NOT_LEAK'));
});

test('accepted retries without fresh task execution are not recovered work', async () => {
  const f = await fixture();
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.action, 'recovery_requested');
  assert.deepEqual(plain(result.retryRequested), [1, 2, 3]);
  assert.deepEqual(plain(result.recovered), []);
  assert.equal(result.ok, false);
});

test('global resume failure is returned explicitly', async () => {
  const f = await fixture({ resumeFails: true });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.action, 'recovery_failed');
  assert.equal(result.resumeFailed, true);
  assert.equal(result.ok, false);
});

test('preparation failure stops before per-agent mutation', async () => {
  const f = await fixture({ preparationFails: true });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.action, 'recovery_preparation_failed');
  assert.ok(!f.calls.some(call => call[0] === 'resumeAgent' || call[0] === 'campaignDispatcherControl'));
  assert.ok(!JSON.stringify(f.warnings).includes('DO_NOT_LEAK'));
});

test('concurrent recovery calls coalesce into one local attempt', async () => {
  const f = await fixture();
  const [one, two, three] = await Promise.all([
    f.api.enforceAutonomous112RuntimeTruth(), f.api.enforceAutonomous112RuntimeTruth(), f.api.enforceAutonomous112RuntimeTruth(),
  ]);
  assert.equal(one.traceId, two.traceId);
  assert.equal(one.traceId, three.traceId);
  assert.equal(f.reads(), 1);
  assert.equal(f.calls.filter(call => call[0] === 'campaignDispatcherControl' && call[1] === 'retry_agent').length, 3);
});

test('112 registered agents still respect deployed capacity of 12', async () => {
  const f = await fixture({ agents: Array.from({ length: 112 }, (_, index) => row(index + 1)) });
  const result = await f.api.enforceAutonomous112RuntimeTruth();
  assert.equal(result.recoverableTotal, 112);
  assert.equal(result.retryRequested.length, 12);
  assert.equal(result.recoveryCapacity, 12);
  assert.equal(result.ok, false); // Registration does not prove a live fleet.
});
