import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';

const apiSource = readFileSync(process.env.IVX_OWNER_COMMAND_SOURCE || new URL('../api/ivx-agent-api.ts', import.meta.url), 'utf8');
const campaignSource = readFileSync(process.env.IVX_OWNER_CAMPAIGN_SOURCE || new URL('./ivx-app-completion-campaign.ts', import.meta.url), 'utf8');
const transpiler = new Bun.Transpiler({ loader: 'ts' });

function routes() {
  const changes: unknown[] = [], dispatches: unknown[] = [];
  const app = new Hono();
  const source = apiSource.slice(apiSource.indexOf('async function ownerAuthorized('))
    .replace('export function registerAgentRoutes', 'function registerAgentRoutes');
  const context = {
    app, Response, setTimeout, clearTimeout, IVX_AGENT_API_MARKER: 'isolated-test',
    resolveActiveIVXSystemSecret: async () => 'synthetic-owner-secret',
    verifyIVXGitHubActionsOIDCRequest: async () => true,
    updateControlState: async (...args: unknown[]) => { changes.push(args); return { paused: false }; },
    campaignDispatcherControl: async (...args: unknown[]) => { dispatches.push(args); },
    listCampaignDispatcherRecords: async () => [],
    buildAppCompletionCampaign: () => ({ counts: {} }),
  };
  vm.runInNewContext(transpiler.transformSync(source) + '\nregisterAgentRoutes(app);', context);
  const request = (body: unknown, owner = false) => app.request('/api/ivx/agents/app-completion/control', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-IVX-GitHub-OIDC': 'synthetic-valid-machine-token',
      ...(owner ? { 'x-ivx-owner-key': 'synthetic-owner-secret' } : {}) }, body: JSON.stringify(body),
  });
  return { request, changes, dispatches };
}

test('verified machine identity cannot resume or change owner control', async () => {
  const f = routes();
  for (const action of ['resume_all', 'pause_all', 'stop_all', 'stop_agent', 'retry_agent', 'reassign']) {
    const response = await f.request({ action, agentNumber: 1 });
    expect(response.status).toBe(401);
  }
  expect(f.changes).toEqual([]);
  expect(f.dispatches).toEqual([]);
});

test('owner commands reject missing or invalid agent identities before any mutation', async () => {
  const f = routes();
  for (const agentNumber of [undefined, 0, -1, 113, 1.5, '2', null]) {
    const response = await f.request({ action: 'retry_agent', agentNumber }, true);
    expect(response.status).toBe(400);
  }
  expect(f.changes).toEqual([]);
  expect(f.dispatches).toEqual([]);
});

test('the authorized owner can target one valid agent or explicitly resume the fleet', async () => {
  const f = routes();
  for (const body of [{ action: 'retry_agent', agentNumber: 112 }, { action: 'resume_all' }]) {
    const response = await f.request(body, true);
    expect(response.status).toBe(200);
    expect((await response.json()).authorization).toBe('owner');
  }
  expect(f.changes).toEqual([['retry_agent', 112], ['resume_all', undefined]]);
  expect(f.dispatches).toEqual(f.changes);
});

function durableControl(mode: 'unavailable' | 'missing' | 'malformed' | 'write-failed' | 'ready') {
  const state = { paused: true, stopped: false, pausedAgents: [1], stoppedAgents: [2] };
  const writes: unknown[] = [];
  const context: Record<string, any> = {
    cachedControl: null, DEFAULT_CONTROL: { paused: false, stopped: false, pausedAgents: [], stoppedAgents: [] },
    STATE_KEY: 'isolated-control', EVENTS_KEY: 'isolated-events', IVX_APP_COMPLETION_MARKER: 'isolated-test',
    nowIso: () => '2026-09-11T00:00:00Z', isDurableStoreConfigured: () => true,
    readDurableJson: async () => {
      if (mode === 'unavailable') throw Error('DATABASE_PRESSURE');
      return mode === 'missing' ? null : { control: mode === 'malformed' ? { ...state, pausedAgents: 'invalid' } : state };
    },
    writeDurableJson: async (_key: string, value: unknown) => {
      if (mode === 'write-failed') throw Error('DATABASE_PRESSURE');
      writes.push(value);
    },
    appendDurableEvent: async () => {},
  };
  const begin = campaignSource.indexOf('export async function loadControlState(');
  const end = campaignSource.indexOf('/**', campaignSource.indexOf('export async function updateControlState(', begin));
  const source = campaignSource.slice(begin, end).replaceAll('export async function', 'async function');
  vm.runInNewContext(transpiler.transformSync(source) + '\nglobalThis.update = updateControlState;', context);
  return { context, writes };
}

test('missing, malformed or unavailable durable controls cannot become a default resume', async () => {
  for (const mode of ['unavailable', 'missing', 'malformed'] as const) {
    const f = durableControl(mode);
    await expect(f.context.update('resume_all')).rejects.toThrow();
    expect(f.writes).toEqual([]);
  }
});

test('a failed durable write does not publish a resumed in-process control state', async () => {
  const f = durableControl('write-failed');
  await expect(f.context.update('resume_all')).rejects.toThrow('DATABASE_PRESSURE');
  expect(f.context.cachedControl.paused).toBe(true);
  expect(f.context.cachedControl.pausedAgents).toEqual([1]);
  expect(f.writes).toEqual([]);
});
