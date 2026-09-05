import { basename, dirname, relative, resolve } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import {
  createTask,
  getAllTasks,
  type Task,
} from './ivx-autonomous-task-engine';
import { resolveRepoRoot } from './ivx-agent-engineering-tools';
import { getOpenTasks, type ImprovementTask } from './ivx-self-improvement';
import { getIntelligenceState } from './ivx-global-opportunity-intelligence';
import { getSelfUpgradeStatus } from './ivx-daily-self-upgrade';

export const IVX_AUTONOMOUS_SEMANTIC_360_MARKER = 'ivx-autonomous-semantic-360-v2-2026-09-05';

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
 * Runtime-required edges must be observable from the deployed backend image.
 * Workflow-only edges were already exact-head CI certified before merge; Render
 * root-directory deployments are not required to ship `.github/` source files.
 */
export const IVX_SEMANTIC_360_EDGES: readonly SemanticCapabilityEdge[] = [
  {
    id: 'manager_to_runtime', from: 'Autonomous Manager', to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-work-manager.ts', consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-work-manager', 'ensureAutonomousManagerBacklog'], kind: 'runtime', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts', description: 'The manager must actively feed the 112-agent runtime.',
  },
  {
    id: 'decision_quality_to_runtime', from: 'Decision Quality', to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-decision-quality.ts', consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-decision-quality', 'runAutonomousDecisionQualityLoop'], kind: 'feedback', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts', description: 'Outcome learning must execute before normal planning.',
  },
  {
    id: 'semantic_360_to_runtime', from: 'Semantic 360', to: '112 Runtime Enforcer',
    producerFile: 'backend/services/ivx-autonomous-semantic-360.ts', consumerFile: 'backend/services/ivx-autonomous-runtime-enforcer.ts',
    requiredTokens: ['ivx-autonomous-semantic-360', 'runAutonomousSemantic360'], kind: 'feedback', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-runtime-enforcer.ts', description: 'Semantic 360 must execute continuously in runtime.',
  },
  {
    id: 'self_improvement_to_semantic_360', from: 'Legacy Self-Improvement', to: 'Autonomous durable queue',
    producerFile: 'backend/services/ivx-self-improvement.ts', consumerFile: 'backend/services/ivx-autonomous-semantic-360.ts',
    requiredTokens: ['ivx-autonomous-semantic-360-v2'], kind: 'feedback', severity: 'high', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360.ts', description: 'Legacy improvement findings must be bridged into the durable task queue.',
  },
  {
    id: 'global_intelligence_visibility', from: 'Global Opportunity Intelligence', to: 'Semantic 360',
    producerFile: 'backend/services/ivx-global-opportunity-intelligence.ts', consumerFile: 'backend/services/ivx-autonomous-semantic-360-v2.ts',
    requiredTokens: ['ivx-global-opportunity-intelligence', 'getIntelligenceState'], kind: 'reporting', severity: 'medium', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360-v2.ts', description: '360 must expose live intelligence state.',
  },
  {
    id: 'self_upgrade_visibility', from: 'Daily Self-Upgrade', to: 'Semantic 360',
    producerFile: 'backend/services/ivx-daily-self-upgrade.ts', consumerFile: 'backend/services/ivx-autonomous-semantic-360-v2.ts',
    requiredTokens: ['ivx-daily-self-upgrade', 'getSelfUpgradeStatus'], kind: 'reporting', severity: 'medium', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-semantic-360-v2.ts', description: '360 must expose live self-upgrade state.',
  },
  {
    id: 'manager_to_durable_task_engine', from: 'Autonomous Manager', to: 'Durable Task Engine',
    producerFile: 'backend/services/ivx-autonomous-work-manager.ts', consumerFile: 'backend/services/ivx-autonomous-work-manager.ts',
    requiredTokens: ['ivx-autonomous-task-engine', 'createTask'], kind: 'runtime', severity: 'critical', certificationRequired: true,
    repairTarget: 'backend/services/ivx-autonomous-work-manager.ts', description: 'Manager work must enter the durable task state machine.',
  },
  {
    id: 'research_hour_evidence', from: '112 Self-Upgrade Research Hour', to: 'Evidence Ledger',
    producerFile: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml', consumerFile: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml',
    requiredTokens: ['ivx-112-self-upgrade-summary.json', 'actions/upload-artifact@v4'], kind: 'evidence', severity: 'high', certificationRequired: false,
    repairTarget: '.github/workflows/ivx-112-daily-self-upgrade-hour.yml', description: 'Static workflow edge: exact-head CI source evidence, not a Render runtime-image gate.',
  },
  {
    id: 'nervous_to_repair_worker', from: 'Nervous System', to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/ivx-autonomous-nervous-system.yml', consumerFile: '.github/workflows/ivx-autonomous-nervous-system.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'Delegate safe self-heal'], kind: 'repair', severity: 'critical', certificationRequired: false,
    repairTarget: '.github/workflows/ivx-autonomous-nervous-system.yml', description: 'Static workflow edge: exact-head CI source evidence, not a Render runtime-image gate.',
  },
  {
    id: 'radar_to_repair_worker', from: 'Predictive Radar', to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/ivx-autonomous-radar-self-heal.yml', consumerFile: '.github/workflows/ivx-autonomous-radar-self-heal.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'closed-loop self-heal'], kind: 'repair', severity: 'critical', certificationRequired: false,
    repairTarget: '.github/workflows/ivx-autonomous-radar-self-heal.yml', description: 'Static workflow edge: exact-head CI source evidence, not a Render runtime-image gate.',
  },
  {
    id: 'control_tower_to_repair_worker', from: 'Internal + External 360 Control Tower', to: 'Senior Developer Repair Worker',
    producerFile: '.github/workflows/autonomous-internal-external-e2e.yml', consumerFile: '.github/workflows/autonomous-internal-external-e2e.yml',
    requiredTokens: ['/api/ivx/senior-developer/worker/jobs', 'Delegate bounded end-to-end repair mission'], kind: 'repair', severity: 'critical', certificationRequired: false,
    repairTarget: '.github/workflows/autonomous-internal-external-e2e.yml', description: 'Static workflow edge: exact-head CI source evidence, not a Render runtime-image gate.',
  },
  {
    id: 'self_upgrade_runtime_scheduler_boot', from: 'Daily Self-Upgrade Scheduler', to: 'Backend Boot',
    producerFile: 'backend/services/ivx-daily-self-upgrade.ts', consumerFile: 'server.ts',
    requiredTokens: ['startSelfUpgradeScheduler'], kind: 'scheduler', severity: 'medium', certificationRequired: false,
    repairTarget: 'server.ts', description: 'Advisory: enabling can create SMS/voice/API side effects and must not be silently activated.',
  },
  {
    id: 'global_intelligence_runtime_ticker_boot', from: 'Global Intelligence Ticker', to: 'Backend Boot',
    producerFile: 'backend/services/ivx-global-opportunity-intelligence.ts', consumerFile: 'server.ts',
    requiredTokens: ['startIntelligenceTicker'], kind: 'scheduler', severity: 'medium', certificationRequired: false,
    repairTarget: 'server.ts', description: 'Advisory: recurring AI/web search can create cost and duplication.',
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
    projectRootMode: string;
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
    return { ...edge, producerPresent: typeof producer === 'string', consumerPresent: typeof consumer === 'string', connected: typeof producer === 'string' && typeof consumer === 'string' && missingTokens.length === 0, missingTokens };
  });
}

export function semanticRootCandidates(startDir: string = process.cwd()): string[] {
  const discovered = resolveRepoRoot(startDir);
  const values = [discovered, startDir];
  for (const value of [...values]) if (basename(resolve(value)) === 'backend') values.push(dirname(resolve(value)));
  return [...new Set(values.map((value) => resolve(value)))];
}

function variantsForRoot(root: string, relPath: string): string[] {
  const variants = [relPath];
  if (basename(root) === 'backend' && relPath.startsWith('backend/')) variants.push(relPath.slice('backend/'.length));
  return [...new Set(variants)];
}

async function readProjectFile(relPath: string): Promise<string | null> {
  for (const root of semanticRootCandidates()) {
    for (const variant of variantsForRoot(root, relPath)) {
      const abs = resolve(root, variant);
      const rel = relative(root, abs);
      if (rel.startsWith('..') || rel === '' && variant !== '.') continue;
      try {
        const info = await stat(abs);
        if (!info.isFile()) continue;
        return await readFile(abs, 'utf8');
      } catch {
        // Try the next safe production/repository layout candidate.
      }
    }
  }
  return null;
}

async function loadSemanticFiles(): Promise<Record<string, string | null>> {
  const paths = [...new Set(IVX_SEMANTIC_360_EDGES.flatMap((edge) => [edge.producerFile, edge.consumerFile]))];
  const entries = await Promise.all(paths.map(async (rel) => [rel, await readProjectFile(rel)] as const));
  return Object.fromEntries(entries);
}

function taskTypeForImprovement(task: ImprovementTask): Task['taskType'] {
  if (task.category === 'security_gap') return 'security';
  if (task.category === 'deployment_incident') return 'deployment';
  if (task.category === 'performance_regression' || task.category === 'user_feedback') return 'qa';
  return 'development';
}

async function bridgeLegacyImprovementTasks(openTasks: ImprovementTask[]): Promise<string[]> {
  const all = await getAllTasks();
  const created: string[] = [];
  for (const improvement of openTasks.slice(0, 8)) {
    const key = `semantic360:self-improvement:${improvement.id}`;
    if (all.some((task) => task.idempotencyKey === key && task.state !== 'CANCELLED' && task.state !== 'EXPIRED')) continue;
    const result = await createTask({
      title: `Self-improvement: ${improvement.title}`,
      description: `SEMANTIC_360 bridge into the Autonomous durable queue. Category=${improvement.category}; severity=${improvement.severity}; evidence=${improvement.evidence}. ${improvement.description}`,
      taskType: taskTypeForImprovement(improvement),
      idempotencyKey: key,
      priority: improvement.severity,
    });
    if (result.ok && result.task && !result.duplicate) created.push(result.task.taskId);
  }
  return created;
}

async function materializeRequiredGaps(sourceSha: string, edges: SemanticEdgeAssessment[]): Promise<string[]> {
  const all = await getAllTasks();
  const created: string[] = [];
  for (const edge of edges.filter((item) => item.certificationRequired && !item.connected).slice(0, 8)) {
    const key = `semantic360:${sourceSha}:${edge.id}`;
    if (all.some((task) => task.idempotencyKey === key && task.state !== 'CANCELLED' && task.state !== 'EXPIRED')) continue;
    const result = await createTask({
      title: `Semantic 360 runtime gap: ${edge.from} -> ${edge.to}`,
      description: `Required runtime semantic connection is missing at ${sourceSha}. Producer=${edge.producerFile}; consumer=${edge.consumerFile}; missing=${edge.missingTokens.join(', ') || 'source file unavailable'}. Repair with fresh evidence and independent QA.`,
      taskType: 'qa',
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
  const roots = semanticRootCandidates();
  const snapshot: Semantic360Snapshot = {
    marker: IVX_AUTONOMOUS_SEMANTIC_360_MARKER,
    sourceSha,
    generatedAt: new Date().toISOString(),
    totalEdges: edges.length,
    connectedEdges: connected.length,
    requiredEdges: required.length,
    requiredConnectedEdges: requiredConnected.length,
    semanticCoveragePct: edges.length ? Math.round(connected.length / edges.length * 1000) / 10 : 0,
    requiredCoveragePct: required.length ? Math.round(requiredConnected.length / required.length * 1000) / 10 : 0,
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
      projectRootMode: roots.map((root) => basename(root)).join(' -> '),
    },
  };
  return { snapshot, openImprovementTasks };
}

async function execute(sourceSha: string): Promise<Semantic360RunResult> {
  try {
    const { snapshot, openImprovementTasks } = await buildSnapshot(sourceSha);
    const bridgedImprovementTaskIds = await bridgeLegacyImprovementTasks(openImprovementTasks);
    const semanticRepairTaskIds = await materializeRequiredGaps(sourceSha, snapshot.edges);
    const result: Semantic360RunResult = { ok: snapshot.certificationReady, snapshot, bridgedImprovementTaskIds, semanticRepairTaskIds, error: null };
    lastRun = result;
    lastRunAtMs = Date.now();
    return result;
  } catch (error) {
    const requiredIds = IVX_SEMANTIC_360_EDGES.filter((edge) => edge.certificationRequired).map((edge) => edge.id);
    const snapshot: Semantic360Snapshot = {
      marker: IVX_AUTONOMOUS_SEMANTIC_360_MARKER, sourceSha, generatedAt: new Date().toISOString(), totalEdges: IVX_SEMANTIC_360_EDGES.length,
      connectedEdges: 0, requiredEdges: requiredIds.length, requiredConnectedEdges: 0, semanticCoveragePct: 0, requiredCoveragePct: 0, certificationReady: false,
      edges: [], disconnectedRequired: requiredIds, advisoryDisconnected: IVX_SEMANTIC_360_EDGES.filter((edge) => !edge.certificationRequired).map((edge) => edge.id),
      runtimeSignals: { selfImprovementOpenTasks: 0, globalIntelligenceEnabled: false, globalIntelligenceLastRunAt: null, globalIntelligenceTotalRecords: 0, selfUpgradeIntervalHours: 0, selfUpgradeLastUpgrade: null, selfUpgradeAIConfigured: false, projectRootMode: 'unavailable' },
    };
    const result: Semantic360RunResult = { ok: false, snapshot, bridgedImprovementTaskIds: [], semanticRepairTaskIds: [], error: error instanceof Error ? error.message : String(error) };
    lastRun = result;
    lastRunAtMs = Date.now();
    return result;
  }
}

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
    mode: 'INSIDE_OUTSIDE_PLUS_RUNTIME_SEMANTIC_CAPABILITY_GRAPH',
    running: Boolean(inFlight),
    lastRunAt: lastRunAtMs ? new Date(lastRunAtMs).toISOString() : null,
    lastRun,
    policy: 'Runtime-required edges fail closed. Workflow-only source edges are exact-head CI evidence and advisory in Render because a root-directory runtime image is not required to contain .github source. Required disconnected runtime capabilities become durable work blocks.',
  };
}
