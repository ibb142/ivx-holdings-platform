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

export const IVX_AGENT_API_MARKER = 'ivx-agent-api-2026-08-27-oidc-machine-auth';

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
import { verifyIVXGitHubActionsOIDCRequest } from '../services/ivx-github-actions-oidc';

async function ownerAuthorized(c: any, body: Record<string, unknown> = {}): Promise<boolean> {
  const provided = (typeof body.ownerApprovalToken === 'string' ? body.ownerApprovalToken : '') || c.req.header('x-ivx-owner-key') || '';
  const envSecret = await resolveActiveIVXSystemSecret();
  return Boolean(envSecret) && provided === envSecret;
}

async function requireOwner(c: any, body: Record<string, unknown> = {}) {
  return (await ownerAuthorized(c, body)) ? null : c.json({ ok: false, error: 'Owner authorization required.' }, 401);
}

export function registerAgentRoutes(app: Hono): void {
  app.get('/api/ivx/agents', (c) => {
    const states = getAllExecutionStates();
    const agents = states.map((state) => {
      const contract = AGENT_CONTRACT_REGISTRY[state.agentId];
      return {
        agentId: state.agentId,
        agentNumber: state.agentNumber,
        name: contract?.agentName ?? 'Unknown',
        role: contract?.roleName ?? '',
        company: contract?.companyId ?? '',
        division: contract?.divisionId ?? '',
        health: state.health,
        availability: state.availability,
        queueDepth: state.queueDepth,
        totalRuns: state.totalRuns,
        successfulRuns: state.successfulRuns,
        failedRuns: state.failedRuns,
        evidenceCount: state.evidenceCount,
        paused: state.pauseState,
        disabled: state.disabledState,
        lastHeartbeat: state.lastHeartbeat,
      };
    });
    c.header('Content-Type', 'application/json'); return c.json({ ok: true, totalAgents: agents.length, marker: IVX_AGENT_API_MARKER, agents });
  });

  app.get('/api/ivx/agents/app-completion/dashboard', async (c) => {
    await loadControlState();
    await runCampaignBootRecovery().catch(() => 0);
    startCampaignDispatcher();
    await syncCampaignAssignmentsToDispatcher().catch(() => 0);
    const records = await listCampaignDispatcherRecords();
    const campaign = buildAppCompletionCampaign(undefined, records);
    const dispatcher = await getCampaignDispatcherSnapshot();
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, campaign, dispatcher });
  });

  app.post('/api/ivx/agents/app-completion/control', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const denied = await requireOwner(c, body as Record<string, unknown>);
    if (denied) return denied;
    const action = String((body as Record<string, unknown>).action ?? '');
    const allowed = ['pause_all', 'resume_all', 'stop_all', 'stop_agent', 'retry_agent', 'reassign'];
    if (!allowed.includes(action)) return c.json({ ok: false, error: `action must be one of: ${allowed.join(', ')}` }, 400);
    const rawAgent = (body as Record<string, unknown>).agentNumber;
    const agentNumber = typeof rawAgent === 'number' ? rawAgent : undefined;
    const control = await updateControlState(action as Parameters<typeof updateControlState>[0], agentNumber);
    if (action !== 'reassign') {
      await campaignDispatcherControl(action as 'pause_all' | 'resume_all' | 'stop_all' | 'stop_agent' | 'retry_agent', agentNumber);
    }
    const records = await listCampaignDispatcherRecords();
    const campaign = buildAppCompletionCampaign(control, records);
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, control, counts: campaign.counts });
  });

  app.get('/api/ivx/agents/dashboard', (c) => {
    const dashboard: EnterpriseAgentDashboard = generateDashboard();
    c.header('Content-Type', 'application/json'); return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...dashboard });
  });

  app.get('/api/ivx/agents/certificate', async (c) => c.json(await getCertificateForApi()));
  app.get('/api/ivx/agents/real-status', async (c) => c.json(await getRealStatusForApi()));
  app.get('/api/ivx/agents/certificate/progress', (c) => {
    const registry = enforceRegistryIntegrity();
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, workflow: REAL_EXECUTION_WORKFLOW_NAME, activeRun: getActiveRunProgress(), registry });
  });

  app.post('/api/ivx/agents/certificate/run', async (c) => {
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    c.header('Content-Type', 'application/json'); const oidcAuthorized = await verifyIVXGitHubActionsOIDCRequest(c.req.raw);
    const legacyAuthorized = await ownerAuthorized(c, body as Record<string, unknown>);
    if (!oidcAuthorized && !legacyAuthorized) return c.json({ ok: false, error: 'Owner approval required to start the IVX 112 Real Execution Certificate run.' }, 401);
    const result = await startRealExecutionCertificateRun();
    return c.json({ ok: result.ok, marker: IVX_AGENT_API_MARKER, workflow: REAL_EXECUTION_WORKFLOW_NAME, runId: result.runId, error: result.error }, result.ok ? 200 : 500);
  });

  app.get('/api/ivx/agents/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    const state = getExecutionState(agentId);
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      contract: {
        agentId: contract.agentId, agentName: contract.agentName, agentNumber: contract.agentNumber,
        divisionId: contract.divisionId, companyId: contract.companyId, roleName: contract.roleName,
        mission: contract.mission, memoryNamespace: contract.memoryNamespace, queueNamespace: contract.queueNamespace,
        allowedTools: contract.allowedTools, prohibitedTools: contract.prohibitedTools,
        readPermissions: contract.readPermissions, writePermissions: contract.writePermissions,
        externalServicePermissions: contract.externalServicePermissions, ownerApprovalRules: contract.ownerApprovalRules,
        schedulerConfig: contract.schedulerConfig, concurrencyLimit: contract.concurrencyLimit, costLimit: contract.costLimit,
        retryPolicy: contract.retryPolicy, timeoutPolicy: contract.timeoutPolicy, status: contract.status,
        version: contract.version, instructionHash: contract.instructionHash, systemInstructionsLength: contract.systemInstructions.length,
      },
      executionState: state,
    });
  });

  app.get('/api/ivx/agents/:agentId/contract', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, contract });
  });

  app.get('/api/ivx/agents/:agentId/system-instructions', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    return c.json({ ok: true, agentId, agentNumber: contract.agentNumber, agentName: contract.agentName, instructionHash: contract.instructionHash, instructionLength: contract.systemInstructions.length, systemInstructions: contract.systemInstructions });
  });

  app.get('/api/ivx/agents/:agentId/memory', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) return c.json({ ok: false, error: `Agent ${agentId} not found` }, 404);
    const result = listMemory(`${agentId}_memory`, agentId);
    return c.json({ ok: result.ok, agentId, memoryNamespace: `${agentId}_memory`, keys: result.keys, error: result.error });
  });

  app.get('/api/ivx/agents/:agentId/memory/:key', (c) => {
    const agentId = c.req.param('agentId');
    const key = c.req.param('key');
    const result = readMemory(`${agentId}_memory`, key, agentId);
    return c.json({ ok: result.ok, agentId, key, record: result.record, error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/pause', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const agentId = c.req.param('agentId'); const result = pauseAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'pause', error: result.error });
  });
  app.post('/api/ivx/agents/:agentId/resume', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const agentId = c.req.param('agentId'); const result = resumeAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'resume', error: result.error });
  });
  app.post('/api/ivx/agents/:agentId/disable', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const agentId = c.req.param('agentId'); const result = disableAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'disable', error: result.error });
  });
  app.post('/api/ivx/agents/:agentId/enable', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const agentId = c.req.param('agentId'); const result = enableAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'enable', error: result.error });
  });
  app.post('/api/ivx/agents/:agentId/clear-memory', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const agentId = c.req.param('agentId'); const result = clearTaskMemory(agentId);
    return c.json({ ok: result.ok, agentId, action: 'clear_task_memory', cleared: result.cleared });
  });

  app.post('/api/ivx/agents/:agentId/run', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const oidcAuthorized = await verifyIVXGitHubActionsOIDCRequest(c.req.raw);
    const legacyAuthorized = await ownerAuthorized(c, body as Record<string, unknown>);
    if (!oidcAuthorized && !legacyAuthorized) return c.json({ ok: false, error: 'Owner or approved IVX GitHub machine authorization required.' }, 401);
    const taskType = (body as any).taskType || 'audit';
    const payload = (body as any).payload || {};
    const ownerApprovalToken = oidcAuthorized ? 'github-oidc-machine-approved' : ((body as any).ownerApprovalToken || null);
    const result = await executeAgentRun(agentId, taskType, payload, ownerApprovalToken);
    return c.json({ ok: result.ok, marker: IVX_AGENT_API_MARKER, runRecord: result.runRecord, error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/version', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const denied = await requireOwner(c, body as Record<string, unknown>); if (denied) return denied;
    const result = updateAgentContract(agentId, (body as any).updates || {}, (body as any).ownerApproval === true);
    return c.json({ ok: result.ok, agentId, newVersion: result.newVersion, error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/rollback', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
    const denied = await requireOwner(c, body as Record<string, unknown>); if (denied) return denied;
    const targetVersion = (body as any).targetVersion;
    if (typeof targetVersion !== 'number') return c.json({ ok: false, error: 'targetVersion (number) required' }, 400);
    const result = rollbackAgentContract(agentId, targetVersion);
    return c.json({ ok: result.ok, agentId, rolledBackTo: targetVersion, error: result.error });
  });

  app.get('/api/ivx/agents/:agentId/history', (c) => {
    const agentId = c.req.param('agentId');
    const history = getContractVersionHistory(agentId);
    return c.json({ ok: true, agentId, versions: history.map((h) => ({ version: h.version, updatedAt: h.updatedAt, instructionHash: h.instructionHash })) });
  });

  app.get('/api/ivx/agents/contracts/audit', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...auditInstructionUniqueness() }));
  app.get('/api/ivx/agents/contracts/validate', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...validateAllContracts() }));
  app.get('/api/ivx/agents/permissions/verify', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...verifyPermissionMatrix() }));
  app.get('/api/ivx/agents/differentiation/test', (c) => {
    const taskType = c.req.query('taskType') || 'deploy';
    const results = testAgentDifferentiation(taskType);
    const accepted = results.filter((r) => r.accepted);
    const rejected = results.filter((r) => !r.accepted);
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, taskType, totalAgents: results.length, acceptedCount: accepted.length, rejectedCount: rejected.length, acceptedAgents: accepted.map((r) => ({ agentNumber: r.agentNumber, agentName: r.agentName, reason: r.reason })), rejectedSample: rejected.slice(0, 10).map((r) => ({ agentNumber: r.agentNumber, agentName: r.agentName, reason: r.reason })) });
  });
  app.get('/api/ivx/agents/failure/isolation', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...testFailureIsolation() }));
  app.get('/api/ivx/agents/pause/isolation', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...testPauseIsolation() }));
  app.get('/api/ivx/agents/independence-check', (c) => c.json({ ok: true, marker: IVX_AGENT_API_MARKER, ...verifyIndependence() }));

  app.get('/api/ivx/agents/runs', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const records = getRunRecords(undefined, limit);
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, totalRecords: getRunRecordCount(), recordsWithEvidence: getRunRecordsWithEvidence(), records });
  });
  app.get('/api/ivx/agents/runs/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const records = getRunRecords(agentId, limit);
    return c.json({ ok: true, agentId, count: records.length, records });
  });

  app.post('/api/ivx/agents/execute-all', async (c) => {
    const denied = await requireOwner(c); if (denied) return denied;
    const maxParallel = Math.max(1, Math.min(112, Number.parseInt(process.env.IVX_AGENT_EXECUTE_ALL_CONCURRENCY ?? '', 10) || 112));
    const results: Array<{ agentId: string; agentNumber: number; agentName: string; ok: boolean; runId: string | null; durationMs: number; error: string | null; evidenceCount: number }> = [];
    for (let offset = 0; offset < ALL_AGENT_CONTRACTS.length; offset += maxParallel) {
      const batch = ALL_AGENT_CONTRACTS.slice(offset, offset + maxParallel);
      const batchResults = await Promise.all(batch.map(async (contract) => {
        const taskType = 'audit';
        const needsApproval = contract.ownerApprovalRules.some((r) => r.required && r.action === 'any_execution');
        const approvalToken = needsApproval ? `owner-controlled-${Date.now()}-${contract.agentNumber}` : null;
        const result = await executeAgentRun(contract.agentId, taskType, { controlled: true }, approvalToken);
        return { agentId: contract.agentId, agentNumber: contract.agentNumber, agentName: contract.agentName, ok: result.ok, runId: result.runRecord?.runId ?? null, durationMs: result.runRecord?.durationMs ?? 0, error: result.error, evidenceCount: result.runRecord?.evidence.length ?? 0 };
      }));
      results.push(...batchResults);
    }
    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const withEvidence = results.filter((r) => r.evidenceCount > 0).length;
    return c.json({ ok: true, marker: IVX_AGENT_API_MARKER, advisoryOnly: true, notProofOfRealWork: true, warRoom: WAR_ROOM_POLICY, certificationEndpoint: '/api/ivx/agents/certificate', totalAgents: results.length, succeeded, failed, withEvidence, results });
  });
}
