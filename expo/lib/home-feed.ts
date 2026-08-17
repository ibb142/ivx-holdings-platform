/**
 * Native-safe Home feed client.
 *
 * Keep this module free of media, filesystem and sharing imports. The Home
 * route imports it during startup; importing the full video-feed client also
 * initializes native media-related modules that Home does not need.
 */

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

export interface HomeFeedVideoDeal {
  id: string;
  title: string | null;
  url: string | null;
}

export interface HomeFeedVideo {
  id: string;
  title: string | null;
  poster_url: string | null;
  thumbnail_url: string | null;
  cover_url?: string | null;
  deal?: HomeFeedVideoDeal | null;
}

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

export type HomeFeedBlock =
  | { position: number; type: 'deal'; display_type: 'investment_card'; deal: HomeFeedDeal }
  | { position: number; type: 'video'; display_type: 'reel'; video: HomeFeedVideo };

export interface HomeFeedResponse {
  blocks: HomeFeedBlock[];
}

export async function fetchHomeFeed(limit = 60): Promise<HomeFeedResponse> {
  const response = await fetch(`${API_BASE}/api/ivx/video-platform/home-feed?limit=${limit}`);
  if (!response.ok) {
    throw new Error(`Home feed request failed (${response.status})`);
  }
  const payload = (await response.json()) as Partial<HomeFeedResponse>;
  return { blocks: Array.isArray(payload.blocks) ? payload.blocks : [] };
}
