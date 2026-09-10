/** Keep private task descriptions out of public PR metadata and bound their file writes. */
export function isPrivateRepairGoal(goal: string): boolean {
  return goal.includes('[OWNER_AUDIT:');
}

export function publicRepairGoal(goal: string): string {
  return isPrivateRepairGoal(goal) || /\[AUTONOMOUS_DIAGNOSTIC_DATA\]|\[TEMPLATE_MODE:BUG_FIX\]/.test(goal) ? 'Scoped application repair' : goal;
}

export function assertPrivateRepairScope(goal: string, allowedFiles: readonly string[] | undefined, paths: readonly string[]): void {
  if (!isPrivateRepairGoal(goal)) return;
  const valid = (p: string) => Boolean(p) && !p.startsWith('/') && !p.includes('\\') && !p.split('/').some(part => !part || part === '.' || part === '..');
  if (!allowedFiles?.length || allowedFiles.some(p => !valid(p))) {
    throw new Error('PRIVATE_REPAIR_SCOPE_MISSING: an explicit repository file set is required.');
  }
  const allowed = new Set(allowedFiles);
  if (paths.some(p => !valid(p) || !allowed.has(p))) {
    throw new Error('PRIVATE_REPAIR_SCOPE_VIOLATION: proposed patch exceeds the authorized file set.');
  }
}
