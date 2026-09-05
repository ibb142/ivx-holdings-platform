import { jsonResponse } from './ivx-media-jobs';

export async function handleJVDealsRequest(): Promise<Response> {
  // Mock response for JV deals
  return jsonResponse({ ok: true, deals: [] }, 200);
}
