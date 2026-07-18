/**
 * Unit tests for the IVX Engineering OS pure logic:
 * team registry invariants, pipeline order enforcement, RM-only deploy rule,
 * owner-approval requirement, VERIFIED evidence gate and report formatting.
 */
import { describe, expect, test } from 'bun:test';
import {
  EMPTY_ENGINEERING_EVIDENCE,
  IVX_ENGINEERING_PIPELINE,
  IVX_ENGINEERING_TEAMS,
  IVX_RELEASE_MANAGER_TEAM_ID,
  evaluateStageTransition,
  evaluateVerifiedEvidence,
  formatEngineeringReport,
  resolveTeamStatusOnSync,
  statusForStage,
} from './ivx-engineering-os';

const FULL_EVIDENCE = {
  commitSha: 'ff256490b9a7',
  renderDeployId: 'dep-test-0001',
  testResults: '62/62 pass',
  healthVerification: 'HTTP 200 commit ff256490b9a7',
};

describe('team registry', () => {
  test('registers exactly 12 teams with unique ids', () => {
    expect(IVX_ENGINEERING_TEAMS.length).toBe(12);
    const ids = new Set(IVX_ENGINEERING_TEAMS.map((t) => t.teamId));
    expect(ids.size).toBe(12);
  });

  test('ONLY the Release Manager (TEAM-12) can merge, tag or deploy', () => {
    for (const team of IVX_ENGINEERING_TEAMS) {
      const isRM = team.teamId === IVX_RELEASE_MANAGER_TEAM_ID;
      expect(team.canMerge).toBe(isRM);
      expect(team.canTag).toBe(isRM);
      expect(team.canDeploy).toBe(isRM);
    }
  });

  test('QA and Monitoring are the continuous 24/7 teams', () => {
    const continuous = IVX_ENGINEERING_TEAMS.filter((t) => t.continuous).map((t) => t.teamId);
    expect(continuous).toEqual(['TEAM-06', 'TEAM-10']);
  });

  test('all teams start honestly as REGISTERED_STANDBY', () => {
    for (const team of IVX_ENGINEERING_TEAMS) {
      expect(team.status).toBe('REGISTERED_STANDBY');
    }
  });
});

describe('activation status preservation (owner Phase 1 approval)', () => {
  test('a registry re-sync NEVER demotes an owner-activated team', () => {
    expect(resolveTeamStatusOnSync('ACTIVE')).toBe('ACTIVE');
  });

  test('standby, missing, or corrupted statuses reset to the honest initial state', () => {
    expect(resolveTeamStatusOnSync('REGISTERED_STANDBY')).toBe('REGISTERED_STANDBY');
    expect(resolveTeamStatusOnSync(undefined)).toBe('REGISTERED_STANDBY');
    expect(resolveTeamStatusOnSync(null)).toBe('REGISTERED_STANDBY');
    expect(resolveTeamStatusOnSync('active')).toBe('REGISTERED_STANDBY');
    expect(resolveTeamStatusOnSync(42)).toBe('REGISTERED_STANDBY');
    expect(resolveTeamStatusOnSync('VERIFIED')).toBe('REGISTERED_STANDBY');
  });
});

describe('pipeline order', () => {
  test('pipeline matches the owner-mandated continuous loop', () => {
    expect(IVX_ENGINEERING_PIPELINE[0]).toBe('COLLECT_BUGS');
    expect(IVX_ENGINEERING_PIPELINE[IVX_ENGINEERING_PIPELINE.length - 1]).toBe('MONITOR');
    expect(IVX_ENGINEERING_PIPELINE.indexOf('OWNER_APPROVAL')).toBeLessThan(IVX_ENGINEERING_PIPELINE.indexOf('PRODUCTION_DEPLOY'));
  });

  test('allows a single forward step', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'COLLECT_BUGS',
      toStage: 'ANALYZE',
      actorTeamId: 'TEAM-01',
      ownerApproved: false,
      evidence: null,
    });
    expect(verdict.allowed).toBe(true);
    expect(verdict.blocker).toBeNull();
  });

  test('rejects skipping stages', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'ANALYZE',
      toStage: 'DEVELOP',
      actorTeamId: 'TEAM-03',
      ownerApproved: false,
      evidence: null,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.blocker).toBe('PIPELINE_ORDER_VIOLATION');
  });

  test('rejects moving backwards', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'CODE_REVIEW',
      toStage: 'DEVELOP',
      actorTeamId: 'TEAM-03',
      ownerApproved: false,
      evidence: null,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.blocker).toBe('PIPELINE_ORDER_VIOLATION');
  });
});

describe('production deploy gates', () => {
  test('blocks deploy without owner approval even for the Release Manager', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'OWNER_APPROVAL',
      toStage: 'PRODUCTION_DEPLOY',
      actorTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      ownerApproved: false,
      evidence: FULL_EVIDENCE,
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.blocker).toBe('OWNER_APPROVAL_REQUIRED');
  });

  test('blocks deploy by any team other than TEAM-12 even with owner approval', () => {
    for (const team of IVX_ENGINEERING_TEAMS) {
      if (team.teamId === IVX_RELEASE_MANAGER_TEAM_ID) continue;
      const verdict = evaluateStageTransition({
        fromStage: 'OWNER_APPROVAL',
        toStage: 'PRODUCTION_DEPLOY',
        actorTeamId: team.teamId,
        ownerApproved: true,
        evidence: FULL_EVIDENCE,
      });
      expect(verdict.allowed).toBe(false);
      expect(verdict.blocker).toBe('RELEASE_MANAGER_ONLY');
    }
  });

  test('allows deploy only for TEAM-12 with owner approval', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'OWNER_APPROVAL',
      toStage: 'PRODUCTION_DEPLOY',
      actorTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      ownerApproved: true,
      evidence: null,
    });
    expect(verdict.allowed).toBe(true);
  });
});

describe('VERIFIED evidence gate (owner rule 5)', () => {
  test('empty evidence reports all four missing fields', () => {
    const proof = evaluateVerifiedEvidence(EMPTY_ENGINEERING_EVIDENCE);
    expect(proof.complete).toBe(false);
    expect(proof.missing).toEqual(['commitSha', 'renderDeployId', 'testResults', 'healthVerification']);
  });

  test('partial evidence is not complete', () => {
    const proof = evaluateVerifiedEvidence({ commitSha: 'abc123', testResults: 'pass' });
    expect(proof.complete).toBe(false);
    expect(proof.missing).toEqual(['renderDeployId', 'healthVerification']);
  });

  test('whitespace-only values do not count as evidence', () => {
    const proof = evaluateVerifiedEvidence({ ...FULL_EVIDENCE, commitSha: '   ' });
    expect(proof.complete).toBe(false);
    expect(proof.missing).toEqual(['commitSha']);
  });

  test('blocks PROOF_LEDGER without complete evidence', () => {
    const verdict = evaluateStageTransition({
      fromStage: 'HEALTH_VERIFICATION',
      toStage: 'PROOF_LEDGER',
      actorTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      ownerApproved: true,
      evidence: { commitSha: 'abc123' },
    });
    expect(verdict.allowed).toBe(false);
    expect(verdict.blocker).toBe('VERIFIED_EVIDENCE_INCOMPLETE');
    expect(verdict.missingEvidence).toEqual(['renderDeployId', 'testResults', 'healthVerification']);
  });

  test('allows PROOF_LEDGER and MONITOR with full evidence', () => {
    const toLedger = evaluateStageTransition({
      fromStage: 'HEALTH_VERIFICATION',
      toStage: 'PROOF_LEDGER',
      actorTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      ownerApproved: true,
      evidence: FULL_EVIDENCE,
    });
    expect(toLedger.allowed).toBe(true);
    const toMonitor = evaluateStageTransition({
      fromStage: 'PROOF_LEDGER',
      toStage: 'MONITOR',
      actorTeamId: IVX_RELEASE_MANAGER_TEAM_ID,
      ownerApproved: true,
      evidence: FULL_EVIDENCE,
    });
    expect(toMonitor.allowed).toBe(true);
  });
});

describe('statusForStage', () => {
  test('OWNER_APPROVAL implies WAITING_APPROVAL', () => {
    expect(statusForStage('OWNER_APPROVAL', null)).toBe('WAITING_APPROVAL');
  });

  test('MONITOR is VERIFIED only with complete evidence', () => {
    expect(statusForStage('MONITOR', FULL_EVIDENCE)).toBe('VERIFIED');
    expect(statusForStage('MONITOR', { commitSha: 'abc' })).toBe('BLOCKED');
  });

  test('intermediate stages imply RUNNING', () => {
    expect(statusForStage('DEVELOP', null)).toBe('RUNNING');
    expect(statusForStage('AUTOMATED_TESTS', null)).toBe('RUNNING');
  });
});

describe('2-hour report format (owner rule 7)', () => {
  test('contains every mandated section', () => {
    const body = formatEngineeringReport({
      generatedAt: '2026-07-18T13:00:00.000Z',
      completed: [{ title: 'Fix RLS', team_id: 'TEAM-04' }],
      active: [{ title: 'API hardening', team_id: 'TEAM-03', stage: 'DEVELOP' }],
      blockers: [{ title: 'EAS build', team_id: 'TEAM-09', blocker: 'EAS credentials missing', status: 'BLOCKED' }],
      waitingApproval: [{ title: 'Deploy v1.4.7', team_id: 'TEAM-12' }],
      health: { ok: true, commit: 'ff256490b9a7', detail: 'HTTP 200' },
      nextPriorities: ['[TEAM-06] regression run'],
    });
    expect(body).toContain('COMPLETED TASKS (1)');
    expect(body).toContain('ACTIVE TASKS (1)');
    expect(body).toContain('WAITING OWNER APPROVAL (1)');
    expect(body).toContain('BLOCKERS (1)');
    expect(body).toContain('DEPLOYMENTS');
    expect(body).toContain('PRODUCTION HEALTH: OK');
    expect(body).toContain('NEXT PRIORITIES');
    expect(body).toContain('commit ff256490b9a7');
    expect(body).toContain('EAS credentials missing');
  });

  test('reports FAIL health honestly and handles empty sections', () => {
    const body = formatEngineeringReport({
      generatedAt: '2026-07-18T13:00:00.000Z',
      completed: [],
      active: [],
      blockers: [],
      waitingApproval: [],
      health: { ok: false, commit: null, detail: 'HTTP 503' },
      nextPriorities: [],
    });
    expect(body).toContain('PRODUCTION HEALTH: FAIL');
    expect(body).toContain('none this window');
    expect(body).toContain('awaiting owner goals');
  });
});
