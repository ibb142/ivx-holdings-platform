import { describe, expect, it } from 'bun:test';
import { createSeniorJobAdmission } from './ivx-senior-job-admission';
const jobs = (count: number) => Array.from({ length: count }, (_, i) => ({ jobId: `job-${i}`, ownerId: `agent-${i}`, status: 'queued', createdAt: new Date().toISOString() }));
describe('senior worker concurrent admission', () => {
  it('continues after PostgreSQL rejects an owner whose stale uncommitted work is still active', async () => {
    const pending = jobs(3);
    pending[1].ownerId = pending[0].ownerId;
    const orphan = { ...pending[0], jobId: 'stale-uncommitted', status: 'running',
      createdAt: new Date(Date.now() - 600_000).toISOString() };
    const claimed = new Set<string>(), calls: string[] = [];
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000,
      stopped: () => false, read: async () => ({ jobs: [orphan, ...pending] }),
      claim: async job => { calls.push(job.jobId); return job.ownerId === orphan.ownerId ? null : job; } });
    expect((await next())?.jobId).toBe('job-2');
    expect(calls).toEqual(['job-0', 'job-2']);
    expect([...claimed]).toEqual(['job-2']);
    expect(orphan.status).toBe('running');
  });
  it('bounds rejected claims to one attempt per owner in the current selection', async () => {
    const queue = jobs(6).map((job, i) => ({ ...job, ownerId: `owner-${i % 2}` }));
    const claimed = new Set<string>(), calls: string[] = [];
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000,
      stopped: () => false, read: async () => ({ jobs: queue }),
      claim: async job => { calls.push(job.ownerId); return null; } });
    expect(await next()).toBeNull();
    expect(calls).toEqual(['owner-0', 'owner-1']);
    expect(claimed.size).toBe(0);
  });
  it('does not try another owner after an ambiguous claim transport failure', async () => {
    const claimed = new Set<string>(), calls: string[] = [];
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000,
      stopped: () => false, read: async () => ({ jobs: jobs(2) }),
      claim: async job => { calls.push(job.jobId); throw new Error('claim response lost'); } });
    await expect(next()).rejects.toThrow('claim response lost');
    expect(calls).toEqual(['job-0']);
    expect(claimed.size).toBe(0);
  });
  it('honors an owner stop raised after a rejected claim', async () => {
    const claimed = new Set<string>(), calls: string[] = [];
    let stopped = false;
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000,
      stopped: () => stopped, read: async () => ({ jobs: jobs(2) }),
      claim: async job => { calls.push(job.jobId); stopped = true; return null; } });
    expect(await next()).toBeNull();
    expect(calls).toEqual(['job-0']);
    expect(claimed.size).toBe(0);
  });
  for (const protectedWork of ['expired-commit', 'live-lease'] as const) {
    it(`admits another owner with one execution slot while ${protectedWork} awaits recovery`, async () => {
      const pending = jobs(2);
      const orphan = { ...jobs(1)[0], jobId: 'orphan', status: 'running',
        lastHeartbeatAt: new Date(Date.now() - 600_000).toISOString(),
        leaseExpiresAt: new Date(Date.now() + (protectedWork === 'live-lease' ? 60_000 : -60_000)).toISOString(),
        result: protectedWork === 'expired-commit' ? { commitSha: 'a'.repeat(40) } : null };
      const queue = { jobs: [orphan, ...pending] };
      const calls: string[] = [];
      const next = createSeniorJobAdmission({ claimed: new Set<string>(), active: new Set(['running']),
        staleAfterMs: 60_000, stopped: () => false, read: async () => queue,
        claim: async job => { calls.push(job.jobId); return job.ownerId === orphan.ownerId ? null : job; } });
      expect((await next())?.jobId).toBe('job-1');
      expect(calls).toEqual(['job-1']);
      expect(orphan.status).toBe('running');
    });
  }
  it('leaves committed retries to verification recovery and admits other queued work', async () => {
    const queue = { jobs: jobs(2).map((job, i) => ({ ...job, result: i === 0 ? { commitSha: 'a'.repeat(40) } : null })) };
    const claimedIds: string[] = [];
    const next = createSeniorJobAdmission({ claimed: new Set<string>(), active: new Set(['running']),
      staleAfterMs: 60_000, stopped: () => false, read: async () => queue,
      claim: async job => { claimedIds.push(job.jobId); return { ...job, status: 'running' }; } });
    expect((await next())?.jobId).toBe('job-1');
    expect(claimedIds).toEqual(['job-1']);
    expect(queue.jobs[0].result?.commitSha).toBe('a'.repeat(40));
  });
  it('admits 112 distinct jobs with one selection read and at most four concurrent durable claims', async () => {
    let reads = 0, activeClaims = 0, peakClaims = 0;
    const claimed = new Set<string>();
    const queue = { jobs: jobs(112) };
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000, stopped: () => false,
      read: async () => { reads++; return queue; },
      claim: async job => {
        activeClaims++; peakClaims = Math.max(peakClaims, activeClaims);
        await new Promise(resolve => setTimeout(resolve, 1)); activeClaims--;
        return { ...job, status: 'running' };
      },
    });
    const results = await Promise.all(Array.from({ length: 112 }, () => next()));
    expect(reads).toBe(1);
    expect(peakClaims).toBe(4);
    expect(new Set(results.map(job => job?.jobId)).size).toBe(112);
    expect(results.every(job => job?.status === 'running')).toBe(true);
    expect(claimed.size).toBe(112);
  });
  it('reserves an owner before waiting on PostgreSQL and releases a rejected claim', async () => {
    const queue = { jobs: jobs(2).map(job => ({ ...job, ownerId: 'same-owner' })) };
    const claimed = new Set<string>(); let claims = 0;
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000, stopped: () => false,
      read: async () => queue, claim: async () => { claims++; return null; } });
    expect(await Promise.all([next(), next()])).toEqual([null, null]);
    expect(claims).toBe(1);
    expect(claimed.size).toBe(0);
    await next(); expect(claims).toBe(2);
  });
  it('does not retain a local reservation after a claim transport failure', async () => {
    const claimed = new Set<string>();
    const next = createSeniorJobAdmission({ claimed, active: new Set(['running']), staleAfterMs: 60_000, stopped: () => false,
      read: async () => ({ jobs: jobs(1) }), claim: async () => { throw new Error('database unavailable'); } });
    await expect(next()).rejects.toThrow('database unavailable');
    expect(claimed.size).toBe(0);
  });
});
