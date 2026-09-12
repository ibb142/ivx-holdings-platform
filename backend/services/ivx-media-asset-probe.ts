export type MediaAssetProbe = {
  status: number;
  bytes: number;
  contentType: string;
  ms: number;
  error: string | null;
};

const MEDIA_ASSET_BUDGET_MS = 2000;
const GET_FALLBACK_STATUSES = new Set([403, 405, 501]);

function mediaType(value: string): string {
  return value.split(';', 1)[0].trim().toLowerCase();
}

/** MIME evidence only. A successful header probe does not certify playback. */
export function matchesMediaMime(value: string, kind: 'video' | 'image'): boolean {
  const type = mediaType(value);
  // Match the complete media type, not a prefix such as video/ or a fake
  // application/vnd.apple.mpegurl.invalid subtype. Keep HLS/DASH support.
  if (kind === 'image') return /^image\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type);
  return /^video\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(type)
    || ['application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/dash+xml'].includes(type);
}

/**
 * Probe media headers with one total HEAD + optional GET budget, outside DB
 * queries and feed response handlers. Do not download a video when an origin
 * ignores Range. Weight measurement has its own binary-byte budget/check.
 */
export async function probeMediaAsset(fetchImpl: typeof fetch, url: string): Promise<MediaAssetProbe> {
  const started = performance.now();
  const controller = new AbortController();
  const timeout = new DOMException('MEDIA_ASSET_TIMEOUT_EXCEEDED', 'TimeoutError');
  const timer = setTimeout(() => controller.abort(timeout), MEDIA_ASSET_BUDGET_MS);
  const elapsed = () => Math.round(performance.now() - started);
  const checkDeadline = () => {
    if (performance.now() - started >= MEDIA_ASSET_BUDGET_MS && !controller.signal.aborted) controller.abort(timeout);
    controller.signal.throwIfAborted();
  };
  const request = async (method: 'HEAD' | 'GET') => {
    checkDeadline();
    const res = await fetchImpl(url, {
      method, redirect: 'follow', signal: controller.signal,
      headers: { 'user-agent': 'ivx-landing-p0-audit/1.0', accept: '*/*', ...(method === 'GET' ? { range: 'bytes=0-0' } : {}) },
    });
    try {
      checkDeadline();
      const lengthHeader = res.headers.get('content-length') ?? '';
      const length = /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : 0;
      return {
        status: res.status,
        // Declared response size, not proof of the complete asset's weight.
        bytes: Number.isSafeInteger(length) && length >= 0 ? length : 0,
        contentType: mediaType(res.headers.get('content-type') ?? ''),
        ms: elapsed(), error: null,
      } satisfies MediaAssetProbe;
    } finally {
      // Start cancellation immediately; do not wait for or read an unbounded
      // response body. The shared controller also aborts any remaining I/O.
      void res.body?.cancel().catch(() => undefined);
    }
  };
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      return { status: 0, bytes: 0, contentType: '', ms: elapsed(), error: 'MEDIA_ASSET_URL_INVALID' };
    }
    let head: MediaAssetProbe | null = null;
    try { head = await request('HEAD'); }
    catch { checkDeadline(); }
    if (head && !GET_FALLBACK_STATUSES.has(head.status)) return head;
    // Some public origins disallow HEAD. At most one fallback may use the
    // remaining deadline; a timed-out HEAD cannot start a fresh GET budget.
    return await request('GET');
  } catch {
    return { status: 0, bytes: 0, contentType: '', ms: elapsed(), error: controller.signal.aborted ? 'MEDIA_ASSET_TIMEOUT_EXCEEDED' : 'MEDIA_ASSET_REQUEST_FAILED' };
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
