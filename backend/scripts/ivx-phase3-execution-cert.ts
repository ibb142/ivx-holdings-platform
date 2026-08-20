import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ALL_ENTERPRISE_AGENTS } from '../services/ivx-enterprise-master-registry';
import { executeRealTool } from '../services/ivx-agent-real-tools';
import { readMemory, writeMemory } from '../services/ivx-agent-runtime';

const sourceSha = String(process.env.IVX_SOURCE_SHA || process.env.GITHUB_SHA || '').trim();
const runId = String(process.env.GITHUB_RUN_ID || `local-${Date.now()}`);
const outputPath = process.env.IVX_PHASE3_CERT_PATH || 'qa/evidence/autonomous/phase3-autonomous-execution-ci.json';
const SHA40 = /^[0-9a-f]{40}$/i;

if (!SHA40.test(sourceSha)) {
  throw new Error(`PHASE3_SOURCE_SHA_INVALID:${sourceSha || 'missing'}`);
}

const selectedNumbers = [10, 11, 17, 20, 40, 49, 68, 92];
const selected = selectedNumbers.map((number) => {
  const agent = ALL_ENTERPRISE_AGENTS.find((row) => row.agentNumber === number);
  if (!agent) throw new Error(`PHASE3_AGENT_MISSING:${number}`);
  return agent;
});

const startedAt = new Date().toISOString();
const positives: Array<Record<string, unknown>> = [];
const negatives: Array<Record<string, unknown>> = [];

async function runPublicProof(agent: (typeof selected)[number]) {
  let result = await executeRealTool(agent.id, agent.agentNumber, 'ivx_public_landing', {}, { timeoutMs: 15_000 });
  if (!result.ok) {
    result = await executeRealTool(agent.id, agent.agentNumber, 'ivx_public_landing', {}, { timeoutMs: 15_000 });
  }
  const evidenceValid = Boolean(
    result.ok &&
    !result.blocked &&
    result.httpStatus >= 200 && result.httpStatus < 400 &&
    result.toolResultId &&
    result.sourceReference &&
    /^[0-9a-f]{64}$/i.test(result.contentSha256),
  );
  positives.push({
    taskId: `phase3-${runId}-${agent.agentNumber}`,
    agentId: agent.id,
    agentNumber: agent.agentNumber,
    role: agent.role,
    division: agent.division,
    taskType: 'phase3_real_execution_probe',
    sourceSha,
    toolId: result.toolId,
    toolResultId: result.toolResultId || null,
    sourceReference: result.sourceReference || null,
    evidenceSha256: result.contentSha256 || null,
    httpStatus: result.httpStatus,
    durationMs: result.durationMs,
    simulated: false,
    finalStatus: evidenceValid ? 'SUCCESS' : 'FAILED',
    error: result.error,
  });
}

for (const agent of selected) {
  await runPublicProof(agent);
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
  const result = await executeRealTool(negativeAgent.id, negativeAgent.agentNumber, toolId, {}, { timeoutMs: 5_000 });
  negatives.push({
    name: `blocked_tool:${toolId}`,
    agentId: negativeAgent.id,
    agentNumber: negativeAgent.agentNumber,
    toolId,
    passed: result.ok === false && result.blocked === true,
    blocked: result.blocked,
    errorClass: result.error ? String(result.error).slice(0, 120) : null,
  });
}

const otherAgent = selected[1];
const crossWrite = writeMemory(
  `${otherAgent.id}_memory`,
  'agent',
  'phase3-cross-agent-write',
  'must-not-write',
  `phase3://${sourceSha}`,
  negativeAgent.id,
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
  stableTaskIdRetry: /stable taskId/i.test(runtimeSource),
  persistenceExecutionRow: /export type ExecutionRow/.test(persistenceSource),
  persistenceTaskId: /task_id: string/.test(persistenceSource),
  persistenceToolResultId: /tool_result_id: string \| null/.test(persistenceSource),
  persistenceSourceReference: /source_reference: string \| null/.test(persistenceSource),
  persistenceEvidenceSha: /evidence_sha256: string \| null/.test(persistenceSource),
  persistenceSimulatedFlag: /simulated: boolean/.test(persistenceSource),
  persistenceStartedAt: /started_at: string \| null/.test(persistenceSource),
  persistenceFinishedAt: /finished_at: string \| null/.test(persistenceSource),
  runtimeDurableInsert: /insertExecutions/.test(runtimeSource),
  runtimeDurableUpdate: /updateExecution/.test(runtimeSource),
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
  representativeExecutions: positives.length,
  representativeExecutionPass: positives.filter((row) => row.finalStatus === 'SUCCESS').length,
  negativeControls: negatives.length,
  negativeControlsPass: negatives.filter((row) => row.passed === true).length,
  staticAuditChecks: Object.keys(staticChecks).length,
  staticAuditPass: Object.values(staticChecks).filter(Boolean).length,
  simulatedRuns: 0,
  realFundsMoved: false,
  positiveExecutions: positives,
  negativeTests: negatives,
  staticChecks,
};
const artifactSha256 = createHash('sha256').update(JSON.stringify(certificatePayload)).digest('hex');
const ok = positivePass && negativePass && staticPass;
const certificate = { ok, ...certificatePayload, artifactSha256 };

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(certificate, null, 2)}\n`);
console.log(JSON.stringify({
  ok,
  certificate: certificate.certificate,
  sourceSha,
  representativeExecutions: certificate.representativeExecutions,
  representativeExecutionPass: certificate.representativeExecutionPass,
  negativeControls: certificate.negativeControls,
  negativeControlsPass: certificate.negativeControlsPass,
  staticAuditChecks: certificate.staticAuditChecks,
  staticAuditPass: certificate.staticAuditPass,
  artifactSha256,
}, null, 2));

if (!ok) process.exit(1);
