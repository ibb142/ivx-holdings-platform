import { expect, test } from 'bun:test';
import { GlobalAIBudgetError, quoteCatalogModel, usageCostUpperNano, usdToNanoCeil } from './ivx-global-ai-budget';
import { createBudgetedFetch, usageFromProvider } from './ivx-global-ai-budget-fetch';

const fixture = { data: [{ id:'openai/fixture',type:'language',context_window:100,max_tokens:20,
  modalities:{ output:['text'] },pricing:{input:'0.000001',output:'0.000002',input_cache_write:'0.000003',
    service_tiers:{priority:{input:'0.000004',output:'0.000008'}}} }] };
const quote=()=>quoteCatalogModel(fixture,'openai/fixture',Date.now(),'a'.repeat(64));
const request=(body:unknown={model:'openai/fixture',messages:[{role:'user',content:'private fixture'}]},path='/v1/chat/completions')=>
  new Request('https://ai-gateway.vercel.sh'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const response=()=>Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:3}});

test('money rounds up and all published pricing tiers fit a full-context reservation',()=>{
  expect(usdToNanoCeil('0.0000000001')).toBe(1n);
  expect(usdToNanoCeil('12.000000001')).toBe(12000000001n);
  for(const bad of ['-1','NaN','1e-6','Infinity','',null,0])expect(()=>usdToNanoCeil(bad)).toThrow();
  const q=quote();expect(q.inputNanoPerToken).toBe('4000');expect(q.outputNanoPerToken).toBe('8000');
  expect(q.reservedNano).toBe('560000');
  expect(usageCostUpperNano(q,{inputTokens:5,outputTokens:3})).toBe('44000');
  expect(()=>usageCostUpperNano(q,{inputTokens:NaN,outputTokens:0})).toThrow();
});
test('missing, zero, multimodal output or invalid tariff bounds reject admission',()=>{
  for(const change of [{pricing:{}},{context_window:0},{max_tokens:null},{modalities:{output:['text','image']}}]) {
    expect(()=>quoteCatalogModel({data:[{...fixture.data[0],...change}]},'openai/fixture',Date.now(),'hash')).toThrow();
  }
  expect(()=>quoteCatalogModel(fixture,'unpriced/model',Date.now(),'hash')).toThrow();
});
test('disabled enforcement and unrelated reads preserve their original response',async()=>{
  let admissions=0;const expected=response();
  const fetcher=createBudgetedFetch((async()=>expected) as typeof fetch,{enabled:()=>false,reserve:async()=>{admissions++;throw Error();}});
  expect(await fetcher(request())).toBe(expected);expect(admissions).toBe(0);
  const reads=createBudgetedFetch((async()=>expected) as typeof fetch,{enabled:()=>true,reserve:async()=>{admissions++;throw Error();}});
  expect(await reads('https://ai-gateway.vercel.sh/v1/models')).toBe(expected);expect(admissions).toBe(0);
});
test('failed durable admission becomes nonretryable 402 before native HTTP',async()=>{
  let calls=0;
  const guarded=createBudgetedFetch((async()=>{calls++;return response();}) as typeof fetch,{
    enabled:()=>true,reserve:async()=>{throw new GlobalAIBudgetError('global_daily_budget_exceeded');}});
  const denied=await guarded(request());expect(denied.status).toBe(402);expect(calls).toBe(0);
  expect((await denied.json()).error.type).toBe('quota_for_entity_exceeded');
});
test('unpriced tools and media cannot bypass the text envelope',async()=>{
  let calls=0,admissions=0;
  const guarded=createBudgetedFetch((async()=>{calls++;return response();}) as typeof fetch,{
    enabled:()=>true,reserve:async()=>{admissions++;throw Error();}});
  for(const req of [request({model:'openai/fixture',tools:[{type:'web_search'}]}),request({model:'image'},'/v1/images/generations'),
    request({model:'openai/fixture',n:2}),request({model:'openai/fixture',best_of:3}),
    request({model:'openai/fixture',providerOptions:{gateway:{models:['expensive/model']}}})])expect((await guarded(req)).status).toBe(402);
  expect(admissions).toBe(0);expect(calls).toBe(0);
});
test('each retry reserves separately and holds global capacity until body completion',async()=>{
  let active=0,reservations=0,finishes=0;
  const guarded=createBudgetedFetch((async()=>new Response('data: {"usage":{"prompt_tokens":5,"completion_tokens":3}}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch,{enabled:()=>true,reserve:async(model,hash)=>{
    expect(model).toBe('openai/fixture');expect(hash).toMatch(/^[a-f0-9]{64}$/);
    if(active)throw new GlobalAIBudgetError('global_capacity_exceeded');
    active++;reservations++;return{quote:quote(),finish:async(usage)=>{expect(usage).toMatchObject({inputTokens:5,outputTokens:3});active--;finishes++;}};
  }});
  const first=await guarded(request());expect(active).toBe(1);
  expect((await guarded(request())).status).toBe(402);
  await first.text();expect(active).toBe(0);
  await (await guarded(request())).text();expect(reservations).toBe(2);expect(finishes).toBe(2);
});
test('a JSON caller inspecting only status cannot leak global admission',async()=>{
  let finished=false;
  const guarded=createBudgetedFetch((async()=>response()) as typeof fetch,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async()=>{finished=true;}})});
  const reply=await guarded(request());expect(reply.ok).toBe(true);expect(finished).toBe(true);
});
test('abort after reservation refunds only work never sent to a provider',async()=>{
  const controller=new AbortController();let calls=0;let finish:unknown;
  const guarded=createBudgetedFetch((async()=>{calls++;return response();}) as typeof fetch,{enabled:()=>true,reserve:async()=>{
    controller.abort(new Error('owner cancelled'));
    return{quote:quote(),finish:async(usage,notStarted)=>{finish={usage,notStarted};}};
  }});
  await expect(guarded(request(),{signal:controller.signal})).rejects.toThrow('owner cancelled');
  expect(calls).toBe(0);expect(finish).toEqual({usage:null,notStarted:true});
});
test('failed and incomplete responses retain their monetary liability',async()=>{
  for(const native of [async()=>{throw Error('socket lost');},async()=>new Response('invalid json'),async()=>new Response('denied',{status:429})]){
    let finish:unknown='not called';
    const guarded=createBudgetedFetch(native as typeof fetch,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{finish=u;}})});
    try{await (await guarded(request())).text();}catch{}
    expect(finish).toBeNull();
  }
});
test('SSE token usage settles on completion and cancellation aborts upstream first',async()=>{
  let finish:unknown='not called';let signal:AbortSignal|undefined|null;
  const native=(async(_input,init)=>{signal=init?.signal;return new Response('data: {"type":"finish","usage":{"inputTokens":{"total":5},"outputTokens":{"total":3}}}\n\n',{headers:{'Content-Type':'text/event-stream'}});}) as typeof fetch;
  const guarded=createBudgetedFetch(native,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{finish=u;}})});
  await (await guarded(request())).text();expect(finish).toEqual({inputTokens:5,outputTokens:3});
  const endless=createBudgetedFetch((async(_input,init)=>{signal=init?.signal;return new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('data: {"text":"partial"}\n\n'));}}),{headers:{'Content-Type':'text/event-stream'}});}) as typeof fetch,
    {enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{expect(signal?.aborted).toBe(true);finish=u;}})});
  const reply=await endless(request());await reply.body!.cancel('disconnected');expect(finish).toBeNull();
});
test('provider usage shape rejects missing or invalid token counts',()=>{
  expect(usageFromProvider({usage:{input_tokens:3,output_tokens:4}})).toEqual({inputTokens:3,outputTokens:4});
  expect(usageFromProvider({usage:{input_tokens:3,cache_read_input_tokens:10,cache_creation_input_tokens:20,output_tokens:4}})).toEqual({inputTokens:33,outputTokens:4});
  expect(usageFromProvider({usage:{input_tokens:3,cache_read_input_tokens:-1,output_tokens:4}})).toBeNull();
  for(const value of [{},{usage:{inputTokens:2}},{usage:{prompt_tokens:-1,completion_tokens:2}}])expect(usageFromProvider(value)).toBeNull();
});
test('a stream ending after partial usage retains its full liability',async()=>{
  let finish:unknown='not called';
  const guarded=createBudgetedFetch((async()=>new Response('data: {"usage":{"input_tokens":5,"output_tokens":0}}\n\n',
    {headers:{'Content-Type':'text/event-stream'}})) as typeof fetch,
    {enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{finish=u;}})});
  await (await guarded(request())).text();expect(finish).toBeNull();
});
