/**
 * IVX Project Vision — permanent north star for Autonomous and the 112-agent fleet.
 *
 * This is intentionally not a finite feature checklist. It is the product mandate
 * used to evaluate what "done" means and what Autonomous should discover next.
 * Financial scale is an ambition, never a fabricated guarantee.
 */

export const IVX_PROJECT_VISION_MARKER = 'ivx-project-vision-2026-09-06';

export const IVX_PROJECT_VISION = {
  mission: 'Finish and continuously improve IVX Holdings end to end so every customer interaction is trustworthy, safe, useful, fast, clear, and worth returning to.',
  productNorthStar: 'Build an intelligent end-to-end real-estate investment platform that can discover unfinished work, prioritize it, execute safely, verify the result in production, learn from evidence, and immediately continue to the next highest-value gap.',
  customerPromise: [
    'Protect customer trust, privacy, money, identity, and data.',
    'Make every critical journey understandable, reliable, fast, and recoverable.',
    'Treat bugs, confusing UX, broken flows, stale data, poor performance, and missing proof as unfinished work.',
    'Create reasons for customers to return through real utility, reliability, transparency, and continuously improving experiences.',
  ],
  scaleAmbition: 'Design for compounding value creation and global scale without an artificial business ceiling. Millions, billions, and larger outcomes are aspirations to enable through architecture and product quality, never claims or guarantees.',
  operatingLoop: ['DISCOVER', 'UNDERSTAND', 'PRIORITIZE', 'EXECUTE', 'TEST', 'VERIFY_PRODUCTION', 'LEARN', 'DISCOVER_AGAIN'] as const,
  completionRules: [
    'An empty known-work queue does not mean the product is finished.',
    'Before declaring a surface clean, perform fresh discovery across code, UX, APIs, data, security, performance, mobile, web, production telemetry, and customer-critical journeys.',
    'Never count ALREADY_VERIFIED, no-op activity, workflow existence, or narrative as new productive work.',
    'Never mark work complete without evidence tied to the exact code/deploy being verified.',
    'Critical and high-impact customer trust, security, correctness, availability, and money-flow failures outrank cosmetic work.',
    'When one task is verified, immediately return to discovery and select the next highest-value gap.',
  ],
} as const;

export type IVXProjectVision = typeof IVX_PROJECT_VISION;

export type ProjectCompletionMandate = {
  marker: string;
  mission: string;
  scaleAmbition: string;
  operatingLoop: readonly string[];
  completionRules: readonly string[];
  doneIsEvidenceBased: true;
  emptyQueueMeansDone: false;
  continuousDiscoveryRequired: true;
};

export function getProjectCompletionMandate(): ProjectCompletionMandate {
  return {
    marker: IVX_PROJECT_VISION_MARKER,
    mission: IVX_PROJECT_VISION.mission,
    scaleAmbition: IVX_PROJECT_VISION.scaleAmbition,
    operatingLoop: IVX_PROJECT_VISION.operatingLoop,
    completionRules: IVX_PROJECT_VISION.completionRules,
    doneIsEvidenceBased: true,
    emptyQueueMeansDone: false,
    continuousDiscoveryRequired: true,
  };
}

export function buildAutonomousMissionContext(ownerTask?: string | null): string {
  const task = typeof ownerTask === 'string' && ownerTask.trim() ? ownerTask.trim() : 'Continue completing IVX end to end.';
  return [
    `IVX MISSION: ${IVX_PROJECT_VISION.mission}`,
    `OWNER TASK: ${task}`,
    'MANDATE: Do not stop because the known queue is empty. Re-discover the system, find the next evidence-backed gap, prioritize customer trust and end-to-end correctness, execute safely, verify exact production proof, learn, and continue.',
    `SCALE: ${IVX_PROJECT_VISION.scaleAmbition}`,
  ].join('\n');
}
