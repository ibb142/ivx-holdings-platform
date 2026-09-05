import { jsonResponse } from './ivx-media-jobs';

export async function handleLandingDealsRequest(): Promise<Response> {
  // Mock response for landing deals
  return jsonResponse({ ok: true, deals: [] }, 200);
}
