import { describe, expect, it } from 'bun:test';
import { createSeniorJobAdmission } from './ivx-senior-job-admission';
const jobs = (count: number) => Array.from({ length: count }, (_, i) => ({ jobId: `job-${i}`, ownerId: `agent-${i}`, status: 'queued', createdAt: new Date().toISOString() }));
describe('senior worker concurrent admission', () => {
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
