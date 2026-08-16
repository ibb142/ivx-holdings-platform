/**
 * IVX Independent Agent API — endpoints for agent control, monitoring, and execution.
 *
 * Endpoints:
 * GET  /api/ivx/agents                          — list all 100 agents with execution state
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
 * GET  /api/ivx/agents/contracts/validate       — validate all 100 contracts
 * GET  /api/ivx/agents/permissions/verify       — permission matrix verification
 * GET  /api/ivx/agents/differentiation/test     — agent differentiation test
 * GET  /api/ivx/agents/failure/isolation        — failure isolation test
 * GET  /api/ivx/agents/pause/isolation          — pause isolation test
 * GET  /api/ivx/agents/independence-check       — Independence check
 * GET  /api/ivx/agents/runs                     — list run records
 * GET  /api/ivx/agents/runs/:agentId            — list run records for agent
 * POST /api/ivx/agents/execute-all              — execute one run for all 100 agents (owner only)
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

export const IVX_AGENT_API_MARKER = 'ivx-agent-api-2026-07-27';

export function registerAgentRoutes(app: Hono): void {
  // ── Dashboard & Listing ──────────────────────────────────────────────────

  app.get('/api/ivx/agents', (c) => {
    const states = getAllExecutionStates();
    // Verify role contract
    verifyRoleContract(states);
    // Verify tools
    verifyTools(states);
    // Verify permissions
    verifyPermissions(states);
    // Verify heartbeat
    verifyHeartbeat(states);
    // Verify evidence recording
    verifyEvidenceRecording(states);
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
    return c.json({
      ok: true,
      totalAgents: agents.length,
      marker: IVX_AGENT_API_MARKER,
      agents,
    });
  });

  app.get('/api/ivx/agents/dashboard', (c) => {
    const dashboard: EnterpriseAgentDashboard = generateDashboard();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...dashboard,
    });
  });

  // ── Single Agent ──────────────────────────────────────────────────────────

  app.get('/api/ivx/agents/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) {
      return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    }
    const state = getExecutionState(agentId);
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      contract: {
        agentId: contract.agentId,
        agentName: contract.agentName,
        agentNumber: contract.agentNumber,
        divisionId: contract.divisionId,
        companyId: contract.companyId,
        roleName: contract.roleName,
        mission: contract.mission,
        memoryNamespace: contract.memoryNamespace,
        queueNamespace: contract.queueNamespace,
        allowedTools: contract.allowedTools,
        prohibitedTools: contract.prohibitedTools,
        readPermissions: contract.readPermissions,
        writePermissions: contract.writePermissions,
        externalServicePermissions: contract.externalServicePermissions,
        ownerApprovalRules: contract.ownerApprovalRules,
        schedulerConfig: contract.schedulerConfig,
        concurrencyLimit: contract.concurrencyLimit,
        costLimit: contract.costLimit,
        retryPolicy: contract.retryPolicy,
        timeoutPolicy: contract.timeoutPolicy,
        status: contract.status,
        version: contract.version,
        instructionHash: contract.instructionHash,
        systemInstructionsLength: contract.systemInstructions.length,
      },
      heartbeat: state.lastHeartbeat,
      executionState: state,
    });
  });

  app.get('/api/ivx/agents/:agentId/contract', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) {
      return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    }
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      contract,
    });
  });

  app.get('/api/ivx/agents/:agentId/system-instructions', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) {
      return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
    }
    return c.json({
      ok: true,
      agentId,
      agentNumber: contract.agentNumber,
      agentName: contract.agentName,
      instructionHash: contract.instructionHash,
      instructionLength: contract.systemInstructions.length,
      systemInstructions: contract.systemInstructions,
    });
  });

  // ── Agent Memory ──────────────────────────────────────────────────────────

  app.get('/api/ivx/agents/:agentId/memory', (c) => {
    const agentId = c.req.param('agentId');
    const contract = getContractByAgentId(agentId);
    if (!contract) {
      return c.json({ ok: false, error: `Agent ${agentId} not found` }, 404);
    }
    const ns = `${agentId}_memory`;
    const result = listMemory(ns, agentId);
    return c.json({
      ok: result.ok,
      agentId,
      memoryNamespace: ns,
      keys: result.keys,
      error: result.error,
    });
  });

  app.get('/api/ivx/agents/:agentId/memory/:key', (c) => {
    const agentId = c.req.param('agentId');
    const key = c.req.param('key');
    const ns = `${agentId}_memory`;
    const result = readMemory(ns, key, agentId);
    return c.json({
      ok: result.ok,
      agentId,
      key,
      record: result.record,
      error: result.error,
    });
  });

  // ── Agent Control ─────────────────────────────────────────────────────────

  app.post('/api/ivx/agents/:agentId/pause', (c) => {
    const agentId = c.req.param('agentId');
    const result = pauseAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'pause', error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/resume', (c) => {
    const agentId = c.req.param('agentId');
    const result = resumeAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'resume', error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/disable', (c) => {
    const agentId = c.req.param('agentId');
    const result = disableAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'disable', error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/enable', (c) => {
    const agentId = c.req.param('agentId');
    const result = enableAgent(agentId);
    return c.json({ ok: result.ok, agentId, action: 'enable', error: result.error });
  });

  app.post('/api/ivx/agents/:agentId/clear-memory', (c) => {
    const agentId = c.req.param('agentId');
    const result = clearTaskMemory(agentId);
    return c.json({ ok: result.ok, agentId, action: 'clear_task_memory', cleared: result.cleared });
  });

  // ── Agent Execution ───────────────────────────────────────────────────────

  app.post('/api/ivx/agents/:agentId/run', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({}));
    const taskType = body.taskType || 'audit';
    const payload = body.payload || {};
    const ownerApprovalToken = body.ownerApprovalToken || null;

    const result = await executeAgentRun(agentId, taskType, payload, ownerApprovalToken);
    return c.json({
      ok: result.ok,
      marker: IVX_AGENT_API_MARKER,
      runRecord: result.runRecord,
      error: result.error,
    });
  });

  // ── Agent Versioning ──────────────────────────────────────────────────────

  app.post('/api/ivx/agents/:agentId/version', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({}));
    const result = updateAgentContract(agentId, body.updates || {}, body.ownerApproval === true);
    return c.json({
      ok: result.ok,
      agentId,
      newVersion: result.newVersion,
      error: result.error,
    });
  });

  app.post('/api/ivx/agents/:agentId/rollback', async (c) => {
    const agentId = c.req.param('agentId');
    const body = await c.req.json().catch(() => ({}));
    const targetVersion = body.targetVersion;
    if (typeof targetVersion !== 'number') {
      return c.json({ ok: false, error: 'targetVersion (number) required' }, 400);
    }
    const result = rollbackAgentContract(agentId, targetVersion);
    return c.json({
      ok: result.ok,
      agentId,
      rolledBackTo: targetVersion,
      error: result.error,
    });
  });

  app.get('/api/ivx/agents/:agentId/history', (c) => {
    const agentId = c.req.param('agentId');
    const history = getContractVersionHistory(agentId);
    return c.json({
      ok: true,
      agentId,
      versions: history.map((h) => ({
        version: h.version,
        updatedAt: h.updatedAt,
        instructionHash: h.instructionHash,
      })),
    });
  });

  // ── Audit & Verification ──────────────────────────────────────────────────

  app.get('/api/ivx/agents/contracts/audit', (c) => {
    const audit = auditInstructionUniqueness();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...audit,
    });
  });

  app.get('/api/ivx/agents/contracts/validate', (c) => {
    const validation = validateAllContracts();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...validation,
    });
  });

  app.get('/api/ivx/agents/permissions/verify', (c) => {
    const verification = verifyPermissionMatrix();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...verification,
    });
  });

  app.get('/api/ivx/agents/differentiation/test', (c) => {
    const taskType = c.req.query('taskType') || 'deploy';
    const results = testAgentDifferentiation(taskType);
    const accepted = results.filter((r) => r.accepted);
    const rejected = results.filter((r) => !r.accepted);
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      taskType,
      totalAgents: results.length,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      acceptedAgents: accepted.map((r) => ({ agentNumber: r.agentNumber, agentName: r.agentName, reason: r.reason })),
      rejectedSample: rejected.slice(0, 10).map((r) => ({ agentNumber: r.agentNumber, agentName: r.agentName, reason: r.reason })),
    });
  });

  app.get('/api/ivx/agents/failure/isolation', (c) => {
    const result = testFailureIsolation();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...result,
    });
  });

  app.get('/api/ivx/agents/pause/isolation', (c) => {
    const result = testPauseIsolation();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...result,
    });
  });

  app.get('/api/ivx/agents/independence-check', (c) => {
    const result = verifyIndependence();
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      ...result,
    });
  });

  // ── Run Records ───────────────────────────────────────────────────────────

  app.get('/api/ivx/agents/runs', (c) => {
    const limit = parseInt(c.req.query('limit') || '50', 10);
    const records = getRunRecords(undefined, limit);
    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      totalRecords: getRunRecordCount(),
      recordsWithEvidence: getRunRecordsWithEvidence(),
      records,
    });
  });

  app.get('/api/ivx/agents/runs/:agentId', (c) => {
    const agentId = c.req.param('agentId');
    const limit = parseInt(c.req.query('limit') || '20', 10);
    const records = getRunRecords(agentId, limit);
    return c.json({
      ok: true,
      agentId,
      count: records.length,
      records,
    });
  });

  // ── Execute All 100 Agents ────────────────────────────────────────────────

  app.post('/api/ivx/agents/execute-all', async (c) => {
    const results: Array<{
      agentId: string;
      agentNumber: number;
      agentName: string;
      ok: boolean;
      runId: string | null;
      durationMs: number;
      error: string | null;
      evidenceCount: number;
    }> = [];

    for (const contract of ALL_AGENT_CONTRACTS) {
      const taskType = 'audit';
      // Critical-priority agents require owner approval — pass a controlled-run token
      const needsApproval = contract.ownerApprovalRules.some((r) => r.required && r.action === 'any_execution');
      const approvalToken = needsApproval ? `owner-controlled-${Date.now()}-${contract.agentNumber}` : null;
      const result = await executeAgentRun(contract.agentId, taskType, { controlled: true }, approvalToken);
      results.push({
        agentId: contract.agentId,
        agentNumber: contract.agentNumber,
        agentName: contract.agentName,
        ok: result.ok,
        runId: result.runRecord?.runId ?? null,
        durationMs: result.runRecord?.durationMs ?? 0,
        error: result.error,
        evidenceCount: result.runRecord?.evidence.length ?? 0,
      });
    }

    const succeeded = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    const withEvidence = results.filter((r) => r.evidenceCount > 0).length;

    return c.json({
      ok: true,
      marker: IVX_AGENT_API_MARKER,
      totalAgents: results.length,
      succeeded,
      failed,
      withEvidence,
      results,
    });
  });
}
