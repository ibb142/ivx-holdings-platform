import { readFileSync, writeFileSync } from 'node:fs';

function replaceOnce(text, oldValue, newValue, label) {
  if (text.includes(newValue)) return text;
  if (!text.includes(oldValue)) throw new Error(`${label}_ANCHOR_MISSING`);
  return text.replace(oldValue, newValue);
}

const dispatcherPath = 'backend/services/ivx-campaign-dispatcher.ts';
let dispatcher = readFileSync(dispatcherPath, 'utf8');
dispatcher = replaceOnce(
  dispatcher,
  'return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 32) : 8;',
  'return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 112) : 112;',
  'DISPATCHER_CONCURRENCY',
);
dispatcher = dispatcher.replace(
  'Max concurrent jobs: IVX_CAMPAIGN_MAX_CONCURRENCY (default 8).',
  'Max concurrent jobs: IVX_CAMPAIGN_MAX_CONCURRENCY (default 112, capped at 112).',
);

const backlogBlock = `  // 2b. CONTINUOUS LOW-RISK BACKLOG: verification agents are not allowed to stay idle.\n  // Re-run completed read-only VERIFY duties after a cooldown. Mutation jobs never auto-repeat.\n  const verifyCooldownMs = Math.max(60_000, Number.parseInt(process.env.IVX_VERIFY_REPEAT_MS ?? '', 10) || 15 * 60 * 1000);\n  const verifyNow = Date.now();\n  for (const record of state.records) {\n    if (record.role !== 'VERIFY' || record.executionMode !== 'read_only' || record.status !== 'COMPLETED' || !record.finishedAt) continue;\n    const finishedAt = Date.parse(record.finishedAt);\n    if (!Number.isFinite(finishedAt) || verifyNow - finishedAt < verifyCooldownMs) continue;\n    record.status = 'QUEUED';\n    record.workerJobId = null;\n    record.workerStatus = null;\n    record.stage = 'CONTINUOUS VERIFICATION - REQUEUED AFTER COOLDOWN';\n    record.progress = 0;\n    record.startedAt = null;\n    record.finishedAt = null;\n    record.error = null;\n    record.blocker = null;\n    result.requeued.push(record.key);\n  }\n\n`;
if (!dispatcher.includes(backlogBlock)) {
  const anchor = '  // 3. FAILURE / CANCELLATION transitions.\n';
  if (!dispatcher.includes(anchor)) throw new Error('CONTINUOUS_BACKLOG_ANCHOR_MISSING');
  dispatcher = dispatcher.replace(anchor, backlogBlock + anchor);
}

const typeBlock = '  utilization24h: { theoreticalAgentHours: number; productiveAgentHours: number; utilizationPercent: number; runningNow: number; queuedNow: number; ownerGateNow: number; };\n';
if (!dispatcher.includes(typeBlock)) {
  const anchor = '  activeJobs: Array<Pick<CampaignJobRecord,\n';
  if (!dispatcher.includes(anchor)) throw new Error('SNAPSHOT_TYPE_ANCHOR_MISSING');
  dispatcher = dispatcher.replace(anchor, typeBlock + anchor);
}

const utilExpr = `    utilization24h: (() => {\n      const now = Date.now();\n      const windowStart = now - 24 * 60 * 60 * 1000;\n      let productiveMs = 0;\n      for (const r of state.records) {\n        if (!r.startedAt) continue;\n        const parsedStart = Date.parse(r.startedAt);\n        if (!Number.isFinite(parsedStart)) continue;\n        const start = Math.max(parsedStart, windowStart);\n        const rawEnd = r.finishedAt ? Date.parse(r.finishedAt) : (r.status === 'RUNNING' ? now : start);\n        const end = Math.min(Number.isFinite(rawEnd) ? rawEnd : start, now);\n        if (end > start) productiveMs += end - start;\n      }\n      const theoreticalAgentHours = 112 * 24;\n      const productiveAgentHours = Number((productiveMs / 3_600_000).toFixed(2));\n      return {\n        theoreticalAgentHours,\n        productiveAgentHours,\n        utilizationPercent: Number(((productiveAgentHours / theoreticalAgentHours) * 100).toFixed(2)),\n        runningNow: count('RUNNING'),\n        queuedNow: count('QUEUED') + count('AWAITING_IMPLEMENT'),\n        ownerGateNow: count('PENDING_OWNER'),\n      };\n    })(),\n`;
if (!dispatcher.includes(utilExpr)) {
  const anchor = '    activeJobs: state.records\n';
  if (!dispatcher.includes(anchor)) throw new Error('SNAPSHOT_BODY_ANCHOR_MISSING');
  dispatcher = dispatcher.replace(anchor, utilExpr + anchor);
}
writeFileSync(dispatcherPath, dispatcher);

const apiPath = 'backend/api/ivx-agent-api.ts';
let api = readFileSync(apiPath, 'utf8');
const oldSerial = `    const results: Array<{ agentId: string; agentNumber: number; agentName: string; ok: boolean; runId: string | null; durationMs: number; error: string | null; evidenceCount: number }> = [];\n    for (const contract of ALL_AGENT_CONTRACTS) {\n      const taskType = 'audit';\n      const needsApproval = contract.ownerApprovalRules.some((r) => r.required && r.action === 'any_execution');\n      const approvalToken = needsApproval ? \`owner-controlled-\${Date.now()}-\${contract.agentNumber}\` : null;\n      const result = await executeAgentRun(contract.agentId, taskType, { controlled: true }, approvalToken);\n      results.push({ agentId: contract.agentId, agentNumber: contract.agentNumber, agentName: contract.agentName, ok: result.ok, runId: result.runRecord?.runId ?? null, durationMs: result.runRecord?.durationMs ?? 0, error: result.error, evidenceCount: result.runRecord?.evidence.length ?? 0 });\n    }\n`;
const newParallel = `    const maxParallel = Math.max(1, Math.min(112, Number.parseInt(process.env.IVX_AGENT_EXECUTE_ALL_CONCURRENCY ?? '', 10) || 112));\n    const results: Array<{ agentId: string; agentNumber: number; agentName: string; ok: boolean; runId: string | null; durationMs: number; error: string | null; evidenceCount: number }> = [];\n    for (let offset = 0; offset < ALL_AGENT_CONTRACTS.length; offset += maxParallel) {\n      const batch = ALL_AGENT_CONTRACTS.slice(offset, offset + maxParallel);\n      const batchResults = await Promise.all(batch.map(async (contract) => {\n        const taskType = 'audit';\n        const needsApproval = contract.ownerApprovalRules.some((r) => r.required && r.action === 'any_execution');\n        const approvalToken = needsApproval ? \`owner-controlled-\${Date.now()}-\${contract.agentNumber}\` : null;\n        const result = await executeAgentRun(contract.agentId, taskType, { controlled: true }, approvalToken);\n        return { agentId: contract.agentId, agentNumber: contract.agentNumber, agentName: contract.agentName, ok: result.ok, runId: result.runRecord?.runId ?? null, durationMs: result.runRecord?.durationMs ?? 0, error: result.error, evidenceCount: result.runRecord?.evidence.length ?? 0 };\n      }));\n      results.push(...batchResults);\n    }\n`;
api = replaceOnce(api, oldSerial, newParallel, 'EXECUTE_ALL_SERIAL');
writeFileSync(apiPath, api);

console.log('IVX_112_UTILIZATION_REPAIR_APPLIED');
