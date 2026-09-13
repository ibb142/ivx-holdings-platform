import { createFeedResponseCache } from './ivx-feed-response-cache';

function publicFeedCacheKey(req: Request): string {
  const url = new URL(req.url);
  // Both landing-page hosts and both Home routes call the same controller.
  // Host failover must join its pending read/cache/backoff, not consume another
  // producer slot. Keep all other origins and controllers isolated by default.
  // Render terminates TLS before this app's HTTP adapter builds Request.url.
  // Use its actual allowlisted host, never caller-supplied forwarding headers.
  if (!['http:', 'https:'].includes(url.protocol) || url.port
    || !['api.ivxholding.com', 'ivx-holdings-platform.onrender.com'].includes(url.hostname)
    || !['/api/home/feed', '/api/ivx/video-platform/home-feed'].includes(url.pathname)) return req.url;
  url.protocol = 'https:';
  url.hostname = 'api.ivxholding.com';
  url.pathname = '/api/home/feed';
  // Preserve every query value, including unknown filters and the order of
  // repeated values. Only the order of different parameter names is irrelevant.
  url.searchParams.sort();
  return url.href;
}

/** Empty render structures are explicitly unavailable, never cacheable evidence
 * of an empty database. Only public GET controllers use this wrapper. */
export const withPublicFeedAvailability = createFeedResponseCache({
  responseTimeoutMs: 2200,
  refreshTimeoutMs: 8000,
  staleWhileRevalidate: true,
  maxActiveReads: 2,
  cacheKey: publicFeedCacheKey,
  headers: { 'Access-Control-Allow-Origin': 'https://ivxholding.com' },
  fallback: req => {
    const path = new URL(req.url).pathname;
    if (path.endsWith('/home-feed') || path === '/api/home/feed') {
      return { blocks: [], count: 0, deal_count: 0, video_count: 0,
        total_approved_videos: 0, personalized: false,
        pattern: '3-deals-1-featured-project-video', ordering: 'canonical-home-v3' };
    }
    if (/deals$/.test(path)) return { deals: [], count: 0, sourceCount: null };
    return { videos: [], count: 0, total: null, next_cursor: null, personalized: false };
  },
});
