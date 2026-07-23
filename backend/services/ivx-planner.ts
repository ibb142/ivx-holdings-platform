/**
 * IVX Internal Planner — Phase 6
 *
 * For moderate, complex, or critical tasks, generates an internal plan containing:
 * objective, acceptance criteria, known/unknown facts, assumptions, dependencies,
 * relevant files/infrastructure, task graph, tool sequence, risk, rollback, verification.
 *
 * The owner sees: objective, current stage, major actions, blocker, evidence.
 */
import { randomUUID } from 'crypto';

export type IVXPlanStage = 'planning' | 'inspecting' | 'building' | 'reviewing' | 'testing' | 'deploying' | 'verifying' | 'completed' | 'blocked' | 'failed';

export type IVXTaskNode = {
  id: string;
  name: string;
  specialist: string;
  dependencies: string[];
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed';
  result?: string;
};

export type IVXPlan = {
  planId: string;
  objective: string;
  acceptanceCriteria: string[];
  knownFacts: string[];
  unknownFacts: string[];
  assumptions: string[];
  dependencies: string[];
  relevantFiles: string[];
  relevantInfrastructure: string[];
  taskGraph: IVXTaskNode[];
  toolSequence: string[];
  risks: IVXRisk[];
  rollbackStrategy: string;
  verificationStrategy: string;
  createdAt: string;
  updatedAt: string;
  stage: IVXPlanStage;
  ownerSummary: IVXOwnerSummary;
};

export type IVXRisk = {
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
};

export type IVXOwnerSummary = {
  objective: string;
  currentStage: IVXPlanStage;
  majorActions: string[];
  blocker: string | null;
  evidence: string[];
};

export function createPlan(input: {
  objective: string;
  complexity: 'simple' | 'moderate' | 'complex' | 'critical';
  intentType: string;
  relevantFiles?: string[];
}): IVXPlan {
  const planId = randomUUID();
  const now = new Date().toISOString();

  // Build task graph based on complexity
  const taskGraph: IVXTaskNode[] = [];
  const toolSequence: string[] = [];

  if (input.complexity === 'simple') {
    taskGraph.push({
      id: 'task-1',
      name: 'Direct answer',
      specialist: 'IVX Response Editor',
      dependencies: [],
      status: 'pending',
    });
    toolSequence.push('ai_query');
  } else if (input.complexity === 'moderate') {
    taskGraph.push(
      { id: 'task-1', name: 'Inspect context', specialist: 'IVX Architect', dependencies: [], status: 'pending' },
      { id: 'task-2', name: 'Execute change', specialist: 'IVX Senior Developer', dependencies: ['task-1'], status: 'pending' },
      { id: 'task-3', name: 'Verify result', specialist: 'IVX Proof Verifier', dependencies: ['task-2'], status: 'pending' },
    );
    toolSequence.push('context_retrieval', 'ai_generate', 'verify');
  } else {
    // complex or critical
    taskGraph.push(
      { id: 'task-1', name: 'Architecture review', specialist: 'IVX Architect', dependencies: [], status: 'pending' },
      { id: 'task-2', name: 'Inspect code', specialist: 'IVX Senior Developer', dependencies: ['task-1'], status: 'pending' },
      { id: 'task-3', name: 'Build patch', specialist: 'IVX Backend Engineer', dependencies: ['task-2'], status: 'pending' },
      { id: 'task-4', name: 'Code review', specialist: 'IVX Security Engineer', dependencies: ['task-3'], status: 'pending' },
      { id: 'task-5', name: 'Run tests', specialist: 'IVX QA Engineer', dependencies: ['task-4'], status: 'pending' },
      { id: 'task-6', name: 'Deploy', specialist: 'IVX DevOps Engineer', dependencies: ['task-5'], status: 'pending' },
      { id: 'task-7', name: 'Verify live', specialist: 'IVX Proof Verifier', dependencies: ['task-6'], status: 'pending' },
    );
    toolSequence.push('context_retrieval', 'ai_design', 'ai_generate_code', 'code_review', 'run_tests', 'deploy', 'verify_live');
  }

  // Build risks
  const risks: IVXRisk[] = [];
  if (input.complexity === 'critical') {
    risks.push({ description: 'Destructive or irreversible action', severity: 'critical', mitigation: 'Owner approval required + rollback plan' });
  }
  risks.push({ description: 'Deployment may fail', severity: 'medium', mitigation: 'Verify health after deploy, auto-rollback if unhealthy' });
  risks.push({ description: 'Tests may not cover edge cases', severity: 'low', mitigation: 'Targeted tests for changed code paths' });

  return {
    planId,
    objective: input.objective,
    acceptanceCriteria: [
      'Changes are committed to GitHub',
      'Backend is deployed to Render',
      'GitHub SHA === Runtime SHA',
      'Live endpoint returns expected HTTP status',
      'Tests pass',
    ],
    knownFacts: [],
    unknownFacts: [],
    assumptions: ['Backend is currently healthy', 'GitHub token is valid', 'Render auto-deploy is active'],
    dependencies: ['GitHub API access', 'Render deployment', 'Supabase database'],
    relevantFiles: input.relevantFiles || [],
    relevantInfrastructure: ['Render backend', 'Supabase database', 'CloudFront CDN', 'S3 storage'],
    taskGraph,
    toolSequence,
    risks,
    rollbackStrategy: 'Revert to previous commit via git revert, trigger Render deploy, verify health endpoint',
    verificationStrategy: 'Check GitHub commit SHA matches Render runtime SHA, verify live endpoint HTTP status, run targeted tests',
    createdAt: now,
    updatedAt: now,
    stage: 'planning',
    ownerSummary: {
      objective: input.objective,
      currentStage: 'planning',
      majorActions: [],
      blocker: null,
      evidence: [],
    },
  };
}

export function updatePlanStage(plan: IVXPlan, stage: IVXPlanStage, updates?: Partial<IVXOwnerSummary>): IVXPlan {
  const updated: IVXPlan = {
    ...plan,
    stage,
    updatedAt: new Date().toISOString(),
    ownerSummary: {
      ...plan.ownerSummary,
      currentStage: stage,
      ...updates,
    },
  };
  return updated;
}

export function completeTaskInPlan(plan: IVXPlan, taskId: string, result: string): IVXPlan {
  const taskGraph = plan.taskGraph.map((t) =>
    t.id === taskId ? { ...t, status: 'completed' as const, result } : t,
  );

  // Mark dependent tasks as in_progress if all deps completed
  for (const task of taskGraph) {
    if (task.status === 'pending') {
      const allDepsComplete = task.dependencies.every((depId) =>
        taskGraph.find((t) => t.id === depId)?.status === 'completed',
      );
      if (allDepsComplete) {
        task.status = 'in_progress';
      }
    }
  }

  const majorActions = taskGraph
    .filter((t) => t.status === 'completed')
    .map((t) => `${t.name}: ${t.result || 'done'}`);

  return {
    ...plan,
    taskGraph,
    updatedAt: new Date().toISOString(),
    ownerSummary: {
      ...plan.ownerSummary,
      majorActions,
    },
  };
}

export const IVX_PLANNER_MARKER = 'ivx-planner-2026-07-23-v1';
