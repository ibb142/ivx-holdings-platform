export function processIdentityMatchesObservedInstance(
  processIdentity: unknown,
  observedInstanceIds: ReadonlySet<string>,
): boolean {
  if (typeof processIdentity !== 'string' || !processIdentity) return false;

  // Shared PostgreSQL topology exposes the complete process identity, while
  // Render's public instances endpoint exposes only its physical instance ID.
  // The application identity is `<fleet>:<render-instance>:<pid>:<boot-nonce>`.
  if (observedInstanceIds.has(processIdentity)) return true;
  const parts = processIdentity.split(':');
  return parts.length === 4 && observedInstanceIds.has(parts[1] ?? '');
}
