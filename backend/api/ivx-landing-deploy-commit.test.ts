import { expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';

it('fences stale runtime deployments before credentials or AWS writes', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { mock } from 'bun:test';
    let credentialReads=0, externalWrites=0;
    mock.module('./backend/api/owner-only', () => ({
      assertIVXOwnerOnly: async request => { if(request.headers.get('X-IVX-System-Key')!=='fixture-key') throw Error('unauthorized'); },
      ownerOnlyJson: (body,status) => Response.json(body,{status}),
    }));
    mock.module('./backend/api/ivx-owner-variables', () => ({
      getRawOwnerVariableValue: async () => { credentialReads++; return ''; },
      getIVXOwnerVariableRuntimeValue: async () => { credentialReads++; return ''; },
    }));
    mock.module('@aws-sdk/client-s3', () => ({
      S3Client: class { constructor(){externalWrites++;} async send(){externalWrites++;return {};} },
      PutObjectCommand: class {}, PutBucketWebsiteCommand: class {}, PutBucketPolicyCommand: class {}, HeadBucketCommand: class {},
    }));
    globalThis.fetch=async () => { externalWrites++; throw Error('Fixture forbids network'); };
    const {handleLandingFullDeploy}=await import('./backend/api/ivx-landing-full-deploy');
    const live='a'.repeat(40), stale='b'.repeat(40);
    const send=(expectedCommitSha,authorized=true,extra={}) => handleLandingFullDeploy(new Request('https://fixture.invalid/api/ivx/landing-deploy',{
      method:'POST',headers:{'Content-Type':'application/json',...(authorized?{'X-IVX-System-Key':'fixture-key'}:{})},
      body:JSON.stringify({confirm:'DEPLOY_IVX_LANDING_FULL',expectedCommitSha,...extra}),
    }));
    process.env.RENDER_GIT_COMMIT=live;
    assert.equal((await send(stale,false)).status,401);
    assert.equal((await send('short')).status,400);
    assert.equal((await send(42)).status,400);
    const rejected=await send(stale,true,{awsCredentials:{accessKeyId:'fixture',secretAccessKey:'fixture'},storeCredentials:true});
    assert.equal(rejected.status,409);
    assert.equal((await rejected.json()).sourceCommitSha,live);
    delete process.env.RENDER_GIT_COMMIT;
    assert.equal((await send(live)).status,409);
    assert.equal(credentialReads,0,'rejected requests must not even read credentials');
    assert.equal(externalWrites,0,'rejected requests must not store secrets, upload or invalidate');
    process.env.RENDER_GIT_COMMIT=live;
    const admitted=await send(live);
    assert.equal(admitted.status,500);
    assert.match((await admitted.json()).error,/Missing AWS credentials/);
    assert.ok(credentialReads>0,'the exact runtime can proceed to normal credential validation');
    assert.equal(externalWrites,0);
  `;
  const result=spawnSync(process.execPath,['--eval',script],{
    cwd:process.cwd(),encoding:'utf8',timeout:30_000,
    env:{PATH:process.env.PATH,NODE_ENV:'test',IVX_PROCESS_ROLE:'api'},
  });
  if(result.status!==0) throw new Error(result.stderr || result.stdout || String(result.error));
  expect(result.status).toBe(0);
});
