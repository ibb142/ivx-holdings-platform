import { describe, expect, it } from 'bun:test';

// Run each scenario in an isolated process: production module caches and fake
// credentials/fetch must never leak into another test or make a real DB call.
const moduleUrl = new URL('./ivx-autonomous-task-engine.ts', import.meta.url).href;

function scenario(body: string): Record<string, unknown> {
  const script = `
    process.env.SUPABASE_URL = 'https://ivx-cache-test.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_KEY;
    let reads = 0;
    let mode = 'ok';
    let clock = 10000;
    Date.now = () => clock;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (!url.startsWith('https://ivx-cache-test.invalid/')) throw new Error('Unexpected network request');
      if (!url.includes('doc_key=eq.task-engine')) return Response.json([]);
      reads += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (mode === 'rejected') return Response.json({message:'test read rejected'}, {status:400});
      return Response.json([{value: mode === 'malformed' ? {} : [{taskId:'task-' + reads}]}]);
    };
    const {getAllTasks} = await import(${JSON.stringify(moduleUrl)});
    ${body}
  `;
  const child = Bun.spawnSync([process.execPath, '--eval', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 10000,
  });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  const output = new TextDecoder().decode(child.stdout).trim().split('\n');
  return JSON.parse(output[output.length - 1]);
}

describe('task-engine cold-cache read coalescing', () => {
  it('serves 112 simultaneous readers with one durable read', () => {
    const result = scenario(`
      const results = await Promise.all(Array.from({length:112}, () => getAllTasks()));
      console.log(JSON.stringify({reads, readers:results.length, taskIds:[...new Set(results.map(r => r[0].taskId))]}));
    `);
    expect(result).toEqual({reads:1, readers:112, taskIds:['task-1']});
  });

  it('keeps the TTL and coalesces the next expired-cache burst', () => {
    const result = scenario(`
      await getAllTasks();
      clock += 1500;
      await getAllTasks();
      const beforeExpiry = reads;
      clock += 1;
      await Promise.all(Array.from({length:112}, () => getAllTasks()));
      console.log(JSON.stringify({beforeExpiry, reads}));
    `);
    expect(result).toEqual({beforeExpiry:1, reads:2});
  });

  it('propagates failures to every reader and permits a later healthy retry', () => {
    const result = scenario(`
      mode = 'rejected';
      const results = await Promise.allSettled(Array.from({length:112}, () => getAllTasks()));
      const failedReads = reads;
      mode = 'ok';
      const recovered = await getAllTasks();
      console.log(JSON.stringify({failedReads, rejected:results.filter(r=>r.status==='rejected').length, reads, recovered:recovered.length}));
    `);
    expect(result).toEqual({failedReads:1, rejected:112, reads:2, recovered:1});
  });

  it('does not turn malformed durable state into an empty or successful queue', () => {
    const result = scenario(`
      mode = 'malformed';
      let error = '';
      try { await getAllTasks(); } catch (caught) { error = caught.message; }
      mode = 'ok';
      const recovered = await getAllTasks();
      console.log(JSON.stringify({error, reads, recovered:recovered.length}));
    `);
    expect(result).toEqual({error:'task_engine_durable_payload_not_array', reads:2, recovered:1});
  });
});
