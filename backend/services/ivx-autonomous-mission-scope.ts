/** Deployment-bound inspections are history once a newer runtime takes over.
 * Derived repairs and owner objectives keep their own durable identities. */
export const VERSIONED_INSPECTION_PREFIXES = ['module-audit:', 'autonomous-secondary:'] as const;
export const VERSIONED_MISSION_PREFIXES = [
  'landing-p0:', 'landing-p0-repair:', 'landing-p0-patrol:', ...VERSIONED_INSPECTION_PREFIXES,
] as const;
