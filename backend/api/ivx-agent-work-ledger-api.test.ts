import { afterEach, expect, spyOn, test } from 'bun:test';
import * as oidc from '../services/ivx-github-actions-oidc';
import * as owner from './owner-only';
import * as tasks from '../services/ivx-postgres-autonomous-task-store';
import * as ledger from '../services/ivx-agent-work-ledger';
import { handleAgentLedgerGet, handleAgentLedgerIngest } from './ivx-agent-work-ledger-api';

const cleanups: Array<() => void> = [];
function restoreLater<T extends { mockRestore(): void }>(mock: T): T {
  cleanups.push(() => mock.mockRestore()); return mock;
}
afterEach(() => { while (cleanups.length) cleanups.pop()!(); });
const request = () => new Request('https://ivx.test/api/ivx/autonomous/agent-ledger?from=2026-09-12T00:00:00Z&to=2026-09-13T00:00:00Z');

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
