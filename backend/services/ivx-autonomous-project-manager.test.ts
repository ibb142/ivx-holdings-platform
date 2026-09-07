import { describe, expect, it } from 'bun:test';
import {
  analyzeAutonomousProjectManagement,
  IVX_AUTONOMOUS_PROJECT_MANAGER_MARKER,
} from './ivx-autonomous-project-manager';
import {
  compareProjectManagedTasks,
  taskSchedulingScore,
  type Objective,
  type Task,
} from './ivx-autonomous-task-engine';

const NOW = Date.parse('2026-09-07T02:00:00.000Z');

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1',
    objectiveId: 'objective-1',
    parentTaskId: null,
    title: 'Inspect authentication boundary',
    description: 'Evidence-backed task',
    taskType: 'security',
    state: 'QUEUED',
    idempotencyKey: 'pm-test:task-1',
    assignedAgentNumber: 43,
    assignedEngine: 'ivx_security_lead',
    priority: 'critical',
    businessValue: 5,
    estimatedMinutes: 30,
    milestone: 'secure-control-plane',
    ownerRole: 'Security Lead',
    dueAt: '2026-09-07T03:00:00.000Z',
    acceptanceCriteria: [],
    dependencies: [],
    executionOrder: 1,
    leaseHolder: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    retryCount: 0,
    maxRetries: 3,
    error: null,
    blocker: null,
    evidence: [],
    filesChanged: [],
    recordsChanged: 0,
    commitSha: null,
    deploymentId: null,
    approvalId: null,
    createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z',
    startedAt: null,
    completedAt: null,
    traceId: null,
    ...overrides,
  };
}

function makeObjective(overrides: Partial<Objective> = {}): Objective {
  return {
    objectiveId: 'objective-1',
    originalOwnerRequest: 'Upgrade Autonomous as end-to-end project manager',
    businessOutcome: 'Finish IVX safely and measurably',
    technicalOutcome: 'Evidence-derived project control tower',
    scope: 'Autonomous objective, task, approval and QA ledger',
    exclusions: [],
    riskClassification: 'high',
    requiredApprovals: ['production_deployment'],
    acceptanceCriteria: [],
    priority: 'critical',
    estimatedEffort: 'medium',
    ownerRole: 'Autonomous Project Manager',
    targetDate: '2026-09-10T00:00:00.000Z',
    successMetrics: ['Zero unauthorized task-engine access', 'Every completion has exact evidence'],
    assignedEngine: 'ivx_security_lead',
    rollbackRequirement: true,
    finalVerificationMethod: 'production_check',
    createdAt: '2026-09-06T00:00:00.000Z',
    status: 'active',
    ...overrides,
  };
}

function makeVerifiedCapabilityTask(index: number): Task {
  const createdAt = new Date(NOW - 60_000).toISOString();
  const completedAt = new Date(NOW - 1_000).toISOString();
  return makeTask({
    taskId: `capability-${index}`,
    title: 'Architecture backend/API Expo mobile web Supabase database auth security QA E2E performance latency deploy Render monitoring incident media video',
    taskType: 'development',
    state: 'VERIFIED',
    idempotencyKey: `decision-quality:qa-sha:capability:${index}`,
    assignedAgentNumber: (index % 12) + 1,
    assignedEngine: `ivx_capability_agent_${(index % 12) + 1}`,
    dueAt: new Date(NOW + 86_400_000).toISOString(),
    acceptanceCriteria: [{
      id: `criterion-${index}`,
      description: 'Exact test and production evidence passes',
      verificationMethod: 'production_check',
      met: true,
      evidence: `capability-evidence-${index}`,
    }],
    evidence: [
      {
        evidenceId: `test-${index}`,
        evidenceType: 'test_result',
        source: 'ci',
        contentHash: `test-hash-${index}`,
        summary: 'Tests passed for exact source SHA',
        createdAt: completedAt,
        commitSha: 'qa-sha',
        deploymentId: null,
      },
      {
        evidenceId: `production-${index}`,
        evidenceType: 'production_verification',
        source: 'production',
        contentHash: `production-hash-${index}`,
        summary: 'Production verification passed for exact source SHA',
        createdAt: completedAt,
        commitSha: 'qa-sha',
        deploymentId: 'deploy-qa',
      },
    ],
    filesChanged: [`backend/capability-${index}.ts`],
    commitSha: 'qa-sha',
    deploymentId: 'deploy-qa',
    createdAt,
    updatedAt: completedAt,
    startedAt: createdAt,
    completedAt,
  });
}

describe('Autonomous Project Manager control tower', () => {
  it('builds a dependency path and identifies only executable work as ready', () => {
    const first = makeTask();
    const second = makeTask({
      taskId: 'task-2',
      idempotencyKey: 'pm-test:task-2',
      title: 'Verify production',
      taskType: 'qa',
      assignedAgentNumber: 44,
      assignedEngine: 'ivx_qa_engineer',
      dependencies: ['task-1'],
      executionOrder: 2,
      estimatedMinutes: 20,
    });

    const report = analyzeAutonomousProjectManagement({
      objectives: [makeObjective()],
      tasks: [first, second],
      approvals: [],
      sourceSha: 'sha-test',
      nowMs: NOW,
      configuredConcurrency: 12,
    });

    expect(report.marker).toBe(IVX_AUTONOMOUS_PROJECT_MANAGER_MARKER);
    expect(report.dependencyAudit.valid).toBe(true);
    expect(report.dependencyAudit.readyTaskIds).toEqual(['task-1']);
    expect(report.dependencyAudit.blockedByDependencyTaskIds).toEqual(['task-2']);
    expect(report.dependencyAudit.longestOpenPath).toEqual(['task-1', 'task-2']);
    expect(report.dependencyAudit.estimatedMinutes).toBe(50);
    expect(report.nextActions[0]?.taskId).toBe('task-1');
  });

  it('fails closed on a missing dependency and never certifies 10/10', () => {
    const task = makeTask({ dependencies: ['task-does-not-exist'] });
    const report = analyzeAutonomousProjectManagement({
      objectives: [makeObjective()],
      tasks: [task],
      approvals: [],
      sourceSha: 'sha-test',
      nowMs: NOW,
      configuredConcurrency: 12,
    });

    expect(report.dependencyAudit.valid).toBe(false);
    expect(report.dependencyAudit.missingDependencies).toEqual([
      { taskId: 'task-1', dependencyId: 'task-does-not-exist' },
    ]);
    expect(report.brain.tenOfTenCertified).toBe(false);
    expect(report.maturity.tenOfTenCertified).toBe(false);
    expect(report.maturity.blockers).toContain('dependency_graph_invalid');
  });

  it('reports absent estimates instead of inventing a delivery duration', () => {
    const first = makeTask({ estimatedMinutes: null });
    const second = makeTask({
      taskId: 'task-2',
      idempotencyKey: 'pm-test:task-2',
      dependencies: ['task-1'],
      estimatedMinutes: 20,
    });
    const report = analyzeAutonomousProjectManagement({
      objectives: [makeObjective()],
      tasks: [first, second],
      approvals: [],
      sourceSha: 'sha-test',
      nowMs: NOW,
    });

    expect(report.dependencyAudit.estimateComplete).toBe(false);
    expect(report.dependencyAudit.estimatedMinutes).toBeNull();
  });

  it('orders overdue high-value work ahead of equivalent undated work', () => {
    const overdue = makeTask({ taskId: 'overdue', idempotencyKey: 'overdue', dueAt: '2026-09-06T00:00:00.000Z' });
    const undated = makeTask({ taskId: 'undated', idempotencyKey: 'undated', dueAt: null });

    expect(taskSchedulingScore(overdue, NOW)).toBeGreaterThan(taskSchedulingScore(undated, NOW));
    expect([undated, overdue].sort((a, b) => compareProjectManagedTasks(a, b, NOW))[0]?.taskId).toBe('overdue');
  });

  it('certifies exactly the requested nine capabilities only when every proof threshold is 10/10', () => {
    const tasks = Array.from({ length: 20 }, (_, index) => makeVerifiedCapabilityTask(index));
    const report = analyzeAutonomousProjectManagement({
      objectives: [makeObjective()],
      tasks,
      approvals: [],
      sourceSha: 'qa-sha',
      nowMs: NOW,
      configuredConcurrency: 12,
    });

    expect(report.capabilityCertification.capabilities.map((item) => item.id)).toEqual([
      'brain',
      'reasoning',
      'capacity',
      'skill',
      'experience',
      'retention',
      'intelligence',
      'self_upgrade',
      'learning',
    ]);
    expect(report.capabilityCertification.capabilities).toHaveLength(9);
    expect(report.capabilityCertification.capabilities.every((item) => item.scoreOutOf10 === 10)).toBe(true);
    expect(report.capabilityCertification.capabilities.every((item) => item.status === 'VERIFIED_10_10')).toBe(true);
    expect(report.capabilityCertification.scoreOutOf10).toBe(10);
    expect(report.capabilityCertification.allNineTenOfTenVerified).toBe(true);
    expect(report.brain.tenOfTenCertified).toBe(true);
  });

  it('does not award lease-integrity capacity credit when there is no active or recently verified work', () => {
    const report = analyzeAutonomousProjectManagement({
      objectives: [makeObjective()],
      tasks: [makeTask({ state: 'QUEUED' })],
      approvals: [],
      sourceSha: 'qa-sha',
      nowMs: NOW,
      configuredConcurrency: 12,
    });
    const capacity = report.capabilityCertification.capabilities.find((item) => item.id === 'capacity');
    expect(capacity?.evidence.find((item) => item.metric === 'fresh_lease_integrity')?.actual).toBe(0);
    expect(capacity?.status).not.toBe('VERIFIED_10_10');
  });
});
