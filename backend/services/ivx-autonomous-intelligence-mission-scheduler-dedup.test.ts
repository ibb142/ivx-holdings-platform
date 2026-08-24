import { describe, expect, it } from 'bun:test';
import {
  IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
  isCompletedMissionReusable,
  type MissionSchedulerState,
} from './ivx-autonomous-intelligence-mission-scheduler';

function state(overrides: Partial<MissionSchedulerState> = {}): MissionSchedulerState {
  return {
    marker: IVX_AUTONOMOUS_INTELLIGENCE_MISSION_SCHEDULER_MARKER,
    startedAt: '2026-08-23T00:00:00.000Z',
    schedulerJobId: 'scheduler-1',
    deploySha: 'old-deploy',
    missionJobId: 'ivx-worker-1',
    status: 'completed',
    stage: 'COMPLETED',
    progressPercent: 100,
    stageDetail: 'done',
    inspectedFiles: ['backend/services/ivx-autonomous-intelligence-mission-scheduler.ts'],
    changedFiles: ['expo/evidence/autonomous/ivx-autonomous-intelligence-mission-scheduler-cert.json'],
    commitSha: 'commit-1',
    prNumber: 288,
    prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/288',
    prMerged: true,
    prMergeCommitSha: 'merge-1',
    deployId: null,
    liveCommit: null,
    healthOk: null,
    completedAt: '2026-08-23T00:01:00.000Z',
    error: null,
    updatedAt: '2026-08-23T00:01:00.000Z',
    ...overrides,
  };
}

describe('AIMS duplicate mission prevention', () => {
  it('reuses a completed merged evidence-only mission', () => {
    expect(isCompletedMissionReusable(state())).toBe(true);
  });

  it('does not suppress a failed mission', () => {
    expect(isCompletedMissionReusable(state({ status: 'failed', error: 'real failure' }))).toBe(false);
  });

  it('does not suppress a mission whose PR never merged', () => {
    expect(isCompletedMissionReusable(state({ prMerged: false }))).toBe(false);
  });

  it('does not suppress a mission without durable worker identity', () => {
    expect(isCompletedMissionReusable(state({ missionJobId: null }))).toBe(false);
  });
});
