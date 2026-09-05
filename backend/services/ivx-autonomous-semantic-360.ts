import { readFile } from 'node:fs/promises';
import {
  createTask,
  getAllTasks,
  type Task,
} from './ivx-autonomous-task-engine';
import { containPath, resolveRepoRoot } from './ivx-agent-engineering-tools';
import { getOpenTasks, type ImprovementTask } from './ivx-self-improvement';
import { getIntelligenceState } from './ivx-global-opportunity-intelligence';
import { getSelfUpgradeStatus } from './ivx-daily-self-upgrade';

export const IVX_AUTONOMOUS_SEMANTIC_360_MARKER = 'ivx-autonomous-semantic-360-v1-2026-09-05';

export type SemanticSeverity = 'critical' | 'high' | 'medium' | 'low';
export type SemanticEdgeKind = 'runtime' | 'feedback' | 'evidence' | 'repair' | 'reporting' | 'scheduler';

export type SemanticCapabilityEdge = {
  id: string;
  from: string;
  to: string;
  producerFile: string;
  consumerFile: string;
  requiredTokens: readonly string[];
  kind: SemanticEdgeKind;
  severity: SemanticSeverity;
  certificationRequired: boolean;
  repairTarget: string;
  description: string;
};

/**
 * The semantic graph answers a different question from the existing 360
 * inventory. The inventory asks "does this route/workflow/file exist?". These
 * contracts ask "does the capability feed the system that is supposed to use
 * it?". This catches orphaned schedulers, disconnected feedback loops and
 * capabilities that are individually green but not connected end-to-end.
 */
export const IVX_SEMANTIC_360_EDGES: readonly SemanticCapabilityEdge[] = [
  {
    id: 'manager_to_runtime',
    from: 'Autonomous Manager',
    to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-work-manager.ts',
    consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-work-manager', 'ensureAutonomousManagerBacklog'],
    kind: 'runtime', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    description: 'The manager must actively feed the 112-agent runtime, not exist as an isolated service.',
  },
  {
    id: 'decision_quality_to_runtime',
    from: 'Decision Quality',
    to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-decision-quality.ts',
    consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-decision-quality', 'runAutonomousDecisionQualityLoop'],
    kind: 'feedback', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    description: 'Outcome learning must execute before normal planning so weak outcomes change future work.',
  },
  {
    id: 'semantic_360_to_runtime',
    from: 'Semantic 360',
    to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-semantic-360.ts',
    consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-semantic-360', 'runAutonomousSemantic360'],
    kind: 'feedback', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    description: 'The semantic graph must run continuously, not only exist as documentation or CI.',
  },
  {
    id: 'self_improvement_to_semantic_360',
    from: 'Legacy Self-Improvement',
    to: 'Autonomous durable queue',
    producerFile: 'backend/services/ivx-self-improvement.ts',
    consumerFile: 'backend/services/ivx-autonomous-semantic-360.ts',
    requiredTokens: ['ivx-self-improvement', 'getOpenTasks'],
    kind: 'feedback', severity: 'high', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360.ts',
    description: 'Observed failure/improvement tasks must be bridged into the same durable queue used by Autonomous Manager.',
  },
  {
    id: 'global_intelligence_visibility',
    from: 'Global Opportunity Intelligence',
    to: 'Semantic 360',
    producerFile: 'backend/services/ivx-global-opportunity-intelligence.ts',
    consumerFile: 'backend/services/ivx-autonomous-semantic-360.ts',
    requiredTokens: ['ivx-global-opportunity-intelligence', 'getIntelligenceState'],
    kind: 'reporting', severity: 'medium', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360.ts',
    description: '360 must know whether the intelligence engine is enabled, running and producing records.',
  },
  {
    id: 'self_upgrade_visibility',
    from: 'Daily Self-Upgrade',
    to: 'Semantic 360',
    producerFile: 'backend/services/ivx-daily-self-upgrade.ts',
    consumerFile: 'backend/services/ivx-autonomous-semantic-360.ts',
    requiredTokens: ['ivx-daily-self-upgrade', 'getSelfUpgradeStatus'],
    kind: 'reporting', severity: 'medium', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360.ts',
    description: '360 must expose self-upgrade state instead of treating it as an invisible separate subsystem.',
  },
  {
    id: 'research_hour_evidence',
    from: '112 Self-Upgrade Research Hour',
    to: 'Evidence Ledger',
    producerFile: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml',
    consumerFile: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml',
    requiredTokens: ['ivx-112-self-upgrade-summary.json', 'actions/upload-artifact@v4'],
    kind: 'evidence', severity: 'high', certificationRequired: true,
    repairTarget: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml',
    description: 'Research is only real when its measured runs and evidence survive the workflow as an auditable artifact.',
  },
  {
    id: 'nervous_to_repair_worker',
    from: 'Nervous System',
    to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/ivx-autonomous-nervous-system.yml',
    consumerFile: '.github/workflows/ivx-autonomous-nervous-system.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'Delegate safe self-heal'],
    kind: 'repair', severity: 'critical', certificationRequired: true,
    repairTarget: '.github/workflows/ivx-autonomous-nervous-system.yml',
    description: 'Nervous must do more than sense health; safe incidents must reach the bounded repair worker.',
  },
  {
    id: 'radar_to_repair_worker',
    from: 'Predictive Radar',
    to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/ivx-autonomous-radar-self-heal.yml',
    consumerFile: '.github/workflows/ivx-autonomous-radar-self-heal.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'closed-loop self-heal'],
    kind: 'repair', severity: 'critical', certificationRequired: true,
    repairTarget: '.github/workflows/ivx-autonomous-radar-self-heal.yml',
    description: 'Radar must turn real warnings/failures into bounded repair missions rather than only report them.',
  },
  {
    id: 'control_tower_to_repair_worker',
    from: 'Internal + External 360 Control Tower',
    to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/autonomous-internal-external-e2e.yml',
    consumerFile: '.github/workflows/autonomous-internal-external-e2e.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'Delegate bounded end-to-end repair mission'],
    kind: 'repair', severity: 'critical', certificationRequired: true,
    repairTarget: '.github/workflows/autonomous-internal-external-e2e.yml',
    description: 'Inside/outside failures must produce a bounded repair mission and exact-SHA re-verification.',
  },
  {
    id: 'manager_to_durable_task_engine',
    from: 'Autonomous Manager',
    to: 'Durable Task Engine',
    producerFile: 'backend/services/ivx-autonomous-work-manager.ts',
    consumerFile: 'backend/services/ivx-autonomous-work-manager.ts',
    requiredTokens: ['ivx-autonomous-task-engine', 'createTask'],
    kind: 'runtime', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-work-manager.ts',
    description: 'Manager-created work must enter the durable state machine, never an isolated in-memory list.',
  },
  {
    id: 'self_upgrade_runtime_scheduler_boot',
    from: 'Daily Self-Upgrade Scheduler',
    to: 'Backend Boot',
    producerFile: 'backend/services/ivx-daily-self-upgrade.ts',
    consumerFile: 'server.ts',
    requiredTokens: ['startSelfUpgradeScheduler'],
    kind: 'scheduler', severity: 'medium', certificationRequired: false,
    repairTarget: 'server.ts',
    description: 'Defined scheduler has no proven boot consumer. This is advisory because enabling it has SMS/voice/API-cost side effects and must not be silently activated.',
  },
  {
    id: 'global_intelligence_runtime_ticker_boot',
    from: 'Global Intelligence Ticker',
    to: 'Backend Boot',
    producerFile: 'backend/services/ivx-global-opportunity-intelligence.ts',
    consumerFile: 'server.ts',
    requiredTokens: ['startIntelligenceTicker'],
    kind: 'scheduler', severity: 'medium', certificationRequired: false,
    repairTarget: 'server.ts',
    description: 'Defined intelligence ticker has no proven boot consumer. This is advisory because enabling recurring AI/web searches can create external API cost and duplication.',
  },
] as const;

export type SemanticEdgeAssessment = SemanticCapabilityEdge & {
  producerPresent: boolean;
  consumerPresent: boolean;
  connected: boolean;
  missingTokens: string[];
};

export type Semantic360Snapshot = {
  marker: string;
  sourceSha: string;
  generatedAt: string;
  totalEdges: number;
  connectedEdges: number;
  requiredEdges: number;
  requiredConnectedEdges: number;
  semanticCoveragePct: number;
  requiredCoveragePct: number;
  certificationReady: boolean;
  edges: SemanticEdgeAssessment[];
  disconnectedRequired: string[];
  advisoryDisconnected: string[];
  runtimeSignals: {
    selfImprovementOpenTasks: number;
    globalIntelligenceEnabled: boolean;
    globalIntelligenceLastRunAt: string | null;
    globalIntelligenceTotalRecords: number;
    selfUpgradeIntervalHours: number;
    selfUpgradeLastUpgrade: unknown;
    selfUpgradeAIConfigured: boolean;
  };
};

export type Semantic360RunResult = {
  ok: boolean;
  snapshot: Semantic360Snapshot;
  bridgedImprovementTaskIds: string[];
  semanticRepairTaskIds: string[];
  error: string | null;
};

let lastRun: Semantic360RunResult | null = null;
let lastRunAtMs = 0;
let inFlight: Promise<Semantic360RunResult> | null = null;

export function evaluateSemanticContracts(files: Readonly<Record<string, string | null | undefined>>): SemanticEdgeAssessment[] {
  return IVX_SEMANTIC_360_EDGES.map((edge) => {
    const producer = files[edge.producerFile];
    const consumer = files[edge.consumerFile];
    const missingTokens = edge.requiredTokens.filter((token) => !consumer?.includes(token));
    return {
      ...edge,
      producerPresent: typeof producer === 'string',
      consumerPresent: typeof consumer === 'string',
      connected: typeof producer === 'string' && typeof consumer === 'string' && missingTokens.length === 0,
      missingTokens,
    };
  });
}

async function readRepoFile(rel: string): Promise<string | null> {
  try {
    const root = resolveRepoRoot();
    const abs = await containPath(root, rel);
    return await readFile(abs, 'utf8');
  } catch {
    return null;
  }
}

async function loadSemanticFiles(): Promise<Record<string, string | null>> {
  const paths = [...new Set(IVX_SEMANTIC_360_EDGES.flatMap((edge) => [edge.producerFile, edge.consumerFile]))];
  const entries = await Promise.all(paths.map(async (rel) => [rel, await readRepoFile(rel)] as const));
  return Object.fromEntries(entries);
}

function taskTypeForImprovement(task: ImprovementTask): Task['taskType'] {
  if (task.category === 'security_gap') return 'security';
  if (task.category === 'deployment_incident') return 'deployment';
  if (task.category === 'performance_regression' || task.category === 'user_feedback') return 'qa';
  return 'development';
}

function priorityForImprovement(task: ImprovementTask): Task['priority'] {
  return task.severity;
}

async function bridgeLegacyImprovementTasks(openTasks: ImprovementTask[]): Promise<string[]> {
  const all = await getAllTasks();
  const created: string[] = [];
  for (const improvement of openTasks.slice(0, 8)) {
    const key = `semantic360:self-improvement:${improvement.id}`;
    if (all.some((task) => task.idempotencyKey === key && task.state !== 'CANCELLED' && task.state !== 'EXPIRED')) continue;
    const result = await createTask({
      title: `Self-improvement: ${improvement.title}`,
      description: `SEMANTIC_360 bridge from legacy self-improvement into Autonomous Manager durable queue. Category=${improvement.category}; severity=${improvement.severity}; observed evidence=${improvement.evidence}. ${improvement.description}`,
      taskType: taskTypeForImprovement(improvement),
      idempotencyKey: key,
      priority: priorityForImprovement(improvement),
    });
    if (result.ok && result.task && !result.duplicate) created.push(result.task.taskId);
  }
  return created;
}

async function materializeSemanticGaps(sourceSha: string, assessments: SemanticEdgeAssessment[]): Promise<string[]> {
  const all = await getAllTasks();
  const created: string[] = [];
  const gaps = assessments
    .filter((edge) => !edge.connected)
    .sort((a, b) => Number(b.certificationRequired) - Number(a.certificationRequired));

  for (const edge of gaps.slice(0, 8)) {
    const key = `semantic360:${sourceSha}:${edge.id}`;
    if (all.some((task) => task.idempotencyKey === key && task.state !== 'CANCELLED' && task.state !== 'EXPIRED')) continue;
    const result = await createTask({
      title: `Semantic 360 gap: ${edge.from} -> ${edge.to}`,
      description: `AUTONOMOUS SEMANTIC 360 detected a real integration gap at source SHA ${sourceSha}. ${edge.description} Producer=${edge.producerFile}; consumer=${edge.consumerFile}; missing=${edge.missingTokens.join(', ') || 'file missing'}. Inspect the real integration, repair only if safe, attach evidence, and require independent QA. Advisory scheduler gaps must not be activated automatically when they can trigger SMS/voice, external search cost, privileged writes or other material side effects.`,
      taskType: edge.kind === 'repair' || edge.kind === 'scheduler' ? 'qa' : 'development',
      idempotencyKey: key,
      priority: edge.severity,
    });
    if (result.ok && result.task && !result.duplicate) created.push(result.task.taskId);
  }
  return created;
}

async function buildSnapshot(sourceSha: string): Promise<{ snapshot: Semantic360Snapshot; openImprovementTasks: ImprovementTask[] }> {
  const [files, openImprovementTasks, intelligenceState] = await Promise.all([
    loadSemanticFiles(),
    getOpenTasks().catch(() => [] as ImprovementTask[]),
    getIntelligenceState().catch(() => null),
  ]);
  const selfUpgrade = getSelfUpgradeStatus();
  const edges = evaluateSemanticContracts(files);
  const required = edges.filter((edge) => edge.certificationRequired);
  const connected = edges.filter((edge) => edge.connected);
  const requiredConnected = required.filter((edge) => edge.connected);
  const snapshot: Semantic360Snapshot = {
    marker: IVX_AUTONOMOUS_SEMANTIC_360_MARKER,
    sourceSha,
    generatedAt: new Date().toISOString(),
    totalEdges: edges.length,
    connectedEdges: connected.length,
    requiredEdges: required.length,
    requiredConnectedEdges: requiredConnected.length,
    semanticCoveragePct: edges.length ? Math.round((connected.length / edges.length) * 1000) / 10 : 0,
    requiredCoveragePct: required.length ? Math.round((requiredConnected.length / required.length) * 1000) / 10 : 0,
    certificationReady: requiredConnected.length === required.length,
    edges,
    disconnectedRequired: required.filter((edge) => !edge.connected).map((edge) => edge.id),
    advisoryDisconnected: edges.filter((edge) => !edge.connected && !edge.certificationRequired).map((edge) => edge.id),
    runtimeSignals: {
      selfImprovementOpenTasks: openImprovementTasks.length,
      globalIntelligenceEnabled: intelligenceState?.enabled === true,
      globalIntelligenceLastRunAt: intelligenceState?.lastRunAt ?? null,
      globalIntelligenceTotalRecords: intelligenceState?.totalRecords ?? 0,
      selfUpgradeIntervalHours: Number(selfUpgrade.intervalHours ?? 0),
      selfUpgradeLastUpgrade: selfUpgrade.lastUpgrade ?? null,
      selfUpgradeAIConfigured: selfUpgrade.capabilities.aiBrainUpgrade === true,
    },
  };
  return { snapshot, openImprovementTasks };
}

async function execute(sourceSha: string): Promise<Semantic360RunResult> {
  try {
    const { snapshot, openImprovementTasks } = await buildSnapshot(sourceSha);
    const bridgedImprovementTaskIds = await bridgeLegacyImprovementTasks(openImprovementTasks);
    const semanticRepairTaskIds = await materializeSemanticGaps(sourceSha, snapshot.edges);
    const result: Semantic360RunResult = {
      ok: snapshot.certificationReady,
      snapshot,
      bridgedImprovementTaskIds,
      semanticRepairTaskIds,
      error: null,
    };
    lastRun = result;
    lastRunAtMs = Date.now();
    return result;
  } catch (error) {
    const empty: Semantic360Snapshot = {
      marker: IVX_AUTONOMOUS_SEMANTIC_360_MARKER,
      sourceSha,
      generatedAt: new Date().toISOString(),
      totalEdges: IVX_SEMANTIC_360_EDGES.length,
      connectedEdges: 0,
      requiredEdges: IVX_SEMANTIC_360_EDGES.filter((edge) => edge.certificationRequired).length,
      requiredConnectedEdges: 0,
      semanticCoveragePct: 0,
      requiredCoveragePct: 0,
      certificationReady: false,
      edges: [],
      disconnectedRequired: IVX_SEMANTIC_360_EDGES.filter((edge) => edge.certificationRequired).map((edge) => edge.id),
      advisoryDisconnected: IVX_SEMANTIC_360_EDGES.filter((edge) => !edge.certificationRequired).map((edge) => edge.id),
      runtimeSignals: {
        selfImprovementOpenTasks: 0,
        globalIntelligenceEnabled: false,
        globalIntelligenceLastRunAt: null,
        globalIntelligenceTotalRecords: 0,
        selfUpgradeIntervalHours: 0,
        selfUpgradeLastUpgrade: null,
        selfUpgradeAIConfigured: false,
      },
    };
    const result: Semantic360RunResult = {
      ok: false,
      snapshot: empty,
      bridgedImprovementTaskIds: [],
      semanticRepairTaskIds: [],
      error: error instanceof Error ? error.message : String(error),
    };
    lastRun = result;
    lastRunAtMs = Date.now();
    return result;
  }
}

/**
 * Runs the semantic 360 patrol at most every five minutes unless forced. It is
 * intentionally fail-closed for required edges, but advisory scheduler gaps do
 * not silently enable side-effectful jobs. Instead they become explicit work
 * blocks for Autonomous Manager and independent QA.
 */
export async function runAutonomousSemantic360(sourceSha: string, force = false): Promise<Semantic360RunResult> {
  const intervalMs = 5 * 60_000;
  if (!force && lastRun && Date.now() - lastRunAtMs < intervalMs) return lastRun;
  if (inFlight) return inFlight;
  inFlight = execute(sourceSha).finally(() => { inFlight = null; });
  return inFlight;
}

export function getAutonomousSemantic360Status() {
  return {
    marker: IVX_AUTONOMOUS_SEMANTIC_360_MARKER,
    mode: 'INSIDE_OUTSIDE_PLUS_SEMANTIC_CAPABILITY_GRAPH',
    running: Boolean(inFlight),
    lastRunAt: lastRunAtMs ? new Date(lastRunAtMs).toISOString() : null,
    lastRun,
    policy: '360 means existence + runtime health + semantic connection. Required disconnected capabilities fail closed and become real durable work blocks. Side-effectful scheduler gaps are visible but never auto-enabled without safe evidence/owner policy.',
  };
}
