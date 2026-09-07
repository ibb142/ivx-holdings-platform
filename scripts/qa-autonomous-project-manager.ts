/** Standalone QA for environments where Bun's test runner is unavailable. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { withAutonomousTaskEngineOwner } from '../backend/api/ivx-autonomous-task-engine-api';
import { withIVXOwnerOnly } from '../backend/api/ivx-owner-route';
import { analyzeAutonomousProjectManagement } from '../backend/services/ivx-autonomous-project-manager';
import { compareProjectManagedTasks, isTaskWithinMissionScope, type Objective, type Task } from '../backend/services/ivx-autonomous-task-engine';
import { validateIVXGitHubOIDCClaims } from '../backend/services/ivx-github-actions-oidc';
import { LANDING_P0_PREFIX, LANDING_P0_REPAIR_PREFIX, parseLandingTaskKey } from '../backend/services/ivx-landing-p0-backlog';

const nowMs = Date.parse('2026-09-07T02:00:00.000Z');

function task(overrides: Partial<Task> = {}): Task {
  return {
    taskId: 'task-1', objectiveId: 'objective-1', parentTaskId: null,
    title: 'Secure task engine', description: 'Evidence-backed security change', taskType: 'security', state: 'QUEUED',
    idempotencyKey: 'qa-pm:task-1', assignedAgentNumber: 43, assignedEngine: 'ivx_security_lead', priority: 'critical',
    businessValue: 5, estimatedMinutes: 30, milestone: 'secure-control-plane', ownerRole: 'Security Lead',
    dueAt: '2026-09-07T03:00:00.000Z', acceptanceCriteria: [], dependencies: [], executionOrder: 1,
    leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null, retryCount: 0, maxRetries: 3,
    error: null, blocker: null, evidence: [], filesChanged: [], recordsChanged: 0, commitSha: null,
    deploymentId: null, approvalId: null, createdAt: '2026-09-06T00:00:00.000Z',
    updatedAt: '2026-09-06T00:00:00.000Z', startedAt: null, completedAt: null, traceId: null,
    ...overrides,
  };
}

const objective: Objective = {
  objectiveId: 'objective-1', originalOwnerRequest: 'Upgrade Autonomous as PM',
  businessOutcome: 'Finish IVX safely', technicalOutcome: 'Evidence control tower', scope: 'Autonomous PM', exclusions: [],
  riskClassification: 'high', requiredApprovals: ['production_deployment'], acceptanceCriteria: [], priority: 'critical',
  estimatedEffort: 'medium', ownerRole: 'Autonomous Project Manager', targetDate: '2026-09-10T00:00:00.000Z',
  successMetrics: ['No unauthorized access', 'Evidence-backed completion'], assignedEngine: 'ivx_security_lead',
  rollbackRequirement: true, finalVerificationMethod: 'production_check', createdAt: '2026-09-06T00:00:00.000Z', status: 'active',
};

function verifiedCapabilityTask(index: number): Task {
  const createdAt = new Date(nowMs - 60_000).toISOString();
  const completedAt = new Date(nowMs - 1_000).toISOString();
  return task({
    taskId: `capability-${index}`,
    title: 'Architecture backend/API Expo mobile web Supabase database auth security QA E2E performance latency deploy Render monitoring incident media video',
    taskType: 'development',
    state: 'VERIFIED',
    idempotencyKey: `decision-quality:qa-sha:capability:${index}`,
    assignedAgentNumber: (index % 12) + 1,
    assignedEngine: `ivx_capability_agent_${(index % 12) + 1}`,
    dueAt: new Date(nowMs + 86_400_000).toISOString(),
    acceptanceCriteria: [{ id: `criterion-${index}`, description: 'Exact proof passes', verificationMethod: 'production_check', met: true, evidence: `proof-${index}` }],
    evidence: [
      { evidenceId: `test-${index}`, evidenceType: 'test_result', source: 'ci', contentHash: `test-${index}`, summary: 'Exact-SHA test passed', createdAt: completedAt, commitSha: 'qa-sha', deploymentId: null },
      { evidenceId: `prod-${index}`, evidenceType: 'production_verification', source: 'production', contentHash: `prod-${index}`, summary: 'Exact-SHA production proof passed', createdAt: completedAt, commitSha: 'qa-sha', deploymentId: 'deploy-qa' },
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

async function main(): Promise<void> {
  const first = task();
  const second = task({ taskId: 'task-2', idempotencyKey: 'qa-pm:task-2', title: 'Verify production', taskType: 'qa',
    assignedAgentNumber: 44, assignedEngine: 'ivx_qa_engineer', dependencies: ['task-1'], executionOrder: 2, estimatedMinutes: 20 });
  const report = analyzeAutonomousProjectManagement({ objectives: [objective], tasks: [first, second], approvals: [], sourceSha: 'qa-sha', nowMs, configuredConcurrency: 12 });

  assert.deepEqual(report.dependencyAudit.readyTaskIds, ['task-1']);
  assert.deepEqual(report.dependencyAudit.blockedByDependencyTaskIds, ['task-2']);
  assert.deepEqual(report.dependencyAudit.longestOpenPath, ['task-1', 'task-2']);
  assert.equal(report.dependencyAudit.estimatedMinutes, 50);
  assert.equal(report.brain.tenOfTenCertified, false);
  assert.equal(
    report.capabilityCertification.capabilities
      .find((item) => item.id === 'capacity')
      ?.evidence.find((item) => item.metric === 'fresh_lease_integrity')
      ?.actual,
    0,
  );

  const invalid = analyzeAutonomousProjectManagement({
    objectives: [objective], tasks: [task({ dependencies: ['missing-task'] })], approvals: [], sourceSha: 'qa-sha', nowMs,
  });
  assert.equal(invalid.dependencyAudit.valid, false);
  assert.equal(invalid.maturity.tenOfTenCertified, false);

  const exactTen = analyzeAutonomousProjectManagement({
    objectives: [objective],
    tasks: Array.from({ length: 20 }, (_, index) => verifiedCapabilityTask(index)),
    approvals: [],
    sourceSha: 'qa-sha',
    nowMs,
    configuredConcurrency: 12,
  });
  assert.deepEqual(exactTen.capabilityCertification.capabilities.map((item) => item.id), [
    'brain', 'reasoning', 'capacity', 'skill', 'experience', 'retention', 'intelligence', 'self_upgrade', 'learning',
  ]);
  assert.equal(exactTen.capabilityCertification.capabilities.length, 9);
  assert.equal(exactTen.capabilityCertification.capabilities.every((item) => item.scoreOutOf10 === 10), true);
  assert.equal(exactTen.capabilityCertification.allNineTenOfTenVerified, true);

  const wrongSha = analyzeAutonomousProjectManagement({
    objectives: [objective],
    tasks: Array.from({ length: 20 }, (_, index) => ({
      ...verifiedCapabilityTask(index),
      commitSha: 'wrong-sha',
    })),
    approvals: [],
    sourceSha: 'qa-sha',
    nowMs,
    configuredConcurrency: 12,
  });
  assert.equal(wrongSha.quality.testEvidenceRate.rate, 0);
  assert.equal(wrongSha.quality.productionVerificationRate.rate, 0);
  assert.equal(wrongSha.capabilityCertification.allNineTenOfTenVerified, false);

  assert.equal(validateIVXGitHubOIDCClaims({
    iss: 'https://token.actions.githubusercontent.com',
    aud: 'ivx-360-autonomous-recovery',
    exp: Math.floor(nowMs / 1_000) + 300,
    nbf: Math.floor(nowMs / 1_000) - 10,
    repository: 'ibb142/ivx-holdings-platform',
    repository_id: '1169662811',
    repository_owner_id: '74543014',
    ref: 'refs/heads/main',
    workflow_ref: 'ibb142/ivx-holdings-platform/.github/workflows/ivx-112-continuous-500-cycle.yml@refs/heads/main',
    event_name: 'workflow_dispatch',
    sub: 'repo:ibb142/ivx-holdings-platform:ref:refs/heads/main',
  }, Math.floor(nowMs / 1_000)), true);

  const overdue = task({ taskId: 'overdue', idempotencyKey: 'overdue', dueAt: '2026-09-06T00:00:00.000Z' });
  const undated = task({ taskId: 'undated', idempotencyKey: 'undated', dueAt: null });
  assert.equal([undated, overdue].sort((a, b) => compareProjectManagedTasks(a, b, nowMs))[0]?.taskId, 'overdue');

  const currentSha = 'current-sha';
  const missionScope = {
    familyPrefixes: [LANDING_P0_PREFIX, LANDING_P0_REPAIR_PREFIX],
    activePrefixes: [`${LANDING_P0_PREFIX}${currentSha}:`, `${LANDING_P0_REPAIR_PREFIX}${currentSha}:`],
  };
  assert.equal(parseLandingTaskKey(`${LANDING_P0_PREFIX}old-sha:ivx_holdings_54:structure.nav`)?.unitId, 'structure.nav');
  assert.equal(isTaskWithinMissionScope(task({ idempotencyKey: `${LANDING_P0_PREFIX}old-sha:ivx_holdings_54:structure.nav` }), missionScope), false);
  assert.equal(isTaskWithinMissionScope(task({ idempotencyKey: `${LANDING_P0_PREFIX}${currentSha}:structure.nav` }), missionScope), true);
  assert.equal(isTaskWithinMissionScope(task({ idempotencyKey: 'module-audit:current-sha:ivx_holdings_1:1:backend/api/x.ts' }), missionScope), true);

  const routeChecks = [
    ['GET', '/api/ivx/autonomous-task-engine/tasks'],
    ['POST', '/api/ivx/autonomous-task-engine/tasks'],
    ['GET', '/api/ivx/autonomous-task-engine/approvals'],
    ['GET', '/api/ivx/autonomous-core/project-manager'],
    ['POST', '/api/ivx/self-upgrade/run'],
    ['POST', '/api/ivx/agent-code-executor/112-cert'],
  ] as const;
  const guardedApp = new Hono();
  const unreachable = withAutonomousTaskEngineOwner(async (c) => c.json({ ok: true }));
  guardedApp.get('/api/ivx/autonomous-task-engine/tasks', unreachable);
  guardedApp.post('/api/ivx/autonomous-task-engine/tasks', unreachable);
  guardedApp.get('/api/ivx/autonomous-task-engine/approvals', unreachable);
  guardedApp.get('/api/ivx/autonomous-core/project-manager', unreachable);
  const protectedMutation = withIVXOwnerOnly(async (c) => c.json({ ok: true }));
  guardedApp.post('/api/ivx/self-upgrade/run', protectedMutation);
  guardedApp.post('/api/ivx/agent-code-executor/112-cert', protectedMutation);
  const statuses: Record<string, number> = {};
  for (const [method, path] of routeChecks) {
    const response = await guardedApp.request(path, { method });
    statuses[`${method} ${path}`] = response.status;
    assert.equal(response.status, 401, `${method} ${path} must reject anonymous access`);
  }

  const dailyUpgradeSource = readFileSync(new URL('../backend/services/ivx-daily-self-upgrade.ts', import.meta.url), 'utf8');
  assert.equal(dailyUpgradeSource.includes('Current state: 112 IA agents live'), false);
  assert.match(dailyUpgradeSource, /getAutonomousTruthSnapshot/);
  assert.match(dailyUpgradeSource, /runAutonomousDecisionQualityLoop/);
  assert.match(dailyUpgradeSource, /allNineTenOfTenVerified/);
  assert.match(dailyUpgradeSource, /writeDurableJson/);

  const executorSource = readFileSync(new URL('../backend/api/ivx-agent-code-executor.ts', import.meta.url), 'utf8');
  assert.match(executorSource, /const certified112 = false/);

  console.log(JSON.stringify({
    ok: true,
    projectManager: {
      dependencyPath: report.dependencyAudit.longestOpenPath,
      estimatedMinutes: report.dependencyAudit.estimatedMinutes,
      tenOfTenCertified: report.maturity.tenOfTenCertified,
      exactNineCapabilityGateProven: exactTen.capabilityCertification.allNineTenOfTenVerified,
      exactNineCapabilityCount: exactTen.capabilityCertification.capabilities.length,
      wrongShaRejected: wrongSha.capabilityCertification.allNineTenOfTenVerified === false,
      legacyLandingKeyNormalized: true,
      staleLandingShaExcluded: true,
      false112PromptRemoved: true,
      oneAgentCannotCertify112: true,
      continuous500OidcAccepted: true,
      selfUpgradeCreatesBoundedCorrectiveWork: true,
      zeroActivityCapacityInflationRejected: true,
    },
    routeChecks: statuses,
  }, null, 2));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
