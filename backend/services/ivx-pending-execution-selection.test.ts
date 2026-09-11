import { describe, expect, it } from 'bun:test';

const moduleUrl = new URL('./ivx-agent-persistence.ts', import.meta.url).href;

function scenario(body: string) {
  const child = Bun.spawnSync([process.execPath, '--eval', `
    process.env.SUPABASE_URL = 'https://pending-selection.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-pending-selection-test-key';
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    let rows = [], requests = [], responseOverride;
    globalThis.fetch = async (input, init = {}) => {
      const url = new URL(String(input));
      if (url.origin !== 'https://pending-selection.invalid') throw new Error('Unexpected origin');
      if (init.method !== 'GET') throw new Error('Recovery selection must not mutate');
      if (url.pathname.endsWith('/ivx_agent_states')) return Response.json([]);
      if (!url.pathname.endsWith('/ivx_agent_executions')) throw new Error('Unexpected table');
      requests.push(url.searchParams);
      if (responseOverride) return responseOverride();
      let selected = rows.slice();
      const status = url.searchParams.get('final_status');
      if (status) selected = selected.filter(row => status.slice(4, -1).split(',').includes(row.final_status));
      for (const field of ['workflow', 'task_type']) {
        const filter = url.searchParams.get(field);
        if (filter) selected = selected.filter(row => row[field] === filter.slice(3));
      }
      const order = url.searchParams.get('order');
      if (order === 'task_id.desc') selected.sort((a,b) => b.task_id.localeCompare(a.task_id));
      else selected.sort((a,b) => (a.started_at || '').localeCompare(b.started_at || '') || a.task_id.localeCompare(b.task_id));
      selected = selected.slice(0, Number(url.searchParams.get('limit')));
      const fields = url.searchParams.get('select');
      if (fields !== '*') selected = selected.map(row => Object.fromEntries(fields.split(',').map(key => [key,row[key]])));
      return Response.json(selected);
    };
    const store = await import(${JSON.stringify(moduleUrl)});
    const row = (task_id, final_status, extra = {}) => ({
      task_id, run_id:'rec-1', agent_id:'ivx_holdings_1', agent_number:1,
      workflow:'certificate', task_type:'real_execution_certification', final_status,
      started_at:null, evidence:{retained:true}, output:{largeHistory:true}, ...extra,
    });
    ${body}
  `], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  return JSON.parse(new TextDecoder().decode(child.stdout).trim().split('\n').at(-1)!);
}

describe('durable pending execution selection', () => {
  it('discovers old pending work behind more than one scan window of completed history', () => {
    const result = scenario(`
      rows = Array.from({length: 1600}, (_,i) => row('z-completed-' + i, 'completed'));
      rows.push(row('a-old-pending','pending'), row('b-running','running'));
      const result = await store.fetchPendingExecutions(2);
      console.log(JSON.stringify({ok:result.ok, ids:result.data.map(row => row.task_id)}));
    `);
    expect(result).toEqual({ ok: true, ids: ['a-old-pending', 'b-running'] });
  });

  it('filters the requested workflow before limiting and does not transfer historical evidence', () => {
    const result = scenario(`
      rows = Array.from({length: 30}, (_,i) => row('z-unrelated-' + i,'pending',{workflow:'other'}));
      rows.push(row('a-certificate','pending'));
      const result = await store.fetchPendingExecutions(1, {workflow:'certificate',taskType:'real_execution_certification'});
      console.log(JSON.stringify({rows:result.data, query:Object.fromEntries(requests[0])}));
    `);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].task_id).toBe('a-certificate');
    expect(result.rows[0]).not.toHaveProperty('evidence');
    expect(result.rows[0]).not.toHaveProperty('output');
    expect(result.query.workflow).toBe('eq.certificate');
    expect(result.query.task_type).toBe('eq.real_execution_certification');
    expect(result.query.limit).toBe('1');
  });

  it('clamps invalid and oversized limits before the database request', () => {
    const result = scenario(`
      for (const limit of [NaN, Infinity, -1, 2.7, 100000]) await store.fetchPendingExecutions(limit);
      console.log(JSON.stringify(requests.map(query => query.get('limit'))));
    `);
    expect(result).toEqual(['200', '200', '1', '2', '1000']);
  });

  it('preserves database errors instead of reporting an empty healthy queue', () => {
    const result = scenario(`
      responseOverride = () => Response.json({message:'upstream unavailable'},{status:503});
      const result = await store.fetchPendingExecutions();
      console.log(JSON.stringify({ok:result.ok,status:result.status,data:result.data,requests:requests.length}));
    `);
    expect(result).toEqual({ ok: false, status: 503, data: null, requests: 1 });
  });
});
