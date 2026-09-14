// Readiness observation only. This does not mutate the DB, heal the feed,
// certify playback, or authorize an executor to start.
export const PRODUCTION_REELS_URL = 'https://api.ivxholding.com/api/reels?channel=reel';

export async function verifyProductionFeed({ fetchImpl = fetch, signal = AbortSignal.timeout(10_000) } = {}) {
  const invalid = (reason) => ({ isValid: false, reason, data: [] });
  try {
    const response = await fetchImpl(PRODUCTION_REELS_URL, { signal, cache: 'no-store' });
    if (response.status !== 200) {
      await response.body?.cancel();
      return invalid(`FEED_HTTP_${response.status}`);
    }
    const state = response.headers.get('X-IVX-Data-State')?.toLowerCase();
    if (state === 'unavailable' || state === 'stale') {
      await response.body?.cancel();
      return invalid(`FEED_${state.toUpperCase()}`);
    }
    let body;
    try { body = await response.json(); }
    catch { return invalid(signal.aborted ? 'FEED_TIMEOUT' : 'FEED_INVALID_JSON'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return invalid('FEED_INVALID_SCHEMA');
    if (body.degraded || body.data_available === false) return invalid('FEED_DEGRADED');
    if (!Array.isArray(body.videos) || !Number.isSafeInteger(body.count) || body.count !== body.videos.length) {
      return invalid('FEED_INVALID_SCHEMA');
    }
    if (body.videos.length === 0) return invalid('FEED_EMPTY');
    if (body.videos.some(video => !video || typeof video.id !== 'string' || !video.id)) {
      return invalid('FEED_INVALID_SCHEMA');
    }
    return { isValid: true, data: body.videos };
  } catch {
    return invalid(signal.aborted ? 'FEED_TIMEOUT' : 'FEED_UNREACHABLE');
  }
}
