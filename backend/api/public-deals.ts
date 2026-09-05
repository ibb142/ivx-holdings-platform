import { listPublicDeals } from '../services/public-deals-service';

export async function handlePublicDealsListRequest(request: Request): Promise<Response> {
  try {
    const deals = await listPublicDeals();
    return new Response(JSON.stringify({ ok: true, deals }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ ok: false, error: 'Failed to retrieve deals.' }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
