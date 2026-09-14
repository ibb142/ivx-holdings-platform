import { afterEach, expect, spyOn, test } from 'bun:test';
import * as oidc from '../services/ivx-github-actions-oidc';
import * as owner from './owner-only';
import * as tasks from '../services/ivx-postgres-autonomous-task-store';
import * as ledger from '../services/ivx-agent-work-ledger';
import * as live from '../services/ivx-agent-ledger-live';
import * as campaigns from '../services/ivx-campaign-dispatcher';
import * as verifier from '../services/ivx-agent-productivity-verifier';
import { handleAgentLedgerGet, handleAgentLedgerIngest } from './ivx-agent-work-ledger-api';

const cleanups: Array<() => void> = [];
function restoreLater<T extends { mockRestore(): void }>(mock: T): T {
  cleanups.push(() => mock.mockRestore()); return mock;
}
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const request = () => new Request('https://ivx.test/api/ivx/autonomous/agent-ledger?from=2026-09-12T00:00:00Z&to=2026-09-13T00:00:00Z');
const liveRequest = () => new Request('https://ivx.test/api/ivx/autonomous/agent-ledger?view=live');

test('live requests authorize before any telemetry read and retain all trusted auth methods', async () => {
  const oidcAuth = restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockResolvedValue(false));
  const systemAuth = restoreLater(spyOn(owner, 'checkIVXAISystemKey').mockResolvedValue(false));
  const ownerAuth = restoreLater(spyOn(owner, 'assertIVXOwnerOnly').mockRejectedValue(new Error('denied')));
  const snapshot = { marker: 'live', matrix112: [], summary: { active_concurrent_count: 0 } };
  const read = restoreLater(spyOn(live, 'readAgentLedgerLive').mockResolvedValue(snapshot as never));
  const dashboard = restoreLater(spyOn(ledger, 'getAgentLedgerDashboard').mockRejectedValue(new Error('historical path must not run')));
  expect((await handleAgentLedgerGet(liveRequest())).status).toBe(401);
  expect(read).not.toHaveBeenCalled();
  for (const auth of ['oidc', 'system_key', 'owner']) {
    oidcAuth.mockResolvedValue(auth === 'oidc');
    systemAuth.mockResolvedValue(auth === 'system_key');
    if (auth === 'owner') ownerAuth.mockResolvedValue({} as never);
    const response = await handleAgentLedgerGet(liveRequest());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, auth, ...snapshot });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(read).toHaveBeenCalledTimes(3); expect(dashboard).not.toHaveBeenCalled();
});

test('live mode rejects historical windows and hides pool failures behind the existing 503 contract', async () => {
  restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockResolvedValue(true));
  const read = restoreLater(spyOn(live, 'readAgentLedgerLive').mockRejectedValue(new Error('private pool details')));
  for (const param of ['from', 'to']) {
    expect((await handleAgentLedgerGet(new Request(`${liveRequest().url}&${param}=2026-09-12T00:00:00Z`))).status).toBe(400);
  }
  expect(read).not.toHaveBeenCalled();
  const response = await handleAgentLedgerGet(liveRequest());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.error).toBe('AGENT_LEDGER_UNAVAILABLE');
  expect(body).not.toHaveProperty('summary');
  expect(JSON.stringify(body)).not.toContain('private pool details');
});

test('historical and default ledger contracts remain separate from the opt-in live matrix', async () => {
  restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockResolvedValue(true));
  const read = restoreLater(spyOn(live, 'readAgentLedgerLive').mockRejectedValue(new Error('live path must not run')));
  const hours = { evidence: 'durable-test-evidence' };
  restoreLater(spyOn(tasks, 'readPostgresWorkEvidenceHours').mockResolvedValue(hours as never));
  const history = await handleAgentLedgerGet(request());
  expect((await history.json()).hours).toEqual(hours);
  restoreLater(spyOn(tasks, 'postgresAtomicQueueSelected').mockReturnValue(false));
  restoreLater(spyOn(campaigns, 'listCampaignDispatcherRecords').mockResolvedValue([]));
  const dashboard = { generatedAt: '2026-09-13T20:00:00Z', totals: { realHours: 2 }, rows: [] };
  restoreLater(spyOn(ledger, 'getAgentLedgerDashboard').mockResolvedValue(dashboard as never));
  restoreLater(spyOn(verifier, 'buildThreeLayerVerifiedLedger').mockResolvedValue({ dashboard, verificationLayers: ['verified'] } as never));
  const response = await handleAgentLedgerGet(new Request('https://ivx.test/api/ivx/autonomous/agent-ledger'));
  const body = await response.json();
  expect(response.status).toBe(200); expect(body.totals).toEqual(dashboard.totals);
  expect(body.agents).toEqual([]); expect(body).toHaveProperty('autonomous');
  expect(body.verificationLayers).toEqual(['verified']); expect(body).not.toHaveProperty('matrix112');
  expect(read).not.toHaveBeenCalled();
});

test('an unavailable database returns 503 without internal error text or synthetic counts', async () => {
  restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockResolvedValue(true));
  restoreLater(spyOn(tasks, 'readPostgresWorkEvidenceHours').mockRejectedValue(new Error('private connection details')));
  const response = await handleAgentLedgerGet(request());
  expect(response.status).toBe(503);
  const body = await response.json();
  expect(body.ok).toBe(false); expect(body.error).toBe('AGENT_LEDGER_UNAVAILABLE');
  expect(body).not.toHaveProperty('agents'); expect(body).not.toHaveProperty('totals');
  expect(JSON.stringify(body)).not.toContain('private connection details');
  expect(response.headers.get('Cache-Control')).toBe('no-store');
});

test('authentication outages are contained and unauthenticated requests still receive 401', async () => {
  const auth = restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockRejectedValue(new Error('private auth details')));
  expect((await handleAgentLedgerGet(request())).status).toBe(503);
  auth.mockResolvedValue(false);
  restoreLater(spyOn(owner, 'checkIVXAISystemKey').mockResolvedValue(false));
  restoreLater(spyOn(owner, 'assertIVXOwnerOnly').mockRejectedValue(new Error('denied')));
  expect((await handleAgentLedgerGet(request())).status).toBe(401);
});

test('failed ingest reports an unconfirmed write and never exposes upstream errors', async () => {
  restoreLater(spyOn(oidc, 'verifyIVXGitHubActionsOIDCRequest').mockResolvedValue(true));
  let calls = 0;
  restoreLater(spyOn(ledger, 'recordWorkflowAttribution').mockImplementation(async () => {
    calls++; throw new Error('private write details');
  }));
  const response = await handleAgentLedgerIngest(new Request('https://ivx.test/api/ivx/autonomous/agent-ledger/ingest', {
    method: 'POST', body: JSON.stringify({ records: [{ agentNumber: 1, taskId: 't' }] }),
    headers: { 'Content-Type': 'application/json' },
  }));
  expect(response.status).toBe(500);
  const body = await response.json();
  expect(body.error).toBe('AGENT_LEDGER_INGEST_UNCONFIRMED'); expect(body.ok).toBe(false);
  expect(calls).toBe(1); expect(JSON.stringify(body)).not.toContain('private write details');
});
