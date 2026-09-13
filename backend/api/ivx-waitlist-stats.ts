import { readCanonicalWaitlistStats } from '../services/ivx-canonical-members';

export async function handleWaitlistStats(
  deploymentMarker: string,
  read = readCanonicalWaitlistStats,
): Promise<Response> {
  try {
    const stats = await read();
    return Response.json({ ok: true, ...stats, degraded: false, data_available: true,
      timestamp: new Date().toISOString(), deploymentMarker },
    { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[WaitlistStats] aggregate read unavailable');
    return Response.json({ ok: true, total: 0, waitlist: 0, degraded: true, data_available: false,
      timestamp: new Date().toISOString(), deploymentMarker },
    { headers: { 'Cache-Control': 'no-store', 'Retry-After': '2' } });
  }
}
