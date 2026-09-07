import { describe, expect, it } from 'bun:test';

const moduleUrl = new URL('./ivx-autonomous-task-engine.ts', import.meta.url).href;
const landingModuleUrl = new URL('./ivx-landing-p0-backlog.ts', import.meta.url).href;

function scenario(body: string): Record<string, unknown> {
  const script = `
    process.env.SUPABASE_URL = 'https://ivx-fleet-batch.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    let document = [];
    let documentReads = 0;
    let documentWrites = 0;
    let eventWrites = 0;
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      const method = init.method ?? 'GET';
      if (url.includes('/ivx_durable_documents?select=doc_key')) return Response.json([]);
      if (url.includes('/ivx_durable_documents?doc_key=eq.task-engine%2Ftasks.json')) {
        documentReads += 1;
        return Response.json([{value: structuredClone(document)}]);
      }
      if (url.includes('/ivx_durable_documents?on_conflict=doc_key') && method === 'POST') {
        documentWrites += 1;
        document = structuredClone(JSON.parse(init.body).value);
        return Response.json(null);
      }
      if (url.includes('/ivx_durable_events') && method === 'POST') {
        eventWrites += 1;
        return Response.json(null);
      }
      throw new Error('Unexpected request: ' + method + ' ' + url);
    };
    const engine = await import(${JSON.stringify(moduleUrl)});
    const taskInputs = Array.from({length:112}, (_, index) => ({
      title: 'Fleet task ' + (index + 1),
      description: 'Real QA work',
      taskType: 'qa',
      idempotencyKey: 'fleet-batch:' + (index + 1),
      assignedAgentNumber: index + 1,
      priority: 'critical',
    }));
    ${body}
  `;
  const child = Bun.spawnSync([process.execPath, '--eval', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
  });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  const lines = new TextDecoder().decode(child.stdout).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

describe('112-lane durable fleet batching', () => {
  it('creates, leases and starts 112 unique tasks in three document writes', () => {
    const result = scenario(`
      const created = await engine.createTasksBatch(taskInputs);
      const leases = await engine.leaseNextTasksBatch(taskInputs.map((_, index) => ({
        workerId: 'agent:ivx_holdings_' + (index + 1),
        agentNumber: index + 1,
      })));
      const started = await engine.startLeasedTasksBatch(leases.map(result => ({
        taskId: result.task.taskId,
        workerId: result.workerId,
      })));
      console.log(JSON.stringify({
        created: created.filter(result => result.ok && !result.duplicate).length,
        leased: leases.filter(result => result.ok && result.task).length,
        started: started.filter(result => result.ok).length,
        uniqueTasks: new Set(started.map(result => result.task.taskId)).size,
        uniqueWorkers: new Set(started.map(result => result.task.leaseHolder)).size,
        running: document.filter(task => task.state === 'RUNNING').length,
        documentReads,
        documentWrites,
        eventWrites,
      }));
    `);
    expect(result).toEqual({
      created: 112,
      leased: 112,
      started: 112,
      uniqueTasks: 112,
      uniqueWorkers: 112,
      running: 112,
      documentReads: 1,
      documentWrites: 3,
      eventWrites: 3,
    });
  });

  it('coalesces 112 simultaneous owner-priority reads into one GitHub request', () => {
    const script = `
      process.env.NODE_ENV = 'production';
      delete process.env.IVX_LANDING_P0_MISSION;
      let reads = 0;
      const fetchImpl = async () => {
        reads += 1;
        await new Promise(resolve => setTimeout(resolve, 5));
        return Response.json({active:true, priority:'P0-OWNER', mission:'landing'});
      };
      const {readOwnerPriority} = await import(${JSON.stringify(landingModuleUrl)});
      const states = await Promise.all(Array.from({length:112}, () => readOwnerPriority(fetchImpl)));
      console.log(JSON.stringify({reads, active:states.filter(state => state.active).length}));
    `;
    const child = Bun.spawnSync([process.execPath, '--eval', script], {
      stdout: 'pipe', stderr: 'pipe', timeout: 15_000,
    });
    if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
    const lines = new TextDecoder().decode(child.stdout).trim().split('\n');
    expect(JSON.parse(lines[lines.length - 1])).toEqual({ reads: 1, active: 112 });
  });

  it('renews 112 heartbeats with one write and rejects a mismatched holder', () => {
    const result = scenario(`
      await engine.createTasksBatch(taskInputs);
      const leases = await engine.leaseNextTasksBatch(taskInputs.map((_, index) => ({
        workerId: 'agent:ivx_holdings_' + (index + 1),
        agentNumber: index + 1,
      })));
      await engine.startLeasedTasksBatch(leases.map(result => ({taskId: result.task.taskId, workerId: result.workerId})));
      documentWrites = 0;
      const heartbeat = await engine.heartbeatTasksBatch([
        ...leases.map(result => ({taskId: result.task.taskId, workerId: result.workerId})),
        {taskId: leases[0].task.taskId, workerId: 'agent:wrong'},
      ]);
      console.log(JSON.stringify({
        refreshed: heartbeat.refreshed,
        rejected: heartbeat.rejected.length,
        ok: heartbeat.ok,
        documentWrites,
        fresh: document.filter(task => task.lastHeartbeatAt && task.state === 'RUNNING').length,
      }));
    `);
    expect(result).toEqual({ refreshed: 112, rejected: 1, ok: false, documentWrites: 1, fresh: 112 });
  });

  it('persists evidence, criteria and VERIFIED state together in one write', () => {
    const result = scenario(`
      await engine.createTasksBatch(taskInputs.slice(0, 1));
      const [lease] = await engine.leaseNextTasksBatch([{workerId:'agent:ivx_holdings_1', agentNumber:1}]);
      await engine.startLeasedTasksBatch([{taskId:lease.task.taskId, workerId:lease.workerId}]);
      documentWrites = 0;
      const final = await engine.finalizeEvidenceTask({
        taskId: lease.task.taskId,
        workerId: lease.workerId,
        outcome: 'VERIFIED',
        evidence: {
          evidenceType: 'production_verification',
          source: 'landing.unit',
          contentHash: 'sha256:test',
          summary: 'real production assertion passed',
          commitSha: null,
          deploymentId: null,
        },
      });
      console.log(JSON.stringify({
        ok: final.ok,
        state: document[0].state,
        evidence: document[0].evidence.length,
        criteriaMet: document[0].acceptanceCriteria.every(criterion => criterion.met),
        documentWrites,
        states: final.states,
      }));
    `);
    expect(result).toEqual({
      ok: true,
      state: 'VERIFIED',
      evidence: 1,
      criteriaMet: true,
      documentWrites: 1,
      states: ['EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'VERIFIED'],
    });
  });
});
