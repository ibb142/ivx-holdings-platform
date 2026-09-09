import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { fleetSloPrometheus, getFleetSloSnapshot, IVX_FLEET_SLO_MARKER } from '../services/ivx-fleet-slo';

export const fleetSloOptions = ownerOnlyOptions;
export async function handleFleetSloGet(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); }
  catch { return ownerOnlyJson({ ok: false, error: 'Owner authentication required' }, 401); }
  let snapshot;
  try {
    snapshot = getFleetSloSnapshot();
  } catch (error) {
    return ownerOnlyJson({ ok: false, marker: IVX_FLEET_SLO_MARKER, status: 'UNKNOWN', error: 'Error fetching fleet SLO snapshot' }, 500);
  }
  if (!snapshot) return ownerOnlyJson({ ok: false, marker: IVX_FLEET_SLO_MARKER, status: 'UNKNOWN', error: 'Waiting for first durable sample' }, 503);
  if (new URL(request.url).searchParams.get('format') === 'prometheus') {
    return new Response(fleetSloPrometheus(snapshot), { headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
  return ownerOnlyJson({ ok: snapshot.status !== 'UNKNOWN', ...snapshot }, snapshot.status === 'UNKNOWN' ? 503 : 200);
}
