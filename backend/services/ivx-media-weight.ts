export type MediaWeight = {
  status: number; bytes: number; contentType: string; ms: number; error: string | null;
};

/** Count binary bytes, never UTF-8 replacement characters or a partial range's length. */
export async function measureMediaWeight(fetchImpl: typeof fetch, url: string, budget = 1_500_000): Promise<MediaWeight> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  let status = 0;
  let contentType = '';
  const result = (bytes: number, error: string | null = null): MediaWeight => ({ status, bytes, contentType, ms: Date.now() - started, error });
  try {
    const request = (method: string) => fetchImpl(url, {
      method, redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': 'ivx-landing-p0-audit/1.0', ...(method === 'GET' ? { range: `bytes=0-${budget}` } : {}) },
    });
    const head = await request('HEAD').catch(() => null);
    if (head?.status === 200) {
      status = head.status;
      contentType = head.headers.get('content-type') || '';
      const length = Number(head.headers.get('content-length'));
      if (Number.isSafeInteger(length) && length > 0) return result(length);
    }
    const response = await request('GET');
    status = response.status;
    contentType = response.headers.get('content-type') || '';
    if (!response.ok) { await response.body?.cancel(); return result(0); }
    if (status === 206) {
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
      const total = range ? Number(range[3]) : 0;
      await response.body?.cancel();
      return range && Number(range[1]) === 0 && Number(range[2]) < total && Number.isSafeInteger(total)
        ? result(total) : result(0, 'partial response has no valid total size');
    }
    if (!response.body) return result(0, 'empty media body');
    const reader = response.body.getReader();
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) return result(bytes);
        bytes += chunk.value.byteLength;
        // Enough evidence to fail the budget; do not download an unbounded asset.
        if (bytes > budget) { await reader.cancel(); return result(bytes); }
      }
    } finally { reader.releaseLock(); }
  } catch (error) {
    return result(0, error instanceof Error ? error.message : String(error));
  } finally { clearTimeout(timer); }
}
