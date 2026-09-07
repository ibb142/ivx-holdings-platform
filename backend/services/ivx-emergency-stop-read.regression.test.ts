import { describe, expect, it } from 'bun:test';

const moduleUrl = new URL('./ivx-emergency-stop-gate.ts', import.meta.url).href;

function scenario(body: string): Record<string, unknown> {
  const script = `
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://ivx-stop-test.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    let reads = 0;
    let mode = 'ready';
    let clock = 10000;
    Date.now = () => clock;
    globalThis.fetch = async (input) => {
      if (!String(input).startsWith('https://ivx-stop-test.invalid/')) throw new Error('Unexpected network request');
      reads += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      if (mode === 'error') return Response.json({message:'test unavailable'}, {status:503});
      return Response.json([{control_name:'emergency_stop', active:mode === 'stop'}]);
    };
    const {checkEmergencyStop, assertEmergencyStopInactive} = await import(${JSON.stringify(moduleUrl)});
    ${body}
  `;
  const child = Bun.spawnSync([process.execPath, '--eval', script], {
    stdout: 'pipe', stderr: 'pipe', timeout: 10000,
  });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  const lines = new TextDecoder().decode(child.stdout).trim().split('\n');
  return JSON.parse(lines[lines.length - 1]);
}

describe('shared emergency-stop control read', () => {
  it('coalesces 112 simultaneous start guards into one control read', () => {
    expect(scenario(`
      const statuses = await Promise.all(Array.from({length:112}, () => assertEmergencyStopInactive('test task')));
      console.log(JSON.stringify({reads, verified:statuses.filter(s=>s.source==='supabase'&&!s.active).length}));
    `)).toEqual({reads:1, verified:112});
  });

  it('refuses every start when the owner stop is active', () => {
    expect(scenario(`
      mode = 'stop';
      const outcomes = await Promise.allSettled(Array.from({length:112}, () => assertEmergencyStopInactive('test task')));
      console.log(JSON.stringify({reads, refused:outcomes.filter(r=>r.status==='rejected'&&r.reason.message.startsWith('EMERGENCY_STOP_ACTIVE:')).length}));
    `)).toEqual({reads:1, refused:112});
  });

  it('keeps an unavailable control fail-closed for every caller and permits recovery', () => {
    expect(scenario(`
      mode = 'error';
      const outcomes = await Promise.allSettled(Array.from({length:112}, () => assertEmergencyStopInactive('test task')));
      const failedReads = reads;
      mode = 'ready';
      const recovered = await assertEmergencyStopInactive('later test task');
      console.log(JSON.stringify({failedReads, refused:outcomes.filter(r=>r.status==='rejected'&&r.reason.message.startsWith('EMERGENCY_STOP_UNAVAILABLE:')).length, reads, recovered:recovered.source}));
    `)).toEqual({failedReads:1, refused:112, reads:2, recovered:'supabase'});
  });

  it('preserves the 15-second cache boundary and observes a new owner stop after expiry', () => {
    expect(scenario(`
      await checkEmergencyStop();
      mode = 'stop';
      clock += 14999;
      const cached = await checkEmergencyStop();
      const beforeExpiry = reads;
      clock += 1;
      const outcomes = await Promise.allSettled(Array.from({length:112}, () => assertEmergencyStopInactive('test task')));
      console.log(JSON.stringify({beforeExpiry, cachedSource:cached.source, reads, refused:outcomes.filter(r=>r.status==='rejected'&&r.reason.message.startsWith('EMERGENCY_STOP_ACTIVE:')).length}));
    `)).toEqual({beforeExpiry:1, cachedSource:'cache', reads:2, refused:112});
  });
});
