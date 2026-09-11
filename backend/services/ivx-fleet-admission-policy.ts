/** Logical identities are independent from the number of admitted executions. */
export const FLEET_IDENTITIES = 112;

export function configuredAdmissionLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value.trim())) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? Math.min(parsed, FLEET_IDENTITIES) : 0;
}

/** Rotate even when a selected identity has no due task, so it cannot starve others. */
export function createFleetAdmissionRotation() {
  let lastSelected = 0;
  return <T extends { agentNumber: number | null }>(eligible: readonly T[], capacity: number): T[] => {
    if (!Number.isInteger(capacity) || capacity <= 0) return [];
    const numbered = eligible.filter((a): a is T & { agentNumber: number } =>
      Number.isInteger(a.agentNumber) && a.agentNumber! >= 1 && a.agentNumber! <= FLEET_IDENTITIES);
    if (new Set(numbered.map(a => a.agentNumber)).size !== numbered.length) throw new Error('Ambiguous fleet admission identities');
    const distance = (n: number) => (n - lastSelected - 1 + FLEET_IDENTITIES) % FLEET_IDENTITIES;
    const selected = numbered.sort((a, b) => distance(a.agentNumber) - distance(b.agentNumber))
      .slice(0, Math.min(capacity, FLEET_IDENTITIES));
    if (selected.length) lastSelected = selected[selected.length - 1].agentNumber;
    return selected;
  };
}
