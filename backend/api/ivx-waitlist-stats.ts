import { readCanonicalWaitlistStats } from '../services/ivx-canonical-members';

export async function handleWaitlistStats(
  deploymentMarker: string,
  read = readCanonicalWaitlistStats,
): Promise<Response> {
  try {
    const stats = await read();
    if (!Number.isSafeInteger(stats.total) || !Number.isSafeInteger(stats.waitlist)
      || stats.total < 0 || stats.waitlist < 0 || stats.waitlist > stats.total) {
      throw new Error('Member counts are temporarily unavailable');
    }
    return Response.json({ ok: true, ...stats, degraded: false, data_available: true,
      timestamp: new Date().toISOString(), deploymentMarker },
    { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    console.error('[WaitlistStats] aggregate read unavailable');
    return Response.json({ ok: false, total: null, waitlist: null, degraded: true, data_available: false,
      code: 'WAITLIST_STATS_UNAVAILABLE', retryable: true,
      error: 'Member counts are temporarily unavailable. Please retry.',
      timestamp: new Date().toISOString(), deploymentMarker },
    { status: 503, headers: { 'Cache-Control': 'no-store', 'Retry-After': '3' } });
  }
}
