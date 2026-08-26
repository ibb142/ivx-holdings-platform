import { describe, expect, it } from 'bun:test';

const SOURCE_PATH = 'backend/api/ivx-autonomous-control-plane.ts';

async function source(): Promise<string> {
  return Bun.file(SOURCE_PATH).text();
}

describe('IVX Autonomous control-plane truth contract', () => {
  it('never equates registry verification with live work', async () => {
    const text = await source();
    expect(text).toContain('registryVerifiedComplete');
    expect(text).toContain('full112RealWorkObserved');
    expect(text).toContain('Registry verification proves structure only.');
    expect(text).toContain('Registry-only and synthetic heartbeat rows never count.');
    expect(text).not.toContain('liveWorkforceObserved: heartbeating > 0');
  });

  it('requires a canonical dispatcher record, real active job, live heartbeat and task before counting WORKING', async () => {
    const text = await source();
    expect(text).toContain('hasRealDispatcherRecord');
    expect(text).toContain('hasRealJob');
    expect(text).toContain("heartbeat === 'live'");
    expect(text).toContain('ACTIVE_WORKER_STATUSES.has');
    expect(text).toContain('currentTask');
    expect(text).toContain('job?.startedAt');
    expect(text).toContain('job?.lastHeartbeatAt');
  });

  it('only claims the full 112 workforce when all 112 have real live-work evidence', async () => {
    const text = await source();
    expect(text).toContain('dispatcherMappedComplete: dispatcherCoverage === 112');
    expect(text).toContain('full112RealWorkObserved: realWorkingCount === 112');
    expect(text).toContain('campaignComplete: completedWithEvidence === 112');
  });
});
