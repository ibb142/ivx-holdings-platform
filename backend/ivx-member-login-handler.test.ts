import { expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

test('HTTP login rejects malformed requests without auth I/O and preserves genuine auth outcomes', () => {
  const script = `
    import { mock } from 'bun:test';
    import assert from 'node:assert/strict';
    let calls=0, next={success:false,message:'Invalid email or password.'}, received;
    const real=await import('./backend/services/ivx-member-database');
    mock.module('./backend/services/ivx-member-database',()=>({...real,loginMember:async(...args)=>{calls++;received=args;return next;}}));
    const {handleMemberLogin}=await import('./backend/api/ivx-members');
    const request=body=>new Request('https://ivxholding.com/api/members/login',{method:'POST',headers:{'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)});
    const started=performance.now();
    const bodies=[null,[],{},'invalid json',{email:'probe@invalid.ivxholding.test',password:'Wrong-Password-1!'}];
    const responses=await Promise.all(Array.from({length:32},(_,i)=>handleMemberLogin(request(bodies[i%bodies.length]))));
    assert(responses.every(r=>r.status===400)); assert.equal(calls,0);
    const elapsedMs=performance.now()-started; assert(elapsedMs<500);
    const valid={email:' Member@IVXHolding.com ',password:' password with spaces '};
    assert.equal((await handleMemberLogin(request(valid))).status,401);
    assert.deepEqual(received,['member@ivxholding.com',' password with spaces ']);
    next={success:false,errorCode:'auth_upstream_timeout'};
    assert.equal((await handleMemberLogin(request(valid))).status,503);
    next={success:false,requiresVerification:true};
    assert.equal((await handleMemberLogin(request(valid))).status,403);
    next={success:true}; assert.equal((await handleMemberLogin(request(valid))).status,200);
    console.log(JSON.stringify({requests:32,authCallsForInvalid:0,elapsedMs}));
  `;
  const child = Bun.spawnSync([process.execPath, '--preload', './backend-test-preload.ts', '-e', script], {
    cwd: fileURLToPath(new URL('../', import.meta.url)), env: { ...process.env, NODE_ENV: 'test' }, timeout: 20_000,
  });
  expect(child.stderr.toString()).not.toContain('AssertionError');
  expect(child.exitCode).toBe(0);
  const result = JSON.parse(child.stdout.toString().trim().split('\n').at(-1)!);
  expect(result.authCallsForInvalid).toBe(0);
  expect(result.elapsedMs).toBeLessThan(500);
  console.info('Invalid login handler concurrency:', result);
});
