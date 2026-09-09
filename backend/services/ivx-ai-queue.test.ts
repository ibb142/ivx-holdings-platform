import {expect,test} from 'bun:test';
import {acquireAIQueueSlot,getAIQueueSnapshot} from './ivx-ai-queue';

test('expired queue waiters are removed and never consume future capacity',async()=>{
 const held=await Promise.all(Array.from({length:getAIQueueSnapshot().short.maxConcurrent},()=>acquireAIQueueSlot('short')));
 try {
  await expect(acquireAIQueueSlot('short',{timeoutMs:10})).rejects.toThrow('AI queue wait timed out');
  expect(getAIQueueSnapshot().short.waiting).toBe(0);
  expect(getAIQueueSnapshot().short.active).toBe(held.length);
 } finally {held.forEach(slot=>slot.release());}
 expect(getAIQueueSnapshot().short.active).toBe(0);
});
test('cancellation removes queued work while preserving FIFO and idempotent release',async()=>{
 const held=await Promise.all(Array.from({length:getAIQueueSnapshot().short.maxConcurrent},()=>acquireAIQueueSlot('short')));
 const controller=new AbortController();
 const cancelled=acquireAIQueueSlot('short',{signal:controller.signal}).catch(error=>error);
 const next=acquireAIQueueSlot('short');
 controller.abort(new Error('cancelled by test'));
 expect((await cancelled).message).toBe('cancelled by test');
 held[0].release();
 const granted=await next;
 held[0].release();
 expect(getAIQueueSnapshot().short.active).toBe(held.length);
 expect(getAIQueueSnapshot().short.waiting).toBe(0);
 held.slice(1).forEach(slot=>slot.release());granted.release();
 expect(getAIQueueSnapshot().short.active).toBe(0);
});
test('queue admission is bounded and aborted requests cannot take a free slot',async()=>{
 const controller=new AbortController();controller.abort(new Error('already cancelled'));
 await expect(acquireAIQueueSlot('long',{signal:controller.signal})).rejects.toThrow('already cancelled');
 const held=await Promise.all(Array.from({length:getAIQueueSnapshot().long.maxConcurrent},()=>acquireAIQueueSlot('long')));
 const controllers=Array.from({length:112},()=>new AbortController());
 const waiting=controllers.map(signal=>acquireAIQueueSlot('long',{signal:signal.signal}).catch(()=>null));
 await expect(acquireAIQueueSlot('long')).rejects.toThrow('AI queue capacity exceeded');
 controllers.forEach(signal=>signal.abort());
 await Promise.all(waiting);held.forEach(slot=>slot.release());
 expect(getAIQueueSnapshot().long).toMatchObject({active:0,waiting:0});
});
