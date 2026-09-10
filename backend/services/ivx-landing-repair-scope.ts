/** Trusted, versioned boundaries for known Landing defects. A generated test
 * passing is not permission to modify an unrelated business rule.
 */
export const LANDING_REPAIR_SCOPE_PROTOCOL = 'ivx-landing-repair-scope-v1';
const VIDEO_UNITS = new Set(['deals.videos-present', 'media.deal-videos-resolvable', 'media.deal-videos-mime', 'media.deal-images-resolvable', 'media.deal-images-mime']);
const VIDEO_SOURCES = [
  'backend/api/ivx-public-features.ts',
  'backend/services/ivx-deal-media-normalization.ts',
] as const;

export function landingRepairScopeForUnit(unitId: string): { protocol: string; unitId: string; files: string[]; instruction: string } | null {
  if (!VIDEO_UNITS.has(unitId)) return null;
  return {
    protocol: LANDING_REPAIR_SCOPE_PROTOCOL,
    unitId,
    files: VIDEO_SOURCES.flatMap(source => [source, source.replace(/\.ts$/, '.node-regression.test.ts')]),
    instruction: 'Trace an existing property-media reference through the public /api/deals response. The regression must exercise that response with a real-shaped row and preserve the original Landing acceptance probe. Missing customer media is a dependency to report, never a reason to invent a URL, reclassify images as documents, alter investment matching scores or weaken tests. A new helper must be wired into the public response; an unused helper is not a repair.',
  };
}

export function assertLandingRepairScope(taskId: string, paths: readonly string[]): void {
  const unit = /^landing-remediation:[^:]+:(.+)$/.exec(taskId)?.[1];
  const scope = unit ? landingRepairScopeForUnit(unit) : null;
  if (!scope) return;
  if (!paths.length) throw new Error(`REPAIR_DEFECT_SCOPE_VIOLATION: ${scope.protocol}/${scope.unitId}: affected-file evidence is required before publishing this repair.`);
  const allowed = new Set(scope.files);
  const outside = paths.find(path => !allowed.has(path));
  if (outside !== undefined) {
    throw new Error(`REPAIR_DEFECT_SCOPE_VIOLATION: ${scope.protocol}/${scope.unitId}: ${outside} is outside the public deal-media response. Allowed files: ${scope.files.join(', ')}. ${scope.instruction}`);
  }
}
