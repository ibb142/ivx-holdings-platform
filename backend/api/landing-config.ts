import { jsonResponse } from './ivx-media-jobs';

export async function handleLandingConfigRequest(): Promise<Response> {
  // Mock response for landing config
  return jsonResponse({ ok: true, config: {} }, 200);
}
