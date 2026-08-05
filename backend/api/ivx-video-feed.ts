/**
 * IVX Video Feed API — Instagram-style video experience.
 *
 * Routes (registered in hono.ts):
 *   GET /api/ivx/videos/feed                 — approved videos + engagement counts
 *   GET /api/ivx/videos/:videoId/download    — high-quality progressive MP4 download
 *                                              (Instagram technique: direct source-quality
 *                                              file streamed with attachment disposition
 *                                              and Range support for resumable downloads)
 *
 * Per-video likes/comments/shares reuse the existing project_* engagement tables,
 * keyed by the video's UUID (project_id column has no FK), so no new schema is needed.
 */

const DEPLOYMENT_MARKER = 'ivx-video-feed-api-v1-2026-07-03';

// ── Supabase (service role first, anon fallback) ───────────────────────────
let _sb: any = null;
async function getSB() {
  if (_sb) return _sb;
  const { createClient } = await import('@supabase/supabase-js');
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Range',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

export const videoFeedOptions = (): Response =>
  new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Range',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Expose-Headers': 'Content-Disposition, Content-Length, Accept-Ranges, Content-Range',
    },
  });

interface FeedVideo {
  id: string;
  project_id: string | null;
  video_url: string;
  /** Adaptive HLS master playlist (from the video pipeline) — preferred playback source. */
  hls_url: string | null;
  poster_url: string | null;
  preview_blur_url: string | null;
  playback_status: string | null;
  thumbnail_url: string | null;
  cover_url: string | null;
  title: string | null;
  duration_sec: number;
  width: number | null;
  height: number | null;
  orientation: string;
  is_pinned: boolean;
  created_at: string;
  like_count: number;
  comment_count: number;
  share_count: number;
  save_count: number;
}

type PlaybackIndexLike = Record<string, { status: string; hls_url: string | null; poster_url: string | null; thumbnail_url: string | null; preview_blur_url?: string | null }>;

async function loadPlaybackIndex(): Promise<PlaybackIndexLike> {
  try {
    const { getPlaybackIndex } = await import('../services/ivx-video-pipeline');
    return (await getPlaybackIndex()) as PlaybackIndexLike;
  } catch {
    return {};
  }
}

/** GET /api/ivx/videos/feed — approved videos, newest/pinned first, with counts. */
export async function handleVideoFeed(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') || '24'), 50);
    const sb = await getSB();

    let videos: any[] = [];
    const { data: vids, error } = await sb
      .from('project_videos')
      .select('id,project_id,media_id,title,video_url,thumbnail_url,cover_url,duration_sec,width,height,orientation,is_pinned,is_approved,view_count,created_at')
      .eq('is_approved', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(limit);
    if (!error && vids) videos = vids;

    // Fallback: videos stored in project_media only
    if (videos.length === 0) {
      const { data: media } = await sb
        .from('project_media')
        .select('id,project_id,media_type,url,media_url,thumbnail_url,cover_image_url,title,description,duration_sec,width,height,position,is_approved,created_at')
        .eq('media_type', 'video')
        .eq('is_approved', true)
        .order('created_at', { ascending: false })
        .limit(limit);
      videos = (media || []).map((m: any) => ({
        id: m.id,
        project_id: m.project_id ?? null,
        video_url: m.url || m.media_url,
        thumbnail_url: m.thumbnail_url ?? null,
        cover_url: m.cover_image_url ?? null,
        title: m.title ?? null,
        duration_sec: m.duration_sec ?? 0,
        width: m.width ?? null,
        height: m.height ?? null,
        orientation: 'landscape',
        is_pinned: false,
        created_at: m.created_at,
      }));
    }

    const ids = videos.map((v: any) => String(v.id));
    const counts: Record<string, { likes: number; comments: number; shares: number; saves: number }> = {};
    for (const id of ids) counts[id] = { likes: 0, comments: 0, shares: 0, saves: 0 };

    if (ids.length > 0) {
      const [likesRes, commentsRes, sharesRes, savesRes] = await Promise.all([
        sb.from('project_likes').select('project_id').in('project_id', ids),
        sb.from('project_comments').select('project_id').in('project_id', ids).eq('is_approved', true).is('deleted_at', null),
        sb.from('project_shares').select('project_id').in('project_id', ids),
        sb.from('project_saves').select('project_id').in('project_id', ids),
      ]);
      for (const row of likesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].likes += 1; }
      for (const row of commentsRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].comments += 1; }
      for (const row of sharesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].shares += 1; }
      for (const row of savesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].saves += 1; }
    }

    const playback = await loadPlaybackIndex();

    const feed: FeedVideo[] = videos.map((v: any) => ({
      id: String(v.id),
      project_id: v.project_id ? String(v.project_id) : null,
      video_url: v.video_url,
      hls_url: playback[String(v.id)]?.status === 'ready' ? playback[String(v.id)]?.hls_url ?? null : null,
      poster_url: playback[String(v.id)]?.poster_url ?? null,
      preview_blur_url: playback[String(v.id)]?.preview_blur_url ?? null,
      playback_status: playback[String(v.id)]?.status ?? null,
      thumbnail_url: v.thumbnail_url ?? playback[String(v.id)]?.thumbnail_url ?? null,
      cover_url: v.cover_url ?? null,
      title: v.title ?? null,
      duration_sec: v.duration_sec ?? 0,
      width: v.width ?? null,
      height: v.height ?? null,
      orientation: v.orientation ?? 'landscape',
      is_pinned: v.is_pinned === true,
      created_at: v.created_at,
      like_count: counts[String(v.id)]?.likes ?? 0,
      comment_count: counts[String(v.id)]?.comments ?? 0,
      share_count: counts[String(v.id)]?.shares ?? 0,
      save_count: counts[String(v.id)]?.saves ?? 0,
    }));

    return json({ videos: feed, count: feed.length, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err: unknown) {
    return json({ error: (err instanceof Error ? err.message : String(err)) || 'feed failed', deploymentMarker: DEPLOYMENT_MARKER }, 500);
  }
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 80) || 'ivx-video';
}

/**
 * GET /api/ivx/videos/:videoId/download
 * Streams the original source-quality file (the same technique Instagram uses for
 * saved reels: the highest-quality progressive MP4 is served directly, no
 * re-encode) with `Content-Disposition: attachment` and Range passthrough so
 * downloads are resumable on mobile networks.
 */
export async function handleVideoDownload(req: Request, videoId: string): Promise<Response> {
  try {
    if (!videoId) return json({ error: 'videoId required', deploymentMarker: DEPLOYMENT_MARKER }, 400);
    const sb = await getSB();

    let videoUrl = '';
    let title = 'ivx-video';

    const { data: vid } = await sb.from('project_videos').select('video_url,title').eq('id', videoId).maybeSingle();
    if (vid?.video_url) { videoUrl = vid.video_url; title = vid.title || title; }

    if (!videoUrl) {
      const { data: media } = await sb.from('project_media').select('url,media_url,title').eq('id', videoId).maybeSingle();
      if (media) { videoUrl = media.url || media.media_url || ''; title = media.title || title; }
    }

    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
      return json({ error: 'Video not found', deploymentMarker: DEPLOYMENT_MARKER }, 404);
    }

    // Track the download as a share event — non-blocking (share_type is CHECK-constrained)
    void Promise.resolve(
      sb.from('project_shares').insert({ project_id: videoId, guest_id: 'download-tracker', share_type: 'other', share_url: 'download' }),
    ).catch(() => {});

    const upstreamHeaders: Record<string, string> = {};
    const range = req.headers.get('range');
    if (range) upstreamHeaders['Range'] = range;

    const upstream = await fetch(videoUrl, { headers: upstreamHeaders });
    if (!upstream.ok && upstream.status !== 206) {
      return json({ error: `Source responded ${upstream.status}`, deploymentMarker: DEPLOYMENT_MARKER }, 502);
    }

    const headers = new Headers();
    headers.set('Content-Type', upstream.headers.get('content-type') || 'video/mp4');
    const len = upstream.headers.get('content-length');
    if (len) headers.set('Content-Length', len);
    const contentRange = upstream.headers.get('content-range');
    if (contentRange) headers.set('Content-Range', contentRange);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Content-Disposition', `attachment; filename="${sanitizeFilename(title)}.mp4"`);
    headers.set('Access-Control-Allow-Origin', 'https://ivxholding.com');
    headers.set('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Accept-Ranges, Content-Range');
    headers.set('Cache-Control', 'public, max-age=3600');

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err: unknown) {
    return json({ error: (err instanceof Error ? err.message : String(err)) || 'download failed', deploymentMarker: DEPLOYMENT_MARKER }, 500);
  }
}
