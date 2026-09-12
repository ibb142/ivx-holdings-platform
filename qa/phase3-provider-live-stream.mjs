import assert from 'node:assert/strict';

// Controlled consumer bandwidth for the cancellation scenario. Forward every
// original byte unchanged; never clone, fabricate, or drain ahead of demand.
// A provider may already have computed buffered bytes. Cancellation therefore
// cannot justify a zero charge and retains the original monetary liability.
export function paceOriginalResponse(response,{chunkBytes=64,delayMs=10}={}) {
  assert(response.body,'ORIGINAL_STREAM_REQUIRED');
  assert(Number.isInteger(chunkBytes)&&chunkBytes>0&&chunkBytes<=1024,'INVALID_FORWARD_CHUNK');
  assert(Number.isInteger(delayMs)&&delayMs>=0&&delayMs<=100,'INVALID_CONSUMER_DELAY');
  const reader=response.body.getReader();let pending=new Uint8Array(),cancelled=false;
  const stream=new ReadableStream({
    async pull(controller) {
      try {
        if(!pending.length) {
          const part=await reader.read();
          if(part.done){controller.close();return;}
          pending=part.value;
        }
        if(delayMs)await new Promise(resolve=>setTimeout(resolve,delayMs));
        if(cancelled)return;
        const chunk=pending.subarray(0,chunkBytes);pending=pending.subarray(chunk.length);
        controller.enqueue(chunk);
      }catch(error){if(!cancelled)controller.error(error);}
    },
    async cancel(reason){cancelled=true;pending=new Uint8Array();await reader.cancel(reason);},
  },{highWaterMark:0});
  return new Response(stream,{status:response.status,statusText:response.statusText,headers:response.headers});
}
