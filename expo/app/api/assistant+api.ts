type ExpoApiRequest = Request;

function jsonResponse(body: Record<string, unknown>, status: number = 503): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type, authorization'}});
}

export function OPTIONS(): Response {
  return jsonResponse({ ok: true }, 200);
}

export async function POST(_request: ExpoApiRequest): Promise<Response> {
  console.log('[Expo API] /api/assistant called inside Expo runtime; backend is external-only.');
  return jsonResponse({
    success: false,
    error: 'Assistant backend must be called through the deployed server endpoint, not the Expo Go bundle.'});
}
