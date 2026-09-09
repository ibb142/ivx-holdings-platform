import { json } from 'hono';

export async function handleDealsRequest(): Promise<Response> {
  return json({ ok: true, message: 'Deals available' }, 200);
}

export async function handleLandingDealsRequest(): Promise<Response> {
  return json({ ok: true, message: 'Landing deals available' }, 200);
}

export async function handleLandingConfigRequest(): Promise<Response> {
  return json({ ok: true, message: 'Landing config available' }, 200);
}

export async function handleVideosRequest(): Promise<Response> {
  return json({ ok: true, message: 'Videos available' }, 200);
}
