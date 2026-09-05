import { stat } from 'node:fs/promises';
import {
  createTask,
  getAllTasks,
  validateCompletion,
  type Task,
} from './ivx-autonomous-task-engine';
import { containPath, resolveRepoRoot } from './ivx-agent-engineering-tools';

export const IVX_AUTONOMOUS_DECISION_QUALITY_MARKER = 'ivx-autonomous-decision-quality-v1-2026-09-05';
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = DAY_MS;
const MAX_CORRECTIVE_TASKS_PER_LOOP = 6;

export type DecisionDomainId =
  | 'architecture'
  | 'backend'
  | 'mobile_web'
  | 'database'
  | 'auth_security'
  | 'qa_e2e'
  | 'performance'
  | 'deployment'
  | 'monitoring'
  | 'media';

export type DecisionDomainDefinition = {
  id: DecisionDomainId;
  label: string;
  match: RegExp;
  taskType: Task['taskType'];
  priority: Task['priority'];
  auditTargets: readonly string[];
};

/**
 * Global operating surface. These are real system domains, not narrative labels.
 * The feedback loop measures recent evidence in each domain and creates a real
 * code/file audit block when a domain has no recent evidence-backed activity.
 */
export const IVX_DECISION_DOMAINS: readonly DecisionDomainDefinition[] = [
  {
    id: 'architecture', label: 'Architecture', taskType: 'development', priority: 'medium',
    match: /architecture|system design|orchestrat|router|server\.ts|control plane/i,
    auditTargets: ['server.ts', 'backend/server.ts', 'backend/services/ivx-task-orchestrator.ts'],
  },
  {
    id: 'backend', label: 'Backend/API', taskType: 'development', priority: 'medium',
    match: /backend\/|\bapi\b|business logic|service/i,
    auditTargets: ['backend/server.ts', 'backend/services/ivx-autonomous-task-engine.ts', 'backend/api/ivx-autonomous-task-engine-api.ts'],
  },
  {
    id: 'mobile_web', label: 'Expo/Mobile/Web', taskType: 'qa', priority: 'medium',
    match: /expo\/|android|ios|react native|mobile|frontend|web/i,
    auditTargets: ['expo/app/_layout.tsx', 'expo/app/index.tsx', 'expo/package.json'],
  },
  {
    id: 'database', label: 'Database/Supabase', taskType: 'qa', priority: 'high',
    match: /supabase|postgres|database|migration|\brls\b|\.sql\b/i,
    auditTargets: ['supabase/config.toml', 'backend/services/ivx-durable-store.ts', 'backend/services/ivx-autonomous-task-engine.ts'],
  },
  {
    id: 'auth_security', label: 'Auth/Security', taskType: 'security', priority: 'critical',
    match: /auth|security|secret|credential|permission|jwt|oidc|vulnerab/i,
    auditTargets: ['backend/services/ivx-github-actions-oidc.ts', 'backend/services/ivx-repair-policy.ts', '.github/workflows/ivx-secret-scanner.yml'],
  },
  {
    id: 'qa_e2e', label: 'QA/E2E', taskType: 'qa', priority: 'high',
    match: /\bqa\b|\be2e\b|test|playwright|maestro|regression/i,
    auditTargets: ['.github/workflows/ivx-qa-suite.yml', '.github/workflows/ivx-e2e.yml', 'backend/services/ivx-agent-real-engineering-cycle.test.ts'],
  },
  {
    id: 'performance', label: 'Performance', taskType: 'qa', priority: 'medium',
    match: /performance|latency|cache|memory|cpu|throughput|stress/i,
    auditTargets: ['backend/services/ivx-autonomous-runtime-enforcer.ts', 'backend/services/ivx-agent-productivity-verifier.ts'],
  },
  {
    id: 'deployment', label: 'Deployment/Release', taskType: 'deployment', priority: 'critical',
    match: /deploy|render|release|github\/workflows|cloudfront|aws|eas|rollback/i,
    auditTargets: ['.github/workflows/ivx-render-live-cert.yml', '.github/workflows/ivx-112-hard-start-recovery.yml', '.github/workflows/ivx-112-15min-agent-control.yml'],
  },
  {
    id: 'monitoring', label: 'Monitoring/Incident', taskType: 'qa', priority: 'high',
    match: /monitor|health|incident|observab|alert|uptime|log/i,
    auditTargets: ['backend/services/ivx-autonomous-truth-control.ts', 'backend/services/ivx-autonomous-runtime-enforcer.ts'],
  },
  {
    id: 'media', label: 'Media/Reels/Uploads', taskType: 'qa', priority: 'medium',
    match: /media|reel|video|upload|stream|image/i,
    auditTargets: ['expo/app/reels.tsx', 'expo/app/index.tsx', 'backend/server.ts'],
  },
] as const;

export type DecisionQualityRate = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type DecisionDomainScore = {
  id: DecisionDomainId;
  label: string;
  recentTasks: number;
  evidenceBackedTasks: number;
  verifiedTasks: number;
  failedTasks: number;
  covered: boolean;
  score: number;
};

export type AgentDecisionScore = {
  agentNumber: number;
  tasks: number;
  verified: number;
  failed: number;
  retries: number;
  evidenceBacked: number;
  score: number;
};

export type AutonomousDecisionQualitySnapshot = {
  marker: string;
  sourceSha: string;
  generatedAt: string;
  windowHours: number;
  sampleTasks: number;
  verifiedTasks: number;
  failedTasks: number;
  blockedTasks: number;
  retryingTasks: number;
  firstPassRate: DecisionQualityRate;
  evidenceIntegrityRate: DecisionQualityRate;
  testEvidenceRate: DecisionQualityRate;
  productionVerificationRate: DecisionQualityRate;
  falseCompletionRiskRate: DecisionQualityRate;
  meanTimeToRepairHours: number | null;
  ownerInterventionRate: DecisionQualityRate;
  globalCoverageRate: DecisionQualityRate;
  domains: DecisionDomainScore[];
  agentScores: AgentDecisionScore[];
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  priorityDomains: DecisionDomainId[];
  recommendations: string[];
  limitations: string[];
};

export type AutonomousDecisionLoopResult = {
  ok: boolean;
  marker: string;
  sourceSha: string;
  snapshot: AutonomousDecisionQualitySnapshot;
  correctiveTaskIds: string[];
  correctiveTaskKeys: string[];
  skipped: string[];
  error: string | null;
};

let lastSnapshot: AutonomousDecisionQualitySnapshot | null = null;
let lastLoopResult: AutonomousDecisionLoopResult | null = null;
let loopInFlight: Promise<AutonomousDecisionLoopResult> | null = null;
let lastLoopAtMs = 0;

function rate(numerator: number, denominator: number): DecisionQualityRate {
  return { numerator, denominator, rate: denominator > 0 ? numerator / denominator : null };
}

function pct(value: number | null, neutral = 0.5): number {
  return Math.round((value ?? neutral) * 1000) / 10;
}

function timestampMs(task: Task): number {
  return Date.parse(task.updatedAt || task.createdAt || '') || 0;
}

function taskCorpus(task: Task): string {
  return [
    task.title,
    task.description,
    task.idempotencyKey,
    task.assignedEngine ?? '',
    ...task.filesChanged,
    ...task.evidence.map((item) => `${item.source} ${item.summary}`),
  ].join('\n');
}

function isEvidenceBacked(task: Task): boolean {
  return task.evidence.length > 0;
}

function isProductionVerified(task: Task): boolean {
  return Boolean(
    task.deploymentId
    || task.evidence.some((item) => item.evidenceType === 'production_verification' || item.evidenceType === 'deployment_id'),
  );
}

function isTestBacked(task: Task): boolean {
  return task.evidence.some((item) => item.evidenceType === 'test_result' || item.evidenceType === 'device_qa');
}

function scoreAgent(tasks: Task[], agentNumber: number): AgentDecisionScore {
  const mine = tasks.filter((task) => task.assignedAgentNumber === agentNumber);
  const verified = mine.filter((task) => task.state === 'VERIFIED').length;
  const failed = mine.filter((task) => task.state === 'FAILED' || task.state === 'QA_FAILED' || task.state === 'EXPIRED').length;
  const retries = mine.reduce((sum, task) => sum + Math.max(0, task.retryCount), 0);
  const evidenceBacked = mine.filter(isEvidenceBacked).length;
  if (mine.length === 0) return { agentNumber, tasks: 0, verified: 0, failed: 0, retries: 0, evidenceBacked: 0, score: 50 };
  const verifiedRate = verified / mine.length;
  const evidenceRate = evidenceBacked / mine.length;
  const failurePenalty = Math.min(1, failed / mine.length);
  const retryPenalty = Math.min(1, retries / Math.max(1, mine.length * 2));
  const score = Math.max(0, Math.min(100, Math.round((verifiedRate * 55 + evidenceRate * 30 + (1 - failurePenalty) * 10 + (1 - retryPenalty) * 5) * 10) / 10));
  return { agentNumber, tasks: mine.length, verified, failed, retries, evidenceBacked, score };
}

export function classifyTaskDomains(task: Task): DecisionDomainId[] {
  const corpus = taskCorpus(task);
  return IVX_DECISION_DOMAINS.filter((domain) => domain.match.test(corpus)).map((domain) => domain.id);
}

/**
 * Evidence-derived brain score. This does NOT claim human-like IQ. It measures
 * whether Autonomous decisions lead to verified, low-retry, test-backed,
 * production-verified outcomes across the full engineering surface.
 */
export function computeDecisionQualitySnapshot(
  tasks: readonly Task[],
  sourceSha: string,
  nowMs = Date.now(),
  windowMs = DEFAULT_WINDOW_MS,
): AutonomousDecisionQualitySnapshot {
  const recent = tasks.filter((task) => nowMs - timestampMs(task) <= windowMs && timestampMs(task) <= nowMs);
  const verified = recent.filter((task) => task.state === 'VERIFIED');
  const failed = recent.filter((task) => task.state === 'FAILED' || task.state === 'QA_FAILED' || task.state === 'EXPIRED');
  const blocked = recent.filter((task) => task.state === 'BLOCKED');
  const retrying = recent.filter((task) => task.retryCount > 0 || task.state === 'RETRYING');

  const firstPass = rate(verified.filter((task) => task.retryCount === 0).length, verified.length);
  const integrity = rate(verified.filter((task) => validateCompletion(task).verdict === 'VERIFIED').length, verified.length);
  const testEligible = verified.filter((task) => task.taskType === 'development' || task.taskType === 'qa' || task.taskType === 'security');
  const testEvidence = rate(testEligible.filter(isTestBacked).length, testEligible.length);
  const prodEligible = verified.filter((task) => task.taskType === 'development' || task.taskType === 'deployment');
  const productionVerification = rate(prodEligible.filter(isProductionVerified).length, prodEligible.length);
  const falseCompletion = rate(verified.filter((task) => validateCompletion(task).verdict !== 'VERIFIED').length, verified.length);
  const ownerIntervention = rate(recent.filter((task) => Boolean(task.approvalId) || /OWNER_GATE/i.test(task.blocker ?? '')).length, recent.length);

  const repairDurations = verified
    .filter((task) => task.idempotencyKey.startsWith('repair:') && task.startedAt && task.completedAt)
    .map((task) => Math.max(0, Date.parse(task.completedAt as string) - Date.parse(task.startedAt as string)))
    .filter((duration) => Number.isFinite(duration));
  const meanTimeToRepairHours = repairDurations.length > 0
    ? Math.round((repairDurations.reduce((sum, value) => sum + value, 0) / repairDurations.length / 3_600_000) * 100) / 100
    : null;

  const domains = IVX_DECISION_DOMAINS.map((domain): DecisionDomainScore => {
    const domainTasks = recent.filter((task) => domain.match.test(taskCorpus(task)));
    const evidenceBackedTasks = domainTasks.filter(isEvidenceBacked).length;
    const verifiedTasks = domainTasks.filter((task) => task.state === 'VERIFIED').length;
    const failedTasks = domainTasks.filter((task) => task.state === 'FAILED' || task.state === 'QA_FAILED' || task.state === 'EXPIRED').length;
    const covered = evidenceBackedTasks > 0;
    const activity = Math.min(1, domainTasks.length / 3);
    const evidence = domainTasks.length > 0 ? evidenceBackedTasks / domainTasks.length : 0;
    const verifiedRate = domainTasks.length > 0 ? verifiedTasks / domainTasks.length : 0;
    const failurePenalty = domainTasks.length > 0 ? failedTasks / domainTasks.length : 0;
    const score = Math.max(0, Math.min(100, Math.round((activity * 20 + evidence * 35 + verifiedRate * 45 - failurePenalty * 25) * 10) / 10));
    return { id: domain.id, label: domain.label, recentTasks: domainTasks.length, evidenceBackedTasks, verifiedTasks, failedTasks, covered, score };
  });

  const coveredDomains = domains.filter((domain) => domain.covered).length;
  const globalCoverage = rate(coveredDomains, domains.length);

  const agentNumbers = [...new Set(recent.map((task) => task.assignedAgentNumber).filter((value): value is number => value != null))];
  const agentScores = agentNumbers.map((agentNumber) => scoreAgent(recent, agentNumber)).sort((a, b) => b.score - a.score || a.agentNumber - b.agentNumber);

  const qualityComponents = [
    { weight: 0.25, value: integrity.rate ?? 0.5 },
    { weight: 0.20, value: firstPass.rate ?? 0.5 },
    { weight: 0.15, value: testEvidence.rate ?? 0.5 },
    { weight: 0.15, value: productionVerification.rate ?? 0.5 },
    { weight: 0.25, value: globalCoverage.rate ?? 0 },
  ];
  const falseCompletionPenalty = (falseCompletion.rate ?? 0) * 30;
  const failurePenalty = recent.length > 0 ? (failed.length / recent.length) * 20 : 0;
  const overallScore = Math.max(0, Math.min(100, Math.round((qualityComponents.reduce((sum, item) => sum + item.weight * item.value, 0) * 100 - falseCompletionPenalty - failurePenalty) * 10) / 10));
  const grade: AutonomousDecisionQualitySnapshot['grade'] = overallScore >= 90 ? 'A' : overallScore >= 80 ? 'B' : overallScore >= 70 ? 'C' : overallScore >= 60 ? 'D' : 'F';

  const priorityDomains = [...domains]
    .sort((a, b) => Number(a.covered) - Number(b.covered) || a.score - b.score || a.id.localeCompare(b.id))
    .map((domain) => domain.id);

  const recommendations: string[] = [];
  if ((integrity.rate ?? 1) < 0.95) recommendations.push('Raise completion-evidence integrity: VERIFIED tasks must pass the honest completion validator.');
  if ((firstPass.rate ?? 1) < 0.8) recommendations.push('Reduce rework: prioritize root-cause analysis and stronger pre-merge tests for high-retry work.');
  if ((testEvidence.rate ?? 1) < 0.85) recommendations.push('Increase test evidence on development/QA/security outcomes before they influence future routing decisions.');
  if ((productionVerification.rate ?? 1) < 0.9) recommendations.push('Require production verification evidence on development/deployment outcomes before learning them as successful.');
  if ((falseCompletion.rate ?? 0) > 0) recommendations.push('Investigate every VERIFIED task rejected by validateCompletion; false-completion risk must be zero.');
  if ((globalCoverage.rate ?? 0) < 1) recommendations.push(`Close global coverage gaps: ${domains.filter((domain) => !domain.covered).map((domain) => domain.label).join(', ')}.`);

  return {
    marker: IVX_AUTONOMOUS_DECISION_QUALITY_MARKER,
    sourceSha,
    generatedAt: new Date(nowMs).toISOString(),
    windowHours: Math.round(windowMs / 3_600_000),
    sampleTasks: recent.length,
    verifiedTasks: verified.length,
    failedTasks: failed.length,
    blockedTasks: blocked.length,
    retryingTasks: retrying.length,
    firstPassRate: firstPass,
    evidenceIntegrityRate: integrity,
    testEvidenceRate: testEvidence,
    productionVerificationRate: productionVerification,
    falseCompletionRiskRate: falseCompletion,
    meanTimeToRepairHours,
    ownerInterventionRate: ownerIntervention,
    globalCoverageRate: globalCoverage,
    domains,
    agentScores,
    overallScore,
    grade,
    priorityDomains,
    recommendations,
    limitations: [
      'Current task records expose final state, retries and evidence but not a complete historical transition stream; root-cause accuracy is therefore measured through verified repair outcomes and rework signals, not claimed directly.',
      'No metric is treated as intelligence by itself. Scores are operational decision-quality indicators and remain evidence-derived.',
    ],
  };
}

async function firstExistingTarget(candidates: readonly string[]): Promise<string | null> {
  const repoRoot = resolveRepoRoot();
  for (const rel of candidates) {
    try {
      const abs = await containPath(repoRoot, rel);
      const info = await stat(abs);
      if (info.isFile()) return rel;
    } catch {
      // Missing candidate is not a valid work block; continue to a real file.
    }
  }
  return null;
}

function alreadyHasCorrectiveTask(tasks: readonly Task[], key: string): boolean {
  return tasks.some((task) => task.idempotencyKey === key && task.state !== 'CANCELLED' && task.state !== 'EXPIRED');
}

async function createAuditTask(input: {
  key: string;
  title: string;
  description: string;
  target: string;
  taskType: Task['taskType'];
  priority: Task['priority'];
}): Promise<{ taskId: string | null; created: boolean; error: string | null }> {
  const result = await createTask({
    title: `Module audit: ${input.target}`,
    description: `${input.title}. ${input.description} Real target: ${input.target}. This task exists because the latest decision-quality snapshot found an evidence-backed gap; attach fresh evidence and queue repairs for real defects only.`,
    taskType: input.taskType,
    idempotencyKey: input.key,
    priority: input.priority,
  });
  return { taskId: result.task?.taskId ?? null, created: Boolean(result.task && !result.duplicate), error: result.error };
}

async function executeDecisionLoop(sourceSha: string): Promise<AutonomousDecisionLoopResult> {
  try {
    const before = await getAllTasks();
    const snapshot = computeDecisionQualitySnapshot(before, sourceSha);
    lastSnapshot = snapshot;
    const correctiveTaskIds: string[] = [];
    const correctiveTaskKeys: string[] = [];
    const skipped: string[] = [];

    const candidates: Array<{ key: string; title: string; description: string; targetCandidates: readonly string[]; taskType: Task['taskType']; priority: Task['priority'] }> = [];

    for (const domainId of snapshot.priorityDomains) {
      const score = snapshot.domains.find((domain) => domain.id === domainId);
      if (!score || score.covered) continue;
      const definition = IVX_DECISION_DOMAINS.find((domain) => domain.id === domainId)!;
      candidates.push({
        key: `decision-quality:${sourceSha}:coverage:${domainId}`,
        title: `Decision-quality global coverage gap: ${definition.label}`,
        description: `Autonomous found zero recent evidence-backed activity for ${definition.label}; audit the selected real surface, identify actual defects or risks, and produce verifiable evidence.`,
        targetCandidates: definition.auditTargets,
        taskType: definition.taskType,
        priority: definition.priority,
      });
    }

    if ((snapshot.falseCompletionRiskRate.rate ?? 0) > 0 || (snapshot.evidenceIntegrityRate.rate ?? 1) < 0.95) {
      candidates.unshift({
        key: `decision-quality:${sourceSha}:completion-integrity`,
        title: 'Decision-quality corrective audit: completion integrity',
        description: 'Autonomous detected VERIFIED outcomes that are not fully supported by the honest completion validator or evidence integrity is below target.',
        targetCandidates: ['backend/services/ivx-autonomous-task-engine.ts', 'backend/services/ivx-completion-validator.ts'],
        taskType: 'qa',
        priority: 'critical',
      });
    }
    if ((snapshot.firstPassRate.rate ?? 1) < 0.8) {
      candidates.unshift({
        key: `decision-quality:${sourceSha}:first-pass`,
        title: 'Decision-quality corrective audit: rework and first-pass failures',
        description: 'Autonomous detected excessive retries/rework; inspect execution and QA gates for root-cause or test-quality gaps.',
        targetCandidates: ['backend/services/ivx-agent-real-engineering-cycle.ts', '.github/workflows/ivx-qa-suite.yml'],
        taskType: 'qa',
        priority: 'high',
      });
    }
    if ((snapshot.testEvidenceRate.rate ?? 1) < 0.85) {
      candidates.push({
        key: `decision-quality:${sourceSha}:test-evidence`,
        title: 'Decision-quality corrective audit: test evidence',
        description: 'Autonomous detected weak test evidence on verified engineering outcomes; audit the evidence/test gate and repair any real bypass.',
        targetCandidates: ['backend/services/ivx-autonomous-task-engine.ts', '.github/workflows/ivx-qa-suite.yml'],
        taskType: 'qa',
        priority: 'high',
      });
    }
    if ((snapshot.productionVerificationRate.rate ?? 1) < 0.9) {
      candidates.push({
        key: `decision-quality:${sourceSha}:production-verification`,
        title: 'Decision-quality corrective audit: production verification',
        description: 'Autonomous detected verified development/deployment outcomes without enough production verification evidence.',
        targetCandidates: ['backend/services/ivx-completion-validator.ts', '.github/workflows/ivx-render-live-cert.yml'],
        taskType: 'deployment',
        priority: 'critical',
      });
    }

    for (const candidate of candidates) {
      if (correctiveTaskIds.length >= MAX_CORRECTIVE_TASKS_PER_LOOP) break;
      if (alreadyHasCorrectiveTask(before, candidate.key)) {
        skipped.push(`${candidate.key}:existing`);
        continue;
      }
      const target = await firstExistingTarget(candidate.targetCandidates);
      if (!target) {
        skipped.push(`${candidate.key}:no-real-target`);
        continue;
      }
      const created = await createAuditTask({ ...candidate, target });
      if (created.error) {
        skipped.push(`${candidate.key}:error:${created.error}`);
        continue;
      }
      if (created.taskId) {
        correctiveTaskIds.push(created.taskId);
        correctiveTaskKeys.push(candidate.key);
      }
    }

    const result: AutonomousDecisionLoopResult = {
      ok: true,
      marker: IVX_AUTONOMOUS_DECISION_QUALITY_MARKER,
      sourceSha,
      snapshot,
      correctiveTaskIds,
      correctiveTaskKeys,
      skipped,
      error: null,
    };
    lastLoopResult = result;
    lastLoopAtMs = Date.now();
    return result;
  } catch (error) {
    const tasks = await getAllTasks().catch(() => [] as Task[]);
    const snapshot = computeDecisionQualitySnapshot(tasks, sourceSha);
    const result: AutonomousDecisionLoopResult = {
      ok: false,
      marker: IVX_AUTONOMOUS_DECISION_QUALITY_MARKER,
      sourceSha,
      snapshot,
      correctiveTaskIds: [],
      correctiveTaskKeys: [],
      skipped: [],
      error: error instanceof Error ? error.message : String(error),
    };
    lastSnapshot = snapshot;
    lastLoopResult = result;
    lastLoopAtMs = Date.now();
    return result;
  }
}

/**
 * Closed feedback loop: OUTCOME -> MEASURE -> LEARN -> REPRIORITIZE -> new real
 * work blocks. Throttled to avoid creating duplicate planning pressure while the
 * 112-agent continuity loop runs every few seconds.
 */
export async function runAutonomousDecisionQualityLoop(sourceSha: string, force = false): Promise<AutonomousDecisionLoopResult> {
  const minInterval = Math.max(60_000, Math.min(15 * 60_000, Number.parseInt(process.env.IVX_DECISION_QUALITY_INTERVAL_MS ?? '', 10) || 5 * 60_000));
  if (!force && lastLoopResult && Date.now() - lastLoopAtMs < minInterval) return lastLoopResult;
  if (loopInFlight) return loopInFlight;
  loopInFlight = executeDecisionLoop(sourceSha).finally(() => {
    loopInFlight = null;
  });
  return loopInFlight;
}

export function getAutonomousDecisionQualityStatus() {
  return {
    marker: IVX_AUTONOMOUS_DECISION_QUALITY_MARKER,
    mode: 'OUTCOME_MEASURE_LEARN_REPRIORITIZE',
    running: Boolean(loopInFlight),
    lastLoopAt: lastLoopAtMs > 0 ? new Date(lastLoopAtMs).toISOString() : null,
    lastSnapshot,
    lastLoopResult,
    domains: IVX_DECISION_DOMAINS.map((domain) => ({ id: domain.id, label: domain.label })),
    policy: 'Scores come only from durable task outcomes/evidence. Weak dimensions and uncovered domains create bounded real audit blocks; no fake busy state, fabricated evidence, or arbitrary intelligence score is allowed.',
  };
}
