import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CAMPAIGN_EXPIRES, PAID_LABELS, reservationId, checkPolicy, checkQuote, sharedBinding, checkRows } from './phase3-provider-live-guards.mjs';

const now = Date.parse('2026-09-12T12:00:00Z');
const policy = { enabled:true, dailyLimitNano:'200000000000', maxConcurrent:2, policyRevision:2, requestsActive:0 };
const quote = { reservedNano:'300000000', observedAt:new Date(now-1000).toISOString(),
  validUntil:new Date(now+1000).toISOString(), catalogSha256:'a'.repeat(64) };
const binding = { SUPABASE_URL:'https://kvclcdjmjghndxsngfzb.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'isolated-test',
  AI_GATEWAY_API_KEY:'vck_isolated-test', IVX_AI_GLOBAL_BUDGET_ENABLED:'true' };

test('stable identities fence replays across workflow attempts and source commits', () => {
  const ids = [...PAID_LABELS,'denied'].map(reservationId);
  assert.equal(new Set(ids).size,4);
  for (const label of PAID_LABELS) assert.equal(reservationId(label),reservationId(label));
  assert.throws(() => reservationId('new-paid-attempt'));
});
test('refuses unapproved or disabled production policy before model admission', () => {
  checkPolicy(policy,now);
  for (const patch of [{enabled:false},{dailyLimitNano:'201000000000'},{maxConcurrent:3},{policyRevision:3},{requestsActive:3}])
    assert.throws(() => checkPolicy({...policy,...patch},now));
  assert.throws(() => checkPolicy(policy,CAMPAIGN_EXPIRES));
});
test('all three potential calls fit the fixed campaign liability and fresh catalog', () => {
  checkQuote(quote,now);
  for (const patch of [{reservedNano:'333333334'},{reservedNano:'0'},{validUntil:new Date(now).toISOString()},
    {observedAt:new Date(now+1).toISOString()},{catalogSha256:''}])
    assert.throws(() => checkQuote({...quote,...patch},now));
});
test('both deployed services must enforce the same protected database and Gateway binding', () => {
  assert.equal(sharedBinding([binding,{...binding}]).databaseUrl,binding.SUPABASE_URL);
  for (const patch of [{SUPABASE_URL:'https://other.supabase.co'},{SUPABASE_SERVICE_ROLE_KEY:'different'},
    {AI_GATEWAY_API_KEY:'vck_different'},{IVX_AI_GLOBAL_BUDGET_ENABLED:'false'}])
    assert.throws(() => sharedBinding([binding,{...binding,...patch}]));
});
test('receipt selection rejects foreign, duplicate and excessive probe liability', () => {
  const rows = PAID_LABELS.map(label => ({reservation_id:reservationId(label),reserved_nano:'300000000'}));
  checkRows(rows);
  assert.throws(() => checkRows([...rows,rows[0]]));
  assert.throws(() => checkRows([{...rows[0],reservation_id:'foreign'}]));
  assert.throws(() => checkRows(rows.map(r => ({...r,reserved_nano:'400000000'}))));
});
