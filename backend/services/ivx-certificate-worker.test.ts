import { expect, test } from 'bun:test';

test('dedicated certificate polling discovers later work, never overlaps, and stops', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    let calls=0, finish, next, scheduled=0;
    mock.module('./backend/services/ivx-real-execution-certificate.ts',()=>({
      resumePendingCertificateRuns:()=>{calls++; return new Promise(resolve=>{finish=resolve;});}
    }));
    globalThis.setTimeout=(callback)=>{next=callback;scheduled++;return 1;};
    globalThis.clearTimeout=()=>{next=null;};
    const m=await import('./backend/services/ivx-certificate-worker.ts');
    process.env.IVX_PROCESS_ROLE='api';
    m.startCertificateWorker();
    if(calls)throw Error('API claimed certificate work');
    process.env.IVX_PROCESS_ROLE='worker';
    m.startCertificateWorker();m.startCertificateWorker();
    if(calls!==1||scheduled)throw Error('overlapping recovery');
    finish({resumed:1,runIds:['rec-1']});await Promise.resolve();await Promise.resolve();
    if(scheduled!==1)throw Error('later enqueue will be stranded');
    next();if(calls!==2)throw Error('next poll did not discover work');
    m.stopCertificateWorker();finish({resumed:0,runIds:[]});await Promise.resolve();await Promise.resolve();
    if(scheduled!==1||next!==null)throw Error('poll continued after shutdown');
  `], {cwd:new URL('../../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:5000});
  const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(err).toBe('');expect(code).toBe(0);
});
