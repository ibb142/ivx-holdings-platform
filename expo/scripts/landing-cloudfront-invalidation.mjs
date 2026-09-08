/** Confirm the actual CloudFront operation; creating an invalidation is not completion. */
export async function completeLandingInvalidation({
  create,
  read,
  onCreated = () => {},
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 180_000,
  pollMs = 3_000,
}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) {
    throw new Error('CloudFront invalidation requires a finite positive wait budget');
  }
  const deadline = now() + timeoutMs;
  let invalidation = await create();
  const id = invalidation?.Id;
  if (typeof id !== 'string' || !id) throw new Error('CloudFront returned no invalidation ID');
  onCreated(id);
  while (invalidation?.Status !== 'Completed') {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error(`CloudFront invalidation ${id} did not complete within ${timeoutMs}ms`);
    await sleep(Math.min(pollMs, remaining));
    if (now() >= deadline) throw new Error(`CloudFront invalidation ${id} did not complete within ${timeoutMs}ms`);
    invalidation = await read(id);
    if (invalidation?.Id !== id) throw new Error('CloudFront invalidation response identity mismatch');
  }
  return { id, status: 'Completed' };
}
