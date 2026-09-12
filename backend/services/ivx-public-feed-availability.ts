import { createFeedResponseCache } from './ivx-feed-response-cache';

/** Empty render structures are explicitly unavailable, never cacheable evidence
 * of an empty database. Only public GET controllers use this wrapper. */
export const withPublicFeedAvailability = createFeedResponseCache({
  responseTimeoutMs: 2200,
  refreshTimeoutMs: 8000,
  staleWhileRevalidate: true,
  maxActiveReads: 2,
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
