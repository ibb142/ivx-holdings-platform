import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';

const transpiler = new Bun.Transpiler({ loader: 'ts' });
const serverSource = readFileSync(new URL('../../server.ts', import.meta.url), 'utf8');
const campaignSource = readFileSync(new URL('./ivx-app-completion-campaign.ts', import.meta.url), 'utf8');
const truthSource = readFileSync(new URL('./ivx-autonomous-truth-control.ts', import.meta.url), 'utf8');

function controlRoute(owner: boolean) {
  const app = new Hono();
  const changes: string[] = [];
  const source = serverSource.slice(serverSource.indexOf("app.post('/api/ivx/autonomous/control'"), serverSource.indexOf("app.options('/api/ivx/autonomous/voice'"));
  vm.runInNewContext(transpiler.transformSync(source), {
    app,
    verifyIVXGitHubActionsOIDCRequest: async () => true,
    assertIVXRegisteredOwnerBearer: async () => {
      if (!owner) throw Object.assign(new Error('Owner session required'), { status: 401 });
      return { approval: 'verified-owner' };
    },
    applyTruthControl: async (action: string) => { changes.push(action); return {}; },
  });
  return { changes, request: (action: string) => app.request('/api/ivx/autonomous/control', {
    method: 'POST', headers: { 'content-type': 'application/json', 'X-IVX-GitHub-OIDC': 'synthetic-machine' }, body: JSON.stringify({ action }),
  }) };
}

test('dashboard control rejects machine-only start and resume before any mutation', async () => {
  const route = controlRoute(false);
  for (const action of ['start_all', 'resume_all', 'pause_all', 'stop_all']) {
    expect((await route.request(action)).status).toBe(401);
  }
  expect(route.changes).toEqual([]);
});

test('the registered owner retains dashboard control authorization', async () => {
  const route = controlRoute(true);
  for (const action of ['start_all', 'resume_all', 'pause_all', 'stop_all']) {
    const response = await route.request(action);
    expect(response.status).toBe(200);
    expect((await response.json()).authorization).toBe('verified-owner');
  }
  expect(route.changes).toEqual(['start_all', 'resume_all', 'pause_all', 'stop_all']);
});

function isolatedControls() {
  let stored = { control: { paused: false, stopped: false, pausedAgents: [2], stoppedAgents: [3] } };
  let failWrite = false;
  const mutations: string[] = [];
  const states = [1, 2, 3].map(agentNumber => ({ agentNumber, agentId: `a${agentNumber}`, pauseState: agentNumber > 1, disabledState: agentNumber === 3 }));
  const durableSource = campaignSource.slice(campaignSource.indexOf('export async function loadControlState('), campaignSource.indexOf('/**', campaignSource.indexOf('export async function updateControlState(')))
    .replaceAll('export async function', 'async function');
  const durable = vm.createContext({
    cachedControl: null, DEFAULT_CONTROL: {}, STATE_KEY: 'isolated-control', EVENTS_KEY: 'isolated-events', IVX_APP_COMPLETION_MARKER: 'test',
    nowIso: () => new Date().toISOString(), isDurableStoreConfigured: () => true,
    readDurableJson: async () => structuredClone(stored),
    writeDurableJson: async (_key: string, value: typeof stored) => {
      if (failWrite) throw new Error('DATABASE_PRESSURE');
      stored = structuredClone(value); mutations.push('persist');
    },
    appendDurableEvent: async () => {},
  });
  vm.runInContext(transpiler.transformSync(durableSource) + '\nthis.load = loadControlState; this.update = updateControlState;', durable);
  const local = (action: string, id: string) => { mutations.push(`${action}:${id}`); return { ok: true }; };
  const control = vm.createContext({
    getAllExecutionStates: () => states,
    updateControlState: durable.update,
    pauseAgent: (id: string) => local('pause', id), resumeAgent: (id: string) => local('resume', id),
    disableAgent: (id: string) => local('disable', id), enableAgent: (id: string) => local('enable', id),
    campaignDispatcherControl: async () => { mutations.push('dispatch'); },
    getAutonomousTruthSnapshot: async () => ({ control: await durable.load({ required: true }) }),
  });
  const source = truthSource.slice(truthSource.indexOf('export async function applyTruthControl(')).replace('export async function', 'async function');
  vm.runInContext(transpiler.transformSync(source) + '\nthis.apply = applyTruthControl;', control);
  return { apply: control.apply, mutations, read: () => durable.load({ required: true }), failWrites: () => { failWrite = true; } };
}

test('individual pause and resume persist the target and preserve other owner restrictions', async () => {
  const controls = isolatedControls();
  await controls.apply('pause_agent', 'a1', 1);
  expect((await controls.read()).pausedAgents).toEqual([2, 1]);
  expect(controls.mutations).toEqual(['persist', 'pause:a1']);
  await controls.apply('resume_agent', 'a1', 1);
  expect((await controls.read()).pausedAgents).toEqual([2]);
  expect((await controls.read()).stoppedAgents).toEqual([3]);
  await expect(controls.apply('resume_agent', 'a3', 3)).rejects.toThrow();
  expect(controls.mutations).toEqual(['persist', 'pause:a1', 'persist', 'resume:a1']);
});

test('failed persistence cannot publish a successful local resume', async () => {
  const controls = isolatedControls();
  controls.failWrites();
  await expect(controls.apply('resume_agent', 'a2', 2)).rejects.toThrow('DATABASE_PRESSURE');
  expect(controls.mutations).toEqual([]);
  expect((await controls.read()).pausedAgents).toEqual([2]);
});

test('a durable disable requires explicit enable even when the local process has not seen it', async () => {
  const controls = isolatedControls();
  await controls.apply('disable_agent', 'a1', 1);
  expect((await controls.read()).stoppedAgents).toEqual([3, 1]);
  await expect(controls.apply('resume_agent', 'a1', 1)).rejects.toThrow('enable it explicitly first');
  expect(controls.mutations).toEqual(['persist', 'disable:a1']);
  await controls.apply('enable_agent', 'a1', 1);
  expect((await controls.read()).stoppedAgents).toEqual([3]);
  expect((await controls.read()).pausedAgents).toEqual([2]);
  expect(controls.mutations).toEqual(['persist', 'disable:a1', 'persist', 'enable:a1']);
});

test('conflicting agent identities are rejected before changing either agent', async () => {
  const controls = isolatedControls();
  await expect(controls.apply('pause_agent', 'a1', 2)).rejects.toThrow();
  expect(controls.mutations).toEqual([]);
});
