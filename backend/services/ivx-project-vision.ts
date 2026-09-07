/**
 * IVX Project Vision — permanent north star for Autonomous and the 112-agent fleet.
 *
 * This is intentionally not a finite feature checklist. It is the product mandate
 * used to evaluate what "done" means and what Autonomous should discover next.
 * Financial scale is an ambition, never a fabricated guarantee.
 */

export const IVX_PROJECT_VISION_MARKER = 'ivx-project-vision-v2-executable-truth-2026-09-06';

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
  fleetModel: {
    totalAgents: 112,
    commandAgents: 12,
    executionAgents: 100,
    commandRange: 'IA-001..IA-012',
    executionRange: 'IA-013..IA-112',
    allocation: 'The command tier discovers, understands, prioritizes, decomposes, reviews, and certifies. The execution tier performs isolated evidence-backed work. All 112 remain dedicated to IVX until the owner changes the allocation.',
  },
  autonomousConstitution: [
    'Autonomous is the single production control authority for fleet scheduling. Observers may measure and recommend, but must not deploy, retry, resume, cancel, or manufacture work.',
    'Autonomous combines a deterministic state machine with bounded AI decisions. AI output is a proposal until policy, permissions, tests, and evidence gates accept it.',
    'Owner pause, emergency stop, approval, budget, security, payment, secret, destructive-data, and production gates always outrank an always-on mandate.',
    'Retries are idempotent, capacity-bounded, backoff-controlled, and protected by circuit breakers. A failure must not create a self-feeding loop.',
    'Each code-changing task owns an isolated branch or workspace. Integration batches compatible work through review instead of allowing 112 writers to collide on main.',
  ],
  runtimeTruthContract: [
    'Registered, assigned, queued, scheduled, requested, or HTTP-successful agents are not proof of simultaneous work.',
    'A working agent requires a distinct active task, a distinct valid lease, a fresh heartbeat, a known worker identity, and task-specific evidence in the same observation window.',
    'The 112/112 claim additionally requires deployed concurrency of at least 112, one mutation authority, an atomic row queue shared across workers, zero stale or blocked agents, and no emergency stop.',
    'Logical agents, physical worker processes, execution slots, and productive tasks are separate metrics and must be reported separately.',
  ],
  dataConstitution: [
    'Hot queues use normalized PostgreSQL rows with atomic conditional claims, leases, heartbeats, retry budgets, and idempotency keys; a shared JSON document is not a horizontally scalable queue.',
    'Operational dashboards report rates over explicit windows. Cumulative database counters must include their reset timestamp and must never be described as files, agents, or productive work.',
    'Audit evidence is retained under an explicit retention and archive policy. Millions of historical rows are never deleted merely to make a metric look smaller.',
  ],
  scaleGates: [
    'Certify one authority and stable database/write rates at 12 concurrent slots.',
    'Prove atomic multi-worker claims, unique worker identities, graceful drain, lease recovery, and zero duplicate execution.',
    'Increase capacity in measured stages and stop automatically on error-rate, lock, connection, memory, cost, or evidence-integrity thresholds.',
    'Claim 112 simultaneous agents only after the executable runtime truth contract passes on live production.',
  ],
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
  fleetModel: typeof IVX_PROJECT_VISION.fleetModel;
  autonomousConstitution: readonly string[];
  runtimeTruthContract: readonly string[];
  dataConstitution: readonly string[];
  scaleGates: readonly string[];
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
    fleetModel: IVX_PROJECT_VISION.fleetModel,
    autonomousConstitution: IVX_PROJECT_VISION.autonomousConstitution,
    runtimeTruthContract: IVX_PROJECT_VISION.runtimeTruthContract,
    dataConstitution: IVX_PROJECT_VISION.dataConstitution,
    scaleGates: IVX_PROJECT_VISION.scaleGates,
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
    `FLEET: ${IVX_PROJECT_VISION.fleetModel.commandAgents} command agents (${IVX_PROJECT_VISION.fleetModel.commandRange}) coordinate ${IVX_PROJECT_VISION.fleetModel.executionAgents} execution agents (${IVX_PROJECT_VISION.fleetModel.executionRange}); total ${IVX_PROJECT_VISION.fleetModel.totalAgents}.`,
    `CONTROL: ${IVX_PROJECT_VISION.autonomousConstitution.join(' ')}`,
    `RUNTIME TRUTH: ${IVX_PROJECT_VISION.runtimeTruthContract.join(' ')}`,
    `DATA: ${IVX_PROJECT_VISION.dataConstitution.join(' ')}`,
    `SCALE GATES: ${IVX_PROJECT_VISION.scaleGates.join(' ')}`,
    'MANDATE: Do not stop because the known queue is empty. Re-discover the system, find the next evidence-backed gap, prioritize customer trust and end-to-end correctness, execute safely, verify exact production proof, learn, and continue.',
    `SCALE: ${IVX_PROJECT_VISION.scaleAmbition}`,
  ].join('\n');
}

export type FleetActivationEvidence = {
  registeredAgents: number;
  distinctActiveAgents: number;
  distinctActiveLeases: number;
  freshHeartbeats: number;
  knownWorkerIdentities: number;
  deployedConcurrency: number;
  mutationAuthorities: number;
  queueBackend: string;
  staleAgents: number;
  blockedAgents: number;
  emergencyStop: boolean;
};

export type FleetActivationGate = {
  certified: boolean;
  requiredAgents: 112;
  blockers: string[];
};

/** Canonical, executable meaning of "112 agents working simultaneously". */
export function evaluateFleetActivationEvidence(evidence: FleetActivationEvidence): FleetActivationGate {
  const blockers: string[] = [];
  if (evidence.registeredAgents !== 112) blockers.push(`REGISTERED_AGENTS:${evidence.registeredAgents}/112`);
  if (evidence.distinctActiveAgents !== 112) blockers.push(`DISTINCT_ACTIVE_AGENTS:${evidence.distinctActiveAgents}/112`);
  if (evidence.distinctActiveLeases !== 112) blockers.push(`DISTINCT_ACTIVE_LEASES:${evidence.distinctActiveLeases}/112`);
  if (evidence.freshHeartbeats !== 112) blockers.push(`FRESH_HEARTBEATS:${evidence.freshHeartbeats}/112`);
  if (evidence.knownWorkerIdentities < 1) blockers.push('KNOWN_WORKER_IDENTITIES:0');
  if (evidence.deployedConcurrency < 112) blockers.push(`DEPLOYED_CONCURRENCY:${evidence.deployedConcurrency}/112`);
  if (evidence.mutationAuthorities !== 1) blockers.push(`MUTATION_AUTHORITIES:${evidence.mutationAuthorities}/1`);
  if (evidence.queueBackend !== 'postgres_atomic') blockers.push(`QUEUE_BACKEND:${evidence.queueBackend || 'unknown'}`);
  if (evidence.staleAgents !== 0) blockers.push(`STALE_AGENTS:${evidence.staleAgents}`);
  if (evidence.blockedAgents !== 0) blockers.push(`BLOCKED_AGENTS:${evidence.blockedAgents}`);
  if (evidence.emergencyStop) blockers.push('EMERGENCY_STOP_ACTIVE');
  return { certified: blockers.length === 0, requiredAgents: 112, blockers };
}
