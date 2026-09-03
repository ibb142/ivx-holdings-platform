import { validateDealPhotoCount } from '../services/ivx-content-integrity';

export async function handleContentIntegrity(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const dealId = url.searchParams.get('dealId');
    if (!dealId) return new Response('dealId required', { status: 400 });

    const isValid = await validateDealPhotoCount(dealId);
    return new Response(JSON.stringify({ valid: isValid }), {
      status: isValid ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response('internal error', { status: 500 });
  }
}
