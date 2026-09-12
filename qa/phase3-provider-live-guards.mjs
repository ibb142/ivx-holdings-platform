import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const CAMPAIGN = 'phase3-provider-live-20260912-03';
export const CAMPAIGN_EXPIRES = Date.parse('2026-09-13T00:00:00Z');
export const MAX_CAMPAIGN_NANO = 1_000_000_000n;
export const PAID_LABELS = ['complete', 'cancel', 'recovery'];
export const DB_ORIGIN = 'https://kvclcdjmjghndxsngfzb.supabase.co';
export const SERVICES = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];

export function reservationId(label) {
  assert([...PAID_LABELS, 'denied'].includes(label), 'UNREVIEWED_PROBE_LABEL');
  const h = createHash('sha256').update(CAMPAIGN + ':' + label).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}

export function checkPolicy(policy, now = Date.now()) {
  assert(now < CAMPAIGN_EXPIRES, 'CAMPAIGN_AUTHORIZATION_EXPIRED');
  assert.equal(policy.enabled, true, 'SHARED_BUDGET_NOT_ENABLED');
  assert.equal(policy.dailyLimitNano, '200000000000', 'AUTHORIZED_POLICY_CHANGED');
  assert.equal(policy.maxConcurrent, 2, 'SHARED_CAPACITY_CHANGED');
  assert.equal(Number(policy.policyRevision), 2, 'POLICY_REVISION_CHANGED');
  assert(Number.isSafeInteger(policy.requestsActive) && policy.requestsActive >= 0 && policy.requestsActive <= 2,
    'INVALID_SHARED_ACTIVE_COUNT');
}

export function checkQuote(quote, now = Date.now()) {
  assert(/^\d{1,16}$/.test(quote.reservedNano || ''), 'INVALID_QUOTE');
  assert(BigInt(quote.reservedNano) > 0n && BigInt(quote.reservedNano) * 3n <= MAX_CAMPAIGN_NANO,
    'CAMPAIGN_LIABILITY_TOO_LARGE');
  assert(Date.parse(quote.observedAt) <= now && Date.parse(quote.validUntil) > now, 'QUOTE_EXPIRED');
  assert(/^[a-f0-9]{64}$/.test(quote.catalogSha256 || ''), 'MISSING_CATALOG_HASH');
}

export function sharedBinding(values) {
  assert.equal(values.length, 2, 'TWO_SERVICE_BINDINGS_REQUIRED');
  const bindings = values.map(env => ({
    databaseUrl: String(env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '').replace(/\/+$/, ''),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY || '').trim(),
    gatewayKey: ['IVX_AI_GATEWAY_KEY','AI_GATEWAY_API_KEY','IVX_VERCEL_GATEWAY_API_KEY','OPENAI_API_KEY']
      .map(key => env[key]).find(value => typeof value === 'string' && value.startsWith('vck_')),
    enforced: env.IVX_AI_GLOBAL_BUDGET_ENABLED === 'true',
  }));
  const first = bindings[0];
  assert.equal(first.databaseUrl, DB_ORIGIN, 'DATABASE_BINDING_MISMATCH');
  assert(first.serviceKey && first.gatewayKey, 'PROTECTED_BINDING_MISSING');
  assert(bindings.every(b => b.enforced && b.databaseUrl === first.databaseUrl
    && b.serviceKey === first.serviceKey && b.gatewayKey === first.gatewayKey), 'SERVICE_BINDINGS_DIFFER');
  return first;
}

export function checkRows(rows) {
  assert(Array.isArray(rows) && rows.length <= PAID_LABELS.length + 1, 'INVALID_PROBE_ROWS');
  const ids = new Set([...PAID_LABELS,'denied'].map(reservationId));
  assert(rows.every(r => ids.has(r.reservation_id)), 'FOREIGN_RESERVATION');
  assert.equal(new Set(rows.map(r => r.reservation_id)).size, rows.length, 'DUPLICATE_RESERVATION');
  assert(rows.reduce((sum,r) => sum + BigInt(r.reserved_nano), 0n) <= MAX_CAMPAIGN_NANO,
    'CAMPAIGN_BUDGET_EXCEEDED');
}

export function checkRefusal(stats,reason) {
  assert.equal(stats.gatewayAttempts,0,'REFUSED_REQUEST_REACHED_TRANSPORT');
  assert.equal(stats.lastAdmissionReason,reason,'WRONG_REFUSAL_REASON');
  if(reason==='global_capacity_exceeded') {
    // Production intentionally retries temporary shared capacity (PR #1783).
    // These are local admissions, never native-provider 429 responses.
    assert.equal(stats.admissions,3,'CAPACITY_RETRY_COUNT_MISMATCH');
    assert.equal(stats.lastErrorStatusCode,429,'CAPACITY_NOT_RETRYABLE_429');
    assert.equal(stats.admissionResponses.length,3,'CAPACITY_RESPONSE_COUNT_MISMATCH');
    assert(stats.admissionResponses.every(r=>r.httpStatus===429&&r.retryAfter==='2'),'CAPACITY_RETRY_AFTER_MISMATCH');
    for(let i=1;i<3;i++)assert(stats.admissionResponses[i].at-stats.admissionResponses[i-1].at>=1750,'RETRY_AFTER_IGNORED');
  } else {
    assert.equal(stats.httpStatus,402,'REFUSAL_NOT_NONRETRYABLE_402');
    assert.equal(stats.admissions,1,'REFUSED_ADMISSION_WAS_RETRIED');
  }
}
