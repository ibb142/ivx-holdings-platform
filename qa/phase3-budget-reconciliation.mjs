import { createHash } from 'node:crypto';

const GATEWAY_ORIGIN = 'https://ai-gateway.vercel.sh';
const DATABASE_ORIGIN = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const ID = /^gen_[0-9A-HJKMNP-TV-Z]{26}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const MODEL = /^[a-z0-9][a-z0-9._/-]{0,199}$/i;
const MAX_RECEIPTS = 112;
const MAX_BODY_BYTES = 512_000;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

class ObservationError extends Error {
  constructor(code, status = null, receiptEvidence = null) {
    super(code); this.code = code; this.status = status; this.receiptEvidence = receiptEvidence;
  }
}
function requireValue(ok, code) { if (!ok) throw new ObservationError(code); }

/** Convert the provider's decimal representation without float multiplication. */
export function receiptUsdToNano(value) {
  requireValue(typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)), 'INVALID_PROVIDER_COST');
  const text = String(value);
  requireValue(text.length <= 60, 'INVALID_PROVIDER_COST');
  const match = text.match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/);
  requireValue(match, 'INVALID_PROVIDER_COST');
  const digits = BigInt(match[1] + (match[2] || ''));
  const scale = 9 + Number(match[3] || 0) - (match[2]?.length || 0);
  requireValue(Math.abs(scale) <= 60, 'INVALID_PROVIDER_COST');
  const nano = scale >= 0 ? digits * 10n ** BigInt(scale)
    : (digits + 10n ** BigInt(-scale) - 1n) / 10n ** BigInt(-scale);
  requireValue(nano <= 1_000_000_000_000_000n, 'INVALID_PROVIDER_COST');
  return nano;
}
function integerNano(value) {
  requireValue((typeof value === 'string' && /^\d{1,16}$/.test(value))
    || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0), 'INVALID_LEDGER_AMOUNT');
  const nano = BigInt(value);
  requireValue(nano <= 1_000_000_000_000_000n, 'INVALID_LEDGER_AMOUNT');
  return nano;
}
function timestamp(value) {
  requireValue(typeof value === 'string' && Number.isFinite(Date.parse(value)), 'INVALID_TIMESTAMP');
  return Date.parse(value);
}
function count(value) { requireValue(Number.isSafeInteger(value) && value >= 0, 'INVALID_PROVIDER_USAGE'); return value; }

async function getJson(url, headers, deps, retry404 = false) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    requireValue(deps.now() < deps.deadline, 'OBSERVATION_DEADLINE');
    let response;
    try {
      response = await deps.fetcher(url, { method: 'GET', redirect: 'error',
        signal: AbortSignal.timeout(Math.max(1, Math.min(5_000, deps.deadline - deps.now()))),
        headers: { Accept: 'application/json', ...headers } });
    } catch { throw new ObservationError('READ_TRANSPORT_UNAVAILABLE'); }
    if (retry404 && response.status === 404 && attempt < 3) {
      await response.body?.cancel();
      requireValue(deps.now() + 2_000 < deps.deadline, 'OBSERVATION_DEADLINE');
      await deps.wait(2_000);
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new ObservationError('READ_HTTP_' + response.status, response.status);
    }
    // Never parse or export arbitrary upstream error bodies. Bound successful
    // bodies while reading, including responses without Content-Length.
    const reader = response.body?.getReader();
    requireValue(reader, 'EMPTY_READ_BODY');
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BODY_BYTES) { await reader.cancel(); throw new ObservationError('OVERSIZED_READ_BODY'); }
        chunks.push(part.value);
      }
    } catch (error) {
      if (error instanceof ObservationError) throw error;
      throw new ObservationError('READ_BODY_UNAVAILABLE');
    } finally { reader.releaseLock(); }
    try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), attempts: attempt }; }
    catch { throw new ObservationError('INVALID_READ_JSON'); }
  }
  throw new ObservationError('RECEIPT_NOT_OBSERVED');
}

/** Return only numeric/identity receipt fields, never prompts or raw metadata. */
export function reconcileReceipt(row, payload, observedAt) {
  requireValue(UUID.test(row.reservation_id || ''), 'INVALID_RESERVATION_ID');
  requireValue(row.status === 'settled', 'RESERVATION_NOT_SETTLED');
  requireValue(ID.test(row.generation_id || '') && MODEL.test(row.model || ''), 'MISSING_RECEIPT_IDENTITY');
  const upper = integerNano(row.settled_upper_nano), reserved = integerNano(row.reserved_nano);
  requireValue(upper <= reserved && reserved > 0n, 'LEDGER_BOUND_BREACHED');
  const receipt = payload?.data;
  requireValue(receipt && receipt.id === row.generation_id, 'RECEIPT_ID_MISMATCH');
  requireValue(receipt.model === row.model, 'RECEIPT_MODEL_MISMATCH');
  // Gateway debits exclude a BYOK invoice. Never certify that unknown bill.
  requireValue(receipt.is_byok === false, 'BYOK_INVOICE_UNOBSERVED');
  const started = timestamp(row.created_at), completed = timestamp(row.completed_at);
  const providerAt = timestamp(receipt.created_at);
  requireValue(completed >= started && completed <= timestamp(observedAt)
    && providerAt >= started - 5_000 && providerAt <= completed + 5_000, 'RECEIPT_TIME_MISMATCH');
  const total = receiptUsdToNano(receipt.total_cost);
  for (const alias of ['gateway_cost', 'usage']) {
    if (receipt[alias] !== undefined) requireValue(receiptUsdToNano(receipt[alias]) === total, 'PROVIDER_COST_CONFLICT');
  }
  const result = { reservationId: row.reservation_id, generationId: receipt.id, model: row.model,
    state: 'RECONCILED', providerCostNano: total.toString(), settledUpperNano: upper.toString(),
    reservedNano: reserved.toString(), providerCreatedAt: receipt.created_at,
    ledgerCompletedAt: row.completed_at, observedAt,
    promptTokens: count(receipt.tokens_prompt), completionTokens: count(receipt.tokens_completion) };
  for (const key of ['latency', 'generation_time']) {
    requireValue(typeof receipt[key] === 'number' && Number.isFinite(receipt[key]) && receipt[key] >= 0, 'INVALID_PROVIDER_LATENCY');
    result[key === 'latency' ? 'firstTokenMs' : 'generationMs'] = receipt[key];
  }
  // Preserve validated billing evidence when the bound fails. Throwing before
  // constructing this allowlist hid the actual amount needed to repair an
  // undercount. This is still a failed reconciliation, never a zero charge.
  if (total > upper) throw new ObservationError('PROVIDER_COST_EXCEEDS_LEDGER', null, {
    ...result, state: 'UNRECONCILED', undercountNano: (total - upper).toString(),
  });
  return result;
}

/**
 * Read one bounded cohort from the current UTC reservation day, then re-read
 * that same cutoff. The report is sample evidence, never an account invoice,
 * an all-day reconciliation, or permission to release unknown liability.
 * This module has no automatic entrypoint and no mutations or model calls.
 */
export async function observeBudgetReconciliation({ databaseUrl, serviceKey, gatewayKey, sourceSha },
  { fetcher = fetch, now = Date.now, wait: pause = wait } = {}) {
  const result = { sourceSha, observedAt: new Date(now()).toISOString(), state: 'UNOBSERVED',
    cohortScope: 'latest_reservations_created_today_before_fixed_cutoff', maxReceipts: MAX_RECEIPTS,
    records: [], selectionTruncated: false, ledgerStable: false,
    productionRowsChanged: 0, modelCallsCreated: 0, secretsReturned: false,
    fullDayReconciled: false, providerAccountReconciled: false, phase3Closed: false,
    sourceShaMeaning: 'observer_target_not_generation_commit', generationCommitAttributed: false };
  try {
    requireValue(/^[a-f0-9]{40}$/.test(sourceSha || ''), 'INVALID_SOURCE_SHA');
    requireValue(databaseUrl === DATABASE_ORIGIN && typeof serviceKey === 'string' && serviceKey.length > 0,
      'DATABASE_BINDING_UNAVAILABLE');
    requireValue(typeof gatewayKey === 'string' && gatewayKey.startsWith('vck_'), 'GATEWAY_BINDING_UNAVAILABLE');
    const deps = { fetcher, now, wait: pause, deadline: now() + 120_000 };
    // Give newly completed usage a short ingestion window. Older unresolved
    // reservations remain visible through the global status read below.
    const day = new Date(now()).toISOString().slice(0, 10);
    const cutoff = new Date(Math.max(Date.parse(day + 'T00:00:00.000Z'), now() - 60_000)).toISOString();
    result.day = day; result.cutoff = cutoff;
    const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
    const statusUrl = DATABASE_ORIGIN + '/rest/v1/rpc/ivx_ai_budget_status';
    const before = (await getJson(statusUrl, headers, deps)).value;
    requireValue(before?.enabled === true && before.day === day && before.scope === 'all_instrumented_backend_provider_requests',
      'GLOBAL_BUDGET_NOT_OBSERVED');
    integerNano(before.dailyLimitNano);
    requireValue(Number.isSafeInteger(before.policyRevision) && Number.isSafeInteger(before.maxConcurrent), 'INVALID_POLICY');
    count(before.requestsActive); count(before.unknownCharges);
    result.policy = { enabled: before.enabled, revision: before.policyRevision,
      dailyLimitNano: String(before.dailyLimitNano), maxConcurrent: before.maxConcurrent,
      requestsActive: before.requestsActive, unknownCharges: before.unknownCharges,
      unsettledLiabilityNano: integerNano(before.unsettledLiabilityNano).toString() };
    const params = new URLSearchParams({
      select: 'reservation_id,model,status,reserved_nano,settled_upper_nano,generation_id,created_at,completed_at',
      day: 'eq.' + day, created_at: 'lt.' + cutoff,
      order: 'created_at.desc,reservation_id.desc', limit: String(MAX_RECEIPTS + 1),
    });
    const ledgerUrl = DATABASE_ORIGIN + '/rest/v1/ivx_ai_budget_reservations?' + params;
    const ledger = (await getJson(ledgerUrl, headers, deps)).value;
    requireValue(Array.isArray(ledger) && ledger.length <= MAX_RECEIPTS + 1, 'INVALID_LEDGER_READ');
    result.selectionTruncated = ledger.length > MAX_RECEIPTS;
    result.ledgerSha256 = createHash('sha256').update(JSON.stringify(ledger)).digest('hex');
    const rows = ledger.slice(0, MAX_RECEIPTS);
    requireValue(rows.length > 0, 'EMPTY_LEDGER_COHORT');
    const ids = new Set(), generations = new Set();
    for (const row of rows) {
      requireValue(UUID.test(row.reservation_id || '') && !ids.has(row.reservation_id), 'DUPLICATE_OR_INVALID_RESERVATION');
      ids.add(row.reservation_id);
      requireValue(timestamp(row.created_at) < timestamp(cutoff)
        && new Date(timestamp(row.created_at)).toISOString().slice(0, 10) === day, 'LEDGER_COHORT_MISMATCH');
      if (row.generation_id) {
        requireValue(ID.test(row.generation_id) && !generations.has(row.generation_id), 'DUPLICATE_OR_INVALID_GENERATION');
        generations.add(row.generation_id);
      }
    }
    // Sequential, deadline-bounded GETs never bypass provider inference admission.
    for (const row of rows) {
      if (row.status !== 'settled') {
        result.records.push({ reservationId: row.reservation_id, state: 'UNRECONCILED',
          reason: row.status === 'uncertain' ? 'UNKNOWN_CHARGE_RETAINED' : 'RESERVATION_NOT_SETTLED' });
        continue;
      }
      try {
        requireValue(ID.test(row.generation_id || ''), 'MISSING_RECEIPT_IDENTITY');
        const receipt = await getJson(GATEWAY_ORIGIN + '/v1/generation?id=' + encodeURIComponent(row.generation_id),
          { Authorization: 'Bearer ' + gatewayKey }, deps, true);
        result.records.push({ ...reconcileReceipt(row, receipt.value, new Date(now()).toISOString()), lookupAttempts: receipt.attempts });
      } catch (error) {
        result.records.push({ ...(error instanceof ObservationError ? error.receiptEvidence : null),
          reservationId: row.reservation_id, state: 'UNRECONCILED',
          reason: error instanceof ObservationError ? error.code : 'RECEIPT_UNAVAILABLE' });
        if (deps.now() >= deps.deadline || (error instanceof ObservationError && [401,403].includes(error.status))) throw error;
      }
    }
    const afterLedger = (await getJson(ledgerUrl, headers, deps)).value;
    result.ledgerStable = JSON.stringify(afterLedger) === JSON.stringify(ledger);
    requireValue(result.ledgerStable, 'LEDGER_CHANGED_DURING_OBSERVATION');
    const after = (await getJson(statusUrl, headers, deps)).value;
    requireValue(after?.enabled === true && after.policyRevision === before.policyRevision
      && String(after.dailyLimitNano) === String(before.dailyLimitNano)
      && after.maxConcurrent === before.maxConcurrent, 'POLICY_CHANGED_DURING_OBSERVATION');
    result.reconciledRecords = result.records.filter(row => row.state === 'RECONCILED').length;
    result.unreconciledRecords = result.records.length - result.reconciledRecords;
    result.providerCostNano = result.records.filter(row => row.state === 'RECONCILED')
      .reduce((sum, row) => sum + BigInt(row.providerCostNano), 0n).toString();
    result.state = !result.selectionTruncated && result.unreconciledRecords === 0 ? 'COHORT_RECONCILED' : 'INCOMPLETE';
  } catch (error) {
    result.state = 'INCOMPLETE';
    result.reason = error instanceof ObservationError ? error.code : 'OBSERVATION_UNAVAILABLE';
  }
  result.observedAt = new Date(now()).toISOString();
  return result;
}
