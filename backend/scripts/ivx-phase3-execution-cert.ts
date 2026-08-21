import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ALL_ENTERPRISE_AGENTS } from '../services/ivx-enterprise-master-registry';
import { executeAgentRun, readMemory, writeMemory } from '../services/ivx-agent-runtime';

const sourceSha = String(process.env.IVX_SOURCE_SHA || process.env.GITHUB_SHA || '').trim();
const runId = String(process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
const outputPath = process.env.IVX_PHASE3_CERT_PATH || 'qa/evidence/autonomous/phase3-autonomous-execution-ci.json';
const SHA40 = /^[0-9a-f]{40}$/i;
const SHA64 = /^[0-9a-f]{64}$/i;

if (!SHA40.test(sourceSha)) throw new Error(`PHASE3_SOURCE_SHA_INVALID:${sourceSha || 'missing'}`);

// Representative set: diverse non-critical agents only. The purpose is to prove
// the runtime path, not manufacture 112 identical green executions.
const selected = (() => {
  const rows = ALL_ENTERPRISE_AGENTS.filter((agent) => agent.priority !== 'critical');
  const out: typeof rows = [];
  const groups = new Set<string>();
  for (const agent of rows) {
    const group = `${agent.division}:${agent.functionalGroup}`;
    if (!groups.has(group)) {
      groups.add(group);
      out.push(agent);
    }
    if (out.length >= 8) break;
  }
  if (out.length < 8) throw new Error(`PHASE3_REPRESENTATIVE_AGENT_SHORTAGE:${out.length}`);
  return out;
})();

const startedAt = new Date().toISOString();
const positives: Array<Record<string, unknown>> = [];
const negatives: Array<Record<string, unknown>> = [];

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

for (const agent of selected) {
  const taskId = `phase3-${runId}-positive-${agent.agentNumber}`;
  const execution = await executeAgentRun(agent.id, 'audit', {
    __taskId: taskId,
    __runId: runId,
    __workflow: 'ivx-autonomous-phase3-execution-ci',
    __toolId: 'ivx_public_landing',
    __toolParams: {},
  });
  const record = execution.runRecord;
  const evidenceSha256 = record ? sha256(record.evidence) : '';
  const passed = Boolean(
    execution.ok &&
    record &&
    record.finalStatus === 'completed' &&
    record.taskId === taskId &&
    record.realToolUsed === true &&
    record.verifiedOutput === true &&
    record.simulated === false &&
    record.toolResultId &&
    record.sourceReference &&
    record.evidence.length > 0 &&
    SHA64.test(evidenceSha256) &&
    record.commitSha === sourceSha,
  );
  positives.push({
    taskId,
    agentId: agent.id,
    agentNumber: agent.agentNumber,
    role: agent.role,
    division: agent.division,
    functionalGroup: agent.functionalGroup,
    sourceSha,
    runtimeCommitSha: record?.commitSha ?? null,
    runRecordId: record?.runId ?? null,
    toolsUsed: record?.toolsUsed ?? [],
    toolResultId: record?.toolResultId ?? null,
    sourceReference: record?.sourceReference ?? null,
    evidenceSha256: evidenceSha256 || null,
    evidenceCount: record?.evidence.length ?? 0,
    durationMs: record?.durationMs ?? 0,
    simulated: record?.simulated ?? null,
    finalStatus: passed ? 'SUCCESS' : 'FAILED',
    error: execution.error,
  });
}

const negativeAgent = selected[0];
const blockedTools = [
  'money_movement',
  'trade_execution',
  'legal_execution',
  'production_deploy',
  'external_outreach',
  'crm_write',
  'crm_update',
] as const;

for (const toolId of blockedTools) {
  const taskId = `phase3-${runId}-negative-${toolId}`;
  const execution = await executeAgentRun(negativeAgent.id, 'audit', {
    __taskId: taskId,
    __runId: runId,
    __workflow: 'ivx-autonomous-phase3-execution-ci',
    __toolId: toolId,
    __toolParams: {},
  });
  const record = execution.runRecord;
  const passed = Boolean(
    execution.ok === false &&
    record &&
    record.taskId === taskId &&
    record.finalStatus === 'blocked' &&
    record.realToolUsed === false &&
    record.verifiedOutput === false &&
    record.simulated === false &&
    record.evidence.some((item) => item.type === 'blocked_tool_attempt'),
  );
  negatives.push({
    name: `runtime_blocked_tool:${toolId}`,
    taskId,
    agentId: negativeAgent.id,
    agentNumber: negativeAgent.agentNumber,
    passed,
    finalStatus: record?.finalStatus ?? null,
    evidenceCount: record?.evidence.length ?? 0,
    simulated: record?.simulated ?? null,
    errorClass: execution.error ? String(execution.error).slice(0, 140) : null,
  });
}

const otherAgent = selected[1];
const crossWrite = writeMemory(
  `${otherAgent.id}_memory`, 'agent', 'phase3-cross-agent-write', 'must-not-write',
  `phase3://${sourceSha}`, negativeAgent.id,
);
negatives.push({
  name: 'cross_agent_memory_write_denied',
  passed: crossWrite.ok === false && /Cross-agent memory write denied/.test(crossWrite.error || ''),
  errorClass: crossWrite.error,
});

const crossRead = readMemory(`${otherAgent.id}_memory`, 'phase3-cross-agent-write', negativeAgent.id);
negatives.push({
  name: 'cross_agent_memory_read_denied',
  passed: crossRead.ok === false && /Cross-agent memory access denied/.test(crossRead.error || ''),
  errorClass: crossRead.error,
});

const runtimeSource = fs.readFileSync(path.resolve('backend/services/ivx-agent-runtime.ts'), 'utf8');
const persistenceSource = fs.readFileSync(path.resolve('backend/services/ivx-agent-persistence.ts'), 'utf8');
const staticChecks = {
  runtimeEntryPointUsed: /export async function executeAgentRun/.test(runtimeSource),
  stableTaskIdRetry: /stable taskId/i.test(runtimeSource),
  persistenceExecutionRow: /export type ExecutionRow/.test(persistenceSource),
  persistenceTaskId: /task_id: string/.test(persistenceSource),
  persistenceToolResultId: /tool_result_id: string \| null/.test(persistenceSource),
  persistenceSourceReference: /source_reference: string \| null/.test(persistenceSource),
  persistenceEvidenceSha: /evidence_sha256: string \| null/.test(persistenceSource),
  persistenceSimulatedFlag: /simulated: boolean/.test(persistenceSource),
  persistenceStartedAt: /started_at: string \| null/.test(persistenceSource),
  persistenceFinishedAt: /finished_at: string \| null/.test(persistenceSource),
  runtimeDurableInsert: /await insertExecutions/.test(runtimeSource),
  runtimeDurableUpdate: /await updateExecution/.test(runtimeSource),
  runtimeAgentStatePersistence: /await upsertAgentStates/.test(runtimeSource),
  runtimeEvidenceSha: /computeEvidenceSha/.test(runtimeSource),
};

const positivePass = positives.every((row) => row.finalStatus === 'SUCCESS');
const negativePass = negatives.every((row) => row.passed === true);
const staticPass = Object.values(staticChecks).every(Boolean);
const completedAt = new Date().toISOString();
const certificatePayload = {
  certificate: 'IVX-AUTONOMOUS-PHASE3-EXECUTION-QA-CI',
  sourceSha,
  githubRunId: runId,
  startedAt,
  completedAt,
  runtimePath: 'executeAgentRun',
  representativeExecutions: positives.length,
  representativeExecutionPass: positives.filter((row) => row.finalStatus === 'SUCCESS').length,
  negativeControls: negatives.length,
  negativeControlsPass: negatives.filter((row) => row.passed === true).length,
  staticAuditChecks: Object.keys(staticChecks).length,
  staticAuditPass: Object.values(staticChecks).filter(Boolean).length,
  simulatedRuns: positives.filter((row) => row.simulated !== false).length,
  realFundsMoved: false,
  positiveExecutions: positives,
  negativeTests: negatives,
  staticChecks,
};
const artifactSha256 = sha256(certificatePayload);
const ok = positivePass && negativePass && staticPass && certificatePayload.simulatedRuns === 0;
const certificate = { ok, ...certificatePayload, artifactSha256 };

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(certificate, null, 2)}\n`);
console.log(JSON.stringify({
  ok,
  certificate: certificate.certificate,
  sourceSha,
  runtimePath: certificate.runtimePath,
  representativeExecutions: certificate.representativeExecutions,
  representativeExecutionPass: certificate.representativeExecutionPass,
  negativeControls: certificate.negativeControls,
  negativeControlsPass: certificate.negativeControlsPass,
  staticAuditChecks: certificate.staticAuditChecks,
  staticAuditPass: certificate.staticAuditPass,
  simulatedRuns: certificate.simulatedRuns,
  artifactSha256,
}, null, 2));

if (!ok) process.exit(1);
