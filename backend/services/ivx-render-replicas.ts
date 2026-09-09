/** Owner-approved, bounded manual scaling of this repository's existing services. */
export async function updateRenderReplicas(input: { serviceId: string; numInstances: number }, headers: HeadersInit, fetcher: typeof fetch = fetch) {
  if (!/^srv-[a-z0-9]+$/.test(input.serviceId) || ![1, 2].includes(input.numInstances)) throw new Error('Existing service and one or two replicas required');
  const origin = 'https://api.render.com/v1';
  const read = async (path: string) => {
    const res = await fetcher(origin + path, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Render topology read failed (HTTP ${res.status})`);
    return res.json();
  };
  const [service, disks] = await Promise.all([read(`/services/${input.serviceId}`), read(`/disks?serviceId=${input.serviceId}&limit=1`)]);
  if (service.repo?.replace(/\.git$/, '') !== 'https://github.com/ibb142/ivx-holdings-platform'
    || service.branch !== 'main' || !['web_service', 'background_worker'].includes(service.type)) throw new Error('Unexpected Render repository, branch or service type');
  if (!Array.isArray(disks) || disks.length) throw new Error('Disk-backed service cannot be replicated');
  if (service.serviceDetails?.autoscaling?.enabled) throw new Error('Manual scaling requires autoscaling disabled');
  if (service.serviceDetails?.numInstances === input.numInstances) return { ok: true, changed: false, serviceId: input.serviceId, numInstances: input.numInstances };
  const response = await fetcher(`${origin}/services/${input.serviceId}/scale`, { method: 'POST', headers,
    body: JSON.stringify({ numInstances: input.numInstances }), signal: AbortSignal.timeout(15_000) });
  if (response.status !== 202) throw new Error(`Render scaling rejected (HTTP ${response.status})`);
  // Provisioning is asynchronous. Configuration acceptance is not live HA proof.
  return { ok: true, changed: true, serviceId: input.serviceId, requestedInstances: input.numInstances, provisionStatus: 'requested', liveVerified: false };
}
