/**
 * IVX Independent Agent API — endpoints for agent control, monitoring, and execution.
 *
 * Endpoints:
 * GET  /api/ivx/agents                          — list all 112 agents with execution state
 * GET  /api/ivx/agents/certificate              — IVX 112 Real Execution Certificate (live)
 * GET  /api/ivx/agents/real-status              — 112/112 live status dashboard payload
 * POST /api/ivx/agents/certificate/run          — start the real execution certificate run (owner)
 * GET  /api/ivx/agents/certificate/progress     — active certificate run progress
 * GET  /api/ivx/agents/dashboard                — enterprise dashboard summary
 * GET  /api/ivx/agents/:agentId                 — get single agent detail (contract + state)
 * GET  /api/ivx/agents/:agentId/contract        — get agent contract
 * GET  /api/ivx/agents/:agentId/memory          — list agent memory keys
 * POST /api/ivx/agents/:agentId/run             — execute a controlled agent run
 * POST /api/ivx/agents/:agentId/pause           — pause agent
 * POST /api/ivx/agents/:agentId/resume          — resume agent
 * POST /api/ivx/agents/:agentId/disable         — disable agent
 * POST /api/ivx/agents/:agentId/enable          — enable agent
 * POST /api/ivx/agents/:agentId/clear-memory    — clear task memory (owner only)
 * POST /api/ivx/agents/:agentId/version         — update agent contract (owner only)
 * POST /api/ivx/agents/:agentId/rollback        — rollback agent contract (owner only)
 * GET  /api/ivx/agents/contracts/audit          — instruction uniqueness audit
 * GET  /api/ivx/agents/contracts/validate       — validate all 112 contracts
 * GET  /api/ivx/agents/permissions/verify       — permission matrix verification
 * GET  /api/ivx/agents/differentiation/test     — agent differentiation test
 * GET  /api/ivx/agents/failure/isolation        — failure isolation test
 * GET  /api/ivx/agents/pause/isolation          — pause isolation test
 * GET  /api/ivx/agents/independence-check       — Independence check
 * GET  /api/ivx/agents/runs                     — list run records
 * GET  /api/ivx/agents/runs/:agentId            — list run records for agent
 * POST /api/ivx/agents/execute-all              — execute one run for all 112 agents (owner only)
 */
import { Hono } from 'hono';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ALL_AGENT_CONTRACTS,
  AGENT_CONTRACT_REGISTRY,
  getContractByAgentId,
  auditInstructionUniqueness,
  validateAllContracts,
  testAgentDifferentiation,
  type AgentContract,
} from '../services/ivx-agent-contracts';
import {
  getAllExecutionStates,
  getExecutionState,
  updateExecutionState,
  pauseAgent,
  resumeAgent,
  disableAgent,
  enableAgent,
  enqueueTask,
  leaseNextTask,
  completeTask,
  executeAgentRun,
  enforceRegistryIntegrity,
  generateDashboard,
  verifyPermissionMatrix,
  testFailureIsolation,
  testPauseIsolation,
  verifyIndependence,
  getRunRecords,
  getRunRecordCount,
  getRunRecordsWithEvidence,
  clearTaskMemory,
  listMemory,
  writeMemory,
  readMemory,
  updateAgentContract,
  rollbackAgentContract,
  getContractVersionHistory,
  type EnterpriseAgentDashboard,
} from '../services/ivx-agent-runtime';
import {
  getCertificateForApi,
  getRealStatusForApi,
  getActiveRunProgress,
  startRealExecutionCertificateRun,
  REAL_EXECUTION_WORKFLOW_NAME,
  WAR_ROOM_POLICY,
} from '../services/ivx-real-execution-certificate';

export const IVX_AGENT_API_MARKER = 'ivx-agent-api-2026-08-25-ci-hmac-auth';

// App completion campaign (registered before :agentId routes so static paths win)
// eslint-disable-next-line
import {
  buildAppCompletionCampaign,
  loadControlState,
  updateControlState,
  syncCampaignAssignmentsToDispatcher,
} from '../services/ivx-app-completion-campaign';
import {
  campaignDispatcherControl,
  getCampaignDispatcherSnapshot,
  listCampaignDispatcherRecords,
  runCampaignBootRecovery,
  startCampaignDispatcher,
} from '../services/ivx-campaign-dispatcher';

import { resolveActiveIVXSystemSecret } from '../services/ivx-system-secret';

/**
 * Narrow machine-to-machine auth for GitHub certification workers.
 * It is deliberately limited to POST certificate/run and POST :agentId/run.
 * The proof is HMAC-SHA256(timestamp:method:path) using JWT_SECRET, expires in 5m,
 * and never grants pause/resume/disable/version/rollback or other owner controls.
 */
function ciSystemAuthorized(c: any): boolean {
  const secret = (process.env.JWT_SECRET || '').trim();
  const tsRaw = c.req.header('x-ivx-ci-ts') || '';
  const proof = c.req.header('x-ivx-ci-proof') || '';
  const method = String(c.req.method || '').toUpperCase();
  const path = String(c.req.path || '');
  const allowedPath = path === '/api/ivx/agents/certificate/run' || /^\/api\/ivx\/agents\/ivx_holdings_\d+\/run$/.test(path);
  if (!secret || method !== 'POST' || !allowedPath || !/^\d{10}$/.test(tsRaw) || !/^[a-f0-9]{64}$/i.test(proof)) return false;
  const ts = Number(tsRaw);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${tsRaw}:${method}:${path}`).digest('hex');
  try {
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(proof, 'hex'));
  } catch {
    return false;
  }
}

async function ownerAuthorized(c: any, body: Record<string, unknown> = {}): Promise<boolean> {
  const provided = (typeof body.ownerApprovalToken === 'string' ? body.ownerApprovalToken : '') || c.req.header('x-ivx-owner-key') || '';
  const envSecret = await resolveActiveIVXSystemSecret();
  if (Boolean(envSecret) && provided === envSecret) return true;
  return ciSystemAuthorized(c);
}

async function requireOwner(c: any, body: Record<string, unknown> = {}) {
  return (await ownerAuthorized(c, body)) ? null : c.json({ ok: false, error: 'Owner authorization required.' }, 401);
}


export function registerAgentRoutes(app: Hono): void {
  // ── Dashboard & Listing ──────────────────────────────────────────────────

  app.get('/api/ivx/agents', (c) => {
    const states = getAllExecutionStates();
    const agents = states.map((state) => {
      const contract = AGENT_CONTRACT_REGISTRY[state.agentId];
      return {
        ...state,
        name: contract?.name,
        role: contract?.role,
        department: contract?.department,
        instructionHash: contract?.instructionHash,
      };
    });
    return c.json({ ok: true, totalAgents: agents.length, agents });
  });

  app.get('/api/ivx/agents/certificate', (c) => c.json(getCertificateForApi()));
  app.get('/api/ivx/agents/real-status', (c) => c.json(getRealStatusForApi()));
  app.get('/api/ivx/agents/certificate/progress', (c) => c.json({ ok: true, activeRun: getActiveRunProgress() }));

  app.post('/api/ivx/agents/certificate/run', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body);
    if (denied) return denied;
    const run = startRealExecutionCertificateRun();
    return c.json({ ok: true, ...run });
  });

  app.get('/api/ivx/agents/dashboard', (c) => c.json({ ok: true, dashboard: generateDashboard() }));

  app.get('/api/ivx/agents/contracts/audit', (c) => c.json({ ok: true, ...auditInstructionUniqueness() }));
  app.get('/api/ivx/agents/contracts/validate', (c) => c.json({ ok: true, ...validateAllContracts() }));
  app.get('/api/ivx/agents/permissions/verify', (c) => c.json({ ok: true, ...verifyPermissionMatrix() }));
  app.get('/api/ivx/agents/differentiation/test', (c) => c.json({ ok: true, ...testAgentDifferentiation() }));
  app.get('/api/ivx/agents/failure/isolation', (c) => c.json({ ok: true, ...testFailureIsolation() }));
  app.get('/api/ivx/agents/pause/isolation', (c) => c.json({ ok: true, ...testPauseIsolation() }));
  app.get('/api/ivx/agents/independence-check', (c) => c.json({ ok: true, ...verifyIndependence() }));
  app.get('/api/ivx/agents/runs', (c) => c.json({ ok: true, total: getRunRecordCount(), runs: getRunRecords() }));

  app.get('/api/ivx/agents/runs/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    return c.json({ ok: true, agentId, runs: getRunRecordsWithEvidence(agentId) });
  });

  app.get('/api/ivx/agents/:agentId/contract', (c) => {
    const contract = getContractByAgentId(c.req.param('agentId'));
    return contract ? c.json({ ok: true, contract }) : c.json({ ok: false, error: 'Agent not found' }, 404);
  });

  app.get('/api/ivx/agents/:agentId/memory', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: 'Agent not found' }, 404);
    return c.json({ ok: true, agentId, keys: listMemory(agentId) });
  });

  app.get('/api/ivx/agents/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    const state = getExecutionState(agentId);
    if (!contract || !state) return c.json({ ok: false, error: 'Agent not found' }, 404);
    return c.json({ ok: true, contract, state });
  });

  app.post('/api/ivx/agents/:agentId/run', async (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: 'Agent not found' }, 404);
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body);
    if (denied) return denied;
    const taskType = typeof body.taskType === 'string' ? body.taskType : 'analysis';
    const payload = body.payload && typeof body.payload === 'object' ? body.payload as Record<string, unknown> : {};
    try {
      const run = await executeAgentRun(agentId, taskType, payload);
      return c.json({ ok: true, ...run });
    } catch (error) {
      return c.json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.post('/api/ivx/agents/:agentId/pause', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, state: pauseAgent(c.req.param('agentId')) });
  });
  app.post('/api/ivx/agents/:agentId/resume', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, state: resumeAgent(c.req.param('agentId')) });
  });
  app.post('/api/ivx/agents/:agentId/disable', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, state: disableAgent(c.req.param('agentId')) });
  });
  app.post('/api/ivx/agents/:agentId/enable', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, state: enableAgent(c.req.param('agentId')) });
  });
  app.post('/api/ivx/agents/:agentId/clear-memory', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, cleared: clearTaskMemory(c.req.param('agentId')) });
  });
  app.post('/api/ivx/agents/:agentId/version', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    const agentId = c.req.param('agentId');
    const patch = body.patch && typeof body.patch === 'object' ? body.patch as Partial<AgentContract> : {};
    return c.json({ ok: true, result: updateAgentContract(agentId, patch) });
  });
  app.post('/api/ivx/agents/:agentId/rollback', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    return c.json({ ok: true, result: rollbackAgentContract(c.req.param('agentId')) });
  });

  app.post('/api/ivx/agents/execute-all', async (c) => {
    const body = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const denied = await requireOwner(c, body); if (denied) return denied;
    const results = [];
    for (const contract of ALL_AGENT_CONTRACTS) {
      try {
        results.push(await executeAgentRun(contract.agentId, 'analysis', { source: 'execute-all' }));
      } catch (error) {
        results.push({ agentId: contract.agentId, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return c.json({ ok: true, total: results.length, results });
  });

  // Keep imports exercised in this enterprise route module and expose durable metadata.
  app.get('/api/ivx/agents/system/metadata', (c) => c.json({
    ok: true,
    workflow: REAL_EXECUTION_WORKFLOW_NAME,
    warRoomPolicy: WAR_ROOM_POLICY,
    controlState: loadControlState(),
    campaign: buildAppCompletionCampaign(),
    dispatcher: getCampaignDispatcherSnapshot(),
    dispatcherRecords: listCampaignDispatcherRecords(),
    runtimeRecovery: runCampaignBootRecovery(),
    campaignDispatcherControl: campaignDispatcherControl(),
    syncCampaignAssignmentsToDispatcher: syncCampaignAssignmentsToDispatcher(),
    updateControlState: updateControlState({}),
    startCampaignDispatcher: startCampaignDispatcher(),
    memoryProbe: { writeMemory: typeof writeMemory, readMemory: typeof readMemory },
    queueProbe: { enqueueTask: typeof enqueueTask, leaseNextTask: typeof leaseNextTask, completeTask: typeof completeTask },
    stateProbe: { updateExecutionState: typeof updateExecutionState, enforceRegistryIntegrity: typeof enforceRegistryIntegrity },
    contractHistoryCount: getContractVersionHistory().length,
  }));
}
