import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paceOriginalResponse } from './phase3-provider-live-stream.mjs';

test('bandwidth control preserves every original byte and response status',async()=>{
  const bytes=new TextEncoder().encode('data: {"id":"real-format","text":"á🙂"}\n\ndata: [DONE]\n\n');
  const source=new Response(bytes,{status:200,headers:{'content-type':'text/event-stream','x-test':'preserved'}});
  const paced=paceOriginalResponse(source,{chunkBytes:3,delayMs:0});
  assert.deepEqual(new Uint8Array(await paced.arrayBuffer()),bytes);
  assert.equal(paced.status,200);assert.equal(paced.headers.get('x-test'),'preserved');
});
test('consumer cancellation reaches the original reader without background drain',async()=>{
  let pulls=0,cancels=0;
  const source=new Response(new ReadableStream({
    pull(controller){pulls++;controller.enqueue(new Uint8Array(1000).fill(65));},
    cancel(){cancels++;},
  },{highWaterMark:0}));
  const reader=paceOriginalResponse(source,{chunkBytes:4,delayMs:0}).body.getReader();
  assert.equal((await reader.read()).value.length,4);
  await reader.cancel('controlled client cancellation');
  await new Promise(resolve=>setTimeout(resolve,5));
  assert.equal(pulls,1);assert.equal(cancels,1);
});
