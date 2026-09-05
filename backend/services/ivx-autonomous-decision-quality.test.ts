import { describe, expect, it } from 'bun:test';
import {
  IVX_AUTONOMOUS_DECISION_QUALITY_MARKER,
  IVX_DECISION_DOMAINS,
  classifyTaskDomains,
  computeDecisionQualitySnapshot,
} from './ivx-autonomous-decision-quality';
import type { Task, TaskEvidence } from './ivx-autonomous-task-engine';

const NOW = Date.parse('2026-09-05T02:30:00.000Z');
const SHA = 'decision-quality-test-sha';

function evidence(type: TaskEvidence['evidenceType'], source: string): TaskEvidence {
  return {
    evidenceId: `ev-${type}-${source}`,
    evidenceType: type,
    source,
    contentHash: `hash-${type}-${source}`,
    summary: `evidence ${type} for ${source}`,
    createdAt: new Date(NOW - 60_000).toISOString(),
    commitSha: SHA,
    deploymentId: type === 'deployment_id' || type === 'production_verification' ? 'dep-test' : null,
  };
}

function task(input: Partial<Task> & Pick<Task, 'taskId' | 'title' | 'idempotencyKey'>): Task {
  return {
    taskId: input.taskId,
    objectiveId: null,
    parentTaskId: null,
    title: input.title,
    description: input.description ?? input.title,
    taskType: input.taskType ?? 'qa',
    state: input.state ?? 'VERIFIED',
    idempotencyKey: input.idempotencyKey,
    assignedAgentNumber: input.assignedAgentNumber ?? 1,
    assignedEngine: input.assignedEngine ?? null,
    priority: input.priority ?? 'medium',
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    dependencies: [],
    executionOrder: 0,
    leaseHolder: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    retryCount: input.retryCount ?? 0,
    maxRetries: 3,
    error: input.error ?? null,
    blocker: input.blocker ?? null,
    evidence: input.evidence ?? [evidence('source_file_inspected', input.title)],
    filesChanged: input.filesChanged ?? [],
    recordsChanged: 0,
    commitSha: input.commitSha ?? null,
    deploymentId: input.deploymentId ?? null,
    approvalId: input.approvalId ?? null,
    createdAt: input.createdAt ?? new Date(NOW - 10 * 60_000).toISOString(),
    updatedAt: input.updatedAt ?? new Date(NOW - 60_000).toISOString(),
    startedAt: input.startedAt ?? new Date(NOW - 8 * 60_000).toISOString(),
    completedAt: input.completedAt ?? new Date(NOW - 60_000).toISOString(),
    traceId: null,
  };
}

describe('Autonomous decision quality closed loop', () => {
  it('exports an evidence-derived decision quality marker and full global domain map', () => {
    expect(IVX_AUTONOMOUS_DECISION_QUALITY_MARKER).toContain('decision-quality');
    expect(IVX_DECISION_DOMAINS.map((domain) => domain.id)).toEqual([
      'architecture', 'backend', 'mobile_web', 'database', 'auth_security',
      'qa_e2e', 'performance', 'deployment', 'monitoring', 'media',
    ]);
  });

  it('classifies real work across multiple system surfaces', () => {
    const securityTask = task({
      taskId: 'security',
      title: 'Security auth OIDC audit',
      description: 'Inspect backend auth permissions and GitHub OIDC validation',
      idempotencyKey: 'security:auth',
      taskType: 'security',
      filesChanged: ['backend/services/ivx-github-actions-oidc.ts'],
    });
    expect(classifyTaskDomains(securityTask)).toContain('auth_security');
    expect(classifyTaskDomains(securityTask)).toContain('backend');

    const mobile = task({
      taskId: 'mobile',
      title: 'Expo Android regression QA',
      idempotencyKey: 'qa:expo',
      filesChanged: ['expo/app/index.tsx'],
    });
    expect(classifyTaskDomains(mobile)).toContain('mobile_web');
    expect(classifyTaskDomains(mobile)).toContain('qa_e2e');
  });

  it('measures uncovered global domains instead of claiming full reach', () => {
    const tasks = [
      task({
        taskId: 'backend-1',
        title: 'Backend API QA',
        idempotencyKey: 'qa:backend',
        filesChanged: ['backend/server.ts'],
        evidence: [evidence('source_file_inspected', 'backend/server.ts'), evidence('test_result', 'backend-tests')],
      }),
      task({
        taskId: 'deploy-1',
        title: 'Render deployment verification',
        idempotencyKey: 'deploy:render',
        taskType: 'deployment',
        filesChanged: ['.github/workflows/ivx-render-live-cert.yml'],
        evidence: [evidence('source_file_inspected', '.github/workflows/ivx-render-live-cert.yml'), evidence('production_verification', 'render-live')],
        deploymentId: 'dep-test',
      }),
    ];

    const snapshot = computeDecisionQualitySnapshot(tasks, SHA, NOW);
    expect(snapshot.globalCoverageRate.denominator).toBe(IVX_DECISION_DOMAINS.length);
    expect(snapshot.globalCoverageRate.numerator).toBeLessThan(snapshot.globalCoverageRate.denominator);
    expect(snapshot.priorityDomains.length).toBe(IVX_DECISION_DOMAINS.length);
    expect(snapshot.recommendations.some((item) => item.includes('global coverage'))).toBe(true);
  });

  it('penalizes retries, failures and unsupported VERIFIED outcomes', () => {
    const tasks = [
      task({
        taskId: 'retry',
        title: 'Backend repair after regression',
        idempotencyKey: 'repair:backend',
        taskType: 'development',
        retryCount: 2,
        filesChanged: ['backend/server.ts'],
        evidence: [evidence('source_file_inspected', 'backend/server.ts')],
      }),
      task({
        taskId: 'failed',
        title: 'QA regression failure',
        idempotencyKey: 'qa:failed',
        state: 'FAILED',
        retryCount: 1,
        evidence: [evidence('test_result', 'qa-suite')],
      }),
      task({
        taskId: 'unsupported',
        title: 'Development completion without code diff',
        idempotencyKey: 'dev:unsupported',
        taskType: 'development',
        evidence: [evidence('source_file_inspected', 'backend/server.ts')],
        filesChanged: [],
      }),
    ];

    const snapshot = computeDecisionQualitySnapshot(tasks, SHA, NOW);
    expect(snapshot.retryingTasks).toBeGreaterThan(0);
    expect(snapshot.failedTasks).toBe(1);
    expect(snapshot.firstPassRate.rate).not.toBe(1);
    expect(snapshot.overallScore).toBeLessThan(90);
    expect(snapshot.recommendations.length).toBeGreaterThan(0);
  });

  it('scores agents from actual durable outcomes rather than registry presence', () => {
    const tasks = [
      task({ taskId: 'a1-ok', title: 'Backend QA', idempotencyKey: 'a1:ok', assignedAgentNumber: 1 }),
      task({ taskId: 'a2-fail', title: 'Backend failed QA', idempotencyKey: 'a2:fail', assignedAgentNumber: 2, state: 'FAILED', retryCount: 2 }),
    ];
    const snapshot = computeDecisionQualitySnapshot(tasks, SHA, NOW);
    const a1 = snapshot.agentScores.find((agent) => agent.agentNumber === 1);
    const a2 = snapshot.agentScores.find((agent) => agent.agentNumber === 2);
    expect(a1).toBeDefined();
    expect(a2).toBeDefined();
    expect((a1?.score ?? 0)).toBeGreaterThan(a2?.score ?? 100);
  });
});
