import { expect, test } from 'bun:test';
import { GlobalAIBudgetError, quoteCatalogModel, usageCostUpperNano, usdToNanoCeil } from './ivx-global-ai-budget';
import { createBudgetedFetch, usageFromProvider } from './ivx-global-ai-budget-fetch';

const fixture = { data: [{ id:'openai/fixture',type:'language',context_window:100,max_tokens:20,
  modalities:{ output:['text'] },pricing:{input:'0.000001',output:'0.000002',input_cache_write:'0.000003',
    service_tiers:{priority:{input:'0.000004',output:'0.000008'}}} }] };
const quote=()=>quoteCatalogModel(fixture,'openai/fixture',Date.now(),'a'.repeat(64));
const request=(body:unknown={model:'openai/fixture',messages:[{role:'user',content:'private fixture'}]},path='/v1/chat/completions')=>
  new Request('https://ai-gateway.vercel.sh'+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const response=()=>Response.json({choices:[{message:{content:'ok'}}],usage:{prompt_tokens:5,completion_tokens:3},
  providerMetadata:{gateway:{cost:'0.000011'}}});

test('money rounds up and all published pricing tiers fit a full-context reservation',()=>{
  expect(usdToNanoCeil('0.0000000001')).toBe(1n);
  expect(usdToNanoCeil('12.000000001')).toBe(12000000001n);
  for(const bad of ['-1','NaN','1e-6','Infinity','',null,0])expect(()=>usdToNanoCeil(bad)).toThrow();
  const q=quote();expect(q.inputNanoPerToken).toBe('4000');expect(q.outputNanoPerToken).toBe('8000');
  expect(q.requestOverheadNano).toBe('200000');expect(q.reservedNano).toBe('760000');
  expect(usageCostUpperNano(q,{inputTokens:5,outputTokens:3})).toBe('244000');
  expect(()=>usageCostUpperNano(q,{inputTokens:NaN,outputTokens:0})).toThrow();
});
test('missing, zero, multimodal output or invalid tariff bounds reject admission',()=>{
  for(const change of [{pricing:{}},{context_window:0},{max_tokens:null},{modalities:{output:['text','image']}}]) {
    expect(()=>quoteCatalogModel({data:[{...fixture.data[0],...change}]},'openai/fixture',Date.now(),'hash')).toThrow();
  }
  expect(()=>quoteCatalogModel(fixture,'unpriced/model',Date.now(),'hash')).toThrow();
});
test('published cost-valued context tiers and cache tiers cannot underquote admission',()=>{
  const pricing={input:'0.000001',output:'0.000002',
    input_tiers:[{min:0,max:50,cost:'0.000001'},{min:50,cost:'0.000005'}],
    output_tiers:[{min:0,max:50,cost:'0.000002'},{min:50,cost:'0.000009'}],
    input_cache_write_tiers:[{min:0,cost:'0.000006'}]};
  const q=quoteCatalogModel({data:[{...fixture.data[0],pricing}]},'openai/fixture',Date.now(),'a'.repeat(64));
  expect(q.inputNanoPerToken).toBe('6000');expect(q.outputNanoPerToken).toBe('9000');
  expect(q.reservedNano).toBe('980000');
  for(const input_tiers of [{cost:'0.000005'},[{}],[{cost:'invalid'}]]) {
    expect(()=>quoteCatalogModel({data:[{...fixture.data[0],pricing:{...pricing,input_tiers}}]},
      'openai/fixture',Date.now(),'a'.repeat(64))).toThrow();
  }
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
    request({model:'openai/fixture',providerOptions:{gateway:{models:['expensive/model']}}}),
    request({model:'openai/fixture',user:'billable-user'}),request({model:'openai/fixture',tags:['billable-tag']}),
    request({model:'openai/fixture',quotaEntity:'billable-quota'}),
    new Request(request(),{headers:{'ai-reporting-tags':'billable-tag'}}),
    new Request(request(),{headers:{'ai-reporting-user':'billable-user'}})])expect((await guarded(req)).status).toBe(402);
  expect(admissions).toBe(0);expect(calls).toBe(0);
});
test('each retry reserves separately and holds global capacity until body completion',async()=>{
  let active=0,reservations=0,finishes=0;
  const guarded=createBudgetedFetch((async()=>new Response('data: {"usage":{"prompt_tokens":5,"completion_tokens":3},"providerMetadata":{"gateway":{"cost":"0.000011"}}}\n\ndata: [DONE]\n\n',{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch,{enabled:()=>true,reserve:async(model,hash)=>{
    expect(model).toBe('openai/fixture');expect(hash).toMatch(/^[a-f0-9]{64}$/);
    if(active)throw new GlobalAIBudgetError('global_capacity_exceeded');
    active++;reservations++;return{quote:quote(),finish:async(usage)=>{expect(usage).toMatchObject({inputTokens:5,outputTokens:3});active--;finishes++;}};
  }});
  const first=await guarded(request());expect(active).toBe(1);
  const waiting=await guarded(request());
  expect(waiting.status).toBe(429);
  expect(waiting.headers.get('retry-after')).toBe('2');
  expect((await waiting.json()).error).toMatchObject({
    type:'rate_limit_error',code:'IVX_GLOBAL_AI_BUDGET_BLOCKED',message:'Global AI budget: global_capacity_exceeded',
  });
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
  const native=(async(_input,init)=>{signal=init?.signal;return new Response('data: {"type":"finish","usage":{"inputTokens":{"total":5},"outputTokens":{"total":3}},"providerMetadata":{"gateway":{"cost":"0.000011"}}}\n\n',{headers:{'Content-Type':'text/event-stream'}});}) as typeof fetch;
  const guarded=createBudgetedFetch(native,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{finish=u;}})});
  await (await guarded(request())).text();expect(finish).toEqual({inputTokens:5,outputTokens:3,providerCostNano:'11000'});
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
test('reported gateway charges raise the token bound and invalid charges retain liability',()=>{
  const value={usage:{prompt_tokens:5,completion_tokens:3},
    providerMetadata:{gateway:{generationId:'gen_01ARZ3NDEKTSV4RRFFQ69G5FAV',cost:'0.0004'}}};
  const usage=usageFromProvider(value)!;
  expect(usage.providerCostNano).toBe('400000');
  expect(usageCostUpperNano(quote(),usage)).toBe('400000');
  expect(usageCostUpperNano(quote(),{...usage,providerCostNano:'1'})).toBe('244000');
  expect(usageFromProvider({...value,providerMetadata:{gateway:{cost:1e-9}}})?.providerCostNano).toBe('1');
  for(const cost of [null,-1,'bad',Infinity,'1e999','1000001']) {
    expect(usageFromProvider({...value,providerMetadata:{gateway:{cost}}})).toBeNull();
  }
  for(const providerCostNano of ['-1','0.1','1e4','1000000000000001']) {
    expect(()=>usageCostUpperNano(quote(),{...usage,providerCostNano})).toThrow();
  }
});
test('the observed production probe surcharge fits the quote and settled upper bound',()=>{
  const q=quoteCatalogModel({data:[{...fixture.data[0],context_window:128000,max_tokens:16384,
    pricing:{input:'0.00000425',output:'0.000017'}}]},'openai/fixture',Date.now(),'a'.repeat(64));
  const actualReceiptNano=157500n;
  const upper=BigInt(usageCostUpperNano(q,{inputTokens:11,outputTokens:3,providerCostNano:actualReceiptNano.toString()}));
  expect(q.reservedNano).toBe('822728000');expect(upper.toString()).toBe('297750');
  expect(upper>=actualReceiptNano).toBe(true);expect(BigInt(q.reservedNano)>=upper).toBe(true);
});
test('missing response cost requires a matching receipt without replaying inference',async()=>{
  const id='gen_01ARZ3NDEKTSV4RRFFQ69G5FAV';let calls=0,lookups=0;let settled:any;
  const guarded=createBudgetedFetch((async(input,init)=>{
    const req=new Request(input,init);
    if(req.method==='GET') {
      lookups++;expect(new URL(req.url).pathname).toBe('/v1/generation');
      expect(req.headers.get('authorization')).toBe('Bearer vck_fixture');
      return Response.json({data:{id,model:'openai/fixture',is_byok:false,created_at:new Date().toISOString(),
        total_cost:'0.0002575',gateway_cost:'0.0002575',usage:'0.0002575'}});
    }
    calls++;return Response.json({id,usage:{prompt_tokens:5,completion_tokens:3}});
  }) as typeof fetch,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(usage,_notStarted,generationId)=>{settled={usage,generationId};}})});
  const reply=await guarded(request(),{headers:{'Content-Type':'application/json',Authorization:'Bearer vck_fixture'}});
  expect(reply.status).toBe(200);expect(calls).toBe(1);expect(lookups).toBe(1);
  expect(settled.generationId).toBe(id);expect(settled.usage.providerCostNano).toBe('257500');
  expect(usageCostUpperNano(quote(),settled.usage)).toBe('257500');
});
test('unavailable gateway cost retains its reservation and its generation identity',async()=>{
  const id='gen_01ARZ3NDEKTSV4RRFFQ69G5FAV';let calls=0;let settled:any;
  const guarded=createBudgetedFetch((async(input,init)=>{
    const req=new Request(input,init);
    if(req.method==='GET')return new Response('',{status:401});
    calls++;return Response.json({id,usage:{prompt_tokens:5,completion_tokens:3}});
  }) as typeof fetch,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(usage,notStarted,generationId)=>{settled={usage,notStarted,generationId};}})});
  await guarded(request(),{headers:{'Content-Type':'application/json',Authorization:'Bearer vck_fixture'}});
  expect(calls).toBe(1);expect(settled).toEqual({usage:null,notStarted:false,generationId:id});
});
test('cancelled SSE keeps the generation ID from an earlier chunk without querying a premature receipt',async()=>{
  const id='gen_01ARZ3NDEKTSV4RRFFQ69G5FAV';let calls=0;let settled:any;
  const guarded=createBudgetedFetch((async()=>{
    calls++;return new Response(new ReadableStream({start(controller){
      controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id,choices:[{delta:{content:'partial'}}]})+'\n\n'));
    }}),{headers:{'Content-Type':'text/event-stream'}});
  }) as typeof fetch,{enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(usage,notStarted,generationId)=>{settled={usage,notStarted,generationId};}})});
  const reader=(await guarded(request())).body!.getReader();await reader.read();await reader.cancel('owner disconnected');
  expect(calls).toBe(1);expect(settled).toEqual({usage:null,notStarted:false,generationId:id});
});
test('malformed SSE or invalid final cost cannot reuse earlier apparently valid billing evidence',async()=>{
  for(const tail of ['data: invalid JSON\n\n','data: {"type":"finish","providerMetadata":{"gateway":{"cost":"invalid"}}}\n\n']) {
    let settled:unknown='not called';
    const body='data: {"type":"finish","usage":{"inputTokens":5,"outputTokens":3},"providerMetadata":{"gateway":{"cost":"0.000011"}}}\n\n'+tail+'data: [DONE]\n\n';
    const guarded=createBudgetedFetch((async()=>new Response(body,{headers:{'Content-Type':'text/event-stream'}})) as typeof fetch,
      {enabled:()=>true,reserve:async()=>({quote:quote(),finish:async usage=>{settled=usage;}})});
    await (await guarded(request())).text();expect(settled).toBeNull();
  }
});
test('a stream ending after partial usage retains its full liability',async()=>{
  let finish:unknown='not called';
  const guarded=createBudgetedFetch((async()=>new Response('data: {"usage":{"input_tokens":5,"output_tokens":0}}\n\n',
    {headers:{'Content-Type':'text/event-stream'}})) as typeof fetch,
    {enabled:()=>true,reserve:async()=>({quote:quote(),finish:async(u)=>{finish=u;}})});
  await (await guarded(request())).text();expect(finish).toBeNull();
});
