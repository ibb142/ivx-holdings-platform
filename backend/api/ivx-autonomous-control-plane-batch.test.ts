import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

// Run through the actual GET handler. Only external dependencies are controlled;
// this test must not dispatch repairs or use real owner credentials.
let now = Date.now();
const clock = spyOn(Date, 'now').mockImplementation(() => now);
afterAll(() => clock.mockRestore());
const owner = mock(async (_request: Request): Promise<void> => {});
const jobs = mock(async (_ids: readonly string[]): Promise<any[]> => []);
const singleJob = mock(async () => { throw new Error('per-agent checkout forbidden'); });
let assignments: any[] = [];
let records: any[] = [];

mock.module('./owner-only', () => ({
  assertIVXOwnerOnly: owner,
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
}));
mock.module('../services/ivx-github-actions-oidc', () => ({ verifyIVXGitHubActionsOIDCRequest: async () => false }));
mock.module('../services/ivx-autonomous-completion-campaign', () => ({ verifyAllEnterpriseAgents: async () => { throw new Error('mutation forbidden'); } }));
mock.module('../services/ivx-app-completion-campaign', () => ({
  loadControlState: async () => ({ paused: false, stopped: false }),
  buildAppCompletionCampaign: (control: unknown) => ({ control, assignments }),
}));
mock.module('../services/ivx-campaign-dispatcher', () => ({ listCampaignDispatcherRecords: async () => records }));
mock.module('../services/ivx-autonomous-sms-notifier', () => ({ getSmsNotifierStatus: () => ({}) }));
mock.module('../services/ivx-durable-store', () => ({ isDurableStoreConfigured: () => true }));
mock.module('../services/ivx-senior-developer-worker', () => ({ getSeniorDeveloperJobs: jobs, getSeniorDeveloperJob: singleJob }));
mock.module('../services/ivx-global-certification-supervisor', () => ({
  resolveMainSha: async () => null,
  runGlobalCertificationSupervision: async () => { throw new Error('mutation forbidden'); },
}));
mock.module('../services/ivx-agent-work-ledger', () => ({ readAllWorkflowAttributions: async () => [] }));

const { handleAutonomousControlPlaneGet } = await import('./ivx-autonomous-control-plane');
const request = () => new Request('https://api.example.test/api/ivx/autonomous/control-plane');

beforeEach(() => {
  now += 180_001; // Expire the existing telemetry cache between observations.
  owner.mockReset();
  owner.mockResolvedValue(undefined);
  jobs.mockReset();
  singleJob.mockClear();
  assignments = Array.from({ length: 112 }, (_, i) => ({
    agentNumber: i + 1, workerJobId: `job-${i + 1}`, status: 'RUNNING',
    assignedTask: `task-${i + 1}`, lastHeartbeatAt: new Date(now).toISOString(),
  }));
  records = assignments.map(({ agentNumber, workerJobId }) => ({ agentNumber, workerJobId }));
});

test('112 dashboard rows use one selected batch and missing, stale or unmapped evidence never counts as live work', async () => {
  // Missing job 112; stale heartbeat 111; missing dispatcher evidence 110.
  records = records.filter(record => record.agentNumber !== 110);
  jobs.mockResolvedValue(assignments.slice(0, 111).map(item => ({
    jobId: item.workerJobId, status: 'running', input: { goal: item.assignedTask },
    startedAt: new Date(now - 1_000).toISOString(),
    lastHeartbeatAt: new Date(now - (item.agentNumber === 111 ? 120_001 : 0)).toISOString(),
  })));
  const response = await handleAutonomousControlPlaneGet(request());
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(jobs).toHaveBeenCalledTimes(1);
  expect(jobs.mock.calls[0][0]).toEqual(assignments.map(item => item.workerJobId));
  expect(singleJob).not.toHaveBeenCalled();
  expect(body.agents.items).toHaveLength(112);
  expect(body.enterprise.realWorkingAgents).toBe(109);
  expect(body.agents.items[111].worker.hasRealJob).toBe(false);
  expect(body.agents.items[110].presence).toBe('STALE');
  expect(body.agents.items[109].worker.hasLiveWorkEvidence).toBe(false);
  expect(body.certification.full112RealWorkObserved).toBe(false);
  expect(body.certification.certified).toBe(false);

  // A previously cached payload must never bypass a new failed authentication.
  const unavailable = new Error('Identity service unavailable');
  unavailable.name = 'IVXAuthServiceUnavailableError';
  owner.mockRejectedValue(unavailable);
  const outage = await handleAutonomousControlPlaneGet(request());
  expect(outage.status).toBe(503);
  expect(outage.headers.get('Retry-After')).toBe('5');
  expect(outage.headers.get('Cache-Control')).toBe('no-store');
  expect((await outage.json()).code).toBe('AUTH_SERVICE_UNAVAILABLE');
  expect(jobs).toHaveBeenCalledTimes(1);
});

test('denied identity never reads jobs or converts a denial into operational telemetry', async () => {
  owner.mockRejectedValue(new Error('Not the registered owner'));
  const denied = await handleAutonomousControlPlaneGet(request());
  expect(denied.status).toBe(403);
  expect((await denied.json()).ok).toBe(false);
  expect(jobs).not.toHaveBeenCalled();
});

test('a batch infrastructure failure is an error rather than a fabricated empty fleet', async () => {
  jobs.mockRejectedValue(new Error('Repair database unavailable'));
  const failed = await handleAutonomousControlPlaneGet(request());
  expect(failed.status).toBe(500);
  expect(await failed.json()).toMatchObject({ ok: false, error: 'Repair database unavailable' });
  expect(singleJob).not.toHaveBeenCalled();
});
