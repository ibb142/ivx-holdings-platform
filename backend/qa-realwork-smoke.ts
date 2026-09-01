/**
 * QA smoke test: executes the REAL engineering cycle end-to-end against the
 * durable task engine (file-backed store) and validates the workflow contract.
 * Exit code != 0 = audit failure.
 */
import {
  runRealEngineeringCycle,
  scanModuleUniverse,
  getFleetEngineeringMetrics,
  IVX_REAL_ENGINEERING_CYCLE_MARKER,
} from './services/ivx-agent-real-engineering-cycle';

let failures = 0;
function check(name: string, cond: boolean, detail = ''): void {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures += 1;
}

async function main(): Promise<void> {
  console.log(`marker: ${IVX_REAL_ENGINEERING_CYCLE_MARKER}`);

  const modules = await scanModuleUniverse();
  check('module universe non-empty', modules.length >= 50, `${modules.length} modules`);
  check('module universe all real .ts/.tsx', modules.every((m) => m.endsWith('.ts') || m.endsWith('.tsx')));
  check('no synthetic/abs paths', modules.every((m) => !m.includes('..') && !m.startsWith('/')));

  // Cycle 1: should seed a module-audit task from the (initially empty) queue, then complete it.
  const c1 = await runRealEngineeringCycle({ agentId: 'qa-agent-001', agentNumber: 1, sourceSha: 'qasmoke0001' });
  console.log('cycle1:', JSON.stringify({ action: c1.action, taskId: c1.taskId, module: c1.module, states: c1.states, defects: c1.defects.length, repairTaskIds: c1.repairTaskIds.length, filesInspected: c1.filesInspected, productiveMinutes: c1.productiveMinutes, error: c1.error }));
  check('cycle1 ok', c1.ok === true, c1.error ?? '');
  check('cycle1 action completed or gated', ['TASK_COMPLETED', 'TASK_OWNER_GATE'].includes(c1.action), c1.action);
  check('cycle1 taskId durable', typeof c1.taskId === 'string' && c1.taskId.length > 0);
  check('cycle1 verified chain', c1.action === 'TASK_OWNER_GATE' || c1.states[c1.states.length - 1] === 'VERIFIED', c1.states.join('>'));
  check('cycle1 evidence recorded', c1.evidenceIds.length >= 1 || c1.action === 'TASK_OWNER_GATE');

  // Workflow-contract field audit (jq in landing-112-agent-autonomous-qa.yml):
  check('contract: .result.action', typeof (c1 as unknown as Record<string, unknown>).action === 'string');
  check('contract: .result.taskId', 'taskId' in c1);
  check('contract: .result.filesInspected array', Array.isArray(c1.filesInspected));
  check('contract: .result.productiveMinutes number', typeof c1.productiveMinutes === 'number' && Number.isFinite(c1.productiveMinutes));

  // Cycle 2-4: different agents, queue should now be drained toward NO_TASK_AVAILABLE or more completions.
  for (const n of [2, 3, 4]) {
    const c = await runRealEngineeringCycle({ agentId: `qa-agent-00${n}`, agentNumber: n, sourceSha: 'qasmoke0001' });
    console.log(`cycle${n}:`, JSON.stringify({ action: c.action, taskId: c.taskId, module: c.module, states: c.states, error: c.error }));
    check(`cycle${n} ok`, c.ok === true, c.error ?? '');
  }

  const metrics = await getFleetEngineeringMetrics(112);
  console.log('metrics:', JSON.stringify({
    tasksStarted: metrics.tasksStarted,
    verified: metrics.tasksCompletedVerified,
    blocked: metrics.tasksBlockedOwnerGate,
    failed: metrics.tasksFailed,
    queued: metrics.tasksQueued,
    defects: metrics.defectsDiscovered,
    repairs: metrics.repairTasksQueued,
    modulesCovered: metrics.modulesCovered,
    hours1h: metrics.productiveAgentHours1h,
    hours24h: metrics.productiveAgentHours24h,
    utilPct: metrics.utilization24hPercent,
  }));
  check('metrics: hours are evidence-backed (not wall-clock x112)', metrics.productiveAgentHours24h < 112 * 24);
  check('metrics: utilization sane', metrics.utilization24hPercent <= 100);
  check('metrics: verified tasks counted', metrics.tasksCompletedVerified >= 1 || metrics.tasksBlockedOwnerGate >= 1);

  // Idempotency: re-running same cycle set must not duplicate seeded audits.
  const before = metrics.tasksStarted + metrics.tasksQueued;
  await runRealEngineeringCycle({ agentId: 'qa-agent-001', agentNumber: 1, sourceSha: 'qasmoke0001' });
  const after = (await getFleetEngineeringMetrics(112));
  const afterTotal = after.tasksStarted + after.tasksQueued;
  check('idempotent seeding (no unbounded queue growth)', afterTotal - before <= 2, `${before} -> ${afterTotal}`);

  console.log(failures === 0 ? 'SMOKE AUDIT: ALL PASS' : `SMOKE AUDIT: ${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
