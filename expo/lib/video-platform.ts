/**
 * IVX Video Platform API client — mirrors the engagement endpoints the landing
 * page (ivx-reels.js) uses. This keeps Android / iOS / web behavior identical
 * to the landing-page reels experience.
 */
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const API_BASE = (process.env.EXPO_PUBLIC_IVX_API_BASE_URL || 'https://api.ivxholding.com').replace(/\/+$/, '');

const VIEWER_ID_KEY = 'ivx_viewer_id';

export type VideoChannel = 'all' | 'reel' | 'investor' | 'buyer' | 'realtor' | 'builder' | 'jv';

export const CHANNELS: { id: VideoChannel; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'reel', label: 'Project Reels' },
  { id: 'investor', label: 'Investor' },
  { id: 'buyer', label: 'Buyer' },
  { id: 'realtor', label: 'Realtor' },
  { id: 'builder', label: 'Builder' },
  { id: 'jv', label: 'JV Deals' },
];

export async function getViewerId(): Promise<string> {
  try {
    let id = await SecureStore.getItemAsync(VIEWER_ID_KEY);
    if (!id) {
      id = `guest-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
      await SecureStore.setItemAsync(VIEWER_ID_KEY, id);
    }
    return id;
  } catch {
    return `guest-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  }
}

async function platformPost(path: string, body: Record<string, unknown>): Promise<{ ok: boolean; data?: Record<string, unknown>; error?: string }> {
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      return { ok: false, error: `Request failed (${res.status})` };
    }
    const data = (await res.json()) as Record<string, unknown>;
    return { ok: true, data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function toggleVideoSave(videoId: string, viewerId?: string | null): Promise<{ saved: boolean; saveCount: number }> {
  const viewer = viewerId || (await getViewerId());
  const result = await platformPost(`/api/projects/${encodeURIComponent(videoId)}/save`, { guest_id: viewer });
  if (!result.ok || !result.data) {
    return { saved: false, saveCount: 0 };
  }
  return {
    saved: !!result.data.saved,
    saveCount: Number(result.data.save_count ?? 0),
  };
}

/**
 * Toggle like on a video/reel via the backend API using guest_id.
 * This replaces the broken `toggleProjectLike(id, null)` call path which
 * silently did nothing because the Supabase client requires a real user_id.
 * The backend `handleProjectLikeToggle` accepts `guest_id` in the body.
 */
export async function toggleVideoLike(videoId: string, viewerId?: string | null): Promise<{ liked: boolean; likeCount: number }> {
  const viewer = viewerId || (await getViewerId());
  const result = await platformPost(`/api/projects/${encodeURIComponent(videoId)}/like`, { guest_id: viewer });
  if (!result.ok || !result.data) {
    return { liked: false, likeCount: 0 };
  }
  return {
    liked: !!result.data.liked,
    likeCount: Number(result.data.like_count ?? 0),
  };
}

export async function toggleVideoFollow(creatorId: string, viewerId?: string | null): Promise<{ following: boolean }> {
  const viewer = viewerId || (await getViewerId());
  const result = await platformPost('/api/ivx/video-platform/follow', { follower_id: viewer, creator_id: creatorId || 'ivx-owner' });
  if (!result.ok || !result.data) {
    return { following: false };
  }
  return { following: !!result.data.following };
}

export async function reportVideo(videoId: string, reason: string, viewerId?: string | null): Promise<{ ok: boolean }> {
  const viewer = viewerId || (await getViewerId());
  const result = await platformPost(`/api/ivx/video-platform/videos/${encodeURIComponent(videoId)}/report`, { reporter_id: viewer, reason });
  return { ok: result.ok };
}

export async function trackVideoEvent(
  eventType: string,
  videoId: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  try {
    const viewer = await getViewerId();
    const payload = {
      events: [{ type: eventType, video_id: videoId, viewer_id: viewer, ...extra }],
    };
    await fetch(`${API_BASE}/api/ivx/video-platform/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    // Analytics beacons are best-effort.
  }
}

export async function fetchVideoStories(): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`${API_BASE}/api/ivx/video-platform/stories`);
    if (!res.ok) return [];
    const data = (await res.json()) as { stories?: Record<string, unknown>[] };
    return Array.isArray(data.stories) ? data.stories : [];
  } catch {
    return [];
  }
}

export async function fetchLiveSessions(): Promise<Record<string, unknown>[]> {
  try {
    const res = await fetch(`${API_BASE}/api/ivx/video-platform/live`);
    if (!res.ok) return [];
    const data = (await res.json()) as { sessions?: Record<string, unknown>[] };
    return Array.isArray(data.sessions) ? data.sessions : [];
  } catch {
    return [];
  }
}

export function buildVideoShareUrl(videoId: string): string {
  return `https://ivxholding.com/?video=${encodeURIComponent(videoId)}`;
}

export function nativeShare(message: string): void {
  if (Platform.OS === 'web') {
    try {
      const w = (globalThis as { window?: { navigator?: { share?: (o: { title?: string; text?: string; url?: string }) => Promise<void> } } }).window;
      if (w?.navigator?.share) {
        void w.navigator.share({ title: 'IVX Holdings', text: message });
        return;
      }
    } catch {}
  }
  // Fallback: share via Expo Sharing is handled by the caller.
}