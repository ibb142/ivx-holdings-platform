import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { readBudgetJson, validateUncertainReceipt } from './phase3-budget-reconciliation.mjs';

const DATABASE = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const GATEWAY = 'https://ai-gateway.vercel.sh';
const COHORT_HASH = '345485c745b622d796f5de62a734999df2c1ab27b0acf1da2ac31f3960ea2bad';
const DOCUMENT_PREFIX = 'finance/provider-receipts/2026-09-13/';

/** Owner-authorized collection of the 33 observed reservations. Writes only
 * validated receipt documents; no reservation, budget, concurrency or AI calls.
 * Credentials stay in the authorized runner; reports contain no prompt data.
 */
export async function collectUncertainReceipts({ serviceKey, gatewayKey, sourceSha },
  { fetcher = fetch, now = Date.now, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), expectedHash = COHORT_HASH, expectedCount = 33 } = {}) {
  if (!serviceKey || !gatewayKey?.startsWith('vck_') || !/^[a-f0-9]{40}$/.test(sourceSha || '')) {
    throw new Error('RECEIPT_CREDENTIAL_BINDING_UNAVAILABLE');
  }
  const headers = { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey };
  const deps = { fetcher, now, wait: pause, deadline: now() + 240_000 };
  const url = DATABASE + '/rest/v1/ivx_ai_budget_reservations?select=reservation_id,model,status,reserved_nano,settled_upper_nano,generation_id,created_at,completed_at'
    + '&status=eq.uncertain&day=eq.2026-09-13&created_at=lte.2026-09-13T14:16:00Z&order=reservation_id&limit=34';
  const rows = (await readBudgetJson(url, headers, deps)).value;
  if (!Array.isArray(rows) || rows.length !== expectedCount || createHash('sha256')
    .update(rows.map(row => row.reservation_id).sort().join(',')).digest('hex') !== expectedHash) {
    throw new Error('RECEIPT_COHORT_CHANGED');
  }
  const report = { sourceSha, observedAt: new Date(now()).toISOString(), requested: rows.length,
    uploaded: 0, unavailable: 0, ledgerRowsChanged: 0, modelCallsCreated: 0, records: [] };
  for (const row of rows) {
    let shape;
    try {
      if (!/^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(row.generation_id || '')) throw new Error('INVALID_GENERATION_ID');
      const payload = (await readBudgetJson(GATEWAY + '/v1/generation?id=' + encodeURIComponent(row.generation_id),
        { Authorization: 'Bearer ' + gatewayKey }, deps, true)).value;
      // Field types only: useful for a provider contract mismatch without
      // logging identities, amounts, timestamps, prompts or arbitrary fields.
      shape = Object.fromEntries(['id','model','created_at','total_cost','is_byok','finish_reason','cancelled',
        'tokens_prompt','tokens_completion','latency','generation_time'].map(key => [key,
        payload?.data?.[key] === null ? 'null' : typeof payload?.data?.[key]]));
      const receipt = validateUncertainReceipt(row, payload, new Date(now()).toISOString());
      const value = { ...receipt, sourceSha, source: 'https://ai-gateway.vercel.sh/v1/generation',
        providerReceiptSha256: createHash('sha256').update(JSON.stringify(receipt)).digest('hex') };
      // Include the digest so repeated observations append evidence instead of
      // overwriting an earlier receipt. The document contains numeric fields only.
      const docKey = DOCUMENT_PREFIX + receipt.reservationId + '/' + value.providerReceiptSha256 + '.json';
      const response = await fetcher(DATABASE + '/rest/v1/ivx_durable_documents?on_conflict=doc_key', {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify({ doc_key: docKey, value, updated_at: new Date(now()).toISOString() }),
      });
      await response.body?.cancel();
      if (!response.ok) throw new Error('RECEIPT_UPLOAD_HTTP_' + response.status);
      report.uploaded++;
      report.records.push({ reservationId: row.reservation_id, state: 'UPLOADED', docKey });
    } catch (error) {
      report.unavailable++;
      const code = error?.code ?? error?.message;
      report.records.push({ reservationId: row.reservation_id, state: 'UNAVAILABLE',
        reason: typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,80}$/.test(code) ? code : 'RECEIPT_OBSERVATION_FAILED', shape });
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await collectUncertainReceipts({ serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      gatewayKey: process.env.IVX_AI_GATEWAY_KEY || process.env.AI_GATEWAY_API_KEY, sourceSha: process.env.GITHUB_SHA });
    // Reservation IDs and receipt documents stay in the private database.
    console.log(JSON.stringify({ requested: report.requested, uploaded: report.uploaded, unavailable: report.unavailable,
      ledgerRowsChanged: 0, modelCallsCreated: 0, reasons: [...new Set(report.records.filter(r => r.reason).map(r => r.reason))],
      schemas: [...new Set(report.records.filter(r => r.shape).map(r => JSON.stringify(r.shape)))].map(s => JSON.parse(s)) }));
    if (report.unavailable) process.exitCode = 1;
  } catch (error) {
    const message = String(error?.code ?? error?.message ?? 'RECEIPT_COLLECTION_FAILED');
    console.error(/^[A-Z][A-Z0-9_]{1,80}$/.test(message) ? message : 'RECEIPT_COLLECTION_FAILED');
    process.exitCode = 1;
  }
}
