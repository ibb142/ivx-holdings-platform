import { test } from 'node:test';
import assert from 'node:assert/strict';
import { providerReportedCostNano, readGatewayReceiptCost } from './ivx-provider-reported-cost.ts';

const generationId = 'gen_01ARZ3NDEKTSV4RRFFQ69G5FAV';
const startedAt = Date.parse('2026-09-12T12:00:00Z');
const completedAt = startedAt + 2000;
const request = new Request('https://ai-gateway.vercel.sh/v1/chat/completions', {
  method: 'POST', headers: { Authorization: 'Bearer vck_ISOLATED', 'x-private-header': 'DO_NOT_FORWARD' },
});
const input = { request, generationId, model: 'openai/fixture', startedAt, completedAt };
const receipt = { data: { id: generationId, model: input.model, is_byok: false,
  created_at: new Date(startedAt).toISOString(), total_cost: '0.0002575', gateway_cost: '0.0002575', usage: '0.0002575' } };

test('provider decimal money rounds up without float multiplication', () => {
  for (const [value, expected] of [['0.0002575','257500'],[1e-9,'1'],['0.0000000001','1'],['0','0']]) {
    assert.equal(providerReportedCostNano(value),expected);
  }
  for (const value of [null,-1,'bad',Infinity,'1e999','1000001']) assert.throws(()=>providerReportedCostNano(value));
});
test('a receipt reads only the fixed gateway endpoint using its original credential', async () => {
  let calls = 0;
  const cost = await readGatewayReceiptCost(input, {fetcher: async(url,init)=>{
    calls++;
    assert.equal(url,'https://ai-gateway.vercel.sh/v1/generation?id='+generationId);
    assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
    assert.deepEqual(init.headers,{Authorization:'Bearer vck_ISOLATED',Accept:'application/json'});
    return Response.json(receipt);
  }});
  assert.equal(cost,'257500');assert.equal(calls,1);
});
test('only ingestion 404 retries once; it never creates another model request', async () => {
  let calls = 0; const pauses = [];
  const cost = await readGatewayReceiptCost(input,{fetcher:async(_url,init)=>{
    assert.equal(init.method,'GET');return ++calls===1?new Response('',{status:404}):Response.json(receipt);
  },pause:async ms=>pauses.push(ms)});
  assert.equal(cost,'257500');assert.equal(calls,2);assert.deepEqual(pauses,[2000]);
});
test('authentication, throttling, transport and permanent missing receipts remain unknown', async () => {
  for (const status of [401,403,404,429,500]) {
    let calls = 0;
    assert.equal(await readGatewayReceiptCost(input,{fetcher:async()=>{calls++;return new Response('PRIVATE',{status});},pause:async()=>{}}),null);
    assert.equal(calls,status===404?2:1);
  }
  assert.equal(await readGatewayReceiptCost(input,{fetcher:async()=>{throw Error('PRIVATE');}}),null);
});
test('wrong identity, model, time, BYOK and contradictory costs cannot release liability', async () => {
  for (const change of [{id:'other'},{model:'other/model'},{is_byok:true},{is_byok:undefined},
    {created_at:'invalid'},{created_at:'2026-09-11T12:00:00Z'},{gateway_cost:'1'},{total_cost:'bad'}]) {
    assert.equal(await readGatewayReceiptCost(input,{fetcher:async()=>Response.json({data:{...receipt.data,...change}})}),null);
  }
});
test('a foreign origin, invalid generation or missing credential never sends a receipt request', async () => {
  for (const change of [{generationId:'../other'}, {generationId:undefined},
    {request:new Request('https://api.openai.com/v1/chat/completions',{headers:{Authorization:'Bearer OTHER'}})},
    {request:new Request(request.url)}]) {
    let calls=0;
    assert.equal(await readGatewayReceiptCost({...input,...change},{fetcher:async()=>{calls++;throw Error();}}),null);
    assert.equal(calls,0);
  }
});
test('invalid or oversized bodies are bounded and remain unknown', async () => {
  for (const body of ['PRIVATE_NOT_JSON','x'.repeat(512001)]) {
    assert.equal(await readGatewayReceiptCost(input,{fetcher:async()=>new Response(body)}),null);
  }
});
