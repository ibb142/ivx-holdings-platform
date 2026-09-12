/** Parse the provider's decimal USD representation without float arithmetic. */
export function providerReportedCostNano(value: unknown): string {
  if (typeof value !== 'string' && (typeof value !== 'number' || !Number.isFinite(value))) {
    throw new Error('Invalid provider cost');
  }
  const text = String(value);
  const match = text.length <= 60 && text.match(/^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d{1,2}))?$/);
  if (!match) throw new Error('Invalid provider cost');
  const digits = BigInt(match[1]! + (match[2] || ''));
  const scale = 9 + Number(match[3] || 0) - (match[2]?.length || 0);
  if (Math.abs(scale) > 60) throw new Error('Invalid provider cost');
  const nano = scale >= 0 ? digits * 10n ** BigInt(scale)
    : (digits + 10n ** BigInt(-scale) - 1n) / 10n ** BigInt(-scale);
  if (nano > 1_000_000_000_000_000n) throw new Error('Invalid provider cost');
  return nano.toString();
}

const GATEWAY_ORIGIN = 'https://ai-gateway.vercel.sh';
const GENERATION_ID = /^gen_[0-9A-HJKMNP-TV-Z]{26}$/;

/** A missing charge stays unknown. This only reads a receipt with the original
 * gateway credential; it can never initiate or retry inference. */
export async function readGatewayReceiptCost({ request, generationId, model, startedAt, completedAt }: {
  request: Request; generationId: string | undefined; model: string; startedAt: number; completedAt: number;
}, { fetcher, pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms)) }: {
  fetcher: typeof fetch; pause?: (ms: number) => Promise<unknown>;
}): Promise<string | null> {
  if (new URL(request.url).origin !== GATEWAY_ORIGIN || !GENERATION_ID.test(generationId || '')) return null;
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await fetcher(GATEWAY_ORIGIN + '/v1/generation?id=' + encodeURIComponent(generationId!), {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(5_000),
        headers: { Authorization: authorization, Accept: 'application/json' },
      });
      if (response.status === 404 && attempt === 0) {
        await response.body?.cancel(); await pause(2_000); continue;
      }
      if (response.status !== 200) { await response.body?.cancel(); return null; }
      const reader = response.body?.getReader();
      if (!reader) return null;
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > 512_000) { await reader.cancel(); return null; }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const receipt = JSON.parse(Buffer.concat(chunks).toString('utf8'))?.data;
      const createdAt = typeof receipt?.created_at === 'string' ? Date.parse(receipt.created_at) : NaN;
      if (!receipt || receipt.id !== generationId || receipt.model !== model || receipt.is_byok !== false
          || !Number.isFinite(createdAt) || createdAt < startedAt - 5_000 || createdAt > completedAt + 5_000) return null;
      const cost = providerReportedCostNano(receipt.total_cost);
      for (const alias of ['gateway_cost', 'usage']) {
        if (receipt[alias] !== undefined && providerReportedCostNano(receipt[alias]) !== cost) return null;
      }
      return cost;
    }
  } catch { /* Read failures and invalid receipts retain the whole reservation. */ }
  return null;
}
