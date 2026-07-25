/**
 * IVX Video Feed client — same backend the landing page and iOS app use.
 *
 *   GET /api/ivx/video-platform/feed         — ranked feed + deal enrichment
 *                                              (property title, price, ROI, deal link)
 *   GET /api/ivx/videos/:videoId/download    — source-quality progressive MP4
 *                                              (Instagram-style direct download)
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

/** JV deal enrichment attached to a feed video (matched via property_id / project_id). */
export interface FeedVideoDeal {
  id: string;
  title: string | null;
  price: number | null;
  min_investment: number | null;
  expected_roi: string | null;
  deal_type: string | null;
  url: string | null;
}

export interface FeedVideo {
  id: string;
  project_id: string | null;
  video_url: string;
  /** Adaptive HLS master playlist — preferred playback source (never play the raw original when present). */
  hls_url: string | null;
  poster_url: string | null;
  /** Tiny blurred placeholder for instant first paint. */
  preview_blur_url: string | null;
  playback_status: string | null;
  thumbnail_url: string | null;
  cover_url?: string | null;
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
  save_count?: number;
  view_count?: number;
  property_id?: string | null;
  /** Type A `deal` (investor deal video) | Type B `reel` (project/construction reel). */
  video_type?: 'deal' | 'reel';
  /** Featured Investor Video — interleaved by the backend every 3 deal videos. */
  is_featured?: boolean;
  /** Present when the video is attached to a live JV deal (e.g. Casa Rosario). */
  deal?: FeedVideoDeal | null;
  /** Creator id used for follow/unfollow actions on the landing page. */
  creator_id?: string | null;
  /** Video publication status (e.g. published, draft, archived). */
  status?: string | null;
}

/**
 * Fetches the ranked video feed with deal enrichment — the SAME endpoint the
 * landing page (ivx-reels.js) and the iOS app (VideoFeedService) consume, so
 * all three platforms show identical videos and property cards.
 */
/**
 * Fetches the ranked video feed with deal enrichment — the SAME endpoint the
 * landing page (ivx-reels.js) and the iOS app (VideoFeedService) consume, so
 * all three platforms show identical videos and property cards.
 *
 * Pass `offset` for cursor-based pagination: the first call fetches `limit`
 * videos, subsequent calls pass `offset = limit`, `offset = limit * 2`, etc.
 */
export async function fetchVideoFeed(limit = 24, offset = 0): Promise<FeedVideo[]> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (offset > 0) params.set('offset', String(offset));
  const res = await fetch(`${API_BASE}/api/ivx/video-platform/feed?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Feed request failed (${res.status})`);
  }
  const data = (await res.json()) as { videos?: FeedVideo[] };
  return Array.isArray(data.videos) ? data.videos : [];
}

/**
 * Project Reels rail (construction updates, drone footage, behind the scenes) —
 * served by the same canonical endpoint with ?type=reel so reels never
 * interrupt the investor deal flow of the main feed.
 */
export async function fetchProjectReels(limit = 24): Promise<FeedVideo[]> {
  const res = await fetch(`${API_BASE}/api/ivx/video-platform/feed?limit=${limit}&type=reel`);
  if (!res.ok) {
    throw new Error(`Reels request failed (${res.status})`);
  }
  const data = (await res.json()) as { videos?: FeedVideo[] };
  return Array.isArray(data.videos) ? data.videos : [];
}

/** Deal payload inside the investor-first home feed (canonical across platforms). */
export interface HomeFeedDeal {
  id: string;
  name: string | null;
  city: string | null;
  phase: string | null;
  status: string | null;
  deal_type: string | null;
  investment_amount: number | null;
  expected_roi: string | null;
  min_investment: number | null;
  progress_percent: number | null;
  photo_url: string | null;
  url: string;
  is_featured: boolean;
  priority: number;
  display_order: number | null;
  created_at: string | null;
}

/** display_type explicitly maps each block to its card component — no inference from media. */
export type DisplayType = 'investment_card' | 'reel';

/** One block of the investor-first home layout: a deal card or a featured project video. */
export type HomeFeedBlock =
  | { position: number; type: 'deal'; display_type: 'investment_card'; deal: HomeFeedDeal }
  | { position: number; type: 'video'; display_type: 'reel'; video: FeedVideo };

export interface HomeFeedResponse {
  pattern: string;
  ordering: string;
  blocks: HomeFeedBlock[];
  deal_count: number;
  video_count: number;
  total_approved_videos?: number;
}

/**
 * Investor-first HOME feed — the SINGLE source of truth for the home layout on
 * landing page, Android, iOS, tablet and desktop:
 *   Featured Deal 1–3 → 1 Featured Project Video → Deal 4–6 → 1 video → repeat.
 * Every video is attached to a real project; the exact same sequence renders
 * on every platform. One admin publish updates all of them.
 */
export async function fetchHomeFeed(limit = 60): Promise<HomeFeedResponse> {
  const res = await fetch(`${API_BASE}/api/ivx/video-platform/home-feed?limit=${limit}`);
  if (!res.ok) {
    throw new Error(`Home feed request failed (${res.status})`);
  }
  const data = (await res.json()) as HomeFeedResponse;
  return {
    pattern: data.pattern ?? '',
    ordering: data.ordering ?? '',
    blocks: Array.isArray(data.blocks) ? data.blocks : [],
    deal_count: data.deal_count ?? 0,
    video_count: data.video_count ?? 0,
  };
}

/** Direct high-quality download URL for a feed video. */
export function getVideoDownloadUrl(videoId: string): string {
  return `${API_BASE}/api/ivx/videos/${encodeURIComponent(videoId)}/download`;
}

function safeFileName(title: string | null): string {
  const base = (title || 'ivx-video').replace(/[^a-zA-Z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 60);
  return `${base || 'ivx-video'}.mp4`;
}

/**
 * Downloads the source-quality MP4 (resumable Range-enabled endpoint) and
 * opens the native share sheet so the user can save it to Photos/Files —
 * the same flow Instagram uses for saved reels.
 */
export async function downloadFeedVideo(
  videoId: string,
  title: string | null,
): Promise<{ success: boolean; uri?: string; error?: string }> {
  const url = getVideoDownloadUrl(videoId);

  if (Platform.OS === 'web') {
    try {
      const w = (globalThis as { window?: { open?: (u: string, t: string) => unknown } }).window;
      w?.open?.(url, '_blank');
      return { success: true };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  try {
    const dest = `${FileSystem.cacheDirectory}${safeFileName(title)}`;
    const result = await FileSystem.downloadAsync(url, dest);
    if (result.status !== 200 && result.status !== 206) {
      return { success: false, error: `Download failed (${result.status})` };
    }
    const canShare = await Sharing.isAvailableAsync();
    if (canShare) {
      await Sharing.shareAsync(result.uri, { mimeType: 'video/mp4', dialogTitle: 'Save video' });
    }
    return { success: true, uri: result.uri };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
