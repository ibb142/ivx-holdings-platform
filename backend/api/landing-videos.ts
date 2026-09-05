import { jsonResponse } from './ivx-media-jobs';

export async function handleLandingVideosRequest(): Promise<Response> {
  // Mock response for landing videos
  return jsonResponse({ ok: true, videos: [] }, 200);
}
