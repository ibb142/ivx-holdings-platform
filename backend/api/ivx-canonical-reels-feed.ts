import { handleReelsFeed } from './ivx-reels';

const CANONICAL_REELS_MARKER = 'ivx-canonical-reels-bridge-v2-2026-08-28';

function json(payload: Record<string, unknown>, status = 200, cache = 'MISS'): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'X-IVX-Cache': cache,
      'X-IVX-Reels-Marker': CANONICAL_REELS_MARKER,
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

/**
 * Canonical adapter for the IVX-owned Reels registry.
 * Empty registry is a valid response. server.ts owns the fallback to the
 * video-platform reel rail so the public landing never depends on stale
 * registry cache. no-store is intentional: a previously empty response must
 * not hide newly published reels for visitors.
 */
export async function handleCanonicalReelsFeed(request: Request): Promise<Response> {
  try {
    const sourceResponse = await handleReelsFeed(request);
    if (!sourceResponse.ok) {
      return json({
        ok: false,
        marker: CANONICAL_REELS_MARKER,
        feed_type: 'reel',
        videos: [],
        count: 0,
        total: 0,
        next_cursor: null,
        source: 'ivx-owned-reels-registry',
        fallback_required: true,
      }, sourceResponse.status);
    }

    const source = asRecord(await sourceResponse.json().catch(() => ({})));
    const reels = Array.isArray(source.reels) ? source.reels : [];
    const origin = new URL(request.url).origin;
    const videos = reels.map((item) => {
      const reel = asRecord(item);
      const rawMedia = typeof reel.mediaUrl === 'string' ? reel.mediaUrl : '';
      const mediaUrl = rawMedia.startsWith('http')
        ? rawMedia
        : rawMedia.startsWith('/')
          ? `${origin}${rawMedia}`
          : '';
      return {
        id: String(reel.id ?? ''),
        title: typeof reel.caption === 'string' && reel.caption.trim() ? reel.caption.trim().slice(0, 120) : 'IVX Reel',
        caption: typeof reel.caption === 'string' ? reel.caption : '',
        video_type: 'reel',
        status: 'published',
        created_at: reel.createdAt ?? null,
        published_at: reel.publishedAt ?? null,
        view_count: Number(reel.views ?? 0) || 0,
        like_count: Number(reel.likes ?? 0) || 0,
        video_url: mediaUrl || null,
        media_url: mediaUrl || null,
        playback_url: mediaUrl || null,
        hls_url: null,
        mime_type: reel.mimeType ?? null,
      };
    }).filter((video) => video.id && video.video_url);

    return json({
      ok: true,
      marker: CANONICAL_REELS_MARKER,
      source_marker: String(source.marker || ''),
      feed_type: 'reel',
      videos,
      count: videos.length,
      total: videos.length,
      next_cursor: null,
      ordering: 'published_at-desc',
      personalized: false,
      source: 'ivx-owned-reels-registry',
      fallback_required: videos.length === 0,
    });
  } catch {
    return json({
      ok: false,
      marker: CANONICAL_REELS_MARKER,
      feed_type: 'reel',
      videos: [],
      count: 0,
      total: 0,
      next_cursor: null,
      source: 'ivx-owned-reels-registry',
      fallback_required: true,
    }, 503);
  }
}
