import { createHash } from 'node:crypto';
import { receiptUsdToNano } from '../../qa/phase3-budget-reconciliation.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const GENERATION = /^gen_[0-9A-HJKMNP-TV-Z]{26}$/;
const GATEWAY = 'https://ai-gateway.vercel.sh';
function requireValue(ok, code) { if (!ok) throw new Error(code); }
function timestamp(value) {
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  requireValue(Number.isFinite(parsed), 'INVALID_RECEIPT_TIMESTAMP');
  return parsed;
}

/** This verifier only accepts an ID already linked to the reservation. */
export function verifyUncertainReceipt(row, payload, observedAt, receiptSha256) {
  const receipt = payload?.data;
  requireValue(row.status === 'uncertain' && row.settled_upper_nano === null, 'NOT_UNCERTAIN');
  requireValue(UUID.test(row.reservation_id ?? ''), 'INVALID_RESERVATION_ID');
  requireValue(GENERATION.test(row.generation_id ?? ''), 'MISSING_PROVIDER_ID');
  requireValue(/^[a-f0-9]{64}$/.test(row.request_sha ?? '')
    && typeof row.worker_instance_id === 'string' && row.worker_instance_id.length > 0, 'INVALID_RESERVATION_IDENTITY');
  requireValue(receipt?.id === row.generation_id, 'RECEIPT_ID_MISMATCH');
  requireValue(receipt.model === row.model, 'RECEIPT_MODEL_MISMATCH');
  requireValue(receipt.is_byok === false, 'BYOK_INVOICE_UNOBSERVED');
  const start = timestamp(row.created_at), end = timestamp(row.completed_at);
  const providerAt = timestamp(receipt.created_at), observed = timestamp(observedAt);
  requireValue(end >= start && end <= observed && providerAt <= observed
    && providerAt >= start - 5000 && providerAt <= end + 5000, 'RECEIPT_TIME_MISMATCH');
  const cost = receiptUsdToNano(receipt.total_cost);
  for (const field of ['gateway_cost', 'usage']) {
    if (receipt[field] !== undefined) requireValue(receiptUsdToNano(receipt[field]) === cost, 'PROVIDER_COST_CONFLICT');
  }
  requireValue(/^[a-f0-9]{64}$/.test(receiptSha256), 'INVALID_RECEIPT_DIGEST');
  return { reservation_id: row.reservation_id, worker_instance_id: row.worker_instance_id,
    request_sha: row.request_sha, generation_id: row.generation_id, model: row.model,
    provider_cost_nano: cost.toString(), provider_created_at: receipt.created_at,
    observed_at: observedAt, receipt_sha256: receiptSha256 };
}

async function lookupReceipt(generationId, gatewayKey, fetcher, timeoutMs) {
  const response = await fetcher(GATEWAY + '/v1/generation?id=' + encodeURIComponent(generationId), {
    method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs),
    headers: { Authorization: 'Bearer ' + gatewayKey, Accept: 'application/json' },
  });
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error('RECEIPT_HTTP_' + response.status);
  }
  const reader = response.body?.getReader();
  requireValue(reader, 'EMPTY_RECEIPT');
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > 512_000) { await reader.cancel(); throw new Error('OVERSIZED_RECEIPT'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch { throw new Error('INVALID_RECEIPT_JSON'); }
  return { payload, digest: createHash('sha256').update(bytes).digest('hex') };
}

/** Authenticated provider reads happen before any accounting locks are held. */
export async function prepareUncertainReceipts(rows, { gatewayKey, fetcher = fetch, now = Date.now }) {
  requireValue(Array.isArray(rows) && rows.length > 0 && rows.length <= 112, 'INVALID_BATCH');
  requireValue(typeof gatewayKey === 'string' && gatewayKey.startsWith('vck_'), 'GATEWAY_BINDING_UNAVAILABLE');
  requireValue(new Set(rows.map(r => r.reservation_id)).size === rows.length, 'DUPLICATE_RESERVATION');
  const ids = rows.map(r => r.generation_id).filter(id => GENERATION.test(id ?? ''));
  requireValue(new Set(ids).size === ids.length, 'DUPLICATE_GENERATION');
  const receipts = [], blocked = [], deadline = now() + 120_000;
  for (const row of rows) {
    try {
      requireValue(row.status === 'uncertain', 'NOT_UNCERTAIN');
      requireValue(GENERATION.test(row.generation_id ?? ''), 'MISSING_PROVIDER_ID');
      requireValue(now() < deadline, 'RECEIPT_DEADLINE');
      const { payload, digest } = await lookupReceipt(row.generation_id, gatewayKey, fetcher,
        Math.max(1, Math.min(5000, deadline - now())));
      receipts.push(verifyUncertainReceipt(row, payload, new Date(now()).toISOString(), digest));
    } catch (error) {
      // Never expose an upstream response body, URL, key, prompt or metadata.
      const reason = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
        ? error.message : 'RECEIPT_UNAVAILABLE';
      blocked.push({ reservationId: row.reservation_id, reason });
    }
  }
  return { receipts, blocked };
}

export async function reconcileUncertainBudget({ client, reservationIds, gatewayKey, apply = false }, deps = {}) {
  requireValue(Array.isArray(reservationIds) && reservationIds.length > 0 && reservationIds.length <= 112
    && reservationIds.every(id => UUID.test(id)) && new Set(reservationIds).size === reservationIds.length, 'INVALID_RESERVATION_IDS');
  const { rows } = await client.query(`select reservation_id,worker_instance_id,model,request_sha,
    status,reserved_nano,settled_upper_nano,generation_id,
    to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') created_at,
    to_char(completed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') completed_at
    from public.ivx_ai_budget_reservations where reservation_id = any($1::uuid[]) order by reservation_id`, [reservationIds]);
  requireValue(rows.length === reservationIds.length, 'RESERVATIONS_MISSING');
  const prepared = await prepareUncertainReceipts(rows, { gatewayKey, ...deps });
  const report = { state: 'DRY_RUN', preparedCount: prepared.receipts.length, blocked: prepared.blocked,
    providerCostNano: prepared.receipts.reduce((n, r) => n + BigInt(r.provider_cost_nano), 0n).toString(),
    modelCallsCreated: 0, reconciledCount: 0, receiptEvidence: prepared.receipts };
  if (!apply || prepared.receipts.length === 0) {
    if (apply) report.state = 'INCOMPLETE';
    return report;
  }
  let result;
  try {
    await client.query('begin');
    // Must precede the outer SQL statement: setting this inside the function
    // would not bound an already running call to four seconds.
    await client.query("set local statement_timeout = '4s'");
    result = await client.query('select * from public.fn_reconcile_uncertain_budget_batch($1,$2::jsonb)',
      [prepared.receipts.length, JSON.stringify(prepared.receipts)]);
    await client.query('commit');
  } catch {
    await client.query('rollback').catch(() => {});
    return { ...report, state: 'WRITE_UNCONFIRMED', reconciledCount: null };
  }
  // A receipt row and settled reservation are the completion evidence. A zero
  // count alone can mean an idempotent retry or a skipped lock.
  try {
    const confirmation = await client.query(`select c.reservation_id,c.generation_id,c.receipt_sha256,
      c.provider_cost_nano::text from public.ivx_ai_budget_reconciliation_receipts c
      join public.ivx_ai_budget_reservations r using(reservation_id)
      where c.reservation_id = any($1::uuid[]) and r.status = 'settled'
        and r.settled_upper_nano = c.provider_cost_nano and r.generation_id = c.generation_id`,
    [prepared.receipts.map(r => r.reservation_id)]);
    const confirmed = prepared.receipts.filter(p => confirmation.rows.some(c =>
      c.reservation_id === p.reservation_id && c.generation_id === p.generation_id
      && c.receipt_sha256 === p.receipt_sha256 && c.provider_cost_nano === p.provider_cost_nano)).length;
    return { ...report, reconciledCount: result.rows[0].reconciled_count, confirmedCount: confirmed,
      state: confirmed === prepared.receipts.length && prepared.blocked.length === 0 ? 'COHORT_RECONCILED' : 'INCOMPLETE' };
  } catch { return { ...report, state: 'WRITE_UNCONFIRMED', reconciledCount: null }; }
}
