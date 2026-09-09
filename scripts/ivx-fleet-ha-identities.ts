export function processIdentityMatchesObservedInstance(
  processIdentity: unknown,
  observedInstanceIds: ReadonlySet<string>,
): boolean {
  if (typeof processIdentity !== 'string' || !processIdentity) return false;

  // The application identity is `<fleet>:<render-instance-or-host>:<pid>:<boot-nonce>`.
  // PostgreSQL exposes that complete identity. Render can expose either the
  // full host or the public ID `<service-id>-<replica-suffix>`.
  if (observedInstanceIds.has(processIdentity)) return true;
  const parts = processIdentity.split(':');
  if (parts.length !== 4) return false;
  const host = parts[1] ?? '';
  if (observedInstanceIds.has(host)) return true;

  // Render's container hostname also includes the deployment hash. Preserve
  // both service ID and replica suffix; a suffix alone is not a valid match.
  const pod = /^(srv-[a-z0-9]+)-[a-z0-9]+-([a-z0-9]+)$/.exec(host);
  return Boolean(pod && observedInstanceIds.has(`${pod[1]}-${pod[2]}`));
}
