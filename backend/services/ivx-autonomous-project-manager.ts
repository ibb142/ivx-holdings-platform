/**
 * Autonomous Project Manager control tower.
 *
 * This is a capability of the existing Autonomous system, not a second agent
 * or another scheduler. It reads the canonical objective/task/approval ledger,
 * computes portfolio health and a dependency path, and tells the existing fleet
 * what is ready, blocked, awaiting owner approval, or unsafe to call complete.
 * It never mutates production and never manufactures a 10/10 claim.
 */
import {
  ALL_TASK_STATES,
  TERMINAL_SUCCESS_STATES,
  getAllApprovals,
  getAllObjectives,
  getAllTasks,
  taskSchedulingScore,
  validateCompletion,
  type ApprovalRecord,
  type Objective,
  type Task,
  type TaskState,
} from './ivx-autonomous-task-engine';
import {
  computeDecisionQualitySnapshot,
  type AutonomousDecisionQualitySnapshot,
} from './ivx-autonomous-decision-quality';
import { IVX_PROJECT_VISION } from './ivx-project-vision';
import { autonomousContinuityCapacity } from './ivx-autonomous-control-policy';

export const IVX_AUTONOMOUS_PROJECT_MANAGER_MARKER = 'ivx-autonomous-project-manager-v2-nine-capability-gate-2026-09-07';

const ACTIVE_EXECUTION_STATES = new Set<TaskState>([
  'LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
]);
const ATTENTION_STATES = new Set<TaskState>(['BLOCKED', 'FAILED', 'QA_FAILED', 'EXPIRED', 'STALE', 'WAITING_FOR_APPROVAL']);

export type ProjectManagerDimensionId =
  | 'vision_alignment'
  | 'objective_clarity'
  | 'work_decomposition'
  | 'value_prioritization'
  | 'dependency_control'
  | 'ownership_capacity'
  | 'approval_governance'
  | 'execution_reliability'
  | 'qa_production_proof'
  | 'learning_reporting';

export type ProjectManagerDimension = {
  id: ProjectManagerDimensionId;
  score: number;
  status: 'PASS' | 'PARTIAL' | 'FAIL';
  evidence: string;
  gap: string | null;
};

export type AutonomousCapabilityId =
  | 'brain'
  | 'reasoning'
  | 'capacity'
  | 'skill'
  | 'experience'
  | 'retention'
  | 'intelligence'
  | 'self_upgrade'
  | 'learning';

export type AutonomousCapabilityEvidence = {
  metric: string;
  actual: string | number | boolean | null;
  requiredForTen: string;
  passed: boolean;
  source:
    | 'decision_quality_snapshot'
    | 'objective_dependency_graph'
    | 'durable_task_ledger'
    | 'runtime_leases'
    | 'corrective_work_loop';
};

export type AutonomousCapabilityAssessment = {
  id: AutonomousCapabilityId;
  label: string;
  operationalDefinition: string;
  scoreOutOf10: number;
  rawScoreOutOf100: number;
  status: 'VERIFIED_10_10' | 'PARTIAL' | 'NOT_VERIFIED';
  evidence: AutonomousCapabilityEvidence[];
  blockers: string[];
};

export type ObjectiveHealth = {
  objectiveId: string;
  request: string;
  priority: Objective['priority'];
  status: Objective['status'];
  health: 'DONE' | 'ON_TRACK' | 'AT_RISK' | 'BLOCKED' | 'UNPLANNED';
  progressPercent: number;
  totalTasks: number;
  verifiedTasks: number;
  activeTasks: number;
  attentionTasks: number;
  missingPlanningFields: string[];
  targetDate: string | null;
  overdue: boolean;
};

export type ProjectManagerAction = {
  rank: number;
  taskId: string;
  objectiveId: string | null;
  priority: Task['priority'];
  state: TaskState;
  action: 'RESOLVE_BLOCKER' | 'OWNER_DECISION' | 'RETRY_OR_CLOSE' | 'EXECUTE' | 'VERIFY';
  title: string;
  reason: string;
  assignedAgentNumber: number | null;
};

export type DependencyAudit = {
  valid: boolean;
  missingDependencies: Array<{ taskId: string; dependencyId: string }>;
  cycles: string[][];
  readyTaskIds: string[];
  blockedByDependencyTaskIds: string[];
  longestOpenPath: string[];
  estimatedMinutes: number | null;
  estimateComplete: boolean;
};

export type AutonomousProjectManagerReport = {
  marker: string;
  generatedAt: string;
  sourceSha: string;
  role: 'AUTONOMOUS_PROJECT_MANAGER';
  authority: {
    singleScheduler: 'Autonomous';
    createsSecondAgent: false;
    readOnlyControlTower: true;
    protectedActionsRemainOwnerGated: true;
  };
  brain: {
    metric: 'operational_decision_quality_not_iq';
    scoreOutOf10: number;
    rawScoreOutOf100: number;
    sampleTasks: number;
    grade: AutonomousDecisionQualitySnapshot['grade'];
    tenOfTenCertified: boolean;
    explanation: string;
  };
  maturity: {
    scoreOutOf10: number;
    dimensions: ProjectManagerDimension[];
    tenOfTenCertified: boolean;
    blockers: string[];
  };
  capabilityCertification: {
    metric: 'evidence_backed_operational_capability_not_human_iq';
    requestedTargetOutOf10: 10;
    scoreOutOf10: number;
    allNineTenOfTenVerified: boolean;
    capabilities: AutonomousCapabilityAssessment[];
    proofPolicy: string;
  };
  portfolio: {
    totalObjectives: number;
    activeObjectives: number;
    totalTasks: number;
    orphanTasks: number;
    verifiedTasks: number;
    failedTasks: number;
    blockedTasks: number;
    waitingForApproval: number;
    readyTasks: number;
    activeExecutionTasks: number;
    activeAgentsObserved: number;
    configuredConcurrency: number;
    wipWithinCapacity: boolean;
    objectives: ObjectiveHealth[];
  };
  dependencyAudit: DependencyAudit;
  approvalQueue: Array<{
    taskId: string;
    title: string;
    requiredDecision: string;
    activeApprovalId: string | null;
    approvalExpiresAt: string | null;
  }>;
  nextActions: ProjectManagerAction[];
  quality: AutonomousDecisionQualitySnapshot;
  operatingLoop: readonly string[];
  limitations: string[];
};

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10));
}

function ratioScore(numerator: number, denominator: number): number {
  return denominator > 0 ? clampScore((numerator / denominator) * 100) : 0;
}

function measuredRate(value: number | null): number {
  return clampScore((value ?? 0) * 100);
}

function capability(
  id: AutonomousCapabilityId,
  label: string,
  operationalDefinition: string,
  rawScore: number,
  evidence: AutonomousCapabilityEvidence[],
): AutonomousCapabilityAssessment {
  const normalized = clampScore(rawScore);
  const blockers = evidence
    .filter((item) => !item.passed)
    .map((item) => `${item.metric}: actual=${String(item.actual)}; required=${item.requiredForTen}`);
  return {
    id,
    label,
    operationalDefinition,
    scoreOutOf10: Math.round((normalized / 10) * 100) / 100,
    rawScoreOutOf100: normalized,
    status: normalized === 100 && blockers.length === 0
      ? 'VERIFIED_10_10'
      : normalized >= 60
        ? 'PARTIAL'
        : 'NOT_VERIFIED',
    evidence,
    blockers,
  };
}

function dimension(
  id: ProjectManagerDimensionId,
  score: number,
  evidence: string,
  gap: string | null,
): ProjectManagerDimension {
  const normalized = clampScore(score);
  return {
    id,
    score: normalized,
    status: normalized >= 90 ? 'PASS' : normalized >= 60 ? 'PARTIAL' : 'FAIL',
    evidence,
    gap: normalized >= 90 ? null : gap,
  };
}

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function activeApprovalForTask(approvals: readonly ApprovalRecord[], taskId: string, nowMs: number): ApprovalRecord | null {
  return approvals.find((approval) => approval.taskId === taskId
    && !approval.consumed
    && (parsedTime(approval.expiresAt) ?? 0) > nowMs) ?? null;
}

function inspectDependencies(tasks: readonly Task[]): DependencyAudit {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const missingDependencies: Array<{ taskId: string; dependencyId: string }> = [];
  for (const task of tasks) {
    for (const dependencyId of task.dependencies) {
      if (!byId.has(dependencyId)) missingDependencies.push({ taskId: task.taskId, dependencyId });
    }
  }

  const colors = new Map<string, 0 | 1 | 2>();
  const stack: string[] = [];
  const cycles: string[][] = [];
  const cycleKeys = new Set<string>();
  const visit = (taskId: string): void => {
    const color = colors.get(taskId) ?? 0;
    if (color === 2) return;
    if (color === 1) {
      const index = stack.indexOf(taskId);
      const cycle = [...stack.slice(Math.max(0, index)), taskId];
      const key = [...new Set(cycle)].sort().join('|');
      if (!cycleKeys.has(key)) {
        cycleKeys.add(key);
        cycles.push(cycle);
      }
      return;
    }
    colors.set(taskId, 1);
    stack.push(taskId);
    const task = byId.get(taskId);
    for (const dependencyId of task?.dependencies ?? []) {
      if (byId.has(dependencyId)) visit(dependencyId);
    }
    stack.pop();
    colors.set(taskId, 2);
  };
  for (const task of tasks) visit(task.taskId);

  const dependencyMet = (dependencyId: string): boolean => {
    const dependency = byId.get(dependencyId);
    return Boolean(dependency && TERMINAL_SUCCESS_STATES.includes(dependency.state));
  };
  const readyTaskIds = tasks
    .filter((task) => task.state === 'QUEUED' && task.dependencies.every(dependencyMet))
    .map((task) => task.taskId);
  const blockedByDependencyTaskIds = tasks
    .filter((task) => task.state === 'QUEUED' && !task.dependencies.every(dependencyMet))
    .map((task) => task.taskId);

  // Longest unresolved dependency chain. This is an ordering path, not a
  // fabricated CPM duration: duration is returned only when every task has an estimate.
  const open = tasks.filter((task) => !TERMINAL_SUCCESS_STATES.includes(task.state));
  const openIds = new Set(open.map((task) => task.taskId));
  const dependents = new Map<string, string[]>();
  for (const task of open) {
    for (const dependencyId of task.dependencies) {
      if (!openIds.has(dependencyId)) continue;
      const rows = dependents.get(dependencyId) ?? [];
      rows.push(task.taskId);
      dependents.set(dependencyId, rows);
    }
  }
  const roots = open.filter((task) => task.dependencies.every((dependencyId) => !openIds.has(dependencyId)));
  const longestFrom = (taskId: string, seen: Set<string>): string[] => {
    if (seen.has(taskId)) return [taskId];
    const nextSeen = new Set(seen).add(taskId);
    const children = dependents.get(taskId) ?? [];
    let best: string[] = [];
    for (const child of children) {
      const candidate = longestFrom(child, nextSeen);
      if (candidate.length > best.length) best = candidate;
    }
    return [taskId, ...best];
  };
  let longestOpenPath: string[] = [];
  for (const root of roots.length > 0 ? roots : open) {
    const candidate = longestFrom(root.taskId, new Set());
    if (candidate.length > longestOpenPath.length) longestOpenPath = candidate;
  }
  const pathTasks = longestOpenPath.map((taskId) => byId.get(taskId)).filter((task): task is Task => Boolean(task));
  const estimateComplete = pathTasks.length > 0 && pathTasks.every((task) => typeof task.estimatedMinutes === 'number');
  const estimatedMinutes = estimateComplete
    ? pathTasks.reduce((sum, task) => sum + (task.estimatedMinutes ?? 0), 0)
    : null;

  return {
    valid: missingDependencies.length === 0 && cycles.length === 0,
    missingDependencies: missingDependencies.slice(0, 100),
    cycles: cycles.slice(0, 20),
    readyTaskIds,
    blockedByDependencyTaskIds,
    longestOpenPath,
    estimatedMinutes,
    estimateComplete,
  };
}

function summarizeObjective(objective: Objective, tasks: readonly Task[], nowMs: number): ObjectiveHealth {
  const mine = tasks.filter((task) => task.objectiveId === objective.objectiveId);
  const verifiedTasks = mine.filter((task) => TERMINAL_SUCCESS_STATES.includes(task.state)).length;
  const activeTasks = mine.filter((task) => ACTIVE_EXECUTION_STATES.has(task.state)).length;
  const attentionTasks = mine.filter((task) => ATTENTION_STATES.has(task.state)).length;
  const targetMs = parsedTime(objective.targetDate);
  const overdue = targetMs !== null && targetMs < nowMs && objective.status !== 'completed';
  const missingPlanningFields: string[] = [];
  if (!objective.businessOutcome?.trim()) missingPlanningFields.push('businessOutcome');
  if (!objective.technicalOutcome?.trim()) missingPlanningFields.push('technicalOutcome');
  if (!objective.scope?.trim()) missingPlanningFields.push('scope');
  if (!objective.ownerRole?.trim()) missingPlanningFields.push('ownerRole');
  if (!objective.targetDate) missingPlanningFields.push('targetDate');
  if (!objective.successMetrics?.length) missingPlanningFields.push('successMetrics');

  let health: ObjectiveHealth['health'];
  if (mine.length === 0) health = 'UNPLANNED';
  else if (objective.status === 'completed' && verifiedTasks === mine.length) health = 'DONE';
  else if (objective.status === 'blocked' || mine.some((task) => task.state === 'BLOCKED' && task.priority === 'critical')) health = 'BLOCKED';
  else if (overdue || mine.some((task) => task.state === 'FAILED' || task.state === 'QA_FAILED' || task.state === 'STALE')) health = 'AT_RISK';
  else health = 'ON_TRACK';

  return {
    objectiveId: objective.objectiveId,
    request: objective.originalOwnerRequest.slice(0, 240),
    priority: objective.priority,
    status: objective.status,
    health,
    progressPercent: mine.length > 0 ? Math.round((verifiedTasks / mine.length) * 10_000) / 100 : 0,
    totalTasks: mine.length,
    verifiedTasks,
    activeTasks,
    attentionTasks,
    missingPlanningFields,
    targetDate: objective.targetDate ?? null,
    overdue,
  };
}

function buildNextActions(tasks: readonly Task[], dependencyAudit: DependencyAudit, nowMs: number): ProjectManagerAction[] {
  const dependencyBlocked = new Set(dependencyAudit.blockedByDependencyTaskIds);
  const candidates = tasks.filter((task) =>
    ATTENTION_STATES.has(task.state)
    || dependencyAudit.readyTaskIds.includes(task.taskId)
    || dependencyBlocked.has(task.taskId)
    || task.state === 'PRODUCTION_VERIFYING'
    || task.state === 'QA_IN_PROGRESS',
  );
  const stateBonus = (state: TaskState): number => {
    if (state === 'BLOCKED' || state === 'QA_FAILED') return 8_000;
    if (state === 'WAITING_FOR_APPROVAL') return 7_000;
    if (state === 'FAILED' || state === 'STALE') return 6_000;
    if (state === 'PRODUCTION_VERIFYING' || state === 'QA_IN_PROGRESS') return 4_000;
    return 0;
  };
  const ranked = [...candidates].sort((a, b) => {
    const score = taskSchedulingScore(b, nowMs) + stateBonus(b.state)
      - taskSchedulingScore(a, nowMs) - stateBonus(a.state);
    return score || a.createdAt.localeCompare(b.createdAt) || a.taskId.localeCompare(b.taskId);
  });
  return ranked.slice(0, 20).map((task, index): ProjectManagerAction => {
    let action: ProjectManagerAction['action'] = 'EXECUTE';
    let reason = `Ready under priority=${task.priority}, businessValue=${task.businessValue ?? 3}.`;
    if (task.state === 'BLOCKED' || task.state === 'QA_FAILED') {
      action = 'RESOLVE_BLOCKER';
      reason = task.blocker ?? task.error ?? `${task.state} must be resolved before execution can continue.`;
    } else if (task.state === 'WAITING_FOR_APPROVAL') {
      action = 'OWNER_DECISION';
      reason = 'Protected action is paused until a task-bound, unexpired owner approval exists.';
    } else if (task.state === 'FAILED' || task.state === 'EXPIRED' || task.state === 'STALE') {
      action = 'RETRY_OR_CLOSE';
      reason = task.error ?? `${task.state} requires an explicit retry or terminal decision.`;
    } else if (task.state === 'PRODUCTION_VERIFYING' || task.state === 'QA_IN_PROGRESS') {
      action = 'VERIFY';
      reason = 'Finish the evidence gate; deployed or tested is not the same as VERIFIED.';
    } else if (dependencyBlocked.has(task.taskId)) {
      action = 'RESOLVE_BLOCKER';
      reason = 'One or more dependency tasks are not VERIFIED.';
    }
    return {
      rank: index + 1,
      taskId: task.taskId,
      objectiveId: task.objectiveId,
      priority: task.priority,
      state: task.state,
      action,
      title: task.title.slice(0, 200),
      reason: reason.slice(0, 300),
      assignedAgentNumber: task.assignedAgentNumber,
    };
  });
}

function configuredConcurrency(): number {
  return autonomousContinuityCapacity();
}

export function analyzeAutonomousProjectManagement(input: {
  objectives: readonly Objective[];
  tasks: readonly Task[];
  approvals: readonly ApprovalRecord[];
  sourceSha: string;
  nowMs?: number;
  configuredConcurrency?: number;
}): AutonomousProjectManagerReport {
  const nowMs = input.nowMs ?? Date.now();
  const requestedCapacity = input.configuredConcurrency ?? configuredConcurrency();
  const concurrency = Number.isSafeInteger(requestedCapacity) ? Math.max(0, Math.min(112, requestedCapacity)) : 0;
  const objectives = [...input.objectives];
  const tasks = [...input.tasks];
  const approvals = [...input.approvals];
  const quality = computeDecisionQualitySnapshot(tasks, input.sourceSha, nowMs);
  const dependencyAudit = inspectDependencies(tasks);
  const objectiveHealth = objectives.map((objective) => summarizeObjective(objective, tasks, nowMs));
  const objectiveIds = new Set(objectives.map((objective) => objective.objectiveId));
  const orphanTasks = tasks.filter((task) => !task.objectiveId || !objectiveIds.has(task.objectiveId));
  const activeTasks = tasks.filter((task) => ACTIVE_EXECUTION_STATES.has(task.state));
  const activeAgentsObserved = new Set(activeTasks
    .filter((task) => task.leaseHolder && task.assignedAgentNumber != null)
    .map((task) => task.assignedAgentNumber as number)).size;
  const waitingTasks = tasks.filter((task) => task.state === 'WAITING_FOR_APPROVAL');
  const approvalQueue = waitingTasks.slice(0, 100).map((task) => {
    const approval = activeApprovalForTask(approvals, task.taskId, nowMs);
    return {
      taskId: task.taskId,
      title: task.title.slice(0, 200),
      requiredDecision: task.blocker ?? 'Approve or reject the protected action bound to this task.',
      activeApprovalId: approval?.approvalId ?? null,
      approvalExpiresAt: approval?.expiresAt ?? null,
    };
  });

  const plannedObjectives = objectiveHealth.filter((objective) => objective.totalTasks > 0).length;
  const decompositionScore = objectives.length > 0 && tasks.length > 0
    ? clampScore((plannedObjectives / objectives.length) * 50 + ((tasks.length - orphanTasks.length) / tasks.length) * 50)
    : 0;
  const explicitObjectivePoints = objectives.reduce((sum, objective) => sum
    + Number(Boolean(objective.businessOutcome?.trim()))
    + Number(Boolean(objective.technicalOutcome?.trim()))
    + Number(Boolean(objective.scope?.trim()))
    + Number(Boolean(objective.ownerRole?.trim()))
    + Number(Boolean(objective.targetDate))
    + Number(Boolean(objective.successMetrics?.length)), 0);
  const prioritizationPoints = tasks.reduce((sum, task) => sum
    + 0.4
    + (task.businessValue != null ? 0.3 : 0)
    + (task.dueAt ? 0.3 : 0), 0);
  const assigned = tasks.filter((task) => task.assignedAgentNumber != null && Boolean(task.assignedEngine)).length;
  const waitingWithApproval = waitingTasks.filter((task) => Boolean(activeApprovalForTask(approvals, task.taskId, nowMs))).length;
  const staleLeases = activeTasks.filter((task) => {
    const heartbeat = parsedTime(task.lastHeartbeatAt);
    return !task.leaseHolder || heartbeat === null || nowMs - heartbeat > 60_000;
  }).length;
  const uniqueIdempotencyKeys = new Set(tasks.map((task) => task.idempotencyKey)).size;
  const stateIntegrity = tasks.every((task) => ALL_TASK_STATES.includes(task.state));
  const ledgerIntegrityScore = tasks.length === 0 ? 0 : clampScore(
    100
    - ((tasks.length - uniqueIdempotencyKeys) / tasks.length) * 100
    - (staleLeases / tasks.length) * 100
    - (stateIntegrity ? 0 : 50),
  );
  const evidenceIntegrity = quality.evidenceIntegrityRate.rate ?? 0;
  const testEvidence = quality.testEvidenceRate.rate ?? 0;
  const productionProof = quality.productionVerificationRate.rate ?? 0;
  const coverage = quality.globalCoverageRate.rate ?? 0;

  const dimensions: ProjectManagerDimension[] = [
    dimension('vision_alignment', 100,
      `Permanent mission, 12+100 fleet model, safety constitution and ${IVX_PROJECT_VISION.operatingLoop.length}-stage operating loop are codified.`, null),
    dimension('objective_clarity', objectives.length > 0 ? ratioScore(explicitObjectivePoints, objectives.length * 6) : 0,
      `${objectives.length} objectives; ${explicitObjectivePoints}/${objectives.length * 6 || 0} explicit outcome/owner/date/metric fields.`,
      'Every active objective needs business outcome, technical outcome, scope, accountable role, owner-set target date and measurable success metrics.'),
    dimension('work_decomposition', decompositionScore,
      `${plannedObjectives}/${objectives.length} objectives have tasks; ${tasks.length - orphanTasks.length}/${tasks.length} tasks are linked to a canonical objective.`,
      'Decompose every active objective into dependency-linked tasks with acceptance criteria.'),
    dimension('value_prioritization', tasks.length > 0 ? ratioScore(prioritizationPoints, tasks.length) : 0,
      `${tasks.length} tasks are safety/priority ordered; ${tasks.filter((task) => task.businessValue != null).length} carry business value and ${tasks.filter((task) => Boolean(task.dueAt)).length} carry owner deadlines.`,
      'Add business value and owner-set due dates so urgency is not inferred only from severity.'),
    dimension('dependency_control', tasks.length > 0 ? clampScore(100 - dependencyAudit.missingDependencies.length * 20 - dependencyAudit.cycles.length * 40) : 0,
      `${dependencyAudit.readyTaskIds.length} ready, ${dependencyAudit.blockedByDependencyTaskIds.length} dependency-blocked, ${dependencyAudit.missingDependencies.length} missing links, ${dependencyAudit.cycles.length} cycles.`,
      'Repair missing dependency IDs/cycles and estimate each critical-path task.'),
    dimension('ownership_capacity', tasks.length > 0 ? clampScore(ratioScore(assigned, tasks.length) - (activeTasks.length > concurrency ? 30 : 0)) : 0,
      `${assigned}/${tasks.length} tasks have agent+engine ownership; WIP ${activeTasks.length}/${concurrency}; ${activeAgentsObserved} lease-backed agents observed.`,
      'Assign one accountable lane per task and keep real WIP within deployed concurrency.'),
    dimension('approval_governance', waitingTasks.length === 0 ? 100 : ratioScore(waitingWithApproval, waitingTasks.length),
      `${waitingWithApproval}/${waitingTasks.length} waiting tasks have an active task-bound approval.`,
      'Resolve the owner decision queue; never execute a protected action from narrative permission.'),
    dimension('execution_reliability', quality.overallScore,
      `Decision-quality=${quality.overallScore}/100 across ${quality.sampleTasks} recent tasks; verified=${quality.verifiedTasks}, failed=${quality.failedTasks}.`,
      'Raise evidence-backed verified outcomes, first-pass success and global domain coverage.'),
    dimension('qa_production_proof', ((evidenceIntegrity + testEvidence + productionProof) / 3) * 100,
      `Evidence integrity=${quality.evidenceIntegrityRate.numerator}/${quality.evidenceIntegrityRate.denominator}; test proof=${quality.testEvidenceRate.numerator}/${quality.testEvidenceRate.denominator}; production proof=${quality.productionVerificationRate.numerator}/${quality.productionVerificationRate.denominator}.`,
      'No engineering task is complete until its exact acceptance, test and production evidence passes.'),
    dimension('learning_reporting', ledgerIntegrityScore * 0.4 + coverage * 60,
      `Control tower is generated from the durable ledger; ledger integrity=${ledgerIntegrityScore}/100 and evidence-backed domain coverage=${quality.globalCoverageRate.numerator}/${quality.globalCoverageRate.denominator}.`,
      'Close uncovered product/engineering domains and feed verified outcomes back into prioritization.'),
  ];

  const dimensionScores = new Map(dimensions.map((item) => [item.id, item.score]));
  const dimensionScore = (id: ProjectManagerDimensionId): number => dimensionScores.get(id) ?? 0;
  const reasoningScore = clampScore((
    dimensionScore('objective_clarity')
    + dimensionScore('value_prioritization')
    + dimensionScore('dependency_control')
  ) / 3);
  const qualityWindowMs = quality.windowHours * 60 * 60 * 1_000;
  const recentAgentsWithVerifiedOutcomes = new Set(tasks
    .filter((task) => {
      const updated = parsedTime(task.updatedAt);
      return updated !== null
        && updated <= nowMs
        && nowMs - updated <= qualityWindowMs
        && task.assignedAgentNumber != null
        && validateCompletion(task).verdict === 'VERIFIED';
    })
    .map((task) => task.assignedAgentNumber as number)).size;
  const activeTasksWithFreshLease = activeTasks.filter((task) => {
    const heartbeat = parsedTime(task.lastHeartbeatAt);
    return Boolean(task.leaseHolder && heartbeat !== null && nowMs - heartbeat <= 60_000);
  }).length;
  const assignmentCoverage = tasks.length > 0 ? ratioScore(assigned, tasks.length) : 0;
  const observedCapacityCoverage = ratioScore(Math.min(recentAgentsWithVerifiedOutcomes, concurrency), concurrency);
  const leaseIntegrityScore = activeTasks.length > 0
    ? ratioScore(activeTasksWithFreshLease, activeTasks.length)
    : concurrency > 0 && recentAgentsWithVerifiedOutcomes >= concurrency ? 100 : 0;
  const capacityScore = clampScore(
    assignmentCoverage * 0.30
    + observedCapacityCoverage * 0.30
    + (activeTasks.length <= concurrency ? 20 : 0)
    + leaseIntegrityScore * 0.20,
  );
  const skillScore = clampScore((
    measuredRate(quality.evidenceIntegrityRate.rate)
    + measuredRate(quality.testEvidenceRate.rate)
    + measuredRate(quality.productionVerificationRate.rate)
  ) / 3);
  const experienceSampleScore = clampScore(Math.min(1, quality.sampleTasks / 20) * 100);
  const validatedVerifiedTasks = quality.evidenceIntegrityRate.numerator;
  const experienceVerifiedScore = clampScore(Math.min(1, validatedVerifiedTasks / 20) * 100);
  const experienceScore = clampScore(
    experienceSampleScore * 0.40
    + experienceVerifiedScore * 0.40
    + measuredRate(quality.globalCoverageRate.rate) * 0.20,
  );
  const linkedTaskScore = tasks.length > 0 ? ratioScore(tasks.length - orphanTasks.length, tasks.length) : 0;
  const retentionHistoryScore = clampScore(Math.min(1, tasks.length / 20) * 100);
  const retentionScore = clampScore(
    ledgerIntegrityScore * 0.50
    + linkedTaskScore * 0.30
    + retentionHistoryScore * 0.20,
  );
  const correctiveTasks = tasks.filter((task) =>
    task.idempotencyKey.startsWith('decision-quality:')
    || task.idempotencyKey.startsWith('semantic360:self-improvement:'),
  );
  const verifiedCorrectiveTasks = correctiveTasks.filter((task) => validateCompletion(task).verdict === 'VERIFIED');
  const correctiveAttentionTasks = correctiveTasks.filter((task) => ATTENTION_STATES.has(task.state));
  const correctiveCoverageScore = clampScore(Math.min(1, correctiveTasks.length / 5) * 100);
  const correctiveSuccessScore = correctiveTasks.length > 0
    ? ratioScore(verifiedCorrectiveTasks.length, correctiveTasks.length)
    : 0;
  const selfUpgradeScore = clampScore(
    correctiveCoverageScore * 0.20
    + correctiveSuccessScore * 0.60
    + (correctiveTasks.length > 0 && correctiveAttentionTasks.length === 0 ? 20 : 0),
  );
  const effectiveFirstPassRate = (quality.firstPassRate.rate ?? 0) * (quality.evidenceIntegrityRate.rate ?? 0);
  const learningScore = clampScore(
    measuredRate(effectiveFirstPassRate) * 0.30
    + measuredRate(quality.globalCoverageRate.rate) * 0.30
    + correctiveSuccessScore * 0.40,
  );
  const evidenceRow = (
    metric: string,
    actual: AutonomousCapabilityEvidence['actual'],
    requiredForTen: string,
    passed: boolean,
    source: AutonomousCapabilityEvidence['source'],
  ): AutonomousCapabilityEvidence => ({ metric, actual, requiredForTen, passed, source });

  const brainAssessment = capability(
    'brain',
    'Brain',
    'Verified operational decision quality across outcomes, evidence, tests, production and IVX domain coverage; this is not IQ or consciousness.',
    quality.overallScore,
    [
      evidenceRow('decision_quality', quality.overallScore, '100/100', quality.overallScore === 100, 'decision_quality_snapshot'),
      evidenceRow('sample_tasks', quality.sampleTasks, '>=20 recent tasks', quality.sampleTasks >= 20, 'durable_task_ledger'),
      evidenceRow('false_completion_rate', quality.falseCompletionRiskRate.rate, '0', (quality.falseCompletionRiskRate.rate ?? 1) === 0, 'decision_quality_snapshot'),
    ],
  );
  const reasoningAssessment = capability(
    'reasoning',
    'Reasoning / Razonamiento',
    'Turns owner outcomes into explicit objectives, priorities and an acyclic dependency plan without inventing dates or facts.',
    reasoningScore,
    [
      evidenceRow('objective_clarity', dimensionScore('objective_clarity'), '100/100', dimensionScore('objective_clarity') === 100, 'objective_dependency_graph'),
      evidenceRow('value_prioritization', dimensionScore('value_prioritization'), '100/100', dimensionScore('value_prioritization') === 100, 'objective_dependency_graph'),
      evidenceRow('dependency_control', dimensionScore('dependency_control'), '100/100 and valid graph', dimensionScore('dependency_control') === 100 && dependencyAudit.valid, 'objective_dependency_graph'),
    ],
  );
  const capacityAssessment = capability(
    'capacity',
    'Capacity / Capacidad',
    'Schedules owned work within actually deployed concurrency and reports lease-backed execution separately from the 112-lane registry.',
    capacityScore,
    [
      evidenceRow('assignment_coverage', assignmentCoverage, '100/100', assignmentCoverage === 100, 'durable_task_ledger'),
      evidenceRow('recent_agents_with_verified_outcomes_vs_configured_concurrency', `${recentAgentsWithVerifiedOutcomes}/${concurrency}`, `>=${concurrency}/${concurrency}; admission enabled`, concurrency > 0 && recentAgentsWithVerifiedOutcomes >= concurrency, 'runtime_leases'),
      evidenceRow('wip_within_capacity', `${activeTasks.length}/${concurrency}`, `<=${concurrency}`, activeTasks.length <= concurrency, 'runtime_leases'),
      evidenceRow('fresh_lease_integrity', leaseIntegrityScore, '100/100', leaseIntegrityScore === 100, 'runtime_leases'),
    ],
  );
  const skillAssessment = capability(
    'skill',
    'Skill / Habilidad',
    'Produces completion evidence, test proof and exact production verification for eligible engineering work.',
    skillScore,
    [
      evidenceRow('evidence_integrity_rate', quality.evidenceIntegrityRate.rate, '1.0', quality.evidenceIntegrityRate.rate === 1, 'decision_quality_snapshot'),
      evidenceRow('test_evidence_rate', quality.testEvidenceRate.rate, '1.0', quality.testEvidenceRate.rate === 1, 'decision_quality_snapshot'),
      evidenceRow('production_verification_rate', quality.productionVerificationRate.rate, '1.0', quality.productionVerificationRate.rate === 1, 'decision_quality_snapshot'),
    ],
  );
  const experienceAssessment = capability(
    'experience',
    'Experience / Experiencia',
    'Demonstrated recent execution history across the complete IVX engineering surface, measured as outcomes rather than age or narrative claims.',
    experienceScore,
    [
      evidenceRow('recent_task_sample', quality.sampleTasks, '>=20', quality.sampleTasks >= 20, 'durable_task_ledger'),
      evidenceRow('validator_accepted_outcomes', validatedVerifiedTasks, '>=20', validatedVerifiedTasks >= 20, 'durable_task_ledger'),
      evidenceRow('domain_coverage', quality.globalCoverageRate.rate, '1.0 across all defined domains', quality.globalCoverageRate.rate === 1, 'decision_quality_snapshot'),
    ],
  );
  const retentionAssessment = capability(
    'retention',
    'Retention / Retención',
    'Preserves objectives, task identity, state and evidence in the canonical durable ledger; this is operational memory, not model-weight memory.',
    retentionScore,
    [
      evidenceRow('ledger_integrity', ledgerIntegrityScore, '100/100', ledgerIntegrityScore === 100, 'durable_task_ledger'),
      evidenceRow('objective_linkage', linkedTaskScore, '100/100 and zero orphan tasks', linkedTaskScore === 100 && orphanTasks.length === 0, 'durable_task_ledger'),
      evidenceRow('retained_history', tasks.length, '>=20 task records', tasks.length >= 20, 'durable_task_ledger'),
    ],
  );
  const selfUpgradeAssessment = capability(
    'self_upgrade',
    'Self-upgrade / Auto-mejora',
    'Detects measured weaknesses, creates bounded corrective work and accepts an upgrade only after the same evidence gates pass; protected changes remain owner-gated.',
    selfUpgradeScore,
    [
      evidenceRow('corrective_tasks_created', correctiveTasks.length, '>=5 evidence-triggered tasks', correctiveTasks.length >= 5, 'corrective_work_loop'),
      evidenceRow('corrective_tasks_verified', `${verifiedCorrectiveTasks.length}/${correctiveTasks.length}`, '100%', correctiveTasks.length > 0 && verifiedCorrectiveTasks.length === correctiveTasks.length, 'corrective_work_loop'),
      evidenceRow('corrective_attention_tasks', correctiveAttentionTasks.length, '0', correctiveTasks.length > 0 && correctiveAttentionTasks.length === 0, 'corrective_work_loop'),
    ],
  );
  const learningAssessment = capability(
    'learning',
    'Learning / Aprendizaje',
    'Feeds verified outcomes and corrective results back into reprioritization; it does not claim unmeasured model training.',
    learningScore,
    [
      evidenceRow('evidence_validated_first_pass_rate', effectiveFirstPassRate, '1.0', effectiveFirstPassRate === 1, 'decision_quality_snapshot'),
      evidenceRow('global_domain_coverage', quality.globalCoverageRate.rate, '1.0', quality.globalCoverageRate.rate === 1, 'decision_quality_snapshot'),
      evidenceRow('applied_corrective_success', correctiveTasks.length > 0 ? verifiedCorrectiveTasks.length / correctiveTasks.length : null, '1.0 with at least one correction', correctiveTasks.length > 0 && verifiedCorrectiveTasks.length === correctiveTasks.length, 'corrective_work_loop'),
    ],
  );
  const intelligenceScore = clampScore((
    brainAssessment.rawScoreOutOf100
    + reasoningAssessment.rawScoreOutOf100
    + skillAssessment.rawScoreOutOf100
    + learningAssessment.rawScoreOutOf100
  ) / 4);
  const intelligenceAssessment = capability(
    'intelligence',
    'Intelligence / Inteligencia',
    'Composite operational intelligence: reason over a plan, execute with proof, learn from outcomes and improve without unsupported claims.',
    intelligenceScore,
    [
      evidenceRow('brain_component', brainAssessment.rawScoreOutOf100, '100/100', brainAssessment.rawScoreOutOf100 === 100, 'decision_quality_snapshot'),
      evidenceRow('reasoning_component', reasoningAssessment.rawScoreOutOf100, '100/100', reasoningAssessment.rawScoreOutOf100 === 100, 'objective_dependency_graph'),
      evidenceRow('skill_component', skillAssessment.rawScoreOutOf100, '100/100', skillAssessment.rawScoreOutOf100 === 100, 'decision_quality_snapshot'),
      evidenceRow('learning_component', learningAssessment.rawScoreOutOf100, '100/100', learningAssessment.rawScoreOutOf100 === 100, 'corrective_work_loop'),
    ],
  );
  const capabilities: AutonomousCapabilityAssessment[] = [
    brainAssessment,
    reasoningAssessment,
    capacityAssessment,
    skillAssessment,
    experienceAssessment,
    retentionAssessment,
    intelligenceAssessment,
    selfUpgradeAssessment,
    learningAssessment,
  ];
  const allNineTenOfTenVerified = capabilities.every((item) => item.status === 'VERIFIED_10_10');
  const capabilityScore = Math.round((capabilities.reduce((sum, item) => sum + item.scoreOutOf10, 0) / capabilities.length) * 100) / 100;

  const maturityScore = Math.round((dimensions.reduce((sum, item) => sum + item.score, 0) / dimensions.length) * 10) / 100;
  const brainScore = Math.round((quality.overallScore / 10) * 100) / 100;
  const criticalAttention = tasks.filter((task) => task.priority === 'critical' && ATTENTION_STATES.has(task.state));
  const maturityBlockers = dimensions
    .filter((item) => item.score < 90)
    .map((item) => `${item.id}:${item.score}/100${item.gap ? ` — ${item.gap}` : ''}`);
  if (criticalAttention.length > 0) maturityBlockers.unshift(`critical_attention_tasks:${criticalAttention.length}`);
  if (orphanTasks.length > 0) maturityBlockers.unshift(`orphan_tasks:${orphanTasks.length}`);
  if (concurrency === 0) maturityBlockers.unshift('admission_disabled');
  if (activeTasks.length > concurrency) maturityBlockers.unshift(`wip_over_capacity:${activeTasks.length}/${concurrency}`);
  if (!dependencyAudit.valid) maturityBlockers.unshift('dependency_graph_invalid');
  const tenOfTenCertified = concurrency > 0 && quality.sampleTasks >= 20
    && quality.overallScore >= 95
    && dimensions.every((item) => item.score >= 95)
    && allNineTenOfTenVerified
    && criticalAttention.length === 0
    && orphanTasks.length === 0
    && activeTasks.length <= concurrency
    && dependencyAudit.valid;

  return {
    marker: IVX_AUTONOMOUS_PROJECT_MANAGER_MARKER,
    generatedAt: new Date(nowMs).toISOString(),
    sourceSha: input.sourceSha,
    role: 'AUTONOMOUS_PROJECT_MANAGER',
    authority: {
      singleScheduler: 'Autonomous',
      createsSecondAgent: false,
      readOnlyControlTower: true,
      protectedActionsRemainOwnerGated: true,
    },
    brain: {
      metric: 'operational_decision_quality_not_iq',
      scoreOutOf10: brainScore,
      rawScoreOutOf100: quality.overallScore,
      sampleTasks: quality.sampleTasks,
      grade: quality.grade,
      tenOfTenCertified,
      explanation: 'This score measures verified operational decisions, not consciousness, IQ or general reasoning ability.',
    },
    maturity: {
      scoreOutOf10: maturityScore,
      dimensions,
      tenOfTenCertified,
      blockers: maturityBlockers.slice(0, 30),
    },
    capabilityCertification: {
      metric: 'evidence_backed_operational_capability_not_human_iq',
      requestedTargetOutOf10: 10,
      scoreOutOf10: capabilityScore,
      allNineTenOfTenVerified,
      capabilities,
      proofPolicy: 'Each 10/10 requires a raw 100/100 and every listed proof threshold to pass. A configured feature, queued task, registry entry or narrative claim is never proof.',
    },
    portfolio: {
      totalObjectives: objectives.length,
      activeObjectives: objectives.filter((objective) => objective.status === 'active').length,
      totalTasks: tasks.length,
      orphanTasks: orphanTasks.length,
      verifiedTasks: tasks.filter((task) => validateCompletion(task).verdict === 'VERIFIED').length,
      failedTasks: tasks.filter((task) => task.state === 'FAILED' || task.state === 'QA_FAILED' || task.state === 'EXPIRED').length,
      blockedTasks: tasks.filter((task) => task.state === 'BLOCKED' || task.state === 'STALE').length,
      waitingForApproval: waitingTasks.length,
      readyTasks: dependencyAudit.readyTaskIds.length,
      activeExecutionTasks: activeTasks.length,
      activeAgentsObserved,
      configuredConcurrency: concurrency,
      wipWithinCapacity: activeTasks.length <= concurrency,
      objectives: objectiveHealth.slice(0, 100),
    },
    dependencyAudit,
    approvalQueue,
    nextActions: buildNextActions(tasks, dependencyAudit, nowMs),
    quality,
    operatingLoop: IVX_PROJECT_VISION.operatingLoop,
    limitations: [
      'The critical path is dependency-order only unless every path task has estimatedMinutes; an incomplete estimate never becomes a fabricated delivery date.',
      'The 112-agent fleet is reported separately from physical concurrency. This control tower cannot certify 112/112 without distinct leases, fresh heartbeats and worker identities.',
      'Owner target dates and business success metrics are never invented. Missing values remain explicit planning gaps.',
      'Brain, intelligence, experience, retention and learning are operational capability labels. They do not claim consciousness, human IQ, human experience or autonomous model-weight training.',
    ],
  };
}

export async function buildAutonomousProjectManagerReport(): Promise<AutonomousProjectManagerReport> {
  const [objectives, tasks, approvals] = await Promise.all([
    getAllObjectives(),
    getAllTasks(),
    getAllApprovals(),
  ]);
  const sourceSha = process.env.RENDER_GIT_COMMIT
    ?? process.env.GITHUB_SHA
    ?? process.env.COMMIT_SHA
    ?? 'runtime-unknown-sha';
  return analyzeAutonomousProjectManagement({ objectives, tasks, approvals, sourceSha });
}
