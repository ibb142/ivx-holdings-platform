import { createHash, randomUUID } from 'node:crypto';
import { settleBudgetWithRetry } from './ivx-global-ai-budget-settlement';

export const GLOBAL_AI_BUDGET_MARKER = 'ivx-global-ai-budget-v1';
export function globalAIBudgetEnabled(): boolean { return process.env.IVX_AI_GLOBAL_BUDGET_ENABLED === 'true'; }
export class GlobalAIBudgetError extends Error {
  readonly statusCode = 402;
  readonly code = 'IVX_GLOBAL_AI_BUDGET_BLOCKED';
  constructor(reason: string) { super(`Global AI budget: ${reason}`); this.name = 'GlobalAIBudgetError'; }
}
export type BudgetQuote = { model: string; maxInputTokens: number; maxOutputTokens: number;
  inputNanoPerToken: string; outputNanoPerToken: string; reservedNano: string;
  catalogSha256: string; observedAt: string; validUntil: string };
export type BudgetUsage = { inputTokens: number; outputTokens: number; generationId?: string };
export type BudgetLease = { quote: BudgetQuote; finish(usage: BudgetUsage | null, notStarted?: boolean): Promise<void> };
type Catalog = { data?: unknown[] };
const CATALOG_URL = 'https://ai-gateway.vercel.sh/v1/models';
type CatalogSnapshot = { value: Catalog; hash: string; at: number };
let catalogCache: CatalogSnapshot | null = null;
let catalogPending: Promise<CatalogSnapshot> | null = null;

/** Round prices upwards to nanodollars; never use binary floats for money. */
export function usdToNanoCeil(value: unknown): bigint {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,18})?$/.test(value)) throw new GlobalAIBudgetError('unverified model price');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000_000n + BigInt((fraction + '000000000').slice(0, 9))
    + (/[1-9]/.test(fraction.slice(9)) ? 1n : 0n);
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === 'object' ? value as Record<string, unknown> : {}; }
function maxRates(pricing: unknown): { input: bigint; output: bigint } {
  let input = 0n, output = 0n;
  function visit(value: unknown) {
    for (const [key, item] of Object.entries(record(value))) {
      if (['input','input_cache_read','input_cache_write'].includes(key)) {
        const price = usdToNanoCeil(item); if (price > input) input = price;
      } else if (key === 'output') {
        const price = usdToNanoCeil(item); if (price > output) output = price;
      } else if (item && typeof item === 'object') visit(item);
    }
  }
  visit(pricing);
  if (input <= 0n || output <= 0n) throw new GlobalAIBudgetError('missing nonzero tariff bounds');
  return { input, output };
}
export function quoteCatalogModel(catalog: Catalog, model: string, at: number, hash: string): BudgetQuote {
  const row = catalog.data?.map(record).find(row => row.id === model);
  const modalities = record(row?.modalities);
  if (!row || row.type !== 'language' || !Array.isArray(modalities.output)
      || modalities.output.some(value => value !== 'text')) throw new GlobalAIBudgetError('unpriced provider operation');
  const context = Number(row.context_window), output = Number(row.max_tokens);
  if (!Number.isSafeInteger(context) || context < 1 || context > 10_000_000
      || !Number.isSafeInteger(output) || output < 1 || output > 1_000_000) throw new GlobalAIBudgetError('missing model token bounds');
  const prices = maxRates(row.pricing);
  // Reserve a full input context plus the published maximum output. This is a
  // conservative liability, not chars/4 and not reported as an invoice cost.
  const reserved = BigInt(context) * prices.input + BigInt(output) * prices.output;
  if (reserved <= 0n || reserved > 1_000_000_000_000_000n) throw new GlobalAIBudgetError('invalid quote envelope');
  return { model, maxInputTokens: context, maxOutputTokens: output,
    inputNanoPerToken: prices.input.toString(), outputNanoPerToken: prices.output.toString(), reservedNano: reserved.toString(),
    catalogSha256: hash, observedAt: new Date(at).toISOString(), validUntil: new Date(at + 300_000).toISOString() };
}
async function catalog(fetcher: typeof fetch): Promise<CatalogSnapshot> {
  if (catalogCache && Date.now() - catalogCache.at >= 0 && Date.now() - catalogCache.at < 240_000) return catalogCache;
  if (!catalogPending) catalogPending = (async () => {
    const response = await fetcher(CATALOG_URL, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new GlobalAIBudgetError('pricing catalog unavailable');
    const text = await response.text();
    if (text.length > 5_000_000) throw new GlobalAIBudgetError('pricing catalog oversized');
    const value = JSON.parse(text) as Catalog;
    if (!Array.isArray(value.data)) throw new GlobalAIBudgetError('pricing catalog invalid');
    const result = { value, hash: createHash('sha256').update(text).digest('hex'), at: Date.now() };
    catalogCache = result; return result;
  })();
  try { return await catalogPending; } finally { catalogPending = null; }
}
export function usageCostUpperNano(quote: BudgetQuote, usage: BudgetUsage): string {
  if (![usage.inputTokens, usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0)) throw new GlobalAIBudgetError('unverified token usage');
  // A provider exceeding its published envelope is persisted by the DB and
  // disables admission, instead of quietly pretending the budget held.
  return (BigInt(usage.inputTokens) * BigInt(quote.inputNanoPerToken)
    + BigInt(usage.outputTokens) * BigInt(quote.outputNanoPerToken)).toString();
}
export async function reserveGlobalAIBudget(model: string, requestSha: string, fetcher: typeof fetch): Promise<BudgetLease> {
  const { autonomousWorkerInstanceId, globalAIBudgetRpc } = await import('./ivx-postgres-autonomous-task-store');
  let quote: BudgetQuote;
  const id = randomUUID(), worker = autonomousWorkerInstanceId();
  try {
    const current = await catalog(fetcher);
    quote = quoteCatalogModel(current.value, model, current.at, current.hash);
    const result = await globalAIBudgetRpc<{ allowed: boolean; reason?: string; reservationId?: string }>('ivx_ai_budget_reserve', {
      p_reservation_id: id, p_worker_instance_id: worker, p_model: model, p_request_sha: requestSha,
      p_reserved_nano: quote.reservedNano, p_pricing_evidence: quote,
    });
    if (result?.allowed !== true || result.reservationId !== id) throw new GlobalAIBudgetError(result?.reason ?? 'admission unconfirmed');
  } catch (error) {
    if (error instanceof GlobalAIBudgetError) throw error;
    throw new GlobalAIBudgetError('durable admission unavailable');
  }
  let finishPending: Promise<void> | null = null;
  return { quote, finish(usage, notStarted = false) {
    if (finishPending) return finishPending;
    finishPending = (async () => {
    let amount: string | null = null;
    if (notStarted) amount = '0';
    else if (usage) { try { amount = usageCostUpperNano(quote, usage); } catch { usage = null; } }
    await settleBudgetWithRetry(
      params => globalAIBudgetRpc<{ ok: boolean; pricingBoundBreached?: boolean }>('ivx_ai_budget_finish', params),
      {
        p_reservation_id: id, p_worker_instance_id: worker, p_status: notStarted ? 'cancelled' : usage ? 'settled' : 'uncertain',
        p_settled_upper_nano: amount, p_generation_id: usage?.generationId ?? null,
      },
      {
        onRetry(settlement, attempts, delayMs) {
          console.warn('[IVX Global Budget] settlement pending retry', {
            reservationId: id, workerInstanceId: worker, attempts, delayMs,
            status: settlement.p_status, settledUpperNano: settlement.p_settled_upper_nano,
            generationId: settlement.p_generation_id,
          });
        },
        onConfirmed(result, attempts) {
          if (result.pricingBoundBreached) console.error('[IVX Global Budget] settlement requires review', { reservationId: id });
          else if (attempts > 1) console.info('[IVX Global Budget] settlement recovered', { reservationId: id, attempts });
        },
        onUnconfirmed(settlement, attempts) {
          // Keep the entire liability reserved. Persist only receipt metadata in
          // operational logs so a stopped-process review can reconcile it.
          console.error('[IVX Global Budget] reservation retained; settlement unconfirmed', {
            reservationId: id, workerInstanceId: worker, attempts,
            status: settlement.p_status, settledUpperNano: settlement.p_settled_upper_nano,
            generationId: settlement.p_generation_id,
          });
        },
      },
    );
    })();
    return finishPending;
  }};
}
export async function readGlobalAIBudgetStatus(): Promise<Record<string, unknown>> {
  if (!globalAIBudgetEnabled()) return { marker: GLOBAL_AI_BUDGET_MARKER, enforcedInThisProcess: false, state: 'NOT_ACTIVATED' };
  try {
    const { globalAIBudgetRpc } = await import('./ivx-postgres-autonomous-task-store');
    const status = await globalAIBudgetRpc<Record<string, unknown>>('ivx_ai_budget_status', {});
    if (typeof status?.enabled !== 'boolean') throw new Error('Budget policy missing');
    return { ...status, marker: GLOBAL_AI_BUDGET_MARKER, enforcedInThisProcess: true };
  }
  catch { return { marker: GLOBAL_AI_BUDGET_MARKER, enforcedInThisProcess: true, state: 'UNKNOWN', admission: 'BLOCKED' }; }
}
