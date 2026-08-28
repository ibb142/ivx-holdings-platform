/**
 * IVX operational metrics API (owner-only).
 *
 * Read-only access to the six diagnostics-screen metrics, each over a 24-hour
 * and a lifetime window:
 *   GET /api/ivx/metrics → crash counter, API latency, Supabase query latency,
 *   OpenAI request latency, owner-route success rate, deliverable success rate.
 *
 * Owner-gated via the same guard as the rest of the IVX developer surface.
 */
import { buildMetricsSnapshot } from '../services/ivx-metrics-aggregator';
import { ensureIncidentStoreReady } from '../services/ivx-incident-store';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const OPTIONS = (): Response => ownerOnlyOptions();

async function requireOwner(request: Request): Promise<{ ok: true } | { ok: false; response: Response }> {
  try {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
      return { ok: false, response: ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401) };
    }
    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'IVX owner authentication required.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return { ok: false, response: ownerOnlyJson({ ok: false, error: message }, status) };
  }
}

/** GET /api/ivx/metrics — full metrics snapshot (24h + lifetime). */
export async function handleMetricsRequest(request: Request): Promise<Response> {
  const auth = await requireOwner(request);
  if (!auth.ok) return auth.response;

  try {
    // Crash counts derive from the durable incident store — make sure it's hydrated.
    await ensureIncidentStoreReady();
    const metrics = await buildMetricsSnapshot();
    return ownerOnlyJson({ ok: true, data: metrics });
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Failed to build metrics snapshot.' }, 500);
  }
}
